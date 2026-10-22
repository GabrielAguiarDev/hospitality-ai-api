import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { EmbeddingsService } from './embeddings.service.js';
import { KnowledgeService } from './knowledge.service.js';
import type { RetrievedDocument } from './knowledge.service.js';
import { RetrievalService } from './retrieval.service.js';

const QUERY_VECTOR = [0.1, 0.2, 0.3];
const RESORT_ID = 'resort-1';

function document(id: string, distance: number | null): RetrievedDocument {
  return { id, title: id, content: `conteúdo ${id}`, distance };
}

describe('RetrievalService', () => {
  const embeddings = { embed: vi.fn<EmbeddingsService['embed']>() };
  const knowledge = { searchByVector: vi.fn<KnowledgeService['searchByVector']>() };

  function createService(config: Record<string, string> = {}) {
    return new RetrievalService(
      embeddings as unknown as EmbeddingsService,
      knowledge as unknown as KnowledgeService,
      new ConfigService(config),
    );
  }

  beforeEach(() => {
    embeddings.embed.mockResolvedValue([QUERY_VECTOR]);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('embeds the question with the EmbeddingGemma search prefix and searches by that vector within the resort', async () => {
    knowledge.searchByVector.mockResolvedValue([document('a', 0.2)]);

    await createService().search('Qual o horário da piscina?', RESORT_ID);

    expect(embeddings.embed).toHaveBeenCalledExactlyOnceWith([
      'task: search result | query: Qual o horário da piscina?',
    ]);
    expect(knowledge.searchByVector).toHaveBeenCalledExactlyOnceWith(
      QUERY_VECTOR,
      RESORT_ID,
    );
  });

  it.each(['', '   '])(
    'rejects a missing resortId (%j) without embedding or searching',
    async (resortId) => {
      await expect(
        createService().search('spa', resortId),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(embeddings.embed).not.toHaveBeenCalled();
      expect(knowledge.searchByVector).not.toHaveBeenCalled();
    },
  );

  describe('RAG_MAX_DISTANCE', () => {
    const documents = [
      document('near', 0.3),
      document('default-edge', 0.5),
      document('edge', 0.8),
      document('far', 0.81),
      document('unknown', null),
    ];

    beforeEach(() => {
      knowledge.searchByVector.mockResolvedValue(documents);
    });

    it.each<[string, Record<string, string>]>([
      ['not configured', {}],
      ['empty', { RAG_MAX_DISTANCE: '' }],
      ['blank', { RAG_MAX_DISTANCE: '   ' }],
      ['not a number', { RAG_MAX_DISTANCE: 'abc' }],
      ['negative', { RAG_MAX_DISTANCE: '-0.1' }],
    ])('falls back to 0.5 when %s', async (_case, config) => {
      const result = await createService(config).search('spa', RESORT_ID);

      expect(result.map(({ id }) => id)).toEqual(['near', 'default-edge']);
    });

    it('drops documents above the configured distance and documents without distance', async () => {
      const result = await createService({ RAG_MAX_DISTANCE: ' 0.8 ' }).search(
        'spa',
        RESORT_ID,
      );

      expect(result.map(({ id }) => id)).toEqual(['near', 'default-edge', 'edge']);
    });
  });

  it.each<[string, number[][]]>([
    ['no embedding', []],
    ['an empty vector', [[]]],
  ])('throws BadGatewayException and skips the vector search on %s', async (_case, vectors) => {
    embeddings.embed.mockResolvedValue(vectors);

    await expect(
      createService().search('spa', RESORT_ID),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(knowledge.searchByVector).not.toHaveBeenCalled();
  });

  it('propagates embedding failures', async () => {
    embeddings.embed.mockRejectedValue(new Error('embeddings indisponíveis'));

    await expect(createService().search('spa', RESORT_ID)).rejects.toThrow(
      'embeddings indisponíveis',
    );
  });
});
