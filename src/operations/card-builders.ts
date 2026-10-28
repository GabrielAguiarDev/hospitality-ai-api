import {
  messageButton,
  navigateButton,
  type BookingItem,
  type BookingListAction,
  type BookingStatus,
  type CatalogItem,
  type CatalogKind,
  type CatalogListAction,
  type MenuViewAction,
  type RequestListAction,
  type RequestListItem,
  type RequestStatus,
} from '../contracts/chat-actions.js';
import type { SimulatedExperienceBooking } from '../experiences/entities/simulated-experience-booking.entity.js';
import type { StayExperienceReservation } from '../experiences/experiences-catalog.service.js';
import type { LeisureEnrollment } from '../resort/leisure-enrollments.service.js';
import type { RestaurantMenu } from '../resort/restaurant-menus.service.js';
import type { RestaurantInfo } from '../resort/restaurants-catalog.service.js';

import type { RestaurantReservation } from './reservations.service.js';
import type { GuestRequest } from './requests.service.js';

/**
 * Montagem dos cards a partir do resultado das ferramentas. Nenhum campo
 * vem do texto do modelo: títulos, datas, status e IDs são do cadastro.
 */

const MAX_LIST_ITEMS = 20;
const MAX_DISHES_PER_CATEGORY = 5;

// "24/10/2026" ou "24/10/2026 20:00" → { date: "2026-10-24", time: "20:00" }.
export function fromBrazilianDate(value: string | null | undefined): { date: string | null; time: string | null } {
  const match = value?.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}:\d{2}))?/);
  return match ? { date: `${match[3]}-${match[2]}-${match[1]}`, time: match[4] ?? null } : { date: null, time: null };
}

// Pasta confirmada no app (`${EXPO_PUBLIC_BUCKET}/<pasta>/<arquivo>`); sem arquivo, sem imagem.
export function imagePath(folder: 'restaurant' | 'menu' | 'experience/logos' | 'spa' | 'tip', file: string | null | undefined): string | null {
  return file ? `${folder}/${file}` : null;
}

export function catalogList(kind: CatalogKind, label: string, items: Omit<CatalogItem, 'position'>[]): CatalogListAction[] {
  if (items.length === 0) return [];
  return [{ type: 'catalog.list', label, kind, items: items.slice(0, MAX_LIST_ITEMS).map((item, index) => ({ ...item, position: index + 1 })) }];
}

/** Botão "Opção N": o app envia a mensagem e o servidor resolve a posição. */
export function optionButton(position: number, label = 'Ver detalhes') {
  return messageButton(label, `Opção ${position}`);
}

export function menuView(restaurant: RestaurantInfo, menu: RestaurantMenu): MenuViewAction[] {
  if (menu.categories.length === 0) return [];

  return [
    {
      type: 'menu.view',
      label: `Cardápio: ${restaurant.name}`.slice(0, 60),
      restaurantId: String(restaurant.id),
      restaurantName: restaurant.name,
      totalDishes: menu.categories.reduce((total, { dishes }) => total + dishes.length, 0),
      categories: menu.categories.slice(0, 20).map((category) => ({
        id: category.id,
        name: category.name,
        dishes: category.dishes.slice(0, MAX_DISHES_PER_CATEGORY).map((dish) => ({
          id: dish.id,
          name: dish.name,
          description: dish.description,
          serves: dish.serves,
          imagePath: imagePath('menu', dish.image),
        })),
        moreDishes: Math.max(0, category.dishes.length - MAX_DISHES_PER_CATEGORY),
      })),
      buttons: [
        navigateButton('Restaurant', 'Abrir no app', { restaurantId: String(restaurant.id) }),
        ...(restaurant.acceptsReservations ? [navigateButton('Gastronomy', 'Reservar', { restaurantId: String(restaurant.id) })] : []),
      ],
    },
  ];
}

const RESTAURANT_STATUS: Record<string, [BookingStatus, string]> = {
  aprovada: ['confirmed', 'Confirmada'],
  cancelada: ['cancelled', 'Cancelada'],
};

// R-EXP-15: "pago" é exibido como confirmada.
const EXPERIENCE_STATUS: Record<string, [BookingStatus, string]> = {
  pago: ['confirmed', 'Confirmada'],
  pendente: ['pending', 'Pendente'],
  cancelado: ['cancelled', 'Cancelada'],
};

function bookingStatus(table: Record<string, [BookingStatus, string]>, raw: string): [BookingStatus, string] {
  return table[raw.trim().toLowerCase()] ?? ['unknown', 'Status não informado'];
}

export interface BookingSources {
  restaurants: RestaurantReservation[];
  experiences: StayExperienceReservation[];
  simulated: SimulatedExperienceBooking[];
}

/** Reservas da estadia em ordem cronológica, cada uma com identidade estável. */
export function bookingItems({ restaurants, experiences, simulated }: BookingSources): BookingItem[] {
  const items: BookingItem[] = [
    ...restaurants.flatMap((reservation): BookingItem[] => {
      const { date } = fromBrazilianDate(reservation.date);
      if (!date) return [];
      const [status, statusLabel] = bookingStatus(RESTAURANT_STATUS, reservation.status);
      return [
        {
          bookingId: String(reservation.id),
          kind: 'restaurant',
          title: reservation.restaurant,
          date,
          time: reservation.time,
          status,
          statusLabel,
          people: reservation.partySize,
          simulated: false,
          confirmationCode: null,
          buttons: [navigateButton('MyReservation', 'Ver em Minhas Reservas', { tab: 'Gastronomy' })],
        },
      ];
    }),
    ...experiences.map((reservation): BookingItem => {
      const [status, statusLabel] = bookingStatus(EXPERIENCE_STATUS, reservation.status);
      return {
        bookingId: String(reservation.id),
        kind: 'experience',
        title: reservation.title,
        date: reservation.date,
        time: reservation.time,
        status,
        statusLabel,
        people: reservation.participants > 0 ? reservation.participants : null,
        simulated: false,
        confirmationCode: null,
        buttons: [navigateButton('MyReservation', 'Ver em Minhas Reservas', { tab: 'Experience' })],
      };
    }),
    // Simuladas: não existem no app oficial, então não há tela para abrir.
    ...simulated.map((booking): BookingItem => ({
      bookingId: booking.id,
      kind: 'experience',
      title: booking.experienceTitle,
      date: booking.bookingDate,
      time: booking.bookingTime,
      status: booking.status === 'confirmed' ? 'confirmed' : 'cancelled',
      statusLabel: booking.status === 'confirmed' ? 'Simulada (não oficial)' : 'Simulação cancelada',
      people: booking.adults + booking.children || null,
      simulated: true,
      confirmationCode: booking.confirmationCode,
      buttons: [],
    })),
  ];

  return items.sort((a, b) => `${a.date} ${a.time ?? '99:99'}`.localeCompare(`${b.date} ${b.time ?? '99:99'}`));
}

export function bookingList(label: string, items: BookingItem[]): BookingListAction[] {
  return items.length ? [{ type: 'booking.list', label, items: items.slice(0, 30) }] : [];
}

const DEPARTMENT_STATUS: Record<string, [RequestStatus, string]> = {
  pendente: ['pending', 'Pendente'],
  executando: ['in_progress', 'Em andamento'],
  atendida: ['done', 'Atendida'],
  cancelada: ['cancelled', 'Cancelada'],
  simulada: ['simulated', 'Simulada (não enviada)'],
};

// R-LAZ-06: "negado" é tanto a recusa do resort quanto o cancelamento do hóspede.
const LEISURE_STATUS: Record<string, [RequestStatus, string]> = {
  pendente: ['pending', 'Pendente'],
  aprovado: ['approved', 'Aprovada'],
  negado: ['denied', 'Negada ou cancelada'],
};

/** Minhas Solicitações: departamentos (oficiais e simuladas) e inscrições de lazer. */
export function requestItems(requests: GuestRequest[], enrollments: LeisureEnrollment[]): RequestListItem[] {
  return [
    ...requests.map((request): RequestListItem => {
      const [status, statusLabel] = DEPARTMENT_STATUS[request.status.toLowerCase()] ?? ['unknown', 'Status não informado'];
      const { date, time } = fromBrazilianDate(request.createdAt);
      return {
        requestId: String(request.id),
        kind: 'department',
        title: request.category,
        // "Itens não informados" é o texto do serviço quando o cadastro não traz itens.
        items: (request.description === 'Itens não informados' ? '' : request.description)
          .split(';')
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 10)
          .map((item) => item.slice(0, 160)),
        status,
        statusLabel,
        date,
        time,
        simulated: request.simulated === true,
        protocol: request.protocol ?? null,
        buttons: request.simulated ? [] : [navigateButton('MyRequests', 'Ver em Minhas Solicitações')],
      };
    }),
    ...enrollments.map((enrollment): RequestListItem => {
      const [status, statusLabel] = LEISURE_STATUS[enrollment.status.toLowerCase()] ?? ['unknown', 'Status não informado'];
      return {
        requestId: enrollment.id,
        kind: 'leisure',
        title: enrollment.title,
        items: enrollment.category && enrollment.category !== enrollment.title ? [enrollment.category] : [],
        status,
        statusLabel,
        date: enrollment.date,
        time: null,
        simulated: false,
        protocol: null,
        buttons: [navigateButton('MyRequests', 'Ver em Minhas Solicitações')],
      };
    }),
  ];
}

export function requestList(label: string, items: RequestListItem[]): RequestListAction[] {
  return items.length ? [{ type: 'request.list', label, items: items.slice(0, 30) }] : [];
}
