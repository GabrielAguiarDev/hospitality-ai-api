
import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { EmbeddingsService } from './embeddings.service.js';
import {
  KnowledgeService,
  type RetrievedDocument,
} from './knowledge.service.js';

@Injectable()
export class RetrievalService {
  constructor(
    private readonly embeddingsService: EmbeddingsService,
    private readonly knowledgeService: KnowledgeService,
    private readonly configService: ConfigService,
  ) {}

  async search(
    question: string,
    resortId: string,
  ): Promise<RetrievedDocument[]> {
    if (!resortId?.trim()) {
      throw new BadRequestException(
        'resortId obrigatório na busca RAG.',
      );
    }

    const embeddings =
      await this.embeddingsService.embed([
        `task: search result | query: ${question}`,
      ]);

    const vector = embeddings[0];

    if (!vector?.length) {
      throw new BadGatewayException(
        'O Ollama não retornou um embedding válido.',
      );
    }

    const documents =
      await this.knowledgeService.searchByVector(
        vector,
        resortId,
      );

    // Valor vazio usa o padrão; Number('') seria 0
    // e descartaria todos os documentos.
    const rawDistance = this.configService
      .get<string>('RAG_MAX_DISTANCE')
      ?.trim();

    const configuredDistance = rawDistance
      ? Number(rawDistance)
      : Number.NaN;

    const maxDistance =
      Number.isFinite(configuredDistance) &&
      configuredDistance >= 0
        ? configuredDistance
        : 0.5;

    return documents.filter(
      (document) =>
        document.distance !== null &&
        document.distance <= maxDistance,
    );
  }
}
