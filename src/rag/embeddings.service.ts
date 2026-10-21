
import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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

    const baseUrl = this.configService.get<string>(
      'OLLAMA_URL',
      'http://127.0.0.1:11434',
    );

    const model = this.configService.get<string>(
      'OLLAMA_EMBED_MODEL',
      'embeddinggemma:300m-qat-q4_0',
    );

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
          keep_alive: 0,
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
