
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module.js';
import { EmbeddingsService } from '../rag/embeddings.service.js';
import { KnowledgeService } from '../rag/knowledge.service.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(
    AppModule,
  );

  const knowledge = app.get(KnowledgeService);
  const embeddings = app.get(EmbeddingsService);

  const testResortId = 'resort-b';
  const testSource = 'isolation-test';
  const testDocumentId = 'demo-pool';

  try {
    // Mesmo ID original utilizado pela piscina
    // do Resort Demonstração.
    await knowledge.upsertDocuments(
      [
        {
          id: testDocumentId,
          title: 'Piscina Principal',
          category: 'lazer',
          content:
            'A piscina principal do Resort B funciona ' +
            'diariamente das 6h às 8h. ' +
            'Informação exclusiva do Resort B.',
        },
      ],
      testResortId,
      testSource,
    );

    const vectors = await embeddings.embed([
      'task: search result | query: Qual o horário da piscina principal?',
    ]);

    const vector = vectors[0];

    if (!vector?.length) {
      throw new Error(
        'Embedding de teste não foi gerado.',
      );
    }

    const demoResults =
      await knowledge.searchByVector(
        vector,
        'demo',
      );

    const resortBResults =
      await knowledge.searchByVector(
        vector,
        testResortId,
      );

    const unknownResults =
      await knowledge.searchByVector(
        vector,
        'resort-inexistente',
      );

    console.log('\nResort Demonstração:');
    console.table(demoResults);

    console.log('\nResort B:');
    console.table(resortBResults);

    console.log('\nResort inexistente:');
    console.table(unknownResults);

    if (
      demoResults.some((document) =>
        document.content.includes('Resort B'),
      )
    ) {
      throw new Error(
        'Vazamento: documento do Resort B apareceu no Resort Demonstração.',
      );
    }

    if (
      !resortBResults.some((document) =>
        document.content.includes('Resort B'),
      )
    ) {
      throw new Error(
        'O Resort B não recuperou seu próprio documento.',
      );
    }

    if (unknownResults.length > 0) {
      throw new Error(
        'Um resort sem documentos recuperou informações indevidas.',
      );
    }

    console.log(
      '\nTeste de isolamento multi-resort aprovado!',
    );
  } finally {
    // Remove somente o documento criado para o teste.
    try {
      await knowledge.deleteDocuments(
        [testDocumentId],
        testResortId,
        testSource,
      );
    } finally {
      await app.close();
    }
  }
}

bootstrap().catch((error: unknown) => {
  console.error('Falha no isolamento RAG:', error);
  process.exitCode = 1;
});
