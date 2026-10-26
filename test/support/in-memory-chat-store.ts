import { getRepositoryToken } from '@nestjs/typeorm';
import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { vi } from 'vitest';

import { ChatConversation } from '../../src/chat/entities/chat-conversation.entity.js';
import { ChatConversationState } from '../../src/chat/entities/chat-conversation-state.entity.js';
import { ChatMessage } from '../../src/chat/entities/chat-message.entity.js';
import type { ConversationState } from '../../src/contracts/conversation-state.js';
import { ResortClock } from '../../src/resort/resort-clock.service.js';
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

type StoredState = Pick<ChatConversationState, 'conversationId' | 'resortId' | 'guestId' | 'state' | 'version'>;

type StateOwner = Partial<Pick<StoredState, 'conversationId' | 'resortId' | 'guestId'>>;

// Como no banco: todo critério informado precisa coincidir.
const ownedBy = (stored: StoredState | undefined, where: StateOwner): stored is StoredState =>
  !!stored &&
  (where.resortId === undefined || stored.resortId === where.resortId) &&
  (where.guestId === undefined || stored.guestId === where.guestId);

/** Fixed resort date used by the chat tests: Friday, 2026-10-23. */
export const TEST_TODAY = '2026-10-23';

/**
 * In-memory replacement for the TypeORM pieces used by ChatService:
 * the two repositories and DataSource.transaction(). Writes made inside a
 * transaction are only committed if the callback resolves.
 */
export class InMemoryChatStore {
  readonly conversations = new Map<string, StoredConversation>();
  readonly messages: StoredMessage[] = [];
  readonly states = new Map<string, StoredState>();
  private nextMessageId = 1;

  readonly clock = (() => {
    const clock = new ResortClock(new ConfigService({ RESORT_TIMEZONE: 'America/Bahia' }));
    vi.spyOn(clock, 'today').mockReturnValue(TEST_TODAY);
    return clock;
  })();

  readonly statesRepository = {
    findOneBy: vi.fn(async (where: StateOwner) => {
      const stored = this.states.get(where.conversationId ?? '');
      return ownedBy(stored, where) ? structuredClone(stored) : null;
    }),
  };

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

  seedState(
    conversationId: string,
    state: ConversationState,
    version = 1,
    owner: GuestContext = this.conversations.get(conversationId) ?? DEMO_GUEST_CONTEXT,
  ) {
    this.states.set(conversationId, {
      conversationId,
      resortId: owner.resortId,
      guestId: owner.guestId,
      state,
      version,
    });
  }

  providers(): Provider[] {
    return [
      { provide: DataSource, useValue: this.dataSource },
      { provide: ResortClock, useValue: this.clock },
      {
        provide: getRepositoryToken(ChatConversationState),
        useValue: this.statesRepository,
      },
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
        async (entity: unknown, values: StoredConversation | MessageInput[] | MessageInput | StoredState) => {
          if (entity === ChatConversationState && !Array.isArray(values)) {
            const stored = values as StoredState;
            staged.push(() => this.states.set(stored.conversationId, structuredClone(stored)));
            return;
          }

          if (entity === ChatMessage && !Array.isArray(values)) {
            const message = values as MessageInput;
            staged.push(() => this.messages.push({ id: this.nextMessageId++, ...message }));
            return;
          }

          if (entity === ChatConversation && !Array.isArray(values)) {
            const { id, resortId, guestId } = values as StoredConversation;
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
        async (
          entity: unknown,
          where: { id?: string; version?: number } & StateOwner,
          values: { updatedAt?: Date; state?: ConversationState; version?: number },
        ) => {
          if (entity === ChatConversationState) {
            const stored = this.states.get(where.conversationId ?? '');
            const matches =
              ownedBy(stored, where) && (where.version === undefined || stored.version === where.version);

            if (matches && stored) {
              staged.push(() => Object.assign(stored, structuredClone(values)));
            }

            return { affected: matches ? 1 : 0 };
          }

          staged.push(() => {
            const conversation = this.conversations.get(where.id ?? '');
            if (conversation && values.updatedAt) conversation.updatedAt = values.updatedAt;
          });
        },
      ),
      commit: () => staged.forEach((apply) => apply()),
    };
  }
}
