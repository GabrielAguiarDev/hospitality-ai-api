
import {
  Body,
  Controller,
  Post,
} from '@nestjs/common';

import { AskOperationsDto } from './dto/ask-operations.dto.js';
import { OperationsAiService } from './operations-ai.service.js';

@Controller('operations')
export class OperationsController {
  constructor(
    private readonly operationsAiService: OperationsAiService,
  ) {}

  @Post('ask')
  async ask(@Body() dto: AskOperationsDto) {
    return this.operationsAiService.ask(dto.message);
  }
}
