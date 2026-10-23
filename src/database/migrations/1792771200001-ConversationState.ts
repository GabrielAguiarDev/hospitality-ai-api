import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ConversationState1792771200001 implements MigrationInterface {
  name = 'ConversationState1792771200001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS chat_conversation_states (
        conversation_id CHAR(36) NOT NULL PRIMARY KEY,
        state JSON NOT NULL,
        version INT UNSIGNED NOT NULL DEFAULT 1,
        updated_at DATETIME(6) NOT NULL
          DEFAULT CURRENT_TIMESTAMP(6)
          ON UPDATE CURRENT_TIMESTAMP(6),
        CONSTRAINT fk_conversation_states_conversation
          FOREIGN KEY (conversation_id)
          REFERENCES chat_conversations(id)
          ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS chat_conversation_states');
  }
}
