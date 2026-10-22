import { vi } from 'vitest';

/**
 * Helpers for simulating the Ollama HTTP API in unit tests.
 * None of them perform real network calls.
 */

export type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Shape returned by `POST /api/chat` with `stream: false`. */
export function ollamaChat(
  content: string,
  extra: Record<string, unknown> = {},
): Response {
  return jsonResponse({
    message: { role: 'assistant', content, ...extra },
    done: true,
  });
}

/** Accepts plain strings so tests can also simulate out-of-schema values. */
export function classification(intent: string, detail: string): Response {
  return ollamaChat(JSON.stringify({ intent, detail }));
}

export function timeoutError(): DOMException {
  return new DOMException(
    'The operation was aborted due to timeout',
    'TimeoutError',
  );
}

export function connectionError(): TypeError {
  return new TypeError('fetch failed', {
    cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:11434'), {
      code: 'ECONNREFUSED',
    }),
  });
}

export function parseBody(init: RequestInit | undefined): Record<string, unknown> {
  if (typeof init?.body !== 'string') {
    throw new Error('fetch was called without a JSON body');
  }

  return JSON.parse(init.body) as Record<string, unknown>;
}

/** Parses the JSON body sent in the n-th fetch call. */
export function requestBody(
  fetchMock: FetchMock,
  call = 0,
): Record<string, unknown> {
  return parseBody(fetchMock.mock.calls[call]?.[1]);
}

export function installFetchMock(): FetchMock {
  const fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
