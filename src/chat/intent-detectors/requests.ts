import { CAPABILITIES } from '../../capabilities/capabilities.js';
import type { ConversationState } from '../../contracts/conversation-state.js';
import type { ChatIntent } from '../chat-intent.types.js';

const REQUEST_NOUN = /\b(?:solicitac(?:ao|oes)|solicitar|chamados?)\b/;
const BARE_MODULE = /^(?:as |minhas )?(?:solicitac(?:ao|oes)|chamados?)$/;
const CATALOG_CUE =
  /\b(?:opcoes|opcao|tipos?|quais|categorias?|o que (?:eu )?(?:posso|da pra|da para) (?:pedir|solicitar)|como (?:faco|funciona|abro|solicito)|posso pedir|posso solicitar)\b/;
const CREATE_CUE = /\b(?:fazer|abrir|quero|queria|gostaria|preciso|pedir|registrar|mandar)\b/;
const NEED_CUE =
  /\b(?:preciso de|precisamos de|quero mais|queria mais|gostaria de (?:mais|um|uma)|mais (?:uma?|duas?|dois|\d+)|podem? (?:me )?(?:mandar|enviar|trazer|levar)|poderia (?:me )?(?:mandar|enviar|trazer|levar)|me (?:traga|traz|manda|mande|envia|envie|leva|leve)|traga|tragam|falta(?:m|ndo)?|acabou|acabaram|(?:estou|estamos|ficamos|fiquei) sem)\b/;
const NEGATION = /\b(?:nao (?:preciso|precisa|precisamos|quero|queremos)|sem necessidade|nao e necessario)\b/;
const NOT_A_ROOM_ITEM = /\b(?:limpeza de pele|massage(?:m|ns)|spa|manicure|pedicure|tratamentos? faciais?|rede (?:wi ?fi|de internet)|rede (?:esta |ta )?(?:sem sinal|lenta|caiu))\b/;
const REQUEST_ITEM =
  /\b(?:toalhas?|lencois|lencol|travesseiros?|cobertor(?:es)?|mantas?|sabonetes?|shampoo|xampu|condicionador|fronhas?|colchas?|berco|bercos|banheira|chaleira|ventilador(?:es)?|repelentes?|inseticidas?|kit (?:bebe|pet)|rede|cadeira de rodas|cadeira de banho|limpeza|arrumacao|faxina|carrinho de bebe|grades?)\b/;
const ROOM_OBJECT =
  /\b(?:ar condicionado|(?<!a)o ar|chuveiro|tv|televisao|lampadas?|luz|fechadura|portas?|telefone|controle|wifi|wi fi|internet|canais|cofre|banheiro|descarga|pia|torneira|janela|cortina)\b/;
const PROBLEM_CUE =
  /\b(?:nao (?:funciona|liga|esquenta|gela|abre|fecha|tranca|acende|pega|conecta)|nao (?:esta |ta )?(?:funcionando|ligando|esquentando|gelando|abrindo|fechando|trancando|acendendo|pegando|conectando)|quebr[a-z]*|estragad[oa]s?|vazando|pingando|entupid[oa]s?|queimad[oa]s?|sem agua quente|com defeito|parou|travad[oa])\b/;
const DEPARTMENT = /\b(?:governanca|manutencao|camareira|arrumadeira|copa baby|enfermaria|guest experience|sala de toalhas)\b/;
const DECLINE = /^(?:nao|nada|deixa|esquece)\b|\b(?:deixa (?:pra|para) la|esquece)\b/;
const QUESTION = /^(?:qual|quais|quando|onde|como|quanto|quantos|quantas|por que|o que|que|e (?:o|a|os|as)|cancelar|cancela)\b|\b(?:senha|que horas)\b/;
const OTHER_DOMAIN = /\b(?:experiencias?|passeios?|restaurantes?|bares|jantar|almoco|mesa|reservar|reserva|eventos?|shows?)\b/;

export function detectRequestCatalogOrCreate(text: string, _state?: ConversationState): ChatIntent | null {
  if (BARE_MODULE.test(text)) return 'request.catalog';
  if (NEGATION.test(text) || NOT_A_ROOM_ITEM.test(text)) return null;
  if (OTHER_DOMAIN.test(text) && !REQUEST_NOUN.test(text)) return null;

  if (REQUEST_NOUN.test(text)) {
    if (CATALOG_CUE.test(text) && !REQUEST_ITEM.test(text)) return 'request.catalog';
    if (CREATE_CUE.test(text) || REQUEST_ITEM.test(text) || DEPARTMENT.test(text)) return 'request.create';
    return null;
  }

  if (REQUEST_ITEM.test(text) && (NEED_CUE.test(text) || DEPARTMENT.test(text))) return 'request.create';
  if (ROOM_OBJECT.test(text) && PROBLEM_CUE.test(text)) return 'request.create';
  if (DEPARTMENT.test(text)) return CREATE_CUE.test(text) || NEED_CUE.test(text) ? 'request.create' : 'request.catalog';

  return null;
}

export function detectRequestFollowUp(text: string, state?: ConversationState, asked = false): ChatIntent | null {
  if (state?.topic !== 'request' || !state.request?.departmentId || state.request.pendingPreviewId) return null;
  if (text.split(' ').length > 6 || NEGATION.test(text) || DECLINE.test(text) || QUESTION.test(text)) return null;
  if (asked && !REQUEST_ITEM.test(text)) return null;
  if (CAPABILITIES.some(({ module, cue }) => module !== 'requests' && cue.test(text)) || OTHER_DOMAIN.test(text)) return null;
  return 'request.create';
}
