import { InternalServerErrorException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import type { ExperienceInfo } from '../../experiences/experience.types.js';
import type { ExperiencesCatalogService } from '../../experiences/experiences-catalog.service.js';
import type { ResortClock } from '../../resort/resort-clock.service.js';
import type { ResortSnapshotGateway } from '../../resort/resort-snapshot.gateway.js';
import type { RestaurantInfo, RestaurantsCatalogService } from '../../resort/restaurants-catalog.service.js';

import { ResortSnapshotKnowledgeSource } from './resort-snapshot.source.js';

const FORBIDDEN_TABLES = /tb_hospede|tb_reserva|tb_solicitacao|tb_pedido|tb_colaborador|tb_usuario/i;

const restaurant = (over: Partial<RestaurantInfo> = {}): RestaurantInfo => ({
  id: 'r1',
  name: 'Trattoria',
  type: 'restaurante',
  openingHours: '19h',
  description: 'Massas',
  location: 'Praça',
  acceptsReservations: true,
  minimumAge: null,
  reservationTimes: ['19:00'],
  ...over,
});

const experience = (over: Partial<ExperienceInfo> = {}): ExperienceInfo => ({
  id: 'e1',
  title: 'Passeio',
  description: 'desc',
  notes: '',
  active: true,
  bookable: true,
  reservationType: 'reserva',
  minimumAge: 8,
  minimumAgeAlone: null,
  requiresGuardian: false,
  bookingCutoff: null,
  prices: [{ category: 'Adulto', price: 100 }],
  ...over,
});

describe('ResortSnapshotKnowledgeSource', () => {
  const select = vi.fn();
  const listRestaurants = vi.fn();
  const listExperiences = vi.fn();

  function build(config: Record<string, string | undefined> = { RESORT_ID: 'demo' }) {
    return new ResortSnapshotKnowledgeSource(
      { select } as unknown as ResortSnapshotGateway,
      { listActive: listRestaurants } as unknown as RestaurantsCatalogService,
      { listActive: listExperiences } as unknown as ExperiencesCatalogService,
      { today: () => '2026-10-23' } as unknown as ResortClock,
      { get: (key: string) => config[key] } as unknown as ConfigService,
    );
  }

  const rowsBySql = (sql: string): unknown[] => {
    if (sql.includes('tb_programacaolazer')) {
      return [
        { name: 'Aquaginástica', weekday: 'monday', time: '09:00', location: 'Piscina', categoryId: 'c1', category: 'Esporte' },
        { name: 'Bingo', weekday: 'tuesday', time: '20:00', location: null, categoryId: 'c2', category: 'Jogos' },
      ];
    }
    if (sql.includes('tb_infolazer')) return [{ id: 'i1', title: 'Regras', description: 'Use touca', category: 'Esporte' }];
    if (sql.includes('tb_evento')) {
      return [
        { title: 'Show', description: 'ao vivo', date: '2026-10-24', time: '21:00', location: 'Palco' },
        { title: 'Dança', description: null, date: '2026-10-24', time: '22:00', location: null },
      ];
    }
    if (sql.includes('tb_servicospa')) return [{ title: 'Massagem', description: null, price: '150.5', duration: '50min', category: 'Corpo' }];
    if (sql.includes('FROM tb_spa')) return [{ description: 'Spa', notes: null }];
    if (sql.includes('tb_departamento')) return [{ id: 'd1', name: 'Lavanderia', description: 'Serviço', info: 'Prazo: 24h\nPreço: sob consulta' }];
    if (sql.includes('tb_dicaitem')) return [{ title: 'Protetor', description: 'Use' }];
    return [];
  };

  beforeEach(() => {
    select.mockReset().mockImplementation(async (sql: string) => rowsBySql(sql));
    listRestaurants.mockReset().mockResolvedValue([restaurant(), restaurant({ id: 'r2', name: 'Bar', type: 'bar', acceptsReservations: false })]);
    listExperiences.mockReset().mockResolvedValue([experience(), experience({ id: 'e2', title: 'Livre', bookable: false, reservationType: 'allinclusive', prices: [] })]);
  });

  it('returns [] for a resortId different from RESORT_ID without querying', async () => {
    expect(await build().load('other')).toEqual([]);
    expect(select).not.toHaveBeenCalled();
    expect(listRestaurants).not.toHaveBeenCalled();
    expect(listExperiences).not.toHaveBeenCalled();
  });

  it('fails when RESORT_ID is not configured', async () => {
    await expect(build({}).load('demo')).rejects.toThrow(InternalServerErrorException);
    expect(select).not.toHaveBeenCalled();
  });

  it('never queries guest, reservation, request or order tables', async () => {
    await build().load('demo');

    expect(select).toHaveBeenCalled();
    for (const [sql] of select.mock.calls) {
      expect(String(sql)).not.toMatch(FORBIDDEN_TABLES);
    }
  });

  it('only issues read-only parameterised queries (events window as parameters)', async () => {
    await build().load('demo');

    const eventCall = select.mock.calls.find(([sql]) => String(sql).includes('tb_evento'))!;
    expect(eventCall[1]).toEqual(['2026-10-23', '2026-11-06']);
    expect(String(eventCall[0])).not.toContain('2026-10-23');
  });

  it('produces unique, prefixed document ids', async () => {
    const documents = await build().load('demo');
    const ids = documents.map((d) => d.id);

    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^(restaurante|restaurantes|experiencia|experiencias|lazer|eventos|spa|departamento|dicas):/);
    }
    expect(ids).toEqual(
      expect.arrayContaining([
        'restaurante:r1',
        'restaurantes:visao-geral',
        'experiencia:e1',
        'experiencias:visao-geral',
        'lazer:programacao:monday',
        'lazer:categoria:c1',
        'lazer:info:i1',
        'eventos:2026-10-24',
        'spa:visao-geral',
        'departamento:d1',
        'dicas:visao-geral',
      ]),
    );
    // events grouped by date: two events, one document
    expect(ids.filter((id) => id.startsWith('eventos:'))).toHaveLength(1);
  });

  it('deduplicates colliding ids keeping a single document', async () => {
    listRestaurants.mockResolvedValue([restaurant(), restaurant({ name: 'Duplicate' })]);
    const documents = await build().load('demo');
    expect(documents.filter((d) => d.id === 'restaurante:r1')).toHaveLength(1);
  });

  it('keeps content within 1800 chars and non-empty', async () => {
    listExperiences.mockResolvedValue([experience({ description: 'x'.repeat(5000), notes: 'y '.repeat(2000) })]);
    select.mockImplementation(async (sql: string) =>
      String(sql).includes('tb_dicaitem')
        ? Array.from({ length: 50 }, (_, i) => ({ title: `Dica ${i}`, description: 'z'.repeat(400) }))
        : rowsBySql(String(sql)),
    );

    const documents = await build().load('demo');

    expect(documents.length).toBeGreaterThan(5);
    for (const d of documents) {
      expect(d.content.length).toBeGreaterThan(0);
      expect(d.content.length).toBeLessThanOrEqual(1800);
      expect(d.title).toBeTruthy();
    }
    expect(documents.find((d) => d.id === 'dicas:visao-geral')!.content.length).toBeLessThanOrEqual(1800);
  });

  it('includes catalog facts and omits private data', async () => {
    const documents = await build().load('demo');
    const byId = new Map(documents.map((d) => [d.id, d.content]));

    expect(byId.get('restaurante:r1')).toContain('Horários de reserva: 19:00');
    expect(byId.get('experiencia:e2')).toContain('all inclusive');
    expect(byId.get('experiencia:e1')).toMatch(/Adulto R\$\s?100,00/);
    expect(byId.get('eventos:2026-10-24')).toContain('21:00 Show');
    expect(byId.get('spa:visao-geral')).toMatch(/Massagem.*R\$\s?150,50/);
  });

  it('skips empty groups (no spa, no tips)', async () => {
    select.mockImplementation(async (sql: string) =>
      /tb_spa|tb_servicospa|tb_dicaitem/.test(String(sql)) ? [] : rowsBySql(String(sql)),
    );
    const ids = (await build().load('demo')).map((d) => d.id);
    expect(ids).not.toContain('spa:visao-geral');
    expect(ids).not.toContain('dicas:visao-geral');
  });

  it('propagates gateway failures', async () => {
    select.mockImplementation(async () => {
      throw new Error('mysql down');
    });
    await expect(build().load('demo')).rejects.toThrow('mysql down');
  });
});
