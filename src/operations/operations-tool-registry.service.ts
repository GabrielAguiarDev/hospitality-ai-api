
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  ReservationsService,
  type RestaurantReservation,
} from './reservations.service.js';

import {
  RequestsService,
  type GuestRequest,
} from './requests.service.js';

export type OperationToolName =
  | 'reservations.list'
  | 'requests.list';

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
    };

@Injectable()
export class OperationsToolRegistryService {
  private readonly logger = new Logger(
    OperationsToolRegistryService.name,
  );

  private readonly definitions: readonly OperationToolDefinition[] = [
    {
      name: 'reservations.list',
      description:
        'Consulta as reservas de restaurante do hóspede atual.',
      readOnly: true,
    },
    {
      name: 'requests.list',
      description:
        'Consulta as solicitações de manutenção e governança do hóspede atual.',
      readOnly: true,
    },
  ];

  constructor(
    private readonly reservationsService: ReservationsService,
    private readonly requestsService: RequestsService,
    private readonly configService: ConfigService,
  ) {}

  listTools(): readonly OperationToolDefinition[] {
    return this.definitions;
  }

  async execute(
    name: string,
    input: unknown = {},
  ): Promise<OperationToolResult> {
    // O registro ainda opera exclusivamente
    // com o contexto fictício de desenvolvimento.
    if (
      this.configService.get<string>('NODE_ENV') ===
      'production'
    ) {
      throw new ForbiddenException(
        'Ferramentas de demonstração desabilitadas.',
      );
    }

    // Por enquanto, nenhuma ferramenta aceita parâmetros
    // fornecidos pelo modelo ou pelo hóspede.
    if (
      input === null ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).length > 0
    ) {
      throw new BadRequestException(
        'Esta ferramenta não aceita argumentos.',
      );
    }

    switch (name) {
      case 'reservations.list': {
        const data =
          await this.reservationsService.listForDemoGuest();

        this.logger.log(
          `Ferramenta executada: ${name}`,
        );

        return {
          tool: name,
          data,
        };
      }

      case 'requests.list': {
        const data =
          await this.requestsService.listForDemoGuest();

        this.logger.log(
          `Ferramenta executada: ${name}`,
        );

        return {
          tool: name,
          data,
        };
      }

      default:
        throw new BadRequestException(
          'Ferramenta não permitida.',
        );
    }
  }
}
