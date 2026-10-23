
import { Injectable } from '@nestjs/common';

import { normalizeTime } from '../common/text.js';
import type { GuestContext } from '../guest/guest-context.js';
import {
  GuestStayService,
  STAY_PARTY_SUBQUERY,
  stayPartyParameters,
} from '../resort/guest-stay.service.js';
import { ResortSnapshotGateway } from '../resort/resort-snapshot.gateway.js';

export interface RestaurantReservation {
  id: string;
  restaurantId: string | null;
  restaurant: string;
  // Data no formato dd/mm/aaaa.
  date: string;
  // Horário do turno reservado (HH:MM), quando cadastrado.
  time: string | null;
  // Compatibilidade: "dd/mm/aaaa HH:MM" ou apenas a data.
  reservedAt: string;
  // Quantidade de pedidos de pratos registrados (um por pessoa).
  // null quando não há pedidos para inferir os participantes.
  partySize: number | null;
  // Valores do snapshot: aprovada | cancelada.
  status: string;
}

interface ReservationRow {
  id: string;
  restaurantId: string | null;
  restaurant: string | null;
  date: string;
  time: string | null;
  status: string | null;
  diners: number | string | null;
}

/**
 * Reservas de restaurante reais do snapshot, restritas à
 * hospedagem atual do titular.
 */
@Injectable()
export class ReservationsService {
  constructor(
    private readonly snapshot: ResortSnapshotGateway,
    private readonly guestStay: GuestStayService,
  ) {}

  async listForGuest(
    guest: GuestContext,
  ): Promise<RestaurantReservation[]> {
    const stay = await this.guestStay.resolve(guest);

    const rows = await this.snapshot.select<ReservationRow>(
      `
        SELECT
          r.id_reservarestaurante AS id,
          rest.id_restaurante AS restaurantId,
          rest.nome_restaurante AS restaurant,
          DATE_FORMAT(r.data_reservarestaurante, '%d/%m/%Y') AS date,
          slot.descricao_horariorestaurante AS time,
          r.situacao_reservarestaurante AS status,
          (
            SELECT COUNT(DISTINCT COALESCE(p.id_hospede, p.id_pedidorestaurante))
            FROM tb_pedidorestaurante p
            WHERE p.id_reservarestaurante = r.id_reservarestaurante
          ) AS diners
        FROM tb_reservarestaurante r
        LEFT JOIN tb_restaurante rest
          ON rest.id_restaurante = r.id_restaurante
        LEFT JOIN tb_horariorestaurante slot
          ON slot.id_horariorestaurante = r.id_horariorestaurante
        WHERE r.idhospedagempms_reservarestaurante = ?
          AND r.data_reservarestaurante BETWEEN ? AND ?
          AND r.idtitular_reservarestaurante IN (${STAY_PARTY_SUBQUERY})
        ORDER BY
          r.data_reservarestaurante ASC,
          slot.descricao_horariorestaurante ASC
        LIMIT 20
      `,
      [
        stay.lodgingId,
        stay.checkIn,
        stay.checkOut,
        ...stayPartyParameters(stay),
      ],
    );

    return rows.map((row) => {
      const time = normalizeTime(row.time);
      const diners = Number(row.diners ?? 0);

      return {
        id: row.id,
        restaurantId: row.restaurantId,
        restaurant: row.restaurant?.trim() || 'Restaurante não identificado',
        date: row.date,
        time,
        reservedAt: time ? `${row.date} ${time}` : row.date,
        partySize: diners > 0 ? diners : null,
        status: row.status ?? 'desconhecido',
      };
    });
  }
}
