
import {
  Injectable,
  Logger,
  type OnModuleInit,
  BadGatewayException,
  GatewayTimeoutException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { chatRequest, llmOverrides, llmSettings, type ChatRequestOptions } from './llm-config.js';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OllamaChatResponse {
  message?: {
    role: string;
    content: string;
  };
  // "length": a geração parou no limite de num_predict.
  done_reason?: string;
  // Métricas do Ollama (durações em nanossegundos).
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

const ms = (nanoseconds = 0) => Math.round(nanoseconds / 1e6);

// Resposta cortada no limite de tokens: mantém só as frases completas.
export function completeSentences(content: string): string {
  const end = Math.max(...['.', '!', '?', '\n'].map((mark) => content.lastIndexOf(mark)));
  return end > content.length / 2 ? content.slice(0, end + 1).trim() : content.trim();
}

@Injectable()
export class OllamaService implements OnModuleInit {
  private readonly logger = new Logger(OllamaService.name);

  // Lido do .env na construção (OLLAMA_CHAT_MODEL, OLLAMA_BASE_URL…).
  private readonly settings = llmSettings();

  onModuleInit(): void {
    const { chatModel, classifierModel, embedModel } = this.settings;
    this.logger.log(`Modelos: respostas=${chatModel}, classificação=${classifierModel}, embeddings=${embedModel}.`);
    llmOverrides().forEach((warning) => this.logger.warn(warning));
  }

  /**
   * Carrega os modelos com o mesmo num_ctx das chamadas: a primeira
   * pergunta do hóspede não espera o carregamento (1 a 5 s).
   * Chamado pelo main.ts depois que o servidor HTTP sobe.
   */
  async warmup(): Promise<void> {
    const { baseUrl, chatModel, classifierModel, keepAlive, numCtx, warmup } = this.settings;

    if (!warmup) return;

    for (const model of new Set([chatModel, classifierModel])) {
      try {
        const response = await fetch(`${baseUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(120_000),
          body: JSON.stringify({ model, keep_alive: keepAlive, options: { num_ctx: numCtx } }),
        });
        this.logger.log(response.ok ? `Modelo ${model} carregado.` : `Pré-carregamento de ${model}: HTTP ${response.status}.`);
      } catch (error) {
        this.logger.warn(`Pré-carregamento de ${model} indisponível: ${error instanceof Error ? error.message : String(error)}.`);
      }
    }
  }

  async generate(messages: LlmMessage[], options: ChatRequestOptions = {}): Promise<string> {
    let response: Response;

    try {
      response = await fetch(`${this.settings.baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(120_000),
        body: JSON.stringify({
          ...chatRequest(this.settings, this.settings.chatModel, options),
          messages,
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

    // Recarga do modelo (load alto) ou prompt grande aparecem aqui.
    this.logger.debug(
      `Ollama: carga ${ms(data.load_duration)} ms, prompt ${data.prompt_eval_count ?? '?'} tokens em ${ms(data.prompt_eval_duration)} ms, ` +
        `resposta ${data.eval_count ?? '?'} tokens em ${ms(data.eval_duration)} ms${data.done_reason === 'length' ? ' (limite atingido)' : ''}.`,
    );

    return data.done_reason === 'length' ? completeSentences(content) : content.trim();
  }
}
