# Yago AI — integração de cards dinâmicos no app (React Native)

> **Público:** o desenvolvedor (ou agente) do `yago-mobile-front` que vai implementar os cards do chat.
> **Fonte:** o código do `yago-ai-api` nesta versão. Tudo aqui está implementado e validado no servidor (`src/contracts/chat-actions.ts`). O que **não** está implementado aparece como tal na seção F e em [`ai-capabilities-implementation.md`](ai-capabilities-implementation.md).
> **Referências:** a auditoria do app em [`yago-ai-audit/`](yago-ai-audit/) (rotas reais em `06-navigation-contracts.md`) e o catálogo de ferramentas em [`ai-tools-reference.md`](ai-tools-reference.md).

## Sumário

- [A. Visão geral](#a-visão-geral)
- [B. Contrato de `POST /chat`](#b-contrato-de-post-chat)
- [C. Tipos de ações](#c-tipos-de-ações)
- [D. Cards](#d-cards)
- [E. Navegação](#e-navegação)
- [F. Operações transacionais](#f-operações-transacionais)
- [G. Atualização de cards](#g-atualização-de-cards)
- [H. Estados e erros](#h-estados-e-erros)
- [I. Exemplos completos](#i-exemplos-completos)
- [J. Checklist de implementação mobile](#j-checklist-de-implementação-mobile)

---

## A. Visão geral

```text
React Native ──POST /chat──▶ ChatController ──▶ ChatService
                                                  │
                                                  ▼
                                    ChatOrchestratorService
                     ┌───────────────┬────────────┴────────────┐
                     ▼               ▼                         ▼
               conversa social   conhecimento (RAG)      operações
               (sem modelo)      ChromaDB + Ollama     IntentClassifier
                                                        → ConversationContext (referências)
                                                        → OperationsDispatcher
                                                        → handler do domínio
                                                        → OperationsToolRegistry (ferramentas fechadas)
                                                        → snapshot do resort (somente leitura)
                                                          / banco da IA (simulações)
                                                  │
                                                  ▼
                          reply (texto) + actions (cards validados no servidor)
                                                  │
React Native ◀────────────────────────────────────┘
   renderiza reply + um componente por action; botões → navegação ou nova mensagem;
   confirmações → POST /chat/actions
```

Pontos que o app precisa saber:

1. **As ações são montadas só pelo servidor**, a partir dos dados das ferramentas. O modelo de linguagem nunca escreve uma ação, uma URL ou um comando de navegação.
2. **Toda ação passa por `isValidChatAction` antes de sair.** Uma ação inválida é descartada no servidor. Mesmo assim, o app deve validar o tipo e ignorar o que não conhece.
3. **O `reply` é curto quando há cards** e não repete o conteúdo deles. Sem cards, ele é autossuficiente. Para restaurantes e reservas de restaurante, o texto continua completo para apps antigos.
4. **Datas e horários já vêm no fuso do resort** (`RESORT_TIMEZONE`, padrão `America/Bahia`): `date` = `AAAA-MM-DD`, `time` = `HH:MM`. **Não reconverta** com o fuso do aparelho.
5. **Operações com efeito** (pré-reserva de experiência, solicitação a departamento) são **simuladas**: gravadas só no banco da IA, nunca no sistema oficial do resort. Os cards e textos dizem isso.

---

## B. Contrato de `POST /chat`

### Request

```http
POST /chat
Content-Type: application/json
X-Demo-Guest-Id: <loggedUser.guestHolder.id>
```

```json
{ "message": "Quais restaurantes vocês têm?", "conversationId": "3f1c2a4e-8b7d-4c1e-9a2f-6d5e4b3a2c10" }
```

| Campo | Tipo | Regras |
| --- | --- | --- |
| `message` | string | Obrigatório, não vazio, até 2000 caracteres. |
| `conversationId` | UUID v4 | Omita na primeira mensagem. Nas seguintes, reenvie sempre o valor recebido: é ele que guarda o contexto ("a segunda", "essa", "para duas pessoas"). |

Campos extras são recusados com `400`.

### Headers

| Header | Valor | Obrigatório |
| --- | --- | --- |
| `Content-Type` | `application/json` | Sim, nos `POST` |
| `X-Demo-Guest-Id` | UUID do **titular** (`guestHolder.id`) | Sim, em todas as rotas `/chat*` |
| `X-Demo-Secret` | Segredo da sessão de demonstração | Só se o servidor configurar `DEMO_SHARED_SECRET` |

- **Não envie** `X-Resort-Id` nem `X-Guest-Id`: a requisição é recusada (`401`). O resort é definido no servidor (`RESORT_ID`).
- `X-Demo-Guest-Id` é **identidade de demonstração, não autenticação**. Ele só é aceito em desenvolvimento, por loopback e hosts permitidos. A troca pelo token do app (Bearer) será feita no mesmo ponto do cliente (`chatApi.ts`), quando o backend oficial expuser `/me` (lacuna G1).
- Timeout recomendado: **180 s**. Consultas de cards (restaurantes, cardápio, reservas, solicitações, SPA…) não usam o modelo generativo e respondem em menos de 1 s. Perguntas abertas (RAG) levam de 2 a 10 s.

### Response `201 Created`

```ts
interface ChatResponse {
  reply: string;                       // texto do Yago (pode ter quebras de linha "\n")
  conversationId: string;              // salve e reenvie
  assistantMessageId?: number;         // ID da resposta gravada (narração: POST /chat/voice)
  retrievedSources: RetrievedSource[]; // fontes do RAG; só para depuração
  actions: ChatAction[];               // sempre presente; [] quando não há cards
}

interface RetrievedSource { id: string; title: string; distance: number | null }
```

**Compatibilidade com o contrato anterior:** nenhum campo foi removido ou renomeado. `actions` ganhou tipos novos (`catalog.list`, `menu.view`, `booking.list`, `request.list`) e `navigate` ganhou telas. Um app que ignora tipos desconhecidos (`KNOWN_ACTION_TYPES`) continua funcionando: ele só não mostra esses cards.

Mudanças de comportamento que o app precisa conhecer (não há negociação de versão nem header de capacidades):

| Antes | Agora | Efeito num app sem suporte |
| --- | --- | --- |
| Restaurante **sem** reserva: `navigate Gastronomy {restaurantId}` (o app abria a tela de reserva) | `navigate Restaurant {restaurantId}` | Botão escondido (tela desconhecida); o texto continua completo |
| Histórico de solicitações: `navigate Requests` | `request.list` + `navigate MyRequests` | Sem card e sem botão; o texto continua completo |
| Reservas de restaurante/experiências: só texto | texto (inalterado para restaurantes) + `booking.list` + `navigate MyReservation` | Só o texto |

Publique a versão do app com as telas novas em `CHAT_SCREEN_ROUTES` junto com esta versão do servidor.

### Rotas relacionadas

| Rota | Uso |
| --- | --- |
| `POST /chat/actions` | Botões Confirmar e Descartar dos cards de operação (seção F). |
| `GET /chat/:conversationId/messages` | Histórico com `actions` de cada mensagem; os cards de operação vêm no **estado atual** (seção G). |
| `POST /chat/voice` | Narração de uma resposta (`{ conversationId, messageId }`). Inalterado. |

### Erros

Formato Nest: `{ "statusCode": 404, "message": "Conversa não encontrada", "error": "Not Found" }`. `message` pode ser string ou array.

| Status | Quando | O que o app faz |
| --- | --- | --- |
| `400` | Body inválido (campo extra, UUID inválido, mensagem vazia). | Bug do app: registre e mostre um erro genérico. |
| `401` | Header ausente ou inválido, header proibido, host/IP não permitido, modo demo desligado. | "Não foi possível conectar ao assistente." |
| `403` | Titular não encontrado ou hospedagem fora do período ativo (da véspera do check-in ao check-out). | "Não encontramos uma hospedagem ativa." |
| `404` | Conversa inexistente ou de outro hóspede (em `/chat/actions`: pré-visualização inexistente). | Descarte o `conversationId` e comece outra conversa / remova o card. |
| `409` | Duas mensagens simultâneas na mesma conversa. | Reenvie a mesma mensagem. |
| `500` | Erro interno (banco indisponível). | Erro genérico com "tentar de novo". |
| `502`/`503`/`504` | Modelo indisponível ou lento (só perguntas de conhecimento). | "O assistente está indisponível no momento." |

Se `POST /chat` falhar, nada é gravado: reenvie o mesmo texto com o mesmo `conversationId`.

---

## C. Tipos de ações

```ts
type ChatAction =
  | NavigateAction             // botão de navegação
  | ExperienceOptionsAction    // carrossel de experiências
  | ExperienceBookingCardAction// pré-reserva simulada (operação)
  | RestaurantOptionsAction    // carrossel de restaurantes, bares e lanches
  | EventListAction            // programação do dia (eventos + lazer)
  | GuestRequestCardAction     // solicitação simulada (operação)
  | CatalogListAction          // NOVO: SPA, Boutique, Dicas, ESG, Quiz, favoritos
  | MenuViewAction             // NOVO: cardápio de um restaurante
  | BookingListAction          // NOVO: Minhas Reservas
  | RequestListAction;         // NOVO: Minhas Solicitações
```

Regra geral do app: `switch (action.type)`; tipo desconhecido → ignore. Uma resposta pode trazer várias ações. A ordem é a de exibição: cards primeiro e o botão `navigate` por último.

### Tipo comum: `CardButton` (novo)

Usado por `catalog.list`, `menu.view`, `booking.list` e `request.list`.

```ts
type CardButton =
  | { kind: 'navigate'; label: string; navigate: { screen: NavigationScreen; params: NavigateParams } }
  | { kind: 'message'; label: string; message: string };
```

| `kind` | O que o app faz |
| --- | --- |
| `navigate` | Resolve `screen`/`params` pela mesma função do `NavigateAction` (seção E). Tela desconhecida: esconda o botão. |
| `message` | Envia `message` como mensagem do hóspede, em `POST /chat` na **mesma conversa** (ex.: `"Opção 2"`). Mostre o texto na conversa como se o hóspede tivesse digitado. |

No máximo 3 botões por item, rótulo de até 40 caracteres. Não existem botões de URL, compra, agendamento ou pagamento.

---

### C.1 `navigate`

```ts
interface NavigateAction {
  type: 'navigate';
  label: string;            // até 60 caracteres ("Abrir Gastronomia")
  screen: NavigationScreen; // ver seção E
  params: NavigateParams;   // somente os parâmetros aceitos pela tela
}

interface NavigateParams {
  restaurantId?: string;    // Gastronomy, Restaurant
  experienceId?: string;    // Experiences, Experience
  departmentId?: string;    // Requests
  date?: string;            // Events (AAAA-MM-DD)
  tab?: 'Gastronomy' | 'Experience'; // MyReservation
}
```

- **Quando:** ao lado de quase toda resposta operacional, para abrir o módulo correspondente. Também quando a operação **precisa** da tela (reservar restaurante, inscrição de lazer, favoritar, jogar quiz).
- **Botão:** um botão com `label`. Ao tocar, navegue (seção E). Os valores de `params` são IDs do cadastro (`[\w-]+`), nunca objetos.

```json
{ "type": "navigate", "label": "Abrir Minhas Reservas", "screen": "MyReservation", "params": { "tab": "Gastronomy" } }
```

### C.2 `experience.options` (existente)

```ts
interface ExperienceOptionsAction {
  type: 'experience.options';
  label: string;
  date: string | null;          // data consultada ou null (catálogo sem data)
  options: {
    position: number;           // 1, 2, 3… na ordem do texto
    experienceId: string;
    title: string;
    times: string[];            // horários com vaga no snapshot (HH:MM)
    summary: string | null;     // "10 vagas para adultos", "com reserva"
    message: string;            // "Opção N": enviar em POST /chat ao tocar
  }[];                          // 1 a 10
}
```

- **Quando:** "Quais experiências estão disponíveis amanhã?", "Quais passeios têm?".
- **Comportamento:** carrossel numerado. Tocar em uma opção envia `message`. Uma lista nova **inativa** as anteriores (deixe-as visíveis, sem toque).
- **Atenção:** `times` e `summary` vêm do snapshot e **não são disponibilidade em tempo real**. O `reply` já avisa isso uma vez por conversa.

### C.3 `experience.booking.card` (existente, operação)

```ts
type BookingCardStatus = 'preview' | 'confirming' | 'confirmed' | 'expired' | 'failed' | 'cancelled';

interface ExperienceBookingCardAction {
  type: 'experience.booking.card';
  cardId: string;               // UUID; não muda durante todo o ciclo
  status: BookingCardStatus;    // "confirming" é só local (app)
  label: string;                // ex.: "Confirmar reserva simulada"
  summary: {
    experienceId: string; experienceTitle: string;
    date: string; time: string | null;
    adults: number; children: number;
    totalPrice: number | null; currency: 'BRL'; priceNote: string | null;
    simulated: true;            // sempre: reserva de demonstração
  };
  notes: string[];              // até 6 avisos (idade mínima, responsável…)
  expiresAt: string | null;     // só em preview (ISO)
  booking: { bookingId: string; confirmationCode: string } | null; // só em confirmed ("SIM-…")
  reason: string | null;        // em expired, failed, cancelled
  confirm: { method: 'POST'; path: '/chat/actions'; body: { type: 'experience.booking.confirm'; conversationId: string; previewId: string } } | null;
  cancel:  { method: 'POST'; path: '/chat/actions'; body: { type: 'experience.booking.cancel';  conversationId: string; previewId: string } } | null;
  updatedAt: string;            // ISO; use para descartar atualizações antigas
}
```

Ciclo completo na seção F.1.

### C.4 `restaurant.options` (existente)

```ts
interface RestaurantOptionsAction {
  type: 'restaurant.options';
  label: string;
  options: {
    position: number;
    restaurantId: string;
    name: string;
    type: 'restaurante' | 'bar' | 'alimentacao' | null;
    openingHours: string | null;   // texto do cadastro ("12h às 15h")
    location: string | null;
    minimumAge: number | null;
    acceptsReservations: boolean;  // reserva pelo app (com pratos)
    reservationTimes: string[];    // turnos HH:MM
    message: string;               // "Opção N"
  }[];                             // 1 a 20
}
```

- **Quando:** "Quais restaurantes vocês têm?", "Tem bar aberto agora?", "Como é o Omakase?" (lista de 1).
- **Botões sugeridos:** tocar no card → `message`. Reserva: use o `navigate` `Gastronomy {restaurantId}` que acompanha a resposta. Nunca mostre "Reservar" quando `acceptsReservations === false`.

### C.5 `event.list` (existente)

```ts
interface EventListAction {
  type: 'event.list';
  label: string;
  date: string;                 // dia consultado
  items: {
    eventId: string;
    kind: 'event' | 'leisure';  // show/evento datado ou atividade semanal de lazer
    title: string;
    date: string;
    time: string | null;        // HH:MM no fuso do resort
    location: string | null;
    category: string | null;    // categoria de lazer ("4 a 7 anos", "Adulto")
    description: string | null;
  }[];                          // 1 a 30
}
```

- **Quando:** "O que tem hoje à noite?", "Quais atividades estão acontecendo hoje?", "E amanhã?".
- **Comportamento:** lista por horário. `kind: 'leisure'` são atividades semanais: para se inscrever, a resposta oferece `navigate Leisure` (seção F.4). Não há favoritar pelo chat (seção F.5).

### C.6 `request.card` (existente, operação)

```ts
type RequestCardStatus = 'preview' | 'confirming' | 'confirmed' | 'expired' | 'cancelled';

interface GuestRequestCardAction {
  type: 'request.card';
  cardId: string;
  status: RequestCardStatus;
  label: string;                 // "Confirmar solicitação simulada"
  summary: {
    departmentId: string; departmentName: string;
    items: { itemId: string; name: string; quantity: number }[]; // 1 a 10
    note: string | null;         // texto do hóspede, resumido
    simulated: true;
  };
  notes: string[];               // avisos do departamento (até 4)
  expiresAt: string | null;
  request: { requestId: string; protocol: string } | null; // só em confirmed ("SIM-…")
  reason: string | null;
  confirm: { method: 'POST'; path: '/chat/actions'; body: { type: 'request.confirm'; conversationId: string; previewId: string } } | null;
  cancel:  { method: 'POST'; path: '/chat/actions'; body: { type: 'request.cancel';  conversationId: string; previewId: string } } | null;
  updatedAt: string;
}
```

Ciclo na seção F.2.

### C.7 `catalog.list` (novo)

```ts
type CatalogKind = 'spa_service' | 'product' | 'tip' | 'esg' | 'quiz' | 'event';

interface CatalogListAction {
  type: 'catalog.list';
  label: string;                 // "SPA", "Boutique", "Dicas", "Sustentabilidade", "Quiz", "Seus favoritos"
  kind: CatalogKind;
  items: CatalogItem[];          // 1 a 20, IDs únicos
}

interface CatalogItem {
  id: string;                    // ID do cadastro: identidade estável do card
  position: number;              // 1..N, na ordem da lista
  title: string;                 // até 160
  description: string | null;    // até 400, texto do cadastro
  imagePath: string | null;      // relativo ao bucket ("spa/foto.jpg"); hoje sempre null nestes tipos
  meta: {                        // todos opcionais, já formatados
    date?: string;               // AAAA-MM-DD (favoritos)
    time?: string;               // HH:MM (favoritos)
    location?: string;
    price?: string;              // "R$ 250,00"
    duration?: string;           // "50 min" ou texto livre do cadastro
    category?: string;
  };
  badges: string[];              // até 4 ("Favorito", "Ao vivo", "10 perguntas")
  buttons: CardButton[];         // até 3
}
```

| `kind` | Quando | Botões |
| --- | --- | --- |
| `spa_service` | "Quais massagens estão disponíveis?", "Quanto custa a drenagem?" | `message "Opção N"` (só em listas com mais de um item) + `navigate Spa` |
| `product` | "Quais produtos existem na boutique?" (catálogo de até 10 itens, uma categoria ou um produto citado) | `message "Opção N"` + `navigate Boutique` |
| `tip` | "Me dê uma dica", "Dicas sobre águas-vivas" | `message "Opção N"` + `navigate Tips` |
| `esg` | "O que o resort faz pela sustentabilidade?" | `navigate Esg` |
| `quiz` | "Quero responder ao quiz", "Tem quiz hoje?" | `navigate Quiz` (o jogo é só na tela) |
| `event` | "Mostre meus favoritos" | `message "Opção N"` + `navigate Events {date}` |

- **Comportamento:** carrossel horizontal. `message "Opção N"` pede ao Yago o detalhe daquele item. O servidor responde com o mesmo `kind` e **um** item. "Opção N" e "o segundo" só valem logo depois da lista (a lista continua valendo depois de um item escolhido). Uma frase que cita outro domínio ("o primeiro restaurante") vai para esse domínio.
- **Uma lista nova do mesmo `kind` inativa a anterior**, como em `experience.options`.
- Sem botão de compra (Boutique), de agendamento (SPA) nem de resposta (Quiz): essas operações não existem no app.

### C.8 `menu.view` (novo)

```ts
interface MenuViewAction {
  type: 'menu.view';
  label: string;                 // "Cardápio: Omakase"
  restaurantId: string;
  restaurantName: string;
  totalDishes: number;           // pratos nas categorias enviadas (inclui os não exibidos)
  categories: {                  // 1 a 20, na ordem do cadastro
    id: string;
    name: string;                // "Entrada", "Principal - Vegetariano" (subcategoria)
    dishes: {                    // até 5 por categoria no card
      id: string;
      name: string;
      description: string | null;
      serves: number | null;     // porção compartilhada: "Serve N pessoas" quando > 1
      imagePath: string | null;  // "menu/<arquivo>"
    }[];
    moreDishes: number;          // pratos que não couberam: mostre "ver todos" → botão Restaurant
  }[];
  buttons: CardButton[];         // "Abrir no app" → Restaurant; "Reservar" → Gastronomy (só com reserva)
}
```

- **Quando:** "Mostre o cardápio do restaurante italiano", "Qual o menu do Omakase?", "O que tem de sobremesa?" (o card traz só a categoria pedida).
- **Layout sugerido:** accordion por categoria, prato com foto pequena, nome, descrição e selo "Serve N pessoas" quando `serves > 1`.
- **Sem botão de pedir prato.** Os pratos são escolhidos na reserva, na tela de Gastronomia.
- Cardápio não publicado: **não há card**. O `reply` diz isso e vem com `navigate Restaurant`.

### C.9 `booking.list` (novo)

```ts
interface BookingListAction {
  type: 'booking.list';
  label: string;                 // "Minhas reservas", "Próxima reserva", "Reservas de experiências"
  items: {                       // 1 a 30; (kind, bookingId) único
    bookingId: string;
    kind: 'restaurant' | 'experience';
    title: string;               // restaurante ou experiência
    date: string;                // AAAA-MM-DD
    time: string | null;         // HH:MM; null sem horário cadastrado
    status: 'confirmed' | 'pending' | 'cancelled' | 'unknown';
    statusLabel: string;         // "Confirmada", "Pendente", "Cancelada", "Simulada (não oficial)"
    people: number | null;
    simulated: boolean;          // feita pelo chat: não existe no sistema oficial
    confirmationCode: string | null; // "SIM-…" nas simuladas
    buttons: CardButton[];       // oficiais: "Ver em Minhas Reservas" (MyReservation {tab}); simuladas: nenhum
  }[];
}
```

- **Quando:** "Tenho alguma reserva amanhã?", "Qual minha próxima reserva?", "Mostre minhas reservas gastronômicas", "Minhas reservas de experiências".
- **Ordem:** cronológica.
- **Status:** `aprovada`/`pago` → `confirmed`; `pendente` → `pending`; `cancelada`/`cancelado` → `cancelled`. Simuladas: `confirmed` com `simulated: true`.
- **Cores sugeridas:** verde `confirmed`, laranja `pending`, vermelho `cancelled`, cinza `unknown`. Simuladas com selo "Simulação".
- **Imagem:** não vem no card. O app pode resolver pelo próprio catálogo (restaurante pelo nome/ID na tela) ou omitir.
- Cancelar ou editar pelo chat **não existe** (seção F.6). O botão leva a Minhas Reservas.

### C.10 `request.list` (novo)

```ts
interface RequestListAction {
  type: 'request.list';
  label: string;                 // "Minhas solicitações"
  items: {                       // 1 a 30; (kind, requestId) único
    requestId: string;
    kind: 'department' | 'leisure';   // inscrições de lazer aparecem aqui (como no app)
    title: string;               // departamento ou atividade ("Recreação: 4 a 7 anos")
    items: string[];             // itens pedidos (até 10)
    status: 'pending' | 'in_progress' | 'done' | 'cancelled' | 'approved' | 'denied' | 'simulated' | 'unknown';
    statusLabel: string;
    date: string | null;         // AAAA-MM-DD da abertura/inscrição
    time: string | null;
    simulated: boolean;          // solicitação feita pelo chat (não enviada ao departamento)
    protocol: string | null;     // "SIM-…" nas simuladas
    buttons: CardButton[];       // oficiais: "Ver em Minhas Solicitações"; simuladas: nenhum
  }[];
}
```

| Origem | `status` ← valor do cadastro | `statusLabel` |
| --- | --- | --- |
| Departamento | `pendente` → `pending`, `executando` → `in_progress`, `atendida` → `done`, `cancelada` → `cancelled` | Pendente, Em andamento, Atendida, Cancelada |
| Simulada pelo chat | `simulated` | Simulada (não enviada) |
| Lazer | `pendente` → `pending`, `aprovado` → `approved`, `negado` → `denied` | Pendente, Aprovada, Negada ou cancelada |

> `negado` é tanto a recusa do resort quanto o cancelamento feito pelo hóspede (R-LAZ-06). Por isso o rótulo é "Negada ou cancelada".

- **Quando:** "Qual o status da minha solicitação?" (um item), "Quais são minhas solicitações?", "Minhas inscrições".
- Cancelar pelo chat **não existe** (seção F.6).

---

## D. Cards

Componente sugerido por ação:

| Ação | Componente | Identidade do card |
| --- | --- | --- |
| `restaurant.options` | `RestaurantCard` (carrossel) | `restaurantId` |
| `menu.view` | `MenuCard` com `DishRow` | `restaurantId` (+ `categories[].id`, `dishes[].id`) |
| `experience.options` | `ExperienceCard` (carrossel) | `experienceId` |
| `experience.booking.card` | `OperationCard` (pré-reserva) | `cardId` |
| `event.list` | `EventCard` (lista por horário) | `eventId` |
| `catalog.list` `event` | `FavoriteCard` | `id` (evento) |
| `catalog.list` `spa_service` | `SpaServiceCard` | `id` |
| `catalog.list` `product` | `BoutiqueProductCard` | `id` |
| `catalog.list` `tip` | `TipCard` | `id` |
| `catalog.list` `esg` | `EsgCard` | `id` |
| `catalog.list` `quiz` | `QuizCard` | `id` |
| `booking.list` | `BookingCard` | `kind` + `bookingId` |
| `request.list` | `RequestStatusCard` | `kind` + `requestId` |
| `request.card` | `OperationCard` (solicitação) | `cardId` |
| `navigate` | `ScreenButton` | — |

Regras que valem para todos:

- **Dados ausentes:** campo `null` ou ausente → não renderize a linha. Nunca mostre "null", "R$ 0" ou "undefined".
- **Imagens:** só `imagePath` relativo (`<pasta>/<arquivo>`, sem `..` e sem URL). Pastas aceitas pelo servidor: `restaurant`, `menu`, `experience/logos`, `spa` e `tip`; extensões `jpg`, `jpeg`, `png`, `webp`, `gif` e `svg`. Monte `${EXPO_PUBLIC_BUCKET}/${imagePath}`. Sem `imagePath`, use a imagem local de fallback ou a do catálogo do app (pelo ID). Hoje só os pratos de `menu.view` trazem `imagePath`: as pastas de galeria de eventos e produtos não foram confirmadas na auditoria, e o servidor não inventa caminhos.
- **Textos:** texto simples (sem HTML nem Markdown). Pode truncar com reticências.
- **Preços** vêm prontos (`"R$ 250,00"`): não recalcule. Em `experience.booking.card`, `totalPrice` é numérico; formate em BRL.
- **Disponibilidade:** nenhum card afirma disponibilidade em tempo real. Vagas e horários de experiências vêm do snapshot.

Detalhes por card:

| Card | Título | Subtítulo/meta | Badges | Botões |
| --- | --- | --- | --- | --- |
| RestaurantCard | `name` | `openingHours`, `location`, "A partir de N anos" (`minimumAge`) | "Aceita reserva" se `acceptsReservations` | Card → `message`; resposta traz `navigate` |
| MenuCard | `restaurantName` | categorias em accordion | "Serve N pessoas" por prato | `buttons` (Restaurant, Gastronomy) |
| ExperienceCard | `title` | `times`, `summary` | — | Card → `message` |
| EventCard | `title` | `time`, `location`, `category` | "Lazer" quando `kind: 'leisure'` | — (resposta traz `navigate`) |
| FavoriteCard | `title` | `meta.date` + `meta.time`, `meta.location` | "Favorito" | `buttons` |
| SpaServiceCard | `title` | `meta.price`, `meta.duration`, `meta.category`; `description` | — | `buttons` |
| BoutiqueProductCard | `title` | `meta.price`, `meta.category`; `description` | — | `buttons` |
| TipCard | `title` | `description` | — | `buttons` |
| EsgCard | `title` | `description` | — | `buttons` |
| QuizCard | `title` | `meta.category` (tema) | "Ao vivo"/"Individual", "N perguntas" | `buttons` |
| BookingCard | `title` | `date` + `time`, `people` | `statusLabel`, "Simulação" se `simulated` | `buttons` |
| RequestStatusCard | `title` | `items`, `date` + `time` | `statusLabel`, "Lazer" se `kind: 'leisure'`, "Simulação" | `buttons` |
| OperationCard | `label` | linhas do `summary`, `notes`, `expiresAt` | `status` | Confirmar/Descartar (seção F) |

---

## E. Navegação

O servidor envia **nomes de tela do contrato**. O app mantém o único mapeamento para as rotas reais (`CHAT_SCREEN_ROUTES` em `screens/Concierge/chatScreenRoutes.ts`). Tela fora da tabela: o botão não aparece.

| `screen` | `params` aceitos | Rota no app (auditoria 06) | Validação no app |
| --- | --- | --- | --- |
| `Gastronomy` | `restaurantId?` | com `restaurantId`: `bookingGastronomyDetails {id}`; senão `gastronomy` | O ID existe no cache `["restaurants"]` e `existsBooking === "sim"`; senão `gastronomyId {id}` |
| `Restaurant` | `restaurantId` | `gastronomyId {id}` (página informativa + cardápio) | O ID existe |
| `Experiences` | `experienceId?` | `experiences` (com ID: mesmo tratamento de `Experience`) | — |
| `Experience` | `experienceId` | `existsBooking === "sim"` ou `type === "reserva"` → `bookingExperienceDetails {id}`; senão `experienceId {id}` (R-EXP-02) | O ID existe no cache `["experiences"]` |
| `Events` | `date?` | `events` (+ aba do dia) | `date` dentro dos 7 dias exibidos; senão abra sem aba |
| `Leisure` | — | `leisure` | — |
| `Requests` | `departmentId?` | `requests` (com ID: `navigate("requests", { screen: dept.name, params: dept })` com `dept` do cache `["departments"]`) | O departamento existe e tem itens |
| `Spa` | — | `spa` | — |
| `Boutique` | — | `boutique` | — |
| `Esg` | — | `esg` | — |
| `Tips` | — | `tip` | — |
| `Quiz` | — | `quiz` | — |
| `MyReservation` | `tab?: 'Gastronomy' \| 'Experience'` | `myReservation {tab}` | `tab` ∈ enum |
| `MyRequests` | — | `myRequests` | — |
| `MyFavorites` | — | `myFavorites` | — |

Regras:

1. Os `params` são **IDs do cadastro**, nunca objetos de rota (`TRestaurantSummary`, `TSignature`, `TLocation`). Quando a rota exige um objeto, o app o monta a partir do próprio cache.
2. Param inválido ou ID inexistente: abra a tela de lista ou esconda o botão. Nunca navegue com um objeto incompleto.
3. `Map` e `WebView` **não** são enviados pelo servidor nesta versão.

---

## F. Operações transacionais

| Operação | Pelo chat | Tipo | Efeito real |
| --- | --- | --- | --- |
| Reserva de experiência | Preview → confirmação | `experience.booking.card` | **Simulada** (banco da IA, código `SIM-…`) |
| Solicitação a departamento | Preview → confirmação | `request.card` | **Simulada** (banco da IA, protocolo `SIM-…`) |
| Reserva de restaurante | Navegação | `navigate Gastronomy {restaurantId}` | Feita na tela (pratos por pessoa) |
| Inscrição de lazer | Navegação | `navigate Leisure` | Feita na tela (ficha, termo, responsável) |
| Favoritar / remover favorito | Navegação | `navigate Events`, `navigate MyFavorites` | Feita na tela (o lembrete local é agendado pelo app) |
| Cancelar reserva / solicitação / inscrição | Navegação | `navigate MyReservation` / `MyRequests` | Feita na tela |
| Agendar SPA, comprar na boutique, responder quiz | Não existe | — | — |

### F.1 Reserva de experiência (simulada)

```text
"Quais experiências estão disponíveis amanhã?"  → experience.options (lista numerada)
"Me mostre a segunda"                            → detalhe da 2ª opção (texto; pergunta se verifica horários)
"Quero reservar essa"                            → pergunta o que falta (pessoas, data)
"Para duas pessoas"                              → experience.booking.card status=preview (cardId X)
[Confirmar] ou "Pode confirmar"                  → o mesmo card X em status=confirmed
```

- **Ao tocar em Confirmar:** marque o card como `confirming` (estado local), desabilite os botões e envie **exatamente** `confirm.body`:

  ```http
  POST /chat/actions
  { "type": "experience.booking.confirm", "conversationId": "…", "previewId": "<cardId>" }
  ```

  Descartar: envie `cancel.body` (`experience.booking.cancel`). O app **nunca** reenvia data, pessoas ou preço: o servidor usa o snapshot persistido da pré-reserva.
- **Confirmação por texto** ("confirmo", "pode confirmar", "sim"): o efeito é o mesmo do botão, mas só enquanto a pré-reserva for a pendência da conversa. Outra operação no meio (nova busca, lista de restaurantes…) desfaz a confirmação por texto. O botão continua valendo até `expiresAt`.
- **Revalidação no servidor antes de confirmar:** experiência ativa, vaga, data dentro da estadia, valor inalterado, horário ainda não passado no fuso do resort e horário-limite de marcação do dia.
- **Idempotência:** confirmar duas vezes devolve `already_confirmed` com a mesma reserva.

### F.2 Solicitação a departamento (simulada)

```text
"Preciso de duas toalhas extras"   → request.card status=preview (Governança, "2x Toalha…")
[Confirmar] ou "confirmo"          → mesmo card em status=confirmed, protocolo SIM-…
```

Body: `{ "type": "request.confirm" | "request.cancel", "conversationId", "previewId" }`. A quantidade é registrada no item do card. Itens só do cadastro; vários departamentos geram uma solicitação por vez.

### F.3 Resposta de `POST /chat/actions` (`200 OK`)

```ts
interface ChatActionResponse extends ChatResponse {
  status: 'confirmed' | 'already_confirmed' | 'cancelled' | 'expired' | 'unavailable' | 'changed';
}
```

`actions` traz o **mesmo card** (mesmo `cardId`) no novo estado. **Exiba o estado do card**, não o `status`:

| `status` | `card.status` |
| --- | --- |
| `confirmed`, `already_confirmed` | `confirmed` |
| `cancelled` | `cancelled` |
| `expired` | `expired` |
| `unavailable`, `changed` | `failed` (com `reason`); em concorrência momentânea o card pode continuar `preview` |

`404`: pré-visualização inexistente ou de outra conversa/hóspede → remova o card.

### F.4 Inscrição de lazer

"Quero inscrever meu filho na recreação" → texto explicando que a inscrição é feita pelo app + `navigate Leisure` (+ `navigate MyRequests` se já houver inscrições). Nada é gravado.

### F.5 Favoritos

- "Mostre meus favoritos" → `catalog.list` `kind: 'event'`, com favoritos reais do sistema do resort (leitura).
- "Adicione aos favoritos", "tira dos favoritos" → texto + `navigate Events` e `navigate MyFavorites`. **O chat não favorita**: o favorito e o lembrete 1 h antes são criados pela tela de Eventos (lacuna G6). **Não existe** o tipo `favorite.changed` nesta versão.

### F.6 Cancelamentos

Não há cancelamento pelo chat nesta versão. O backend da IA não tem acesso de escrita ao sistema oficial. Os cards de reserva e solicitação oficiais trazem o botão para Minhas Reservas ou Minhas Solicitações, onde o app já aplica as regras de janela (R-GAS-15, R-EXP-16, R-REQ-07, R-LAZ-06).

---

## G. Atualização de cards

### Cards de operação (`experience.booking.card`, `request.card`)

- **Chave:** `cardId`. Uma ação com um `cardId` já exibido **atualiza o card existente**: nunca crie um segundo.
- **Ordem:** compare `updatedAt` (ISO). Ignore uma atualização mais antiga que a exibida, para que uma resposta atrasada não reabra os botões.
- **Botões** existem só em `preview`. Em qualquer outro estado, `confirm` e `cancel` vêm `null`.
- **Histórico:** em `GET /chat/:id/messages`, cada card aparece **uma vez**, na mensagem em que foi criado, já com o estado atual. Uma pré-reserva vencida chega como `expired`. Reconstrua o mapa `cardId → card` a partir do histórico.

Merge sugerido (o mesmo de `mergeBookingCard`, estendido a `request.card`):

```ts
function mergeOperationCard(cards: Map<string, OperationCard>, incoming: OperationCard) {
  const current = cards.get(incoming.cardId);
  if (current && Date.parse(current.updatedAt) > Date.parse(incoming.updatedAt)) return; // resposta atrasada
  cards.set(incoming.cardId, incoming); // atualiza no lugar: a mensagem original re-renderiza
}
```

### Listas (`experience.options`, `restaurant.options`, `catalog.list`, `event.list`, `booking.list`, `request.list`, `menu.view`)

- Listas não mudam de estado: cada resposta traz uma lista nova.
- **Uma lista nova do mesmo tipo** (e, em `catalog.list`, do mesmo `kind`) **inativa a anterior**: deixe-a visível, mas desabilite os botões `message`. "Opção 2" sempre se refere à **última** lista apresentada. O servidor também resolve a posição pela última lista.
- Identidade dos itens: a coluna "Identidade" da seção D. Use-a como `key` do React e para cruzar com o catálogo do app (imagem, `existsBooking`).

---

## H. Estados e erros

| Estado | Origem | UI sugerida |
| --- | --- | --- |
| **Loading** | app, durante `POST /chat` | Bolha "Yago está digitando…". Bloqueie um segundo envio. Skeleton do carrossel se o último pedido costuma ter cards. |
| **Empty** | `actions` sem card + `reply` explicando ("Você não tem reservas…") | Só a bolha de texto. Listas nunca vêm vazias: sem itens, não há card. |
| **Pending** | `booking.list`/`request.list` com `status: 'pending'` | Selo laranja. |
| **Awaiting confirmation** | card de operação em `preview` | Botões Confirmar/Descartar e contagem até `expiresAt`. |
| **Confirming** | app (local) | Spinner, botões travados. |
| **Success** | card em `confirmed` | Código/protocolo (`SIM-…`) e o aviso de simulação. |
| **Failed** | card em `failed` | `reason` em destaque, sem botões. |
| **Expired** | card em `expired` | Card em cinza com `reason`. |
| **Cancelled** | card em `cancelled` | "Descartada", sem botões. |
| **Unavailable** | operação sem suporte no chat (restaurante, lazer, favoritos, cancelamentos) | `reply` explicativo + `navigate` para a tela que faz a operação. |
| **Unauthorized** | HTTP `401`/`403` | Tela de erro do chat (seção B). Não tente de novo automaticamente. |

---

## I. Exemplos completos

> IDs, nomes e valores abaixo são **fixtures fictícias**, mas respeitam os schemas validados pelo servidor.

### I.1 Restaurantes

`"Quais restaurantes vocês têm?"`

```json
{
  "reply": "Encontrei 3 restaurantes: Gino Praia Gastronomia, Restaurante Central e Omakase.",
  "conversationId": "3f1c2a4e-8b7d-4c1e-9a2f-6d5e4b3a2c10",
  "assistantMessageId": 120,
  "retrievedSources": [],
  "actions": [
    {
      "type": "restaurant.options",
      "label": "Ver restaurante",
      "options": [
        { "position": 1, "restaurantId": "rest-gino", "name": "Gino Praia Gastronomia", "type": "restaurante", "openingHours": null,
          "location": "Praia", "minimumAge": null, "acceptsReservations": true, "reservationTimes": ["19:00", "19:30"], "message": "Opção 1" },
        { "position": 2, "restaurantId": "rest-central", "name": "Restaurante Central", "type": "restaurante",
          "openingHours": "Almoço: 12h às 15h. Jantar: 19h às 22h", "location": null, "minimumAge": null,
          "acceptsReservations": false, "reservationTimes": [], "message": "Opção 2" },
        { "position": 3, "restaurantId": "rest-omakase", "name": "Omakase", "type": "restaurante", "openingHours": null,
          "location": null, "minimumAge": 12, "acceptsReservations": true, "reservationTimes": ["19:00"], "message": "Opção 3" }
      ]
    },
    { "type": "navigate", "label": "Abrir Gastronomia", "screen": "Gastronomy", "params": {} }
  ]
}
```

`"Quero conhecer o segundo"` → `restaurant.options` com 1 opção + `{ "type": "navigate", "label": "Ver restaurante", "screen": "Restaurant", "params": { "restaurantId": "rest-central" } }`.

### I.2 Cardápio

`"Mostre o cardápio dele"`

```json
{
  "reply": "Este é o cardápio de Gino Praia Gastronomia: 4 pratos em Entrada, Principal - Vegetariano e Sobremesa. Os pratos são escolhidos na reserva, pelo app.",
  "conversationId": "3f1c2a4e-8b7d-4c1e-9a2f-6d5e4b3a2c10",
  "assistantMessageId": 122,
  "retrievedSources": [],
  "actions": [
    {
      "type": "menu.view",
      "label": "Cardápio: Gino Praia Gastronomia",
      "restaurantId": "rest-gino",
      "restaurantName": "Gino Praia Gastronomia",
      "totalDishes": 4,
      "categories": [
        { "id": "cat-entrada", "name": "Entrada", "moreDishes": 0, "dishes": [
          { "id": "p1", "name": "Carpaccio", "description": "Fatias finas de filé.", "serves": null, "imagePath": "menu/3ff4543b.jpg" },
          { "id": "p2", "name": "Bruschetta", "description": null, "serves": 2, "imagePath": null }
        ] },
        { "id": "cat-veg", "name": "Principal - Vegetariano", "moreDishes": 0, "dishes": [
          { "id": "p3", "name": "Risoto de cogumelos", "description": null, "serves": null, "imagePath": null }
        ] },
        { "id": "cat-sobremesa", "name": "Sobremesa", "moreDishes": 0, "dishes": [
          { "id": "p4", "name": "Tiramisù", "description": null, "serves": null, "imagePath": null }
        ] }
      ],
      "buttons": [
        { "kind": "navigate", "label": "Abrir no app", "navigate": { "screen": "Restaurant", "params": { "restaurantId": "rest-gino" } } },
        { "kind": "navigate", "label": "Reservar", "navigate": { "screen": "Gastronomy", "params": { "restaurantId": "rest-gino" } } }
      ]
    }
  ]
}
```

### I.3 Experiências (com pré-reserva)

`"Quais experiências estão disponíveis amanhã?"`

```json
{
  "reply": "Para sábado, 24/10/2026, há vagas registradas em 2 experiências: Cidade Histórica / City Tour e Reserva da Jaqueira.\nObservação: as vagas vêm do snapshot do sistema do resort e podem não refletir a disponibilidade em tempo real.",
  "conversationId": "3f1c2a4e-8b7d-4c1e-9a2f-6d5e4b3a2c10",
  "retrievedSources": [],
  "actions": [
    {
      "type": "experience.options",
      "label": "Escolher experiência",
      "date": "2026-10-24",
      "options": [
        { "position": 1, "experienceId": "exp-city", "title": "Cidade Histórica / City Tour", "times": ["08:00"], "summary": "10 vagas", "message": "Opção 1" },
        { "position": 2, "experienceId": "exp-jaqueira", "title": "Reserva da Jaqueira", "times": ["09:00"], "summary": "10 vagas", "message": "Opção 2" }
      ]
    }
  ]
}
```

`"Para duas pessoas"` (depois de "Me mostre a segunda" e "Quero reservar essa"):

```json
{
  "reply": "Preparei a pré-reserva de Reserva da Jaqueira. Confira os detalhes no card e confirme pelo botão ou respondendo \"confirmo\". Considerei todos os participantes como adultos; se houver crianças, me avise antes de confirmar.",
  "conversationId": "3f1c2a4e-8b7d-4c1e-9a2f-6d5e4b3a2c10",
  "retrievedSources": [],
  "actions": [
    {
      "type": "experience.booking.card",
      "cardId": "9f9e9d9c-1111-4222-8333-444455556666",
      "status": "preview",
      "label": "Confirmar reserva simulada",
      "summary": { "experienceId": "exp-jaqueira", "experienceTitle": "Reserva da Jaqueira", "date": "2026-10-24", "time": "09:00",
                   "adults": 2, "children": 0, "totalPrice": 240, "currency": "BRL", "priceNote": null, "simulated": true },
      "notes": ["Menores de 18 anos precisam de um responsável."],
      "expiresAt": "2026-10-23T15:15:00.000Z",
      "booking": null,
      "reason": null,
      "confirm": { "method": "POST", "path": "/chat/actions", "body": { "type": "experience.booking.confirm", "conversationId": "3f1c2a4e-8b7d-4c1e-9a2f-6d5e4b3a2c10", "previewId": "9f9e9d9c-1111-4222-8333-444455556666" } },
      "cancel": { "method": "POST", "path": "/chat/actions", "body": { "type": "experience.booking.cancel", "conversationId": "3f1c2a4e-8b7d-4c1e-9a2f-6d5e4b3a2c10", "previewId": "9f9e9d9c-1111-4222-8333-444455556666" } },
      "updatedAt": "2026-10-23T15:05:00.000Z"
    }
  ]
}
```

`"Pode confirmar"` → o mesmo `cardId` com `"status": "confirmed"`, `"booking": { "bookingId": "7a7b7c7d-…", "confirmationCode": "SIM-TEST1234" }`, `"confirm": null`, `"cancel": null`.

### I.4 Eventos

`"O que tem hoje à noite?"`

```json
{
  "reply": "Para hoje à noite: Show de Circo (22:00) e Música ao vivo (23:00).",
  "conversationId": "3f1c2a4e-8b7d-4c1e-9a2f-6d5e4b3a2c10",
  "retrievedSources": [],
  "actions": [
    {
      "type": "event.list",
      "label": "Programação",
      "date": "2026-10-23",
      "items": [
        { "eventId": "evt-circo", "kind": "event", "title": "Show de Circo", "date": "2026-10-23", "time": "22:00", "location": "Teatro", "category": null, "description": null },
        { "eventId": "evt-mpb", "kind": "event", "title": "Música ao vivo", "date": "2026-10-23", "time": "23:00", "location": "Lounge Bar Park", "category": null, "description": "O melhor da MPB." }
      ]
    }
  ]
}
```

### I.5 Solicitações (criação)

`"Preciso de duas toalhas extras"`

```json
{
  "reply": "Preparei a solicitação simulada para Governança: 2x Toalha de banho. Confirme no card ou responda \"confirmo\".",
  "conversationId": "3f1c2a4e-8b7d-4c1e-9a2f-6d5e4b3a2c10",
  "retrievedSources": [],
  "actions": [
    {
      "type": "request.card",
      "cardId": "5b5c5d5e-1111-4222-8333-444455556666",
      "status": "preview",
      "label": "Confirmar solicitação simulada",
      "summary": { "departmentId": "3", "departmentName": "Governança", "items": [{ "itemId": "30", "name": "Toalha de banho", "quantity": 2 }],
                   "note": "Preciso de duas toalhas extras", "simulated": true },
      "notes": ["Atendimento: Das 7h às 22h"],
      "expiresAt": "2026-10-23T15:20:00.000Z",
      "request": null,
      "reason": null,
      "confirm": { "method": "POST", "path": "/chat/actions", "body": { "type": "request.confirm", "conversationId": "3f1c2a4e-8b7d-4c1e-9a2f-6d5e4b3a2c10", "previewId": "5b5c5d5e-1111-4222-8333-444455556666" } },
      "cancel": { "method": "POST", "path": "/chat/actions", "body": { "type": "request.cancel", "conversationId": "3f1c2a4e-8b7d-4c1e-9a2f-6d5e4b3a2c10", "previewId": "5b5c5d5e-1111-4222-8333-444455556666" } },
      "updatedAt": "2026-10-23T15:10:00.000Z"
    }
  ]
}
```

### I.6 Minhas Reservas

`"Tenho alguma reserva amanhã?"`

```json
{
  "reply": "Sim, você tem 2 reservas para amanhã: Cidade Histórica / City Tour (amanhã às 08:00) e Gino Praia Gastronomia (amanhã às 20:00).",
  "conversationId": "3f1c2a4e-8b7d-4c1e-9a2f-6d5e4b3a2c10",
  "retrievedSources": [],
  "actions": [
    {
      "type": "booking.list",
      "label": "Minhas reservas",
      "items": [
        { "bookingId": "rx-city", "kind": "experience", "title": "Cidade Histórica / City Tour", "date": "2026-10-24", "time": "08:00",
          "status": "confirmed", "statusLabel": "Confirmada", "people": 2, "simulated": false, "confirmationCode": null,
          "buttons": [{ "kind": "navigate", "label": "Ver em Minhas Reservas", "navigate": { "screen": "MyReservation", "params": { "tab": "Experience" } } }] },
        { "bookingId": "res-gino", "kind": "restaurant", "title": "Gino Praia Gastronomia", "date": "2026-10-24", "time": "20:00",
          "status": "confirmed", "statusLabel": "Confirmada", "people": 2, "simulated": false, "confirmationCode": null,
          "buttons": [{ "kind": "navigate", "label": "Ver em Minhas Reservas", "navigate": { "screen": "MyReservation", "params": { "tab": "Gastronomy" } } }] }
      ]
    },
    { "type": "navigate", "label": "Abrir Minhas Reservas", "screen": "MyReservation", "params": { "tab": "Gastronomy" } }
  ]
}
```

### I.7 Minhas Solicitações

`"Quais são minhas solicitações?"`

```json
{
  "reply": "Sua solicitação de Governança (Toalha de banho), aberta em 23/10/2026 09:15, está pendente. Inscrições de lazer: 1 (1 pendente).",
  "conversationId": "3f1c2a4e-8b7d-4c1e-9a2f-6d5e4b3a2c10",
  "retrievedSources": [],
  "actions": [
    {
      "type": "request.list",
      "label": "Minhas solicitações",
      "items": [
        { "requestId": "sol-1", "kind": "department", "title": "Governança", "items": ["Toalha de banho"], "status": "pending", "statusLabel": "Pendente",
          "date": "2026-10-23", "time": "09:15", "simulated": false, "protocol": null,
          "buttons": [{ "kind": "navigate", "label": "Ver em Minhas Solicitações", "navigate": { "screen": "MyRequests", "params": {} } }] },
        { "requestId": "lz-1", "kind": "leisure", "title": "Recreação: 4 a 7 anos", "items": [], "status": "pending", "statusLabel": "Pendente",
          "date": "2026-10-22", "time": null, "simulated": false, "protocol": null,
          "buttons": [{ "kind": "navigate", "label": "Ver em Minhas Solicitações", "navigate": { "screen": "MyRequests", "params": {} } }] }
      ]
    },
    { "type": "navigate", "label": "Abrir Minhas Solicitações", "screen": "MyRequests", "params": {} }
  ]
}
```

### I.8 Favoritos

`"Mostre meus favoritos"`

```json
{
  "reply": "Você tem 2 eventos favoritos pela frente: Show de Circo (amanhã às 22:00) e Música ao vivo (domingo, 25/10 às 23:00).",
  "conversationId": "3f1c2a4e-8b7d-4c1e-9a2f-6d5e4b3a2c10",
  "retrievedSources": [],
  "actions": [
    {
      "type": "catalog.list",
      "label": "Seus favoritos",
      "kind": "event",
      "items": [
        { "id": "evt-circo", "position": 1, "title": "Show de Circo", "description": null, "imagePath": null,
          "meta": { "date": "2026-10-24", "time": "22:00", "location": "Teatro" }, "badges": ["Favorito"],
          "buttons": [
            { "kind": "message", "label": "Ver detalhes", "message": "Opção 1" },
            { "kind": "navigate", "label": "Ver em Eventos", "navigate": { "screen": "Events", "params": { "date": "2026-10-24" } } }
          ] },
        { "id": "evt-mpb", "position": 2, "title": "Música ao vivo", "description": null, "imagePath": null,
          "meta": { "date": "2026-10-25", "time": "23:00" }, "badges": ["Favorito"],
          "buttons": [
            { "kind": "message", "label": "Ver detalhes", "message": "Opção 2" },
            { "kind": "navigate", "label": "Ver em Eventos", "navigate": { "screen": "Events", "params": { "date": "2026-10-25" } } }
          ] }
      ]
    },
    { "type": "navigate", "label": "Abrir Meus Favoritos", "screen": "MyFavorites", "params": {} }
  ]
}
```

### I.9 SPA (e item escolhido)

`"Quais massagens o spa oferece?"`

```json
{
  "reply": "Massagens: Massagem Relaxante e Drenagem Linfática. Pergunte o valor de qualquer um. O agendamento é feito pelo SPA.",
  "conversationId": "3f1c2a4e-8b7d-4c1e-9a2f-6d5e4b3a2c10",
  "retrievedSources": [],
  "actions": [
    {
      "type": "catalog.list",
      "label": "SPA",
      "kind": "spa_service",
      "items": [
        { "id": "1", "position": 1, "title": "Massagem Relaxante", "description": null, "imagePath": null,
          "meta": { "duration": "50 min R$ 250,00; 30 min R$ 180,00", "category": "Massagens" }, "badges": [],
          "buttons": [
            { "kind": "message", "label": "Ver detalhes", "message": "Opção 1" },
            { "kind": "navigate", "label": "Ver SPA", "navigate": { "screen": "Spa", "params": {} } }
          ] },
        { "id": "2", "position": 2, "title": "Drenagem Linfática", "description": null, "imagePath": null,
          "meta": { "price": "R$ 200,00", "duration": "60 min", "category": "Massagens" }, "badges": [],
          "buttons": [
            { "kind": "message", "label": "Ver detalhes", "message": "Opção 2" },
            { "kind": "navigate", "label": "Ver SPA", "navigate": { "screen": "Spa", "params": {} } }
          ] }
      ]
    },
    { "type": "navigate", "label": "Abrir SPA", "screen": "Spa", "params": {} }
  ]
}
```

`"Me fala da segunda"` → `"Drenagem Linfática: R$ 200,00, 60 min. O agendamento é feito pelo SPA."` + `catalog.list` com 1 item (sem botão "Ver detalhes") + `navigate Spa`.

### I.10 Boutique, Dicas, ESG e Quiz

```json
{ "type": "catalog.list", "label": "Boutique", "kind": "product", "items": [
  { "id": "1", "position": 1, "title": "Protetor solar FPS 50", "description": null, "imagePath": null,
    "meta": { "price": "R$ 59,90", "category": "Praia" }, "badges": [],
    "buttons": [{ "kind": "message", "label": "Ver detalhes", "message": "Opção 1" }, { "kind": "navigate", "label": "Ver na Boutique", "navigate": { "screen": "Boutique", "params": {} } }] } ] }
```

```json
{ "type": "catalog.list", "label": "Dicas", "kind": "tip", "items": [
  { "id": "1", "position": 1, "title": "Águas-vivas", "description": "Evite tocar; lave com água do mar, nunca com água doce.", "imagePath": null,
    "meta": {}, "badges": [], "buttons": [{ "kind": "navigate", "label": "Abrir Dicas", "navigate": { "screen": "Tips", "params": {} } }] } ] }
```

```json
{ "type": "catalog.list", "label": "Sustentabilidade", "kind": "esg", "items": [
  { "id": "esg-1", "position": 1, "title": "ESG", "description": "O resort separa resíduos, usa energia solar e protege a restinga.", "imagePath": null,
    "meta": {}, "badges": [], "buttons": [{ "kind": "navigate", "label": "Abrir ESG", "navigate": { "screen": "Esg", "params": {} } }] } ] }
```

```json
{ "type": "catalog.list", "label": "Quiz", "kind": "quiz", "items": [
  { "id": "1", "position": 1, "title": "Quiz do Mar", "description": null, "imagePath": null,
    "meta": { "category": "Natureza" }, "badges": ["Ao vivo", "10 perguntas"],
    "buttons": [{ "kind": "navigate", "label": "Jogar no app", "navigate": { "screen": "Quiz", "params": {} } }] } ] }
```

---

## J. Checklist de implementação mobile

1. **Tipagem.** Copie as interfaces das seções C.1–C.10 para `services/concierge/chatApi.types.ts`. Amplie `NavigateAction["params"]` e a união `ChatAction`.
2. **Parsing.** Inclua `catalog.list`, `menu.view`, `booking.list` e `request.list` em `KNOWN_ACTION_TYPES`. Valide no cliente o mínimo para renderizar (tipo, arrays presentes, IDs string). Item inválido: descarte só o item. Tipo desconhecido: ignore a ação.
3. **Registro de componentes.** Um mapa `type` (e `kind` em `catalog.list`) → componente (seção D). Uma ação sem componente não quebra a mensagem.
4. **Cards.** Implemente `MenuCard`, `BookingCard`, `RequestStatusCard`, `SpaServiceCard`, `BoutiqueProductCard`, `TipCard`, `EsgCard`, `QuizCard` e `FavoriteCard`. Reaproveite o layout de `ConciergeCard`, `CardEvent`, `CardDepartment` e `CardSubscription`. Use `imagePath` com `EXPO_PUBLIC_BUCKET`, e fallback local.
5. **Carrosséis.** `restaurant.options`, `experience.options` e `catalog.list` em carrossel horizontal. `booking.list`, `request.list` e `event.list` em lista vertical. Ao receber uma lista nova do mesmo tipo (e `kind`), inative a anterior.
6. **Botões.** `CardButton.kind === 'message'`: envie `message` em `POST /chat` (mesma conversa) e mostre-o como fala do hóspede. `kind === 'navigate'`: use o mesmo resolvedor do `NavigateAction`.
7. **Navegação.** Amplie `CHAT_SCREEN_ROUTES` com `Restaurant`, `Experience`, `Events {date}`, `MyReservation {tab}`, `MyRequests`, `MyFavorites` (seção E). Valide os IDs no cache antes de navegar.
8. **Operações.** Mantenha o fluxo de `experience.booking.card` e estenda o mesmo componente/merge a `request.card` (`request.confirm` / `request.cancel`). Envie `confirm.body` / `cancel.body` sem alterar.
9. **Confirmações.** Estado local `confirming` com botões travados até a resposta. Exiba o estado do card devolvido, não o `status` HTTP.
10. **Erros.** Trate `400/401/403/404/409/5xx` conforme a seção B. Em `404` de `/chat`, comece uma conversa nova. Em `404` de `/chat/actions`, remova o card.
11. **Atualização de mensagens e cards.** Mapa `cardId → card` com a regra de `updatedAt` (seção G). Na reabertura, reconstrua com `GET /chat/:id/messages`. Depois de um `confirmed`, invalide as queryKeys afetadas quando a operação for real (hoje são simuladas: `["bookingExperience"]` e `["order"]` não mudam).
12. **Testes.** Fixtures desta seção I como testes de parsing e renderização. Tipos desconhecidos ignorados. Merge por `cardId` com `updatedAt` fora de ordem. Botão `message` envia o texto exato. Navegação recusa tela ou param inválido. Simuladas sempre marcadas como "Simulação".
