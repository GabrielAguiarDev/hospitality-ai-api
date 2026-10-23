
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';

import { AppModule } from '../app.module.js';
import { ResortReservationsService } from '../operations/resort-reservations.service.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(
    AppModule,
  );

  try {
    const config = app.get(ConfigService);

    const service = app.get(
      ResortReservationsService,
    );

    const resortId =
      config.getOrThrow<string>('RESORT_ID');

    const guestId = config
      .getOrThrow<string>('DEMO_ALLOWED_GUEST_IDS')
      .split(',')
      .map((id) => id.trim())
      .find(Boolean);

    if (!guestId) {
      throw new Error(
        'Nenhum hóspede de demonstração configurado.',
      );
    }

    const reservations = await service.listForGuest({
      resortId,
      guestId,
    });

    console.log(
      `\nReservas encontradas: ${reservations.length}`,
    );

    // Não imprime nomes nem identificadores
    // pessoais de hóspedes.
    console.table(
      reservations.map((reservation) => ({
        restaurante: reservation.restaurant,
        data: reservation.reservationDate,
        situacao: reservation.status,
      })),
    );
  } finally {
    await app.close();
  }
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
