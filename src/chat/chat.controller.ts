
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';

import { CurrentGuest } from '../guest/current-guest.decorator.js';
import { DemoGuestGuard } from '../guest/demo-guest.guard.js';
import type { GuestContext } from '../guest/guest-context.js';

import { ChatService } from './chat.service.js';
import { SendMessageDto } from './dto/send-message.dto.js';

@Controller('chat')
@UseGuards(DemoGuestGuard)
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
  ) {}

  @Post()
  sendMessage(
    @Body() dto: SendMessageDto,
    @CurrentGuest() guest: GuestContext,
  ) {
    return this.chatService.sendMessage(
      dto.message,
      guest,
      dto.conversationId,
    );
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
