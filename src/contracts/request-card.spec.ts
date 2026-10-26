import {
  NAVIGATION_SCREENS,
  isValidChatAction,
  navigateAction,
  requestCard,
  sanitizeActions,
  type ChatAction,
  type GuestRequestCardAction,
  type GuestRequestSummary,
} from './chat-actions.js';

const ID = '11111111-1111-4111-8111-111111111111';
const CONV = '33333333-3333-4333-8333-333333333333';

const summary = (over: Partial<GuestRequestSummary> = {}): GuestRequestSummary => ({
  departmentId: '3',
  departmentName: 'Governança',
  items: [{ itemId: '30', name: 'Toalha de banho', quantity: 2 }],
  note: 'Quarto 12',
  simulated: true,
  ...over,
});

const card = (status: 'preview' | 'confirmed' | 'expired' | 'cancelled' = 'preview', over: Partial<Parameters<typeof requestCard>[0]> = {}) =>
  requestCard({
    conversationId: CONV,
    previewId: ID,
    status,
    summary: summary(),
    notes: ['Atendimento: Das 7h às 22h'],
    expiresAt: new Date('2026-10-23T12:00:00.000Z'),
    protocol: 'SIM-ABCD1234',
    reason: 'Descartada.',
    updatedAt: new Date('2026-10-23T11:50:00.000Z'),
    ...over,
  });

// Altera o card já montado para simular um servidor com defeito.
const tampered = (status: 'preview' | 'confirmed' | 'expired' | 'cancelled', over: Record<string, unknown>): ChatAction =>
  ({ ...card(status), ...over }) as ChatAction;

describe('requestCard', () => {
  it('builds a preview with confirm and cancel buttons bound to the same card', () => {
    const preview = card('preview');

    expect(preview).toMatchObject({
      type: 'request.card',
      cardId: ID,
      status: 'preview',
      label: 'Confirmar solicitação simulada',
      expiresAt: '2026-10-23T12:00:00.000Z',
      request: null,
      reason: null,
      confirm: { method: 'POST', path: '/chat/actions', body: { type: 'request.confirm', conversationId: CONV, previewId: ID } },
      cancel: { method: 'POST', path: '/chat/actions', body: { type: 'request.cancel', conversationId: CONV, previewId: ID } },
    });
  });

  it('carries the protocol only when confirmed and drops the buttons and expiry', () => {
    const confirmed = card('confirmed');

    expect(confirmed).toMatchObject({
      status: 'confirmed',
      request: { requestId: ID, protocol: 'SIM-ABCD1234' },
      confirm: null,
      cancel: null,
      expiresAt: null,
      reason: null,
    });
    expect(card('preview').request).toBeNull();
    expect(card('confirmed', { protocol: null }).request).toBeNull();
  });

  it.each(['expired', 'cancelled'] as const)('a %s card has the reason and no buttons', (status) => {
    expect(card(status)).toMatchObject({ status, confirm: null, cancel: null, expiresAt: null, request: null, reason: 'Descartada.' });
  });
});

describe('isValidChatAction - request.card', () => {
  it.each(['preview', 'confirmed', 'expired', 'cancelled'] as const)('accepts a valid %s card', (status) => {
    expect(isValidChatAction(card(status))).toBe(true);
  });

  it('accepts a card without a note and without department notices', () => {
    expect(isValidChatAction(card('preview', { summary: summary({ note: null }), notes: [] }))).toBe(true);
  });

  it.each([
    'SIM-',
    'SIM-abc',
    'SIM-ABC',
    'SIM-ABCDEFGHIJKLMNOPQ',
    'XYZ-ABCD1234',
    'SIM-ABCD 123',
    'SIM-ABCD-1234',
    '',
  ])('rejects the protocol %j', (protocol) => {
    expect(isValidChatAction(card('confirmed', { protocol }))).toBe(false);
  });

  it('accepts the protocol size limits (4 and 16)', () => {
    expect(isValidChatAction(card('confirmed', { protocol: 'SIM-ABCD' }))).toBe(true);
    expect(isValidChatAction(card('confirmed', { protocol: `SIM-${'A'.repeat(16)}` }))).toBe(true);
  });

  it('rejects a confirmed card without request, and a request on a non-confirmed card', () => {
    expect(isValidChatAction(tampered('confirmed', { request: null }))).toBe(false);
    for (const status of ['preview', 'expired', 'cancelled'] as const) {
      expect(isValidChatAction(tampered(status, { request: { requestId: ID, protocol: 'SIM-ABCD1234' } })), status).toBe(false);
    }
  });

  it('rejects a confirmed card whose requestId is not a UUID', () => {
    expect(isValidChatAction(tampered('confirmed', { request: { requestId: 'abc', protocol: 'SIM-ABCD1234' } }))).toBe(false);
  });

  it.each(['confirmed', 'expired', 'cancelled'] as const)('rejects buttons outside preview (%s)', (status) => {
    const base = card('preview');

    expect(isValidChatAction(tampered(status, { confirm: base.confirm }))).toBe(false);
    expect(isValidChatAction(tampered(status, { cancel: base.cancel }))).toBe(false);
  });

  it('rejects a preview missing either button', () => {
    expect(isValidChatAction(tampered('preview', { confirm: null }))).toBe(false);
    expect(isValidChatAction(tampered('preview', { cancel: null }))).toBe(false);
  });

  it('rejects buttons that point to another card, another type or another path', () => {
    const base = card('preview') as GuestRequestCardAction;

    expect(isValidChatAction({ ...base, confirm: { ...base.confirm!, body: { ...base.confirm!.body, previewId: '44444444-4444-4444-8444-444444444444' } } })).toBe(false);
    expect(isValidChatAction({ ...base, confirm: { ...base.confirm!, body: { ...base.confirm!.body, type: 'request.cancel' } } } as unknown as ChatAction)).toBe(false);
    expect(isValidChatAction({ ...base, cancel: { ...base.cancel!, body: { ...base.cancel!.body, type: 'experience.booking.cancel' } } } as unknown as ChatAction)).toBe(false);
    expect(isValidChatAction({ ...base, cancel: { ...base.cancel!, path: '/admin' } } as unknown as ChatAction)).toBe(false);
    expect(isValidChatAction({ ...base, confirm: { ...base.confirm!, body: { ...base.confirm!.body, conversationId: 'nope' } } })).toBe(false);
  });

  it('rejects a cardId that is not a UUID and unknown statuses', () => {
    expect(isValidChatAction(tampered('preview', { cardId: 'x' }))).toBe(false);
    expect(isValidChatAction(tampered('preview', { status: 'failed' }))).toBe(false);
  });

  it('accepts at most 10 items, each with a quantity from 1 to 10', () => {
    const items = (count: number) => Array.from({ length: count }, (_, index) => ({ itemId: `${index}`, name: `Item ${index}`, quantity: 1 }));

    expect(isValidChatAction(card('preview', { summary: summary({ items: items(10) }) }))).toBe(true);
    expect(isValidChatAction(card('preview', { summary: summary({ items: items(11) }) }))).toBe(false);
    expect(isValidChatAction(card('preview', { summary: summary({ items: [] }) }))).toBe(false);
  });

  it.each([0, 11, -1, 1.5, Number.NaN])('rejects the item quantity %s', (quantity) => {
    expect(isValidChatAction(card('preview', { summary: summary({ items: [{ itemId: '30', name: 'Toalha', quantity }] }) }))).toBe(false);
  });

  it('rejects empty item names and ids', () => {
    expect(isValidChatAction(card('preview', { summary: summary({ items: [{ itemId: '', name: 'Toalha', quantity: 1 }] }) }))).toBe(false);
    expect(isValidChatAction(card('preview', { summary: summary({ items: [{ itemId: '1', name: '  ', quantity: 1 }] }) }))).toBe(false);
  });

  it('accepts a note of 200 characters and rejects 201', () => {
    expect(isValidChatAction(card('preview', { summary: summary({ note: 'n'.repeat(200) }) }))).toBe(true);
    expect(isValidChatAction(card('preview', { summary: summary({ note: 'n'.repeat(201) }) }))).toBe(false);
  });

  it('rejects a summary that is not marked as simulated', () => {
    expect(isValidChatAction(card('preview', { summary: { ...summary(), simulated: false } as never }))).toBe(false);
  });

  it('rejects more than 4 department notices and notices over 200 characters', () => {
    expect(isValidChatAction(card('preview', { notes: ['a', 'b', 'c', 'd', 'e'] }))).toBe(false);
    expect(isValidChatAction(card('preview', { notes: ['a'.repeat(201)] }))).toBe(false);
  });

  it('rejects invalid dates', () => {
    expect(isValidChatAction(tampered('preview', { expiresAt: 'ontem' }))).toBe(false);
    expect(isValidChatAction(tampered('preview', { updatedAt: 'agora' }))).toBe(false);
  });

  it('sanitizeActions keeps valid cards and drops the invalid ones', () => {
    const bad = tampered('confirmed', { request: null });

    expect(sanitizeActions([card('preview'), bad, card('cancelled')])).toEqual([card('preview'), card('cancelled')]);
  });
});

describe('isValidChatAction - navigate params per screen', () => {
  const navigate = (screen: string, params: Record<string, unknown>, label = 'Abrir') =>
    ({ type: 'navigate', label, screen, params }) as unknown as ChatAction;

  it('exposes exactly the module screens', () => {
    expect([...NAVIGATION_SCREENS].sort()).toEqual(
      ['Boutique', 'Esg', 'Events', 'Experiences', 'Gastronomy', 'Leisure', 'Quiz', 'Requests', 'Spa', 'Tips'],
    );
  });

  it.each([
    ['Requests', { departmentId: '3' }],
    ['Requests', {}],
    ['Gastronomy', { restaurantId: 'r-1' }],
    ['Experiences', { experienceId: 'exp_9' }],
    ['Boutique', {}],
    ['Spa', {}],
    ['Esg', {}],
    ['Tips', {}],
    ['Quiz', {}],
    ['Events', {}],
    ['Leisure', {}],
  ])('accepts %s with %j', (screen, params) => {
    expect(isValidChatAction(navigate(screen, params))).toBe(true);
  });

  it.each([
    ['Requests', { restaurantId: 'r1' }],
    ['Requests', { experienceId: 'e1' }],
    ['Gastronomy', { departmentId: '3' }],
    ['Experiences', { restaurantId: 'r1' }],
    ['Boutique', { departmentId: '3' }],
    ['Quiz', { quizId: '1' }],
    ['Events', { restaurantId: 'r1' }],
  ])('rejects %s with the foreign param %j', (screen, params) => {
    expect(isValidChatAction(navigate(screen, params))).toBe(false);
  });

  it.each(['Admin', 'Settings', '', 'requests', 'constructor', '__proto__'])('rejects the unknown screen %j', (screen) => {
    expect(isValidChatAction(navigate(screen, {}))).toBe(false);
    expect(isValidChatAction(navigate(screen, { departmentId: '3' }))).toBe(false);
  });

  it.each(['a b', '3 ', 'x/y', '../etc', '3;DROP', 'id\n', '', 'http://evil', 'a'.repeat(256)])('rejects the id %j', (id) => {
    expect(isValidChatAction(navigate('Requests', { departmentId: id }))).toBe(false);
  });

  it('rejects non-string ids', () => {
    expect(isValidChatAction(navigate('Requests', { departmentId: 3 }))).toBe(false);
    expect(isValidChatAction(navigate('Requests', { departmentId: null }))).toBe(false);
  });

  it('rejects labels that are empty or longer than 60 characters', () => {
    expect(isValidChatAction(navigate('Spa', {}, ''))).toBe(false);
    expect(isValidChatAction(navigate('Spa', {}, 'x'.repeat(61)))).toBe(false);
  });

  it('navigateAction builds a valid action, with params defaulting to {}', () => {
    expect(navigateAction('Requests', 'Abrir Solicitações')).toEqual({ type: 'navigate', label: 'Abrir Solicitações', screen: 'Requests', params: {} });
    expect(isValidChatAction(navigateAction('Requests', 'Abrir Solicitações', { departmentId: '3' }))).toBe(true);
  });
});
