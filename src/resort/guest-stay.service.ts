import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { GuestContext } from '../guest/guest-context.js';
import { requireConfiguredResortId } from '../guest/resort-config.js';

import { ResortClock } from './resort-clock.service.js';
import { ResortSnapshotGateway } from './resort-snapshot.gateway.js';

export const GUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Hospedagem do titular. O ID de hospedagem do PMS é reutilizado
 * entre estadias, portanto toda consulta deve combinar
 * lodgingId com a janela de datas da estadia.
 */
export interface GuestStay {
  resortId: string;
  holderId: string;
  lodgingId: number;
  checkIn: string;
  checkOut: string;
}

interface StayRow {
  holderId: string;
  lodgingId: number | null;
  checkIn: string | null;
  checkOut: string | null;
}

/**
 * Condição SQL que seleciona os hóspedes da mesma estadia:
 * mesma hospedagem e datas sobrepostas à estadia do titular.
 *
 * A sobreposição é estrita: no dia de troca, o hóspede que sai
 * (ou o que entra) na mesma hospedagem não faz parte da estadia.
 * Parâmetros: lodgingId, checkOut, checkIn.
 */
export const STAY_PARTY_SUBQUERY = `
  SELECT party.id_hospede
  FROM tb_hospede party
  WHERE party.idhospedagempms_hospede = ?
    AND party.dtcheckin_hospede < ?
    AND party.dtcheckout_hospede > ?
`;

export function stayPartyParameters(stay: GuestStay): unknown[] {
  return [stay.lodgingId, stay.checkOut, stay.checkIn];
}

@Injectable()
export class GuestStayService {
  private readonly logger = new Logger(GuestStayService.name);

  constructor(
    private readonly snapshot: ResortSnapshotGateway,
    private readonly clock: ResortClock,
    private readonly configService: ConfigService,
  ) {}

  private requireActiveStay(): boolean {
    // Só é possível desligar a verificação com dados sintéticos.
    const disabled =
      this.configService.get<string>('DEMO_REQUIRE_ACTIVE_STAY') === 'false';
    const synthetic =
      this.configService.get<string>('DEMO_DATASET') === 'synthetic';

    return !(disabled && synthetic);
  }

  async resolve(guest: GuestContext): Promise<GuestStay> {
    const resortId = requireConfiguredResortId(
      this.configService.get<string>('RESORT_ID'),
    );

    const guestId = guest?.guestId?.trim().toLowerCase() ?? '';

    // O snapshot representa um único resort.
    if (guest?.resortId !== resortId || !GUEST_ID_PATTERN.test(guestId)) {
      throw new ForbiddenException('Hospedagem não identificada.');
    }

    const rows = await this.snapshot.select<StayRow>(
      `
        SELECT
          h.id_hospede AS holderId,
          h.idhospedagempms_hospede AS lodgingId,
          DATE_FORMAT(h.dtcheckin_hospede, '%Y-%m-%d') AS checkIn,
          DATE_FORMAT(h.dtcheckout_hospede, '%Y-%m-%d') AS checkOut
        FROM tb_hospede h
        WHERE h.id_hospede = ?
          AND h.tipo_hospede = 'titular'
        LIMIT 2
      `,
      [guestId],
    );

    const row = rows.length === 1 ? rows[0] : undefined;

    if (
      !row ||
      row.lodgingId === null ||
      !ResortClock.isIsoDate(row.checkIn) ||
      !ResortClock.isIsoDate(row.checkOut)
    ) {
      this.logger.warn('Titular não encontrado ou sem hospedagem válida.');
      throw new ForbiddenException('Hospedagem não identificada.');
    }

    if (this.requireActiveStay()) {
      const today = this.clock.today();

      // Permite o acesso a partir da véspera do check-in.
      if (
        today < ResortClock.addDays(row.checkIn, -1) ||
        today > row.checkOut
      ) {
        this.logger.warn('Hospedagem fora do período ativo.');
        throw new ForbiddenException('Hospedagem não está ativa.');
      }
    }

    return {
      resortId,
      holderId: row.holderId,
      lodgingId: Number(row.lodgingId),
      checkIn: row.checkIn,
      checkOut: row.checkOut,
    };
  }
}
