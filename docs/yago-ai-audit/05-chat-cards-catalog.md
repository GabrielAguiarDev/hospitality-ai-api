# 05 — Catálogo de cards do chat

## 1. O que já existe (base obrigatória)

### Contrato da Yago AI API (`src/services/concierge/chatApi.types.ts`)

```ts
type ChatAction = NavigateAction | ExperienceBookingCardAction | ExperienceOptionsAction

interface ChatResponse {
  reply: string
  conversationId: string
  assistantMessageId?: number
  retrievedSources: RetrievedSource[]
  actions: ChatAction[]
}
```

| Ação | Uso atual | Componente |
|---|---|---|
| `navigate { label, screen, params: { restaurantId? } }` | Botão "Abrir Gastronomia" | `screens/Concierge/components/ChatActionCard.tsx:170-183,325`; lista permitida em `screens/Concierge/chatScreenRoutes.ts` (só `Gastronomy`) |
| `experience.booking.card { cardId, status, summary, notes, expiresAt, booking, reason, confirm, cancel, updatedAt }` | Pré-reserva com Confirmar/Descartar. Um mesmo `cardId` é atualizado no lugar | `ChatActionCard.tsx`; merge em `services/concierge/actionItems.ts:57-114` |
| `experience.options { label, date, options[{ position, experienceId, title, times, message }] }` | Carrossel numerado: tocar envia "Opção N" | `components/ExperienceOptions.tsx`; `services/concierge/catalogCards.ts:76-103` |

**Regras já implementadas no app que o novo contrato deve preservar:**

- **Tipos desconhecidos são descartados** em `chatApi.ts:76-81` (`KNOWN_ACTION_TYPES`). Isso garante a **compatibilidade para trás**: um servidor novo não quebra um app antigo.
- O card de reserva é **idempotente por `cardId`**: uma atualização mais antiga (`updatedAt`) é ignorada, e uma resposta atrasada não reabilita os botões (`actionItems.ts:57-66`).
- Uma lista de opções nova **inativa** as anteriores (`actionItems.ts:100-111`).
- O histórico (`GET /chat/:id/messages`) reconstrói os cards pelo mesmo ponto de entrada (`rebuildHistory`).
- Imagem e descrição **vêm do catálogo do app** pelo id (`useCatalogExperiences`, `useCatalogRestaurants`). O servidor manda só o id e o título.

### Card genérico do concierge local (`services/concierge/types.ts:23-60`)

```ts
ConciergeCard {
  id
  category: "experiencia" | "gastronomia" | "evento" | "lazer"
  variant?: "item" | "more"
  title
  description
  imageUrl
  meta: { date?, time?, location?, price?, capacity? }
  action: { type: "reservar" | "favoritar" | "inscrever" | "navegar" | "detalhar", label }
  navigation?
  prompt?
  state
}
```

O componente é `screens/Concierge/components/ConciergeCard.tsx`, com carrossel em `CardCarousel.tsx`.

> Hoje `reservar`, `favoritar` e `inscrever` são **mocks** no concierge local (`screens/Concierge/actions.ts:224-300`, com `TODO(backend)`). Nenhum chama a API oficial.

### Cards das telas que podem ser reaproveitados visualmente

| Componente | Arquivo | Dados |
|---|---|---|
| `CardRestaurant` | `screens/Gastronomy/components/CardRestaurant.tsx` | `IResponseRestaurant` |
| `CardExperience` | `screens/Experiences/components/CardExperience.tsx` | `IResponseExperience` |
| `CardEvent` (inclui botão de favoritar) | `screens/Events/components/CardEvent.tsx` | `IResponseEvents` |
| `CardDepartment` / `CardSubscription` | `screens/MyRequests/components/*` | `IResponseOrderDepartment`, `IResponseLeisureSubscription` |
| `CardMenu` (departamento) | `screens/Requests/components/CardMenu.tsx` | `IDepartment` |
| `CardInfo` (lazer) | `screens/Leisure/components/CardInfo.tsx` | `IResponseLeisureInfo` |
| `CollapsibleCard` | `components/CollapsibleCard` | genérico (usado no SPA) |

---

## 2. Proposta de evolução do contrato

**Estratégia:** acrescentar tipos à união `ChatAction`, sem alterar os existentes. Os princípios são:

- **um tipo genérico de lista de catálogo**, em vez de um tipo por módulo, para manter a união pequena e combinar com o `ConciergeCard` já genérico;
- **um tipo genérico de operação**, que generaliza o ciclo de vida do `experience.booking.card`;
- **o `navigate` existente, com mais telas na lista permitida**;
- **os dados de exibição vêm do resultado da tool.** O app completa com o próprio catálogo quando tiver.

```ts
// NOVO — proposta, não implementado
type ChatAction =
  | NavigateAction                       // existente, telas ampliadas (06)
  | ExperienceBookingCardAction          // existente
  | ExperienceOptionsAction              // existente
  | CatalogListAction                    // novo
  | MenuAction                           // novo
  | BookingListAction                    // novo
  | RequestListAction                    // novo
  | OperationCardAction                  // novo (generaliza a pré-reserva)
  | FavoriteChangedAction                // novo (sincroniza o cache e o lembrete local)

interface CatalogListAction {
  type: "catalog.list"
  label: string
  kind: "restaurant" | "experience" | "event" | "leisure" | "spa_service" | "product" | "tip" | "esg"
  items: CatalogItem[]
}

interface CatalogItem {
  id: string                 // id real da entidade
  title: string
  description: string | null
  imageUrl: string | null    // URL absoluta montada pelo servidor (BUCKET + pasta), ou null
  meta: {
    date?: string            // AAAA-MM-DD local do resort
    time?: string            // HH:MM ou lista "19:00, 19:30"
    startsAt?: string        // ISO com offset
    location?: string
    price?: string           // texto já formatado (BRL)
    duration?: string
    ageRange?: string
  }
  badges?: string[]          // ex.: "Incluso", "Taxa extra", "Já reservado", "Favorito"
  primary?: CardButton
  secondary?: CardButton
}

type CardButton =
  | { kind: "navigate"; label: string; navigate: Omit<NavigateAction, "type" | "label"> }
  | { kind: "message"; label: string; message: string }          // como experience.options
  | { kind: "action"; label: string; request: ChatActionRequest }  // favoritar etc.

interface OperationCardAction {
  type: "operation.card"
  cardId: string                         // = previewId
  operation: "request.create" | "request.cancel" | "experience.booking.cancel"
           | "restaurant.booking.cancel" | "leisure.enrollment.cancel"
  status: BookingCardStatus              // reaproveita o tipo existente
  label: string
  summary: { title: string; lines: { label: string; value: string }[] }
  notes: string[]
  expiresAt: string | null
  result: { id: string } | null
  reason: string | null
  confirm: { method: "POST"; path: "/chat/actions"; body: ChatActionRequest } | null
  cancel:  { method: "POST"; path: "/chat/actions"; body: ChatActionRequest } | null
  updatedAt: string
}
```

**`ChatActionRequestType` passaria a incluir:**

- `"operation.confirm"` e `"operation.cancel"`;
- `"favorite.add"` e `"favorite.remove"`.

**Mudanças necessárias no app** (quando for implementar):

1. Incluir os novos tipos em `KNOWN_ACTION_TYPES`.
2. Generalizar `mergeBookingCard` para `operation.card`, com o mesmo `cardId` e a mesma regra de `updatedAt`.
3. Mapear `CatalogItem` para `ConciergeCard` num `catalogCards.ts` estendido.
4. Ampliar `CHAT_SCREEN_ROUTES`.

---

## 3. Catálogo de cards

Valores comuns a todos os cards, salvo quando indicado:

- **Loading**: skeleton do carrossel.
- **Vazio**: texto do `reply`, sem card.
- **Erro**: o card não é exibido (o erro vai no `reply`).
- **Imagem com falha**: imagem local de fallback, como já faz o `ConciergeCard`.

---

### C01 `restaurant`

- **Ação**: `catalog.list`, kind `restaurant`.
- **Objetivo**: listar restaurantes e bares (T02, T03, T05).
- **Obrigatórios**: `id`, `title`.
- **Opcionais**: `description`, `meta.time`, `meta.location`, `badges`.
  - `meta.time` vem dos turnos ou de `operation`.
  - Exemplos de badge: "Aceita reserva", "Já reservado", "A partir de 12 anos".
- **Imagem**: `${BUCKET}/restaurant/<image>`.
- **Botões**:
  - aceita reserva: "Reservar" → navigate `Gastronomy {restaurantId}`;
  - não aceita: "Ver cardápio" → navigate `Restaurant {restaurantId}`.
- **Tipos reutilizáveis**: `IResponseRestaurant`, `restaurantCard()` (`catalogCards.ts:31-49`).
- **Regras de exibição**:
  - nunca mostrar "Reservar" quando `existsBooking !== "sim"`;
  - com reserva aprovada, trocar o botão por "Ver minha reserva".

### C02 `menu`

- **Ação**: `menu.view` (novo).
- **Formato**: `{ restaurantId, restaurantName, categories: [{ id, name, dishes: DishItem[] }] }`.
- **Objetivo**: mostrar o cardápio no chat em accordion (T04).
- **Botão**: "Abrir no app" → navigate `Restaurant {restaurantId}`.
- **Vazio**: "Cardápio não cadastrado".
- **Regra**: o limite de pratos por categoria no chat (sugestão: 5) leva a "ver tudo".

### C03 `dish`

- Item de C02: `{ id, name, description, serves, imageUrl, removableIngredients[] }`.
- **Imagem**: `${BUCKET}/menu/<image>`.
- **Exibição**: se `serves > 1`, mostrar o selo "Serve N pessoas" (R-GAS-10).
- **Sem botão de pedir**: pratos só são escolhidos na tela de reserva.

### C04 `experience`

- **Ações**: `catalog.list` kind `experience`, ou as existentes `experience.options` e `experience.booking.card`.
- **Obrigatórios**: `id`, `title`.
- **Opcionais**:
  - `meta.time` (horários com vaga);
  - `meta.price` ("A partir de R$ X", de `experienceValue`);
  - `meta.ageRange`;
  - `badges`: "Incluso", "Taxa extra", "Termo de risco".
- **Imagem**: logo `${BUCKET}/experience/logos/<logo>` na lista; banner no detalhe.
- **Botões**:
  - "Ver detalhes" (message, como hoje);
  - "Reservar" (message, que leva o servidor a T11);
  - "Abrir no app" → navigate `Experience {experienceId}`.
- **Tipos reutilizáveis**: `IResponseExperience`, `experienceCard()`, `experienceOptionCard()`.

### C05 `event`

- **Ação**: `catalog.list`, kind `event`.
- **Obrigatórios**: `id`, `title`, `meta.startsAt`.
- **Opcionais**: `description`, `meta.location`, `imageUrl` (`galleries[0].image`, URL absoluta).
- **Datas**: exibir no fuso do resort.
  - O servidor manda `meta.date` e `meta.time` já locais.
  - O app não deve reconverter (R-DT-01).
- **Botões**:
  - "Favoritar" ou "Remover dos favoritos" (action `favorite.add`/`favorite.remove`);
  - "Ver local" → navigate `Map`.
- **Estado**: `badges: ["Favorito"]`.
- **Tipos reutilizáveis**: `IResponseEvents`, layout do `CardEvent`.

### C06 `leisure_activity`

- **Ação**: `catalog.list`, kind `leisure`.
- **Obrigatórios**: `id`, `title`, `meta.date`, `meta.time`.
- **Opcionais**: `meta.location`, `meta.ageRange`, `badges` (categoria).
- **Botões**:
  - "Inscrever" → navigate `Leisure`;
  - "Ver local" → navigate `Map`.
- **Regra**: não mostrar "Inscrever" quando a categoria não tem ficha ativa.

### C07 `spa_service`

- **Ação**: `catalog.list`, kind `spa_service`.
- **Obrigatórios**: `id`, `title`.
- **Opcionais**: `description`, `meta.price` (`value`), `meta.duration` (`time`), `badges` (categoria).
- **Botões**:
  - "Falar com o SPA" (link externo do `spa.link`): exige o tipo de botão `open_url`, com lista de domínios permitidos, ou navigate `Spa`;
  - "Ver SPA" → navigate `Spa`.
- **Regra**: **nunca** usar "Agendar".

### C08 `product`

- **Ação**: `catalog.list`, kind `product`.
- **Campos**: `title`, `description`, `meta.price` (formatado BRL a partir de `price` string), `imageUrl` (1ª de `productGalleries`).
- **Botão**: "Ver na boutique" → navigate `Boutique`.
- **Regra**: nenhum botão de compra.

### C09 `request_item` (seleção de item)

- **Ação**: `catalog.list`, kind `request_item` (variação a incluir no enum).
- **Objetivo**: quando "quero toalhas" corresponde a vários itens, listar as opções.
- **Campos**: `title` (item), `badges` (departamento, item pai).
- **Botão**: message "Quero <item>", que leva o servidor a T21.

### C10 `request` (resumo de criação)

- Implementado via **C16** com `operation: "request.create"`.
- **Linhas**: Departamento, Itens, Observação.

### C11 `request.status`

- **Ação**: `request.list` (novo): `{ items: [{ id, kind: "department" | "leisure", title, items[], status, statusLabel, createdAt, attendedAt?, note?, canCancel }] }`.
- **Status e cores** (as mesmas de `CardDepartment` / `CardSubscription`):
  - verde: `atendida`, `aprovado`;
  - laranja: `pendente`, `executando`;
  - vermelho: `cancelada`, `negado`.
- **Botões**:
  - "Cancelar", se `canCancel` (action, que leva a T23/T27 e depois a C16);
  - "Ver todas" → navigate `MyRequests`.
- **Vazio**: "Você não tem solicitações".

### C12 `booking`

- **Ação**: `booking.list` (novo): `{ items: [{ bookingId, kind: "restaurant" | "experience", title, date, time, status, statusLabel, people[], totalValue?, canCancel, canEdit }] }`.
- **Imagem**: imagem do restaurante ou logo da experiência, resolvidas pelo app via catálogo.
- **Botões**:
  - "Ver detalhes" → navigate `MyReservation {tab}`;
  - "Cancelar" (`canCancel`, leva a C16);
  - "Editar pratos" (`canEdit`, restaurante) → navigate `MyReservation {tab: "Gastronomy"}`.
- **Status**:
  - `pago`/`aprovada` → "Confirmada";
  - `pendente` → "Pendente";
  - cancelado → "Cancelada".
- **Vazio**: "Você não tem reservas".

### C13 `favorite`

- É o C05 com o badge "Favorito" e o botão "Remover".
- **Lista**: `catalog.list` kind `event` + `label: "Seus favoritos"`.

### C14 `tip`

- **Ação**: `catalog.list`, kind `tip`.
- **Campos**: `title`, `description`, `imageUrl` (`${BUCKET}/tip/<image>`).
- **Botão**: navigate `Tips`.

### C15 `esg`

- **Ação**: `catalog.list`, kind `esg`.
- **Campos**: `title`, `description`, `imageUrl`.
- **Iniciativas e parceiros**: imagem + botão `open_url` (WebView) com o `link`.
- **Regra**: sem descrição inventada. Iniciativas não têm texto na API.

### C16 `operation.confirm` / `operation.result`

- **Ação**: `operation.card` (novo).
- **Objetivo**: preview de qualquer operação transacional diferente de reserva de experiência, mais o resultado.
- **Estados**:

  | Estado | Origem | Exibição |
  |---|---|---|
  | `preview` | servidor | Confirmar / Descartar; `expiresAt` |
  | `confirming` | app (local) | spinner e botões travados |
  | `confirmed` | servidor | `result.id` + mensagem de sucesso |
  | `failed`, `expired` | servidor | `reason` |
  | `cancelled` | servidor | descartado |

- **Regras de exibição**:
  - **valores, datas e pessoas aparecem no resumo antes de confirmar**;
  - nunca reenviar parâmetros, só o `body` recebido (`chatApi.ts:110`).
- **Tipos reutilizáveis**: `BookingCardStatus`, `ChatActionPending`, `mergeBookingCard`.

### C17 `quiz`

- **Ação**: `catalog.list`, kind `quiz` (variação a incluir).
- **Campos**: `title`, `badges` (tema, "Ao vivo", "Já participou").
- **Botão**: navigate `Quiz`.
- **Regra**: **não** renderizar perguntas pelo contrato do chat.
  - Se o produto quiser o quiz dentro do chat, isso deve ser um widget nativo que consome `useQuizSession` diretamente (E50–E56 / socket), fora do fluxo da LLM.
  - Condições do widget: o hook vive no nível da tela de chat, o timer vem do servidor e as bolhas antigas ficam somente leitura (ver 07, §T-QZ).

---

## 4. Exemplo de resposta (proposta)

```json
{
  "reply": "Hoje à noite teremos 2 eventos:",
  "conversationId": "…",
  "retrievedSources": [],
  "actions": [
    {
      "type": "catalog.list",
      "label": "Eventos de hoje",
      "kind": "event",
      "items": [
        { "id": "uuid-ev", "title": "Show acústico", "description": "…", "imageUrl": "https://…",
          "meta": { "date": "2026-10-28", "time": "20:00", "startsAt": "2026-10-28T20:00:00-03:00", "location": "Lounge" },
          "badges": [],
          "primary": { "kind": "action", "label": "Favoritar", "request": { "type": "favorite.add", "conversationId": "…", "previewId": "…" } },
          "secondary": { "kind": "navigate", "label": "Ver local", "navigate": { "screen": "Map", "params": { "locationId": "uuid-loc" } } } }
      ]
    }
  ]
}
```

> `favorite.add` reutiliza `ChatActionRequest { type, conversationId, previewId }`. O servidor guarda qual evento corresponde ao `previewId`, e o cliente nunca envia o `eventId`. Isso segue o padrão existente.
