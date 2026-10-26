import { Injectable } from '@nestjs/common';

import { compactText, normalizeTime, stripSymbols } from '../common/text.js';

import { ResortSnapshotGateway } from './resort-snapshot.gateway.js';

export interface RestaurantInfo {
  id: string;
  name: string;
  type: string | null;
  openingHours: string | null;
  description: string;
  location: string | null;
  acceptsReservations: boolean;
  minimumAge: number | null;
  // Turnos ativos de reserva (HH:MM).
  reservationTimes: string[];
}

interface RestaurantRow {
  id: string;
  name: string | null;
  type: string | null;
  openingHours: string | null;
  description: string | null;
  location: string | null;
  acceptsReservations: string | null;
  minimumAge: number | null;
  times: string | null;
}

/**
 * Catálogo público de restaurantes e bares ativos do snapshot.
 */
@Injectable()
export class RestaurantsCatalogService {
  constructor(private readonly snapshot: ResortSnapshotGateway) {}

  async listActive(): Promise<RestaurantInfo[]> {
    const rows = await this.snapshot.select<RestaurantRow>(
      `
        SELECT
          r.id_restaurante AS id,
          r.nome_restaurante AS name,
          r.tipo_restaurante AS type,
          r.funcionamento_restaurante AS openingHours,
          r.descricao_restaurante AS description,
          l.nome_localizacao AS location,
          r.possuireserva_restaurante AS acceptsReservations,
          r.idademinima_restaurante AS minimumAge,
          (
            SELECT GROUP_CONCAT(
              DISTINCT s.descricao_horariorestaurante
              ORDER BY s.descricao_horariorestaurante
              SEPARATOR ','
            )
            FROM tb_horariorestaurante s
            WHERE s.id_restaurante = r.id_restaurante
              AND s.situacao_horariorestaurante = 1
          ) AS times
        FROM tb_restaurante r
        LEFT JOIN tb_localizacao l
          ON l.id_localizacao = r.id_localizacao
        WHERE r.situacao_restaurante = 1
        ORDER BY r.ordem_restaurante ASC, r.nome_restaurante ASC
        LIMIT 100
      `,
    );

    return rows.map((row) => ({
      id: row.id,
      name: stripSymbols(compactText(row.name, 120)) || 'Restaurante sem nome',
      type: row.type,
      openingHours: compactText(row.openingHours, 300) || null,
      description: compactText(row.description),
      location: compactText(row.location, 120) || null,
      acceptsReservations: row.acceptsReservations === 'sim',
      minimumAge:
        row.minimumAge !== null && Number(row.minimumAge) > 0
          ? Number(row.minimumAge)
          : null,
      reservationTimes: (row.times ?? '')
        .split(',')
        .map((time) => normalizeTime(time))
        .filter((time): time is string => time !== null),
    }));
  }
}
