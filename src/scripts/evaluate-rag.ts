import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module.js';
import { RetrievalService } from '../rag/retrieval.service.js';

const questions = [
  'Qual restaurante italiano existe no resort?',
  'Qual é o horário da piscina?',
  'Crianças de 5 anos podem participar do clube infantil?',
  'Quanto custa uma massagem no spa?',
  'O resort oferece aluguel de jet ski?',
];

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const retrievalService = app.get(RetrievalService);

    for (const question of questions) {
      const documents = await retrievalService.search(question, 'demo');

      console.log('\n--------------------------------');
      console.log(`Pergunta: ${question}`);

      console.table(
        documents.map((document) => ({
          id: document.id,
          title: document.title,
          distance:
            document.distance === null
              ? null
              : Number(document.distance.toFixed(4)),
        })),
      );
    }
  } finally {
    await app.close();
  }
}

bootstrap().catch((error: unknown) => {
  console.error('Falha na avaliação do RAG:', error);
  process.exitCode = 1;
});
