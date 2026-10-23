export type ExperienceReservationType = 'allinclusive' | 'reserva';

export interface ExperiencePrice {
  category: string;
  price: number;
}

export interface ExperienceInfo {
  id: string;
  title: string;
  description: string;
  notes: string;
  active: boolean;
  // possuireserva_experiencia = 'sim'
  bookable: boolean;
  reservationType: ExperienceReservationType | null;
  minimumAge: number | null;
  minimumAgeAlone: number | null;
  requiresGuardian: boolean;
  // Horário-limite de marcação cadastrado (HH:MM). Informativo:
  // a semântica exata não pode ser confirmada pelo snapshot.
  bookingCutoff: string | null;
  prices: ExperiencePrice[];
}

/**
 * Vaga registrada no snapshot. A capacidade cadastrada é total;
 * o saldo desconta reservas ativas do snapshot e reservas simuladas.
 */
export interface ExperienceSlot {
  experienceId: string;
  availabilityId: string;
  slotId: string | null;
  date: string;
  time: string | null;
  capacity: number | null;
  adultCapacity: number | null;
  childCapacity: number | null;
  bookedAdults: number;
  bookedChildren: number;
  remaining: number | null;
  remainingAdults: number | null;
  remainingChildren: number | null;
}

export interface PartyComposition {
  adults: number;
  children: number;
}

export interface PriceQuote {
  currency: 'BRL';
  total: number | null;
  adultUnit: number | null;
  childUnit: number | null;
  included: boolean;
  note: string | null;
}
