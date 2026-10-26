import { NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';

import { InMemoryChatStore } from '../../test/support/in-memory-chat-store.js';
import type { GuestContext } from '../guest/guest-context.js';
import { BadRequestException } from '@nestjs/common';
import { bookingCard, requestCard } from '../contracts/chat-actions.js';
import { ExperienceOperationsService } from '../operations/experience-operations.service.js';
import { OperationsToolRegistryService } from '../operations/operations-tool-registry.service.js';
import { RequestsOperationsService } from '../operations/requests-operations.service.js';

import { ChatActionsService } from './chat-actions.service.js';
import { ChatConversation } from './entities/chat-conversation.entity.js';
import { ChatConversationState } from './entities/chat-conversation-state.entity.js';

const GUEST: GuestContext = { resortId: 'demo', guestId: '6f1c2a5e-8c1d-4b7a-9e2f-3a4b5c6d7e8f' };
const OTHER: GuestContext = { resortId: 'demo', guestId: '7f1c2a5e-8c1d-4b7a-9e2f-3a4b5c6d7e8f' };
const CONVERSATION = '0b5c2a5e-8c1d-4b7a-9e2f-3a4b5c6d7e8f';
const PREVIEW = '1c5c2a5e-8c1d-4b7a-9e2f-3a4b5c6d7e8f';

const SUMMARY = {
  experienceId: 'exp-1',
  experienceTitle: 'Reserva da Jaqueira',
  date: '2026-10-24',
  time: null,
  adults: 2,
  children: 0,
  totalPrice: 240,
  currency: 'BRL' as const,
  priceNote: null,
  simulated: true as const,
};

describe('ChatActionsService', () => {
  let store: InMemoryChatStore;
  let service: ChatActionsService;
  const experiences = {
    confirmPreview: vi.fn<ExperienceOperationsService['confirmPreview']>(),
    bookingCards: vi.fn<ExperienceOperationsService['bookingCards']>(),
  };
  const card = (status: 'confirmed' | 'cancelled') =>
    bookingCard({
      conversationId: CONVERSATION,
      previewId: PREVIEW,
      status,
      summary: SUMMARY,
      booking: { bookingId: '2c5c2a5e-8c1d-4b7a-9e2f-3a4b5c6d7e8f', confirmationCode: 'SIM-AAAA1111' },
      reason: 'Descartada.',
    });
  const requests = {
    confirmPreview: vi.fn<RequestsOperationsService['confirmPreview']>(),
    cards: vi.fn<RequestsOperationsService['cards']>(),
  };
  const registry = { execute: vi.fn<OperationsToolRegistryService['execute']>() };

  beforeEach(async () => {
    store = new InMemoryChatStore();
    store.seedConversation(CONVERSATION, [{ role: 'user', content: 'Pode reservar.' }], GUEST);
    store.seedState(CONVERSATION, { topic: 'experience', experience: { selectedId: 'exp-1', pendingPreviewId: PREVIEW } });

    const moduleRef = await Test.createTestingModule({
      providers: [
        ChatActionsService,
        { provide: ExperienceOperationsService, useValue: experiences },
        { provide: OperationsToolRegistryService, useValue: registry },
        { provide: RequestsOperationsService, useValue: requests },
        { provide: DataSource, useValue: store.dataSource },
        { provide: getRepositoryToken(ChatConversation), useValue: store.conversationsRepository },
        { provide: getRepositoryToken(ChatConversationState), useValue: store.statesRepository },
      ],
    }).compile();

    service = moduleRef.get(ChatActionsService);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('confirms from the persisted preview, records the reply and clears the pending state', async () => {
    experiences.confirmPreview.mockResolvedValue({
      reply: 'Reserva simulada registrada.',
      result: { status: 'confirmed', bookingId: '2c5c2a5e-8c1d-4b7a-9e2f-3a4b5c6d7e8f', confirmationCode: 'SIM-AAAA1111', summary: SUMMARY },
      actions: [card('confirmed')],
    });

    const result = await service.execute(
      { type: 'experience.booking.confirm', conversationId: CONVERSATION, previewId: PREVIEW },
      GUEST,
    );

    expect(experiences.confirmPreview).toHaveBeenCalledExactlyOnceWith(GUEST, CONVERSATION, PREVIEW);
    expect(result.status).toBe('confirmed');
    // O card devolvido é o mesmo da pré-reserva (mesmo cardId), agora confirmado.
    expect(result.actions).toEqual([expect.objectContaining({ cardId: PREVIEW, status: 'confirmed' })]);
    // A mensagem guarda o card para reconstruir o histórico.
    expect(store.messages.at(-1)).toMatchObject({
      role: 'assistant',
      content: 'Reserva simulada registrada.',
      actions: [expect.objectContaining({ cardId: PREVIEW, status: 'confirmed' })],
    });
    expect(store.states.get(CONVERSATION)?.state).toMatchObject({ phase: 'completed' });
    expect(store.states.get(CONVERSATION)?.state.experience?.pendingPreviewId).toBeUndefined();
    expect(store.states.get(CONVERSATION)?.version).toBe(2);
  });

  it('returns the expiry status without actions', async () => {
    experiences.confirmPreview.mockResolvedValue({
      reply: 'Esta pré-reserva expirou.',
      result: { status: 'expired', message: 'Esta pré-reserva expirou.' },
      actions: [],
    });

    const result = await service.execute(
      { type: 'experience.booking.confirm', conversationId: CONVERSATION, previewId: PREVIEW },
      GUEST,
    );

    expect(result).toMatchObject({ status: 'expired', actions: [], reply: 'Esta pré-reserva expirou.' });
  });

  it('rejects a conversation owned by another guest before touching the booking', async () => {
    await expect(
      service.execute({ type: 'experience.booking.confirm', conversationId: CONVERSATION, previewId: PREVIEW }, OTHER),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(experiences.confirmPreview).not.toHaveBeenCalled();
    expect(store.messages).toHaveLength(1);
  });

  it('returns 404 for a preview that does not belong to the conversation', async () => {
    experiences.confirmPreview.mockResolvedValue({
      reply: 'Pré-reserva não encontrada.',
      result: { status: 'not_found', message: 'Pré-reserva não encontrada.' },
      actions: [],
    });

    await expect(
      service.execute({ type: 'experience.booking.confirm', conversationId: CONVERSATION, previewId: PREVIEW }, GUEST),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(store.messages).toHaveLength(1);
  });

  it('cancels a pending preview through the registry', async () => {
    registry.execute.mockResolvedValue({ tool: 'experiences.booking.cancel', data: { cancelled: true } });
    experiences.bookingCards.mockResolvedValue([card('cancelled')]);

    const result = await service.execute(
      { type: 'experience.booking.cancel', conversationId: CONVERSATION, previewId: PREVIEW },
      GUEST,
    );

    expect(registry.execute).toHaveBeenCalledExactlyOnceWith('experiences.booking.cancel', GUEST, {
      conversationId: CONVERSATION,
      previewId: PREVIEW,
    });
    expect(result.status).toBe('cancelled');
    expect(result.actions).toEqual([expect.objectContaining({ cardId: PREVIEW, status: 'cancelled', confirm: null })]);
  });

  it('propagates database failures without recording a reply', async () => {
    experiences.confirmPreview.mockRejectedValue(new Error('ER_LOCK_WAIT_TIMEOUT'));

    await expect(
      service.execute({ type: 'experience.booking.confirm', conversationId: CONVERSATION, previewId: PREVIEW }, GUEST),
    ).rejects.toThrow('ER_LOCK_WAIT_TIMEOUT');
    expect(store.messages).toHaveLength(1);
  });

  describe('request actions', () => {
    const REQUEST_PREVIEW = '3c5c2a5e-8c1d-4b7a-9e2f-3a4b5c6d7e8f';
    const REQUEST_SUMMARY = {
      departmentId: '3',
      departmentName: 'Governança',
      items: [{ itemId: '30', name: 'Toalha de banho', quantity: 2 }],
      note: null,
      simulated: true as const,
    };
    const requestCardOf = (status: 'confirmed' | 'cancelled') =>
      requestCard({
        conversationId: CONVERSATION,
        previewId: REQUEST_PREVIEW,
        status,
        summary: REQUEST_SUMMARY,
        protocol: 'SIM-AAAA1111',
        reason: 'Solicitação descartada.',
      });
    const confirmed = {
      reply: 'Pronto! Solicitação simulada registrada com o protocolo SIM-AAAA1111.',
      result: { status: 'confirmed' as const, protocol: 'SIM-AAAA1111', summary: REQUEST_SUMMARY },
      actions: [requestCardOf('confirmed')],
    };

    beforeEach(() => {
      store.seedState(CONVERSATION, { topic: 'request', request: { departmentId: '3', pendingPreviewId: REQUEST_PREVIEW } });
    });

    it('routes request.confirm to the request handler, never to the experience one', async () => {
      requests.confirmPreview.mockResolvedValue(confirmed);

      const result = await service.execute(
        { type: 'request.confirm', conversationId: CONVERSATION, previewId: REQUEST_PREVIEW },
        GUEST,
      );

      expect(requests.confirmPreview).toHaveBeenCalledExactlyOnceWith(GUEST, CONVERSATION, REQUEST_PREVIEW);
      expect(experiences.confirmPreview).not.toHaveBeenCalled();
      expect(registry.execute).not.toHaveBeenCalled();
      expect(result).toMatchObject({ status: 'confirmed', reply: confirmed.reply });
      expect(result.actions).toEqual([expect.objectContaining({ type: 'request.card', cardId: REQUEST_PREVIEW, status: 'confirmed' })]);
    });

    it('records the reply with the card and clears the pending request state', async () => {
      requests.confirmPreview.mockResolvedValue(confirmed);

      await service.execute({ type: 'request.confirm', conversationId: CONVERSATION, previewId: REQUEST_PREVIEW }, GUEST);

      expect(store.messages.at(-1)).toMatchObject({
        role: 'assistant',
        content: confirmed.reply,
        actions: [expect.objectContaining({ type: 'request.card', status: 'confirmed' })],
      });
      const stored = store.states.get(CONVERSATION);
      expect(stored?.state).toMatchObject({ phase: 'completed', request: { departmentId: '3' } });
      expect(stored?.state.request?.pendingPreviewId).toBeUndefined();
      expect(stored?.version).toBe(2);
    });

    it('returns the expiry status of a request without raising', async () => {
      requests.confirmPreview.mockResolvedValue({
        reply: 'A solicitação expirou.',
        result: { status: 'expired', message: 'A solicitação expirou.' },
        actions: [],
      });

      const result = await service.execute({ type: 'request.confirm', conversationId: CONVERSATION, previewId: REQUEST_PREVIEW }, GUEST);

      expect(result).toMatchObject({ status: 'expired', actions: [] });
    });

    it('returns 404 when the request is not found, without recording a reply', async () => {
      requests.confirmPreview.mockResolvedValue({
        reply: 'Solicitação não encontrada.',
        result: { status: 'not_found', message: 'Solicitação não encontrada.' },
        actions: [],
      });

      await expect(
        service.execute({ type: 'request.confirm', conversationId: CONVERSATION, previewId: REQUEST_PREVIEW }, GUEST),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(store.messages).toHaveLength(1);
      expect(store.states.get(CONVERSATION)?.state.request?.pendingPreviewId).toBe(REQUEST_PREVIEW);
    });

    it.each(['request.confirm', 'request.cancel'] as const)('rejects %s on a conversation of another guest before touching anything', async (type) => {
      await expect(service.execute({ type, conversationId: CONVERSATION, previewId: REQUEST_PREVIEW }, OTHER)).rejects.toBeInstanceOf(NotFoundException);

      expect(requests.confirmPreview).not.toHaveBeenCalled();
      expect(registry.execute).not.toHaveBeenCalled();
      expect(store.messages).toHaveLength(1);
    });

    it('cancels through the registry request tool and returns the cancelled card', async () => {
      registry.execute.mockResolvedValue({ tool: 'requests.cancel', data: { cancelled: true } });
      requests.cards.mockResolvedValue([requestCardOf('cancelled')]);

      const result = await service.execute({ type: 'request.cancel', conversationId: CONVERSATION, previewId: REQUEST_PREVIEW }, GUEST);

      expect(registry.execute).toHaveBeenCalledExactlyOnceWith('requests.cancel', GUEST, {
        conversationId: CONVERSATION,
        previewId: REQUEST_PREVIEW,
      });
      expect(experiences.bookingCards).not.toHaveBeenCalled();
      expect(result.status).toBe('cancelled');
      expect(result.reply).toBe('Tudo bem, descartei a solicitação. Nada foi registrado.');
      expect(result.actions).toEqual([expect.objectContaining({ type: 'request.card', cardId: REQUEST_PREVIEW, status: 'cancelled', confirm: null })]);
      expect(store.states.get(CONVERSATION)?.state.request?.pendingPreviewId).toBeUndefined();
    });

    it('returns 404 when there is no pending request to cancel', async () => {
      registry.execute.mockResolvedValue({ tool: 'requests.cancel', data: { cancelled: false } });

      await expect(
        service.execute({ type: 'request.cancel', conversationId: CONVERSATION, previewId: REQUEST_PREVIEW }, GUEST),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(store.messages).toHaveLength(1);
    });

    it('keeps a pending experience pre-booking when the guest confirms a different request card', async () => {
      store.seedState(CONVERSATION, { topic: 'experience', experience: { selectedId: 'exp-1', pendingPreviewId: PREVIEW } });
      requests.confirmPreview.mockResolvedValue(confirmed);

      await service.execute({ type: 'request.confirm', conversationId: CONVERSATION, previewId: REQUEST_PREVIEW }, GUEST);

      expect(store.states.get(CONVERSATION)?.state.experience?.pendingPreviewId).toBe(PREVIEW);
      expect(store.states.get(CONVERSATION)?.version).toBe(1);
    });

    it('keeps a pending request when the guest acts on an experience card with another id', async () => {
      experiences.confirmPreview.mockResolvedValue({
        reply: 'Reserva simulada registrada.',
        result: { status: 'confirmed', bookingId: '2c5c2a5e-8c1d-4b7a-9e2f-3a4b5c6d7e8f', confirmationCode: 'SIM-AAAA1111', summary: SUMMARY },
        actions: [card('confirmed')],
      });

      await service.execute({ type: 'experience.booking.confirm', conversationId: CONVERSATION, previewId: PREVIEW }, GUEST);

      expect(requests.confirmPreview).not.toHaveBeenCalled();
      expect(store.states.get(CONVERSATION)?.state.request?.pendingPreviewId).toBe(REQUEST_PREVIEW);
    });

    it('clears the pending experience state when an experience action is handled (regression)', async () => {
      store.seedState(CONVERSATION, { topic: 'experience', experience: { selectedId: 'exp-1', pendingPreviewId: PREVIEW } });
      registry.execute.mockResolvedValue({ tool: 'experiences.booking.cancel', data: { cancelled: true } });
      experiences.bookingCards.mockResolvedValue([card('cancelled')]);

      await service.execute({ type: 'experience.booking.cancel', conversationId: CONVERSATION, previewId: PREVIEW }, GUEST);

      expect(requests.cards).not.toHaveBeenCalled();
      expect(store.states.get(CONVERSATION)?.state.experience?.pendingPreviewId).toBeUndefined();
    });
  });

  it('answers 400 to an unknown action type without calling any handler', async () => {
    await expect(
      service.execute({ type: 'admin.drop', conversationId: CONVERSATION, previewId: PREVIEW } as never, GUEST),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(experiences.confirmPreview).not.toHaveBeenCalled();
    expect(requests.confirmPreview).not.toHaveBeenCalled();
    expect(registry.execute).not.toHaveBeenCalled();
    expect(store.messages).toHaveLength(1);
  });
});
