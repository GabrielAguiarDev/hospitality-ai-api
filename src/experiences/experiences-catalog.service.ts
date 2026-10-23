import { Injectable } from '@nestjs/common';

import { compactText, normalizeTime } from '../common/text.js';
import {
  STAY_PARTY_SUBQUERY,
  stayPartyParameters,
  type GuestStay,
} from '../resort/guest-stay.service.js';
import { ResortSnapshotGateway } from '../resort/resort-snapshot.gateway.js';

import type {
  ExperienceInfo,
  ExperiencePrice,
  ExperienceReservationType,
  ExperienceSlot,
} from './experience.types.js';

interface ExperienceRow {
  id: string;
  title: string | null;
  description: string | null;
  notes: string | null;
  text: string | null;
  active: number | null;
  bookable: string | null;
  reservationType: string | null;
  minimumAge: number | null;
  minimumAgeAlone: number | null;
  requiresGuardian: number | null;
  bookingCutoff: string | null;
  prices: string | null;
}

interface SlotRow {
  availabilityId: string;
  experienceId: string;
  date: string;
  hourly: number | null;
  dayCapacity: number | null;
  dayAdultCapacity: number | null;
  dayChildCapacity: number | null;
  slotId: string | null;
  slotTime: string | null;
  slotActive: number | null;
  slotCapacity: number | null;
  slotAdultCapacity: string | null;
  slotChildCapacity: number | null;
}

interface BookedRow {
  availabilityId: string;
  slotId: string | null;
  persons: number | string;
  children: number | string;
}

export interface StayExperienceReservation {
  id: string;
  title: string;
  date: string;
  time: string | null;
  // Valores do snapshot: pago | pendente | cancelado.
  status: string;
  participants: number;
}

export interface BookedCount {
  availabilityId: string;
  slotId: string | null;
  adults: number;
  children: number;
}

const EXPERIENCE_COLUMNS = `
  e.id_experiencia AS id,
  e.titulo_experiencia AS title,
  e.descricao_experiencia AS description,
  e.observacao_experiencia AS notes,
  e.texto_experiencia AS text,
  e.situacao_experiencia AS active,
  e.possuireserva_experiencia AS bookable,
  e.tipo_reserva AS reservationType,
  e.idademinima_experiencia AS minimumAge,
  e.idademinimasozinho_experiencia AS minimumAgeAlone,
  e.exigeresponsavel_experiencia AS requiresGuardian,
  TIME_FORMAT(e.horamaxmarcacao_experiencia, '%H:%i') AS bookingCutoff,
  (
    SELECT GROUP_CONCAT(
      CONCAT(c.nome_categoriacobranca, '=', v.preco_valorexperiencia)
      ORDER BY c.nome_categoriacobranca
      SEPARATOR '|'
    )
    FROM tb_valorexperiencia v
    INNER JOIN tb_categoriacobranca c
      ON c.id_categoriacobranca = v.id_categoriacobranca
    WHERE v.id_experiencia = e.id_experiencia
      AND v.preco_valorexperiencia IS NOT NULL
  ) AS prices
`;

function positiveOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}

function remainingOf(capacity: number | null, booked: number): number | null {
  return capacity === null ? null : Math.max(0, capacity - booked);
}

/**
 * Leituras de experiências, disponibilidades e preços do snapshot.
 */
@Injectable()
export class ExperiencesCatalogService {
  constructor(private readonly snapshot: ResortSnapshotGateway) {}

  private toInfo(row: ExperienceRow): ExperienceInfo {
    const prices: ExperiencePrice[] = (row.prices ?? '')
      .split('|')
      .map((entry) => {
        const separator = entry.lastIndexOf('=');
        return {
          category: compactText(entry.slice(0, separator), 80),
          price: Number(entry.slice(separator + 1)),
        };
      })
      .filter((price) => price.category && Number.isFinite(price.price));

    const reservationType: ExperienceReservationType | null =
      row.reservationType === 'allinclusive' || row.reservationType === 'reserva'
        ? row.reservationType
        : null;

    const cutoff = row.bookingCutoff && row.bookingCutoff !== '00:00'
      ? row.bookingCutoff
      : null;

    return {
      id: row.id,
      title: compactText(row.title, 160) || 'Experiência sem título',
      description: compactText(
        [row.description, row.text].filter(Boolean).join(' '),
      ),
      notes: compactText(row.notes, 600),
      active: Number(row.active) === 1,
      bookable: row.bookable === 'sim',
      reservationType,
      minimumAge: positiveOrNull(row.minimumAge) || null,
      minimumAgeAlone: positiveOrNull(row.minimumAgeAlone) || null,
      requiresGuardian: Number(row.requiresGuardian) === 1,
      bookingCutoff: cutoff,
      prices,
    };
  }

  async listActive(): Promise<ExperienceInfo[]> {
    const rows = await this.snapshot.select<ExperienceRow>(
      `
        SELECT ${EXPERIENCE_COLUMNS}
        FROM tb_experiencia e
        WHERE e.situacao_experiencia = 1
        ORDER BY e.ordem_experiencia ASC, e.titulo_experiencia ASC
        LIMIT 100
      `,
    );

    return rows.map((row) => this.toInfo(row));
  }

  // Inclui experiências inativas para informar o motivo ao hóspede.
  async findById(experienceId: string): Promise<ExperienceInfo | null> {
    const rows = await this.snapshot.select<ExperienceRow>(
      `
        SELECT ${EXPERIENCE_COLUMNS}
        FROM tb_experiencia e
        WHERE e.id_experiencia = ?
        LIMIT 1
      `,
      [experienceId],
    );

    return rows[0] ? this.toInfo(rows[0]) : null;
  }

  // Inclui inativas para reconhecer pedidos por experiências desativadas.
  async listAll(): Promise<ExperienceInfo[]> {
    const rows = await this.snapshot.select<ExperienceRow>(
      `
        SELECT ${EXPERIENCE_COLUMNS}
        FROM tb_experiencia e
        ORDER BY e.situacao_experiencia DESC, e.ordem_experiencia ASC
        LIMIT 200
      `,
    );

    return rows.map((row) => this.toInfo(row));
  }

  /**
   * Vagas cadastradas para a data, descontando somente as reservas
   * ativas do snapshot. Reservas simuladas são descontadas pelo
   * ExperienceAvailabilityService.
   */
  async findSlots(
    date: string,
    experienceId?: string,
  ): Promise<ExperienceSlot[]> {
    const rows = await this.snapshot.select<SlotRow>(
      `
        SELECT
          d.id_dispexperiencia AS availabilityId,
          d.id_experiencia AS experienceId,
          DATE_FORMAT(d.data_dispexperiencia, '%Y-%m-%d') AS date,
          d.hora_dispexperiencia AS hourly,
          d.vagas_dispexperiencia AS dayCapacity,
          d.vagasadulto_dispexperiencia AS dayAdultCapacity,
          d.vagascrianca_dispexperiencia AS dayChildCapacity,
          h.id_horaexperiencia AS slotId,
          h.hora_horaexperiencia AS slotTime,
          h.situacao_horaexperiencia AS slotActive,
          h.vagas_horaexperiencia AS slotCapacity,
          h.vagasadulto_horaexperiencia AS slotAdultCapacity,
          h.vagascrianca_horaexperiencia AS slotChildCapacity
        FROM tb_dispexperiencia d
        LEFT JOIN tb_horaexperiencia h
          ON h.id_dispexperiencia = d.id_dispexperiencia
         AND d.hora_dispexperiencia = 1
        WHERE d.data_dispexperiencia = ?
          ${experienceId ? 'AND d.id_experiencia = ?' : ''}
        ORDER BY d.id_experiencia, d.id_dispexperiencia, h.hora_horaexperiencia
        LIMIT 500
      `,
      experienceId ? [date, experienceId] : [date],
    );

    if (rows.length === 0) {
      return [];
    }

    const booked = await this.countSnapshotBookings([
      ...new Set(rows.map((row) => row.availabilityId)),
    ]);

    const slots: ExperienceSlot[] = [];

    for (const row of rows) {
      const hourly = Number(row.hourly) === 1;

      // Horários desativados não representam vagas.
      if (hourly && (!row.slotId || Number(row.slotActive) !== 1)) {
        continue;
      }

      const capacity = hourly
        ? positiveOrNull(row.slotCapacity)
        : positiveOrNull(row.dayCapacity);
      const adultCapacity = hourly
        ? positiveOrNull(row.slotAdultCapacity)
        : positiveOrNull(row.dayAdultCapacity);
      const childCapacity = hourly
        ? positiveOrNull(row.slotChildCapacity)
        : positiveOrNull(row.dayChildCapacity);

      const used = booked.filter((count) =>
        hourly
          ? count.slotId === row.slotId
          : count.availabilityId === row.availabilityId,
      );

      const bookedAdults = used.reduce((sum, count) => sum + count.adults, 0);
      const bookedChildren = used.reduce((sum, count) => sum + count.children, 0);

      slots.push({
        experienceId: row.experienceId,
        availabilityId: row.availabilityId,
        slotId: hourly ? row.slotId : null,
        date: row.date,
        time: hourly ? normalizeTime(row.slotTime) : null,
        capacity,
        adultCapacity,
        childCapacity,
        bookedAdults,
        bookedChildren,
        remaining: remainingOf(capacity, bookedAdults + bookedChildren),
        remainingAdults: remainingOf(adultCapacity, bookedAdults),
        remainingChildren: remainingOf(childCapacity, bookedChildren),
      });
    }

    return slots;
  }

  // Reservas de experiências registradas no sistema oficial para a estadia.
  async listStayReservations(stay: GuestStay): Promise<StayExperienceReservation[]> {
    const rows = await this.snapshot.select<{
      id: string;
      title: string | null;
      date: string;
      time: string | null;
      status: string | null;
      participants: number | string;
    }>(
      `
        SELECT
          r.id_reservaexperiencia AS id,
          e.titulo_experiencia AS title,
          DATE_FORMAT(r.data_reservaexperiencia, '%Y-%m-%d') AS date,
          h.hora_horaexperiencia AS time,
          r.situacao_reservaexperiencia AS status,
          GREATEST(
            1,
            COALESCE(r.acompanhantesadulto_reservaexperiencia, 0)
              + COALESCE(r.acompanhantescrianca_reservaexperiencia, 0),
            (
              SELECT COUNT(*)
              FROM tb_reservaexphospede x
              WHERE x.id_reservaexperiencia = r.id_reservaexperiencia
            )
          ) AS participants
        FROM tb_reservaexperiencia r
        LEFT JOIN tb_experiencia e
          ON e.id_experiencia = r.id_experiencia
        LEFT JOIN tb_horaexperiencia h
          ON h.id_horaexperiencia = r.id_horaexperiencia
        WHERE r.id_hospede IN (${STAY_PARTY_SUBQUERY})
          AND r.data_reservaexperiencia BETWEEN ? AND ?
        ORDER BY r.data_reservaexperiencia ASC, h.hora_horaexperiencia ASC
        LIMIT 20
      `,
      [...stayPartyParameters(stay), stay.checkIn, stay.checkOut],
    );

    return rows.map((row) => ({
      id: row.id,
      title: compactText(row.title, 160) || 'Experiência não identificada',
      date: row.date,
      time: normalizeTime(row.time),
      status: row.status ?? 'desconhecido',
      participants: Number(row.participants) || 1,
    }));
  }

  /**
   * Participantes de reservas não canceladas. O snapshot não tem um
   * campo único de participantes: usa-se o maior valor entre
   * adultos + crianças e hóspedes vinculados (mínimo de 1).
   */
  private async countSnapshotBookings(
    availabilityIds: string[],
  ): Promise<BookedCount[]> {
    if (availabilityIds.length === 0) {
      return [];
    }

    const rows = await this.snapshot.select<BookedRow>(
      `
        SELECT
          r.id_dispexperiencia AS availabilityId,
          r.id_horaexperiencia AS slotId,
          SUM(GREATEST(
            1,
            COALESCE(r.acompanhantesadulto_reservaexperiencia, 0)
              + COALESCE(r.acompanhantescrianca_reservaexperiencia, 0),
            (
              SELECT COUNT(*)
              FROM tb_reservaexphospede x
              WHERE x.id_reservaexperiencia = r.id_reservaexperiencia
            )
          )) AS persons,
          SUM(COALESCE(r.acompanhantescrianca_reservaexperiencia, 0)) AS children
        FROM tb_reservaexperiencia r
        WHERE r.id_dispexperiencia IN (${availabilityIds.map(() => '?').join(', ')})
          AND COALESCE(r.situacao_reservaexperiencia, '') <> 'cancelado'
        GROUP BY r.id_dispexperiencia, r.id_horaexperiencia
      `,
      availabilityIds,
    );

    return rows.map((row) => {
      const persons = Number(row.persons) || 0;
      const children = Math.min(persons, Number(row.children) || 0);

      return {
        availabilityId: row.availabilityId,
        slotId: row.slotId,
        adults: persons - children,
        children,
      };
    });
  }
}
