# Integração do chat mobile com a Yago AI API

> **Substituído por [mobile-ai-integration.md](mobile-ai-integration.md)**, que descreve o contrato atual (`actions`, `POST /chat/actions`, Gastronomia e reservas simuladas). Este documento é mantido apenas como referência histórica.

Guia para conectar o chat do app mobile à API do Yago (o mordomo digital do resort).

> **Status:** a API está em **modo de demonstração**. Ainda não existe login/token de verdade: o hóspede é identificado por um header (`X-Demo-Guest-Id`) e só dispositivos/IPs liberados no servidor conseguem acessar. Quando a autenticação real chegar, este header será substituído — mantenha o envio dele centralizado em um único lugar do app (ex.: interceptor do cliente HTTP).

---

## 1. Visão geral

O app só precisa de **duas rotas**:

| Método | Rota | Uso |
| --- | --- | --- |
| `POST` | `/chat` | Envia uma mensagem e recebe a resposta do Yago. Cria a conversa na primeira mensagem. |
| `GET` | `/chat/:conversationId/messages` | Carrega o histórico de uma conversa existente. |

Fluxo típico:

```text
1ª mensagem   → POST /chat { message }                  → guarda o conversationId retornado
próximas      → POST /chat { message, conversationId }  → mesma conversa, com contexto
reabrir tela  → GET  /chat/{conversationId}/messages    → renderiza o histórico
```

O backend decide sozinho se a pergunta é sobre **reservas/solicitações do hóspede** ou sobre **informações do resort** (horários, serviços etc.). O app não precisa escolher nada — sempre usa `POST /chat`.

> Existe também `POST /operations/ask`, mas é uma rota interna de teste. **Não use no app.**

---

## 2. Conexão

### Base URL

A API roda na porta `3000` por padrão (variável `PORT`).

| Ambiente do app | Base URL |
| --- | --- |
| Simulador iOS | `http://localhost:3000` |
| Emulador Android | `http://10.0.2.2:3000` |
| Aparelho físico via USB (Android) | `adb reverse tcp:3000 tcp:3000` e depois `http://localhost:3000` |
| Aparelho físico na rede (Wi-Fi) | Ver observação abaixo |

> **Aparelho físico na rede:** hoje o servidor escuta apenas em `127.0.0.1`, então ele **não aceita conexões vindas de outro dispositivo da rede**. Para testar em aparelho via Wi-Fi, o backend precisa (1) passar a escutar em `0.0.0.0` e (2) incluir o IP do aparelho em `DEMO_ALLOWED_CLIENT_IPS`. Combine com o time do backend antes.

Por ser HTTP (sem TLS) em desenvolvimento, lembre de liberar cleartext no app:
- **Android:** `android:usesCleartextTraffic="true"` (ou `network_security_config`) no build de dev.
- **iOS:** exceção de ATS (`NSAllowsLocalNetworking` / `NSExceptionDomains`) no build de dev.

### Headers obrigatórios

| Header | Valor | Obrigatório |
| --- | --- | --- |
| `Content-Type` | `application/json` | Sim (no `POST`) |
| `X-Demo-Guest-Id` | ID do hóspede logado (string, até 255 caracteres) | **Sim, em todas as requisições** |

### Headers proibidos

**Não envie** `X-Resort-Id` nem `X-Guest-Id`. Se qualquer um deles estiver presente, a API recusa a requisição com `401`. O resort é definido pelo servidor, nunca pelo app.

### Timeout

A resposta depende de um modelo de IA local e pode demorar. Configure o timeout da requisição de `POST /chat` em **pelo menos 180 segundos** e mostre um indicador de "digitando…" enquanto aguarda. O `GET` de histórico é rápido; o timeout padrão serve.

---

## 3. `POST /chat` — enviar mensagem

### Body

```json
{
  "message": "Quais são minhas reservas de restaurante?",
  "conversationId": "3f1c2a4e-8b7d-4c1e-9a2f-6d5e4b3a2c10"
}
```

| Campo | Tipo | Regras |
| --- | --- | --- |
| `message` | string | Obrigatório. Não pode ser vazio nem só espaços. Máximo **2000** caracteres. |
| `conversationId` | string (UUID v4) | Opcional. **Omita na primeira mensagem.** Nas seguintes, envie o valor recebido da API. |

**Não envie nenhum outro campo** no body (nem `null` extras, `guestId`, `timestamp` etc.). A API rejeita campos desconhecidos com `400`.

Valide no app antes de enviar: trim da mensagem, bloqueio de envio vazio e limite de 2000 caracteres no input.

### Resposta `201 Created`

```json
{
  "reply": "Você tem 2 reservas de restaurante: ...",
  "conversationId": "3f1c2a4e-8b7d-4c1e-9a2f-6d5e4b3a2c10",
  "retrievedSources": [
    { "id": "spa-horarios", "title": "Horários do Spa", "distance": 0.21 }
  ]
}
```

| Campo | Descrição |
| --- | --- |
| `reply` | Texto da resposta do Yago (português). Exiba como mensagem do assistente. Pode conter quebras de linha. |
| `conversationId` | ID da conversa. **Salve** este valor (estado da tela e, se quiser retomar depois, armazenamento local). |
| `retrievedSources` | Fontes usadas na resposta. Pode vir vazio. É informação de depuração — **não é necessário exibir** ao hóspede. |

> O status de sucesso é `201`, não `200`. Trate qualquer `2xx` como sucesso.

### Exemplo

```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -H "X-Demo-Guest-Id: 12345" \
  -d '{"message":"Que horas abre o spa?"}'
```

---

## 4. `GET /chat/:conversationId/messages` — histórico

### Parâmetro

`conversationId` — UUID v4 recebido em `POST /chat`.

### Resposta `200 OK`

```json
{
  "conversationId": "3f1c2a4e-8b7d-4c1e-9a2f-6d5e4b3a2c10",
  "messages": [
    {
      "id": 101,
      "conversationId": "3f1c2a4e-8b7d-4c1e-9a2f-6d5e4b3a2c10",
      "role": "user",
      "content": "Que horas abre o spa?",
      "createdAt": "2026-10-23T14:02:11.123Z"
    },
    {
      "id": 102,
      "conversationId": "3f1c2a4e-8b7d-4c1e-9a2f-6d5e4b3a2c10",
      "role": "assistant",
      "content": "O spa funciona das 9h às 20h.",
      "createdAt": "2026-10-23T14:02:11.123Z"
    }
  ]
}
```

- Mensagens já vêm em **ordem cronológica** (mais antiga primeiro).
- `role` é `"user"` (hóspede) ou `"assistant"` (Yago).
- `createdAt` é ISO 8601 em UTC — converta para o fuso do aparelho na exibição.
- Pergunta e resposta do mesmo envio podem ter o mesmo `createdAt`; para ordenar, use a ordem do array (ou `id`).
- Não há paginação: a rota retorna a conversa inteira.

Uma conversa só é visível para o mesmo `X-Demo-Guest-Id` que a criou. Com outro ID, a API responde `404`.

---

## 5. Erros

Formato padrão de erro:

```json
{
  "statusCode": 400,
  "message": ["A mensagem não pode ser vazia."],
  "error": "Bad Request"
}
```

> `message` pode ser **string ou array de strings** (erros de validação vêm como array). Trate os dois casos.

| Status | Quando acontece | O que o app deve fazer |
| --- | --- | --- |
| `400` | Body inválido (mensagem vazia, > 2000 caracteres, `conversationId` não é UUID, campo extra) ou `conversationId` inválido na URL. | Bug do app ou input não validado. Mostre erro genérico e registre no log. |
| `401` | Header `X-Demo-Guest-Id` ausente/vazio; envio de `X-Resort-Id`/`X-Guest-Id`; IP do dispositivo não liberado; modo demo desligado no servidor. | Mostrar "Não foi possível conectar ao assistente". Verificar headers e configuração com o backend. |
| `403` | Consulta de reservas/solicitações bloqueada pelo servidor (ex.: ambiente de produção, contexto do hóspede inválido). | Mensagem genérica de erro. Reportar ao backend. |
| `404` | `conversationId` não existe ou pertence a outro hóspede. | Descartar o `conversationId` salvo e iniciar uma conversa nova (próximo envio sem `conversationId`). |
| `500` | Erro interno (ex.: servidor sem `RESORT_ID` configurado, falha de banco). | Mensagem de erro genérica + opção de tentar novamente. |
| `502` / `503` | Serviço de IA indisponível. | "O assistente está indisponível no momento. Tente novamente." |
| `504` | Modelo de IA demorou demais. | Mesma mensagem acima + botão de reenviar. |

Se o `POST /chat` falhar, a mensagem **não é salva** no histórico. O app pode manter a bolha do hóspede na tela com estado "falhou — tocar para reenviar" e reenviar o mesmo texto com o mesmo `conversationId`.

---

## 6. Implementação de referência (TypeScript)

```ts
const API_URL = 'http://localhost:3000'; // ver tabela da seção 2

export interface ChatReply {
  reply: string;
  conversationId: string;
  retrievedSources: { id: string; title: string; distance: number | null }[];
}

export interface ChatHistoryMessage {
  id: number;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export class ChatApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, guestId: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Demo-Guest-Id': guestId,
    },
    signal: AbortSignal.timeout(180_000),
  });

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const message = Array.isArray(body?.message)
      ? body.message.join(' ')
      : body?.message ?? 'Erro inesperado.';
    throw new ChatApiError(response.status, message);
  }

  return body as T;
}

export function sendMessage(guestId: string, message: string, conversationId?: string) {
  const payload: { message: string; conversationId?: string } = { message: message.trim() };
  if (conversationId) payload.conversationId = conversationId;

  return request<ChatReply>('/chat', guestId, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getMessages(guestId: string, conversationId: string) {
  return request<{ conversationId: string; messages: ChatHistoryMessage[] }>(
    `/chat/${conversationId}/messages`,
    guestId,
  );
}
```

> Se o runtime do app não tiver `AbortSignal.timeout`, use um `AbortController` com `setTimeout`.

Uso na tela:

```ts
let conversationId: string | undefined; // carregar do storage, se houver

async function onSend(text: string) {
  try {
    const result = await sendMessage(guestId, text, conversationId);
    conversationId = result.conversationId; // persistir
    appendAssistantMessage(result.reply);
  } catch (error) {
    if (error instanceof ChatApiError && error.status === 404) {
      conversationId = undefined; // conversa perdida: começa outra
    }
    markLastMessageAsFailed();
  }
}
```

---

## 7. Checklist

- [ ] Base URL correta para o ambiente (simulador, emulador ou aparelho).
- [ ] Cleartext HTTP liberado no build de desenvolvimento.
- [ ] `X-Demo-Guest-Id` enviado em **todas** as requisições, a partir de um único ponto do código.
- [ ] `X-Resort-Id` e `X-Guest-Id` **nunca** enviados.
- [ ] Primeira mensagem sem `conversationId`; seguintes com o valor retornado.
- [ ] Body contém apenas `message` e (opcionalmente) `conversationId`.
- [ ] Input limitado a 2000 caracteres e bloqueado quando vazio.
- [ ] Timeout ≥ 180s no `POST /chat` + indicador de "digitando…".
- [ ] `404` limpa o `conversationId` salvo.
- [ ] `message` de erro tratado como string **ou** array.
- [ ] Datas do histórico convertidas de UTC para o fuso local.
