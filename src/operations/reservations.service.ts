
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { GuestContext } from '../guest/guest-context.js';

export interface RestaurantReservation {
  id: string;
  restaurant: string;
  reservedAt: string;
  partySize: number;
  status: string;
}

@Injectable()
export class ReservationsService {
  constructor(
    private readonly dataSource: DataSource,
  ) {}

  async listForGuest(
    guest: GuestContext,
  ): Promise<RestaurantReservation[]> {
    const results: unknown = await this.dataSource.query(
      `
        SELECT
          id,
          restaurant,
          DATE_FORMAT(
            reserved_at,
            '%d/%m/%Y %H:%i'
          ) AS reservedAt,
          party_size AS partySize,
          status
        FROM demo_restaurant_reservations
        WHERE resort_id = ?
          AND guest_id = ?
        ORDER BY reserved_at ASC
        LIMIT 20
      `,
      [guest.resortId, guest.guestId],
    );

    return results as RestaurantReservation[];
  }
}
