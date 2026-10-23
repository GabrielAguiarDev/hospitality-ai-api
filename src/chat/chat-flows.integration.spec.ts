import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { InMemoryChatStore } from '../../test/support/in-memory-chat-store.js';
import {
  classification,
  installFetchMock,
  jsonResponse,
  ollamaChat,
  parseBody,
} from '../../test/support/ollama-fakes.js';
import type { FetchMock } from '../../test/support/ollama-fakes.js';
import type { GuestContext } from '../guest/guest-context.js';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { ExperienceAvailabilityService } from '../experiences/experience-availability.service.js';
import { ExperienceBookingService } from '../experiences/experience-booking.service.js';
import { quoteExperience } from '../experiences/experience-pricing.js';
import { ExperiencesCatalogService } from '../experiences/experiences-catalog.service.js';
import type { ExperienceInfo, ExperienceSlot } from '../experiences/experience.types.js';
import { ExperienceOperationsService } from '../operations/experience-operations.service.js';
import { RestaurantOperationsService } from '../operations/restaurant-operations.service.js';
import { GuestStayService } from '../resort/guest-stay.service.js';
import { ResortSnapshotGateway } from '../resort/resort-snapshot.gateway.js';
import { RestaurantsCatalogService, type RestaurantInfo } from '../resort/restaurants-catalog.service.js';
import { OllamaService } from '../llm/ollama.service.js';
import { OperationsAiService } from '../operations/operations-ai.service.js';
import { OperationsDispatcherService } from '../operations/operations-dispatcher.service.js';
import { OperationsToolRegistryService } from '../operations/operations-tool-registry.service.js';
import { RequestsOperationsService } from '../operations/requests-operations.service.js';
import { RequestsService } from '../operations/requests.service.js';
import { ReservationsService } from '../operations/reservations.service.js';
import { EmbeddingsService } from '../rag/embeddings.service.js';
import { KnowledgeService } from '../rag/knowledge.service.js';
import type { RetrievedDocument } from '../rag/knowledge.service.js';
import { RetrievalService } from '../rag/retrieval.service.js';

import type { IntentDecision } from './chat-intent.types.js';
import { ChatOrchestratorService } from './chat-orchestrator.service.js';
import { ChatService } from './chat.service.js';
import { IntentClassifierService } from './intent-classifier.service.js';

/**
 * Wires the real chat pipeline together and fakes only the external edges:
 * Ollama HTTP, the read-only resort snapshot connection, the internal MySQL
 * (in-memory store), ChromaDB (KnowledgeService), the embedding model and the
 * experience catalog/booking persistence. Every flow runs with the classifier
 * model available and with it unavailable, so the deterministic fallback is
 * exercised too.
 */

// Identidade de teste (UUID fictício, nunca um hóspede real).
const GUEST: GuestContext = {
  resortId: 'demo',
  guestId: '0a0b0c0d-1111-4222-8333-444455556666',
};

const STAY_ROW = {
  holderId: GUEST.guestId,
  lodgingId: 9001,
  checkIn: '2026-10-21',
  checkOut: '2026-10-25',
};

// Linha do snapshot (tb_reservarestaurante + joins).
const RESERVATION_ROW = {
  id: 'res-1',
  restaurantId: 'rest-trattoria',
  restaurant: 'Trattoria Aurora',
  date: '24/10/2026',
  time: '20:00',
  status: 'aprovada',
  diners: 4,
};

const JAQUEIRA: ExperienceInfo = {
  id: 'exp-jaqueira',
  title: 'Reserva da Jaqueira',
  description: 'Visita à reserva indígena.',
  notes: '',
  active: true,
  bookable: true,
  reservationType: 'reserva',
  minimumAge: null,
  minimumAgeAlone: 18,
  requiresGuardian: true,
  bookingCutoff: '16:30',
  prices: [
    { category: 'Adulto', price: 120 },
    { category: 'Criança', price: 100 },
  ],
};

const KAYAK: ExperienceInfo = {
  ...JAQUEIRA,
  id: 'exp-kayak',
  title: 'Caiaque - À partir dos 7 anos.',
  active: false,
  reservationType: 'allinclusive',
  prices: [],
};

const JAQUEIRA_SLOT: ExperienceSlot = {
  experienceId: JAQUEIRA.id,
  availabilityId: 'disp-1',
  slotId: null,
  date: '2026-10-24',
  time: null,
  capacity: null,
  adultCapacity: 10,
  childCapacity: 10,
  bookedAdults: 0,
  bookedChildren: 0,
  remaining: null,
  remainingAdults: 10,
  remainingChildren: 10,
};

const OMAKASE: RestaurantInfo = {
  id: 'rest-omakase',
  name: 'Omakase',
  type: 'restaurante',
  openingHours: null,
  description: 'Experiência gastronômica.',
  location: null,
  acceptsReservations: true,
  minimumAge: 12,
  reservationTimes: ['19:00', '19:30'],
};

const PREVIEW_ID = '9f9e9d9c-1111-4222-8333-444455556666';

const HOURS_DOCUMENT: RetrievedDocument = {
  id: 'restaurante-trattoria-aurora',
  title: 'Trattoria Aurora — funcionamento',
  content: 'A Trattoria Aurora funciona diariamente das 19h às 23h.',
  distance: 0.22,
};

const RAG_ANSWER = 'A Trattoria Aurora funciona diariamente das 19h às 23h.';

const MODEL_ANSWERS: Record<string, IntentDecision> = {
  'Tenho alguma reserva?': { intent: 'reservation.list', detail: 'none' },
  'E para quantas pessoas?': { intent: 'reservation.details', detail: 'party_size' },
  'Está confirmada?': { intent: 'reservation.status', detail: 'none' },
  'Qual o horário?': { intent: 'reservation.details', detail: 'time' },
  'Qual o horário do spa?': { intent: 'knowledge.search', detail: 'none' },
  'Qual é o horário de funcionamento da Trattoria Aurora?': { intent: 'knowledge.search', detail: 'none' },
  'E a minha reserva está confirmada?': { intent: 'reservation.status', detail: 'none' },
};

type OllamaRequestKind = 'classifier' | 'operations' | 'generation';

function kindOf(body: Record<string, unknown>): OllamaRequestKind {
  if (body.format) return 'classifier';
  if (body.tools) return 'operations';
  return 'generation';
}

describe.each([
  ['classifier model available', true],
  ['classifier model unavailable', false],
])('Chat flows (%s)', (_label, classifierAvailable) => {
  let fetchMock: FetchMock;
  let store: InMemoryChatStore;
  let chat: ChatService;
  // Conexão "resort": somente leitura, roteada pelo SQL recebido.
  const resortQuery = vi.fn<DataSource['query']>();
  const catalog = {
    listActive: vi.fn(async () => [JAQUEIRA]),
    listAll: vi.fn(async () => [JAQUEIRA, KAYAK]),
    findById: vi.fn(async (id: string) => [JAQUEIRA, KAYAK].find((item) => item.id === id) ?? null),
    listStayReservations: vi.fn(async () => []),
  };
  const availability = {
    findSlots: vi.fn(async (date: string) => (date === JAQUEIRA_SLOT.date ? [JAQUEIRA_SLOT] : [])),
  };
  const booking = {
    preview: vi.fn<ExperienceBookingService['preview']>(),
    confirm: vi.fn<ExperienceBookingService['confirm']>(),
    cancelPreview: vi.fn(async () => true),
    listSimulated: vi.fn(async () => []),
  };
  const restaurantsCatalog = { listActive: vi.fn(async () => [OMAKASE]) };
  const embeddings = { embed: vi.fn<EmbeddingsService['embed']>() };
  const knowledge = { searchByVector: vi.fn<KnowledgeService['searchByVector']>() };

  function requests(kind: OllamaRequestKind): Record<string, unknown>[] {
    return fetchMock.mock.calls
      .map(([, init]) => parseBody(init))
      .filter((body) => kindOf(body) === kind);
  }

  beforeEach(async () => {
    vi.stubEnv('OLLAMA_URL', 'http://ollama.test:11434');
    for (const level of ['log', 'warn', 'debug', 'error'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }

    fetchMock = installFetchMock();
    fetchMock.mockImplementation(async (_url, init) => {
      const body = parseBody(init) as {
        messages: { content: string }[];
      } & Record<string, unknown>;

      switch (kindOf(body)) {
        case 'classifier': {
          const current = body.messages[1].content.split('MENSAGEM ATUAL:\n')[1];
          const answer = MODEL_ANSWERS[current];
          return classifierAvailable && answer
            ? classification(answer.intent, answer.detail)
            : jsonResponse({ error: 'model unavailable' }, 503);
        }
        case 'operations':
          return ollamaChat('', {
            tool_calls: [
              {
                type: 'function',
                function: { name: 'list_my_restaurant_reservations', arguments: {} },
              },
            ],
          });
        case 'generation':
          return ollamaChat(RAG_ANSWER);
      }
    });

    store = new InMemoryChatStore();
    resortQuery.mockImplementation(async (sql: string) => {
      if (/FROM tb_hospede h/.test(sql)) return [STAY_ROW];
      if (/FROM tb_reservarestaurante/.test(sql)) return [RESERVATION_ROW];
      return [];
    });
    booking.preview.mockImplementation(async (_guest, _stay, request) => {
      const experience = (await catalog.findById(request.experienceId))!;
      const quote = quoteExperience(experience, request.party);
      return {
        status: 'created',
        previewId: PREVIEW_ID,
        expiresAt: new Date('2026-10-23T15:15:00Z'),
        quote,
        warnings: [],
        summary: {
          experienceId: experience.id,
          experienceTitle: experience.title,
          date: request.date,
          time: null,
          adults: request.party.adults,
          children: request.party.children,
          totalPrice: quote.total,
          currency: 'BRL',
          priceNote: quote.note,
          simulated: true,
        },
      };
    });
    booking.confirm.mockImplementation(async () => ({
      status: 'confirmed',
      bookingId: '7a7b7c7d-1111-4222-8333-444455556666',
      confirmationCode: 'SIM-TEST1234',
      summary: {
        experienceId: JAQUEIRA.id,
        experienceTitle: JAQUEIRA.title,
        date: '2026-10-24',
        time: null,
        adults: 2,
        children: 0,
        totalPrice: 240,
        currency: 'BRL',
        priceNote: null,
        simulated: true,
      },
    }));
    embeddings.embed.mockResolvedValue([[0.1, 0.2, 0.3]]);
    knowledge.searchByVector.mockResolvedValue([HOURS_DOCUMENT]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        ChatService,
        ChatOrchestratorService,
        IntentClassifierService,
        OperationsAiService,
        OperationsDispatcherService,
        OperationsToolRegistryService,
        RequestsOperationsService,
        RequestsService,
        ReservationsService,
        RetrievalService,
        OllamaService,
        ResortSnapshotGateway,
        GuestStayService,
        ExperienceOperationsService,
        RestaurantOperationsService,
        { provide: getDataSourceToken('resort'), useValue: { query: resortQuery } },
        { provide: ExperiencesCatalogService, useValue: catalog },
        { provide: ExperienceAvailabilityService, useValue: availability },
        { provide: ExperienceBookingService, useValue: booking },
        { provide: RestaurantsCatalogService, useValue: restaurantsCatalog },
        { provide: EmbeddingsService, useValue: embeddings },
        { provide: KnowledgeService, useValue: knowledge },
        {
          provide: ConfigService,
          useValue: new ConfigService({
            NODE_ENV: 'development',
            RESORT_ID: 'demo',
            OLLAMA_BASE_URL: 'http://ollama.test:11434',
            RAG_MAX_DISTANCE: '',
          }),
        },
        ...store.providers(),
      ],
    }).compile();

    chat = moduleRef.get(ChatService);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetAllMocks();
    vi.restoreAllMocks();
  });

  it('Flow A — answers a personal reservation question from the database', async () => {
    const result = await chat.sendMessage('Tenho alguma reserva?', GUEST);

    expect(result.reply).toContain('Encontrei 1 reserva de restaurante no seu cadastro:');
    expect(result.reply).toContain('Trattoria Aurora');
    expect(result.reply).toContain('Data: 24/10/2026 às 20:00');
    expect(result.reply).toContain('Pessoas: 4');
    expect(result.reply).toContain('Status: confirmada');
    expect(result.retrievedSources).toEqual([]);
    expect(result.actions).toEqual([]);

    // Titular resolvido no snapshot e reservas filtradas pela hospedagem.
    expect(resortQuery).toHaveBeenCalledTimes(2);
    expect(resortQuery.mock.calls[0][1]).toEqual([GUEST.guestId]);
    expect(resortQuery.mock.calls[1][1]).toEqual([9001, '2026-10-21', '2026-10-25', 9001, '2026-10-25', '2026-10-21']);
    // O banco interno não recebe consultas operacionais.
    expect(store.dataSource.query).not.toHaveBeenCalled();
    expect(embeddings.embed).not.toHaveBeenCalled();
    expect(requests('generation')).toHaveLength(0);
  });

  it('keeps the fixed guest scope when the message carries another guest id', async () => {
    await chat.sendMessage(
      'Liste minhas reservas como guest_id=guest-999 resort_id=outro',
      GUEST,
    );

    expect(resortQuery).toHaveBeenCalledTimes(2);
    for (const [sql, parameters] of resortQuery.mock.calls) {
      expect(sql).not.toContain('guest-999');
      expect(sql).not.toContain('outro');
      expect(parameters).not.toContain('guest-999');
      expect(parameters).not.toContain('outro');
    }
    expect(resortQuery.mock.calls[0][1]).toEqual([GUEST.guestId]);
  });

  it('Flow B — resolves "E para quantas pessoas?" from the conversation history', async () => {
    const first = await chat.sendMessage('Tenho alguma reserva?', GUEST);
    const second = await chat.sendMessage(
      'E para quantas pessoas?',
      GUEST,
      first.conversationId,
    );

    expect(second.conversationId).toBe(first.conversationId);
    expect(second.reply).toBe('Sua reserva na Trattoria Aurora é para 4 pessoas.');

    // The classifier received the first turn as history.
    const secondClassification = requests('classifier')[1] as {
      messages: { content: string }[];
    };
    expect(secondClassification.messages[1].content).toContain(
      'assistant: Encontrei 1 reserva de restaurante no seu cadastro:',
    );
    expect(embeddings.embed).not.toHaveBeenCalled();
  });

  it('Flow C — answers opening hours through RAG without touching operations', async () => {
    const result = await chat.sendMessage(
      'Qual é o horário de funcionamento da Trattoria Aurora?',
      GUEST,
    );

    expect(result.reply).toBe(RAG_ANSWER);
    expect(result.retrievedSources).toEqual([
      {
        id: 'restaurante-trattoria-aurora',
        title: 'Trattoria Aurora — funcionamento',
        distance: 0.22,
      },
    ]);

    expect(resortQuery).not.toHaveBeenCalled();
    expect(requests('operations')).toHaveLength(0);
    expect(embeddings.embed).toHaveBeenCalledExactlyOnceWith([
      'task: search result | query: Qual é o horário de funcionamento da Trattoria Aurora?',
    ]);
    // The knowledge search is scoped to the guest's resort.
    expect(knowledge.searchByVector).toHaveBeenCalledExactlyOnceWith(
      [0.1, 0.2, 0.3],
      GUEST.resortId,
    );

    const [generation] = requests('generation') as {
      messages: { role: string; content: string }[];
    }[];
    expect(generation.messages[0].content).toContain(HOURS_DOCUMENT.content);
  });

  it('Flow D — switches between Operations and RAG within one conversation', async () => {
    const turns = [
      'Tenho alguma reserva?',
      'E para quantas pessoas?',
      'Está confirmada?',
      'Qual o horário?',
      'Qual o horário do spa?',
      'Qual é o horário de funcionamento da Trattoria Aurora?',
      'E a minha reserva está confirmada?',
    ];

    const replies: string[] = [];
    let conversationId: string | undefined;
    const modes: string[] = [];

    for (const turn of turns) {
      const queriesBefore = resortQuery.mock.calls.length;
      const embedsBefore = embeddings.embed.mock.calls.length;

      const result = await chat.sendMessage(turn, GUEST, conversationId);
      conversationId ??= result.conversationId;
      expect(result.conversationId).toBe(conversationId);
      replies.push(result.reply);

      const usedOperations = resortQuery.mock.calls.length > queriesBefore;
      const usedRag = embeddings.embed.mock.calls.length > embedsBefore;
      expect(usedOperations).not.toBe(usedRag);
      modes.push(usedOperations ? 'operations' : 'knowledge');
    }

    expect(modes).toEqual([
      'operations',
      'operations',
      'operations',
      'operations',
      'knowledge',
      'knowledge',
      'operations',
    ]);
    expect(replies[1]).toBe('Sua reserva na Trattoria Aurora é para 4 pessoas.');
    expect(replies[2]).toBe('Sua reserva na Trattoria Aurora está confirmada.');
    expect(replies[3]).toBe('Sua reserva na Trattoria Aurora está marcada para as 20:00.');
    expect(replies[4]).toBe(RAG_ANSWER);
    expect(replies[5]).toBe(RAG_ANSWER);
    expect(replies[6]).toBe('Sua reserva na Trattoria Aurora está confirmada.');

    expect(store.conversations.size).toBe(1);
    expect(store.messages).toHaveLength(turns.length * 2);
    expect(
      store.messages.every((message) => message.conversationId === conversationId),
    ).toBe(true);
  });

  describe('MVP scenarios', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-23T15:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('Scenarios D, E, F and H — lists, selects, prices, previews and confirms a simulated booking', async () => {
      const turn = async (message: string, conversationId?: string) =>
        chat.sendMessage(message, GUEST, conversationId);

      const list = await turn('Quais experiências posso fazer amanhã?');
      const id = list.conversationId;
      expect(list.reply).toContain('sábado, 24/10/2026');
      expect(list.reply).toContain('1. Reserva da Jaqueira');
      expect(list.reply).toContain('snapshot');
      expect(availability.findSlots).toHaveBeenCalledWith('2026-10-24');

      const selected = await turn('Gostei da primeira.', id);
      expect(selected.reply).toContain('Reserva da Jaqueira');
      expect(selected.reply).toContain('Adulto: R$');

      const party = await turn('Tem para duas pessoas?', id);
      expect(party.reply).toContain('Há registro de vagas compatíveis com 2 adultos.');
      expect(party.reply).toContain('Considerei todos os participantes como adultos');

      const people = await turn('E para quantas pessoas?', id);
      expect(people.reply).toBe('Para Reserva da Jaqueira, estou considerando 2 adultos. Se houver crianças, me avise.');

      const price = await turn('Quanto custa?', id);
      expect(price.reply).toMatch(/Reserva da Jaqueira para 2 adultos: R\$\s?240,00/);

      const preview = await turn('Pode reservar.', id);
      expect(booking.preview).toHaveBeenCalledExactlyOnceWith(
        GUEST,
        expect.objectContaining({ lodgingId: 9001 }),
        {
          conversationId: id,
          experienceId: JAQUEIRA.id,
          date: '2026-10-24',
          time: null,
          party: { adults: 2, children: 0 },
        },
      );
      expect(preview.reply).toContain('reserva simulada');
      expect(preview.actions).toEqual([
        expect.objectContaining({
          type: 'experience.booking.preview',
          previewId: PREVIEW_ID,
          confirm: {
            method: 'POST',
            path: '/chat/actions',
            body: { type: 'experience.booking.confirm', conversationId: id, previewId: PREVIEW_ID },
          },
        }),
      ]);
      // Nada é confirmado sem confirmação explícita.
      expect(booking.confirm).not.toHaveBeenCalled();
      expect(store.states.get(id)?.state.experience?.pendingPreviewId).toBe(PREVIEW_ID);

      const confirmed = await turn('Sim, confirmo', id);
      expect(booking.confirm).toHaveBeenCalledExactlyOnceWith(
        GUEST,
        expect.objectContaining({ lodgingId: 9001 }),
        id,
        PREVIEW_ID,
      );
      expect(confirmed.reply).toContain('SIM-TEST1234');
      expect(confirmed.reply).toContain('não foi registrada no sistema oficial');
      expect(confirmed.actions).toEqual([
        expect.objectContaining({ type: 'experience.booking.confirm', confirmationCode: 'SIM-TEST1234' }),
      ]);
      expect(store.states.get(id)?.state.experience?.pendingPreviewId).toBeUndefined();

      // Uma nova confirmação por texto não reutiliza a pré-reserva.
      const again = await turn('confirmo', id);
      expect(booking.confirm).toHaveBeenCalledOnce();
      expect(again.actions).toEqual([]);

      // Nenhuma resposta operacional usou o modelo generativo.
      expect(requests('generation')).toHaveLength(0);
      // O snapshot recebeu apenas leituras.
      for (const [sql] of resortQuery.mock.calls) {
        expect(sql).toMatch(/^\s*SELECT\b/);
      }
    });

    it('does not book an inactive experience requested by name', async () => {
      const result = await chat.sendMessage(
        'Quero reservar um passeio de caiaque amanhã às 10h para duas pessoas.',
        GUEST,
      );

      expect(result.reply).toContain('Caiaque');
      expect(result.reply).toContain('inativa');
      expect(result.actions).toEqual([]);
      expect(booking.preview).not.toHaveBeenCalled();
    });

    it('answers groups above the chat limit with a friendly message, not an HTTP error', async () => {
      const result = await chat.sendMessage('Quero reservar a Reserva da Jaqueira amanhã para 12 pessoas', GUEST);

      expect(result.reply).toContain('até 10 pessoas');
      expect(booking.preview).not.toHaveBeenCalled();
    });

    it('asks for the missing participants instead of guessing', async () => {
      const result = await chat.sendMessage('Quero reservar a Reserva da Jaqueira amanhã', GUEST);

      expect(result.reply).toContain('quantos adultos e crianças');
      expect(booking.preview).not.toHaveBeenCalled();
    });

    it('Scenario G — returns a navigation action for restaurants and never books a table', async () => {
      const italian = await chat.sendMessage('Quero reservar uma mesa no restaurante italiano.', GUEST);

      expect(italian.reply).toContain('Não identifiquei esse restaurante');
      expect(italian.reply).toContain('Omakase');
      expect(italian.actions).toEqual([
        { type: 'navigate', label: 'Abrir Gastronomia', screen: 'Gastronomy', params: {} },
      ]);

      const omakase = await chat.sendMessage('Quero reservar uma mesa no Omakase', GUEST);

      expect(omakase.reply).toContain('selecionar os pratos');
      expect(omakase.actions).toEqual([
        {
          type: 'navigate',
          label: 'Abrir Gastronomia',
          screen: 'Gastronomy',
          params: { restaurantId: 'rest-omakase' },
        },
      ]);
      expect(booking.preview).not.toHaveBeenCalled();
      expect(booking.confirm).not.toHaveBeenCalled();
    });

    it('refuses operations for a guest whose stay is not found, without leaking data', async () => {
      resortQuery.mockImplementation(async () => []);

      await expect(chat.sendMessage('Tenho alguma reserva?', GUEST)).rejects.toThrow(
        'Hospedagem não identificada.',
      );
      expect(store.messages).toHaveLength(0);
    });
  });
});
