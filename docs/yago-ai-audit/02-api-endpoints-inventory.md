# 02 — Inventário de endpoints da API

> Fonte: código do `yago-mobile-front` (versão 5.18.1, branch `feat/chat`). Este documento descreve **o que o aplicativo chama**, e não o que o backend de IA já consegue chamar. Nenhum desses endpoints está hoje disponível para o `yago-ai-api`. Hoje a IA lê um snapshot do banco (ver `docs/mobile-ai-integration.md` §1 e §11).

## Convenções

- **Instância `API`** (`src/services/api.ts:6-8`): `axios.create({ baseURL: process.env.EXPO_PUBLIC_API })`.
  - Interceptor de request (`api.ts:10-21`): adiciona `Authorization: Bearer <loggedUser.token>` quando há usuário logado. Nenhum outro header é enviado (nem resort, nem idioma).
  - Interceptor de response (`api.ts:25-31`): guarda o offset do header `Date` (`src/utils/serverTime.ts`).
- **Instância `CHAT_API`** (`src/services/concierge/chatApi.ts:35-52`): `EXPO_PUBLIC_CONCIERGE_API`, timeout de 180 s, header `X-Demo-Guest-Id` com `guestHolder.id`.
- **Socket.IO** (`src/services/quiz/liveSession.ts:249-263`): `${EXPO_PUBLIC_SOCKET_IO}/quiz`.
- **Paths**: relativos ao `baseURL`. O axios não recebe barra inicial, e o app monta as query strings manualmente.
- **Tratamento de erro padrão**: os hooks capturam o erro, mostram um toast via `validateRequestError` (`src/utils/validateError.ts`) e devolvem `[]` ou `{}`. O formato de erro esperado é `TRequestError { validateError: [{ property?, constraints: { message } }] }` (`src/types/index.ts:3-11`).
- **Cache**: TanStack Query v5 com `gcTime` de 24 h (`src/services/queryClient.ts:11-17`), **persistido em disco** via `PersistQueryClientProvider` + MMKV (`src/routes/index.tsx:26-43`).
- **Paginação**: nenhuma rota do app pagina, exceto `GET quiz/` (`offset`/`limit`).

**Classificação**:

| Classe | Significado |
| --- | --- |
| `READ` | Só consulta. |
| `WRITE` | Cria ou modifica um registro de baixo impacto. |
| `TRANSACTIONAL` | Reserva, cancelamento, inscrição ou outra operação com efeito importante. |
| `NAVIGATION_ONLY` | Precisa da tela do app. |
| `UNKNOWN` | Comportamento não confirmado. |

**Reuso pela IA**:

| Valor | Significado |
| --- | --- |
| `SIM` | Pode ser chamada pelo backend com o token do hóspede. |
| `COM RESSALVA` | Exige correção ou validação adicional. |
| `NÃO` | Não deve ser chamada pela IA. |

---

## Tabela-resumo

### API principal (`EXPO_PUBLIC_API`)

| # | Módulo | Método | Path | Classe | Função (arquivo) | Usado por |
|---|---|---|---|---|---|---|
| E01 | Auth | POST | `access-control/guest-auth` | WRITE (sessão) | `useLogin` (`services/user/index.ts:17-39`) | Login |
| E02 | Sistema | GET | `system/responsible` | READ | `getResponsible` (`services/system/index.ts:64-87`) | Home |
| E03 | Sistema | GET | `system/app-version` | READ | `getVersionApplication` (`services/system/index.ts:41-62`) | Home, Update, Login |
| E04 | Sistema | GET | `image/find-by-type/:type` | READ | `getImageFindByType` (`services/system/index.ts:18-39`) | Home, Quiz |
| E05 | Push | POST | `notification/assign` | WRITE | `saveNotificationToken` (`services/system/index.ts:89-96`) | pós-login |
| E06 | Solicitações | GET | `department` | READ | `getDepartments` (`services/department/index.ts:38-65`) | Requests, MyRequests |
| E07 | Solicitações | GET | `order` | READ (pessoal) | `getOrderDepartments` (`services/department/index.ts:67-81`) | MyRequests |
| E08 | Solicitações | POST | `order` | TRANSACTIONAL | `createOrderDepartment` (`services/department/index.ts:83-103`) | Requests |
| E09 | Solicitações | PATCH | `order/update-situation/:id` | TRANSACTIONAL | `updateSituationOrderDepartment` (`services/department/index.ts:105-130`) | MyRequests |
| E10 | Lazer | GET | `leisure/leisure` | READ | `fetchLeisure` / `getLeisure` (`services/leisure/index.ts:30-46`) | Leisure, concierge local |
| E11 | Lazer | GET | `leisure/category` | READ | `getLeisureCategory` (`services/leisure/index.ts:52-77`) | Leisure |
| E12 | Lazer | GET | `leisure/info/:categoryId` | READ | `getLeisureInfo` (`services/leisure/index.ts:48-50`) | Leisure (N chamadas) |
| E13 | Lazer | POST | `leisure/sign` | TRANSACTIONAL | `signLeisure` (`services/leisure/index.ts:79-90`) | Signature |
| E14 | Lazer | GET | `leisure/sign` | READ (pessoal) | `getLeisureSubscription` (`services/leisure/index.ts:92-106`) | Leisure, Signature, MyRequests |
| E15 | Lazer | PATCH | `leisure/sign/update-situation/:id` | TRANSACTIONAL | `updateSituationOrderSubscription` (`services/leisure/index.ts:108-133`) | MyRequests |
| E16 | Gastronomia | GET | `restaurant` | READ | `fetchRestaurants` / `getRestaurant` (`services/gastronomy/index.ts:48-68`) | Gastronomy, Home, Header, concierge |
| E17 | Gastronomia | GET | `restaurant/:id` | READ | `fetchRestaurantId` / `getRestaurantId` (`services/gastronomy/index.ts:75-92`) | gastronomyId, bookingGastronomyDetails |
| E18 | Gastronomia | GET | `category-menu/list-by-restaurant/:restaurantId` | READ | `getCategoryListRestaurantId` (`services/gastronomy/index.ts:106-116`) | cardápio, reservas |
| E19 | Gastronomia | GET | `menu/list-by-category/:categoryId` | READ | `getMenuListCategoryId` (`services/gastronomy/index.ts:94-104`) | cardápio (N chamadas) |
| E20 | Gastronomia | GET | `section-menu/list-by-restaurant-id/:restaurantId` | READ (**não usado**) | `getSectionListRestaurantId` (`services/gastronomy/index.ts:118-128`) | nenhuma tela |
| E21 | Gastronomia | GET | `block-category/list-by-category-menu/:categoryId` | READ | `getBlockCategoryMenuId` (`services/gastronomy/index.ts:130-144`) | SelectDish |
| E22 | Gastronomia | GET | `availability-restaurant/find-bookings-available` | READ | `fetchRestaurantAvailability` (`services/gastronomy/index.ts:189-218`) | SelectDate, concierge local |
| E23 | Gastronomia | POST | `booking-restaurant` | TRANSACTIONAL | `bookingGastronomy` (`services/gastronomy/index.ts:220-278`) | SelectDish/OrderSummary |
| E24 | Gastronomia | GET | `booking-restaurant/find-by-lodging-pms/:lodgingIdPms` | READ (pessoal) | `getBookingGastronomy` (`services/gastronomy/index.ts:280-318`) | MyReservation, Booking Details |
| E25 | Gastronomia | PATCH | `booking-restaurant/update-situation-by-lodging-pms` | TRANSACTIONAL | `updateSituationBookingGastronomy` (`services/gastronomy/index.ts:320-358`) | MyReservation |
| E26 | Gastronomia | PUT | `order-restaurant/:orderRestaurantId` | TRANSACTIONAL | `updateOrderGastronomy` (`services/gastronomy/index.ts:360-370`) | edição de reserva |
| E27 | Gastronomia | PATCH | `booking-restaurant/update-obs/:reservationId` | WRITE | `updateBookingObservation` (`services/gastronomy/index.ts:372-381`) | edição de reserva |
| E28 | Experiências | GET | `experience` | READ | `fetchExperiences` / `getExperiences` (`services/experience/index.ts:41-58`) | Experiences, concierge |
| E29 | Experiências | GET | `experience/:id` | READ | `fetchExperienceId` / `getExperienceId` (`services/experience/index.ts:65-82`) | detalhes e reserva |
| E30 | Experiências | POST | `experience-availability/find-availability` | READ (via POST) | `fetchExperienceAvailability` (`services/experience/index.ts:114-135`) | SelectDate, concierge local |
| E31 | Experiências | POST | `experience-booking` | TRANSACTIONAL | `bookingExperience` (`services/experience/index.ts:146-236`) | Summary |
| E32 | Experiências | POST | `experience/sign` | TRANSACTIONAL | `signExperience` (`services/experience/index.ts:137-139`) | encadeado em E31 |
| E33 | Experiências | GET | `experience-booking/find-by-lodging-pms/:lodgingIdPms` | READ (pessoal) | `getBookingExperience` (`services/experience/index.ts:244-267`) | MyReservation, Home, Header, Booking |
| E34 | Experiências | PATCH | `experience-booking/update-situation/:reservationId` | TRANSACTIONAL | `updateSituationBookingExperience` (`services/experience/index.ts:269-304`) | MyReservation |
| E35 | Eventos | GET | `event?dateStart=&dateEnd=` | READ | `fetchEvents` / `getEvents` (`services/event/index.ts:25-45`) | Events, Home, MyFavorites, Header |
| E36 | Favoritos/Notificações | GET | `notification` | READ (pessoal) | `getNotifications` (`services/notification/index.ts:26-43`) | MyFavorites, Events, Home, Header |
| E37 | Favoritos | POST | `notification` | WRITE | `createNotification` (`services/notification/index.ts:45-91`) | CardEvent |
| E38 | Notificações | PATCH | `notification/:id` | WRITE | `readNotification` (`services/notification/index.ts:93-116`) | Header |
| E39 | Favoritos | DELETE | `notification/:id` | WRITE | `removeNotification` (`services/notification/index.ts:118-138`) | MyFavorites, CardEvent |
| E40 | Boutique | GET | `product/category` | READ | `getBoutiqueCategories` (`services/boutique/index.ts:13-32`) | Boutique |
| E41 | Boutique | GET | `product/?productCategoryId=` | READ | `getBoutiqueProductsCategoryId` (`services/boutique/index.ts:34-49`) | Boutique |
| E42 | SPA | GET | `spa` | READ | `getSpa` (`services/spa/index.ts:13-27`) | SPA |
| E43 | SPA | GET | `spa-category` | READ | `getSpaService` (`services/spa/index.ts:29-52`) | SPA |
| E44 | SPA | GET | `spa-service` | READ | `getSpaService` (`services/spa/index.ts:35`) | SPA |
| E45 | ESG | GET | `esg` | READ | `getEsg` (`services/esg/index.ts:12-26`) | ESG |
| E46 | ESG | GET | `esg/partner` | READ | `getEsgPartner` (`services/esg/index.ts:28-42`) | ESG |
| E47 | ESG | GET | `esg/initiative` | READ | `getEsgInitiative` (`services/esg/index.ts:44-58`) | ESG |
| E48 | Dicas | GET | `system/tip` | READ | `getTip` (`services/tip/index.ts:12-26`) | Tip |
| E49 | Formulários | GET | `form/:id` | READ | `getForm` / `getSignatureForm` (`services/signature/index.ts:7-26`) | termos de Lazer e Experiência |
| E50 | Quiz | GET | `quiz/?offset=&limit=` | READ | `services/quiz/api.ts:24-42` | QuizList |
| E51 | Quiz | GET | `quiz/:quizId` | READ | `services/quiz/api.ts:49-65` | QuizLobby |
| E52 | Quiz | POST | `quiz-participation/` | WRITE | `services/quiz/api.ts:67-70` | QuizPlay (async) |
| E53 | Quiz | GET | `quiz-participation/:quizId/me?guestId=` | READ (pessoal) | `services/quiz/api.ts:72-77` | Lobby/Play |
| E54 | Quiz | POST | `quiz-participation/answers` | WRITE | `services/quiz/api.ts:79-82` | QuizPlay |
| E55 | Quiz | POST | `quiz-participation/next` | WRITE | `services/quiz/api.ts:84-90` | QuizPlay |
| E56 | Quiz | GET | `quiz-participation/:participationId/result?guestId=` | READ (pessoal) | `services/quiz/api.ts:92-97` | Result/Lobby |

### Socket.IO (`EXPO_PUBLIC_SOCKET_IO`, namespace `/quiz`)

| # | Direção | Evento | Payload |
|---|---|---|---|
| S01 | conexão | `auth: { token, role: "guest" }`, `transports: ["websocket"]` | `liveSession.ts:249-263` |
| S02 | cliente → servidor | `quiz:join`, `answer:submit`, `quiz:leave` | `liveSession.ts:132-140, 266-286` |
| S03 | servidor → cliente | `quiz:joined`, `quiz:rejected`, `player:joined/left`, `quiz:started`, `question:started`, `question:ended`, `answer:result`, `leaderboard:update`, `quiz:ended`, `host:disconnected`, `error`, `pong` | `liveSession.ts` |

### Yago AI API (`EXPO_PUBLIC_CONCIERGE_API`), já existente

| # | Método | Path | Função |
|---|---|---|---|
| A01 | POST | `/chat` | `chatApi.sendMessage` (`services/concierge/chatApi.ts:103-108`) |
| A02 | POST | `/chat/actions` | `chatApi.runAction` (`chatApi.ts:111-117`) |
| A03 | POST | `/chat/voice` | `chatApi.getVoice` (`chatApi.ts:126-146`) |
| A04 | GET | `/chat/:conversationId/messages` | `chatApi.getMessages` (`chatApi.ts:149-155`) |

### Serviços externos (fora do escopo de tools)

- Firebase Messaging (token FCM).
- Notifee (notificações locais).
- ElevenLabs TTS (`services/speech/elevenlabsClient.ts`), com chave `EXPO_PUBLIC_*` no bundle.
- Lojas de app (`Linking.openURL`).
- WhatsApp do SPA (`spa.link`).
- WebView com links externos.

**Totais**:

| Grupo | Quantidade |
|---|---|
| API principal | **56** endpoints (49 de domínio + 7 de quiz; 55 em uso, 1 morto: E20) |
| Socket do quiz | 1 namespace |
| Yago AI API | 4 rotas |

---

## Detalhamento por endpoint

Em todos os casos, **Auth** é Bearer JWT do hóspede, enviado pelo interceptor. Exceção: E01, que é anônimo. Os exemplos JSON vêm dos tipos em `src/services/types.d.ts`; IDs e nomes são fictícios.

### Autenticação e sistema

#### E01 — `POST access-control/guest-auth`

- **Body**: `{ "room": 101, "laterName": "Silva" }`.
  - O schema zod está em `src/screens/Login/formSchema.ts`: `room` é número (máx. 3 dígitos no input) e `laterName` é string obrigatória, enviada com `trim()`.
- **Resposta (`IUser`, `types.d.ts:15-22`)**:
  ```json
  {
    "token": "<jwt>",
    "guestId": "uuid-guest-logado",
    "guestHolder": {
      "id": "uuid-titular", "name": "Titular Exemplo", "uh": "101", "type": "titular",
      "birthDate": "1980-01-01", "dateCheckin": "2026-10-20T00:00:00.000Z",
      "dateCheckout": "2026-10-25T00:00:00.000Z", "lodgingIdPms": 123456,
      "guestIdPms": 987, "dateFirstLogin": "2026-10-20T15:00:00.000Z", "createdAt": "..."
    },
    "companions": [ { "id": "uuid-acomp", "name": "Acompanhante", "birthDate": "2015-05-05", "...": "mesmo shape de TGuest" } ],
    "responsibleId": null
  }
  ```
- **Efeitos colaterais**:
  - salva tudo no zustand persistido (`stores/slices/user.ts`);
  - registra o token FCM via E05.
- **Reuso pela IA**: **NÃO**. A IA não deve autenticar hóspedes. Precisa receber o JWT do app (ver 08).
- **Observação**: `type` do titular é `string` livre. Os valores reais são `NÃO CONFIRMADO`.

#### E02 — `GET system/responsible`

- **Resposta**: `IResponseResponsible[] { id, name, createdAt }`.
- **Regra**: o app pega o `id` cujo `name === "Hospede"` e grava em `loggedUser.responsibleId` (`services/system/index.ts:71-74`).
- O `responsibleId` é **obrigatório** nos bodies E08, E23 e E31. **Ele só é buscado ao focar a Home** (`screens/Home/actions.ts:60`).
- **Reuso**: SIM. É uma constante do resort que o backend pode cachear.

#### E03 — `GET system/app-version`

- Resposta `{ version }`: a versão **mínima** suportada (`routes/Config/stack.routes.tsx:144-152`).
- Reuso: NÃO.

#### E04 — `GET image/find-by-type/:type`

- `type` ∈ `"home" | "quiz"`.
- Resposta: `IResponseImage[] { id, type, image, json: { linkType: "external" | "experience", link?, experience? }, situation }`.
- O banner da Home navega para WebView ou `experienceId`.
- Reuso: COM RESSALVA. Útil só para destacar promoção.

#### E05 — `POST notification/assign`

- Body `{ token: "<fcm>", status: 1 }`.
- Reuso: NÃO.

### Solicitações (departamentos)

#### E06 — `GET department`

- **Resposta `IDepartment[]`** (`types.d.ts:47-58`):
  ```json
  [{
    "id": "uuid-dep", "situation": true, "order": 1, "name": "Governança",
    "description": "Arrumação e enxoval", "logo": "gov.png", "request": "?",
    "infosDepartment": [{ "id": "i1", "order": 1, "title": "Horário", "description": "08h às 18h", "departmentId": "uuid-dep" }],
    "itemsDepartment": [
      { "id": "it1", "name": "Toalhas", "situation": true, "departmentId": "uuid-dep", "subItemId": null },
      { "id": "it2", "name": "Toalha de banho", "situation": true, "departmentId": "uuid-dep", "subItemId": "it1" }
    ]
  }]
  ```
- **Pós-processamento no app** (`services/department/index.ts:43-56`):
  - descarta departamentos sem `infosDepartment` **e** sem `itemsDepartment`;
  - filtra itens com `situation`;
  - monta a hierarquia por `subItemId` (`buildHierarchy`, l.28-36);
  - ordena os itens por `name` e os departamentos por `order` crescente.
- **Campo `request`**: declarado, **não usado**. Significado `NÃO CONFIRMADO`.
- **Os departamentos e itens são dados do resort** e não estão fixos no app. O catálogo real (toalhas, travesseiros, limpeza…) só pode ser confirmado consultando a API. `NÃO CONFIRMADO` pelo código.
- Reuso: SIM.

#### E07 — `GET order`

- **Resposta `IResponseOrderDepartment[]`** (`types.d.ts:68-85`):
  ```json
  [{ "id": "uuid-order", "situation": "pendente", "date": null, "createdAt": "2026-10-21T13:00:00Z",
     "orderItems": [{ "id": "oi1", "itemDepartmentId": "it2", "itemDepartment": { "id": "it2", "name": "Toalha de banho" } }],
     "guestId": "uuid-guest", "guestObs": "Duas unidades, por favor", "departmentId": "uuid-dep",
     "uh": "101", "responsibleId": "uuid-resp", "collaboratorObs": null, "collaboratorId": null,
     "sectorId": null, "depTransferId": null, "image": null, "guest": { "...": "TGuest" } }]
  ```
- **Escopo**: o app não envia filtro. O servidor filtra pelo token (`NÃO CONFIRMADO` se por hóspede ou por hospedagem).
- **Situações**: `atendida | cancelada | pendente | executando` (`types.d.ts:24`).
- Reuso: SIM, com o token do hóspede.

#### E08 — `POST order`

- **Body `IBodyOrderDepartment`** (`types.d.ts:87-92`; montado em `screens/Requests/actions.ts:46-63`):
  ```json
  { "departmentId": "uuid-dep", "responsibleId": "uuid-resp-hospede",
    "itemDepartmentIds": ["it2"], "guestObs": "Duas unidades, por favor" }
  ```
- **Regras**:
  - é preciso ter ao menos um item ou uma observação;
  - o pai é removido quando um filho dele está marcado (`filterItems`, l.16-23);
  - **não há campo de quantidade**: quantidade só cabe em `guestObs`;
  - um departamento sem itens não exibe o formulário (`screens/Requests/screens/[departmentId].tsx:65`).
- **Resposta**: `NÃO CONFIRMADO` (tipada como `any`).
- **Efeito**: toast + `goBack()`. **Não invalida** o cache `["order"]`.
- **Idempotência**: nenhuma.
- Reuso: SIM, com confirmação.

#### E09 — `PATCH order/update-situation/:id`

- Body `{ "situation": "cancelada" }`.
- A UI só oferece o cancelamento quando `situation === "pendente"`, com PopUp de confirmação (`screens/MyRequests/index.tsx:67-117`).
- Atualiza o cache otimisticamente.
- Reuso: SIM, com confirmação.

### Lazer

#### E10 — `GET leisure/leisure`

- **Resposta `IResponseLeisure[]`** (`types.d.ts:640-651`):
  ```json
  [{ "id": "uuid-ativ", "name": "Hidroginástica", "dayOfWeek": "monday", "hour": "10:00:00",
     "locationId": "uuid-loc", "location": { "id": "uuid-loc", "name": "Piscina", "acronym": "PSC", "latitude": "-0.0", "longitude": "-0.0" },
     "leisureCategoryId": "uuid-cat", "leisureCategory": { "id": "uuid-cat", "name": "Adulto", "order": 1, "situation": true },
     "leisureForms": [{ "id": "uuid-lform", "formId": "uuid-form", "leisureId": "uuid-ativ", "leisureCategoryId": "uuid-cat", "form": { "...": "IResponseForm" } }] }]
  ```
- **É uma programação semanal recorrente** (`dayOfWeek` em inglês minúsculo + `hour`), e não um evento datado.
- Reuso: SIM.

#### E11 / E12 — `GET leisure/category` + `GET leisure/info/:categoryId`

- O app faz uma chamada E12 **por categoria** (N+1) e anexa `registrationForm = leisureForms[0].form` e `leisureInfo` (`services/leisure/index.ts:52-77`).
- Filtra `order > 0 && situation` e ordena por `order` crescente.
- `IResponseLeisureInfo { id, title, description, leisureCategoryId }`.
- Reuso: SIM.

#### E13 — `POST leisure/sign`

- **Body `IBodySignLeisure`** (`types.d.ts:808-818`; montado em `screens/Signature/actions.ts:50-120`):
  ```json
  { "leisureFormId": "uuid-lform", "guestId": "uuid-responsavel-18+", "situation": "pendente",
    "leisureGuestsForm": [{ "guestId": "uuid-crianca", "json": { "uuid-field-nasc": "2018-03-01", "uuid-field-alergia": "Não" } }] }
  ```
- **Regras**:
  - `leisureFormId` é o id do vínculo leisureForm, **não** o `formId`;
  - vai **um POST por leisureForm**, em `Promise.all`;
  - `situation` é sempre `"pendente"`;
  - não há assinatura gráfica.
- **Efeitos**:
  - nenhuma invalidação de `["leisureSubscription"]`;
  - os POSTs de "autorizar todos" **não são aguardados** (`Signature/actions.ts:71-103`).
- Reuso: COM RESSALVA. Depende de um formulário dinâmico + seleção de responsável e de crianças. Recomenda-se navegação (ver 07).

#### E14 — `GET leisure/sign`

- **Resposta `IResponseLeisureSubscription[]`**: `{ id, date, guestId, leisureFormId, leisureForm: { form, leisure, leisureCategory }, leisureGuestsForm: [{ guestId, observation }], signature, situation: "aprovado" | "pendente" | "negado" }`.
- Reuso: SIM.

#### E15 — `PATCH leisure/sign/update-situation/:id`

- Body `{ "situation": "negado" }`. O "cancelamento" do hóspede é gravado como `negado` (`screens/MyRequests/components/CardSubscription.tsx:162-178`).
- Só é oferecido quando `pendente`.
- Reuso: SIM, com confirmação.

### Gastronomia

#### E16 / E17 — `GET restaurant`, `GET restaurant/:id`

- **Resposta `IResponseRestaurant`** (`types.d.ts:445-465`):
  ```json
  { "id": "uuid-rest", "order": 1, "situation": true, "name": "Restaurante Exemplo", "description": "...",
    "logo": "logo.png", "image": "foto.jpg", "type": "restaurante", "operation": "12h às 15h",
    "closure": "17:00", "standardVacancies": "40", "existsBooking": "sim", "link": null,
    "minimumDaily": 2, "minimumAge": 12, "locationId": "uuid-loc", "location": { "name": "Bloco A", "...": "TLocation" },
    "timeRestaurant": [{ "id": "uuid-turno", "description": "19:30", "situation": true, "vacancies": 20 }] }
  ```
- **Campos-chave**:
  - `type` ∈ `restaurante | bar | alimentacao`;
  - `existsBooking` (`"sim"` aceita reserva pelo app);
  - `closure` (hora de corte para reservar, editar e cancelar);
  - `minimumDaily` (número mínimo de noites para o restaurante aparecer);
  - `minimumAge`.
- **Imagens**: `${EXPO_PUBLIC_BUCKET}/restaurant/<image>`.
- Cache: `staleTime` de 30 min.
- Reuso: SIM.

#### E18 + E19 — cardápio

- E18 `TResponseCategoryMenu[] { id, referenceId, order, situation, name, icon, restaurantId }`. `referenceId` = id da categoria pai.
- E19 `IResponseMenuListByCategory[] { id, serves, order, situation, name, description, image, virtual, categoryMenuId, menuItem: [{ id, name, situation }] }`.
- **Montagem (`getCategoryMenuId`, `services/gastronomy/index.ts:146-181`)**:
  - uma chamada E19 **por categoria** (N+1);
  - filtra `situation && order > 0`;
  - ordena por `order`;
  - os `menuItem` são os **ingredientes removíveis** do prato.
- **Imagens**: `${BUCKET}/menu/<image>`.
- Reuso: SIM.

#### E20 — `GET section-menu/list-by-restaurant-id/:id`

- **Não é chamado por nenhuma tela.** Tipo `IResponseMenuSection`.
- Reuso: UNKNOWN.

#### E21 — `GET block-category/list-by-category-menu/:categoryId`

- `IBlockCategoryMenu[] { categoryMenuId, blockCategoryId }`.
- **Semântica aplicada no app**: escolher prato da categoria X **desabilita** a categoria Y (`screens/Booking/Gastronomy/actions.ts:107-157`).
- Reuso: SIM, apenas para validar.

#### E22 — `GET availability-restaurant/find-bookings-available`

- **Query**: `dateCheckin=YYYY-MM-DD&dateCheckout=YYYY-MM-DD&numberOfGuests=N&restaurantId=uuid`. Os nomes na URL diferem dos campos TS (comentário em `services/gastronomy/index.ts:183-188`).
- **Resposta `IResponseRestaurantAvailability`**: mapa de data para slots.
  ```json
  { "2026-10-22": [{ "availabilityRestaurantId": "uuid-av", "dateBooking": "2026-10-22", "vacancies": 12, "isAvailable": true, "hour": "19:30", "timeRestaurantId": "uuid-turno" }] }
  ```
- **Regras do app**:
  - a janela é a estadia inteira, incluindo o dia do checkout;
  - a data só fica habilitada se `now < data + closure` e houver slot `isAvailable`;
  - o slot fica desabilitado se a hora já passou hoje (fuso do resort) (`SelectDate.tsx:41-76`).
- **Inconsistência**: `numberOfGuests` é sempre `companions.length + 1` (toda a hospedagem), e não as pessoas selecionadas (`SelectDate.tsx:38`).
- Reuso: SIM (READ).

#### E23 — `POST booking-restaurant`

- **Body `IBodyBookingGastronomy`** (`types.d.ts:206-219`; montado em `screens/Booking/Gastronomy/actions.ts:166-203`):
  ```json
  { "responsibleId": "uuid-resp-hospede", "notificationTriggerTime": "19:30", "numberOfGuests": 3,
    "checkin": "2026-10-20T00:00:00.000Z", "checkout": "2026-10-25T00:00:00.000Z",
    "date": "2026-10-22T12:00:00.000Z", "obs": "Mesa perto da janela", "lodgingIdPms": 123456,
    "holderId": "uuid-titular-18+", "restaurantId": "uuid-rest", "timeRestaurantId": "uuid-turno",
    "orderRestaurant": [
      { "guestId": "uuid-titular-18+", "obs": "", "menuIds": ["uuid-entrada", "uuid-principal"],
        "json": { "restrictionDish": [{ "dishId": "uuid-principal", "restrictions": [{ "id": "uuid-ing", "name": "Cebola" }] }] } }
    ]
  }
  ```
- **Regras**:
  - um `orderRestaurant` **por pessoa** (titular + acompanhantes selecionados);
  - `notificationTriggerTime` só serve para o texto da notificação local.
- **Resposta**: `NÃO CONFIRMADO`.
- **Efeitos**:
  - invalida `["bookingGastronomy", lodgingIdPms]`;
  - agenda uma notificação local às `16:00Z` do dia;
  - toast;
  - navega para `bookingGastronomyConfirmation`.
- **Erro**: mensagem genérica, sem ler o body (`services/gastronomy/index.ts:270-275`).
- Reuso: **NÃO via chat** (exige a seleção de pratos, ver 07).

#### E24 — `GET booking-restaurant/find-by-lodging-pms/:lodgingIdPms`

- **Resposta `IResponseBookingGastronomy[]`**: `{ id, situation: "aprovada" | "cancelada", date, obs, holderId, lodgingIdPms, restaurantId, timeRestaurantId, timeRestaurant: { description }, restaurant, orderRestaurant: [{ id, guestId, nameGuest, obs, json, menuOrder: [{ id, menuId, menu }] }] }`.
- **Pós-processamento**:
  - para cada reserva chama E18 (N+1) para resolver a categoria de cada prato;
  - **descarta reservas sem `orderRestaurant`**;
  - ordena por data decrescente.
- **Segurança**: o identificador vai no path. É preciso garantir que o servidor valida o `lodgingIdPms` contra o token (`NÃO CONFIRMADO`).
- Reuso: SIM, desde que o `lodgingIdPms` venha da sessão.

#### E25 — `PATCH booking-restaurant/update-situation-by-lodging-pms?lodgingIdPms=&restaurantId=`

- Body `{ "situation": "cancelada" }`.
- **Cancela por hospedagem + restaurante, não por id de reserva.** Se houver mais de uma reserva no mesmo restaurante, todas podem ser afetadas (`NÃO CONFIRMADO` no servidor). A atualização otimista do app muda todas (`services/gastronomy/index.ts:339-348`).
- Também cancela a notificação local pelo `restaurantId`.
- Reuso: COM RESSALVA (ver 07, risco R1).

#### E26 / E27 — edição de reserva

- E26: `PUT order-restaurant/:orderRestaurantId { menuIds, obs, json }`, uma chamada por pessoa.
- E27: `PATCH booking-restaurant/update-obs/:reservationId { obs }`. Só é chamado se a observação mudou.
- Só os pratos e as observações são editáveis. Data, hora e pessoas, não.
- **Janela**: `situation === "aprovada"` e `now < date + closure` (`screens/MyReservation/screens/Gastronomy.tsx:76-77`).
- Reuso: NÃO via chat (exige a tela de pratos).

### Experiências

#### E28 / E29 — `GET experience`, `GET experience/:id`

- **Lista `IResponseExperience`**: `{ id, situation, existsBooking: "sim" | "nao", order, minimumAge, requiresResponsible, minimumAgeAlone, title, description, logo, type: "reserva" | "allinclusive" }`.
- **Detalhe `IExperienceId`** (`types.d.ts:170-195`):
  ```json
  { "id": "uuid-exp", "title": "Passeio de barco", "description": "...", "text": "<p>html</p>", "obs": "Levar protetor",
    "logo": "logo.png", "image": "banner.jpg", "type": "reserva", "existsBooking": "sim", "repeat": false,
    "maxBookingHour": "17:00", "minimumAge": 6, "requiresResponsible": true, "minimumAgeAlone": 16,
    "link": null, "formId": "uuid-form",
    "form": { "id": "uuid-form", "type": "termo", "title": "Termo de risco", "text": "<p>...</p>", "signature": true, "situation": true },
    "experienceValue": [{ "price": "150.00", "chargeCategory": { "name": "Adulto" } }] }
  ```
- **Imagens**: logo em `${BUCKET}/experience/logos/<logo>`. O banner (`image`) existe só no detalhe.
- Reuso: SIM.

#### E30 — `POST experience-availability/find-availability`

- **Body** (`IBodyExperienceAvailability`):
  ```json
  { "dateStart": "2026-10-20", "dateEnd": "2026-10-25", "experienceId": "uuid-exp",
    "adultGuests": ["uuid-titular"], "childGuests": ["uuid-crianca"] }
  ```
- **Resposta `IResponseExperienceAvailability[]`**:
  ```json
  [{ "id": "uuid-av", "date": "2026-10-22", "adultVacancies": 4, "childVacancies": 2, "vacancies": 0, "experienceId": "uuid-exp",
     "isHour": 1, "hoursAvailabilities": [{ "id": "uuid-hora", "hour": "09:00", "situation": true, "adultVacancies": 4, "childVacancies": 2, "vacancies": 0 }] }]
  ```
- **Observações**:
  - é um POST, mas é uma leitura;
  - a separação adulto/criança é feita por idade ≥ 18 (`splitParticipantsByAge`, `src/utils/experienceAgeRules.ts:134`);
  - os erros usam as chaves padronizadas traduzidas por `translateExperienceBookingError` (`src/utils/experienceBookingErrors.ts`).
- Reuso: SIM.

#### E31 — `POST experience-booking`

- **Body `IBodyBookingExperience`** (`types.d.ts:229-251`):
  ```json
  { "date": "2026-10-22", "lodgingIdPms": 123456, "obs": "", "guestId": "uuid-titular-18+",
    "responsibleId": "uuid-resp-hospede", "experienceId": "uuid-exp", "phone": "11999998888",
    "experienceAvailabilityId": "uuid-av-ou-hora", "experienceHouryId": "uuid-hora",
    "expBookingGuests": [{ "guestId": "uuid-titular-18+" }, { "guestId": "uuid-crianca" }],
    "adultCompanions": 1, "childCompanions": 1 }
  ```
- **Resposta `IResponseBookingExperience`**: usa só o `id`.
- **Regras**:
  - `experienceAvailabilityId` é obrigatório (sem ele a API responde 400);
  - `experienceHouryId` só vai quando a disponibilidade é por hora;
  - `adultCompanions` / `childCompanions` são recalculados pelo servidor.
- **Encadeamento**: E31 → (se houver ficha ou termo) E32.
- Reuso: SIM, com confirmação (ver 07, fluxo T1).

#### E32 — `POST experience/sign`

- Body `{ guestId: titular, experienceId, experienceBookingId, formId, json?: { fieldId: valor } }`.
- Uma falha **não desfaz** a reserva: o app marca `signFailed` e orienta o hóspede a assinar presencialmente (`services/experience/index.ts:167-190`).
- `NÃO CONFIRMADO` se a rota existe em produção (`docs/expsign-yago-mobile-api.md` diz que ela precisa ser criada).

#### E33 — `GET experience-booking/find-by-lodging-pms/:lodgingIdPms`

- **Resposta**: `IResponseBookingExperience[]` com `situation: "pago" | "cancelado" | "pendente"`, `totalValue`, `phone`, `experience`, `experienceAvailability`, `experienceHouryId` e `expBookingGuests[{ guestId, name }]`.
- **Bug**: o sort compara `situation === "confirmado"`, que nunca ocorre (`services/experience/index.ts:250-254`).
- Reuso: SIM (`lodgingIdPms` vindo da sessão).

#### E34 — `PATCH experience-booking/update-situation/:reservationId`

- Body `{ "situation": "cancelado" }`.
- Oferecido quando `data/hora > agora && situation !== "cancelado"` (`screens/MyReservation/screens/Experiences.tsx:80`). Se não há hora, o app assume 15:00 (`MyReservation/actions.ts:83-87`).
- Também cancela a notificação local.
- Reuso: SIM, com confirmação.

### Eventos, favoritos e notificações

#### E35 — `GET event?dateStart=YYYY-MM-DD&dateEnd=YYYY-MM-DD`

- **Resposta `IResponseEvents[]`**:
  ```json
  [{ "id": "uuid-ev", "title": "Show acústico", "description": "...", "date": "2026-10-22T22:00:00.000Z",
     "situation": true, "locationId": "uuid-loc", "location": { "name": "Lounge" }, "galleries": [{ "id": "g1", "image": "https://...", "eventId": "uuid-ev" }] }]
  ```
- `date` é um ISO com hora. A exibição usa o fuso do aparelho (ver 03, §Datas).
- **Não há endpoint de detalhe**: o detalhe é o próprio item da lista.
- Reuso: SIM.

#### E36–E39 — `notification`

- **E36 `GET notification`**: `IResponseNotifcation[] { id, read, createdAt, eventType: "gastronomia" | "evento" | "experiencia", eventId, guestId }`.
- **E37 `POST notification`**:
  - body `{ event: <IResponseEvents completo>, eventType: "evento", eventId }`;
  - **é assim que o "favoritar evento" é implementado** (`screens/Events/components/CardEvent.tsx:116-151`);
  - agenda uma notificação local 1 h antes do evento.
- **E38 `PATCH notification/:id { read: true }`**: marca como lida ao fechar o painel do Header.
- **E39 `DELETE notification/:id`**: "desfavoritar".
- **Reuso**:
  - E36 e E39: SIM;
  - E37: COM RESSALVA (o body carrega o evento inteiro, e o lembrete local não seria agendado se a ação vier do servidor).

### Catálogos informativos

| # | Resposta | Pós-processamento no app |
|---|---|---|
| E40 | `IResponseBoutiqueCategory[] { id, name, priority, status }` | `status === 1`, ordenado por `priority` |
| E41 | `IResponseBoutiqueProduct[] { id, name, description, price: string, status, productCategoryId, productGalleries[{ image }] }` | `status === 1` |
| E42 | `IResponseSpa { id, description, observation, link, image }` | `link` = contato por WhatsApp via `Linking.openURL` (`screens/SPA/actions.ts:19-28`) |
| E43 + E44 | `IResponseSpaCategory[] { id, order, title, image, situation }` + `IResponseSpaService[] { id, order, situation, title, description, value, time, spaCategoryId }` | app junta por `spaCategoryId` e descarta categorias vazias ou `order <= 0` |
| E45 | `IResponseEsg { id, title, description, image }` | — |
| E46 / E47 | `IResponseEsgPartner[]` / `IResponseEsgInitiative[] { id, icon/image, link, priority, status }` | o link abre na WebView |
| E48 | `IResponseTip[] { id, title, image, tipItems[{ title, description, order, situation }] }` | **só `tip[0]` é exibido** |
| E49 | `IResponseForm { id, title, text (HTML), type: "termo" \| "ficha", signature, situation, fields[{ id, title, type: "texto" \| "data" \| "numero" \| "condicional", situation }] }` | `getSignatureForm` devolve `null` se `situation` for falsy |

Todos: Reuso SIM (READ), salvo E49 (apoio a fluxos transacionais).

### Quiz (E50–E56)

Detalhes em `src/services/quiz/types.ts:180-266`.

| # | Resposta / regra |
|---|---|
| E50 | `{ total, items: IQuiz[] }`; cada item tem `mode` (`live` / `async`), `requiresPin`, `sessionStatus`, `participationScope`, `quizTheme` |
| E51 | Detalhe com `questions[].choices{ id, order, text }`, **sem a resposta correta** |
| E52 | Body `{ quizId, pin?, nickname, guestId? }`; resposta `IParticipationStateDTO`. Uma participação por (quiz, hóspede) |
| E53 | 404 = não jogou |
| E54 | Body `{ participationId, guestId?, questionId, choiceId }`; resposta `{ correct, correctChoiceId, selectedChoiceId, pointsEarned, totalScore }` |
| E55 | `{ finished, question?, result? }` |
| E56 | `{ me, finalLeaderboard, completedAt }` |

**Divergência**: a pasta `api/quiz/` (spec) está desatualizada em relação ao código (rotas `/quiz/:id/participations`, `choiceIndex`, eventos `room:*`). Vale o código.

**Reuso**: NÃO para a LLM gerar ou ler respostas. Apenas READ de E50 e E56 para cards; o jogo continua na tela ou num widget dedicado (ver 05 e 07).

---

## Endpoints usados por mais de uma tela

| Endpoint | Telas e propósito |
|---|---|
| E16 `restaurant` | Gastronomia (lista), Header (resolver notificações `gastronomia`), Home (prefetch), concierge (cards). |
| E33 `experience-booking/find-by-lodging-pms` | MyReservation, Booking Details (bloqueia quem já reservou), Home e Header (notificações). |
| E35 `event` | Events (7 dias a partir de hoje, UTC); Home, Header e MyFavorites usam a janela **do check-in até hoje+6** (`MyFavorites/actions.ts:26-56`). São queryKeys diferentes para o mesmo endpoint. |
| E14 `leisure/sign` | Leisure (elegibilidade), Signature (já inscritos), MyRequests (histórico). |
| E06 `department` | Requests (formulário) e MyRequests (nome e logo do departamento no card). |
| E49 `form/:id` | Termo de Lazer (Signature/Terms) e termo/ficha de Experiência (Booking Terms/Form). |

## Endpoints inexistentes que fariam falta

Não há nenhum endpoint, no app, para:

- **dados do hóspede a partir do token** (`/me`): o contexto vem só da resposta do login;
- detalhe de evento;
- detalhe de solicitação;
- detalhe de reserva por id;
- histórico de quiz;
- agendamento de SPA;
- compra na boutique;
- logout ou revogação de token.
