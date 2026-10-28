import type { ChatIntent, ConversationIntent } from '../chat/chat-intent.types.js';

import type { OperationToolName } from './operations-tool-registry.service.js';

export type OperationalIntent = Exclude<ChatIntent, 'knowledge.search' | ConversationIntent>;

// Mapeamento centralizado entre intenções e ferramentas.
export const INTENT_TOOL_MAP = {
  'reservation.list': 'reservations.list',
  'reservation.details': 'reservations.list',
  'reservation.status': 'reservations.list',

  'request.list': 'requests.list',
  'request.status': 'requests.list',
  'request.catalog': 'requests.catalog',
  'request.create': 'requests.preview',
  'request.confirm': 'requests.confirm',
  'request.cancel': 'requests.cancel',

  'restaurant.booking': 'restaurants.list',
  'restaurant.list': 'restaurants.list',
  'restaurant.details': 'restaurants.list',
  'restaurant.menu': 'restaurants.menu',

  'favorite.list': 'favorites.list',
  // Sem escrita: confere os favoritos e leva à tela de Eventos.
  'favorite.manage': 'favorites.list',

  // Sem escrita: a inscrição é feita na tela de Lazer.
  'leisure.enroll': 'leisure.enrollments',

  'event.list': 'events.list',

  'boutique.info': 'boutique.list',
  'spa.info': 'spa.list',
  'tips.list': 'tips.list',
  'quiz.info': 'quiz.list',
  'esg.info': 'esg.info',

  'experience.list': 'experiences.list',
  // A busca usa a mesma ferramenta, com filtros opcionais.
  'experience.search': 'experiences.list',
  'experience.details': 'experiences.details',
  'experience.availability': 'experiences.availability',
  'experience.price': 'experiences.details',
  'experience.booking': 'experiences.booking.preview',
  'experience.booking.confirm': 'experiences.booking.confirm',
  'experience.booking.cancel': 'experiences.booking.cancel',
  'experience.reservations': 'experiences.reservations',
} as const satisfies Record<OperationalIntent, OperationToolName>;
