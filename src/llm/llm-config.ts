/**
 * Configuração única dos modelos locais (Ollama), lida do .env.
 *
 * - OLLAMA_CHAT_MODEL: respostas do RAG. Testados: qwen3.5:2b-q4_K_M,
 *   qwen3.5:4b e qwen3:1.7b (o modelo anterior).
 * - OLLAMA_CLASSIFIER_MODEL: classificação estruturada e ferramentas;
 *   sem valor, usa o mesmo modelo das respostas.
 * - OLLAMA_EMBED_MODEL: embeddings do RAG (EmbeddingGemma).
 *
 * Os nomes antigos (OLLAMA_URL, OLLAMA_MODEL) continuam aceitos.
 */
export interface LlmSettings {
  baseUrl: string;
  chatModel: string;
  classifierModel: string;
  embedModel: string;
  numPredict: number;
  numCtx: number;
  // Modelos com raciocínio (qwen3, qwen3.5) respondem direto com think=false.
  think: boolean;
  // Tempo que o modelo fica carregado após a última chamada.
  keepAlive: string | number;
  embedKeepAlive: string | number;
  // Carrega o modelo de respostas na inicialização da API.
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

// Ollama aceita texto com unidade ("30m", "1h") ou número de segundos
// (-1 = sempre carregado, 0 = descarrega). "-1" e "300" como texto dão HTTP 400.
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
    // Respostas curtas: 1 a 3 frases ou até 5 itens.
    numPredict: positiveInt(read('OLLAMA_NUM_PREDICT'), 320),
    // Comporta os documentos recuperados e o histórico da conversa.
    numCtx: positiveInt(read('OLLAMA_NUM_CTX'), 8192),
    think: text(read('OLLAMA_THINK')) === 'true',
    keepAlive: duration(read('OLLAMA_KEEP_ALIVE'), '30m'),
    // keep_alive=0 recarregava o EmbeddingGemma a cada pergunta (~1 s).
    embedKeepAlive: duration(read('OLLAMA_EMBED_KEEP_ALIVE'), '10m'),
    warmup: text(read('OLLAMA_WARMUP')) !== 'false',
  };
}

export interface ChatRequestOptions {
  temperature?: number;
  numPredict?: number;
  format?: object;
  // Classificação e function calling: o raciocínio consumiria o num_predict.
  structured?: boolean;
}

/**
 * Corpo comum de POST /api/chat. Todas as chamadas a um mesmo modelo
 * usam o mesmo num_ctx: o Ollama recarrega o modelo (1 a 5 s) quando
 * o num_ctx muda entre duas requisições.
 */
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

/**
 * Variáveis antigas ainda definidas, mas substituídas pelas novas.
 * Evita a troca silenciosa de modelo (ex.: OLLAMA_MODEL=qwen3:1.7b
 * com OLLAMA_CHAT_MODEL=qwen3.5:4b passa a responder com o 4b).
 */
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
