import {
  BadGatewayException,
  GatewayTimeoutException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { setTimeout as sleep } from 'node:timers/promises';

import { voiceSettings, type VoiceSettings } from './voice-config.js';

interface VoiceboxHealth {
  status?: string;
  model_loaded?: boolean;
  model_size?: string | null;
}

interface VoiceboxGeneration {
  id?: unknown;
  status?: unknown;
  error?: unknown;
}

const VOICEBOX_MAX_TEXT = 50_000;
const GENERATION_ID = /^[A-Za-z0-9-]{1,64}$/;
const FAILED_STATUSES = new Set(['failed', 'error', 'cancelled', 'canceled']);
const WAV_HEADER_BYTES = 44;
const MIN_SYNTHESIS_MS = 30_000;

export function isWav(audio: Buffer): boolean {
  return (
    audio.length > WAV_HEADER_BYTES &&
    audio.toString('ascii', 0, 4) === 'RIFF' &&
    audio.toString('ascii', 8, 12) === 'WAVE'
  );
}

@Injectable()
export class VoiceboxService implements OnModuleInit {
  private readonly logger = new Logger(VoiceboxService.name);

  readonly settings: VoiceSettings;

  private queue: Promise<unknown> = Promise.resolve();
  private waiting = 0;

  constructor(config: ConfigService) {
    this.settings = voiceSettings((key) => config.get<string>(key));
  }

  onModuleInit(): void {
    const { enabled, problem, profileId, engine, modelSize, language } = this.settings;

    if (problem) this.logger.warn(`Narração desativada: ${problem}.`);
    else if (enabled) this.logger.log(`Narração: perfil ${profileId}, ${engine} ${modelSize}, idioma ${language}.`);
  }

  get voiceKey(): string {
    const { profileId, engine, modelSize, language } = this.settings;
    return `${profileId}:${engine}:${modelSize}:${language}`;
  }

  async synthesize(text: string): Promise<Buffer> {
    if (!this.settings.enabled) {
      throw new ServiceUnavailableException('A narração por voz está desativada.');
    }

    if (!text.trim() || text.length > VOICEBOX_MAX_TEXT) {
      throw new UnprocessableEntityException('Texto inválido para narração.');
    }

    if (this.waiting >= this.settings.maxQueue) {
      throw new ServiceUnavailableException('A narração está ocupada. Tente novamente em instantes.');
    }

    const deadline = Date.now() + this.settings.timeoutMs;

    this.waiting += 1;
    const run = this.queue.then(() => this.generate(text, deadline));
    this.queue = run.catch(() => undefined);

    try {
      return await run;
    } finally {
      this.waiting -= 1;
    }
  }

  private async generate(text: string, deadline: number): Promise<Buffer> {
    const { profileId, engine, modelSize, language, pollIntervalMs } = this.settings;

    if (deadline - Date.now() < Math.min(MIN_SYNTHESIS_MS, this.settings.timeoutMs / 2)) {
      throw new GatewayTimeoutException('A narração demorou para ficar pronta.');
    }

    await this.checkHealth(deadline);

    const started = Date.now();

    const created = await this.json<VoiceboxGeneration>('/generate', deadline, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile_id: profileId,
        text,
        language,
        engine,
        model_size: modelSize,
        personality: false,
      }),
    });

    if (typeof created.id !== 'string' || !GENERATION_ID.test(created.id)) {
      throw new BadGatewayException('O Voicebox retornou uma resposta inválida.');
    }

    const id = created.id;
    let generation = created;

    try {
      while (generation.status !== 'completed') {
        if (typeof generation.status === 'string' && FAILED_STATUSES.has(generation.status)) {
          const reason = typeof generation.error === 'string' ? generation.error : '';
          this.logger.error(`Voicebox: geração ${id} terminou com ${generation.status}: ${reason.slice(0, 300)}`);
          throw new BadGatewayException('O Voicebox não conseguiu gerar o áudio.');
        }

        if (Date.now() + pollIntervalMs >= deadline) {
          throw new GatewayTimeoutException('A narração demorou para ficar pronta.');
        }

        await sleep(pollIntervalMs);
        generation = await this.json<VoiceboxGeneration>(`/history/${id}`, deadline);
      }
    } catch (error) {
      await this.cancel(id);
      throw error;
    }

    const audio = await this.audio(id, deadline);
    this.logger.debug(`Voicebox: ${text.length} caracteres narrados em ${Date.now() - started} ms (${audio.length} bytes).`);
    return audio;
  }

  private async checkHealth(deadline: number): Promise<void> {
    const health = await this.json<VoiceboxHealth>('/health', Math.min(deadline, Date.now() + this.settings.healthTimeoutMs)).catch(
      () => null,
    );

    if (!health && Date.now() >= deadline) {
      throw new GatewayTimeoutException('A narração demorou para ficar pronta.');
    }

    if (health?.status !== 'healthy') {
      throw new ServiceUnavailableException('O Voicebox não está disponível.');
    }

    if (health.model_loaded && health.model_size && health.model_size !== this.settings.modelSize) {
      this.logger.warn(`Voicebox com o modelo ${health.model_size} carregado; a narração usa ${this.settings.modelSize}.`);
    }
  }

  private async audio(id: string, deadline: number): Promise<Buffer> {
    const response = await this.request(`/audio/${id}`, deadline);
    const type = response.headers.get('content-type') ?? '';
    const length = Number(response.headers.get('content-length') ?? 0);

    if (!/^audio\/(x-)?wav\b/i.test(type) || length > this.settings.maxAudioBytes) {
      await response.body?.cancel();
      throw new BadGatewayException('O Voicebox retornou um áudio inválido.');
    }

    const audio = await this.readLimited(response);

    if (!audio || !isWav(audio)) {
      throw new BadGatewayException('O Voicebox retornou um áudio inválido.');
    }

    return audio;
  }

  private async readLimited(response: Response): Promise<Buffer | null> {
    const chunks: Buffer[] = [];
    let size = 0;

    for await (const chunk of response.body ?? []) {
      size += chunk.length;
      if (size > this.settings.maxAudioBytes) {
        await response.body?.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
  }

  private async cancel(id: string): Promise<void> {
    try {
      await this.request(`/generate/${id}/cancel`, Date.now() + this.settings.healthTimeoutMs, { method: 'POST' });
    } catch (error) {
      this.logger.warn(`Voicebox: não foi possível cancelar a geração ${id}: ${error instanceof Error ? error.message : String(error)}.`);
    }
  }

  private async json<T>(path: string, deadline: number, init: RequestInit = {}): Promise<T> {
    const response = await this.request(path, deadline, init);

    try {
      return (await response.json()) as T;
    } catch {
      throw new BadGatewayException('O Voicebox retornou uma resposta inválida.');
    }
  }

  private async request(path: string, deadline: number, init: RequestInit = {}): Promise<Response> {
    let response: Response;

    try {
      response = await fetch(`${this.settings.baseUrl}${path}`, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new GatewayTimeoutException('A narração demorou para ficar pronta.');
      }

      this.logger.error(`Falha de conexão com o Voicebox: ${error instanceof Error ? error.message : String(error)}`);
      throw new ServiceUnavailableException('O Voicebox não está disponível.');
    }

    if (!response.ok) {
      const details = await response.text().catch(() => '');
      this.logger.error(`Voicebox ${path.split('/')[1]} retornou HTTP ${response.status}: ${details.slice(0, 300)}`);
      throw new BadGatewayException('O Voicebox não conseguiu gerar o áudio.');
    }

    return response;
  }
}
