
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { matchByName } from '../common/text.js';
import type { GuestContext } from '../guest/guest-context.js';
import type { SimulatedExperienceBooking } from '../experiences/entities/simulated-experience-booking.entity.js';
import { ExperienceAvailabilityService } from '../experiences/experience-availability.service.js';
import {
  ExperienceBookingService,
  type BookingCardState,
  type ConfirmResult,
  type PreviewResult,
} from '../experiences/experience-booking.service.js';
import {
  ExperiencesCatalogService,
  type StayExperienceReservation,
} from '../experiences/experiences-catalog.service.js';
import type { ExperienceInfo, ExperienceSlot } from '../experiences/experience.types.js';
import {
  matchesCatalogFilters,
  slotsMatching,
  timeWindowOf,
  upcomingSlots,
} from '../experiences/experience-search.js';
import type { ChatAction } from '../contracts/chat-actions.js';
import { EventsCatalogService, type ResortEvent } from '../resort/events-catalog.service.js';
import { FavoritesService, type FavoriteEvent } from '../resort/favorites.service.js';
import { LeisureEnrollmentsService, type LeisureEnrollment } from '../resort/leisure-enrollments.service.js';
import { RestaurantMenusService, type RestaurantMenu } from '../resort/restaurant-menus.service.js';
import {
  ModulesCatalogService,
  type BoutiqueProduct,
  type EsgInfo,
  type QuizInfo,
  type SpaService,
  type Tip,
} from '../resort/modules-catalog.service.js';
import { RequestsCatalogService, type RequestDepartment } from '../resort/requests-catalog.service.js';
import {
  GuestRequestService,
  type RequestCardState,
  type RequestConfirmResult,
  type RequestPreviewResult,
} from '../requests/guest-request.service.js';
import { ResortClock } from '../resort/resort-clock.service.js';
import { GuestStayService } from '../resort/guest-stay.service.js';
import {
  RestaurantsCatalogService,
  type RestaurantInfo,
} from '../resort/restaurants-catalog.service.js';

import {
  ReservationsService,
  type RestaurantReservation,
} from './reservations.service.js';

import {
  RequestsService,
  type GuestRequest,
} from './requests.service.js';

import {
  parseAvailabilityInput,
  parseBookingCardsInput,
  parseEventListInput,
  parseExperienceIdInput,
  parseExperienceListInput,
  parseNoInput,
  parsePreviewInput,
  parseRestaurantListInput,
  parsePreviewReferenceInput,
  parseRequestPreviewInput,
  parseRestaurantIdInput,
} from './tool-inputs.js';

export type OperationToolName =
  | 'reservations.list'
  | 'requests.list'
  | 'requests.catalog'
  | 'requests.preview'
  | 'requests.confirm'
  | 'requests.cancel'
  | 'requests.cards'
  | 'boutique.list'
  | 'spa.list'
  | 'tips.list'
  | 'quiz.list'
  | 'esg.info'
  | 'restaurants.list'
  | 'restaurants.menu'
  | 'favorites.list'
  | 'leisure.enrollments'
  | 'events.list'
  | 'experiences.list'
  | 'experiences.details'
  | 'experiences.availability'
  | 'experiences.reservations'
  | 'experiences.booking.preview'
  | 'experiences.booking.confirm'
  | 'experiences.booking.cancel'
  | 'experiences.booking.cards';

export type ToolDomain =
  | 'gastronomy'
  | 'experiences'
  | 'events'
  | 'leisure'
  | 'requests'
  | 'reservations'
  | 'favorites'
  | 'spa'
  | 'boutique'
  | 'esg'
  | 'tips'
  | 'quiz';

/**
 * Contrato de uma ferramenta. O modelo nunca escolhe a ferramenta nem
 * os argumentos: o servidor a executa a partir da intenção classificada,
 * com identificadores do cadastro ou da própria conversa.
 */
export interface OperationToolDefinition {
  name: OperationToolName;
  description: string;
  readOnly: boolean;
  domain: ToolDomain;
  // catalog: dados públicos do resort; guest: dados da estadia do titular,
  // sempre resolvida pelo servidor (GuestStayService), nunca pelo cliente.
  access: 'catalog' | 'guest';
  // snapshot: banco do resort (somente leitura); ai_db: banco interno da IA.
  source: 'snapshot' | 'ai_db' | 'snapshot+ai_db';
  // read: consulta. simulated_write: grava somente no banco da IA.
  mode: 'read' | 'simulated_write';
  // explicit: pré-visualização + confirmação por botão ou texto inequívoco.
  confirmation: 'none' | 'explicit';
  // Campo → tipo e regra. Campos fora desta lista são recusados.
  input: Readonly<Record<string, string>>;
  output: string;
  // Ações que os handlers montam a partir do resultado.
  cards: readonly ChatAction['type'][];
}

export type OperationToolResult =
  | {
      tool: 'reservations.list';
      data: RestaurantReservation[];
    }
  | {
      tool: 'requests.list';
      data: GuestRequest[];
    }
  | { tool: 'requests.catalog'; data: RequestDepartment[] }
  | { tool: 'requests.preview'; data: RequestPreviewResult }
  | { tool: 'requests.confirm'; data: RequestConfirmResult }
  | { tool: 'requests.cancel'; data: { cancelled: boolean } }
  | { tool: 'requests.cards'; data: RequestCardState[] }
  | { tool: 'boutique.list'; data: BoutiqueProduct[] }
  | { tool: 'spa.list'; data: SpaService[] }
  | { tool: 'tips.list'; data: Tip[] }
  | { tool: 'quiz.list'; data: QuizInfo[] }
  | { tool: 'esg.info'; data: EsgInfo[] }
  | {
      tool: 'restaurants.list';
      data: RestaurantInfo[];
    }
  | { tool: 'restaurants.menu'; data: RestaurantMenu }
  | { tool: 'favorites.list'; data: FavoriteEvent[] }
  | { tool: 'leisure.enrollments'; data: LeisureEnrollment[] }
  | {
      tool: 'events.list';
      data: { date: string; events: ResortEvent[] };
    }
  | {
      tool: 'experiences.list';
      data: {
        date: string | null;
        experiences: ExperienceInfo[];
        slots: ExperienceSlot[];
      };
    }
  | {
      tool: 'experiences.details';
      data: ExperienceInfo | null;
    }
  | {
      tool: 'experiences.availability';
      data: {
        experience: ExperienceInfo | null;
        date: string;
        slots: ExperienceSlot[];
      };
    }
  | {
      tool: 'experiences.reservations';
      data: {
        official: StayExperienceReservation[];
        simulated: SimulatedExperienceBooking[];
      };
    }
  | {
      tool: 'experiences.booking.preview';
      data: PreviewResult;
    }
  | {
      tool: 'experiences.booking.confirm';
      data: ConfirmResult;
    }
  | {
      tool: 'experiences.booking.cancel';
      data: { cancelled: boolean };
    }
  | {
      tool: 'experiences.booking.cards';
      data: BookingCardState[];
    };

/**
 * Ponto único de execução das ferramentas operacionais.
 * Cada ferramenta valida as próprias entradas; nenhuma
 * aceita SQL, e identificadores são revalidados no banco.
 */
@Injectable()
export class OperationsToolRegistryService {
  private readonly logger = new Logger(
    OperationsToolRegistryService.name,
  );

  private readonly definitions: readonly OperationToolDefinition[] = [
    {
      name: 'reservations.list',
      description: 'Consulta reservas de restaurante do hóspede atual.',
      readOnly: true,
      domain: 'reservations',
      access: 'guest',
      source: 'snapshot',
      mode: 'read',
      confirmation: 'none',
      input: {},
      output: 'RestaurantReservation[] da estadia',
      cards: ['booking.list'],
    },
    {
      name: 'requests.list',
      description: 'Consulta solicitações do hóspede atual.',
      readOnly: true,
      domain: 'requests',
      access: 'guest',
      source: 'snapshot+ai_db',
      mode: 'read',
      confirmation: 'none',
      input: {},
      output: 'GuestRequest[] (oficiais do snapshot + simuladas pelo chat)',
      cards: ['request.list'],
    },
    {
      name: 'requests.catalog',
      description: 'Lista departamentos que aceitam solicitação, seus itens ativos e avisos.',
      readOnly: true,
      domain: 'requests',
      access: 'catalog',
      source: 'snapshot',
      mode: 'read',
      confirmation: 'none',
      input: {},
      output: 'RequestDepartment[]',
      cards: ['navigate'],
    },
    {
      name: 'requests.preview',
      description: 'Prepara uma solicitação SIMULADA com itens do catálogo (banco interno da IA).',
      readOnly: false,
      domain: 'requests',
      access: 'guest',
      source: 'snapshot+ai_db',
      mode: 'simulated_write',
      confirmation: 'explicit',
      input: { conversationId: 'UUID da conversa (servidor)', departmentId: 'string: ID do cadastro', items: '[{ itemId: ID do cadastro, quantity: 1-10 }], 1-10 itens', note: 'string? até 2000' },
      output: 'RequestPreviewResult',
      cards: ['request.card'],
    },
    {
      name: 'requests.confirm',
      description: 'Confirma uma solicitação simulada da conversa (não envia ao departamento).',
      readOnly: false,
      domain: 'requests',
      access: 'guest',
      source: 'ai_db',
      mode: 'simulated_write',
      confirmation: 'explicit',
      input: { conversationId: 'conversationId: UUID da conversa (servidor)', previewId: 'previewId: UUID da pré-visualização (servidor)' },
      output: 'RequestConfirmResult (protocolo SIM-…)',
      cards: ['request.card'],
    },
    {
      name: 'requests.cancel',
      description: 'Descarta uma solicitação simulada pendente.',
      readOnly: false,
      domain: 'requests',
      access: 'guest',
      source: 'ai_db',
      mode: 'simulated_write',
      confirmation: 'none',
      input: { conversationId: 'conversationId: UUID da conversa (servidor)', previewId: 'previewId: UUID da pré-visualização (servidor)' },
      output: '{ cancelled }',
      cards: ['request.card'],
    },
    {
      name: 'requests.cards',
      description: 'Consulta o estado atual dos cards de solicitação da conversa.',
      readOnly: true,
      domain: 'requests',
      access: 'guest',
      source: 'ai_db',
      mode: 'read',
      confirmation: 'none',
      input: { conversationId: 'conversationId: UUID da conversa (servidor)', previewIds: 'UUID[] (1-50)' },
      output: 'RequestCardState[]',
      cards: ['request.card'],
    },
    {
      name: 'boutique.list',
      description: 'Lista produtos ativos da boutique e da conveniência, com preços.',
      readOnly: true,
      domain: 'boutique',
      access: 'catalog',
      source: 'snapshot',
      mode: 'read',
      confirmation: 'none',
      input: {},
      output: 'BoutiqueProduct[]',
      cards: ['catalog.list', 'navigate'],
    },
    {
      name: 'spa.list',
      description: 'Lista serviços ativos do SPA e do salão de beleza.',
      readOnly: true,
      domain: 'spa',
      access: 'catalog',
      source: 'snapshot',
      mode: 'read',
      confirmation: 'none',
      input: {},
      output: 'SpaService[]',
      cards: ['catalog.list', 'navigate'],
    },
    {
      name: 'tips.list',
      description: 'Lista as dicas publicadas para a estadia.',
      readOnly: true,
      domain: 'tips',
      access: 'catalog',
      source: 'snapshot',
      mode: 'read',
      confirmation: 'none',
      input: {},
      output: 'Tip[]',
      cards: ['catalog.list', 'navigate'],
    },
    {
      name: 'quiz.list',
      description: 'Lista quizzes ativos (sem participações nem PIN).',
      readOnly: true,
      domain: 'quiz',
      access: 'catalog',
      source: 'snapshot',
      mode: 'read',
      confirmation: 'none',
      input: {},
      output: 'QuizInfo[] (sem perguntas nem respostas)',
      cards: ['catalog.list', 'navigate'],
    },
    {
      name: 'esg.info',
      description: 'Textos publicados de ESG do resort.',
      readOnly: true,
      domain: 'esg',
      access: 'catalog',
      source: 'snapshot',
      mode: 'read',
      confirmation: 'none',
      input: {},
      output: 'EsgInfo[]',
      cards: ['catalog.list', 'navigate'],
    },
    {
      name: 'restaurants.list',
      description: 'Lista restaurantes, bares e opções de alimentação ativos, com filtro opcional por tipo ou nome.',
      readOnly: true,
      domain: 'gastronomy',
      access: 'catalog',
      source: 'snapshot',
      mode: 'read',
      confirmation: 'none',
      input: { type: '\'restaurante\' | \'bar\' | \'alimentacao\'?', name: 'string? até 120 (busca no cadastro)' },
      output: 'RestaurantInfo[]',
      cards: ['restaurant.options', 'navigate'],
    },
    {
      name: 'restaurants.menu',
      description: 'Cardápio publicado de um restaurante: categorias e pratos ativos (somente leitura).',
      readOnly: true,
      domain: 'gastronomy',
      access: 'catalog',
      source: 'snapshot',
      mode: 'read',
      confirmation: 'none',
      input: { restaurantId: 'string: ID do cadastro' },
      output: 'RestaurantMenu',
      cards: ['menu.view', 'navigate'],
    },
    {
      name: 'favorites.list',
      description: 'Eventos favoritados (lembretes) pelos hóspedes da estadia.',
      readOnly: true,
      domain: 'favorites',
      access: 'guest',
      source: 'snapshot',
      mode: 'read',
      confirmation: 'none',
      input: {},
      output: 'FavoriteEvent[]',
      cards: ['catalog.list', 'navigate'],
    },
    {
      name: 'leisure.enrollments',
      description: 'Inscrições de lazer dos hóspedes da estadia e seu status.',
      readOnly: true,
      domain: 'leisure',
      access: 'guest',
      source: 'snapshot',
      mode: 'read',
      confirmation: 'none',
      input: {},
      output: 'LeisureEnrollment[]',
      cards: ['request.list'],
    },
    {
      name: 'events.list',
      description: 'Lista eventos, shows e a programação de lazer de uma data.',
      readOnly: true,
      domain: 'events',
      access: 'catalog',
      source: 'snapshot',
      mode: 'read',
      confirmation: 'none',
      input: { date: 'AAAA-MM-DD (fuso do resort)' },
      output: '{ date, events: ResortEvent[] }',
      cards: ['event.list', 'navigate'],
    },
    {
      name: 'experiences.list',
      description: 'Lista ou busca experiências ativas com filtros opcionais (data, período, faixa de horário, gratuitas, para crianças, com reserva, grupo) e, com data, as vagas registradas no snapshot.',
      readOnly: true,
      domain: 'experiences',
      access: 'catalog',
      source: 'snapshot+ai_db',
      mode: 'read',
      confirmation: 'none',
      input: { date: 'AAAA-MM-DD?', includeInactive: 'boolean?', period: '\'morning\' | \'afternoon\' | \'evening\'?', after: 'HH:MM?', before: 'HH:MM?', free: 'true?', forChildren: 'true?', bookable: 'true?', adults: '0-10?', children: '0-10?' },
      output: '{ date, experiences: ExperienceInfo[], slots: ExperienceSlot[] }',
      cards: ['experience.options', 'navigate'],
    },
    {
      name: 'experiences.details',
      description: 'Consulta descrição, regras e preços de uma experiência.',
      readOnly: true,
      domain: 'experiences',
      access: 'catalog',
      source: 'snapshot',
      mode: 'read',
      confirmation: 'none',
      input: { experienceId: 'string: ID do cadastro' },
      output: 'ExperienceInfo | null',
      cards: ['experience.options', 'navigate'],
    },
    {
      name: 'experiences.availability',
      description: 'Consulta horários e vagas registrados de uma experiência.',
      readOnly: true,
      domain: 'experiences',
      access: 'catalog',
      source: 'snapshot+ai_db',
      mode: 'read',
      confirmation: 'none',
      input: { experienceId: 'string: ID do cadastro', date: 'AAAA-MM-DD' },
      output: '{ experience, date, slots: ExperienceSlot[] }',
      cards: ['experience.options', 'navigate'],
    },
    {
      name: 'experiences.reservations',
      description: 'Consulta reservas de experiências da hospedagem atual.',
      readOnly: true,
      domain: 'reservations',
      access: 'guest',
      source: 'snapshot+ai_db',
      mode: 'read',
      confirmation: 'none',
      input: {},
      output: '{ official: StayExperienceReservation[], simulated: SimulatedExperienceBooking[] }',
      cards: ['booking.list'],
    },
    {
      name: 'experiences.booking.preview',
      description: 'Cria uma pré-reserva simulada após validar as regras.',
      readOnly: false,
      domain: 'experiences',
      access: 'guest',
      source: 'snapshot+ai_db',
      mode: 'simulated_write',
      confirmation: 'explicit',
      input: { conversationId: 'conversationId: UUID da conversa (servidor)', experienceId: 'string: ID do cadastro', date: 'AAAA-MM-DD', time: 'HH:MM | null', adults: '0-10', children: '0-10' },
      output: 'PreviewResult',
      cards: ['experience.booking.card'],
    },
    {
      name: 'experiences.booking.confirm',
      description: 'Confirma uma pré-reserva simulada persistida.',
      readOnly: false,
      domain: 'experiences',
      access: 'guest',
      source: 'snapshot+ai_db',
      mode: 'simulated_write',
      confirmation: 'explicit',
      input: { conversationId: 'conversationId: UUID da conversa (servidor)', previewId: 'previewId: UUID da pré-visualização (servidor)' },
      output: 'ConfirmResult (código SIM-…)',
      cards: ['experience.booking.card'],
    },
    {
      name: 'experiences.booking.cancel',
      description: 'Cancela uma pré-reserva simulada pendente.',
      readOnly: false,
      domain: 'experiences',
      access: 'guest',
      source: 'ai_db',
      mode: 'simulated_write',
      confirmation: 'none',
      input: { conversationId: 'conversationId: UUID da conversa (servidor)', previewId: 'previewId: UUID da pré-visualização (servidor)' },
      output: '{ cancelled }',
      cards: ['experience.booking.card'],
    },
    {
      name: 'experiences.booking.cards',
      description: 'Consulta o estado atual dos cards de reserva da conversa.',
      readOnly: true,
      domain: 'experiences',
      access: 'guest',
      source: 'ai_db',
      mode: 'read',
      confirmation: 'none',
      input: { conversationId: 'conversationId: UUID da conversa (servidor)', previewIds: 'UUID[] (1-50)' },
      output: 'BookingCardState[]',
      cards: ['experience.booking.card'],
    },
  ];

  constructor(
    private readonly reservationsService: ReservationsService,
    private readonly requestsService: RequestsService,
    private readonly configService: ConfigService,
    private readonly restaurantsCatalog: RestaurantsCatalogService,
    private readonly experiencesCatalog: ExperiencesCatalogService,
    private readonly experienceAvailability: ExperienceAvailabilityService,
    private readonly experienceBooking: ExperienceBookingService,
    private readonly guestStay: GuestStayService,
    private readonly clock: ResortClock,
    private readonly eventsCatalog: EventsCatalogService,
    private readonly requestsCatalog: RequestsCatalogService,
    private readonly modulesCatalog: ModulesCatalogService,
    private readonly guestRequests: GuestRequestService,
    private readonly restaurantMenus: RestaurantMenusService,
    private readonly favorites: FavoritesService,
    private readonly leisureEnrollments: LeisureEnrollmentsService,
  ) {}

  // Vagas do snapshot filtradas pelo relógio atual do resort.
  private async upcoming(date: string, experienceId?: string): Promise<ExperienceSlot[]> {
    const slots = experienceId
      ? await this.experienceAvailability.findSlots(date, experienceId)
      : await this.experienceAvailability.findSlots(date);
    return upcomingSlots(slots, this.clock.today(), this.clock.time());
  }

  listTools(): readonly OperationToolDefinition[] {
    return this.definitions;
  }

  async execute(
    name: string,
    guest: GuestContext,
    input: unknown = {},
  ): Promise<OperationToolResult> {
    // Falha fechada: ferramentas de demonstração somente em desenvolvimento.
    if (
      this.configService.get<string>('NODE_ENV') !==
      'development'
    ) {
      throw new ForbiddenException(
        'Ferramentas de demonstração desabilitadas.',
      );
    }

    if (
      !guest?.resortId ||
      !guest?.guestId
    ) {
      throw new ForbiddenException(
        'Contexto do hóspede obrigatório.',
      );
    }

    const result = await this.run(name, guest, input);

    this.logger.log(
      `Ferramenta executada: ${name}`,
    );

    return result;
  }

  private async run(
    name: string,
    guest: GuestContext,
    input: unknown,
  ): Promise<OperationToolResult> {
    switch (name) {
      case 'reservations.list': {
        parseNoInput(input);

        return {
          tool: name,
          data: await this.reservationsService.listForGuest(guest),
        };
      }

      case 'requests.list': {
        parseNoInput(input);
        const stay = await this.guestStay.resolve(guest);
        const [official, simulated] = await Promise.all([
          this.requestsService.listForGuest(guest),
          this.guestRequests.listForStay(guest, stay),
        ]);

        return {
          tool: name,
          // Simuladas primeiro (mais recentes) e sempre identificadas.
          data: [
            ...simulated.map((request): GuestRequest => ({
              id: request.id,
              category: request.departmentName,
              description: request.items.map(({ name, quantity }) => (quantity > 1 ? `${quantity}x ${name}` : name)).join('; '),
              status: 'simulada',
              createdAt: `${ResortClock.formatDate(this.clock.dateAt(request.confirmedAt))} ${this.clock.timeAt(request.confirmedAt)}`,
              updatedAt: null,
              simulated: true,
              protocol: request.protocol,
            })),
            ...official,
          ],
        };
      }

      case 'requests.catalog': {
        parseNoInput(input);
        return { tool: name, data: await this.requestsCatalog.departments() };
      }

      case 'requests.preview': {
        const draft = parseRequestPreviewInput(input);
        const stay = await this.guestStay.resolve(guest);
        return { tool: name, data: await this.guestRequests.preview(guest, stay, draft) };
      }

      case 'requests.confirm': {
        const { conversationId, previewId } = parsePreviewReferenceInput(input);
        const stay = await this.guestStay.resolve(guest);
        return { tool: name, data: await this.guestRequests.confirm(guest, stay, conversationId, previewId) };
      }

      case 'requests.cancel': {
        const { conversationId, previewId } = parsePreviewReferenceInput(input);
        return { tool: name, data: { cancelled: await this.guestRequests.cancel(guest, conversationId, previewId) } };
      }

      case 'requests.cards': {
        const { conversationId, previewIds } = parseBookingCardsInput(input);
        return { tool: name, data: await this.guestRequests.cards(guest, conversationId, previewIds) };
      }

      case 'boutique.list':
        parseNoInput(input);
        return { tool: name, data: await this.modulesCatalog.boutique() };

      case 'spa.list':
        parseNoInput(input);
        return { tool: name, data: await this.modulesCatalog.spa() };

      case 'tips.list':
        parseNoInput(input);
        return { tool: name, data: await this.modulesCatalog.tips() };

      case 'quiz.list':
        parseNoInput(input);
        return { tool: name, data: await this.modulesCatalog.activeQuizzes() };

      case 'esg.info':
        parseNoInput(input);
        return { tool: name, data: await this.modulesCatalog.esg() };

      case 'restaurants.list': {
        const { type, name: query } = parseRestaurantListInput(input);
        const active = await this.restaurantsCatalog.listActive();
        const ofType = type ? active.filter((restaurant) => restaurant.type === type) : active;

        return {
          tool: name,
          // Pesquisa por nome sobre o cadastro, nunca por SQL livre.
          data: query ? matchByName(query, ofType) : ofType,
        };
      }

      case 'restaurants.menu': {
        const { restaurantId } = parseRestaurantIdInput(input);
        // O ID precisa existir no cadastro ativo: nunca um ID livre.
        const active = await this.restaurantsCatalog.listActive();
        if (!active.some(({ id }) => String(id) === restaurantId)) {
          throw new BadRequestException('Restaurante não encontrado.');
        }
        return { tool: name, data: await this.restaurantMenus.forRestaurant(restaurantId) };
      }

      case 'favorites.list': {
        parseNoInput(input);
        const stay = await this.guestStay.resolve(guest);
        return { tool: name, data: await this.favorites.forStay(stay) };
      }

      case 'leisure.enrollments': {
        parseNoInput(input);
        const stay = await this.guestStay.resolve(guest);
        return { tool: name, data: await this.leisureEnrollments.forStay(stay) };
      }

      case 'events.list': {
        const { date } = parseEventListInput(input);

        return { tool: name, data: { date, events: await this.eventsCatalog.forDate(date) } };
      }

      case 'experiences.list': {
        const { date, includeInactive, filters, party } = parseExperienceListInput(input);
        const all = includeInactive
          ? await this.experiencesCatalog.listAll()
          : await this.experiencesCatalog.listActive();
        const experiences = all.filter((experience) => matchesCatalogFilters(experience, filters));
        const ids = new Set(experiences.map(({ id }) => id));
        // Somente vagas com saldo, das experiências filtradas e na faixa pedida.
        const slots = date
          ? slotsMatching(
              (await this.upcoming(date)).filter((slot) => ids.has(slot.experienceId)),
              timeWindowOf(filters),
              party,
            )
          : [];

        return { tool: name, data: { date, experiences, slots } };
      }

      case 'experiences.details': {
        const { experienceId } = parseExperienceIdInput(input);

        return {
          tool: name,
          data: await this.experiencesCatalog.findById(experienceId),
        };
      }

      case 'experiences.availability': {
        const { experienceId, date } = parseAvailabilityInput(input);
        const experience = await this.experiencesCatalog.findById(experienceId);
        const slots = experience ? await this.upcoming(date, experience.id) : [];

        return { tool: name, data: { experience, date, slots } };
      }

      case 'experiences.reservations': {
        parseNoInput(input);
        const stay = await this.guestStay.resolve(guest);
        const [official, simulated] = await Promise.all([
          this.experiencesCatalog.listStayReservations(stay),
          this.experienceBooking.listSimulated(guest, stay),
        ]);

        return { tool: name, data: { official, simulated } };
      }

      case 'experiences.booking.preview': {
        const parsed = parsePreviewInput(input);
        const stay = await this.guestStay.resolve(guest);

        return {
          tool: name,
          data: await this.experienceBooking.preview(guest, stay, {
            conversationId: parsed.conversationId,
            experienceId: parsed.experienceId,
            date: parsed.date,
            time: parsed.time,
            party: { adults: parsed.adults, children: parsed.children },
          }),
        };
      }

      case 'experiences.booking.confirm': {
        const { conversationId, previewId } = parsePreviewReferenceInput(input);
        const stay = await this.guestStay.resolve(guest);

        return {
          tool: name,
          data: await this.experienceBooking.confirm(
            guest,
            stay,
            conversationId,
            previewId,
          ),
        };
      }

      case 'experiences.booking.cancel': {
        const { conversationId, previewId } = parsePreviewReferenceInput(input);

        return {
          tool: name,
          data: {
            cancelled: await this.experienceBooking.cancelPreview(
              guest,
              conversationId,
              previewId,
            ),
          },
        };
      }

      case 'experiences.booking.cards': {
        const { conversationId, previewIds } = parseBookingCardsInput(input);

        return {
          tool: name,
          data: await this.experienceBooking.cards(guest, conversationId, previewIds),
        };
      }

      default:
        throw new BadRequestException(
          'Ferramenta não permitida.',
        );
    }
  }
}
