
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
import { EventsCatalogService, type ResortEvent } from '../resort/events-catalog.service.js';
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
  | 'events.list'
  | 'experiences.list'
  | 'experiences.details'
  | 'experiences.availability'
  | 'experiences.reservations'
  | 'experiences.booking.preview'
  | 'experiences.booking.confirm'
  | 'experiences.booking.cancel'
  | 'experiences.booking.cards';

export interface OperationToolDefinition {
  name: OperationToolName;
  description: string;
  readOnly: boolean;
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
      description:
        'Consulta reservas de restaurante do hóspede atual.',
      readOnly: true,
    },
    {
      name: 'requests.list',
      description:
        'Consulta solicitações do hóspede atual.',
      readOnly: true,
    },
    {
      name: 'requests.catalog',
      description: 'Lista departamentos que aceitam solicitação, seus itens ativos e avisos.',
      readOnly: true,
    },
    {
      name: 'requests.preview',
      description: 'Prepara uma solicitação SIMULADA com itens do catálogo (banco interno da IA).',
      readOnly: false,
    },
    {
      name: 'requests.confirm',
      description: 'Confirma uma solicitação simulada da conversa (não envia ao departamento).',
      readOnly: false,
    },
    {
      name: 'requests.cancel',
      description: 'Descarta uma solicitação simulada pendente.',
      readOnly: false,
    },
    {
      name: 'requests.cards',
      description: 'Consulta o estado atual dos cards de solicitação da conversa.',
      readOnly: true,
    },
    {
      name: 'boutique.list',
      description: 'Lista produtos ativos da boutique e da conveniência, com preços.',
      readOnly: true,
    },
    {
      name: 'spa.list',
      description: 'Lista serviços ativos do SPA e do salão de beleza.',
      readOnly: true,
    },
    {
      name: 'tips.list',
      description: 'Lista as dicas publicadas para a estadia.',
      readOnly: true,
    },
    {
      name: 'quiz.list',
      description: 'Lista quizzes ativos (sem participações nem PIN).',
      readOnly: true,
    },
    {
      name: 'esg.info',
      description: 'Textos publicados de ESG do resort.',
      readOnly: true,
    },
    {
      name: 'restaurants.list',
      description: 'Lista restaurantes, bares e opções de alimentação ativos, com filtro opcional por tipo ou nome.',
      readOnly: true,
    },
    {
      name: 'events.list',
      description: 'Lista eventos, shows e a programação de lazer de uma data.',
      readOnly: true,
    },
    {
      name: 'experiences.list',
      description:
        'Lista ou busca experiências ativas com filtros opcionais (data, período, faixa de horário, ' +
        'gratuitas, para crianças, com reserva, grupo) e, com data, as vagas registradas no snapshot.',
      readOnly: true,
    },
    {
      name: 'experiences.details',
      description: 'Consulta descrição, regras e preços de uma experiência.',
      readOnly: true,
    },
    {
      name: 'experiences.availability',
      description: 'Consulta horários e vagas registrados de uma experiência.',
      readOnly: true,
    },
    {
      name: 'experiences.reservations',
      description: 'Consulta reservas de experiências da hospedagem atual.',
      readOnly: true,
    },
    {
      name: 'experiences.booking.preview',
      description: 'Cria uma pré-reserva simulada após validar as regras.',
      readOnly: false,
    },
    {
      name: 'experiences.booking.confirm',
      description: 'Confirma uma pré-reserva simulada persistida.',
      readOnly: false,
    },
    {
      name: 'experiences.booking.cancel',
      description: 'Cancela uma pré-reserva simulada pendente.',
      readOnly: false,
    },
    {
      name: 'experiences.booking.cards',
      description: 'Consulta o estado atual dos cards de reserva da conversa.',
      readOnly: true,
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
