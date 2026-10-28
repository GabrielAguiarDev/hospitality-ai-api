import { ConfigService } from '@nestjs/config';
import type { Provider } from '@nestjs/common';
import { vi } from 'vitest';

import { GuestRequestService } from '../../src/requests/guest-request.service.js';
import { GuestOperationsService } from '../../src/operations/guest-operations.service.js';
import { ModuleOperationsService } from '../../src/operations/module-operations.service.js';
import { FavoritesService } from '../../src/resort/favorites.service.js';
import { LeisureEnrollmentsService } from '../../src/resort/leisure-enrollments.service.js';
import { RestaurantMenusService } from '../../src/resort/restaurant-menus.service.js';
import { ModulesCatalogService } from '../../src/resort/modules-catalog.service.js';
import { RequestsCatalogService, type RequestDepartment } from '../../src/resort/requests-catalog.service.js';

import { InMemoryGuestRequests } from './in-memory-guest-requests.js';

/** Departamentos fictícios, no formato do RequestsCatalogService. */
export const REQUEST_DEPARTMENTS: RequestDepartment[] = [
  {
    id: '3',
    name: 'Governança',
    description: null,
    items: [
      { id: '30', name: 'Toalha de banho' },
      { id: '31', name: 'Travesseiro' },
      { id: '32', name: 'Lençol' },
      { id: '33', name: 'Cobertor' },
      { id: '34', name: 'Kit Pet' },
    ],
    info: [{ title: 'Atendimento', description: 'Das 7h às 22h' }],
  },
  {
    id: '5',
    name: 'Manutenção',
    description: null,
    items: [
      { id: '50', name: 'Ar condicionado' },
      { id: '51', name: 'Chuveiro' },
      { id: '52', name: 'Lâmpada' },
      { id: '53', name: 'TV' },
    ],
    info: [],
  },
  {
    id: '7',
    name: 'TI',
    description: null,
    items: [
      { id: '70', name: 'Wi-Fi' },
      { id: '71', name: 'Canais de TV' },
    ],
    info: [],
  },
  // Sem itens nem avisos: não é oferecido ao hóspede.
  { id: '9', name: 'Equipe interna', description: null, items: [], info: [] },
];

export const BOUTIQUE_PRODUCTS = [
  { id: '1', name: 'Protetor solar FPS 50', category: 'Praia', price: 59.9 },
  { id: '2', name: 'Chapéu de palha', category: 'Praia', price: 45 },
  { id: '3', name: 'Camiseta Yaayoo', category: 'Vestuário', price: null },
];

export const SPA_SERVICES = [
  { id: '1', name: 'Massagem Relaxante', category: 'Massagens', price: null, details: '50 min R$ 250,00; 30 min R$ 180,00' },
  { id: '2', name: 'Drenagem Linfática', category: 'Massagens', price: 200, details: '60 min' },
  { id: '3', name: 'Manicure', category: 'Salão', price: null, details: null },
];

export interface RequestFakes {
  departments: ReturnType<typeof vi.fn<() => Promise<RequestDepartment[]>>>;
  rows: InMemoryGuestRequests;
}

/**
 * Providers dos módulos Solicitações, Boutique, SPA, Dicas, Quiz, ESG,
 * Minhas Reservas, Favoritos, Cardápio e inscrições de lazer
 * para os testes de integração: catálogos falsos (snapshot) e o
 * GuestRequestService REAL sobre um banco interno em memória.
 */
export function requestProviders(options: { departments?: RequestDepartment[] } = {}): { providers: Provider[]; fakes: RequestFakes } {
  const rows = new InMemoryGuestRequests();
  const departments = vi.fn(async () => structuredClone(options.departments ?? REQUEST_DEPARTMENTS));

  return {
    fakes: { departments, rows },
    providers: [
      ModuleOperationsService,
      GuestOperationsService,
      // Leituras reais sobre a conexão "resort" falsa de cada teste.
      RestaurantMenusService,
      FavoritesService,
      LeisureEnrollmentsService,
      { provide: RequestsCatalogService, useValue: { departments } },
      {
        provide: ModulesCatalogService,
        useValue: {
          boutique: vi.fn(async () => BOUTIQUE_PRODUCTS),
          spa: vi.fn(async () => SPA_SERVICES),
          tips: vi.fn(async () => []),
          activeQuizzes: vi.fn(async () => []),
          esg: vi.fn(async () => []),
        },
      },
      {
        provide: GuestRequestService,
        inject: [ConfigService],
        useFactory: (config: ConfigService) =>
          new GuestRequestService(rows.dataSource, { departments } as unknown as RequestsCatalogService, config),
      },
    ],
  };
}
