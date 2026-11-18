import { Injectable, Logger } from '@nestjs/common';

import type { ChatAction } from '../contracts/chat-actions.js';
import { withoutPendingConfirmation, type ConversationState } from '../contracts/conversation-state.js';
import { OperationsDispatcherService } from '../operations/operations-dispatcher.service.js';

import { RetrievalService } from '../rag/retrieval.service.js';
import type { RetrievedDocument } from '../rag/knowledge.service.js';

import { normalizeText } from '../common/text.js';

import { ConversationContextService } from './conversation-context.service.js';
import { IntentClassifierService } from './intent-classifier.service.js';
import { extractDate } from './message-entities.js';
import {
  isConversationIntent,
  isExperienceIntent,
  isModuleIntent,
  type ConversationIntent,
  type HistoryEntry,
  type IntentDecision,
} from './chat-intent.types.js';

import { GuestContext } from '../guest/guest-context.js';
import { ResortClock } from '../resort/resort-clock.service.js';

export interface OrchestrationContext {
  conversationId: string;
  state: ConversationState;
  today?: string;
}

export type OrchestrationResult =
  | {
      mode: 'operations';
      reply: string;
      documents: [];
      actions?: ChatAction[];
      state?: ConversationState;
    }
  | {
      mode: 'knowledge';
      documents: RetrievedDocument[];
      state?: ConversationState;
    }
  | {
      mode: 'conversation';
      intent: ConversationIntent;
      declinesPending?: boolean;
      documents: [];
      state?: ConversationState;
    };

function topicOf(decision: IntentDecision): ConversationState['topic'] {
  if (isExperienceIntent(decision.intent)) return 'experience';
  if (decision.intent.startsWith('restaurant.')) return 'restaurant';
  if (decision.intent === 'event.list') return 'event';
  if (isModuleIntent(decision.intent)) return 'module';
  if (decision.intent.startsWith('reservation.')) return 'reservation';
  if (decision.intent.startsWith('request.')) return 'request';
  return 'knowledge';
}

function retrievalQuery(message: string, history: HistoryEntry[], state: ConversationState): string {
  const text = normalizeText(message);

  if (state.lastIntent !== 'knowledge.search' || !/^(?:e|entao|mas)\b/.test(text) || text.split(' ').length > 6) {
    return message;
  }

  const previous = [...history].reverse().find(({ role }) => role === 'user')?.content;
  return previous ? `${previous} ${message}` : message;
}

function withTopic(state: ConversationState, topic: ConversationState['topic']): ConversationState {
  const cleared = withoutPendingConfirmation(state);

  return {
    ...cleared,
    topic,
    ...(topic === 'experience' && state.experience ? { experience: state.experience } : {}),
    ...(topic === 'request' && state.request ? { request: state.request } : {}),
  };
}

@Injectable()
export class ChatOrchestratorService {
  private readonly logger = new Logger(ChatOrchestratorService.name);

  constructor(
    private readonly classifier: IntentClassifierService,
    private readonly dispatcher: OperationsDispatcherService,
    private readonly retrievalService: RetrievalService,
    private readonly context: ConversationContextService,
  ) {}

  async resolve(
    message: string,
    guest: GuestContext,
    history: HistoryEntry[] = [],
    context?: OrchestrationContext,
  ): Promise<OrchestrationResult> {
    const classified = context
      ? await this.classifier.classify(message, history, context.state)
      : await this.classifier.classify(message, history);
    const decision = context ? this.context.resolve(message, classified, context.state) : classified;

    this.logger.log(
      `Intenção identificada: ${decision.intent} (${decision.detail})`,
    );
    this.logger.debug(
      `Assunto atual: ${context?.state.topic ?? 'nenhum'} → ${isConversationIntent(decision.intent) ? 'conversa' : topicOf(decision)}` +
        `${decision.refine ? ' (refinamento)' : ''}${decision.answersPending ? ' (resposta à pergunta pendente)' : ''}`,
    );

    if (isConversationIntent(decision.intent)) {
      return {
        mode: 'conversation',
        intent: decision.intent,
        ...(decision.declinesPending ? { declinesPending: true } : {}),
        documents: [],
        ...(context ? { state: this.context.afterConversation(context.state, decision) } : {}),
      };
    }

    if (decision.intent !== 'knowledge.search') {
      const result = context
        ? await this.dispatcher.dispatch(message, decision, guest, {
            conversationId: context.conversationId,
            state: withTopic(context.state, topicOf(decision)),
          })
        : await this.dispatcher.dispatch(message, decision, guest);

      this.logger.log(`Operação concluída: ${result.tool}`);
      if (result.resultCount !== undefined) {
        this.logger.debug(`Resultados apresentados: ${result.resultCount}.`);
      }

      return {
        mode: 'operations',
        reply: result.reply,
        documents: [],
        ...(result.actions?.length ? { actions: result.actions } : {}),
        ...(context
          ? {
              state: this.context.afterOperation(
                result,
                withTopic(context.state, topicOf(decision)),
                decision.intent,
              ),
            }
          : {}),
      };
    }

    const date = context?.today
      ? (decision.entities?.date ?? extractDate(message, context.today))
      : undefined;

    const query = context ? retrievalQuery(message, history, context.state) : message;
    const documents = context
      ? await this.retrievalService.search(
          date ? `${query} (${ResortClock.describeDate(date)})` : query,
          guest.resortId,
          date ? { date } : {},
        )
      : await this.retrievalService.search(message, guest.resortId);

    if (documents.length === 0) {
      const product = await this.dispatcher.findProducts(
        message,
        guest,
        context ? { conversationId: context.conversationId, state: withTopic(context.state, 'module') } : undefined,
      );

      if (product) {
        return {
          mode: 'operations',
          reply: product.reply,
          documents: [],
          ...(product.actions?.length ? { actions: product.actions } : {}),
          ...(context ? { state: this.context.afterOperation(product, withTopic(context.state, 'module'), 'boutique.info') } : {}),
        };
      }
    }

    return {
      mode: 'knowledge',
      documents,
      ...(context
        ? { state: this.context.afterKnowledge(withTopic(context.state, 'knowledge'), decision.intent) }
        : {}),
    };
  }
}
