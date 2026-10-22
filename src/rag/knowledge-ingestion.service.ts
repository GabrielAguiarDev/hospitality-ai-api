
import { Injectable, Logger } from '@nestjs/common';
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
  private readonly logger = new Logger(
    KnowledgeIngestionService.name,
  );

  private readonly source = 'mysql-demo';

  constructor(
    private readonly dataSource: DataSource,
    private readonly knowledgeService: KnowledgeService,
  ) {}

  async syncDemo(): Promise<SyncResult> {
    // 1. Busca o conhecimento ativo no MySQL.
    const documents = (await this.dataSource.query(
      `
        SELECT id, title, category, content
        FROM resort_knowledge_demo
        WHERE resort_id = ?
          AND active = TRUE
        ORDER BY id
      `,
      ['demo'],
    )) as KnowledgeDocument[];

    // Evita apagar o índice inteiro por acidente.
    if (documents.length === 0) {
      throw new Error(
        'Nenhum documento ativo encontrado. ' +
        'Sincronização interrompida por segurança.',
      );
    }

    // 2. Recupera os hashes já indexados.
    const indexed = await this.knowledgeService
      .listIndexedHashes(this.source);

    // 3. Identifica documentos novos ou alterados.
    const changed = documents.filter((document) => {
      const currentHash =
        this.knowledgeService.fingerprint(document);

      const indexedHash = indexed.get(document.id);

      return currentHash !== indexedHash;
    });

    // 4. Indexa somente documentos modificados.
    const createdOrUpdated =
      await this.knowledgeService.upsertDocuments(
        changed,
        this.source,
      );

    // 5. Identifica documentos que deixaram de existir
    // ou não estão mais ativos no MySQL.
    const activeIds = new Set(
      documents.map((document) => document.id),
    );

    const removedIds = [...indexed.keys()].filter(
      (id) => !activeIds.has(id),
    );

    // 6. Remove documentos obsoletos.
    await this.knowledgeService.deleteDocuments(
      removedIds,
    );

    const result: SyncResult = {
      createdOrUpdated,
      unchanged: documents.length - changed.length,
      removed: removedIds.length,
    };

    this.logger.log(
      `Sincronização concluída: ${JSON.stringify(result)}`,
    );

    return result;
  }
}
