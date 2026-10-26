
import { Module } from '@nestjs/common';

import { ExperiencesModule } from '../experiences/experiences.module.js';
import { ResortModule } from '../resort/resort.module.js';

import { OperationsController } from './operations.controller.js';
import { OperationsAiService } from './operations-ai.service.js';
import { OperationsToolRegistryService } from './operations-tool-registry.service.js';
import { OperationsDispatcherService } from './operations-dispatcher.service.js';
import { RequestsOperationsService } from './requests-operations.service.js';
import { ReservationsService } from './reservations.service.js';
import { RequestsService } from './requests.service.js';
import { EventOperationsService } from './event-operations.service.js';
import { ExperienceOperationsService } from './experience-operations.service.js';
import { RestaurantOperationsService } from './restaurant-operations.service.js';

@Module({
  imports: [
    ResortModule,
    ExperiencesModule,
  ],
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
    ExperienceOperationsService,
    RestaurantOperationsService,
    EventOperationsService,
  ],
  exports: [
    OperationsAiService,
    OperationsToolRegistryService,
    OperationsDispatcherService,
    RequestsOperationsService,
    ExperienceOperationsService,
  ],
})
export class OperationsModule {}
