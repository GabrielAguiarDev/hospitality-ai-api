
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { EmbeddingsService } from './embeddings.service.js';
import { KnowledgeService } from './knowledge.service.js';
import type { RetrievedDocument } from './knowledge.service.js';

@Injectable()
export class RetrievalService {
  constructor(
    private readonly embeddingsService: EmbeddingsService,
    private readonly knowledgeService: KnowledgeService,
    private readonly configService: ConfigService,
  ) {}

  async search(
    question: string,
  ): Promise<RetrievedDocument[]> {
    const [queryEmbedding] =
      await this.embeddingsService.embed([
        `task: search result | query: ${question}`,
      ]);

    if (!queryEmbedding) {
      return [];
    }

    // Busca documentos semanticamente semelhantes.
    const documents =
      await this.knowledgeService.searchByVector(
        queryEmbedding,
      );

    // O limite é opcional durante a calibração.
    const configuredDistance = this.configService
      .get<string>('RAG_MAX_DISTANCE')
      ?.trim();

    if (!configuredDistance) {
      return documents;
    }

    const maxDistance = Number(configuredDistance);

    if (
      !Number.isFinite(maxDistance) ||
      maxDistance < 0 ||
      maxDistance > 2
    ) {
      throw new Error(
        'RAG_MAX_DISTANCE deve ser um número entre 0 e 2',
      );
    }

    // Descarta documentos com distância elevada.
    return documents.filter((document) => {
      if (document.distance === null) {
        return false;
      }

      return document.distance <= maxDistance;
    });
  }
}
