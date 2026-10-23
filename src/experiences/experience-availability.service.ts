import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';

import { ExperiencesCatalogService } from './experiences-catalog.service.js';
import type { ExperienceSlot } from './experience.types.js';

interface LocalBookedRow {
  availabilityId: string;
  slotId: string | null;
  adults: number | string;
  children: number | string;
}

const minusOrNull = (value: number | null, used: number): number | null =>
  value === null ? null : Math.max(0, value - used);

/**
 * Disponibilidade = vagas do snapshot − reservas ativas do snapshot
 * − reservas simuladas confirmadas no banco da IA.
 *
 * Os dados do snapshot são históricos e não representam
 * necessariamente a disponibilidade em tempo real.
 */
@Injectable()
export class ExperienceAvailabilityService {
  constructor(
    private readonly catalog: ExperiencesCatalogService,
    private readonly dataSource: DataSource,
  ) {}

  async findSlots(
    date: string,
    experienceId?: string,
    manager?: EntityManager,
  ): Promise<ExperienceSlot[]> {
    const slots = await this.catalog.findSlots(date, experienceId);

    if (slots.length === 0) {
      return [];
    }

    const availabilityIds = [...new Set(slots.map((slot) => slot.availabilityId))];

    const rows = (await (manager ?? this.dataSource).query(
      `
        SELECT
          availability_id AS availabilityId,
          slot_id AS slotId,
          SUM(adults) AS adults,
          SUM(children) AS children
        FROM simulated_experience_bookings
        WHERE status = 'confirmed'
          AND availability_id IN (${availabilityIds.map(() => '?').join(', ')})
        GROUP BY availability_id, slot_id
      `,
      availabilityIds,
    )) as LocalBookedRow[];

    return slots.map((slot) => {
      const local = rows.filter(
        (row) =>
          row.availabilityId === slot.availabilityId &&
          (row.slotId ?? null) === slot.slotId,
      );

      const adults = local.reduce((sum, row) => sum + Number(row.adults), 0);
      const children = local.reduce((sum, row) => sum + Number(row.children), 0);

      return {
        ...slot,
        bookedAdults: slot.bookedAdults + adults,
        bookedChildren: slot.bookedChildren + children,
        remaining: minusOrNull(slot.remaining, adults + children),
        remainingAdults: minusOrNull(slot.remainingAdults, adults),
        remainingChildren: minusOrNull(slot.remainingChildren, children),
      };
    });
  }
}
