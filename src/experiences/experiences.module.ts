import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ResortModule } from '../resort/resort.module.js';

import { ExperienceBookingPreview } from './entities/experience-booking-preview.entity.js';
import { SimulatedExperienceBooking } from './entities/simulated-experience-booking.entity.js';
import { ExperienceAvailabilityService } from './experience-availability.service.js';
import { ExperienceBookingService } from './experience-booking.service.js';
import { ExperiencesCatalogService } from './experiences-catalog.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ExperienceBookingPreview,
      SimulatedExperienceBooking,
    ]),
    ResortModule,
  ],
  providers: [
    ExperiencesCatalogService,
    ExperienceAvailabilityService,
    ExperienceBookingService,
  ],
  exports: [
    ExperiencesCatalogService,
    ExperienceAvailabilityService,
    ExperienceBookingService,
  ],
})
export class ExperiencesModule {}
