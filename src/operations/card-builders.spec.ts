import { isValidChatAction } from '../contracts/chat-actions.js';
import type { SimulatedExperienceBooking } from '../experiences/entities/simulated-experience-booking.entity.js';
import type { RestaurantInfo } from '../resort/restaurants-catalog.service.js';

import { bookingItems, bookingList, catalogList, fromBrazilianDate, menuView, requestItems, requestList } from './card-builders.js';

const RESTAURANT: RestaurantInfo = {
  id: 'rest-1',
  name: 'Omakase',
  type: 'restaurante',
  openingHours: null,
  description: '',
  location: null,
  acceptsReservations: true,
  minimumAge: null,
  reservationTimes: [],
};

describe('card builders', () => {
  it('converts the snapshot dd/mm/aaaa format to ISO date and time', () => {
    expect(fromBrazilianDate('24/10/2026 20:00')).toEqual({ date: '2026-10-24', time: '20:00' });
    expect(fromBrazilianDate('24/10/2026')).toEqual({ date: '2026-10-24', time: null });
    expect(fromBrazilianDate('data não informada')).toEqual({ date: null, time: null });
  });

  it('normalizes booking statuses, sorts chronologically and flags simulated bookings', () => {
    const simulated = {
      id: 'sim-1', experienceTitle: 'City Tour', bookingDate: '2026-10-24', bookingTime: '08:00', adults: 2, children: 1,
      status: 'confirmed', confirmationCode: 'SIM-AB12CD34',
    } as SimulatedExperienceBooking;

    const items = bookingItems({
      restaurants: [
        { id: 'r1', restaurantId: 'rest-1', restaurant: 'Omakase', date: '25/10/2026', time: '19:30', reservedAt: '', partySize: null, status: 'aprovada' },
        { id: 'r2', restaurantId: 'rest-1', restaurant: 'Omakase', date: '22/10/2026', time: null, reservedAt: '', partySize: 2, status: 'cancelada' },
      ],
      experiences: [{ id: 'x1', title: 'Jaqueira', date: '2026-10-24', time: null, status: 'pago', participants: 3 }],
      simulated: [simulated],
    });

    expect(items.map(({ bookingId, status, simulated: isSimulated, people }) => [bookingId, status, isSimulated, people])).toEqual([
      ['r2', 'cancelled', false, 2],
      ['sim-1', 'confirmed', true, 3],
      // Sem horário, depois dos horários do mesmo dia.
      ['x1', 'confirmed', false, 3],
      ['r1', 'confirmed', false, null],
    ]);
    // Simulada não tem tela no app oficial; as oficiais abrem Minhas Reservas na aba certa.
    expect(items[1].buttons).toEqual([]);
    expect(items[1].confirmationCode).toBe('SIM-AB12CD34');
    expect(items[2].buttons[0]).toMatchObject({ navigate: { screen: 'MyReservation', params: { tab: 'Experience' } } });
    expect(bookingList('Minhas reservas', items).every(isValidChatAction)).toBe(true);
  });

  it('maps an unknown booking status to "unknown" instead of guessing', () => {
    const [item] = bookingItems({
      restaurants: [],
      experiences: [{ id: 'x1', title: 'Jaqueira', date: '2026-10-24', time: null, status: 'finalizado', participants: 1 }],
      simulated: [],
    });
    expect(item).toMatchObject({ status: 'unknown', statusLabel: 'Status não informado' });
  });

  it('builds request items for departments (official and simulated) and leisure enrollments', () => {
    const items = requestItems(
      [
        { id: 's1', category: 'Governança', description: 'Toalha de banho; Travesseiro', status: 'executando', createdAt: '23/10/2026 09:15', updatedAt: null },
        { id: 's2', category: 'Manutenção', description: 'Itens não informados', status: 'simulada', createdAt: '23/10/2026 10:00', updatedAt: null, simulated: true, protocol: 'SIM-1234' },
      ],
      [{ id: 'l1', title: 'Hidroginástica', category: 'Adulto', status: 'negado', date: '2026-10-22' }],
    );

    expect(items.map(({ kind, status, items: names, simulated, protocol }) => [kind, status, names, simulated, protocol])).toEqual([
      ['department', 'in_progress', ['Toalha de banho', 'Travesseiro'], false, null],
      ['department', 'simulated', [], true, 'SIM-1234'],
      ['leisure', 'denied', ['Adulto'], false, null],
    ]);
    // "negado" também é o cancelamento feito pelo hóspede (R-LAZ-06).
    expect(items[2].statusLabel).toBe('Negada ou cancelada');
    expect(requestList('Minhas solicitações', items).every(isValidChatAction)).toBe(true);
  });

  it('limits dishes per category in the menu card and keeps the hidden count', () => {
    const dishes = Array.from({ length: 7 }, (_, index) => ({ id: `d${index}`, name: `Prato ${index}`, description: null, serves: null, image: null }));
    const [menu] = menuView(RESTAURANT, { restaurantId: 'rest-1', categories: [{ id: 'c1', name: 'Principal', dishes }] });

    expect(menu.categories[0].dishes).toHaveLength(5);
    expect(menu.categories[0].moreDishes).toBe(2);
    expect(menu.totalDishes).toBe(7);
    expect(menu.buttons.map((button) => (button.kind === 'navigate' ? button.navigate.screen : null))).toEqual(['Restaurant', 'Gastronomy']);
    expect(isValidChatAction(menu)).toBe(true);
    expect(menuView(RESTAURANT, { restaurantId: 'rest-1', categories: [] })).toEqual([]);
  });

  it('numbers catalog items and omits empty lists', () => {
    expect(catalogList('tip', 'Dicas', [])).toEqual([]);
    const [list] = catalogList('tip', 'Dicas', [
      { id: 'a', title: 'A', description: null, imagePath: null, meta: {}, badges: [], buttons: [] },
      { id: 'b', title: 'B', description: null, imagePath: null, meta: {}, badges: [], buttons: [] },
    ]);
    expect(list.items.map(({ position }) => position)).toEqual([1, 2]);
  });
});
