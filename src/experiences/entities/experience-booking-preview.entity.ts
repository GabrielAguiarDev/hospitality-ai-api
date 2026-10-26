import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export type PreviewStatus = 'pending' | 'confirmed' | 'expired' | 'cancelled' | 'failed';

const decimal = {
  to: (value: number | null) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};

/**
 * Pré-reserva simulada. Guarda as condições validadas pelo servidor;
 * a confirmação nunca usa dados reenviados pelo cliente.
 */
@Entity('experience_booking_previews')
@Index('idx_previews_owner', ['resortId', 'guestId', 'conversationId'])
export class ExperienceBookingPreview {
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

  @Column({ name: 'experience_id', type: 'varchar', length: 255 })
  experienceId!: string;

  @Column({ name: 'experience_title', type: 'varchar', length: 255 })
  experienceTitle!: string;

  @Column({ name: 'availability_id', type: 'varchar', length: 255 })
  availabilityId!: string;

  @Column({ name: 'slot_id', type: 'varchar', length: 255, nullable: true })
  slotId!: string | null;

  @Column({ name: 'booking_date', type: 'date' })
  bookingDate!: string;

  @Column({ name: 'booking_time', type: 'char', length: 5, nullable: true })
  bookingTime!: string | null;

  @Column({ type: 'tinyint', unsigned: true })
  adults!: number;

  @Column({ type: 'tinyint', unsigned: true })
  children!: number;

  @Column({ name: 'total_price', type: 'decimal', precision: 10, scale: 2, nullable: true, transformer: decimal })
  totalPrice!: number | null;

  @Column({ type: 'char', length: 3, default: 'BRL' })
  currency!: string;

  @Column({ name: 'price_note', type: 'varchar', length: 255, nullable: true })
  priceNote!: string | null;

  @Column({ type: 'enum', enum: ['pending', 'confirmed', 'expired', 'cancelled', 'failed'], default: 'pending' })
  status!: PreviewStatus;

  // Motivo de uma confirmação que falhou (revalidação ou valor alterado).
  @Column({ name: 'failure_reason', type: 'varchar', length: 255, nullable: true })
  failureReason!: string | null;

  @Column({ name: 'expires_at', type: 'datetime', precision: 6 })
  expiresAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 6 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 6 })
  updatedAt!: Date;
}
