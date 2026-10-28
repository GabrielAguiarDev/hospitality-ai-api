import { capabilityOf } from '../../capabilities/capabilities.js';
import type { ConversationState } from '../../contracts/conversation-state.js';
import type { ChatIntent, ModuleIntent } from '../chat-intent.types.js';

/**
 * Cardápio, Meus Favoritos, inscrição de lazer e continuações por posição
 * nas listas de catálogo (texto já normalizado). Só decidem a intenção:
 * restaurante, evento e item reais são resolvidos pelos handlers.
 */

// Só com cue pessoal ou de ação: "o restaurante favorito dos hóspedes" não é Meus Favoritos.
const FAVORITE =
  /\b(?:(?:meus|minhas|nos|aos|dos|nas|as|os) favorit[oa]s|favoritar|favoritei|desfavoritar|lembretes? (?:de|do|dos) eventos?)\b/;
// "Adicione aos favoritos", "tira dos favoritos", "favoritar o show".
const FAVORITE_CHANGE =
  /\b(?:adicion[a-z]*|coloc[a-z]*|salv[a-z]*|marc[a-z]*|inclu[a-z]*|remov[a-z]*|tir[ae]r?|tira|exclu[a-z]*|apag[a-z]*|favoritar|desfavoritar)\b/;

const ENROLL = /\b(?:inscrever|inscreve|inscrevo|inscreva|inscricao|participar|matricular)\b/;
const LEISURE = /\b(?:lazer|recreac(?:ao|oes)|atividades?|kids|monitor(?:es|a)?|hidroginastica|aula)\b/;
// "Minhas inscrições" é consulta: aparece em Minhas Solicitações (R-LAZ-07).
const MY_ENROLLMENTS = /\b(?:minhas?|meus?) inscric(?:ao|oes)\b|\binscric(?:ao|oes) (?:de lazer )?(?:esta|foi|ja foi)\b/;
const NOT_LEISURE = /\b(?:experiencias?|passeios?|tours?|trilhas?|quiz|restaurantes?|reservar|shows?|eventos?|festas?|apresentac(?:ao|oes))\b/;
// "Quais atividades posso participar amanhã?" é programação, não inscrição.
const SCHEDULE_QUESTION = /^(?:quais|que|qual|tem|ha|o que)\b/;

const MENU = /\b(?:cardapios?|menu)\b/;
// "Quais pratos tem no X?", "o que tem de sobremesa?": só com restaurante em conversa.
const DISH_QUESTION =
  /\b(?:quais (?:sao )?(?:os )?pratos|que pratos|pratos (?:do|da|de|tem)|o que (?:tem|ha|serve|servem) (?:de|para|pra) (?:sobremesa|entrada|comer|beber))\b/;
const NOT_MENU = /\b(?:reservar|reserva|minhas? reservas?|spa|massage(?:m|ns)|app|aplicativo|tela|passeios?|experiencias?|tours?|trilhas?)\b/;

// Somente os módulos que guardam lista numerada (ESG e Quiz não guardam).
const CATALOG_INTENTS: readonly (ModuleIntent | 'favorite.list')[] = ['spa.info', 'boutique.info', 'tips.list', 'favorite.list'];
// Outro domínio citado ("o primeiro restaurante", "a primeira solicitação") não é a lista do módulo.
const OTHER_DOMAIN =
  /\b(?:restaurantes?|bares?|experiencias?|passeios?|solicitac(?:ao|oes)|chamados?|reservas?|reservar|eventos?|shows?|quartos?|toalhas?|cardapio)\b/;

export function detectFavorites(text: string): Extract<ChatIntent, 'favorite.list' | 'favorite.manage'> | null {
  if (!FAVORITE.test(text)) return null;
  return FAVORITE_CHANGE.test(text) ? 'favorite.manage' : 'favorite.list';
}

export function detectLeisureEnrollment(text: string, state?: ConversationState): Extract<ChatIntent, 'leisure.enroll' | 'request.list'> | null {
  if (MY_ENROLLMENTS.test(text)) return 'request.list';
  if (!ENROLL.test(text) || NOT_LEISURE.test(text) || SCHEDULE_QUESTION.test(text)) return null;

  // "Quero participar dessa" logo depois de uma programação só de lazer.
  const afterLeisure = state?.topic === 'event' && state.lastIntent === 'event.list' && state.event?.kind === 'leisure';
  return LEISURE.test(text) || capabilityOf('leisure').cue.test(text) || afterLeisure ? 'leisure.enroll' : null;
}

export function detectMenu(text: string, state?: ConversationState): Extract<ChatIntent, 'restaurant.menu'> | null {
  if (NOT_MENU.test(text)) return null;
  if (MENU.test(text)) return 'restaurant.menu';

  const restaurantContext = state?.topic === 'restaurant' && Boolean(state.restaurant?.selectedId || state.restaurant?.listed?.length);
  return DISH_QUESTION.test(text) && (restaurantContext || /\b(?:restaurantes?|bar)\b/.test(text)) ? 'restaurant.menu' : null;
}

/**
 * "O segundo", "Opção 3", "me fala da última" logo depois de uma lista de
 * catálogo: repete a intenção da lista; o handler escolhe o item pela posição.
 */
export function detectCatalogFollowUp(text: string, ordinal: number | undefined, state?: ConversationState): ChatIntent | null {
  const listed = state?.catalog?.listed;
  const intent = state?.lastIntent;

  if (ordinal === undefined || !listed?.length || !intent || !(CATALOG_INTENTS as readonly ChatIntent[]).includes(intent)) return null;
  if (text.split(' ').length > 8 || ordinal > listed.length || OTHER_DOMAIN.test(text)) return null;

  return intent;
}
