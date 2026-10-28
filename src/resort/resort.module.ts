import { Module } from '@nestjs/common';

import { EventsCatalogService } from './events-catalog.service.js';
import { FavoritesService } from './favorites.service.js';
import { GuestStayService } from './guest-stay.service.js';
import { LeisureEnrollmentsService } from './leisure-enrollments.service.js';
import { ModulesCatalogService } from './modules-catalog.service.js';
import { RequestsCatalogService } from './requests-catalog.service.js';
import { ResortClock } from './resort-clock.service.js';
import { ResortSnapshotGateway } from './resort-snapshot.gateway.js';
import { RestaurantMenusService } from './restaurant-menus.service.js';
import { RestaurantsCatalogService } from './restaurants-catalog.service.js';

/**
 * Acesso somente leitura ao snapshot do resort.
 * A conexão "resort" é registrada pelo ResortDatabaseModule no AppModule.
 */
@Module({
  providers: [
    ResortSnapshotGateway,
    RestaurantMenusService,
    FavoritesService,
    LeisureEnrollmentsService,
    ResortClock,
    GuestStayService,
    RestaurantsCatalogService,
    EventsCatalogService,
    RequestsCatalogService,
    ModulesCatalogService,
  ],
  exports: [
    ResortSnapshotGateway,
    RestaurantMenusService,
    FavoritesService,
    LeisureEnrollmentsService,
    ResortClock,
    GuestStayService,
    RestaurantsCatalogService,
    EventsCatalogService,
    RequestsCatalogService,
    ModulesCatalogService,
  ],
})
export class ResortModule {}
