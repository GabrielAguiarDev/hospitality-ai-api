import type { ChatIntent } from '../chat/chat-intent.types.js';
import { normalizeText } from '../common/text.js';

/**
 * Mapa das capacidades do Yago por módulo do aplicativo.
 *
 * - Fonte única de módulo, tela do React Native, parâmetros de navegação,
 *   tipo de operação, limitações e pistas de roteamento por módulo.
 * - A relação intenção → ferramenta continua em operations/intent-tool-map.ts;
 *   a descrição e o readOnly de cada ferramenta, no OperationsToolRegistry.
 * - Nunca é enviado inteiro ao modelo: selectCapabilities escolhe só os
 *   módulos citados na mensagem.
 */

export const APP_MODULES = [
  'requests',
  'gastronomy',
  'experiences',
  'events',
  'leisure',
  'boutique',
  'spa',
  'esg',
  'tips',
  'quiz',
] as const;

export type AppModule = (typeof APP_MODULES)[number];

/**
 * Telas que o aplicativo pode abrir e os parâmetros aceitos em cada uma.
 * Os nomes são provisórios: o app os mapeia para as rotas reais.
 */
export const SCREEN_PARAMS = {
  // Com restaurantId: tela de reserva (somente restaurantes com reserva).
  Gastronomy: ['restaurantId'],
  // Página informativa e cardápio de um restaurante.
  Restaurant: ['restaurantId'],
  Requests: ['departmentId'],
  Experiences: ['experienceId'],
  // Uma experiência: o app escolhe reserva ou página informativa (R-EXP-02).
  Experience: ['experienceId'],
  // date (AAAA-MM-DD) escolhe a aba do dia.
  Events: ['date'],
  Leisure: [],
  Boutique: [],
  Spa: [],
  Esg: [],
  Tips: [],
  Quiz: [],
  MyReservation: ['tab'],
  MyRequests: [],
  MyFavorites: [],
} as const satisfies Record<string, readonly string[]>;

// Abas de Minhas Reservas aceitas em MyReservation.tab.
export const RESERVATION_TABS = ['Gastronomy', 'Experience'] as const;

export type NavigationScreen = keyof typeof SCREEN_PARAMS;

export type OperationKind = 'read' | 'write' | 'navigation';

export interface Capability {
  module: AppModule;
  // Nome do módulo como aparece no app.
  label: string;
  description: string;
  intents: readonly ChatIntent[];
  // Parâmetros que o hóspede pode informar na mensagem.
  params: readonly string[];
  kinds: readonly OperationKind[];
  limitations: readonly string[];
  screen: NavigationScreen;
  // Pistas do módulo no texto normalizado (sem acentos, minúsculo).
  cue: RegExp;
}

export const CAPABILITIES: readonly Capability[] = [
  {
    module: 'requests',
    label: 'Solicitações',
    description: 'Itens e serviços dos departamentos (Governança, Manutenção, TI…), solicitações da estadia e novas solicitações simuladas.',
    intents: ['request.catalog', 'request.create', 'request.confirm', 'request.cancel', 'request.list', 'request.status'],
    params: ['departamento', 'item', 'quantidade'],
    kinds: ['read', 'write', 'navigation'],
    limitations: [
      'Novas solicitações são simuladas: ficam só no banco da IA e não chegam ao departamento.',
      'Somente itens ativos do cadastro de cada departamento.',
    ],
    screen: 'Requests',
    cue: /\b(?:solicitac(?:ao|oes)|solicitar|chamados?|governanca|manutencao|camareira|arrumadeira|enxoval)\b/,
  },
  {
    module: 'gastronomy',
    label: 'Gastronomia',
    description: 'Restaurantes, bares e lanches: horários, cardápio, filtros por tipo, cozinha e horário, e reserva pelo app.',
    intents: ['restaurant.list', 'restaurant.details', 'restaurant.menu', 'restaurant.booking', 'reservation.list', 'reservation.details', 'reservation.status'],
    params: ['tipo', 'cozinha', 'horário', 'período'],
    kinds: ['read', 'navigation'],
    limitations: ['O chat não cria reservas de restaurante: a reserva exige escolher os pratos no app.'],
    screen: 'Gastronomy',
    cue: /\b(?:restaurantes?|bares|bar|lanchonetes?|gastronomia|jantar|almoco|cardapio)\b/,
  },
  {
    module: 'experiences',
    label: 'Experiências',
    description: 'Catálogo, detalhes, preços, vagas e pré-reserva simulada de passeios e atividades.',
    intents: [
      'experience.list',
      'experience.search',
      'experience.details',
      'experience.availability',
      'experience.price',
      'experience.booking',
      'experience.booking.confirm',
      'experience.booking.cancel',
      'experience.reservations',
    ],
    params: ['data', 'período', 'adultos', 'crianças'],
    kinds: ['read', 'write', 'navigation'],
    limitations: ['Reservas feitas pelo chat são simuladas e não vão ao sistema oficial.'],
    screen: 'Experiences',
    cue: /\b(?:experiencias?|passeios?|tours?|excursao|excursoes|trilhas?)\b/,
  },
  {
    module: 'events',
    label: 'Eventos',
    description: 'Eventos e shows por data e período, e os eventos favoritados (Meus Favoritos).',
    intents: ['event.list', 'favorite.list', 'favorite.manage'],
    params: ['data', 'período'],
    kinds: ['read', 'navigation'],
    limitations: [
      'Mostra eventos dos próximos dias registrados no snapshot.',
      'O chat não favorita nem remove favoritos: isso é feito na tela de Eventos ou Meus Favoritos.',
    ],
    screen: 'Events',
    cue: /\b(?:eventos?|shows?|apresentac(?:ao|oes)|musica ao vivo|festas?)\b/,
  },
  {
    module: 'leisure',
    label: 'Lazer',
    description: 'Programação semanal de recreação, filtrada por data, período e público.',
    intents: ['event.list', 'leisure.enroll'],
    params: ['data', 'período', 'público'],
    kinds: ['read', 'navigation'],
    limitations: ['A inscrição exige ficha e termo: é feita na tela de Lazer, não pelo chat.'],
    screen: 'Leisure',
    cue: /\b(?:lazer|recreac(?:ao|oes)|programacao|atividades|kids|monitores?)\b/,
  },
  {
    module: 'boutique',
    label: 'Boutique',
    description: 'Produtos e preços da boutique e da conveniência.',
    intents: ['boutique.info'],
    params: ['produto', 'categoria'],
    kinds: ['read', 'navigation'],
    limitations: ['O chat não vende nem reserva produtos.'],
    screen: 'Boutique',
    cue: /\b(?:boutique|lojinha|loja|produtos?|souvenirs?|lembrancinhas?|conveniencia|comprar)\b/,
  },
  {
    module: 'spa',
    label: 'SPA',
    description: 'Serviços do SPA e do salão de beleza, com duração e valores cadastrados.',
    intents: ['spa.info'],
    params: ['serviço', 'categoria'],
    kinds: ['read', 'navigation'],
    limitations: ['O agendamento é feito pelo SPA; o chat não agenda serviços.'],
    screen: 'Spa',
    cue: /\b(?:spa|massage(?:m|ns)|drenagem|tratamentos? faciais?|facial|salao de beleza|manicure|pedicure|escova|hidratacao|abhyanga|pedras quentes|esmaltacao)\b/,
  },
  {
    module: 'esg',
    label: 'ESG',
    description: 'Compromisso de sustentabilidade do resort.',
    intents: ['esg.info'],
    params: [],
    kinds: ['read', 'navigation'],
    limitations: ['O cadastro de iniciativas e parceiros ESG não tem detalhes publicados.'],
    screen: 'Esg',
    cue: /\b(?:esg|sustentabilidade|sustentave(?:l|is)|meio ambiente|ambienta(?:l|is)|ecologic[oa]s?)\b/,
  },
  {
    module: 'tips',
    label: 'Dicas',
    description: 'Dicas de segurança e bem-estar para a estadia.',
    intents: ['tips.list'],
    params: ['assunto'],
    kinds: ['read', 'navigation'],
    limitations: [],
    screen: 'Tips',
    cue: /\b(?:dicas?|cuidados?|aguas? vivas?|henna|trancinhas?|pertences)\b/,
  },
  {
    module: 'quiz',
    label: 'Quiz',
    description: 'Quizzes do resort em andamento.',
    intents: ['quiz.info'],
    params: [],
    kinds: ['read', 'navigation'],
    limitations: ['O chat não inscreve nem responde quizzes; a participação é pelo app.'],
    screen: 'Quiz',
    cue: /\b(?:quiz|quizzes|quizes|gincana)\b/,
  },
];

const BY_MODULE = new Map(CAPABILITIES.map((capability) => [capability.module, capability]));

export function capabilityOf(module: AppModule): Capability {
  return BY_MODULE.get(module) as Capability;
}

/** Módulo dono de uma intenção (o primeiro, para intenções compartilhadas). */
export function capabilityForIntent(intent: ChatIntent): Capability | undefined {
  return CAPABILITIES.find((capability) => capability.intents.includes(intent));
}

/**
 * Somente as capacidades citadas na mensagem (no máximo `limit`),
 * na ordem do catálogo. Nenhuma pista: lista vazia.
 */
export function selectCapabilities(message: string, limit = 2): Capability[] {
  const text = normalizeText(message);
  return CAPABILITIES.filter((capability) => capability.cue.test(text)).slice(0, limit);
}

/** "Posso ajudar com Solicitações, Gastronomia, … e Quiz." */
export function capabilitiesOverview(): string {
  const labels = CAPABILITIES.map(({ label }) => label);
  return `${labels.slice(0, -1).join(', ')} e ${labels.at(-1)}`;
}
