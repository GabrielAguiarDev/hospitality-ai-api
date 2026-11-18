import type { ChatIntent } from '../chat/chat-intent.types.js';

export type DayPeriod = 'morning' | 'afternoon' | 'evening';

export interface ExperienceSearchFilters {
  period?: DayPeriod;
  after?: string;
  before?: string;
  free?: boolean;
  forChildren?: boolean;
  bookable?: boolean;
}

export interface ExperienceConversationState {
  listed?: { id: string; title: string }[];
  listedDate?: string | null;
  selectedId?: string;
  selectedTitle?: string;
  date?: string;
  time?: string | null;
  adults?: number;
  children?: number;
  partyAssumed?: boolean;
  filters?: ExperienceSearchFilters;
  describedId?: string;
  snapshotNoticeShown?: boolean;
  pendingPreviewId?: string;
  awaiting?: 'booking';
}

export interface RestaurantConversationState {
  listed?: { id: string; name: string }[];
  selectedId?: string;
  selectedName?: string;
  describedId?: string;
  filters?: RestaurantSearchFilters;
  awaiting?: 'menu';
}

export interface RestaurantSearchFilters {
  type?: 'restaurante' | 'bar' | 'alimentacao';
  cuisine?: string;
  reservations?: boolean;
}

export interface EventConversationState {
  date?: string;
  filters?: Pick<ExperienceSearchFilters, 'period' | 'after' | 'before'>;
  kind?: 'event' | 'leisure';
  audience?: 'kids' | 'teens' | 'adults' | 'sports';
}

export interface RequestConversationState {
  pendingPreviewId?: string;
  departmentId?: string;
  lastRequestId?: string;
}

export interface CatalogConversationState {
  kind: 'spa_service' | 'product' | 'tip' | 'esg' | 'quiz' | 'event';
  listed: { id: string; title: string }[];
}

export interface PendingQuestion {
  intent: ChatIntent;
  targetId?: string;
}

export type ConversationPhase =
  | 'conversation'
  | 'knowledge'
  | 'operation'
  | 'awaiting_confirmation'
  | 'completed';

export interface ConversationState {
  phase?: ConversationPhase;
  topic?: 'experience' | 'restaurant' | 'event' | 'reservation' | 'request' | 'module' | 'knowledge';
  lastIntent?: ChatIntent;
  pendingQuestion?: PendingQuestion;
  experience?: ExperienceConversationState;
  restaurant?: RestaurantConversationState;
  event?: EventConversationState;
  request?: RequestConversationState;
  catalog?: CatalogConversationState;
}

export type PendingConfirmation = { kind: 'experience' | 'request'; id: string };

export function pendingConfirmation(state: ConversationState | undefined): PendingConfirmation | null {
  if (state?.request?.pendingPreviewId) return { kind: 'request', id: state.request.pendingPreviewId };
  if (state?.experience?.pendingPreviewId) return { kind: 'experience', id: state.experience.pendingPreviewId };
  return null;
}

export function withoutPendingConfirmation(state: ConversationState): ConversationState {
  return {
    ...state,
    ...(state.experience ? { experience: { ...state.experience, pendingPreviewId: undefined } } : {}),
    ...(state.request ? { request: { ...state.request, pendingPreviewId: undefined } } : {}),
  };
}

export const EMPTY_CONVERSATION_STATE: Readonly<ConversationState> =
  Object.freeze({});
