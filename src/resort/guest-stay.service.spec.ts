import { ForbiddenException, InternalServerErrorException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import { GuestStayService } from './guest-stay.service.js';
import type { ResortClock } from './resort-clock.service.js';
import type { ResortSnapshotGateway } from './resort-snapshot.gateway.js';

const GUEST = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
const GUEST_LOWER = GUEST.toLowerCase();

describe('GuestStayService.resolve', () => {
  const select = vi.fn();
  const todayFn = vi.fn<() => string>();

  function build(config: Record<string, string | undefined> = {}) {
    const values: Record<string, string | undefined> = { RESORT_ID: 'demo', ...config };
    const configService = { get: (key: string) => values[key] } as unknown as ConfigService;
    return new GuestStayService(
      { select } as unknown as ResortSnapshotGateway,
      { today: todayFn } as unknown as ResortClock,
      configService,
    );
  }

  const row = (over: Record<string, unknown> = {}) => ({
    holderId: GUEST_LOWER,
    lodgingId: 77,
    checkIn: '2026-10-20',
    checkOut: '2026-10-28',
    ...over,
  });

  beforeEach(() => {
    select.mockReset();
    todayFn.mockReset().mockReturnValue('2026-10-23');
  });

  it('rejects a non UUID guestId without querying', async () => {
    await expect(build().resolve({ resortId: 'demo', guestId: 'guest-demo-001' })).rejects.toThrow(ForbiddenException);
    expect(select).not.toHaveBeenCalled();
  });

  it('rejects a resortId different from RESORT_ID without querying', async () => {
    await expect(build().resolve({ resortId: 'other', guestId: GUEST_LOWER })).rejects.toThrow(ForbiddenException);
    expect(select).not.toHaveBeenCalled();
  });

  it('fails when RESORT_ID is not configured', async () => {
    await expect(
      build({ RESORT_ID: '  ' }).resolve({ resortId: 'demo', guestId: GUEST_LOWER }),
    ).rejects.toThrow(InternalServerErrorException);
    expect(select).not.toHaveBeenCalled();
  });

  it('queries the holder with the lowercased id as a bound parameter', async () => {
    select.mockResolvedValue([row()]);

    const stay = await build().resolve({ resortId: 'demo', guestId: GUEST });

    expect(select).toHaveBeenCalledTimes(1);
    const [sql, params] = select.mock.calls[0];
    expect(sql).toContain('tb_hospede');
    expect(sql).toContain("tipo_hospede = 'titular'");
    expect(sql).not.toContain(GUEST_LOWER);
    expect(params).toEqual([GUEST_LOWER]);
    expect(stay).toEqual({
      resortId: 'demo',
      holderId: GUEST_LOWER,
      lodgingId: 77,
      checkIn: '2026-10-20',
      checkOut: '2026-10-28',
    });
  });

  it('rejects when there is no row, several rows or a null lodging', async () => {
    const guest = { resortId: 'demo', guestId: GUEST_LOWER };

    select.mockResolvedValueOnce([]);
    await expect(build().resolve(guest)).rejects.toThrow(ForbiddenException);

    select.mockResolvedValueOnce([row(), row()]);
    await expect(build().resolve(guest)).rejects.toThrow(ForbiddenException);

    select.mockResolvedValueOnce([row({ lodgingId: null })]);
    await expect(build().resolve(guest)).rejects.toThrow(ForbiddenException);

    select.mockResolvedValueOnce([row({ checkIn: null })]);
    await expect(build().resolve(guest)).rejects.toThrow(ForbiddenException);
  });

  it('rejects stays outside the window and allows the day before check-in', async () => {
    const guest = { resortId: 'demo', guestId: GUEST_LOWER };
    select.mockResolvedValue([row()]);

    todayFn.mockReturnValue('2026-10-18');
    await expect(build().resolve(guest)).rejects.toThrow(ForbiddenException);

    todayFn.mockReturnValue('2026-10-19');
    await expect(build().resolve(guest)).resolves.toMatchObject({ lodgingId: 77 });

    todayFn.mockReturnValue('2026-10-28');
    await expect(build().resolve(guest)).resolves.toBeDefined();

    todayFn.mockReturnValue('2026-10-29');
    await expect(build().resolve(guest)).rejects.toThrow(ForbiddenException);
  });

  it('ignores DEMO_REQUIRE_ACTIVE_STAY=false unless the dataset is synthetic', async () => {
    const guest = { resortId: 'demo', guestId: GUEST_LOWER };
    select.mockResolvedValue([row()]);
    todayFn.mockReturnValue('2027-01-01');

    await expect(build({ DEMO_REQUIRE_ACTIVE_STAY: 'false' }).resolve(guest)).rejects.toThrow(ForbiddenException);
    await expect(
      build({ DEMO_REQUIRE_ACTIVE_STAY: 'false', DEMO_DATASET: 'real' }).resolve(guest),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      build({ DEMO_REQUIRE_ACTIVE_STAY: 'false', DEMO_DATASET: 'synthetic' }).resolve(guest),
    ).resolves.toBeDefined();
    // synthetic alone does not disable the check
    await expect(build({ DEMO_DATASET: 'synthetic' }).resolve(guest)).rejects.toThrow(ForbiddenException);
  });
});
