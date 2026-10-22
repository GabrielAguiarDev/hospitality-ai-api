
import { Injectable, Logger } from '@nestjs/common';

import { OperationsAiService } from '../operations/operations-ai.service.js';
import { RequestsOperationsService } from '../operations/requests-operations.service.js';

import { RetrievalService } from '../rag/retrieval.service.js';
import type { RetrievedDocument } from '../rag/knowledge.service.js';

import { IntentClassifierService } from './intent-classifier.service.js';
import type { HistoryEntry } from './chat-intent.types.js';

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
  private readonly logger = new Logger(
    ChatOrchestratorService.name,
  );

  constructor(
    private readonly classifier: IntentClassifierService,
    private readonly operationsAiService: OperationsAiService,
    private readonly requestsOperationsService: RequestsOperationsService,
    private readonly retrievalService: RetrievalService,
  ) {}

  async resolve(
    message: string,
    history: HistoryEntry[] = [],
  ): Promise<OrchestrationResult> {
    const decision = await this.classifier.classify(
      message,
      history,
    );

    this.logger.log(
      `Intenção identificada: ${decision.intent} (${decision.detail})`,
    );

    // Nova funcionalidade: solicitações do hóspede.
    if (
      decision.intent === 'request.list' ||
      decision.intent === 'request.status'
    ) {
      const reply =
        await this.requestsOperationsService.ask(
          message,
          decision.intent,
        );

      return {
        mode: 'operations',
        reply,
        documents: [],
      };
    }

    // Fluxo já existente: reservas de restaurante.
    if (
      decision.intent === 'reservation.list' ||
      decision.intent === 'reservation.details' ||
      decision.intent === 'reservation.status'
    ) {
      const result =
        await this.operationsAiService.ask(
          message,
          decision,
        );

      return {
        mode: 'operations',
        reply: result.reply,
        documents: [],
      };
    }

    // Fluxo já existente: conhecimento do resort.
    this.logger.log('Executando busca RAG');

    const documents =
      await this.retrievalService.search(message);

    return {
      mode: 'knowledge',
      documents,
    };
  }
}
