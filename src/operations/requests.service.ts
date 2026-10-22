
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

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

  async listForDemoGuest(): Promise<GuestRequest[]> {
    // Contexto fictício controlado pelo backend.
    // Futuramente virá da sessão autenticada.
    const resortId = 'demo';
    const guestId = 'guest-demo-001';

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
      [resortId, guestId],
    );

    return results as GuestRequest[];
  }
}
