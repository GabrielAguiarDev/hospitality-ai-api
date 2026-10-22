
import { Body, Controller, Post } from '@nestjs/common';

import { AskOperationsDto } from './dto/ask-operations.dto.js';
import { OperationsAiService } from './operations-ai.service.js';
import type { OperationsResponse } from './operations-ai.service.js';

@Controller('operations')
export class OperationsController {
  constructor(
    private readonly operationsAiService: OperationsAiService,
  ) {}

  @Post('ask')
  async ask(
    @Body() dto: AskOperationsDto,
  ): Promise<OperationsResponse> {
    return this.operationsAiService.ask(dto.message);
  }
}
