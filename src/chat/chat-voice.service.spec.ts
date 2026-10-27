import {
  GatewayTimeoutException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { fakeWav } from '../../test/support/fake-wav.js';
import { InMemoryChatStore } from '../../test/support/in-memory-chat-store.js';
import type { ChatAction } from '../contracts/chat-actions.js';
import type { GuestContext } from '../guest/guest-context.js';
import { voiceSettings } from '../voice/voice-config.js';
import { VoiceboxService } from '../voice/voicebox.service.js';

import { ChatVoiceService } from './chat-voice.service.js';

const CONVERSATION_ID = '6f1c2a5e-8c1d-4b7a-9e2f-3a4b5c6d7e8f';
const OTHER_CONVERSATION_ID = '0b5c2a5e-8c1d-4b7a-9e2f-3a4b5c6d7e8f';

const GUEST: GuestContext = { resortId: 'demo', guestId: 'guest-demo-001' };
const OTHER_GUEST: GuestContext = { resortId: 'demo', guestId: 'guest-999' };
const OTHER_RESORT: GuestContext = { resortId: 'outro', guestId: 'guest-demo-001' };

const OPTIONS = { type: 'experience.options', label: 'Experiências', date: '2026-10-24', options: [] } as unknown as ChatAction;

describe('ChatVoiceService', () => {
  let store: InMemoryChatStore;
  let service: ChatVoiceService;
  const synthesize = vi.fn<VoiceboxService['synthesize']>();
  let settings = { ...voiceSettings(() => undefined), enabled: true };

  async function build() {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ChatVoiceService,
        {
          provide: VoiceboxService,
          useValue: { synthesize, settings, voiceKey: 'luigi:qwen:1.7B:pt' },
        },
        ...store.providers(),
      ],
    }).compile();

    service = moduleRef.get(ChatVoiceService);
  }

  beforeEach(async () => {
    settings = { ...voiceSettings(() => undefined), enabled: true };
    store = new InMemoryChatStore();
    // IDs 1 (usuário) e 2 (assistente) na conversa do hóspede.
    store.seedConversation(
      CONVERSATION_ID,
      [
        { role: 'user', content: 'Qual o horário da Trattoria?' },
        { role: 'assistant', content: 'A Trattoria Aurora funciona das 19h às 23h.' },
      ],
      GUEST,
    );
    // ID 3: resposta de outro hóspede.
    store.seedConversation(OTHER_CONVERSATION_ID, [{ role: 'assistant', content: 'Seu quarto é o 1204.' }], OTHER_GUEST);
    synthesize.mockResolvedValue(fakeWav());
    await build();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('narrates the persisted assistant message, never text from the client', async () => {
    const result = await service.narrate(CONVERSATION_ID, 2, GUEST);

    expect(result).toEqual({ audio: fakeWav(), cached: false });
    expect(synthesize).toHaveBeenCalledWith('A Trattoria Aurora funciona das 19h às 23h.');
    expect(store.conversationsRepository.findOneBy).toHaveBeenCalledWith({
      id: CONVERSATION_ID,
      resortId: GUEST.resortId,
      guestId: GUEST.guestId,
    });
    expect(store.messagesRepository.findOneBy).toHaveBeenCalledWith({
      id: 2,
      conversationId: CONVERSATION_ID,
      role: 'assistant',
    });
  });

  it('returns 503 without reading the database when narration is disabled', async () => {
    settings = { ...settings, enabled: false };
    await build();

    await expect(service.narrate(CONVERSATION_ID, 2, GUEST)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(store.conversationsRepository.findOneBy).not.toHaveBeenCalled();
    expect(synthesize).not.toHaveBeenCalled();
  });

  it('with cards, narrates the introduction and the conclusion only', async () => {
    store.messages.push({
      id: 10,
      conversationId: CONVERSATION_ID,
      role: 'assistant',
      content: 'Há vagas em 2 experiências:\n1. Passeio de barco\n2. Trilha\nQual delas você prefere?',
      actions: [OPTIONS],
    });

    await service.narrate(CONVERSATION_ID, 10, GUEST);

    expect(synthesize).toHaveBeenCalledWith('Há vagas em 2 experiências. Qual delas você prefere?');
  });

  describe('access control', () => {
    it('returns 404 for a message that does not exist', async () => {
      await expect(service.narrate(CONVERSATION_ID, 999, GUEST)).rejects.toBeInstanceOf(NotFoundException);
      expect(synthesize).not.toHaveBeenCalled();
    });

    it('returns 404 for a conversation owned by another guest, before reading any message', async () => {
      await expect(service.narrate(OTHER_CONVERSATION_ID, 3, GUEST)).rejects.toBeInstanceOf(NotFoundException);
      expect(store.messagesRepository.findOneBy).not.toHaveBeenCalled();
      expect(synthesize).not.toHaveBeenCalled();
    });

    it('returns 404 for the same conversation from another resort', async () => {
      await expect(service.narrate(CONVERSATION_ID, 2, OTHER_RESORT)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns 404 when the message belongs to another conversation', async () => {
      // Conversa própria + mensagem (ID 3) de outra conversa.
      await expect(service.narrate(CONVERSATION_ID, 3, GUEST)).rejects.toBeInstanceOf(NotFoundException);
      expect(synthesize).not.toHaveBeenCalled();
    });

    it('returns 404 for a message written by the guest', async () => {
      await expect(service.narrate(CONVERSATION_ID, 1, GUEST)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('does not serve cached audio to another guest', async () => {
      await service.narrate(OTHER_CONVERSATION_ID, 3, OTHER_GUEST);

      await expect(service.narrate(OTHER_CONVERSATION_ID, 3, GUEST)).rejects.toBeInstanceOf(NotFoundException);
      expect(synthesize).toHaveBeenCalledTimes(1);
    });
  });

  describe('cache', () => {
    it('serves the second request from the cache without calling Voicebox', async () => {
      await service.narrate(CONVERSATION_ID, 2, GUEST);
      const second = await service.narrate(CONVERSATION_ID, 2, GUEST);

      expect(second).toEqual({ audio: fakeWav(), cached: true });
      expect(synthesize).toHaveBeenCalledTimes(1);
    });

    it('generates concurrent requests for the same message only once', async () => {
      let finish!: (audio: Buffer) => void;
      synthesize.mockReturnValue(new Promise((resolve) => (finish = resolve)));

      const requests = Promise.all([
        service.narrate(CONVERSATION_ID, 2, GUEST),
        service.narrate(CONVERSATION_ID, 2, GUEST),
        service.narrate(CONVERSATION_ID, 2, GUEST),
      ]);
      await vi.waitFor(() => expect(synthesize).toHaveBeenCalled());
      finish(fakeWav());

      const results = await requests;
      expect(synthesize).toHaveBeenCalledTimes(1);
      expect(results.map(({ audio }) => audio.equals(fakeWav()))).toEqual([true, true, true]);
    });

    it('does not cache failures: the next request tries again', async () => {
      synthesize.mockRejectedValueOnce(new GatewayTimeoutException());

      await expect(service.narrate(CONVERSATION_ID, 2, GUEST)).rejects.toBeInstanceOf(GatewayTimeoutException);
      await expect(service.narrate(CONVERSATION_ID, 2, GUEST)).resolves.toEqual({ audio: fakeWav(), cached: false });
      expect(synthesize).toHaveBeenCalledTimes(2);
    });

    it('shares a failure with concurrent requests for the same message', async () => {
      synthesize.mockRejectedValueOnce(new ServiceUnavailableException());

      const results = await Promise.allSettled([
        service.narrate(CONVERSATION_ID, 2, GUEST),
        service.narrate(CONVERSATION_ID, 2, GUEST),
      ]);

      expect(results.map(({ status }) => status)).toEqual(['rejected', 'rejected']);
      expect(synthesize).toHaveBeenCalledTimes(1);
    });

    it('evicts the least recently used audio beyond VOICEBOX_CACHE_MAX_MB', async () => {
      settings = { ...settings, cacheMaxBytes: fakeWav(100).length * 2 };
      await build();
      store.messages.push({ id: 11, conversationId: CONVERSATION_ID, role: 'assistant', content: 'Segunda resposta.' });
      store.messages.push({ id: 12, conversationId: CONVERSATION_ID, role: 'assistant', content: 'Terceira resposta.' });
      synthesize.mockResolvedValue(fakeWav(100));

      await service.narrate(CONVERSATION_ID, 2, GUEST);
      await service.narrate(CONVERSATION_ID, 11, GUEST);
      // Mensagem 2 usada de novo: a mais antiga passa a ser a 11.
      await service.narrate(CONVERSATION_ID, 2, GUEST);
      await service.narrate(CONVERSATION_ID, 12, GUEST);

      expect((await service.narrate(CONVERSATION_ID, 2, GUEST)).cached).toBe(true);
      expect((await service.narrate(CONVERSATION_ID, 11, GUEST)).cached).toBe(false);
    });
  });

  describe('text validation', () => {
    it.each(['```json\n{"bookingId": "x"}\n```', '🎉', 'ID: 6f1c2a5e-8c1d-4b7a-9e2f-3a4b5c6d7e8f'])(
      'returns 422 for a message with nothing to narrate (%j)',
      async (content) => {
        store.messages.push({ id: 20, conversationId: CONVERSATION_ID, role: 'assistant', content });

        await expect(service.narrate(CONVERSATION_ID, 20, GUEST)).rejects.toBeInstanceOf(UnprocessableEntityException);
        expect(synthesize).not.toHaveBeenCalled();
      },
    );

    it('limits the narrated text to VOICEBOX_MAX_CHARS', async () => {
      settings = { ...settings, maxChars: 30 };
      await build();
      store.messages.push({
        id: 21,
        conversationId: CONVERSATION_ID,
        role: 'assistant',
        content: 'Primeira frase. Segunda frase bem mais longa que o limite.',
      });

      await service.narrate(CONVERSATION_ID, 21, GUEST);

      expect(synthesize).toHaveBeenCalledWith('Primeira frase.');
    });
  });
});
