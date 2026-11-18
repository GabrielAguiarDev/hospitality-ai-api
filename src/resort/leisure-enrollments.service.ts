import { Injectable } from '@nestjs/common';

import { compactText, stripSymbols } from '../common/text.js';

import { STAY_PARTY_SUBQUERY, stayPartyParameters, type GuestStay } from './guest-stay.service.js';
import { ResortSnapshotGateway } from './resort-snapshot.gateway.js';

export interface LeisureEnrollment {
  id: string;
  title: string;
  category: string | null;
  status: string;
  date: string | null;
}

interface EnrollmentRow {
  id: string;
  activity: string | null;
  category: string | null;
  form: string | null;
  status: string | null;
  date: string | null;
}

const text = (value: string | null, max: number) => stripSymbols(compactText(value, max)) || null;
const readable = (value: string | null) =>
  value && value === value.toUpperCase() ? value.charAt(0) + value.slice(1).toLowerCase() : value;

@Injectable()
export class LeisureEnrollmentsService {
  constructor(private readonly snapshot: ResortSnapshotGateway) {}

  async forStay(stay: GuestStay): Promise<LeisureEnrollment[]> {
    const rows = await this.snapshot.select<EnrollmentRow>(
      `
        SELECT
          a.id_lazerassinatura AS id,
          p.nome_programacaolazer AS activity,
          c.nome_categorialazer AS category,
          fm.titulo_formulario AS form,
          a.situacao_lazerassinatura AS status,
          DATE_FORMAT(COALESCE(a.data_lazerassinatura, a.criado_em), '%Y-%m-%d') AS date
        FROM tb_lazerassinatura a
        INNER JOIN tb_lazerform f
          ON f.id_lazerform = a.id_lazerform
        LEFT JOIN tb_programacaolazer p
          ON p.id_programacaolazer = f.id_programacaolazer
        LEFT JOIN tb_categorialazer c
          ON c.id_categorialazer = COALESCE(f.id_categorialazer, p.id_categorialazer)
        LEFT JOIN tb_formulario fm
          ON fm.id_formulario = f.id_formulario
        WHERE a.id_hospede IN (${STAY_PARTY_SUBQUERY})
          AND COALESCE(a.data_lazerassinatura, a.criado_em) >= ?
          AND COALESCE(a.data_lazerassinatura, a.criado_em) < DATE_ADD(?, INTERVAL 1 DAY)
        ORDER BY COALESCE(a.data_lazerassinatura, a.criado_em) DESC
        LIMIT 20
      `,
      [...stayPartyParameters(stay), stay.checkIn, stay.checkOut],
    );

    return rows.map((row) => {
      const form = readable(text(row.form, 120));
      return {
        id: String(row.id),
        title:
          text(row.activity, 160) ??
          (row.category ? `Recreação: ${text(row.category, 140)}` : form ? `Inscrição de lazer (${form})` : 'Inscrição de lazer'),
        category: text(row.category, 80),
        status: row.status ?? 'desconhecido',
        date: row.date,
      };
    });
  }
}
