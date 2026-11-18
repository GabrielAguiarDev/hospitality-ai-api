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
  bookable: boolean;
  reservationType: ExperienceReservationType | null;
  minimumAge: number | null;
  minimumAgeAlone: number | null;
  requiresGuardian: boolean;
  bookingCutoff: string | null;
  prices: ExperiencePrice[];
}

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
