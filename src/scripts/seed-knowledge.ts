
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module.js';
import {
  KnowledgeService,
  type KnowledgeDocument,
} from '../rag/knowledge.service.js';

const documents: KnowledgeDocument[] = [
  {
    id: 'demo-restaurant-italian',
    title: 'Trattoria Aurora',
    category: 'gastronomia',
    content: `
      A Trattoria Aurora é um restaurante italiano
      fictício do Resort Demonstração.

      Funciona diariamente das 18h às 22h.

      Oferece massas artesanais, pizzas e risotos.

      Possui opções vegetarianas no cardápio.

      Reservas dependem de disponibilidade,
      que não está disponível nesta base.
    `,
  },
  {
    id: 'demo-pool',
    title: 'Piscina Principal',
    category: 'lazer',
    content: `
      A piscina principal do Resort Demonstração
      funciona diariamente das 8h às 20h.

      Está localizada próxima à área de lazer.

      A utilização é exclusiva para hóspedes.
    `,
  },
  {
    id: 'demo-kids-club',
    title: 'Clube Infantil',
    category: 'atividades',
    content: `
      O Clube Infantil do Resort Demonstração
      oferece atividades recreativas
      supervisionadas para crianças de 4 a 12 anos.

      Funciona diariamente das 9h às 17h.

      Algumas atividades exigem inscrição prévia.
    `,
  },
  {
    id: 'demo-checkin',
    title: 'Check-in e Check-out',
    category: 'hospedagem',
    content: `
      No Resort Demonstração,
      o check-in começa às 15h.

      O check-out deve ser realizado até as 12h.

      Solicitações de antecipação ou extensão
      dependem de disponibilidade e autorização.
    `,
  },
];

async function bootstrap() {
  const app =
    await NestFactory.createApplicationContext(AppModule);

  try {
    const knowledgeService = app.get(KnowledgeService);

    const total =
      await knowledgeService.upsertDocuments(documents);

    console.log(
      `${total} documentos fictícios indexados com sucesso!`,
    );
  } finally {
    await app.close();
  }
}

bootstrap().catch((error: unknown) => {
  console.error('Erro ao indexar documentos:', error);
  process.exitCode = 1;
});
