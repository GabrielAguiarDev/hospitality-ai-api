import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { KnowledgeDocument } from '../knowledge.service.js';

import { LEGACY_DEMO_SOURCE, type KnowledgeSource } from './knowledge-source.js';

@Injectable()
export class LegacyDemoKnowledgeSource implements KnowledgeSource {
  readonly name = LEGACY_DEMO_SOURCE;

  constructor(private readonly dataSource: DataSource) {}

  async load(resortId: string): Promise<KnowledgeDocument[]> {
    return (await this.dataSource.query(
      `
        SELECT id, title, category, content
        FROM resort_knowledge_demo
        WHERE resort_id = ?
          AND active = TRUE
        ORDER BY id
      `,
      [resortId],
    )) as KnowledgeDocument[];
  }
}
