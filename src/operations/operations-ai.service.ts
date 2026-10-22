import {
  BadGatewayException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { IntentDecision } from '../chat/chat-intent.types.js';
import { ReservationsService } from './reservations.service.js';
import type { RestaurantReservation } from './reservations.service.js';

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

export interface OperationsResponse {
  reply: string;
  toolUsed: boolean;
  toolRequestedByModel: boolean;
  reservationsFound: number;
}

const TOOL_NAME = 'list_my_restaurant_reservations';

const RESERVATIONS_TOOL = {
  type: 'function',
  function: {
    name: TOOL_NAME,
    description:
      'Consulta as reservas de restaurante do hóspede atual diretamente ' +
      'no banco de dados. Use quando o hóspede perguntar sobre suas reservas.',
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
    } catch (error: unknown) {
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

  async ask(
    message: string,
    decision?: IntentDecision,
  ): Promise<OperationsResponse> {
    if (this.configService.get<string>('NODE_ENV') === 'production') {
      throw new ForbiddenException('Consulta de demonstração desabilitada.');
    }

    const resolvedDecision: IntentDecision = decision ?? {
      intent: 'reservation.list',
      detail: 'none',
    };

    let toolRequestedByModel = false;

    // Quando a intenção já foi identificada pelo
    // ChatOrchestrator, não chamamos o Qwen novamente.
    if (!decision) {
      const messages: OllamaMessage[] = [
        {
          role: 'system',
          content: [
            'Você é um concierge de resort.',
            'Para consultar reservas pessoais,',
            'solicite list_my_restaurant_reservations.',
            'Não invente dados nem identificadores.',
          ].join(' '),
        },
        {
          role: 'user',
          content: message,
        },
      ];

      const firstResponse = await this.chatWithOllama(messages, [
        RESERVATIONS_TOOL,
      ]);

      const toolCalls = firstResponse.message.tool_calls ?? [];

      toolRequestedByModel =
        toolCalls.length === 1 && toolCalls[0]?.function?.name === TOOL_NAME;

      this.logger.debug(`Function Calling nativo: ${toolRequestedByModel}`);
    } else {
      this.logger.debug(
        `Operação selecionada pelo orquestrador: ${resolvedDecision.intent}`,
      );
    }

    // A consulta é controlada exclusivamente pelo NestJS.
    const reservations = await this.reservationsService.listForDemoGuest();

    // Formata a resposta conforme a intenção identificada.
    const reply = this.formatReservationReply(
      reservations,
      resolvedDecision,
      message,
    );

    this.logger.log(
      `Consulta operacional concluída: ${reservations.length} reservas`,
    );

    return {
      reply,
      toolUsed: true,
      toolRequestedByModel,
      reservationsFound: reservations.length,
    };
  }

  private formatReservationReply(
    reservations: RestaurantReservation[],
    decision: IntentDecision,
    question: string,
  ): string {
    if (reservations.length === 0) {
      return 'Não encontrei reservas de restaurante no seu cadastro.';
    }

    const statusLabels: Record<string, string> = {
      confirmed: 'confirmada',
      pending: 'pendente',
      cancelled: 'cancelada',
      canceled: 'cancelada',
    };

    const normalize = (text: string): string =>
      text
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();

    const formatStatus = (status: string): string =>
      statusLabels[status.toLowerCase()] ?? `registrada com status "${status}"`;

    // 1. Consulta geral: lista todas as reservas.
    if (decision.intent === 'reservation.list') {
      const details = reservations.map((reservation, index) => {
        const date = reservation.reservedAt.replace(' ', ' às ');

        return [
          `${index + 1}. ${reservation.restaurant}`,
          `Data: ${date}`,
          `Pessoas: ${reservation.partySize}`,
          `Status: ${formatStatus(reservation.status)}`,
        ].join('\n');
      });

      const count = reservations.length;

      return [
        `Encontrei ${count} ${
          count === 1 ? 'reserva' : 'reservas'
        } de restaurante no seu cadastro:`,
        '',
        details.join('\n\n'),
      ].join('\n');
    }

    // 2. Identifica se a pergunta cita um restaurante.
    const normalizedQuestion = normalize(question);

    const matchingReservations = reservations.filter((reservation) =>
      normalizedQuestion.includes(normalize(reservation.restaurant)),
    );

    const candidates =
      matchingReservations.length > 0 ? matchingReservations : reservations;

    // 3. Não escolhe arbitrariamente entre várias reservas.

    if (candidates.length !== 1) {
      return [
        `Encontrei ${candidates.length} reservas relacionadas à sua consulta.`,
        'De qual reserva você deseja os detalhes?',
        'Informe o restaurante ou a data.',
      ].join(' ');
    }

    const reservation = candidates[0];

    const restaurant = reservation.restaurant;
    const status = formatStatus(reservation.status);

    const [date, time] = reservation.reservedAt.split(' ');

    // 4. Consulta específica do status.
    if (decision.intent === 'reservation.status') {
      return `Sua reserva na ${restaurant} está ${status}.`;
    }

    // 5. Consulta específica de algum detalhe.
    switch (decision.detail) {
      case 'party_size': {
        const peopleLabel = reservation.partySize === 1 ? 'pessoa' : 'pessoas';

        return (
          `Sua reserva na ${restaurant} é para ` +
          `${reservation.partySize} ${peopleLabel}.`
        );
      }

      case 'date':
        return `Sua reserva na ${restaurant} ` + `está marcada para ${date}.`;

      case 'time':
        return (
          `Sua reserva na ${restaurant} ` + `está marcada para as ${time}.`
        );

      case 'restaurant':
        return `Sua reserva está cadastrada ` + `no restaurante ${restaurant}.`;

      default:
        return [
          `Sua reserva na ${restaurant}:`,
          `Data: ${date} às ${time}`,
          `Pessoas: ${reservation.partySize}`,
          `Status: ${status}`,
        ].join('\n');
    }
  }
}
