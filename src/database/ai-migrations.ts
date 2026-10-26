import { BaselineChat1792771200000 } from './migrations/1792771200000-BaselineChat.js';
import { ConversationState1792771200001 } from './migrations/1792771200001-ConversationState.js';
import { ExperienceBookings1792771200002 } from './migrations/1792771200002-ExperienceBookings.js';
import { ConversationStateOwner1792771200003 } from './migrations/1792771200003-ConversationStateOwner.js';
import { BookingCards1792771200004 } from './migrations/1792771200004-BookingCards.js';
import { SimulatedGuestRequests1792771200005 } from './migrations/1792771200005-SimulatedGuestRequests.js';

// Migrations do banco interno da IA (yago_ai_local).
// Nunca registre migrations na conexão "resort".
export const AI_MIGRATIONS = [
  BaselineChat1792771200000,
  ConversationState1792771200001,
  ExperienceBookings1792771200002,
  ConversationStateOwner1792771200003,
  BookingCards1792771200004,
  SimulatedGuestRequests1792771200005,
];

export const AI_MIGRATIONS_TABLE = 'ai_migrations';
