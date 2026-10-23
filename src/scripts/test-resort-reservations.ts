
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';

import { AppModule } from '../app.module.js';
import { ReservationsService } from '../operations/reservations.service.js';
import { RequestsService } from '../operations/requests.service.js';

// Uso: node dist/scripts/test-resort-reservations.js <guestHolderId>
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(
    AppModule,
  );

  try {
    const config = app.get(ConfigService);

    const resortId =
      config.getOrThrow<string>('RESORT_ID');

    const guestId = process.argv[2]?.trim();

    if (!guestId) {
      throw new Error(
        'Informe o guestHolder.id como argumento.',
      );
    }

    const guest = { resortId, guestId };

    const reservations = await app
      .get(ReservationsService)
      .listForGuest(guest);

    const requests = await app
      .get(RequestsService)
      .listForGuest(guest);

    // Não imprime nomes nem identificadores
    // pessoais de hóspedes.
    console.log(
      `\nReservas encontradas: ${reservations.length}`,
    );

    console.table(
      reservations.map((reservation) => ({
        restaurante: reservation.restaurant,
        data: reservation.reservedAt,
        pessoas: reservation.partySize,
        situacao: reservation.status,
      })),
    );

    console.log(
      `\nSolicitações encontradas: ${requests.length}`,
    );

    console.table(
      requests.map((request) => ({
        departamento: request.category,
        itens: request.description,
        situacao: request.status,
        abertura: request.createdAt,
      })),
    );
  } finally {
    await app.close();
  }
}

bootstrap().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
