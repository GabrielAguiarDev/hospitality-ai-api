
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
import { ResortClock } from '../resort/resort-clock.service.js';
import { RESORT_SNAPSHOT_SOURCE } from './sources/knowledge-source.js';

export interface RetrievalOptions {
  // Data absoluta (YYYY-MM-DD) citada na pergunta ("hoje", "sábado").
  date?: string;
}

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
    options: RetrievalOptions = {},
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

    const relevant = documents.filter(
      (document) =>
        document.distance !== null &&
        document.distance <= maxDistance,
    );

    if (!options.date || !ResortClock.isIsoDate(options.date)) {
      return relevant;
    }

    // Perguntas datadas: inclui a programação e os eventos daquele dia,
    // que a busca semântica sozinha não distingue de outros dias.
    const dated = await this.knowledgeService.getDocuments(
      [
        `eventos:${options.date}`,
        `lazer:programacao:${ResortClock.weekdayKey(options.date)}`,
      ],
      resortId,
      RESORT_SNAPSHOT_SOURCE,
    );

    const datedIds = new Set(dated.map(({ id }) => id));

    // Remove documentos de outras datas para não misturar dias.
    const otherDays = (id: string) =>
      /^(?:eventos:\d{4}-\d{2}-\d{2}|lazer:programacao:)/.test(id) && !datedIds.has(id);

    return [
      ...dated,
      ...relevant.filter(({ id }) => !datedIds.has(id) && !otherDays(id)),
    ];
  }
}
