import { Injectable, Logger } from '@nestjs/common';

import { OperationsDispatcherService } from '../operations/operations-dispatcher.service.js';

import { RetrievalService } from '../rag/retrieval.service.js';
import type { RetrievedDocument } from '../rag/knowledge.service.js';

import { IntentClassifierService } from './intent-classifier.service.js';
import type { HistoryEntry } from './chat-intent.types.js';

import { GuestContext } from '../guest/guest-context.js';
export type OrchestrationResult =
  | {
      mode: 'operations';
      reply: string;
      documents: [];
    }
  | {
      mode: 'knowledge';
      documents: RetrievedDocument[];
    };

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
  ): Promise<OrchestrationResult> {
    const decision = await this.classifier.classify(message, history);

    this.logger.log(
      `Intenção identificada: ${decision.intent} (${decision.detail})`,
    );

    // 1. Todas as operações passam pelo Dispatcher.
    if (decision.intent !== 'knowledge.search') {
      const result = await this.dispatcher.dispatch(message, decision, guest);

      this.logger.log(`Operação concluída: ${result.tool}`);

      return {
        mode: 'operations',
        reply: result.reply,
        documents: [],
      };
    }

    // 2. Consultas de conhecimento continuam no RAG.
    const documents = await this.retrievalService.search(message);

    return {
      mode: 'knowledge',
      documents,
    };
  }
}
