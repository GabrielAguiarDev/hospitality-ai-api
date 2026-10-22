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

import { OllamaService } from './ollama.service.js';
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
});
