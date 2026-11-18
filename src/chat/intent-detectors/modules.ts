import { capabilityOf } from '../../capabilities/capabilities.js';
import type { ModuleIntent } from '../chat-intent.types.js';

const HOURS_OR_PLACE = /\b(?:horarios?|que horas|abre|abrem|fecha|fecham|funciona|funcionamento|onde fica|fica onde|agendar|agendamento|marcar)\b/;
const CATALOG_QUESTION = /\b(?:quais|qual|quanto|custa|valor|precos?|tem|ha|vende|vendem|oferece|oferecem|lista|mostra|mostre|opcoes|produtos?|servicos?|tratamentos?)\b/;
const OTHER_DOMAIN = /\b(?:experiencias?|passeios?|restaurantes?|bares|reservar|minhas? reservas?|solicitac(?:ao|oes))\b/;

export function detectModule(text: string): ModuleIntent | null {
  if (OTHER_DOMAIN.test(text)) return null;

  if (capabilityOf('quiz').cue.test(text)) return 'quiz.info';
  if (capabilityOf('esg').cue.test(text)) return 'esg.info';
  if (capabilityOf('tips').cue.test(text) && !/\bdicas? de (?:restaurante|passeio|experiencia)/.test(text)) return 'tips.list';

  if (HOURS_OR_PLACE.test(text)) return null;

  if (capabilityOf('boutique').cue.test(text) && (CATALOG_QUESTION.test(text) || /\bboutique\b/.test(text))) return 'boutique.info';
  if (capabilityOf('spa').cue.test(text) && !/\bescovas? de dentes?\b/.test(text) && (CATALOG_QUESTION.test(text) || text.split(' ').length <= 3)) return 'spa.info';

  return null;
}
