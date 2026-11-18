import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ResortModule } from '../resort/resort.module.js';

import { SimulatedGuestRequest } from './entities/simulated-guest-request.entity.js';
import { GuestRequestService } from './guest-request.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([SimulatedGuestRequest]), ResortModule],
  providers: [GuestRequestService],
  exports: [GuestRequestService],
})
export class RequestsModule {}
