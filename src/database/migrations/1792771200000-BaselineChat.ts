import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Linha de base das tabelas de chat. Idempotente: bancos criados
 * por database/init/001-chat.sql ou já em uso não são alterados
 * além das colunas de propriedade ausentes.
 */
export class BaselineChat1792771200000 implements MigrationInterface {
  name = 'BaselineChat1792771200000';

  private async hasColumn(
    queryRunner: QueryRunner,
    table: string,
    column: string,
  ): Promise<boolean> {
    const rows = (await queryRunner.query(
      `
        SELECT COUNT(*) AS total
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
          AND COLUMN_NAME = ?
      `,
      [table, column],
    )) as { total: number | string }[];

    return Number(rows[0]?.total ?? 0) > 0;
  }

  private async hasIndex(
    queryRunner: QueryRunner,
    table: string,
    index: string,
  ): Promise<boolean> {
    const rows = (await queryRunner.query(
      `
        SELECT COUNT(*) AS total
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
          AND INDEX_NAME = ?
      `,
      [table, index],
    )) as { total: number | string }[];

    return Number(rows[0]?.total ?? 0) > 0;
  }

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS chat_conversations (
        id CHAR(36) NOT NULL PRIMARY KEY,
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at DATETIME(6) NOT NULL
          DEFAULT CURRENT_TIMESTAMP(6)
          ON UPDATE CURRENT_TIMESTAMP(6),
        resort_id VARCHAR(50) NOT NULL,
        guest_id VARCHAR(50) NOT NULL,
        INDEX idx_chat_conversations_owner (resort_id, guest_id, id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        conversation_id CHAR(36) NOT NULL,
        role ENUM('user', 'assistant') NOT NULL,
        content TEXT NOT NULL,
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        INDEX idx_messages_conversation (conversation_id, id),
        CONSTRAINT fk_messages_conversation
          FOREIGN KEY (conversation_id)
          REFERENCES chat_conversations(id)
          ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Bancos antigos foram criados sem as colunas de propriedade.
    for (const column of ['resort_id', 'guest_id']) {
      if (!(await this.hasColumn(queryRunner, 'chat_conversations', column))) {
        await queryRunner.query(
          `ALTER TABLE chat_conversations ADD COLUMN ${column} VARCHAR(50) NOT NULL DEFAULT ''`,
        );
      }
    }

    if (
      !(await this.hasIndex(
        queryRunner,
        'chat_conversations',
        'idx_chat_conversations_owner',
      ))
    ) {
      await queryRunner.query(
        'CREATE INDEX idx_chat_conversations_owner ON chat_conversations (resort_id, guest_id, id)',
      );
    }
  }

  // A linha de base não remove tabelas com histórico de conversas.
  async down(): Promise<void> {}
}
