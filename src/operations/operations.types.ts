import type { ChatIntent } from '../chat/chat-intent.types.js';
import type { ChatAction } from '../contracts/chat-actions.js';
import type { ConversationState, PendingQuestion } from '../contracts/conversation-state.js';

import type { OperationToolName } from './operations-tool-registry.service.js';

export interface DispatchContext {
  conversationId: string;
  state: ConversationState;
}

export interface DispatchResult {
  tool: OperationToolName;
  reply: string;
  actions?: ChatAction[];
  // Novo estado da conversa, quando a operação o altera.
  state?: ConversationState;
  // Intenção efetivamente atendida, quando difere da classificada
  // (uma consulta de vagas sem experiência vira uma busca).
  intent?: ChatIntent;
  // Pergunta de sim/não feita nesta resposta. Toda pergunta assim
  // precisa ser registrada para que um "sim" tenha um destino.
  pendingQuestion?: PendingQuestion;
  // Quantidade de itens apresentados (somente para logs).
  resultCount?: number;
}

export const SNAPSHOT_NOTICE =
  'Observação: as vagas vêm do snapshot do sistema do resort e podem não refletir a disponibilidade em tempo real.';

export const SIMULATION_NOTICE =
  'Esta é uma reserva simulada para demonstração; ela não foi registrada no sistema oficial do resort.';
