import { describe, expect, it } from 'vitest';

import {
  evaluateBooking,
  MAX_PARTY_SIZE,
  type BookingRuleInput,
} from './experience-rules.js';
import type { ExperienceInfo, ExperienceSlot } from './experience.types.js';

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
  prices: [],
  ...over,
});

const slot = (over: Partial<ExperienceSlot> = {}): ExperienceSlot => ({
  experienceId: 'e1',
  availabilityId: 'a1',
  slotId: null,
  date: '2026-10-25',
  time: '10:00',
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

const input = (over: Partial<BookingRuleInput> = {}): BookingRuleInput => ({
  experience: experience(),
  slots: [slot()],
  date: '2026-10-25',
  time: '10:00',
  party: { adults: 2, children: 0 },
  today: '2026-10-23',
  stay: { checkIn: '2026-10-20', checkOut: '2026-10-28' },
  ...over,
});

const code = (r: ReturnType<typeof evaluateBooking>) => (r.ok ? 'ok' : r.code);

describe('evaluateBooking', () => {
  it('accepts a valid booking', () => {
    const r = evaluateBooking(input());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.slot.availabilityId).toBe('a1');
      expect(r.capacityKnown).toBe(true);
    }
  });

  it('rejects inactive and non bookable experiences', () => {
    expect(code(evaluateBooking(input({ experience: experience({ active: false }) })))).toBe('experience_inactive');
    expect(code(evaluateBooking(input({ experience: experience({ bookable: false }) })))).toBe('experience_not_bookable');
  });

  it('rejects invalid parties', () => {
    for (const party of [
      { adults: 0, children: 0 },
      { adults: -1, children: 2 },
      { adults: 1.5, children: 0 },
      { adults: Number.NaN, children: 1 },
    ]) {
      expect(code(evaluateBooking(input({ party })))).toBe('party_invalid');
    }
  });

  it('rejects parties above the maximum and accepts exactly the maximum', () => {
    expect(
      code(evaluateBooking(input({ party: { adults: MAX_PARTY_SIZE, children: 1 } }))),
    ).toBe('party_too_large');
    expect(
      code(evaluateBooking(input({ party: { adults: MAX_PARTY_SIZE, children: 0 } }))),
    ).toBe('ok');
  });

  it('requires a guardian when the experience demands it', () => {
    const party = { adults: 0, children: 2 };
    expect(
      code(evaluateBooking(input({ party, experience: experience({ requiresGuardian: true }) }))),
    ).toBe('guardian_required');
    expect(
      code(evaluateBooking(input({ party, experience: experience({ minimumAgeAlone: 12 }) }))),
    ).toBe('guardian_required');
    expect(code(evaluateBooking(input({ party })))).toBe('ok');
  });

  it('rejects dates in the past and outside the stay', () => {
    expect(code(evaluateBooking(input({ date: '2026-10-22' })))).toBe('date_in_past');
    expect(code(evaluateBooking(input({ date: '2026-10-29' })))).toBe('date_outside_stay');
    expect(
      code(evaluateBooking(input({ date: '2026-10-23', stay: { checkIn: '2026-10-24', checkOut: '2026-10-28' } }))),
    ).toBe('date_outside_stay');
  });

  it('accepts check-in and check-out boundary dates', () => {
    const stay = { checkIn: '2026-10-25', checkOut: '2026-10-25' };
    expect(code(evaluateBooking(input({ stay })))).toBe('ok');
  });

  it('reports no availability for another date or experience', () => {
    expect(code(evaluateBooking(input({ slots: [slot({ date: '2026-10-26' })] })))).toBe('no_availability');
    expect(code(evaluateBooking(input({ slots: [slot({ experienceId: 'other' })] })))).toBe('no_availability');
    expect(code(evaluateBooking(input({ slots: [] })))).toBe('no_availability');
  });

  it('asks for the time with sorted options when several timed slots exist', () => {
    const r = evaluateBooking(
      input({
        time: null,
        slots: [slot({ time: '14:00', availabilityId: 'b' }), slot({ time: '10:00' }), slot({ time: '10:00', availabilityId: 'c' })],
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('time_required');
      expect(r.options).toEqual(['10:00', '14:00']);
    }
  });

  it('proceeds without time when there is a single timed option', () => {
    expect(code(evaluateBooking(input({ time: null })))).toBe('ok');
  });

  it('proceeds without time for untimed slots', () => {
    const r = evaluateBooking(input({ time: null, slots: [slot({ time: null })] }));
    expect(r.ok).toBe(true);
  });

  it('reports time_not_found with options', () => {
    const r = evaluateBooking(input({ time: '09:00' }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('time_not_found');
      expect(r.options).toEqual(['10:00']);
    }
  });

  it('rejects when total capacity is exceeded', () => {
    expect(
      code(evaluateBooking(input({ slots: [slot({ remaining: 1 })], party: { adults: 1, children: 1 } }))),
    ).toBe('capacity_exceeded');
  });

  it('rejects when adult or child capacity is exceeded', () => {
    expect(
      code(
        evaluateBooking(
          input({
            slots: [slot({ remaining: 10, remainingAdults: 1 })],
            party: { adults: 2, children: 0 },
          }),
        ),
      ),
    ).toBe('capacity_exceeded');
    expect(
      code(
        evaluateBooking(
          input({
            slots: [slot({ remaining: 10, remainingChildren: 0 })],
            party: { adults: 1, children: 1 },
          }),
        ),
      ),
    ).toBe('capacity_exceeded');
  });

  it('accepts exactly the remaining capacity', () => {
    expect(code(evaluateBooking(input({ slots: [slot({ remaining: 2 })] })))).toBe('ok');
  });

  it('accepts unknown capacity with a warning and capacityKnown false', () => {
    const r = evaluateBooking(
      input({ slots: [slot({ remaining: null, capacity: null })] }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.capacityKnown).toBe(false);
      expect(r.warnings.join(' ')).toMatch(/vagas não está cadastrada/);
    }
  });

  it('adds informational warnings from the experience', () => {
    const r = evaluateBooking(
      input({ experience: experience({ minimumAge: 8, minimumAgeAlone: 14, bookingCutoff: '09:00' }) }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings).toHaveLength(3);
      expect(r.warnings.join(' ')).toContain('8 anos');
      expect(r.warnings.join(' ')).toContain('09:00');
    }
  });

  it('picks deterministically the slot with the largest remaining, tie by availabilityId', () => {
    const slots = [
      slot({ availabilityId: 'z', remaining: 5 }),
      slot({ availabilityId: 'b', remaining: 8 }),
      slot({ availabilityId: 'a', remaining: 8 }),
      slot({ availabilityId: 'k', remaining: null }),
    ];
    for (const s of [slots, [...slots].reverse()]) {
      const r = evaluateBooking(input({ slots: s }));
      expect(r.ok && r.slot.availabilityId).toBe('a');
    }
  });

  it('skips slots that do not fit and uses one that does', () => {
    const r = evaluateBooking(
      input({
        slots: [
          slot({ availabilityId: 'small', remaining: 1 }),
          slot({ availabilityId: 'big', remaining: 4 }),
        ],
      }),
    );
    expect(r.ok && r.slot.availabilityId).toBe('big');
  });
});
