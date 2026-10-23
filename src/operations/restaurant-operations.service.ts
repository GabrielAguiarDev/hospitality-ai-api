import { Injectable, InternalServerErrorException } from '@nestjs/common';

import { matchByName } from '../common/text.js';
import type { NavigateAction } from '../contracts/chat-actions.js';
import type { GuestContext } from '../guest/guest-context.js';
import type { RestaurantInfo } from '../resort/restaurants-catalog.service.js';

import { OperationsToolRegistryService } from './operations-tool-registry.service.js';
import type { DispatchResult } from './operations.types.js';

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

    return matchByName(message, result.data);
  }

  async handleBooking(message: string, guest: GuestContext): Promise<DispatchResult> {
    const result = await this.registry.execute('restaurants.list', guest);

    if (result.tool !== 'restaurants.list') {
      throw new InternalServerErrorException('Resultado inesperado da ferramenta.');
    }

    const restaurants = result.data;
    const matches = matchByName(message, restaurants);
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
