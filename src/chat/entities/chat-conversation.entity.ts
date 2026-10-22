import {
  Entity,
  PrimaryColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Column,
} from 'typeorm';

@Entity('chat_conversations')
export class ChatConversation {
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string;

  @CreateDateColumn({
    name: 'created_at',
    type: 'datetime',
    precision: 6,
  })
  createdAt!: Date;

  @UpdateDateColumn({
    name: 'updated_at',
    type: 'datetime',
    precision: 6,
  })
  updatedAt!: Date;

  @Column({
    name: 'resort_id',
    type: 'varchar',
    length: 50,
  })
  resortId!: string;

  @Column({
    name: 'guest_id',
    type: 'varchar',
    length: 50,
  })
  guestId!: string;
}
