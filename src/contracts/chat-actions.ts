/**
 * Contrato das ações estruturadas retornadas ao aplicativo.
 * Ações são montadas apenas pelo servidor, a partir de dados
 * verificados; nunca a partir de texto do modelo.
 */

import { RESERVATION_TABS, SCREEN_PARAMS, type NavigationScreen } from '../capabilities/capabilities.js';

export type { NavigationScreen } from '../capabilities/capabilities.js';

// Telas que o aplicativo pode abrir (nomes provisórios, mapeados pelo app
// para as rotas reais) e os parâmetros aceitos em cada uma.
export const NAVIGATION_SCREENS = Object.keys(SCREEN_PARAMS) as NavigationScreen[];

export interface NavigateAction {
  type: 'navigate';
  label: string;
  screen: NavigationScreen;
  // Somente os parâmetros da tela (SCREEN_PARAMS), com IDs do cadastro.
  params: {
    restaurantId?: string;
    departmentId?: string;
    experienceId?: string;
    // Events: aba do dia (AAAA-MM-DD, fuso do resort).
    date?: string;
    // MyReservation: aba inicial.
    tab?: (typeof RESERVATION_TABS)[number];
  };
}

// Ponto único de montagem de navegação: o rótulo vem do módulo.
export function navigateAction(screen: NavigationScreen, label: string, params: NavigateAction['params'] = {}): NavigateAction {
  return { type: 'navigate', label, screen, params };
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

/**
 * Estados do card de reserva. O servidor devolve preview, confirmed,
 * expired, failed e cancelled; "confirming" é o estado local do
 * aplicativo enquanto POST /chat/actions está em andamento.
 */
export const BOOKING_CARD_STATUSES = ['preview', 'confirming', 'confirmed', 'expired', 'failed', 'cancelled'] as const;

export type BookingCardStatus = (typeof BOOKING_CARD_STATUSES)[number];

interface BookingCardRequest<T extends 'experience.booking.confirm' | 'experience.booking.cancel'> {
  method: 'POST';
  path: '/chat/actions';
  body: { type: T; conversationId: string; previewId: string };
}

/**
 * Um único card por reserva: `cardId` (o ID da pré-reserva) não muda
 * durante todo o ciclo. Uma nova ação com o mesmo cardId ATUALIZA o
 * card existente no aplicativo; nunca cria uma segunda representação.
 */
export interface ExperienceBookingCardAction {
  type: 'experience.booking.card';
  cardId: string;
  status: BookingCardStatus;
  label: string;
  summary: ExperienceBookingSummary;
  // Avisos do cadastro exibidos no card (idade mínima, responsável…).
  notes: string[];
  // Somente em "preview".
  expiresAt: string | null;
  // Somente em "confirmed".
  booking: { bookingId: string; confirmationCode: string } | null;
  // Motivo em "expired", "failed" e "cancelled".
  reason: string | null;
  // Botões disponíveis somente em "preview".
  confirm: BookingCardRequest<'experience.booking.confirm'> | null;
  cancel: BookingCardRequest<'experience.booking.cancel'> | null;
  updatedAt: string;
}

export const BOOKING_CARD_LABELS: Record<BookingCardStatus, string> = {
  preview: 'Confirmar reserva simulada',
  confirming: 'Confirmando…',
  confirmed: 'Reserva simulada confirmada',
  expired: 'Pré-reserva expirada',
  failed: 'Não foi possível confirmar',
  cancelled: 'Pré-reserva descartada',
};

export interface BookingCardInput {
  conversationId: string;
  previewId: string;
  status: Exclude<BookingCardStatus, 'confirming'>;
  summary: ExperienceBookingSummary;
  notes?: string[];
  expiresAt?: Date | null;
  booking?: { bookingId: string; confirmationCode: string } | null;
  reason?: string | null;
  updatedAt?: Date;
}

// Ponto único de montagem do card: os botões existem só em "preview".
export function bookingCard(input: BookingCardInput): ExperienceBookingCardAction {
  const request = <T extends 'experience.booking.confirm' | 'experience.booking.cancel'>(type: T): BookingCardRequest<T> => ({
    method: 'POST',
    path: '/chat/actions',
    body: { type, conversationId: input.conversationId, previewId: input.previewId },
  });
  const preview = input.status === 'preview';

  return {
    type: 'experience.booking.card',
    cardId: input.previewId,
    status: input.status,
    label: BOOKING_CARD_LABELS[input.status],
    summary: input.summary,
    notes: input.notes ?? [],
    expiresAt: preview && input.expiresAt ? input.expiresAt.toISOString() : null,
    booking: input.status === 'confirmed' ? (input.booking ?? null) : null,
    reason: preview || input.status === 'confirmed' ? null : (input.reason ?? null),
    confirm: preview ? request('experience.booking.confirm') : null,
    cancel: preview ? request('experience.booking.cancel') : null,
    updatedAt: (input.updatedAt ?? new Date()).toISOString(),
  };
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
  // Resumo verificado para o card ("10 vagas para adultos", "com reserva").
  summary: string | null;
  message: string;
}

export interface ExperienceOptionsAction {
  type: 'experience.options';
  label: string;
  // Data consultada (AAAA-MM-DD) ou null para o catálogo sem data.
  date: string | null;
  options: ExperienceOption[];
}

export const RESTAURANT_TYPES = ['restaurante', 'bar', 'alimentacao'] as const;

/**
 * Restaurantes e bares apresentados na resposta, na ordem da lista.
 * Ao tocar, o aplicativo envia `message` para POST /chat na mesma
 * conversa; para reservar, usa a ação `navigate` da resposta.
 */
export interface RestaurantOption {
  position: number;
  restaurantId: string;
  name: string;
  type: (typeof RESTAURANT_TYPES)[number] | null;
  // Texto do cadastro ("10h às 18h"); null quando não cadastrado.
  openingHours: string | null;
  location: string | null;
  minimumAge: number | null;
  acceptsReservations: boolean;
  // Turnos de reserva cadastrados (HH:MM).
  reservationTimes: string[];
  message: string;
}

export interface RestaurantOptionsAction {
  type: 'restaurant.options';
  label: string;
  options: RestaurantOption[];
}

/**
 * Programação de um dia: eventos e shows (tb_evento) e atividades
 * semanais de lazer (tb_programacaolazer). Somente leitura.
 */
export interface EventItem {
  eventId: string;
  kind: 'event' | 'leisure';
  title: string;
  date: string;
  // HH:MM; null quando o cadastro não tem horário.
  time: string | null;
  location: string | null;
  category: string | null;
  // Resumo da descrição cadastrada.
  description: string | null;
}

export interface EventListAction {
  type: 'event.list';
  label: string;
  // Data consultada (AAAA-MM-DD).
  date: string;
  items: EventItem[];
}

/**
 * Solicitação SIMULADA (Governança, Manutenção, TI…). Mesmo ciclo do card
 * de reserva: um card por `cardId`, atualizado no lugar; botões só em
 * "preview". Nada é enviado ao departamento.
 */
export const REQUEST_CARD_STATUSES = ['preview', 'confirming', 'confirmed', 'expired', 'cancelled'] as const;

export type RequestCardStatus = (typeof REQUEST_CARD_STATUSES)[number];

interface RequestCardRequest<T extends 'request.confirm' | 'request.cancel'> {
  method: 'POST';
  path: '/chat/actions';
  body: { type: T; conversationId: string; previewId: string };
}

export interface GuestRequestSummary {
  departmentId: string;
  departmentName: string;
  items: { itemId: string; name: string; quantity: number }[];
  // Texto do próprio hóspede, resumido.
  note: string | null;
  simulated: true;
}

export interface GuestRequestCardAction {
  type: 'request.card';
  cardId: string;
  status: RequestCardStatus;
  label: string;
  summary: GuestRequestSummary;
  // Avisos do departamento (horário de atendimento, prazo).
  notes: string[];
  expiresAt: string | null;
  // Somente em "confirmed": protocolo da simulação (SIM-…).
  request: { requestId: string; protocol: string } | null;
  reason: string | null;
  confirm: RequestCardRequest<'request.confirm'> | null;
  cancel: RequestCardRequest<'request.cancel'> | null;
  updatedAt: string;
}

export const REQUEST_CARD_LABELS: Record<RequestCardStatus, string> = {
  preview: 'Confirmar solicitação simulada',
  confirming: 'Confirmando…',
  confirmed: 'Solicitação simulada registrada',
  expired: 'Solicitação expirada',
  cancelled: 'Solicitação descartada',
};

export interface RequestCardInput {
  conversationId: string;
  previewId: string;
  status: Exclude<RequestCardStatus, 'confirming'>;
  summary: GuestRequestSummary;
  notes?: string[];
  expiresAt?: Date | null;
  protocol?: string | null;
  reason?: string | null;
  updatedAt?: Date;
}

// Ponto único de montagem do card de solicitação: botões só em "preview".
export function requestCard(input: RequestCardInput): GuestRequestCardAction {
  const request = <T extends 'request.confirm' | 'request.cancel'>(type: T): RequestCardRequest<T> => ({
    method: 'POST',
    path: '/chat/actions',
    body: { type, conversationId: input.conversationId, previewId: input.previewId },
  });
  const preview = input.status === 'preview';

  return {
    type: 'request.card',
    cardId: input.previewId,
    status: input.status,
    label: REQUEST_CARD_LABELS[input.status],
    summary: input.summary,
    notes: input.notes ?? [],
    expiresAt: preview && input.expiresAt ? input.expiresAt.toISOString() : null,
    request: input.status === 'confirmed' && input.protocol ? { requestId: input.previewId, protocol: input.protocol } : null,
    reason: preview || input.status === 'confirmed' ? null : (input.reason ?? null),
    confirm: preview ? request('request.confirm') : null,
    cancel: preview ? request('request.cancel') : null,
    updatedAt: (input.updatedAt ?? new Date()).toISOString(),
  };
}

/**
 * Botão de um card. Navegação usa somente telas e parâmetros permitidos
 * (SCREEN_PARAMS); "message" é enviado pelo app a POST /chat na mesma
 * conversa, exatamente como as opções de experience.options.
 */
export type CardButton =
  | { kind: 'navigate'; label: string; navigate: { screen: NavigationScreen; params: NavigateAction['params'] } }
  | { kind: 'message'; label: string; message: string };

export function navigateButton(screen: NavigationScreen, label: string, params: NavigateAction['params'] = {}): CardButton {
  return { kind: 'navigate', label, navigate: { screen, params } };
}

export function messageButton(label: string, message: string): CardButton {
  return { kind: 'message', label, message };
}

/**
 * Tipos de item de catalog.list. Restaurantes, experiências e a
 * programação do dia mantêm suas ações próprias (restaurant.options,
 * experience.options, event.list); "event" aqui são os favoritos.
 */
export const CATALOG_KINDS = ['spa_service', 'product', 'tip', 'esg', 'quiz', 'event'] as const;

export type CatalogKind = (typeof CATALOG_KINDS)[number];

export interface CatalogItem {
  // ID real do cadastro: identidade estável do card.
  id: string;
  // Posição na lista (1 = primeiro): "o segundo" e "Opção 2" referem-se a ela.
  position: number;
  title: string;
  description: string | null;
  // Caminho relativo no bucket de imagens do app ("spa/foto.jpg"); null
  // quando não há imagem ou a pasta não é confirmada. Nunca uma URL inventada.
  imagePath: string | null;
  // Textos já formatados no fuso do resort; o app não reconverte.
  meta: {
    date?: string;
    time?: string;
    location?: string;
    price?: string;
    duration?: string;
    category?: string;
  };
  badges: string[];
  buttons: CardButton[];
}

export interface CatalogListAction {
  type: 'catalog.list';
  label: string;
  kind: CatalogKind;
  items: CatalogItem[];
}

export interface MenuDish {
  id: string;
  name: string;
  description: string | null;
  // Porção compartilhada (R-GAS-10): serve N pessoas; null quando não cadastrado.
  serves: number | null;
  imagePath: string | null;
}

export interface MenuCategory {
  id: string;
  name: string;
  dishes: MenuDish[];
  // Pratos da categoria que não couberam no card ("ver tudo" no app).
  moreDishes: number;
}

/** Cardápio de um restaurante (somente leitura; pratos se escolhem na reserva). */
export interface MenuViewAction {
  type: 'menu.view';
  label: string;
  restaurantId: string;
  restaurantName: string;
  categories: MenuCategory[];
  totalDishes: number;
  buttons: CardButton[];
}

export const BOOKING_STATUSES = ['confirmed', 'pending', 'cancelled', 'unknown'] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export interface BookingItem {
  // ID da reserva (snapshot) ou da reserva simulada (banco da IA).
  bookingId: string;
  kind: 'restaurant' | 'experience';
  title: string;
  date: string;
  time: string | null;
  status: BookingStatus;
  statusLabel: string;
  // Pessoas registradas; null quando o cadastro não permite inferir.
  people: number | null;
  // Reserva feita pelo chat: existe só no banco da IA.
  simulated: boolean;
  confirmationCode: string | null;
  buttons: CardButton[];
}

/** Minhas Reservas: restaurantes e experiências da estadia. */
export interface BookingListAction {
  type: 'booking.list';
  label: string;
  items: BookingItem[];
}

export const REQUEST_STATUSES = ['pending', 'in_progress', 'done', 'cancelled', 'approved', 'denied', 'simulated', 'unknown'] as const;

export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export interface RequestListItem {
  requestId: string;
  // Solicitação a um departamento ou inscrição de lazer (R-LAZ-07).
  kind: 'department' | 'leisure';
  title: string;
  items: string[];
  status: RequestStatus;
  statusLabel: string;
  date: string | null;
  time: string | null;
  simulated: boolean;
  protocol: string | null;
  buttons: CardButton[];
}

/** Minhas Solicitações: departamentos e inscrições de lazer. */
export interface RequestListAction {
  type: 'request.list';
  label: string;
  items: RequestListItem[];
}

export type ChatAction =
  | NavigateAction
  | ExperienceBookingCardAction
  | ExperienceOptionsAction
  | RestaurantOptionsAction
  | EventListAction
  | GuestRequestCardAction
  | CatalogListAction
  | MenuViewAction
  | BookingListAction
  | RequestListAction;

export interface RetrievedSource {
  id: string;
  title: string;
  distance: number | null;
}

export interface ChatResponse {
  reply: string;
  conversationId: string;
  // Mensagem do assistente gravada com esta resposta (narração: POST /chat/voice).
  assistantMessageId?: number;
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

function validNavigation(screen: NavigationScreen, params: NavigateAction['params'] | undefined): boolean {
  const allowed: readonly string[] = SCREEN_PARAMS[screen] ?? [];
  return (
    (NAVIGATION_SCREENS as readonly string[]).includes(screen) &&
    !!params &&
    typeof params === 'object' &&
    Object.entries(params).every(
      ([key, value]) =>
        allowed.includes(key) &&
        isText(value) &&
        /^[\w-]+$/.test(value as string) &&
        (key !== 'tab' || (RESERVATION_TABS as readonly string[]).includes(value as string)) &&
        (key !== 'date' || ISO_DATE.test(value as string)),
    )
  );
}

function validButtons(buttons: CardButton[] | undefined): boolean {
  return (
    Array.isArray(buttons) &&
    buttons.length <= 3 &&
    buttons.every((button) =>
      button?.kind === 'navigate'
        ? isText(button.label, 40) && validNavigation(button.navigate?.screen, button.navigate?.params)
        : button?.kind === 'message' && isText(button.label, 40) && isText(button.message, 120),
    )
  );
}

const isOptionalText = (value: unknown, max: number) => value === null || isText(value, max);
// Somente as pastas do bucket confirmadas no app e um nome de arquivo de imagem.
const IMAGE_PATH = /^(?:restaurant|menu|experience\/logos|spa|tip)\/[^/\\]+\.(?:jpe?g|png|webp|gif|svg)$/i;
const isImagePath = (value: unknown) =>
  value === null || (isText(value, 300) && IMAGE_PATH.test(value as string) && !(value as string).includes('..'));

function validCatalogItem(item: CatalogItem, index: number): boolean {
  const meta = item?.meta;
  return (
    item.position === index + 1 &&
    isText(item.id) &&
    isText(item.title, 160) &&
    isOptionalText(item.description, 400) &&
    isImagePath(item.imagePath) &&
    !!meta &&
    typeof meta === 'object' &&
    Object.entries(meta).every(([key, value]) =>
      ['date', 'time', 'location', 'price', 'duration', 'category'].includes(key) && isText(value, 160) &&
      (key !== 'date' || ISO_DATE.test(value)) && (key !== 'time' || TIME.test(value))) &&
    Array.isArray(item.badges) &&
    item.badges.length <= 4 &&
    item.badges.every((badge) => isText(badge, 40)) &&
    validButtons(item.buttons)
  );
}

/**
 * Validação em tempo de execução antes de enviar ao cliente.
 * Uma ação inválida é descartada em vez de chegar ao aplicativo.
 */
export function isValidChatAction(action: ChatAction): boolean {
  switch (action?.type) {
    case 'navigate':
      return isText(action.label, 60) && validNavigation(action.screen, action.params);

    case 'request.card': {
      const preview = action.status === 'preview';
      const request = (value: GuestRequestCardAction['confirm'] | GuestRequestCardAction['cancel'], type: string) =>
        value?.path === '/chat/actions' &&
        value.body.type === type &&
        value.body.previewId === action.cardId &&
        UUID.test(value.body.conversationId);
      const summary = action.summary;

      return (
        UUID.test(action.cardId) &&
        (REQUEST_CARD_STATUSES as readonly string[]).includes(action.status) &&
        isText(action.label, 60) &&
        !!summary &&
        isText(summary.departmentId) &&
        isText(summary.departmentName, 120) &&
        Array.isArray(summary.items) &&
        summary.items.length >= 1 &&
        summary.items.length <= 10 &&
        summary.items.every((item) => isText(item.itemId) && isText(item.name, 160) && Number.isInteger(item.quantity) && item.quantity >= 1 && item.quantity <= 10) &&
        (summary.note === null || isText(summary.note, 200)) &&
        summary.simulated === true &&
        Array.isArray(action.notes) &&
        action.notes.length <= 4 &&
        action.notes.every((note) => isText(note, 200)) &&
        (action.expiresAt === null || !Number.isNaN(Date.parse(action.expiresAt))) &&
        !Number.isNaN(Date.parse(action.updatedAt)) &&
        (action.status === 'confirmed'
          ? !!action.request && UUID.test(action.request.requestId) && /^SIM-[A-Z0-9]{4,16}$/.test(action.request.protocol)
          : action.request === null) &&
        (preview
          ? request(action.confirm, 'request.confirm') && request(action.cancel, 'request.cancel')
          : action.confirm === null && action.cancel === null)
      );
    }

    case 'experience.booking.card': {
      const preview = action.status === 'preview';
      const request = (
        value: ExperienceBookingCardAction['confirm'] | ExperienceBookingCardAction['cancel'],
        type: string,
      ) =>
        value?.path === '/chat/actions' &&
        value.body.type === type &&
        value.body.previewId === action.cardId &&
        UUID.test(value.body.conversationId);

      return (
        UUID.test(action.cardId) &&
        (BOOKING_CARD_STATUSES as readonly string[]).includes(action.status) &&
        isText(action.label, 60) &&
        validSummary(action.summary) &&
        Array.isArray(action.notes) &&
        action.notes.length <= 6 &&
        action.notes.every((note) => isText(note, 200)) &&
        (action.expiresAt === null || !Number.isNaN(Date.parse(action.expiresAt))) &&
        !Number.isNaN(Date.parse(action.updatedAt)) &&
        (action.status === 'confirmed'
          ? !!action.booking && UUID.test(action.booking.bookingId) && isText(action.booking.confirmationCode, 20)
          : action.booking === null) &&
        (preview
          ? request(action.confirm, 'experience.booking.confirm') && request(action.cancel, 'experience.booking.cancel')
          : action.confirm === null && action.cancel === null)
      );
    }

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
            (option.summary === null || isText(option.summary, 160)) &&
            Array.isArray(option.times) &&
            option.times.every((time) => TIME.test(time)),
        )
      );

    case 'restaurant.options':
      return (
        isText(action.label, 60) &&
        Array.isArray(action.options) &&
        action.options.length >= 1 &&
        action.options.length <= 20 &&
        action.options.every(
          (option, index) =>
            option.position === index + 1 &&
            isText(option.restaurantId) &&
            isText(option.name, 120) &&
            (option.type === null || (RESTAURANT_TYPES as readonly string[]).includes(option.type)) &&
            (option.openingHours === null || isText(option.openingHours, 300)) &&
            (option.location === null || isText(option.location, 120)) &&
            (option.minimumAge === null || (Number.isInteger(option.minimumAge) && option.minimumAge > 0)) &&
            typeof option.acceptsReservations === 'boolean' &&
            Array.isArray(option.reservationTimes) &&
            option.reservationTimes.every((time) => TIME.test(time)) &&
            isText(option.message, 60),
        )
      );

    case 'event.list':
      return (
        isText(action.label, 60) &&
        ISO_DATE.test(action.date) &&
        Array.isArray(action.items) &&
        action.items.length >= 1 &&
        action.items.length <= 30 &&
        action.items.every(
          (item) =>
            isText(item.eventId) &&
            (item.kind === 'event' || item.kind === 'leisure') &&
            isText(item.title, 160) &&
            ISO_DATE.test(item.date) &&
            (item.time === null || TIME.test(item.time)) &&
            (item.location === null || isText(item.location, 120)) &&
            (item.category === null || isText(item.category, 80)) &&
            (item.description === null || isText(item.description, 240)),
        )
      );

    case 'catalog.list':
      return (
        isText(action.label, 60) &&
        (CATALOG_KINDS as readonly string[]).includes(action.kind) &&
        Array.isArray(action.items) &&
        action.items.length >= 1 &&
        action.items.length <= 20 &&
        action.items.every(validCatalogItem) &&
        new Set(action.items.map(({ id }) => id)).size === action.items.length
      );

    case 'menu.view':
      return (
        isText(action.label, 60) &&
        isText(action.restaurantId) &&
        isText(action.restaurantName, 120) &&
        Number.isInteger(action.totalDishes) &&
        action.totalDishes >= 0 &&
        Array.isArray(action.categories) &&
        action.categories.length >= 1 &&
        action.categories.length <= 20 &&
        action.categories.every(
          (category) =>
            isText(category.id) &&
            isText(category.name, 120) &&
            Number.isInteger(category.moreDishes) &&
            category.moreDishes >= 0 &&
            Array.isArray(category.dishes) &&
            category.dishes.length <= 10 &&
            category.dishes.every(
              (dish) =>
                isText(dish.id) &&
                isText(dish.name, 160) &&
                isOptionalText(dish.description, 300) &&
                (dish.serves === null || (Number.isInteger(dish.serves) && dish.serves >= 1 && dish.serves <= 50)) &&
                isImagePath(dish.imagePath),
            ),
        ) &&
        validButtons(action.buttons)
      );

    case 'booking.list':
      return (
        isText(action.label, 60) &&
        Array.isArray(action.items) &&
        action.items.length >= 1 &&
        action.items.length <= 30 &&
        action.items.every(
          (item) =>
            isText(item.bookingId) &&
            (item.kind === 'restaurant' || item.kind === 'experience') &&
            isText(item.title, 160) &&
            ISO_DATE.test(item.date) &&
            (item.time === null || TIME.test(item.time)) &&
            (BOOKING_STATUSES as readonly string[]).includes(item.status) &&
            isText(item.statusLabel, 40) &&
            (item.people === null || (Number.isInteger(item.people) && item.people >= 1 && item.people <= 50)) &&
            typeof item.simulated === 'boolean' &&
            (item.confirmationCode === null || isText(item.confirmationCode, 20)) &&
            validButtons(item.buttons),
        ) &&
        new Set(action.items.map(({ kind, bookingId }) => `${kind}:${bookingId}`)).size === action.items.length
      );

    case 'request.list':
      return (
        isText(action.label, 60) &&
        Array.isArray(action.items) &&
        action.items.length >= 1 &&
        action.items.length <= 30 &&
        action.items.every(
          (item) =>
            isText(item.requestId) &&
            (item.kind === 'department' || item.kind === 'leisure') &&
            isText(item.title, 160) &&
            Array.isArray(item.items) &&
            item.items.length <= 10 &&
            item.items.every((name) => isText(name, 160)) &&
            (REQUEST_STATUSES as readonly string[]).includes(item.status) &&
            isText(item.statusLabel, 40) &&
            (item.date === null || ISO_DATE.test(item.date)) &&
            (item.time === null || TIME.test(item.time)) &&
            typeof item.simulated === 'boolean' &&
            (item.protocol === null || isText(item.protocol, 20)) &&
            validButtons(item.buttons),
        ) &&
        new Set(action.items.map(({ kind, requestId }) => `${kind}:${requestId}`)).size === action.items.length
      );

    default:
      return false;
  }
}

export function sanitizeActions(actions: readonly ChatAction[] | undefined): ChatAction[] {
  return (actions ?? []).filter(isValidChatAction);
}
