
import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';

import type { GuestContext } from './guest-context.js';

interface GuestRequest {
  guestContext?: GuestContext;
}

export const CurrentGuest = createParamDecorator(
  (_data: unknown, context: ExecutionContext): GuestContext => {
    const request = context
      .switchToHttp()
      .getRequest<GuestRequest>();

    if (!request.guestContext) {
      throw new UnauthorizedException(
        'Contexto do hóspede não identificado.',
      );
    }

    return request.guestContext;
  },
);
