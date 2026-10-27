import { Module } from '@nestjs/common';

import { VoiceboxService } from './voicebox.service.js';

@Module({
  providers: [VoiceboxService],
  exports: [VoiceboxService],
})
export class VoiceModule {}
