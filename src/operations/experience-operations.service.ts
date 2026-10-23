import { Injectable, InternalServerErrorException } from '@nestjs/common';

import { compactText, matchByName } from '../common/text.js';
import type { ChatAction } from '../contracts/chat-actions.js';
import type {
  ConversationState,
  ExperienceConversationState,
} from '../contracts/conversation-state.js';
import type { ExperienceIntent, IntentDecision } from '../chat/chat-intent.types.js';
import type { ConfirmResult, PreviewResult } from '../experiences/experience-booking.service.js';
import { formatCurrency, quoteExperience } from '../experiences/experience-pricing.js';
import { MAX_PARTY_SIZE } from '../experiences/experience-rules.js';
import type {
  ExperienceInfo,
  ExperienceSlot,
  PartyComposition,
} from '../experiences/experience.types.js';
import type { GuestContext } from '../guest/guest-context.js';
import { ResortClock } from '../resort/resort-clock.service.js';

import {
  OperationsToolRegistryService,
  type OperationToolName,
  type OperationToolResult,
} from './operations-tool-registry.service.js';
import { RestaurantOperationsService } from './restaurant-operations.service.js';
import {
  SIMULATION_NOTICE,
  SNAPSHOT_NOTICE,
  type DispatchContext,
  type DispatchResult,
} from './operations.types.js';

type ToolData<N extends OperationToolName> = Extract<OperationToolResult, { tool: N }>['data'];

type Resolution =
  | { kind: 'found'; experience: ExperienceInfo }
  | { kind: 'ambiguous'; candidates: ExperienceInfo[] }
  | { kind: 'none' };

const MAX_LISTED = 10;

function describeSlot(slot: ExperienceSlot): string {
  const when = slot.time ? `às ${slot.time}` : 'horário não especificado (vaga para o dia)';

  if (slot.remainingAdults !== null || slot.remainingChildren !== null) {
    const adults = slot.remainingAdults ?? '—';
    const children = slot.remainingChildren ?? '—';
    return `${when}: ${adults} vaga(s) para adultos e ${children} para crianças`;
  }

  if (slot.remaining !== null) {
    return `${when}: ${slot.remaining} vaga(s)`;
  }

  return `${when}: quantidade de vagas não cadastrada`;
}

function describeParty(party: PartyComposition): string {
  const parts = [
    party.adults ? `${party.adults} ${party.adults === 1 ? 'adulto' : 'adultos'}` : '',
    party.children ? `${party.children} ${party.children === 1 ? 'criança' : 'crianças'}` : '',
  ].filter(Boolean);

  return parts.join(' e ') || 'nenhum participante';
}

function describePrices(experience: ExperienceInfo): string {
  if (experience.reservationType === 'allinclusive') {
    return 'Sem cobrança cadastrada (all inclusive).';
  }

  if (experience.prices.length === 0) {
    return 'Valores não cadastrados.';
  }

  return experience.prices
    .map(({ category, price }) => `${category}: ${formatCurrency(price)}`)
    .join('; ');
}

/**
 * Consultas e reservas simuladas de experiências pelo chat.
 *
 * A interpretação (classificador + entidades) é separada da execução:
 * aqui somente identificadores vindos do banco ou do estado do
 * servidor são enviados às ferramentas do Registry.
 */
@Injectable()
export class ExperienceOperationsService {
  constructor(
    private readonly registry: OperationsToolRegistryService,
    private readonly restaurants: RestaurantOperationsService,
    private readonly clock: ResortClock,
  ) {}

  private async execute<N extends OperationToolName>(
    name: N,
    guest: GuestContext,
    input: unknown = {},
  ): Promise<ToolData<N>> {
    const result = await this.registry.execute(name, guest, input);

    if (result.tool !== name) {
      throw new InternalServerErrorException('Resultado inesperado da ferramenta.');
    }

    return result.data as unknown as ToolData<N>;
  }

  private async resolveExperience(
    message: string,
    decision: IntentDecision,
    state: ExperienceConversationState,
    guest: GuestContext,
  ): Promise<Resolution> {
    const ordinal = decision.entities?.ordinal;
    const listed = state.listed ?? [];

    if (ordinal !== undefined && listed.length > 0) {
      const index = ordinal === -1 ? listed.length - 1 : ordinal - 1;
      const reference = listed[index];

      if (!reference) {
        return { kind: 'none' };
      }

      const experience = await this.execute('experiences.details', guest, {
        experienceId: reference.id,
      });

      return experience ? { kind: 'found', experience } : { kind: 'none' };
    }

    const { experiences } = await this.execute('experiences.list', guest, {
      includeInactive: true,
    });

    const candidates = experiences.map((experience) => ({ ...experience, name: experience.title }));

    // Experiências ativas têm prioridade sobre homônimas inativas.
    const activeMatches = matchByName(message, candidates.filter(({ active }) => active));
    const matches = activeMatches.length ? activeMatches : matchByName(message, candidates);

    if (matches.length === 1) {
      return { kind: 'found', experience: matches[0] };
    }

    if (matches.length > 1) {
      // Mantém a experiência já selecionada quando ela está entre os empatados.
      const selected = matches.find(({ id }) => id === state.selectedId);
      return selected
        ? { kind: 'found', experience: selected }
        : { kind: 'ambiguous', candidates: matches };
    }

    if (state.selectedId) {
      const experience = await this.execute('experiences.details', guest, {
        experienceId: state.selectedId,
      });

      return experience ? { kind: 'found', experience } : { kind: 'none' };
    }

    return { kind: 'none' };
  }

  private partyFrom(
    decision: IntentDecision,
    state: ExperienceConversationState,
  ): { party: PartyComposition | null; assumed: boolean } {
    const entities = decision.entities ?? {};

    if (entities.adults !== undefined || entities.children !== undefined) {
      return {
        party: { adults: entities.adults ?? 0, children: entities.children ?? 0 },
        assumed: false,
      };
    }

    // "2 pessoas" sem divisão: considera adultos e avisa o hóspede.
    if (entities.people !== undefined) {
      return { party: { adults: entities.people, children: 0 }, assumed: true };
    }

    if (state.adults !== undefined || state.children !== undefined) {
      return {
        party: { adults: state.adults ?? 0, children: state.children ?? 0 },
        assumed: state.partyAssumed ?? false,
      };
    }

    return { party: null, assumed: false };
  }

  async handle(
    message: string,
    decision: IntentDecision & { intent: ExperienceIntent },
    guest: GuestContext,
    context: DispatchContext,
  ): Promise<DispatchResult> {
    const previous = context.state.experience ?? {};
    // Qualquer nova interação invalida a confirmação por texto
    // de uma pré-reserva anterior, exceto a própria confirmação.
    const state: ExperienceConversationState = { ...previous, pendingPreviewId: undefined };

    switch (decision.intent) {
      case 'experience.booking.confirm':
        return this.confirm(guest, context, previous);
      case 'experience.booking.cancel':
        return this.cancel(guest, context, previous);
      case 'experience.reservations':
        return this.reservations(guest, context.state, state);
      case 'experience.list':
        return this.list(decision, guest, context.state, state);
      default:
        break;
    }

    const resolution = await this.resolveExperience(message, decision, state, guest);

    if (resolution.kind === 'ambiguous') {
      const listed = resolution.candidates.slice(0, MAX_LISTED).map(({ id, title }) => ({ id, title }));

      return this.result('experiences.list', [
        'Encontrei mais de uma experiência com esse nome:',
        ...listed.map(({ title }, index) => `${index + 1}. ${title}`),
        'Qual delas você deseja?',
      ].join('\n'), context.state, { ...state, listed, listedDate: state.date ?? null, selectedId: undefined, selectedTitle: undefined });
    }

    if (resolution.kind === 'none') {
      if (decision.intent === 'experience.booking') {
        const restaurants = await this.restaurants.findMentioned(message, guest);

        if (restaurants.length > 0) {
          const result = await this.restaurants.handleBooking(message, guest);
          return { ...result, state: { ...context.state, topic: 'restaurant' } };
        }
      }

      const hint = state.listed?.length
        ? 'Informe o nome ou o número da experiência da lista.'
        : 'Informe o nome da experiência ou pergunte "Quais experiências posso fazer?".';

      return this.result('experiences.list', `Não identifiquei qual experiência você deseja. ${hint}`, context.state, state);
    }

    const { experience } = resolution;
    const selected: ExperienceConversationState = {
      ...state,
      selectedId: experience.id,
      selectedTitle: experience.title,
      date: decision.entities?.date ?? state.date ?? state.listedDate ?? undefined,
      time: decision.entities?.time ?? (decision.entities?.date ? null : state.time),
    };

    const { party, assumed } = this.partyFrom(decision, selected);

    if (party) {
      selected.adults = party.adults;
      selected.children = party.children;
      selected.partyAssumed = assumed;
    }

    switch (decision.intent) {
      case 'experience.price':
        return this.price(experience, party, assumed, context.state, selected);
      case 'experience.availability':
        return this.availability(experience, party, assumed, guest, context.state, selected);
      case 'experience.booking':
        return this.preview(experience, party, assumed, guest, context, selected);
      default:
        if (decision.detail === 'party_size') {
          return this.result('experiences.details', party
            ? `Para ${experience.title}, estou considerando ${describeParty(party)}.${assumed ? ' Se houver crianças, me avise.' : ''}`
            : `Ainda não sei quantas pessoas vão participar de ${experience.title}. Quantos adultos e crianças?`,
          context.state, selected);
        }

        return this.details(experience, party, context.state, selected);
    }
  }

  private result(
    tool: OperationToolName,
    reply: string,
    state: ConversationState,
    experience: ExperienceConversationState,
    actions: ChatAction[] = [],
  ): DispatchResult {
    return {
      tool,
      reply,
      actions,
      state: { ...state, topic: 'experience', experience },
    };
  }

  private async list(
    decision: IntentDecision,
    guest: GuestContext,
    conversation: ConversationState,
    state: ExperienceConversationState,
  ): Promise<DispatchResult> {
    const date = decision.entities?.date ?? null;
    const { experiences, slots } = await this.execute('experiences.list', guest, { date });

    const withoutBooking = experiences.filter((experience) => !experience.bookable);

    if (!date) {
      const listed = experiences.slice(0, MAX_LISTED).map(({ id, title }) => ({ id, title }));

      return this.result('experiences.list', [
        'Estas são as experiências ativas no cadastro do resort:',
        ...experiences.slice(0, MAX_LISTED).map((experience, index) =>
          `${index + 1}. ${experience.title} — ${experience.bookable ? 'com reserva' : 'sem necessidade de reserva'}`,
        ),
        'Posso verificar os horários de alguma delas. Para qual data?',
      ].join('\n'), conversation, { ...state, listed, listedDate: null });
    }

    const bookableIds = new Set(
      experiences.filter((experience) => experience.bookable).map(({ id }) => id),
    );
    const available = experiences.filter(
      (experience) =>
        bookableIds.has(experience.id) &&
        slots.some((slot) => slot.experienceId === experience.id),
    );
    const label = ResortClock.describeDate(date);

    if (available.length === 0) {
      return this.result('experiences.list', [
        `Não encontrei vagas de experiências com reserva registradas para ${label}.`,
        withoutBooking.length
          ? `Sem necessidade de reserva: ${withoutBooking.map(({ title }) => title).join(', ')}.`
          : '',
        SNAPSHOT_NOTICE,
      ].filter(Boolean).join('\n'), conversation, { ...state, listed: [], listedDate: date, date });
    }

    const listed = available.slice(0, MAX_LISTED).map(({ id, title }) => ({ id, title }));

    return this.result('experiences.list', [
      `Para ${label}, o cadastro do resort registra vagas para:`,
      ...available.slice(0, MAX_LISTED).map((experience, index) => {
        const times = slots
          .filter((slot) => slot.experienceId === experience.id)
          .map(describeSlot)
          .join('; ');
        return `${index + 1}. ${experience.title} — ${times}`;
      }),
      withoutBooking.length
        ? `Sem necessidade de reserva: ${withoutBooking.map(({ title }) => title).join(', ')}.`
        : '',
      SNAPSHOT_NOTICE,
    ].filter(Boolean).join('\n'), conversation, { ...state, listed, listedDate: date, date });
  }

  private details(
    experience: ExperienceInfo,
    party: PartyComposition | null,
    conversation: ConversationState,
    state: ExperienceConversationState,
  ): DispatchResult {
    const rules = [
      experience.minimumAge ? `idade mínima de ${experience.minimumAge} anos` : '',
      experience.minimumAgeAlone ? `menores de ${experience.minimumAgeAlone} anos precisam de um responsável` : '',
      experience.requiresGuardian ? 'exige um adulto responsável' : '',
      experience.bookingCutoff ? `horário-limite de marcação: ${experience.bookingCutoff}` : '',
    ].filter(Boolean);

    return this.result('experiences.details', [
      `${experience.title}${experience.active ? '' : ' (inativa no cadastro)'}`,
      experience.description ? compactText(experience.description, 500) : 'Descrição não cadastrada.',
      `Reserva: ${experience.bookable ? 'necessária' : 'não necessária'}.`,
      `Valores: ${describePrices(experience)}`,
      rules.length ? `Regras: ${rules.join('; ')}.` : '',
      party ? `Participantes considerados até agora: ${describeParty(party)}.` : '',
      experience.bookable && experience.active ? 'Quer que eu verifique os horários disponíveis?' : '',
    ].filter(Boolean).join('\n'), conversation, state);
  }

  private price(
    experience: ExperienceInfo,
    party: PartyComposition | null,
    assumed: boolean,
    conversation: ConversationState,
    state: ExperienceConversationState,
  ): DispatchResult {
    if (!party) {
      return this.result('experiences.details', [
        `Valores de ${experience.title}: ${describePrices(experience)}`,
        'Para calcular o total, me diga quantos adultos e crianças vão participar.',
      ].join('\n'), conversation, state);
    }

    const quote = quoteExperience(experience, party);

    return this.result('experiences.details', [
      quote.total !== null
        ? `${experience.title} para ${describeParty(party)}: ${quote.included ? 'sem cobrança (all inclusive)' : formatCurrency(quote.total)}.`
        : `Não consigo calcular o total de ${experience.title} para ${describeParty(party)}.`,
      quote.note && !quote.included ? quote.note : '',
      assumed ? 'Considerei todos os participantes como adultos; se houver crianças, me avise.' : '',
    ].filter(Boolean).join('\n'), conversation, state);
  }

  private async availability(
    experience: ExperienceInfo,
    party: PartyComposition | null,
    assumed: boolean,
    guest: GuestContext,
    conversation: ConversationState,
    state: ExperienceConversationState,
  ): Promise<DispatchResult> {
    if (!state.date) {
      return this.result('experiences.availability', `Para qual data você deseja consultar ${experience.title}?`, conversation, state);
    }

    const label = ResortClock.describeDate(state.date);
    const { slots } = await this.execute('experiences.availability', guest, {
      experienceId: experience.id,
      date: state.date,
    });

    if (!experience.active || !experience.bookable) {
      return this.details(experience, party, conversation, state);
    }

    if (slots.length === 0) {
      return this.result('experiences.availability', [
        `Não há horários registrados para ${experience.title} em ${label}.`,
        SNAPSHOT_NOTICE,
      ].join('\n'), conversation, state);
    }

    const lines = [`${experience.title} em ${label}:`, ...slots.map((slot) => `- ${describeSlot(slot)}`)];

    if (party) {
      const total = party.adults + party.children;
      const fitting = slots.filter(
        (slot) =>
          (slot.remaining === null || slot.remaining >= total) &&
          (slot.remainingAdults === null || slot.remainingAdults >= party.adults) &&
          (slot.remainingChildren === null || slot.remainingChildren >= party.children),
      );

      lines.push(
        fitting.length
          ? `Há registro de vagas compatíveis com ${describeParty(party)}.`
          : `Não há vagas registradas suficientes para ${describeParty(party)}.`,
      );

      if (fitting.some((slot) => slot.remaining === null && slot.remainingAdults === null && slot.remainingChildren === null)) {
        lines.push('Em alguns horários a quantidade de vagas não está cadastrada.');
      }

      if (assumed) {
        lines.push('Considerei todos os participantes como adultos; se houver crianças, me avise.');
      }

      if (fitting.length) {
        lines.push('Se quiser, posso preparar a reserva simulada.');
      }
    } else {
      lines.push('Para quantas pessoas seria?');
    }

    lines.push(SNAPSHOT_NOTICE);

    return this.result('experiences.availability', lines.join('\n'), conversation, state);
  }

  private async preview(
    experience: ExperienceInfo,
    party: PartyComposition | null,
    assumed: boolean,
    guest: GuestContext,
    context: DispatchContext,
    state: ExperienceConversationState,
  ): Promise<DispatchResult> {
    // Regras verificáveis antes de qualquer gravação.
    if (!experience.active || !experience.bookable) {
      return this.result('experiences.details', [
        experience.active
          ? `A experiência "${experience.title}" não exige reserva pelo aplicativo.`
          : `A experiência "${experience.title}" está inativa no cadastro do resort e não pode ser reservada.`,
        'Posso mostrar as experiências disponíveis, se desejar.',
      ].join(' '), context.state, state);
    }

    const missing = [
      !state.date ? 'a data' : '',
      !party ? 'quantos adultos e crianças vão participar' : '',
    ].filter(Boolean);

    if (missing.length) {
      return this.result('experiences.details', `Para preparar a reserva de ${experience.title}, preciso saber ${missing.join(' e ')}.`, context.state, state);
    }

    if (party!.adults + party!.children > MAX_PARTY_SIZE) {
      return this.result('experiences.details', `Pelo chat é possível reservar para até ${MAX_PARTY_SIZE} pessoas. Para grupos maiores, procure a recepção.`, context.state, state);
    }

    const result: PreviewResult = await this.execute('experiences.booking.preview', guest, {
      conversationId: context.conversationId,
      experienceId: experience.id,
      date: state.date,
      time: state.time ?? null,
      adults: party!.adults,
      children: party!.children,
    });

    if (result.status === 'rejected') {
      return this.result('experiences.booking.preview', [
        result.message,
        result.options?.length ? `Horários registrados: ${result.options.join(', ')}.` : '',
      ].filter(Boolean).join(' '), context.state, state);
    }

    const { summary } = result;
    const lines = [
      'Confira o resumo da reserva simulada:',
      `Experiência: ${summary.experienceTitle}`,
      `Data: ${ResortClock.describeDate(summary.date)}`,
      `Horário: ${summary.time ?? 'vaga para o dia (sem horário específico)'}`,
      `Participantes: ${describeParty(summary)}`,
      `Valor: ${
        summary.totalPrice === null
          ? `não calculado${result.quote.note ? ` (${result.quote.note})` : ''}`
          : result.quote.included
            ? 'sem cobrança (all inclusive)'
            : formatCurrency(summary.totalPrice)
      }`,
      ...result.warnings,
      assumed ? 'Considerei todos os participantes como adultos; se houver crianças, me avise antes de confirmar.' : '',
      SIMULATION_NOTICE,
      'Deseja confirmar? Responda "confirmo" ou use o botão de confirmação.',
    ].filter(Boolean);

    return this.result(
      'experiences.booking.preview',
      lines.join('\n'),
      context.state,
      { ...state, time: summary.time, pendingPreviewId: result.previewId },
      [
        {
          type: 'experience.booking.preview',
          label: 'Confirmar reserva simulada',
          previewId: result.previewId,
          expiresAt: result.expiresAt.toISOString(),
          summary,
          confirm: {
            method: 'POST',
            path: '/chat/actions',
            body: {
              type: 'experience.booking.confirm',
              conversationId: context.conversationId,
              previewId: result.previewId,
            },
          },
        },
      ],
    );
  }

  /** Usado pelo chat ("confirmo") e por POST /chat/actions. */
  async confirmPreview(
    guest: GuestContext,
    conversationId: string,
    previewId: string,
  ): Promise<{ reply: string; actions: ChatAction[]; result: ConfirmResult }> {
    const result: ConfirmResult = await this.execute('experiences.booking.confirm', guest, {
      conversationId,
      previewId,
    });

    if ('message' in result) {
      return { reply: result.message, actions: [], result };
    }

    const { summary } = result;

    return {
      result,
      reply: [
        result.status === 'already_confirmed'
          ? 'Esta reserva simulada já estava confirmada.'
          : 'Reserva simulada registrada.',
        `${summary.experienceTitle} — ${ResortClock.describeDate(summary.date)}${summary.time ? ` às ${summary.time}` : ''}, ${describeParty(summary)}.`,
        `Código da simulação: ${result.confirmationCode}.`,
        SIMULATION_NOTICE,
      ].join('\n'),
      actions: [
        {
          type: 'experience.booking.confirm',
          label: 'Reserva simulada confirmada',
          bookingId: result.bookingId,
          confirmationCode: result.confirmationCode,
          status: 'confirmed',
          alreadyConfirmed: result.status === 'already_confirmed',
          summary,
        },
      ],
    };
  }

  private async confirm(
    guest: GuestContext,
    context: DispatchContext,
    state: ExperienceConversationState,
  ): Promise<DispatchResult> {
    if (!state.pendingPreviewId) {
      return this.result('experiences.booking.confirm', 'Não há uma pré-reserva aguardando confirmação nesta conversa.', context.state, state);
    }

    const { reply, actions } = await this.confirmPreview(guest, context.conversationId, state.pendingPreviewId);

    return this.result('experiences.booking.confirm', reply, context.state, { ...state, pendingPreviewId: undefined }, actions);
  }

  private async cancel(
    guest: GuestContext,
    context: DispatchContext,
    state: ExperienceConversationState,
  ): Promise<DispatchResult> {
    if (state.pendingPreviewId) {
      await this.execute('experiences.booking.cancel', guest, {
        conversationId: context.conversationId,
        previewId: state.pendingPreviewId,
      });
    }

    return this.result('experiences.booking.cancel', 'Tudo bem, a pré-reserva foi descartada e nada foi registrado.', context.state, { ...state, pendingPreviewId: undefined });
  }

  private async reservations(
    guest: GuestContext,
    conversation: ConversationState,
    state: ExperienceConversationState,
  ): Promise<DispatchResult> {
    const { official, simulated } = await this.execute('experiences.reservations', guest);

    if (official.length === 0 && simulated.length === 0) {
      return this.result('experiences.reservations', 'Não encontrei reservas de experiências para a sua hospedagem.', conversation, state);
    }

    const statusLabel: Record<string, string> = {
      pago: 'paga',
      pendente: 'pendente',
      cancelado: 'cancelada',
    };

    return this.result('experiences.reservations', [
      official.length ? 'Reservas registradas no sistema do resort:' : '',
      ...official.map((booking) =>
        `- ${booking.title} — ${ResortClock.formatDate(booking.date)}${booking.time ? ` às ${booking.time}` : ''}, ${booking.participants} participante(s), ${statusLabel[booking.status] ?? booking.status}`,
      ),
      simulated.length ? 'Reservas simuladas feitas pelo chat (não registradas no sistema oficial):' : '',
      ...simulated.map((booking) =>
        `- ${booking.experienceTitle} — ${ResortClock.formatDate(booking.bookingDate)}${booking.bookingTime ? ` às ${booking.bookingTime}` : ''}, ${describeParty(booking)}, código ${booking.confirmationCode}`,
      ),
    ].filter(Boolean).join('\n'), conversation, state);
  }
}
