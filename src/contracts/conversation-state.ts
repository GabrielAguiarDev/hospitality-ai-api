/**
 * Estado operacional de uma conversa, persistido no banco da IA.
 *
 * Todos os identificadores vêm de consultas do servidor, nunca
 * de texto gerado pelo modelo ou enviado pelo cliente.
 */
export interface ExperienceConversationState {
  // Última lista apresentada, na ordem exibida ("a segunda").
  listed?: { id: string; title: string }[];
  listedDate?: string | null;
  selectedId?: string;
  selectedTitle?: string;
  date?: string;
  time?: string | null;
  adults?: number;
  children?: number;
  // A divisão adultos/crianças foi presumida ("2 pessoas").
  partyAssumed?: boolean;
  pendingPreviewId?: string;
}

export interface ConversationState {
  topic?: 'experience' | 'restaurant' | 'reservation' | 'request' | 'knowledge';
  experience?: ExperienceConversationState;
}

export const EMPTY_CONVERSATION_STATE: Readonly<ConversationState> =
  Object.freeze({});
