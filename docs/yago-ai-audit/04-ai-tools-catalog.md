# 04 — Catálogo proposto de tools (yago-ai-api / NestJS)

> **Nenhuma destas tools existe hoje.** Esta é uma proposta. Os schemas descrevem o **contrato da tool** (LLM ↔ backend), e não os contratos atuais da API oficial. Os campos de saída vêm sempre de respostas reais (`E##` no [02](02-api-endpoints-inventory.md)). Quando a saída é derivada ou renomeada, isso está indicado.

## Princípios

1. **Contexto injetado, nunca pedido ao LLM.** Toda tool recebe implicitamente um `ctx` montado pelo servidor a partir da sessão:

   ```json
   {
     "guestHolderId": "...",
     "companions": [{ "id": "...", "name": "..." }],
     "lodgingIdPms": 0,
     "stay": { "checkin": "YYYY-MM-DD", "checkout": "YYYY-MM-DD" },
     "responsibleId": "...",
     "token": "<jwt>",
     "tz": "America/Sao_Paulo",
     "language": "pt"
   }
   ```

   Nenhum schema de entrada abaixo contém esses campos.
2. **Pessoas por referência.** O LLM diz `participants: ["Ana", "titular"]` ou `participantRefs: [1, 2]`. O servidor resolve contra `ctx.companions`. Se o nome for ambíguo, a tool devolve um erro `AMBIGUOUS_GUEST` com as opções.
3. **IDs de catálogo só de saídas anteriores.** Um `experienceId` ou `restaurantId` só é aceito se existir no catálogo. A resolução por nome (`query`) é feita pelo servidor (fuzzy match), com retorno `NOT_FOUND` ou `AMBIGUOUS`.
4. **Transacional = preview + confirmação.** Tools `*.prepare*` devolvem um `previewId`. A execução só acontece via `POST /chat/actions` (botão) ou pela regra de confirmação textual já existente. **O LLM nunca chama `*.execute`.** A execução é do servidor, disparada pela ação do usuário.
5. **Saída sempre com `cards[]`.** Os cards são construídos **a partir do resultado da tool** (ver [05](05-chat-cards-catalog.md)), nunca a partir do texto do LLM.

### Níveis de confirmação

| Nível | Quando |
|---|---|
| `NONE` | Leitura. |
| `LIGHT` | Reversível e sem custo (favorito). O LLM executa e responde com um card que permite desfazer. |
| `EXPLICIT` | Preview + botão Confirmar + idempotência por `previewId`. |
| `SCREEN` | Não executável pelo chat. Devolve `navigate`. |

### Status de viabilidade

| Status | Significado |
|---|---|
| `PRONTA` | O endpoint existe e as regras são conhecidas. Depende só da autenticação real. |
| `PRONTA*` | Exige reimplementar regras que hoje estão só no app. |
| `LACUNA` | Exige um endpoint ou uma correção no backend oficial. |
| `NÃO RECOMENDADA` | Não deve ser oferecida pelo chat. |

### Tipos comuns (saída)

```ts
type ToolError = { code: "NOT_FOUND"|"AMBIGUOUS"|"AMBIGUOUS_GUEST"|"NOT_ELIGIBLE"|"UNAVAILABLE"|"OUT_OF_WINDOW"|"ALREADY_BOOKED"|"NOT_CANCELLABLE"|"UPSTREAM_ERROR"|"STAY_INACTIVE"; message: string; options?: {id: string; label: string}[] }
type ToolResult<T> = { ok: true; data: T; cards?: CardRef[] } | { ok: false; error: ToolError }
type CardRef = { kind: string; id: string }   // o servidor hidrata o card (05)
```

---

## Índice

| # | Tool | Módulo | Tipo | Confirmação | Viabilidade | Prioridade |
|---|---|---|---|---|---|---|
| T01 | `guest.getStayContext` | Contexto | READ | NONE | LACUNA (G1) | P0 |
| T02 | `restaurants.list` | Gastronomia | READ | NONE | PRONTA* | P0 |
| T03 | `restaurants.getDetails` | Gastronomia | READ | NONE | PRONTA | P0 |
| T04 | `restaurants.getMenu` | Gastronomia | READ | NONE | PRONTA | P0 |
| T05 | `restaurants.checkAvailability` | Gastronomia | READ | NONE | PRONTA* | P0 |
| T06 | `restaurants.startBooking` | Gastronomia | NAVIGATION | SCREEN | PRONTA | P0 |
| T07 | `experiences.list` | Experiências | READ | NONE | PRONTA | P0 |
| T08 | `experiences.getDetails` | Experiências | READ | NONE | PRONTA | P0 |
| T09 | `experiences.checkEligibility` | Experiências | READ | NONE | PRONTA* | P0 |
| T10 | `experiences.checkAvailability` | Experiências | READ | NONE | PRONTA | P0 |
| T11 | `experiences.prepareBooking` | Experiências | TRANSACTIONAL | EXPLICIT | PRONTA* (+ termo: SCREEN) | P0 |
| T12 | `bookings.listMine` | Minhas Reservas | READ | NONE | PRONTA | P0 |
| T13 | `bookings.getDetails` | Minhas Reservas | READ | NONE | PRONTA (via lista) | P0 |
| T14 | `bookings.prepareCancelExperience` | Minhas Reservas | TRANSACTIONAL | EXPLICIT | PRONTA* | P1 |
| T15 | `bookings.prepareCancelRestaurant` | Minhas Reservas | TRANSACTIONAL | EXPLICIT | LACUNA (G4) | P2 |
| T16 | `bookings.editRestaurantDishes` | Minhas Reservas | NAVIGATION | SCREEN | PRONTA | P2 |
| T17 | `events.list` | Eventos | READ | NONE | PRONTA | P0 |
| T18 | `events.getDetails` | Eventos | READ | NONE | PRONTA (via lista) | P1 |
| T19 | `requests.listDepartments` | Solicitações | READ | NONE | PRONTA | P0 |
| T20 | `requests.findItems` | Solicitações | READ | NONE | PRONTA | P0 |
| T21 | `requests.prepareCreate` | Solicitações | TRANSACTIONAL | EXPLICIT | PRONTA* | P0 |
| T22 | `requests.listMine` | Minhas Solicitações | READ | NONE | PRONTA | P0 |
| T23 | `requests.prepareCancel` | Minhas Solicitações | TRANSACTIONAL | EXPLICIT | PRONTA | P1 |
| T24 | `leisure.listActivities` | Lazer | READ | NONE | PRONTA* | P1 |
| T25 | `leisure.getCategoryInfo` | Lazer | READ | NONE | PRONTA | P1 |
| T26 | `leisure.startEnrollment` | Lazer | NAVIGATION | SCREEN | PRONTA | P1 |
| T27 | `leisure.prepareCancelEnrollment` | Minhas Solicitações | TRANSACTIONAL | EXPLICIT | PRONTA | P2 |
| T28 | `favorites.list` | Favoritos | READ | NONE | PRONTA | P1 |
| T29 | `favorites.addEvent` | Favoritos | WRITE | LIGHT | LACUNA (G6: lembrete) | P1 |
| T30 | `favorites.remove` | Favoritos | WRITE | LIGHT | PRONTA | P1 |
| T31 | `spa.listServices` | SPA | READ | NONE | PRONTA | P1 |
| T32 | `boutique.listProducts` | Boutique | READ | NONE | PRONTA | P2 |
| T33 | `esg.getContent` | ESG | READ | NONE | PRONTA (+RAG) | P2 |
| T34 | `tips.list` | Dicas | READ | NONE | PRONTA (+RAG) | P2 |
| T35 | `quiz.list` | Quiz | READ | NONE | PRONTA | P3 |
| T36 | `navigation.open` | Navegação | NAVIGATION | SCREEN | PRONTA (app precisa ampliar a lista permitida) | P0 |

**Total: 36 tools.**

| Tipo | Quantidade |
|---|---|
| Leitura | 24 |
| Transacionais com preview | 6 |
| WRITE de baixo impacto | 2 |
| Navegação | 4 |

**Tools descartadas de propósito:**

- `restaurants.createBooking` (seleção de pratos, ver 07 T-GAS);
- `leisure.createEnrollment` direto (ficha e termo dinâmicos);
- `spa.book` e `boutique.buy` (sem API);
- `quiz.answer` (anti-cheat);
- qualquer `http.request` genérico.

---

## Fichas

Formato de cada ficha:

- **Intenções**: o que a tool atende.
- **Entrada** e **Saída**: JSON Schema resumido.
- **Endpoints** e **Contexto**: o que a tool consome.
- **Regras** e **Erros**.
- **Cards** e **Lacunas**.

Permissão padrão: sessão válida com hospedagem ativa (R-CTX-07). Efeitos colaterais: nenhum, salvo quando indicado.

### T01 `guest.getStayContext`

- **Descrição**: dados da estadia para personalizar respostas.
- **Intenções**:
  - "quando é meu checkout?"
  - "quem está na minha reserva?"
  - "qual meu quarto?"
- **Entrada**: `{}`.
- **Saída**:

  ```json
  {"holder":{"firstName":"string","isAdult":true},"companions":[{"ref":1,"firstName":"string","isAdult":false,"ageYears":7}],"uh":"string","checkin":"YYYY-MM-DD","checkout":"YYYY-MM-DD","nights":0}
  ```

  - Derivado de `IUser`.
  - **Não** expõe `birthDate` completo nem ids ao LLM.
- **Endpoints**: nenhum hoje.
  - O contexto só existe no login (E01).
  - Exige um endpoint `/me` ou introspecção do token (09, G1).
- **Erros**: `STAY_INACTIVE`.
- **Cards**: nenhum (texto).

### T02 `restaurants.list`

- **Intenções**:
  - "quais restaurantes estão disponíveis?"
  - "tem bar?"
  - "onde posso comer?"
- **Entrada**:

  ```json
  {"type":{"enum":["restaurante","bar","alimentacao"]},"acceptsBooking":{"type":"boolean"}}
  ```

  Todos os campos são opcionais.
- **Saída**:

  ```json
  [{"id","name","description","type","acceptsBooking":"existsBooking==='sim'","hours":"timeRestaurant[].description|operation","location":"location.name","minimumAge","imageUrl"}]
  ```
- **Endpoints**: E16 (cache de 30 min).
- **Regras**:
  - R-GAS-01: `situation && order>0 && noites >= minimumDaily`, usando `ctx.stay`;
  - R-GAS-02;
  - R-GAS-04.
- **Cards**: `restaurant` (lista/carrossel).

### T03 `restaurants.getDetails`

- **Entrada**:

  ```json
  {"restaurantId":"string?","query":"string?"}
  ```

  Um dos dois é obrigatório.
- **Saída**: os campos de T02 + `closure`, `minimumDaily`, `link`, `shifts`.
  - `shifts`: `[{id, label}]`, com `label` vindo de `timeRestaurant`.
- **Endpoints**: E17.
- **Erros**: `NOT_FOUND`, `AMBIGUOUS`.
- **Cards**: `restaurant`.

### T04 `restaurants.getMenu`

- **Intenções**:
  - "mostre o cardápio do italiano"
  - "o que tem de sobremesa?"
  - "esse prato serve quantas pessoas?"
- **Entrada**:

  ```json
  {"restaurantId":"string","categoryQuery":"string?"}
  ```
- **Saída**:

  ```json
  {"categories":[{"id","name","parentId":"referenceId","dishes":[{"id","name","description","serves","imageUrl","removableIngredients":["menuItem[].name"]}]}]}
  ```
- **Endpoints**:
  - E18;
  - E19 × N categorias (N+1, com cache no servidor recomendado).
- **Regras**:
  - filtros `situation && order>0`;
  - `menuItem` = ingredientes removíveis (R-GAS-12);
  - **não** inventar restrições alimentares.
- **Cards**: `menu` (categorias) e `dish`.
- **Lacunas**: o E20 (seções) não é usado. Validar com o backend se as seções deveriam agrupar o cardápio.

### T05 `restaurants.checkAvailability`

- **Intenções**:
  - "tem mesa amanhã à noite no X?"
  - "quais horários livres hoje?"
- **Entrada**:

  ```json
  {"restaurantId":"string","date":"YYYY-MM-DD?","partySize":"integer?"}
  ```
- **Saída**:

  ```json
  {"dates":[{"date","slots":[{"timeRestaurantId","hour","isAvailable","vacancies"}],"bookable":"boolean"}]}
  ```
- **Endpoints**: E22, com `dateCheckin/dateCheckout` = `ctx.stay` e `numberOfGuests`.
- **Regras**:
  - R-GAS-07: data + `closure` > agora; horário de hoje que já passou fica bloqueado;
  - R-GAS-06: a tool deve consultar E24 e indicar `alreadyBooked`;
  - `existsBooking !== 'sim'` → `UNAVAILABLE` com motivo.
- **Lacuna**: `numberOfGuests`. O app envia o tamanho da hospedagem (R-GAS-13). Decidir se a IA envia `partySize` real; o comportamento no servidor está NÃO CONFIRMADO.
- **Cards**: `restaurant` com horários.

### T06 `restaurants.startBooking`

- **Intenções**:
  - "quero reservar no X"
  - "reserva para 2 amanhã"
- **Entrada**:

  ```json
  {"restaurantId":"string?"}
  ```
- **Saída**: `navigate`.
  - Com id: `{screen: "Gastronomy", params: {restaurantId}}` → `bookingGastronomyDetails`.
  - Sem id: abre a lista.
  - É o comportamento que já existe (`chatScreenRoutes.ts:12-16`).
- **Regras**: só restaurantes com `existsBooking === "sim"`. Antes, avisar se já há reserva (R-GAS-06).
- **Por que SCREEN**: ver 07, T-GAS.

### T07 `experiences.list`

- **Intenções**:
  - "quais experiências?"
  - "o que tem incluso?"
  - "atividades com taxa extra"
- **Entrada**:

  ```json
  {"type":{"enum":["reserva","allinclusive"]},"date":"YYYY-MM-DD?"}
  ```
- **Saída**:

  ```json
  [{"id","title","description","type","acceptsBooking","minimumAge","logoUrl"}]
  ```
- **Endpoints**: E28. Com `date`, combinar com T10 por item.
  - É o mesmo comportamento atual de `experience.options`.
- **Regras**: R-EXP-01 e R-EXP-02.
- **Cards**: `experience` / `experience.options`, que já existem.

### T08 `experiences.getDetails`

- **Saída**: T07 + campos do detalhe.

  ```json
  {"text":"html→texto","obs","imageUrl","prices":[{"category":"chargeCategory.name","price":"number"}],"rules":{"minimumAge","requiresResponsible","minimumAgeAlone","repeat","maxBookingHour"},"form":{"required":"boolean","type":"termo|ficha","requiresSignature":"boolean"}}
  ```
- **Endpoints**: E29.
- **Cards**: `experience`.

### T09 `experiences.checkEligibility`

- **Intenções**:
  - "meu filho de 7 anos pode ir?"
  - "posso ir sozinho com as crianças?"
- **Entrada**:

  ```json
  {"experienceId":"string","participants":["string (nome|'titular')"]}
  ```
- **Saída**:

  ```json
  {"eligible":"boolean","perGuest":[{"ref","firstName","status":"eligible|below_minimum|needs_responsible|already_booked"}],"holderMustParticipate":"boolean","errors":["selectAHolder|holderBelowMinimumAge|..."]}
  ```
- **Endpoints**:
  - E29;
  - E33 (já reservados, R-EXP-06).
- **Regras**: R-EXP-03 a R-EXP-07. **Reimplementar** `utils/experienceAgeRules.ts` no servidor, idealmente como pacote compartilhado ou validação na API oficial.
- **Erros**: `AMBIGUOUS_GUEST`.

### T10 `experiences.checkAvailability`

- **Entrada**:

  ```json
  {"experienceId":"string","participants":["string"],"date":"YYYY-MM-DD?"}
  ```
- **Saída**:

  ```json
  [{"date","availabilityId","isHour":"boolean","vacancies":{"adult","child","shared"},"hours":[{"hourId","hour","available":"boolean"}],"bookable":"boolean"}]
  ```
- **Endpoints**: E30, com `adultGuests`/`childGuests` separados por idade ≥ 18 (R-EXP-08).
- **Regras**:
  - R-EXP-09: data + `maxBookingHour` > agora; vagas ≥ número de participantes;
  - R-EXP-10.
- **Erros**: chaves padronizadas de erro (R-EXP-17).

### T11 `experiences.prepareBooking`

- **Intenções**:
  - "quero reservar essa para duas pessoas amanhã às 9h"
- **Entrada**:

  ```json
  {"experienceId":"string","date":"YYYY-MM-DD","hour":"HH:mm?","participants":["string"],"holder":"string?","phone":"string?","obs":"string?"}
  ```
- **Saída**: `experience.booking.card` em `preview`, um contrato que **já existe** (`chatApi.types.ts:58-77`), com `previewId`, `expiresAt` e `summary`.
- **Execução** (confirmar): servidor → E31 com o snapshot do preview → E32, se houver ficha.
- **Contexto**: `lodgingIdPms`, `responsibleId`, ids resolvidos.
- **Validações no preview e de novo na execução**:
  - T09 + T10;
  - telefone ≥ 10 dígitos (R-EXP-11);
  - `experienceAvailabilityId` obrigatório.
- **Termo/ficha (R-EXP-12, R-EXP-13)**: se `form` existe, o chat **não** coleta o aceite. Responde com `navigate` para `bookingExperienceDetails`, ou propõe ao produto um card de aceite que exiba `form.text` com checkbox (P2, ver 05).
- **Efeitos**:
  - cria a reserva oficial;
  - **hoje é simulada** (`simulated: true`);
  - o lembrete local do app **não** é agendado (lacuna G6).
- **Erros**: `UNAVAILABLE`, `NOT_ELIGIBLE`, `ALREADY_BOOKED`, `OUT_OF_WINDOW`, `UPSTREAM_ERROR` (texto da API).
- **Idempotência**: `previewId`.
- **Cards**: `experience.booking.card`.

### T12 `bookings.listMine`

- **Intenções**:
  - "tenho reserva amanhã?"
  - "qual a próxima?"
  - "quais pendentes?"
- **Entrada**:

  ```json
  {"kind":{"enum":["restaurant","experience","all"]},"from":"YYYY-MM-DD?","to":"YYYY-MM-DD?","status":"string?","upcomingOnly":"boolean?"}
  ```
- **Saída**:

  ```json
  [{"bookingId","kind","title","date":"YYYY-MM-DD","time":"HH:mm|null","status":"normalizado","rawStatus","people":[{"firstName"}],"totalValue?","canCancel":"boolean","canEdit":"boolean"}]
  ```
- **Endpoints**:
  - E24 (+ E18 para categorias);
  - E33.
  - Ambos com o `lodgingIdPms` da sessão.
- **Regras**:
  - normalizar status: `aprovada|pago` → `confirmed`, `pendente` → `pending`, `cancelada|cancelado` → `cancelled`;
  - `canCancel` / `canEdit` seguem R-GAS-15 e R-EXP-16;
  - "próxima" = menor data/hora ≥ agora (fuso do resort);
  - **o app esconde as canceladas de restaurante**; a IA pode mostrá-las se for explicitamente perguntada.
- **Cards**: `booking`.

### T13 `bookings.getDetails`

- **Entrada**:

  ```json
  {"bookingId":"string","kind":"restaurant|experience"}
  ```
- **Saída**: T12 + `dishesPerPerson` (restaurante) ou `participants`, `phone`, `obs` e `price` (experiência).
- **Endpoints**: E24/E33 com filtro por id. Não há endpoint de detalhe (lacuna G3).
- **Erros**: `NOT_FOUND` (inclusive id de outra hospedagem).

### T14 `bookings.prepareCancelExperience`

- **Entrada**:

  ```json
  {"bookingId":"string"}
  ```
- **Saída**: card `operation.confirm` com o resumo.
  - Execução: E34 com `{situation: "cancelado"}`.
- **Regras**:
  - R-EXP-16;
  - revalidar na execução que o item pertence à hospedagem e que ainda é cancelável.
- **Efeitos**: cancela a reserva oficial. O lembrete local fica órfão (G6).
- **Erros**: `NOT_CANCELLABLE`, `OUT_OF_WINDOW`.

### T15 `bookings.prepareCancelRestaurant`

- **Saída**: `operation.confirm`. Execução: E25.
- **Bloqueio (G4)**: E25 cancela por `lodgingIdPms + restaurantId`.
  - Se houver mais de uma reserva aprovada no mesmo restaurante, a tool deve **recusar** e responder com `navigate` para `myReservation {tab: "Gastronomy"}`.
  - O mesmo vale até a API oferecer cancelamento por id.
- **Regras**: R-GAS-15 (antes do `closure`).

### T16 `bookings.editRestaurantDishes`

- **Saída**: `navigate` para `myReservation {tab: "Gastronomy"}`.
  - A edição exige a montagem de `TRestaurantSummary` (ver 06).

### T17 `events.list`

- **Intenções**:
  - "o que vai acontecer hoje?"
  - "eventos à noite?"
  - "o que tem no sábado?"
- **Entrada**:

  ```json
  {"from":"YYYY-MM-DD","to":"YYYY-MM-DD","period":{"enum":["manha","tarde","noite"]}}
  ```

  `period` é opcional.
- **Saída**:

  ```json
  [{"id","title","description","startsAt":"ISO com offset -03:00","localDate","localTime","location","imageUrl":"galleries[0].image","isFavorite":"boolean"}]
  ```
- **Endpoints**:
  - E35;
  - E36, para `isFavorite`.
- **Regras**:
  - **converter para America/Sao_Paulo** (R-DT-01, R-EVT-02);
  - "noite" (≥ 18:00) é uma definição da IA e precisa ser documentada no prompt;
  - "hoje" no fuso do resort (o app usa UTC, R-EVT-01).
- **Cards**: `event`.

### T18 `events.getDetails`

- **Entrada**:

  ```json
  {"eventId":"string"}
  ```
- **Saída**: o item de T17 + `galleries[]`.
- **Endpoints**: E35 com a janela da estadia e filtro por id. Não há endpoint de detalhe (G3).

### T19 `requests.listDepartments`

- **Saída**:

  ```json
  [{"id","name","description","info":[{"title","description"}],"acceptsItems":"boolean"}]
  ```
- **Endpoints**: E06.
- **Regras**: R-REQ-01 e R-REQ-06.

### T20 `requests.findItems`

- **Intenções**:
  - "quero mais toalhas"
  - "pode mandar travesseiro?"
  - "limpeza no quarto"
- **Entrada**:

  ```json
  {"query":"string","departmentId":"string?"}
  ```
- **Saída**:

  ```json
  [{"itemId","name","parent":"string|null","departmentId","departmentName","score"}]
  ```
- **Endpoints**: E06, com busca no servidor sobre `itemsDepartment` (hierarquia).
- **Regras**: só itens com `situation`. **Se nada corresponder, não inventar**: oferecer o departamento com observação livre, ou `navigate` para `requests`.

### T21 `requests.prepareCreate`

- **Entrada**:

  ```json
  {"departmentId":"string","itemIds":["string"],"note":"string?","quantityHint":"integer?"}
  ```
- **Saída**: `operation.confirm` (departamento, itens, observação).
  - Execução: E08 `{departmentId, responsibleId: ctx, itemDepartmentIds, guestObs}`.
- **Regras**:
  - R-REQ-03: item ou observação;
  - R-REQ-04: remover o pai quando houver filho;
  - R-REQ-05: `quantityHint` é **concatenado em `guestObs`** ("Quantidade: 2"), porque não existe campo próprio.
- **Idempotência**: `previewId`. O E08 não tem deduplicação; evitar uma segunda confirmação.
- **Cards**: `operation.confirm` → `request`.

### T22 `requests.listMine`

- **Intenções**:
  - "qual o status da minha solicitação?"
  - "minhas solicitações"
- **Entrada**:

  ```json
  {"kind":{"enum":["department","leisure","all"]},"status":"string?"}
  ```
- **Saída**:

  ```json
  [{"id","kind","title":"departamento|atividade","items":["string"],"status","createdAt","attendedAt?","note?","canCancel":"status==='pendente'"}]
  ```
- **Endpoints**:
  - E07 + E06 (nomes);
  - E14.
- **Cards**: `request.status`.

### T23 `requests.prepareCancel`

- **Entrada**:

  ```json
  {"requestId":"string"}
  ```
- **Saída**: `operation.confirm`. Execução: E09 `{situation: "cancelada"}`.
- **Regras**: só `pendente` (R-REQ-07). Revalidar que o item pertence ao hóspede na execução.

### T24 `leisure.listActivities`

- **Intenções**:
  - "atividades para crianças amanhã"
  - "que horas é a hidroginástica?"
- **Entrada**:

  ```json
  {"date":"YYYY-MM-DD?","categoryQuery":"string?","forGuest":"string?"}
  ```
- **Saída**:

  ```json
  [{"activityId","name","category","date":"expandido de dayOfWeek","time":"HH:mm","location","ageRange?":{"min","max"},"requiresEnrollment":"boolean"}]
  ```
- **Endpoints**: E10 e E11.
- **Regras**:
  - R-LAZ-01: expandir `dayOfWeek` em datas da estadia;
  - R-LAZ-03: faixas etárias **fixas no app**, que precisam ir para o backend (G7).

### T25 `leisure.getCategoryInfo`

- **Endpoints**: E11 e E12.
- **Saída**:

  ```json
  {"category","info":[{"title","description"}],"hasRegistrationForm":"boolean"}
  ```

### T26 `leisure.startEnrollment`

- **Saída**: `navigate` para `leisure`.
  - Hoje a inscrição exige a montagem de `TSignature` (ver 06).
- **Motivo de ser SCREEN**:
  - formulário dinâmico (E49);
  - escolha de responsável;
  - faixas etárias;
  - vários forms em sequência;
  - termo HTML.

### T27 `leisure.prepareCancelEnrollment`

- **Saída**: `operation.confirm`. Execução: E15 `{situation: "negado"}`.
- **Regras**: só `pendente` (R-LAZ-06). Observação: o valor `negado` é o mesmo de uma recusa pelo resort.

### T28 `favorites.list`

- **Endpoints**: E36 (`eventType === "evento"`) + E35 com a **janela da estadia inteira**. O app usa uma janela menor (R-FAV-03).
- **Saída**: os itens de `event` com `favoriteId`.

### T29 `favorites.addEvent`

- **Entrada**:

  ```json
  {"eventId":"string"}
  ```
- **Execução**: E37 `{event: <objeto E35>, eventType: "evento", eventId}`.
- **Lacuna (G6)**:
  - o lembrete 1 h antes é **local** (notifee) e só é criado pelo app;
  - criado pelo servidor, o favorito existe, mas o lembrete não.
  - Solução: o app reagenda os lembretes ao receber a ação `favorite.changed`, ou o push passa a ser do servidor.
- **Regras**: só eventos futuros; evitar duplicar (checar E36).

### T30 `favorites.remove`

- **Entrada**:

  ```json
  {"favoriteId":"string?","eventId":"string?"}
  ```
- **Execução**: E39. O app precisa cancelar a notificação local (G6).

### T31 `spa.listServices`

- **Intenções**:
  - "tratamentos do spa"
  - "quanto custa a massagem?"
  - "posso agendar?"
- **Endpoints**: E42, E43 e E44.
- **Saída**:

  ```json
  {"description","observation","contactUrl":"spa.link","categories":[{"title","services":[{"id","title","description","price":"value","duration":"time"}]}]}
  ```
- **Regras**: R-SPA-01. **Não há agendamento.** Responder com o contato (WhatsApp) e `navigate` para `spa`.

### T32 `boutique.listProducts`

- **Endpoints**: E40 e E41.
- **Entrada**:

  ```json
  {"categoryQuery":"string?","query":"string?"}
  ```
- **Saída**:

  ```json
  [{"id","name","description","price","category","imageUrls"}]
  ```
- **Regras**: R-BTQ-01. Não oferecer compra.

### T33 `esg.getContent`

- **Endpoints**: E45, E46 e E47.
- **Regras**:
  - o texto institucional vai para o **RAG**;
  - iniciativas e parceiros são **estruturados** (imagem + link), sem texto descritivo na API.
  - A IA não deve inventar descrições a partir da imagem.

### T34 `tips.list`

- **Endpoints**: E48.
- **Regras**:
  - todos os `tips` + os `tipItems` com `situation`, ordenados por `order`;
  - adequado para RAG;
  - o app só mostra o primeiro (R-TIP-01).

### T35 `quiz.list`

- **Endpoints**: E50 (+E53 para "já jogou").
- **Saída**:

  ```json
  [{"id","title","theme","mode","sessionStatus","requiresPin","holderOnly","alreadyPlayed"}]
  ```
- **Regras**: R-QZ-05. Para jogar, `navigate` para `quiz`. **Nunca** expor perguntas ao LLM.

### T36 `navigation.open`

- **Entrada**:

  ```json
  {"target":{"enum":["Gastronomy","Restaurant","Experiences","Experience","Events","Leisure","Requests","Spa","Boutique","Esg","Tips","Quiz","MyReservation","MyRequests","MyFavorites","Map"]},"params":{"type":"object"}}
  ```
- **Saída**: a ação `navigate` (contrato existente, estendido em 06).
- **Regras**: lista fechada nos dois lados; params validados por alvo (06).
