import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

const decimal = {
  to: (value: number | null) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};

/**
 * Reserva simulada confirmada. Existe somente no banco da IA;
 * não representa uma reserva no sistema oficial do resort.
 */
@Entity('simulated_experience_bookings')
@Index('uq_bookings_preview', ['previewId'], { unique: true })
@Index('uq_bookings_confirmation', ['confirmationCode'], { unique: true })
@Index('idx_bookings_slot', ['availabilityId', 'slotId', 'status'])
@Index('idx_bookings_owner', ['resortId', 'guestId'])
export class SimulatedExperienceBooking {
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string;

  @Column({ name: 'preview_id', type: 'char', length: 36 })
  previewId!: string;

  @Column({ name: 'confirmation_code', type: 'varchar', length: 20 })
  confirmationCode!: string;

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

  @Column({ type: 'enum', enum: ['confirmed', 'cancelled'], default: 'confirmed' })
  status!: 'confirmed' | 'cancelled';

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 6 })
  createdAt!: Date;
}
