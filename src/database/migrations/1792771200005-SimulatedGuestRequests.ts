import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Solicitações de hóspede simuladas (demonstração).
 * Nunca são enviadas ao sistema oficial do resort.
 * Somente no banco interno da IA; o snapshot do resort permanece intocado.
 */
export class SimulatedGuestRequests1792771200005 implements MigrationInterface {
  name = 'SimulatedGuestRequests1792771200005';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS simulated_guest_requests (
        id CHAR(36) NOT NULL PRIMARY KEY,
        resort_id VARCHAR(50) NOT NULL,
        guest_id VARCHAR(50) NOT NULL,
        conversation_id CHAR(36) NOT NULL,
        lodging_id INT NOT NULL,
        stay_check_in VARCHAR(19) NOT NULL,
        department_id VARCHAR(255) NOT NULL,
        department_name VARCHAR(255) NOT NULL,
        items JSON NOT NULL,
        note VARCHAR(500) NULL,
        status ENUM('preview', 'confirmed', 'cancelled', 'expired')
          NOT NULL DEFAULT 'preview',
        protocol VARCHAR(20) NULL,
        expires_at DATETIME(6) NOT NULL,
        confirmed_at DATETIME(6) NULL,
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at DATETIME(6) NOT NULL
          DEFAULT CURRENT_TIMESTAMP(6)
          ON UPDATE CURRENT_TIMESTAMP(6),
        UNIQUE KEY uq_guest_requests_protocol (protocol),
        -- Sem FK para chat_conversations: a solicitação pode ser criada
        -- na primeira mensagem, antes da conversa ser persistida.
        -- A propriedade é validada por resort, hóspede e conversa.
        INDEX idx_guest_requests_owner (resort_id, guest_id, conversation_id),
        INDEX idx_guest_requests_stay (resort_id, guest_id, status, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS simulated_guest_requests');
  }
}
