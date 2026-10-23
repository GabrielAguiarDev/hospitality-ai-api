import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IncomingMessage } from 'node:http';

import type { GuestContext } from './guest-context.js';
import { requireConfiguredResortId } from './resort-config.js';

type GuestRequest = IncomingMessage & {
  guestContext?: GuestContext;
};

@Injectable()
export class DemoGuestGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const env = this.configService.get<string>('NODE_ENV');

    const enabled = this.configService.get<string>('ENABLE_DEMO_GUEST_CONTEXT');

    const dynamicGuest = this.configService.get<string>(
      'DEMO_DYNAMIC_GUEST_ENABLED',
    );

    if (
      env !== 'development' ||
      enabled !== 'true' ||
      dynamicGuest !== 'true'
    ) {
      throw new UnauthorizedException('Modo de demonstração indisponível.');
    }

    const request = context.switchToHttp().getRequest<GuestRequest>();

    const remoteAddress = request.socket.remoteAddress ?? '';

    const clientIp = remoteAddress.startsWith('::ffff:')
      ? remoteAddress.slice(7)
      : remoteAddress;

    const allowedIps = new Set(
      this.configService
        .get<string>('DEMO_ALLOWED_CLIENT_IPS', '127.0.0.1,::1')
        .split(',')
        .map((ip) => ip.trim())
        .filter(Boolean),
    );

    if (!allowedIps.has(clientIp)) {
      throw new UnauthorizedException(
        'Dispositivo não autorizado para demonstração.',
      );
    }

    // Não permite que o cliente escolha um resort.
    if (
      request.headers['x-resort-id'] !== undefined ||
      request.headers['x-guest-id'] !== undefined
    ) {
      throw new UnauthorizedException('Identificadores não autorizados.');
    }

    const header = request.headers['x-demo-guest-id'];

    if (typeof header !== 'string' || !header.trim() || header.length > 255) {
      throw new UnauthorizedException('ID do hóspede não informado.');
    }

    request.guestContext = {
      resortId: requireConfiguredResortId(
        this.configService.get<string>('RESORT_ID'),
      ),
      guestId: header.trim(),
    };

    return true;
  }
}
