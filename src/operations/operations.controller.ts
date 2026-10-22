import { Body, Controller, Post, UseGuards } from '@nestjs/common';

import { CurrentGuest } from '../guest/current-guest.decorator.js';
import { DemoGuestGuard } from '../guest/demo-guest.guard.js';
import type { GuestContext } from '../guest/guest-context.js';

import { AskOperationsDto } from './dto/ask-operations.dto.js';
import {
  OperationsAiService,
  type OperationsResponse,
} from './operations-ai.service.js';

@Controller('operations')
@UseGuards(DemoGuestGuard)
export class OperationsController {
  constructor(private readonly operationsAiService: OperationsAiService) {}

  @Post('ask')
  async ask(
    @Body() dto: AskOperationsDto,
    @CurrentGuest() guest: GuestContext,
  ): Promise<OperationsResponse> {
    return this.operationsAiService.ask(dto.message, guest);
  }
}
