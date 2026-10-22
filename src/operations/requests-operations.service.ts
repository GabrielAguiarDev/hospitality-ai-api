import { Injectable, InternalServerErrorException } from '@nestjs/common';

import { OperationsToolRegistryService } from './operations-tool-registry.service.js';
import type { GuestRequest } from './requests.service.js';
import { GuestContext } from '../guest/guest-context.js';

type RequestIntent = 'request.list' | 'request.status';

@Injectable()
export class RequestsOperationsService {
  constructor(private readonly registry: OperationsToolRegistryService) {}

  private normalize(text: string): string {
    return text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  private categoryLabel(category: string): string {
    const categories: Record<string, string> = {
      maintenance: 'manutenção',
      housekeeping: 'governança',
    };

    return categories[category.toLowerCase()] ?? category;
  }

  private statusLabel(status: string): string {
    const statuses: Record<string, string> = {
      pending: 'pendente',
      in_progress: 'em andamento',
      completed: 'concluída',
      cancelled: 'cancelada',
      canceled: 'cancelada',
    };

    return statuses[status.toLowerCase()] ?? `com status "${status}"`;
  }

  private selectRequest(
    question: string,
    requests: GuestRequest[],
  ): GuestRequest | null {
    if (requests.length === 1) {
      return requests[0];
    }

    const ignoredWords = new Set([
      'solicitacao',
      'solicitacoes',
      'chamado',
      'chamados',
      'minha',
      'minhas',
      'meu',
      'meus',
      'qual',
      'como',
      'esta',
      'estava',
      'estou',
      'porque',
      'abri',
      'fiz',
      'andamento',
      'status',
      'ainda',
      'concluida',
      'concluido',
      'funcionando',
      'quarto',
      'sobre',
      'dessa',
      'deste',
      'essa',
      'aquela',
      'para',
      'alguma',
    ]);

    const terms = [
      ...new Set(
        this.normalize(question)
          .split(/\s+/)
          .filter((word) => word.length >= 4 && !ignoredWords.has(word)),
      ),
    ];

    if (terms.length === 0) {
      return null;
    }

    const scored = requests.map((request) => {
      const searchable = this.normalize(
        [request.description, this.categoryLabel(request.category)].join(' '),
      );

      return {
        request,
        score: terms.filter((term) => searchable.split(/\s+/).includes(term))
          .length,
      };
    });

    const highestScore = Math.max(...scored.map((item) => item.score));

    if (highestScore === 0) {
      return null;
    }

    const matches = scored.filter((item) => item.score === highestScore);

    return matches.length === 1 ? matches[0].request : null;
  }

  async ask(
    question: string,
    intent: RequestIntent,
    guest: GuestContext,
  ): Promise<string> {
    // O Registry decide qual operação pode ser executada.
    const result = await this.registry.execute('requests.list', guest);

    if (result.tool !== 'requests.list') {
      throw new InternalServerErrorException(
        'Resultado inesperado da ferramenta.',
      );
    }

    const requests = result.data;

    if (requests.length === 0) {
      return 'Não encontrei solicitações no seu cadastro.';
    }

    if (intent === 'request.list') {
      const items = requests.map((request, index) =>
        [
          `${index + 1}. ${this.categoryLabel(request.category)}`,
          `Descrição: ${request.description}`,
          `Status: ${this.statusLabel(request.status)}`,
          `Abertura: ${request.createdAt}`,
        ].join('\n'),
      );

      return [
        `Encontrei ${requests.length} ${
          requests.length === 1 ? 'solicitação' : 'solicitações'
        } no seu cadastro:`,
        '',
        items.join('\n\n'),
      ].join('\n');
    }

    const selected = this.selectRequest(question, requests);

    if (!selected) {
      return [
        'Encontrei mais de uma solicitação,',
        'mas não consegui identificar qual você deseja consultar.',
        'Informe a categoria ou o assunto da solicitação.',
      ].join(' ');
    }

    const category = this.categoryLabel(selected.category);

    const status = this.statusLabel(selected.status);

    return [
      `Sua solicitação de ${category}`,
      `referente a "${selected.description}"`,
      `está ${status}.`,
    ].join(' ');
  }
}
