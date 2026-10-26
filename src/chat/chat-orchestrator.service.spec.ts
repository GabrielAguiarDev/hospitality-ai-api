import { BadGatewayException, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import type { GuestContext } from '../guest/guest-context.js';
import { OperationsDispatcherService } from '../operations/operations-dispatcher.service.js';
import type { RetrievedDocument } from '../rag/knowledge.service.js';
import { RetrievalService } from '../rag/retrieval.service.js';

import type { HistoryEntry, IntentDecision } from './chat-intent.types.js';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ChatOrchestratorService } from './chat-orchestrator.service.js';
import { ConversationContextService } from './conversation-context.service.js';
import { ChatConversationState } from './entities/chat-conversation-state.entity.js';
import { IntentClassifierService } from './intent-classifier.service.js';

const HOURS_DOCUMENT: RetrievedDocument = {
  id: 'restaurante-trattoria-aurora',
  title: 'Trattoria Aurora',
  content: 'A Trattoria Aurora funciona diariamente das 19h às 23h.',
  distance: 0.21,
};

const GUEST: GuestContext = { resortId: 'resort-1', guestId: 'guest-001' };

const HISTORY: HistoryEntry[] = [
  { role: 'user', content: 'Tenho alguma reserva?' },
  {
    role: 'assistant',
    content: 'Encontrei 1 reserva de restaurante no seu cadastro:',
  },
];

describe('ChatOrchestratorService', () => {
  const classifier = {
    classify: vi.fn<IntentClassifierService['classify']>(),
  };
  const dispatcher = {
    dispatch: vi.fn<OperationsDispatcherService['dispatch']>(),
    findProducts: vi.fn<OperationsDispatcherService['findProducts']>(async () => null),
  };
  const retrieval = { search: vi.fn<RetrievalService['search']>() };

  let orchestrator: ChatOrchestratorService;

  beforeEach(async () => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    // Only the collaborators are provided: if the orchestrator ever started
    // depending on DataSource or EmbeddingsService, this would fail. The
    // context service resolves references from the given state only.
    const moduleRef = await Test.createTestingModule({
      providers: [
        ChatOrchestratorService,
        ConversationContextService,
        { provide: getRepositoryToken(ChatConversationState), useValue: {} },
        { provide: IntentClassifierService, useValue: classifier },
        { provide: OperationsDispatcherService, useValue: dispatcher },
        { provide: RetrievalService, useValue: retrieval },
      ],
    }).compile();

    orchestrator = moduleRef.get(ChatOrchestratorService);
  });

  afterEach(() => {
    vi.resetAllMocks();
    vi.restoreAllMocks();
  });

  describe('operational intents', () => {
    it.each<IntentDecision>([
      { intent: 'reservation.list', detail: 'none' },
      { intent: 'reservation.details', detail: 'party_size' },
      { intent: 'reservation.details', detail: 'date' },
      { intent: 'reservation.details', detail: 'time' },
      { intent: 'reservation.details', detail: 'restaurant' },
      { intent: 'reservation.status', detail: 'none' },
      { intent: 'request.list', detail: 'none' },
      { intent: 'request.status', detail: 'none' },
    ])('routes $intent/$detail to the dispatcher only', async (decision) => {
      classifier.classify.mockResolvedValue(decision);
      dispatcher.dispatch.mockResolvedValue({
        tool: 'reservations.list',
        reply: 'Sua reserva na Trattoria Aurora é para 4 pessoas.',
      });

      const result = await orchestrator.resolve('E para quantas pessoas?', GUEST, HISTORY);

      expect(dispatcher.dispatch).toHaveBeenCalledExactlyOnceWith(
        'E para quantas pessoas?',
        decision,
        GUEST,
      );
      expect(retrieval.search).not.toHaveBeenCalled();
      expect(result).toEqual({
        mode: 'operations',
        reply: 'Sua reserva na Trattoria Aurora é para 4 pessoas.',
        documents: [],
      });
    });

    it('exposes only the reply, not the tool used', async () => {
      classifier.classify.mockResolvedValue({
        intent: 'request.list',
        detail: 'none',
      });
      dispatcher.dispatch.mockResolvedValue({
        tool: 'requests.list',
        reply: 'Você tem 1 solicitação pendente.',
      });

      const result = await orchestrator.resolve('Quais são minhas solicitações?', GUEST);

      expect(Object.keys(result).sort()).toEqual(['documents', 'mode', 'reply']);
    });

    it('propagates dispatcher failures instead of falling back to RAG', async () => {
      classifier.classify.mockResolvedValue({
        intent: 'reservation.list',
        detail: 'none',
      });
      dispatcher.dispatch.mockRejectedValue(
        new BadGatewayException('Não foi possível conectar ao Ollama.'),
      );

      await expect(
        orchestrator.resolve('Tenho alguma reserva?', GUEST),
      ).rejects.toBeInstanceOf(BadGatewayException);
      expect(retrieval.search).not.toHaveBeenCalled();
    });
  });

  describe('conversation intents', () => {
    it.each<IntentDecision>([
      { intent: 'conversation.greeting', detail: 'none' },
      { intent: 'conversation.general', detail: 'none' },
    ])('answers $intent without RAG or tools', async (decision) => {
      classifier.classify.mockResolvedValue(decision);

      const result = await orchestrator.resolve('Olá', GUEST, HISTORY);

      expect(retrieval.search).not.toHaveBeenCalled();
      expect(dispatcher.dispatch).not.toHaveBeenCalled();
      expect(result).toEqual({ mode: 'conversation', intent: decision.intent, documents: [] });
    });

    it('keeps the conversation state untouched, including a pending pre-booking', async () => {
      classifier.classify.mockResolvedValue({ intent: 'conversation.general', detail: 'none' });
      const state = {
        topic: 'experience' as const,
        experience: { selectedId: 'exp-1', pendingPreviewId: 'preview-1' },
      };

      const result = await orchestrator.resolve('Obrigado!', GUEST, [], {
        conversationId: 'conv-1',
        state,
        today: '2026-10-23',
      });

      // A pré-reserva continua aguardando confirmação.
      expect(result).toEqual({
        mode: 'conversation',
        intent: 'conversation.general',
        documents: [],
        state: { ...state, phase: 'awaiting_confirmation' },
      });
    });
  });

  describe('pending pre-booking and topic changes', () => {
    const CTX = (state: object) => ({ conversationId: 'conv-1', state, today: '2026-10-23' });
    const pending = { topic: 'experience' as const, experience: { selectedId: 'exp-1', pendingPreviewId: 'preview-1' } };

    it.each<[IntentDecision]>([
      [{ intent: 'restaurant.list', detail: 'none' }],
      [{ intent: 'event.list', detail: 'none' }],
      [{ intent: 'reservation.list', detail: 'none' }],
      [{ intent: 'request.list', detail: 'none' }],
    ])('clears the pending preview before dispatching %j, keeping the selected experience', async (decision) => {
      classifier.classify.mockResolvedValue(decision);
      dispatcher.dispatch.mockResolvedValue({ tool: 'restaurants.list', reply: 'ok' });

      const result = await orchestrator.resolve('Quais restaurantes tem?', GUEST, [], CTX(pending));

      const dispatched = dispatcher.dispatch.mock.calls[0][3];
      expect(dispatched?.state.experience?.pendingPreviewId).toBeUndefined();
      expect(dispatched?.state.experience?.selectedId).toBe('exp-1');
      expect(result.state?.experience?.pendingPreviewId).toBeUndefined();
    });

    it('keeps the pending preview for experience intents', async () => {
      classifier.classify.mockResolvedValue({ intent: 'experience.booking.confirm', detail: 'none' });
      dispatcher.dispatch.mockResolvedValue({ tool: 'experiences.booking.confirm', reply: 'ok' });

      await orchestrator.resolve('confirmo', GUEST, [], CTX(pending));

      expect(dispatcher.dispatch.mock.calls[0][3]?.state.experience?.pendingPreviewId).toBe('preview-1');
    });
  });

  describe('pending confirmations across domains', () => {
    const CTX = (state: object) => ({ conversationId: 'conv-1', state, today: '2026-10-23' });
    const pendingRequest = { topic: 'request' as const, request: { pendingPreviewId: 'req-1', departmentId: '3' } };
    const pendingExperience = { topic: 'experience' as const, experience: { selectedId: 'exp-1', pendingPreviewId: 'preview-1' } };

    it('clears a pending request before dispatching an unrelated intent', async () => {
      classifier.classify.mockResolvedValue({ intent: 'event.list', detail: 'none' });
      dispatcher.dispatch.mockResolvedValue({ tool: 'events.list', reply: 'ok' });

      const result = await orchestrator.resolve('Tem algum evento hoje?', GUEST, [], CTX(pendingRequest));

      expect(dispatcher.dispatch.mock.calls[0][3]?.state.request?.pendingPreviewId).toBeUndefined();
      expect(result.state?.request?.pendingPreviewId).toBeUndefined();
    });

    it('keeps the pending request for request intents so "confirmo" reaches its handler', async () => {
      classifier.classify.mockResolvedValue({ intent: 'request.confirm', detail: 'none' });
      dispatcher.dispatch.mockResolvedValue({ tool: 'requests.confirm', reply: 'ok' });

      await orchestrator.resolve('confirmo', GUEST, [], CTX(pendingRequest));

      expect(dispatcher.dispatch.mock.calls[0][3]?.state.request?.pendingPreviewId).toBe('req-1');
    });

    it('drops a pending experience pre-booking when the guest starts a request, and vice versa', async () => {
      classifier.classify.mockResolvedValue({ intent: 'request.create', detail: 'none' });
      dispatcher.dispatch.mockResolvedValue({ tool: 'requests.preview', reply: 'ok' });
      await orchestrator.resolve('Preciso de toalhas', GUEST, [], CTX(pendingExperience));
      expect(dispatcher.dispatch.mock.calls[0][3]?.state.experience?.pendingPreviewId).toBeUndefined();
      expect(dispatcher.dispatch.mock.calls[0][3]?.state.experience?.selectedId).toBe('exp-1');

      classifier.classify.mockResolvedValue({ intent: 'experience.list', detail: 'none' });
      dispatcher.dispatch.mockResolvedValue({ tool: 'experiences.list', reply: 'ok' });
      await orchestrator.resolve('Quais experiências?', GUEST, [], CTX(pendingRequest));
      expect(dispatcher.dispatch.mock.calls[1][3]?.state.request?.pendingPreviewId).toBeUndefined();
    });

    it('does not keep either confirmation when the product fallback answers (no stray "confirmo")', async () => {
      classifier.classify.mockResolvedValue({ intent: 'knowledge.search', detail: 'none' });
      retrieval.search.mockResolvedValue([]);
      dispatcher.findProducts.mockResolvedValue({ tool: 'boutique.list', reply: 'Na Boutique: Protetor solar.', state: { topic: 'module' } });

      for (const pending of [pendingRequest, pendingExperience]) {
        const result = await orchestrator.resolve('Tem protetor solar?', GUEST, [], CTX(pending));

        const passed = dispatcher.findProducts.mock.lastCall?.[2];
        expect(passed?.state.request?.pendingPreviewId).toBeUndefined();
        expect(passed?.state.experience?.pendingPreviewId).toBeUndefined();
        expect(result.state?.request?.pendingPreviewId).toBeUndefined();
        expect(result.state?.experience?.pendingPreviewId).toBeUndefined();
      }
    });
  });

  describe('product fallback when the RAG finds nothing', () => {
    const CTX = { conversationId: 'conv-1', state: {}, today: '2026-10-23' };

    beforeEach(() => {
      classifier.classify.mockResolvedValue({ intent: 'knowledge.search', detail: 'none' });
      retrieval.search.mockResolvedValue([]);
    });

    it('answers from the Boutique, in operations mode, with its actions and the module topic', async () => {
      const navigate = { type: 'navigate' as const, label: 'Abrir Boutique', screen: 'Boutique' as const, params: {} };
      dispatcher.findProducts.mockResolvedValue({ tool: 'boutique.list', reply: 'Na Boutique: Protetor solar, R$ 59,90.', actions: [navigate], state: { topic: 'module' } });

      const result = await orchestrator.resolve('Tem protetor solar?', GUEST, [], CTX);

      expect(result).toMatchObject({ mode: 'operations', reply: 'Na Boutique: Protetor solar, R$ 59,90.', documents: [], actions: [navigate] });
      expect(result.state?.topic).toBe('module');
    });

    it('falls back to knowledge mode without documents when no product matches', async () => {
      dispatcher.findProducts.mockResolvedValue(null);

      await expect(orchestrator.resolve('Vocês têm heliponto?', GUEST, [], CTX)).resolves.toMatchObject({ mode: 'knowledge', documents: [] });
    });

    it('does not look for products when the RAG found documents', async () => {
      retrieval.search.mockResolvedValue([HOURS_DOCUMENT]);

      await orchestrator.resolve('Que horas abre o spa?', GUEST, [], CTX);

      expect(dispatcher.findProducts).not.toHaveBeenCalled();
    });

    it('works without a conversation context', async () => {
      dispatcher.findProducts.mockResolvedValue(null);

      await orchestrator.resolve('Vocês têm heliponto?', GUEST);

      expect(dispatcher.findProducts).toHaveBeenCalledWith('Vocês têm heliponto?', GUEST, undefined);
    });
  });

  describe('knowledge follow-ups', () => {
    const CTX = (lastIntent?: 'knowledge.search' | 'restaurant.list') => ({
      conversationId: 'conv-1',
      state: { topic: 'knowledge' as const, ...(lastIntent ? { lastIntent } : {}) },
      today: '2026-10-23',
    });
    const history: HistoryEntry[] = [
      { role: 'user', content: 'Que horas abre o spa?' },
      { role: 'assistant', content: 'O spa abre às 9h.' },
    ];

    beforeEach(() => {
      classifier.classify.mockResolvedValue({ intent: 'knowledge.search', detail: 'none' });
      retrieval.search.mockResolvedValue([HOURS_DOCUMENT]);
    });

    it.each(['E a academia?', 'Então e a piscina?', 'Mas e o salão de jogos?'])(
      'prepends the previous question to the retrieval query of %j',
      async (message) => {
        await orchestrator.resolve(message, GUEST, history, CTX('knowledge.search'));

        expect(retrieval.search.mock.calls[0][0]).toBe(`Que horas abre o spa? ${message}`);
      },
    );

    it('does not rewrite a long follow-up, a full question or a follow-up without knowledge context', async () => {
      await orchestrator.resolve('E a academia fica aberta até que horas durante a semana inteira?', GUEST, history, CTX('knowledge.search'));
      await orchestrator.resolve('Onde fica a academia?', GUEST, history, CTX('knowledge.search'));
      await orchestrator.resolve('E a academia?', GUEST, history, CTX('restaurant.list'));
      await orchestrator.resolve('E a academia?', GUEST, history, CTX());

      expect(retrieval.search.mock.calls.map(([query]) => query)).toEqual([
        'E a academia fica aberta até que horas durante a semana inteira?',
        'Onde fica a academia?',
        'E a academia?',
        'E a academia?',
      ]);
    });
  });

  describe('knowledge intent', () => {
    it('routes knowledge.search to RetrievalService only and returns the documents', async () => {
      classifier.classify.mockResolvedValue({
        intent: 'knowledge.search',
        detail: 'none',
      });
      retrieval.search.mockResolvedValue([HOURS_DOCUMENT]);

      const question = 'Qual é o horário de funcionamento da Trattoria Aurora?';
      const result = await orchestrator.resolve(question, GUEST, HISTORY);

      expect(retrieval.search).toHaveBeenCalledExactlyOnceWith(question, GUEST.resortId);
      expect(dispatcher.dispatch).not.toHaveBeenCalled();
      expect(result).toEqual({ mode: 'knowledge', documents: [HOURS_DOCUMENT] });
    });

    it('returns knowledge mode with no documents when nothing is retrieved', async () => {
      classifier.classify.mockResolvedValue({
        intent: 'knowledge.search',
        detail: 'none',
      });
      retrieval.search.mockResolvedValue([]);

      await expect(
        orchestrator.resolve('Vocês têm heliponto?', GUEST),
      ).resolves.toEqual({ mode: 'knowledge', documents: [] });
    });

    it('propagates RetrievalService failures instead of falling back to operations', async () => {
      classifier.classify.mockResolvedValue({
        intent: 'knowledge.search',
        detail: 'none',
      });
      retrieval.search.mockRejectedValue(new Error('ChromaDB indisponível'));

      await expect(orchestrator.resolve('O resort tem spa?', GUEST)).rejects.toThrow(
        'ChromaDB indisponível',
      );
      expect(dispatcher.dispatch).not.toHaveBeenCalled();
    });
  });

  describe('classification', () => {
    it('passes the message and the history to the classifier', async () => {
      classifier.classify.mockResolvedValue({
        intent: 'knowledge.search',
        detail: 'none',
      });
      retrieval.search.mockResolvedValue([]);

      await orchestrator.resolve('Está confirmada?', GUEST, HISTORY);

      expect(classifier.classify).toHaveBeenCalledExactlyOnceWith(
        'Está confirmada?',
        HISTORY,
      );
    });

    it('defaults to an empty history', async () => {
      classifier.classify.mockResolvedValue({
        intent: 'knowledge.search',
        detail: 'none',
      });
      retrieval.search.mockResolvedValue([]);

      await orchestrator.resolve('Olá', GUEST);

      expect(classifier.classify).toHaveBeenCalledWith('Olá', []);
    });

    it('does not call any downstream service when classification fails', async () => {
      classifier.classify.mockRejectedValue(new Error('unexpected'));

      await expect(orchestrator.resolve('Olá', GUEST)).rejects.toThrow('unexpected');
      expect(dispatcher.dispatch).not.toHaveBeenCalled();
      expect(retrieval.search).not.toHaveBeenCalled();
    });
  });
});
