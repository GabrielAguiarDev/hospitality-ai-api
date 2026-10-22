import {
  BadGatewayException,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  connectionError,
  installFetchMock,
  jsonResponse,
  ollamaChat,
  requestBody,
  timeoutError,
} from '../../test/support/ollama-fakes.js';
import type { FetchMock } from '../../test/support/ollama-fakes.js';
import type { IntentDecision } from '../chat/chat-intent.types.js';
import type { GuestContext } from '../guest/guest-context.js';

import { OperationsAiService } from './operations-ai.service.js';
import { OperationsToolRegistryService } from './operations-tool-registry.service.js';
import type { RestaurantReservation } from './reservations.service.js';

const TRATTORIA: RestaurantReservation = {
  id: 'res-1',
  restaurant: 'Trattoria Aurora',
  reservedAt: '24/10/2026 20:00',
  partySize: 4,
  status: 'confirmed',
};

const SABOR_DO_MAR: RestaurantReservation = {
  id: 'res-2',
  restaurant: 'Sabor do Mar',
  reservedAt: '25/10/2026 12:30',
  partySize: 1,
  status: 'pending',
};

const GUEST: GuestContext = { resortId: 'resort-1', guestId: 'guest-001' };

const LIST: IntentDecision = { intent: 'reservation.list', detail: 'none' };

function toolCall(name: string, args: Record<string, unknown> = {}) {
  return ollamaChat('', {
    tool_calls: [{ type: 'function', function: { name, arguments: args } }],
  });
}

describe('OperationsAiService', () => {
  let fetchMock: FetchMock;
  let registry: { execute: ReturnType<typeof vi.fn<OperationsToolRegistryService['execute']>> };
  let errorSpy: ReturnType<typeof vi.spyOn>;

  function givenReservations(data: RestaurantReservation[]) {
    registry.execute.mockResolvedValue({ tool: 'reservations.list', data });
  }

  function createService(nodeEnv = 'development') {
    return new OperationsAiService(
      registry as unknown as OperationsToolRegistryService,
      new ConfigService({
        NODE_ENV: nodeEnv,
        OLLAMA_BASE_URL: 'http://ollama.test:11434',
        OLLAMA_CHAT_MODEL: 'qwen3:1.7b',
      }),
    );
  }

  beforeEach(() => {
    fetchMock = installFetchMock();
    fetchMock.mockImplementation(async () =>
      toolCall('list_my_restaurant_reservations'),
    );
    registry = { execute: vi.fn() };
    errorSpy = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('data source', () => {
    it('always reads reservations through the tool registry, even if the model does not request the tool', async () => {
      fetchMock.mockImplementation(async () =>
        ollamaChat('Você não possui reservas.'),
      );
      givenReservations([TRATTORIA]);

      const result = await createService().ask('Tenho alguma reserva?', GUEST);

      expect(registry.execute).toHaveBeenCalledExactlyOnceWith('reservations.list', GUEST);
      expect(result).toMatchObject({
        toolUsed: true,
        toolRequestedByModel: false,
        reservationsFound: 1,
      });
      // The model's hallucinated "no reservations" text never reaches the guest.
      expect(result.reply).not.toContain('não possui');
      expect(result.reply).toContain('Encontrei 1 reserva');
    });

    it('reports when the model correctly requested the tool', async () => {
      givenReservations([TRATTORIA]);

      const result = await createService().ask('Tenho alguma reserva?', GUEST);

      expect(result.toolRequestedByModel).toBe(true);
    });

    it('skips Ollama when the orchestrator already supplied the decision', async () => {
      givenReservations([TRATTORIA]);

      const result = await createService().ask('Tenho alguma reserva?', GUEST, LIST);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        toolUsed: true,
        toolRequestedByModel: false,
        reservationsFound: 1,
      });
    });

    it.each([
      ['an unknown tool name', () => toolCall('run_sql', { sql: 'DROP TABLE demo_restaurant_reservations' })],
      ['SQL passed as tool arguments', () => toolCall('list_my_restaurant_reservations', { sql: 'SELECT * FROM chat_messages', guest_id: 'guest-999' })],
    ])('answers from the database, not the model, when it returns %s', async (_case, makeResponse) => {
      fetchMock.mockResolvedValue(makeResponse());
      givenReservations([TRATTORIA]);

      const result = await createService().ask('Tenho alguma reserva?', GUEST);

      // The registry is called with the tool name and the authenticated
      // guest only; model-supplied arguments never reach it.
      expect(registry.execute).toHaveBeenCalledExactlyOnceWith('reservations.list', GUEST);
      expect(result.toolRequestedByModel).toBe(_case === 'SQL passed as tool arguments');
      expect(result.reply).toContain('Trattoria Aurora');
      expect(result.reply).not.toMatch(/DROP|SELECT|guest-999/);
    });

    it('exposes a tool without parameters, so the model cannot supply SQL or identifiers', async () => {
      givenReservations([]);

      await createService().ask('Tenho alguma reserva?', GUEST);

      const body = requestBody(fetchMock);
      expect(body.tools).toEqual([
        expect.objectContaining({
          function: expect.objectContaining({
            name: 'list_my_restaurant_reservations',
            parameters: { type: 'object', properties: {}, required: [] },
          }),
        }),
      ]);
      expect(body).toMatchObject({ model: 'qwen3:1.7b', stream: false });
      expect(fetchMock.mock.calls[0][0]).toBe('http://ollama.test:11434/api/chat');
    });

    it('rejects a registry result for a different tool', async () => {
      registry.execute.mockResolvedValue({ tool: 'requests.list', data: [] });

      await expect(
        createService().ask('Tenho alguma reserva?', GUEST, LIST),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });

    it('propagates database failures', async () => {
      registry.execute.mockRejectedValue(new Error('ER_ACCESS_DENIED_ERROR'));

      await expect(
        createService().ask('Tenho alguma reserva?', GUEST, LIST),
      ).rejects.toThrow('ER_ACCESS_DENIED_ERROR');
    });
  });

  describe('production guard', () => {
    it('refuses the demo query in production without calling Ollama or the database', async () => {
      await expect(
        createService('production').ask('Tenho alguma reserva?', GUEST, LIST),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(registry.execute).not.toHaveBeenCalled();
    });
  });

  // KNOWN LIMITATION, not a desired behaviour: without an orchestrator
  // decision the reply is still built only from the database, yet a failed
  // function-calling round trip blocks it. These tests document the current
  // contract; flip them if the dependency on Ollama is made optional.
  describe('Ollama failures (no orchestrator decision)', () => {
    it.each<[string, () => void]>([
      ['connection refused', () => fetchMock.mockRejectedValue(connectionError())],
      ['timeout', () => fetchMock.mockRejectedValue(timeoutError())],
      ['HTTP 500', () => fetchMock.mockResolvedValue(jsonResponse({ error: 'boom' }, 500))],
      ['a response without message', () => fetchMock.mockResolvedValue(jsonResponse({ done: true }))],
    ])('throws BadGatewayException on %s (current contract)', async (_case, arrange) => {
      arrange();
      givenReservations([TRATTORIA]);

      await expect(
        createService().ask('Tenho alguma reserva?', GUEST),
      ).rejects.toBeInstanceOf(BadGatewayException);
      expect(registry.execute).not.toHaveBeenCalled();
    });

    it('logs the HTTP error details without exposing them to the guest', async () => {
      fetchMock.mockResolvedValue(
        new Response('internal stack trace', { status: 500 }),
      );

      const error = await createService()
        .ask('Tenho alguma reserva?', GUEST)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(BadGatewayException);
      expect((error as BadGatewayException).message).not.toContain('stack trace');
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('internal stack trace'),
      );
    });
  });

  describe('reply formatting', () => {
    it('answers that there are no reservations only when the query returns none', async () => {
      givenReservations([]);

      const result = await createService().ask('Tenho alguma reserva?', GUEST, LIST);

      expect(result.reply).toBe(
        'Não encontrei reservas de restaurante no seu cadastro.',
      );
      expect(result.reservationsFound).toBe(0);
    });

    it.each<IntentDecision>([
      LIST,
      { intent: 'reservation.details', detail: 'party_size' },
      { intent: 'reservation.status', detail: 'none' },
    ])('never says there are no reservations when records exist ($intent)', async (decision) => {
      givenReservations([TRATTORIA]);

      const { reply } = await createService().ask('Tenho reserva?', GUEST, decision);

      expect(reply).not.toMatch(/não encontrei|nenhuma reserva|não possui/i);
    });

    it('lists every reservation with date, time, party size and status from the database', async () => {
      givenReservations([TRATTORIA, SABOR_DO_MAR]);

      const { reply } = await createService().ask('Quais são minhas reservas?', GUEST, LIST);

      expect(reply).toContain('Encontrei 2 reservas de restaurante no seu cadastro:');
      expect(reply).toContain('Trattoria Aurora\nData: 24/10/2026 às 20:00\nPessoas: 4\nStatus: confirmada');
      expect(reply).toContain('Sabor do Mar\nData: 25/10/2026 às 12:30\nPessoas: 1\nStatus: pendente');
    });

    it.each<[IntentDecision, string]>([
      [{ intent: 'reservation.details', detail: 'party_size' }, 'Sua reserva na Trattoria Aurora é para 4 pessoas.'],
      [{ intent: 'reservation.details', detail: 'date' }, 'Sua reserva na Trattoria Aurora está marcada para 24/10/2026.'],
      [{ intent: 'reservation.details', detail: 'time' }, 'Sua reserva na Trattoria Aurora está marcada para as 20:00.'],
      [{ intent: 'reservation.details', detail: 'restaurant' }, 'Sua reserva está cadastrada no restaurante Trattoria Aurora.'],
      [{ intent: 'reservation.status', detail: 'none' }, 'Sua reserva na Trattoria Aurora está confirmada.'],
      [{ intent: 'reservation.details', detail: 'none' }, 'Sua reserva na Trattoria Aurora:\nData: 24/10/2026 às 20:00\nPessoas: 4\nStatus: confirmada'],
    ])('answers $intent/$detail with the stored values', async (decision, expected) => {
      givenReservations([TRATTORIA]);

      const { reply } = await createService().ask('pergunta', GUEST, decision);

      expect(reply).toBe(expected);
    });

    it('uses the singular for a party of one', async () => {
      givenReservations([SABOR_DO_MAR]);

      const { reply } = await createService().ask('Quantas pessoas?', GUEST, {
        intent: 'reservation.details',
        detail: 'party_size',
      });

      expect(reply).toBe('Sua reserva na Sabor do Mar é para 1 pessoa.');
    });

    it.each([
      ['confirmed', 'confirmada'],
      ['CONFIRMED', 'confirmada'],
      ['pending', 'pendente'],
      ['cancelled', 'cancelada'],
      ['canceled', 'cancelada'],
      ['no_show', 'registrada com status "no_show"'],
    ])('translates status "%s" to "%s"', async (status, label) => {
      givenReservations([{ ...TRATTORIA, status }]);

      const { reply } = await createService().ask('Está confirmada?', GUEST, {
        intent: 'reservation.status',
        detail: 'none',
      });

      expect(reply).toBe(`Sua reserva na Trattoria Aurora está ${label}.`);
    });

    it('selects the reservation whose restaurant is mentioned, ignoring accents and case', async () => {
      givenReservations([
        TRATTORIA,
        { ...SABOR_DO_MAR, restaurant: 'Café Jardim', partySize: 2 },
      ]);

      const { reply } = await createService().ask(
        'Para quantas pessoas é a reserva no cafe jardim?', GUEST,
        { intent: 'reservation.details', detail: 'party_size' },
      );

      expect(reply).toBe('Sua reserva na Café Jardim é para 2 pessoas.');
    });

    it('asks which reservation when several match and none is mentioned', async () => {
      givenReservations([TRATTORIA, SABOR_DO_MAR]);

      const { reply } = await createService().ask('E para quantas pessoas?', GUEST, {
        intent: 'reservation.details',
        detail: 'party_size',
      });

      expect(reply).toContain('Encontrei 2 reservas relacionadas à sua consulta.');
      expect(reply).toContain('De qual reserva você deseja os detalhes?');
      expect(reply).not.toMatch(/\d+ pessoas?\./);
    });
  });
});
