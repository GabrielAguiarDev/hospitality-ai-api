
import { Module } from '@nestjs/common';

import { OperationsController } from './operations.controller.js';
import { OperationsAiService } from './operations-ai.service.js';
import { OperationsToolRegistryService } from './operations-tool-registry.service.js';
import { RequestsOperationsService } from './requests-operations.service.js';
import { ReservationsService } from './reservations.service.js';
import { RequestsService } from './requests.service.js';

@Module({
  controllers: [OperationsController],
  providers: [
    OperationsAiService,
    OperationsToolRegistryService,
    RequestsOperationsService,
    ReservationsService,
    RequestsService,
  ],
  exports: [
    OperationsAiService,
    OperationsToolRegistryService,
    RequestsOperationsService,
  ],
})
export class OperationsModule {}
