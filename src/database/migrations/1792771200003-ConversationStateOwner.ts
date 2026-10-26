import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Propriedade do estado da conversa: o estado passa a ser lido e gravado
 * por conversation_id + resort_id + guest_id. Somente o banco interno da
 * IA é alterado. Idempotente, como a linha de base.
 */
export class ConversationStateOwner1792771200003 implements MigrationInterface {
  name = 'ConversationStateOwner1792771200003';

  private async column(queryRunner: QueryRunner, column: string): Promise<{ nullable: boolean } | null> {
    const rows = (await queryRunner.query(
      `
        SELECT IS_NULLABLE AS nullable
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'chat_conversation_states'
          AND COLUMN_NAME = ?
      `,
      [column],
    )) as { nullable: string }[];

    return rows[0] ? { nullable: rows[0].nullable === 'YES' } : null;
  }

  private async hasIndex(queryRunner: QueryRunner, index: string): Promise<boolean> {
    const rows = (await queryRunner.query(
      `
        SELECT COUNT(*) AS total
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'chat_conversation_states'
          AND INDEX_NAME = ?
      `,
      [index],
    )) as { total: number | string }[];

    return Number(rows[0]?.total ?? 0) > 0;
  }

  // DDL no MySQL não é transacional: cada etapa é retomável isoladamente.
  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await this.column(queryRunner, 'resort_id'))) {
      await queryRunner.query(
        'ALTER TABLE chat_conversation_states ADD COLUMN resort_id VARCHAR(50) NULL AFTER conversation_id',
      );
    }

    if (!(await this.column(queryRunner, 'guest_id'))) {
      await queryRunner.query(
        'ALTER TABLE chat_conversation_states ADD COLUMN guest_id VARCHAR(50) NULL AFTER resort_id',
      );
    }

    // Estados sem dono herdam o dono da conversa (inclusive numa nova tentativa).
    await queryRunner.query(`
      UPDATE chat_conversation_states s
      INNER JOIN chat_conversations c ON c.id = s.conversation_id
      SET s.resort_id = c.resort_id, s.guest_id = c.guest_id
      WHERE s.resort_id IS NULL OR s.guest_id IS NULL
    `);

    // Defensivo: a FK com ON DELETE CASCADE já impede estados sem conversa.
    await queryRunner.query('DELETE FROM chat_conversation_states WHERE resort_id IS NULL OR guest_id IS NULL');

    if ((await this.column(queryRunner, 'resort_id'))?.nullable) {
      await queryRunner.query('ALTER TABLE chat_conversation_states MODIFY resort_id VARCHAR(50) NOT NULL');
    }

    if ((await this.column(queryRunner, 'guest_id'))?.nullable) {
      await queryRunner.query('ALTER TABLE chat_conversation_states MODIFY guest_id VARCHAR(50) NOT NULL');
    }

    if (!(await this.hasIndex(queryRunner, 'idx_conversation_states_owner'))) {
      await queryRunner.query(
        'ALTER TABLE chat_conversation_states ADD INDEX idx_conversation_states_owner (resort_id, guest_id, conversation_id)',
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (await this.hasIndex(queryRunner, 'idx_conversation_states_owner')) {
      await queryRunner.query('ALTER TABLE chat_conversation_states DROP INDEX idx_conversation_states_owner');
    }

    for (const column of ['guest_id', 'resort_id']) {
      if (await this.column(queryRunner, column)) {
        await queryRunner.query(`ALTER TABLE chat_conversation_states DROP COLUMN ${column}`);
      }
    }
  }
}
