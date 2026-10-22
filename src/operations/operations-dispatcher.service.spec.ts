import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IntentDecision } from '../chat/chat-intent.types.js';

import type { GuestContext } from '../guest/guest-context.js';

import type { OperationsAiService } from './operations-ai.service.js';

import type { RequestsOperationsService } from './requests-operations.service.js';

import { OperationsDispatcherService } from './operations-dispatcher.service.js';

describe('OperationsDispatcherService', () => {
  // Contexto fictício utilizado exclusivamente nos testes.
  const GUEST: GuestContext = {
    resortId: 'demo',
    guestId: 'guest-demo-001',
  };

  const reservations = {
    ask: vi.fn(async () => ({
      reply: 'Reserva encontrada',
      toolUsed: true,
      toolRequestedByModel: false,
      reservationsFound: 1,
    })),
  };

  const requests = {
    ask: vi.fn(async () => 'Solicitação encontrada'),
  };

  const dispatcher = new OperationsDispatcherService(
    reservations as unknown as OperationsAiService,
    requests as unknown as RequestsOperationsService,
  );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['reservation.list', 'none'],
    ['reservation.details', 'party_size'],
    ['reservation.status', 'none'],
  ] as const)('routes %s to reservations.list', async (intent, detail) => {
    const decision: IntentDecision = {
      intent,
      detail,
    };

    const result = await dispatcher.dispatch('Minha reserva', decision, GUEST);

    expect(result.tool).toBe('reservations.list');
    expect(result.reply).toBe('Reserva encontrada');

    // Verifica que a identidade é propagada corretamente.
    expect(reservations.ask).toHaveBeenCalledWith(
      'Minha reserva',
      GUEST,
      decision,
    );

    expect(requests.ask).not.toHaveBeenCalled();
  });

  it.each(['request.list', 'request.status'] as const)(
    'routes %s to requests.list',
    async (intent) => {
      const decision: IntentDecision = {
        intent,
        detail: 'none',
      };

      const result = await dispatcher.dispatch(
        'Minha solicitação',
        decision,
        GUEST,
      );

      expect(result.tool).toBe('requests.list');
      expect(result.reply).toBe('Solicitação encontrada');

      expect(requests.ask).toHaveBeenCalledWith(
        'Minha solicitação',
        intent,
        GUEST,
      );

      expect(reservations.ask).not.toHaveBeenCalled();
    },
  );

  it('rejects knowledge intentions', async () => {
    await expect(
      dispatcher.dispatch(
        'Horário da piscina',
        {
          intent: 'knowledge.search',
          detail: 'none',
        },
        GUEST,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(reservations.ask).not.toHaveBeenCalled();
    expect(requests.ask).not.toHaveBeenCalled();
  });

  it('propagates the correct guest context', async () => {
    const anotherGuest: GuestContext = {
      resortId: 'resort-002',
      guestId: 'guest-002',
    };

    const decision: IntentDecision = {
      intent: 'reservation.list',
      detail: 'none',
    };

    await dispatcher.dispatch('Minhas reservas', decision, anotherGuest);

    expect(reservations.ask).toHaveBeenCalledExactlyOnceWith(
      'Minhas reservas',
      anotherGuest,
      decision,
    );
  });
});
