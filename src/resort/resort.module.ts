import { Module } from '@nestjs/common';

import { EventsCatalogService } from './events-catalog.service.js';
import { GuestStayService } from './guest-stay.service.js';
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
  ],
  exports: [
    ResortSnapshotGateway,
    ResortClock,
    GuestStayService,
    RestaurantsCatalogService,
    EventsCatalogService,
  ],
})
export class ResortModule {}
