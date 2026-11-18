import { RESERVATION_TABS, SCREEN_PARAMS, type NavigationScreen } from '../capabilities/capabilities.js';

export type { NavigationScreen } from '../capabilities/capabilities.js';

export const NAVIGATION_SCREENS = Object.keys(SCREEN_PARAMS) as NavigationScreen[];

export interface NavigateAction {
  type: 'navigate';
  label: string;
  screen: NavigationScreen;
  params: {
    restaurantId?: string;
    departmentId?: string;
    experienceId?: string;
    date?: string;
    tab?: (typeof RESERVATION_TABS)[number];
  };
}

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
  simulated: true;
}

export const BOOKING_CARD_STATUSES = ['preview', 'confirming', 'confirmed', 'expired', 'failed', 'cancelled'] as const;

export type BookingCardStatus = (typeof BOOKING_CARD_STATUSES)[number];

interface BookingCardRequest<T extends 'experience.booking.confirm' | 'experience.booking.cancel'> {
  method: 'POST';
  path: '/chat/actions';
  body: { type: T; conversationId: string; previewId: string };
}

export interface ExperienceBookingCardAction {
  type: 'experience.booking.card';
  cardId: string;
  status: BookingCardStatus;
  label: string;
  summary: ExperienceBookingSummary;
  notes: string[];
  expiresAt: string | null;
  booking: { bookingId: string; confirmationCode: string } | null;
  reason: string | null;
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

export interface ExperienceOption {
  position: number;
  experienceId: string;
  title: string;
  times: string[];
  summary: string | null;
  message: string;
}

export interface ExperienceOptionsAction {
  type: 'experience.options';
  label: string;
  date: string | null;
  options: ExperienceOption[];
}

export const RESTAURANT_TYPES = ['restaurante', 'bar', 'alimentacao'] as const;

export interface RestaurantOption {
  position: number;
  restaurantId: string;
  name: string;
  type: (typeof RESTAURANT_TYPES)[number] | null;
  openingHours: string | null;
  location: string | null;
  minimumAge: number | null;
  acceptsReservations: boolean;
  reservationTimes: string[];
  message: string;
}

export interface RestaurantOptionsAction {
  type: 'restaurant.options';
  label: string;
  options: RestaurantOption[];
}

export interface EventItem {
  eventId: string;
  kind: 'event' | 'leisure';
  title: string;
  date: string;
  time: string | null;
  location: string | null;
  category: string | null;
  description: string | null;
}

export interface EventListAction {
  type: 'event.list';
  label: string;
  date: string;
  items: EventItem[];
}

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
  note: string | null;
  simulated: true;
}

export interface GuestRequestCardAction {
  type: 'request.card';
  cardId: string;
  status: RequestCardStatus;
  label: string;
  summary: GuestRequestSummary;
  notes: string[];
  expiresAt: string | null;
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

export type CardButton =
  | { kind: 'navigate'; label: string; navigate: { screen: NavigationScreen; params: NavigateAction['params'] } }
  | { kind: 'message'; label: string; message: string };

export function navigateButton(screen: NavigationScreen, label: string, params: NavigateAction['params'] = {}): CardButton {
  return { kind: 'navigate', label, navigate: { screen, params } };
}

export function messageButton(label: string, message: string): CardButton {
  return { kind: 'message', label, message };
}

export const CATALOG_KINDS = ['spa_service', 'product', 'tip', 'esg', 'quiz', 'event'] as const;

export type CatalogKind = (typeof CATALOG_KINDS)[number];

export interface CatalogItem {
  id: string;
  position: number;
  title: string;
  description: string | null;
  imagePath: string | null;
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
  serves: number | null;
  imagePath: string | null;
}

export interface MenuCategory {
  id: string;
  name: string;
  dishes: MenuDish[];
  moreDishes: number;
}

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
  bookingId: string;
  kind: 'restaurant' | 'experience';
  title: string;
  date: string;
  time: string | null;
  status: BookingStatus;
  statusLabel: string;
  people: number | null;
  simulated: boolean;
  confirmationCode: string | null;
  buttons: CardButton[];
}

export interface BookingListAction {
  type: 'booking.list';
  label: string;
  items: BookingItem[];
}

export const REQUEST_STATUSES = ['pending', 'in_progress', 'done', 'cancelled', 'approved', 'denied', 'simulated', 'unknown'] as const;

export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export interface RequestListItem {
  requestId: string;
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
