export interface LlmSettings {
  baseUrl: string;
  chatModel: string;
  classifierModel: string;
  embedModel: string;
  numPredict: number;
  numCtx: number;
  think: boolean;
  keepAlive: string | number;
  embedKeepAlive: string | number;
  warmup: boolean;
}

export const DEFAULT_CHAT_MODEL = 'qwen3:1.7b';
export const DEFAULT_EMBED_MODEL = 'embeddinggemma:300m-qat-q4_0';

type Read = (key: string) => string | undefined;

const text = (value: string | undefined) => value?.trim() || undefined;

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function duration(value: string | undefined, fallback: string): string | number {
  const parsed = text(value);
  if (parsed && /^-?\d+$/.test(parsed)) return Number(parsed);
  return parsed && /^\d+(?:ms|s|m|h)$/.test(parsed) ? parsed : fallback;
}

export function llmSettings(read: Read = (key) => process.env[key]): LlmSettings {
  const chatModel = text(read('OLLAMA_CHAT_MODEL')) ?? text(read('OLLAMA_MODEL')) ?? DEFAULT_CHAT_MODEL;

  return {
    baseUrl: (text(read('OLLAMA_BASE_URL')) ?? text(read('OLLAMA_URL')) ?? 'http://127.0.0.1:11434').replace(/\/+$/, ''),
    chatModel,
    classifierModel: text(read('OLLAMA_CLASSIFIER_MODEL')) ?? chatModel,
    embedModel: text(read('OLLAMA_EMBED_MODEL')) ?? DEFAULT_EMBED_MODEL,
    numPredict: positiveInt(read('OLLAMA_NUM_PREDICT'), 320),
    numCtx: positiveInt(read('OLLAMA_NUM_CTX'), 8192),
    think: text(read('OLLAMA_THINK')) === 'true',
    keepAlive: duration(read('OLLAMA_KEEP_ALIVE'), '30m'),
    embedKeepAlive: duration(read('OLLAMA_EMBED_KEEP_ALIVE'), '10m'),
    warmup: text(read('OLLAMA_WARMUP')) !== 'false',
  };
}

export interface ChatRequestOptions {
  temperature?: number;
  numPredict?: number;
  format?: object;
  structured?: boolean;
}

export function chatRequest(
  settings: LlmSettings,
  model: string,
  options: ChatRequestOptions = {},
): Record<string, unknown> {
  return {
    model,
    stream: false,
    think: options.structured ? false : settings.think,
    keep_alive: settings.keepAlive,
    ...(options.format ? { format: options.format } : {}),
    options: {
      num_ctx: settings.numCtx,
      num_predict: options.numPredict ?? settings.numPredict,
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    },
  };
}

export function llmOverrides(read: Read = (key) => process.env[key]): string[] {
  const pairs: [legacy: string, current: string][] = [
    ['OLLAMA_MODEL', 'OLLAMA_CHAT_MODEL'],
    ['OLLAMA_URL', 'OLLAMA_BASE_URL'],
  ];

  return pairs.flatMap(([legacy, current]) => {
    const old = text(read(legacy));
    const now = text(read(current));
    return old && now && old.replace(/\/+$/, '') !== now.replace(/\/+$/, '')
      ? [`${legacy}=${old} é ignorado: ${current}=${now} tem prioridade.`]
      : [];
  });
}
