import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IntentDecision } from '../chat/chat-intent.types.js';

import type { GuestContext } from '../guest/guest-context.js';

import type { OperationsAiService } from './operations-ai.service.js';

import type { RequestsOperationsService } from './requests-operations.service.js';

import type { ExperienceOperationsService } from './experience-operations.service.js';

import type { RestaurantOperationsService } from './restaurant-operations.service.js';

import type { EventOperationsService } from './event-operations.service.js';

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

  const experiences = {
    handle: vi.fn(async () => ({
      tool: 'experiences.list' as const,
      reply: 'Experiências',
      actions: [],
      state: { topic: 'experience' as const },
    })),
  };

  const restaurants = {
    handleBooking: vi.fn(async () => ({
      tool: 'restaurants.list' as const,
      reply: 'Abra Gastronomia',
      actions: [],
    })),
    handle: vi.fn(async () => ({
      tool: 'restaurants.list' as const,
      reply: 'Abra Gastronomia',
      actions: [],
    })),
  };

  const events = {
    handle: vi.fn(async () => ({
      tool: 'events.list' as const,
      reply: 'Programação',
      actions: [],
    })),
  };

  const CONTEXT = {
    conversationId: '6f1c2a5e-8c1d-4b7a-9e2f-3a4b5c6d7e8f',
    state: {},
  };

  const dispatcher = new OperationsDispatcherService(
    reservations as unknown as OperationsAiService,
    requests as unknown as RequestsOperationsService,
    experiences as unknown as ExperienceOperationsService,
    restaurants as unknown as RestaurantOperationsService,
    events as unknown as EventOperationsService,
  );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes event.list to the events service, with or without conversation context', async () => {
    const decision: IntentDecision = { intent: 'event.list', detail: 'none' };

    const withContext = await dispatcher.dispatch('Quais os eventos?', decision, GUEST, CONTEXT);
    const withoutContext = await dispatcher.dispatch('Quais os eventos?', decision, GUEST);

    expect(withContext.tool).toBe('events.list');
    expect(withoutContext.tool).toBe('events.list');
    expect(events.handle).toHaveBeenCalledTimes(2);
    expect(events.handle).toHaveBeenLastCalledWith('Quais os eventos?', decision, GUEST, { conversationId: '', state: {} });
    expect(reservations.ask).not.toHaveBeenCalled();
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

  it.each(['conversation.greeting', 'conversation.general'] as const)(
    'never sends %s to the Tool Registry',
    async (intent) => {
      await expect(
        dispatcher.dispatch('Olá', { intent, detail: 'none' }, GUEST, CONTEXT),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(reservations.ask).not.toHaveBeenCalled();
      expect(requests.ask).not.toHaveBeenCalled();
      expect(experiences.handle).not.toHaveBeenCalled();
      expect(restaurants.handleBooking).not.toHaveBeenCalled();
    },
  );

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

  it.each([
    'experience.list',
    'experience.details',
    'experience.availability',
    'experience.price',
    'experience.booking',
    'experience.booking.confirm',
    'experience.booking.cancel',
    'experience.reservations',
  ] as const)('routes %s to the experience operations with the conversation context', async (intent) => {
    const decision: IntentDecision = { intent, detail: 'none' };

    const result = await dispatcher.dispatch('Experiências', decision, GUEST, CONTEXT);

    expect(result.reply).toBe('Experiências');
    expect(experiences.handle).toHaveBeenCalledExactlyOnceWith('Experiências', decision, GUEST, CONTEXT);
    expect(reservations.ask).not.toHaveBeenCalled();
    expect(restaurants.handleBooking).not.toHaveBeenCalled();
  });

  it('refuses experience operations without a conversation context', async () => {
    await expect(
      dispatcher.dispatch('Quero reservar', { intent: 'experience.booking', detail: 'none' }, GUEST),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(experiences.handle).not.toHaveBeenCalled();
  });

  it('routes restaurant bookings to navigation only, never to a booking tool', async () => {
    const result = await dispatcher.dispatch(
      'Quero reservar uma mesa',
      { intent: 'restaurant.booking', detail: 'none' },
      GUEST,
      CONTEXT,
    );

    expect(result.tool).toBe('restaurants.list');
    // Com a conversa, o handler resolve referências ("a segunda") antes de navegar.
    expect(restaurants.handle).toHaveBeenCalledExactlyOnceWith(
      'Quero reservar uma mesa',
      { intent: 'restaurant.booking', detail: 'none' },
      GUEST,
      CONTEXT,
    );
    expect(experiences.handle).not.toHaveBeenCalled();
  });

  it('routes restaurant bookings without a conversation context to navigation only', async () => {
    await dispatcher.dispatch('Quero reservar uma mesa', { intent: 'restaurant.booking', detail: 'none' }, GUEST);

    expect(restaurants.handleBooking).toHaveBeenCalledExactlyOnceWith('Quero reservar uma mesa', GUEST);
  });

  it.each(['restaurant.list', 'restaurant.details'] as const)('routes %s to the restaurant catalog', async (intent) => {
    await dispatcher.dispatch('Quais restaurantes existem?', { intent, detail: 'none' }, GUEST, CONTEXT);

    expect(restaurants.handle).toHaveBeenCalledOnce();
    expect(reservations.ask).not.toHaveBeenCalled();
  });
});
