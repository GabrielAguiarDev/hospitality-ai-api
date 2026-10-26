import { normalizeText } from '../common/text.js';
import type { DayPeriod } from '../contracts/conversation-state.js';
import { ResortClock } from '../resort/resort-clock.service.js';

/**
 * Extração determinística de entidades da mensagem do hóspede.
 * Datas relativas ("amanhã", "sábado") são convertidas para datas
 * absolutas no fuso do resort a partir de `today`.
 */
export interface MessageEntities {
  date?: string;
  time?: string;
  adults?: number;
  children?: number;
  // Total informado sem divisão entre adultos e crianças.
  people?: number;
  // Posição em uma lista apresentada (1 = primeira).
  ordinal?: number;
  // Período do dia, sem horário específico ("de manhã").
  period?: DayPeriod;
  // Faixa de horário (HH:MM): "depois das 15h", "antes das 10h".
  after?: string;
  before?: string;
  // Filtros de catálogo citados na pergunta.
  free?: true;
  forChildren?: true;
  bookable?: true;
}

const NUMBER_WORDS: Record<string, number> = {
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
};

const ORDINALS: Record<string, number> = {
  primeira: 1,
  primeiro: 1,
  segunda: 2,
  segundo: 2,
  terceira: 3,
  terceiro: 3,
  quarta: 4,
  quarto: 4,
  quinta: 5,
  quinto: 5,
  sexta: 6,
  sexto: 6,
  ultima: -1,
  ultimo: -1,
};

const WEEKDAYS: Record<string, number> = {
  domingo: 0,
  segunda: 1,
  terca: 2,
  quarta: 3,
  quinta: 4,
  sexta: 5,
  sabado: 6,
};

const NUMBER = `(\\d{1,2}|${Object.keys(NUMBER_WORDS).join('|')})`;

function toNumber(token: string): number | undefined {
  const value = /^\d+$/.test(token) ? Number(token) : NUMBER_WORDS[token];
  return value !== undefined && value >= 0 && value <= 20 ? value : undefined;
}

export function extractDate(text: string, today: string): string | undefined {
  const t = normalizeText(text);

  if (/\bdepois de amanha\b/.test(t)) return ResortClock.addDays(today, 2);
  if (/\bamanha\b/.test(t)) return ResortClock.addDays(today, 1);
  if (/\bhoje\b/.test(t)) return today;

  const full = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);

  if (full) {
    const day = Number(full[1]);
    const month = Number(full[2]);
    const currentYear = Number(today.slice(0, 4));
    let year = full[3] ? Number(full[3]) : currentYear;
    if (year < 100) year += 2000;

    let candidate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    // Sem ano informado, uma data já passada refere-se ao próximo ano.
    if (!full[3] && ResortClock.isIsoDate(candidate) && candidate < today) {
      candidate = `${year + 1}-${candidate.slice(5)}`;
    }

    return ResortClock.isIsoDate(candidate) ? candidate : undefined;
  }

  const dayOnly = t.match(/\bdia (\d{1,2})\b/);

  if (dayOnly) {
    const day = Number(dayOnly[1]);
    let candidate = `${today.slice(0, 8)}${String(day).padStart(2, '0')}`;

    if (ResortClock.isIsoDate(candidate) && candidate < today) {
      const nextMonth = ResortClock.addDays(`${today.slice(0, 8)}01`, 32);
      candidate = `${nextMonth.slice(0, 8)}${String(day).padStart(2, '0')}`;
    }

    return ResortClock.isIsoDate(candidate) ? candidate : undefined;
  }

  // "segunda" sozinha pode ser ordinal ("gostei da segunda"):
  // dias da semana exigem "-feira" ou uma preposição de tempo.
  const weekday = t.match(
    /\b(?:(?:no|na|neste|nesta|este|esta|proximo|proxima|pro|pra)\s+)?(domingo|segunda|terca|quarta|quinta|sexta|sabado)(\s+feira)?\b/,
  );

  if (weekday) {
    const name = weekday[1];
    const explicit =
      Boolean(weekday[2]) ||
      name === 'domingo' ||
      name === 'sabado' ||
      /^(?:no|na|neste|nesta|este|esta|proximo|proxima|pro|pra)\s/.test(weekday[0]);

    if (explicit) {
      const target = WEEKDAYS[name];
      const current = ResortClock.weekdayIndex(today);
      const days = (target - current + 7) % 7;
      // "Próximo sábado" dito num sábado é o da semana seguinte.
      return ResortClock.addDays(today, days === 0 && /^(?:proximo|proxima)\s/.test(weekday[0]) ? 7 : days);
    }
  }

  return undefined;
}

export function extractTime(text: string): string | undefined {
  const t = normalizeText(text.replace(/(\d)\s*:\s*(\d)/g, '$1h$2'));

  const match =
    // "pra 2 pessoas" e "quero a 2" não são horários.
    t.match(/\b(?:as|pras|por volta das)\s+(\d{1,2})(?:\s*h\s*(\d{2})?|\s+horas?)?\b(?!\s+(?:pessoas?|adultos?|criancas?))/) ??
    t.match(/\b(\d{1,2})\s*h\s*(\d{2})?\b/) ??
    t.match(/\b(\d{1,2})\s+horas?\b/);

  if (!match) {
    return undefined;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2] ?? '0');

  if (hours > 23 || minutes > 59) {
    return undefined;
  }

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

// Expressões que contêm "manhã", "tarde" ou "noite" sem indicar período.
const NOT_A_PERIOD = /\b(?:bom dia|boa tarde|boa noite|boas noites|cafe da manha|mais tarde|ate mais tarde)\b/g;

export function extractPeriod(text: string): DayPeriod | undefined {
  const t = normalizeText(text).replace(NOT_A_PERIOD, ' ');

  // "amanhã" não contém a palavra "manhã" isolada.
  if (/\bmanha\b/.test(t)) return 'morning';
  // "tarde" sozinha também é advérbio ("vou chegar tarde").
  if (/\b(?:a|de|da|na|pela|esta|essa|nesta|hoje|amanha|durante a) tarde\b/.test(t)) return 'afternoon';
  if (/\bnoite\b/.test(t)) return 'evening';

  return undefined;
}

const HOUR =
  '(\\d{1,2})(?:\\s*h\\s*(\\d{2})?|\\s+horas?)?\\b(?!\\s+(?:pessoas?|adultos?|criancas?|anos?|meses))(?:\\s+d[ae]\\s+(tarde|noite))?';

// "8 da noite" = 20:00; "4 da tarde" = 16:00.
function clock(hours: string, minutes?: string, afternoon?: string): string | undefined {
  const h = Number(hours) + (afternoon && Number(hours) < 12 ? 12 : 0);
  const m = Number(minutes ?? '0');
  return h <= 23 && m <= 59 ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` : undefined;
}

/** "depois das 15h", "a partir das 14h", "antes das 10h". */
export function extractTimeRange(text: string): Pick<MessageEntities, 'after' | 'before'> {
  const t = normalizeText(text.replace(/(\d)\s*:\s*(\d)/g, '$1h$2'));
  const result: Pick<MessageEntities, 'after' | 'before'> = {};

  const after = t.match(new RegExp(`\\b(?:depois d[ao]s?|apos (?:as?|o)?|a partir d[ao]s?)\\s*${HOUR}`));
  const before = t.match(new RegExp(`\\b(?:antes d[ao]s?|ate (?:as|a))\\s+${HOUR}`));

  const afterTime = after ? clock(after[1], after[2], after[3]) : undefined;
  const beforeTime = before ? clock(before[1], before[2], before[3]) : undefined;

  if (afterTime) result.after = afterTime;
  if (beforeTime) result.before = beforeTime;

  return result;
}

/**
 * Filtros de catálogo: "gratuitas", "para crianças", "que aceitam reserva".
 * Um número de crianças ("para 2 crianças") é composição do grupo, não filtro.
 */
export function extractSearchCues(text: string): Pick<MessageEntities, 'free' | 'forChildren' | 'bookable'> {
  const t = normalizeText(text);
  const result: Pick<MessageEntities, 'free' | 'forChildren' | 'bookable'> = {};

  if (/\b(?:gratis|gratuit[ao]s?|de graca|sem custo|sem cobranca|sem pagar|all inclusive|inclus[ao]s? na diaria|incluid[ao]s? na diaria)\b/.test(t)) {
    result.free = true;
  }

  if (
    /\b(?:infantil|infantis|kids|criancas? pode|criancas podem|aceitam? criancas?|(?:para|pra|com) (?:as |os |meus |minhas )?(?:criancas|pequenos|filhos|filhas))\b/.test(t) &&
    !new RegExp(`\\b${NUMBER}\\s+(?:criancas?|filhos?|filhas?)\\b`).test(t)
  ) {
    result.forChildren = true;
  }

  // "não precisam de reserva" / "sem reserva" pedem o contrário.
  const negated = /\b(?:nao (?:precisa|precisam|exige|exigem|tem|aceita|aceitam|requer|requerem)(?: de)? reservas?|sem (?:necessidade de )?reservas?)\b/.test(t);

  if (
    !negated &&
    /\b(?:vagas?|disponive(?:l|is)|disponibilidade|(?:tem|tenha|tenham|com|aceitam?|precisam?(?: de)?|exigem?) reservas?|reservave(?:l|is)|(?:posso|podemos|da pra|da para|para|pra|consigo) reservar)\b/.test(t)
  ) {
    result.bookable = true;
  }

  return result;
}

export function extractParty(
  text: string,
): Pick<MessageEntities, 'adults' | 'children' | 'people'> {
  const t = normalizeText(text);
  const result: Pick<MessageEntities, 'adults' | 'children' | 'people'> = {};

  const adults = t.match(new RegExp(`\\b${NUMBER}\\s+adultos?\\b`));
  const children = t.match(new RegExp(`\\b${NUMBER}\\s+(?:criancas?|filhos?|filhas?)\\b`));
  const people = t.match(new RegExp(`\\b${NUMBER}\\s+(?:pessoas?|pax|participantes?)\\b`));

  if (adults) result.adults = toNumber(adults[1]);
  if (children) result.children = toNumber(children[1]);

  if (people && result.adults === undefined && result.children === undefined) {
    result.people = toNumber(people[1]);
  }

  if (
    result.adults === undefined &&
    result.people === undefined &&
    /\b(?:um casal|para o casal|eu e (?:minha|meu) (?:esposa|esposo|marido|mulher|namorada|namorado))\b/.test(t)
  ) {
    result.adults = 2;
  }

  if (result.adults === undefined && result.people === undefined && /\b(?:so eu|apenas eu|somente eu)\b/.test(t)) {
    result.adults = 1;
  }

  return result;
}

export function extractOrdinal(text: string): number | undefined {
  const t = normalizeText(text);

  const word = t.match(
    /\b(?:a|o|da|do|na|no|pela|pelo|essa|esse)\s+(primeira|primeiro|segunda|segundo|terceira|terceiro|quarta|quarto|quinta|quinto|sexta|sexto|ultima|ultimo)\b(?!\s+feira)/,
  );

  if (word) {
    return ORDINALS[word[1]];
  }

  const numbered = t.match(/\b(?:opcao|numero|n|item)\s*(\d{1,2})\b/) ?? t.match(/^(\d{1,2})$/);

  return numbered ? Number(numbered[1]) : undefined;
}

export function extractEntities(text: string, today: string): MessageEntities {
  const entities: MessageEntities = { ...extractParty(text) };

  const normalized = normalizeText(text);
  // "na segunda" / "segunda-feira" é dia da semana, não posição na lista.
  const weekdayPhrase =
    /\b(?:no|na|neste|nesta|proximo|proxima)\s+(?:domingo|segunda|terca|quarta|quinta|sexta|sabado)\b|\bfeira\b/.test(normalized);

  const ordinal = weekdayPhrase ? undefined : extractOrdinal(text);
  if (ordinal !== undefined) entities.ordinal = ordinal;

  // Um ordinal ("a segunda") não deve virar dia da semana.
  const date = extractDate(text, today);
  if (date !== undefined && ordinal === undefined) {
    entities.date = date;
  }

  // Uma faixa ("depois das 15h") ou um período não é um horário exato.
  const range = extractTimeRange(text);
  Object.assign(entities, range);

  const time = range.after || range.before ? undefined : extractTime(text);
  if (time !== undefined) entities.time = time;

  // "depois das 8 da noite" já é uma faixa; o período não a alarga.
  const period = range.after || range.before ? undefined : extractPeriod(text);
  if (period !== undefined) entities.period = period;

  Object.assign(entities, extractSearchCues(text));

  for (const key of Object.keys(entities) as (keyof MessageEntities)[]) {
    if (entities[key] === undefined) delete entities[key];
  }

  return entities;
}
