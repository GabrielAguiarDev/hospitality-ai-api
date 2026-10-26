import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import type { Repository } from 'typeorm';

import {
  bookingCard,
  sanitizeActions,
  type ChatAction,
  type ChatResponse,
} from '../contracts/chat-actions.js';
import type { GuestContext } from '../guest/guest-context.js';
import { ExperienceOperationsService } from '../operations/experience-operations.service.js';
import { OllamaService } from '../llm/ollama.service.js';
import type { LlmMessage } from '../llm/ollama.service.js';
import { toPlainText } from '../common/text.js';
import type { RetrievedDocument } from '../rag/knowledge.service.js';
import { ResortClock } from '../resort/resort-clock.service.js';

import { ChatConversation } from './entities/chat-conversation.entity.js';
import { ChatMessage } from './entities/chat-message.entity.js';
import { ChatOrchestratorService } from './chat-orchestrator.service.js';
import { buildKnowledgePrompt, knowledgeHistory, polishReply } from './chat-prompts.js';
import { ConversationContextService } from './conversation-context.service.js';
import type { HistoryEntry } from './chat-intent.types.js';
import { socialReply } from './social-replies.js';

// Resposta fixa quando o RAG não encontra evidências:
// o modelo não é chamado para não inventar informações.
export { CONCURRENT_UPDATE_MESSAGE } from './conversation-context.service.js';

export const NO_EVIDENCE_REPLY =
  'Não encontrei essa informação nas fontes do resort. ' +
  'Posso ajudar com restaurantes, experiências, programação de lazer, ' +
  'suas reservas ou solicitações. Para outros assuntos, procure a recepção.';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly ollamaService: OllamaService,
    private readonly dataSource: DataSource,
    private readonly chatOrchestrator: ChatOrchestratorService,

    @InjectRepository(ChatConversation)
    private readonly conversationsRepository: Repository<ChatConversation>,

    @InjectRepository(ChatMessage)
    private readonly messagesRepository: Repository<ChatMessage>,

    private readonly context: ConversationContextService,

    private readonly clock: ResortClock,

    private readonly experienceOperations: ExperienceOperationsService,
  ) {}

  async sendMessage(
    message: string,
    guest: GuestContext,
    conversationId?: string,
  ): Promise<ChatResponse> {
    const id = conversationId ?? randomUUID();

    // Verifica a existência E a propriedade da conversa.
    if (conversationId) {
      const conversation = await this.conversationsRepository.findOneBy({
        id,
        resortId: guest.resortId,
        guestId: guest.guestId,
      });

      if (!conversation) {
        throw new NotFoundException('Conversa não encontrada');
      }
    }

    // Recupera histórico apenas após validar o proprietário.
    const previousMessages = conversationId
      ? await this.messagesRepository.find({
          where: {
            conversationId: id,
          },
          order: { id: 'DESC' },
          take: 12,
        })
      : [];

    const history: HistoryEntry[] = previousMessages
      .reverse()
      .map(({ role, content }) => ({
        role,
        content,
      }));

    // Estado estruturado da conversa, lido pelo dono (resort + hóspede).
    const stored = await this.context.load(conversationId, guest);
    const { state } = stored;
    const today = this.clock.today();

    const orchestration = await this.chatOrchestrator.resolve(
      message,
      guest,
      history,
      { conversationId: id, state, today },
    );

    let reply: string;
    let documents: RetrievedDocument[] = [];
    let actions: ChatAction[] = [];

    if (orchestration.mode === 'operations') {
      reply = orchestration.reply;
      actions = sanitizeActions(orchestration.actions);
    } else if (orchestration.mode === 'conversation') {
      // Interações sociais não chamam o modelo: resposta curta e imediata.
      reply = socialReply(message, orchestration.intent, {
        history,
        pendingBooking: Boolean(state.experience?.pendingPreviewId),
        declinesPending: orchestration.declinesPending,
      });
    } else if (orchestration.documents.length === 0) {
      this.logger.debug('Fallback: o RAG não encontrou evidências; resposta padrão sem o modelo.');
      reply = NO_EVIDENCE_REPLY;
    } else {
      documents = orchestration.documents;

      const messages: LlmMessage[] = [
        {
          role: 'system',
          content: buildKnowledgePrompt(documents, today),
        },
        ...knowledgeHistory(history),
        {
          role: 'user',
          content: message,
        },
      ];

      reply = polishReply(toPlainText(await this.ollamaService.generate(messages)));
    }

    await this.dataSource.transaction(async (manager) => {
      if (!conversationId) {
        await manager.insert(ChatConversation, {
          id,
          resortId: guest.resortId,
          guestId: guest.guestId,
        });
      }

      await manager.insert(ChatMessage, [
        {
          conversationId: id,
          role: 'user',
          content: message,
        },
        {
          conversationId: id,
          role: 'assistant',
          content: reply,
          // Persistidas para reconstruir o histórico com os cards.
          actions: actions.length ? actions : null,
        },
      ]);

      await manager.update(ChatConversation, { id }, { updatedAt: new Date() });

      await this.context.save(manager, id, guest, stored, orchestration.state);
    });

    return {
      reply,
      conversationId: id,
      retrievedSources: documents.map((document) => ({
        id: document.id,
        title: document.title,
        distance: document.distance,
      })),
      actions,
    };
  }

  async getMessages(conversationId: string, guest: GuestContext) {
    const conversation = await this.conversationsRepository.findOneBy({
      id: conversationId,
      resortId: guest.resortId,
      guestId: guest.guestId,
    });

    if (!conversation) {
      throw new NotFoundException('Conversa não encontrada');
    }

    const messages = await this.messagesRepository.find({
      where: { conversationId },
      order: { id: 'ASC' },
    });

    // Cada card aparece uma vez, onde foi criado, com o estado atual.
    const cardIds = [
      ...new Set(
        messages.flatMap(({ actions }) =>
          (actions ?? []).flatMap((action) => (action.type === 'experience.booking.card' ? [action.cardId] : [])),
        ),
      ),
    ];
    const current = new Map(
      (await this.experienceOperations.bookingCards(guest, conversationId, cardIds)).map((card) => [card.cardId, card]),
    );
    const shown = new Set<string>();

    return {
      conversationId,
      messages: messages.map(({ actions, ...message }) => ({
        ...message,
        actions: sanitizeActions(
          (actions ?? []).flatMap((action): ChatAction[] => {
            if (action.type !== 'experience.booking.card') return [action];
            if (shown.has(action.cardId)) return [];

            shown.add(action.cardId);
            const fresh = current.get(action.cardId);
            // Os avisos do card original não são guardados no banco de reservas.
            if (fresh) return [{ ...fresh, notes: action.notes }];
            // Sem estado atual, um card em "preview" não pode manter botões ativos.
            return [
              action.status === 'preview'
                ? bookingCard({
                    conversationId,
                    previewId: action.cardId,
                    status: 'expired',
                    summary: action.summary,
                    notes: action.notes,
                    reason: 'A pré-reserva não está mais disponível.',
                  })
                : action,
            ];
          }),
        ),
      })),
    };
  }
}
