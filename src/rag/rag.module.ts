
import { Module } from '@nestjs/common';

import { EmbeddingsService } from './embeddings.service.js';
import { KnowledgeService } from './knowledge.service.js';
import { RetrievalService } from './retrieval.service.js';
import { KnowledgeIngestionService } from './knowledge-ingestion.service.js';
import { KnowledgeSyncScheduler } from './knowledge-sync.scheduler.js';
import { LegacyDemoKnowledgeSource } from './sources/legacy-demo.source.js';
import { ResortSnapshotKnowledgeSource } from './sources/resort-snapshot.source.js';
import { ExperiencesModule } from '../experiences/experiences.module.js';
import { ResortModule } from '../resort/resort.module.js';

@Module({
  imports: [ResortModule, ExperiencesModule],
  providers: [
    ResortSnapshotKnowledgeSource,
    LegacyDemoKnowledgeSource,
    EmbeddingsService,
    KnowledgeService,
    RetrievalService,
    KnowledgeIngestionService,
    KnowledgeSyncScheduler,
  ],
  exports: [
    KnowledgeService,
    RetrievalService,
    KnowledgeIngestionService,
    KnowledgeSyncScheduler,
  ],
})
export class RagModule {}
