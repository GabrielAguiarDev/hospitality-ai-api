
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IncomingMessage } from 'node:http';

import {
  DEMO_GUEST_CONTEXT,
  type GuestContext,
} from './guest-context.js';

type GuestRequest = IncomingMessage & {
  guestContext?: GuestContext;
};

@Injectable()
export class DemoGuestGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const env = this.configService.get<string>('NODE_ENV');
    const enabled = this.configService.get<string>(
      'ENABLE_DEMO_GUEST_CONTEXT',
    );

    if (env !== 'development' || enabled !== 'true') {
      throw new UnauthorizedException(
        'Autenticação do hóspede não configurada.',
      );
    }

    const request = context
      .switchToHttp()
      .getRequest<GuestRequest>();

    // Permite apenas requisições originadas
    // do próprio computador.
    const remoteAddress = request.socket.remoteAddress;

    const isLocal = [
      '127.0.0.1',
      '::1',
      '::ffff:127.0.0.1',
    ].includes(remoteAddress ?? '');

    if (!isLocal) {
      throw new UnauthorizedException(
        'Contexto de demonstração restrito ao localhost.',
      );
    }

    // Não aceita identidade declarada pelo cliente.
    if (
      request.headers['x-guest-id'] ||
      request.headers['x-resort-id']
    ) {
      throw new UnauthorizedException(
        'Identificadores de hóspedes não são aceitos.',
      );
    }

    request.guestContext = {
      ...DEMO_GUEST_CONTEXT,
    };

    return true;
  }
}
