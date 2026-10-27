
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';

import { CurrentGuest } from '../guest/current-guest.decorator.js';
import { DemoGuestGuard } from '../guest/demo-guest.guard.js';
import type { GuestContext } from '../guest/guest-context.js';

import type { ChatResponse } from '../contracts/chat-actions.js';

import { ChatActionsService, type ChatActionResponse } from './chat-actions.service.js';
import { ChatService } from './chat.service.js';
import { ChatVoiceService } from './chat-voice.service.js';
import { ChatActionDto } from './dto/chat-action.dto.js';
import { ChatVoiceDto } from './dto/chat-voice.dto.js';
import { SendMessageDto } from './dto/send-message.dto.js';

@Controller('chat')
@UseGuards(DemoGuestGuard)
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly chatActionsService: ChatActionsService,
    private readonly chatVoiceService: ChatVoiceService,
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

  @Post('actions')
  @HttpCode(200)
  executeAction(
    @Body() dto: ChatActionDto,
    @CurrentGuest() guest: GuestContext,
  ): Promise<ChatActionResponse> {
    return this.chatActionsService.execute(dto, guest);
  }

  // Narração (WAV) de uma resposta já persistida do assistente.
  @Post('voice')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async voice(
    @Body() dto: ChatVoiceDto,
    @CurrentGuest() guest: GuestContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const { audio, cached } = await this.chatVoiceService.narrate(
      dto.conversationId,
      dto.messageId,
      guest,
    );

    response.setHeader('X-Voice-Cache', cached ? 'hit' : 'miss');
    return new StreamableFile(audio, { type: 'audio/wav', length: audio.length });
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
