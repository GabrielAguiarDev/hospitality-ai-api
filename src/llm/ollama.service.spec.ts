import {
  BadGatewayException,
  GatewayTimeoutException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

import {
  connectionError,
  installFetchMock,
  jsonResponse,
  ollamaChat,
  requestBody,
  timeoutError,
} from '../../test/support/ollama-fakes.js';
import type { FetchMock } from '../../test/support/ollama-fakes.js';

import { OllamaService, completeSentences } from './ollama.service.js';
import type { LlmMessage } from './ollama.service.js';

const MESSAGES: LlmMessage[] = [
  { role: 'system', content: 'Você é Yago.' },
  { role: 'user', content: 'Olá' },
];

describe('OllamaService', () => {
  let fetchMock: FetchMock;
  let service: OllamaService;

  beforeEach(() => {
    // The service reads process.env when it is constructed.
    vi.stubEnv('OLLAMA_URL', 'http://ollama.test:11434');
    vi.stubEnv('OLLAMA_MODEL', 'qwen3:1.7b');
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    fetchMock = installFetchMock();
    service = new OllamaService();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sends the messages to /api/chat and returns the trimmed content', async () => {
    fetchMock.mockResolvedValue(ollamaChat('  Olá! Como posso ajudar?\n'));

    await expect(service.generate(MESSAGES)).resolves.toBe(
      'Olá! Como posso ajudar?',
    );

    expect(fetchMock.mock.calls[0][0]).toBe('http://ollama.test:11434/api/chat');
    expect(requestBody(fetchMock)).toMatchObject({
      model: 'qwen3:1.7b',
      stream: false,
      messages: MESSAGES,
    });
  });

  it.each<[string, () => void, new (...args: never[]) => Error]>([
    ['a timeout', () => fetchMock.mockRejectedValue(timeoutError()), GatewayTimeoutException],
    ['a connection failure', () => fetchMock.mockRejectedValue(connectionError()), ServiceUnavailableException],
    ['an HTTP error', () => fetchMock.mockResolvedValue(jsonResponse({ error: 'x' }, 500)), BadGatewayException],
    ['a non-JSON body', () => fetchMock.mockResolvedValue(new Response('<html>', { status: 200 })), BadGatewayException],
    ['an empty content', () => fetchMock.mockResolvedValue(ollamaChat('   ')), BadGatewayException],
    ['a missing message', () => fetchMock.mockResolvedValue(jsonResponse({ done: true })), BadGatewayException],
  ])('maps %s to the matching HTTP exception', async (_case, arrange, expected) => {
    arrange();

    await expect(service.generate(MESSAGES)).rejects.toBeInstanceOf(expected);
  });

  it('sends keep_alive, think and the configured num_ctx and honors per-call options', async () => {
    fetchMock.mockResolvedValue(ollamaChat('Ok.'));

    await service.generate(MESSAGES, { temperature: 0, numPredict: 50 });

    expect(requestBody(fetchMock)).toMatchObject({
      think: false,
      keep_alive: '30m',
      options: { num_ctx: 8192, num_predict: 50, temperature: 0 },
    });
  });

  it('trims a reply cut by the token limit to complete sentences', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ message: { role: 'assistant', content: 'O spa abre às 9h. Fecha às 18h. O jantar é' }, done_reason: 'length' }),
    );

    await expect(service.generate(MESSAGES)).resolves.toBe('O spa abre às 9h. Fecha às 18h.');
  });

  it('does not trim a reply that finished normally', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ message: { role: 'assistant', content: 'Abre às 9h. Sem ponto final' }, done_reason: 'stop' }),
    );

    await expect(service.generate(MESSAGES)).resolves.toBe('Abre às 9h. Sem ponto final');
  });

  it('does not warm up the models from onModuleInit', () => {
    service.onModuleInit();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('warmup() loads the chat model with keep_alive and the same num_ctx', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));

    await service.warmup();

    expect(fetchMock).toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][0]).toBe('http://ollama.test:11434/api/generate');
    expect(requestBody(fetchMock)).toMatchObject({ model: 'qwen3:1.7b', keep_alive: '30m', options: { num_ctx: 8192 } });
  });

  it('warmup() survives an unavailable Ollama', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    fetchMock.mockRejectedValue(connectionError());

    await expect(service.warmup()).resolves.toBeUndefined();
  });

  it('warmup() returns early with OLLAMA_WARMUP=false', async () => {
    vi.stubEnv('OLLAMA_WARMUP', 'false');

    await new OllamaService().warmup();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('completeSentences', () => {
  it('cuts after the last sentence mark when it is past the middle of the text', () => {
    expect(completeSentences('Um. Dois! Três? Quatr')).toBe('Um. Dois! Três?');
    expect(completeSentences('Linha um\nLinha dois\nLin')).toBe('Linha um\nLinha dois');
  });

  it('keeps the whole text when the only complete sentence is too short', () => {
    expect(completeSentences('Ok. e depois continuava sem parar')).toBe('Ok. e depois continuava sem parar');
  });

  it('keeps text without any sentence mark and trims whitespace', () => {
    expect(completeSentences('  sem pontuação  ')).toBe('sem pontuação');
    expect(completeSentences('Já completa.')).toBe('Já completa.');
  });
});
