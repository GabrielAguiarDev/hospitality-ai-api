import { existsSync } from 'node:fs';
import { DataSource } from 'typeorm';

import { AI_MIGRATIONS, AI_MIGRATIONS_TABLE } from '../database/ai-migrations.js';

// Executa as migrations somente no banco interno da IA.
async function run(): Promise<void> {
  if (existsSync('.env')) {
    process.loadEnvFile('.env');
  }

  const required = (name: string): string => {
    const value = process.env[name]?.trim();

    if (!value) {
      throw new Error(`${name} não configurado.`);
    }

    return value;
  };

  const database = required('DB_NAME');

  // Aborta se o destino for o mesmo servidor e schema do snapshot.
  const sameTarget =
    required('DB_HOST') === process.env.RESORT_DB_HOST?.trim() &&
    required('DB_PORT') === process.env.RESORT_DB_PORT?.trim() &&
    database === process.env.RESORT_DB_NAME?.trim();

  if (sameTarget || database === 'resort_snapshot') {
    throw new Error('O destino das migrations é o snapshot do resort. Abortando.');
  }

  const dataSource = new DataSource({
    type: 'mysql',
    host: required('DB_HOST'),
    port: Number(required('DB_PORT')),
    username: required('DB_USER'),
    password: required('DB_PASSWORD'),
    database,
    migrations: AI_MIGRATIONS,
    migrationsTableName: AI_MIGRATIONS_TABLE,
    migrationsTransactionMode: 'each',
    logging: ['error', 'migration'],
  });

  await dataSource.initialize();

  try {
    const executed = await dataSource.runMigrations();

    console.log(
      executed.length
        ? `Migrations executadas: ${executed.map(({ name }) => name).join(', ')}`
        : 'Nenhuma migration pendente.',
    );
  } finally {
    await dataSource.destroy();
  }
}

await run();
