# Integração do chat do app Yago com a Yago AI API

Contrato para implementar a tela de chat do Yago (concierge) no aplicativo React Native.

> **Status: MVP de demonstração.** A API ainda não valida o token do app. O hóspede é identificado pelo header `X-Demo-Guest-Id` e só são aceitas conexões locais. Reservas de experiências feitas pelo chat são **simuladas** e não vão para o sistema oficial do resort. Leia a seção 11 antes de usar com qualquer dado real.

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

Respostas de conhecimento usam um modelo local e podem levar dezenas de segundos. Use timeout de **180 s** em `POST /chat`. Respostas operacionais (reservas, experiências, Gastronomia) não usam o modelo generativo e costumam ser rápidas.

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

- Respostas comuns retornam `actions: []`.
- Um app que ainda não renderiza ações continua funcionando: o `reply` sempre explica o próximo passo em texto, inclusive como confirmar digitando "confirmo".
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
  | ExperienceBookingPreviewAction
  | ExperienceBookingConfirmAction
  | ExperienceOptionsAction;

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

### 4.2 `experience.booking.preview`: pré-reserva aguardando confirmação

```ts
interface ExperienceBookingPreviewAction {
  type: 'experience.booking.preview';
  label: string;            // "Confirmar reserva simulada"
  previewId: string;        // UUID da pré-reserva persistida no servidor
  expiresAt: string;        // ISO 8601 UTC; padrão de 15 min
  summary: ExperienceBookingSummary;
  confirm: {
    method: 'POST';
    path: '/chat/actions';
    body: { type: 'experience.booking.confirm'; conversationId: string; previewId: string };
  };
}
```

Renderize um cartão com `summary` e dois botões:

- **Confirmar:** envie `confirm.body` para `confirm.path`, sem alterar nada.
- **Cancelar:** envie o mesmo body com `type: 'experience.booking.cancel'`.

Desabilite o botão depois de `expiresAt`.

### 4.3 `experience.booking.confirm`: reserva simulada registrada

```ts
interface ExperienceBookingConfirmAction {
  type: 'experience.booking.confirm';
  label: string;             // "Reserva simulada confirmada"
  bookingId: string;
  confirmationCode: string;  // ex.: "SIM-7KQ2M9XA"
  status: 'confirmed';
  alreadyConfirmed: boolean; // true se a mesma pré-reserva já tinha sido confirmada
  summary: ExperienceBookingSummary;
}
```

Exiba o cartão de sucesso com o código e o aviso **"Reserva simulada: não registrada no sistema oficial do resort"**.

### 4.4 `experience.options`: experiências selecionáveis

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
    message: string;      // texto a enviar ao tocar, ex.: "Opção 2"
  }[];
}
```

- **Ao tocar:** envie `option.message` como uma mensagem normal em `POST /chat`, com o mesmo `conversationId`. O servidor resolve a posição pela lista guardada na conversa, e o app não precisa enviar o `experienceId`.
- Use o botão da **última** resposta que trouxe a ação: uma nova busca substitui a lista guardada.
- Clientes que ainda não tratam este tipo podem ignorá-lo (`default: return null`). O texto de `reply` continua completo.

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
| `previewId` | UUID v4 recebido na ação de pré-reserva |

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

- A resposta também é gravada no histórico da conversa, como mensagem do assistente.
- Confirmar duas vezes, por exemplo com um toque duplo ou um retry de rede, **não** cria duas reservas.
- Antes de confirmar, o servidor revalida: experiência ativa, vaga ainda disponível, data dentro da estadia e valor inalterado.
- `404` significa conversa ou pré-reserva inexistente, ou pertencente a outro hóspede.

O hóspede também pode confirmar **por texto**: "confirmo", "sim" ou "pode confirmar", logo após o resumo. O efeito é o mesmo. Se houver qualquer outra interação antes, a confirmação por texto deixa de valer e é preciso usar o botão ou pedir a reserva novamente.

---

## 6. Experiências: fluxo conversacional

Exemplo real com dados do snapshot. O hóspede é um titular de teste.

**1. Hóspede:** "Quais experiências posso fazer amanhã?"

```json
{
  "reply": "Para sábado, 24/10/2026, o cadastro do resort registra vagas para:\n1. Reserva da Jaqueira — horário não especificado (vaga para o dia): 10 vaga(s) para adultos e 10 para crianças\nSem necessidade de reserva: Mágica da Mente, Circo Show 4+, Ritual da Lua Cheia.\nObservação: as vagas vêm do snapshot do sistema do resort e podem não refletir a disponibilidade em tempo real.",
  "conversationId": "bb39a64c-3af7-4976-abe0-4ab8500e7536",
  "retrievedSources": [],
  "actions": [
    {
      "type": "experience.options",
      "label": "Escolher experiência",
      "date": "2026-10-24",
      "options": [
        { "position": 1, "experienceId": "ee86bdf8-6ed4-4ea9-bc64-1b2a909ce56f", "title": "Reserva da Jaqueira", "times": [], "message": "Opção 1" }
      ]
    }
  ]
}
```

**2. "Gostei da primeira."** O Yago mostra descrição, valores e regras da experiência.

**3. "Tem para duas pessoas?"** O Yago confirma que há vagas e avisa que considerou 2 adultos.

**4. "Quanto custa?"** Resposta: "Reserva da Jaqueira para 2 adultos: R$ 240,00."

**5. "Pode reservar."**

```json
{
  "reply": "Confira o resumo da reserva simulada:\nExperiência: Reserva da Jaqueira\nData: sábado, 24/10/2026\n...\nDeseja confirmar? Responda \"confirmo\" ou use o botão de confirmação.",
  "conversationId": "bb39a64c-3af7-4976-abe0-4ab8500e7536",
  "retrievedSources": [],
  "actions": [
    {
      "type": "experience.booking.preview",
      "label": "Confirmar reserva simulada",
      "previewId": "a7e3e8d1-7f15-47fa-a82b-57b49ee92fea",
      "expiresAt": "2026-10-23T19:08:18.835Z",
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
      "confirm": {
        "method": "POST",
        "path": "/chat/actions",
        "body": {
          "type": "experience.booking.confirm",
          "conversationId": "bb39a64c-3af7-4976-abe0-4ab8500e7536",
          "previewId": "a7e3e8d1-7f15-47fa-a82b-57b49ee92fea"
        }
      }
    }
  ]
}
```

**6. Botão "Confirmar"** (`POST /chat/actions`), ou o hóspede digita "confirmo":

```json
{
  "reply": "Reserva simulada registrada.\nReserva da Jaqueira — sábado, 24/10/2026, 2 adultos.\nCódigo da simulação: SIM-LU3F64SB.\nEsta é uma reserva simulada para demonstração; ela não foi registrada no sistema oficial do resort.",
  "conversationId": "bb39a64c-3af7-4976-abe0-4ab8500e7536",
  "retrievedSources": [],
  "actions": [
    {
      "type": "experience.booking.confirm",
      "label": "Reserva simulada confirmada",
      "bookingId": "8e70dd5c-3ae1-4526-a89e-6e3446cd63cb",
      "confirmationCode": "SIM-LU3F64SB",
      "status": "confirmed",
      "alreadyConfirmed": false,
      "summary": { "experienceTitle": "Reserva da Jaqueira", "date": "2026-10-24", "time": null, "adults": 2, "children": 0, "totalPrice": 240, "currency": "BRL", "priceNote": null, "simulated": true, "experienceId": "ee86bdf8-6ed4-4ea9-bc64-1b2a909ce56f" }
    }
  ],
  "status": "confirmed"
}
```

O campo `status` existe somente em `/chat/actions`.

Comportamentos importantes para a UI:

- **Dados faltando:** o Yago pergunta pela data ou pelos participantes e não cria a pré-reserva.
- **"2 pessoas":** o Yago considera 2 adultos e avisa no texto. Para crianças, o hóspede pode dizer "2 adultos e 1 criança".
- **`totalPrice: null`:** acontece, por exemplo, quando a tarifa infantil depende de uma idade que o sistema não registra. Exiba `priceNote` em vez de um valor.
- **Experiência inativa ou sem vagas:** o Yago explica e não retorna ação.
- **Datas relativas:** "hoje", "amanhã", "depois de amanhã", "sábado", "sexta-feira", "próximo sábado", "dia 25" e "25/10" são convertidas pelo servidor para datas absolutas no fuso do resort.
- **Períodos e faixas:** "de manhã" (05:00–12:00), "à tarde" (12:00–18:00), "à noite" (18:00–24:00), "depois das 15h" e "antes das 10h" filtram horários e **não** viram um horário exato. Na pré-reserva, se houver um único horário registrado no período, ele aparece no resumo para confirmação. Se houver mais de um, o Yago pergunta qual.

### 6.1 Buscas e refinamentos na mesma conversa

O Yago também responde a referências e a perguntas que ele mesmo fez:

- **"E como é essa experiência?"** depois de uma lista com uma opção: mostra os detalhes dela. Com várias opções, pergunta qual, com `experience.options`.
- **"Sim"** depois de "Quer que eu verifique os horários…?": consulta os horários. Um "sim" a uma pergunta nunca confirma uma reserva. A confirmação continua sendo "confirmo" ou o botão da pré-reserva.
- **Restaurantes:** "E os restaurantes?" ou "E os bares?" listam o cadastro com a ação `navigate` para a Gastronomia. Sobre um restaurante com reserva, um "sim" devolve `navigate` com o `restaurantId`. O app conclui a reserva, como antes.


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
  "reply": "Para reservar no Omakase🇯🇵, é preciso selecionar os pratos no cardápio do restaurante pelo aplicativo. Horários de reserva cadastrados: 19:00, 19:30, 20:00, 20:30, 21:00, 21:30. Toque em \"Abrir Gastronomia\" para continuar. Eu não crio reservas de restaurante pelo chat.",
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
  "reply": "Não identifiquei esse restaurante no cadastro do resort. Os restaurantes com reserva pelo aplicativo são: Gino Praia Gastronomia, Omakase🇯🇵. Para reservar, é preciso selecionar os pratos em Gastronomia.",
  "actions": [{ "type": "navigate", "label": "Abrir Gastronomia", "screen": "Gastronomy", "params": {} }]
}
```

---

## 8. Outras consultas (sem ações)

| Pergunta | Fonte |
| --- | --- |
| "Tenho alguma reserva de restaurante?" | Reservas reais da hospedagem: restaurante, data, turno, status e pessoas. |
| "E para quantas pessoas?" / "Está confirmada?" | Contexto da reserva anterior. Com mais de uma reserva, o Yago pergunta qual. |
| "Como está minha solicitação de manutenção?" | Solicitações reais da estadia: departamento, itens e status (atendida, em andamento, pendente, cancelada). |
| "Minhas reservas de experiências" | Reservas oficiais do snapshot e as simuladas pelo chat, identificadas separadamente. |
| "Quais restaurantes existem?", "Horário do Restaurante Central?", "O que posso fazer hoje?" | RAG com dados reais do resort, incluindo a programação e os eventos do dia. |
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
| Confirmando ação | Botão com spinner e desabilitado. Não permita um segundo toque, mesmo sendo idempotente. |
| Pré-reserva expirada | Cartão em cinza com o texto "Pré-reserva expirada — peça novamente". |
| Reabrindo a tela | `GET /chat/:id/messages`. O histórico guarda só texto: os cartões não são reconstruídos. |

---

## 11. Limitações e segurança do modo de demonstração

> O modo de demonstração identifica o hóspede apenas por um identificador **não autenticado e não secreto** (`X-Demo-Guest-Id`). Ele aceita qualquer processo que alcance a API em loopback, o que inclui todo app em aparelho conectado por USB/adb e todo emulador. Não há autenticação, vínculo de dispositivo nem trilha de auditoria. Com dados pessoais identificáveis, qualquer pessoa com acesso local e um UUID de hóspede poderia ler os registros desse hóspede. Esses dados também acabariam no histórico do chat, no contexto do modelo e em logs. Use este modo apenas com dados **sintéticos ou pseudonimizados de forma irreversível**, e nunca em ambiente compartilhado, acessível pela rede ou ligado a dados de produção.

Outras limitações:

- **Reservas de experiências são simulações.** Ficam no banco interno da IA e não aparecem no sistema do resort. O snapshot nunca é alterado.
- **A disponibilidade vem do snapshot**, e não em tempo real. Em alguns horários o cadastro não informa a quantidade de vagas, e o Yago avisa isso.
- O histórico (`GET /messages`) guarda apenas texto. Para retomar uma pré-reserva pendente após reabrir o app, peça a reserva novamente.
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

// Renderização das ações
const SCREENS: Record<string, string> = { Gastronomy: 'GastronomiaScreen' }; // ajustar para a rota real

function renderAction(action: ChatAction) {
  switch (action.type) {
    case 'navigate': {
      const route = SCREENS[action.screen];
      return route ? <NavigateButton label={action.label} onPress={() => navigation.navigate(route, action.params)} /> : null;
    }
    case 'experience.booking.preview':
      return <BookingPreviewCard action={action} onConfirm={() => runAction(guestHolderId, action.confirm.body)}
        onCancel={() => runAction(guestHolderId, { ...action.confirm.body, type: 'experience.booking.cancel' })} />;
    case 'experience.booking.confirm':
      return <BookingConfirmedCard action={action} />;
    case 'experience.options':
      // Cada opção envia o próprio texto na mesma conversa.
      return <ExperienceOptionsList action={action}
        onSelect={(option) => sendMessage(guestHolderId, option.message, conversationId)} />;
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
- [ ] Cartão de pré-reserva com Confirmar/Cancelar usando exatamente `confirm.body`, desabilitado após `expiresAt`.
- [ ] Cartão de confirmação com o código e o aviso "reserva simulada".
- [ ] `totalPrice: null` exibe `priceNote`.
- [ ] Botões com estado de carregamento e proteção contra toque duplo.
- [ ] Tratamento de `400`/`401`/`403`/`404`/`5xx` conforme a seção 9; `404` em `/chat` reinicia a conversa.
- [ ] Timeout ≥ 180 s e indicador "digitando…".
- [ ] Texto do Yago exibido como texto simples (sem HTML/WebView).
