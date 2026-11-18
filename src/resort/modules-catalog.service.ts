import { Injectable } from '@nestjs/common';

import { compactText, stripSymbols, summarizeText } from '../common/text.js';

import { ResortSnapshotGateway } from './resort-snapshot.gateway.js';

export interface BoutiqueProduct {
  id: string;
  name: string;
  category: string;
  price: number | null;
  description?: string | null;
}

export interface SpaService {
  id: string;
  name: string;
  category: string | null;
  price: number | null;
  details: string | null;
  description?: string | null;
}

export interface Tip {
  id: string;
  title: string;
  description: string | null;
}

export interface EsgInfo {
  id?: string;
  title: string | null;
  description: string;
}

export interface QuizInfo {
  id: string;
  title: string;
  theme: string | null;
  mode: 'live' | 'async' | null;
  questions: number | null;
}

const text = (value: string | null | undefined, max: number) => stripSymbols(compactText(value, max)) || null;
const money = (value: string | number | null) => {
  const parsed = Number(value);
  return value !== null && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const CACHE_MS = 60_000;

@Injectable()
export class ModulesCatalogService {
  private boutiqueCache: { at: number; value: Promise<BoutiqueProduct[]> } | null = null;

  constructor(private readonly snapshot: ResortSnapshotGateway) {}

  boutique(): Promise<BoutiqueProduct[]> {
    if (!this.boutiqueCache || Date.now() - this.boutiqueCache.at > CACHE_MS) {
      const value = this.loadBoutique();
      this.boutiqueCache = { at: Date.now(), value };
      value.catch(() => {
        if (this.boutiqueCache?.value === value) this.boutiqueCache = null;
      });
    }

    return this.boutiqueCache.value;
  }

  private async loadBoutique(): Promise<BoutiqueProduct[]> {
    const rows = await this.snapshot.select<{
      id: string;
      name: string | null;
      category: string | null;
      price: string | null;
      description: string | null;
    }>(
      `
        SELECT
          p.id_produto AS id,
          p.nome_produto AS name,
          c.titulo_categoriaproduto AS category,
          p.preco_produto AS price,
          p.descricao_produto AS description
        FROM tb_produto p
        INNER JOIN tb_categoriaproduto c
          ON c.id_categoriaproduto = p.id_categoriaproduto
         AND c.situacao_categoriaproduto = 1
        WHERE p.situacao_produto = 1
        ORDER BY c.ordem_categoriaproduto ASC, p.ordem_produto ASC, p.nome_produto ASC
        LIMIT 300
      `,
    );

    return rows.map((row) => ({
      id: String(row.id),
      name: text(row.name, 120) ?? 'Produto',
      category: text(row.category, 80) ?? 'Boutique',
      price: money(row.price),
      description: summarizeText(row.description, 300) || null,
    }));
  }

  async spa(): Promise<SpaService[]> {
    const rows = await this.snapshot.select<{
      id: string;
      name: string | null;
      category: string | null;
      price: string | null;
      details: string | null;
      description: string | null;
    }>(
      `
        SELECT
          s.id_servicospa AS id,
          s.titulo_servicospa AS name,
          c.titulo_categoriaspa AS category,
          s.valor_servicospa AS price,
          s.tempo_servicospa AS details,
          s.descricao_servicospa AS description
        FROM tb_servicospa s
        LEFT JOIN tb_categoriaspa c
          ON c.id_categoriaspa = s.id_categoriaspa
        WHERE s.situacao_servicospa = 1
          AND (c.id_categoriaspa IS NULL OR c.situacao_categoriaspa = 1)
        ORDER BY c.ordem_categoriaspa ASC, s.ordem_servicospa ASC
        LIMIT 100
      `,
    );
    const seen = new Set<string>();

    return rows
      .map((row) => {
        const details = text(row.details, 160)?.replace(/(R\$\s*[\d.,]+)\s+(?=\d)/g, '$1; ') ?? null;
        return {
          id: String(row.id),
          name: text(row.name, 120) ?? 'Serviço',
          category: text(row.category, 80),
          price: money(row.price),
          details: details && /^\d+$/.test(details) ? `${details} min` : details,
          description: summarizeText(row.description, 300) || null,
        };
      })
      .filter((service) => {
        const key = `${service.category}|${service.name}`.toLowerCase();
        return !seen.has(key) && Boolean(seen.add(key));
      });
  }

  async tips(): Promise<Tip[]> {
    const rows = await this.snapshot.select<{ id: string; title: string | null; description: string | null }>(
      `
        SELECT
          i.id_dicaitem AS id,
          i.titulo_dicaitem AS title,
          i.descricao_dicaitem AS description
        FROM tb_dicaitem i
        WHERE i.situacao_dicaitem = 1
        ORDER BY i.ordem_dicaitem ASC
        LIMIT 50
      `,
    );

    return rows.map((row) => ({
      id: String(row.id),
      title: text(row.title, 120) ?? 'Dica',
      description:
        summarizeText((row.description ?? '').replace(/\s*>\s*/g, '; ').replace(/:\s*;\s*/g, ': ').replace(/([.!?])\s*;/g, '$1').replace(/^;\s*/, ''), 400) || null,
    }));
  }

  async activeQuizzes(): Promise<QuizInfo[]> {
    const rows = await this.snapshot.select<{
      id: string;
      title: string | null;
      theme: string | null;
      mode: 'live' | 'async' | null;
      questions: number | null;
    }>(
      `
        SELECT
          q.id_quiz AS id,
          q.titulo_quiz AS title,
          t.titulo_quiztema AS theme,
          q.modo_quiz AS mode,
          q.totalperguntas_quiz AS questions
        FROM tb_quiz q
        LEFT JOIN tb_quiztema t
          ON t.id_quiztema = q.id_quiztema
        WHERE q.situacao_quiz = 1
        ORDER BY q.ordem_quiz ASC
        LIMIT 20
      `,
    );

    return rows.map((row) => ({
      id: String(row.id),
      title: text(row.title, 120) ?? 'Quiz',
      theme: text(row.theme, 120),
      mode: row.mode === 'live' || row.mode === 'async' ? row.mode : null,
      questions: row.questions !== null && Number(row.questions) > 0 ? Number(row.questions) : null,
    }));
  }

  async esg(): Promise<EsgInfo[]> {
    const rows = await this.snapshot.select<{ id: string; title: string | null; description: string | null }>(
      `
        SELECT e.id_esg AS id, e.titulo_esg AS title, e.descricao_esg AS description
        FROM tb_esg e
        WHERE e.descricao_esg IS NOT NULL AND TRIM(e.descricao_esg) <> ''
        LIMIT 10
      `,
    );

    return rows.flatMap((row) => {
      const description = summarizeText(row.description, 300);
      return description ? [{ ...(row.id != null ? { id: String(row.id) } : {}), title: text(row.title, 120), description }] : [];
    });
  }
}
