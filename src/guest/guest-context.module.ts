
import { Module } from '@nestjs/common';

import { DemoGuestGuard } from './demo-guest.guard.js';

@Module({
  providers: [DemoGuestGuard],
  exports: [DemoGuestGuard],
})
export class GuestContextModule {}
