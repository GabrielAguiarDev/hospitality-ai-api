import { getRepositoryToken } from '@nestjs/typeorm';
import type { Provider } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { vi } from 'vitest';

import { ChatConversation } from '../../src/chat/entities/chat-conversation.entity.js';
import { ChatMessage } from '../../src/chat/entities/chat-message.entity.js';

type StoredMessage = Pick<
  ChatMessage,
  'id' | 'conversationId' | 'role' | 'content'
>;

interface FindMessagesOptions {
  where: { conversationId: string };
  order?: { id: 'ASC' | 'DESC' };
  take?: number;
}

type MessageInput = Pick<ChatMessage, 'conversationId' | 'role' | 'content'>;

/**
 * In-memory replacement for the TypeORM pieces used by ChatService:
 * the two repositories and DataSource.transaction(). Writes made inside a
 * transaction are only committed if the callback resolves.
 */
export class InMemoryChatStore {
  readonly conversations = new Map<string, { id: string; updatedAt?: Date }>();
  readonly messages: StoredMessage[] = [];
  private nextMessageId = 1;

  readonly conversationsRepository = {
    findOneBy: vi.fn(async ({ id }: { id: string }) =>
      this.conversations.get(id) ?? null,
    ),
  };

  readonly messagesRepository = {
    find: vi.fn(async ({ where, order, take }: FindMessagesOptions) => {
      const rows = this.messages
        .filter((message) => message.conversationId === where.conversationId)
        .sort((a, b) =>
          order?.id === 'DESC' ? b.id - a.id : a.id - b.id,
        );

      return (take ? rows.slice(0, take) : rows).map((row) => ({ ...row }));
    }),
  };

  /** Also used as the DataSource for ReservationsService.query(). */
  readonly dataSource = {
    query: vi.fn<DataSource['query']>(),
    transaction: vi.fn(
      async <T>(work: (manager: ReturnType<InMemoryChatStore['createManager']>) => Promise<T>) => {
        const manager = this.createManager();
        const result = await work(manager);
        manager.commit();
        return result;
      },
    ),
  };

  seedConversation(id: string, messages: Omit<MessageInput, 'conversationId'>[] = []) {
    this.conversations.set(id, { id });
    for (const message of messages) {
      this.messages.push({ id: this.nextMessageId++, conversationId: id, ...message });
    }
  }

  providers(): Provider[] {
    return [
      { provide: DataSource, useValue: this.dataSource },
      {
        provide: getRepositoryToken(ChatConversation),
        useValue: this.conversationsRepository,
      },
      {
        provide: getRepositoryToken(ChatMessage),
        useValue: this.messagesRepository,
      },
    ];
  }

  private createManager() {
    const staged: (() => void)[] = [];

    return {
      insert: vi.fn(
        async (entity: unknown, values: { id: string } | MessageInput[]) => {
          if (entity === ChatConversation && !Array.isArray(values)) {
            staged.push(() => this.conversations.set(values.id, { id: values.id }));
            return;
          }

          if (entity === ChatMessage && Array.isArray(values)) {
            staged.push(() => {
              for (const value of values) {
                this.messages.push({ id: this.nextMessageId++, ...value });
              }
            });
            return;
          }

          throw new Error('Unexpected insert in InMemoryChatStore');
        },
      ),
      update: vi.fn(
        async (_entity: unknown, { id }: { id: string }, values: { updatedAt: Date }) => {
          staged.push(() => {
            const conversation = this.conversations.get(id);
            if (conversation) conversation.updatedAt = values.updatedAt;
          });
        },
      ),
      commit: () => staged.forEach((apply) => apply()),
    };
  }
}
