import { normalizeText } from '../common/text.js';

import type { ConversationIntent, HistoryEntry } from './chat-intent.types.js';

/**
 * Respostas a interações sociais (saudação, agradecimento, elogio,
 * despedida, perguntas sobre o Yago). São determinísticas: não chamam
 * o modelo, o RAG nem ferramentas, e nunca citam dados do resort.
 *
 * Uma ou duas frases curtas, sem tratamento de gênero do hóspede.
 */
export type SocialKind =
  | 'thanks'
  | 'farewell'
  | 'compliment'
  | 'identity'
  | 'help'
  | 'greeting'
  | 'acknowledgement'
  | 'decline'
  | 'external';

export interface SocialContext {
  history: HistoryEntry[];
  // Pré-reserva aguardando confirmação nesta conversa.
  pendingBooking: boolean;
  // "Não" a uma pergunta do Yago.
  declinesPending?: boolean;
}

const THANKS = /\b(?:obrigad[oa]s?|brigad[oa]|brigadao|valeu|agradeco|grat[oa]|thanks)\b/;
const FAREWELL = /\b(?:tchau|ate (?:logo|mais|breve|amanha)|adeus|bom descanso)\b/;
const COMPLIMENT =
  /\b(?:legal|muito bom|que bom|otim[oa]|excelente|maravilh[a-z]*|incrivel|sensacional|perfeito|adorei|amei|top|ajudou|ajudaram|show de bola|bom trabalho)\b/;
const IDENTITY =
  /\b(?:quem (?:e|fala)|seu nome|se chama|robo|humano|uma ia|inteligencia artificial)\b/;
const HELP = /\b(?:o que (?:voce|vc) (?:faz|pode fazer)|pode me ajudar|me ajuda|preciso de ajuda|como (?:voce|vc) pode me ajudar)\b/;
const HOW_ARE_YOU = /\b(?:tudo (?:bem|bom|certo|joia|otimo)|td (?:bem|bom)|como vai|como (?:voce|vc) esta|como esta|e ai|eai)\b/;
const SALUTATION = /\b(bom dia|boa tarde|boa noite)\b/;
const NEGATIVE = /\b(?:nao|agora nao|depois|talvez)\b/;

export function socialKind(message: string, intent: ConversationIntent, declinesPending = false): SocialKind {
  // "Oiii" e "Obrigadooo" viram "oi" e "obrigado".
  const text = normalizeText(message).replace(/([a-z])\1{2,}/g, '$1');

  if (intent === 'conversation.external') return 'external';
  if (declinesPending) return 'decline';
  if (THANKS.test(text)) return 'thanks';
  if (FAREWELL.test(text)) return 'farewell';
  if (IDENTITY.test(text)) return 'identity';
  if (HELP.test(text)) return 'help';
  if (COMPLIMENT.test(text)) return 'compliment';
  if (intent === 'conversation.greeting') return 'greeting';
  if (NEGATIVE.test(text)) return 'decline';
  return 'acknowledgement';
}

const VARIANTS: Record<Exclude<SocialKind, 'greeting' | 'identity' | 'external'>, string[]> = {
  thanks: [
    'Por nada! Precisa de mais alguma coisa?',
    'Imagina! Se precisar de algo, é só chamar.',
    'Disponha! Posso ajudar em mais alguma coisa?',
  ],
  farewell: ['Até mais! Aproveite a estadia.', 'Até logo! Se precisar, estou por aqui.'],
  compliment: ['Que bom que gostou! Precisa de mais alguma coisa?', 'Fico feliz em ajudar! Se precisar, é só chamar.'],
  help: ['Posso ajudar com restaurantes, experiências, eventos, suas reservas e solicitações. Do que você precisa?'],
  acknowledgement: ['Combinado! Se precisar, é só chamar.', 'Certo! Estou por aqui se precisar.'],
  decline: ['Tudo bem! Se precisar, é só chamar.', 'Sem problemas! Estou por aqui se precisar.'],
};

export const EXTERNAL_REPLY =
  'Não tenho acesso a previsão do tempo, notícias ou outras informações em tempo real. A recepção pode ajudar com isso.';

const IDENTITY_REPLY =
  'Sou o Yago, concierge digital do resort. Posso ajudar com restaurantes, experiências, eventos e suas reservas.';

const PENDING_BOOKING = 'A pré-reserva continua aguardando: confirme pelo card ou responda "confirmo".';

// Alterna as variações sem repetir a última resposta do Yago.
function pick(options: string[], history: HistoryEntry[]): string {
  const last = [...history].reverse().find(({ role }) => role === 'assistant')?.content;
  const turn = history.filter(({ role }) => role === 'assistant').length;
  const ordered = [...options.slice(turn % options.length), ...options.slice(0, turn % options.length)];
  return ordered.find((option) => option !== last) ?? ordered[0];
}

function greeting(message: string, history: HistoryEntry[]): string {
  const text = normalizeText(message);
  const salutation = text.match(SALUTATION)?.[1];
  const opening = salutation ? `${salutation.charAt(0).toUpperCase()}${salutation.slice(1)}` : 'Olá';
  const howAreYou = HOW_ARE_YOU.test(text);

  // A apresentação acontece uma vez, no primeiro contato.
  if (!history.some(({ role }) => role === 'assistant')) {
    return howAreYou
      ? 'Tudo ótimo por aqui, sou o Yago, concierge digital do resort. Como posso ajudar?'
      : `${opening}, sou o Yago, concierge digital do resort. Como posso ajudar?`;
  }

  return howAreYou ? 'Tudo ótimo por aqui! Como posso ajudar?' : `${opening}! Como posso ajudar?`;
}

export function socialReply(message: string, intent: ConversationIntent, context: SocialContext): string {
  const kind = socialKind(message, intent, context.declinesPending);

  if (kind === 'external') return EXTERNAL_REPLY;
  if (kind === 'identity') return IDENTITY_REPLY;

  // Com uma pré-reserva pendente, o lembrete substitui a oferta de ajuda.
  if (context.pendingBooking && kind !== 'help') {
    const opening = {
      thanks: 'Por nada!',
      farewell: 'Até mais!',
      compliment: 'Que bom que gostou!',
      greeting: 'Olá!',
      acknowledgement: 'Certo!',
      decline: 'Tudo bem!',
    }[kind];
    return `${opening} ${PENDING_BOOKING}`;
  }

  return kind === 'greeting' ? greeting(message, context.history) : pick(VARIANTS[kind], context.history);
}
