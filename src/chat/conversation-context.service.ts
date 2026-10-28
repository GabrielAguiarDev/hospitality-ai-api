import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { EntityManager, Repository } from 'typeorm';

import { normalizeText } from '../common/text.js';
import { CUISINE_CUE } from '../operations/restaurant-search.js';
import { pendingConfirmation, type ConversationPhase, type ConversationState } from '../contracts/conversation-state.js';
import type { GuestContext } from '../guest/guest-context.js';
import type { DispatchResult } from '../operations/operations.types.js';

import type { ChatIntent, IntentDecision } from './chat-intent.types.js';
import { ChatConversationState } from './entities/chat-conversation-state.entity.js';

export const CONCURRENT_UPDATE_MESSAGE =
  'A conversa foi atualizada por outra requisição. Envie a mensagem novamente.';

// "essa experiência", "como é ela?", "e dele?".
const DEMONSTRATIVE =
  /\b(?:essa|esse|dessa|desse|desta|deste|nessa|nesse|ela|ele|dela|dele|nela|nele|aquela|aquele|daquela|daquele|mesma|mesmo)\b/;
// "esta"/"este" ficam de fora: "está" normalizado também vira "esta".

// Intenções que agem sobre uma entidade já apresentada.
const EXPERIENCE_TARGETED = new Set<ChatIntent>([
  'experience.details',
  'experience.price',
  'experience.availability',
  'experience.booking',
]);
const RESTAURANT_TARGETED = new Set<ChatIntent>(['restaurant.details', 'restaurant.booking', 'restaurant.menu']);

export interface StoredContext {
  state: ConversationState;
  // null quando a conversa ainda não tem estado gravado.
  version: number | null;
}

/**
 * Contexto estruturado da conversa: assunto, itens apresentados,
 * entidade selecionada, filtros, pergunta pendente e pré-reserva.
 *
 * O estado pertence a conversation_id + resort_id + guest_id e nunca é
 * compartilhado entre conversas. Referências como "essa", "a única" ou
 * "sim" são resolvidas aqui, a partir do estado, antes das ferramentas.
 */
@Injectable()
export class ConversationContextService {
  private readonly logger = new Logger(ConversationContextService.name);

  constructor(
    @InjectRepository(ChatConversationState)
    private readonly statesRepository: Repository<ChatConversationState>,
  ) {}

  async load(conversationId: string | undefined, guest: GuestContext): Promise<StoredContext> {
    if (!conversationId) {
      return { state: {}, version: null };
    }

    const stored = await this.statesRepository.findOneBy({
      conversationId,
      resortId: guest.resortId,
      guestId: guest.guestId,
    });

    return { state: stored?.state ?? {}, version: stored?.version ?? null };
  }

  /**
   * Grava o estado somente quando ele muda. Controle otimista: se outra
   * requisição da mesma conversa alterou o estado, nada é gravado.
   */
  async save(
    manager: EntityManager,
    conversationId: string,
    guest: GuestContext,
    previous: StoredContext,
    next: ConversationState | undefined,
  ): Promise<void> {
    if (!next || JSON.stringify(next) === JSON.stringify(previous.state)) {
      return;
    }

    const owner = { conversationId, resortId: guest.resortId, guestId: guest.guestId };

    if (previous.version !== null) {
      const updated = await manager.update(
        ChatConversationState,
        { ...owner, version: previous.version },
        { state: next, version: previous.version + 1 },
      );

      if (!updated?.affected) {
        throw new ConflictException(CONCURRENT_UPDATE_MESSAGE);
      }
    } else {
      try {
        await manager.insert(ChatConversationState, { ...owner, state: next, version: 1 });
      } catch (error) {
        if ((error as { code?: string })?.code === 'ER_DUP_ENTRY') {
          throw new ConflictException(CONCURRENT_UPDATE_MESSAGE);
        }

        throw error;
      }
    }

    this.logger.debug(`Estado atualizado: ${changedKeys(previous.state, next).join(', ') || 'sem mudanças relevantes'}.`);
  }

  /**
   * Resolve a entidade a que a mensagem se refere. Nome e posição
   * ("a segunda") continuam com os handlers, que consultam o cadastro;
   * aqui ficam as referências que só o estado explica.
   */
  resolve(message: string, decision: IntentDecision, state: ConversationState): IntentDecision {
    const pending = state.pendingQuestion;

    // "all" (ou "all:<tipo>") é uma opção da pergunta ("ver todas"), não uma entidade.
    if (decision.answersPending && pending?.targetId && !pending.targetId.startsWith('all')) {
      const kind = decision.intent.startsWith('restaurant.') ? 'restaurant' : 'experience';
      return this.withTarget(decision, kind, pending.targetId, 'pending_question');
    }

    if (decision.entities?.ordinal !== undefined) {
      return decision;
    }

    const demonstrative = DEMONSTRATIVE.test(normalizeText(message));

    if (EXPERIENCE_TARGETED.has(decision.intent) && state.experience) {
      const { listed = [], selectedId } = state.experience;
      // Depois de uma lista, "essa" se refere à lista; senão, à selecionada.
      const afterList = state.lastIntent === 'experience.search' || state.lastIntent === 'experience.list';

      if (afterList && listed.length === 1 && (demonstrative || !selectedId)) {
        return this.withTarget(decision, 'experience', listed[0].id, 'single_listed');
      }

      if (demonstrative && selectedId && !(afterList && listed.length > 1)) {
        return this.withTarget(decision, 'experience', selectedId, 'demonstrative');
      }
    }

    if (RESTAURANT_TARGETED.has(decision.intent) && state.restaurant) {
      const { listed = [], selectedId } = state.restaurant;

      // "Quero reservar" e "mostre o cardápio" logo após um restaurante falam dele.
      // O cardápio usa a selecionada só dentro do assunto e sem outra cozinha pedida.
      const menuOfSelected =
        decision.intent === 'restaurant.menu' && state.topic === 'restaurant' && !CUISINE_CUE.test(normalizeText(message));
      if (selectedId && (demonstrative || decision.intent === 'restaurant.booking' || menuOfSelected)) {
        return this.withTarget(decision, 'restaurant', selectedId, 'selected');
      }

      // Somente logo após uma lista; um nome citado ainda vence no handler.
      if (listed.length === 1 && state.lastIntent === 'restaurant.list') {
        return this.withTarget(decision, 'restaurant', listed[0].id, 'single_listed');
      }
    }

    return decision;
  }

  /**
   * Próximo estado após uma operação: a pergunta pendente vale somente
   * para a mensagem seguinte e só existe se a resposta atual a fez.
   */
  afterOperation(result: DispatchResult, fallback: ConversationState, intent: ChatIntent): ConversationState {
    const { pendingQuestion: _previous, ...base } = result.state ?? fallback;
    const phase: ConversationPhase = pendingConfirmation(base)
      ? 'awaiting_confirmation'
      : result.completed
        ? 'completed'
        : 'operation';

    return this.withPhase({
      ...base,
      lastIntent: result.intent ?? intent,
      ...(result.pendingQuestion ? { pendingQuestion: result.pendingQuestion } : {}),
    }, phase);
  }

  afterKnowledge(state: ConversationState, intent: ChatIntent): ConversationState {
    const { pendingQuestion: _unanswered, ...rest } = state;
    return this.withPhase({ ...rest, lastIntent: intent }, 'knowledge');
  }

  /**
   * Interações sociais preservam o estado (inclusive a pré-reserva), mas
   * encerram a pergunta pendente: um "sim" depois de "Obrigado!" não
   * responde a uma pergunta antiga.
   */
  afterConversation(state: ConversationState, _decision: IntentDecision): ConversationState {
    const { pendingQuestion: _closed, ...rest } = state;
    // Uma conversa livre depois de uma operação concluída mantém a
    // fase "concluída", para que nada reabra a operação anterior.
    const phase: ConversationPhase = pendingConfirmation(rest)
      ? 'awaiting_confirmation'
      : rest.phase === 'completed'
        ? 'completed'
        : 'conversation';

    return this.withPhase(rest, phase);
  }

  private withPhase(state: ConversationState, phase: ConversationPhase): ConversationState {
    if (state.phase !== phase) {
      this.logger.debug(`Fase da conversa: ${state.phase ?? 'inicial'} → ${phase}.`);
    }

    return { ...state, phase };
  }

  private withTarget(
    decision: IntentDecision,
    kind: 'experience' | 'restaurant',
    id: string,
    via: NonNullable<IntentDecision['target']>['via'],
  ): IntentDecision {
    this.logger.debug(`Referência contextual resolvida: ${kind} via ${via}.`);
    return { ...decision, target: { kind, id, via } };
  }
}

// Somente nomes de campos: valores podem conter dados do hóspede.
function changedKeys(previous: ConversationState, next: ConversationState): string[] {
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]) as Set<keyof ConversationState>;
  const changed: string[] = [];

  for (const key of keys) {
    const before = previous[key];
    const after = next[key];

    if (JSON.stringify(before) === JSON.stringify(after)) continue;

    if (before && after && typeof before === 'object' && typeof after === 'object') {
      const inner = new Set([...Object.keys(before), ...Object.keys(after)]);
      for (const field of inner) {
        const a = (before as Record<string, unknown>)[field];
        const b = (after as Record<string, unknown>)[field];
        if (JSON.stringify(a) !== JSON.stringify(b)) changed.push(`${key}.${field}`);
      }
    } else {
      changed.push(key);
    }
  }

  return changed;
}
