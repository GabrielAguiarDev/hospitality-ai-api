import type { IntentDecision } from '../chat/chat-intent.types.js';
import { isValidChatAction, type ExperienceOptionsAction } from '../contracts/chat-actions.js';
import type { ConversationState } from '../contracts/conversation-state.js';
import type { ConfirmResult, PreviewResult } from '../experiences/experience-booking.service.js';
import type { ExperienceInfo, ExperienceSlot } from '../experiences/experience.types.js';
import { ResortClock } from '../resort/resort-clock.service.js';

import { ExperienceOperationsService } from './experience-operations.service.js';
import type { OperationsToolRegistryService } from './operations-tool-registry.service.js';
import { RestaurantOperationsService } from './restaurant-operations.service.js';
import { SIMULATION_NOTICE, SNAPSHOT_NOTICE } from './operations.types.js';

const guest = { resortId: 'demo', guestId: '11111111-1111-4111-8111-111111111111' };
const CONV = '33333333-3333-4333-8333-333333333333';
const PREVIEW_ID = '44444444-4444-4444-8444-444444444444';
const BOOKING_ID = '55555555-5555-4555-8555-555555555555';

const experience = (over: Partial<ExperienceInfo> = {}): ExperienceInfo => ({
  id: 'e1',
  title: 'Passeio de barco',
  description: 'Passeio pelo mar.',
  notes: '',
  active: true,
  bookable: true,
  reservationType: 'reserva',
  minimumAge: null,
  minimumAgeAlone: null,
  requiresGuardian: false,
  bookingCutoff: null,
  prices: [
    { category: 'Adulto', price: 120 },
    { category: 'Criança', price: 60 },
  ],
  ...over,
});

const slot = (experienceId: string, over: Partial<ExperienceSlot> = {}): ExperienceSlot => ({
  experienceId,
  availabilityId: `a-${experienceId}`,
  slotId: null,
  date: '2026-10-25',
  time: '10:00',
  capacity: 10,
  adultCapacity: null,
  childCapacity: null,
  bookedAdults: 0,
  bookedChildren: 0,
  remaining: 8,
  remainingAdults: null,
  remainingChildren: null,
  ...over,
});

const BOAT = experience();
const KAYAK = experience({ id: 'e2', title: 'Caiaque no mangue' });
const FREE = experience({ id: 'e3', title: 'Yoga na praia', bookable: false, reservationType: null, prices: [] });

const summary = {
  experienceId: 'e2',
  experienceTitle: 'Caiaque no mangue',
  date: '2026-10-25',
  time: '10:00',
  adults: 2,
  children: 0,
  totalPrice: 240,
  currency: 'BRL' as const,
  priceNote: null,
  simulated: true as const,
};

const createdPreview = (): PreviewResult => ({
  status: 'created',
  previewId: PREVIEW_ID,
  expiresAt: new Date('2026-10-23T12:15:00.000Z'),
  summary,
  quote: { currency: 'BRL', total: 240, adultUnit: 120, childUnit: 60, included: false, note: null },
  warnings: [],
});

describe('ExperienceOperationsService', () => {
  const execute = vi.fn();
  const clock = { today: () => '2026-10-23', time: () => '10:30' } as unknown as ResortClock;
  const registry = { execute } as unknown as OperationsToolRegistryService;
  const service = new ExperienceOperationsService(registry, new RestaurantOperationsService(registry, clock), clock);
  const optionCards = (actions: unknown[] | undefined) =>
    (actions as { type: string }[] | undefined)?.find((action) => action.type === 'experience.options') as
      | ExperienceOptionsAction
      | undefined;

  let handlers: Record<string, (input: any) => unknown>;
  let cardState: { status: 'preview' | 'confirmed' | 'expired' | 'failed' | 'cancelled'; reason?: string };
  let restaurants: unknown[];

  beforeEach(() => {
    restaurants = [];
    handlers = {
      'experiences.list': () => ({
        date: null,
        experiences: [BOAT, KAYAK, FREE],
        slots: [slot('e1'), slot('e2', { time: '14:00', remaining: 3 })],
      }),
      'experiences.details': ({ experienceId }) => [BOAT, KAYAK, FREE].find((e) => e.id === experienceId) ?? null,
      'experiences.availability': ({ experienceId }) => ({
        experience: [BOAT, KAYAK].find((e) => e.id === experienceId),
        date: '2026-10-25',
        slots: [slot(experienceId)],
      }),
      'restaurants.list': () => restaurants,
      'experiences.booking.preview': () => createdPreview(),
      'experiences.booking.confirm': () => ({
        status: 'confirmed',
        bookingId: BOOKING_ID,
        confirmationCode: 'SIM-ABCDEFGH',
        summary,
      }),
      'experiences.booking.cancel': () => true,
      // Estado persistido do card, lido após confirmar ou descartar.
      'experiences.booking.cards': ({ previewIds }) =>
        previewIds.map((previewId: string) => ({
          previewId,
          status: cardState.status,
          summary,
          expiresAt: new Date('2026-10-23T12:15:00.000Z'),
          updatedAt: new Date('2026-10-23T12:01:00.000Z'),
          ...(cardState.status === 'confirmed' ? { booking: { bookingId: BOOKING_ID, confirmationCode: 'SIM-ABCDEFGH' } } : {}),
          ...(cardState.reason ? { reason: cardState.reason } : {}),
        })),
    };
    cardState = { status: 'confirmed' };
    execute.mockReset();
    execute.mockImplementation(async (name: string, _guest: unknown, input: unknown) => ({
      tool: name,
      data: handlers[name](input),
    }));
  });

  const decide = (intent: IntentDecision['intent'], entities: IntentDecision['entities'] = {}) =>
    ({ intent, detail: 'none', entities }) as IntentDecision & { intent: any };

  const ctx = (experienceState: ConversationState['experience'] = {}) => ({
    conversationId: CONV,
    state: { topic: 'experience', experience: experienceState } as ConversationState,
  });

  const called = (name: string) => execute.mock.calls.filter(([n]) => n === name);

  describe('list', () => {
    it('lists active experiences briefly, with the details in the options card', async () => {
      const result = await service.handle('Quais experiências posso fazer?', decide('experience.list'), guest, ctx({}));

      expect(result.reply).toBe(
        'Separei 3 experiências: Passeio de barco, Caiaque no mangue e Yoga na praia. Para qual data quer que eu verifique as vagas?',
      );
      expect(result.reply).not.toMatch(/^\d+\./m);
      expect(result.reply).not.toContain('\n');
      expect(result.state?.experience?.listed?.map((l) => l.id)).toEqual(['e1', 'e2', 'e3']);
      expect(result.state?.topic).toBe('experience');

      const card = optionCards(result.actions);
      expect(card?.options.map(({ summary }) => summary)).toEqual([
        'Com reserva',
        'Com reserva',
        'Sem necessidade de reserva',
      ]);
      expect(card?.options.map(({ message }) => message)).toEqual(['Opção 1', 'Opção 2', 'Opção 3']);
      expect(result.actions?.every(isValidChatAction)).toBe(true);
    });

    it('quotes only three names and counts the rest', async () => {
      handlers['experiences.list'] = () => ({
        date: null,
        experiences: ['A', 'B', 'C', 'D', 'E'].map((title, i) => experience({ id: `x${i}`, title })),
        slots: [],
      });
      const result = await service.handle('Quais experiências?', decide('experience.list'), guest, ctx({}));

      expect(result.reply).toContain('Separei 5 experiências: A, B, C e mais 2.');
      expect(optionCards(result.actions)?.options).toHaveLength(5);
    });

    it('with date replies briefly, moves slots to the card and shows the snapshot notice once', async () => {
      const result = await service.handle(
        'o que tem amanhã?',
        decide('experience.list', { date: '2026-10-24' }),
        guest,
        ctx({}),
      );

      expect(called('experiences.list')[0][2]).toEqual({ date: '2026-10-24' });
      expect(result.reply).toContain(ResortClock.describeDate('2026-10-24'));
      expect(result.reply).toContain('há vagas registradas em 2 experiências: Passeio de barco e Caiaque no mangue.');
      expect(result.reply).not.toMatch(/^\d+\./m);
      expect(result.reply).not.toContain('vaga(s)');
      expect(result.reply).toContain('Sem necessidade de reserva: Yoga na praia');
      expect(result.reply).toContain(SNAPSHOT_NOTICE);
      expect(result.state?.experience?.snapshotNoticeShown).toBe(true);
      expect(result.state?.experience?.listed).toEqual([
        { id: 'e1', title: 'Passeio de barco' },
        { id: 'e2', title: 'Caiaque no mangue' },
      ]);
      expect(result.state?.experience?.listedDate).toBe('2026-10-24');

      const card = optionCards(result.actions);
      expect(card?.date).toBe('2026-10-24');
      expect(card?.options[0]).toMatchObject({ experienceId: 'e1', times: ['10:00'] });
      expect(card?.options[0].summary).toContain('8 vaga');
      expect(card?.options[1].summary).toContain('3 vaga');
      expect(result.actions?.every(isValidChatAction)).toBe(true);

      // Segunda consulta na mesma conversa: o aviso não se repete.
      const again = await service.handle(
        'e sábado?',
        decide('experience.list', { date: '2026-10-24' }),
        guest,
        { ...ctx({}), state: result.state! },
      );
      expect(again.reply).not.toContain(SNAPSHOT_NOTICE);
    });

    it('with date and no slots says so and clears the listing', async () => {
      handlers['experiences.list'] = () => ({ date: '2026-10-24', experiences: [BOAT], slots: [] });
      const result = await service.handle('amanhã', decide('experience.list', { date: '2026-10-24' }), guest, ctx({}));

      expect(result.reply).toContain('Não encontrei vagas');
      expect(result.reply).toContain(SNAPSHOT_NOTICE);
      expect(result.state?.experience?.listed).toEqual([]);
    });
  });

  describe('search', () => {
    it('answers "tem vaga amanhã?" without a named experience as a search, not an error', async () => {
      const result = await service.handle(
        'Tem vaga amanhã?',
        decide('experience.availability', { date: '2026-10-25', bookable: true }),
        guest,
        ctx({ listed: [{ id: 'e1', title: 'Passeio de barco' }], listedDate: null }),
      );

      expect(result.reply).not.toContain('Não identifiquei');
      expect(result.intent).toBe('experience.search');
      // A primeira chamada tenta resolver um nome; a última é a busca.
      expect(called('experiences.list').at(-1)?.[2]).toEqual({ date: '2026-10-25', bookable: true });
      expect(result.actions).toEqual([
        expect.objectContaining({ type: 'experience.options', date: '2026-10-25' }),
      ]);
    });

    it('merges a refinement with the stored filters and replaces the period', async () => {
      const result = await service.handle(
        'E à tarde?',
        { ...decide('experience.search', { period: 'afternoon' }), refine: true },
        guest,
        ctx({ date: '2026-10-25', filters: { period: 'morning', free: true } }),
      );

      expect(called('experiences.list')[0][2]).toEqual({ date: '2026-10-25', period: 'afternoon', free: true });
      expect(result.state?.experience?.filters).toEqual({ period: 'afternoon', free: true });
    });

    it('starts a new search from scratch and clears the previous selection', async () => {
      const result = await service.handle(
        'Quais experiências têm vagas no domingo?',
        decide('experience.search', { date: '2026-10-25', bookable: true }),
        guest,
        ctx({ selectedId: 'e2', selectedTitle: 'Caiaque no mangue', filters: { period: 'morning' } }),
      );

      expect(called('experiences.list')[0][2]).toEqual({ date: '2026-10-25', bookable: true });
      expect(result.state?.experience?.selectedId).toBeUndefined();
    });
  });

  it('hands a "quais horários posso reservar" question about a restaurant over to restaurants', async () => {
    restaurants = [{ id: 'r1', name: 'Trattoria Aurora', type: 'restaurante', openingHours: null, description: '', location: null,
      acceptsReservations: true, minimumAge: null, reservationTimes: ['19:00'] }];

    const result = await service.handle(
      'Quais horários posso reservar na Trattoria Aurora amanhã?',
      decide('experience.search', { date: '2026-10-24', bookable: true }),
      guest,
      ctx({}),
    );

    expect(result.state?.topic).toBe('restaurant');
    expect(called('experiences.list')).toHaveLength(0);
  });

  describe('period without an exact time', () => {
    const chosen = {
      selectedId: 'e1',
      selectedTitle: 'Passeio de barco',
      date: '2026-10-25',
      adults: 2,
      children: 0,
      filters: { period: 'morning' as const },
    };

    it('asks which time when the period has more than one registered time', async () => {
      handlers['experiences.availability'] = () => ({
        experience: BOAT,
        date: '2026-10-25',
        slots: [slot('e1', { time: '09:00' }), slot('e1', { time: '10:30' }), slot('e1', { time: '15:00' })],
      });

      const result = await service.handle('Pode reservar.', decide('experience.booking'), guest, ctx(chosen));

      expect(result.reply).toContain('mais de um horário registrado de manhã: 09:00, 10:30');
      expect(called('experiences.booking.preview')).toHaveLength(0);
      expect(result.state?.experience?.pendingPreviewId).toBeUndefined();
    });

    it('uses the single registered time of the period in the summary to be confirmed', async () => {
      handlers['experiences.availability'] = () => ({
        experience: BOAT,
        date: '2026-10-25',
        slots: [slot('e1', { time: '10:00' }), slot('e1', { time: '15:00' })],
      });

      await service.handle('Pode reservar.', decide('experience.booking'), guest, ctx(chosen));

      expect(called('experiences.booking.preview')[0][2]).toMatchObject({ time: '10:00' });
      expect(called('experiences.booking.confirm')).toHaveLength(0);
    });
  });

  describe('selection', () => {
    const listedState = {
      listed: [
        { id: 'e1', title: 'Passeio de barco' },
        { id: 'e2', title: 'Caiaque no mangue' },
      ],
      listedDate: '2026-10-25',
    };

    it('"Gostei da segunda." selects listed[1] by ordinal', async () => {
      const result = await service.handle(
        'Gostei da segunda.',
        decide('experience.details', { ordinal: 2 }),
        guest,
        ctx(listedState),
      );

      expect(called('experiences.details')[0][2]).toEqual({ experienceId: 'e2' });
      expect(called('experiences.list')).toHaveLength(0);
      expect(result.reply).toContain('Caiaque no mangue');
      expect(result.state?.experience).toMatchObject({ selectedId: 'e2', selectedTitle: 'Caiaque no mangue', date: '2026-10-25' });
    });

    it('ordinal -1 selects the last and out of range is not found', async () => {
      const last = await service.handle('a última', decide('experience.details', { ordinal: -1 }), guest, ctx(listedState));
      expect(last.state?.experience?.selectedId).toBe('e2');

      const outOfRange = await service.handle('opção 7', decide('experience.details', { ordinal: 7 }), guest, ctx(listedState));
      expect(outOfRange.reply).toContain('Não identifiquei');
      expect(outOfRange.reply).toContain('número da experiência da lista');
    });

    it('asks to disambiguate when several experiences match the name', async () => {
      handlers['experiences.list'] = () => ({
        date: null,
        experiences: [experience({ id: 'a', title: 'Passeio Lagoa Azul' }), experience({ id: 'b', title: 'Passeio Lagoa Verde' })],
        slots: [],
      });
      const result = await service.handle('quero a lagoa', decide('experience.details'), guest, ctx({}));

      expect(result.reply).toBe('Encontrei mais de uma experiência com esse nome. Qual delas você deseja?');
      expect(result.reply).not.toMatch(/^\d+\./m);
      expect(optionCards(result.actions)?.options.map(({ title }) => title)).toEqual(['Passeio Lagoa Azul', 'Passeio Lagoa Verde']);
      expect(result.state?.experience?.listed).toHaveLength(2);
      expect(result.state?.experience?.selectedId).toBeUndefined();
    });

    it('selects by name', async () => {
      const result = await service.handle('Fale do caiaque', decide('experience.details'), guest, ctx({}));
      expect(result.state?.experience?.selectedId).toBe('e2');
    });
  });

  describe('follow-ups', () => {
    it('party follow-up reuses the selected experience and date from state', async () => {
      const result = await service.handle(
        'duas pessoas',
        decide('experience.availability', { people: 2 }),
        guest,
        ctx({ selectedId: 'e2', selectedTitle: 'Caiaque no mangue', date: '2026-10-25' }),
      );

      expect(called('experiences.availability')[0][2]).toEqual({ experienceId: 'e2', date: '2026-10-25' });
      expect(result.reply).toContain('Considerei todos os participantes como adultos');
      expect(result.reply).toContain('2 adultos');
      expect(result.reply).toContain(SNAPSHOT_NOTICE);
      expect(result.state?.experience).toMatchObject({ adults: 2, children: 0, partyAssumed: true });
    });

    it('availability without a date asks for it', async () => {
      const result = await service.handle(
        'tem vaga no caiaque?',
        decide('experience.availability'),
        guest,
        ctx({}),
      );
      expect(result.reply).toContain('Para qual data');
      expect(called('experiences.availability')).toHaveLength(0);
    });

    it('price for a party computes the total on the server rules', async () => {
      const result = await service.handle(
        'quanto custa o passeio de barco para 2 adultos e 1 criança',
        decide('experience.price', { adults: 2, children: 1 }),
        guest,
        ctx({}),
      );
      expect(result.reply).toMatch(/R\$\s?300,00/);
    });
  });

  describe('booking', () => {
    const selected = { selectedId: 'e2', selectedTitle: 'Caiaque no mangue' };

    it('without date and party asks for the missing info and does not preview', async () => {
      const result = await service.handle('quero reservar o caiaque', decide('experience.booking'), guest, ctx({}));

      expect(result.reply).toContain('preciso saber a data e quantos adultos e crianças');
      expect(called('experiences.booking.preview')).toHaveLength(0);
      expect(result.actions).toEqual([]);
    });

    it('without party only asks for the party', async () => {
      const result = await service.handle(
        'reservar o caiaque amanhã',
        decide('experience.booking', { date: '2026-10-24' }),
        guest,
        ctx({}),
      );
      expect(result.reply).toContain('preciso saber quantos adultos e crianças');
      expect(result.reply).not.toContain('a data');
      expect(called('experiences.booking.preview')).toHaveLength(0);
    });

    it('creates a preview action and sets pendingPreviewId', async () => {
      const result = await service.handle(
        'reservar o caiaque amanhã às 10h para 2 adultos',
        decide('experience.booking', { date: '2026-10-25', time: '10:00', adults: 2 }),
        guest,
        ctx({}),
      );

      expect(called('experiences.booking.preview')[0][2]).toEqual({
        conversationId: CONV,
        experienceId: 'e2',
        date: '2026-10-25',
        time: '10:00',
        adults: 2,
        children: 0,
      });
      expect(result.actions).toHaveLength(1);
      expect(result.actions?.[0]).toMatchObject({
        type: 'experience.booking.card',
        cardId: PREVIEW_ID,
        status: 'preview',
        expiresAt: '2026-10-23T12:15:00.000Z',
        summary,
        confirm: {
          method: 'POST',
          path: '/chat/actions',
          body: { type: 'experience.booking.confirm', conversationId: CONV, previewId: PREVIEW_ID },
        },
      });
      expect(result.actions?.[0]).toMatchObject({ notes: expect.arrayContaining([SIMULATION_NOTICE]) });
      expect(result.state?.experience?.pendingPreviewId).toBe(PREVIEW_ID);
      // Valor, data e avisos ficam no card; o texto não os repete.
      expect(result.reply).not.toMatch(/R\$/);
      expect(result.reply).not.toContain('2026');
      expect(result.reply).toContain('confirmo');
      expect(called('experiences.booking.confirm')).toHaveLength(0);
    });

    it('uses selection, date and party kept in state', async () => {
      await service.handle(
        'quero reservar',
        decide('experience.booking'),
        guest,
        ctx({ ...selected, date: '2026-10-25', adults: 2, children: 0 }),
      );

      expect(called('experiences.booking.preview')[0][2]).toMatchObject({
        experienceId: 'e2',
        date: '2026-10-25',
        adults: 2,
        children: 0,
      });
    });

    it('relays rejection messages with options and sets no action nor pending preview', async () => {
      handlers['experiences.booking.preview'] = () => ({
        status: 'rejected',
        code: 'time_required',
        message: 'Qual horário você prefere?',
        options: ['10:00', '14:00'],
      });
      const result = await service.handle(
        'reservar',
        decide('experience.booking', { date: '2026-10-25', adults: 2 }),
        guest,
        ctx(selected),
      );

      expect(result.reply).toContain('Qual horário você prefere?');
      expect(result.reply).toContain('10:00, 14:00');
      expect(result.actions).toEqual([]);
      expect(result.state?.experience?.pendingPreviewId).toBeUndefined();
    });

    it('experience not found falls back to restaurant navigation when a restaurant matches', async () => {
      handlers['experiences.list'] = () => ({ date: null, experiences: [BOAT], slots: [] });
      restaurants = [
        {
          id: 'r1',
          name: 'Trattoria Bella',
          type: null,
          openingHours: null,
          description: '',
          location: null,
          acceptsReservations: true,
          minimumAge: null,
          reservationTimes: [],
        },
      ];

      const result = await service.handle(
        'quero reservar no Trattoria Bella',
        decide('experience.booking', { date: '2026-10-25', adults: 2 }),
        guest,
        ctx({}),
      );

      expect(result.actions).toEqual([
        { type: 'navigate', label: 'Abrir Gastronomia', screen: 'Gastronomy', params: { restaurantId: 'r1' } },
      ]);
      expect(result.state?.topic).toBe('restaurant');
      expect(called('experiences.booking.preview')).toHaveLength(0);
    });

    it('experience not found without restaurant match asks for the experience name', async () => {
      handlers['experiences.list'] = () => ({ date: null, experiences: [BOAT], slots: [] });

      const result = await service.handle('quero reservar o foguete', decide('experience.booking'), guest, ctx({}));

      expect(result.reply).toContain('Não identifiquei qual experiência');
      expect(result.actions).toEqual([]);
      expect(called('experiences.booking.preview')).toHaveLength(0);
    });
  });

  describe('confirm and cancel', () => {
    it('confirm with no pending preview does not call the tool', async () => {
      const result = await service.handle('confirmo', decide('experience.booking.confirm'), guest, ctx({}));

      expect(result.reply).toContain('Não há uma pré-reserva aguardando');
      expect(called('experiences.booking.confirm')).toHaveLength(0);
      expect(result.actions).toEqual([]);
    });

    it('confirm success updates the same card and clears pending', async () => {
      const result = await service.handle(
        'confirmo',
        decide('experience.booking.confirm'),
        guest,
        ctx({ pendingPreviewId: PREVIEW_ID, selectedId: 'e2' }),
      );

      expect(called('experiences.booking.confirm')[0][2]).toEqual({ conversationId: CONV, previewId: PREVIEW_ID });
      expect(result.actions).toEqual([
        expect.objectContaining({
          type: 'experience.booking.card',
          cardId: PREVIEW_ID,
          status: 'confirmed',
          booking: { bookingId: BOOKING_ID, confirmationCode: 'SIM-ABCDEFGH' },
          confirm: null,
          cancel: null,
        }),
      ]);
      expect(result.reply).toContain('confirmada');
      expect(result.completed).toBe(true);
      expect(result.state?.experience?.pendingPreviewId).toBeUndefined();
      expect(result.state?.experience?.selectedId).toBe('e2');
    });

    it('confirm failure moves the same card to expired and clears pending', async () => {
      handlers['experiences.booking.confirm'] = (): ConfirmResult => ({ status: 'expired', message: 'Esta pré-reserva expirou.' });
      cardState = { status: 'expired', reason: 'A pré-reserva expirou.' };
      const result = await service.handle('confirmo', decide('experience.booking.confirm'), guest, ctx({ pendingPreviewId: PREVIEW_ID }));

      expect(result.reply).toBe('Esta pré-reserva expirou.');
      expect(result.actions).toEqual([
        expect.objectContaining({ cardId: PREVIEW_ID, status: 'expired', reason: 'A pré-reserva expirou.', confirm: null }),
      ]);
      expect(result.state?.experience?.pendingPreviewId).toBeUndefined();
    });

    it('a preview that is not found returns no card', async () => {
      handlers['experiences.booking.confirm'] = (): ConfirmResult => ({ status: 'not_found', message: 'Pré-reserva não encontrada.' });
      const result = await service.confirmPreview(guest, CONV, PREVIEW_ID);

      expect(result.actions).toEqual([]);
      expect(called('experiences.booking.cards')).toHaveLength(0);
    });

    it('already confirmed keeps the confirmed card', async () => {
      handlers['experiences.booking.confirm'] = () => ({
        status: 'already_confirmed',
        bookingId: BOOKING_ID,
        confirmationCode: 'SIM-ABCDEFGH',
        summary,
      });
      const result = await service.confirmPreview(guest, CONV, PREVIEW_ID);
      expect(result.actions[0]).toMatchObject({ cardId: PREVIEW_ID, status: 'confirmed' });
      expect(result.reply).toContain('já estava confirmada');
    });

    it('any other interaction drops the pending preview (no stale text confirmation)', async () => {
      const result = await service.handle(
        'e o preço?',
        decide('experience.price'),
        guest,
        ctx({ pendingPreviewId: PREVIEW_ID, selectedId: 'e1' }),
      );
      expect(result.state?.experience?.pendingPreviewId).toBeUndefined();
    });

    it('cancel discards a pending preview and calls the tool once', async () => {
      cardState = { status: 'cancelled', reason: 'Descartada.' };
      const result = await service.handle(
        'cancela',
        decide('experience.booking.cancel'),
        guest,
        ctx({ pendingPreviewId: PREVIEW_ID }),
      );

      expect(called('experiences.booking.cancel')).toHaveLength(1);
      expect(called('experiences.booking.cancel')[0][2]).toEqual({ conversationId: CONV, previewId: PREVIEW_ID });
      expect(result.state?.experience?.pendingPreviewId).toBeUndefined();
      expect(result.completed).toBe(true);
      expect(result.actions?.[0]).toMatchObject({ cardId: PREVIEW_ID, status: 'cancelled', confirm: null });
    });

    it('cancel without a pending preview does not call the tool', async () => {
      await service.handle('cancela', decide('experience.booking.cancel'), guest, ctx({}));
      expect(called('experiences.booking.cancel')).toHaveLength(0);
    });
  });

  describe('bookingCards', () => {
    it('reads long conversations in chunks of 50 card IDs', async () => {
      const ids = Array.from({ length: 60 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);

      const cards = await service.bookingCards(guest, CONV, ids);

      const calls = execute.mock.calls.filter(([name]) => name === 'experiences.booking.cards');
      expect(calls.map(([, , input]) => (input as { previewIds: string[] }).previewIds.length)).toEqual([50, 10]);
      expect(cards.map(({ cardId }) => cardId)).toEqual(ids);
    });
  });

  describe('reservations', () => {
    it('says when there are none', async () => {
      handlers['experiences.reservations'] = () => ({ official: [], simulated: [] });
      const result = await service.handle('minhas reservas de experiências', decide('experience.reservations'), guest, ctx({}));
      expect(result.reply).toContain('Não encontrei reservas');
    });
  });

  it('rejects unexpected tool results', async () => {
    execute.mockResolvedValue({ tool: 'requests.list', data: [] });
    await expect(
      service.handle('Quais experiências?', decide('experience.list'), guest, ctx({})),
    ).rejects.toThrow();
  });
});
