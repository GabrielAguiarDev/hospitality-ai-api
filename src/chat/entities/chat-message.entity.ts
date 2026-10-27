
import type { ChatAction } from '../../contracts/chat-actions.js';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('chat_messages')
export class ChatMessage {
  @PrimaryGeneratedColumn({
    type: 'int',
    unsigned: true,
  })
  id!: number;

  @Column({
    name: 'conversation_id',
    type: 'char',
    length: 36,
  })
  conversationId!: string;

  @Column({
    type: 'enum',
    enum: ['user', 'assistant'],
  })
  role!: 'user' | 'assistant';

  @Column({ type: 'text' })
  content!: string;

  // Ações enviadas com a resposta (cards), para reconstruir o histórico.
  @Column({ type: 'json', nullable: true })
  actions!: ChatAction[] | null;

  @CreateDateColumn({
    name: 'created_at',
    type: 'datetime',
    precision: 6,
  })
  createdAt!: Date;
}

// ID gerado na inserção (InsertResult.identifiers) de uma única mensagem.
export function assistantId(identifiers: readonly Record<string, unknown>[] | undefined): number | undefined {
  const id = Number(identifiers?.[0]?.id);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}
