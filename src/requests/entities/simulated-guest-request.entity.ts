import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export type SimulatedRequestStatus = 'preview' | 'confirmed' | 'cancelled' | 'expired';

export interface SimulatedRequestItem {
  itemId: string;
  name: string;
  quantity: number;
}

@Entity('simulated_guest_requests')
@Index('idx_guest_requests_owner', ['resortId', 'guestId', 'conversationId'])
@Index('idx_guest_requests_stay', ['resortId', 'guestId', 'status', 'createdAt'])
export class SimulatedGuestRequest {
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string;

  @Column({ name: 'resort_id', type: 'varchar', length: 50 })
  resortId!: string;

  @Column({ name: 'guest_id', type: 'varchar', length: 50 })
  guestId!: string;

  @Column({ name: 'conversation_id', type: 'char', length: 36 })
  conversationId!: string;

  @Column({ name: 'lodging_id', type: 'int' })
  lodgingId!: number;

  @Column({ name: 'stay_check_in', type: 'varchar', length: 19 })
  stayCheckIn!: string;

  @Column({ name: 'department_id', type: 'varchar', length: 255 })
  departmentId!: string;

  @Column({ name: 'department_name', type: 'varchar', length: 255 })
  departmentName!: string;

  @Column({ type: 'json' })
  items!: SimulatedRequestItem[];

  @Column({ type: 'varchar', length: 500, nullable: true })
  note!: string | null;

  @Column({ type: 'enum', enum: ['preview', 'confirmed', 'cancelled', 'expired'], default: 'preview' })
  status!: SimulatedRequestStatus;

  @Column({ type: 'varchar', length: 20, nullable: true, unique: true })
  protocol!: string | null;

  @Column({ name: 'expires_at', type: 'datetime', precision: 6 })
  expiresAt!: Date;

  @Column({ name: 'confirmed_at', type: 'datetime', precision: 6, nullable: true })
  confirmedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 6 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 6 })
  updatedAt!: Date;
}
