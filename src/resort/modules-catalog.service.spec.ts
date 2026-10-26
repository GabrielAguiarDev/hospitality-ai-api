import { ModulesCatalogService } from './modules-catalog.service.js';
import type { ResortSnapshotGateway } from './resort-snapshot.gateway.js';

describe('ModulesCatalogService', () => {
  const select = vi.fn<(sql: string) => Promise<unknown[]>>();
  // O cache de 60 s é por instância: cada teste usa a sua.
  let catalog: ModulesCatalogService;

  const sqlOf = (call = 0) => select.mock.calls[call][0];

  beforeEach(() => {
    select.mockReset();
    catalog = new ModulesCatalogService({ select } as unknown as ResortSnapshotGateway);
  });

  describe('quiz', () => {
    it('reads only the quiz catalog, never participations, PINs or hosts', async () => {
      select.mockResolvedValue([{ id: 7, title: 'Quiz do Mar', theme: 'Natureza', mode: 'live', questions: 10 }]);

      const result = await catalog.activeQuizzes();

      expect(result).toEqual([{ id: '7', title: 'Quiz do Mar', theme: 'Natureza', mode: 'live', questions: 10 }]);
      expect(select).toHaveBeenCalledOnce();
      const sql = sqlOf();
      expect(sql).not.toMatch(/tb_quizparticipacao/i);
      expect(sql).not.toMatch(/participa|pin_|anfitriao|host|hospede/i);
      expect(sql).toMatch(/FROM tb_quiz q/);
      expect(sql).toMatch(/situacao_quiz = 1/);
    });

    it('normalizes unknown modes and missing counts', async () => {
      select.mockResolvedValue([
        { id: 1, title: null, theme: null, mode: 'weird', questions: 0 },
        { id: 2, title: 'B', theme: '', mode: 'async', questions: 5 },
      ]);

      await expect(catalog.activeQuizzes()).resolves.toEqual([
        { id: '1', title: 'Quiz', theme: null, mode: null, questions: null },
        { id: '2', title: 'B', theme: null, mode: 'async', questions: 5 },
      ]);
    });
  });

  describe('every catalog query is read-only and guest-agnostic', () => {
    it('issues only SELECT statements without guest identifiers', async () => {
      select.mockResolvedValue([]);

      await Promise.all([catalog.boutique(), catalog.spa(), catalog.tips(), catalog.activeQuizzes(), catalog.esg()]);

      expect(select).toHaveBeenCalledTimes(5);
      for (const [sql] of select.mock.calls) {
        expect(sql.trim()).toMatch(/^SELECT\b/i);
        expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|DROP)\b/i);
        expect(sql).not.toMatch(/hospede|participacao|pedido/i);
      }
    });
  });

  describe('boutique', () => {
    it('keeps only active rows from the query, with price null for 0 or missing', async () => {
      select.mockResolvedValue([
        { id: 1, name: 'Chapéu', category: 'Praia', price: '45.00' },
        { id: 2, name: 'Brinde', category: null, price: '0.00' },
        { id: 3, name: null, category: 'Praia', price: null },
        { id: 4, name: 'Errado', category: 'Praia', price: 'abc' },
      ]);

      await expect(catalog.boutique()).resolves.toEqual([
        { id: '1', name: 'Chapéu', category: 'Praia', price: 45 },
        { id: '2', name: 'Brinde', category: 'Boutique', price: null },
        { id: '3', name: 'Produto', category: 'Praia', price: null },
        { id: '4', name: 'Errado', category: 'Praia', price: null },
      ]);
      expect(sqlOf()).toMatch(/situacao_produto = 1/);
      expect(sqlOf()).toMatch(/situacao_categoriaproduto = 1/);
    });
  });

  describe('boutique cache', () => {
    afterEach(() => vi.useRealTimers());

    it('serves repeated reads from a 60 second cache, then reloads', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-23T15:00:00Z'));
      select.mockResolvedValue([{ id: 1, name: 'Chapéu', category: 'Praia', price: '45' }]);

      await catalog.boutique();
      await catalog.boutique();
      expect(select).toHaveBeenCalledOnce();

      vi.setSystemTime(new Date('2026-10-23T15:01:01Z'));
      await catalog.boutique();
      expect(select).toHaveBeenCalledTimes(2);
    });

    it('does not cache a failed load', async () => {
      select.mockRejectedValueOnce(new Error('snapshot indisponível')).mockResolvedValue([]);

      await expect(catalog.boutique()).rejects.toThrow('snapshot indisponível');
      await expect(catalog.boutique()).resolves.toEqual([]);
      expect(select).toHaveBeenCalledTimes(2);
    });
  });

  describe('spa', () => {
    it('never returns a price of 0: it becomes null and the text keeps the values', async () => {
      select.mockResolvedValue([
        { id: 1, name: 'Massagem Relaxante', category: 'Massagens', price: '0.00', details: '50 min R$ 250,00 30 min R$ 180,00' },
      ]);

      const [service] = await catalog.spa();

      expect(service.price).toBeNull();
      expect(service.details).toBe('50 min R$ 250,00; 30 min R$ 180,00');
    });

    it('reads a bare number as minutes and drops duplicated services', async () => {
      select.mockResolvedValue([
        { id: 1, name: 'Máscara Tensora', category: 'Facial', price: '90', details: '25' },
        { id: 2, name: 'Máscara Tensora', category: 'Facial', price: '90', details: '25' },
        { id: 3, name: 'Máscara Tensora', category: 'Corporal', price: null, details: null },
      ]);

      const services = await catalog.spa();

      expect(services).toHaveLength(2);
      expect(services[0]).toMatchObject({ price: 90, details: '25 min' });
    });
  });

  describe('tips', () => {
    it('turns ">" markers into a running text', async () => {
      select.mockResolvedValue([{ id: 1, title: 'Águas-vivas', description: 'Se tocar: > lave com água do mar > não use água doce' }]);

      const [tip] = await catalog.tips();

      expect(tip.title).toBe('Águas-vivas');
      expect(tip.description).not.toContain('>');
      expect(tip.description).toContain('lave com água do mar');
    });

    it('returns a null description when the text is empty', async () => {
      select.mockResolvedValue([{ id: 1, title: 'Henna', description: null }]);

      await expect(catalog.tips()).resolves.toEqual([{ id: '1', title: 'Henna', description: null }]);
    });
  });

  describe('esg', () => {
    it('keeps only rows with published text', async () => {
      select.mockResolvedValue([
        { title: 'ESG', description: 'Separamos resíduos.' },
        { title: 'Parceiro', description: '   ' },
        { title: 'Outro', description: null },
      ]);

      const result = await catalog.esg();

      expect(result).toEqual([{ title: 'ESG', description: 'Separamos resíduos.' }]);
      expect(sqlOf()).toMatch(/descricao_esg IS NOT NULL/);
    });
  });
});
