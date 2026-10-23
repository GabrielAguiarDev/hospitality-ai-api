import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import {
  isConversationIntent,
  isExperienceIntent,
  type ChatIntent,
  type ConversationIntent,
  type IntentDecision,
} from '../chat/chat-intent.types.js';

import { ExperienceOperationsService } from './experience-operations.service.js';
import { OperationsAiService } from './operations-ai.service.js';
import { RequestsOperationsService } from './requests-operations.service.js';
import { RestaurantOperationsService } from './restaurant-operations.service.js';

import type { OperationToolName } from './operations-tool-registry.service.js';
import type { DispatchContext, DispatchResult } from './operations.types.js';
import { GuestContext } from '../guest/guest-context.js';

export type { DispatchContext, DispatchResult } from './operations.types.js';

type OperationalIntent = Exclude<ChatIntent, 'knowledge.search' | ConversationIntent>;

// Mapeamento centralizado entre intenções e ferramentas.
const INTENT_TOOL_MAP = {
  'reservation.list': 'reservations.list',
  'reservation.details': 'reservations.list',
  'reservation.status': 'reservations.list',

  'request.list': 'requests.list',
  'request.status': 'requests.list',

  'restaurant.booking': 'restaurants.list',

  'experience.list': 'experiences.list',
  'experience.details': 'experiences.details',
  'experience.availability': 'experiences.availability',
  'experience.price': 'experiences.details',
  'experience.booking': 'experiences.booking.preview',
  'experience.booking.confirm': 'experiences.booking.confirm',
  'experience.booking.cancel': 'experiences.booking.cancel',
  'experience.reservations': 'experiences.reservations',
} as const satisfies Record<OperationalIntent, OperationToolName>;

@Injectable()
export class OperationsDispatcherService {
  private readonly logger = new Logger(OperationsDispatcherService.name);

  constructor(
    private readonly operationsAiService: OperationsAiService,
    private readonly requestsOperationsService: RequestsOperationsService,
    private readonly experienceOperationsService: ExperienceOperationsService,
    private readonly restaurantOperationsService: RestaurantOperationsService,
  ) {}

  async dispatch(
    message: string,
    decision: IntentDecision,
    guest: GuestContext,
    context?: DispatchContext,
  ): Promise<DispatchResult> {
    if (decision.intent === 'knowledge.search') {
      throw new BadRequestException(
        'Intenções de conhecimento não são operações.',
      );
    }

    // Conversas nunca chegam ao Tool Registry.
    if (isConversationIntent(decision.intent)) {
      throw new BadRequestException(
        'Intenções de conversa não são operações.',
      );
    }

    const tool = INTENT_TOOL_MAP[decision.intent];

    this.logger.log(`Intenção: ${decision.intent} → Ferramenta: ${tool}`);

    if (decision.intent === 'restaurant.booking') {
      return this.restaurantOperationsService.handleBooking(message, guest);
    }

    if (isExperienceIntent(decision.intent)) {
      // Operações de experiência dependem da conversa e do seu estado.
      if (!context) {
        throw new BadRequestException(
          'Operações de experiência exigem o contexto da conversa.',
        );
      }

      return this.experienceOperationsService.handle(
        message,
        { ...decision, intent: decision.intent },
        guest,
        context,
      );
    }

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
