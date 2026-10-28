import { BadRequestException } from '@nestjs/common';

import type { DayPeriod, ExperienceSearchFilters } from '../contracts/conversation-state.js';
import { ResortClock } from '../resort/resort-clock.service.js';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

type Input = Record<string, unknown>;

function asObject(input: unknown, allowed: readonly string[]): Input {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new BadRequestException('Argumentos inválidos para a ferramenta.');
  }

  const unexpected = Object.keys(input).filter((key) => !allowed.includes(key));

  if (unexpected.length > 0) {
    throw new BadRequestException('Argumentos não permitidos para a ferramenta.');
  }

  return input as Input;
}

function identifier(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 255) {
    throw new BadRequestException(`${field} inválido.`);
  }

  return value.trim();
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new BadRequestException(`${field} inválido.`);
  }

  return value.toLowerCase();
}

function isoDate(value: unknown, field = 'date'): string {
  if (!ResortClock.isIsoDate(value)) {
    throw new BadRequestException(`${field} deve estar no formato AAAA-MM-DD.`);
  }

  return value;
}

function count(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 10) {
    throw new BadRequestException(`${field} inválido.`);
  }

  return value as number;
}

export function parseNoInput(input: unknown): Record<string, never> {
  if (
    input === null ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).length > 0
  ) {
    throw new BadRequestException('Esta ferramenta não aceita argumentos.');
  }

  return {};
}

const PERIODS = ['morning', 'afternoon', 'evening'] as const;

export interface ExperienceListInput {
  date: string | null;
  includeInactive: boolean;
  filters: ExperienceSearchFilters;
  party: { adults: number; children: number } | null;
}

function flag(value: unknown, field: string): true | undefined {
  if (value === undefined || value === false) return undefined;
  if (value !== true) throw new BadRequestException(`${field} inválido.`);
  return true;
}

function clockTime(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !TIME.test(value)) {
    throw new BadRequestException(`${field} deve estar no formato HH:MM.`);
  }
  return value;
}

/** Listagem e busca de experiências: todos os filtros são opcionais. */
export function parseExperienceListInput(input: unknown): ExperienceListInput {
  const data = asObject(input, [
    'date',
    'includeInactive',
    'period',
    'after',
    'before',
    'free',
    'forChildren',
    'bookable',
    'adults',
    'children',
  ]);

  if (data.includeInactive !== undefined && typeof data.includeInactive !== 'boolean') {
    throw new BadRequestException('includeInactive inválido.');
  }

  if (data.period !== undefined && !(PERIODS as readonly unknown[]).includes(data.period)) {
    throw new BadRequestException('period inválido.');
  }

  const filters: ExperienceSearchFilters = {
    period: data.period as DayPeriod | undefined,
    after: clockTime(data.after, 'after'),
    before: clockTime(data.before, 'before'),
    free: flag(data.free, 'free'),
    forChildren: flag(data.forChildren, 'forChildren'),
    bookable: flag(data.bookable, 'bookable'),
  };

  for (const key of Object.keys(filters) as (keyof ExperienceSearchFilters)[]) {
    if (filters[key] === undefined) delete filters[key];
  }

  const hasParty = data.adults !== undefined || data.children !== undefined;
  const party = hasParty
    ? { adults: count(data.adults ?? 0, 'adults'), children: count(data.children ?? 0, 'children') }
    : null;

  return {
    date: data.date === undefined || data.date === null ? null : isoDate(data.date),
    includeInactive: data.includeInactive === true,
    filters,
    party,
  };
}

export const RESTAURANT_TYPES = ['restaurante', 'bar', 'alimentacao'] as const;

export type RestaurantType = (typeof RESTAURANT_TYPES)[number];

/** Catálogo de restaurantes: sem argumentos, por tipo ou por nome. */
export function parseRestaurantListInput(
  input: unknown,
): { type: RestaurantType | null; name: string | null } {
  const data = asObject(input, ['type', 'name']);

  if (data.type !== undefined && !(RESTAURANT_TYPES as readonly unknown[]).includes(data.type)) {
    throw new BadRequestException('type inválido.');
  }

  if (data.name !== undefined && (typeof data.name !== 'string' || !data.name.trim() || data.name.length > 120)) {
    throw new BadRequestException('name inválido.');
  }

  return {
    type: (data.type as RestaurantType | undefined) ?? null,
    name: typeof data.name === 'string' ? data.name.trim() : null,
  };
}

export function parseEventListInput(input: unknown): { date: string } {
  const data = asObject(input, ['date']);
  return { date: isoDate(data.date) };
}

export function parseRestaurantIdInput(input: unknown): { restaurantId: string } {
  const data = asObject(input, ['restaurantId']);
  return { restaurantId: identifier(data.restaurantId, 'restaurantId') };
}

export function parseExperienceIdInput(input: unknown): { experienceId: string } {
  const data = asObject(input, ['experienceId']);
  return { experienceId: identifier(data.experienceId, 'experienceId') };
}

export function parseAvailabilityInput(
  input: unknown,
): { experienceId: string; date: string } {
  const data = asObject(input, ['experienceId', 'date']);
  return {
    experienceId: identifier(data.experienceId, 'experienceId'),
    date: isoDate(data.date),
  };
}

export interface PreviewInput {
  conversationId: string;
  experienceId: string;
  date: string;
  time: string | null;
  adults: number;
  children: number;
}

export function parsePreviewInput(input: unknown): PreviewInput {
  const data = asObject(input, [
    'conversationId',
    'experienceId',
    'date',
    'time',
    'adults',
    'children',
  ]);

  if (data.time !== null && data.time !== undefined && (typeof data.time !== 'string' || !TIME.test(data.time))) {
    throw new BadRequestException('time deve estar no formato HH:MM.');
  }

  return {
    conversationId: uuid(data.conversationId, 'conversationId'),
    experienceId: identifier(data.experienceId, 'experienceId'),
    date: isoDate(data.date),
    time: typeof data.time === 'string' ? data.time : null,
    adults: count(data.adults, 'adults'),
    children: count(data.children ?? 0, 'children'),
  };
}

export function parsePreviewReferenceInput(
  input: unknown,
): { conversationId: string; previewId: string } {
  const data = asObject(input, ['conversationId', 'previewId']);
  return {
    conversationId: uuid(data.conversationId, 'conversationId'),
    previewId: uuid(data.previewId, 'previewId'),
  };
}

/** Estado atual de cards de reserva de uma conversa. */
export function parseBookingCardsInput(input: unknown): { conversationId: string; previewIds: string[] } {
  const data = asObject(input, ['conversationId', 'previewIds']);

  if (!Array.isArray(data.previewIds) || data.previewIds.length === 0 || data.previewIds.length > 50) {
    throw new BadRequestException('previewIds inválido.');
  }

  return {
    conversationId: uuid(data.conversationId, 'conversationId'),
    previewIds: [...new Set(data.previewIds.map((id) => uuid(id, 'previewId')))],
  };
}

export interface RequestPreviewInput {
  conversationId: string;
  departmentId: string;
  items: { itemId: string; quantity: number }[];
  note: string | null;
}

/** Nova solicitação simulada: IDs do catálogo, nunca nomes livres. */
export function parseRequestPreviewInput(input: unknown): RequestPreviewInput {
  const data = asObject(input, ['conversationId', 'departmentId', 'items', 'note']);

  if (!Array.isArray(data.items) || data.items.length === 0 || data.items.length > 10) {
    throw new BadRequestException('items inválido.');
  }

  const items = data.items.map((item: unknown) => {
    const entry = asObject(item, ['itemId', 'quantity']);
    const quantity = Number(entry.quantity ?? 1);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
      throw new BadRequestException('quantity inválido.');
    }
    return { itemId: identifier(entry.itemId, 'itemId'), quantity };
  });

  if (new Set(items.map(({ itemId }) => itemId)).size !== items.length) {
    throw new BadRequestException('items repetidos.');
  }

  if (data.note !== undefined && data.note !== null && (typeof data.note !== 'string' || data.note.length > 2000)) {
    throw new BadRequestException('note inválido.');
  }

  return {
    conversationId: uuid(data.conversationId, 'conversationId'),
    departmentId: identifier(data.departmentId, 'departmentId'),
    items,
    note: typeof data.note === 'string' ? data.note : null,
  };
}
