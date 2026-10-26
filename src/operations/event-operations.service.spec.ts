import { InternalServerErrorException } from '@nestjs/common';

import type { IntentDecision } from '../chat/chat-intent.types.js';
import { isValidChatAction, type EventListAction } from '../contracts/chat-actions.js';
import type { ConversationState } from '../contracts/conversation-state.js';
import type { ResortEvent } from '../resort/events-catalog.service.js';
import type { ResortClock } from '../resort/resort-clock.service.js';

import { EventOperationsService } from './event-operations.service.js';
import type { OperationsToolRegistryService } from './operations-tool-registry.service.js';

const guest = { resortId: 'demo', guestId: '11111111-1111-4111-8111-111111111111' };
const TODAY = '2026-10-23';
const TOMORROW = '2026-10-24';

const event = (over: Partial<ResortEvent>): ResortEvent => ({
  id: 'e1',
  kind: 'event',
  title: 'Show de Circo',
  date: TODAY,
  time: '22:00',
  location: 'Teatro',
  category: null,
  description: null,
  ...over,
});

describe('EventOperationsService', () => {
  const execute = vi.fn();
  let now = '09:00';
  const clock = { today: () => TODAY, time: () => now } as unknown as ResortClock;
  const service = new EventOperationsService({ execute } as unknown as OperationsToolRegistryService, clock);

  let events: ResortEvent[];

  beforeEach(() => {
    now = '09:00';
    events = [
      event({ id: 'e1', title: 'Show de Circo', time: '22:00' }),
      event({ id: 'e2', title: 'Música ao vivo', time: '23:00', location: null }),
      event({ id: 'l1', kind: 'leisure', title: 'Hidroginástica', time: '10:00', location: 'Piscina' }),
    ];
    execute.mockReset();
    execute.mockImplementation(async (_name: string, _guest: unknown, input: { date: string }) => ({
      tool: 'events.list',
      data: { date: input.date, events: events.map((item) => ({ ...item, date: input.date })) },
    }));
  });

  const decide = (over: Partial<IntentDecision> = {}): IntentDecision => ({ intent: 'event.list', detail: 'none', ...over });
  const ctx = (state: ConversationState = {}) => ({ conversationId: '33333333-3333-4333-8333-333333333333', state });
  const card = (actions: unknown[] | undefined) => (actions as { type: string }[] | undefined)?.find((a) => a.type === 'event.list') as EventListAction | undefined;

  it('reads only the events.list tool for the requested date, defaulting to today', async () => {
    await service.handle('Quais eventos?', decide(), guest, ctx());
    await service.handle('E amanhã?', decide({ entities: { date: TOMORROW } }), guest, ctx());

    expect(execute.mock.calls.map(([name, , input]) => [name, input])).toEqual([
      ['events.list', { date: TODAY }],
      ['events.list', { date: TOMORROW }],
    ]);
  });

  it('hides what already passed today but not on other days', async () => {
    now = '22:30';
    const today = await service.handle('Programação de hoje', decide(), guest, ctx());
    const tomorrow = await service.handle('Programação de amanhã', decide({ entities: { date: TOMORROW } }), guest, ctx());

    expect(card(today.actions)?.items.map(({ eventId }) => eventId)).toEqual(['e2']);
    expect(card(tomorrow.actions)?.items).toHaveLength(3);
  });

  it('lists up to three items inline and returns a valid card', async () => {
    const result = await service.handle('Qual a programação?', decide(), guest, ctx());

    expect(result.reply).toBe('Para hoje: Show de Circo (22:00), Música ao vivo (23:00) e Hidroginástica (10:00).');
    expect(result.actions?.every((action) => isValidChatAction(action))).toBe(true);
    expect(result.state?.topic).toBe('event');
  });

  it('summarizes more than three items with counts and highlights, listing shows first', async () => {
    events.push(event({ id: 'e3', title: 'Baile', time: '21:00' }), event({ id: 'e4', title: 'Karaokê', time: '20:00' }));

    const result = await service.handle('Qual a programação?', decide(), guest, ctx());

    expect(result.reply).toBe('Para hoje, há 4 eventos e 1 atividade de lazer na programação. Destaques: Show de Circo (22:00), Música ao vivo (23:00) e Baile (21:00).');
    expect(card(result.actions)?.items).toHaveLength(5);
  });

  it('caps the card at 30 items and says so', async () => {
    events = Array.from({ length: 35 }, (_, i) => event({ id: `x${i}`, title: `Evento ${i}`, time: '23:00' }));

    const result = await service.handle('Qual a programação?', decide(), guest, ctx());

    expect(card(result.actions)?.items).toHaveLength(30);
    expect(result.reply).toContain('Os cards mostram os 30 primeiros horários.');
    expect(result.resultCount).toBe(35);
  });

  it('filters by period and saves date and period for the next follow-up', async () => {
    const result = await service.handle('O que tem hoje à noite?', decide({ entities: { period: 'evening' } }), guest, ctx());

    expect(card(result.actions)?.items.map(({ eventId }) => eventId)).toEqual(['e1', 'e2']);
    expect(result.reply).toBe('Para hoje à noite: Show de Circo (22:00) e Música ao vivo (23:00).');
    expect(result.state?.event).toEqual({ date: TODAY, filters: { period: 'evening' } });
  });

  it('a refinement keeps the period with the new date; a new period replaces it', async () => {
    const state: ConversationState = { topic: 'event', event: { date: TODAY, filters: { period: 'evening' } } };

    const next = await service.handle('E amanhã?', decide({ refine: true, entities: { date: TOMORROW } }), guest, ctx(state));
    expect(next.state?.event).toEqual({ date: TOMORROW, filters: { period: 'evening' } });
    expect(next.reply).toContain('amanhã à noite');

    const morning = await service.handle('E de manhã?', decide({ refine: true, entities: { period: 'morning' } }), guest, ctx(next.state));
    expect(morning.state?.event?.filters).toEqual({ period: 'morning' });
    expect(morning.state?.event?.date).toBe(TOMORROW);
    expect(card(morning.actions)?.items.map(({ eventId }) => eventId)).toEqual(['l1']);
  });

  it('without refine, previous date and filters are not reused', async () => {
    const state: ConversationState = { topic: 'event', event: { date: TOMORROW, filters: { period: 'morning' } } };

    const result = await service.handle('Quais eventos?', decide(), guest, ctx(state));

    expect(result.state?.event).toEqual({ date: TODAY, kind: 'event' });
  });

  it('keeps only shows after "Quais shows amanhã?" and a refinement reuses the kind', async () => {
    const first = await service.handle('Quais shows amanhã?', decide({ entities: { date: TOMORROW } }), guest, ctx());

    expect(card(first.actions)?.items.every(({ kind }) => kind === 'event')).toBe(true);
    expect(first.state?.event?.kind).toBe('event');

    const refined = await service.handle('E à noite?', decide({ refine: true, entities: { period: 'evening' } }), guest, ctx(first.state));

    expect(card(refined.actions)?.items.map(({ eventId }) => eventId)).toEqual(['e1', 'e2']);
    expect(refined.state?.event?.kind).toBe('event');
  });

  it('keeps only leisure activities when recreation is asked', async () => {
    const result = await service.handle('Qual a recreação de amanhã?', decide({ entities: { date: TOMORROW } }), guest, ctx());

    expect(card(result.actions)?.items.map(({ eventId }) => eventId)).toEqual(['l1']);
    expect(result.state?.event?.kind).toBe('leisure');
  });

  it('answers a named show directly with time and place', async () => {
    const result = await service.handle('Que horas é o show de circo?', decide(), guest, ctx());

    expect(result.reply).toBe('Show de Circo: hoje às 22:00, em Teatro.');
    expect(card(result.actions)?.items).toHaveLength(1);
    expect(result.resultCount).toBe(1);
  });

  it.each([
    [undefined, 'Não encontrei programação registrada para hoje.'],
    ['eventos', 'Não encontrei eventos registrados para hoje.'],
    ['recreação', 'Não encontrei atividades de lazer registradas para hoje.'],
  ])('says so without a card when nothing matches (%s)', async (word, reply) => {
    events = word === 'recreação' ? [event({ id: 'e1' })] : word === 'eventos' ? [event({ id: 'l1', kind: 'leisure', title: 'Yoga' })] : [];

    const result = await service.handle(`Quais ${word ?? 'atividades'}?`.replace('atividades', 'coisas'), decide(), guest, ctx());

    expect(result.reply).toBe(reply);
    expect(result.actions ?? []).toEqual([]);
    expect(result.resultCount).toBe(0);
  });

  it('rejects an unexpected tool result', async () => {
    execute.mockResolvedValue({ tool: 'restaurants.list', data: [] });

    await expect(service.handle('Eventos', decide(), guest, ctx())).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});
