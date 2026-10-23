import { NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';

import { InMemoryChatStore } from '../../test/support/in-memory-chat-store.js';
import type { GuestContext } from '../guest/guest-context.js';
import { ExperienceOperationsService } from '../operations/experience-operations.service.js';
import { OperationsToolRegistryService } from '../operations/operations-tool-registry.service.js';

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
  const experiences = { confirmPreview: vi.fn<ExperienceOperationsService['confirmPreview']>() };
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
      actions: [
        {
          type: 'experience.booking.confirm',
          label: 'Reserva simulada confirmada',
          bookingId: '2c5c2a5e-8c1d-4b7a-9e2f-3a4b5c6d7e8f',
          confirmationCode: 'SIM-AAAA1111',
          status: 'confirmed',
          alreadyConfirmed: false,
          summary: SUMMARY,
        },
      ],
    });

    const result = await service.execute(
      { type: 'experience.booking.confirm', conversationId: CONVERSATION, previewId: PREVIEW },
      GUEST,
    );

    expect(experiences.confirmPreview).toHaveBeenCalledExactlyOnceWith(GUEST, CONVERSATION, PREVIEW);
    expect(result.status).toBe('confirmed');
    expect(result.actions).toHaveLength(1);
    expect(store.messages.at(-1)).toMatchObject({ role: 'assistant', content: 'Reserva simulada registrada.' });
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

    const result = await service.execute(
      { type: 'experience.booking.cancel', conversationId: CONVERSATION, previewId: PREVIEW },
      GUEST,
    );

    expect(registry.execute).toHaveBeenCalledExactlyOnceWith('experiences.booking.cancel', GUEST, {
      conversationId: CONVERSATION,
      previewId: PREVIEW,
    });
    expect(result.status).toBe('cancelled');
  });

  it('propagates database failures without recording a reply', async () => {
    experiences.confirmPreview.mockRejectedValue(new Error('ER_LOCK_WAIT_TIMEOUT'));

    await expect(
      service.execute({ type: 'experience.booking.confirm', conversationId: CONVERSATION, previewId: PREVIEW }, GUEST),
    ).rejects.toThrow('ER_LOCK_WAIT_TIMEOUT');
    expect(store.messages).toHaveLength(1);
  });
});
