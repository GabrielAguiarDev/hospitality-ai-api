import { InternalServerErrorException } from '@nestjs/common';

import type { ChatAction, RestaurantOptionsAction } from '../contracts/chat-actions.js';
import { isValidChatAction } from '../contracts/chat-actions.js';
import type { ResortClock } from '../resort/resort-clock.service.js';
import type { RestaurantInfo } from '../resort/restaurants-catalog.service.js';

import type { OperationsToolRegistryService } from './operations-tool-registry.service.js';
import { RestaurantOperationsService } from './restaurant-operations.service.js';

const guest = { resortId: 'demo', guestId: '11111111-1111-4111-8111-111111111111' };

const restaurant = (over: Partial<RestaurantInfo>): RestaurantInfo => ({
  id: 'r1',
  name: 'Trattoria Bella',
  type: null,
  openingHours: '19h às 23h',
  description: '',
  location: null,
  acceptsReservations: true,
  minimumAge: null,
  reservationTimes: ['19:00', '21:00'],
  ...over,
});

const RESTAURANTS = [
  restaurant({ id: 'r1', name: 'Trattoria Bella' }),
  restaurant({ id: 'r2', name: 'Churrascaria Gaucha', reservationTimes: [] }),
  restaurant({ id: 'r3', name: 'Snack Piscina', acceptsReservations: false, openingHours: null }),
  restaurant({ id: 'r4', name: 'Sushi Sakura' }),
  restaurant({ id: 'r5', name: 'Sushi Zen' }),
];

describe('RestaurantOperationsService', () => {
  const execute = vi.fn();
  // Sexta-feira, 10:30 no resort.
  const clock = { today: () => '2026-10-23', time: () => '10:30' };
  const service = new RestaurantOperationsService(
    { execute } as unknown as OperationsToolRegistryService,
    clock as unknown as ResortClock,
  );

  beforeEach(() => {
    execute.mockReset();
    execute.mockResolvedValue({ tool: 'restaurants.list', data: RESTAURANTS });
  });

  const onlyListTool = () => {
    for (const call of execute.mock.calls) {
      expect(call[0]).toBe('restaurants.list');
    }
  };

  it('single bookable match returns navigate with the real restaurantId and mentions dish selection', async () => {
    const result = await service.handleBooking('Quero reservar no Trattoria Bella hoje', guest);

    expect(result.tool).toBe('restaurants.list');
    expect(result.actions).toEqual([
      { type: 'navigate', label: 'Abrir Gastronomia', screen: 'Gastronomy', params: { restaurantId: 'r1' } },
    ]);
    expect(result.reply).toBe(
      'A reserva do Trattoria Bella é feita pelo aplicativo, com a escolha dos pratos. Turnos cadastrados 19:00 e 21:00; toque em "Abrir Gastronomia" para continuar.',
    );
    expect(result.reply).toContain('escolha dos pratos');
    onlyListTool();
  });

  it('omits reservation times when none are registered', async () => {
    const result = await service.handleBooking('reservar na Churrascaria Gaucha', guest);
    expect(result.actions?.[0]).toMatchObject({ params: { restaurantId: 'r2' } });
    expect(result.reply).not.toContain('Turnos cadastrados');
    expect(result.reply).toContain('Toque em "Abrir Gastronomia"');
  });

  it('non bookable restaurant explains and lists bookable ones', async () => {
    const result = await service.handleBooking('reservar o Snack Piscina', guest);

    expect(result.reply).toContain('não trabalha com reservas pelo aplicativo');
    expect(result.reply).toContain('Trattoria Bella');
    expect(result.reply).not.toContain('Snack Piscina, ');
    expect(result.actions).toEqual([
      expect.objectContaining({ type: 'navigate', params: { restaurantId: 'r3' } }),
    ]);
  });

  it('ambiguous matches ask which one and navigate without params', async () => {
    const result = await service.handleBooking('reservar no sushi', guest);

    expect(result.reply).toContain('mais de um restaurante');
    expect(result.reply).toContain('Sushi Sakura');
    expect(result.reply).toContain('Sushi Zen');
    expect(result.actions).toEqual([
      { type: 'navigate', label: 'Abrir Gastronomia', screen: 'Gastronomy', params: {} },
    ]);
  });

  it('no match navigates without params and lists bookable restaurants', async () => {
    const result = await service.handleBooking('quero reservar uma mesa', guest);

    expect(result.reply).toContain('Não identifiquei');
    expect(result.reply).toContain('Trattoria Bella');
    expect(result.reply).not.toContain('Snack Piscina');
    expect(result.actions).toEqual([
      { type: 'navigate', label: 'Abrir Gastronomia', screen: 'Gastronomy', params: {} },
    ]);
  });

  it('works when no restaurant accepts reservations', async () => {
    execute.mockResolvedValue({ tool: 'restaurants.list', data: [restaurant({ acceptsReservations: false })] });
    const result = await service.handleBooking('algo', guest);
    expect(result.reply).not.toContain('com reserva pelo aplicativo são');
  });

  it('never calls booking tools', async () => {
    await service.handleBooking('reservar no Trattoria Bella', guest);
    await service.handleBooking('reservar no sushi', guest);
    await service.handleBooking('nada', guest);
    await service.findMentioned('Trattoria Bella', guest);

    expect(execute.mock.calls.every(([name]) => name === 'restaurants.list')).toBe(true);
    expect(execute.mock.calls.some(([name]) => String(name).includes('booking'))).toBe(false);
  });

  it('findMentioned returns matched restaurants', async () => {
    const found = await service.findMentioned('e o Sushi Zen?', guest);
    expect(found.map((r) => r.id)).toEqual(['r5']);
    expect(await service.findMentioned('bom dia', guest)).toEqual([]);
  });

  it('rejects unexpected tool results', async () => {
    execute.mockResolvedValue({ tool: 'requests.list', data: [] });
    await expect(service.handleBooking('x', guest)).rejects.toThrow(InternalServerErrorException);
    await expect(service.findMentioned('x', guest)).rejects.toThrow(InternalServerErrorException);
  });

  it('propagates tool failures', async () => {
    execute.mockImplementation(async () => {
      throw new Error('db down');
    });
    await expect(service.handleBooking('x', guest)).rejects.toThrow('db down');
  });

  describe('large catalog', () => {
    const CATALOG = [
      ...['Gino', 'Central', 'Omakase'].map((name, i) => restaurant({ id: `r${i}`, name, type: 'restaurante' })),
      ...['Mirante', 'Topázio', 'Villagio', 'Corais'].map((name, i) => restaurant({ id: `b${i}`, name: `Bar ${name}`, type: 'bar' })),
      ...['Pizzaria', 'Hamburgueria', 'Gelateria'].map((name, i) => restaurant({ id: `f${i}`, name, type: 'alimentacao' })),
    ];
    const ctx = { conversationId: '33333333-3333-4333-8333-333333333333', state: {} };
    const list = { intent: 'restaurant.list' as const, detail: 'none' as const };

    const cards = (actions: ChatAction[] | undefined) =>
      (actions?.find((action) => action.type === 'restaurant.options') as RestaurantOptionsAction | undefined)?.options ?? [];

    beforeEach(() => {
      execute.mockResolvedValue({ tool: 'restaurants.list', data: CATALOG });
    });

    it('summarizes the full catalog briefly, restaurants first, with the list in the card', async () => {
      const result = await service.handle('Quais as opções de gastronomia?', list, guest, ctx);

      expect(result.reply).toBe('Separei 6 opções de gastronomia: Gino, Central, Omakase e mais 3. Há mais 4; quer ver todas?');
      expect(result.reply).not.toContain('\n');
      expect(result.reply.length).toBeLessThanOrEqual(200);
      expect(cards(result.actions).map(({ name }) => name).slice(0, 3)).toEqual(['Gino', 'Central', 'Omakase']);
      expect(cards(result.actions)).toHaveLength(6);
      expect(result.actions?.every(isValidChatAction)).toBe(true);
      expect(result.actions?.at(-1)).toEqual({ type: 'navigate', label: 'Abrir Gastronomia', screen: 'Gastronomy', params: {} });
      expect(result.pendingQuestion).toEqual({ intent: 'restaurant.list', targetId: 'all' });
      expect(result.state?.restaurant?.listed).toHaveLength(6);
    });

    const answered = (targetId: string) => ({
      ...ctx,
      state: { topic: 'restaurant' as const, pendingQuestion: { intent: 'restaurant.list' as const, targetId } },
    });
    const yes = { ...list, answersPending: true };

    it('shows every option after a "yes"', async () => {
      const result = await service.handle('Sim', yes, guest, answered('all'));

      expect(cards(result.actions)).toHaveLength(10);
      expect(result.reply).toMatch(/^Separei 10 opções de gastronomia: /);
      expect(result.reply).not.toContain('quer ver todas');
      expect(result.pendingQuestion).toBeUndefined();
    });

    it('keeps the requested type when expanding a filtered list', async () => {
      const bars = Array.from({ length: 12 }, (_, i) => restaurant({ id: `x${i}`, name: `Bar ${i + 1}`, type: 'bar' }));
      execute.mockResolvedValue({ tool: 'restaurants.list', data: [...CATALOG.filter(({ type }) => type !== 'bar'), ...bars] });

      const first = await service.handle('Quais bares?', list, guest, ctx);
      expect(first.pendingQuestion).toEqual({ intent: 'restaurant.list', targetId: 'all:bar' });
      expect(cards(first.actions)).toHaveLength(10);
      expect(first.reply).toContain('Há mais 2; quer ver todas?');

      const result = await service.handle('sim', yes, guest, answered('all:bar'));
      expect(result.reply).toMatch(/^Encontrei 12 bares: /);
      expect(cards(result.actions)).toHaveLength(12);
      expect(cards(result.actions).every(({ type }) => type === 'bar')).toBe(true);
      expect(result.reply).not.toMatch(/Gino|Pizzaria/);
    });

    it('does not ask "ver todas" again on an expanded list', async () => {
      const many = Array.from({ length: 25 }, (_, i) => restaurant({ id: `m${i}`, name: `Opção ${i + 1}`, type: 'restaurante' }));
      execute.mockResolvedValue({ tool: 'restaurants.list', data: many });

      const result = await service.handle('sim', yes, guest, answered('all'));

      expect(cards(result.actions)).toHaveLength(20);
      // O restante não some em silêncio.
      expect(result.reply).toContain('As outras 5 estão na tela de Gastronomia.');
      expect(result.reply).not.toContain('Quer ver todas?');
      expect(result.reply).not.toContain('quer ver todas');
      expect(result.pendingQuestion).toBeUndefined();
    });

    it('lists a specific type without truncating it to the summary', async () => {
      const result = await service.handle('E os bares?', list, guest, ctx);

      expect(result.reply).toBe('Encontrei 4 bares: Bar Mirante, Bar Topázio, Bar Villagio e mais 1.');
      expect(cards(result.actions)).toHaveLength(4);
      expect(result.state?.restaurant?.filters).toEqual({ type: 'bar' });
    });

    it('uses the singular noun for a single match', async () => {
      const result = await service.handle('Tem algum bar?', list, guest, ctx);
      expect(result.reply).toMatch(/^Encontrei 4 bares/);

      execute.mockResolvedValue({ tool: 'restaurants.list', data: [restaurant({ id: 'b1', name: 'Bar Único', type: 'bar' })] });
      const single = await service.handle('Quais bares?', list, guest, ctx);
      expect(single.reply).toBe('Encontrei 1 bar: Bar Único.');
    });

    it('reports an empty catalog without cards', async () => {
      execute.mockResolvedValue({ tool: 'restaurants.list', data: [] });
      const result = await service.handle('Quais bares?', list, guest, ctx);

      expect(result.reply).toBe('Não encontrei bares ativos no cadastro do resort.');
      expect(result.actions ?? []).toEqual([]);
      expect(result.resultCount).toBe(0);
    });
  });

  describe('filters', () => {
    const ctx = { conversationId: '33333333-3333-4333-8333-333333333333', state: {} };
    const list = { intent: 'restaurant.list' as const, detail: 'none' as const };
    const cards = (actions: ChatAction[] | undefined) =>
      (actions?.find((action) => action.type === 'restaurant.options') as RestaurantOptionsAction | undefined)?.options ?? [];

    const CATALOG = [
      restaurant({ id: 'j1', name: 'Omakase', type: 'restaurante', description: 'Culinária japonesa', openingHours: 'Jantar: 19h às 22h', reservationTimes: ['19:00', '21:30'] }),
      restaurant({ id: 'i1', name: 'Gino', type: 'restaurante', description: 'Cozinha italiana', openingHours: 'Almoço: 12h às 15h. Jantar: 19h às 22h', acceptsReservations: false }),
      restaurant({ id: 'b1', name: 'Bar Villagio', type: 'bar', description: '', openingHours: '10h às 18h', acceptsReservations: false, reservationTimes: [] }),
      restaurant({ id: 'b2', name: 'Bar Mirante', type: 'bar', description: '', openingHours: null, acceptsReservations: false, reservationTimes: [] }),
      restaurant({ id: 'f1', name: 'Pizzaria', type: 'alimentacao', description: 'Pizza no forno', openingHours: '12h às 23h', acceptsReservations: false, reservationTimes: [] }),
    ];

    beforeEach(() => {
      execute.mockResolvedValue({ tool: 'restaurants.list', data: CATALOG });
    });

    it('filters by cuisine, using name and description from the cadastro', async () => {
      const result = await service.handle('Tem restaurante japonês?', list, guest, ctx);

      expect(result.reply).toBe('Encontrei 1 restaurante de cozinha japonesa: Omakase.');
      expect(cards(result.actions).map(({ restaurantId }) => restaurantId)).toEqual(['j1']);
      expect(result.state?.restaurant?.filters).toEqual({ type: 'restaurante', cuisine: 'japonesa' });
    });

    it('filters "com reserva" using only restaurants that accept reservations', async () => {
      const result = await service.handle('Quais restaurantes com reserva?', list, guest, ctx);

      expect(cards(result.actions).map(({ restaurantId }) => restaurantId)).toEqual(['j1']);
      expect(result.reply).toContain('com reserva pelo aplicativo');
    });

    it('filters by an evening window and never claims restaurants without hours as open', async () => {
      const result = await service.handle('Quais bares estão abertos à noite?', { ...list, entities: { period: 'evening' } }, guest, ctx);

      // Villagio fecha às 18h; Mirante não tem horário cadastrado.
      expect(cards(result.actions)).toEqual([]);
      expect(result.reply).toContain('Não encontrei bares');
      expect(result.reply).toContain('Não consegui conferir pelo horário cadastrado: Bar Mirante.');
      expect(result.reply).toContain('Quer ver todas as opções?');
      expect(result.pendingQuestion).toEqual({ intent: 'restaurant.list', targetId: 'all:bar' });
    });

    it('lists the matches of a time window and mentions unknown hours separately', async () => {
      const result = await service.handle('Quais bares estão abertos de tarde?', { ...list, entities: { period: 'afternoon' } }, guest, ctx);

      expect(result.reply).toContain('Bar Villagio');
      expect(result.reply).toContain('Não consegui conferir pelo horário cadastrado: Bar Mirante.');
      expect(cards(result.actions).map(({ name }) => name)).toEqual(['Bar Villagio']);
    });

    it('answers "agora" with the resort clock (10:30)', async () => {
      const result = await service.handle('Tem algo aberto agora?', list, guest, ctx);

      // 10:30: só o bar com 10h às 18h; Gino e a pizzaria abrem às 12h.
      expect(cards(result.actions).map(({ name }) => name)).toEqual(['Bar Villagio']);
      expect(result.reply).toContain('em funcionamento agora');
      expect(result.reply).toContain('Não consegui conferir pelo horário cadastrado: Bar Mirante.');

      const restaurants = await service.handle('Tem restaurante aberto agora?', list, guest, ctx);
      expect(cards(restaurants.actions)).toEqual([]);
      expect(restaurants.reply).toContain('Não encontrei restaurantes em funcionamento agora');
    });

    it('answers a named restaurant with a direct yes/no from the cadastro', async () => {
      const open = await service.handle('O Bar Villagio está aberto agora?', list, guest, ctx);
      expect(open.reply).toBe('Sim, Bar Villagio está em funcionamento agora. Funcionamento: 10h às 18h.');
      expect(cards(open.actions)).toHaveLength(1);

      const closed = await service.handle('O Bar Villagio está aberto à noite?', { ...list, entities: { period: 'evening' } }, guest, ctx);
      expect(closed.reply).toMatch(/^Não, Bar Villagio não está em funcionamento/);

      const unknown = await service.handle('O Bar Mirante está aberto agora?', list, guest, ctx);
      expect(unknown.reply).toBe('O horário de funcionamento de Bar Mirante não está cadastrado.');
      expect(unknown.reply).not.toMatch(/^Sim/);
    });

    it('offers a navigate action to bookable restaurants only on a direct answer', async () => {
      const bookable = await service.handle('O Omakase está aberto à noite?', { ...list, entities: { period: 'evening' } }, guest, ctx);
      expect(bookable.actions?.at(-1)).toMatchObject({ type: 'navigate', params: { restaurantId: 'j1' } });

      // Sem reserva pelo app: a página do restaurante, nunca a tela de reserva.
      const walkIn = await service.handle('O Gino está aberto à noite?', { ...list, entities: { period: 'evening' } }, guest, ctx);
      const screens = walkIn.actions?.flatMap((action) => (action.type === 'navigate' ? [action.screen] : []));
      expect(screens).toEqual(['Restaurant']);
    });

    it('returns no match with the filters and a pending question to see everything', async () => {
      const result = await service.handle('Tem restaurante de frutos do mar?', list, guest, ctx);

      expect(result.reply).toBe('Não encontrei restaurantes de frutos do mar no cadastro do resort. Quer ver todas as opções?');
      expect(result.resultCount).toBe(0);
      expect(result.pendingQuestion).toEqual({ intent: 'restaurant.list', targetId: 'all:restaurante' });
    });

    it('refines a previous restaurant list: "E à noite?" keeps the type and cuisine', async () => {
      const first = await service.handle('Quais restaurantes de comida japonesa?', list, guest, ctx);
      const followUp = await service.handle(
        'E à noite?',
        { ...list, refine: true, entities: { period: 'evening' } },
        guest,
        { ...ctx, state: first.state! },
      );

      expect(cards(followUp.actions).map(({ name }) => name)).toEqual(['Omakase']);
      expect(followUp.reply).toContain('cozinha japonesa');
      expect(followUp.reply).toContain('em funcionamento');
      expect(followUp.state?.restaurant?.filters).toEqual({ type: 'restaurante', cuisine: 'japonesa' });
    });

    it('keeps the bar type on a refinement with reservations', async () => {
      const first = await service.handle('Quais bares?', list, guest, ctx);
      const followUp = await service.handle('E com reserva?', { ...list, refine: true }, guest, { ...ctx, state: first.state! });

      // Nenhum bar aceita reserva: o tipo se manteve, sem trocar por restaurantes.
      expect(followUp.reply).toContain('Não encontrei bares com reserva pelo aplicativo');
      expect(followUp.state?.restaurant?.filters).toMatchObject({ type: 'bar', reservations: true });
    });

    it('says it could not check unparsable registered hours instead of answering yes/no', async () => {
      execute.mockResolvedValue({
        tool: 'restaurants.list',
        data: [restaurant({ id: 'w1', name: 'Bar Praia', type: 'bar', openingHours: 'Seg a sex: 10h às 18h', reservationTimes: [], acceptsReservations: false })],
      });

      const result = await service.handle('O Bar Praia está aberto agora?', list, guest, ctx);

      expect(result.reply).toBe('Não consegui conferir pelo horário cadastrado de Bar Praia: Seg a sex: 10h às 18h.');
    });

    it('keeps refining after an empty list ("E à noite?" after "Nenhum resultado")', async () => {
      const empty = await service.handle('Tem restaurante de frutos do mar?', list, guest, ctx);
      expect(empty.resultCount).toBe(0);

      const followUp = await service.handle(
        'E à noite?',
        { ...list, refine: true, entities: { period: 'evening' } },
        guest,
        { ...ctx, state: { ...empty.state!, lastIntent: 'restaurant.list' } },
      );

      expect(followUp.state?.topic).toBe('restaurant');
      expect(followUp.reply).toContain('frutos do mar');
    });

    it('does not carry the previous filters without refine', async () => {
      const first = await service.handle('Quais bares?', list, guest, ctx);
      const other = await service.handle('Quais as opções?', list, guest, { ...ctx, state: first.state! });

      expect(other.state?.restaurant?.filters).toBeUndefined();
    });

    it('resolves "a segunda" and "Opção 2" after a list to the right restaurant', async () => {
      const first = await service.handle('Quais restaurantes?', list, guest, ctx);
      const listed = first.state!.restaurant!.listed!;
      const details = { intent: 'restaurant.details' as const, detail: 'none' as const };

      const second = await service.handle('a segunda', { ...details, entities: { ordinal: 2 } }, guest, { ...ctx, state: first.state! });
      expect(second.state?.restaurant?.selectedId).toBe(listed[1].id);
      expect(second.reply).toContain(listed[1].name);

      const option = await service.handle('Opção 2', { ...details, entities: { ordinal: 2 } }, guest, { ...ctx, state: first.state! });
      expect(option.state?.restaurant?.selectedId).toBe(listed[1].id);

      const last = await service.handle('a última', { ...details, entities: { ordinal: -1 } }, guest, { ...ctx, state: first.state! });
      expect(last.state?.restaurant?.selectedId).toBe(listed.at(-1)!.id);
    });

    it('details include a single-item restaurant.options card and keep the reply short', async () => {
      const result = await service.handle('Fale do Omakase', { intent: 'restaurant.details', detail: 'none' }, guest, ctx);

      expect(cards(result.actions)).toHaveLength(1);
      expect(cards(result.actions)[0]).toMatchObject({ restaurantId: 'j1', position: 1, openingHours: 'Jantar: 19h às 22h' });
      expect(result.actions?.every(isValidChatAction)).toBe(true);
      expect(result.pendingQuestion).toEqual({ intent: 'restaurant.booking', targetId: 'j1' });
    });
  });
});
