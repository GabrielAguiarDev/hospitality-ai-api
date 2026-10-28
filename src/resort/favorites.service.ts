import { Injectable } from '@nestjs/common';

import { compactText, normalizeTime, stripSymbols } from '../common/text.js';

import { STAY_PARTY_SUBQUERY, stayPartyParameters, type GuestStay } from './guest-stay.service.js';
import { ResortSnapshotGateway } from './resort-snapshot.gateway.js';

/**
 * Evento favoritado (lembrete) por alguém da estadia. No app, favorito é
 * um registro tb_notificacao com tipo "evento" (R-FAV-01); só eventos
 * podem ser favoritados.
 */
export interface FavoriteEvent {
  favoriteId: string;
  eventId: string;
  title: string;
  date: string;
  time: string | null;
  location: string | null;
}

interface FavoriteRow {
  favoriteId: string;
  eventId: string;
  title: string | null;
  date: string;
  time: string | null;
  location: string | null;
}

/**
 * Favoritos da estadia, lidos do snapshot (somente leitura). A janela é a
 * estadia inteira; o app mostra só os eventos do seu cache (R-FAV-03).
 */
@Injectable()
export class FavoritesService {
  constructor(private readonly snapshot: ResortSnapshotGateway) {}

  async forStay(stay: GuestStay): Promise<FavoriteEvent[]> {
    const rows = await this.snapshot.select<FavoriteRow>(
      `
        SELECT
          n.id_notificacao AS favoriteId,
          e.id_evento AS eventId,
          e.titulo_evento AS title,
          DATE_FORMAT(e.data_evento, '%Y-%m-%d') AS date,
          DATE_FORMAT(e.data_evento, '%H:%i') AS time,
          l.nome_localizacao AS location
        FROM tb_notificacao n
        INNER JOIN tb_evento e
          ON e.id_evento = n.id_evento
         AND e.situacao_evento = 1
        LEFT JOIN tb_localizacao l
          ON l.id_localizacao = e.id_localizacao
        WHERE n.tipo_evento = 'evento'
          AND n.id_hospede IN (${STAY_PARTY_SUBQUERY})
          AND e.data_evento >= ?
          AND e.data_evento < DATE_ADD(?, INTERVAL 1 DAY)
        ORDER BY e.data_evento ASC
        LIMIT 60
      `,
      [...stayPartyParameters(stay), stay.checkIn, stay.checkOut],
    );

    // Duas pessoas da estadia podem favoritar o mesmo evento: um card por evento.
    const seen = new Set<string>();

    return rows.flatMap((row) => {
      const eventId = String(row.eventId);
      if (seen.has(eventId)) return [];
      seen.add(eventId);

      return [
        {
          favoriteId: String(row.favoriteId),
          eventId,
          title: stripSymbols(compactText(row.title, 160)) || 'Evento',
          date: row.date,
          time: normalizeTime(row.time),
          location: stripSymbols(compactText(row.location, 120)) || null,
        },
      ];
    });
  }
}
