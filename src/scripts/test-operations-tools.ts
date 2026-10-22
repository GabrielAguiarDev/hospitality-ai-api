import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module.js';
import { OperationsToolRegistryService } from '../operations/operations-tool-registry.service.js';
import { DEMO_GUEST_CONTEXT } from '../guest/guest-context.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule);

  try {
    const registry = app.get(OperationsToolRegistryService);

    console.log('\nFerramentas disponíveis:');
    console.table(registry.listTools());

    console.log('\nConsultando reservas...');
    const reservations = await registry.execute(
      'reservations.list',
      DEMO_GUEST_CONTEXT,
    );

    console.log(JSON.stringify(reservations, null, 2));

    console.log('\nConsultando solicitações...');
    const requests = await registry.execute(
      'requests.list',
      DEMO_GUEST_CONTEXT,
    );

    console.log(JSON.stringify(requests, null, 2));
  } finally {
    await app.close();
  }
}

bootstrap().catch((error: unknown) => {
  console.error('Erro ao executar ferramentas:', error);
  process.exitCode = 1;
});
