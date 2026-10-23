
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { LlmModule } from '../llm/llm.module.js';
import { RagModule } from '../rag/rag.module.js';
import { OperationsModule } from '../operations/operations.module.js';

import { ChatController } from './chat.controller.js';
import { ChatService } from './chat.service.js';
import { ChatOrchestratorService } from './chat-orchestrator.service.js';
import { IntentClassifierService } from './intent-classifier.service.js';

import { ChatActionsService } from './chat-actions.service.js';
import { ChatConversation } from './entities/chat-conversation.entity.js';
import { ChatConversationState } from './entities/chat-conversation-state.entity.js';
import { ChatMessage } from './entities/chat-message.entity.js';
import { GuestContextModule } from '../guest/guest-context.module.js';
import { ResortModule } from '../resort/resort.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ChatConversation,
      ChatMessage,
      ChatConversationState,
    ]),
    LlmModule,
    RagModule,
    OperationsModule,
    GuestContextModule,
    ResortModule,
  ],
  controllers: [ChatController],
  providers: [
    ChatService,
    ChatOrchestratorService,
    IntentClassifierService,
    ChatActionsService,
  ],
})
export class ChatModule {}
