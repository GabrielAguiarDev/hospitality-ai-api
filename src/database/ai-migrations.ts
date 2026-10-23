import { BaselineChat1792771200000 } from './migrations/1792771200000-BaselineChat.js';
import { ConversationState1792771200001 } from './migrations/1792771200001-ConversationState.js';
import { ExperienceBookings1792771200002 } from './migrations/1792771200002-ExperienceBookings.js';

// Migrations do banco interno da IA (yago_ai_local).
// Nunca registre migrations na conexão "resort".
export const AI_MIGRATIONS = [
  BaselineChat1792771200000,
  ConversationState1792771200001,
  ExperienceBookings1792771200002,
];

export const AI_MIGRATIONS_TABLE = 'ai_migrations';
