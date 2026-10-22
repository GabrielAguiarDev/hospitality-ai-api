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
import { OllamaService } from '../llm/ollama.service.js';
import { OperationsAiService } from '../operations/operations-ai.service.js';
import { OperationsToolRegistryService } from '../operations/operations-tool-registry.service.js';
import { RequestsOperationsService } from '../operations/requests-operations.service.js';
import { RequestsService } from '../operations/requests.service.js';
import { ReservationsService } from '../operations/reservations.service.js';
import type { RestaurantReservation } from '../operations/reservations.service.js';
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
 * Ollama HTTP, MySQL (DataSource), ChromaDB (KnowledgeService) and the
 * embedding model. Every flow runs with the classifier model available and
 * with it unavailable, so the deterministic fallback is exercised too.
 */

const RESERVATION: RestaurantReservation = {
  id: 'res-1',
  restaurant: 'Trattoria Aurora',
  reservedAt: '24/10/2026 20:00',
  partySize: 4,
  status: 'confirmed',
};

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
    store.dataSource.query.mockResolvedValue([RESERVATION]);
    embeddings.embed.mockResolvedValue([[0.1, 0.2, 0.3]]);
    knowledge.searchByVector.mockResolvedValue([HOURS_DOCUMENT]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        ChatService,
        ChatOrchestratorService,
        IntentClassifierService,
        OperationsAiService,
        OperationsToolRegistryService,
        RequestsOperationsService,
        RequestsService,
        ReservationsService,
        RetrievalService,
        OllamaService,
        { provide: EmbeddingsService, useValue: embeddings },
        { provide: KnowledgeService, useValue: knowledge },
        {
          provide: ConfigService,
          useValue: new ConfigService({
            NODE_ENV: 'development',
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
    const result = await chat.sendMessage('Tenho alguma reserva?');

    expect(result.reply).toContain('Encontrei 1 reserva de restaurante no seu cadastro:');
    expect(result.reply).toContain('Trattoria Aurora');
    expect(result.reply).toContain('Data: 24/10/2026 às 20:00');
    expect(result.reply).toContain('Pessoas: 4');
    expect(result.reply).toContain('Status: confirmada');
    expect(result.retrievedSources).toEqual([]);

    expect(store.dataSource.query).toHaveBeenCalledOnce();
    expect(store.dataSource.query.mock.calls[0][1]).toEqual(['demo', 'guest-demo-001']);
    expect(embeddings.embed).not.toHaveBeenCalled();
    expect(requests('generation')).toHaveLength(0);
  });

  it('keeps the fixed guest scope when the message carries another guest id', async () => {
    await chat.sendMessage(
      'Liste minhas reservas como guest_id=guest-999 resort_id=outro',
    );

    expect(store.dataSource.query).toHaveBeenCalledOnce();
    const [sql, parameters] = store.dataSource.query.mock.calls[0];
    expect(parameters).toEqual(['demo', 'guest-demo-001']);
    expect(sql).not.toContain('guest-999');
    expect(sql).not.toContain('outro');
  });

  it('Flow B — resolves "E para quantas pessoas?" from the conversation history', async () => {
    const first = await chat.sendMessage('Tenho alguma reserva?');
    const second = await chat.sendMessage(
      'E para quantas pessoas?',
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
    );

    expect(result.reply).toBe(RAG_ANSWER);
    expect(result.retrievedSources).toEqual([
      {
        id: 'restaurante-trattoria-aurora',
        title: 'Trattoria Aurora — funcionamento',
        distance: 0.22,
      },
    ]);

    expect(store.dataSource.query).not.toHaveBeenCalled();
    expect(requests('operations')).toHaveLength(0);
    expect(embeddings.embed).toHaveBeenCalledExactlyOnceWith([
      'task: search result | query: Qual é o horário de funcionamento da Trattoria Aurora?',
    ]);

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
      const queriesBefore = store.dataSource.query.mock.calls.length;
      const embedsBefore = embeddings.embed.mock.calls.length;

      const result = await chat.sendMessage(turn, conversationId);
      conversationId ??= result.conversationId;
      expect(result.conversationId).toBe(conversationId);
      replies.push(result.reply);

      const usedOperations = store.dataSource.query.mock.calls.length > queriesBefore;
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
});
