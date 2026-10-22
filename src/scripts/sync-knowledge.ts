
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module.js';
import { KnowledgeIngestionService } from '../rag/knowledge-ingestion.service.js';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(
    AppModule,
  );

  try {
    const ingestionService = app.get(
      KnowledgeIngestionService,
    );

    const result = await ingestionService.syncDemo();

    console.log('\nResultado da sincronização:');
    console.table({
      'Criados ou atualizados': result.createdOrUpdated,
      'Sem alterações': result.unchanged,
      'Removidos': result.removed,
    });
  } finally {
    await app.close();
  }
}

bootstrap().catch((error: unknown) => {
  console.error('Erro na sincronização:', error);
  process.exitCode = 1;
});
