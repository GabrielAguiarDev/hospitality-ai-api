
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { GuestContext } from '../guest/guest-context.js';

export interface GuestRequest {
  id: string;
  category: string;
  description: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class RequestsService {
  constructor(
    private readonly dataSource: DataSource,
  ) {}

  async listForGuest(
    guest: GuestContext,
  ): Promise<GuestRequest[]> {
    const results: unknown = await this.dataSource.query(
      `
        SELECT
          id,
          category,
          description,
          status,
          DATE_FORMAT(
            created_at,
            '%d/%m/%Y %H:%i'
          ) AS createdAt,
          DATE_FORMAT(
            updated_at,
            '%d/%m/%Y %H:%i'
          ) AS updatedAt
        FROM demo_guest_requests
        WHERE resort_id = ?
          AND guest_id = ?
        ORDER BY created_at DESC
        LIMIT 20
      `,
      [guest.resortId, guest.guestId],
    );

    return results as GuestRequest[];
  }
}
