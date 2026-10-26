import { describe, expect, it } from 'vitest';

import {
  bookingCard,
  isValidChatAction,
  NAVIGATION_SCREENS,
  sanitizeActions,
  type ChatAction,
  type ExperienceBookingSummary,
} from './chat-actions.js';

const ID1 = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
const CONV = '33333333-3333-4333-8333-333333333333';

const summary = (over: Partial<ExperienceBookingSummary> = {}): ExperienceBookingSummary => ({
  experienceId: 'e1',
  experienceTitle: 'Passeio',
  date: '2026-10-25',
  time: '10:00',
  adults: 2,
  children: 1,
  totalPrice: 100,
  currency: 'BRL',
  priceNote: null,
  simulated: true,
  ...over,
});

// O card de reserva: um único cardId durante todo o ciclo.
const card = (status: 'preview' | 'confirmed' | 'expired' | 'failed' | 'cancelled' = 'preview') =>
  bookingCard({
    conversationId: CONV,
    previewId: ID1,
    status,
    summary: summary(),
    notes: ['Idade mínima: 4 anos.'],
    expiresAt: new Date('2026-10-23T12:00:00.000Z'),
    booking: { bookingId: ID2, confirmationCode: 'SIM-ABC123' },
    reason: 'A pré-reserva expirou.',
    updatedAt: new Date('2026-10-23T11:50:00.000Z'),
  });

const preview = (over: Record<string, unknown> = {}): ChatAction => ({ ...card('preview'), ...over }) as ChatAction;

const confirm = (over: Record<string, unknown> = {}): ChatAction => ({ ...card('confirmed'), ...over }) as ChatAction;

describe('isValidChatAction - navigate', () => {
  it('accepts with and without restaurantId', () => {
    expect(isValidChatAction({ type: 'navigate', label: 'Ver', screen: 'Gastronomy', params: {} })).toBe(true);
    expect(
      isValidChatAction({ type: 'navigate', label: 'Ver', screen: 'Gastronomy', params: { restaurantId: 'r1' } }),
    ).toBe(true);
    expect(NAVIGATION_SCREENS).toContain('Gastronomy');
  });

  it('rejects unknown screens, extra params and bad labels', () => {
    expect(
      isValidChatAction({ type: 'navigate', label: 'Ver', screen: 'Admin' as never, params: {} }),
    ).toBe(false);
    expect(
      isValidChatAction({
        type: 'navigate',
        label: 'Ver',
        screen: 'Gastronomy',
        params: { restaurantId: 'r1', url: 'http://evil' } as never,
      }),
    ).toBe(false);
    expect(isValidChatAction({ type: 'navigate', label: '', screen: 'Gastronomy', params: {} })).toBe(false);
    expect(
      isValidChatAction({ type: 'navigate', label: 'x'.repeat(61), screen: 'Gastronomy', params: {} }),
    ).toBe(false);
    expect(
      isValidChatAction({ type: 'navigate', label: 'Ver', screen: 'Gastronomy', params: { restaurantId: '' } }),
    ).toBe(false);
  });
});

describe('isValidChatAction - preview', () => {
  it('accepts a valid preview', () => {
    expect(isValidChatAction(preview())).toBe(true);
    expect(isValidChatAction(preview({ summary: summary({ time: null, totalPrice: null }) }))).toBe(true);
  });

  it('rejects a non UUID cardId', () => {
    expect(isValidChatAction(preview({ cardId: 'abc' }))).toBe(false);
  });

  it('rejects mismatched confirm.body.previewId', () => {
    const action = preview() as unknown as { confirm: { body: { previewId: string } } };
    action.confirm.body.previewId = ID2;
    expect(isValidChatAction(action as unknown as ChatAction)).toBe(false);
  });

  it('rejects invalid conversationId, path and expiresAt', () => {
    const bad = preview() as unknown as { confirm: { body: { conversationId: string } } };
    bad.confirm.body.conversationId = 'x';
    expect(isValidChatAction(bad as unknown as ChatAction)).toBe(false);
    expect(isValidChatAction(preview({ expiresAt: 'nope' }))).toBe(false);
    expect(
      isValidChatAction(preview({ confirm: { method: 'POST', path: '/other', body: { previewId: ID1, conversationId: CONV } } })),
    ).toBe(false);
  });

  it.each([
    ['simulated false', { simulated: false }],
    ['currency USD', { currency: 'USD' }],
    ['party zero', { adults: 0, children: 0 }],
    ['party above 10', { adults: 11, children: 0 }],
    ['negative adults', { adults: -1, children: 2 }],
    ['fractional', { adults: 1.5 }],
    ['bad date', { date: '25/10/2026' }],
    ['bad time', { time: '10h' }],
    ['negative price', { totalPrice: -1 }],
    ['NaN price', { totalPrice: Number.NaN }],
    ['empty title', { experienceTitle: ' ' }],
  ])('rejects summary with %s', (_name, over) => {
    expect(isValidChatAction(preview({ summary: summary(over as never) }))).toBe(false);
  });

  it('rejects a missing summary', () => {
    expect(isValidChatAction(preview({ summary: undefined }))).toBe(false);
  });
});

describe('isValidChatAction - confirm', () => {
  it('accepts a valid confirm', () => {
    expect(isValidChatAction(confirm())).toBe(true);
  });

  it('requires a UUID bookingId, a known status and a code', () => {
    expect(isValidChatAction(confirm({ booking: { bookingId: '123', confirmationCode: 'SIM-1' } }))).toBe(false);
    expect(isValidChatAction(confirm({ status: 'pending' }))).toBe(false);
    expect(isValidChatAction(confirm({ booking: { bookingId: ID2, confirmationCode: '' } }))).toBe(false);
    expect(isValidChatAction(confirm({ booking: { bookingId: ID2, confirmationCode: 'X'.repeat(21) } }))).toBe(false);
    expect(isValidChatAction(confirm({ booking: null }))).toBe(false);
  });
});

describe('bookingCard lifecycle', () => {
  it('keeps the same cardId in every state', () => {
    const ids = (['preview', 'confirmed', 'expired', 'failed', 'cancelled'] as const).map((status) => card(status).cardId);
    expect(new Set(ids)).toEqual(new Set([ID1]));
  });

  it('offers buttons and expiry only while in preview', () => {
    expect(card('preview')).toMatchObject({ status: 'preview', expiresAt: '2026-10-23T12:00:00.000Z', booking: null, reason: null });
    expect(card('preview').confirm?.body).toEqual({ type: 'experience.booking.confirm', conversationId: CONV, previewId: ID1 });
    expect(card('preview').cancel?.body).toEqual({ type: 'experience.booking.cancel', conversationId: CONV, previewId: ID1 });

    for (const status of ['confirmed', 'expired', 'failed', 'cancelled'] as const) {
      expect(card(status)).toMatchObject({ confirm: null, cancel: null, expiresAt: null });
      expect(isValidChatAction(card(status))).toBe(true);
    }
  });

  it('exposes the booking only when confirmed and a reason only when it did not succeed', () => {
    expect(card('confirmed')).toMatchObject({ booking: { bookingId: ID2, confirmationCode: 'SIM-ABC123' }, reason: null });
    expect(card('failed')).toMatchObject({ booking: null, reason: 'A pré-reserva expirou.' });
  });

  it('rejects buttons outside preview and a preview without buttons', () => {
    expect(isValidChatAction({ ...card('confirmed'), confirm: card('preview').confirm } as ChatAction)).toBe(false);
    expect(isValidChatAction({ ...card('preview'), cancel: null } as ChatAction)).toBe(false);
  });
});

describe('isValidChatAction - other', () => {
  it('drops unknown types and nullish', () => {
    expect(isValidChatAction({ type: 'open.url', label: 'x' } as never)).toBe(false);
    expect(isValidChatAction(undefined as never)).toBe(false);
    expect(isValidChatAction(null as never)).toBe(false);
  });
});

describe('sanitizeActions', () => {
  it('keeps only valid actions in order', () => {
    const nav: ChatAction = { type: 'navigate', label: 'Ver', screen: 'Gastronomy', params: {} };
    const result = sanitizeActions([nav, { type: 'bogus' } as never, preview(), confirm({ cardId: 'x' })]);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(nav);
  });

  it('handles undefined', () => {
    expect(sanitizeActions(undefined)).toEqual([]);
  });
});

describe('party size limit', () => {
  it('drops a summary with more than 10 participants', () => {
    const action = { ...card('confirmed'), summary: summary({ adults: 6, children: 6 }) };
    expect(isValidChatAction(action)).toBe(false);
  });
});

describe('experience.options', () => {
  const options = (over: Record<string, unknown> = {}): ChatAction =>
    ({
      type: 'experience.options',
      label: 'Escolher experiência',
      date: '2026-10-24',
      options: [
        { position: 1, experienceId: 'exp-1', title: 'City Tour', times: ['08:00'], summary: null, message: 'Opção 1' },
        { position: 2, experienceId: 'exp-2', title: 'Jaqueira', times: [], summary: null, message: 'Opção 2' },
      ],
      ...over,
    }) as ChatAction;

  it('accepts a numbered list of real options', () => {
    expect(isValidChatAction(options())).toBe(true);
    expect(isValidChatAction(options({ date: null }))).toBe(true);
  });

  it('accepts a verified summary for the card', () => {
    expect(
      isValidChatAction(
        options({
          options: [
            { position: 1, experienceId: 'exp-1', title: 'City Tour', times: ['08:00'], summary: '10 vagas para adultos', message: 'Opção 1' },
          ],
        }),
      ),
    ).toBe(true);
  });

  it.each<[string, Record<string, unknown>]>([
    ['an empty list', { options: [] }],
    ['an invalid date', { date: '24/10/2026' }],
    ['positions out of order', {
      options: [{ position: 2, experienceId: 'exp-1', title: 'City Tour', times: [], summary: null, message: 'Opção 2' }],
    }],
    ['an invalid time', {
      options: [{ position: 1, experienceId: 'exp-1', title: 'City Tour', times: ['8h'], summary: null, message: 'Opção 1' }],
    }],
    ['a missing summary', {
      options: [{ position: 1, experienceId: 'exp-1', title: 'City Tour', times: [], message: 'Opção 1' }],
    }],
    ['an oversized summary', {
      options: [{ position: 1, experienceId: 'exp-1', title: 'City Tour', times: [], summary: 'x'.repeat(161), message: 'Opção 1' }],
    }],
    ['a missing experience id', {
      options: [{ position: 1, experienceId: '', title: 'City Tour', times: [], summary: null, message: 'Opção 1' }],
    }],
  ])('rejects %s', (_label, over) => {
    expect(sanitizeActions([options(over)])).toEqual([]);
  });
});


describe('restaurant.options', () => {
  const option = (position: number, over: Record<string, unknown> = {}) => ({
    position,
    restaurantId: `r${position}`,
    name: `Restaurante ${position}`,
    type: 'restaurante',
    openingHours: '10h às 18h',
    location: 'Térreo',
    minimumAge: null,
    acceptsReservations: true,
    reservationTimes: ['19:00', '21:30'],
    message: `Opção ${position}`,
    ...over,
  });
  const action = (over: Record<string, unknown> = {}): ChatAction =>
    ({ type: 'restaurant.options', label: 'Gastronomia', options: [option(1), option(2, { type: 'bar' })], ...over }) as ChatAction;

  it('accepts a numbered list, with nullable cadastro fields', () => {
    expect(isValidChatAction(action())).toBe(true);
    expect(
      isValidChatAction(
        action({ options: [option(1, { type: null, openingHours: null, location: null, reservationTimes: [], acceptsReservations: false })] }),
      ),
    ).toBe(true);
    expect(isValidChatAction(action({ options: [option(1, { type: 'alimentacao', minimumAge: 12 })] }))).toBe(true);
  });

  it.each<[string, Record<string, unknown>]>([
    ['an empty list', { options: [] }],
    ['more than 20 options', { options: Array.from({ length: 21 }, (_, i) => option(i + 1)) }],
    ['a bad position', { options: [option(2)] }],
    ['positions out of order', { options: [option(1), option(3)] }],
    ['an invalid reservation time', { options: [option(1, { reservationTimes: ['7h'] })] }],
    ['an unknown type', { options: [option(1, { type: 'boate' })] }],
    ['a missing restaurant id', { options: [option(1, { restaurantId: '' })] }],
    ['a non-boolean acceptsReservations', { options: [option(1, { acceptsReservations: 'sim' })] }],
    ['an invalid minimum age', { options: [option(1, { minimumAge: 0 })] }],
    ['a message longer than 60 chars', { options: [option(1, { message: 'x'.repeat(61) })] }],
    ['an empty label', { label: '' }],
  ])('rejects %s', (_label, over) => {
    expect(sanitizeActions([action(over)])).toEqual([]);
  });

  it('accepts exactly 20 options', () => {
    expect(isValidChatAction(action({ options: Array.from({ length: 20 }, (_, i) => option(i + 1)) }))).toBe(true);
  });
});

describe('event.list', () => {
  const item = (over: Record<string, unknown> = {}) => ({
    eventId: 'ev1',
    kind: 'event',
    title: 'Show de Circo',
    date: '2026-10-26',
    time: '20:00',
    location: 'Anfiteatro',
    category: null,
    description: null,
    ...over,
  });
  const action = (over: Record<string, unknown> = {}): ChatAction =>
    ({ type: 'event.list', label: 'Programação', date: '2026-10-26', items: [item(), item({ eventId: 'l1', kind: 'leisure', time: null })], ...over }) as ChatAction;

  it('accepts events and leisure items, with null time', () => {
    expect(isValidChatAction(action())).toBe(true);
  });

  it.each<[string, Record<string, unknown>]>([
    ['an empty list', { items: [] }],
    ['more than 30 items', { items: Array.from({ length: 31 }, (_, i) => item({ eventId: `e${i}` })) }],
    ['an invalid action date', { date: '26/10/2026' }],
    ['an invalid item date', { items: [item({ date: '2026-13-01x' })] }],
    ['an invalid time', { items: [item({ time: '8h' })] }],
    ['an unknown kind', { items: [item({ kind: 'party' })] }],
    ['a missing event id', { items: [item({ eventId: '' })] }],
    ['an oversized description', { items: [item({ description: 'x'.repeat(241) })] }],
    ['an empty title', { items: [item({ title: '' })] }],
  ])('rejects %s', (_label, over) => {
    expect(sanitizeActions([action(over)])).toEqual([]);
  });

  it('accepts exactly 30 items', () => {
    expect(isValidChatAction(action({ items: Array.from({ length: 30 }, (_, i) => item({ eventId: `e${i}` })) }))).toBe(true);
  });
});
