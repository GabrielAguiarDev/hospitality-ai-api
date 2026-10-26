import { normalizeText } from '../common/text.js';
import type { MessageEntities } from '../chat/message-entities.js';
import { PERIOD_LABELS, PERIOD_WINDOWS, type TimeWindow } from '../experiences/experience-search.js';
import type { RestaurantInfo } from '../resort/restaurants-catalog.service.js';

/**
 * Filtros de restaurantes citados na pergunta. Nenhum deles inventa
 * dados: só comparam a mensagem com o que o cadastro registra.
 */
export interface RestaurantFilters {
  // Cozinha pedida ("japonês", "pizza"), comparada ao nome e à descrição.
  cuisine?: { label: string; phrase: string; pattern: RegExp };
  reservations?: boolean;
  // Faixa de horário em que o restaurante precisa estar aberto.
  window?: TimeWindow;
  windowLabel?: string;
}

const CUISINES: { cue: RegExp; label: string; phrase: string; pattern: RegExp }[] = [
  { cue: /\b(?:japones(?:a|as|es)?|sushi|sashimi|orientais|oriental)\b/, label: 'japonesa', phrase: 'de cozinha japonesa', pattern: /\b(?:japones(?:a|as|es)?|sushi|sashimi|omakase|oriental|nipo[a-z]*)\b/ },
  { cue: /\b(?:italian[oa]s?|massas?|trattoria)\b/, label: 'italiana', phrase: 'de cozinha italiana', pattern: /\b(?:italian[oa]|massas?|trattoria|risoto)\b/ },
  { cue: /\b(?:pizzas?|pizzaria)\b/, label: 'pizza', phrase: 'com pizza', pattern: /\b(?:pizzas?|pizzaria)\b/ },
  { cue: /\b(?:hamburguer(?:es)?|hamburgueria|burger)\b/, label: 'hambúrguer', phrase: 'com hambúrguer', pattern: /\b(?:hamburguer(?:es)?|hamburgueria|burger)\b/ },
  { cue: /\b(?:frutos do mar|mariscos?|camarao|moqueca)\b/, label: 'frutos do mar', phrase: 'de frutos do mar', pattern: /\b(?:frutos do mar|peixes?|mariscos?|camarao|moqueca)\b/ },
  { cue: /\b(?:regional|regionais|baian[oa]s?|nordestin[oa]s?|brasileir[oa]s?)\b/, label: 'regional', phrase: 'de cozinha regional', pattern: /\b(?:regional|baian[oa]|nordestin[oa]|brasileir[oa]|moqueca|acaraje)\b/ },
  { cue: /\b(?:sorvetes?|gelatos?|acai|sobremesas?)\b/, label: 'sobremesas', phrase: 'com sobremesas', pattern: /\b(?:sorvetes?|gelat[oa]s?|gelateria|acai|sobremesas?|doces?)\b/ },
];

// Qualquer cozinha citada ("Onde tem sushi?"): pedido de lista de restaurantes.
export const CUISINE_CUE = new RegExp(CUISINES.map(({ cue }) => cue.source).join('|'));

export function cuisineByLabel(label: string | undefined): RestaurantFilters['cuisine'] {
  const cuisine = CUISINES.find((item) => item.label === label);
  return cuisine ? { label: cuisine.label, phrase: cuisine.phrase, pattern: cuisine.pattern } : undefined;
}

// Refeições sem horário explícito: faixa usual da refeição.
const MEALS: { cue: RegExp; window: TimeWindow; label: string }[] = [
  { cue: /\bcafe da manha\b/, window: { from: '06:00', to: '10:30' }, label: 'no café da manhã' },
  { cue: /\balmoc(?:o|ar)\b/, window: { from: '11:30', to: '15:00' }, label: 'no almoço' },
  { cue: /\bjantar\b/, window: { from: '18:30', to: '23:00' }, label: 'no jantar' },
];

// "abertos hoje" não é "agora": o dia inteiro não filtra horário.
const NOW = /\b(?:agora|neste momento|nesse momento)\b/;

const addMinutes = (time: string, minutes: number) => {
  const [h, m] = time.split(':').map(Number);
  const total = Math.min(h * 60 + m + minutes, 24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

export function restaurantFilters(message: string, entities: MessageEntities, now: string): RestaurantFilters {
  const text = normalizeText(message);
  const filters: RestaurantFilters = {};
  const cuisine = CUISINES.find(({ cue }) => cue.test(text));

  if (cuisine) filters.cuisine = { label: cuisine.label, phrase: cuisine.phrase, pattern: cuisine.pattern };
  if (/\b(?:com reserva|aceitam? reservas?|que reservam?|fazem reservas?)\b/.test(text)) filters.reservations = true;

  // Horário explícito > faixa > período > refeição > "agora".
  const meal = MEALS.find(({ cue }) => cue.test(text));

  if (entities.time) {
    filters.window = { from: entities.time, to: addMinutes(entities.time, 1) };
    filters.windowLabel = `às ${entities.time}`;
  } else if (entities.after || entities.before) {
    filters.window = { from: entities.after ?? '00:00', to: entities.before ?? '24:00' };
    filters.windowLabel = [entities.after ? `depois das ${entities.after}` : '', entities.before ? `antes das ${entities.before}` : '']
      .filter(Boolean)
      .join(' e ');
  } else if (entities.period) {
    filters.window = PERIOD_WINDOWS[entities.period];
    filters.windowLabel = PERIOD_LABELS[entities.period];
  } else if (meal) {
    filters.window = meal.window;
    filters.windowLabel = meal.label;
  } else if (NOW.test(text)) {
    filters.window = { from: now, to: addMinutes(now, 1) };
    filters.windowLabel = 'agora';
  }

  return filters;
}

// Depois de normalizeText: "10h às 18h30" vira "10h as 18h30" e "10h - 18h", "10h 18h".
// O fim exige o conectivo ("16h às 23") ou a unidade ("12h 15h"): em
// "Abre às 18h, 7 dias por semana" o 7 não é horário de fechamento.
const HOUR_RANGE =
  /\b(\d{1,2})(?:h|:)(\d{2})?\s+(?:(?:as|a|ate)\s+(\d{1,2})(?:h|:)?(\d{2})?|(\d{1,2})(?:h|:)(\d{2})?)\b/g;
// Horários por dia da semana não são interpretados: o funcionamento fica "não conferido".
const WEEKDAYS = /\b(?:seg|segunda|ter|terca|qua|quarta|qui|quinta|sex|sexta|sab|sabado|dom|domingo|fi(?:m|ns) de semana|feriados?)\b/;

const hhmm = (hours: string, minutes?: string) => `${hours.padStart(2, '0')}:${minutes ?? '00'}`;

/**
 * Faixas de funcionamento do texto do cadastro ("10h às 18h",
 * "Almoço: 12h às 15h. Night food: 23h às 5h"). Faixas que viram a
 * noite são divididas em duas.
 */
export function openingIntervals(openingHours: string | null): TimeWindow[] {
  const text = normalizeText(openingHours ?? '').replace(/(\d)\s+(\d{2})\b/g, '$1:$2');
  const intervals: TimeWindow[] = [];

  if (WEEKDAYS.test(text)) return intervals;

  for (const match of text.matchAll(HOUR_RANGE)) {
    const end = match[3] ?? match[5];
    const endMinutes = match[3] ? match[4] : match[6];
    if (Number(match[1]) > 23 || Number(end) > 24) continue;
    const from = hhmm(match[1], match[2]);
    const to = hhmm(end, endMinutes);

    if (to > from) intervals.push({ from, to });
    else intervals.push({ from, to: '24:00' }, { from: '00:00', to });
  }

  return intervals;
}

/**
 * true/false quando o cadastro permite decidir; null quando o
 * restaurante não tem horário cadastrado para a faixa pedida.
 */
export function openDuring(restaurant: RestaurantInfo, window: TimeWindow): boolean | null {
  const intervals = openingIntervals(restaurant.openingHours);

  if (intervals.length) {
    return intervals.some(({ from, to }) => from < window.to && window.from < to);
  }

  // Sem funcionamento conferível, um turno de reserva na faixa prova que
  // atende; a ausência de turno não prova que está fechado.
  return restaurant.reservationTimes.some((time) => time >= window.from && time < window.to) ? true : null;
}

export function matchesCuisine(restaurant: RestaurantInfo, filters: RestaurantFilters): boolean {
  return !filters.cuisine || filters.cuisine.pattern.test(normalizeText(`${restaurant.name} ${restaurant.description}`));
}
