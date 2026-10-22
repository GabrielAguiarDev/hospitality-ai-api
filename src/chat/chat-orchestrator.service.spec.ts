import { BadGatewayException, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import type { GuestContext } from '../guest/guest-context.js';
import { OperationsDispatcherService } from '../operations/operations-dispatcher.service.js';
import type { RetrievedDocument } from '../rag/knowledge.service.js';
import { RetrievalService } from '../rag/retrieval.service.js';

import type { HistoryEntry, IntentDecision } from './chat-intent.types.js';
import { ChatOrchestratorService } from './chat-orchestrator.service.js';
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
  };
  const retrieval = { search: vi.fn<RetrievalService['search']>() };

  let orchestrator: ChatOrchestratorService;

  beforeEach(async () => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    // Only the three collaborators are provided: if the orchestrator ever
    // started depending on DataSource or EmbeddingsService, this would fail.
    const moduleRef = await Test.createTestingModule({
      providers: [
        ChatOrchestratorService,
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

  describe('knowledge intent', () => {
    it('routes knowledge.search to RetrievalService only and returns the documents', async () => {
      classifier.classify.mockResolvedValue({
        intent: 'knowledge.search',
        detail: 'none',
      });
      retrieval.search.mockResolvedValue([HOURS_DOCUMENT]);

      const question = 'Qual é o horário de funcionamento da Trattoria Aurora?';
      const result = await orchestrator.resolve(question, GUEST, HISTORY);

      expect(retrieval.search).toHaveBeenCalledExactlyOnceWith(question);
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
