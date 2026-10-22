import { ConfigService } from '@nestjs/config';

import { EmbeddingsService } from './embeddings.service.js';
import { KnowledgeService } from './knowledge.service.js';
import type { RetrievedDocument } from './knowledge.service.js';
import { RetrievalService } from './retrieval.service.js';

const QUERY_VECTOR = [0.1, 0.2, 0.3];

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
      new ConfigService({ RAG_MAX_DISTANCE: '', ...config }),
    );
  }

  beforeEach(() => {
    embeddings.embed.mockResolvedValue([QUERY_VECTOR]);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('embeds the question with the EmbeddingGemma search prefix and searches by that vector', async () => {
    knowledge.searchByVector.mockResolvedValue([document('a', 0.2)]);

    await createService().search('Qual o horário da piscina?');

    expect(embeddings.embed).toHaveBeenCalledExactlyOnceWith([
      'task: search result | query: Qual o horário da piscina?',
    ]);
    expect(knowledge.searchByVector).toHaveBeenCalledExactlyOnceWith(QUERY_VECTOR);
  });

  it('returns all documents when RAG_MAX_DISTANCE is not configured', async () => {
    const documents = [document('a', 0.2), document('b', 1.4), document('c', null)];
    knowledge.searchByVector.mockResolvedValue(documents);

    await expect(createService().search('spa')).resolves.toEqual(documents);
  });

  it('drops documents above RAG_MAX_DISTANCE and documents without distance', async () => {
    knowledge.searchByVector.mockResolvedValue([
      document('near', 0.3),
      document('edge', 0.8),
      document('far', 0.81),
      document('unknown', null),
    ]);

    const result = await createService({ RAG_MAX_DISTANCE: ' 0.8 ' }).search('spa');

    expect(result.map(({ id }) => id)).toEqual(['near', 'edge']);
  });

  it.each(['abc', '-0.1', '2.5'])(
    'rejects an invalid RAG_MAX_DISTANCE (%s)',
    async (value) => {
      knowledge.searchByVector.mockResolvedValue([document('a', 0.2)]);

      await expect(
        createService({ RAG_MAX_DISTANCE: value }).search('spa'),
      ).rejects.toThrow('RAG_MAX_DISTANCE deve ser um número entre 0 e 2');
    },
  );

  it('returns no documents and skips the vector search when no embedding is produced', async () => {
    embeddings.embed.mockResolvedValue([]);

    await expect(createService().search('spa')).resolves.toEqual([]);
    expect(knowledge.searchByVector).not.toHaveBeenCalled();
  });

  it('propagates embedding failures', async () => {
    embeddings.embed.mockRejectedValue(new Error('embeddings indisponíveis'));

    await expect(createService().search('spa')).rejects.toThrow(
      'embeddings indisponíveis',
    );
  });
});
