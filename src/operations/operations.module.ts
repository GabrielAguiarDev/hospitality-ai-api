
import { Module } from '@nestjs/common';

import { OperationsController } from './operations.controller.js';
import { OperationsAiService } from './operations-ai.service.js';
import { ReservationsService } from './reservations.service.js';

@Module({
  controllers: [OperationsController],
  providers: [
    OperationsAiService,
    ReservationsService,
  ],
  exports: [OperationsAiService],
})
export class OperationsModule {}
