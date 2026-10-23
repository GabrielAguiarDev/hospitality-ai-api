import { ForbiddenException } from '@nestjs/common';

import type { GuestContext } from '../guest/guest-context.js';
import type { GuestStay, GuestStayService } from '../resort/guest-stay.service.js';
import type { ResortSnapshotGateway } from '../resort/resort-snapshot.gateway.js';

import { ReservationsService } from './reservations.service.js';

const GUEST: GuestContext = {
  resortId: 'resort-1',
  guestId: '6f1c2a5e-8c1d-4b7a-9e2f-3a4b5c6d7e8f',
};

const STAY: GuestStay = {
  resortId: 'resort-1',
  holderId: GUEST.guestId,
  lodgingId: 4321,
  checkIn: '2026-10-21',
  checkOut: '2026-10-25',
};

describe('ReservationsService', () => {
  const select = vi.fn<ResortSnapshotGateway['select']>();
  const resolve = vi.fn<GuestStayService['resolve']>();

  const service = new ReservationsService(
    { select } as unknown as ResortSnapshotGateway,
    { resolve } as unknown as GuestStayService,
  );

  beforeEach(() => {
    resolve.mockResolvedValue(STAY);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('queries the snapshot by lodging, stay window and stay party with bound parameters only', async () => {
    select.mockResolvedValue([]);

    await service.listForGuest(GUEST);

    expect(resolve).toHaveBeenCalledExactlyOnceWith(GUEST);
    expect(select).toHaveBeenCalledOnce();
    const [sql, parameters] = select.mock.calls[0];

    // Hospedagem + janela da estadia + hóspedes da mesma estadia.
    expect(parameters).toEqual([4321, '2026-10-21', '2026-10-25', 4321, '2026-10-25', '2026-10-21']);
    expect(sql).toMatch(/r\.idhospedagempms_reservarestaurante = \?/);
    expect(sql).toMatch(/r\.data_reservarestaurante BETWEEN \? AND \?/);
    expect(sql).toMatch(/r\.idtitular_reservarestaurante IN \(/);
    expect(sql).not.toContain(GUEST.guestId);
    expect(sql).not.toContain('4321');
    expect(sql).toMatch(/^\s*SELECT\b/);
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER)\b/i);
    expect(sql).toMatch(/LIMIT 20/);
    // Somente campos necessários: sem nome, telefone ou observações.
    expect(sql).not.toMatch(/nome_hospede|observacao|celular|dtnascimento/);
  });

  // IDs de hospedagem são reutilizados: no dia de troca, o hóspede que
  // sai ou o que entra não pode fazer parte da estadia atual.
  it('uses a strict stay overlap so previous or next occupants are excluded', async () => {
    select.mockResolvedValue([]);

    await service.listForGuest(GUEST);

    const [sql] = select.mock.calls[0];
    expect(sql).toMatch(/party\.dtcheckin_hospede < \?/);
    expect(sql).toMatch(/party\.dtcheckout_hospede > \?/);
  });

  it('maps snapshot rows to the operational contract', async () => {
    select.mockResolvedValue([
      {
        id: 'res-1',
        restaurantId: 'rest-1',
        restaurant: 'Gino Praia Gastronomia',
        date: '24/10/2026',
        time: '21:30',
        status: 'aprovada',
        diners: 5,
      },
      {
        id: 'res-2',
        restaurantId: 'rest-2',
        restaurant: 'Omakase',
        date: '25/10/2026',
        time: null,
        status: 'cancelada',
        diners: 0,
      },
    ]);

    await expect(service.listForGuest(GUEST)).resolves.toEqual([
      {
        id: 'res-1',
        restaurantId: 'rest-1',
        restaurant: 'Gino Praia Gastronomia',
        date: '24/10/2026',
        time: '21:30',
        reservedAt: '24/10/2026 21:30',
        partySize: 5,
        status: 'aprovada',
      },
      {
        id: 'res-2',
        restaurantId: 'rest-2',
        restaurant: 'Omakase',
        date: '25/10/2026',
        time: null,
        reservedAt: '25/10/2026',
        // Sem pedidos de pratos, a quantidade não é inventada.
        partySize: null,
        status: 'cancelada',
      },
    ]);
  });

  it('returns an empty list when the stay has no reservations', async () => {
    select.mockResolvedValue([]);

    await expect(service.listForGuest(GUEST)).resolves.toEqual([]);
  });

  it('does not query reservations when the stay cannot be resolved', async () => {
    resolve.mockRejectedValue(new ForbiddenException('Hospedagem não identificada.'));

    await expect(service.listForGuest(GUEST)).rejects.toBeInstanceOf(ForbiddenException);
    expect(select).not.toHaveBeenCalled();
  });

  it('propagates database errors', async () => {
    select.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:3308'));

    await expect(service.listForGuest(GUEST)).rejects.toThrow('ECONNREFUSED');
  });
});
