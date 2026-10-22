import {
  BadGatewayException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ReservationsService } from './reservations.service.js';

interface ToolCall {
  type: 'function';
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_name?: string;
}

interface OllamaResponse {
  message: OllamaMessage;
}

const TOOL_NAME = 'list_my_restaurant_reservations';

const RESERVATIONS_TOOL = {
  type: 'function',
  function: {
    name: TOOL_NAME,
    description:
      'Consulta as reservas de restaurante do hóspede atual ' +
      'diretamente no banco de dados. Use quando o hóspede ' +
      'perguntar sobre suas reservas, horários ou status.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
};

@Injectable()
export class OperationsAiService {
  private readonly logger = new Logger(OperationsAiService.name);

  constructor(
    private readonly reservationsService: ReservationsService,
    private readonly configService: ConfigService,
  ) {}

  private async chatWithOllama(
    messages: OllamaMessage[],
    tools?: (typeof RESERVATIONS_TOOL)[],
  ): Promise<OllamaResponse> {
    const baseUrl = this.configService.get<string>(
      'OLLAMA_BASE_URL',
      'http://127.0.0.1:11434',
    );

    const model = this.configService.get<string>(
      'OLLAMA_CHAT_MODEL',
      'qwen3:1.7b',
    );

    let response: Response;

    try {
      response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages,
          tools,
          stream: false,
          think: false,
          options: {
            temperature: 0.1,
          },
        }),
        signal: AbortSignal.timeout(90_000),
      });
    } catch (error) {
      this.logger.error(
        'Erro de conexão com Ollama',
        error instanceof Error ? error.stack : String(error),
      );

      throw new BadGatewayException('Não foi possível conectar ao Ollama.');
    }

    if (!response.ok) {
      const details = await response.text();

      this.logger.error(`Ollama HTTP ${response.status}: ${details}`);

      throw new BadGatewayException(
        'O Ollama não conseguiu processar a solicitação.',
      );
    }

    const data = (await response.json()) as OllamaResponse;

    if (!data.message) {
      throw new BadGatewayException('Resposta inválida recebida do Ollama.');
    }

    return data;
  }

  async ask(message: string) {
    if (this.configService.get<string>('NODE_ENV') === 'production') {
      throw new ForbiddenException('Consulta de demonstração desabilitada.');
    }

    const messages: OllamaMessage[] = [
      {
        role: 'system',
        content: [
          'Você é o concierge de um resort.',
          'Para consultar as reservas do hóspede,',
          'utilize a ferramenta list_my_restaurant_reservations.',
          'Nunca invente informações.',
        ].join(' '),
      },
      {
        role: 'user',
        content: message,
      },
    ];

    // 1. Testamos se o Qwen solicita a ferramenta.
    const firstResponse = await this.chatWithOllama(messages, [
      RESERVATIONS_TOOL,
    ]);

    const toolCalls = firstResponse.message.tool_calls ?? [];

    const toolRequestedByModel =
      toolCalls.length === 1 && toolCalls[0]?.function?.name === TOOL_NAME;

    this.logger.debug(
      `Tool Calling: ${JSON.stringify({
        requestedByModel: toolRequestedByModel,
        toolCalls,
        content: firstResponse.message.content,
      })}`,
    );

    // 2. O backend sempre consulta o MySQL
    // neste endpoint especializado.
    const reservations = await this.reservationsService.listForDemoGuest();

    this.logger.log(
      `Consulta MySQL: ${reservations.length} registros encontrados`,
    );

    // 3. Caso não existam reservas.
    if (reservations.length === 0) {
      return {
        reply: 'Não encontrei reservas de restaurante no seu cadastro.',
        toolUsed: true,
        toolRequestedByModel,
        reservationsFound: 0,
      };
    }

    // 4. Mapeia os status cadastrados no banco.
    const statusLabels: Record<string, string> = {
      confirmed: 'confirmada',
      pending: 'pendente',
      cancelled: 'cancelada',
      canceled: 'cancelada',
    };

    // 5. Formata cada reserva sem usar a LLM.
    const reservationDetails = reservations.map((reservation, index) => {
      const date = reservation.reservedAt.replace(' ', ' às ');

      const peopleLabel = reservation.partySize === 1 ? 'pessoa' : 'pessoas';

      const status =
        statusLabels[reservation.status.toLowerCase()] ?? reservation.status;

      return [
        `${index + 1}. ${reservation.restaurant}`,
        `Data: ${date}`,
        `Pessoas: ${reservation.partySize} ${peopleLabel}`,
        `Status: ${status}`,
      ].join('\n');
    });

    const count = reservations.length;

    const reply = [
      `Encontrei ${count} ${
        count === 1 ? 'reserva' : 'reservas'
      } de restaurante no seu cadastro:`,
      '',
      reservationDetails.join('\n\n'),
    ].join('\n');

    return {
      reply,
      toolUsed: true,
      toolRequestedByModel,
      reservationsFound: count,
    };
  }
}
