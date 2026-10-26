import { describe, expect, it } from 'vitest';

import {
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

const preview = (over: Record<string, unknown> = {}): ChatAction =>
  ({
    type: 'experience.booking.preview',
    label: 'Confirmar',
    previewId: ID1,
    expiresAt: '2026-10-23T12:00:00.000Z',
    summary: summary(),
    confirm: {
      method: 'POST',
      path: '/chat/actions',
      body: { type: 'experience.booking.confirm', conversationId: CONV, previewId: ID1 },
    },
    ...over,
  }) as ChatAction;

const confirm = (over: Record<string, unknown> = {}): ChatAction =>
  ({
    type: 'experience.booking.confirm',
    label: 'Reserva confirmada',
    bookingId: ID2,
    confirmationCode: 'SIM-ABC123',
    status: 'confirmed',
    alreadyConfirmed: false,
    summary: summary(),
    ...over,
  }) as ChatAction;

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

  it('rejects a non UUID previewId', () => {
    expect(isValidChatAction(preview({ previewId: 'abc' }))).toBe(false);
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

  it('requires UUID bookingId, confirmed status, code', () => {
    expect(isValidChatAction(confirm({ bookingId: '123' }))).toBe(false);
    expect(isValidChatAction(confirm({ status: 'pending' }))).toBe(false);
    expect(isValidChatAction(confirm({ confirmationCode: '' }))).toBe(false);
    expect(isValidChatAction(confirm({ confirmationCode: 'X'.repeat(21) }))).toBe(false);
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
    const result = sanitizeActions([nav, { type: 'bogus' } as never, preview(), confirm({ bookingId: 'x' })]);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(nav);
  });

  it('handles undefined', () => {
    expect(sanitizeActions(undefined)).toEqual([]);
  });
});

describe('party size limit', () => {
  it('drops a summary with more than 10 participants', () => {
    const action = {
      type: 'experience.booking.confirm',
      label: 'Reserva simulada confirmada',
      bookingId: '2c5c2a5e-8c1d-4b7a-9e2f-3a4b5c6d7e8f',
      confirmationCode: 'SIM-AAAA1111',
      status: 'confirmed',
      alreadyConfirmed: false,
      summary: {
        experienceId: 'e', experienceTitle: 'E', date: '2026-10-24', time: null,
        adults: 6, children: 6, totalPrice: null, currency: 'BRL', priceNote: null, simulated: true,
      },
    } as const;
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
        { position: 1, experienceId: 'exp-1', title: 'City Tour', times: ['08:00'], message: 'Opção 1' },
        { position: 2, experienceId: 'exp-2', title: 'Jaqueira', times: [], message: 'Opção 2' },
      ],
      ...over,
    }) as ChatAction;

  it('accepts a numbered list of real options', () => {
    expect(isValidChatAction(options())).toBe(true);
    expect(isValidChatAction(options({ date: null }))).toBe(true);
  });

  it.each<[string, Record<string, unknown>]>([
    ['an empty list', { options: [] }],
    ['an invalid date', { date: '24/10/2026' }],
    ['positions out of order', {
      options: [{ position: 2, experienceId: 'exp-1', title: 'City Tour', times: [], message: 'Opção 2' }],
    }],
    ['an invalid time', {
      options: [{ position: 1, experienceId: 'exp-1', title: 'City Tour', times: ['8h'], message: 'Opção 1' }],
    }],
    ['a missing experience id', {
      options: [{ position: 1, experienceId: '', title: 'City Tour', times: [], message: 'Opção 1' }],
    }],
  ])('rejects %s', (_label, over) => {
    expect(sanitizeActions([options(over)])).toEqual([]);
  });
});
