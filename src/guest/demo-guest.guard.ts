
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

import { requireConfiguredResortId } from './resort-config.js';

type GuestRequest = IncomingMessage & {
  guestContext?: GuestContext;
};

@Injectable()
export class DemoGuestGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const env = this.configService.get<string>(
      'NODE_ENV',
    );

    const enabled = this.configService.get<string>(
      'ENABLE_DEMO_GUEST_CONTEXT',
    );

    // Nunca permitir o contexto fictício em produção.
    if (env !== 'development' || enabled !== 'true') {
      throw new UnauthorizedException(
        'Autenticação do hóspede não configurada.',
      );
    }

    const request = context
      .switchToHttp()
      .getRequest<GuestRequest>();

    const remoteAddress =
      request.socket.remoteAddress;

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

    // Impede que o cliente escolha outra identidade.
    if (
      request.headers['x-guest-id'] !== undefined ||
      request.headers['x-resort-id'] !== undefined
    ) {
      throw new UnauthorizedException(
        'Identificadores de hóspedes não são aceitos.',
      );
    }

    // Identifica o resort configurado no servidor.
    const resortId = requireConfiguredResortId(
      this.configService.get<string>('RESORT_ID'),
    );

    // O hóspede continua fictício até integrarmos
    // a validação do token do backend original.
    request.guestContext = {
      resortId,
      guestId: DEMO_GUEST_CONTEXT.guestId,
    };

    return true;
  }
}
