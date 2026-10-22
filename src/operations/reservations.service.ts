
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

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

  async listForDemoGuest(): Promise<RestaurantReservation[]> {
    const resortId = 'demo';
    const guestId = 'guest-demo-001';

    const results = await this.dataSource.query(
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
      [resortId, guestId],
    );

    return results as RestaurantReservation[];
  }
}
