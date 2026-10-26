import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DataSource, In } from 'typeorm';
import type { EntityManager } from 'typeorm';

import type { ExperienceBookingSummary } from '../contracts/chat-actions.js';
import type { GuestContext } from '../guest/guest-context.js';
import type { GuestStay } from '../resort/guest-stay.service.js';
import { ResortClock } from '../resort/resort-clock.service.js';

import { ExperienceBookingPreview } from './entities/experience-booking-preview.entity.js';
import { SimulatedExperienceBooking } from './entities/simulated-experience-booking.entity.js';
import { ExperienceAvailabilityService } from './experience-availability.service.js';
import { quoteExperience } from './experience-pricing.js';
import { evaluateBooking } from './experience-rules.js';
import type { BookingRuleCode } from './experience-rules.js';
import { ExperiencesCatalogService } from './experiences-catalog.service.js';
import type { PartyComposition, PriceQuote } from './experience.types.js';

export interface BookingRequest {
  conversationId: string;
  experienceId: string;
  date: string;
  time: string | null;
  party: PartyComposition;
}

export type PreviewResult =
  | {
      status: 'created';
      previewId: string;
      expiresAt: Date;
      summary: ExperienceBookingSummary;
      quote: PriceQuote;
      warnings: string[];
    }
  | {
      status: 'rejected';
      code: BookingRuleCode | 'experience_not_found';
      message: string;
      options?: string[];
    };

export type ConfirmResult =
  | {
      status: 'confirmed' | 'already_confirmed';
      bookingId: string;
      confirmationCode: string;
      summary: ExperienceBookingSummary;
    }
  | {
      status: 'not_found' | 'expired' | 'cancelled' | 'unavailable' | 'changed';
      message: string;
    };

export interface BookingCardState {
  previewId: string;
  status: 'preview' | 'confirmed' | 'expired' | 'failed' | 'cancelled';
  summary: ExperienceBookingSummary;
  expiresAt: Date;
  updatedAt: Date;
  booking?: { bookingId: string; confirmationCode: string };
  reason?: string;
}

const DEFAULT_TTL_MINUTES = 15;

function summaryOf(
  source: Pick<
    ExperienceBookingPreview,
    | 'experienceId'
    | 'experienceTitle'
    | 'bookingDate'
    | 'bookingTime'
    | 'adults'
    | 'children'
    | 'totalPrice'
  >,
  priceNote: string | null = null,
): ExperienceBookingSummary {
  return {
    experienceId: source.experienceId,
    experienceTitle: source.experienceTitle,
    date: source.bookingDate,
    time: source.bookingTime,
    adults: source.adults,
    children: source.children,
    totalPrice: source.totalPrice,
    currency: 'BRL',
    priceNote,
    simulated: true,
  };
}

/**
 * Pré-reservas e reservas simuladas de experiências.
 * Grava somente no banco interno da IA.
 */
@Injectable()
export class ExperienceBookingService {
  private readonly logger = new Logger(ExperienceBookingService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly catalog: ExperiencesCatalogService,
    private readonly availability: ExperienceAvailabilityService,
    private readonly clock: ResortClock,
    private readonly configService: ConfigService,
  ) {}

  private ttlMinutes(): number {
    const value = Number(this.configService.get<string>('BOOKING_PREVIEW_TTL_MINUTES'));
    return Number.isInteger(value) && value > 0 && value <= 120
      ? value
      : DEFAULT_TTL_MINUTES;
  }

  /**
   * Valida as regras do snapshot e calcula o valor no servidor.
   * Usado tanto na pré-reserva quanto na revalidação da confirmação.
   */
  private async validate(
    stay: GuestStay,
    request: Omit<BookingRequest, 'conversationId'>,
    manager?: EntityManager,
    pinned?: { availabilityId: string; slotId: string | null },
  ) {
    const experience = await this.catalog.findById(request.experienceId);

    if (!experience) {
      return {
        ok: false as const,
        code: 'experience_not_found' as const,
        message: 'Experiência não encontrada no cadastro do resort.',
      };
    }

    const allSlots = await this.availability.findSlots(
      request.date,
      experience.id,
      manager,
    );

    const slots = pinned
      ? allSlots.filter(
          (slot) =>
            slot.availabilityId === pinned.availabilityId &&
            slot.slotId === pinned.slotId,
        )
      : allSlots;

    const evaluation = evaluateBooking({
      experience,
      slots,
      date: request.date,
      time: request.time,
      party: request.party,
      today: this.clock.today(),
      now: this.clock.time(),
      stay,
    });

    if (!evaluation.ok) {
      return evaluation;
    }

    return {
      ...evaluation,
      experience,
      quote: quoteExperience(experience, request.party),
    };
  }

  async preview(
    guest: GuestContext,
    stay: GuestStay,
    request: BookingRequest,
  ): Promise<PreviewResult> {
    const result = await this.validate(stay, request);

    if (!result.ok) {
      return {
        status: 'rejected',
        code: result.code,
        message: result.message,
        options: 'options' in result ? result.options : undefined,
      };
    }

    const { experience, slot, quote, warnings } = result;
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + this.ttlMinutes() * 60_000);

    const preview: Partial<ExperienceBookingPreview> = {
      id,
      resortId: guest.resortId,
      guestId: guest.guestId,
      conversationId: request.conversationId,
      lodgingId: stay.lodgingId,
      experienceId: experience.id,
      experienceTitle: experience.title.slice(0, 255),
      availabilityId: slot.availabilityId,
      slotId: slot.slotId,
      bookingDate: request.date,
      bookingTime: slot.time,
      adults: request.party.adults,
      children: request.party.children,
      totalPrice: quote.total,
      currency: 'BRL',
      priceNote: quote.note?.slice(0, 255) ?? null,
      status: 'pending',
      expiresAt,
    };

    await this.dataSource.getRepository(ExperienceBookingPreview).insert(preview);

    this.logger.log('Pré-reserva simulada criada.');

    return {
      status: 'created',
      previewId: id,
      expiresAt,
      summary: summaryOf(preview as ExperienceBookingPreview, preview.priceNote ?? null),
      quote,
      warnings,
    };
  }

  // Bloqueio nomeado por vaga, para evitar exceder a capacidade
  // em confirmações simultâneas de pré-reservas diferentes.
  private slotLockName(preview: ExperienceBookingPreview): string {
    const digest = createHash('sha256')
      .update(`${preview.availabilityId}:${preview.slotId ?? ''}`)
      .digest('hex')
      .slice(0, 40);

    return `yago-exp-${digest}`;
  }

  private confirmationCode(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = randomBytes(8);
    return `SIM-${[...bytes].map((byte) => alphabet[byte % alphabet.length]).join('')}`;
  }

  /**
   * Confirma uma pré-reserva persistida. Idempotente: confirmar
   * novamente a mesma pré-reserva retorna a reserva existente.
   */
  async confirm(
    guest: GuestContext,
    stay: GuestStay,
    conversationId: string,
    previewId: string,
  ): Promise<ConfirmResult> {
    // Conexão dedicada: o bloqueio da vaga só é liberado depois do
    // commit, para que outra confirmação enxergue esta reserva.
    const runner = this.dataSource.createQueryRunner();
    let lockName: string | null = null;

    await runner.connect();

    try {
      await runner.startTransaction('READ COMMITTED');
      const manager = runner.manager;

      const result = await this.confirmInTransaction(
        manager,
        guest,
        stay,
        conversationId,
        previewId,
        (name) => {
          lockName = name;
        },
      );

      await runner.commitTransaction();

      return result;
    } catch (error) {
      if (runner.isTransactionActive) {
        await runner.rollbackTransaction();
      }

      throw error;
    } finally {
      if (lockName) {
        await runner.query('SELECT RELEASE_LOCK(?)', [lockName]);
      }

      await runner.release();
    }
  }

  private async confirmInTransaction(
    manager: EntityManager,
    guest: GuestContext,
    stay: GuestStay,
    conversationId: string,
    previewId: string,
    onLocked: (lockName: string) => void,
  ): Promise<ConfirmResult> {
    const preview = await manager.findOne(ExperienceBookingPreview, {
      where: {
        id: previewId,
        resortId: guest.resortId,
        guestId: guest.guestId,
        conversationId,
      },
      lock: { mode: 'pessimistic_write' },
    });

    if (
      !preview ||
      preview.lodgingId !== stay.lodgingId ||
      preview.bookingDate < stay.checkIn ||
      preview.bookingDate > stay.checkOut
    ) {
      return {
        status: 'not_found' as const,
        message: 'Pré-reserva não encontrada.',
      };
    }

    if (preview.status === 'confirmed') {
      const existing = await manager.findOneBy(SimulatedExperienceBooking, {
        previewId: preview.id,
      });

      if (existing) {
        return {
          status: 'already_confirmed' as const,
          bookingId: existing.id,
          confirmationCode: existing.confirmationCode,
          summary: summaryOf(existing, preview.priceNote),
        };
      }
    }

    if (preview.status === 'cancelled') {
      return {
        status: 'cancelled' as const,
        message: 'Esta pré-reserva foi cancelada.',
      };
    }

    // Nova tentativa sobre um card que falhou: o motivo registrado é mantido.
    if (preview.status === 'failed') {
      return {
        status: 'unavailable' as const,
        message: preview.failureReason ?? 'Não foi possível confirmar esta pré-reserva.',
      };
    }

    if (preview.status !== 'pending' || preview.expiresAt.getTime() <= Date.now()) {
      if (preview.status === 'pending') {
        await manager.update(ExperienceBookingPreview, { id: preview.id }, { status: 'expired' });
      }

      return {
        status: 'expired' as const,
        message: 'Esta pré-reserva expirou. Posso preparar uma nova, se desejar.',
      };
    }

    const lockName = this.slotLockName(preview);
    const [lock] = (await manager.query('SELECT GET_LOCK(?, 5) AS acquired', [
      lockName,
    ])) as { acquired: number | string | null }[];

    if (Number(lock?.acquired) !== 1) {
      return {
        status: 'unavailable' as const,
        message: 'Não foi possível confirmar agora. Tente novamente em instantes.',
      };
    }

    onLocked(lockName);

    // Revalida as condições no momento da confirmação.
    const check = await this.validate(
      stay,
      {
        experienceId: preview.experienceId,
        date: preview.bookingDate,
        time: preview.bookingTime,
        party: { adults: preview.adults, children: preview.children },
      },
      manager,
      { availabilityId: preview.availabilityId, slotId: preview.slotId },
    );

    // Falhas de revalidação ficam registradas: o card reaberto
    // continua mostrando "não foi possível confirmar" e o motivo.
    if (!check.ok) {
      const reason = `Não foi possível confirmar: ${check.message}`;
      await manager.update(ExperienceBookingPreview, { id: preview.id }, { status: 'failed', failureReason: reason.slice(0, 255) });

      return {
        status: 'unavailable' as const,
        message: reason,
      };
    }

    if (check.quote.total !== preview.totalPrice) {
      const reason = 'O valor cadastrado mudou desde a pré-reserva. Posso preparar uma nova pré-reserva.';
      await manager.update(ExperienceBookingPreview, { id: preview.id }, { status: 'failed', failureReason: reason });

      return {
        status: 'changed' as const,
        message: reason,
      };
    }

    const booking: Partial<SimulatedExperienceBooking> = {
      id: randomUUID(),
      previewId: preview.id,
      confirmationCode: this.confirmationCode(),
      resortId: preview.resortId,
      guestId: preview.guestId,
      conversationId: preview.conversationId,
      lodgingId: preview.lodgingId,
      experienceId: preview.experienceId,
      experienceTitle: preview.experienceTitle,
      availabilityId: preview.availabilityId,
      slotId: preview.slotId,
      bookingDate: preview.bookingDate,
      bookingTime: preview.bookingTime,
      adults: preview.adults,
      children: preview.children,
      totalPrice: preview.totalPrice,
      currency: 'BRL',
      status: 'confirmed',
    };

    // A chave única em preview_id impede uma segunda reserva.
    await manager.insert(SimulatedExperienceBooking, booking);
    await manager.update(ExperienceBookingPreview, { id: preview.id }, { status: 'confirmed' });

    this.logger.log('Reserva simulada confirmada.');

    return {
      status: 'confirmed' as const,
      bookingId: booking.id as string,
      confirmationCode: booking.confirmationCode as string,
      summary: summaryOf(preview, preview.priceNote),
    };
  }

  /**
   * Estado atual dos cards de reserva de uma conversa, lido do banco
   * interno. É a fonte para atualizar um card e reconstruir o histórico.
   */
  async cards(guest: GuestContext, conversationId: string, previewIds: string[]): Promise<BookingCardState[]> {
    if (previewIds.length === 0) {
      return [];
    }

    const previews = await this.dataSource.getRepository(ExperienceBookingPreview).find({
      where: { id: In(previewIds), resortId: guest.resortId, guestId: guest.guestId, conversationId },
    });
    const confirmed = previews.filter((preview) => preview.status === 'confirmed').map(({ id }) => id);
    const bookings = confirmed.length
      ? await this.dataSource.getRepository(SimulatedExperienceBooking).find({ where: { previewId: In(confirmed) } })
      : [];
    const now = Date.now();

    return previews.map((preview) => {
      const booking = bookings.find((item) => item.previewId === preview.id);
      const base = {
        previewId: preview.id,
        summary: summaryOf(preview, preview.priceNote),
        expiresAt: preview.expiresAt,
        updatedAt: preview.updatedAt,
      };

      if (preview.status === 'confirmed' && booking) {
        return { ...base, status: 'confirmed' as const, booking: { bookingId: booking.id, confirmationCode: booking.confirmationCode } };
      }

      if (preview.status === 'pending' && preview.expiresAt.getTime() > now) {
        return { ...base, status: 'preview' as const };
      }

      if (preview.status === 'failed') {
        return { ...base, status: 'failed' as const, reason: preview.failureReason ?? 'Não foi possível confirmar.' };
      }

      if (preview.status === 'cancelled') {
        return { ...base, status: 'cancelled' as const, reason: 'A pré-reserva foi descartada e nada foi registrado.' };
      }

      return { ...base, status: 'expired' as const, reason: 'A pré-reserva expirou. Posso preparar uma nova, se desejar.' };
    });
  }

  async cancelPreview(
    guest: GuestContext,
    conversationId: string,
    previewId: string,
  ): Promise<boolean> {
    const result = await this.dataSource.getRepository(ExperienceBookingPreview).update(
      {
        id: previewId,
        resortId: guest.resortId,
        guestId: guest.guestId,
        conversationId,
        status: 'pending',
      },
      { status: 'cancelled' },
    );

    return (result.affected ?? 0) > 0;
  }

  async listSimulated(
    guest: GuestContext,
    stay: GuestStay,
  ): Promise<SimulatedExperienceBooking[]> {
    const bookings = await this.dataSource.getRepository(SimulatedExperienceBooking).find({
      where: {
        resortId: guest.resortId,
        guestId: guest.guestId,
        lodgingId: stay.lodgingId,
        status: 'confirmed',
      },
      order: { bookingDate: 'ASC', bookingTime: 'ASC' },
      take: 20,
    });

    return bookings.filter(
      (booking) => booking.bookingDate >= stay.checkIn && booking.bookingDate <= stay.checkOut,
    );
  }
}
