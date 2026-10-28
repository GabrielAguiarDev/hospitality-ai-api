import {
  isValidChatAction,
  navigateAction,
  navigateButton,
  sanitizeActions,
  type BookingListAction,
  type CatalogListAction,
  type ChatAction,
  type MenuViewAction,
  type RequestListAction,
} from './chat-actions.js';

// Exemplos no formato real enviado ao app (fixtures fictícias).
const CATALOG: CatalogListAction = {
  type: 'catalog.list',
  label: 'SPA',
  kind: 'spa_service',
  items: [
    {
      id: '1',
      position: 1,
      title: 'Massagem Relaxante',
      description: 'Massagem corporal com óleos.',
      imagePath: null,
      meta: { price: 'R$ 250,00', duration: '50 min', category: 'Massagens' },
      badges: [],
      buttons: [{ kind: 'message', label: 'Ver detalhes', message: 'Opção 1' }, navigateButton('Spa', 'Ver SPA')],
    },
  ],
};

const MENU: MenuViewAction = {
  type: 'menu.view',
  label: 'Cardápio: Omakase',
  restaurantId: 'rest-omakase',
  restaurantName: 'Omakase',
  totalDishes: 1,
  categories: [{ id: 'c1', name: 'Entrada', moreDishes: 0, dishes: [{ id: 'd1', name: 'Gyoza', description: null, serves: 2, imagePath: 'menu/a1.jpg' }] }],
  buttons: [navigateButton('Restaurant', 'Abrir no app', { restaurantId: 'rest-omakase' })],
};

const BOOKINGS: BookingListAction = {
  type: 'booking.list',
  label: 'Minhas reservas',
  items: [
    {
      bookingId: 'res-1', kind: 'restaurant', title: 'Omakase', date: '2026-10-24', time: '20:00', status: 'confirmed',
      statusLabel: 'Confirmada', people: 2, simulated: false, confirmationCode: null,
      buttons: [navigateButton('MyReservation', 'Ver em Minhas Reservas', { tab: 'Gastronomy' })],
    },
    {
      bookingId: 'res-1', kind: 'experience', title: 'City Tour', date: '2026-10-25', time: null, status: 'confirmed',
      statusLabel: 'Simulada (não oficial)', people: 2, simulated: true, confirmationCode: 'SIM-AB12CD34', buttons: [],
    },
  ],
};

const REQUESTS: RequestListAction = {
  type: 'request.list',
  label: 'Minhas solicitações',
  items: [
    {
      requestId: 's1', kind: 'department', title: 'Governança', items: ['Toalha de banho'], status: 'pending', statusLabel: 'Pendente',
      date: '2026-10-23', time: '09:15', simulated: false, protocol: null, buttons: [navigateButton('MyRequests', 'Ver em Minhas Solicitações')],
    },
    {
      requestId: 'l1', kind: 'leisure', title: 'Recreação: 4 a 7 anos', items: [], status: 'denied', statusLabel: 'Negada ou cancelada',
      date: '2026-10-22', time: null, simulated: false, protocol: null, buttons: [],
    },
  ],
};

const clone = <T>(value: T): T => structuredClone(value);

describe('new card actions (catalog.list, menu.view, booking.list, request.list)', () => {
  it.each([CATALOG, MENU, BOOKINGS, REQUESTS] as ChatAction[])('accepts a well-formed %s', (action) => {
    expect(isValidChatAction(action)).toBe(true);
  });

  it('rejects absolute URLs, traversal and nested paths as imagePath (only bucket-relative files)', () => {
    for (const imagePath of ['https://evil.example/x.jpg', 'menu/../../etc/passwd', '/menu/a.jpg', 'a.jpg', 'menu/a/b\\c.jpg']) {
      const menu = clone(MENU);
      menu.categories[0].dishes[0].imagePath = imagePath;
      expect(isValidChatAction(menu), imagePath).toBe(false);
    }
  });

  it('rejects buttons to unknown screens, unknown params or an invalid tab', () => {
    const bad = [
      { kind: 'navigate', label: 'x', navigate: { screen: 'Payments', params: {} } },
      { kind: 'navigate', label: 'x', navigate: { screen: 'MyReservation', params: { tab: 'Spa' } } },
      { kind: 'navigate', label: 'x', navigate: { screen: 'Spa', params: { url: 'https://x' } } },
      { kind: 'navigate', label: 'x', navigate: { screen: 'Events', params: { date: 'amanhã' } } },
      { kind: 'open_url', label: 'x', url: 'https://x' },
    ];
    for (const button of bad) {
      const catalog = clone(CATALOG);
      catalog.items[0].buttons = [button as never];
      expect(isValidChatAction(catalog), JSON.stringify(button)).toBe(false);
    }
  });

  it('requires positions in order and unique ids (stable card identity)', () => {
    const catalog = clone(CATALOG);
    catalog.items.push({ ...clone(CATALOG.items[0]), position: 2 });
    expect(isValidChatAction(catalog)).toBe(false);

    const shifted = clone(CATALOG);
    shifted.items[0].position = 2;
    expect(isValidChatAction(shifted)).toBe(false);

    // O mesmo ID em tipos diferentes de reserva é permitido; no mesmo tipo, não.
    const bookings = clone(BOOKINGS);
    bookings.items[1].kind = 'restaurant';
    expect(isValidChatAction(bookings)).toBe(false);
  });

  it('rejects unknown statuses and malformed dates in bookings and requests', () => {
    const booking = clone(BOOKINGS);
    (booking.items[0] as { status: string }).status = 'pago';
    expect(isValidChatAction(booking)).toBe(false);

    const request = clone(REQUESTS);
    request.items[0].date = '23/10/2026';
    expect(isValidChatAction(request)).toBe(false);
  });

  it('rejects unknown catalog kinds and empty lists', () => {
    expect(isValidChatAction({ ...CATALOG, kind: 'restaurant' } as never)).toBe(false);
    expect(isValidChatAction({ ...CATALOG, items: [] })).toBe(false);
    expect(isValidChatAction({ ...MENU, categories: [] })).toBe(false);
  });

  it('drops invalid actions instead of sending them to the app', () => {
    const broken = { ...BOOKINGS, items: [{ ...BOOKINGS.items[0], date: 'amanhã' }] };
    expect(sanitizeActions([CATALOG, broken, MENU])).toEqual([CATALOG, MENU]);
  });

  it('validates the new navigation screens and their params', () => {
    expect(isValidChatAction(navigateAction('Restaurant', 'Ver restaurante', { restaurantId: 'r1' }))).toBe(true);
    expect(isValidChatAction(navigateAction('Experience', 'Ver', { experienceId: 'e1' }))).toBe(true);
    expect(isValidChatAction(navigateAction('MyReservation', 'Abrir', { tab: 'Experience' }))).toBe(true);
    expect(isValidChatAction(navigateAction('MyRequests', 'Abrir'))).toBe(true);
    expect(isValidChatAction(navigateAction('MyFavorites', 'Abrir'))).toBe(true);
    expect(isValidChatAction(navigateAction('Events', 'Abrir', { date: '2026-10-24' }))).toBe(true);
    expect(isValidChatAction(navigateAction('MyRequests', 'Abrir', { departmentId: '3' } as never))).toBe(false);
    expect(isValidChatAction(navigateAction('Restaurant', 'Ver', { restaurantId: 'r 1; drop' }))).toBe(false);
  });
});
