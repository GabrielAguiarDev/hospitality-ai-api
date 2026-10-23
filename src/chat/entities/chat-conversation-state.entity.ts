import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import type { ConversationState } from '../../contracts/conversation-state.js';

@Entity('chat_conversation_states')
export class ChatConversationState {
  @PrimaryColumn({
    name: 'conversation_id',
    type: 'char',
    length: 36,
  })
  conversationId!: string;

  @Column({ type: 'json' })
  state!: ConversationState;

  @Column({ type: 'int', unsigned: true, default: 1 })
  version!: number;

  @UpdateDateColumn({
    name: 'updated_at',
    type: 'datetime',
    precision: 6,
  })
  updatedAt!: Date;
}
