import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import { DemoGuestGuard } from './demo-guest.guard.js';

const GUEST = '11111111-1111-4111-8111-111111111111';
const GENERIC = 'Acesso de demonstração não autorizado.';

type Config = Record<string, string | undefined>;

const baseConfig: Config = {
  NODE_ENV: 'development',
  ENABLE_DEMO_GUEST_CONTEXT: 'true',
  RESORT_ID: 'demo',
  DEMO_DYNAMIC_GUEST_ENABLED: 'true',
};

function run(
  config: Config = {},
  headers: Record<string, string | undefined> = {},
  remoteAddress: string | null = '127.0.0.1',
) {
  const values = { ...baseConfig, ...config };
  const guard = new DemoGuestGuard({
    get: (key: string, fallback?: string) => values[key] ?? fallback,
  } as unknown as ConfigService);

  const request: Record<string, unknown> = {
    headers: { host: 'localhost:3000', 'x-demo-guest-id': GUEST, ...headers },
    socket: { remoteAddress: remoteAddress ?? undefined },
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;

  return { request, result: () => guard.canActivate(context) };
}

function expectDenied(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as UnauthorizedException).message).toBe(GENERIC);
    return;
  }
  throw new Error('expected denial');
}

describe('DemoGuestGuard', () => {
  it('allows a valid local request and sets guestContext', () => {
    const { request, result } = run({}, { 'x-demo-guest-id': GUEST.toUpperCase() });
    expect(result()).toBe(true);
    expect(request.guestContext).toEqual({ resortId: 'demo', guestId: GUEST });
  });

  it('accepts IPv4-mapped IPv6 loopback and ::1', () => {
    expect(run({}, {}, '::ffff:127.0.0.1').result()).toBe(true);
    expect(run({}, {}, '::1').result()).toBe(true);
  });

  it('denies outside development', () => {
    expectDenied(run({ NODE_ENV: 'production' }).result);
    expectDenied(run({ NODE_ENV: undefined }).result);
  });

  it('denies when demo is disabled', () => {
    expectDenied(run({ ENABLE_DEMO_GUEST_CONTEXT: 'false' }).result);
    expectDenied(run({ ENABLE_DEMO_GUEST_CONTEXT: undefined }).result);
  });

  it('denies IPs that are not allowed', () => {
    expectDenied(run({}, {}, '203.0.113.5').result);
    expectDenied(run({}, {}, null).result);
    expectDenied(run({ DEMO_ALLOWED_CLIENT_IPS: '10.0.0.1' }, {}, '127.0.0.1').result);
    expect(run({ DEMO_ALLOWED_CLIENT_IPS: '10.0.0.1' }, {}, '10.0.0.1').result()).toBe(true);
  });

  it('denies hosts that are not allowed (DNS rebinding)', () => {
    expectDenied(run({}, { host: 'evil.example.com' }).result);
    expectDenied(run({}, { host: undefined }).result);
    expect(run({}, { host: '10.0.2.2:3000' }).result()).toBe(true);
    expect(run({}, { host: 'LOCALHOST' }).result()).toBe(true);
    expect(run({ DEMO_ALLOWED_HOSTS: 'api.local' }, { host: 'api.local:80' }).result()).toBe(true);
  });

  it('denies when client sends x-resort-id or x-guest-id', () => {
    expectDenied(run({}, { 'x-resort-id': 'other' }).result);
    expectDenied(run({}, { 'x-guest-id': GUEST }).result);
  });

  it('denies missing or invalid guest ids', () => {
    expectDenied(run({}, { 'x-demo-guest-id': undefined }).result);
    expectDenied(run({}, { 'x-demo-guest-id': 'guest-demo-001' }).result);
    expectDenied(run({}, { 'x-demo-guest-id': '1 OR 1=1' }).result);
    expectDenied(run({}, { 'x-demo-guest-id': '-1' }).result);
    expectDenied(run({}, { 'x-demo-guest-id': '' }).result);
  });

  it('accepts the numeric ids that exist in the snapshot (e.g. "1")', () => {
    const { result, request } = run({}, { 'x-demo-guest-id': ' 1 ' });
    expect(result()).toBe(true);
    expect(request.guestContext).toEqual({ resortId: 'demo', guestId: '1' });
  });

  it('validates DEMO_SHARED_SECRET when configured', () => {
    const config = { DEMO_SHARED_SECRET: 'topsecret' };
    expectDenied(run(config).result);
    expectDenied(run(config, { 'x-demo-secret': 'wrong' }).result);
    expectDenied(run(config, { 'x-demo-secret': 'topsecreT' }).result);
    expectDenied(run(config, { 'x-demo-secret': 'topsecret-longer' }).result);
    expect(run(config, { 'x-demo-secret': 'topsecret' }).result()).toBe(true);
  });

  it('ignores the secret header when none is configured', () => {
    expect(run({}, { 'x-demo-secret': 'anything' }).result()).toBe(true);
  });

  it('uses allowlist mode when dynamic guests are not enabled', () => {
    expectDenied(run({ DEMO_DYNAMIC_GUEST_ENABLED: 'false' }).result);
    expectDenied(run({ DEMO_DYNAMIC_GUEST_ENABLED: undefined, DEMO_ALLOWED_GUEST_IDS: '' }).result);
    expectDenied(
      run({ DEMO_DYNAMIC_GUEST_ENABLED: 'false', DEMO_ALLOWED_GUEST_IDS: '22222222-2222-4222-8222-222222222222' }).result,
    );
    expect(
      run({ DEMO_DYNAMIC_GUEST_ENABLED: 'false', DEMO_ALLOWED_GUEST_IDS: ` ${GUEST.toUpperCase()} ,other` }).result(),
    ).toBe(true);
  });

  it('does not set guestContext on denial', () => {
    const { request, result } = run({}, { 'x-demo-guest-id': 'bad' });
    expectDenied(result);
    expect(request.guestContext).toBeUndefined();
  });

  it('fails with a server error when RESORT_ID is missing', () => {
    expect(() => run({ RESORT_ID: '' }).result()).toThrow(/RESORT_ID/);
  });
});
