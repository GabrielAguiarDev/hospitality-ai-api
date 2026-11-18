import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

import { GUEST_ID_PATTERN } from '../resort/guest-stay.service.js';

import type { GuestContext } from './guest-context.js';
import { requireConfiguredResortId } from './resort-config.js';

type GuestRequest = IncomingMessage & {
  guestContext?: GuestContext;
};

const DEFAULT_ALLOWED_HOSTS = 'localhost,127.0.0.1,[::1],10.0.2.2';

@Injectable()
export class DemoGuestGuard implements CanActivate {
  private readonly logger = new Logger(DemoGuestGuard.name);

  constructor(private readonly configService: ConfigService) {}

  private list(name: string, fallback = ''): Set<string> {
    return new Set(
      this.configService
        .get<string>(name, fallback)
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    );
  }

  private deny(reason: string): never {
    this.logger.warn(`Acesso de demonstração negado: ${reason}`);
    throw new UnauthorizedException('Acesso de demonstração não autorizado.');
  }

  canActivate(context: ExecutionContext): boolean {
    const env = this.configService.get<string>('NODE_ENV');

    const enabled = this.configService.get<string>('ENABLE_DEMO_GUEST_CONTEXT');

    if (env !== 'development' || enabled !== 'true') {
      this.deny('modo de demonstração desabilitado');
    }

    const request = context.switchToHttp().getRequest<GuestRequest>();

    const remoteAddress = request.socket.remoteAddress ?? '';
    console.log('[DemoGuestGuard] IP recebido:', remoteAddress);

    const clientIp = remoteAddress.startsWith('::ffff:')
      ? remoteAddress.slice(7)
      : remoteAddress;

    if (!this.list('DEMO_ALLOWED_CLIENT_IPS', '127.0.0.1,::1').has(clientIp)) {
      this.deny('IP não autorizado');
    }

    const host = (request.headers.host ?? '')
      .toLowerCase()
      .replace(/:\d+$/, '');

    if (!this.list('DEMO_ALLOWED_HOSTS', DEFAULT_ALLOWED_HOSTS).has(host)) {
      this.deny('host não autorizado');
    }

    if (
      request.headers['x-resort-id'] !== undefined ||
      request.headers['x-guest-id'] !== undefined
    ) {
      this.deny('identificadores não permitidos');
    }

    const secret = this.configService.get<string>('DEMO_SHARED_SECRET')?.trim();

    if (secret) {
      const provided = request.headers['x-demo-secret'];
      const expected = Buffer.from(secret);
      const received = Buffer.from(
        typeof provided === 'string' ? provided : '',
      );

      if (
        expected.length !== received.length ||
        !timingSafeEqual(expected, received)
      ) {
        this.deny('segredo de demonstração inválido');
      }
    }

    const header = request.headers['x-demo-guest-id'];

    const guestId =
      typeof header === 'string' ? header.trim().toLowerCase() : '';

    if (!GUEST_ID_PATTERN.test(guestId)) {
      this.deny('ID do hóspede ausente ou inválido');
    }

    const dynamicGuest =
      this.configService.get<string>('DEMO_DYNAMIC_GUEST_ENABLED') === 'true';

    if (!dynamicGuest && !this.list('DEMO_ALLOWED_GUEST_IDS').has(guestId)) {
      this.deny('hóspede fora da lista autorizada');
    }

    request.guestContext = {
      resortId: requireConfiguredResortId(
        this.configService.get<string>('RESORT_ID'),
      ),
      guestId,
    };

    return true;
  }
}
