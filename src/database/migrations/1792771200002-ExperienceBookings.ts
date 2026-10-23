import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Pré-reservas e reservas simuladas de experiências.
 * Somente no banco interno da IA; o snapshot do resort
 * permanece intocado.
 */
export class ExperienceBookings1792771200002 implements MigrationInterface {
  name = 'ExperienceBookings1792771200002';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS experience_booking_previews (
        id CHAR(36) NOT NULL PRIMARY KEY,
        resort_id VARCHAR(50) NOT NULL,
        guest_id VARCHAR(50) NOT NULL,
        conversation_id CHAR(36) NOT NULL,
        lodging_id INT NOT NULL,
        experience_id VARCHAR(255) NOT NULL,
        experience_title VARCHAR(255) NOT NULL,
        availability_id VARCHAR(255) NOT NULL,
        slot_id VARCHAR(255) NULL,
        booking_date DATE NOT NULL,
        booking_time CHAR(5) NULL,
        adults TINYINT UNSIGNED NOT NULL,
        children TINYINT UNSIGNED NOT NULL,
        total_price DECIMAL(10, 2) NULL,
        currency CHAR(3) NOT NULL DEFAULT 'BRL',
        price_note VARCHAR(255) NULL,
        status ENUM('pending', 'confirmed', 'expired', 'cancelled')
          NOT NULL DEFAULT 'pending',
        expires_at DATETIME(6) NOT NULL,
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at DATETIME(6) NOT NULL
          DEFAULT CURRENT_TIMESTAMP(6)
          ON UPDATE CURRENT_TIMESTAMP(6),
        INDEX idx_previews_owner (resort_id, guest_id, conversation_id),
        INDEX idx_previews_status (status, expires_at),
        -- Sem FK para chat_conversations: a pré-reserva pode ser criada
        -- na primeira mensagem, antes da conversa ser persistida.
        -- A propriedade é validada por resort, hóspede e conversa.
        CONSTRAINT chk_previews_party
          CHECK (adults + children BETWEEN 1 AND 10)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS simulated_experience_bookings (
        id CHAR(36) NOT NULL PRIMARY KEY,
        preview_id CHAR(36) NOT NULL,
        confirmation_code VARCHAR(20) NOT NULL,
        resort_id VARCHAR(50) NOT NULL,
        guest_id VARCHAR(50) NOT NULL,
        conversation_id CHAR(36) NOT NULL,
        lodging_id INT NOT NULL,
        experience_id VARCHAR(255) NOT NULL,
        experience_title VARCHAR(255) NOT NULL,
        availability_id VARCHAR(255) NOT NULL,
        slot_id VARCHAR(255) NULL,
        booking_date DATE NOT NULL,
        booking_time CHAR(5) NULL,
        adults TINYINT UNSIGNED NOT NULL,
        children TINYINT UNSIGNED NOT NULL,
        total_price DECIMAL(10, 2) NULL,
        currency CHAR(3) NOT NULL DEFAULT 'BRL',
        status ENUM('confirmed', 'cancelled') NOT NULL DEFAULT 'confirmed',
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        UNIQUE KEY uq_bookings_preview (preview_id),
        UNIQUE KEY uq_bookings_confirmation (confirmation_code),
        INDEX idx_bookings_slot (availability_id, slot_id, status),
        INDEX idx_bookings_owner (resort_id, guest_id),
        CONSTRAINT fk_bookings_preview
          FOREIGN KEY (preview_id)
          REFERENCES experience_booking_previews(id)
          ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS simulated_experience_bookings');
    await queryRunner.query('DROP TABLE IF EXISTS experience_booking_previews');
  }
}
