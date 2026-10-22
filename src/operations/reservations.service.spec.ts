import { DataSource } from 'typeorm';

import type { GuestContext } from '../guest/guest-context.js';

import { ReservationsService } from './reservations.service.js';
import type { RestaurantReservation } from './reservations.service.js';

const GUEST: GuestContext = { resortId: 'resort-1', guestId: 'guest-001' };

describe('ReservationsService', () => {
  const query = vi.fn<DataSource['query']>();
  const service = new ReservationsService({ query } as unknown as DataSource);

  afterEach(() => {
    query.mockReset();
  });

  it('queries the given guest with bound parameters only', async () => {
    query.mockResolvedValue([]);

    await service.listForGuest(GUEST);

    expect(query).toHaveBeenCalledOnce();
    const [sql, parameters] = query.mock.calls[0];

    expect(parameters).toEqual(['resort-1', 'guest-001']);
    expect(sql).toMatch(/WHERE resort_id = \?\s+AND guest_id = \?/);
    expect(sql).not.toContain('guest-001');
    expect(sql).toMatch(/^\s*SELECT\b/);
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER)\b/i);
    expect(sql).toMatch(/LIMIT 20/);
  });

  it('returns the rows produced by the database unchanged', async () => {
    const rows: RestaurantReservation[] = [
      {
        id: 'res-1',
        restaurant: 'Trattoria Aurora',
        reservedAt: '24/10/2026 20:00',
        partySize: 4,
        status: 'confirmed',
      },
    ];
    query.mockResolvedValue(rows);

    await expect(service.listForGuest(GUEST)).resolves.toEqual(rows);
  });

  it('propagates database errors', async () => {
    query.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:3306'));

    await expect(service.listForGuest(GUEST)).rejects.toThrow('ECONNREFUSED');
  });
});
