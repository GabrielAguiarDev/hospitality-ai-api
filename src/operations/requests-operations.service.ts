import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';

import type { IntentDecision, RequestIntent } from '../chat/chat-intent.types.js';
import { nameList, normalizeText } from '../common/text.js';
import { navigateAction, requestCard, type ChatAction } from '../contracts/chat-actions.js';
import type { ConversationState, RequestConversationState } from '../contracts/conversation-state.js';
import { GuestContext } from '../guest/guest-context.js';
import { GuestRequestService } from '../requests/guest-request.service.js';
import type { RequestDepartment } from '../resort/requests-catalog.service.js';

import { requestItems, requestList } from './card-builders.js';
import { OperationsToolRegistryService, type OperationToolName, type OperationToolResult } from './operations-tool-registry.service.js';
import type { DispatchContext, DispatchResult } from './operations.types.js';
import { matchItems, mentionedDepartment, requestTokens, symptomDepartment, type MatchedItem } from './request-matching.js';
import type { GuestRequest } from './requests.service.js';

type ToolData<N extends OperationToolName> = Extract<OperationToolResult, { tool: N }>['data'];

const STATUS_LABELS: Record<string, string> = {
  atendida: 'atendida',
  executando: 'em andamento',
  pendente: 'pendente',
  cancelada: 'cancelada',
  simulada: 'simulada pelo chat',
};

const STATUS_PLURALS: Record<string, string> = {
  atendida: 'atendidas',
  pendente: 'pendentes',
  cancelada: 'canceladas',
  'simulada pelo chat': 'simuladas pelo chat',
};

// Palavras do próprio pedido ("quero fazer uma solicitação"): sem item.
const REQUEST_WORDS = new Set([
  'quero', 'queria', 'gostaria', 'fazer', 'abrir', 'nova', 'novo', 'solicitacao', 'solicitar', 'chamado', 'pedido', 'pedir',
  'preciso', 'registrar', 'mandar', 'eu', 'voce', 'pode', 'podem', 'ajuda', 'algo', 'alguma', 'coisa',
]);

const NO_PENDING =
  'Não há uma solicitação aguardando confirmação por texto. Se ela ainda aparece no card, confirme pelo botão.';
// A conversa também tem uma experiência escolhida: "confirmo" pode ser dela.
const NO_PENDING_ANY =
  'Não há nada aguardando confirmação por texto. Se a solicitação ou a pré-reserva ainda aparece no card, confirme pelo botão.';

// "a anterior", "a última", "a mais recente": a solicitação mais nova.
const LATEST = /\b(?:anterior|ultima|ultimo|mais recente|recente|ela|essa|dela)\b/;

const requestsScreen = (departmentId?: string) =>
  navigateAction('Requests', 'Abrir Solicitações', departmentId ? { departmentId } : {});
const myRequestsScreen = () => navigateAction('MyRequests', 'Abrir Minhas Solicitações');

const LEISURE_STATUS: Record<string, string> = { pendente: 'pendente', aprovado: 'aprovada', negado: 'negada ou cancelada' };

const describeItems = (items: { name: string; quantity: number }[]) =>
  nameList(items.map(({ name, quantity }) => (quantity > 1 ? `${quantity}x ${name}` : name)), 4);

/**
 * Solicitações pelo chat: catálogo real dos departamentos, solicitações
 * da estadia e novas solicitações SIMULADAS (preview → confirmação).
 */
@Injectable()
export class RequestsOperationsService {
  constructor(private readonly registry: OperationsToolRegistryService) {}

  private async execute<N extends OperationToolName>(name: N, guest: GuestContext, input: unknown = {}): Promise<ToolData<N>> {
    const result = await this.registry.execute(name, guest, input);

    if (result.tool !== name) {
      throw new InternalServerErrorException('Resultado inesperado da ferramenta.');
    }

    return result.data as ToolData<N>;
  }

  private state(conversation: ConversationState, request: RequestConversationState): ConversationState {
    const compact = Object.fromEntries(Object.entries(request).filter(([, value]) => value !== undefined));
    return { ...conversation, topic: 'request', request: compact };
  }

  async handle(
    message: string,
    decision: IntentDecision & { intent: RequestIntent },
    guest: GuestContext,
    context: DispatchContext | undefined,
  ): Promise<DispatchResult> {
    const conversation = context?.state ?? {};
    const previous = conversation.request ?? {};
    // Qualquer outra interação descarta a confirmação por texto pendente e
    // a pergunta "O que você precisa?" (vale só para a mensagem seguinte).
    const base: RequestConversationState = { ...previous, pendingPreviewId: undefined, departmentId: undefined };

    switch (decision.intent) {
      case 'request.list':
      case 'request.status':
        return this.history(message, decision.intent, guest, conversation, base);
      case 'request.confirm':
      case 'request.cancel':
      case 'request.create':
        // Escrita simulada: só dentro de uma conversa do próprio hóspede.
        if (!context?.conversationId) {
          throw new BadRequestException('Solicitações simuladas exigem o contexto da conversa.');
        }
        if (decision.intent === 'request.create') return this.create(message, guest, context, base, previous);
        return decision.intent === 'request.confirm'
          ? this.confirm(guest, context, previous)
          : this.cancel(guest, context, previous);
      default:
        return this.catalog(message, guest, conversation, base);
    }
  }

  private async catalog(
    message: string,
    guest: GuestContext,
    conversation: ConversationState,
    state: RequestConversationState,
  ): Promise<DispatchResult> {
    const departments = await this.execute('requests.catalog', guest);
    const department = mentionedDepartment(message, departments);

    if (department) {
      return this.askItem(department, conversation, state, 'requests.catalog');
    }

    // Departamentos sem itens nem avisos (ex.: equipes internas) não são oferecidos.
    const offered = departments.filter(({ items, info }) => items.length > 0 || info.length > 0);

    return {
      tool: 'requests.catalog',
      reply:
        `Pelo app você pode fazer solicitações para ${nameList(offered.map(({ name }) => name), 4)}. ` +
        'É só dizer do que precisa, por exemplo "preciso de toalhas".',
      actions: [requestsScreen()],
      resultCount: offered.length,
      state: this.state(conversation, { ...state, departmentId: undefined }),
    };
  }

  // Departamento conhecido, item não: mostra o que pode ser pedido.
  private askItem(
    department: RequestDepartment,
    conversation: ConversationState,
    state: RequestConversationState,
    tool: OperationToolName,
  ): DispatchResult {
    const note = GuestRequestService.departmentNotes(department)[0];

    return {
      tool,
      reply: department.items.length
        ? `${department.name} atende pedidos como ${nameList(department.items.map(({ name }) => name), 5)}. O que você precisa?` +
          `${note ? ` ${note}` : ''}`
        : `${department.name} não tem itens para pedir pelo chat.${note ? ` ${note}` : ''} Use a tela de Solicitações.`,
      actions: [requestsScreen(department.id)],
      resultCount: department.items.length,
      state: this.state(conversation, { ...state, departmentId: department.items.length ? department.id : undefined }),
    };
  }

  private async create(
    message: string,
    guest: GuestContext,
    context: DispatchContext,
    state: RequestConversationState,
    previous: RequestConversationState,
  ): Promise<DispatchResult> {
    const conversation = context.state;
    const departments = await this.execute('requests.catalog', guest);
    // Departamento citado agora ou na pergunta anterior ("Governança" → "toalhas").
    const mentioned = mentionedDepartment(message, departments);
    const asked = mentioned ? undefined : departments.find(({ id }) => id === previous.departmentId);
    const named = mentioned ?? asked;
    const scope = named ? [named] : departments;
    let matches: MatchedItem[] = matchItems(message, scope);

    // Item de outro departamento com o mesmo nome: busca em todos. Na
    // resposta a "O que você precisa?" não: a mensagem pode ser outra pergunta.
    if (matches.length === 0 && mentioned) matches = matchItems(message, departments);

    if (matches.length === 0 && asked) {
      return {
        tool: 'requests.preview',
        reply: `Não encontrei esse item em ${asked.name}. Diga o item como aparece na lista ou abra a tela de Solicitações.`,
        actions: [requestsScreen(asked.id)],
        state: this.state(conversation, state),
      };
    }

    if (matches.length === 0) {
      const department = named ?? symptomDepartment(message, departments);
      if (department) return this.askItem(department, conversation, state, 'requests.preview');

      // "Quero fazer uma solicitação": nenhum item citado, então mostra o catálogo.
      if (requestTokens(message).every((token) => REQUEST_WORDS.has(token))) {
        return this.catalog(message, guest, conversation, state);
      }

      return {
        tool: 'requests.preview',
        reply:
          'Não encontrei esse item nas Solicitações. ' +
          `Os departamentos são ${nameList(departments.filter(({ items }) => items.length > 0).map(({ name }) => name), 4)}; diga o item ou abra a tela de Solicitações.`,
        actions: [requestsScreen()],
        state: this.state(conversation, state),
      };
    }

    // Empate pelas mesmas palavras ("toalha" → de banho, de rosto): pergunta qual.
    const tied = matches.filter(({ tied: isTied }) => isTied);

    if (tied.length > 1) {
      const sameDepartment = new Set(tied.map(({ department }) => department.id)).size === 1;
      const options = tied.map(({ item, department }) => (sameDepartment ? item.name : `${item.name} (${department.name})`));

      return {
        tool: 'requests.preview',
        reply: `Qual deles: ${nameList(options, 4).replace(/ e (?=[^,]*$)/, ' ou ')}?`,
        actions: [requestsScreen(sameDepartment ? tied[0].department.id : undefined)],
        state: this.state(conversation, { ...state, departmentId: sameDepartment ? tied[0].department.id : undefined }),
      };
    }

    // Uma solicitação por departamento: prepara a primeira e avisa das demais.
    const department = matches[0].department;
    const others = matches.filter((match) => match.department.id !== department.id);
    const items = matches.filter((match) => match.department.id === department.id);

    // A pré-visualização anterior desta conversa deixa de valer (e perde a nota).
    if (previous.pendingPreviewId) {
      await this.execute('requests.cancel', guest, { conversationId: context.conversationId, previewId: previous.pendingPreviewId });
    }

    const preview = await this.execute('requests.preview', guest, {
      conversationId: context.conversationId,
      departmentId: department.id,
      items: items.map(({ item, quantity }) => ({ itemId: item.id, quantity })),
      note: message,
    });

    if (preview.status === 'rejected') {
      return {
        tool: 'requests.preview',
        reply: preview.message,
        actions: [requestsScreen(department.id)],
        state: this.state(conversation, state),
      };
    }

    return {
      tool: 'requests.preview',
      reply:
        `Preparei a solicitação simulada para ${department.name}: ${describeItems(preview.summary.items)}. ` +
        'Confirme no card ou responda "confirmo".' +
        (others.length ? ` Depois peça ${nameList(others.map(({ item }) => item.name))} separadamente (${others[0].department.name}).` : ''),
      actions: [
        requestCard({
          conversationId: context.conversationId,
          previewId: preview.previewId,
          status: 'preview',
          summary: preview.summary,
          notes: preview.notes,
          expiresAt: preview.expiresAt,
        }),
      ],
      resultCount: preview.summary.items.length,
      state: this.state(conversation, { ...state, pendingPreviewId: preview.previewId }),
    };
  }

  async confirmPreview(
    guest: GuestContext,
    conversationId: string,
    previewId: string,
  ): Promise<{ reply: string; actions: ChatAction[]; result: ToolData<'requests.confirm'> }> {
    const result = await this.execute('requests.confirm', guest, { conversationId, previewId });
    const cards = await this.cards(guest, conversationId, [previewId]);

    if (result.status === 'confirmed' || result.status === 'already_confirmed') {
      return {
        reply:
          `Pronto! Solicitação simulada registrada com o protocolo ${result.protocol}. ` +
          'Ela não foi enviada ao departamento: para atendimento real, use a tela de Solicitações.',
        actions: [...cards, requestsScreen(result.summary.departmentId)],
        result,
      };
    }

    return { reply: 'message' in result ? result.message : NO_PENDING, actions: cards, result };
  }

  private async confirm(guest: GuestContext, context: DispatchContext, state: RequestConversationState): Promise<DispatchResult> {
    if (!state.pendingPreviewId) {
      const reply = context.state.experience?.selectedId ? NO_PENDING_ANY : NO_PENDING;
      return { tool: 'requests.confirm', reply, state: this.state(context.state, state) };
    }

    const { reply, actions } = await this.confirmPreview(guest, context.conversationId, state.pendingPreviewId);

    return {
      tool: 'requests.confirm',
      reply,
      actions,
      completed: true,
      state: this.state(context.state, { ...state, pendingPreviewId: undefined }),
    };
  }

  private async cancel(guest: GuestContext, context: DispatchContext, state: RequestConversationState): Promise<DispatchResult> {
    if (!state.pendingPreviewId) {
      return { tool: 'requests.cancel', reply: 'Não há uma solicitação pendente para descartar.', state: this.state(context.state, state) };
    }

    await this.execute('requests.cancel', guest, { conversationId: context.conversationId, previewId: state.pendingPreviewId });

    return {
      tool: 'requests.cancel',
      reply: 'Tudo bem, descartei a solicitação. Nada foi registrado.',
      actions: await this.cards(guest, context.conversationId, [state.pendingPreviewId]),
      completed: true,
      state: this.state(context.state, { ...state, pendingPreviewId: undefined }),
    };
  }

  /** Cards no estado atual, montados só a partir do banco. */
  async cards(guest: GuestContext, conversationId: string, previewIds: string[]): Promise<ChatAction[]> {
    if (previewIds.length === 0) return [];

    // A ferramenta aceita até 50 IDs por consulta; conversas longas são lidas em partes.
    const chunks = Array.from({ length: Math.ceil(previewIds.length / 50) }, (_, index) => previewIds.slice(index * 50, index * 50 + 50));
    const states = (await Promise.all(chunks.map((ids) => this.execute('requests.cards', guest, { conversationId, previewIds: ids })))).flat();

    return states.map((card) =>
      requestCard({
        conversationId,
        previewId: card.previewId,
        status: card.status,
        summary: card.summary,
        expiresAt: card.expiresAt,
        protocol: card.protocol ?? null,
        reason: card.reason ?? null,
        updatedAt: card.updatedAt,
      }),
    );
  }

  private async history(
    message: string,
    intent: 'request.list' | 'request.status',
    guest: GuestContext,
    conversation: ConversationState,
    state: RequestConversationState,
  ): Promise<DispatchResult> {
    // Inscrições de lazer também são "solicitações" no app (R-LAZ-07).
    const [requests, enrollments] = await Promise.all([
      this.execute('requests.list', guest),
      this.execute('leisure.enrollments', guest),
    ]);
    const label = (request: GuestRequest) =>
      `${request.category} (${request.description})${request.simulated ? `, protocolo ${request.protocol}` : ''}`;
    const statusOf = (request: GuestRequest) => STATUS_LABELS[request.status.toLowerCase()] ?? request.status;
    const pendingEnrollments = enrollments.filter(({ status }) => status === 'pendente').length;
    const leisureLine = enrollments.length
      ? `Inscrições de lazer: ${enrollments.length}${pendingEnrollments ? ` (${pendingEnrollments} ${pendingEnrollments === 1 ? 'pendente' : 'pendentes'})` : ''}.`
      : '';
    const cards = (selected: GuestRequest[], leisure = enrollments) =>
      [...requestList('Minhas solicitações', requestItems(selected, leisure)), myRequestsScreen()];

    if (requests.length === 0 && enrollments.length === 0) {
      return {
        tool: 'requests.list',
        reply: 'Você não tem solicitações nesta estadia. Se precisar de algo, é só dizer, por exemplo "preciso de toalhas".',
        actions: [requestsScreen()],
        state: this.state(conversation, state),
      };
    }

    if (requests.length === 0) {
      const [latest] = enrollments;
      return {
        tool: 'requests.list',
        reply: `Você não tem solicitações a departamentos nesta estadia. ${leisureLine} A mais recente: ${latest.title}, ${LEISURE_STATUS[latest.status] ?? latest.status}.`,
        actions: cards([]),
        resultCount: enrollments.length,
        state: this.state(conversation, state),
      };
    }

    if (intent === 'request.status' || requests.length === 1) {
      const selected = this.select(message, requests, state.lastRequestId);

      if (selected) {
        const reply = selected.simulated
          ? `Sua solicitação simulada de ${selected.category} (${selected.description}) foi registrada em ${selected.createdAt}, ` +
            `protocolo ${selected.protocol}. Ela não chega ao departamento.`
          : `Sua solicitação de ${label(selected)}, aberta em ${selected.createdAt}, está ${statusOf(selected)}.`;
        // Status pedido: só a solicitação escolhida. Lista com uma só: as inscrições também.
        const listing = intent === 'request.list';

        return {
          tool: 'requests.list',
          reply: listing && leisureLine ? `${reply} ${leisureLine}` : reply,
          actions: listing ? cards([selected]) : cards([selected], []),
          state: this.state(conversation, { ...state, lastRequestId: selected.id }),
        };
      }
    }

    // Resumo por status; os detalhes completos ficam nos cards e em Minhas Solicitações.
    const counts = Object.entries(
      requests.reduce<Record<string, number>>((total, request) => {
        const status = statusOf(request);
        total[status] = (total[status] ?? 0) + 1;
        return total;
      }, {}),
    ).map(([status, count]) => `${count} ${count === 1 ? status : (STATUS_PLURALS[status] ?? status)}`);
    const [latest] = requests;

    return {
      tool: 'requests.list',
      reply:
        `Você tem ${requests.length} ${requests.length === 1 ? 'solicitação' : 'solicitações'} nesta estadia: ${nameList(counts, 4)}. ` +
        `A mais recente: ${label(latest)}, ${statusOf(latest)}.${leisureLine ? ` ${leisureLine}` : ''}`,
      actions: cards(requests),
      resultCount: requests.length + enrollments.length,
      state: this.state(conversation, { ...state, lastRequestId: latest.id }),
    };
  }

  /**
   * A solicitação pedida: pelo assunto ("a da toalha"), pela referência
   * ("a anterior" → a mais recente) ou a única existente.
   */
  private select(message: string, requests: GuestRequest[], lastId?: string): GuestRequest | null {
    if (requests.length === 1) return requests[0];

    const text = normalizeText(message);
    const terms = text.split(' ').filter((word) => word.length >= 4 && !/^(?:solicitac|chamado|minha|status|como|esta|qual|anterior|ultima|recente)/.test(word));
    const scored = requests
      .map((request) => {
        const searchable = normalizeText(`${request.category} ${request.description}`).split(' ');
        return { request, score: terms.filter((term) => searchable.some((word) => word.startsWith(term.slice(0, 5)))).length };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score);

    if (scored.length && (scored.length === 1 || scored[0].score > scored[1].score)) return scored[0].request;
    if (scored.length) return null;

    if (LATEST.test(text)) {
      return requests.find(({ id }) => id === lastId) ?? requests[0];
    }

    return null;
  }
}
