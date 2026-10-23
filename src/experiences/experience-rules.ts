import type {
  ExperienceInfo,
  ExperienceSlot,
  PartyComposition,
} from './experience.types.js';

// Limite de participantes por reserva simulada no MVP.
export const MAX_PARTY_SIZE = 10;

export type BookingRuleCode =
  | 'experience_inactive'
  | 'experience_not_bookable'
  | 'party_invalid'
  | 'party_too_large'
  | 'guardian_required'
  | 'date_in_past'
  | 'date_outside_stay'
  | 'no_availability'
  | 'time_required'
  | 'time_not_found'
  | 'capacity_exceeded';

export type BookingRuleResult =
  | { ok: true; slot: ExperienceSlot; capacityKnown: boolean; warnings: string[] }
  | { ok: false; code: BookingRuleCode; message: string; options?: string[] };

export interface BookingRuleInput {
  experience: ExperienceInfo;
  slots: ExperienceSlot[];
  date: string;
  time: string | null;
  party: PartyComposition;
  today: string;
  stay: { checkIn: string; checkOut: string };
}

function fits(slot: ExperienceSlot, party: PartyComposition): boolean {
  const total = party.adults + party.children;

  if (slot.remaining !== null && total > slot.remaining) return false;
  if (slot.remainingAdults !== null && party.adults > slot.remainingAdults) return false;
  if (slot.remainingChildren !== null && party.children > slot.remainingChildren) return false;

  return true;
}

function capacityKnown(slot: ExperienceSlot): boolean {
  return (
    slot.remaining !== null ||
    slot.remainingAdults !== null ||
    slot.remainingChildren !== null
  );
}

/**
 * Regras verificáveis no snapshot. Não decide nada que o banco
 * não represente (ex.: idade dos participantes não é validada,
 * apenas informada).
 */
export function evaluateBooking(input: BookingRuleInput): BookingRuleResult {
  const { experience, party, date } = input;

  if (!experience.active) {
    return {
      ok: false,
      code: 'experience_inactive',
      message: `A experiência "${experience.title}" está inativa no cadastro do resort.`,
    };
  }

  if (!experience.bookable) {
    return {
      ok: false,
      code: 'experience_not_bookable',
      message: `A experiência "${experience.title}" não exige reserva pelo aplicativo.`,
    };
  }

  const total = party.adults + party.children;

  if (
    !Number.isInteger(party.adults) ||
    !Number.isInteger(party.children) ||
    party.adults < 0 ||
    party.children < 0 ||
    total < 1
  ) {
    return {
      ok: false,
      code: 'party_invalid',
      message: 'Informe quantos adultos e crianças vão participar.',
    };
  }

  if (total > MAX_PARTY_SIZE) {
    return {
      ok: false,
      code: 'party_too_large',
      message: `Pelo chat é possível reservar para até ${MAX_PARTY_SIZE} pessoas.`,
    };
  }

  if (
    party.children > 0 &&
    party.adults === 0 &&
    (experience.requiresGuardian || experience.minimumAgeAlone !== null)
  ) {
    return {
      ok: false,
      code: 'guardian_required',
      message: `Crianças precisam estar acompanhadas de um adulto na experiência "${experience.title}".`,
    };
  }

  if (date < input.today) {
    return {
      ok: false,
      code: 'date_in_past',
      message: 'A data informada já passou.',
    };
  }

  if (date < input.stay.checkIn || date > input.stay.checkOut) {
    return {
      ok: false,
      code: 'date_outside_stay',
      message: 'A data informada está fora do período da sua hospedagem.',
    };
  }

  const slots = input.slots.filter(
    (slot) => slot.experienceId === experience.id && slot.date === date,
  );

  if (slots.length === 0) {
    return {
      ok: false,
      code: 'no_availability',
      message: `Não há horários registrados para "${experience.title}" nessa data.`,
    };
  }

  const timedSlots = slots.filter((slot) => slot.time !== null);
  let candidates = slots;

  if (timedSlots.length > 0) {
    const times = [...new Set(timedSlots.map((slot) => slot.time as string))].sort();

    if (!input.time) {
      if (times.length > 1) {
        return {
          ok: false,
          code: 'time_required',
          message: 'Qual horário você prefere?',
          options: times,
        };
      }
    } else {
      candidates = timedSlots.filter((slot) => slot.time === input.time);

      if (candidates.length === 0) {
        return {
          ok: false,
          code: 'time_not_found',
          message: `Não há o horário ${input.time} registrado nessa data.`,
          options: times,
        };
      }
    }
  }

  // Ordem determinística: a vaga com maior saldo conhecido primeiro.
  const available = candidates
    .filter((slot) => fits(slot, party))
    .sort((a, b) => (b.remaining ?? -1) - (a.remaining ?? -1) || a.availabilityId.localeCompare(b.availabilityId));

  if (available.length === 0) {
    return {
      ok: false,
      code: 'capacity_exceeded',
      message: `Não há vagas suficientes registradas para ${total} ${total === 1 ? 'pessoa' : 'pessoas'} nesse horário.`,
    };
  }

  const slot = available[0];
  const warnings: string[] = [];

  if (!capacityKnown(slot)) {
    warnings.push('A quantidade de vagas não está cadastrada para esse horário.');
  }

  if (experience.minimumAge) {
    warnings.push(`Idade mínima: ${experience.minimumAge} anos.`);
  }

  if (experience.minimumAgeAlone) {
    warnings.push(`Menores de ${experience.minimumAgeAlone} anos precisam de um responsável.`);
  }

  if (experience.bookingCutoff) {
    warnings.push(`Horário-limite de marcação cadastrado: ${experience.bookingCutoff}.`);
  }

  return { ok: true, slot, capacityKnown: capacityKnown(slot), warnings };
}
