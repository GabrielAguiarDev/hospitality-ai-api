
import type { MessageEntities } from './message-entities.js';

export type ChatIntent =
  | 'reservation.list'
  | 'reservation.details'
  | 'reservation.status'
  | 'request.list'
  | 'request.status'
  // Departamentos e itens que podem ser pedidos (tb_departamento/tb_itemdepartamento).
  | 'request.catalog'
  // Nova solicitação simulada: prepara o card; a gravação exige confirmação.
  | 'request.create'
  | 'request.confirm'
  | 'request.cancel'
  // Módulos informativos do app (somente leitura + navegação).
  | 'boutique.info'
  | 'spa.info'
  | 'tips.list'
  | 'quiz.info'
  | 'esg.info'
  | 'restaurant.booking'
  // Catálogo e detalhes de restaurantes e bares (sem reserva pelo chat).
  | 'restaurant.list'
  | 'restaurant.details'
  // Cardápio publicado de um restaurante (somente leitura).
  | 'restaurant.menu'
  // Meus Favoritos (lembretes de eventos) e pedidos para favoritar/remover,
  // que o chat ainda não executa: leva à tela de Eventos.
  | 'favorite.list'
  | 'favorite.manage'
  // Inscrição em atividade de lazer: exige ficha e termo no app (navegação).
  | 'leisure.enroll'
  // Eventos, shows e programação de lazer de uma data.
  | 'event.list'
  | 'experience.list'
  // Busca de vagas em várias experiências (data, período, filtros).
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
  // Clima, tempo real e fatos externos: sem fonte integrada.
  | 'conversation.external';

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
  // A mensagem refina a busca anterior ("E de manhã?"): os filtros
  // já preservados na conversa são combinados com os novos.
  refine?: boolean;
  // Referência contextual resolvida pelo servidor ("essa", "sim"):
  // ID vindo do estado da conversa, nunca do texto do modelo.
  target?: { kind: 'experience' | 'restaurant'; id: string; via: ContextReference };
  // "Sim" a uma pergunta pendente: executa a intenção registrada.
  answersPending?: boolean;
  // "Não" a uma pergunta pendente: nada é executado.
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
