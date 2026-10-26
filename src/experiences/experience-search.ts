import { normalizeText } from '../common/text.js';
import type { DayPeriod, ExperienceSearchFilters } from '../contracts/conversation-state.js';

import type { ExperienceInfo, ExperienceSlot, PartyComposition } from './experience.types.js';

/**
 * Regras puras da busca de experiências. Nenhuma delas inventa dados:
 * só classificam o que o snapshot registra.
 */

// Intervalos [início, fim) usados para "de manhã", "à tarde" e "à noite".
export const PERIOD_WINDOWS: Record<DayPeriod, { from: string; to: string }> = {
  morning: { from: '05:00', to: '12:00' },
  afternoon: { from: '12:00', to: '18:00' },
  evening: { from: '18:00', to: '24:00' },
};

export const PERIOD_LABELS: Record<DayPeriod, string> = {
  morning: 'de manhã',
  afternoon: 'à tarde',
  evening: 'à noite',
};

export interface TimeWindow {
  from: string;
  to: string;
}

// Um período tem prioridade sobre uma faixa: os dois nunca são preservados juntos.
export function timeWindowOf(filters: ExperienceSearchFilters | undefined): TimeWindow | null {
  if (!filters) return null;
  if (filters.period) return PERIOD_WINDOWS[filters.period];
  if (!filters.after && !filters.before) return null;

  return { from: filters.after ?? '00:00', to: filters.before ?? '24:00' };
}

export function describeWindow(filters: ExperienceSearchFilters | undefined): string {
  if (filters?.period) return PERIOD_LABELS[filters.period];

  return [
    filters?.after ? `a partir das ${filters.after}` : '',
    filters?.before ? `antes das ${filters.before}` : '',
  ].filter(Boolean).join(' e ');
}

// HH:MM compara corretamente como texto.
export function inWindow(time: string, window: TimeWindow): boolean {
  return time >= window.from && time < window.to;
}

// Gratuita = sem cobrança cadastrada (tipo all inclusive).
export function isFree(experience: ExperienceInfo): boolean {
  return experience.reservationType === 'allinclusive';
}

/**
 * Indício cadastrado de que crianças participam: idade mínima abaixo
 * de 12 anos, tarifa de criança ou menção no título/descrição.
 * Idade mínima de 12 anos ou mais exclui a experiência.
 */
export function welcomesChildren(experience: ExperienceInfo): boolean {
  if (experience.minimumAge !== null && experience.minimumAge >= 12) {
    return false;
  }

  return (
    experience.minimumAge !== null ||
    experience.prices.some(({ category }) => normalizeText(category).startsWith('crianca')) ||
    /\b(?:criancas?|infantil|kids|familia)\b/.test(normalizeText(`${experience.title} ${experience.description}`))
  );
}

export function matchesCatalogFilters(
  experience: ExperienceInfo,
  filters: ExperienceSearchFilters,
): boolean {
  return (
    (!filters.free || isFree(experience)) &&
    (!filters.forChildren || welcomesChildren(experience)) &&
    (!filters.bookable || experience.bookable)
  );
}

// Vaga sem quantidade cadastrada não é descartada: não há como afirmar que acabou.
export function hasVacancy(slot: ExperienceSlot, party?: PartyComposition | null): boolean {
  const adults = party?.adults ?? 0;
  const children = party?.children ?? 0;
  const total = Math.max(1, adults + children);

  return (
    (slot.remaining === null || slot.remaining >= total) &&
    (slot.remainingAdults === null || slot.remainingAdults >= adults) &&
    (slot.remainingChildren === null || slot.remainingChildren >= children) &&
    !(slot.remainingAdults === 0 && slot.remainingChildren === 0)
  );
}

/**
 * Vagas compatíveis com a faixa de horário. Vagas para o dia (sem
 * horário) são mantidas: o chamador informa que o período não pode
 * ser confirmado em vez de descartá-las ou presumir um horário.
 */
export function slotsMatching(
  slots: readonly ExperienceSlot[],
  window: TimeWindow | null,
  party?: PartyComposition | null,
): ExperienceSlot[] {
  return slots.filter(
    (slot) =>
      hasVacancy(slot, party) &&
      (!window || slot.time === null || inWindow(slot.time, window)),
  );
}
