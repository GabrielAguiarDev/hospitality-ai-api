import { Injectable } from '@nestjs/common';

import { compactText, normalizeText, normalizeTime, stripSymbols, summarizeText } from '../common/text.js';

import { ResortClock } from './resort-clock.service.js';
import { ResortSnapshotGateway } from './resort-snapshot.gateway.js';

export interface ResortEvent {
  id: string;
  // "event": evento ou show daquela data; "leisure": atividade semanal de lazer.
  kind: 'event' | 'leisure';
  title: string;
  date: string;
  time: string | null;
  location: string | null;
  category: string | null;
  description: string | null;
}

interface EventRow {
  id: string;
  title: string | null;
  description: string | null;
  time: string | null;
  location: string | null;
}

interface LeisureRow {
  id: string;
  title: string | null;
  time: string | null;
  location: string | null;
  category: string | null;
}

/**
 * Programação de um dia no snapshot: eventos e shows da data
 * (tb_evento) e atividades semanais de lazer (tb_programacaolazer).
 */
@Injectable()
export class EventsCatalogService {
  constructor(private readonly snapshot: ResortSnapshotGateway) {}

  async forDate(date: string): Promise<ResortEvent[]> {
    const [events, leisure] = await Promise.all([
      this.snapshot.select<EventRow>(
        `
          SELECT
            e.id_evento AS id,
            e.titulo_evento AS title,
            e.descricao_evento AS description,
            DATE_FORMAT(e.data_evento, '%H:%i') AS time,
            l.nome_localizacao AS location
          FROM tb_evento e
          LEFT JOIN tb_localizacao l
            ON l.id_localizacao = e.id_localizacao
          WHERE e.situacao_evento = 1
            AND e.data_evento >= ?
            AND e.data_evento < DATE_ADD(?, INTERVAL 1 DAY)
          ORDER BY e.data_evento ASC
          LIMIT 50
        `,
        [date, date],
      ),
      this.snapshot.select<LeisureRow>(
        `
          SELECT
            p.id_programacaolazer AS id,
            p.nome_programacaolazer AS title,
            TIME_FORMAT(p.hora_programacaolazer, '%H:%i') AS time,
            l.nome_localizacao AS location,
            c.nome_categorialazer AS category
          FROM tb_programacaolazer p
          INNER JOIN tb_categorialazer c
            ON c.id_categorialazer = p.id_categorialazer
           AND c.situacao_categorialazer = 1
          LEFT JOIN tb_localizacao l
            ON l.id_localizacao = p.id_localizacao
          WHERE p.situacao_programacaolazer = 1
            AND LOWER(TRIM(p.diasemana_programacaolazer)) = ?
          ORDER BY p.hora_programacaolazer ASC, p.nome_programacaolazer ASC
          LIMIT 100
        `,
        [ResortClock.weekdayKey(date)],
      ),
    ]);

    const text = (value: string | null, max: number) => stripSymbols(compactText(value, max)) || null;
    // Locais cadastrados em maiúsculas ("PARK LOUNGE") viram "Park Lounge".
    const place = (value: string | null) => {
      const name = text(value, 120);
      return name && name === name.toUpperCase()
        ? name.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, space: string, letter: string) => space + letter.toUpperCase())
        : name;
    };

    return [
      ...events.map((row): ResortEvent => {
        const title = text(row.title, 160) ?? 'Evento';
        const description = summarizeText(row.description, 240);
        return {
          id: String(row.id),
          kind: 'event',
          title,
          date,
          time: normalizeTime(row.time),
          location: place(row.location),
          category: null,
          // "Show de Circo: Show de Circo" não acrescenta nada ao card.
          description: description && normalizeText(description) !== normalizeText(title) ? description : null,
        };
      }),
      ...leisure.map((row): ResortEvent => ({
        id: String(row.id),
        kind: 'leisure',
        title: text(row.title, 160) ?? 'Atividade de lazer',
        date,
        time: normalizeTime(row.time),
        location: place(row.location),
        category: text(row.category, 80),
        description: null,
      })),
    ].sort((a, b) => (a.time ?? '99:99').localeCompare(b.time ?? '99:99'));
  }
}
