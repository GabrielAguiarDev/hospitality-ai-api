import { Injectable } from '@nestjs/common';

import { compactText, stripSymbols } from '../common/text.js';

import { ResortSnapshotGateway } from './resort-snapshot.gateway.js';

export interface RequestItem {
  id: string;
  name: string;
}

export interface RequestDepartment {
  id: string;
  name: string;
  description: string | null;
  // Itens ativos que o hóspede pode pedir (tb_itemdepartamento).
  items: RequestItem[];
  // Avisos do departamento: horários, prazos, serviços (tb_infodepartamento).
  info: { title: string; description: string | null }[];
}

interface DepartmentRow {
  id: string;
  name: string | null;
  description: string | null;
}

interface ItemRow {
  id: string;
  departmentId: string;
  name: string | null;
  sub: string | null;
}

interface InfoRow {
  departmentId: string;
  title: string | null;
  description: string | null;
}

const text = (value: string | null, max: number) => stripSymbols(compactText(value, max)) || null;

// O catálogo muda raramente; a confirmação revalida itens de qualquer forma.
const CACHE_MS = 60_000;

/**
 * Catálogo de Solicitações do snapshot: departamentos que aceitam
 * solicitação, seus itens ativos e avisos. Somente leitura.
 */
@Injectable()
export class RequestsCatalogService {
  private cache: { at: number; value: Promise<RequestDepartment[]> } | null = null;

  constructor(private readonly snapshot: ResortSnapshotGateway) {}

  departments(): Promise<RequestDepartment[]> {
    if (!this.cache || Date.now() - this.cache.at > CACHE_MS) {
      const value = this.load();
      this.cache = { at: Date.now(), value };
      // Uma falha não fica guardada.
      value.catch(() => {
        if (this.cache?.value === value) this.cache = null;
      });
    }

    return this.cache.value;
  }

  private async load(): Promise<RequestDepartment[]> {
    const [departments, items, info] = await Promise.all([
      this.snapshot.select<DepartmentRow>(
        `
          SELECT
            d.id_departamento AS id,
            d.nome_departamento AS name,
            d.descricao_departamento AS description
          FROM tb_departamento d
          WHERE d.situacao_departamento = 1
            AND d.solicitacao_departamento = 'sim'
          ORDER BY d.ordem_departamento ASC, d.nome_departamento ASC
          LIMIT 50
        `,
      ),
      this.snapshot.select<ItemRow>(
        `
          SELECT
            i.id_itemdepartamento AS id,
            i.id_departamento AS departmentId,
            i.nome_itemdepartamento AS name,
            i.sub_itemdepartamento AS sub
          FROM tb_itemdepartamento i
          WHERE i.situacao_itemdepartamento = 1
          ORDER BY i.nome_itemdepartamento ASC
          LIMIT 300
        `,
      ),
      this.snapshot.select<InfoRow>(
        `
          SELECT
            i.id_departamento AS departmentId,
            i.titulo_infodepartamento AS title,
            i.descricao_infodepartamento AS description
          FROM tb_infodepartamento i
          ORDER BY i.ordem_infodepartamento ASC
          LIMIT 200
        `,
      ),
    ]);

    return departments.map((row) => {
      const id = String(row.id);
      const seen = new Set<string>();

      return {
        id,
        name: text(row.name, 120) ?? 'Departamento',
        description: text(row.description, 300),
        items: items
          .filter((item) => String(item.departmentId) === id)
          .map((item) => ({
            id: String(item.id),
            // Até 160 caracteres: o mesmo limite do card de solicitação.
            name: compactText([text(item.name, 120), text(item.sub, 60)].filter(Boolean).join(' - '), 160) || 'Item',
          }))
          // O cadastro tem itens repetidos ("Travesseiro" duas vezes).
          .filter((item) => !seen.has(item.name.toLowerCase()) && seen.add(item.name.toLowerCase())),
        info: info
          .filter((item) => String(item.departmentId) === id && text(item.title, 160))
          .map((item) => ({ title: text(item.title, 160) as string, description: text(item.description, 400) })),
      };
    });
  }
}
