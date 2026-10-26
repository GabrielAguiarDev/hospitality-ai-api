import { Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';

import { InMemoryChatStore } from '../../test/support/in-memory-chat-store.js';
import { installFetchMock, jsonResponse, ollamaChat, parseBody } from '../../test/support/ollama-fakes.js';
import type { FetchMock } from '../../test/support/ollama-fakes.js';
import type { ChatResponse } from '../contracts/chat-actions.js';
import { ExperienceAvailabilityService } from '../experiences/experience-availability.service.js';
import { ExperienceBookingService } from '../experiences/experience-booking.service.js';
import { quoteExperience } from '../experiences/experience-pricing.js';
import { ExperiencesCatalogService } from '../experiences/experiences-catalog.service.js';
import type { ExperienceInfo, ExperienceSlot } from '../experiences/experience.types.js';
import type { GuestContext } from '../guest/guest-context.js';
import { OllamaService } from '../llm/ollama.service.js';
import { ExperienceOperationsService } from '../operations/experience-operations.service.js';
import { OperationsAiService } from '../operations/operations-ai.service.js';
import { OperationsDispatcherService } from '../operations/operations-dispatcher.service.js';
import { OperationsToolRegistryService } from '../operations/operations-tool-registry.service.js';
import { RequestsOperationsService } from '../operations/requests-operations.service.js';
import { RequestsService } from '../operations/requests.service.js';
import { ReservationsService } from '../operations/reservations.service.js';
import { RestaurantOperationsService } from '../operations/restaurant-operations.service.js';
import { EmbeddingsService } from '../rag/embeddings.service.js';
import { KnowledgeService } from '../rag/knowledge.service.js';
import { RetrievalService } from '../rag/retrieval.service.js';
import { GuestStayService } from '../resort/guest-stay.service.js';
import { ResortSnapshotGateway } from '../resort/resort-snapshot.gateway.js';
import { RestaurantsCatalogService } from '../resort/restaurants-catalog.service.js';

import { ChatOrchestratorService } from './chat-orchestrator.service.js';
import { ConversationContextService } from './conversation-context.service.js';
import { ChatService } from './chat.service.js';
import { IntentClassifierService } from './intent-classifier.service.js';

/**
 * Conversas completas (3 a 6 mensagens na mesma conversa) sobre
 * experiências. O pipeline é real; somente as bordas são simuladas:
 * Ollama, snapshot, banco interno, ChromaDB e persistência das reservas.
 * O OperationsToolRegistryService é real, então os filtros da busca
 * são aplicados de fato sobre as vagas abaixo.
 */

// Identidades de teste (UUIDs fictícios, nunca hóspedes reais).
const GUEST: GuestContext = { resortId: 'demo', guestId: '0a0b0c0d-1111-4222-8333-444455556666' };
const OTHER_GUEST: GuestContext = { resortId: 'demo', guestId: '0f0e0d0c-9999-4888-8777-666655554444' };

// Sexta-feira, 23/10/2026: "amanhã" é sábado, 24/10/2026.
const TOMORROW = '2026-10-24';

const STAY_ROW = { holderId: GUEST.guestId, lodgingId: 9001, checkIn: '2026-10-21', checkOut: '2026-10-27' };
const PREVIEW_ID = '9f9e9d9c-1111-4222-8333-444455556666';

const base: Omit<ExperienceInfo, 'id' | 'title'> = {
  description: '',
  notes: '',
  active: true,
  bookable: true,
  reservationType: 'reserva',
  minimumAge: null,
  minimumAgeAlone: null,
  requiresGuardian: false,
  bookingCutoff: null,
  prices: [],
};

// Valores e regras iguais aos do snapshot de demonstração.
const CITY_TOUR: ExperienceInfo = {
  ...base,
  id: 'exp-city',
  title: 'Cidade Histórica / City Tour',
  // Texto no formato do cadastro real: longo, com emoji e preços em lista.
  description:
    'O Resort organiza passeios ao Centro Histórico de Porto Seguro, um verdadeiro museu a céu aberto. ' +
    'O Centro Histórico está localizado na parte alta da cidade e oferece uma vista espetacular. ' +
    'Saímos às 9h da manhã e retornamos ao resort ao meio-dia. Nossa guia fala espanhol. ' +
    '💰 Valores: • Crianças de 5 a 10 anos: R$ 80 • Adultos: R$ 100.',
  prices: [{ category: 'Adulto', price: 100 }, { category: 'Criança', price: 80 }],
};
const JAQUEIRA: ExperienceInfo = {
  ...base,
  id: 'exp-jaqueira',
  title: 'Reserva da Jaqueira',
  minimumAgeAlone: 18,
  prices: [{ category: 'Adulto', price: 120 }, { category: 'Criança', price: 100 }],
};
const TRAPEZIO: ExperienceInfo = {
  ...base,
  id: 'exp-trapezio',
  title: 'Trapézio Voador 4+Anos',
  reservationType: 'allinclusive',
  minimumAge: 4,
};
const MAGICA: ExperienceInfo = {
  ...base,
  id: 'exp-magica',
  title: 'Mágica da Mente',
  bookable: false,
  reservationType: 'allinclusive',
};
const CATALOG = [CITY_TOUR, JAQUEIRA, TRAPEZIO, MAGICA];

const slot = (experienceId: string, time: string | null, over: Partial<ExperienceSlot> = {}): ExperienceSlot => ({
  experienceId,
  availabilityId: `disp-${experienceId}`,
  slotId: time ? `hora-${experienceId}-${time}` : null,
  date: TOMORROW,
  time,
  capacity: 10,
  adultCapacity: null,
  childCapacity: null,
  bookedAdults: 0,
  bookedChildren: 0,
  remaining: 10,
  remainingAdults: null,
  remainingChildren: null,
  ...over,
});

// Quarta-feira, 28/10/2026: só o City Tour tem vaga (como no snapshot real).
const ONLY_CITY_DATE = '2026-10-28';

const RESTAURANT_BASE = { description: '', location: null, minimumAge: null, reservationTimes: [] };
const RESTAURANTS = [
  { ...RESTAURANT_BASE, id: 'rest-gino', name: 'Gino Praia Gastronomia', type: 'restaurante', openingHours: null, acceptsReservations: true,
    description: 'Cozinha italiana à beira-mar. Reservas com seleção de pratos pelo aplicativo.' },
  { ...RESTAURANT_BASE, id: 'rest-central', name: 'Restaurante Central', type: 'restaurante', openingHours: 'Almoço: 12h às 15h. Jantar: 19h às 22h', acceptsReservations: false },
  { ...RESTAURANT_BASE, id: 'rest-omakase', name: 'Omakase', type: 'restaurante', openingHours: null, acceptsReservations: true, minimumAge: 12 },
  { ...RESTAURANT_BASE, id: 'bar-mirante', name: 'Bar Mirante', type: 'bar', openingHours: '09h às 21h', acceptsReservations: false },
  { ...RESTAURANT_BASE, id: 'food-cha', name: 'Chá da Tarde', type: 'alimentacao', openingHours: '17h às 18h30', acceptsReservations: false },
];

const TOMORROW_SLOTS = [
  slot(CITY_TOUR.id, '08:00'),
  slot(CITY_TOUR.id, '14:00', { remaining: 0 }), // esgotado
  slot(JAQUEIRA.id, '09:00'),
  slot(TRAPEZIO.id, '16:00'),
];

describe('Experience conversations (multi-turn)', () => {
  let fetchMock: FetchMock;
  let store: InMemoryChatStore;
  let chat: ChatService;
  const resortQuery = vi.fn<DataSource['query']>();
  const catalog = {
    listActive: vi.fn(async () => CATALOG),
    listAll: vi.fn(async () => CATALOG),
    findById: vi.fn(async (id: string) => CATALOG.find((item) => item.id === id) ?? null),
    listStayReservations: vi.fn(async () => []),
  };
  const availability = {
    findSlots: vi.fn(async (date: string, experienceId?: string) =>
      (date === TOMORROW
        ? TOMORROW_SLOTS
        : date === ONLY_CITY_DATE
          ? [slot(CITY_TOUR.id, '08:00', { date: ONLY_CITY_DATE })]
          : []
      ).filter((item) => !experienceId || item.experienceId === experienceId),
    ),
  };
  const booking = {
    preview: vi.fn<ExperienceBookingService['preview']>(),
    confirm: vi.fn<ExperienceBookingService['confirm']>(),
    cancelPreview: vi.fn(async () => true),
    listSimulated: vi.fn(async () => []),
  };
  const embeddings = { embed: vi.fn<EmbeddingsService['embed']>() };
  const knowledge = { searchByVector: vi.fn<KnowledgeService['searchByVector']>() };

  const modelCalls = (kind: 'classifier' | 'generation') =>
    fetchMock.mock.calls
      .map(([, init]) => parseBody(init))
      .filter((body) => (kind === 'classifier' ? Boolean(body.format) : !body.format && !body.tools));

  // Ferramentas executadas pelo Registry real, com os argumentos recebidos.
  let registryCalls: { name: string; input: unknown }[];

  async function converse(
    messages: string[],
    guest: GuestContext = GUEST,
  ): Promise<{ id: string; replies: ChatResponse[] }> {
    const replies: ChatResponse[] = [];
    let id: string | undefined;

    for (const message of messages) {
      const response = await chat.sendMessage(message, guest, id);
      id ??= response.conversationId;
      expect(response.conversationId).toBe(id);
      replies.push(response);
    }

    return { id: id!, replies };
  }

  const stateOf = (id: string) => store.states.get(id)?.state;
  const listCalls = () => registryCalls.filter(({ name }) => name === 'experiences.list').map(({ input }) => input);

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-23T15:00:00Z'));
    for (const level of ['log', 'warn', 'debug', 'error'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }

    fetchMock = installFetchMock();
    // O modelo de classificação está indisponível: os fluxos abaixo
    // precisam ser resolvidos pelas regras determinísticas.
    fetchMock.mockImplementation(async (_url, init) =>
      parseBody(init).format ? jsonResponse({ error: 'model unavailable' }, 503) : ollamaChat('resposta livre'),
    );

    store = new InMemoryChatStore();
    resortQuery.mockImplementation(async (sql: string) => (/FROM tb_hospede h/.test(sql) ? [STAY_ROW] : []));
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
          time: request.time,
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
        date: TOMORROW,
        time: '09:00',
        adults: 2,
        children: 0,
        totalPrice: 240,
        currency: 'BRL',
        priceNote: null,
        simulated: true,
      },
    }));

    const moduleRef = await Test.createTestingModule({
      providers: [
        ChatService,
        ChatOrchestratorService,
        ConversationContextService,
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
        { provide: RestaurantsCatalogService, useValue: { listActive: vi.fn(async () => RESTAURANTS) } },
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

    const registry = moduleRef.get(OperationsToolRegistryService);
    const execute = registry.execute.bind(registry);
    registryCalls = [];
    vi.spyOn(registry, 'execute').mockImplementation(async (name, guest, input) => {
      registryCalls.push({ name, input });
      return execute(name, guest, input);
    });

    chat = moduleRef.get(ChatService);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetAllMocks();
    vi.restoreAllMocks();
  });

  it('reproduces the reported bug: "Qual tem reserva pra amanhã?" searches instead of asking for an experience', async () => {
    const { id, replies } = await converse([
      'Quais experiências posso fazer?',
      'Qual tem reserva pra amanhã?',
      'Qual experiência tem reserva para amanhã de manhã?',
    ]);

    // 1. Catálogo sem data, pedindo a data.
    expect(replies[0].reply).toContain('1. Cidade Histórica / City Tour — com reserva');
    expect(replies[0].reply).toContain('Para qual data?');

    // 2. Busca de vagas em várias experiências, só as que aceitam reserva.
    expect(replies[1].reply).not.toContain('Não identifiquei');
    expect(replies[1].reply).toContain('sábado, 24/10/2026');
    expect(replies[1].reply).toContain('1. Cidade Histórica / City Tour — às 08:00: 10 vaga(s)');
    expect(replies[1].reply).toContain('2. Reserva da Jaqueira — às 09:00');
    expect(replies[1].reply).toContain('3. Trapézio Voador 4+Anos — às 16:00');
    // Horário esgotado não é oferecido; experiência sem reserva não entra.
    expect(replies[1].reply).not.toContain('14:00');
    expect(replies[1].reply).not.toContain('Mágica da Mente');
    expect(replies[1].reply).toContain('snapshot');

    // 3. Mesma busca, restrita à manhã.
    expect(replies[2].reply).not.toContain('Não identifiquei');
    expect(replies[2].reply).toContain('sábado, 24/10/2026, de manhã');
    expect(replies[2].reply).toContain('1. Cidade Histórica / City Tour — às 08:00');
    expect(replies[2].reply).toContain('2. Reserva da Jaqueira — às 09:00');
    expect(replies[2].reply).not.toContain('Trapézio');

    expect(listCalls()).toEqual([
      { date: null },
      { date: TOMORROW, bookable: true },
      { date: TOMORROW, period: 'morning', bookable: true },
    ]);
    expect(stateOf(id)).toMatchObject({
      topic: 'experience',
      lastIntent: 'experience.search',
      experience: {
        date: TOMORROW,
        filters: { period: 'morning', bookable: true },
        listed: [
          { id: CITY_TOUR.id, title: CITY_TOUR.title },
          { id: JAQUEIRA.id, title: JAQUEIRA.title },
        ],
      },
    });
    expect(modelCalls('classifier')).toHaveLength(0);
    expect(embeddings.embed).not.toHaveBeenCalled();
  });

  it('refines, selects, prices and previews without repeating information — and never books without confirmation', async () => {
    const { id, replies } = await converse([
      'Quais experiências têm amanhã?',
      'E de manhã?',
      'Gostei da segunda.',
      'Quanto custa para dois adultos?',
      'Pode reservar.',
    ]);

    expect(replies[0].reply).toContain('3. Trapézio Voador 4+Anos — às 16:00');
    expect(replies[0].reply).toContain('Sem necessidade de reserva: Mágica da Mente.');

    // "E de manhã?" mantém a data e acrescenta o período.
    expect(replies[1].reply).toContain('sábado, 24/10/2026, de manhã');
    expect(replies[1].reply).not.toContain('Trapézio');
    expect(listCalls()[1]).toEqual({ date: TOMORROW, period: 'morning' });

    // "a segunda" é a segunda opção da lista refinada, não segunda-feira.
    expect(replies[2].reply).toContain('Reserva da Jaqueira');
    expect(replies[2].reply).toContain('Adulto: R$');

    expect(replies[3].reply).toMatch(/Reserva da Jaqueira para 2 adultos: R\$\s?240,00/);

    // A pré-reserva usa a data e o único horário da manhã, ambos já informados.
    expect(booking.preview).toHaveBeenCalledExactlyOnceWith(GUEST, expect.objectContaining({ lodgingId: 9001 }), {
      conversationId: id,
      experienceId: JAQUEIRA.id,
      date: TOMORROW,
      time: '09:00',
      party: { adults: 2, children: 0 },
    });
    expect(replies[4].reply).toContain('Horário: 09:00');
    expect(replies[4].reply).toContain('Deseja confirmar?');
    expect(replies[4].actions).toEqual([
      expect.objectContaining({ type: 'experience.booking.preview', previewId: PREVIEW_ID }),
    ]);
    expect(booking.confirm).not.toHaveBeenCalled();
    expect(stateOf(id)?.experience?.pendingPreviewId).toBe(PREVIEW_ID);

    // Só a confirmação explícita registra a reserva simulada.
    const confirmed = await chat.sendMessage('confirmo', GUEST, id);
    expect(booking.confirm).toHaveBeenCalledOnce();
    expect(confirmed.reply).toContain('SIM-TEST1234');
    expect(modelCalls('generation')).toHaveLength(0);
  });

  it('returns selectable options built only from snapshot identifiers', async () => {
    const { replies } = await converse(['Quais experiências têm vagas amanhã?', 'E de manhã?', 'Opção 2']);

    expect(replies[1].actions).toEqual([
      {
        type: 'experience.options',
        label: 'Escolher experiência',
        date: TOMORROW,
        options: [
          { position: 1, experienceId: CITY_TOUR.id, title: CITY_TOUR.title, times: ['08:00'], message: 'Opção 1' },
          { position: 2, experienceId: JAQUEIRA.id, title: JAQUEIRA.title, times: ['09:00'], message: 'Opção 2' },
        ],
      },
    ]);
    // A mensagem do botão seleciona a mesma opção.
    expect(replies[2].reply).toContain('Reserva da Jaqueira');
    expect(replies[2].reply).toContain('Reserva: necessária.');
  });

  it('applies catalog filters across follow-ups: afternoon, free and children', async () => {
    const { id, replies } = await converse([
      'Quais experiências têm vagas amanhã?',
      'E à tarde?',
      'Quais são gratuitas?',
      'Tem alguma para crianças?',
    ]);

    // À tarde: o City Tour das 14h está esgotado; só o Trapézio tem vaga.
    expect(replies[1].reply).toContain('sábado, 24/10/2026, à tarde');
    expect(replies[1].reply).toContain('1. Trapézio Voador 4+Anos — às 16:00');
    expect(replies[1].reply).not.toContain('City Tour');

    // Gratuitas: mantém data e período.
    expect(replies[2].reply).toContain('sem cobrança cadastrada (all inclusive)');
    expect(replies[2].reply).toContain('Trapézio Voador 4+Anos');

    // Para crianças: idade mínima informada a partir do cadastro.
    expect(replies[3].reply).toContain('Trapézio Voador 4+Anos (a partir de 4 anos) — às 16:00');

    expect(listCalls()).toEqual([
      { date: TOMORROW, bookable: true },
      { date: TOMORROW, period: 'afternoon', bookable: true },
      { date: TOMORROW, period: 'afternoon', bookable: true, free: true },
      { date: TOMORROW, period: 'afternoon', bookable: true, free: true, forChildren: true },
    ]);
    expect(stateOf(id)?.experience?.filters).toEqual({
      period: 'afternoon',
      bookable: true,
      free: true,
      forChildren: true,
    });
  });

  it('asks for the date when only a period is given, then completes the search', async () => {
    const { replies } = await converse([
      'Quais experiências posso fazer?',
      'Quais posso reservar de manhã?',
      'amanhã',
    ]);

    expect(replies[1].reply).toContain('Posso verificar os horários de manhã de alguma delas. Para qual data?');
    expect(replies[1].reply).not.toContain('Mágica da Mente');
    expect(booking.preview).not.toHaveBeenCalled();

    expect(replies[2].reply).toContain('sábado, 24/10/2026, de manhã');
    expect(listCalls()[2]).toEqual({ date: TOMORROW, period: 'morning', bookable: true });
  });

  it('handles a time range ("depois das 15h") as a filter, not as an exact time', async () => {
    const { replies } = await converse([
      'Quais experiências têm vagas amanhã depois das 15h?',
      'Gostei da primeira',
      'Pode reservar para 2 adultos',
    ]);

    expect(replies[0].reply).toContain('sábado, 24/10/2026, a partir das 15:00');
    expect(replies[0].reply).toContain('1. Trapézio Voador 4+Anos — às 16:00');
    expect(listCalls()[0]).toEqual({ date: TOMORROW, after: '15:00', bookable: true });
    expect(booking.preview).toHaveBeenCalledWith(
      GUEST,
      expect.anything(),
      expect.objectContaining({ experienceId: TRAPEZIO.id, time: '16:00' }),
    );
  });

  it('answers a search for a group above the chat limit with a message, not an HTTP error', async () => {
    const { replies } = await converse(['Quais experiências têm vagas amanhã para 12 pessoas?', 'E para 2 adultos e 1 criança?']);

    expect(replies[0].reply).toContain('até 10 pessoas');
    // O grupo acima do limite nunca chega à ferramenta.
    expect(listCalls().some((input) => (input as { adults?: number }).adults === 12)).toBe(false);
    expect(replies[1].reply).toContain('sábado, 24/10/2026');
  });

  it('keeps the group from the search for the booking and drops an old period for a new date', async () => {
    const { replies } = await converse([
      'Quais experiências têm vagas amanhã de manhã para 2 adultos?',
      'Gostei da segunda',
      'Pode reservar.',
    ]);

    // O grupo da busca não é perguntado de novo.
    expect(replies[0].reply).toContain('registra vagas para 2 adultos em:');
    expect(booking.preview).toHaveBeenCalledWith(
      GUEST,
      expect.anything(),
      expect.objectContaining({ experienceId: JAQUEIRA.id, time: '09:00', party: { adults: 2, children: 0 } }),
    );
    expect(replies[2].reply).toContain('Deseja confirmar?');

    // Uma nova data para a experiência escolhida não herda "de manhã".
    const sunday = await chat.sendMessage('Quero reservar a Reserva da Jaqueira no domingo para 2 adultos', GUEST, replies[0].conversationId);
    expect(sunday.reply).not.toContain('de manhã');
    expect(store.states.get(replies[0].conversationId)?.state.experience?.filters).toEqual({ bookable: true });
  });

  it('keeps refining after a search with no results', async () => {
    const { replies } = await converse(['Qual experiência tem vaga amanhã à noite?', 'E de manhã?', 'Gostei da segunda']);

    expect(replies[0].reply).toContain('Não encontrei vagas');
    expect(replies[0].reply).toContain('Posso consultar outro período ou outra data.');
    // A lista vazia não encerra o contexto: a busca continua refinável.
    expect(replies[1].reply).toContain('sábado, 24/10/2026, de manhã');
    expect(replies[1].reply).toContain('2. Reserva da Jaqueira — às 09:00');
    expect(replies[2].reply).toContain('Reserva da Jaqueira');
    expect(embeddings.embed).not.toHaveBeenCalled();
  });

  it('treats ambiguous references safely: out-of-range option and a period without registered times', async () => {
    const { id, replies } = await converse([
      'Quais experiências têm vagas amanhã de manhã?',
      'Gostei da quinta opção',
      'Gostei da primeira',
      'E à noite?',
      'Pode reservar para 2 adultos',
    ]);

    expect(replies[1].reply).toContain('Não identifiquei');
    expect(replies[2].reply).toContain('Cidade Histórica / City Tour');
    // Com uma experiência escolhida, o período refina os horários dela.
    expect(replies[3].reply).toContain('Não há horários registrados para Cidade Histórica / City Tour');
    expect(replies[3].reply).toContain('08:00');
    // Sem horário no período, nada é presumido nem pré-reservado.
    expect(replies[4].reply).toContain('Não há horários registrados para Cidade Histórica / City Tour à noite');
    expect(booking.preview).not.toHaveBeenCalled();
    expect(stateOf(id)?.experience?.pendingPreviewId).toBeUndefined();
  });

  it('keeps context isolated per guest and per conversation', async () => {
    const first = await chat.sendMessage('Quais experiências têm vagas amanhã de manhã?', GUEST);
    const other = await chat.sendMessage('Quais experiências posso fazer?', OTHER_GUEST);

    // Outro hóspede não acessa a conversa do primeiro.
    await expect(chat.sendMessage('Gostei da segunda.', OTHER_GUEST, first.conversationId)).rejects.toThrow(
      NotFoundException,
    );

    // Na própria conversa, "a segunda" refere-se à lista dele (catálogo sem data).
    const otherSelection = await chat.sendMessage('Gostei da segunda.', OTHER_GUEST, other.conversationId);
    expect(otherSelection.reply).toContain('Reserva da Jaqueira');

    const firstSelection = await chat.sendMessage('Gostei da primeira.', GUEST, first.conversationId);
    expect(firstSelection.reply).toContain('Cidade Histórica / City Tour');

    expect(store.states.get(first.conversationId)?.state.experience?.filters).toEqual({
      period: 'morning',
      bookable: true,
    });
    expect(store.states.get(other.conversationId)?.state.experience?.filters).toEqual({});
    expect(store.conversations.get(other.conversationId)?.guestId).toBe(OTHER_GUEST.guestId);
  });

  it('does not create a pre-booking from a question that merely mentions "reservar"', async () => {
    const { id, replies } = await converse([
      'Quais experiências posso fazer?',
      'Qual dá pra reservar amanhã?',
      'Quais posso reservar à tarde?',
    ]);

    expect(replies[1].reply).toContain('sábado, 24/10/2026');
    expect(replies[2].reply).toContain('sábado, 24/10/2026, à tarde');
    expect(booking.preview).not.toHaveBeenCalled();
    expect(booking.confirm).not.toHaveBeenCalled();
    expect(stateOf(id)?.experience?.pendingPreviewId).toBeUndefined();
  });

  describe('contextual references, pending questions and topic changes (reported scenarios)', () => {
    const toolCalls = (name: string) => registryCalls.filter((call) => call.name === name).map(({ input }) => input);

    it('Scenario 1 — "E como é essa experiência?" resolves the only listed experience', async () => {
      const { id, replies } = await converse(['Quais experiências têm vagas no dia 28?', 'E como é essa experiência?']);

      expect(replies[0].reply).toContain('1. Cidade Histórica / City Tour — às 08:00');
      expect(replies[1].reply).not.toContain('Não identifiquei');
      expect(replies[1].reply).toContain('Cidade Histórica / City Tour');
      expect(replies[1].reply).toContain('Centro Histórico de Porto Seguro');
      expect(toolCalls('experiences.details')).toEqual([{ experienceId: CITY_TOUR.id }]);
      expect(stateOf(id)?.experience).toMatchObject({ selectedId: CITY_TOUR.id, describedId: CITY_TOUR.id });
      expect(modelCalls('classifier')).toHaveLength(0);
    });

    it('Scenario 2 — "Sim." answers the pending question by checking times, never by booking', async () => {
      const { id, replies } = await converse([
        'Quais experiências têm vagas no dia 28?',
        'E como é essa experiência?',
        'Sim.',
      ]);

      expect(replies[1].reply).toContain('Quer que eu verifique os horários de quarta-feira, 28/10/2026?');
      expect(stateOf(id)?.pendingQuestion).toBeUndefined();

      // A resposta executa a consulta de horários, sem repetir a descrição.
      expect(replies[2].reply).toContain('Cidade Histórica / City Tour em quarta-feira, 28/10/2026:');
      expect(replies[2].reply).toContain('às 08:00');
      expect(replies[2].reply).not.toContain('Centro Histórico de Porto Seguro');
      expect(toolCalls('experiences.availability')).toEqual([{ experienceId: CITY_TOUR.id, date: ONLY_CITY_DATE }]);
      expect(booking.preview).not.toHaveBeenCalled();
      expect(booking.confirm).not.toHaveBeenCalled();
      expect(modelCalls('classifier')).toHaveLength(0);
    });

    it('records the pending question, and "não" closes it without running a tool', async () => {
      const first = await chat.sendMessage('Quais experiências têm vagas no dia 28?', GUEST);
      await chat.sendMessage('E como é essa experiência?', GUEST, first.conversationId);

      expect(stateOf(first.conversationId)?.pendingQuestion).toEqual({
        intent: 'experience.availability',
        targetId: CITY_TOUR.id,
      });

      const calls = registryCalls.length;
      await chat.sendMessage('Não, obrigado', GUEST, first.conversationId);

      expect(registryCalls).toHaveLength(calls);
      expect(stateOf(first.conversationId)?.pendingQuestion).toBeUndefined();

      // Sem pergunta pendente, um "sim" isolado não aciona ferramentas nem o classificador.
      await chat.sendMessage('Sim', GUEST, first.conversationId);
      expect(registryCalls).toHaveLength(calls);
      expect(modelCalls('classifier')).toHaveLength(0);
    });

    it('a "yes" to "posso preparar a reserva simulada" prepares a preview and still requires "confirmo"', async () => {
      const { id, replies } = await converse([
        'Quais experiências têm vagas no dia 28?',
        'E como é essa experiência?',
        'Sim, para 2 adultos',
      ]);
      // "Sim, para 2 adultos" traz informação nova: segue o fluxo normal (vagas para o grupo).
      expect(replies[2].reply).toContain('Se quiser, posso preparar a reserva simulada.');
      expect(stateOf(id)?.pendingQuestion).toEqual({ intent: 'experience.booking', targetId: CITY_TOUR.id });

      const yes = await chat.sendMessage('Pode sim', GUEST, id);
      expect(booking.preview).toHaveBeenCalledOnce();
      expect(yes.reply).toContain('Deseja confirmar?');
      expect(booking.confirm).not.toHaveBeenCalled();
      expect(stateOf(id)?.experience?.pendingPreviewId).toBe(PREVIEW_ID);
    });

    it('Scenario 3 — switches to restaurants from an experience conversation and never falls back', async () => {
      const { id, replies } = await converse([
        'Quais experiências têm vagas no dia 28?',
        'E como é essa experiência?',
        'E sobre os restaurantes, consegue me indicar algum?',
        'Sim, os restaurantes.',
        'Quero a segunda',
        'Quero reservar',
      ]);

      for (const reply of [replies[2], replies[3]]) {
        expect(reply.reply).not.toContain('Não encontrei essa informação');
        expect(reply.reply).toContain('Estes são os restaurantes do resort:');
        expect(reply.reply).toContain('1. Gino Praia Gastronomia — reserva pelo app');
        expect(reply.reply).toContain('2. Restaurante Central — Almoço: 12h às 15h');
        // Bares e lanches são citados, não listados.
        expect(reply.reply).toContain('Também há 1 bar e 1 opção de lanche ou sobremesa.');
        expect(reply.reply).not.toContain('Chá da Tarde');
        expect(reply.actions).toEqual([{ type: 'navigate', label: 'Abrir Gastronomia', screen: 'Gastronomy', params: {} }]);
      }

      // A experiência anterior não é reutilizada.
      expect(replies[4].reply).toContain('Restaurante Central é um restaurante do resort');
      expect(replies[4].reply).not.toContain('City Tour');
      expect(replies[5].reply).toContain('Restaurante Central não trabalha com reservas pelo aplicativo');
      expect(replies[5].actions).toEqual([
        { type: 'navigate', label: 'Abrir Gastronomia', screen: 'Gastronomy', params: { restaurantId: 'rest-central' } },
      ]);
      expect(stateOf(id)).toMatchObject({ topic: 'restaurant', restaurant: { selectedId: 'rest-central' } });
      expect(embeddings.embed).not.toHaveBeenCalled();
      expect(booking.preview).not.toHaveBeenCalled();
    });

    it('opens Gastronomy with the real id when the guest says yes to a bookable restaurant', async () => {
      const { replies } = await converse(['Quais restaurantes vocês têm?', 'Como é o Omakase?', 'Sim']);

      expect(replies[1].reply).toContain('Idade mínima: 12 anos.');
      expect(replies[1].reply).toContain('Quer que eu abra a Gastronomia?');
      expect(replies[2].reply).toContain('Para reservar no Omakase, é preciso selecionar os pratos');
      expect(replies[2].actions).toEqual([
        { type: 'navigate', label: 'Abrir Gastronomia', screen: 'Gastronomy', params: { restaurantId: 'rest-omakase' } },
      ]);
    });

    it('lists bars when asked, from the catalog', async () => {
      const { replies } = await converse(['E os bares?']);

      expect(replies[0].reply).toContain('Estes são os bares do resort:');
      expect(replies[0].reply).toContain('1. Bar Mirante — 09h às 21h');
      expect(toolCalls('restaurants.list').length).toBeGreaterThan(0);
    });

    it('Scenario 4 — summarizes the description once and never repeats it', async () => {
      const { replies } = await converse([
        'Quais experiências têm vagas no dia 28?',
        'E como é essa experiência?',
        'Me fala mais sobre essa experiência',
      ]);

      const first = replies[1].reply;
      // Resumo em frases inteiras, sem emoji nem a lista de preços do texto bruto.
      expect(first).toContain('Centro Histórico de Porto Seguro');
      expect(first).not.toContain('💰');
      expect(first).not.toContain('Crianças de 5 a 10 anos');
      expect(first).toContain('Valores: Adulto: R$');
      expect(first.split('\n')[1].length).toBeLessThanOrEqual(220);

      expect(replies[2].reply).toContain('Cidade Histórica / City Tour');
      expect(replies[2].reply).not.toContain('Centro Histórico de Porto Seguro');
    });

    it('asks which one only when "essa" is really ambiguous', async () => {
      const { replies } = await converse(['Quais experiências têm vagas amanhã?', 'E como é essa experiência?']);

      expect(replies[1].reply).toContain('Você se refere a qual delas?');
      expect(replies[1].reply).toContain('1. Cidade Histórica / City Tour');
      expect(replies[1].actions[0]).toMatchObject({ type: 'experience.options' });
      expect(toolCalls('experiences.details')).toHaveLength(0);
    });

    it('does not leak a pending question across conversations or guests', async () => {
      const first = await chat.sendMessage('Quais experiências têm vagas no dia 28?', GUEST);
      await chat.sendMessage('E como é essa experiência?', GUEST, first.conversationId);

      const calls = registryCalls.length;
      const sameGuestOtherConversation = await chat.sendMessage('Sim.', GUEST);
      const otherGuest = await chat.sendMessage('Sim.', OTHER_GUEST);

      expect(registryCalls).toHaveLength(calls);
      expect(sameGuestOtherConversation.reply).toBe('resposta livre');
      expect(otherGuest.reply).toBe('resposta livre');
      await expect(chat.sendMessage('Sim.', OTHER_GUEST, first.conversationId)).rejects.toThrow(NotFoundException);
      expect(stateOf(first.conversationId)?.pendingQuestion).toEqual({
        intent: 'experience.availability',
        targetId: CITY_TOUR.id,
      });
    });

    it('never lets the free-form model state availability for a bare "sim"', async () => {
      fetchMock.mockImplementation(async (_url, init) =>
        parseBody(init).format
          ? jsonResponse({ error: 'model unavailable' }, 503)
          : ollamaChat('Claro! Temos vagas às 9h amanhã por R$ 50.'),
      );

      const result = await chat.sendMessage('Sim', GUEST);

      expect(result.reply).not.toContain('9h');
      expect(result.reply).not.toContain('R$');
      expect(registryCalls).toHaveLength(0);
    });
  });

  describe('review regressions', () => {
    const navigateTargets = (response: ChatResponse) =>
      response.actions.map((action) => (action.type === 'navigate' ? action.params.restaurantId : undefined));

    it('a restaurant named in the message beats the stored selection', async () => {
      const { replies } = await converse(['Me fale sobre o restaurante Gino Praia', 'Quero reservar uma mesa no Omakase']);

      expect(replies[1].reply).toContain('Para reservar no Omakase');
      expect(navigateTargets(replies[1])).toEqual(['rest-omakase']);
    });

    it('a single listed bar does not hijack a question about another restaurant', async () => {
      const { replies } = await converse(['Quais bares tem?', 'Como é o restaurante Omakase?']);

      expect(replies[1].reply).toContain('Omakase é um restaurante');
      expect(replies[1].reply).not.toContain('Bar Mirante');
    });

    it.each(['Como é a piscina?', 'E o spa, como é?', 'Como é o check-in?', 'Esse tem opção vegana?'])(
      'sends %j to knowledge even inside a restaurant conversation',
      async (message) => {
        knowledge.searchByVector.mockResolvedValue([]);
        embeddings.embed.mockResolvedValue([[0.1]]);
        const { replies } = await converse(['Quais restaurantes existem?', message]);

        expect(replies[1].reply).not.toContain('opções de gastronomia');
        expect(replies[1].reply).not.toContain('restaurantes do resort:');
        expect(embeddings.embed).toHaveBeenCalledOnce();
      },
    );

    it.each(['Ok, obrigado!', 'Perfeito, obrigado!'])(
      'a closing %j never runs the pending booking offer',
      async (message) => {
        const { id } = await converse([
          'Quais experiências têm vagas no dia 28?',
          'E como é essa experiência?',
          'Sim, para 2 adultos',
        ]);
        expect(stateOf(id)?.pendingQuestion?.intent).toBe('experience.booking');

        await chat.sendMessage(message, GUEST, id);

        expect(booking.preview).not.toHaveBeenCalled();
        expect(stateOf(id)?.pendingQuestion).toBeUndefined();
      },
    );

    it('a "sim" after "Obrigado!" does not answer an old question', async () => {
      const { id } = await converse(['Quais experiências têm vagas no dia 28?', 'E como é essa experiência?', 'Obrigado!']);
      const calls = registryCalls.length;

      await chat.sendMessage('Sim', GUEST, id);

      expect(registryCalls).toHaveLength(calls);
    });

    it('"Sim, quero fazer a reserva" asks for the booking, not for the times', async () => {
      const { replies } = await converse([
        'Quais experiências têm vagas no dia 28?',
        'E como é essa experiência?',
        'Sim, quero fazer a reserva',
      ]);

      expect(replies[2].reply).toContain('quantos adultos e crianças');
      expect(booking.preview).not.toHaveBeenCalled();
    });
  });
});
