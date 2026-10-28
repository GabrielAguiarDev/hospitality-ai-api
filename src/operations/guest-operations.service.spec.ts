import { isValidChatAction, type BookingListAction, type CatalogListAction } from '../contracts/chat-actions.js';
import type { IntentDecision } from '../chat/chat-intent.types.js';
import type { GuestContext } from '../guest/guest-context.js';
import type { ResortClock } from '../resort/resort-clock.service.js';

import { GuestOperationsService } from './guest-operations.service.js';
import type { OperationsToolRegistryService } from './operations-tool-registry.service.js';

const GUEST: GuestContext = { resortId: 'demo', guestId: '0a0b0c0d-1111-4222-8333-444455556666' };
const CONTEXT = { conversationId: '6f1c2a5e-8c1d-4b7a-9e2f-3a4b5c6d7e8f', state: {} };

// Sexta-feira, 23/10/2026, 15:00 no resort.
const clock = { today: () => '2026-10-23', time: () => '15:00' } as unknown as ResortClock;

describe('GuestOperationsService', () => {
  let data: Record<string, unknown>;
  const execute = vi.fn(async (name: string) => ({ tool: name, data: data[name] }));
  const service = new GuestOperationsService({ execute } as unknown as OperationsToolRegistryService, clock);
  const decision = (intent: IntentDecision['intent']): IntentDecision => ({ intent, detail: 'none' });

  beforeEach(() => {
    execute.mockClear();
    data = {
      'reservations.list': [],
      'experiences.reservations': { official: [], simulated: [] },
      'favorites.list': [],
    };
  });

  describe('bookings', () => {
    it('answers an empty stay without cards and only with read tools', async () => {
      const result = await service.bookings('Tenho alguma reserva?', decision('reservation.list'), GUEST, CONTEXT);

      expect(result.reply).toBe('Não encontrei reservas de restaurante no seu cadastro.');
      expect(result.actions).toEqual([]);
      expect(execute.mock.calls.map(([name]) => name).sort()).toEqual(['experiences.reservations', 'reservations.list']);
    });

    it('says when there is no future booking for "a próxima", ignoring past and cancelled ones', async () => {
      data['experiences.reservations'] = {
        official: [
          { id: 'x1', title: 'City Tour', date: '2026-10-23', time: '08:00', status: 'pago', participants: 2 },
          { id: 'x2', title: 'Jaqueira', date: '2026-10-24', time: null, status: 'cancelado', participants: 2 },
        ],
        simulated: [],
      };

      const result = await service.bookings('Qual minha próxima reserva?', decision('reservation.list'), GUEST, CONTEXT);

      expect(result.reply).toBe('Você não tem reservas futuras nesta estadia.');
      expect(result.actions?.map(({ type }) => type)).toEqual(['navigate']);
    });

    it('marks simulated chat bookings as not official, in the text and in the card', async () => {
      data['experiences.reservations'] = {
        official: [],
        simulated: [{ id: 'sim-1', experienceTitle: 'City Tour', bookingDate: '2026-10-24', bookingTime: '08:00', adults: 2, children: 0, status: 'confirmed', confirmationCode: 'SIM-AB12CD34' }],
      };

      const result = await service.bookings('Tenho reserva amanhã?', { ...decision('reservation.list'), entities: { date: '2026-10-24' } }, GUEST, CONTEXT);

      expect(result.reply).toBe(
        'Sim, você tem 1 reserva para amanhã: City Tour (amanhã às 08:00). As simuladas foram feitas pelo chat e não estão no sistema oficial do resort.',
      );
      const [list] = result.actions as BookingListAction[];
      expect(list.items[0]).toMatchObject({ simulated: true, statusLabel: 'Simulada (não oficial)', confirmationCode: 'SIM-AB12CD34', buttons: [] });
      expect(result.actions?.every(isValidChatAction)).toBe(true);
    });

    it('filters experiences when asked and opens the Experience tab', async () => {
      data['reservations.list'] = [
        { id: 'r1', restaurantId: 'rest-1', restaurant: 'Omakase', date: '24/10/2026', time: '19:30', reservedAt: '', partySize: 2, status: 'aprovada' },
      ];
      data['experiences.reservations'] = { official: [{ id: 'x1', title: 'City Tour', date: '2026-10-25', time: null, status: 'pendente', participants: 1 }], simulated: [] };

      const result = await service.bookings('Mostre minhas reservas de experiências', decision('reservation.list'), GUEST, CONTEXT);

      expect(result.reply).toBe('Você tem 1 reserva de experiência: City Tour (domingo, 25/10).');
      expect(result.actions?.at(-1)).toMatchObject({ type: 'navigate', screen: 'MyReservation', params: { tab: 'Experience' } });
    });
  });

  describe('favorites', () => {
    it('lists upcoming favorites with numbered buttons and stores them for "o segundo"', async () => {
      data['favorites.list'] = [
        { favoriteId: 'f0', eventId: 'e0', title: 'Passado', date: '2026-10-22', time: '20:00', location: null },
        { favoriteId: 'f1', eventId: 'e1', title: 'Show de Circo', date: '2026-10-23', time: '22:00', location: 'Teatro' },
      ];

      const result = await service.favorites('Mostre meus favoritos', decision('favorite.list'), GUEST, CONTEXT);

      expect(result.reply).toBe('Você tem 1 evento favorito pela frente: Show de Circo (hoje às 22:00).');
      const [list] = result.actions as CatalogListAction[];
      expect(list.items.map(({ id, buttons }) => [id, buttons.map(({ label }) => label)])).toEqual([['e1', ['Ver detalhes', 'Ver em Eventos']]]);
      expect(result.state?.catalog).toEqual({ kind: 'event', listed: [{ id: 'e1', title: 'Show de Circo' }] });
      expect(result.actions?.every(isValidChatAction)).toBe(true);
    });

    it('explains the empty list and that favorites are managed in the Events screen', async () => {
      const empty = await service.favorites('Meus favoritos', decision('favorite.list'), GUEST, CONTEXT);
      expect(empty.reply).toContain('Você ainda não tem eventos favoritos.');

      const manage = await service.favorites('Remove dos favoritos', decision('favorite.manage'), GUEST, CONTEXT);
      expect(manage.reply).toContain('Pelo chat ainda não consigo favoritar nem remover favoritos.');
      // Nenhuma ferramenta de escrita existe para favoritos.
      expect(execute.mock.calls.map(([name]) => name)).toEqual(['favorites.list']);
    });
  });
});
