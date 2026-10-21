
import {
  Injectable,
  Logger,
  BadGatewayException,
  GatewayTimeoutException,
  ServiceUnavailableException,
} from '@nestjs/common';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OllamaChatResponse {
  message?: {
    role: string;
    content: string;
  };
}

@Injectable()
export class OllamaService {
  private readonly logger = new Logger(OllamaService.name);

  private readonly baseUrl =
    process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';

  private readonly model =
    process.env.OLLAMA_MODEL ?? 'qwen3:1.7b';

  async generate(messages: LlmMessage[]): Promise<string> {
    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(120_000),
        body: JSON.stringify({
          model: this.model,
          stream: false,
          think: false,
          messages,
          options: {
            num_ctx: 4096,
            num_predict: 256,
          },
        }),
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === 'TimeoutError'
      ) {
        throw new GatewayTimeoutException(
          'O modelo demorou para responder',
        );
      }

      this.logger.error(
        'Falha de conexão com o Ollama',
        error instanceof Error ? error.stack : String(error),
      );

      throw new ServiceUnavailableException(
        'Não foi possível conectar ao Ollama',
      );
    }

    if (!response.ok) {
      const details = await response.text();

      this.logger.error(
        `Ollama retornou HTTP ${response.status}: ${details}`,
      );

      throw new BadGatewayException(
        'O Ollama não conseguiu processar a mensagem',
      );
    }

    let data: OllamaChatResponse;

    try {
      data = (await response.json()) as OllamaChatResponse;
    } catch {
      throw new BadGatewayException(
        'O Ollama retornou uma resposta inválida',
      );
    }

    const content = data.message?.content;

    if (typeof content !== 'string' || !content.trim()) {
      throw new BadGatewayException(
        'O Ollama retornou uma resposta vazia',
      );
    }

    return content.trim();
  }
}
