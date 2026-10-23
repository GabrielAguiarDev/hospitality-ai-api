import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import { KnowledgeIngestionService } from './knowledge-ingestion.service.js';
import type { KnowledgeDocument, KnowledgeService } from './knowledge.service.js';
import { enabledKnowledgeSources, type KnowledgeSource } from './sources/knowledge-source.js';
import type { LegacyDemoKnowledgeSource } from './sources/legacy-demo.source.js';
import type { ResortSnapshotKnowledgeSource } from './sources/resort-snapshot.source.js';

const document = (id: string, content = `c-${id}`): KnowledgeDocument => ({
  id,
  title: `t-${id}`,
  content,
  category: 'x',
});

describe('enabledKnowledgeSources', () => {
  it('defaults to resort-snapshot only', () => {
    expect(enabledKnowledgeSources(undefined)).toEqual(['resort-snapshot']);
    expect(enabledKnowledgeSources('')).toEqual(['resort-snapshot']);
    expect(enabledKnowledgeSources(' , ')).toEqual(['resort-snapshot']);
  });

  it('parses, trims and dedupes', () => {
    expect(enabledKnowledgeSources(' a, b ,a')).toEqual(['a', 'b']);
  });
});

describe('KnowledgeIngestionService', () => {
  const knowledge = {
    // hash is deterministic and content-based
    fingerprint: vi.fn((d: KnowledgeDocument) => `h:${d.content}`),
    listIndexedHashes: vi.fn(),
    upsertDocuments: vi.fn(),
    deleteDocuments: vi.fn(),
  };
  const snapshotLoad = vi.fn();
  const legacyLoad = vi.fn();
  let config: Record<string, string | undefined>;

  function build() {
    return new KnowledgeIngestionService(
      knowledge as unknown as KnowledgeService,
      { get: (key: string) => config[key] } as unknown as ConfigService,
      { name: 'resort-snapshot', load: snapshotLoad } as unknown as ResortSnapshotKnowledgeSource,
      { name: 'mysql-resort-knowledge', load: legacyLoad } as unknown as LegacyDemoKnowledgeSource,
    );
  }

  beforeEach(() => {
    config = { RESORT_ID: 'demo' };
    knowledge.listIndexedHashes.mockReset().mockResolvedValue(new Map());
    knowledge.upsertDocuments.mockReset().mockImplementation(async (docs: unknown[]) => docs.length);
    knowledge.deleteDocuments.mockReset().mockResolvedValue(undefined);
    snapshotLoad.mockReset().mockResolvedValue([]);
    legacyLoad.mockReset().mockResolvedValue([]);
  });

  it('rejects an empty resortId without touching sources', async () => {
    const service = build();
    await expect(service.syncResort('')).rejects.toThrow(BadRequestException);
    await expect(service.syncResort('   ')).rejects.toThrow(BadRequestException);
    expect(snapshotLoad).not.toHaveBeenCalled();
    expect(knowledge.upsertDocuments).not.toHaveBeenCalled();
  });

  it('syncs only the snapshot source by default', async () => {
    snapshotLoad.mockResolvedValue([document('a')]);

    const result = await build().syncResort('demo');

    expect(snapshotLoad).toHaveBeenCalledWith('demo');
    expect(legacyLoad).not.toHaveBeenCalled();
    expect(Object.keys(result.sources!)).toEqual(['resort-snapshot']);
  });

  it('syncs legacy when enabled via KNOWLEDGE_SOURCES, and ignores unknown names', async () => {
    config.KNOWLEDGE_SOURCES = 'resort-snapshot,mysql-resort-knowledge,bogus';
    snapshotLoad.mockResolvedValue([document('a')]);
    legacyLoad.mockResolvedValue([document('b'), document('c')]);

    const result = await build().syncResort('demo');

    expect(Object.keys(result.sources!)).toEqual(['resort-snapshot', 'mysql-resort-knowledge']);
    expect(result.createdOrUpdated).toBe(3);
  });

  it('only legacy when only legacy is enabled', async () => {
    config.KNOWLEDGE_SOURCES = 'mysql-resort-knowledge';
    await build().syncResort('demo');
    expect(snapshotLoad).not.toHaveBeenCalled();
    expect(legacyLoad).toHaveBeenCalledWith('demo');
  });

  it('skips unchanged documents and upserts changed or new ones', async () => {
    snapshotLoad.mockResolvedValue([document('same'), document('changed', 'new'), document('fresh')]);
    knowledge.listIndexedHashes.mockResolvedValue(
      new Map([
        ['same', 'h:c-same'],
        ['changed', 'h:old'],
      ]),
    );

    const result = await build().syncResort('demo');

    expect(knowledge.listIndexedHashes).toHaveBeenCalledWith('demo', 'resort-snapshot');
    const [docs, resortId, source] = knowledge.upsertDocuments.mock.calls[0];
    expect((docs as KnowledgeDocument[]).map((d) => d.id)).toEqual(['changed', 'fresh']);
    expect(resortId).toBe('demo');
    expect(source).toBe('resort-snapshot');
    expect(result).toMatchObject({ createdOrUpdated: 2, unchanged: 1, removed: 0 });
  });

  it('deletes stale ids scoped by resortId and source', async () => {
    snapshotLoad.mockResolvedValue([document('keep')]);
    knowledge.listIndexedHashes.mockResolvedValue(
      new Map([
        ['keep', 'h:c-keep'],
        ['gone1', 'x'],
        ['gone2', 'y'],
      ]),
    );

    const result = await build().syncResort('demo');

    expect(knowledge.deleteDocuments).toHaveBeenCalledWith(['gone1', 'gone2'], 'demo', 'resort-snapshot');
    expect(result.removed).toBe(2);
    expect(result.unchanged).toBe(1);
  });

  it('an empty source load removes everything previously indexed for that source only', async () => {
    snapshotLoad.mockResolvedValue([]);
    knowledge.listIndexedHashes.mockResolvedValue(new Map([['a', 'x']]));

    await build().syncResort('demo');

    expect(knowledge.deleteDocuments).toHaveBeenCalledWith(['a'], 'demo', 'resort-snapshot');
    expect(legacyLoad).not.toHaveBeenCalled();
  });

  it('aggregates results per source', async () => {
    config.KNOWLEDGE_SOURCES = 'resort-snapshot,mysql-resort-knowledge';
    snapshotLoad.mockResolvedValue([document('a'), document('b')]);
    legacyLoad.mockResolvedValue([document('l1')]);
    knowledge.listIndexedHashes.mockImplementation(async (_resort: string, source: string) =>
      source === 'resort-snapshot' ? new Map([['a', 'h:c-a'], ['old', 'z']]) : new Map(),
    );

    const result = await build().syncResort('demo');

    expect(result.sources).toEqual({
      'resort-snapshot': { createdOrUpdated: 1, unchanged: 1, removed: 1 },
      'mysql-resort-knowledge': { createdOrUpdated: 1, unchanged: 0, removed: 0 },
    });
    expect(result).toMatchObject({ createdOrUpdated: 2, unchanged: 1, removed: 1 });
  });

  it('syncSource works with an arbitrary source', async () => {
    const source: KnowledgeSource = { name: 'custom', load: vi.fn().mockResolvedValue([document('z')]) };
    const result = await build().syncSource('demo', source);
    expect(result).toEqual({ createdOrUpdated: 1, unchanged: 0, removed: 0 });
    expect(knowledge.upsertDocuments.mock.calls[0][2]).toBe('custom');
  });

  it('syncDemo uses RESORT_ID and fails when it is missing', async () => {
    await build().syncDemo();
    expect(snapshotLoad).toHaveBeenCalledWith('demo');

    config.RESORT_ID = undefined;
    await expect(build().syncDemo()).rejects.toThrow(InternalServerErrorException);
  });

  it('propagates source and store failures', async () => {
    snapshotLoad.mockImplementation(async () => {
      throw new Error('mysql down');
    });
    await expect(build().syncResort('demo')).rejects.toThrow('mysql down');

    snapshotLoad.mockResolvedValue([document('a')]);
    knowledge.upsertDocuments.mockImplementation(async () => {
      throw new Error('chroma down');
    });
    await expect(build().syncResort('demo')).rejects.toThrow('chroma down');
    expect(knowledge.deleteDocuments).not.toHaveBeenCalled();
  });
});
