import type { ChatAction } from '../contracts/chat-actions.js';
import type { ConversationState } from '../contracts/conversation-state.js';

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
}

export const SNAPSHOT_NOTICE =
  'Observação: as vagas vêm do snapshot do sistema do resort e podem não refletir a disponibilidade em tempo real.';

export const SIMULATION_NOTICE =
  'Esta é uma reserva simulada para demonstração; ela não foi registrada no sistema oficial do resort.';
