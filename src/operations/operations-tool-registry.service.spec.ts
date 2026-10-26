import { BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { ResortClock } from '../resort/resort-clock.service.js';

import type { ExperienceAvailabilityService } from '../experiences/experience-availability.service.js';
import type { ExperienceBookingService } from '../experiences/experience-booking.service.js';
import type { ExperiencesCatalogService } from '../experiences/experiences-catalog.service.js';
import type { GuestContext } from '../guest/guest-context.js';
import type { GuestStay, GuestStayService } from '../resort/guest-stay.service.js';
import type { EventsCatalogService } from '../resort/events-catalog.service.js';
import type { RestaurantsCatalogService } from '../resort/restaurants-catalog.service.js';

import { OperationsToolRegistryService } from './operations-tool-registry.service.js';
import type { RequestsService } from './requests.service.js';
import type { ReservationsService } from './reservations.service.js';

const GUEST: GuestContext = {
  resortId: 'demo',
  guestId: '6f1c2a5e-8c1d-4b7a-9e2f-3a4b5c6d7e8f',
};

const STAY: GuestStay = {
  resortId: 'demo',
  holderId: GUEST.guestId,
  lodgingId: 1,
  checkIn: '2026-10-21',
  checkOut: '2026-10-25',
};

const CONVERSATION = '0b5c2a5e-8c1d-4b7a-9e2f-3a4b5c6d7e8f';
const PREVIEW = '1c5c2a5e-8c1d-4b7a-9e2f-3a4b5c6d7e8f';

describe('OperationsToolRegistryService', () => {
  const reservations = { listForGuest: vi.fn(async () => []) };
  const requests = { listForGuest: vi.fn(async () => []) };
  const restaurants = { listActive: vi.fn(async () => []) };
  const catalog = {
    listActive: vi.fn(async () => []),
    listAll: vi.fn(async () => []),
    findById: vi.fn(async () => null),
    listStayReservations: vi.fn(async () => []),
  };
  const availability = { findSlots: vi.fn(async () => []) };
  const booking = {
    preview: vi.fn(async () => ({ status: 'rejected', code: 'no_availability', message: 'x' })),
    confirm: vi.fn(async () => ({ status: 'not_found', message: 'x' })),
    cancelPreview: vi.fn(async () => true),
    listSimulated: vi.fn(async () => []),
  };
  const eventsCatalog = { forDate: vi.fn(async () => []) };
  const stay = { resolve: vi.fn(async () => STAY) };

  // Sexta-feira, 23/10/2026, 10:30 no resort.
  const clock = { today: () => '2026-10-23', time: () => '10:30' };

  function createRegistry(nodeEnv = 'development') {
    return new OperationsToolRegistryService(
      reservations as unknown as ReservationsService,
      requests as unknown as RequestsService,
      new ConfigService({ NODE_ENV: nodeEnv }),
      restaurants as unknown as RestaurantsCatalogService,
      catalog as unknown as ExperiencesCatalogService,
      availability as unknown as ExperienceAvailabilityService,
      booking as unknown as ExperienceBookingService,
      stay as unknown as GuestStayService,
      clock as unknown as ResortClock,
      eventsCatalog as unknown as EventsCatalogService,
    );
  }

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it.each(['production', 'test', ''])('fails closed when NODE_ENV is %j', async (env) => {
    await expect(createRegistry(env).execute('reservations.list', GUEST)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(reservations.listForGuest).not.toHaveBeenCalled();
  });

  it('requires a guest context', async () => {
    await expect(
      createRegistry().execute('reservations.list', { resortId: '', guestId: '' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects unknown tools, including SQL-like names', async () => {
    await expect(createRegistry().execute('DROP TABLE tb_hospede', GUEST)).rejects.toThrow(
      'Ferramenta não permitida.',
    );
  });

  it.each(['reservations.list', 'requests.list', 'experiences.reservations'])(
    '%s accepts no arguments',
    async (tool) => {
      await expect(createRegistry().execute(tool, GUEST, { guestId: 'other' })).rejects.toThrow(
        'Esta ferramenta não aceita argumentos.',
      );
    },
  );

  it.each<[string, Record<string, unknown>]>([
    ['experiences.list', { date: '24/10/2026' }],
    ['experiences.list', { sql: 'SELECT 1' }],
    ['restaurants.list', { guestId: 'other' }],
    ['restaurants.list', { type: 'boate' }],
    ['restaurants.list', { name: '' }],
    ['experiences.list', { period: 'madrugada' }],
    ['experiences.list', { after: '15h' }],
    ['experiences.list', { free: 'sim' }],
    ['experiences.list', { date: '2026-10-24', adults: 11 }],
    ['events.list', { date: '24/10/2026' }],
    ['events.list', { sql: 'SELECT 1' }],
    ['experiences.details', { experienceId: '' }],
    ['experiences.availability', { experienceId: 'exp-1', date: '2026-02-30' }],
    ['experiences.booking.preview', { conversationId: 'not-a-uuid', experienceId: 'e', date: '2026-10-24', adults: 2 }],
    ['experiences.booking.preview', { conversationId: CONVERSATION, experienceId: 'e', date: '2026-10-24', adults: 11 }],
    ['experiences.booking.preview', { conversationId: CONVERSATION, experienceId: 'e', date: '2026-10-24', adults: 2, time: '25:00' }],
    ['experiences.booking.preview', { conversationId: CONVERSATION, experienceId: 'e', date: '2026-10-24', adults: 2, price: 0 }],
    ['experiences.booking.confirm', { conversationId: CONVERSATION, previewId: 'x' }],
  ])('%s rejects invalid input %j', async (tool, input) => {
    await expect(createRegistry().execute(tool, GUEST, input)).rejects.toBeInstanceOf(BadRequestException);
    expect(booking.preview).not.toHaveBeenCalled();
    expect(booking.confirm).not.toHaveBeenCalled();
  });

  it('filters the restaurant catalog by type and by name, without SQL from the caller', async () => {
    const base = { openingHours: null, description: '', location: null, acceptsReservations: false, minimumAge: null, reservationTimes: [] };
    restaurants.listActive.mockResolvedValueOnce([
      { ...base, id: 'r1', name: 'Restaurante Central', type: 'restaurante' },
      { ...base, id: 'r2', name: 'Bar Mirante', type: 'bar' },
    ] as never).mockResolvedValueOnce([
      { ...base, id: 'r1', name: 'Restaurante Central', type: 'restaurante' },
      { ...base, id: 'r2', name: 'Bar Mirante', type: 'bar' },
    ] as never);

    const bars = await createRegistry().execute('restaurants.list', GUEST, { type: 'bar' });
    const byName = await createRegistry().execute('restaurants.list', GUEST, { name: 'central' });

    expect((bars.data as { id: string }[]).map(({ id }) => id)).toEqual(['r2']);
    expect((byName.data as { id: string }[]).map(({ id }) => id)).toEqual(['r1']);
  });

  it('lists events by date through the events catalog, read-only', async () => {
    const event = { id: 'e1', kind: 'event', title: 'Show de Circo', date: '2026-10-24', time: '20:00', location: null, category: null, description: null };
    eventsCatalog.forDate.mockResolvedValueOnce([event] as never);

    const result = await createRegistry().execute('events.list', GUEST, { date: '2026-10-24' });

    expect(result).toEqual({ tool: 'events.list', data: { date: '2026-10-24', events: [event] } });
    expect(eventsCatalog.forDate).toHaveBeenCalledExactlyOnceWith('2026-10-24');
    expect(createRegistry().listTools().find(({ name }) => name === 'events.list')?.readOnly).toBe(true);
  });

  it('resolves the stay on the server before previewing a booking', async () => {
    await createRegistry().execute('experiences.booking.preview', GUEST, {
      conversationId: CONVERSATION,
      experienceId: 'exp-1',
      date: '2026-10-24',
      time: '10:00',
      adults: 2,
      children: 1,
    });

    expect(stay.resolve).toHaveBeenCalledExactlyOnceWith(GUEST);
    expect(booking.preview).toHaveBeenCalledExactlyOnceWith(GUEST, STAY, {
      conversationId: CONVERSATION,
      experienceId: 'exp-1',
      date: '2026-10-24',
      time: '10:00',
      party: { adults: 2, children: 1 },
    });
  });

  it('confirms only by persisted preview reference', async () => {
    const result = await createRegistry().execute('experiences.booking.confirm', GUEST, {
      conversationId: CONVERSATION,
      previewId: PREVIEW,
    });

    expect(result.tool).toBe('experiences.booking.confirm');
    expect(booking.confirm).toHaveBeenCalledExactlyOnceWith(GUEST, STAY, CONVERSATION, PREVIEW);
  });

  it('lists availability only for a known experience', async () => {
    const result = await createRegistry().execute('experiences.availability', GUEST, {
      experienceId: 'missing',
      date: '2026-10-24',
    });

    expect(result).toEqual({
      tool: 'experiences.availability',
      data: { experience: null, date: '2026-10-24', slots: [] },
    });
    expect(availability.findSlots).not.toHaveBeenCalled();
  });

  it('declares write tools as not read-only', () => {
    const writable = createRegistry()
      .listTools()
      .filter(({ readOnly }) => !readOnly)
      .map(({ name }) => name);

    expect(writable).toEqual([
      'experiences.booking.preview',
      'experiences.booking.confirm',
      'experiences.booking.cancel',
    ]);
  });
});
