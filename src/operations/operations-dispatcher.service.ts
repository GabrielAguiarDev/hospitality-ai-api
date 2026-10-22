import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import type { ChatIntent, IntentDecision } from '../chat/chat-intent.types.js';

import { OperationsAiService } from './operations-ai.service.js';
import { RequestsOperationsService } from './requests-operations.service.js';

import type { OperationToolName } from './operations-tool-registry.service.js';
import { GuestContext } from '../guest/guest-context.js';

type OperationalIntent = Exclude<ChatIntent, 'knowledge.search'>;

interface DispatchResult {
  tool: OperationToolName;
  reply: string;
}

// Mapeamento centralizado entre intenções e ferramentas.
const INTENT_TOOL_MAP = {
  'reservation.list': 'reservations.list',
  'reservation.details': 'reservations.list',
  'reservation.status': 'reservations.list',

  'request.list': 'requests.list',
  'request.status': 'requests.list',
} as const satisfies Record<OperationalIntent, OperationToolName>;

@Injectable()
export class OperationsDispatcherService {
  private readonly logger = new Logger(OperationsDispatcherService.name);

  constructor(
    private readonly operationsAiService: OperationsAiService,
    private readonly requestsOperationsService: RequestsOperationsService,
  ) {}

  async dispatch(
    message: string,
    decision: IntentDecision,
    guest: GuestContext,
  ): Promise<DispatchResult> {
    if (decision.intent === 'knowledge.search') {
      throw new BadRequestException(
        'Intenções de conhecimento não são operações.',
      );
    }

    const tool = INTENT_TOOL_MAP[decision.intent];

    this.logger.log(`Intenção: ${decision.intent} → Ferramenta: ${tool}`);

    if (tool === 'reservations.list') {
      const result = await this.operationsAiService.ask(
        message,
        guest,
        decision,
      );

      return {
        tool,
        reply: result.reply,
      };
    }

    if (
      decision.intent !== 'request.list' &&
      decision.intent !== 'request.status'
    ) {
      throw new BadRequestException(
        'Combinação de intenção e ferramenta inválida.',
      );
    }

    const reply = await this.requestsOperationsService.ask(
      message,
      decision.intent,
      guest,
    );

    return {
      tool,
      reply,
    };
  }
}
