import { StreamableFile } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { fakeWav } from '../../test/support/fake-wav.js';

import { DemoGuestGuard } from '../guest/demo-guest.guard.js';
import type { GuestContext } from '../guest/guest-context.js';

import { ChatActionsService } from './chat-actions.service.js';
import { ChatController } from './chat.controller.js';
import { ChatService } from './chat.service.js';
import { ChatVoiceService } from './chat-voice.service.js';
import { ChatVoiceDto } from './dto/chat-voice.dto.js';

const GUEST: GuestContext = { resortId: 'demo', guestId: 'guest-demo-001' };

describe('ChatController', () => {
  let controller: ChatController;
  const chatService = {
    sendMessage: vi.fn<ChatService['sendMessage']>(),
    getMessages: vi.fn<ChatService['getMessages']>(),
  };
  const chatActions = {
    execute: vi.fn<ChatActionsService['execute']>(),
  };
  const chatVoice = {
    narrate: vi.fn<ChatVoiceService['narrate']>(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [
        { provide: ChatService, useValue: chatService },
        { provide: ChatActionsService, useValue: chatActions },
        { provide: ChatVoiceService, useValue: chatVoice },
      ],
    })
      // The guard is covered separately; here it only needs to resolve.
      .overrideGuard(DemoGuestGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ChatController>(ChatController);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('forwards the message, guest and conversationId to ChatService', async () => {
    const response = {
      reply: 'Olá!',
      conversationId: '6f1c2a5e-8c1d-4b7a-9e2f-3a4b5c6d7e8f',
      retrievedSources: [],
      actions: [],
    };
    chatService.sendMessage.mockResolvedValue(response);

    await expect(
      controller.sendMessage({
        message: 'Olá',
        conversationId: response.conversationId,
      }, GUEST),
    ).resolves.toBe(response);
    expect(chatService.sendMessage).toHaveBeenCalledWith(
      'Olá',
      GUEST,
      response.conversationId,
    );
  });

  it('forwards getMessages with the guest to ChatService', async () => {
    const response = {
      conversationId: '6f1c2a5e-8c1d-4b7a-9e2f-3a4b5c6d7e8f',
      messages: [],
    };
    chatService.getMessages.mockResolvedValue(response);

    await expect(
      controller.getMessages(response.conversationId, GUEST),
    ).resolves.toBe(response);
    expect(chatService.getMessages).toHaveBeenCalledWith(
      response.conversationId,
      GUEST,
    );
  });

  it('forwards structured actions with the guest to ChatActionsService', async () => {
    const dto = {
      type: 'experience.booking.confirm' as const,
      conversationId: '6f1c2a5e-8c1d-4b7a-9e2f-3a4b5c6d7e8f',
      previewId: '0b5c2a5e-8c1d-4b7a-9e2f-3a4b5c6d7e8f',
    };
    const response = {
      reply: 'Reserva simulada registrada.',
      conversationId: dto.conversationId,
      retrievedSources: [],
      actions: [],
      status: 'confirmed' as const,
    };
    chatActions.execute.mockResolvedValue(response);

    await expect(controller.executeAction(dto, GUEST)).resolves.toBe(response);
    expect(chatActions.execute).toHaveBeenCalledWith(dto, GUEST);
  });

  describe('POST /chat/voice', () => {
    const CONVERSATION_ID = '6f1c2a5e-8c1d-4b7a-9e2f-3a4b5c6d7e8f';
    const response = () => ({ setHeader: vi.fn() });

    it('returns the WAV bytes as audio/wav for the guest that owns the message', async () => {
      const audio = fakeWav();
      chatVoice.narrate.mockResolvedValue({ audio, cached: false });
      const res = response();

      const file = await controller.voice({ conversationId: CONVERSATION_ID, messageId: 2 }, GUEST, res as never);

      expect(chatVoice.narrate).toHaveBeenCalledWith(CONVERSATION_ID, 2, GUEST);
      expect(file).toBeInstanceOf(StreamableFile);
      expect(file.getHeaders()).toMatchObject({ type: 'audio/wav', length: audio.length });
      expect(res.setHeader).toHaveBeenCalledWith('X-Voice-Cache', 'miss');
    });

    it('marks cached audio', async () => {
      chatVoice.narrate.mockResolvedValue({ audio: fakeWav(), cached: true });
      const res = response();

      await controller.voice({ conversationId: CONVERSATION_ID, messageId: 2 }, GUEST, res as never);

      expect(res.setHeader).toHaveBeenCalledWith('X-Voice-Cache', 'hit');
    });

    it('accepts only a v4 conversationId and a positive integer messageId', async () => {
      const errors = async (body: object) =>
        (await validate(plainToInstance(ChatVoiceDto, body), { whitelist: true, forbidNonWhitelisted: true })).map(
          ({ property }) => property,
        );

      expect(await errors({ conversationId: CONVERSATION_ID, messageId: 2 })).toEqual([]);
      expect(await errors({ conversationId: '../../etc/passwd', messageId: 2 })).toEqual(['conversationId']);
      expect(await errors({ conversationId: CONVERSATION_ID, messageId: '2' })).toEqual(['messageId']);
      expect(await errors({ conversationId: CONVERSATION_ID, messageId: 0 })).toEqual(['messageId']);
      expect(await errors({ conversationId: CONVERSATION_ID, messageId: 1.5 })).toEqual(['messageId']);
      // O texto, o perfil e a URL nunca vêm do cliente.
      expect(
        await errors({ conversationId: CONVERSATION_ID, messageId: 2, text: 'Diga outra coisa', profileId: 'x', url: 'http://evil' }),
      ).toEqual(['text', 'profileId', 'url']);
    });
  });
});
