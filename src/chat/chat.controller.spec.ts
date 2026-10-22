import { Test, TestingModule } from '@nestjs/testing';
import { ChatController } from './chat.controller.js';
import { ChatService } from './chat.service.js';

describe('ChatController', () => {
  let controller: ChatController;
  const chatService = {
    sendMessage: vi.fn<ChatService['sendMessage']>(),
    getMessages: vi.fn<ChatService['getMessages']>(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [{ provide: ChatService, useValue: chatService }],
    }).compile();

    controller = module.get<ChatController>(ChatController);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('forwards the message and conversationId to ChatService', async () => {
    const response = {
      reply: 'Olá!',
      conversationId: '6f1c2a5e-8c1d-4b7a-9e2f-3a4b5c6d7e8f',
      retrievedSources: [],
    };
    chatService.sendMessage.mockResolvedValue(response);

    await expect(
      controller.sendMessage({
        message: 'Olá',
        conversationId: response.conversationId,
      }),
    ).resolves.toBe(response);
    expect(chatService.sendMessage).toHaveBeenCalledWith(
      'Olá',
      response.conversationId,
    );
  });

  it('forwards getMessages to ChatService', async () => {
    const response = {
      conversationId: '6f1c2a5e-8c1d-4b7a-9e2f-3a4b5c6d7e8f',
      messages: [],
    };
    chatService.getMessages.mockResolvedValue(response);

    await expect(
      controller.getMessages(response.conversationId),
    ).resolves.toBe(response);
    expect(chatService.getMessages).toHaveBeenCalledWith(
      response.conversationId,
    );
  });
});
