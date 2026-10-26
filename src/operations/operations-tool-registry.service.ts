
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
} from './tool-inputs.js';

export type OperationToolName =
  | 'reservations.list'
  | 'requests.list'
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

        return {
          tool: name,
          data: await this.requestsService.listForGuest(guest),
        };
      }

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
