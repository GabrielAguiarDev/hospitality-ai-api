import type { GuestContext } from '../guest/guest-context.js';
import type { GuestStay, GuestStayService } from '../resort/guest-stay.service.js';
import type { ResortSnapshotGateway } from '../resort/resort-snapshot.gateway.js';

import { RequestsService } from './requests.service.js';

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

describe('RequestsService', () => {
  const select = vi.fn<ResortSnapshotGateway['select']>();
  const resolve = vi.fn<GuestStayService['resolve']>();

  const service = new RequestsService(
    { select } as unknown as ResortSnapshotGateway,
    { resolve } as unknown as GuestStayService,
  );

  beforeEach(() => {
    resolve.mockResolvedValue(STAY);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('filters requests by the stay party and stay window with bound parameters', async () => {
    select.mockResolvedValue([]);

    await service.listForGuest(GUEST);

    const [sql, parameters] = select.mock.calls[0];

    expect(parameters).toEqual([4321, '2026-10-25', '2026-10-21', '2026-10-21', '2026-10-25']);
    expect(sql).toMatch(/s\.id_hospede IN \(/);
    expect(sql).toMatch(/s\.data_solicitacao >= \?/);
    expect(sql).not.toContain(GUEST.guestId);
    expect(sql).toMatch(/LIMIT 20/);
  });

  it('never selects free-text observations or staff data', async () => {
    select.mockResolvedValue([]);

    await service.listForGuest(GUEST);

    const [sql] = select.mock.calls[0];
    expect(sql).not.toMatch(/obshospede|obscolaborador|imagem_solicitacao|id_colaborador|nome_hospede/);
  });

  it('maps department, items and real statuses to the operational contract', async () => {
    select.mockResolvedValue([
      {
        id: 'sol-1',
        department: 'Manutenção',
        items: 'Chuveiro; Lâmpada queimada',
        status: 'executando',
        createdAt: '22/10/2026 10:15',
      },
      {
        id: 'sol-2',
        department: null,
        items: null,
        status: 'atendida',
        createdAt: '21/10/2026 18:00',
      },
    ]);

    await expect(service.listForGuest(GUEST)).resolves.toEqual([
      {
        id: 'sol-1',
        category: 'Manutenção',
        description: 'Chuveiro; Lâmpada queimada',
        status: 'executando',
        createdAt: '22/10/2026 10:15',
        updatedAt: null,
      },
      {
        id: 'sol-2',
        category: 'Departamento não informado',
        description: 'Itens não informados',
        status: 'atendida',
        createdAt: '21/10/2026 18:00',
        updatedAt: null,
      },
    ]);
  });

  it('returns an empty list when there are no requests', async () => {
    select.mockResolvedValue([]);

    await expect(service.listForGuest(GUEST)).resolves.toEqual([]);
  });

  it('propagates database errors', async () => {
    select.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(service.listForGuest(GUEST)).rejects.toThrow('ECONNREFUSED');
  });
});
