
export type ChatIntent =
  | 'reservation.list'
  | 'reservation.details'
  | 'reservation.status'
  | 'request.list'
  | 'request.status'
  | 'knowledge.search';

export type ReservationDetail =
  | 'party_size'
  | 'date'
  | 'time'
  | 'restaurant'
  | 'none';

export interface IntentDecision {
  intent: ChatIntent;
  detail: ReservationDetail;
}

export interface HistoryEntry {
  role: 'user' | 'assistant';
  content: string;
}
