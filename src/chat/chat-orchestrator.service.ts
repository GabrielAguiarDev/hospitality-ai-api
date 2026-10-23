import { Injectable, Logger } from '@nestjs/common';

import type { ChatAction } from '../contracts/chat-actions.js';
import type { ConversationState } from '../contracts/conversation-state.js';
import { OperationsDispatcherService } from '../operations/operations-dispatcher.service.js';

import { RetrievalService } from '../rag/retrieval.service.js';
import type { RetrievedDocument } from '../rag/knowledge.service.js';

import { IntentClassifierService } from './intent-classifier.service.js';
import { extractDate } from './message-entities.js';
import {
  isExperienceIntent,
  type HistoryEntry,
  type IntentDecision,
} from './chat-intent.types.js';

import { GuestContext } from '../guest/guest-context.js';
import { ResortClock } from '../resort/resort-clock.service.js';

export interface OrchestrationContext {
  conversationId: string;
  state: ConversationState;
  // Data atual no resort (YYYY-MM-DD).
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
    };

function topicOf(decision: IntentDecision): ConversationState['topic'] {
  if (isExperienceIntent(decision.intent)) return 'experience';
  if (decision.intent === 'restaurant.booking') return 'restaurant';
  if (decision.intent.startsWith('reservation.')) return 'reservation';
  if (decision.intent.startsWith('request.')) return 'request';
  return 'knowledge';
}

/**
 * Muda o assunto sem perder a experiência selecionada, mas
 * descarta a confirmação por texto de uma pré-reserva pendente.
 */
function withTopic(state: ConversationState, topic: ConversationState['topic']): ConversationState {
  return {
    ...state,
    topic,
    ...(state.experience
      ? { experience: { ...state.experience, pendingPreviewId: undefined } }
      : {}),
  };
}

@Injectable()
export class ChatOrchestratorService {
  private readonly logger = new Logger(ChatOrchestratorService.name);

  constructor(
    private readonly classifier: IntentClassifierService,
    private readonly dispatcher: OperationsDispatcherService,
    private readonly retrievalService: RetrievalService,
  ) {}

  async resolve(
    message: string,
    guest: GuestContext,
    history: HistoryEntry[] = [],
    context?: OrchestrationContext,
  ): Promise<OrchestrationResult> {
    const decision = context
      ? await this.classifier.classify(message, history, context.state)
      : await this.classifier.classify(message, history);

    this.logger.log(
      `Intenção identificada: ${decision.intent} (${decision.detail})`,
    );

    // 1. Todas as operações passam pelo Dispatcher.
    if (decision.intent !== 'knowledge.search') {
      const result = context
        ? await this.dispatcher.dispatch(message, decision, guest, {
            conversationId: context.conversationId,
            state: context.state,
          })
        : await this.dispatcher.dispatch(message, decision, guest);

      this.logger.log(`Operação concluída: ${result.tool}`);

      return {
        mode: 'operations',
        reply: result.reply,
        documents: [],
        ...(result.actions?.length ? { actions: result.actions } : {}),
        ...(context
          ? { state: result.state ?? withTopic(context.state, topicOf(decision)) }
          : {}),
      };
    }

    // 2. Consultas de conhecimento continuam no RAG. Datas relativas
    // são convertidas para datas absolutas antes da busca.
    const date = context?.today
      ? (decision.entities?.date ?? extractDate(message, context.today))
      : undefined;

    const documents = context
      ? await this.retrievalService.search(
          date ? `${message} (${ResortClock.describeDate(date)})` : message,
          guest.resortId,
          date ? { date } : {},
        )
      : await this.retrievalService.search(message, guest.resortId);

    return {
      mode: 'knowledge',
      documents,
      ...(context ? { state: withTopic(context.state, 'knowledge') } : {}),
    };
  }
}
