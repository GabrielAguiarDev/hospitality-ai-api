
import { Module } from '@nestjs/common';
import { OllamaService } from './ollama.service.js';

@Module({
  providers: [OllamaService],
  exports: [OllamaService],
})
export class LlmModule {}
