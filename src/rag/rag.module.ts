
import { Module } from '@nestjs/common';

import { EmbeddingsService } from './embeddings.service.js';
import { KnowledgeService } from './knowledge.service.js';
import { RetrievalService } from './retrieval.service.js';

@Module({
  providers: [
    EmbeddingsService,
    KnowledgeService,
    RetrievalService,
  ],
  exports: [
    KnowledgeService,
    RetrievalService,
  ],
})
export class RagModule {}
