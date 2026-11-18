
import type { MessageEntities } from './message-entities.js';

export type ChatIntent =
  | 'reservation.list'
  | 'reservation.details'
  | 'reservation.status'
  | 'request.list'
  | 'request.status'
  | 'request.catalog'
  | 'request.create'
  | 'request.confirm'
  | 'request.cancel'
  | 'boutique.info'
  | 'spa.info'
  | 'tips.list'
  | 'quiz.info'
  | 'esg.info'
  | 'restaurant.booking'
  | 'restaurant.list'
  | 'restaurant.details'
  | 'restaurant.menu'
  | 'favorite.list'
  | 'favorite.manage'
  | 'leisure.enroll'
  | 'event.list'
  | 'experience.list'
  | 'experience.search'
  | 'experience.details'
  | 'experience.availability'
  | 'experience.price'
  | 'experience.booking'
  | 'experience.booking.confirm'
  | 'experience.booking.cancel'
  | 'experience.reservations'
  | 'knowledge.search'
  | 'conversation.greeting'
  | 'conversation.general'
  | 'conversation.external';

export type ExperienceIntent = Extract<ChatIntent, `experience.${string}`>;

export type ConversationIntent = Extract<ChatIntent, `conversation.${string}`>;

export type ReservationDetail =
  | 'party_size'
  | 'date'
  | 'time'
  | 'restaurant'
  | 'none';

export interface IntentDecision {
  intent: ChatIntent;
  detail: ReservationDetail;
  entities?: MessageEntities;
  refine?: boolean;
  target?: { kind: 'experience' | 'restaurant'; id: string; via: ContextReference };
  answersPending?: boolean;
  declinesPending?: boolean;
}

export type ContextReference = 'pending_question' | 'demonstrative' | 'single_listed' | 'selected';

export type RestaurantIntent = Extract<ChatIntent, `restaurant.${string}`>;

export function isRestaurantIntent(intent: ChatIntent): intent is RestaurantIntent {
  return intent.startsWith('restaurant.');
}

export interface HistoryEntry {
  role: 'user' | 'assistant';
  content: string;
}

export function isExperienceIntent(intent: ChatIntent): intent is ExperienceIntent {
  return intent.startsWith('experience.');
}

export function isConversationIntent(intent: ChatIntent): intent is ConversationIntent {
  return intent.startsWith('conversation.');
}

export type RequestIntent = Extract<ChatIntent, `request.${string}`>;

export function isRequestIntent(intent: ChatIntent): intent is RequestIntent {
  return intent.startsWith('request.');
}

export type ModuleIntent = Extract<ChatIntent, 'boutique.info' | 'spa.info' | 'tips.list' | 'quiz.info' | 'esg.info'>;

export const MODULE_INTENTS: readonly ModuleIntent[] = ['boutique.info', 'spa.info', 'tips.list', 'quiz.info', 'esg.info'];

export function isModuleIntent(intent: ChatIntent): intent is ModuleIntent {
  return (MODULE_INTENTS as readonly ChatIntent[]).includes(intent);
}
