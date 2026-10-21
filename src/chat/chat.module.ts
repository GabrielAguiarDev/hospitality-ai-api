
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { LlmModule } from '../llm/llm.module.js';
import { ChatController } from './chat.controller.js';
import { ChatService } from './chat.service.js';
import { ChatConversation } from './entities/chat-conversation.entity.js';
import { ChatMessage } from './entities/chat-message.entity.js';
import { RagModule } from '../rag/rag.module.js';

@Module({
  imports: [
    LlmModule,
    RagModule,
    TypeOrmModule.forFeature([
      ChatConversation,
      ChatMessage,
    ]),
  ],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
