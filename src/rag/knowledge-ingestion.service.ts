import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { requireConfiguredResortId } from '../guest/resort-config.js';

import { KnowledgeService } from './knowledge.service.js';
import { enabledKnowledgeSources, type KnowledgeSource } from './sources/knowledge-source.js';
import { LegacyDemoKnowledgeSource } from './sources/legacy-demo.source.js';
import { ResortSnapshotKnowledgeSource } from './sources/resort-snapshot.source.js';

export interface SyncResult {
  createdOrUpdated: number;
  unchanged: number;
  removed: number;
  sources?: Record<string, Omit<SyncResult, 'sources'>>;
}

@Injectable()
export class KnowledgeIngestionService {
  private readonly logger = new Logger(KnowledgeIngestionService.name);

  private readonly sources: readonly KnowledgeSource[];

  constructor(
    private readonly knowledgeService: KnowledgeService,
    private readonly configService: ConfigService,
    snapshotSource: ResortSnapshotKnowledgeSource,
    legacySource: LegacyDemoKnowledgeSource,
  ) {
    this.sources = [snapshotSource, legacySource];
  }

  private enabledSources(): KnowledgeSource[] {
    const enabled = new Set(
      enabledKnowledgeSources(this.configService.get<string>('KNOWLEDGE_SOURCES')),
    );

    return this.sources.filter((source) => enabled.has(source.name));
  }

  async syncSource(
    resortId: string,
    source: KnowledgeSource,
  ): Promise<Omit<SyncResult, 'sources'>> {
    const documents = await source.load(resortId);

    const indexed = await this.knowledgeService.listIndexedHashes(
      resortId,
      source.name,
    );

    const changed = documents.filter((document) => {
      const currentHash = this.knowledgeService.fingerprint(document);

      return indexed.get(document.id) !== currentHash;
    });

    const createdOrUpdated = await this.knowledgeService.upsertDocuments(
      changed,
      resortId,
      source.name,
    );

    const activeIds = new Set(documents.map((document) => document.id));

    const removedIds = [...indexed.keys()].filter((id) => !activeIds.has(id));

    await this.knowledgeService.deleteDocuments(
      removedIds,
      resortId,
      source.name,
    );

    return {
      createdOrUpdated,
      unchanged: documents.length - changed.length,
      removed: removedIds.length,
    };
  }

  async syncResort(resortId: string): Promise<SyncResult> {
    if (!resortId?.trim()) {
      throw new BadRequestException('resortId obrigatório na sincronização.');
    }

    const result: SyncResult = {
      createdOrUpdated: 0,
      unchanged: 0,
      removed: 0,
      sources: {},
    };

    for (const source of this.enabledSources()) {
      const sourceResult = await this.syncSource(resortId, source);

      result.createdOrUpdated += sourceResult.createdOrUpdated;
      result.unchanged += sourceResult.unchanged;
      result.removed += sourceResult.removed;
      result.sources![source.name] = sourceResult;
    }

    this.logger.log(`Resort ${resortId}: ${JSON.stringify(result)}`);

    return result;
  }

  async syncDemo(): Promise<SyncResult> {
    const resortId = requireConfiguredResortId(
      this.configService.get<string>('RESORT_ID'),
    );

    return this.syncResort(resortId);
  }
}
