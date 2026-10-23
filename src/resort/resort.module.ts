import { Module } from '@nestjs/common';

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
  ],
  exports: [
    ResortSnapshotGateway,
    ResortClock,
    GuestStayService,
    RestaurantsCatalogService,
  ],
})
export class ResortModule {}
