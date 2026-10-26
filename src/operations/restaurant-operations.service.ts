import { Injectable, InternalServerErrorException } from '@nestjs/common';

import type { IntentDecision, RestaurantIntent } from '../chat/chat-intent.types.js';
import { matchByName, nameList, normalizeText, summarizeText } from '../common/text.js';
import { RESTAURANT_TYPES, type ChatAction, type NavigateAction, type RestaurantOptionsAction } from '../contracts/chat-actions.js';
import type {
  ConversationState,
  RestaurantConversationState,
  RestaurantSearchFilters,
} from '../contracts/conversation-state.js';
import type { GuestContext } from '../guest/guest-context.js';
import { ResortClock } from '../resort/resort-clock.service.js';
import type { RestaurantInfo } from '../resort/restaurants-catalog.service.js';

import { OperationsToolRegistryService } from './operations-tool-registry.service.js';
import type { DispatchContext, DispatchResult } from './operations.types.js';
import { cuisineByLabel, matchesCuisine, openDuring, restaurantFilters, type RestaurantFilters } from './restaurant-search.js';
import type { RestaurantType } from './tool-inputs.js';

const MAX_LISTED = 10;
const TYPE_ORDER: readonly RestaurantType[] = ['restaurante', 'bar', 'alimentacao'];
// Resumo do catálogo completo e lista expandida ("Quer ver todas?").
const SUMMARY_SIZE = 6;
const MAX_EXPANDED = 20;

const TYPE_LABELS: Record<RestaurantType, { one: string; many: string }> = {
  restaurante: { one: 'restaurante', many: 'restaurantes' },
  bar: { one: 'bar', many: 'bares' },
  alimentacao: { one: 'opção de lanche ou sobremesa', many: 'opções de lanches e sobremesas' },
};

// Tipo pedido na mensagem; sem indicação clara, o catálogo inteiro.
function requestedType(message: string): RestaurantType | null {
  const text = normalizeText(message);
  const bar = /\b(?:bares|bar|drinks?|bebidas?)\b/.test(text);
  const snack = /\b(?:lanches?|lanchonetes?|pizzas?|pizzaria|hamburguer(?:ia)?|sorvetes?|acai|gelateria|sobremesas?)\b/.test(text);
  const restaurant = /\brestaurantes?\b/.test(text);

  if (bar && !restaurant && !snack) return 'bar';
  if (snack && !restaurant && !bar) return 'alimentacao';
  if (restaurant && !bar && !snack) return 'restaurante';
  return null;
}

// "à tarde" não cita o "Chá da Tarde": palavras de tempo não identificam nomes.
function withoutTimeWords(message: string): string {
  return normalizeText(message).replace(/\b(?:manha|tarde|noite|hoje|amanha|dia|semana)\b/g, ' ');
}

// Textos do cadastro podem vir com ponto final ou em maiúsculas ("PRAIA").
const trimEnd = (value: string) => value.replace(/[.;\s]+$/, '');
const readable = (value: string) =>
  value === value.toUpperCase() ? value.charAt(0) + value.slice(1).toLowerCase() : value;

function isRestaurantType(value: string | null): value is RestaurantType {
  return value === 'restaurante' || value === 'bar' || value === 'alimentacao';
}

function optionsAction(restaurants: RestaurantInfo[]): ChatAction[] {
  if (restaurants.length === 0) return [];

  const action: RestaurantOptionsAction = {
    type: 'restaurant.options',
    label: 'Ver restaurante',
    options: restaurants.map((restaurant, index) => ({
      position: index + 1,
      restaurantId: String(restaurant.id),
      name: restaurant.name,
      type: (RESTAURANT_TYPES as readonly string[]).includes(restaurant.type ?? '') ? (restaurant.type as RestaurantType) : null,
      openingHours: trimEnd(restaurant.openingHours ?? '') || null,
      location: restaurant.location ? readable(restaurant.location) : null,
      minimumAge: restaurant.minimumAge,
      acceptsReservations: restaurant.acceptsReservations,
      reservationTimes: restaurant.reservationTimes,
      message: `Opção ${index + 1}`,
    })),
  };

  return [action];
}

// "entre 19:00 e 21:30" em vez de listar cada turno.
function describeTimes(times: string[]): string {
  return times.length > 2 ? `entre ${times[0]} e ${times.at(-1)}` : times.join(' e ');
}

function compactFilters(filters: RestaurantSearchFilters): RestaurantSearchFilters | undefined {
  const entries = Object.entries(filters).filter(([, value]) => value !== undefined);
  return entries.length ? (Object.fromEntries(entries) as RestaurantSearchFilters) : undefined;
}

function gastronomyAction(restaurantId?: string): NavigateAction {
  return {
    type: 'navigate',
    label: 'Abrir Gastronomia',
    screen: 'Gastronomy',
    params: restaurantId ? { restaurantId } : {},
  };
}

/**
 * Reservas gastronômicas exigem a seleção de pratos no aplicativo.
 * A IA nunca cria a reserva: apenas identifica o restaurante e
 * devolve uma ação de navegação com o ID real do cadastro.
 */
@Injectable()
export class RestaurantOperationsService {
  constructor(
    private readonly registry: OperationsToolRegistryService,
    private readonly clock: ResortClock,
  ) {}

  async findMentioned(message: string, guest: GuestContext): Promise<RestaurantInfo[]> {
    const result = await this.registry.execute('restaurants.list', guest);

    if (result.tool !== 'restaurants.list') {
      throw new InternalServerErrorException('Resultado inesperado da ferramenta.');
    }

    return matchByName(withoutTimeWords(message), result.data);
  }

  private async catalog(guest: GuestContext, input: { type?: RestaurantType; name?: string } = {}): Promise<RestaurantInfo[]> {
    const result = await this.registry.execute('restaurants.list', guest, input);

    if (result.tool !== 'restaurants.list') {
      throw new InternalServerErrorException('Resultado inesperado da ferramenta.');
    }

    return result.data;
  }

  /** Catálogo e detalhes de restaurantes pelo chat. */
  async handle(
    message: string,
    decision: IntentDecision & { intent: RestaurantIntent },
    guest: GuestContext,
    context: DispatchContext,
  ): Promise<DispatchResult> {
    const state = context.state.restaurant ?? {};
    const all = await this.catalog(guest);
    const resolved = this.resolve(message, decision, state, all);

    if (decision.intent === 'restaurant.booking') {
      const result = await this.handleBooking(message, guest, resolved ?? undefined, all);
      return {
        ...result,
        state: this.state(context.state, resolved ? { ...state, selectedId: resolved.id, selectedName: resolved.name } : state),
      };
    }

    const filters = restaurantFilters(message, decision.entities ?? {}, this.clock.time());

    // Um nome, uma posição ou uma referência indicam um restaurante;
    // senão, a pergunta é sobre o catálogo.
    if (resolved && (decision.intent === 'restaurant.details' || !/\b(?:quais|lista|liste|opcoes|algum|alguns)\b/.test(normalizeText(message)))) {
      return filters.window ? this.openNow(resolved, filters, context.state, state) : this.details(resolved, context.state, state);
    }

    // "Sim" a "Quer ver todas?" mostra a lista completa do mesmo tipo.
    const pending = decision.answersPending ? context.state.pendingQuestion?.targetId : undefined;
    const expand = pending?.startsWith('all') ? { type: (pending.split(':')[1] as RestaurantType | undefined) ?? null } : null;

    if (expand) {
      return this.list(message, all, context.state, state, expand);
    }

    // Continuação ("E à noite?"): tipo, cozinha e reserva da lista anterior.
    const previous = decision.refine ? state.filters : undefined;
    return this.list(message, all, context.state, state, null, {
      ...filters,
      cuisine: filters.cuisine ?? cuisineByLabel(previous?.cuisine),
      reservations: filters.reservations ?? previous?.reservations,
    }, previous?.type);
  }

  // "O Bar Villagio está aberto agora?": resposta direta pelo cadastro.
  private openNow(
    restaurant: RestaurantInfo,
    filters: RestaurantFilters,
    conversation: ConversationState,
    state: RestaurantConversationState,
  ): DispatchResult {
    const open = openDuring(restaurant, filters.window!);
    const hours = restaurant.openingHours ? ` Funcionamento: ${trimEnd(restaurant.openingHours)}.` : '';

    return {
      tool: 'restaurants.list',
      reply:
        open === null
          ? restaurant.openingHours
            ? `Não consegui conferir pelo horário cadastrado de ${restaurant.name}: ${trimEnd(restaurant.openingHours)}.`
            : `O horário de funcionamento de ${restaurant.name} não está cadastrado.`
          : `${open ? 'Sim' : 'Não'}, ${restaurant.name} ${open ? 'está' : 'não está'} em funcionamento ${filters.windowLabel}.${hours}`,
      actions: [...optionsAction([restaurant]), ...(restaurant.acceptsReservations ? [gastronomyAction(restaurant.id)] : [])],
      resultCount: 1,
      state: this.state(conversation, { ...state, selectedId: restaurant.id, selectedName: restaurant.name }),
    };
  }

  private resolve(
    message: string,
    decision: IntentDecision,
    state: RestaurantConversationState,
    all: RestaurantInfo[],
  ): RestaurantInfo | null {
    const byId = (id?: string) => all.find((restaurant) => restaurant.id === id) ?? null;
    const ordinal = decision.entities?.ordinal;

    if (ordinal !== undefined && state.listed?.length) {
      const reference = state.listed[ordinal === -1 ? state.listed.length - 1 : ordinal - 1];
      return byId(reference?.id);
    }

    const target = decision.target?.kind === 'restaurant' ? decision.target : undefined;

    // "Sim" à pergunta pendente: a pergunta já define o restaurante.
    if (target?.via === 'pending_question') {
      return byId(target.id);
    }

    // Um nome citado sempre vence o contexto ("Quero reservar no Omakase").
    const matches = matchByName(withoutTimeWords(message), all);
    if (matches.length === 1) return matches[0];

    return target ? byId(target.id) : null;
  }

  private state(conversation: ConversationState, restaurant: RestaurantConversationState): ConversationState {
    return { ...conversation, topic: 'restaurant', restaurant };
  }

  private list(
    message: string,
    all: RestaurantInfo[],
    conversation: ConversationState,
    state: RestaurantConversationState,
    expand: { type: RestaurantType | null } | null = null,
    filters: RestaurantFilters = {},
    previousType?: RestaurantType,
  ): DispatchResult {
    const type = expand
      ? expand.type && expand.type in TYPE_LABELS ? expand.type : null
      : (requestedType(message) ?? previousType ?? null);
    // Catálogo completo: restaurantes primeiro, depois bares e lanches.
    const rank = (restaurant: RestaurantInfo) => {
      const position = TYPE_ORDER.indexOf(restaurant.type as RestaurantType);
      return position === -1 ? TYPE_ORDER.length : position;
    };
    const window = filters.window;
    const candidates = (type ? all.filter((restaurant) => restaurant.type === type) : [...all].sort((a, b) => rank(a) - rank(b)))
      .filter((restaurant) => matchesCuisine(restaurant, filters) && (!filters.reservations || restaurant.acceptsReservations));
    // Sem horário cadastrado, o restaurante não é afirmado como aberto.
    const matching = window ? candidates.filter((restaurant) => openDuring(restaurant, window) === true) : candidates;
    const unknownHours = window ? candidates.filter((restaurant) => openDuring(restaurant, window) === null) : [];
    const filtered = Boolean(filters.cuisine || filters.reservations || window);
    // Listas grandes: um resumo com as opções mais relevantes e acesso ao restante.
    const limit = expand ? MAX_EXPANDED : type || filtered ? MAX_LISTED : SUMMARY_SIZE;
    const shown = matching.slice(0, limit);
    const hidden = matching.length - shown.length;
    const listed = shown.map(({ id, name }) => ({ id, name }));
    const noun = type ? TYPE_LABELS[type] : { one: 'opção de gastronomia', many: 'opções de gastronomia' };
    const criteria = [
      filters.cuisine?.phrase ?? '',
      filters.reservations ? 'com reserva pelo aplicativo' : '',
      window ? `em funcionamento ${filters.windowLabel}` : '',
    ].filter(Boolean).join(', ');
    const savedFilters = compactFilters({ type: type ?? undefined, cuisine: filters.cuisine?.label, reservations: filters.reservations });
    const unknownLine = unknownHours.length
      ? `Não consegui conferir pelo horário cadastrado: ${nameList(unknownHours.map(({ name }) => name))}.`
      : '';

    if (shown.length === 0) {
      return {
        tool: 'restaurants.list',
        reply: [
          criteria
            ? `Não encontrei ${noun.many} ${criteria} no cadastro do resort.`
            : `Não encontrei ${type ? TYPE_LABELS[type].many : 'restaurantes'} ativos no cadastro do resort.`,
          unknownLine,
          filtered ? 'Quer ver todas as opções?' : '',
        ].filter(Boolean).join(' '),
        resultCount: 0,
        ...(filtered ? { pendingQuestion: { intent: 'restaurant.list' as const, targetId: type ? `all:${type}` : 'all' } } : {}),
        state: this.state(conversation, { ...state, listed: [], filters: savedFilters }),
      };
    }

    // Texto breve: a lista completa vai nos cards (restaurant.options).
    return {
      tool: 'restaurants.list',
      reply: [
        `${criteria || type ? 'Encontrei' : 'Separei'} ${shown.length} ${shown.length === 1 ? noun.one : noun.many}` +
          `${criteria ? ` ${criteria}` : ''}: ${nameList(shown.map(({ name }) => name))}.`,
        unknownLine,
        hidden > 0 && !expand ? `Há mais ${hidden}; quer ver todas?` : '',
        // A lista expandida não pergunta de novo: o restante fica na tela.
        hidden > 0 && expand ? `As outras ${hidden} estão na tela de Gastronomia.` : '',
      ].filter(Boolean).join(' '),
      actions: [...optionsAction(shown), gastronomyAction()],
      resultCount: shown.length,
      ...(hidden > 0 && !expand
        ? { pendingQuestion: { intent: 'restaurant.list' as const, targetId: type ? `all:${type}` : 'all' } }
        : {}),
      state: this.state(conversation, { ...state, listed, selectedId: undefined, selectedName: undefined, filters: savedFilters }),
    };
  }

  private details(
    restaurant: RestaurantInfo,
    conversation: ConversationState,
    state: RestaurantConversationState,
  ): DispatchResult {
    // A descrição não é repetida para o restaurante já apresentado.
    const repeated = state.describedId === restaurant.id;
    const kind = isRestaurantType(restaurant.type) ? TYPE_LABELS[restaurant.type].one : 'opção de gastronomia';

    return {
      tool: 'restaurants.list',
      reply: [
        `${restaurant.name} é ${kind === 'opção de lanche ou sobremesa' ? 'uma' : 'um'} ${kind} do resort${restaurant.location ? ` (local: ${readable(restaurant.location)})` : ''}.`,
        repeated ? '' : summarizeText(restaurant.description),
        restaurant.openingHours ? `Funcionamento: ${trimEnd(restaurant.openingHours)}.` : 'O horário de funcionamento não está cadastrado.',
        restaurant.minimumAge ? `Idade mínima: ${restaurant.minimumAge} anos.` : '',
        restaurant.acceptsReservations
          ? 'A reserva é feita pelo aplicativo, em Gastronomia, com a seleção dos pratos. Quer que eu abra a Gastronomia?'
          : 'Não é preciso reservar.',
      ].filter(Boolean).join('\n'),
      actions: [...optionsAction([restaurant]), ...(restaurant.acceptsReservations ? [gastronomyAction(restaurant.id)] : [])],
      resultCount: 1,
      ...(restaurant.acceptsReservations
        ? { pendingQuestion: { intent: 'restaurant.booking' as const, targetId: restaurant.id } }
        : {}),
      state: this.state(conversation, { ...state, selectedId: restaurant.id, selectedName: restaurant.name, describedId: restaurant.id }),
    };
  }

  async handleBooking(
    message: string,
    guest: GuestContext,
    target?: RestaurantInfo,
    catalog?: RestaurantInfo[],
  ): Promise<DispatchResult> {
    const restaurants = catalog ?? (await this.catalog(guest));
    const matches = target ? [target] : matchByName(withoutTimeWords(message), restaurants);
    const bookable = restaurants.filter((restaurant) => restaurant.acceptsReservations);
    const bookableNames = bookable.map(({ name }) => name).join(', ');

    if (matches.length === 1) {
      const [restaurant] = matches;

      if (!restaurant.acceptsReservations) {
        return {
          tool: 'restaurants.list',
          reply: [
            `O ${restaurant.name} não trabalha com reservas pelo aplicativo.`,
            restaurant.openingHours ? `Funcionamento: ${restaurant.openingHours}.` : '',
            bookable.length ? `Restaurantes com reserva pelo aplicativo: ${bookableNames}.` : '',
          ].filter(Boolean).join(' '),
          actions: [gastronomyAction(restaurant.id)],
        };
      }

      return {
        tool: 'restaurants.list',
        reply: [
          `A reserva do ${restaurant.name} é feita pelo aplicativo, com a escolha dos pratos.`,
          restaurant.reservationTimes.length
            ? `Turnos cadastrados ${describeTimes(restaurant.reservationTimes)}; toque em "Abrir Gastronomia" para continuar.`
            : 'Toque em "Abrir Gastronomia" para continuar.',
        ].join(' '),
        actions: [gastronomyAction(restaurant.id)],
      };
    }

    if (matches.length > 1) {
      return {
        tool: 'restaurants.list',
        reply: `Encontrei mais de um restaurante com esse nome: ${matches.map(({ name }) => name).join(', ')}. Qual deles você deseja?`,
        actions: [gastronomyAction()],
      };
    }

    return {
      tool: 'restaurants.list',
      reply: [
        'Não identifiquei esse restaurante no cadastro do resort.',
        bookable.length
          ? `Os restaurantes com reserva pelo aplicativo são: ${bookableNames}.`
          : '',
        'Para reservar, é preciso selecionar os pratos em Gastronomia.',
      ].filter(Boolean).join(' '),
      actions: [gastronomyAction()],
    };
  }
}
