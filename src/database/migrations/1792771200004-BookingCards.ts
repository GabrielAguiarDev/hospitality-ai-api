import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Card de reserva com estado persistido:
 * - experience_booking_previews ganha o estado "failed" e o motivo;
 * - chat_messages guarda as ações enviadas com cada resposta, para
 *   reconstruir o histórico com o card correto.
 * Somente o banco interno da IA. Cada etapa é retomável isoladamente.
 */
export class BookingCards1792771200004 implements MigrationInterface {
  name = 'BookingCards1792771200004';

  private async columnType(queryRunner: QueryRunner, table: string, column: string): Promise<string | null> {
    const rows = (await queryRunner.query(
      `
        SELECT COLUMN_TYPE AS type
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
          AND COLUMN_NAME = ?
      `,
      [table, column],
    )) as { type: string }[];

    return rows[0]?.type ?? null;
  }

  async up(queryRunner: QueryRunner): Promise<void> {
    const status = await this.columnType(queryRunner, 'experience_booking_previews', 'status');

    if (status && !status.includes("'failed'")) {
      await queryRunner.query(`
        ALTER TABLE experience_booking_previews
          MODIFY status ENUM('pending', 'confirmed', 'expired', 'cancelled', 'failed')
          NOT NULL DEFAULT 'pending'
      `);
    }

    if (!(await this.columnType(queryRunner, 'experience_booking_previews', 'failure_reason'))) {
      await queryRunner.query(
        'ALTER TABLE experience_booking_previews ADD COLUMN failure_reason VARCHAR(255) NULL AFTER status',
      );
    }

    if (!(await this.columnType(queryRunner, 'chat_messages', 'actions'))) {
      await queryRunner.query('ALTER TABLE chat_messages ADD COLUMN actions JSON NULL AFTER content');
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (await this.columnType(queryRunner, 'chat_messages', 'actions')) {
      await queryRunner.query('ALTER TABLE chat_messages DROP COLUMN actions');
    }

    if (await this.columnType(queryRunner, 'experience_booking_previews', 'failure_reason')) {
      await queryRunner.query('ALTER TABLE experience_booking_previews DROP COLUMN failure_reason');
    }

    // Pré-reservas que falharam voltam a ser "expired" antes de reduzir o ENUM.
    await queryRunner.query("UPDATE experience_booking_previews SET status = 'expired' WHERE status = 'failed'");
    await queryRunner.query(`
      ALTER TABLE experience_booking_previews
        MODIFY status ENUM('pending', 'confirmed', 'expired', 'cancelled')
        NOT NULL DEFAULT 'pending'
    `);
  }
}
