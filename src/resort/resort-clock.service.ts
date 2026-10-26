import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const WEEKDAYS_PT = [
  'domingo',
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
] as const;

const WEEKDAYS_EN = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

export type WeekdayKey = (typeof WEEKDAYS_EN)[number];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Datas do resort. Internamente todas as datas são absolutas
 * (YYYY-MM-DD) no fuso configurado em RESORT_TIMEZONE.
 */
@Injectable()
export class ResortClock {
  constructor(private readonly configService: ConfigService) {}

  get timeZone(): string {
    return (
      this.configService.get<string>('RESORT_TIMEZONE')?.trim() ||
      'America/Bahia'
    );
  }

  now(): Date {
    return new Date();
  }

  today(): string {
    return this.dateAt(this.now());
  }

  dateAt(instant: Date): string {
    // en-CA produz o formato YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: this.timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(instant);
  }

  // Hora atual no fuso do resort (HH:MM).
  time(): string {
    return this.timeAt(this.now());
  }

  timeAt(instant: Date): string {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: this.timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(instant);
  }

  static isIsoDate(value: unknown): value is string {
    if (typeof value !== 'string' || !ISO_DATE.test(value)) {
      return false;
    }

    const parsed = new Date(`${value}T00:00:00Z`);

    return (
      !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }

  static addDays(date: string, days: number): string {
    const parsed = new Date(`${date}T00:00:00Z`);
    parsed.setUTCDate(parsed.getUTCDate() + days);
    return parsed.toISOString().slice(0, 10);
  }

  static weekdayIndex(date: string): number {
    return new Date(`${date}T00:00:00Z`).getUTCDay();
  }

  static weekdayKey(date: string): WeekdayKey {
    return WEEKDAYS_EN[ResortClock.weekdayIndex(date)];
  }

  static weekdayLabel(date: string): string {
    return WEEKDAYS_PT[ResortClock.weekdayIndex(date)];
  }

  static weekdayLabelFromKey(key: string): string | null {
    const index = WEEKDAYS_EN.indexOf(key.trim().toLowerCase() as WeekdayKey);
    return index >= 0 ? WEEKDAYS_PT[index] : null;
  }

  static formatDate(date: string): string {
    const [year, month, day] = date.split('-');
    return `${day}/${month}/${year}`;
  }

  static describeDate(date: string): string {
    return `${ResortClock.weekdayLabel(date)}, ${ResortClock.formatDate(date)}`;
  }
}
