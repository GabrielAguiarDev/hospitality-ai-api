
import { NestFactory } from '@nestjs/core';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { AppModule } from '../app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(
    AppModule,
  );

  try {
    const resortDb = app.get<DataSource>(
      getDataSourceToken('resort'),
    );

    const rows: Array<{
      restaurantes: number;
      reservas: number;
      solicitacoes: number;
    }> = await resortDb.query(`
      SELECT
        (SELECT COUNT(*) FROM tb_restaurante)
          AS restaurantes,
        (SELECT COUNT(*) FROM tb_reservarestaurante)
          AS reservas,
        (SELECT COUNT(*) FROM tb_solicitacao)
          AS solicitacoes
    `);

    console.log('Conexão com o resort funcionando.');
    console.table(rows);
  } finally {
    await app.close();
  }
}

bootstrap().catch((error: unknown) => {
  console.error('Erro ao consultar resort:', error);
  process.exitCode = 1;
});
