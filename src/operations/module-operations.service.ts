import { Injectable, InternalServerErrorException } from '@nestjs/common';

import { capabilityOf, type AppModule } from '../capabilities/capabilities.js';
import type { IntentDecision, ModuleIntent } from '../chat/chat-intent.types.js';
import { nameList, normalizeText } from '../common/text.js';
import { navigateAction, navigateButton, type CatalogItem, type CatalogKind, type ChatAction } from '../contracts/chat-actions.js';
import type { CatalogConversationState, ConversationState } from '../contracts/conversation-state.js';
import { formatCurrency } from '../experiences/experience-pricing.js';
import type { GuestContext } from '../guest/guest-context.js';
import type { BoutiqueProduct, EsgInfo, QuizInfo, SpaService, Tip } from '../resort/modules-catalog.service.js';

import { catalogList, optionButton } from './card-builders.js';
import { OperationsToolRegistryService, type OperationToolName, type OperationToolResult } from './operations-tool-registry.service.js';
import type { DispatchContext, DispatchResult } from './operations.types.js';
import { requestTokens } from './request-matching.js';

type ToolData<N extends OperationToolName> = Extract<OperationToolResult, { tool: N }>['data'];

// Palavras que só dizem o módulo ou a pergunta, nunca o item procurado.
const GENERIC = new Set(
  [
    'boutique', 'loja', 'lojinha', 'produto', 'vende', 'vendem', 'comprar', 'compra', 'tem', 'quai', 'qual', 'quanto',
    'custa', 'preco', 'valor', 'spa', 'servico', 'oferece', 'oferecem', 'dica', 'quero', 'gostaria', 'sobre', 'ver', 'mostra',
    'mostre', 'lista', 'opcao', 'algum', 'alguma', 'voce', 'vc', 'resort', 'hotel', 'aqui', 'ai', 'ha', 'existe', 'sao',
  ],
);

/** Itens cujo nome cobre as palavras significativas da mensagem. */
function matchNamed<T extends { name: string }>(message: string, items: readonly T[]): T[] {
  const words = new Set(requestTokens(message).filter((word) => !GENERIC.has(word) && word.length >= 3));
  if (words.size === 0) return [];

  const scored = items
    .map((item) => {
      const tokens = new Set(requestTokens(item.name));
      const hits = [...words].filter((word) => tokens.has(word)).length;
      return { item, hits, ratio: tokens.size ? hits / tokens.size : 0 };
    })
    .filter(({ hits }) => hits > 0)
    .sort((a, b) => b.hits - a.hits || b.ratio - a.ratio);

  if (scored.length === 0) return [];
  const best = scored[0];
  return scored.filter(({ hits, ratio }) => hits === best.hits && ratio === best.ratio).map(({ item }) => item);
}

// O preço do SPA às vezes está só no texto ("50 min R$ 250,00"): nunca "R$ 0".
function spaPrice(service: SpaService): string {
  const parts = [service.price ? formatCurrency(service.price) : '', service.details ?? ''].filter(Boolean);
  return parts.join(', ') || 'valor não cadastrado';
}

/**
 * Boutique, SPA, Dicas, Quiz e ESG: respostas curtas a partir do
 * cadastro e um botão para a tela do módulo. Somente leitura.
 */
@Injectable()
export class ModuleOperationsService {
  constructor(private readonly registry: OperationsToolRegistryService) {}

  private async execute<N extends OperationToolName>(name: N, guest: GuestContext): Promise<ToolData<N>> {
    const result = await this.registry.execute(name, guest, {});

    if (result.tool !== name) {
      throw new InternalServerErrorException('Resultado inesperado da ferramenta.');
    }

    return result.data as ToolData<N>;
  }

  private result(
    module: AppModule,
    tool: OperationToolName,
    reply: string,
    conversation: ConversationState,
    resultCount?: number,
    cards?: { kind: CatalogKind; label: string; items: Omit<CatalogItem, 'position'>[]; listed?: boolean },
  ): DispatchResult {
    const capability = capabilityOf(module);
    const screen = navigateAction(capability.screen, `Abrir ${capability.label}`);
    // Uma lista nova substitui a anterior; um item isolado ou nenhum card a encerra.
    const { catalog: _previous, ...rest } = conversation;
    const listed = cards?.listed && cards.items.length > 1;
    // Um item escolhido da lista mantém a lista na tela ("e a terceira?").
    const keepsList = !listed && cards?.items.length === 1 && _previous?.kind === cards.kind && _previous.listed.some(({ id }) => id === cards.items[0].id);
    const catalog: CatalogConversationState | undefined = listed
      ? { kind: cards.kind, listed: cards.items.slice(0, 20).map(({ id, title }) => ({ id, title })) }
      : keepsList ? _previous : undefined;
    const items = cards ? cards.items.map((item, index) => (listed ? { ...item, buttons: [optionButton(index + 1), ...item.buttons] } : item)) : [];

    return {
      tool,
      reply,
      actions: [...(cards ? catalogList(cards.kind, cards.label, items) : []), screen] satisfies ChatAction[],
      ...(resultCount !== undefined ? { resultCount } : {}),
      state: { ...rest, topic: 'module', ...(catalog ? { catalog } : {}) },
    };
  }

  /** Item escolhido pela posição ("o segundo", "Opção 2") na última lista do módulo. */
  private chosen<T extends { id: string }>(decision: IntentDecision, conversation: ConversationState, kind: CatalogKind, items: readonly T[]): T | null {
    const ordinal = decision.entities?.ordinal;
    // Só logo depois da própria lista: uma lista antiga não responde "a segunda".
    const listed = conversation.catalog?.kind === kind && conversation.lastIntent === decision.intent ? conversation.catalog.listed : undefined;
    if (ordinal === undefined || !listed?.length) return null;
    const reference = listed[ordinal === -1 ? listed.length - 1 : ordinal - 1];
    return items.find(({ id }) => id === reference?.id) ?? null;
  }

  /**
   * Produto citado pelo nome ("Tem protetor solar?") quando as fontes do
   * RAG não responderam. Sem produto no cadastro, nada é afirmado.
   */
  async findProducts(message: string, guest: GuestContext, context?: DispatchContext): Promise<DispatchResult | null> {
    // Exige o nome do produto, não uma palavra solta ("piscina" ≠ "Boia de piscina").
    const words = new Set(requestTokens(message));
    const named = matchNamed(message, await this.execute('boutique.list', guest))
      .filter(({ name }) => {
        const tokens = requestTokens(name).filter((token) => token.length >= 3);
        const hits = tokens.filter((token) => words.has(token)).length;
        return hits >= 2 || (tokens.length > 0 && hits / tokens.length >= 0.5);
      })
      .slice(0, 3);
    if (named.length === 0) return null;

    const price = (value: number | null) => (value !== null ? formatCurrency(value) : 'preço não cadastrado');
    return this.result('boutique', 'boutique.list',
      `Na Boutique: ${nameList(named.map(({ name, price: value }) => `${name}, ${price(value)}`))}.`, context?.state ?? {}, named.length);
  }

  async handle(message: string, decision: IntentDecision & { intent: ModuleIntent }, guest: GuestContext, context?: DispatchContext): Promise<DispatchResult> {
    const conversation = context?.state ?? {};

    switch (decision.intent) {
      case 'boutique.info':
        return this.boutique(message, decision, guest, conversation);
      case 'spa.info':
        return this.spa(message, decision, guest, conversation);
      case 'tips.list':
        return this.tips(message, decision, guest, conversation);
      case 'quiz.info': {
        const quizzes = await this.execute('quiz.list', guest);
        // Nunca perguntas nem respostas (R-QZ-05): só título, tema e modo.
        return this.result('quiz', 'quiz.list', quizzes.length
          ? `Quiz ativo: ${nameList(quizzes.map(({ title, theme }) => (theme ? `${title} (${theme})` : title)))}. A participação é pela tela de Quiz.`
          : 'Não há quiz ativo no momento. Quando houver, ele aparece na tela de Quiz.', conversation, quizzes.length,
        { kind: 'quiz', label: 'Quiz', items: quizzes.map(quizCard) });
      }
      default: {
        const texts = await this.execute('esg.info', guest);
        const [esg] = texts;
        return this.result('esg', 'esg.info', esg
          ? `${esg.description} As iniciativas estão na tela de ESG.`
          : 'As iniciativas de ESG do resort estão na tela de ESG.', conversation, esg ? 1 : 0,
        { kind: 'esg', label: 'Sustentabilidade', items: texts.slice(0, 5).map(esgCard) });
      }
    }
  }

  private async boutique(message: string, decision: IntentDecision, guest: GuestContext, conversation: ConversationState): Promise<DispatchResult> {
    const products = await this.execute('boutique.list', guest);
    const chosen = this.chosen(decision, conversation, 'product', products);
    const categories = [...new Set(products.map(({ category }) => category))];
    const text = normalizeText(message);
    const category = categories.find((name) => text.includes(normalizeText(name)));
    const named = chosen ? [chosen] : matchNamed(message, products).slice(0, 3);
    const price = (value: number | null) => (value !== null ? formatCurrency(value) : 'preço não cadastrado');
    const cards = (items: BoutiqueProduct[], listed = true) => ({ kind: 'product' as const, label: 'Boutique', items: items.map(productCard), listed });

    if (named.length) {
      const detail = chosen?.description ? ` ${chosen.description}` : '';
      return this.result('boutique', 'boutique.list', `${nameList(named.map(({ name, price: value }) => `${name}: ${price(value)}`))}.${detail} Disponível na Boutique.`, conversation, named.length, cards(named, false));
    }

    if (category) {
      const items = products.filter((product) => product.category === category);
      return this.result('boutique', 'boutique.list', `${category} tem ${items.length} produtos, como ${nameList(items.map(({ name }) => name), 3)}.`, conversation, items.length, cards(items));
    }

    // Procurou algo que não está no cadastro: diz isso, sem sugerir que existe.
    const searched = requestTokens(message).some((word) => !GENERIC.has(word) && word.length >= 4);

    // Catálogo inteiro: os cards só aparecem quando cabem numa lista curta.
    return this.result('boutique', 'boutique.list',
      `${searched ? 'Não encontrei esse produto no cadastro da Boutique. ' : ''}A Boutique tem ${products.length} produtos em ${nameList(categories)}.`,
      conversation, products.length, products.length <= 10 ? cards(products) : undefined);
  }

  private async spa(message: string, decision: IntentDecision, guest: GuestContext, conversation: ConversationState): Promise<DispatchResult> {
    const services = await this.execute('spa.list', guest);
    const chosen = this.chosen(decision, conversation, 'spa_service', services);
    const categories = [...new Set(services.flatMap(({ category }) => (category ? [category] : [])))];
    const limitation = 'O agendamento é feito pelo SPA.';
    const cards = (items: SpaService[], listed = true) => ({ kind: 'spa_service' as const, label: 'SPA', items: items.map(spaCard), listed });

    if (chosen) {
      return this.result('spa', 'spa.list',
        `${chosen.name}: ${spaPrice(chosen)}.${chosen.description ? ` ${chosen.description}` : ''} ${limitation}`, conversation, 1, cards([chosen], false));
    }

    // "Quais massagens?" → serviços da categoria citada.
    const category = categories.find((name) => requestTokens(name).some((token) => requestTokens(message).includes(token) && token !== 'spa'));
    const listing = /\b(?:quais|que|lista|opcoes|tipos)\b/.test(normalizeText(message));
    const named = listing && category ? [] : matchNamed(message, services);
    // Mesmo serviço em dois lugares ("Massagem Relaxante" no SPA e no stand): cita o local.
    const repeated = (service: SpaService) => named.filter(({ name }) => name === service.name).length > 1;

    if (named.length && named.length <= 3) {
      return this.result('spa', 'spa.list',
        `${nameList(named.map((service) => `${service.name}${repeated(service) && service.category ? ` (${service.category})` : ''}: ${spaPrice(service)}`))}. ${limitation}`,
        conversation, named.length, cards(named, named.length > 1));
    }

    if (category) {
      const items = services.filter((service) => service.category === category);
      return this.result('spa', 'spa.list', `${category}: ${nameList([...new Set(items.map(({ name }) => name))], 4)}. Pergunte o valor de qualquer um. ${limitation}`, conversation, items.length, cards(items));
    }

    return this.result('spa', 'spa.list', `O SPA oferece ${services.length} serviços em ${nameList(categories, 3)}. ${limitation}`, conversation, services.length, cards(services));
  }

  private async tips(message: string, decision: IntentDecision, guest: GuestContext, conversation: ConversationState): Promise<DispatchResult> {
    const tips = (await this.execute('tips.list', guest)).map((tip) => ({ ...tip, name: tip.title }));
    const chosen = this.chosen(decision, conversation, 'tip', tips);
    const [named] = chosen ? [chosen] : matchNamed(message, tips);

    if (named) {
      return this.result('tips', 'tips.list', `${named.title}: ${named.description ?? 'veja os detalhes na tela de Dicas.'}`, conversation, 1,
        { kind: 'tip', label: 'Dicas', items: [tipCard(named)], listed: false });
    }

    return this.result('tips', 'tips.list', tips.length
      ? `Separei ${tips.length} dicas para a estadia: ${nameList(tips.map(({ title }) => title), 3)}. Diga o assunto para eu detalhar.`
      : 'Não há dicas publicadas no momento.', conversation, tips.length,
    { kind: 'tip', label: 'Dicas', items: tips.map(tipCard), listed: true });
  }
}

/*
 * Cards dos módulos informativos. Imagens só com pasta confirmada no app;
 * nenhum botão de compra, agendamento ou resposta de quiz.
 */
function productCard(product: BoutiqueProduct): Omit<CatalogItem, 'position'> {
  return {
    id: product.id,
    title: product.name,
    description: product.description ?? null,
    imagePath: null,
    meta: { ...(product.price !== null ? { price: formatCurrency(product.price) } : {}), category: product.category },
    badges: [],
    buttons: [navigateButton('Boutique', 'Ver na Boutique')],
  };
}

function spaCard(service: SpaService): Omit<CatalogItem, 'position'> {
  return {
    id: service.id,
    title: service.name,
    description: service.description ?? null,
    imagePath: null,
    meta: {
      ...(service.price !== null ? { price: formatCurrency(service.price) } : {}),
      ...(service.details ? { duration: service.details.slice(0, 160) } : {}),
      ...(service.category ? { category: service.category } : {}),
    },
    badges: [],
    buttons: [navigateButton('Spa', 'Ver SPA')],
  };
}

function tipCard(tip: Tip): Omit<CatalogItem, 'position'> {
  return {
    id: tip.id,
    title: tip.title,
    description: tip.description,
    imagePath: null,
    meta: {},
    badges: [],
    buttons: [navigateButton('Tips', 'Abrir Dicas')],
  };
}

function quizCard(quiz: QuizInfo): Omit<CatalogItem, 'position'> {
  return {
    id: quiz.id,
    title: quiz.title,
    description: null,
    imagePath: null,
    meta: quiz.theme ? { category: quiz.theme } : {},
    badges: [quiz.mode === 'live' ? 'Ao vivo' : quiz.mode === 'async' ? 'Individual' : '', quiz.questions ? `${quiz.questions} perguntas` : ''].filter(Boolean),
    buttons: [navigateButton('Quiz', 'Jogar no app')],
  };
}

function esgCard(esg: EsgInfo, index: number): Omit<CatalogItem, 'position'> {
  return {
    id: esg.id ?? `esg-${index + 1}`,
    title: esg.title ?? 'Sustentabilidade',
    description: esg.description.slice(0, 400),
    imagePath: null,
    meta: {},
    badges: [],
    buttons: [navigateButton('Esg', 'Abrir ESG')],
  };
}
