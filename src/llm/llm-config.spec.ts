import { DEFAULT_CHAT_MODEL, DEFAULT_EMBED_MODEL, chatRequest, llmOverrides, llmSettings } from './llm-config.js';

const read = (env: Record<string, string>) => (key: string) => env[key];

describe('llmSettings', () => {
  it('uses qwen3:1.7b and EmbeddingGemma by default', () => {
    expect(llmSettings(read({}))).toEqual({
      baseUrl: 'http://127.0.0.1:11434',
      chatModel: DEFAULT_CHAT_MODEL,
      classifierModel: DEFAULT_CHAT_MODEL,
      embedModel: DEFAULT_EMBED_MODEL,
      numPredict: 320,
      numCtx: 8192,
      think: false,
      keepAlive: '30m',
      embedKeepAlive: '10m',
      warmup: true,
    });
    expect(DEFAULT_CHAT_MODEL).toBe('qwen3:1.7b');
  });

  it('switches every chat call to qwen3.5:4b from a single variable', () => {
    const settings = llmSettings(read({ OLLAMA_CHAT_MODEL: 'qwen3.5:4b' }));

    expect(settings.chatModel).toBe('qwen3.5:4b');
    expect(settings.classifierModel).toBe('qwen3.5:4b');
    // O RAG continua com EmbeddingGemma.
    expect(settings.embedModel).toBe(DEFAULT_EMBED_MODEL);
  });

  it('allows a smaller model for classification and tools', () => {
    const settings = llmSettings(read({ OLLAMA_CHAT_MODEL: 'qwen3.5:4b', OLLAMA_CLASSIFIER_MODEL: 'qwen3:1.7b' }));

    expect(settings).toMatchObject({ chatModel: 'qwen3.5:4b', classifierModel: 'qwen3:1.7b' });
  });

  it('keeps accepting the legacy variable names', () => {
    expect(llmSettings(read({ OLLAMA_URL: 'http://legacy:11434/', OLLAMA_MODEL: 'qwen3:1.7b' }))).toMatchObject({
      baseUrl: 'http://legacy:11434',
      chatModel: 'qwen3:1.7b',
    });
    // O nome novo tem prioridade.
    expect(llmSettings(read({ OLLAMA_BASE_URL: 'http://new:11434', OLLAMA_URL: 'http://legacy:11434' })).baseUrl).toBe(
      'http://new:11434',
    );
  });

  it('ignores invalid numbers and enables thinking only explicitly', () => {
    expect(llmSettings(read({ OLLAMA_NUM_PREDICT: '-1', OLLAMA_NUM_CTX: 'x', OLLAMA_THINK: 'yes' }))).toMatchObject({
      numPredict: 320,
      numCtx: 8192,
      think: false,
    });
    expect(llmSettings(read({ OLLAMA_THINK: 'true' })).think).toBe(true);
  });

  it('reads keep-alive durations and accepts only the Ollama formats', () => {
    expect(llmSettings(read({ OLLAMA_KEEP_ALIVE: '1h', OLLAMA_EMBED_KEEP_ALIVE: '-1' }))).toMatchObject({
      keepAlive: '1h',
      // Número de segundos: o Ollama recusa "-1" e "300" como texto (HTTP 400).
      embedKeepAlive: -1,
    });
    expect(llmSettings(read({ OLLAMA_KEEP_ALIVE: '0' })).keepAlive).toBe(0);
    expect(llmSettings(read({ OLLAMA_KEEP_ALIVE: '300' })).keepAlive).toBe(300);
    expect(llmSettings(read({ OLLAMA_KEEP_ALIVE: 'abc', OLLAMA_EMBED_KEEP_ALIVE: '-1m' }))).toMatchObject({
      keepAlive: '30m',
      embedKeepAlive: '10m',
    });
    expect(llmSettings(read({ OLLAMA_KEEP_ALIVE: '30m' })).keepAlive).toBe('30m');
    expect(llmSettings(read({ OLLAMA_KEEP_ALIVE: 'forever', OLLAMA_EMBED_KEEP_ALIVE: '5 minutes' }))).toMatchObject({
      keepAlive: '30m',
      embedKeepAlive: '10m',
    });
    expect(llmSettings(read({ OLLAMA_KEEP_ALIVE: '  ' })).keepAlive).toBe('30m');
  });

  it('disables the warmup only with OLLAMA_WARMUP=false', () => {
    expect(llmSettings(read({ OLLAMA_WARMUP: 'false' })).warmup).toBe(false);
    expect(llmSettings(read({ OLLAMA_WARMUP: 'true' })).warmup).toBe(true);
    expect(llmSettings(read({ OLLAMA_WARMUP: '0' })).warmup).toBe(true);
  });
});

describe('chatRequest', () => {
  const settings = llmSettings(read({ OLLAMA_NUM_CTX: '4096', OLLAMA_KEEP_ALIVE: '15m', OLLAMA_THINK: 'true' }));

  it('builds the shared body with the same num_ctx, keep_alive and think', () => {
    expect(chatRequest(settings, 'qwen3:1.7b')).toEqual({
      model: 'qwen3:1.7b',
      stream: false,
      think: true,
      keep_alive: '15m',
      options: { num_ctx: 4096, num_predict: 320 },
    });
  });

  it('keeps num_ctx equal for classifier-style and chat-style calls', () => {
    const classifier = chatRequest(settings, 'qwen3:1.7b', { temperature: 0, numPredict: 80, format: { type: 'object' } });
    const chat = chatRequest(settings, 'qwen3:1.7b');

    expect((classifier.options as Record<string, unknown>).num_ctx).toBe(
      (chat.options as Record<string, unknown>).num_ctx,
    );
    expect(classifier).toMatchObject({
      format: { type: 'object' },
      keep_alive: chat.keep_alive,
      think: chat.think,
      options: { temperature: 0, num_predict: 80 },
    });
  });

  it('forces think=false for structured calls regardless of OLLAMA_THINK', () => {
    expect(settings.think).toBe(true);
    expect(chatRequest(settings, 'm', { structured: true }).think).toBe(false);
    expect(chatRequest(settings, 'm').think).toBe(true);
  });

  it('sends numeric keep_alive as a number', () => {
    const numeric = llmSettings(read({ OLLAMA_KEEP_ALIVE: '-1' }));

    expect(chatRequest(numeric, 'm').keep_alive).toBe(-1);
  });

  it('omits format and temperature when not requested, and keeps temperature 0', () => {
    const body = chatRequest(settings, 'm');

    expect(body).not.toHaveProperty('format');
    expect(body.options).not.toHaveProperty('temperature');
    expect((chatRequest(settings, 'm', { temperature: 0 }).options as Record<string, unknown>).temperature).toBe(0);
  });
});

describe('llmOverrides', () => {
  it('warns when a legacy variable is overridden by a different value', () => {
    expect(llmOverrides(read({ OLLAMA_MODEL: 'qwen3:1.7b', OLLAMA_CHAT_MODEL: 'qwen3.5:4b' }))).toEqual([
      'OLLAMA_MODEL=qwen3:1.7b é ignorado: OLLAMA_CHAT_MODEL=qwen3.5:4b tem prioridade.',
    ]);
  });

  it('stays quiet when values match or only one name is set', () => {
    expect(
      llmOverrides(
        read({ OLLAMA_URL: 'http://x:11434/', OLLAMA_BASE_URL: 'http://x:11434', OLLAMA_MODEL: 'qwen3:1.7b' }),
      ),
    ).toEqual([]);
  });
});
