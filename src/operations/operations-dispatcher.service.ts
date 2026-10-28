import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import {
  isConversationIntent,
  isExperienceIntent,
  isModuleIntent,
  isRequestIntent,
  isRestaurantIntent,
  type IntentDecision,
} from '../chat/chat-intent.types.js';

import { EventOperationsService } from './event-operations.service.js';
import { ExperienceOperationsService } from './experience-operations.service.js';
import { GuestOperationsService } from './guest-operations.service.js';
import { INTENT_TOOL_MAP } from './intent-tool-map.js';
import { ModuleOperationsService } from './module-operations.service.js';
import { OperationsAiService } from './operations-ai.service.js';
import { RequestsOperationsService } from './requests-operations.service.js';
import { RestaurantOperationsService } from './restaurant-operations.service.js';

import type { DispatchContext, DispatchResult } from './operations.types.js';
import { GuestContext } from '../guest/guest-context.js';

export type { DispatchContext, DispatchResult } from './operations.types.js';

@Injectable()
export class OperationsDispatcherService {
  private readonly logger = new Logger(OperationsDispatcherService.name);

  constructor(
    private readonly operationsAiService: OperationsAiService,
    private readonly requestsOperationsService: RequestsOperationsService,
    private readonly experienceOperationsService: ExperienceOperationsService,
    private readonly restaurantOperationsService: RestaurantOperationsService,
    private readonly eventOperationsService: EventOperationsService,
    private readonly moduleOperationsService: ModuleOperationsService,
    private readonly guestOperationsService: GuestOperationsService,
  ) {}

  /** Produto da Boutique citado numa pergunta que o RAG não respondeu. */
  findProducts(message: string, guest: GuestContext, context?: DispatchContext): Promise<DispatchResult | null> {
    return this.moduleOperationsService.findProducts(message, guest, context);
  }

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

    // Minhas Reservas (restaurantes e experiências) em uma lista só.
    if (decision.intent === 'reservation.list') {
      return this.guestOperationsService.bookings(message, decision, guest, context);
    }

    if (decision.intent === 'favorite.list' || decision.intent === 'favorite.manage') {
      return this.guestOperationsService.favorites(message, decision, guest, context);
    }

    if (decision.intent === 'leisure.enroll') {
      return this.eventOperationsService.enroll(guest, context ?? { conversationId: '', state: {} });
    }

    if (isRestaurantIntent(decision.intent)) {
      // Sem a conversa, a reserva só é encaminhada; o catálogo usa um estado vazio.
      if (!context && decision.intent === 'restaurant.booking') {
        return this.restaurantOperationsService.handleBooking(message, guest);
      }

      return this.restaurantOperationsService.handle(
        message,
        { ...decision, intent: decision.intent },
        guest,
        context ?? { conversationId: '', state: {} },
      );
    }

    if (isRequestIntent(decision.intent)) {
      // A escrita simulada exige a conversa; o handler recusa sem ela.
      return this.requestsOperationsService.handle(message, { ...decision, intent: decision.intent }, guest, context);
    }

    if (isModuleIntent(decision.intent)) {
      return this.moduleOperationsService.handle(message, { ...decision, intent: decision.intent }, guest, context);
    }

    if (decision.intent === 'event.list') {
      return this.eventOperationsService.handle(message, decision, guest, context ?? { conversationId: '', state: {} });
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

    if (tool !== 'reservations.list') {
      throw new BadRequestException(
        'Combinação de intenção e ferramenta inválida.',
      );
    }

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
}
