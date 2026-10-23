import { InternalServerErrorException } from '@nestjs/common';

import type { RestaurantInfo } from '../resort/restaurants-catalog.service.js';

import type { OperationsToolRegistryService } from './operations-tool-registry.service.js';
import { RestaurantOperationsService } from './restaurant-operations.service.js';

const guest = { resortId: 'demo', guestId: '11111111-1111-4111-8111-111111111111' };

const restaurant = (over: Partial<RestaurantInfo>): RestaurantInfo => ({
  id: 'r1',
  name: 'Trattoria Bella',
  type: null,
  openingHours: '19h às 23h',
  description: '',
  location: null,
  acceptsReservations: true,
  minimumAge: null,
  reservationTimes: ['19:00', '21:00'],
  ...over,
});

const RESTAURANTS = [
  restaurant({ id: 'r1', name: 'Trattoria Bella' }),
  restaurant({ id: 'r2', name: 'Churrascaria Gaucha', reservationTimes: [] }),
  restaurant({ id: 'r3', name: 'Snack Piscina', acceptsReservations: false, openingHours: null }),
  restaurant({ id: 'r4', name: 'Sushi Sakura' }),
  restaurant({ id: 'r5', name: 'Sushi Zen' }),
];

describe('RestaurantOperationsService', () => {
  const execute = vi.fn();
  const service = new RestaurantOperationsService({ execute } as unknown as OperationsToolRegistryService);

  beforeEach(() => {
    execute.mockReset();
    execute.mockResolvedValue({ tool: 'restaurants.list', data: RESTAURANTS });
  });

  const onlyListTool = () => {
    for (const call of execute.mock.calls) {
      expect(call[0]).toBe('restaurants.list');
    }
  };

  it('single bookable match returns navigate with the real restaurantId and mentions dish selection', async () => {
    const result = await service.handleBooking('Quero reservar no Trattoria Bella hoje', guest);

    expect(result.tool).toBe('restaurants.list');
    expect(result.actions).toEqual([
      { type: 'navigate', label: 'Abrir Gastronomia', screen: 'Gastronomy', params: { restaurantId: 'r1' } },
    ]);
    expect(result.reply).toContain('selecionar os pratos');
    expect(result.reply).toContain('19:00, 21:00');
    expect(result.reply).toMatch(/não crio reservas/i);
    onlyListTool();
  });

  it('omits reservation times when none are registered', async () => {
    const result = await service.handleBooking('reservar na Churrascaria Gaucha', guest);
    expect(result.actions?.[0]).toMatchObject({ params: { restaurantId: 'r2' } });
    expect(result.reply).not.toContain('Horários de reserva');
  });

  it('non bookable restaurant explains and lists bookable ones', async () => {
    const result = await service.handleBooking('reservar o Snack Piscina', guest);

    expect(result.reply).toContain('não trabalha com reservas pelo aplicativo');
    expect(result.reply).toContain('Trattoria Bella');
    expect(result.reply).not.toContain('Snack Piscina, ');
    expect(result.actions).toEqual([
      expect.objectContaining({ type: 'navigate', params: { restaurantId: 'r3' } }),
    ]);
  });

  it('ambiguous matches ask which one and navigate without params', async () => {
    const result = await service.handleBooking('reservar no sushi', guest);

    expect(result.reply).toContain('mais de um restaurante');
    expect(result.reply).toContain('Sushi Sakura');
    expect(result.reply).toContain('Sushi Zen');
    expect(result.actions).toEqual([
      { type: 'navigate', label: 'Abrir Gastronomia', screen: 'Gastronomy', params: {} },
    ]);
  });

  it('no match navigates without params and lists bookable restaurants', async () => {
    const result = await service.handleBooking('quero reservar uma mesa', guest);

    expect(result.reply).toContain('Não identifiquei');
    expect(result.reply).toContain('Trattoria Bella');
    expect(result.reply).not.toContain('Snack Piscina');
    expect(result.actions).toEqual([
      { type: 'navigate', label: 'Abrir Gastronomia', screen: 'Gastronomy', params: {} },
    ]);
  });

  it('works when no restaurant accepts reservations', async () => {
    execute.mockResolvedValue({ tool: 'restaurants.list', data: [restaurant({ acceptsReservations: false })] });
    const result = await service.handleBooking('algo', guest);
    expect(result.reply).not.toContain('com reserva pelo aplicativo são');
  });

  it('never calls booking tools', async () => {
    await service.handleBooking('reservar no Trattoria Bella', guest);
    await service.handleBooking('reservar no sushi', guest);
    await service.handleBooking('nada', guest);
    await service.findMentioned('Trattoria Bella', guest);

    expect(execute.mock.calls.every(([name]) => name === 'restaurants.list')).toBe(true);
    expect(execute.mock.calls.some(([name]) => String(name).includes('booking'))).toBe(false);
  });

  it('findMentioned returns matched restaurants', async () => {
    const found = await service.findMentioned('e o Sushi Zen?', guest);
    expect(found.map((r) => r.id)).toEqual(['r5']);
    expect(await service.findMentioned('bom dia', guest)).toEqual([]);
  });

  it('rejects unexpected tool results', async () => {
    execute.mockResolvedValue({ tool: 'requests.list', data: [] });
    await expect(service.handleBooking('x', guest)).rejects.toThrow(InternalServerErrorException);
    await expect(service.findMentioned('x', guest)).rejects.toThrow(InternalServerErrorException);
  });

  it('propagates tool failures', async () => {
    execute.mockImplementation(async () => {
      throw new Error('db down');
    });
    await expect(service.handleBooking('x', guest)).rejects.toThrow('db down');
  });
});
