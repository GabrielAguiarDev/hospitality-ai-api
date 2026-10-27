import { Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';

import type { GuestContext } from '../guest/guest-context.js';
import { speechText } from '../voice/speech-text.js';
import { VoiceboxService } from '../voice/voicebox.service.js';

import { ChatConversation } from './entities/chat-conversation.entity.js';
import { ChatMessage } from './entities/chat-message.entity.js';

export interface NarratedMessage {
  audio: Buffer;
  cached: boolean;
}

/**
 * Narração de uma resposta já persistida do assistente. O texto vem
 * sempre do banco (nunca do cliente), e a conversa é conferida pelo
 * dono antes de qualquer consulta ao cache.
 */
@Injectable()
export class ChatVoiceService {
  // LRU em memória: Map mantém a ordem de inserção.
  private readonly cache = new Map<string, Buffer>();
  private cacheBytes = 0;
  // Pedidos simultâneos da mesma mensagem aguardam a mesma síntese.
  private readonly inFlight = new Map<string, Promise<Buffer>>();

  constructor(
    private readonly voicebox: VoiceboxService,

    @InjectRepository(ChatConversation)
    private readonly conversationsRepository: Repository<ChatConversation>,

    @InjectRepository(ChatMessage)
    private readonly messagesRepository: Repository<ChatMessage>,
  ) {}

  async narrate(conversationId: string, messageId: number, guest: GuestContext): Promise<NarratedMessage> {
    // Desligada: mesmo erro para qualquer mensagem, sem consultar o banco.
    if (!this.voicebox.settings.enabled) {
      throw new ServiceUnavailableException('A narração por voz está desativada.');
    }

    const conversation = await this.conversationsRepository.findOneBy({
      id: conversationId,
      resortId: guest.resortId,
      guestId: guest.guestId,
    });

    if (!conversation) {
      throw new NotFoundException('Conversa não encontrada');
    }

    const message = await this.messagesRepository.findOneBy({
      id: messageId,
      conversationId,
      role: 'assistant',
    });

    if (!message) {
      throw new NotFoundException('Mensagem não encontrada');
    }

    // IDs do banco, e não do request: "ABC…" e "abc…" são a mesma conversa no MySQL.
    const key = `${this.voicebox.voiceKey}:${conversation.id}:${message.id}`;
    const cached = this.cache.get(key);

    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return { audio: cached, cached: true };
    }

    const pending = this.inFlight.get(key);
    if (pending) return { audio: await pending, cached: false };

    const text = speechText(message.content, message.actions, this.voicebox.settings.maxChars);

    if (!text) {
      throw new UnprocessableEntityException('A mensagem não tem conteúdo para narração.');
    }

    const job = this.voicebox
      .synthesize(text)
      .then((audio) => {
        this.remember(key, audio);
        return audio;
      })
      .finally(() => this.inFlight.delete(key));

    this.inFlight.set(key, job);
    return { audio: await job, cached: false };
  }

  private remember(key: string, audio: Buffer): void {
    const { cacheMaxBytes } = this.voicebox.settings;
    if (audio.length > cacheMaxBytes) return;

    const previous = this.cache.get(key);
    if (previous) this.cacheBytes -= previous.length;
    this.cache.delete(key);
    this.cache.set(key, audio);
    this.cacheBytes += audio.length;

    for (const [oldest, stored] of this.cache) {
      if (this.cacheBytes <= cacheMaxBytes) break;
      this.cache.delete(oldest);
      this.cacheBytes -= stored.length;
    }
  }
}
