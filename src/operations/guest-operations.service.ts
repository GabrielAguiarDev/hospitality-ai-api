import { Injectable, InternalServerErrorException } from '@nestjs/common';

import type { IntentDecision } from '../chat/chat-intent.types.js';
import { extractDate } from '../chat/message-entities.js';
import { nameList, normalizeText } from '../common/text.js';
import { navigateAction, navigateButton, type BookingItem, type ChatAction } from '../contracts/chat-actions.js';
import type { ConversationState } from '../contracts/conversation-state.js';
import type { GuestContext } from '../guest/guest-context.js';
import { ResortClock } from '../resort/resort-clock.service.js';

import { bookingItems, bookingList, catalogList, optionButton } from './card-builders.js';
import { formatRestaurantReservations } from './operations-ai.service.js';
import { OperationsToolRegistryService, type OperationToolName, type OperationToolResult } from './operations-tool-registry.service.js';
import type { DispatchContext, DispatchResult } from './operations.types.js';

type ToolData<N extends OperationToolName> = Extract<OperationToolResult, { tool: N }>['data'];

const RESTAURANT_CUE = /\b(?:gastronomic[ao]s?|restaurantes?|jantar|almoco|mesa)\b/;
const EXPERIENCE_CUE = /\b(?:experiencias?|passeios?|atividades?)\b/;
const NEXT_CUE = /\bproxim[ao]s?\b/;

const MAX_NAMED = 3;

/**
 * Dados pessoais da estadia: Minhas Reservas (restaurantes e experiências)
 * e Meus Favoritos. Somente leitura; a estadia vem sempre do servidor.
 */
@Injectable()
export class GuestOperationsService {
  constructor(
    private readonly registry: OperationsToolRegistryService,
    private readonly clock: ResortClock,
  ) {}

  private async execute<N extends OperationToolName>(name: N, guest: GuestContext): Promise<ToolData<N>> {
    const result = await this.registry.execute(name, guest, {});

    if (result.tool !== name) {
      throw new InternalServerErrorException('Resultado inesperado da ferramenta.');
    }

    return result.data as ToolData<N>;
  }

  private when(item: Pick<BookingItem, 'date' | 'time'>): string {
    const today = this.clock.today();
    const day =
      item.date === today
        ? 'hoje'
        : item.date === ResortClock.addDays(today, 1)
          ? 'amanhã'
          : `${ResortClock.weekdayLabel(item.date)}, ${ResortClock.formatDate(item.date).slice(0, 5)}`;
    return item.time ? `${day} às ${item.time}` : day;
  }

  /**
   * "Tenho alguma reserva amanhã?", "Qual minha próxima reserva?",
   * "Mostre minhas reservas gastronômicas".
   */
  async bookings(message: string, decision: IntentDecision, guest: GuestContext, context?: DispatchContext): Promise<DispatchResult> {
    const [restaurants, experiences] = await Promise.all([
      this.execute('reservations.list', guest),
      this.execute('experiences.reservations', guest),
    ]);
    const all = bookingItems({ restaurants, experiences: experiences.official, simulated: experiences.simulated });

    const text = normalizeText(message);
    const kind = RESTAURANT_CUE.test(text) && !EXPERIENCE_CUE.test(text)
      ? 'restaurant'
      : EXPERIENCE_CUE.test(text) && !RESTAURANT_CUE.test(text)
        ? 'experience'
        : null;
    const date = decision.entities?.date ?? extractDate(message, this.clock.today());
    const next = NEXT_CUE.test(text);
    const state: ConversationState | undefined = context ? { ...context.state, topic: 'reservation' } : undefined;
    const tab = kind === 'experience' ? 'Experience' : 'Gastronomy';
    const screen = navigateAction('MyReservation', 'Abrir Minhas Reservas', { tab });

    // Sem filtro e só restaurantes: o texto de sempre, que as perguntas
    // seguintes ("E para quantas pessoas?") continuam reconhecendo.
    if (!kind && !date && !next && experiences.official.length === 0 && experiences.simulated.length === 0) {
      return {
        tool: 'reservations.list',
        reply: formatRestaurantReservations(restaurants, { intent: 'reservation.list', detail: 'none' }, message),
        actions: [...bookingList('Minhas reservas', all), ...(all.length ? [screen] : [])],
        resultCount: all.length,
        ...(state ? { state } : {}),
      };
    }

    const now = `${this.clock.today()} ${this.clock.time()}`;
    const scoped = all.filter((item) => (!kind || item.kind === kind) && (!date || item.date === date));
    const selected = next
      ? scoped.filter((item) => item.status !== 'cancelled' && `${item.date} ${item.time ?? '23:59'}` >= now).slice(0, 1)
      : scoped;
    const noun = kind === 'restaurant' ? 'reserva de restaurante' : kind === 'experience' ? 'reserva de experiência' : 'reserva';
    const nouns = kind === 'restaurant' ? 'reservas de restaurante' : kind === 'experience' ? 'reservas de experiências' : 'reservas';
    const period = date ? ` para ${this.when({ date, time: null })}` : '';
    const describe = (item: BookingItem) => `${item.title} (${this.when(item)})`;
    const simulatedNote = selected.some(({ simulated }) => simulated)
      ? 'As simuladas foram feitas pelo chat e não estão no sistema oficial do resort.'
      : '';

    let reply: string;

    if (selected.length === 0) {
      reply = next ? `Você não tem ${nouns} futuras nesta estadia.` : `Não encontrei ${nouns}${period} nesta estadia.`;
    } else if (next) {
      const [item] = selected;
      reply = `Sua próxima ${noun}: ${describe(item)}, ${item.statusLabel.toLowerCase()}.`;
    } else {
      reply =
        `${date ? 'Sim, você' : 'Você'} tem ${selected.length} ${selected.length === 1 ? noun : nouns}${period}: ` +
        `${nameList(selected.map(describe), MAX_NAMED)}.`;
    }

    return {
      tool: kind === 'experience' ? 'experiences.reservations' : 'reservations.list',
      reply: [reply, simulatedNote].filter(Boolean).join(' '),
      actions: [...bookingList(next ? 'Próxima reserva' : 'Minhas reservas', selected), screen],
      resultCount: selected.length,
      ...(state ? { state } : {}),
    };
  }

  async favorites(message: string, decision: IntentDecision, guest: GuestContext, context?: DispatchContext): Promise<DispatchResult> {
    const conversation = context?.state ?? {};
    const events = navigateAction('Events', 'Abrir Eventos');

    // Favoritar e remover acontecem na tela: o lembrete é agendado pelo app (G6).
    if (decision.intent === 'favorite.manage') {
      return {
        tool: 'favorites.list',
        reply:
          'Pelo chat ainda não consigo favoritar nem remover favoritos. ' +
          'Na tela de Eventos, toque na estrela do evento: o app agenda o lembrete 1 hora antes.',
        actions: [events, navigateAction('MyFavorites', 'Abrir Meus Favoritos')],
        state: { ...conversation, topic: 'event' },
      };
    }

    const favorites = await this.execute('favorites.list', guest);
    const today = this.clock.today();
    const upcoming = favorites.filter((favorite) => favorite.date >= today);
    const listed = upcoming.length ? upcoming : favorites;
    if (favorites.length === 0) {
      return {
        tool: 'favorites.list',
        reply: 'Você ainda não tem eventos favoritos. Na tela de Eventos, toque na estrela para receber um lembrete.',
        actions: [events],
        resultCount: 0,
        state: { ...conversation, topic: 'event' },
      };
    }

    // A posição se refere à lista que o hóspede viu (IDs guardados), não a uma recalculada.
    const ordinal = decision.entities?.ordinal;
    const seen = conversation.lastIntent === 'favorite.list' && conversation.catalog?.kind === 'event' ? conversation.catalog.listed : undefined;
    const reference = ordinal !== undefined && seen?.length ? seen[ordinal === -1 ? seen.length - 1 : ordinal - 1] : undefined;
    const chosen = reference ? favorites.find(({ eventId }) => eventId === reference.id) : undefined;
    const shown = chosen ? [chosen] : listed;
    const state: ConversationState = {
      ...conversation,
      topic: 'event',
      // Um item escolhido não substitui a lista que o hóspede tem na tela.
      catalog: chosen && seen ? { kind: 'event', listed: seen } : { kind: 'event', listed: listed.slice(0, 20).map(({ eventId, title }) => ({ id: eventId, title })) },
    };

    const describe = ({ title, date, time }: (typeof favorites)[number]) => `${title} (${this.when({ date, time })})`;

    return {
      tool: 'favorites.list',
      reply: chosen
        ? `${chosen.title}: ${this.when(chosen)}${chosen.location ? `, em ${chosen.location}` : ''}.`
        : upcoming.length
          ? `Você tem ${upcoming.length} ${upcoming.length === 1 ? 'evento favorito' : 'eventos favoritos'} pela frente: ${nameList(upcoming.map(describe), MAX_NAMED)}.`
          : `Seus ${favorites.length === 1 ? 'favorito já aconteceu' : `${favorites.length} favoritos já aconteceram`} nesta estadia.`,
      actions: [
        ...catalogList(
          'event',
          'Seus favoritos',
          shown.map((favorite) => ({
            id: favorite.eventId,
            title: favorite.title,
            description: null,
            imagePath: null,
            meta: { date: favorite.date, ...(favorite.time ? { time: favorite.time } : {}), ...(favorite.location ? { location: favorite.location } : {}) },
            badges: ['Favorito'],
            buttons: [
              ...(chosen ? [] : [optionButton(listed.indexOf(favorite) + 1)]),
              navigateButton('Events', 'Ver em Eventos', { date: favorite.date }),
            ],
          })),
        ),
        navigateAction('MyFavorites', 'Abrir Meus Favoritos'),
      ] satisfies ChatAction[],
      resultCount: shown.length,
      state,
    };
  }
}
