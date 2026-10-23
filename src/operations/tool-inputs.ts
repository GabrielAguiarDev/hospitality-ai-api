import { BadRequestException } from '@nestjs/common';

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

export function parseExperienceListInput(
  input: unknown,
): { date: string | null; includeInactive: boolean } {
  const data = asObject(input, ['date', 'includeInactive']);

  if (data.includeInactive !== undefined && typeof data.includeInactive !== 'boolean') {
    throw new BadRequestException('includeInactive inválido.');
  }

  return {
    date: data.date === undefined || data.date === null ? null : isoDate(data.date),
    includeInactive: data.includeInactive === true,
  };
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
