import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { compactText, normalizeTime } from '../../common/text.js';
import { formatCurrency } from '../../experiences/experience-pricing.js';
import { ExperiencesCatalogService } from '../../experiences/experiences-catalog.service.js';
import { requireConfiguredResortId } from '../../guest/resort-config.js';
import { ResortClock } from '../../resort/resort-clock.service.js';
import { ResortSnapshotGateway } from '../../resort/resort-snapshot.gateway.js';
import { RestaurantsCatalogService } from '../../resort/restaurants-catalog.service.js';
import type { KnowledgeDocument } from '../knowledge.service.js';

import { RESORT_SNAPSHOT_SOURCE, type KnowledgeSource } from './knowledge-source.js';

// EmbeddingGemma aceita até 2048 tokens; mantém margem.
const MAX_CONTENT = 1800;
const EVENT_WINDOW_DAYS = 14;

const WEEKDAY_ORDER = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

interface LeisureRow {
  name: string | null;
  weekday: string | null;
  time: string | null;
  location: string | null;
  categoryId: string | null;
  category: string | null;
}

interface InfoRow {
  id: string | null;
  title: string | null;
  description: string | null;
  category: string | null;
}

interface EventRow {
  title: string | null;
  description: string | null;
  date: string;
  time: string | null;
  location: string | null;
}

interface DepartmentRow {
  id: string;
  name: string | null;
  description: string | null;
  info: string | null;
}

interface SpaRow {
  description: string | null;
  notes: string | null;
}

interface SpaServiceRow {
  title: string | null;
  description: string | null;
  price: string | number | null;
  duration: string | null;
  category: string | null;
}

interface TipRow {
  title: string | null;
  description: string | null;
}

function doc(id: string, title: string, category: string, lines: (string | null | undefined | false)[]): KnowledgeDocument {
  const content = lines
    .map((line) => (typeof line === 'string' ? compactText(line, MAX_CONTENT) : ''))
    .filter(Boolean)
    .join('\n');

  return {
    id,
    title,
    category,
    content: content.length > MAX_CONTENT ? `${content.slice(0, MAX_CONTENT - 1).trimEnd()}…` : content,
  };
}

/**
 * Conhecimento público do resort extraído do snapshot.
 *
 * Nunca inclui hóspedes, reservas, solicitações, pedidos ou
 * colaboradores: somente catálogos e informações institucionais.
 */
@Injectable()
export class ResortSnapshotKnowledgeSource implements KnowledgeSource {
  readonly name = RESORT_SNAPSHOT_SOURCE;

  constructor(
    private readonly snapshot: ResortSnapshotGateway,
    private readonly restaurants: RestaurantsCatalogService,
    private readonly experiences: ExperiencesCatalogService,
    private readonly clock: ResortClock,
    private readonly configService: ConfigService,
  ) {}

  async load(resortId: string): Promise<KnowledgeDocument[]> {
    // O snapshot pertence somente ao resort desta instância.
    if (resortId !== requireConfiguredResortId(this.configService.get<string>('RESORT_ID'))) {
      return [];
    }

    const groups = await Promise.all([
      this.restaurantDocuments(),
      this.experienceDocuments(),
      this.leisureDocuments(),
      this.eventDocuments(),
      this.spaDocuments(),
      this.departmentDocuments(),
      this.tipDocuments(),
    ]);

    // IDs únicos dentro da fonte.
    const unique = new Map<string, KnowledgeDocument>();

    for (const document of groups.flat()) {
      if (document.content) {
        unique.set(document.id, document);
      }
    }

    return [...unique.values()];
  }

  private async restaurantDocuments(): Promise<KnowledgeDocument[]> {
    const restaurants = await this.restaurants.listActive();

    const typeLabel = (type: string | null) =>
      type === 'bar' ? 'Bar' : type === 'alimentacao' ? 'Alimentação' : 'Restaurante';

    const documents = restaurants.map((restaurant) =>
      doc(`restaurante:${restaurant.id}`, restaurant.name, 'gastronomia', [
        `${typeLabel(restaurant.type)}: ${restaurant.name}.`,
        restaurant.openingHours ? `Horário de funcionamento: ${restaurant.openingHours}.` : 'Horário de funcionamento não cadastrado.',
        restaurant.location ? `Localização: ${restaurant.location}.` : '',
        restaurant.acceptsReservations
          ? `Exige reserva pelo aplicativo, com seleção de pratos.${restaurant.reservationTimes.length ? ` Horários de reserva: ${restaurant.reservationTimes.join(', ')}.` : ''}`
          : 'Não exige reserva.',
        restaurant.minimumAge ? `Idade mínima: ${restaurant.minimumAge} anos.` : '',
        restaurant.description,
      ]),
    );

    documents.push(
      doc('restaurantes:visao-geral', 'Restaurantes e bares do resort', 'gastronomia', [
        'Restaurantes, bares e pontos de alimentação ativos no resort:',
        ...restaurants.map(
          (restaurant) =>
            `- ${restaurant.name} (${typeLabel(restaurant.type).toLowerCase()})` +
            `${restaurant.openingHours ? `: ${restaurant.openingHours}` : ''}` +
            `${restaurant.acceptsReservations ? ' — com reserva pelo aplicativo' : ''}`,
        ),
      ]),
    );

    return documents;
  }

  private async experienceDocuments(): Promise<KnowledgeDocument[]> {
    const experiences = await this.experiences.listActive();

    const prices = (experience: (typeof experiences)[number]) =>
      experience.reservationType === 'allinclusive'
        ? 'Sem cobrança cadastrada (all inclusive).'
        : experience.prices.length
          ? `Valores: ${experience.prices.map(({ category, price }) => `${category} ${formatCurrency(price)}`).join('; ')}.`
          : 'Valores não cadastrados.';

    const documents = experiences.map((experience) =>
      doc(`experiencia:${experience.id}`, experience.title, 'experiencias', [
        `Experiência: ${experience.title}.`,
        experience.bookable ? 'Exige reserva.' : 'Não exige reserva.',
        prices(experience),
        experience.minimumAge ? `Idade mínima: ${experience.minimumAge} anos.` : '',
        experience.minimumAgeAlone ? `Menores de ${experience.minimumAgeAlone} anos precisam de um responsável.` : '',
        experience.requiresGuardian ? 'Exige um adulto responsável.' : '',
        experience.description,
        experience.notes,
        'Para datas e vagas, consulte a disponibilidade pelo chat.',
      ]),
    );

    documents.push(
      doc('experiencias:visao-geral', 'Experiências do resort', 'experiencias', [
        'Experiências ativas no resort:',
        ...experiences.map(
          (experience) =>
            `- ${experience.title}${experience.bookable ? ' (com reserva)' : ' (sem reserva)'}` +
            `${experience.minimumAge ? `, a partir de ${experience.minimumAge} anos` : ''}`,
        ),
      ]),
    );

    return documents;
  }

  private async leisureDocuments(): Promise<KnowledgeDocument[]> {
    const rows = await this.snapshot.select<LeisureRow>(
      `
        SELECT
          p.nome_programacaolazer AS name,
          p.diasemana_programacaolazer AS weekday,
          TIME_FORMAT(p.hora_programacaolazer, '%H:%i') AS time,
          l.nome_localizacao AS location,
          c.id_categorialazer AS categoryId,
          c.nome_categorialazer AS category
        FROM tb_programacaolazer p
        INNER JOIN tb_categorialazer c
          ON c.id_categorialazer = p.id_categorialazer
         AND c.situacao_categorialazer = 1
        LEFT JOIN tb_localizacao l
          ON l.id_localizacao = p.id_localizacao
        WHERE p.situacao_programacaolazer = 1
        ORDER BY p.hora_programacaolazer ASC, p.nome_programacaolazer ASC
        LIMIT 1000
      `,
    );

    const info = await this.snapshot.select<InfoRow>(
      `
        SELECT
          i.id_infolazer AS id,
          i.titulo_infolazer AS title,
          i.descricao_infolazer AS description,
          c.nome_categorialazer AS category
        FROM tb_infolazer i
        LEFT JOIN tb_categorialazer c
          ON c.id_categorialazer = i.id_categorialazer
        WHERE i.situacao_infolazer = 1
        ORDER BY i.ordem_infolazer ASC
        LIMIT 100
      `,
    );

    const line = (row: LeisureRow, withCategory: boolean) =>
      `- ${normalizeTime(row.time) ?? 'horário a confirmar'} ${compactText(row.name, 80)}` +
      `${withCategory && row.category ? ` (${compactText(row.category, 40)})` : ''}` +
      `${row.location ? ` — ${compactText(row.location, 60)}` : ''}`;

    const documents: KnowledgeDocument[] = [];

    for (const weekday of WEEKDAY_ORDER) {
      const items = rows.filter((row) => row.weekday?.trim().toLowerCase() === weekday);
      const label = ResortClock.weekdayLabelFromKey(weekday) ?? weekday;

      if (items.length) {
        documents.push(
          doc(`lazer:programacao:${weekday}`, `Programação de lazer — ${label}`, 'lazer', [
            `Programação de lazer e recreação de ${label} (toda semana):`,
            ...items.map((row) => line(row, true)),
          ]),
        );
      }
    }

    const categories = new Map<string, LeisureRow[]>();

    for (const row of rows) {
      if (row.categoryId) {
        categories.set(row.categoryId, [...(categories.get(row.categoryId) ?? []), row]);
      }
    }

    for (const [categoryId, items] of categories) {
      const category = compactText(items[0].category, 60);
      const byActivity = new Map<string, string[]>();

      for (const row of items) {
        const key = `${compactText(row.name, 80)}${row.location ? ` — ${compactText(row.location, 60)}` : ''}`;
        const day = ResortClock.weekdayLabelFromKey(row.weekday ?? '') ?? '';
        byActivity.set(key, [...(byActivity.get(key) ?? []), `${day} ${normalizeTime(row.time) ?? ''}`.trim()]);
      }

      documents.push(
        doc(`lazer:categoria:${categoryId}`, `Atividades de lazer — ${category}`, 'lazer', [
          `Atividades recreativas da categoria ${category}:`,
          ...[...byActivity].map(([activity, when]) => `- ${activity}: ${when.join(', ')}`),
        ]),
      );
    }

    for (const row of info) {
      if (row.id) {
        documents.push(
          doc(`lazer:info:${row.id}`, compactText(row.title, 120) || 'Lazer', 'lazer', [
            row.category ? `Lazer — ${compactText(row.category, 60)}.` : 'Lazer.',
            compactText(row.title, 120),
            compactText(row.description),
          ]),
        );
      }
    }

    return documents;
  }

  // Somente a janela próxima: eventos passados deixam de ser indexados.
  private async eventDocuments(): Promise<KnowledgeDocument[]> {
    const today = this.clock.today();
    const until = ResortClock.addDays(today, EVENT_WINDOW_DAYS);

    const rows = await this.snapshot.select<EventRow>(
      `
        SELECT
          e.titulo_evento AS title,
          e.descricao_evento AS description,
          DATE_FORMAT(e.data_evento, '%Y-%m-%d') AS date,
          DATE_FORMAT(e.data_evento, '%H:%i') AS time,
          l.nome_localizacao AS location
        FROM tb_evento e
        LEFT JOIN tb_localizacao l
          ON l.id_localizacao = e.id_localizacao
        WHERE e.situacao_evento = 1
          AND e.data_evento >= ?
          AND e.data_evento < DATE_ADD(?, INTERVAL 1 DAY)
        ORDER BY e.data_evento ASC
        LIMIT 300
      `,
      [today, until],
    );

    const byDate = new Map<string, EventRow[]>();

    for (const row of rows) {
      byDate.set(row.date, [...(byDate.get(row.date) ?? []), row]);
    }

    return [...byDate].map(([date, events]) =>
      doc(`eventos:${date}`, `Eventos e shows — ${ResortClock.describeDate(date)}`, 'eventos', [
        `Eventos e shows programados para ${ResortClock.describeDate(date)}:`,
        ...events.map(
          (event) =>
            `- ${event.time} ${compactText(event.title, 100)}` +
            `${event.location ? ` — ${compactText(event.location, 60)}` : ''}` +
            `${event.description ? `: ${compactText(event.description, 160)}` : ''}`,
        ),
      ]),
    );
  }

  private async spaDocuments(): Promise<KnowledgeDocument[]> {
    const [spa] = await this.snapshot.select<SpaRow>(
      `
        SELECT descricao_spa AS description, observacao_spa AS notes
        FROM tb_spa
        LIMIT 1
      `,
    );

    const services = await this.snapshot.select<SpaServiceRow>(
      `
        SELECT
          s.titulo_servicospa AS title,
          s.descricao_servicospa AS description,
          s.valor_servicospa AS price,
          s.tempo_servicospa AS duration,
          c.titulo_categoriaspa AS category
        FROM tb_servicospa s
        LEFT JOIN tb_categoriaspa c
          ON c.id_categoriaspa = s.id_categoriaspa
        WHERE s.situacao_servicospa = 1
        ORDER BY c.ordem_categoriaspa ASC, s.ordem_servicospa ASC
        LIMIT 100
      `,
    );

    if (!spa && services.length === 0) {
      return [];
    }

    return [
      doc('spa:visao-geral', 'Spa, academia e serviços de bem-estar', 'spa', [
        'Spa e bem-estar.',
        compactText(spa?.description),
        compactText(spa?.notes),
        services.length ? 'Serviços do spa:' : '',
        ...services.map((service) => {
          const price = service.price === null ? null : Number(service.price);
          return (
            `- ${compactText(service.title, 80)}` +
            `${service.category ? ` (${compactText(service.category, 40)})` : ''}` +
            `${service.duration ? `, ${compactText(service.duration, 20)}` : ''}` +
            `${price !== null && Number.isFinite(price) ? `, ${formatCurrency(price)}` : ''}`
          );
        }),
      ]),
    ];
  }

  private async departmentDocuments(): Promise<KnowledgeDocument[]> {
    const rows = await this.snapshot.select<DepartmentRow>(
      `
        SELECT
          d.id_departamento AS id,
          d.nome_departamento AS name,
          d.descricao_departamento AS description,
          (
            SELECT GROUP_CONCAT(
              CONCAT_WS(': ', i.titulo_infodepartamento, i.descricao_infodepartamento)
              ORDER BY i.ordem_infodepartamento
              SEPARATOR '\n'
            )
            FROM tb_infodepartamento i
            WHERE i.id_departamento = d.id_departamento
          ) AS info
        FROM tb_departamento d
        WHERE d.situacao_departamento = 1
        ORDER BY d.ordem_departamento ASC
        LIMIT 100
      `,
    );

    return rows
      .filter((row) => row.description?.trim() || row.info?.trim())
      .map((row) =>
        doc(`departamento:${row.id}`, compactText(row.name, 120) || 'Serviço do resort', 'servicos', [
          `Serviço do resort: ${compactText(row.name, 120)}.`,
          compactText(row.description),
          ...(row.info ?? '').split('\n').map((item) => compactText(item, 600)),
        ]),
      );
  }

  private async tipDocuments(): Promise<KnowledgeDocument[]> {
    const rows = await this.snapshot.select<TipRow>(
      `
        SELECT titulo_dicaitem AS title, descricao_dicaitem AS description
        FROM tb_dicaitem
        WHERE situacao_dicaitem = 1
        ORDER BY ordem_dicaitem ASC
        LIMIT 50
      `,
    );

    if (rows.length === 0) {
      return [];
    }

    return [
      doc('dicas:visao-geral', 'Dicas e recomendações aos hóspedes', 'dicas', [
        'Dicas e recomendações do resort:',
        ...rows.map((row) => `- ${compactText(row.title, 80)}: ${compactText(row.description, 300)}`),
      ]),
    ];
  }
}
