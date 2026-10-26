import type { ChatIntent } from '../chat/chat-intent.types.js';

// Períodos do dia citados pelo hóspede ("de manhã", "à tarde", "à noite").
export type DayPeriod = 'morning' | 'afternoon' | 'evening';

/**
 * Filtros de uma busca de experiências, preservados entre mensagens
 * para que "E de manhã?" refine a consulta anterior. A data da busca
 * fica em `ExperienceConversationState.date`.
 */
export interface ExperienceSearchFilters {
  period?: DayPeriod;
  // Faixa de horário (HH:MM): "depois das 15h", "antes das 10h".
  after?: string;
  before?: string;
  // Sem cobrança cadastrada (all inclusive).
  free?: boolean;
  // Com indício de participação de crianças no cadastro.
  forChildren?: boolean;
  // Somente experiências que aceitam reserva.
  bookable?: boolean;
}

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
  filters?: ExperienceSearchFilters;
  // Experiência cuja descrição já foi apresentada (evita repeti-la).
  describedId?: string;
  pendingPreviewId?: string;
}

export interface RestaurantConversationState {
  // Última lista apresentada, na ordem exibida.
  listed?: { id: string; name: string }[];
  selectedId?: string;
  selectedName?: string;
  describedId?: string;
}

/**
 * Pergunta feita pelo Yago e ainda sem resposta ("Quer que eu verifique
 * os horários disponíveis?"). Um "sim" executa `intent` sobre `targetId`.
 * Nunca representa a confirmação de uma reserva: essa usa pendingPreviewId.
 */
export interface PendingQuestion {
  intent: ChatIntent;
  targetId?: string;
}

export interface ConversationState {
  topic?: 'experience' | 'restaurant' | 'reservation' | 'request' | 'knowledge';
  // Última intenção operacional ou de conhecimento (interações sociais não contam).
  lastIntent?: ChatIntent;
  pendingQuestion?: PendingQuestion;
  experience?: ExperienceConversationState;
  restaurant?: RestaurantConversationState;
}

export const EMPTY_CONVERSATION_STATE: Readonly<ConversationState> =
  Object.freeze({});
