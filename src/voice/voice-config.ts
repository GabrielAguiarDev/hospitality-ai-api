export interface VoiceSettings {
  enabled: boolean;
  baseUrl: string;
  profileId: string;
  engine: string;
  modelSize: string;
  language: string;
  timeoutMs: number;
  healthTimeoutMs: number;
  pollIntervalMs: number;
  maxQueue: number;
  maxChars: number;
  cacheMaxBytes: number;
  maxAudioBytes: number;
  problem: string | null;
}

type Read = (key: string) => string | undefined;

const text = (value: string | undefined) => value?.trim() || undefined;

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const ENGINES = /^(qwen|qwen_custom_voice|luxtts|chatterbox|chatterbox_turbo|tada|kokoro)$/;
const MODEL_SIZES = /^(1\.7B|0\.6B|1B|3B)$/;
const LANGUAGES = /^(zh|en|ja|ko|de|fr|ru|pt|es|it|he|ar|da|el|fi|hi|ms|nl|no|pl|sv|sw|tr)$/;
const PROFILE_ID = /^[A-Za-z0-9-]{1,64}$/;

function httpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function voiceSettings(read: Read = (key) => process.env[key]): VoiceSettings {
  const settings = {
    baseUrl: (text(read('VOICEBOX_BASE_URL')) ?? 'http://127.0.0.1:17493').replace(/\/+$/, ''),
    profileId: text(read('VOICEBOX_PROFILE_ID')) ?? '',
    engine: text(read('VOICEBOX_ENGINE')) ?? 'qwen',
    modelSize: text(read('VOICEBOX_MODEL_SIZE')) ?? '1.7B',
    language: text(read('VOICEBOX_LANGUAGE')) ?? 'pt',
    timeoutMs: positiveInt(read('VOICEBOX_TIMEOUT_MS'), 180_000),
    healthTimeoutMs: positiveInt(read('VOICEBOX_HEALTH_TIMEOUT_MS'), 3_000),
    pollIntervalMs: positiveInt(read('VOICEBOX_POLL_INTERVAL_MS'), 500),
    maxQueue: positiveInt(read('VOICEBOX_MAX_QUEUE'), 2),
    maxChars: positiveInt(read('VOICEBOX_MAX_CHARS'), 400),
    cacheMaxBytes: positiveInt(read('VOICEBOX_CACHE_MAX_MB'), 32) * 1024 * 1024,
    maxAudioBytes: positiveInt(read('VOICEBOX_MAX_AUDIO_MB'), 20) * 1024 * 1024,
  };

  const problem = !httpUrl(settings.baseUrl)
    ? 'VOICEBOX_BASE_URL inválida'
    : !PROFILE_ID.test(settings.profileId)
      ? 'VOICEBOX_PROFILE_ID ausente ou inválido'
      : !ENGINES.test(settings.engine)
        ? `VOICEBOX_ENGINE não suportado: ${settings.engine}`
        : !MODEL_SIZES.test(settings.modelSize)
          ? `VOICEBOX_MODEL_SIZE não suportado: ${settings.modelSize}`
          : !LANGUAGES.test(settings.language)
            ? `VOICEBOX_LANGUAGE não suportado: ${settings.language}`
            : null;

  const requested = text(read('VOICEBOX_ENABLED')) === 'true';

  return {
    ...settings,
    enabled: requested && problem === null,
    problem: requested ? problem : null,
  };
}
