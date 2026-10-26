
import { Injectable } from '@nestjs/common';

import type { GuestContext } from '../guest/guest-context.js';
import {
  GuestStayService,
  STAY_PARTY_SUBQUERY,
  stayPartyParameters,
} from '../resort/guest-stay.service.js';
import { ResortSnapshotGateway } from '../resort/resort-snapshot.gateway.js';

export interface GuestRequest {
  id: string;
  // Departamento responsável (ex.: Manutenção, Governança).
  category: string;
  // Itens solicitados. Observações livres não são expostas.
  description: string;
  // Valores do snapshot: atendida | cancelada | pendente | executando.
  status: string;
  createdAt: string;
  // O snapshot não registra a data da última atualização.
  updatedAt: string | null;
  // Solicitação simulada pelo chat (banco interno), nunca enviada ao resort.
  simulated?: true;
  protocol?: string;
}

interface RequestRow {
  id: string;
  department: string | null;
  items: string | null;
  status: string | null;
  createdAt: string | null;
}

/**
 * Solicitações reais do snapshot feitas pelos hóspedes
 * da estadia atual do titular.
 */
@Injectable()
export class RequestsService {
  constructor(
    private readonly snapshot: ResortSnapshotGateway,
    private readonly guestStay: GuestStayService,
  ) {}

  async listForGuest(
    guest: GuestContext,
  ): Promise<GuestRequest[]> {
    const stay = await this.guestStay.resolve(guest);

    const rows = await this.snapshot.select<RequestRow>(
      `
        SELECT
          s.id_solicitacao AS id,
          d.nome_departamento AS department,
          (
            SELECT GROUP_CONCAT(
              DISTINCT CONCAT_WS(' - ', i.nome_itemdepartamento, i.sub_itemdepartamento)
              ORDER BY i.nome_itemdepartamento
              SEPARATOR '; '
            )
            FROM tb_itemsolicitacao si
            INNER JOIN tb_itemdepartamento i
              ON i.id_itemdepartamento = si.id_itemdepartamento
            WHERE si.id_solicitacao = s.id_solicitacao
          ) AS items,
          s.situacao_solicitacao AS status,
          DATE_FORMAT(s.data_solicitacao, '%d/%m/%Y %H:%i') AS createdAt
        FROM tb_solicitacao s
        LEFT JOIN tb_departamento d
          ON d.id_departamento = s.id_departamento
        WHERE s.id_hospede IN (${STAY_PARTY_SUBQUERY})
          AND s.data_solicitacao >= ?
          AND s.data_solicitacao < DATE_ADD(?, INTERVAL 1 DAY)
        ORDER BY s.data_solicitacao DESC
        LIMIT 20
      `,
      [...stayPartyParameters(stay), stay.checkIn, stay.checkOut],
    );

    return rows.map((row) => ({
      id: row.id,
      category: row.department?.trim() || 'Departamento não informado',
      description: row.items?.trim() || 'Itens não informados',
      status: row.status ?? 'desconhecido',
      createdAt: row.createdAt ?? 'data não informada',
      updatedAt: null,
    }));
  }
}
