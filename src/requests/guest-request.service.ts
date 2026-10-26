import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { DataSource, In, LessThan, MoreThanOrEqual } from 'typeorm';

import type { GuestRequestSummary } from '../contracts/chat-actions.js';
import type { GuestContext } from '../guest/guest-context.js';
import type { GuestStay } from '../resort/guest-stay.service.js';
import { RequestsCatalogService, type RequestDepartment } from '../resort/requests-catalog.service.js';

import { SimulatedGuestRequest, type SimulatedRequestItem } from './entities/simulated-guest-request.entity.js';

export interface RequestDraft {
  conversationId: string;
  departmentId: string;
  items: { itemId: string; quantity: number }[];
  note: string | null;
}

export type RequestPreviewResult =
  | { status: 'created'; previewId: string; expiresAt: Date; summary: GuestRequestSummary; notes: string[] }
  | { status: 'rejected'; message: string };

export type RequestConfirmResult =
  | { status: 'confirmed' | 'already_confirmed'; protocol: string; summary: GuestRequestSummary }
  | { status: 'not_found' | 'expired' | 'cancelled'; message: string };

export interface RequestCardState {
  previewId: string;
  status: 'preview' | 'confirmed' | 'expired' | 'cancelled';
  summary: GuestRequestSummary;
  expiresAt: Date;
  updatedAt: Date;
  protocol?: string;
  reason?: string;
}

export interface SimulatedRequestRecord {
  id: string;
  protocol: string;
  departmentName: string;
  items: SimulatedRequestItem[];
  confirmedAt: Date;
}

const DEFAULT_TTL_MINUTES = 15;
// Limites anti-abuso da demonstração.
const MAX_OPEN_PREVIEWS = 5;
const MAX_CONFIRMED_PER_DAY = 10;
const MAX_ITEMS = 10;
const NOTE_MAX = 500;
const CARD_NOTE_MAX = 200;

/**
 * Nota livre do hóspede: texto simples, sem caracteres de controle,
 * de largura zero ou de direção. Nunca vai ao modelo nem ao estado.
 */
export function sanitizeNote(value: string | null | undefined): string | null {
  const text = (value ?? '')
    // oxlint-disable-next-line no-control-regex -- remover caracteres de controle é o objetivo.
    .replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u206f\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, NOTE_MAX) : null;
}

const cardNote = (note: string | null) =>
  note && note.length > CARD_NOTE_MAX ? `${note.slice(0, CARD_NOTE_MAX - 1).trimEnd()}…` : note;

function summaryOf(row: Pick<SimulatedGuestRequest, 'departmentId' | 'departmentName' | 'items' | 'note'>): GuestRequestSummary {
  return {
    departmentId: row.departmentId,
    departmentName: row.departmentName,
    items: row.items.map(({ itemId, name, quantity }) => ({ itemId, name, quantity })),
    note: cardNote(row.note),
    simulated: true,
  };
}

/**
 * Solicitações SIMULADAS: gravadas só no banco interno da IA, nunca no
 * snapshot nem no sistema do resort. Toda leitura e escrita é filtrada
 * por resort, hóspede e conversa; a confirmação confere a estadia.
 */
@Injectable()
export class GuestRequestService {
  private readonly logger = new Logger(GuestRequestService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly catalog: RequestsCatalogService,
    private readonly configService: ConfigService,
  ) {}

  private ttlMinutes(): number {
    const value = Number(this.configService.get<string>('BOOKING_PREVIEW_TTL_MINUTES'));
    return Number.isInteger(value) && value > 0 && value <= 120 ? value : DEFAULT_TTL_MINUTES;
  }

  // Avisos do departamento exibidos no card: horário de atendimento e prazos.
  static departmentNotes(department: RequestDepartment): string[] {
    return department.info
      .filter(({ title, description }) => /\b(?:\d{1,2}\s*h|hor[aá]ri|prazo|atendid|funcionamento)/i.test(`${title} ${description ?? ''}`))
      .slice(0, 2)
      .map(({ title, description }) => {
        const text = description ? `${title.replace(/[.:]$/, '')}: ${description}` : title;
        return text.length > 200 ? `${text.slice(0, 199).trimEnd()}…` : text;
      });
  }

  /**
   * Valida departamento e itens contra o catálogo ativo do snapshot e
   * grava a pré-visualização. Os nomes vêm do cadastro, nunca do texto.
   */
  async preview(guest: GuestContext, stay: GuestStay, draft: RequestDraft): Promise<RequestPreviewResult> {
    const department = (await this.catalog.departments()).find(({ id }) => id === draft.departmentId);
    const itemIds = draft.items.map(({ itemId }) => itemId);

    if (
      !department ||
      draft.items.length === 0 ||
      draft.items.length > MAX_ITEMS ||
      new Set(itemIds).size !== itemIds.length ||
      draft.items.some(({ quantity }) => !Number.isInteger(quantity) || quantity < 1 || quantity > 10)
    ) {
      return { status: 'rejected', message: 'Não consegui preparar essa solicitação com os itens do cadastro.' };
    }

    const items: SimulatedRequestItem[] = [];

    for (const { itemId, quantity } of draft.items) {
      const item = department.items.find(({ id }) => id === itemId);
      if (!item) {
        return { status: 'rejected', message: 'Esse item não está disponível no cadastro do departamento.' };
      }
      items.push({ itemId: item.id, name: item.name, quantity });
    }

    const repository = this.dataSource.getRepository(SimulatedGuestRequest);
    const owner = { resortId: guest.resortId, guestId: guest.guestId };
    const now = new Date();

    // Pré-visualizações vencidas do hóspede expiram e perdem a nota.
    await repository.update({ ...owner, status: 'preview', expiresAt: LessThan(now) }, { status: 'expired', note: null });

    // Limites por hóspede e estadia, não por conversa: cada conversa nova não renova a cota.
    const stayOwner = { ...owner, lodgingId: stay.lodgingId, stayCheckIn: stay.checkIn };
    const [openPreviews, confirmedToday] = await Promise.all([
      repository.count({ where: { ...stayOwner, status: 'preview' } }),
      repository.count({ where: { ...stayOwner, status: 'confirmed', confirmedAt: MoreThanOrEqual(new Date(now.getTime() - 86_400_000)) } }),
    ]);

    if (openPreviews >= MAX_OPEN_PREVIEWS) {
      return {
        status: 'rejected',
        message: 'Você já tem solicitações simuladas aguardando confirmação. Confirme ou descarte as anteriores, ou use a tela de Solicitações.',
      };
    }

    if (confirmedToday >= MAX_CONFIRMED_PER_DAY) {
      return {
        status: 'rejected',
        message: 'O limite de solicitações simuladas pelo chat nas últimas 24 horas foi atingido. Use a tela de Solicitações.',
      };
    }

    const row = repository.create({
      id: randomUUID(),
      ...owner,
      conversationId: draft.conversationId,
      lodgingId: stay.lodgingId,
      stayCheckIn: stay.checkIn,
      departmentId: department.id,
      departmentName: department.name,
      items,
      note: sanitizeNote(draft.note),
      status: 'preview',
      protocol: null,
      expiresAt: new Date(now.getTime() + this.ttlMinutes() * 60_000),
      confirmedAt: null,
    });

    await repository.insert(row);
    this.logger.log('Solicitação simulada preparada.');

    return {
      status: 'created',
      previewId: row.id,
      expiresAt: row.expiresAt,
      summary: summaryOf(row),
      notes: GuestRequestService.departmentNotes(department),
    };
  }

  private protocol(): string {
    return `SIM-${randomBytes(4).toString('hex').toUpperCase()}`;
  }

  /**
   * Transição atômica preview → confirmed, idempotente: um segundo toque
   * (ou "confirmo" junto com o botão) devolve o mesmo protocolo.
   */
  async confirm(guest: GuestContext, stay: GuestStay, conversationId: string, previewId: string): Promise<RequestConfirmResult> {
    // Catálogo lido antes do bloqueio da linha; a conferência é feita sob o bloqueio.
    const departments = await this.catalog.departments();
    const department = (departmentId: string) => departments.find(({ id }) => id === departmentId);

    try {
      return await this.confirmOnce(guest, stay, conversationId, previewId, department);
    } catch (error) {
      // Colisão rara do protocolo aleatório: uma nova tentativa gera outro.
      if ((error as { code?: string })?.code !== 'ER_DUP_ENTRY') throw error;
      return this.confirmOnce(guest, stay, conversationId, previewId, department);
    }
  }

  private confirmOnce(
    guest: GuestContext,
    stay: GuestStay,
    conversationId: string,
    previewId: string,
    department: (departmentId: string) => RequestDepartment | undefined,
  ): Promise<RequestConfirmResult> {
    return this.dataSource.transaction(async (manager) => {
      const row = await manager.findOne(SimulatedGuestRequest, {
        where: { id: previewId, resortId: guest.resortId, guestId: guest.guestId, conversationId },
        lock: { mode: 'pessimistic_write' },
      });

      // Outra estadia (o alojamento é reutilizado): como se não existisse.
      if (!row || row.lodgingId !== stay.lodgingId || row.stayCheckIn !== stay.checkIn) {
        return { status: 'not_found', message: 'Solicitação não encontrada.' };
      }

      if (row.status === 'confirmed' && row.protocol) {
        return { status: 'already_confirmed', protocol: row.protocol, summary: summaryOf(row) };
      }

      if (row.status === 'cancelled') {
        return { status: 'cancelled', message: 'Essa solicitação foi descartada.' };
      }

      const current = department(row.departmentId);
      const stillActive = Boolean(current && row.items.every(({ itemId }) => current.items.some(({ id }) => id === itemId)));

      if (row.status === 'expired' || row.expiresAt.getTime() <= Date.now() || !stillActive) {
        await manager.update(SimulatedGuestRequest, { id: row.id }, { status: 'expired', note: null });
        return {
          status: 'expired',
          message: stillActive
            ? 'A solicitação expirou. Se ainda precisar, é só pedir de novo.'
            : 'Um dos itens não está mais disponível no cadastro. Se ainda precisar, peça de novo.',
        };
      }

      const protocol = this.protocol();
      await manager.update(SimulatedGuestRequest, { id: row.id, status: 'preview' }, { status: 'confirmed', protocol, confirmedAt: new Date() });
      this.logger.log('Solicitação simulada confirmada.');

      return { status: 'confirmed', protocol, summary: summaryOf(row) };
    });
  }

  async cancel(guest: GuestContext, conversationId: string, previewId: string): Promise<boolean> {
    const result = await this.dataSource.getRepository(SimulatedGuestRequest).update(
      { id: previewId, resortId: guest.resortId, guestId: guest.guestId, conversationId, status: 'preview' },
      // A nota do hóspede não fica guardada depois do descarte.
      { status: 'cancelled', note: null },
    );
    return Boolean(result.affected);
  }

  /** Estado atual dos cards da conversa, somente do dono. */
  async cards(guest: GuestContext, conversationId: string, previewIds: string[]): Promise<RequestCardState[]> {
    if (previewIds.length === 0) return [];

    const rows = await this.dataSource.getRepository(SimulatedGuestRequest).find({
      where: { id: In(previewIds.slice(0, 200)), resortId: guest.resortId, guestId: guest.guestId, conversationId },
    });
    const now = Date.now();

    return rows.map((row) => {
      const base = { previewId: row.id, summary: summaryOf(row), expiresAt: row.expiresAt, updatedAt: row.updatedAt };

      if (row.status === 'confirmed' && row.protocol) return { ...base, status: 'confirmed', protocol: row.protocol };
      if (row.status === 'cancelled') return { ...base, status: 'cancelled', reason: 'Solicitação descartada. Nada foi registrado.' };
      if (row.status === 'preview' && row.expiresAt.getTime() > now) return { ...base, status: 'preview' };
      return { ...base, status: 'expired', reason: 'A solicitação expirou antes da confirmação.' };
    });
  }

  /** Solicitações simuladas confirmadas na estadia atual. */
  async listForStay(guest: GuestContext, stay: GuestStay): Promise<SimulatedRequestRecord[]> {
    const rows = await this.dataSource.getRepository(SimulatedGuestRequest).find({
      where: { resortId: guest.resortId, guestId: guest.guestId, lodgingId: stay.lodgingId, stayCheckIn: stay.checkIn, status: 'confirmed' },
      order: { confirmedAt: 'DESC' },
      take: 20,
    });

    return rows.flatMap((row) =>
      row.protocol && row.confirmedAt
        ? [{ id: row.id, protocol: row.protocol, departmentName: row.departmentName, items: row.items, confirmedAt: row.confirmedAt }]
        : [],
    );
  }
}
