
import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { llmSettings } from '../llm/llm-config.js';

interface OllamaEmbedResponse {
  embeddings?: number[][];
}

@Injectable()
export class EmbeddingsService {
  constructor(
    private readonly configService: ConfigService,
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const { baseUrl, embedModel: model, embedKeepAlive } = llmSettings((key) => this.configService.get<string>(key));

    let response: Response;

    try {
      response = await fetch(`${baseUrl}/api/embed`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(180_000),
        body: JSON.stringify({
          model,
          input: texts,
          keep_alive: embedKeepAlive,
          truncate: false,
        }),
      });
    } catch {
      throw new ServiceUnavailableException(
        'Não foi possível conectar ao modelo de embeddings',
      );
    }

    if (!response.ok) {
      throw new BadGatewayException(
        `Falha ao gerar embeddings: HTTP ${response.status}`,
      );
    }

    const data =
      (await response.json()) as OllamaEmbedResponse;

    if (
      !Array.isArray(data.embeddings) ||
      data.embeddings.length !== texts.length ||
      data.embeddings.some(
        (vector) =>
          !Array.isArray(vector) ||
          vector.length === 0 ||
          !vector.every(Number.isFinite),
      )
    ) {
      throw new BadGatewayException(
        'O modelo retornou embeddings inválidos',
      );
    }

    return data.embeddings;
  }
}
