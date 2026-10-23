
import type { MessageEntities } from './message-entities.js';

export type ChatIntent =
  | 'reservation.list'
  | 'reservation.details'
  | 'reservation.status'
  | 'request.list'
  | 'request.status'
  | 'restaurant.booking'
  | 'experience.list'
  | 'experience.details'
  | 'experience.availability'
  | 'experience.price'
  | 'experience.booking'
  | 'experience.booking.confirm'
  | 'experience.booking.cancel'
  | 'experience.reservations'
  | 'knowledge.search'
  | 'conversation.greeting'
  | 'conversation.general';

export type ExperienceIntent = Extract<ChatIntent, `experience.${string}`>;

// Interações sociais: não consultam o RAG nem ferramentas.
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
  // Entidades extraídas deterministicamente da mensagem.
  entities?: MessageEntities;
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
