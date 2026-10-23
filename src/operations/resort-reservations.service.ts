
import {
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import type { GuestContext } from '../guest/guest-context.js';

export interface ResortRestaurantReservation {
  id: string;
  restaurant: string;
  reservationDate: string | null;
  status: 'aprovada' | 'cancelada' | null;
}

@Injectable()
export class ResortReservationsService {
  constructor(
    @InjectDataSource('resort')
    private readonly resortDb: DataSource,
    private readonly configService: ConfigService,
  ) {}

  async listForGuest(
    guest: GuestContext,
  ): Promise<ResortRestaurantReservation[]> {
    const configuredResortId =
      this.configService.getOrThrow<string>('RESORT_ID');

    if (
      guest.resortId !== configuredResortId ||
      !guest.guestId?.trim()
    ) {
      throw new ForbiddenException(
        'Contexto do hóspede inválido.',
      );
    }

    const rows = (await this.resortDb.query(
      `
        SELECT
          r.id_reservarestaurante AS id,
          rest.nome_restaurante AS restaurant,

          DATE_FORMAT(
            r.data_reservarestaurante,
            '%d/%m/%Y'
          ) AS reservationDate,

          r.situacao_reservarestaurante AS status

        FROM tb_reservarestaurante r

        INNER JOIN tb_hospede h
          ON h.id_hospede =
             r.idtitular_reservarestaurante

        LEFT JOIN tb_restaurante rest
          ON rest.id_restaurante =
             r.id_restaurante

        WHERE h.id_hospede = ?
          AND h.tipo_hospede = 'titular'

          AND h.idhospedagempms_hospede IS NOT NULL

          AND h.idhospedagempms_hospede =
              r.idhospedagempms_reservarestaurante

        ORDER BY
          r.data_reservarestaurante DESC,
          r.criado_em DESC

        LIMIT 30
      `,
      [guest.guestId],
    )) as ResortRestaurantReservation[];

    return rows;
  }
}
