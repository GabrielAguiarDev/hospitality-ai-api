import { BadGatewayException, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { OperationsAiService } from '../operations/operations-ai.service.js';
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

const HISTORY: HistoryEntry[] = [
  { role: 'user', content: 'Tenho alguma reserva?' },
  {
    role: 'assistant',
    content: 'Encontrei 1 reserva de restaurante no seu cadastro:',
  },
];

type OperationsAskResult = Awaited<ReturnType<OperationsAiService['ask']>>;

function operationsResult(reply: string): OperationsAskResult {
  return {
    reply,
    toolUsed: true,
    toolRequestedByModel: false,
    reservationsFound: 1,
  };
}

describe('ChatOrchestratorService', () => {
  const classifier = {
    classify: vi.fn<IntentClassifierService['classify']>(),
  };
  const operations = { ask: vi.fn<OperationsAiService['ask']>() };
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
        { provide: OperationsAiService, useValue: operations },
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
    ])('routes $intent/$detail to OperationsAiService only', async (decision) => {
      classifier.classify.mockResolvedValue(decision);
      operations.ask.mockResolvedValue(
        operationsResult('Sua reserva na Trattoria Aurora é para 4 pessoas.'),
      );

      const result = await orchestrator.resolve('E para quantas pessoas?', HISTORY);

      expect(operations.ask).toHaveBeenCalledExactlyOnceWith(
        'E para quantas pessoas?',
        decision,
      );
      expect(retrieval.search).not.toHaveBeenCalled();
      expect(result).toEqual({
        mode: 'operations',
        reply: 'Sua reserva na Trattoria Aurora é para 4 pessoas.',
        documents: [],
      });
    });

    it('exposes only the reply, not internal tool metadata', async () => {
      classifier.classify.mockResolvedValue({
        intent: 'reservation.list',
        detail: 'none',
      });
      operations.ask.mockResolvedValue(operationsResult('Encontrei 1 reserva.'));

      const result = await orchestrator.resolve('Tenho alguma reserva?');

      expect(Object.keys(result).sort()).toEqual(['documents', 'mode', 'reply']);
    });

    it('propagates OperationsAiService failures instead of falling back to RAG', async () => {
      classifier.classify.mockResolvedValue({
        intent: 'reservation.list',
        detail: 'none',
      });
      operations.ask.mockRejectedValue(
        new BadGatewayException('Não foi possível conectar ao Ollama.'),
      );

      await expect(
        orchestrator.resolve('Tenho alguma reserva?'),
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
      const result = await orchestrator.resolve(question, HISTORY);

      expect(retrieval.search).toHaveBeenCalledExactlyOnceWith(question);
      expect(operations.ask).not.toHaveBeenCalled();
      expect(result).toEqual({ mode: 'knowledge', documents: [HOURS_DOCUMENT] });
    });

    it('returns knowledge mode with no documents when nothing is retrieved', async () => {
      classifier.classify.mockResolvedValue({
        intent: 'knowledge.search',
        detail: 'none',
      });
      retrieval.search.mockResolvedValue([]);

      await expect(
        orchestrator.resolve('Vocês têm heliponto?'),
      ).resolves.toEqual({ mode: 'knowledge', documents: [] });
    });

    it('propagates RetrievalService failures instead of falling back to operations', async () => {
      classifier.classify.mockResolvedValue({
        intent: 'knowledge.search',
        detail: 'none',
      });
      retrieval.search.mockRejectedValue(new Error('ChromaDB indisponível'));

      await expect(orchestrator.resolve('O resort tem spa?')).rejects.toThrow(
        'ChromaDB indisponível',
      );
      expect(operations.ask).not.toHaveBeenCalled();
    });
  });

  describe('classification', () => {
    it('passes the message and the history to the classifier', async () => {
      classifier.classify.mockResolvedValue({
        intent: 'knowledge.search',
        detail: 'none',
      });
      retrieval.search.mockResolvedValue([]);

      await orchestrator.resolve('Está confirmada?', HISTORY);

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

      await orchestrator.resolve('Olá');

      expect(classifier.classify).toHaveBeenCalledWith('Olá', []);
    });

    it('does not call any downstream service when classification fails', async () => {
      classifier.classify.mockRejectedValue(new Error('unexpected'));

      await expect(orchestrator.resolve('Olá')).rejects.toThrow('unexpected');
      expect(operations.ask).not.toHaveBeenCalled();
      expect(retrieval.search).not.toHaveBeenCalled();
    });
  });
});
