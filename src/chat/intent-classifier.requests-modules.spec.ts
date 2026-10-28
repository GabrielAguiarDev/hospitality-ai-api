import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { connectionError, installFetchMock } from '../../test/support/ollama-fakes.js';
import type { FetchMock } from '../../test/support/ollama-fakes.js';
import type { ConversationState } from '../contracts/conversation-state.js';

import type { ChatIntent } from './chat-intent.types.js';
import { IntentClassifierService } from './intent-classifier.service.js';

const PREVIEW = '1c5c2a5e-8c1d-4b7a-9e2f-3a4b5c6d7e8f';

const REQUEST_PENDING: ConversationState = {
  topic: 'request',
  phase: 'awaiting_confirmation',
  request: { departmentId: '3', pendingPreviewId: PREVIEW },
};
const EXPERIENCE_PENDING: ConversationState = {
  topic: 'experience',
  phase: 'awaiting_confirmation',
  experience: { selectedId: 'exp-1', pendingPreviewId: PREVIEW },
};

describe('IntentClassifierService routing for requests and modules', () => {
  let fetchMock: FetchMock;
  let service: IntentClassifierService;

  beforeEach(() => {
    fetchMock = installFetchMock();
    // Modelo indisponível: tudo abaixo precisa sair das regras determinísticas.
    fetchMock.mockRejectedValue(connectionError());
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    service = new IntentClassifierService(
      new ConfigService({ OLLAMA_BASE_URL: 'http://ollama.test:11434/', OLLAMA_CHAT_MODEL: 'qwen3:1.7b' }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const route = async (message: string, state?: ConversationState): Promise<ChatIntent> =>
    (await service.classify(message, [], state)).intent;

  it.each<[string, ChatIntent]>([
    ['Quero fazer uma solicitação de mais toalhas para a governança.', 'request.create'],
    ['Quais são as opções de solicitações?', 'request.catalog'],
    ['Solicitações.', 'request.catalog'],
    ['Quais tipos de solicitação posso fazer?', 'request.catalog'],
    ['Governança', 'request.catalog'],
    ['Preciso de toalhas.', 'request.create'],
    ['a TV não liga', 'request.create'],
    ['o wifi não conecta', 'request.create'],
    ['Obrigado, me traga um travesseiro extra', 'request.create'],
    ['E a minha solicitação anterior?', 'request.status'],
    ['Quais são minhas solicitações?', 'request.list'],
  ])('routes "%s" to %s without calling the model', async (message, intent) => {
    await expect(route(message)).resolves.toBe(intent);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each<[string, ChatIntent]>([
    ['Qual a senha do wifi?', 'knowledge.search'],
    ['Que horas abre o spa?', 'knowledge.search'],
    ['Qual o horário da área de lazer?', 'knowledge.search'],
    ['Quais produtos tem na boutique?', 'boutique.info'],
    ['Quanto custa a massagem relaxante?', 'spa.info'],
    ['Quais massagens tem?', 'spa.info'],
    ['Tem quiz hoje?', 'quiz.info'],
    ['dicas sobre águas-vivas', 'tips.list'],
    ['O que vocês fazem de ESG?', 'esg.info'],
    ['Tem atividade para crianças hoje?', 'event.list'],
  ])('routes "%s" to %s without calling the model', async (message, intent) => {
    await expect(route(message)).resolves.toBe(intent);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the module questions in their own domains', async () => {
    await expect(route('Quais experiências posso fazer?')).resolves.toBe('experience.list');
    await expect(route('Quais restaurantes tem?')).resolves.toBe('restaurant.list');
    await expect(route('Tem algum evento hoje?')).resolves.toBe('event.list');
  });

  describe('with a request preview pending', () => {
    it('reads thanks as social, never as a new request', async () => {
      const decision = await service.classify('Obrigado!', [], REQUEST_PENDING);

      expect(decision.intent).toBe('conversation.general');
      expect(decision.intent).not.toBe('request.create');
    });

    it('reads "Obrigado, me traga um travesseiro extra" as a new request, not as a confirmation', async () => {
      await expect(route('Obrigado, me traga um travesseiro extra', REQUEST_PENDING)).resolves.toBe('request.create');
    });

    it.each(['confirmo', 'Confirmo', 'sim', 'Pode confirmar'])('confirms the request on "%s"', async (message) => {
      await expect(route(message, REQUEST_PENDING)).resolves.toBe('request.confirm');
    });

    it.each(['não, deixa', 'Não', 'cancela'])('cancels the request on "%s"', async (message) => {
      await expect(route(message, REQUEST_PENDING)).resolves.toBe('request.cancel');
    });
  });

  describe('with an experience pre-booking pending', () => {
    it.each(['sim', 'confirmo', 'Pode confirmar'])('confirms the experience on "%s"', async (message) => {
      await expect(route(message, EXPERIENCE_PENDING)).resolves.toBe('experience.booking.confirm');
    });

    it.each(['não', 'não, deixa'])('cancels the experience on "%s"', async (message) => {
      await expect(route(message, EXPERIENCE_PENDING)).resolves.toBe('experience.booking.cancel');
    });
  });

  it('does not confirm anything on "confirmo" when nothing is pending', async () => {
    const intent = await route('confirmo', {});

    expect(['request.confirm', 'experience.booking.confirm']).not.toContain(intent);
  });

  describe('with a department in conversation ("Governança" asked "O que você precisa?")', () => {
    const state: ConversationState = { topic: 'request', request: { departmentId: '3' } };

    it('reads a short reply as the item', async () => {
      await expect(route('kit pet', state)).resolves.toBe('request.create');
      await expect(route('toalha de banho', state)).resolves.toBe('request.create');
    });

    it('lets thanks stay social and a long message fall through', async () => {
      await expect(route('Obrigado!', state)).resolves.toBe('conversation.general');
      await expect(route('Vocês têm algum horário de funcionamento especial no feriado de carnaval?', state)).resolves.toBe('knowledge.search');
    });

    it.each<[string, ChatIntent]>([
      ['Tem algum evento hoje?', 'event.list'],
      ['Me mostra os restaurantes.', 'restaurant.list'],
      ['Quais massagens tem?', 'spa.info'],
      ['Tem quiz hoje?', 'quiz.info'],
    ])('does not hijack "%s" (expected %s)', async (message, intent) => {
      await expect(route(message, state)).resolves.toBe(intent);
    });

    it.each(['não preciso de mais toalhas', 'não quero nada'])('does not read the negation "%s" as an item', async (message) => {
      await expect(route(message, state)).resolves.not.toBe('request.create');
    });

    it('does not read "não, deixa" as an item', async () => {
      await expect(route('não, deixa', state)).resolves.not.toBe('request.create');
    });

    it('does not hijack "Qual a senha do wifi?" (expected knowledge.search)', async () => {
      await expect(route('Qual a senha do wifi?', state)).resolves.toBe('knowledge.search');
    });

    it.each(['A piscina é aquecida?', 'que horas abre a piscina', 'e o check-out?', 'senha do wifi', 'e a academia?', 'cancelar'])(
      'does not read the question "%s" as an item',
      async (message) => {
        await expect(route(message, state)).resolves.not.toBe('request.create');
      },
    );

    it('still reads an item with a question mark as the answer', async () => {
      await expect(route('toalha de rosto?', state)).resolves.toBe('request.create');
    });
  });

  it('routes "O ar condicionado não está gelando" to request.create', async () => {
    await expect(route('O ar condicionado não está gelando')).resolves.toBe('request.create');
  });
  describe('menus, favorites, leisure, my bookings and catalog follow-ups', () => {
    it.each<[string, ChatIntent]>([
      ['Mostre o cardápio do restaurante italiano', 'restaurant.menu'],
      ['Mostre meus favoritos', 'favorite.list'],
      ['Adicione essa experiência aos favoritos', 'favorite.manage'],
      ['Quero inscrever meu filho na recreação', 'leisure.enroll'],
      ['Tenho alguma reserva amanhã?', 'reservation.list'],
      ['Qual minha próxima reserva?', 'reservation.list'],
      ['Mostre minhas reservas gastronômicas', 'reservation.list'],
      ['Preciso de duas toalhas extras', 'request.create'],
      ['Quero solicitar limpeza no meu quarto', 'request.create'],
      ['Qual o status da minha solicitação?', 'request.status'],
    ])('routes %j to %s', async (message, intent) => {
      await expect(route(message, {})).resolves.toBe(intent);
    });

    it('"a segunda" after an SPA list repeats spa.info with the position', async () => {
      const state: ConversationState = {
        topic: 'module',
        lastIntent: 'spa.info',
        catalog: { kind: 'spa_service', listed: [{ id: '1', title: 'A' }, { id: '2', title: 'B' }] },
      };
      const decision = await service.classify('Me fala da segunda', [], state);
      expect(decision).toMatchObject({ intent: 'spa.info', entities: { ordinal: 2 } });
    });

    it('continues a booking that asked for the party instead of checking availability', async () => {
      const asked: ConversationState = {
        topic: 'experience',
        lastIntent: 'experience.booking',
        experience: { selectedId: 'exp-1', date: '2026-10-24', awaiting: 'booking' },
      };
      await expect(route('Para duas pessoas', asked)).resolves.toBe('experience.booking');
      await expect(route('2 adultos e 1 criança', asked)).resolves.toBe('experience.booking');

      // Sem a pergunta pendente, o mesmo texto continua sendo uma consulta de vagas.
      const { awaiting: _asked, ...experience } = asked.experience!;
      await expect(route('Para duas pessoas', { ...asked, experience })).resolves.toBe('experience.availability');
    });
  });
  describe('review regressions: new detectors do not hijack other questions', () => {
    it.each<[string, ConversationState | undefined, ChatIntent | RegExp]>([
      ['Qual o restaurante favorito dos hóspedes?', undefined, /^(?!favorite\.)/],
      ['Qual o passeio favorito das crianças?', undefined, /^(?!favorite\.)/],
      ['Quais atividades posso participar amanhã?', undefined, /^(?!leisure\.enroll)/],
      ['Quero participar do show de mágica', { topic: 'event', lastIntent: 'event.list', event: {} }, /^(?!leisure\.enroll)/],
      ['O passeio de barco inclui cardápio?', undefined, /^(?!restaurant\.menu)/],
    ])('%j is not captured by the new detectors', async (message, state, expected) => {
      const intent = await route(message, state);
      if (typeof expected === 'string') expect(intent).toBe(expected);
      else expect(intent).toMatch(expected);
    });

    it.each([
      ['spa.info', 'Quero reservar o primeiro restaurante'],
      ['tips.list', 'Qual o status da primeira solicitação?'],
      ['boutique.info', 'Me fala da primeira experiência'],
    ] as const)('after %s, %j goes to its own domain, not the catalog list', async (lastIntent, message) => {
      const state: ConversationState = { topic: 'module', lastIntent, catalog: { kind: 'tip', listed: [{ id: '1', title: 'A' }, { id: '2', title: 'B' }] } };
      await expect(route(message, state)).resolves.not.toBe(lastIntent);
    });
  });
});
