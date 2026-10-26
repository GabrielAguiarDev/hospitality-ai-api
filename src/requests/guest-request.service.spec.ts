import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { InMemoryGuestRequests } from '../../test/support/in-memory-guest-requests.js';
import { REQUEST_DEPARTMENTS } from '../../test/support/request-fixtures.js';
import type { GuestContext } from '../guest/guest-context.js';
import type { GuestStay } from '../resort/guest-stay.service.js';
import type { RequestDepartment, RequestsCatalogService } from '../resort/requests-catalog.service.js';

import { GuestRequestService, sanitizeNote, type RequestDraft } from './guest-request.service.js';

const GUEST: GuestContext = { resortId: 'demo', guestId: '0a0b0c0d-1111-4222-8333-444455556666' };
const OTHER: GuestContext = { resortId: 'demo', guestId: '0f0e0d0c-9999-4888-8777-666655554444' };
const OTHER_RESORT: GuestContext = { resortId: 'other', guestId: GUEST.guestId };
const STAY: GuestStay = { resortId: 'demo', holderId: GUEST.guestId, lodgingId: 12, checkIn: '2026-10-21', checkOut: '2026-10-25' };
const NEXT_STAY: GuestStay = { ...STAY, checkIn: '2026-11-02', checkOut: '2026-11-05' };
const OTHER_LODGING: GuestStay = { ...STAY, lodgingId: 99 };
const CONVERSATION = '0b5c2a5e-8c1d-4b7a-9e2f-3a4b5c6d7e8f';
const OTHER_CONVERSATION = '9b5c2a5e-8c1d-4b7a-9e2f-3a4b5c6d7e8f';
// Limite de pré-visualizações abertas por hóspede e estadia (MAX_OPEN_PREVIEWS do serviço).
const OPEN_LIMIT = 5;
const NOW = new Date('2026-10-23T15:00:00Z');

const draft = (overrides: Partial<RequestDraft> = {}): RequestDraft => ({
  conversationId: CONVERSATION,
  departmentId: '3',
  items: [{ itemId: '30', quantity: 2 }],
  note: null,
  ...overrides,
});

describe('GuestRequestService', () => {
  let rows: InMemoryGuestRequests;
  let departments: RequestDepartment[];
  let service: GuestRequestService;

  const build = (config: Record<string, string> = {}) =>
    new GuestRequestService(
      rows.dataSource,
      { departments: vi.fn(async () => structuredClone(departments)) } as unknown as RequestsCatalogService,
      new ConfigService(config),
    );

  const created = async (overrides: Partial<RequestDraft> = {}, guest = GUEST, stay = STAY) => {
    const result = await service.preview(guest, stay, draft(overrides));
    if (result.status !== 'created') throw new Error(`preview rejected: ${result.message}`);
    return result;
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    rows = new InMemoryGuestRequests();
    departments = structuredClone(REQUEST_DEPARTMENTS);
    service = build();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('sanitizeNote', () => {
    it('returns null for empty or whitespace-only notes', () => {
      expect(sanitizeNote(null)).toBeNull();
      expect(sanitizeNote(undefined)).toBeNull();
      expect(sanitizeNote('   \n\t ')).toBeNull();
    });

    it('strips control, zero-width and bidi characters and collapses whitespace', () => {
      const dirty = 'Quarto\u0000 12‮ ​⁦toalhas⁩\u0007\n\n  extras\u007f\u009f﻿';

      expect(sanitizeNote(dirty)).toBe('Quarto 12 toalhas extras');
    });

    it('also strips line/paragraph separators and the Arabic letter mark', () => {
      expect(sanitizeNote('a\u2028b\u2029c\u061Cd')).toBe('a b c d');
    });

    it('keeps accents, punctuation and normal text untouched', () => {
      expect(sanitizeNote('  Preciso de toalhas, por favor! (urgente)  ')).toBe('Preciso de toalhas, por favor! (urgente)');
    });

    it('caps the note at 500 characters', () => {
      expect(sanitizeNote('a'.repeat(900))).toHaveLength(500);
    });
  });

  describe('departmentNotes', () => {
    it('keeps only notices about hours and deadlines, at most 2, capped at 200 characters', () => {
      const notes = GuestRequestService.departmentNotes({
        id: '1',
        name: 'Governança',
        description: null,
        items: [],
        info: [
          { title: 'Atendimento', description: 'Das 7h às 22h' },
          { title: 'Cor do uniforme', description: 'Azul' },
          { title: 'Prazo de entrega.', description: 'Até 30 minutos' },
          { title: 'Horário de funcionamento', description: 'x'.repeat(400) },
        ],
      });

      expect(notes).toHaveLength(2);
      expect(notes[0]).toBe('Atendimento: Das 7h às 22h');
      expect(notes[1]).toBe('Prazo de entrega: Até 30 minutos');
    });

    it('truncates a long notice with an ellipsis', () => {
      const [note] = GuestRequestService.departmentNotes({
        id: '1',
        name: 'X',
        description: null,
        items: [],
        info: [{ title: 'Horário de funcionamento', description: 'y'.repeat(400) }],
      });

      expect(note).toHaveLength(200);
      expect(note.endsWith('…')).toBe(true);
    });
  });

  it('recognizes a notice titled "Horário" (accented)', () => {
    const notes = GuestRequestService.departmentNotes({
      id: '1',
      name: 'X',
      description: null,
      items: [],
      info: [{ title: 'Horário', description: 'Manhã e tarde' }],
    });

    expect(notes).toEqual(['Horário: Manhã e tarde']);
  });

  describe('preview', () => {
    it('stores a preview with names from the catalog, owner, stay and a 15 minute expiry', async () => {
      const result = await created({ items: [{ itemId: '30', quantity: 2 }, { itemId: '31', quantity: 1 }], note: 'Quarto 12' });

      expect(result.summary).toEqual({
        departmentId: '3',
        departmentName: 'Governança',
        items: [
          { itemId: '30', name: 'Toalha de banho', quantity: 2 },
          { itemId: '31', name: 'Travesseiro', quantity: 1 },
        ],
        note: 'Quarto 12',
        simulated: true,
      });
      expect(result.notes).toEqual(['Atendimento: Das 7h às 22h']);
      expect(result.expiresAt).toEqual(new Date(NOW.getTime() + 15 * 60_000));
      expect(rows.get(result.previewId)).toMatchObject({
        resortId: 'demo',
        guestId: GUEST.guestId,
        conversationId: CONVERSATION,
        lodgingId: 12,
        stayCheckIn: '2026-10-21',
        status: 'preview',
        protocol: null,
        confirmedAt: null,
      });
    });

    it('honors BOOKING_PREVIEW_TTL_MINUTES within 1..120 and ignores invalid values', async () => {
      for (const [value, minutes] of [['30', 30], ['0', 15], ['121', 15], ['abc', 15], ['2.5', 15]] as const) {
        service = build({ BOOKING_PREVIEW_TTL_MINUTES: value });
        const { expiresAt } = await created();
        expect(expiresAt, value).toEqual(new Date(NOW.getTime() + minutes * 60_000));
        rows.rows.clear();
      }
    });

    it.each([
      ['an unknown department', { departmentId: '404' }],
      ['an unknown item', { items: [{ itemId: '999', quantity: 1 }] }],
      ['an item from another department', { items: [{ itemId: '50', quantity: 1 }] }],
      ['no items', { items: [] }],
      ['a repeated item', { items: [{ itemId: '30', quantity: 1 }, { itemId: '30', quantity: 2 }] }],
      ['more than 10 items', { items: Array.from({ length: 11 }, (_, index) => ({ itemId: `x${index}`, quantity: 1 })) }],
      ['quantity 0', { items: [{ itemId: '30', quantity: 0 }] }],
      ['a negative quantity', { items: [{ itemId: '30', quantity: -1 }] }],
      ['quantity 11', { items: [{ itemId: '30', quantity: 11 }] }],
      ['a fractional quantity', { items: [{ itemId: '30', quantity: 1.5 }] }],
      ['a NaN quantity', { items: [{ itemId: '30', quantity: Number.NaN }] }],
    ] as [string, Partial<RequestDraft>][])('rejects %s without writing anything', async (_title, overrides) => {
      const result = await service.preview(GUEST, STAY, draft(overrides));

      expect(result.status).toBe('rejected');
      expect(rows.all()).toHaveLength(0);
    });

    it('rejects an inactive item (absent from the active catalog)', async () => {
      departments[0].items = departments[0].items.filter(({ id }) => id !== '30');

      const result = await service.preview(GUEST, STAY, draft());

      expect(result).toMatchObject({ status: 'rejected', message: expect.stringContaining('cadastro') });
      expect(rows.all()).toHaveLength(0);
    });

    it('accepts exactly 10 distinct items and quantity 10', async () => {
      departments[0].items = Array.from({ length: 10 }, (_, index) => ({ id: `i${index}`, name: `Item ${index}` }));

      const result = await created({ items: departments[0].items.map(({ id }) => ({ itemId: id, quantity: 10 })) });

      expect(result.summary.items).toHaveLength(10);
    });

    it('stores a sanitized note and shows at most 200 characters of it in the summary', async () => {
      const result = await created({ note: `Quarto‮ 12 ${'z'.repeat(700)}` });
      const stored = rows.get(result.previewId);

      expect(stored?.note).toHaveLength(500);
      expect(stored?.note).not.toMatch(/[‮\u0000-\u001f]/);
      expect(result.summary.note).toHaveLength(200);
      expect(result.summary.note?.endsWith('…')).toBe(true);
    });

    it('limits open previews to 5 per guest and stay, across conversations', async () => {
      for (let index = 0; index < OPEN_LIMIT - 1; index += 1) await created();
      await created({ conversationId: OTHER_CONVERSATION });

      const fourth = await service.preview(GUEST, STAY, draft());
      expect(fourth).toMatchObject({ status: 'rejected', message: expect.stringContaining('aguardando confirmação') });
      // Uma conversa nova não renova a cota.
      await expect(service.preview(GUEST, STAY, draft({ conversationId: '8b5c2a5e-8c1d-4b7a-9e2f-3a4b5c6d7e8f' }))).resolves.toMatchObject({ status: 'rejected' });
      expect(rows.all()).toHaveLength(OPEN_LIMIT);

      // Outro hóspede e outra estadia têm a própria cota.
      await expect(service.preview(OTHER, STAY, draft({ conversationId: OTHER_CONVERSATION }))).resolves.toMatchObject({ status: 'created' });
      await expect(service.preview(GUEST, NEXT_STAY, draft())).resolves.toMatchObject({ status: 'created' });
    });

    it('frees the quota when a preview is confirmed or cancelled', async () => {
      const first = await created();
      const second = await created();
      for (let index = 2; index < OPEN_LIMIT; index += 1) await created();

      await service.cancel(GUEST, CONVERSATION, first.previewId);
      await expect(service.preview(GUEST, STAY, draft())).resolves.toMatchObject({ status: 'created' });
      await service.confirm(GUEST, STAY, CONVERSATION, second.previewId);
      await expect(service.preview(GUEST, STAY, draft())).resolves.toMatchObject({ status: 'created' });
    });

    it('expires overdue previews of the guest (nulling their note) before counting', async () => {
      const old = await created({ note: 'Quarto 12' });
      for (let index = 1; index < OPEN_LIMIT; index += 1) await created();
      vi.setSystemTime(new Date(NOW.getTime() + 16 * 60_000));

      await expect(service.preview(GUEST, STAY, draft())).resolves.toMatchObject({ status: 'created' });
      expect(rows.get(old.previewId)).toMatchObject({ status: 'expired', note: null });
    });

    it('limits confirmed requests to 10 per stay in 24 hours', async () => {
      for (let index = 0; index < 10; index += 1) {
        const { previewId } = await created();
        await service.confirm(GUEST, STAY, CONVERSATION, previewId);
      }

      await expect(service.preview(GUEST, STAY, draft())).resolves.toMatchObject({
        status: 'rejected',
        message: expect.stringContaining('24 horas'),
      });
      // Outra estadia do mesmo alojamento (novo check-in) e outro hóspede não são afetados.
      await expect(service.preview(GUEST, NEXT_STAY, draft())).resolves.toMatchObject({ status: 'created' });
      await expect(service.preview(OTHER, STAY, draft({ conversationId: OTHER_CONVERSATION }))).resolves.toMatchObject({ status: 'created' });

      // Depois de 24 horas, a cota volta.
      vi.setSystemTime(new Date(NOW.getTime() + 25 * 3_600_000));
      await expect(service.preview(GUEST, STAY, draft())).resolves.toMatchObject({ status: 'created' });
    });
  });

  describe('confirm', () => {
    it('confirms once with a SIM protocol and persists the transition', async () => {
      const { previewId } = await created({ note: 'Quarto 12' });

      const result = await service.confirm(GUEST, STAY, CONVERSATION, previewId);

      expect(result).toMatchObject({ status: 'confirmed', protocol: expect.stringMatching(/^SIM-[0-9A-F]{8}$/) });
      expect(rows.get(previewId)).toMatchObject({ status: 'confirmed', protocol: (result as { protocol: string }).protocol, confirmedAt: expect.any(Date) });
    });

    it('is idempotent: a second confirm returns already_confirmed with the same protocol', async () => {
      const { previewId } = await created();
      const first = await service.confirm(GUEST, STAY, CONVERSATION, previewId);
      const second = await service.confirm(GUEST, STAY, CONVERSATION, previewId);

      expect(first.status).toBe('confirmed');
      expect(second.status).toBe('already_confirmed');
      expect((second as { protocol: string }).protocol).toBe((first as { protocol: string }).protocol);
      expect(rows.all()).toHaveLength(1);
    });

    it('confirms only once even with concurrent taps', async () => {
      const { previewId } = await created();

      const results = await Promise.all([
        service.confirm(GUEST, STAY, CONVERSATION, previewId),
        service.confirm(GUEST, STAY, CONVERSATION, previewId),
      ]);

      expect(results.map(({ status }) => status).sort()).toEqual(['already_confirmed', 'confirmed']);
      expect(new Set(results.map((result) => (result as { protocol: string }).protocol)).size).toBe(1);
    });

    it.each([
      ['another guest', OTHER, STAY, CONVERSATION],
      ['another resort', OTHER_RESORT, STAY, CONVERSATION],
      ['another conversation of the same guest', GUEST, STAY, OTHER_CONVERSATION],
      ['another lodging', GUEST, OTHER_LODGING, CONVERSATION],
      ['another stay in the same lodging (new check-in)', GUEST, NEXT_STAY, CONVERSATION],
    ] as [string, GuestContext, GuestStay, string][])('answers not_found to %s, leaving the preview untouched', async (_title, guest, stay, conversation) => {
      const { previewId } = await created();

      const result = await service.confirm(guest, stay, conversation, previewId);

      expect(result).toEqual({ status: 'not_found', message: 'Solicitação não encontrada.' });
      expect(rows.get(previewId)).toMatchObject({ status: 'preview', protocol: null });
    });

    it('answers not_found to an unknown previewId', async () => {
      await expect(service.confirm(GUEST, STAY, CONVERSATION, '7c5c2a5e-8c1d-4b7a-9e2f-3a4b5c6d7e8f')).resolves.toMatchObject({ status: 'not_found' });
    });

    it('expires after the TTL, nulls the note and never confirms', async () => {
      const { previewId } = await created({ note: 'Quarto 12' });
      vi.setSystemTime(new Date(NOW.getTime() + 16 * 60_000));

      const result = await service.confirm(GUEST, STAY, CONVERSATION, previewId);

      expect(result).toMatchObject({ status: 'expired', message: expect.stringContaining('expirou') });
      expect(rows.get(previewId)).toMatchObject({ status: 'expired', note: null, protocol: null });
    });

    it('stays expired on later attempts', async () => {
      const { previewId } = await created();
      vi.setSystemTime(new Date(NOW.getTime() + 16 * 60_000));
      await service.confirm(GUEST, STAY, CONVERSATION, previewId);

      await expect(service.confirm(GUEST, STAY, CONVERSATION, previewId)).resolves.toMatchObject({ status: 'expired' });
    });

    it('expires when an item left the active catalog, with a specific message', async () => {
      const { previewId } = await created({ note: 'Quarto 12' });
      departments[0].items = departments[0].items.filter(({ id }) => id !== '30');

      const result = await service.confirm(GUEST, STAY, CONVERSATION, previewId);

      expect(result).toMatchObject({ status: 'expired', message: expect.stringContaining('não está mais disponível') });
      expect(rows.get(previewId)).toMatchObject({ status: 'expired', note: null });
    });

    it('expires when the whole department was deactivated', async () => {
      const { previewId } = await created();
      departments = departments.filter(({ id }) => id !== '3');

      await expect(service.confirm(GUEST, STAY, CONVERSATION, previewId)).resolves.toMatchObject({ status: 'expired' });
    });

    it('retries once on a protocol collision (ER_DUP_ENTRY) and then confirms', async () => {
      const { previewId } = await created();
      vi.mocked(rows.dataSource.transaction).mockRejectedValueOnce(Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' }));

      await expect(service.confirm(GUEST, STAY, CONVERSATION, previewId)).resolves.toMatchObject({ status: 'confirmed' });
      expect(rows.dataSource.transaction).toHaveBeenCalledTimes(2);
    });

    it('does not retry other database errors', async () => {
      const { previewId } = await created();
      vi.mocked(rows.dataSource.transaction).mockRejectedValueOnce(Object.assign(new Error('lock timeout'), { code: 'ER_LOCK_WAIT_TIMEOUT' }));

      await expect(service.confirm(GUEST, STAY, CONVERSATION, previewId)).rejects.toThrow('lock timeout');
      expect(rows.dataSource.transaction).toHaveBeenCalledOnce();
    });

    it('does not confirm a cancelled preview', async () => {
      const { previewId } = await created();
      await service.cancel(GUEST, CONVERSATION, previewId);

      await expect(service.confirm(GUEST, STAY, CONVERSATION, previewId)).resolves.toMatchObject({ status: 'cancelled' });
      expect(rows.get(previewId)?.protocol).toBeNull();
    });
  });

  describe('cancel', () => {
    it('cancels the owner preview and drops the guest note', async () => {
      const { previewId } = await created({ note: 'Quarto 12' });

      await expect(service.cancel(GUEST, CONVERSATION, previewId)).resolves.toBe(true);

      expect(rows.get(previewId)).toMatchObject({ status: 'cancelled', note: null });
    });

    it.each([
      ['another guest', OTHER, CONVERSATION],
      ['another resort', OTHER_RESORT, CONVERSATION],
      ['another conversation', GUEST, OTHER_CONVERSATION],
    ] as [string, GuestContext, string][])('does nothing for %s', async (_title, guest, conversation) => {
      const { previewId } = await created({ note: 'Quarto 12' });

      await expect(service.cancel(guest, conversation, previewId)).resolves.toBe(false);

      expect(rows.get(previewId)).toMatchObject({ status: 'preview', note: 'Quarto 12' });
    });

    it('never cancels an already confirmed request', async () => {
      const { previewId } = await created();
      await service.confirm(GUEST, STAY, CONVERSATION, previewId);

      await expect(service.cancel(GUEST, CONVERSATION, previewId)).resolves.toBe(false);
      expect(rows.get(previewId)?.status).toBe('confirmed');
    });

    it('returns false the second time', async () => {
      const { previewId } = await created();
      await service.cancel(GUEST, CONVERSATION, previewId);

      await expect(service.cancel(GUEST, CONVERSATION, previewId)).resolves.toBe(false);
    });
  });

  describe('cards', () => {
    it('reports preview, confirmed, cancelled and expired states from the database', async () => {
      const preview = await created();
      const confirmed = await created();
      const cancelled = await created();
      const { protocol } = (await service.confirm(GUEST, STAY, CONVERSATION, confirmed.previewId)) as { protocol: string };
      await service.cancel(GUEST, CONVERSATION, cancelled.previewId);

      const cards = await service.cards(GUEST, CONVERSATION, [preview.previewId, confirmed.previewId, cancelled.previewId]);
      const byId = Object.fromEntries(cards.map((card) => [card.previewId, card]));

      expect(byId[preview.previewId]).toMatchObject({ status: 'preview' });
      expect(byId[confirmed.previewId]).toMatchObject({ status: 'confirmed', protocol });
      expect(byId[cancelled.previewId]).toMatchObject({ status: 'cancelled', reason: expect.stringContaining('descartada') });

      vi.setSystemTime(new Date(NOW.getTime() + 16 * 60_000));
      const [late] = await service.cards(GUEST, CONVERSATION, [preview.previewId]);
      expect(late).toMatchObject({ status: 'expired', reason: expect.stringContaining('expirou') });
    });

    it('returns nothing for another guest, another conversation or no ids', async () => {
      const { previewId } = await created();

      await expect(service.cards(OTHER, CONVERSATION, [previewId])).resolves.toEqual([]);
      await expect(service.cards(GUEST, OTHER_CONVERSATION, [previewId])).resolves.toEqual([]);
      await expect(service.cards(GUEST, CONVERSATION, [])).resolves.toEqual([]);
    });

    it('shows a note of at most 200 characters', async () => {
      const { previewId } = await created({ note: 'n'.repeat(450) });

      const [card] = await service.cards(GUEST, CONVERSATION, [previewId]);

      expect(card.summary.note).toHaveLength(200);
    });
  });

  describe('listForStay', () => {
    it('lists only confirmed requests of the same guest and stay, newest first', async () => {
      const first = await created();
      await service.confirm(GUEST, STAY, CONVERSATION, first.previewId);
      vi.setSystemTime(new Date(NOW.getTime() + 60_000));
      const second = await created({ items: [{ itemId: '31', quantity: 1 }] });
      await service.confirm(GUEST, STAY, CONVERSATION, second.previewId);
      await created();
      const hidden = await created({ conversationId: OTHER_CONVERSATION });
      await service.cancel(GUEST, OTHER_CONVERSATION, hidden.previewId);
      const theirs = await created({ conversationId: OTHER_CONVERSATION }, OTHER);
      await service.confirm(OTHER, STAY, OTHER_CONVERSATION, theirs.previewId);

      const list = await service.listForStay(GUEST, STAY);

      expect(list.map(({ id }) => id)).toEqual([second.previewId, first.previewId]);
      expect(list[0]).toMatchObject({ departmentName: 'Governança', protocol: expect.stringMatching(/^SIM-/) });
      await expect(service.listForStay(GUEST, NEXT_STAY)).resolves.toEqual([]);
      await expect(service.listForStay(GUEST, OTHER_LODGING)).resolves.toEqual([]);
    });
  });
});
