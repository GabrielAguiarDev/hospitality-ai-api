import { Injectable } from '@nestjs/common';

import { compactText, stripSymbols } from '../common/text.js';

import { STAY_PARTY_SUBQUERY, stayPartyParameters, type GuestStay } from './guest-stay.service.js';
import { ResortSnapshotGateway } from './resort-snapshot.gateway.js';

/**
 * Inscrição de lazer da estadia. No app ela aparece em Minhas
 * Solicitações, não em Minhas Reservas (R-LAZ-07).
 */
export interface LeisureEnrollment {
  id: string;
  // Atividade ou, sem ela, a categoria de lazer.
  title: string;
  category: string | null;
  // Valores do snapshot: pendente | aprovado | negado (R-LAZ-06).
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
// Títulos cadastrados em maiúsculas ("TERMO DE AVENTURA") viram "Termo de aventura".
const readable = (value: string | null) =>
  value && value === value.toUpperCase() ? value.charAt(0) + value.slice(1).toLowerCase() : value;

/** Inscrições de lazer dos hóspedes da estadia (snapshot, somente leitura). */
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

    // Parte das inscrições só tem o formulário (sem atividade nem categoria).
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
