import type { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';

import type { GuestStay } from '../resort/guest-stay.service.js';
import type { ResortClock } from '../resort/resort-clock.service.js';

import { ExperienceBookingPreview } from './entities/experience-booking-preview.entity.js';
import { SimulatedExperienceBooking } from './entities/simulated-experience-booking.entity.js';
import type { ExperienceAvailabilityService } from './experience-availability.service.js';
import { ExperienceBookingService } from './experience-booking.service.js';
import type { ExperiencesCatalogService } from './experiences-catalog.service.js';
import type { ExperienceInfo, ExperienceSlot } from './experience.types.js';

const NOW = new Date('2026-10-23T12:00:00.000Z');
const guest = { resortId: 'demo', guestId: '11111111-1111-4111-8111-111111111111' };
const stay: GuestStay = {
  resortId: 'demo',
  holderId: guest.guestId,
  lodgingId: 77,
  checkIn: '2026-10-20',
  checkOut: '2026-10-28',
};
const CONV = '33333333-3333-4333-8333-333333333333';
const PREVIEW_ID = '44444444-4444-4444-8444-444444444444';

const experience: ExperienceInfo = {
  id: 'e1',
  title: 'Passeio de barco',
  description: '',
  notes: '',
  active: true,
  bookable: true,
  reservationType: 'reserva',
  minimumAge: null,
  minimumAgeAlone: null,
  requiresGuardian: false,
  bookingCutoff: null,
  prices: [
    { category: 'Adulto', price: 120 },
    { category: 'Criança', price: 60 },
  ],
};

const slot: ExperienceSlot = {
  experienceId: 'e1',
  availabilityId: 'a1',
  slotId: 's1',
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
};

function storedPreview(over: Record<string, unknown> = {}) {
  return {
    id: PREVIEW_ID,
    resortId: 'demo',
    guestId: guest.guestId,
    conversationId: CONV,
    lodgingId: 77,
    experienceId: 'e1',
    experienceTitle: 'Passeio de barco',
    availabilityId: 'a1',
    slotId: 's1',
    bookingDate: '2026-10-25',
    bookingTime: '10:00',
    adults: 2,
    children: 1,
    totalPrice: 300,
    currency: 'BRL',
    priceNote: null,
    status: 'pending',
    expiresAt: new Date(NOW.getTime() + 10 * 60_000),
    ...over,
  };
}

describe('ExperienceBookingService', () => {
  const repoInsert = vi.fn();
  const repoUpdate = vi.fn();
  const repoFind = vi.fn();
  const manager = {
    findOne: vi.fn(),
    findOneBy: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    query: vi.fn(),
  };
  const catalog = { findById: vi.fn() };
  const availability = { findSlots: vi.fn() };
  const clock = { today: vi.fn(), time: vi.fn() };
  let config: Record<string, string | undefined>;

  // QueryRunner dedicado da confirmação; registra a ordem das chamadas.
  const calls: string[] = [];
  const runner = {
    manager,
    isTransactionActive: false,
    connect: vi.fn(async () => undefined),
    startTransaction: vi.fn(async (level?: string) => {
      calls.push(`start:${level}`);
      runner.isTransactionActive = true;
    }),
    commitTransaction: vi.fn(async () => {
      calls.push('commit');
      runner.isTransactionActive = false;
    }),
    rollbackTransaction: vi.fn(async () => {
      calls.push('rollback');
      runner.isTransactionActive = false;
    }),
    release: vi.fn(async () => {
      calls.push('release');
    }),
    // Mesma conexão: RELEASE_LOCK aparece nas chamadas do manager.
    query: (sql: string, parameters?: unknown[]) => {
      calls.push(sql.includes('RELEASE_LOCK') ? 'release_lock' : 'query');
      return manager.query(sql, parameters);
    },
  };

  function build() {
    const dataSource = {
      getRepository: vi.fn(() => ({ insert: repoInsert, update: repoUpdate, find: repoFind })),
      createQueryRunner: vi.fn(() => runner),
    };
    const service = new ExperienceBookingService(
      dataSource as unknown as DataSource,
      catalog as unknown as ExperiencesCatalogService,
      availability as unknown as ExperienceAvailabilityService,
      clock as unknown as ResortClock,
      { get: (key: string) => config[key] } as unknown as ConfigService,
    );
    return { service, dataSource };
  }

  const request = {
    conversationId: CONV,
    experienceId: 'e1',
    date: '2026-10-25',
    time: '10:00' as string | null,
    party: { adults: 2, children: 1 },
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    config = {};
    for (const fn of [repoInsert, repoUpdate, repoFind, catalog.findById, availability.findSlots, clock.today]) {
      fn.mockReset();
    }
    for (const fn of Object.values(manager)) fn.mockReset();
    calls.length = 0;
    runner.isTransactionActive = false;
    clock.today.mockReturnValue('2026-10-23');
    clock.time.mockReturnValue('09:00');
    catalog.findById.mockResolvedValue(experience);
    availability.findSlots.mockResolvedValue([slot]);
    manager.query.mockImplementation((sql: string) =>
      sql.includes('GET_LOCK') ? Promise.resolve([{ acquired: 1 }]) : Promise.resolve([{}]),
    );
  });

  afterEach(() => vi.useRealTimers());

  describe('preview', () => {
    it('rejects when the experience does not exist', async () => {
      catalog.findById.mockResolvedValue(null);
      const { service } = build();

      const result = await service.preview(guest, stay, request);

      expect(result).toMatchObject({ status: 'rejected', code: 'experience_not_found' });
      expect(repoInsert).not.toHaveBeenCalled();
    });

    it('rejects on rule violations with options and does not persist', async () => {
      availability.findSlots.mockResolvedValue([slot, { ...slot, availabilityId: 'a2', time: '14:00' }]);
      const { service } = build();

      const result = await service.preview(guest, stay, { ...request, time: null });

      expect(result).toMatchObject({ status: 'rejected', code: 'time_required', options: ['10:00', '14:00'] });
      expect(repoInsert).not.toHaveBeenCalled();
    });

    it('rejects when capacity is exceeded', async () => {
      availability.findSlots.mockResolvedValue([{ ...slot, remaining: 1 }]);
      const { service } = build();

      expect(await service.preview(guest, stay, request)).toMatchObject({
        status: 'rejected',
        code: 'capacity_exceeded',
      });
    });

    it('rejects a preview for a time of today that already passed', async () => {
      const { service } = build();
      clock.today.mockReturnValue('2026-10-25');
      clock.time.mockReturnValue('11:04');

      const result = await service.preview(guest, stay, request);

      expect(result).toMatchObject({ status: 'rejected', code: 'time_in_past' });
      expect(repoInsert).not.toHaveBeenCalled();
    });

    it('creates a preview with server computed price, slot and default TTL', async () => {
      const { service } = build();

      const result = await service.preview(guest, stay, {
        ...request,
        // the client cannot choose price or slot: only these inputs exist
      });

      expect(result.status).toBe('created');
      if (result.status !== 'created') return;

      expect(result.expiresAt.getTime()).toBe(NOW.getTime() + 15 * 60_000);
      expect(result.summary).toMatchObject({
        experienceId: 'e1',
        date: '2026-10-25',
        time: '10:00',
        adults: 2,
        children: 1,
        totalPrice: 300,
        currency: 'BRL',
        simulated: true,
      });
      expect(repoInsert).toHaveBeenCalledTimes(1);
      expect(repoInsert.mock.calls[0][0]).toMatchObject({
        id: result.previewId,
        resortId: 'demo',
        guestId: guest.guestId,
        conversationId: CONV,
        lodgingId: 77,
        availabilityId: 'a1',
        slotId: 's1',
        totalPrice: 300,
        status: 'pending',
      });
      expect(result.previewId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('honors BOOKING_PREVIEW_TTL_MINUTES within bounds and falls back otherwise', async () => {
      for (const [value, minutes] of [['5', 5], ['0', 15], ['500', 15], ['abc', 15], ['1.5', 15]] as const) {
        config.BOOKING_PREVIEW_TTL_MINUTES = value;
        const { service } = build();
        const result = await service.preview(guest, stay, request);
        expect(result.status === 'created' && result.expiresAt.getTime()).toBe(NOW.getTime() + minutes * 60_000);
      }
    });

    it('stores a null price with a note when the price cannot be computed', async () => {
      catalog.findById.mockResolvedValue({ ...experience, prices: [{ category: 'Casal', price: 300 }] });
      const { service } = build();

      const result = await service.preview(guest, stay, { ...request, party: { adults: 2, children: 0 } });

      expect(result.status).toBe('created');
      expect(repoInsert.mock.calls[0][0].totalPrice).toBeNull();
      expect(repoInsert.mock.calls[0][0].priceNote).toBeTruthy();
    });

    it('propagates database failures', async () => {
      repoInsert.mockImplementation(async () => {
        throw new Error('db down');
      });
      const { service } = build();

      await expect(service.preview(guest, stay, request)).rejects.toThrow('db down');
    });
  });

  describe('confirm', () => {
    const confirm = () => build().service.confirm(guest, stay, CONV, PREVIEW_ID);

    it('looks up the preview scoped by owner and conversation', async () => {
      manager.findOne.mockResolvedValue(null);

      await confirm();

      expect(manager.findOne).toHaveBeenCalledWith(
        ExperienceBookingPreview,
        expect.objectContaining({
          where: { id: PREVIEW_ID, resortId: 'demo', guestId: guest.guestId, conversationId: CONV },
          lock: { mode: 'pessimistic_write' },
        }),
      );
    });

    it('returns not_found when the preview is missing (other owner)', async () => {
      manager.findOne.mockResolvedValue(null);

      expect(await confirm()).toMatchObject({ status: 'not_found' });
      expect(manager.insert).not.toHaveBeenCalled();
    });

    it('returns not_found for another lodging', async () => {
      manager.findOne.mockResolvedValue(storedPreview({ lodgingId: 999 }));

      expect(await confirm()).toMatchObject({ status: 'not_found' });
      expect(manager.insert).not.toHaveBeenCalled();
    });

    it('is idempotent for already confirmed previews', async () => {
      manager.findOne.mockResolvedValue(storedPreview({ status: 'confirmed' }));
      manager.findOneBy.mockResolvedValue({
        id: 'b1',
        confirmationCode: 'SIM-ABCDEFGH',
        experienceId: 'e1',
        experienceTitle: 'Passeio de barco',
        bookingDate: '2026-10-25',
        bookingTime: '10:00',
        adults: 2,
        children: 1,
        totalPrice: 300,
      });

      const result = await confirm();

      expect(result).toMatchObject({ status: 'already_confirmed', bookingId: 'b1', confirmationCode: 'SIM-ABCDEFGH' });
      expect(manager.findOneBy).toHaveBeenCalledWith(SimulatedExperienceBooking, { previewId: PREVIEW_ID });
      expect(manager.insert).not.toHaveBeenCalled();
      expect(manager.query).not.toHaveBeenCalled();
    });

    it('returns cancelled for cancelled previews', async () => {
      manager.findOne.mockResolvedValue(storedPreview({ status: 'cancelled' }));

      expect(await confirm()).toMatchObject({ status: 'cancelled' });
      expect(manager.insert).not.toHaveBeenCalled();
    });

    it('keeps a failed preview and its reason on a retried confirm', async () => {
      manager.findOne.mockResolvedValue(
        storedPreview({ status: 'failed', failureReason: 'O valor mudou desde a pré-reserva.' }),
      );

      expect(await confirm()).toMatchObject({ status: 'unavailable', message: 'O valor mudou desde a pré-reserva.' });
      expect(manager.update).not.toHaveBeenCalled();
      expect(manager.insert).not.toHaveBeenCalled();
    });

    it('marks expired previews as expired', async () => {
      manager.findOne.mockResolvedValue(
        storedPreview({ expiresAt: new Date(NOW.getTime() - 1000) }),
      );

      expect(await confirm()).toMatchObject({ status: 'expired' });
      expect(manager.update).toHaveBeenCalledWith(ExperienceBookingPreview, { id: PREVIEW_ID }, { status: 'expired' });
      expect(manager.insert).not.toHaveBeenCalled();
      expect(manager.query).not.toHaveBeenCalled();
    });

    it('treats a preview expiring exactly now as expired', async () => {
      manager.findOne.mockResolvedValue(storedPreview({ expiresAt: new Date(NOW.getTime()) }));
      expect(await confirm()).toMatchObject({ status: 'expired' });
    });

    it('treats a confirmed preview without booking as expired (no duplicate insert)', async () => {
      manager.findOne.mockResolvedValue(storedPreview({ status: 'confirmed' }));
      manager.findOneBy.mockResolvedValue(null);

      expect(await confirm()).toMatchObject({ status: 'expired' });
      expect(manager.insert).not.toHaveBeenCalled();
    });

    it('returns unavailable when the lock cannot be acquired', async () => {
      manager.findOne.mockResolvedValue(storedPreview());
      manager.query.mockImplementation(async () => [{ acquired: 0 }]);

      expect(await confirm()).toMatchObject({ status: 'unavailable' });
      expect(manager.insert).not.toHaveBeenCalled();
      // no lock held, so nothing to release
      expect(manager.query.mock.calls.some(([sql]) => String(sql).includes('RELEASE_LOCK'))).toBe(false);
    });

    it('returns unavailable and releases the lock when revalidation fails', async () => {
      manager.findOne.mockResolvedValue(storedPreview());
      availability.findSlots.mockResolvedValue([{ ...slot, remaining: 0 }]);

      expect(await confirm()).toMatchObject({ status: 'unavailable' });
      expect(manager.update).toHaveBeenCalledWith(ExperienceBookingPreview, { id: PREVIEW_ID }, {
        // A falha fica registrada com o motivo, para o card reaberto.
        status: 'failed',
        failureReason: expect.stringContaining('Não foi possível confirmar'),
      });
      expect(manager.insert).not.toHaveBeenCalled();
      expect(manager.query.mock.calls.some(([sql]) => String(sql).includes('RELEASE_LOCK'))).toBe(true);
    });

    it('does not confirm a preview whose time already passed (resort clock)', async () => {
      // Pré-reserva para hoje às 10:00; a confirmação chega às 10:30.
      clock.today.mockReturnValue('2026-10-25');
      clock.time.mockReturnValue('10:30');
      manager.findOne.mockResolvedValue(storedPreview());

      expect(await confirm()).toMatchObject({ status: 'unavailable', message: expect.stringContaining('já passou') });
      expect(manager.insert).not.toHaveBeenCalled();
      expect(manager.update).toHaveBeenCalledWith(ExperienceBookingPreview, { id: PREVIEW_ID }, {
        status: 'failed',
        failureReason: expect.stringContaining('já passou'),
      });
    });

    it('revalidates pinned to the stored slot and passes the manager', async () => {
      manager.findOne.mockResolvedValue(storedPreview());
      // another slot with more room must not be used: only the pinned one counts
      availability.findSlots.mockResolvedValue([
        { ...slot, availabilityId: 'other', slotId: 's9', remaining: 10 },
        { ...slot, remaining: 0 },
      ]);

      expect(await confirm()).toMatchObject({ status: 'unavailable' });
      expect(availability.findSlots).toHaveBeenCalledWith('2026-10-25', 'e1', manager);
    });

    it('returns changed when the price differs', async () => {
      manager.findOne.mockResolvedValue(storedPreview({ totalPrice: 250 }));

      expect(await confirm()).toMatchObject({ status: 'changed' });
      expect(manager.update).toHaveBeenCalledWith(ExperienceBookingPreview, { id: PREVIEW_ID }, {
        // A falha fica registrada com o motivo, para o card reaberto.
        status: 'failed',
        failureReason: expect.stringContaining('valor cadastrado mudou'),
      });
      expect(manager.insert).not.toHaveBeenCalled();
      expect(manager.query.mock.calls.some(([sql]) => String(sql).includes('RELEASE_LOCK'))).toBe(true);
    });

    it('confirms: inserts booking with SIM- code, marks preview confirmed, releases lock', async () => {
      manager.findOne.mockResolvedValue(storedPreview());

      const result = await confirm();

      expect(result.status).toBe('confirmed');
      if (result.status !== 'confirmed') return;
      expect(result.confirmationCode).toMatch(/^SIM-[A-HJ-NP-Z2-9]{8}$/);
      expect(result.summary).toMatchObject({ totalPrice: 300, adults: 2, children: 1, simulated: true });

      expect(manager.insert).toHaveBeenCalledTimes(1);
      const [entity, booking] = manager.insert.mock.calls[0];
      expect(entity).toBe(SimulatedExperienceBooking);
      expect(booking).toMatchObject({
        id: result.bookingId,
        previewId: PREVIEW_ID,
        confirmationCode: result.confirmationCode,
        resortId: 'demo',
        guestId: guest.guestId,
        lodgingId: 77,
        availabilityId: 'a1',
        slotId: 's1',
        totalPrice: 300,
        status: 'confirmed',
      });
      expect(manager.update).toHaveBeenCalledWith(ExperienceBookingPreview, { id: PREVIEW_ID }, { status: 'confirmed' });

      const sqls = manager.query.mock.calls.map(([sql]) => String(sql));
      expect(sqls[0]).toContain('GET_LOCK');
      expect(sqls.at(-1)).toContain('RELEASE_LOCK');
      // same lock name for acquire and release
      expect(manager.query.mock.calls[0][1]).toEqual(manager.query.mock.calls.at(-1)![1]);
    });

    it('uses a lock name derived from the slot (bounded length)', async () => {
      manager.findOne.mockResolvedValue(storedPreview());
      await confirm();
      const name = manager.query.mock.calls[0][1][0] as string;
      expect(name).toMatch(/^yago-exp-[0-9a-f]{40}$/);
      expect(name.length).toBeLessThanOrEqual(64);
    });

    it('propagates DB failures on insert and still releases the lock', async () => {
      manager.findOne.mockResolvedValue(storedPreview());
      manager.insert.mockImplementation(async () => {
        throw new Error('duplicate');
      });

      await expect(confirm()).rejects.toThrow('duplicate');
      expect(manager.update).not.toHaveBeenCalledWith(
        ExperienceBookingPreview,
        { id: PREVIEW_ID },
        { status: 'confirmed' },
      );
      expect(manager.query.mock.calls.some(([sql]) => String(sql).includes('RELEASE_LOCK'))).toBe(true);
    });

    it('releases the slot lock only after the commit, in a READ COMMITTED transaction', async () => {
      manager.findOne.mockResolvedValue(storedPreview());

      await confirm();

      expect(calls[0]).toBe('start:READ COMMITTED');
      expect(calls.indexOf('commit')).toBeLessThan(calls.indexOf('release_lock'));
      expect(calls.at(-1)).toBe('release');
    });

    it('rolls back, releases the lock and the connection when the insert fails', async () => {
      manager.findOne.mockResolvedValue(storedPreview());
      manager.insert.mockImplementation(async () => {
        throw new Error('duplicate');
      });

      await expect(confirm()).rejects.toThrow('duplicate');
      expect(calls).toContain('rollback');
      expect(calls).not.toContain('commit');
      expect(calls.indexOf('rollback')).toBeLessThan(calls.indexOf('release_lock'));
      expect(calls.at(-1)).toBe('release');
    });

    it('returns not_found when the preview date is outside the current stay', async () => {
      manager.findOne.mockResolvedValue(storedPreview({ bookingDate: '2026-12-01' }));

      expect(await confirm()).toMatchObject({ status: 'not_found' });
      expect(manager.insert).not.toHaveBeenCalled();
    });

    it('propagates DB failures on lookup', async () => {
      manager.findOne.mockImplementation(async () => {
        throw new Error('db down');
      });
      await expect(confirm()).rejects.toThrow('db down');
    });
  });

  describe('cancelPreview', () => {
    it('cancels only pending previews of the owner and reports whether it changed', async () => {
      const { service } = build();
      repoUpdate.mockResolvedValueOnce({ affected: 1 }).mockResolvedValueOnce({ affected: 0 });

      expect(await service.cancelPreview(guest, CONV, PREVIEW_ID)).toBe(true);
      expect(repoUpdate).toHaveBeenCalledWith(
        { id: PREVIEW_ID, resortId: 'demo', guestId: guest.guestId, conversationId: CONV, status: 'pending' },
        { status: 'cancelled' },
      );
      expect(await service.cancelPreview(guest, CONV, PREVIEW_ID)).toBe(false);
    });
  });

  describe('listSimulated', () => {
    it('scopes by owner and lodging and filters to the stay window', async () => {
      const { service } = build();
      repoFind.mockResolvedValue([
        { id: 'in', bookingDate: '2026-10-25' },
        { id: 'before', bookingDate: '2026-10-19' },
        { id: 'after', bookingDate: '2026-10-29' },
        { id: 'edge', bookingDate: '2026-10-28' },
      ]);

      const result = await service.listSimulated(guest, stay);

      expect(result.map((b) => b.id)).toEqual(['in', 'edge']);
      expect(repoFind.mock.calls[0][0].where).toEqual({
        resortId: 'demo',
        guestId: guest.guestId,
        lodgingId: 77,
        status: 'confirmed',
      });
    });
  });

  describe('cards', () => {
    const BOOKING = '7a7b7c7d-1111-4222-8333-444455556666';
    const ids = { pending: 'p1', late: 'p2', failed: 'p3', cancelled: 'p4', confirmed: 'p5' };

    it('maps every stored preview to the current card status, scoped to the owner and conversation', async () => {
      const { service } = build();
      const future = new Date(NOW.getTime() + 60_000);
      const past = new Date(NOW.getTime() - 60_000);
      repoFind
        .mockResolvedValueOnce([
          storedPreview({ id: ids.pending, status: 'pending', expiresAt: future }),
          storedPreview({ id: ids.late, status: 'pending', expiresAt: past }),
          storedPreview({ id: ids.failed, status: 'failed', failureReason: 'Não foi possível confirmar: sem vagas.' }),
          storedPreview({ id: ids.cancelled, status: 'cancelled' }),
          storedPreview({ id: ids.confirmed, status: 'confirmed' }),
        ])
        .mockResolvedValueOnce([{ id: BOOKING, previewId: ids.confirmed, confirmationCode: 'SIM-AAAA1111' }]);

      const cards = await service.cards(guest, CONV, Object.values(ids));

      expect(cards.map(({ previewId, status }) => [previewId, status])).toEqual([
        [ids.pending, 'preview'],
        [ids.late, 'expired'],
        [ids.failed, 'failed'],
        [ids.cancelled, 'cancelled'],
        [ids.confirmed, 'confirmed'],
      ]);
      expect(cards[2].reason).toBe('Não foi possível confirmar: sem vagas.');
      expect(cards[4].booking).toEqual({ bookingId: BOOKING, confirmationCode: 'SIM-AAAA1111' });
      expect(repoFind.mock.calls[0][0].where).toMatchObject({ resortId: 'demo', guestId: guest.guestId, conversationId: CONV });
    });

    it('does not query when there are no cards', async () => {
      const { service } = build();
      expect(await service.cards(guest, CONV, [])).toEqual([]);
      expect(repoFind).not.toHaveBeenCalled();
    });
  });
});
