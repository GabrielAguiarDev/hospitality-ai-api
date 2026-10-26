
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { OllamaService } from './llm/ollama.service.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.listen(process.env.PORT ?? 3000, '127.0.0.1');

  // Somente no servidor HTTP: scripts (sync, avaliação) não pré-carregam o modelo.
  void app.get(OllamaService).warmup();
}

await bootstrap();
