import { Injectable, InternalServerErrorException } from '@nestjs/common';

import type { IntentDecision, RestaurantIntent } from '../chat/chat-intent.types.js';
import { matchByName, normalizeText, summarizeText } from '../common/text.js';
import type { NavigateAction } from '../contracts/chat-actions.js';
import type {
  ConversationState,
  RestaurantConversationState,
} from '../contracts/conversation-state.js';
import type { GuestContext } from '../guest/guest-context.js';
import type { RestaurantInfo } from '../resort/restaurants-catalog.service.js';

import { OperationsToolRegistryService } from './operations-tool-registry.service.js';
import type { DispatchContext, DispatchResult } from './operations.types.js';
import type { RestaurantType } from './tool-inputs.js';

const MAX_LISTED = 10;

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

// Linha curta de uma lista: nome e a informação que ajuda a escolher.
function listLine(restaurant: RestaurantInfo, index: number): string {
  const facts = [
    restaurant.acceptsReservations ? 'reserva pelo app' : trimEnd(restaurant.openingHours ?? ''),
    restaurant.minimumAge ? `a partir de ${restaurant.minimumAge} anos` : '',
  ].filter(Boolean);

  return `${index + 1}. ${restaurant.name}${facts.length ? ` — ${facts.join('; ')}` : ''}`;
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
  constructor(private readonly registry: OperationsToolRegistryService) {}

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

    // Um nome, uma posição ou uma referência indicam um restaurante;
    // senão, a pergunta é sobre o catálogo.
    if (resolved && (decision.intent === 'restaurant.details' || !/\b(?:quais|lista|liste|opcoes|algum|alguns)\b/.test(normalizeText(message)))) {
      return this.details(resolved, context.state, state);
    }

    return this.list(message, all, context.state, state);
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
  ): DispatchResult {
    const type = requestedType(message);
    const shown = (type ? all.filter((restaurant) => restaurant.type === type) : all).slice(0, MAX_LISTED);
    const listed = shown.map(({ id, name }) => ({ id, name }));

    if (shown.length === 0) {
      return {
        tool: 'restaurants.list',
        reply: `Não encontrei ${type ? TYPE_LABELS[type].many : 'restaurantes'} ativos no cadastro do resort.`,
        resultCount: 0,
        state: this.state(conversation, { ...state, listed: [] }),
      };
    }

    // Os demais tipos são só citados, para não alongar a resposta.
    const others = type
      ? (Object.keys(TYPE_LABELS) as RestaurantType[])
          .filter((other) => other !== type)
          .map((other) => ({ other, count: all.filter((restaurant) => restaurant.type === other).length }))
          .filter(({ count }) => count > 0)
          .map(({ other, count }) => `${count} ${count === 1 ? TYPE_LABELS[other].one : TYPE_LABELS[other].many}`)
      : [];

    return {
      tool: 'restaurants.list',
      reply: [
        type ? `Estes são os ${TYPE_LABELS[type].many} do resort:` : 'Estas são as opções de gastronomia do resort:',
        ...shown.map(listLine),
        others.length ? `Também há ${others.join(' e ')}.` : '',
        'Quer saber mais sobre algum? É só dizer o nome ou o número.',
      ].filter(Boolean).join('\n'),
      actions: [gastronomyAction()],
      resultCount: shown.length,
      state: this.state(conversation, { ...state, listed, selectedId: undefined, selectedName: undefined }),
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
      actions: restaurant.acceptsReservations ? [gastronomyAction(restaurant.id)] : [],
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
          `Para reservar no ${restaurant.name}, é preciso selecionar os pratos no cardápio do restaurante pelo aplicativo.`,
          restaurant.reservationTimes.length
            ? `Horários de reserva cadastrados: ${restaurant.reservationTimes.join(', ')}.`
            : '',
          'Toque em "Abrir Gastronomia" para continuar. Eu não crio reservas de restaurante pelo chat.',
        ].filter(Boolean).join(' '),
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
