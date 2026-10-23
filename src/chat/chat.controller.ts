
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';

import { CurrentGuest } from '../guest/current-guest.decorator.js';
import { DemoGuestGuard } from '../guest/demo-guest.guard.js';
import type { GuestContext } from '../guest/guest-context.js';

import type { ChatResponse } from '../contracts/chat-actions.js';

import { ChatActionsService, type ChatActionResponse } from './chat-actions.service.js';
import { ChatService } from './chat.service.js';
import { ChatActionDto } from './dto/chat-action.dto.js';
import { SendMessageDto } from './dto/send-message.dto.js';

@Controller('chat')
@UseGuards(DemoGuestGuard)
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly chatActionsService: ChatActionsService,
  ) {}

  @Post()
  sendMessage(
    @Body() dto: SendMessageDto,
    @CurrentGuest() guest: GuestContext,
  ): Promise<ChatResponse> {
    return this.chatService.sendMessage(
      dto.message,
      guest,
      dto.conversationId,
    );
  }

  // Executa uma ação estruturada a partir de dados persistidos no servidor.
  @Post('actions')
  @HttpCode(200)
  executeAction(
    @Body() dto: ChatActionDto,
    @CurrentGuest() guest: GuestContext,
  ): Promise<ChatActionResponse> {
    return this.chatActionsService.execute(dto, guest);
  }

  @Get(':conversationId/messages')
  getMessages(
    @Param(
      'conversationId',
      new ParseUUIDPipe({ version: '4' }),
    )
    conversationId: string,
    @CurrentGuest() guest: GuestContext,
  ) {
    return this.chatService.getMessages(
      conversationId,
      guest,
    );
  }
}
