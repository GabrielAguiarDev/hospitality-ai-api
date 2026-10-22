import { getRepositoryToken } from '@nestjs/typeorm';
import type { Provider } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { vi } from 'vitest';

import { ChatConversation } from '../../src/chat/entities/chat-conversation.entity.js';
import { ChatMessage } from '../../src/chat/entities/chat-message.entity.js';
import { DEMO_GUEST_CONTEXT } from '../../src/guest/guest-context.js';
import type { GuestContext } from '../../src/guest/guest-context.js';

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

type StoredConversation = Pick<ChatConversation, 'id' | 'resortId' | 'guestId'> & {
  updatedAt?: Date;
};

/**
 * In-memory replacement for the TypeORM pieces used by ChatService:
 * the two repositories and DataSource.transaction(). Writes made inside a
 * transaction are only committed if the callback resolves.
 */
export class InMemoryChatStore {
  readonly conversations = new Map<string, StoredConversation>();
  readonly messages: StoredMessage[] = [];
  private nextMessageId = 1;

  readonly conversationsRepository = {
    // Every criterion must match, so a conversation owned by another guest
    // is not found, as with the real repository.
    findOneBy: vi.fn(async (where: Partial<StoredConversation>) => {
      const conversation = where.id ? this.conversations.get(where.id) : undefined;
      if (!conversation) return null;

      const matches = Object.entries(where).every(
        ([key, value]) => conversation[key as keyof StoredConversation] === value,
      );
      return matches ? conversation : null;
    }),
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

  seedConversation(
    id: string,
    messages: Omit<MessageInput, 'conversationId'>[] = [],
    owner: GuestContext = DEMO_GUEST_CONTEXT,
  ) {
    this.conversations.set(id, { id, resortId: owner.resortId, guestId: owner.guestId });
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
        async (entity: unknown, values: StoredConversation | MessageInput[]) => {
          if (entity === ChatConversation && !Array.isArray(values)) {
            const { id, resortId, guestId } = values;
            staged.push(() => this.conversations.set(id, { id, resortId, guestId }));
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
