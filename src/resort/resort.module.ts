import { Module } from '@nestjs/common';

import { EventsCatalogService } from './events-catalog.service.js';
import { GuestStayService } from './guest-stay.service.js';
import { ModulesCatalogService } from './modules-catalog.service.js';
import { RequestsCatalogService } from './requests-catalog.service.js';
import { ResortClock } from './resort-clock.service.js';
import { ResortSnapshotGateway } from './resort-snapshot.gateway.js';
import { RestaurantsCatalogService } from './restaurants-catalog.service.js';

/**
 * Acesso somente leitura ao snapshot do resort.
 * A conexão "resort" é registrada pelo ResortDatabaseModule no AppModule.
 */
@Module({
  providers: [
    ResortSnapshotGateway,
    ResortClock,
    GuestStayService,
    RestaurantsCatalogService,
    EventsCatalogService,
    RequestsCatalogService,
    ModulesCatalogService,
  ],
  exports: [
    ResortSnapshotGateway,
    ResortClock,
    GuestStayService,
    RestaurantsCatalogService,
    EventsCatalogService,
    RequestsCatalogService,
    ModulesCatalogService,
  ],
})
export class ResortModule {}
