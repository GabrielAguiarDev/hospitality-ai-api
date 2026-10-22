import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import {
  KnowledgeService,
  type KnowledgeDocument,
} from './knowledge.service.js';

export interface SyncResult {
  createdOrUpdated: number;
  unchanged: number;
  removed: number;
}

@Injectable()
export class KnowledgeIngestionService {
  private readonly logger = new Logger(KnowledgeIngestionService.name);

  private readonly source = 'mysql-resort-knowledge';

  constructor(
    private readonly dataSource: DataSource,
    private readonly knowledgeService: KnowledgeService,
  ) {}

  async syncResort(resortId: string): Promise<SyncResult> {
    if (!resortId?.trim()) {
      throw new BadRequestException('resortId obrigatório na sincronização.');
    }

    // Consulta a fonte oficial deste resort.
    const documents = (await this.dataSource.query(
      `
        SELECT id, title, category, content
        FROM resort_knowledge_demo
        WHERE resort_id = ?
          AND active = TRUE
        ORDER BY id
      `,
      [resortId],
    )) as KnowledgeDocument[];

    // Recupera somente os documentos já gerenciados
    // por esta fonte e por este resort.
    const indexed = await this.knowledgeService.listIndexedHashes(
      resortId,
      this.source,
    );

    // Identifica documentos novos ou alterados.
    const changed = documents.filter((document) => {
      const currentHash = this.knowledgeService.fingerprint(document);

      return indexed.get(document.id) !== currentHash;
    });

    const createdOrUpdated = await this.knowledgeService.upsertDocuments(
      changed,
      resortId,
      this.source,
    );

    // Identifica documentos desativados ou removidos.
    const activeIds = new Set(documents.map((document) => document.id));

    const removedIds = [...indexed.keys()].filter((id) => !activeIds.has(id));

    await this.knowledgeService.deleteDocuments(
      removedIds,
      resortId,
      this.source,
    );

    const result: SyncResult = {
      createdOrUpdated,
      unchanged: documents.length - changed.length,
      removed: removedIds.length,
    };

    this.logger.log(`Resort ${resortId}: ${JSON.stringify(result)}`);

    return result;
  }

  // Preserva o contrato utilizado pelo script
  // e pelo agendador já implementados.
  async syncDemo(): Promise<SyncResult> {
    return this.syncResort('demo');
  }
}
