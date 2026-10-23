import { describe, expect, it } from 'vitest';

import { quoteExperience } from './experience-pricing.js';
import type { ExperiencePrice } from './experience.types.js';

const exp = (
  reservationType: 'allinclusive' | 'reserva' | null,
  prices: ExperiencePrice[] = [],
) => ({ reservationType, prices });

describe('quoteExperience', () => {
  it('returns zero included total for allinclusive', () => {
    const q = quoteExperience(exp('allinclusive'), { adults: 2, children: 1 });
    expect(q.total).toBe(0);
    expect(q.included).toBe(true);
    expect(q.currency).toBe('BRL');
  });

  it('sums adults and children with the registered tariffs', () => {
    const prices = [
      { category: 'Adulto', price: 120 },
    ];
    expect(quoteExperience(exp('reserva', prices), { adults: 2, children: 0 }).total).toBe(240);

    const q = quoteExperience(
      exp('reserva', [
        { category: 'Adulto', price: 250 },
        { category: 'Criança', price: 125 },
      ]),
      { adults: 2, children: 1 },
    );
    expect(q.total).toBe(625);
    expect(q.adultUnit).toBe(250);
    expect(q.childUnit).toBe(125);
  });

  it('avoids floating point drift with cents', () => {
    const q = quoteExperience(
      exp('reserva', [
        { category: 'Adulto', price: 0.1 },
        { category: 'Criança', price: 0.2 },
      ]),
      { adults: 3, children: 3 },
    );
    expect(q.total).toBe(0.9);
  });

  it('returns null total when the adult price is missing', () => {
    const q = quoteExperience(exp('reserva', [{ category: 'Criança', price: 10 }]), {
      adults: 1,
      children: 0,
    });
    expect(q.total).toBeNull();
    expect(q.note).toMatch(/adultos/i);
  });

  it('returns null total with a note when child categories are ambiguous', () => {
    const q = quoteExperience(
      exp('reserva', [
        { category: 'Adulto', price: 100 },
        { category: 'Criança', price: 50 },
        { category: 'Criança -  free', price: 0 },
      ]),
      { adults: 1, children: 1 },
    );
    expect(q.total).toBeNull();
    expect(q.note).toMatch(/faixa etária/);
  });

  it('ambiguous child categories do not matter without children', () => {
    const q = quoteExperience(
      exp('reserva', [
        { category: 'Adulto', price: 100 },
        { category: 'Criança', price: 50 },
        { category: 'Criança -  free', price: 0 },
      ]),
      { adults: 2, children: 0 },
    );
    expect(q.total).toBe(200);
  });

  it('uses the free child tariff when it is the only one', () => {
    const q = quoteExperience(
      exp('reserva', [
        { category: 'Adulto', price: 100 },
        { category: 'Criança -  free', price: 0 },
      ]),
      { adults: 1, children: 2 },
    );
    expect(q.total).toBe(100);
    expect(q.childUnit).toBe(0);
  });

  it('returns null for package-only categories', () => {
    const q = quoteExperience(
      exp('reserva', [
        { category: 'Casal', price: 300 },
        { category: 'Família', price: 500 },
      ]),
      { adults: 2, children: 0 },
    );
    expect(q.total).toBeNull();
    expect(q.note).toContain('Casal');
  });

  it('returns null with a note for unknown or null reservation types', () => {
    expect(quoteExperience(exp(null), { adults: 1, children: 0 }).total).toBeNull();
    const q = quoteExperience(
      { reservationType: 'outro' as never, prices: [] },
      { adults: 1, children: 0 },
    );
    expect(q.total).toBeNull();
    expect(q.note).toBeTruthy();
  });
});
