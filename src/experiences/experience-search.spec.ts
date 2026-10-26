import type { ExperienceInfo, ExperienceSlot } from './experience.types.js';
import {
  hasVacancy,
  matchesCatalogFilters,
  slotsMatching,
  timeWindowOf,
  welcomesChildren,
} from './experience-search.js';

const experience = (over: Partial<ExperienceInfo> = {}): ExperienceInfo => ({
  id: 'e1',
  title: 'Passeio',
  description: '',
  notes: '',
  active: true,
  bookable: true,
  reservationType: 'reserva',
  minimumAge: null,
  minimumAgeAlone: null,
  requiresGuardian: false,
  bookingCutoff: null,
  prices: [{ category: 'Adulto', price: 100 }],
  ...over,
});

const slot = (time: string | null, over: Partial<ExperienceSlot> = {}): ExperienceSlot => ({
  experienceId: 'e1',
  availabilityId: 'a1',
  slotId: time ? `h-${time}` : null,
  date: '2026-10-24',
  time,
  capacity: 10,
  adultCapacity: null,
  childCapacity: null,
  bookedAdults: 0,
  bookedChildren: 0,
  remaining: 10,
  remainingAdults: null,
  remainingChildren: null,
  ...over,
});

describe('experience search rules', () => {
  it('maps periods and ranges to [from, to) windows', () => {
    expect(timeWindowOf({ period: 'morning' })).toEqual({ from: '05:00', to: '12:00' });
    expect(timeWindowOf({ after: '15:00' })).toEqual({ from: '15:00', to: '24:00' });
    expect(timeWindowOf({ before: '10:00' })).toEqual({ from: '00:00', to: '10:00' });
    expect(timeWindowOf({ free: true })).toBeNull();
  });

  it('keeps day slots without a time and drops timed slots outside the window', () => {
    const slots = [slot('08:00'), slot('12:00'), slot(null)];
    expect(slotsMatching(slots, timeWindowOf({ period: 'morning' })).map(({ time }) => time)).toEqual(['08:00', null]);
    expect(slotsMatching(slots, timeWindowOf({ period: 'afternoon' })).map(({ time }) => time)).toEqual(['12:00', null]);
  });

  it('drops sold-out slots but keeps slots without a registered capacity', () => {
    expect(hasVacancy(slot('08:00', { remaining: 0 }))).toBe(false);
    expect(hasVacancy(slot('08:00', { remaining: null }))).toBe(true);
    expect(hasVacancy(slot(null, { remaining: null, remainingAdults: 0, remainingChildren: 0 }))).toBe(false);
    expect(hasVacancy(slot('08:00', { remaining: 3 }), { adults: 2, children: 2 })).toBe(false);
    expect(hasVacancy(slot('08:00', { remaining: null, remainingChildren: 0 }), { adults: 2, children: 1 })).toBe(false);
  });

  it('treats only all inclusive experiences as free', () => {
    expect(matchesCatalogFilters(experience({ reservationType: 'allinclusive' }), { free: true })).toBe(true);
    // Sem preço cadastrado não significa gratuito.
    expect(matchesCatalogFilters(experience({ reservationType: null, prices: [] }), { free: true })).toBe(false);
  });

  it('requires registered evidence that children take part', () => {
    expect(welcomesChildren(experience({ minimumAge: 4 }))).toBe(true);
    expect(welcomesChildren(experience({ prices: [{ category: 'Criança', price: 80 }] }))).toBe(true);
    expect(welcomesChildren(experience({ minimumAge: 12 }))).toBe(false);
    expect(welcomesChildren(experience())).toBe(false);
  });

  it('filters bookable experiences', () => {
    expect(matchesCatalogFilters(experience({ bookable: false }), { bookable: true })).toBe(false);
    expect(matchesCatalogFilters(experience(), { bookable: true })).toBe(true);
  });
});
