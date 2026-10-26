/**
 * Contrato das ações estruturadas retornadas ao aplicativo.
 * Ações são montadas apenas pelo servidor, a partir de dados
 * verificados; nunca a partir de texto do modelo.
 */

// Telas que o aplicativo pode abrir. O nome "Gastronomy" é provisório
// e deve ser ajustado à rota real do React Native.
export const NAVIGATION_SCREENS = ['Gastronomy'] as const;

export type NavigationScreen = (typeof NAVIGATION_SCREENS)[number];

export interface NavigateAction {
  type: 'navigate';
  label: string;
  screen: NavigationScreen;
  params: {
    restaurantId?: string;
  };
}

export interface ExperienceBookingSummary {
  experienceId: string;
  experienceTitle: string;
  date: string;
  time: string | null;
  adults: number;
  children: number;
  totalPrice: number | null;
  currency: 'BRL';
  priceNote: string | null;
  // Sempre true: reservas feitas pelo chat são simulações.
  simulated: true;
}

export interface ExperienceBookingPreviewAction {
  type: 'experience.booking.preview';
  label: string;
  previewId: string;
  expiresAt: string;
  summary: ExperienceBookingSummary;
  // Como o aplicativo confirma a pré-reserva.
  confirm: {
    method: 'POST';
    path: '/chat/actions';
    body: {
      type: 'experience.booking.confirm';
      conversationId: string;
      previewId: string;
    };
  };
}

export interface ExperienceBookingConfirmAction {
  type: 'experience.booking.confirm';
  label: string;
  bookingId: string;
  confirmationCode: string;
  status: 'confirmed';
  alreadyConfirmed: boolean;
  summary: ExperienceBookingSummary;
}

/**
 * Opções de experiência apresentadas na resposta, na mesma ordem
 * numerada do texto. Ao tocar em uma opção, o aplicativo envia
 * `message` para POST /chat na mesma conversa.
 */
export interface ExperienceOption {
  position: number;
  experienceId: string;
  title: string;
  // Horários registrados no snapshot para a data consultada (HH:MM).
  times: string[];
  message: string;
}

export interface ExperienceOptionsAction {
  type: 'experience.options';
  label: string;
  // Data consultada (AAAA-MM-DD) ou null para o catálogo sem data.
  date: string | null;
  options: ExperienceOption[];
}

export type ChatAction =
  | NavigateAction
  | ExperienceBookingPreviewAction
  | ExperienceBookingConfirmAction
  | ExperienceOptionsAction;

export interface RetrievedSource {
  id: string;
  title: string;
  distance: number | null;
}

export interface ChatResponse {
  reply: string;
  conversationId: string;
  retrievedSources: RetrievedSource[];
  actions: ChatAction[];
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;

const isText = (value: unknown, max = 255): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;

const isCount = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 10;

function validSummary(summary: ExperienceBookingSummary | undefined): boolean {
  return (
    !!summary &&
    isText(summary.experienceId) &&
    isText(summary.experienceTitle) &&
    ISO_DATE.test(summary.date) &&
    (summary.time === null || TIME.test(summary.time)) &&
    isCount(summary.adults) &&
    isCount(summary.children) &&
    summary.adults + summary.children >= 1 &&
    summary.adults + summary.children <= 10 &&
    (summary.totalPrice === null ||
      (Number.isFinite(summary.totalPrice) && summary.totalPrice >= 0)) &&
    summary.currency === 'BRL' &&
    summary.simulated === true
  );
}

/**
 * Validação em tempo de execução antes de enviar ao cliente.
 * Uma ação inválida é descartada em vez de chegar ao aplicativo.
 */
export function isValidChatAction(action: ChatAction): boolean {
  switch (action?.type) {
    case 'navigate':
      return (
        isText(action.label, 60) &&
        (NAVIGATION_SCREENS as readonly string[]).includes(action.screen) &&
        Object.keys(action.params ?? {}).every((key) => key === 'restaurantId') &&
        (action.params.restaurantId === undefined ||
          isText(action.params.restaurantId))
      );

    case 'experience.booking.preview':
      return (
        isText(action.label, 60) &&
        UUID.test(action.previewId) &&
        !Number.isNaN(Date.parse(action.expiresAt)) &&
        validSummary(action.summary) &&
        action.confirm?.path === '/chat/actions' &&
        action.confirm.body.previewId === action.previewId &&
        UUID.test(action.confirm.body.conversationId)
      );

    case 'experience.options':
      return (
        isText(action.label, 60) &&
        (action.date === null || ISO_DATE.test(action.date)) &&
        Array.isArray(action.options) &&
        action.options.length >= 1 &&
        action.options.length <= 10 &&
        action.options.every(
          (option, index) =>
            option.position === index + 1 &&
            isText(option.experienceId) &&
            isText(option.title, 160) &&
            isText(option.message, 60) &&
            Array.isArray(option.times) &&
            option.times.every((time) => TIME.test(time)),
        )
      );

    case 'experience.booking.confirm':
      return (
        isText(action.label, 60) &&
        UUID.test(action.bookingId) &&
        isText(action.confirmationCode, 20) &&
        action.status === 'confirmed' &&
        validSummary(action.summary)
      );

    default:
      return false;
  }
}

export function sanitizeActions(actions: readonly ChatAction[] | undefined): ChatAction[] {
  return (actions ?? []).filter(isValidChatAction);
}
