import {
  BadGatewayException,
  GatewayTimeoutException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { fakeWav } from '../../test/support/fake-wav.js';

import { voiceSettings } from './voice-config.js';
import { isWav, VoiceboxService } from './voicebox.service.js';

const PROFILE_ID = 'dde27a57-a6f4-4beb-a809-e806935b5f27';
const GENERATION_ID = 'd7cea48c-e80a-48a0-89ea-3ffeb5c95c43';

const ENV = {
  VOICEBOX_ENABLED: 'true',
  VOICEBOX_BASE_URL: 'http://127.0.0.1:17493/',
  VOICEBOX_PROFILE_ID: PROFILE_ID,
  VOICEBOX_ENGINE: 'qwen',
  VOICEBOX_MODEL_SIZE: '1.7B',
  VOICEBOX_LANGUAGE: 'pt',
  VOICEBOX_POLL_INTERVAL_MS: '1',
  VOICEBOX_TIMEOUT_MS: '2000',
};

// As chamadas do serviço sempre usam uma URL em texto.
const urlOf = (input: Parameters<typeof fetch>[0]) =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const wav = (audio: Buffer = fakeWav(), type = 'audio/x-wav') =>
  new Response(new Uint8Array(audio), { status: 200, headers: { 'content-type': type, 'content-length': String(audio.length) } });

const HEALTHY = { status: 'healthy', model_loaded: true, model_size: '1.7B' };

interface Script {
  health?: () => Response | Promise<Response>;
  generate?: () => Response | Promise<Response>;
  // Respostas sucessivas de GET /history/{id}.
  history?: (() => Response)[];
  audio?: () => Response;
}

function service(env: Record<string, string> = ENV): VoiceboxService {
  return new VoiceboxService(new ConfigService(env));
}

describe('VoiceboxService', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const calls = () => fetchMock.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${urlOf(url)}`);
  const generateBody = () => {
    const call = fetchMock.mock.calls.find(([url]) => urlOf(url).endsWith('/generate'));
    return JSON.parse(call?.[1]?.body as string) as Record<string, unknown>;
  };

  function script({ health, generate, history = [], audio }: Script) {
    let polls = 0;
    fetchMock.mockImplementation(async (input, init) => {
      const url = urlOf(input);
      if (url.endsWith('/health')) return health ? health() : json(HEALTHY);
      if (url.endsWith('/generate')) {
        return generate ? generate() : json({ id: GENERATION_ID, status: 'generating', audio_path: '' });
      }
      if (url.endsWith('/cancel') && init?.method === 'POST') return json({ message: 'cancelled' });
      if (url.includes('/history/')) {
        const next = history[Math.min(polls++, history.length - 1)];
        return next ? next() : json({ id: GENERATION_ID, status: 'completed', audio_path: 'generations/x.wav' });
      }
      if (url.includes('/audio/')) return audio ? audio() : wav();
      throw new Error(`Unexpected request: ${url}`);
    });
  }

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  describe('generation flow', () => {
    it('generates with the configured Luigi profile, engine, model and language only', async () => {
      script({});

      await service().synthesize('Olá, eu sou o Yago.');

      expect(generateBody()).toEqual({
        profile_id: PROFILE_ID,
        text: 'Olá, eu sou o Yago.',
        language: 'pt',
        engine: 'qwen',
        model_size: '1.7B',
        personality: false,
      });
      // Somente o Voicebox configurado, sem barra dupla e sem redirecionamentos.
      for (const [url, init] of fetchMock.mock.calls) {
        expect(urlOf(url)).toMatch(/^http:\/\/127\.0\.0\.1:17493\/[a-z]/);
        expect(init?.redirect).toBe('error');
      }
    });

    it('polls the asynchronous generation until it completes, then returns the WAV bytes', async () => {
      const audio = fakeWav(32);
      script({
        history: [
          () => json({ id: GENERATION_ID, status: 'generating' }),
          () => json({ id: GENERATION_ID, status: 'generating' }),
          () => json({ id: GENERATION_ID, status: 'completed', audio_path: '/Users/x/generations/a.wav' }),
        ],
        audio: () => wav(audio),
      });

      const result = await service().synthesize('Olá.');

      expect(result.equals(audio)).toBe(true);
      expect(isWav(result)).toBe(true);
      expect(calls()).toEqual([
        'GET http://127.0.0.1:17493/health',
        'POST http://127.0.0.1:17493/generate',
        `GET http://127.0.0.1:17493/history/${GENERATION_ID}`,
        `GET http://127.0.0.1:17493/history/${GENERATION_ID}`,
        `GET http://127.0.0.1:17493/history/${GENERATION_ID}`,
        `GET http://127.0.0.1:17493/audio/${GENERATION_ID}`,
      ]);
    });

    it('accepts a generation that is already completed in the POST /generate response', async () => {
      script({ generate: () => json({ id: GENERATION_ID, status: 'completed' }) });

      await expect(service().synthesize('Olá.')).resolves.toBeInstanceOf(Buffer);
      expect(calls().some((call) => call.includes('/history/'))).toBe(false);
    });
  });

  describe('audio validation', () => {
    it('rejects bytes that are not a WAV file', async () => {
      script({ audio: () => wav(Buffer.from('Internal Server Error, but 200 OK....................')) });

      await expect(service().synthesize('Olá.')).rejects.toBeInstanceOf(BadGatewayException);
    });

    it('rejects a non-audio content type', async () => {
      script({ audio: () => wav(fakeWav(), 'text/html') });

      await expect(service().synthesize('Olá.')).rejects.toBeInstanceOf(BadGatewayException);
    });

    it('rejects audio larger than VOICEBOX_MAX_AUDIO_MB', async () => {
      script({ audio: () => wav(fakeWav(600_000)) });

      await expect(service({ ...ENV, VOICEBOX_MAX_AUDIO_MB: '1' }).synthesize('Olá.')).rejects.toBeInstanceOf(
        BadGatewayException,
      );
    });

    it('rejects an oversized body even without Content-Length', async () => {
      const big = fakeWav(600_000);
      script({ audio: () => new Response(new Uint8Array(big), { status: 200, headers: { 'content-type': 'audio/x-wav' } }) });

      await expect(service({ ...ENV, VOICEBOX_MAX_AUDIO_MB: '1' }).synthesize('Olá.')).rejects.toBeInstanceOf(
        BadGatewayException,
      );
    });

    it('cancels the generation when polling fails, so two syntheses never overlap', async () => {
      script({ history: [() => json({ detail: 'boom' }, 500)] });

      await expect(service().synthesize('Olá.')).rejects.toBeInstanceOf(BadGatewayException);
      expect(calls()).toContain(`POST http://127.0.0.1:17493/generate/${GENERATION_ID}/cancel`);
    });

    it('rejects an unsafe generation id instead of using it in a path', async () => {
      script({ generate: () => json({ id: '../profiles', status: 'generating' }) });

      await expect(service().synthesize('Olá.')).rejects.toBeInstanceOf(BadGatewayException);
      expect(calls()).toHaveLength(2);
    });

    it('fails when Voicebox reports a failed generation, without exposing its error', async () => {
      script({ history: [() => json({ id: GENERATION_ID, status: 'failed', error: 'CUDA OOM at /Users/x/model' })] });

      const error = await service().synthesize('Olá.').catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(BadGatewayException);
      expect(JSON.stringify((error as BadGatewayException).getResponse())).not.toContain('/Users');
    });
  });

  describe('failures', () => {
    it('times out, cancels the generation in Voicebox and returns 504', async () => {
      script({ history: [() => json({ id: GENERATION_ID, status: 'generating' })] });

      await expect(service({ ...ENV, VOICEBOX_TIMEOUT_MS: '40' }).synthesize('Olá.')).rejects.toBeInstanceOf(
        GatewayTimeoutException,
      );
      expect(calls()).toContain(`POST http://127.0.0.1:17493/generate/${GENERATION_ID}/cancel`);
      expect(calls().some((call) => call.includes('/audio/'))).toBe(false);
    });

    it('returns 503 when Voicebox is not running', async () => {
      fetchMock.mockRejectedValue(new TypeError('fetch failed'));

      await expect(service().synthesize('Olá.')).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(calls()).toEqual(['GET http://127.0.0.1:17493/health']);
    });

    it('returns 503 when the health check does not answer in time', async () => {
      script({
        health: () =>
          new Promise<Response>((_, reject) =>
            setTimeout(() => reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' })), 5),
          ),
      });

      await expect(service().synthesize('Olá.')).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('returns 503 when Voicebox is not healthy', async () => {
      script({ health: () => json({ status: 'loading', model_loaded: false }) });

      await expect(service().synthesize('Olá.')).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(calls()).toHaveLength(1);
    });

    it('returns 502 when POST /generate is rejected', async () => {
      script({ generate: () => json({ detail: 'Profile not found' }, 404) });

      await expect(service().synthesize('Olá.')).rejects.toBeInstanceOf(BadGatewayException);
    });

    it('returns 503 without calling Voicebox when narration is disabled', async () => {
      await expect(service({ ...ENV, VOICEBOX_ENABLED: 'false' }).synthesize('Olá.')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each(['', '   \n '])('rejects empty text %j without calling Voicebox', async (text) => {
      await expect(service().synthesize(text)).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('concurrency', () => {
    it('runs one synthesis at a time', async () => {
      let active = 0;
      let peak = 0;
      script({
        generate: async () => {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, 10));
          return json({ id: GENERATION_ID, status: 'generating' });
        },
        audio: () => {
          active -= 1;
          return wav();
        },
      });
      const voicebox = service();

      await Promise.all([voicebox.synthesize('Um.'), voicebox.synthesize('Dois.')]);

      expect(peak).toBe(1);
      expect(fetchMock.mock.calls.filter(([url]) => urlOf(url).endsWith('/generate'))).toHaveLength(2);
    });

    it('refuses new work with 503 when the queue is full, and recovers afterwards', async () => {
      script({});
      const voicebox = service({ ...ENV, VOICEBOX_MAX_QUEUE: '1' });

      const first = voicebox.synthesize('Um.');
      await expect(voicebox.synthesize('Dois.')).rejects.toBeInstanceOf(ServiceUnavailableException);
      await expect(first).resolves.toBeInstanceOf(Buffer);
      await expect(voicebox.synthesize('Três.')).resolves.toBeInstanceOf(Buffer);
    });

    it('counts the timeout from the queue: a request whose time ran out while waiting never starts', async () => {
      script({
        generate: async () => {
          await new Promise((resolve) => setTimeout(resolve, 60));
          return json({ id: GENERATION_ID, status: 'completed' });
        },
      });
      const voicebox = service({ ...ENV, VOICEBOX_TIMEOUT_MS: '30' });

      const results = await Promise.allSettled([voicebox.synthesize('Um.'), voicebox.synthesize('Dois.')]);

      expect(results[1]).toMatchObject({ status: 'rejected', reason: expect.any(GatewayTimeoutException) });
      expect(fetchMock.mock.calls.filter(([url]) => urlOf(url).endsWith('/generate'))).toHaveLength(1);
    });

    it('keeps serving after a failed synthesis', async () => {
      let attempt = 0;
      script({ generate: () => (attempt++ === 0 ? json({}, 500) : json({ id: GENERATION_ID, status: 'completed' })) });
      const voicebox = service();

      await expect(voicebox.synthesize('Um.')).rejects.toBeInstanceOf(BadGatewayException);
      await expect(voicebox.synthesize('Um.')).resolves.toBeInstanceOf(Buffer);
    });
  });
});

describe('voiceSettings', () => {
  const read = (env: Record<string, string>) => (key: string) => env[key];

  it('reads the configured profile and the measured defaults', () => {
    expect(voiceSettings(read(ENV))).toMatchObject({
      enabled: true,
      baseUrl: 'http://127.0.0.1:17493',
      profileId: PROFILE_ID,
      engine: 'qwen',
      modelSize: '1.7B',
      language: 'pt',
      maxQueue: 2,
      maxChars: 400,
      problem: null,
    });
  });

  it('is disabled, without reporting a problem, unless VOICEBOX_ENABLED=true', () => {
    expect(voiceSettings(read({ VOICEBOX_ENABLED: '' }))).toMatchObject({ enabled: false, problem: null });
  });

  it.each([
    ['VOICEBOX_PROFILE_ID', '', 'VOICEBOX_PROFILE_ID'],
    ['VOICEBOX_PROFILE_ID', '../../etc', 'VOICEBOX_PROFILE_ID'],
    ['VOICEBOX_BASE_URL', 'file:///etc/passwd', 'VOICEBOX_BASE_URL'],
    ['VOICEBOX_BASE_URL', 'http://user:pass@127.0.0.1:17493', 'VOICEBOX_BASE_URL'],
    ['VOICEBOX_ENGINE', 'whisper', 'VOICEBOX_ENGINE'],
    ['VOICEBOX_MODEL_SIZE', '7B', 'VOICEBOX_MODEL_SIZE'],
    ['VOICEBOX_LANGUAGE', 'pt-BR', 'VOICEBOX_LANGUAGE'],
  ])('disables narration when %s=%j', (key, value, problem) => {
    const settings = voiceSettings(read({ ...ENV, [key]: value }));

    expect(settings.enabled).toBe(false);
    expect(settings.problem).toContain(problem);
  });
});
