# Integração do chat do app Yago com a Yago AI API

Contrato para implementar a tela de chat do Yago (concierge) no aplicativo React Native.

> **Status: MVP de demonstração.** A API ainda não valida o token do app. O hóspede é identificado pelo header `X-Demo-Guest-Id` e só são aceitas conexões locais. Reservas de experiências feitas pelo chat são **simuladas** e não vão para o sistema oficial do resort. Leia a seção 11 antes de usar com qualquer dado real.

---

## 0. O que muda no aplicativo nesta versão

O Yago passou a responder de forma curta e a enviar listas como **cards**. O campo `reply` traz só um resumo; os itens de uma lista vêm em `actions`. Os campos `reply`, `conversationId`, `retrievedSources` e `actions` não mudaram, nem o fluxo de confirmação de reservas (`experience.booking.card`, `POST /chat/actions`, "confirmo").

Alterações **obrigatórias** no React Native:

1. **Renderizar `experience.options` (seção 4.3).** O `reply` não traz mais a lista numerada de experiências, só um resumo ("Separei 3 experiências: A, B e C."). Sem o card, o hóspede não vê horários nem vagas. Exiba `title`, `times` e o novo campo `summary` de cada opção.
2. **Renderizar o novo `restaurant.options` (seção 4.4).** Listas de restaurantes, bares e lanches chegam como cards. Ao tocar, envie `option.message` em `POST /chat`, como em `experience.options`. O botão `navigate` para a Gastronomia continua na mesma resposta.
3. **Renderizar o novo `event.list` (seção 4.5).** A programação do dia (eventos, shows e lazer) chega como uma lista de cards somente leitura.
4. **Adicionar os novos tipos à lista de tipos conhecidos** (`KNOWN_ACTION_TYPES`, seção 12). Hoje a referência só aceita `navigate` e `experience.booking.card` e descartaria os demais.
5. **Ordem de exibição:** bolha com o `reply` e, logo abaixo, os cards da mesma resposta.
6. **Histórico:** `GET /chat/:id/messages` devolve os mesmos tipos em `messages[].actions`. Aplique o mesmo renderizador.
7. **Timeout e "digitando…":** saudações, agradecimentos, cards de restaurantes, eventos e experiências respondem em menos de 1 s. Perguntas abertas que usam o modelo local levam de 2 a 10 s. Mantenha o timeout de 180 s e o indicador "digitando…".

Nada precisa mudar no envio de mensagens, nos headers, no `conversationId` nem no card de reserva.

---

## 1. Visão geral

| Método | Rota | Uso |
| --- | --- | --- |
| `POST` | `/chat` | Envia uma mensagem e recebe a resposta do Yago, com ações opcionais. |
| `POST` | `/chat/actions` | Executa uma ação de botão, como confirmar ou descartar uma pré-reserva. |
| `GET` | `/chat/:conversationId/messages` | Carrega o histórico de uma conversa. |

O backend escolhe sozinho entre:

- **conhecimento do resort**, via RAG com dados reais (restaurantes, experiências, lazer, eventos, spa, serviços);
- **operações do hóspede**, consultando o banco do resort (reservas de restaurante, solicitações, experiências).

O app não decide nada disso: sempre chama `POST /chat`.

Fluxo típico:

```text
1ª mensagem        → POST /chat { message }                  → salvar conversationId
próximas           → POST /chat { message, conversationId }  → mesmo contexto
botão de uma ação  → POST /chat/actions { type, conversationId, previewId }
reabrir a tela     → GET  /chat/{conversationId}/messages
```

---

## 2. Conexão e autenticação de demonstração

### Base URL

A porta padrão é `3000`. O servidor escuta apenas em `127.0.0.1`.

| Ambiente | Base URL |
| --- | --- |
| Simulador iOS | `http://localhost:3000` |
| Emulador Android | `http://10.0.2.2:3000` |
| Aparelho Android via USB | `adb reverse tcp:3000 tcp:3000` e `http://localhost:3000` |
| Aparelho na rede Wi-Fi | **Não suportado** no modo de demonstração (o servidor não aceita conexões de rede). |

Libere HTTP sem TLS apenas no build de desenvolvimento:

- **Android:** `usesCleartextTraffic` ou `network_security_config`.
- **iOS:** `NSAllowsLocalNetworking`.

### Headers

| Header | Valor | Obrigatório |
| --- | --- | --- |
| `Content-Type` | `application/json` | Sim, nos `POST` |
| `X-Demo-Guest-Id` | `loggedUser.guestHolder.id`, o UUID do **titular** da hospedagem | **Sim, em todas as requisições** |
| `X-Demo-Secret` | Segredo da sessão de demonstração | Só quando o backend configurar `DEMO_SHARED_SECRET` |

- **Não envie** `X-Resort-Id` nem `X-Guest-Id`: a requisição é recusada com `401`. O resort é definido pelo servidor (`RESORT_ID`).
- Use `guestHolder.id`, não `loggedUser.guestId`. A API valida que o ID pertence a um **titular** com hospedagem ativa (da véspera do check-in até o check-out).
- Centralize os headers em um único ponto, por exemplo um interceptor. Quando a autenticação real chegar, `X-Demo-Guest-Id` será substituído pelo token do app.
- Não registre esse header em logs de rede (Flipper, Reactotron, OkHttp).

### Timeout

Perguntas abertas sobre o resort usam um modelo local e levam de 2 a 10 s (mais na primeira pergunta depois de iniciar o servidor). Use timeout de **180 s** em `POST /chat`. Saudações, agradecimentos, reservas, experiências, restaurantes e eventos não usam o modelo generativo e respondem em menos de 1 s.

---

## 3. `POST /chat`

### Body

```json
{
  "message": "Quais experiências posso fazer amanhã?",
  "conversationId": "3f1c2a4e-8b7d-4c1e-9a2f-6d5e4b3a2c10"
}
```

| Campo | Tipo | Regras |
| --- | --- | --- |
| `message` | string | Obrigatório, não vazio, até 2000 caracteres. |
| `conversationId` | UUID v4 | Omita na primeira mensagem. Nas seguintes, envie o valor retornado. |

Campos extras são rejeitados com `400`.

### Resposta `201 Created`: `ChatResponse`

```ts
interface ChatResponse {
  reply: string;                       // texto do Yago (pode ter quebras de linha)
  conversationId: string;              // salve este valor
  retrievedSources: RetrievedSource[]; // depuração; não precisa ser exibido
  actions: ChatAction[];               // sempre presente; [] na maioria das respostas
}

interface RetrievedSource {
  id: string;
  title: string;
  distance: number | null;
}
```

Compatibilidade:

- Respostas de conversa e de conhecimento retornam `actions: []`.
- O `reply` é curto: 1 ou 2 frases em interações sociais e um resumo quando há cards. **Listas não vêm mais no texto**: sem renderizar `experience.options`, `restaurant.options` e `event.list`, o hóspede só vê o resumo.
- O `reply` continua explicando como confirmar uma pré-reserva digitando "confirmo".
- Ignore tipos de ação que o app não conheça.

### Uso de `conversationId`

- A conversa guarda o **contexto**: a experiência escolhida, a data, os participantes e a pré-reserva pendente. Isso permite perguntas como "Gostei da segunda", "Tem para duas pessoas?", "Quanto custa?" e "Pode reservar".
- Sempre reenvie o `conversationId` da conversa aberta. Sem ele, o Yago perde o contexto.
- Uma conversa só é acessível pelo mesmo titular que a criou. Para qualquer outro, a API responde `404`.

---

## 4. Ações (`ChatAction`)

`ChatAction` é uma união discriminada pelo campo `type`. Todas as ações são montadas e validadas pelo servidor. O conteúdo gerado pelo modelo nunca cria ações nem escolhe telas.

```ts
type ChatAction =
  | NavigateAction
  | ExperienceBookingCardAction
  | ExperienceOptionsAction
  | RestaurantOptionsAction   // novo
  | EventListAction;          // novo

interface ExperienceBookingSummary {
  experienceId: string;
  experienceTitle: string;
  date: string;              // AAAA-MM-DD, no fuso do resort
  time: string | null;       // HH:MM; null = vaga para o dia, sem horário
  adults: number;
  children: number;
  totalPrice: number | null; // calculado no servidor; null = não foi possível calcular
  currency: 'BRL';
  priceNote: string | null;  // motivo quando totalPrice é null
  simulated: true;           // sempre true no MVP
}
```

### 4.1 `navigate`: abrir Gastronomia

```ts
interface NavigateAction {
  type: 'navigate';
  label: string;            // texto do botão, ex.: "Abrir Gastronomia"
  screen: 'Gastronomy';     // lista fechada no servidor
  params: { restaurantId?: string }; // ID real de tb_restaurante, quando identificado
}
```

- `screen: 'Gastronomy'` é **provisório**. Mapeie para a rota real do app em um único lugar, por exemplo `{ Gastronomy: 'GastronomiaScreen' }`.
- Telas fora do mapa devem ser ignoradas.
- Use `params.restaurantId` para abrir direto no restaurante. Sem ele, abra a lista de Gastronomia.

### 4.2 `experience.booking.card`: card único da reserva

> **Mudança de contrato.** Substitui `experience.booking.preview` e `experience.booking.confirm`. O servidor não envia mais esses dois tipos. Um app desatualizado ignora o tipo novo e mostra só o texto.

Cada reserva simulada tem **um único card**, identificado por `cardId` (o ID da pré-reserva). O `cardId` não muda durante o ciclo inteiro. Toda ação com um `cardId` já exibido **atualiza esse card**, em vez de criar outro.

```ts
type BookingCardStatus = 'preview' | 'confirming' | 'confirmed' | 'expired' | 'failed' | 'cancelled';

interface ExperienceBookingCardAction {
  type: 'experience.booking.card';
  cardId: string;                 // UUID estável (= previewId)
  status: BookingCardStatus;
  label: string;                  // texto do estado, ex.: "Confirmar reserva simulada"
  summary: ExperienceBookingSummary;
  notes: string[];                // avisos do cadastro (idade mínima, responsável, simulação…)
  expiresAt: string | null;       // ISO 8601 UTC, só em "preview"
  booking: { bookingId: string; confirmationCode: string } | null; // só em "confirmed"
  reason: string | null;          // motivo em "expired", "failed" e "cancelled"
  confirm: { method: 'POST'; path: '/chat/actions'; body: { type: 'experience.booking.confirm'; conversationId: string; previewId: string } } | null;
  cancel:  { method: 'POST'; path: '/chat/actions'; body: { type: 'experience.booking.cancel';  conversationId: string; previewId: string } } | null;
  updatedAt: string;              // ISO 8601 UTC do último estado
}
```

| `status` | Quem define | Como exibir | Botões |
| --- | --- | --- | --- |
| `preview` | servidor | resumo, `notes` e prazo (`expiresAt`) | Confirmar (`confirm`) e Cancelar (`cancel`) |
| `confirming` | **app**, ao tocar em Confirmar | mesmo card, com indicador de carregamento | desabilitados |
| `confirmed` | servidor | selo "Reserva simulada confirmada" e `booking.confirmationCode` | nenhum |
| `expired` | servidor | "Pré-reserva expirada" e `reason` | nenhum (o hóspede pode pedir outra) |
| `failed` | servidor | "Não foi possível confirmar" e `reason` | nenhum |
| `cancelled` | servidor | "Pré-reserva descartada" | nenhum |

**Como o app atualiza o card:**

1. Guarde os cards em um mapa `cardId → card`, por conversa. Cada card fica na posição da primeira mensagem que o trouxe.
2. Ao receber qualquer `experience.booking.card` (em `POST /chat`, `POST /chat/actions` ou no histórico):
   - se o `cardId` já existe, **substitua** o card no mesmo lugar, sem inserir outro na lista;
   - se não existe, insira-o na mensagem atual.
3. Use `updatedAt` para ignorar uma resposta mais antiga que chegue depois. O servidor envia sempre ISO 8601 UTC com milissegundos (`2026-10-23T18:54:02.120Z`); compare como data. Enquanto um pedido de confirmação ou descarte estiver em andamento, ignore outras atualizações desse `cardId`: só a resposta do próprio pedido muda o card.
4. Mantenha as `notes` já exibidas quando a atualização chegar com `notes: []`. As respostas de confirmação e descarte não repetem os avisos; o histórico já os devolve completos.
5. Ao tocar em Confirmar, mude o card localmente para `confirming` e envie `confirm.body` para `confirm.path`, sem alterar nada no body.
   - A resposta traz o mesmo `cardId` com o novo estado: em geral `confirmed`, `expired` ou `failed`. Se outra confirmação do mesmo horário estiver em andamento, o card volta como `preview` e o hóspede pode tentar de novo. Exiba sempre o `status` do card.
   - Em erro de rede, volte para `preview`. O servidor é idempotente: confirmar de novo não cria outra reserva.
6. Cancelar funciona da mesma forma com `cancel.body` e termina em `cancelled`.
7. Quando `expiresAt` passar, desabilite os botões localmente. O servidor devolve `expired` na próxima consulta.
8. Se o hóspede confirmar **por texto** ("confirmo"), a resposta de `POST /chat` traz o mesmo `cardId` como `confirmed`, e o card existente é atualizado.

### 4.3 `experience.options`: experiências selecionáveis

Retornada quando a resposta apresenta uma lista numerada de experiências, seja o catálogo, uma busca de vagas ou nomes ambíguos. As opções têm a mesma ordem e a mesma numeração do texto de `reply`.

```ts
interface ExperienceOptionsAction {
  type: 'experience.options';
  label: string;          // "Escolher experiência"
  date: string | null;    // AAAA-MM-DD consultada; null = catálogo sem data
  options: {
    position: number;     // 1, 2, 3… (igual ao texto)
    experienceId: string; // id do cadastro do resort
    title: string;
    times: string[];      // HH:MM com vaga registrada na data; vazio = sem horário cadastrado
    summary: string | null; // novo: resumo verificado para o card (até 160 caracteres)
    message: string;      // texto a enviar ao tocar, ex.: "Opção 2"
  }[];
}
```

- `summary` traz o que antes ficava no texto: vagas por horário numa busca com data ("às 09:00: 10 vaga(s) para adultos e 10 para crianças") ou, no catálogo sem data, "Com reserva", "Sem necessidade de reserva", "sem cobrança" e a idade mínima. Pode ser `null`.
- **Ao tocar:** envie `option.message` como uma mensagem normal em `POST /chat`, com o mesmo `conversationId`. O servidor resolve a posição pela lista guardada na conversa, e o app não precisa enviar o `experienceId`.
- Use o botão da **última** resposta que trouxe a ação: uma nova busca substitui a lista guardada.
- **Renderização obrigatória:** o `reply` cita no máximo três nomes ("Separei 5 experiências: A, B, C e mais 2."). Horários, vagas e regras estão só no card.

### 4.4 `restaurant.options`: restaurantes, bares e lanches (novo)

Retornada em listas de gastronomia ("Quais restaurantes estão abertos à noite?", "Tem restaurante japonês?", "E os bares?") e nos detalhes de um restaurante (um único item). Vem acompanhada de `navigate` para a Gastronomia.

```ts
interface RestaurantOptionsAction {
  type: 'restaurant.options';
  label: string;                 // "Ver restaurante"
  options: {
    position: number;            // 1, 2, 3… na ordem da lista
    restaurantId: string;        // id real de tb_restaurante (o mesmo de navigate.params.restaurantId)
    name: string;
    type: 'restaurante' | 'bar' | 'alimentacao' | null;
    openingHours: string | null; // texto do cadastro, ex.: "10h às 18h"; null = não cadastrado
    location: string | null;
    minimumAge: number | null;
    acceptsReservations: boolean; // reserva pelo app (Gastronomia, com seleção de pratos)
    reservationTimes: string[];  // turnos de reserva HH:MM; pode ser vazio
    message: string;             // texto a enviar ao tocar, ex.: "Opção 2"
  }[];                           // 1 a 20 itens
}
```

- **Ao tocar no card:** envie `option.message` em `POST /chat` com o mesmo `conversationId`. O Yago responde com os detalhes daquele restaurante.
- **Reservar:** use o botão `navigate` da resposta (com `restaurantId` quando há um restaurante identificado). Se quiser um atalho no próprio card, navegue para a Gastronomia com `option.restaurantId` quando `acceptsReservations` for `true`.
- Exiba `openingHours` como texto, sem interpretar. Quando for `null`, mostre "Horário não cadastrado".
- Filtros da pergunta (tipo, cozinha, "com reserva", horário, período, "agora") já vêm aplicados pelo servidor. Restaurantes sem horário cadastrado nunca aparecem como "abertos": o `reply` os cita à parte.

### 4.5 `event.list`: programação do dia (novo)

Retornada para perguntas sobre eventos, shows e programação ("O que tem hoje à noite?", "Tem show amanhã?", "E no sábado?"). É somente leitura: não há botão nem mensagem a enviar.

```ts
interface EventListAction {
  type: 'event.list';
  label: string;              // "Programação"
  date: string;               // AAAA-MM-DD consultada
  items: {
    eventId: string;          // id do evento (tb_evento) ou da atividade (tb_programacaolazer)
    kind: 'event' | 'leisure'; // evento/show daquela data ou atividade semanal de lazer
    title: string;
    date: string;             // AAAA-MM-DD
    time: string | null;      // HH:MM; null = sem horário cadastrado
    location: string | null;
    category: string | null;  // categoria de lazer, ex.: "Esportes"; null em eventos
    description: string | null; // resumo de até 240 caracteres
  }[];                        // 1 a 30 itens, em ordem de horário
}
```

- Exiba a lista em ordem, com `time`, `title` e `location`. Use `kind` para destacar shows e eventos (`event`) em relação à recreação (`leisure`).
- Para hoje, atividades que já passaram não são enviadas.
- O `reply` resume ("Para hoje à noite, há 2 eventos e 4 atividades de lazer na programação. Destaques: …") ou responde direto quando o hóspede cita um evento ("Show de Circo: hoje às 22:00, em Park Lounge.").

---

## 5. `POST /chat/actions`

Executa ações de botão. O servidor lê a pré-reserva **persistida**. O app nunca envia data, valor ou participantes.

### Body

```json
{
  "type": "experience.booking.confirm",
  "conversationId": "3f1c2a4e-8b7d-4c1e-9a2f-6d5e4b3a2c10",
  "previewId": "a7e3e8d1-7f15-47fa-a82b-57b49ee92fea"
}
```

| Campo | Valores |
| --- | --- |
| `type` | `experience.booking.confirm` ou `experience.booking.cancel` |
| `conversationId` | UUID v4 da conversa |
| `previewId` | `cardId` do card (o mesmo valor já vem pronto em `confirm.body` e `cancel.body`; envie o body sem alterá-lo) |

Qualquer outro campo (por exemplo `totalPrice`) é rejeitado com `400`.

### Resposta `200 OK`

```ts
interface ChatActionResponse extends ChatResponse {
  status:
    | 'confirmed'          // reserva simulada criada
    | 'already_confirmed'  // repetição: retorna a mesma reserva (idempotente)
    | 'cancelled'          // pré-reserva descartada
    | 'expired'            // passou de expiresAt: peça uma nova
    | 'unavailable'        // revalidação falhou (vagas, regras, estadia)
    | 'changed';           // o valor mudou desde a pré-reserva: peça uma nova
}
```

- `actions` traz o **mesmo card** (mesmo `cardId`) no novo estado: `confirmed`, `expired`, `failed` ou `cancelled`. Atualize o card existente (seção 4.2), sem criar outro.
- **Exiba o estado do card, não o `status` da resposta.** O `status` resume o resultado da chamada; o card já traz o estado final:

  | `status` da resposta | `status` do card |
  | --- | --- |
  | `confirmed`, `already_confirmed` | `confirmed` |
  | `cancelled` | `cancelled` |
  | `expired` | `expired` |
  | `unavailable`, `changed` | `failed` (com `reason`) |

  Em `unavailable` causado por concorrência momentânea (outra confirmação do mesmo horário em andamento), o card continua `preview` e o hóspede pode tentar de novo.
- A resposta também é gravada no histórico da conversa, como mensagem do assistente.
- Confirmar duas vezes, por exemplo com um toque duplo ou um retry de rede, **não** cria duas reservas.
- **Revalidação antes de confirmar:**
  - experiência ativa e vaga ainda disponível;
  - data dentro da estadia;
  - valor inalterado;
  - **horário ainda não passado** no fuso do resort;
  - para reservas do mesmo dia, horário-limite de marcação cadastrado ainda não atingido.

### Histórico: `GET /chat/:conversationId/messages`

Cada mensagem do assistente traz `actions`, com o mesmo formato de `POST /chat`:

```ts
interface HistoryMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  actions: ChatAction[];   // vazio em mensagens sem ações
  createdAt: string;
}
```

- **Cards no histórico:** cada card aparece **uma única vez**, na mensagem em que foi criado (a da pré-reserva), já com o **estado atual** lido do servidor. Uma reserva confirmada aparece como `confirmed`, e uma pré-reserva vencida como `expired`.
- **Reabrir uma conversa:** reconstrua a lista com essas mensagens e popule o mapa `cardId → card` a partir delas.
- `404` significa conversa ou pré-reserva inexistente, ou pertencente a outro hóspede.

O hóspede também pode confirmar **por texto**: "confirmo", "sim" ou "pode confirmar". O efeito é o mesmo do botão. A confirmação por texto continua valendo depois de conversa ou de perguntas gerais ("Obrigado!", "Que horas abre o spa?"), mas deixa de valer depois de outra operação: nova busca ou pré-reserva de experiência, lista de restaurantes, programação, reservas ou solicitações. Assim, um "sim" a "Quer ver todas?" nunca confirma uma reserva. Nesse caso, "confirmo" recebe "Não há uma pré-reserva aguardando confirmação por texto. Se ela ainda aparece no card, confirme pelo botão." O botão do card continua funcionando até `expiresAt`.

---

## 6. Experiências: fluxo conversacional

Exemplo real com dados do snapshot. O hóspede é um titular de teste.

**1. Hóspede:** "Quais experiências posso fazer amanhã?"

```json
{
  "reply": "Para sábado, 24/10/2026, há vagas registradas em 1 experiência: Reserva da Jaqueira.\nSem necessidade de reserva: Mágica da Mente, Circo Show 4+ e Ritual da Lua Cheia.\nObservação: as vagas vêm do snapshot do sistema do resort e podem não refletir a disponibilidade em tempo real.",
  "conversationId": "bb39a64c-3af7-4976-abe0-4ab8500e7536",
  "retrievedSources": [],
  "actions": [
    {
      "type": "experience.options",
      "label": "Escolher experiência",
      "date": "2026-10-24",
      "options": [
        { "position": 1, "experienceId": "ee86bdf8-6ed4-4ea9-bc64-1b2a909ce56f", "title": "Reserva da Jaqueira", "times": [], "summary": "horário não especificado (vaga para o dia): 10 vaga(s) para adultos e 10 para crianças", "message": "Opção 1" }
      ]
    }
  ]
}
```

**2. "Gostei da primeira."** O Yago mostra descrição, valores e regras da experiência.

**3. "Tem para duas pessoas?"** O Yago confirma que há vagas e avisa que considerou 2 adultos.

**4. "Quanto custa?"** Resposta: "Reserva da Jaqueira para 2 adultos: R$ 240,00."

**5. "Pode reservar."** O texto é curto: data, valor e avisos ficam no card.

```json
{
  "reply": "Preparei a pré-reserva de Reserva da Jaqueira. Confira os detalhes no card e confirme pelo botão ou respondendo \"confirmo\".",
  "conversationId": "bb39a64c-3af7-4976-abe0-4ab8500e7536",
  "retrievedSources": [],
  "actions": [
    {
      "type": "experience.booking.card",
      "cardId": "a7e3e8d1-7f15-47fa-a82b-57b49ee92fea",
      "status": "preview",
      "label": "Confirmar reserva simulada",
      "summary": {
        "experienceId": "ee86bdf8-6ed4-4ea9-bc64-1b2a909ce56f",
        "experienceTitle": "Reserva da Jaqueira",
        "date": "2026-10-24",
        "time": null,
        "adults": 2,
        "children": 0,
        "totalPrice": 240,
        "currency": "BRL",
        "priceNote": null,
        "simulated": true
      },
      "notes": [
        "Menores de 18 anos precisam de um responsável.",
        "Esta é uma reserva simulada para demonstração; ela não foi registrada no sistema oficial do resort."
      ],
      "expiresAt": "2026-10-23T19:08:18.835Z",
      "booking": null,
      "reason": null,
      "confirm": {
        "method": "POST",
        "path": "/chat/actions",
        "body": { "type": "experience.booking.confirm", "conversationId": "bb39a64c-3af7-4976-abe0-4ab8500e7536", "previewId": "a7e3e8d1-7f15-47fa-a82b-57b49ee92fea" }
      },
      "cancel": {
        "method": "POST",
        "path": "/chat/actions",
        "body": { "type": "experience.booking.cancel", "conversationId": "bb39a64c-3af7-4976-abe0-4ab8500e7536", "previewId": "a7e3e8d1-7f15-47fa-a82b-57b49ee92fea" }
      },
      "updatedAt": "2026-10-23T18:53:18.835Z"
    }
  ]
}
```

**6. Botão "Confirmar"** (`POST /chat/actions`), ou o hóspede digita "confirmo". O **mesmo** `cardId` volta como `confirmed`, e o app atualiza o card existente:

```json
{
  "reply": "Pronto! Sua reserva simulada de Reserva da Jaqueira está confirmada. O código está no card.",
  "conversationId": "bb39a64c-3af7-4976-abe0-4ab8500e7536",
  "retrievedSources": [],
  "actions": [
    {
      "type": "experience.booking.card",
      "cardId": "a7e3e8d1-7f15-47fa-a82b-57b49ee92fea",
      "status": "confirmed",
      "label": "Reserva simulada confirmada",
      "summary": { "experienceId": "ee86bdf8-6ed4-4ea9-bc64-1b2a909ce56f", "experienceTitle": "Reserva da Jaqueira", "date": "2026-10-24", "time": null, "adults": 2, "children": 0, "totalPrice": 240, "currency": "BRL", "priceNote": null, "simulated": true },
      "notes": [],
      "expiresAt": null,
      "booking": { "bookingId": "8e70dd5c-3ae1-4526-a89e-6e3446cd63cb", "confirmationCode": "SIM-LU3F64SB" },
      "reason": null,
      "confirm": null,
      "cancel": null,
      "updatedAt": "2026-10-23T18:54:02.120Z"
    }
  ],
  "status": "confirmed"
}
```

**7. "Muito legal! Me ajudou muito, obrigado."** A resposta é curta e natural, sem ações. O Yago não reabre a reserva concluída.

O campo `status` existe somente em `/chat/actions`.

Comportamentos importantes para a UI:

- **Dados faltando:** o Yago pergunta pela data ou pelos participantes e não cria a pré-reserva.
- **"2 pessoas":** o Yago considera 2 adultos e avisa no texto. Para crianças, o hóspede pode dizer "2 adultos e 1 criança".
- **`totalPrice: null`:** acontece, por exemplo, quando a tarifa infantil depende de uma idade que o sistema não registra. Exiba `priceNote` em vez de um valor.
- **Experiência inativa ou sem vagas:** o Yago explica e não retorna ação.
- **Horários que já passaram:** em respostas para hoje, horários anteriores à hora atual do resort não aparecem e não podem ser reservados.
- **Datas relativas:** "hoje", "amanhã", "depois de amanhã", "sábado", "sexta-feira", "próximo sábado", "dia 25" e "25/10" são convertidas pelo servidor para datas absolutas no fuso do resort.
- **Períodos e faixas:** "de manhã" (05:00–12:00), "à tarde" (12:00–18:00), "à noite" (18:00–24:00), "depois das 15h" e "antes das 10h" filtram horários e **não** viram um horário exato. Na pré-reserva, se houver um único horário registrado no período, ele aparece no resumo para confirmação. Se houver mais de um, o Yago pergunta qual.

### 6.1 Buscas e refinamentos na mesma conversa

O Yago também responde a referências e a perguntas que ele mesmo fez:

- **"E como é essa experiência?"** depois de uma lista com uma opção: mostra os detalhes dela. Com várias opções, pergunta qual, com `experience.options`.
- **"Sim"** depois de "Quer que eu verifique os horários…?": consulta os horários. Um "sim" a uma pergunta nunca confirma uma reserva. A confirmação continua sendo "confirmo" ou o botão da pré-reserva.
- **Restaurantes:** "E os restaurantes?" ou "E os bares?" listam o cadastro com `restaurant.options` e a ação `navigate` para a Gastronomia. Sobre um restaurante com reserva, um "sim" devolve `navigate` com o `restaurantId`. O app conclui a reserva, como antes.
- **Continuações de restaurantes:** "Quais restaurantes estão abertos à noite?" → "E com reserva?" → "Opção 1". O tipo, a cozinha e o filtro de reserva da lista anterior são mantidos.
- **Continuações de programação:** "O que tem hoje à noite?" → "E amanhã?" repete a busca para amanhã, à noite. "Que horas é o show de circo?" responde direto sobre o evento citado.
- **Perguntas abertas:** "Que horas abre o spa?" → "E a academia?". A segunda pergunta é buscada junto com a anterior.


O Yago guarda a data, o período, os filtros e a última lista **por conversa**. O hóspede não precisa repetir o que já disse:

| Hóspede | O que o Yago faz |
| --- | --- |
| "Quais experiências têm amanhã?" | Lista as experiências com vagas registradas para amanhã (com `experience.options`). |
| "E de manhã?" | Refaz a busca de amanhã, só de manhã. |
| "E à tarde?" | Troca o período. Sem resultados, oferece outro período ou outra data. |
| "Quais são gratuitas?" | Mantém data e período e filtra as experiências sem cobrança cadastrada (all inclusive). |
| "Tem alguma para crianças?" | Filtra as experiências com indício de participação de crianças no cadastro e informa a idade mínima. |
| "Gostei da segunda." | Seleciona a 2ª opção da **última** lista apresentada. |
| "Quanto custa para dois adultos?" | Calcula o valor da experiência escolhida. |
| "Pode reservar." | Prepara a pré-reserva com os dados já informados e pede confirmação explícita. |

Perguntas como "Qual tem reserva pra amanhã?" ou "Quais posso reservar de manhã?" são **buscas**: nenhuma pré-reserva é criada só porque a palavra "reserva" apareceu. A reserva simulada só é registrada após "confirmo" ou o botão de confirmação.

---

## 7. Gastronomia: navegação assistida

O chat **não cria reservas de restaurante**, porque o app exige escolher os pratos antes. Quando o hóspede pede uma mesa, o Yago identifica o restaurante e retorna `navigate`.

**"Quero reservar uma mesa no Omakase"**

```json
{
  "reply": "A reserva do Omakase é feita pelo aplicativo, com a escolha dos pratos. Turnos cadastrados entre 19:00 e 21:30; toque em \"Abrir Gastronomia\" para continuar.",
  "conversationId": "…",
  "retrievedSources": [],
  "actions": [
    {
      "type": "navigate",
      "label": "Abrir Gastronomia",
      "screen": "Gastronomy",
      "params": { "restaurantId": "790c665d-52fa-4fe3-abda-fc9c247404cb" }
    }
  ]
}
```

**"Quero reservar uma mesa no restaurante italiano"**

Nenhum restaurante do cadastro é identificado como italiano, então a ação vem **sem** `restaurantId`:

```json
{
  "reply": "Não identifiquei esse restaurante no cadastro do resort. Os restaurantes com reserva pelo aplicativo são: Gino Praia Gastronomia, Omakase. Para reservar, é preciso selecionar os pratos em Gastronomia.",
  "actions": [{ "type": "navigate", "label": "Abrir Gastronomia", "screen": "Gastronomy", "params": {} }]
}
```

---

**"Quais restaurantes estão abertos à noite?"** (resposta real, `options` resumido a um item)

```json
{
  "reply": "Encontrei 3 restaurantes em funcionamento à noite: Gino Praia Gastronomia, Restaurante Central e Omakase.",
  "conversationId": "…",
  "retrievedSources": [],
  "actions": [
    {
      "type": "restaurant.options",
      "label": "Ver restaurante",
      "options": [
        {
          "position": 2,
          "restaurantId": "8045da0f-8ca8-47f7-b827-62ae0f6fc4d3",
          "name": "Restaurante Central",
          "type": "restaurante",
          "openingHours": "Café da manhã: 7h às 10h30. Almoço: 12h às 15h. Jantar: 19h às 22h. Night food: 23h às 5h",
          "location": "Piscina central",
          "minimumAge": null,
          "acceptsReservations": false,
          "reservationTimes": [],
          "message": "Opção 2"
        }
      ]
    },
    { "type": "navigate", "label": "Abrir Gastronomia", "screen": "Gastronomy", "params": {} }
  ]
}
```

**"O que tem hoje à noite?"** (resposta real, `items` resumido)

```json
{
  "reply": "Para hoje à noite, há 2 eventos e 4 atividades de lazer na programação. Destaques: Show de Circo (22:00) e Música ao vivo (23:00).",
  "conversationId": "…",
  "retrievedSources": [],
  "actions": [
    {
      "type": "event.list",
      "label": "Programação",
      "date": "2026-10-26",
      "items": [
        { "eventId": "8cda00eb-6970-4c55-8b50-de7406f7f2cf", "kind": "leisure", "title": "Aquecendo e brincando", "date": "2026-10-26", "time": "20:00", "location": "Teatro", "category": "4 a 7 anos", "description": null }
      ]
    }
  ]
}
```

---

## 8. Outras consultas

| Pergunta | Fonte |
| --- | --- |
| "Tenho alguma reserva de restaurante?" | Reservas reais da hospedagem: restaurante, data, turno, status e pessoas. |
| "E para quantas pessoas?" / "Está confirmada?" | Contexto da reserva anterior. Com mais de uma reserva, o Yago pergunta qual. |
| "Como está minha solicitação de manutenção?" | Solicitações reais da estadia: departamento, itens e status (atendida, em andamento, pendente, cancelada). |
| "Minhas reservas de experiências" | Reservas oficiais do snapshot e as simuladas pelo chat, identificadas separadamente. |
| "Quais restaurantes existem?", "Tem restaurante japonês?", "Quais bares estão abertos agora?", "Onde posso jantar às 20h?" | Cadastro de restaurantes, com `restaurant.options` e `navigate`. Os filtros vêm da pergunta; quem não tem horário cadastrado é citado à parte, nunca como aberto. |
| "O Bar Villagio está aberto agora?" | Resposta direta pelo horário cadastrado, com um card `restaurant.options` de um item. |
| "O que tem hoje à noite?", "Tem show amanhã?", "Qual a programação de sábado?" | Eventos e programação de lazer do snapshot, com `event.list`. |
| "Horário do Restaurante Central?", "O que posso fazer hoje?", "O show de hoje é pago?" | RAG com dados reais do resort, sem ações. Resposta de 1 a 3 frases. |
| "Oi", "Obrigado!", "Valeu, até mais", "Quem é você?" | Resposta curta e imediata, sem modelo, sem RAG e sem ações. Uma pré-reserva pendente é lembrada. |
| Pergunta sem informação nas fontes | Resposta fixa: "Não encontrei essa informação nas fontes do resort…". O Yago não inventa. |

A quantidade de pessoas de uma reserva de restaurante vem dos pedidos de pratos, um por pessoa. Sem pedidos, o Yago diz que a informação não está disponível.

---

## 9. Erros

Formato:

```json
{ "statusCode": 404, "message": "Conversa não encontrada", "error": "Not Found" }
```

`message` pode ser uma string ou um array de strings.

| Status | Quando | O que o app deve fazer |
| --- | --- | --- |
| `400` | Body inválido (campo extra, UUID inválido, mensagem vazia) | Bug do app: registre e mostre um erro genérico. |
| `401` | Header ausente ou inválido, header proibido, host ou IP não permitido, modo demo desligado. A mensagem é sempre genérica. | "Não foi possível conectar ao assistente." Verifique a configuração. |
| `403` | Titular não encontrado ou hospedagem fora do período ativo | "Não encontramos uma hospedagem ativa para este usuário." |
| `404` | Conversa ou pré-reserva inexistente, ou de outro hóspede | Em `/chat`: descarte o `conversationId` e comece uma conversa nova. Em `/chat/actions`: remova o cartão. |
| `500` | Erro interno (banco indisponível, configuração) | Erro genérico e opção de tentar de novo. |
| `502`/`503`/`504` | Modelo de IA indisponível ou lento | "O assistente está indisponível no momento." |

Se `POST /chat` falhar, nada é salvo. Reenvie o mesmo texto com o mesmo `conversationId`.

---

## 10. Estados de carregamento

| Estado | UI sugerida |
| --- | --- |
| Enviando mensagem | Bolha do hóspede em "enviando" e indicador "Yago está digitando…". Bloqueie um novo envio. |
| Sucesso | Bolha do assistente com `reply`, seguida dos cartões de `actions`. |
| Falha no envio | Bolha marcada "falhou — tocar para reenviar". |
| Confirmando ação | Card em `confirming` (estado local): spinner e botões desabilitados. Não permita um segundo toque, mesmo sendo idempotente. |
| Pré-reserva expirada | Card em `expired`, em cinza, com `reason`. |
| Confirmação falhou | Card em `failed`, com `reason` (ex.: o horário já passou, sem vagas). |
| Reabrindo a tela | `GET /chat/:id/messages`. Cada mensagem traz `actions`, e cada card vem uma vez, no estado atual. |

---

## 11. Limitações e segurança do modo de demonstração

> O modo de demonstração identifica o hóspede apenas por um identificador **não autenticado e não secreto** (`X-Demo-Guest-Id`). Ele aceita qualquer processo que alcance a API em loopback, o que inclui todo app em aparelho conectado por USB/adb e todo emulador. Não há autenticação, vínculo de dispositivo nem trilha de auditoria. Com dados pessoais identificáveis, qualquer pessoa com acesso local e um UUID de hóspede poderia ler os registros desse hóspede. Esses dados também acabariam no histórico do chat, no contexto do modelo e em logs. Use este modo apenas com dados **sintéticos ou pseudonimizados de forma irreversível**, e nunca em ambiente compartilhado, acessível pela rede ou ligado a dados de produção.

Outras limitações:

- **Reservas de experiências são simulações.** Ficam no banco interno da IA e não aparecem no sistema do resort. O snapshot nunca é alterado.
- **A disponibilidade vem do snapshot**, e não em tempo real. Em alguns horários o cadastro não informa a quantidade de vagas, e o Yago avisa isso.
- O histórico (`GET /messages`) traz os cards no estado atual (seção 5). Uma pré-reserva ainda em `preview` pode ser confirmada pelo botão depois de reabrir o app. A confirmação **por texto** ("confirmo") segue as regras da seção 5.
- Mensagens gravadas antes desta versão da API não têm `actions`: os cards dessas conversas não aparecem no histórico.
- O modelo local é pequeno. Perguntas abertas de conhecimento podem trazer respostas longas ou imprecisas, mas sempre limitadas às fontes do resort.

---

## 12. Implementação de referência (TypeScript)

```ts
const API_URL = 'http://localhost:3000';

export class ChatApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function request<T>(path: string, guestHolderId: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-Demo-Guest-Id': guestHolderId },
    signal: AbortSignal.timeout(180_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = Array.isArray(body?.message) ? body.message.join(' ') : body?.message ?? 'Erro inesperado.';
    throw new ChatApiError(response.status, message);
  }
  return body as T;
}

export const sendMessage = (guestHolderId: string, message: string, conversationId?: string) =>
  request<ChatResponse>('/chat', guestHolderId, {
    method: 'POST',
    body: JSON.stringify(conversationId ? { message: message.trim(), conversationId } : { message: message.trim() }),
  });

export const runAction = (
  guestHolderId: string,
  body: { type: 'experience.booking.confirm' | 'experience.booking.cancel'; conversationId: string; previewId: string },
) => request<ChatResponse & { status: string }>('/chat/actions', guestHolderId, {
  method: 'POST',
  body: JSON.stringify(body),
});

// Tipos que o app conhece; os demais são descartados em TODA entrada
// (POST /chat, POST /chat/actions e histórico).
const KNOWN_ACTION_TYPES: ReadonlyArray<ChatAction['type']> = [
  'navigate',
  'experience.booking.card',
  'experience.options',
  'restaurant.options', // novo
  'event.list',         // novo
];
const knownActions = (actions: ChatAction[] | undefined) =>
  (actions ?? []).filter((action) => KNOWN_ACTION_TYPES.includes(action?.type));

// Cards de reserva: um por cardId, atualizados no lugar (seção 4.2).
const cards = new Map<string, ExperienceBookingCardAction>();
// Mensagem dona de cada card: a primeira que o trouxe.
const cardOwner = new Map<string, string>(); // cardId → id da mensagem (local ou do histórico)
// Cards com POST /chat/actions em andamento ("confirming"/"cancelling").
const busy = new Set<string>();

// updatedAt é sempre ISO 8601 UTC com milissegundos (toISOString no servidor).
// Mesmo assim, compare como data, não como texto.
const time = (iso: string) => Date.parse(iso);

function upsertCards(actions: ChatAction[], fromRequest = false) {
  for (const action of actions) {
    if (action.type !== 'experience.booking.card') continue;
    // Durante um pedido, só a resposta do próprio pedido muda o card:
    // uma resposta atrasada não reabilita os botões no meio da confirmação.
    if (busy.has(action.cardId) && !fromRequest) continue;
    const current = cards.get(action.cardId);
    // Ignora uma resposta mais antiga que chegue depois.
    if (current && time(current.updatedAt) > time(action.updatedAt)) continue;
    // Atualizações sem avisos mantêm os avisos já exibidos.
    cards.set(action.cardId, action.notes.length || !current ? action : { ...action, notes: current.notes });
  }
}

/**
 * Ponto único de entrada de ações: chame em TODA resposta de POST /chat e
 * POST /chat/actions (com o id da bolha do assistente criada para ela) e
 * em cada mensagem do histórico. Devolve as ações a renderizar.
 */
function receiveActions(messageId: string, actions: ChatAction[] | undefined, fromRequest = false) {
  const known = knownActions(actions);
  for (const action of known) {
    if (action.type === 'experience.booking.card' && !cardOwner.has(action.cardId)) {
      cardOwner.set(action.cardId, messageId);
    }
  }
  upsertCards(known, fromRequest);
  return known;
}

// Confirmar e descartar seguem o mesmo padrão: estado local, trava contra
// toque duplo, body exatamente como veio do servidor e volta em erro de rede.
async function runCardAction(
  card: ExperienceBookingCardAction,
  request: ExperienceBookingCardAction['confirm'] | ExperienceBookingCardAction['cancel'],
  localStatus: 'confirming' | 'cancelling', // "cancelling" é opcional, só do app
  replyMessageId: string,                    // bolha do assistente para o reply
) {
  if (!request || busy.has(card.cardId)) return;
  busy.add(card.cardId);
  cards.set(card.cardId, { ...card, status: localStatus as BookingCardStatus, confirm: null, cancel: null });
  try {
    const response = await runAction(guestHolderId, request.body);
    busy.delete(card.cardId);
    // Mesmo cardId, novo estado. O card fica na mensagem dona; o reply curto vira uma bolha nova.
    receiveActions(replyMessageId, response.actions, true);
    return response;
  } catch (error) {
    busy.delete(card.cardId);
    cards.set(card.cardId, card); // volta para "preview"; repetir é seguro (idempotente)
    throw error;                  // a tela mostra o erro (seção 9)
  }
}

const confirmCard = (card: ExperienceBookingCardAction, replyMessageId: string) =>
  runCardAction(card, card.confirm, 'confirming', replyMessageId);
// Sempre cancel.body, nunca montado a partir de confirm.body.
const cancelCard = (card: ExperienceBookingCardAction, replyMessageId: string) =>
  runCardAction(card, card.cancel, 'cancelling', replyMessageId);

// Envio de mensagem: as ações passam pelo mesmo ponto de entrada.
export async function send(message: string, conversationId: string | undefined, replyMessageId: string) {
  const response = await sendMessage(guestHolderId, message, conversationId);
  return { ...response, actions: receiveActions(replyMessageId, response.actions) };
}

// Histórico: filtra e registra cada mensagem, na ordem, pelo mesmo ponto de entrada.
export async function loadHistory(guestHolderId: string, conversationId: string) {
  const history = await request<{ conversationId: string; messages: HistoryMessage[] }>(
    `/chat/${conversationId}/messages`, guestHolderId,
  );
  return {
    ...history,
    messages: history.messages.map((message) => ({
      ...message,
      actions: receiveActions(String(message.id), message.actions),
    })),
  };
}

// Renderização das ações
const SCREENS: Record<string, string> = { Gastronomy: 'GastronomiaScreen' }; // ajustar para a rota real

function renderAction(messageId: string, action: ChatAction) {
  switch (action.type) {
    case 'navigate': {
      const route = SCREENS[action.screen];
      return route ? <NavigateButton label={action.label} onPress={() => navigation.navigate(route, action.params)} /> : null;
    }
    case 'experience.booking.card':
      // Um card só aparece na mensagem dona; nas demais, a ação apenas atualizou o mapa.
      if (cardOwner.get(action.cardId) !== messageId) return null;
      // Renderize a partir do mapa de cards, não da ação: o mesmo cardId pode ter sido atualizado.
      return <BookingCard card={cards.get(action.cardId) ?? action}
        onConfirm={(card) => confirmCard(card, newAssistantBubbleId())}
        onCancel={(card) => cancelCard(card, newAssistantBubbleId())} />;
    case 'experience.options':
      // Cada opção envia o próprio texto na mesma conversa. Mostre title, times e summary.
      return <ExperienceOptionsList action={action}
        onSelect={(option) => sendMessage(guestHolderId, option.message, conversationId)} />;
    case 'restaurant.options':
      // Toque no card: detalhes pelo chat. Reserva: botão navigate da mesma resposta.
      return <RestaurantCards action={action}
        onSelect={(option) => sendMessage(guestHolderId, option.message, conversationId)} />;
    case 'event.list':
      // Somente leitura: horário, título, local; destaque para kind === 'event'.
      return <EventList action={action} />;
    default:
      return null; // tipos desconhecidos são ignorados
  }
}
```

---

## 13. Exemplos `curl`

```bash
GUEST=00000000-0000-4000-8000-000000000000   # guestHolder.id do titular de teste

curl -s -X POST http://localhost:3000/chat -H 'Content-Type: application/json' \
  -H "X-Demo-Guest-Id: $GUEST" -d '{"message":"Quais experiências posso fazer amanhã?"}'

curl -s -X POST http://localhost:3000/chat -H 'Content-Type: application/json' \
  -H "X-Demo-Guest-Id: $GUEST" -d '{"message":"Pode reservar.","conversationId":"<conversationId>"}'

curl -s -X POST http://localhost:3000/chat/actions -H 'Content-Type: application/json' \
  -H "X-Demo-Guest-Id: $GUEST" \
  -d '{"type":"experience.booking.confirm","conversationId":"<conversationId>","previewId":"<previewId>"}'

curl -s http://localhost:3000/chat/<conversationId>/messages -H "X-Demo-Guest-Id: $GUEST"
```

---

## 14. Checklist de integração

- [ ] Base URL correta por ambiente e HTTP sem TLS liberado só no build de desenvolvimento.
- [ ] `X-Demo-Guest-Id` = `guestHolder.id`, em todas as requisições, enviado de um único ponto.
- [ ] `X-Resort-Id`/`X-Guest-Id` nunca enviados; headers fora dos logs de rede.
- [ ] `conversationId` salvo na primeira resposta e reenviado em toda mensagem seguinte.
- [ ] Tipos `ChatResponse`/`ChatAction` copiados desta especificação.
- [ ] `actions` renderizadas depois do `reply`; tipos desconhecidos ignorados.
- [ ] `navigate`: `screen` mapeado para a rota real de Gastronomia; `restaurantId` opcional tratado.
- [ ] `experience.options` renderizado como cards (`title`, `times`, `summary`), com toque enviando `option.message`. O `reply` não traz mais a lista.
- [ ] `restaurant.options` renderizado como cards (nome, tipo, `openingHours` ou "Horário não cadastrado", local, idade mínima, selo de reserva), com toque enviando `option.message`.
- [ ] `event.list` renderizado como lista somente leitura, em ordem de horário.
- [ ] `KNOWN_ACTION_TYPES` com os cinco tipos (seção 12), aplicado também ao histórico.
- [ ] `experience.booking.preview` e `experience.booking.confirm` removidos: um único `experience.booking.card` por `cardId`.
- [ ] Cards guardados em `cardId → card` e **atualizados no lugar** a cada resposta (`POST /chat`, `POST /chat/actions` e histórico), respeitando `updatedAt`.
- [ ] Estado local `confirming` ao tocar em Confirmar; volta para `preview` em erro de rede.
- [ ] Botões só em `preview`, usando exatamente `confirm.body`/`cancel.body`, desabilitados após `expiresAt`.
- [ ] `confirmed` mostra `booking.confirmationCode` e o aviso "reserva simulada"; `expired`, `failed` e `cancelled` mostram `reason`.
- [ ] Histórico reconstruído com `messages[].actions` (cada card aparece uma vez, no estado atual).
- [ ] Texto do Yago exibido como texto simples (sem HTML/WebView, sem renderizar Markdown). Mostrar também a bolha curta da confirmação ("O código está no card").
- [ ] Card exibido só na mensagem que o trouxe primeiro; respostas seguintes com o mesmo `cardId` apenas o atualizam.
- [ ] Estado exibido a partir do `status` do card, nunca do `status` de `/chat/actions`.
- [ ] `actions` do histórico filtradas pelos tipos conhecidos, como em `POST /chat`.
- [ ] `totalPrice: null` exibe `priceNote`.
- [ ] Botões com estado de carregamento e proteção contra toque duplo.
- [ ] Tratamento de `400`/`401`/`403`/`404`/`5xx` conforme a seção 9; `404` em `/chat` reinicia a conversa.
- [ ] Timeout ≥ 180 s e indicador "digitando…".
