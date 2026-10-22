
import { Module } from '@nestjs/common';

import { EmbeddingsService } from './embeddings.service.js';
import { KnowledgeService } from './knowledge.service.js';
import { RetrievalService } from './retrieval.service.js';
import { KnowledgeIngestionService } from './knowledge-ingestion.service.js';
import { KnowledgeSyncScheduler } from './knowledge-sync.scheduler.js';

@Module({
  providers: [
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
