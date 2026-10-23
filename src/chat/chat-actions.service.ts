import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { Repository } from 'typeorm';

import { sanitizeActions, type ChatResponse } from '../contracts/chat-actions.js';
import type { GuestContext } from '../guest/guest-context.js';
import { ExperienceOperationsService } from '../operations/experience-operations.service.js';
import { OperationsToolRegistryService } from '../operations/operations-tool-registry.service.js';

import type { ChatActionDto } from './dto/chat-action.dto.js';
import { ChatConversation } from './entities/chat-conversation.entity.js';
import { ChatConversationState } from './entities/chat-conversation-state.entity.js';
import { ChatMessage } from './entities/chat-message.entity.js';

export type ChatActionStatus =
  | 'confirmed'
  | 'already_confirmed'
  | 'cancelled'
  | 'expired'
  | 'unavailable'
  | 'changed';

export interface ChatActionResponse extends ChatResponse {
  status: ChatActionStatus;
}

/**
 * Executa ações estruturadas (botões) a partir de pré-reservas
 * persistidas. A propriedade da conversa é sempre verificada.
 */
@Injectable()
export class ChatActionsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly experienceOperations: ExperienceOperationsService,
    private readonly registry: OperationsToolRegistryService,

    @InjectRepository(ChatConversation)
    private readonly conversationsRepository: Repository<ChatConversation>,

    @InjectRepository(ChatConversationState)
    private readonly statesRepository: Repository<ChatConversationState>,
  ) {}

  async execute(dto: ChatActionDto, guest: GuestContext): Promise<ChatActionResponse> {
    const conversation = await this.conversationsRepository.findOneBy({
      id: dto.conversationId,
      resortId: guest.resortId,
      guestId: guest.guestId,
    });

    if (!conversation) {
      throw new NotFoundException('Conversa não encontrada');
    }

    let reply: string;
    let status: ChatActionStatus;
    let response: ChatResponse['actions'] = [];

    if (dto.type === 'experience.booking.confirm') {
      const outcome = await this.experienceOperations.confirmPreview(
        guest,
        dto.conversationId,
        dto.previewId,
      );

      if (outcome.result.status === 'not_found') {
        throw new NotFoundException('Pré-reserva não encontrada');
      }

      reply = outcome.reply;
      status = outcome.result.status;
      response = sanitizeActions(outcome.actions);
    } else {
      const result = await this.registry.execute('experiences.booking.cancel', guest, {
        conversationId: dto.conversationId,
        previewId: dto.previewId,
      });

      if (result.tool !== 'experiences.booking.cancel' || !result.data.cancelled) {
        throw new NotFoundException('Pré-reserva pendente não encontrada');
      }

      reply = 'A pré-reserva foi descartada e nada foi registrado.';
      status = 'cancelled';
    }

    const stored = await this.statesRepository.findOneBy({
      conversationId: dto.conversationId,
    });

    await this.dataSource.transaction(async (manager) => {
      await manager.insert(ChatMessage, {
        conversationId: dto.conversationId,
        role: 'assistant',
        content: reply,
      });

      await manager.update(ChatConversation, { id: dto.conversationId }, { updatedAt: new Date() });

      // A pré-reserva tratada deixa de aguardar confirmação por texto.
      // Versão conferida: se o estado mudou em paralelo, a pendência
      // já foi substituída e não há o que limpar.
      if (stored?.state.experience?.pendingPreviewId === dto.previewId) {
        await manager.update(
          ChatConversationState,
          { conversationId: dto.conversationId, version: stored.version },
          {
            state: {
              ...stored.state,
              experience: { ...stored.state.experience, pendingPreviewId: undefined },
            },
            version: stored.version + 1,
          },
        );
      }
    });

    return {
      reply,
      conversationId: dto.conversationId,
      retrievedSources: [],
      actions: response,
      status,
    };
  }
}
