
import { Module } from '@nestjs/common';

import { OperationsController } from './operations.controller.js';
import { OperationsAiService } from './operations-ai.service.js';
import { OperationsToolRegistryService } from './operations-tool-registry.service.js';
import { OperationsDispatcherService } from './operations-dispatcher.service.js';
import { RequestsOperationsService } from './requests-operations.service.js';
import { ReservationsService } from './reservations.service.js';
import { RequestsService } from './requests.service.js';

@Module({
  controllers: [
    OperationsController,
  ],
  providers: [
    OperationsAiService,
    OperationsToolRegistryService,
    OperationsDispatcherService,
    RequestsOperationsService,
    ReservationsService,
    RequestsService,
  ],
  exports: [
    OperationsAiService,
    OperationsToolRegistryService,
    OperationsDispatcherService,
    RequestsOperationsService,
  ],
})
export class OperationsModule {}
