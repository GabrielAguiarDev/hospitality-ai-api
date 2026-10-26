import type { RestaurantInfo } from '../resort/restaurants-catalog.service.js';

import {
  CUISINE_CUE,
  cuisineByLabel,
  matchesCuisine,
  openDuring,
  openingIntervals,
  restaurantFilters,
} from './restaurant-search.js';

const restaurant = (over: Partial<RestaurantInfo> = {}): RestaurantInfo => ({
  id: 'r1',
  name: 'Restaurante Teste',
  type: 'restaurante',
  openingHours: null,
  description: '',
  location: null,
  acceptsReservations: false,
  minimumAge: null,
  reservationTimes: [],
  ...over,
});

describe('openingIntervals', () => {
  it('reads a single range', () => {
    expect(openingIntervals('10h às 18h')).toEqual([{ from: '10:00', to: '18:00' }]);
  });

  it('reads minutes and several meals, splitting the range that crosses midnight', () => {
    expect(
      openingIntervals('Café da manhã: 7h às 10h30. Almoço: 12h às 15h. Jantar: 19h às 22h. Night food: 23h às 5h.'),
    ).toEqual([
      { from: '07:00', to: '10:30' },
      { from: '12:00', to: '15:00' },
      { from: '19:00', to: '22:00' },
      { from: '23:00', to: '24:00' },
      { from: '00:00', to: '05:00' },
    ]);
  });

  it('accepts a closing hour without the "h" suffix', () => {
    expect(openingIntervals('16h às 23')).toEqual([{ from: '16:00', to: '23:00' }]);
  });

  it('reads colon notation and a dash separator', () => {
    expect(openingIntervals('10:00 às 18:30')).toEqual([{ from: '10:00', to: '18:30' }]);
    expect(openingIntervals('10h - 18h')).toEqual([{ from: '10:00', to: '18:00' }]);
  });

  it.each([null, '', 'Fechado para manutenção', 'Aberto todos os dias'])('returns no intervals for %j', (value) => {
    expect(openingIntervals(value)).toEqual([]);
  });

  it('requires a connector or a unit for the closing hour and adjacent minutes', () => {
    expect(openingIntervals('12h-15h 20 lugares')).toEqual([{ from: '12:00', to: '15:00' }]);
    expect(openingIntervals('10h30 às 18h')).toEqual([{ from: '10:30', to: '18:00' }]);
    expect(openingIntervals('Abre às 18h, 7 dias por semana')).toEqual([]);
    expect(openingIntervals('Capacidade: 12h 40 pessoas')).toEqual([]);
  });

  it.each([
    'Seg a sex: 10h às 18h',
    'Sábado e domingo: 9h às 17h',
    'Fins de semana 10h às 16h',
    'Fim de semana 10h às 16h',
    'Feriados: 10h às 14h',
  ])('does not interpret per-weekday hours: %j', (value) => {
    expect(openingIntervals(value)).toEqual([]);
  });

  it('ignores impossible hours', () => {
    expect(openingIntervals('25h às 30h')).toEqual([]);
  });
});

describe('openDuring', () => {
  const evening = { from: '18:00', to: '24:00' };
  const morning = { from: '05:00', to: '12:00' };

  it('is true when the window overlaps a registered interval', () => {
    expect(openDuring(restaurant({ openingHours: '19h às 22h' }), evening)).toBe(true);
    expect(openDuring(restaurant({ openingHours: '10h às 18h' }), { from: '17:59', to: '18:30' })).toBe(true);
  });

  it('is false when the registered intervals do not overlap the window', () => {
    expect(openDuring(restaurant({ openingHours: '10h às 18h' }), evening)).toBe(false);
    // [from, to): fechar às 18h não cobre 18h.
    expect(openDuring(restaurant({ openingHours: '10h às 18h' }), { from: '18:00', to: '18:01' })).toBe(false);
  });

  it('uses the overnight part of a range that crosses midnight', () => {
    expect(openDuring(restaurant({ openingHours: 'Night food: 23h às 5h' }), { from: '02:00', to: '02:01' })).toBe(true);
    expect(openDuring(restaurant({ openingHours: 'Night food: 23h às 5h' }), { from: '04:00', to: '06:00' })).toBe(true);
    expect(openDuring(restaurant({ openingHours: 'Night food: 23h às 5h' }), morning)).toBe(false);
    expect(openDuring(restaurant({ openingHours: 'Night food: 23h às 5h' }), { from: '12:00', to: '12:01' })).toBe(false);
  });

  it('falls back to the reservation times when there are no opening hours', () => {
    const base = restaurant({ openingHours: null, reservationTimes: ['19:00', '21:30'] });

    expect(openDuring(base, evening)).toBe(true);
    // Sem turno na faixa, o cadastro não prova que está fechado: não se afirma nada.
    expect(openDuring(base, morning)).toBeNull();
  });

  it('prefers the opening hours over the reservation times', () => {
    expect(openDuring(restaurant({ openingHours: '10h às 12h', reservationTimes: ['19:00'] }), evening)).toBe(false);
  });

  it('never says false without parsable hours (weekday text stays unknown)', () => {
    const weekday = restaurant({ openingHours: 'Seg a sex: 10h às 18h', reservationTimes: ['19:00'] });

    expect(openDuring(weekday, { from: '05:00', to: '12:00' })).toBeNull();
    expect(openDuring(weekday, evening)).toBe(true);
  });

  it('is null (never claimed open) when nothing is registered', () => {
    expect(openDuring(restaurant(), evening)).toBeNull();
    expect(openDuring(restaurant({ openingHours: 'Sob consulta' }), evening)).toBeNull();
  });
});

describe('restaurantFilters', () => {
  const NOW = '10:30';

  it('returns no filters for a plain list request', () => {
    expect(restaurantFilters('Quais restaurantes tem?', {}, NOW)).toEqual({});
  });

  it.each([
    ['Tem comida japonesa?', 'japonesa'],
    ['Onde tem sushi?', 'japonesa'],
    ['Quero comer massa', 'italiana'],
    ['Tem pizza?', 'pizza'],
    ['Tem hambúrguer?', 'hambúrguer'],
    ['Tem frutos do mar?', 'frutos do mar'],
    ['Tem comida regional?', 'regional'],
    ['Tem sorvete?', 'sobremesas'],
  ])('detects the cuisine in %j', (message, label) => {
    expect(restaurantFilters(message, {}, NOW).cuisine?.label).toBe(label);
  });

  it('keeps cuisine patterns that match the cadastro text', () => {
    const { cuisine } = restaurantFilters('Tem comida japonesa?', {}, NOW);

    expect(cuisine?.pattern.test('omakase com pratos')).toBe(true);
    expect(cuisine?.pattern.test('churrascaria gaucha')).toBe(false);
  });

  it('detects "com reserva" and its variations', () => {
    expect(restaurantFilters('Quais têm com reserva?', {}, NOW).reservations).toBe(true);
    expect(restaurantFilters('Quais aceitam reserva?', {}, NOW).reservations).toBe(true);
    expect(restaurantFilters('Quais fazem reservas?', {}, NOW).reservations).toBe(true);
    expect(restaurantFilters('Quero reservar uma mesa', {}, NOW).reservations).toBeUndefined();
  });

  it('turns the "à noite" period into the evening window', () => {
    const filters = restaurantFilters('Quais estão abertos à noite?', { period: 'evening' }, NOW);

    expect(filters.window).toEqual({ from: '18:00', to: '24:00' });
    expect(filters.windowLabel).toBe('à noite');
  });

  it('turns "depois das 20h" into a range and an explicit time into a minute window', () => {
    expect(restaurantFilters('Abre depois das 20h?', { after: '20:00' }, NOW)).toMatchObject({
      window: { from: '20:00', to: '24:00' },
      windowLabel: 'depois das 20:00',
    });
    expect(restaurantFilters('Abre antes das 9h?', { before: '09:00' }, NOW)).toMatchObject({
      window: { from: '00:00', to: '09:00' },
    });
    expect(restaurantFilters('Está aberto às 21:30?', { time: '21:30' }, NOW)).toMatchObject({
      window: { from: '21:30', to: '21:31' },
      windowLabel: 'às 21:30',
    });
  });

  it('maps meal words to their usual windows', () => {
    expect(restaurantFilters('Onde posso jantar?', {}, NOW).window).toEqual({ from: '18:30', to: '23:00' });
    expect(restaurantFilters('Onde almoçar?', {}, NOW).window).toEqual({ from: '11:30', to: '15:00' });
    expect(restaurantFilters('Servem café da manhã?', {}, NOW)).toMatchObject({
      window: { from: '06:00', to: '10:30' },
      windowLabel: 'no café da manhã',
    });
  });

  it('uses the resort clock for "agora" and does not overflow past midnight', () => {
    expect(restaurantFilters('Tem algo aberto agora?', {}, NOW)).toMatchObject({
      window: { from: '10:30', to: '10:31' },
      windowLabel: 'agora',
    });
    expect(restaurantFilters('aberto agora', {}, '23:59').window).toEqual({ from: '23:59', to: '24:00' });
  });

  it('prioritizes an explicit time over a period, a meal and "agora"', () => {
    const filters = restaurantFilters('Abre para jantar agora às 20:00?', { time: '20:00', period: 'evening' }, NOW);

    expect(filters.window).toEqual({ from: '20:00', to: '20:01' });
  });

  it('does not treat "abertos hoje" as "agora"', () => {
    expect(restaurantFilters('Quais estão abertos hoje?', {}, NOW).window).toBeUndefined();
  });

  it('exposes the phrase used in the reply criteria', () => {
    expect(restaurantFilters('Tem comida japonesa?', {}, NOW).cuisine?.phrase).toBe('de cozinha japonesa');
    expect(restaurantFilters('Tem frutos do mar?', {}, NOW).cuisine?.phrase).toBe('de frutos do mar');
    expect(restaurantFilters('Tem pizza?', {}, NOW).cuisine?.phrase).toBe('com pizza');
  });

  it('combines several filters', () => {
    const filters = restaurantFilters('Tem japonês com reserva para jantar?', {}, NOW);

    expect(filters.cuisine?.label).toBe('japonesa');
    expect(filters.reservations).toBe(true);
    expect(filters.windowLabel).toBe('no jantar');
  });
});

describe('plural cuisine words', () => {
  it.each([
    ['Quais restaurantes japoneses?', 'japonesa'],
    ['Tem restaurantes italianos?', 'italiana'],
    ['Opções baianas?', 'regional'],
  ])('%j sets the cuisine filter', (message, label) => {
    expect(restaurantFilters(message, {}, '12:00').cuisine?.label).toBe(label);
  });
});

describe('cuisine helpers', () => {
  it('CUISINE_CUE recognizes any registered cuisine', () => {
    expect(CUISINE_CUE.test('onde tem sushi')).toBe(true);
    expect(CUISINE_CUE.test('onde tem pizza')).toBe(true);
    expect(CUISINE_CUE.test('onde fica a piscina')).toBe(false);
  });

  it('cuisineByLabel restores a stored cuisine and ignores unknown labels', () => {
    expect(cuisineByLabel('japonesa')?.label).toBe('japonesa');
    expect(cuisineByLabel('klingon')).toBeUndefined();
    expect(cuisineByLabel(undefined)).toBeUndefined();
  });

  it('matchesCuisine checks name and description, and accepts everything without a cuisine', () => {
    const japanese = { cuisine: cuisineByLabel('japonesa') };

    expect(matchesCuisine(restaurant({ name: 'Omakase' }), japanese)).toBe(true);
    expect(matchesCuisine(restaurant({ description: 'Culinária Japonesa autêntica' }), japanese)).toBe(true);
    expect(matchesCuisine(restaurant({ name: 'Gino', description: 'Cozinha italiana' }), japanese)).toBe(false);
    expect(matchesCuisine(restaurant(), {})).toBe(true);
  });
});
