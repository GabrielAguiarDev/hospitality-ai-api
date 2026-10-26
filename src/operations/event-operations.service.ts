import { Injectable, InternalServerErrorException } from '@nestjs/common';

import type { IntentDecision } from '../chat/chat-intent.types.js';
import { matchByName, nameList, normalizeText } from '../common/text.js';
import type { ChatAction, EventListAction } from '../contracts/chat-actions.js';
import type { ConversationState, EventConversationState } from '../contracts/conversation-state.js';
import { describeWindow, inWindow, timeWindowOf } from '../experiences/experience-search.js';
import type { GuestContext } from '../guest/guest-context.js';
import type { ResortEvent } from '../resort/events-catalog.service.js';
import { ResortClock } from '../resort/resort-clock.service.js';

import { OperationsToolRegistryService } from './operations-tool-registry.service.js';
import type { DispatchContext, DispatchResult } from './operations.types.js';

const MAX_CARDS = 30;
const MAX_HIGHLIGHTS = 3;

// Somente shows e eventos, ou somente a recreação semanal.
const EVENTS_ONLY = /\b(?:eventos?|shows?|apresentac(?:ao|oes)|musica ao vivo|ao vivo|festas?|atrac(?:ao|oes))\b/;
// Público citado → categorias de lazer ("4 a 7 anos", "Teens", "Adulto", "Sports").
const AUDIENCES: { key: NonNullable<EventConversationState['audience']>; cue: RegExp; category: RegExp; label: string }[] = [
  { key: 'kids', cue: /\b(?:criancas?|infantil|infantis|kids|filhos?|pequenos)\b/, category: /^\d+ a (?:[1-9]|1[01]) anos$/, label: 'para crianças' },
  { key: 'teens', cue: /\b(?:teens?|adolescentes?|jovens)\b/, category: /\bteens?\b/, label: 'para adolescentes' },
  { key: 'adults', cue: /\badult[oa]s?\b/, category: /\badult[oa]s?\b/, label: 'para adultos' },
  { key: 'sports', cue: /\b(?:esportes?|esportivas?|sports?)\b/, category: /\b(?:sports?|esportes?)\b/, label: 'de esportes' },
];

const LEISURE_ONLY = /\b(?:recreac(?:ao|oes)|atividades(?: de lazer)?|lazer)\b/;
// Palavras genéricas não identificam um evento pelo nome.
const GENERIC = /\b(?:show|shows|evento|eventos|hoje|amanha|noite|tarde|manha|programacao|que|horas|onde|vai|ter|tem)\b/g;

function dayLabel(date: string, today: string): string {
  if (date === today) return 'hoje';
  if (date === ResortClock.addDays(today, 1)) return 'amanhã';
  return `${ResortClock.weekdayLabel(date)}, ${ResortClock.formatDate(date).slice(0, 5)}`;
}

function eventsAction(date: string, events: ResortEvent[]): ChatAction[] {
  if (events.length === 0) return [];

  const action: EventListAction = {
    type: 'event.list',
    label: 'Programação',
    date,
    items: events.slice(0, MAX_CARDS).map(({ id, kind, title, time, location, category, description }) => ({
      eventId: id,
      kind,
      title,
      date,
      time,
      location,
      category,
      description,
    })),
  };

  return [action];
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * Eventos, shows e programação de lazer de um dia, lidos do snapshot.
 * O texto é um resumo curto; a programação completa vai no card.
 */
@Injectable()
export class EventOperationsService {
  constructor(
    private readonly registry: OperationsToolRegistryService,
    private readonly clock: ResortClock,
  ) {}

  async handle(
    message: string,
    decision: IntentDecision,
    guest: GuestContext,
    context: DispatchContext,
  ): Promise<DispatchResult> {
    const previous = context.state.event ?? {};
    const entities = decision.entities ?? {};
    const today = this.clock.today();
    const date = entities.date ?? (decision.refine ? previous.date : undefined) ?? today;
    // Uma continuação ("E amanhã?") mantém o período anterior; um novo período o substitui.
    const ownWindow = entities.period || entities.after || entities.before;
    const filters: NonNullable<EventConversationState['filters']> = ownWindow
      ? entities.period
        ? { period: entities.period }
        : { ...(entities.after ? { after: entities.after } : {}), ...(entities.before ? { before: entities.before } : {}) }
      : decision.refine ? { ...previous.filters } : {};
    const window = timeWindowOf(filters);

    const result = await this.registry.execute('events.list', guest, { date });

    if (result.tool !== 'events.list') {
      throw new InternalServerErrorException('Resultado inesperado da ferramenta.');
    }

    const text = normalizeText(message);
    const asked = EVENTS_ONLY.test(text) && !LEISURE_ONLY.test(text) ? 'event' : LEISURE_ONLY.test(text) && !EVENTS_ONLY.test(text) ? 'leisure' : null;
    // "Quais shows amanhã?" → "E à noite?" continua só com shows.
    const audience = AUDIENCES.find(({ cue }) => cue.test(text)) ?? (decision.refine ? AUDIENCES.find(({ key }) => key === previous.audience) : undefined);
    // Público só existe nas atividades de lazer.
    const kind = audience ? 'leisure' : (asked ?? (decision.refine ? (previous.kind ?? null) : null));
    // Hoje, o que já passou não é oferecido.
    const now = date === today ? this.clock.time() : null;
    const upcoming = result.data.events.filter(
      (event) =>
        (!kind || event.kind === kind) &&
        (!audience || (event.category !== null && audience.category.test(normalizeText(event.category)))) &&
        (!window || (event.time !== null && inWindow(event.time, window))) &&
        (!now || event.time === null || event.time >= now),
    );

    const label = `${dayLabel(date, today)}${window ? ` ${describeWindow(filters)}` : ''}${audience ? `, ${audience.label}` : ''}`;
    const state: ConversationState = {
      ...context.state,
      topic: 'event',
      event: { date, ...(Object.keys(filters).length ? { filters } : {}), ...(kind ? { kind } : {}), ...(audience ? { audience: audience.key } : {}) },
    };

    // "Que horas é o show de circo?": responde sobre o evento citado.
    const named = matchByName(text.replace(GENERIC, ' '), upcoming.map((event) => ({ ...event, name: event.title })));

    if (named.length >= 1 && named.length <= 2) {
      return {
        tool: 'events.list',
        reply: named
          .map(({ title, time, location }) =>
            `${title}: ${dayLabel(date, today)}${time ? ` às ${time}` : ''}${location ? `, em ${location}` : ''}.`)
          .join(' '),
        actions: eventsAction(date, named),
        resultCount: named.length,
        state,
      };
    }

    if (upcoming.length === 0) {
      return {
        tool: 'events.list',
        reply: `Não encontrei ${kind === 'leisure' ? 'atividades de lazer registradas' : kind === 'event' ? 'eventos registrados' : 'programação registrada'} para ${label}.`,
        resultCount: 0,
        state,
      };
    }

    const events = upcoming.filter((event) => event.kind === 'event');
    const leisure = upcoming.length - events.length;
    const counts = [
      events.length ? plural(events.length, 'evento', 'eventos') : '',
      leisure ? plural(leisure, 'atividade de lazer', 'atividades de lazer') : '',
    ].filter(Boolean).join(' e ');
    const describe = ({ title, time }: ResortEvent) => `${title}${time ? ` (${time})` : ''}`;
    const highlights = (events.length ? events : upcoming).slice(0, MAX_HIGHLIGHTS).map(describe);

    return {
      tool: 'events.list',
      reply:
        upcoming.length <= MAX_HIGHLIGHTS
          ? `Para ${label}: ${nameList(upcoming.map(describe), MAX_HIGHLIGHTS)}.`
          : `Para ${label}, há ${counts} na programação. Destaques: ${nameList(highlights, MAX_HIGHLIGHTS)}.` +
            (upcoming.length > MAX_CARDS ? ` Os cards mostram os ${MAX_CARDS} primeiros horários.` : ''),
      actions: eventsAction(date, upcoming),
      resultCount: upcoming.length,
      state,
    };
  }
}
