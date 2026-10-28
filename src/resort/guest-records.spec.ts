import type { GuestStay } from './guest-stay.service.js';
import { FavoritesService } from './favorites.service.js';
import { LeisureEnrollmentsService } from './leisure-enrollments.service.js';
import { imageFile, RestaurantMenusService } from './restaurant-menus.service.js';
import type { ResortSnapshotGateway } from './resort-snapshot.gateway.js';

const STAY: GuestStay = { resortId: 'demo', holderId: 'holder-1', lodgingId: 9001, checkIn: '2026-10-21', checkOut: '2026-10-25' };
// Parâmetros da subconsulta da estadia: hospedagem, checkout, checkin.
const PARTY = [9001, '2026-10-25', '2026-10-21'];

describe('snapshot readers for menus, favorites and leisure enrollments', () => {
  const select = vi.fn();
  const snapshot = { select } as unknown as ResortSnapshotGateway;

  beforeEach(() => select.mockReset());

  describe('FavoritesService', () => {
    it('reads only "evento" favorites of the stay party within the stay window, one card per event', async () => {
      select.mockResolvedValue([
        { favoriteId: 'f1', eventId: 'e1', title: 'Show de Circo', date: '2026-10-24', time: '22:00', location: 'Teatro' },
        { favoriteId: 'f2', eventId: 'e1', title: 'Show de Circo', date: '2026-10-24', time: '22:00', location: 'Teatro' },
        { favoriteId: 'f3', eventId: 'e2', title: null, date: '2026-10-25', time: null, location: '  ' },
      ]);

      const favorites = await new FavoritesService(snapshot).forStay(STAY);

      expect(favorites).toEqual([
        { favoriteId: 'f1', eventId: 'e1', title: 'Show de Circo', date: '2026-10-24', time: '22:00', location: 'Teatro' },
        { favoriteId: 'f3', eventId: 'e2', title: 'Evento', date: '2026-10-25', time: null, location: null },
      ]);
      const [sql, parameters] = select.mock.calls[0];
      expect(sql).toMatch(/n\.tipo_evento = 'evento'/);
      expect(sql).toMatch(/n\.id_hospede IN \(/);
      expect(parameters).toEqual([...PARTY, '2026-10-21', '2026-10-25']);
    });
  });

  describe('LeisureEnrollmentsService', () => {
    it('scopes enrollments to the stay party and labels them by activity, category or form', async () => {
      select.mockResolvedValue([
        { id: 'a1', activity: 'Hidroginástica', category: 'Adulto', form: 'TERMO', status: 'aprovado', date: '2026-10-22' },
        { id: 'a2', activity: null, category: '4 a 7 anos', form: 'FICHA', status: 'pendente', date: '2026-10-23' },
        { id: 'a3', activity: null, category: null, form: 'TERMO DE AVENTURA', status: 'negado', date: '2026-10-23' },
        { id: 'a4', activity: null, category: null, form: null, status: null, date: null },
      ]);

      const enrollments = await new LeisureEnrollmentsService(snapshot).forStay(STAY);

      expect(enrollments.map(({ title, status }) => [title, status])).toEqual([
        ['Hidroginástica', 'aprovado'],
        ['Recreação: 4 a 7 anos', 'pendente'],
        ['Inscrição de lazer (Termo de aventura)', 'negado'],
        ['Inscrição de lazer', 'desconhecido'],
      ]);
      expect(select.mock.calls[0][1]).toEqual([...PARTY, '2026-10-21', '2026-10-25']);
      expect(select.mock.calls[0][0]).toMatch(/a\.id_hospede IN \(/);
    });
  });

  describe('RestaurantMenusService', () => {
    it('returns active categories with their active dishes, labels subcategories and drops empty ones', async () => {
      select
        .mockResolvedValueOnce([
          { id: 'c1', name: 'Principal', parent: null },
          { id: 'c2', name: 'Vegetariano', parent: 'Principal' },
          { id: 'c3', name: 'Bebidas', parent: null },
        ])
        .mockResolvedValueOnce([
          { id: 'd1', categoryId: 'c1', name: 'Risoto', description: 'Arroz arbóreo. R$ 80,00 por pessoa.', serves: 0, image: 'abc.jpg' },
          { id: 'd2', categoryId: 'c2', name: 'Hikari Vegano', description: null, serves: 1, image: '../x.png' },
        ]);

      const menu = await new RestaurantMenusService(snapshot).forRestaurant('rest-1');

      expect(menu).toEqual({
        restaurantId: 'rest-1',
        categories: [
          // O preço do texto livre não é repetido (summarizeText).
          { id: 'c1', name: 'Principal', dishes: [{ id: 'd1', name: 'Risoto', description: 'Arroz arbóreo.', serves: null, image: 'abc.jpg' }] },
          { id: 'c2', name: 'Principal - Vegetariano', dishes: [{ id: 'd2', name: 'Hikari Vegano', description: null, serves: 1, image: null }] },
        ],
      });
      // Mesmos filtros do app: ativo e ordem > 0, sempre pelo ID do restaurante.
      expect(select.mock.calls[0][0]).toMatch(/situation_catcardapio = 1\s+AND c\.ordem_catcardapio > 0/);
      expect(select.mock.calls[1][0]).toMatch(/situacao_cardapio = 1\s+AND m\.ordem_cardapio > 0/);
      expect(select.mock.calls.map(([, parameters]) => parameters)).toEqual([['rest-1'], ['rest-1']]);
    });

    it('accepts only plain image file names, never paths or URLs', () => {
      expect(imageFile('a1b2-foto.JPG')).toBe('a1b2-foto.JPG');
      expect(imageFile('https://x.y/a.jpg')).toBeNull();
      expect(imageFile('../a.jpg')).toBeNull();
      expect(imageFile('documento.pdf')).toBeNull();
      expect(imageFile(null)).toBeNull();
    });
  });
});
