# 09 — Requisitos para o `yago-ai-api`

Este é o documento de transferência para o time do `yago-ai-api`. Ele diz o que precisa ser implementado, o que pode ser reaproveitado e o que está bloqueado.

## 1. Ponto de partida

O `yago-ai-api` hoje (fonte: `docs/mobile-ai-integration.md`):

- é NestJS + Ollama + RAG (ChromaDB) com histórico de conversa;
- expõe `POST /chat`, `POST /chat/actions`, `GET /chat/:id/messages` e `POST /chat/voice`;
- autentica por `X-Demo-Guest-Id` (não seguro, só loopback);
- lê dados de um **snapshot** do banco do resort;
- simula reservas de experiência (`simulated: true`);
- já implementa as ações `navigate` (Gastronomy), `experience.options` e `experience.booking.card`.

O app (`src/services/concierge/*`) já está pronto para:

- trocar o header de autenticação num único ponto (`chatApi.ts:44-52`);
- descartar tipos de ação desconhecidos;
- atualizar cards por `cardId`;
- desativar listas de opções antigas;
- reconstruir o histórico.

## 2. Decisão arquitetural central: snapshot × API oficial

| Opção | Prós | Contras |
|---|---|---|
| **A. Ler o banco/snapshot (atual)** | Rápido; consultas livres | **Não carrega as regras de negócio**, que estão na API oficial e, em grande parte, só no app (ver 03). Escrita direta no banco ignora validações. Dados defasados. |
| **B. Adaptadores sobre a API oficial com o token do hóspede (recomendado para tudo que é pessoal ou transacional)** | Mesmas validações do app, autorização herdada, dados em tempo real | Latência, N+1 (cardápio, categorias de lazer), dependência de disponibilidade |
| **C. Híbrido (recomendado)** | Catálogo estático no RAG/cache (restaurantes, cardápio, experiências, ESG, dicas, SPA, boutique). Estado pessoal, disponibilidade e escrita via B | Duas fontes, com invalidação do índice |

**Recomendação: C.**

- **Nenhuma escrita no banco do resort pelo `yago-ai-api`.** Todas as escritas passam pela API oficial.
- Acesso ao banco não substitui as regras de produção.

## 3. O que implementar no `yago-ai-api`

### 3.1 Sessão e identidade (bloqueante para produção)

1. **Aceitar `Authorization: Bearer <jwt do app>`** e remover `X-Demo-Guest-Id`.
2. Validar o token, por introspecção ou assinatura. **NÃO CONFIRMADO**: emissor, algoritmo e expiração do JWT.
3. Montar o `ctx` a partir do token: titular, acompanhantes com nascimento, `lodgingIdPms`, datas e UH. Depende de **G1**.
4. Obter `responsibleId` uma vez (E02, registro `name === "Hospede"`) e cachear.
5. Guardar o token só em memória, por requisição. Nunca no histórico nem em logs.

### 3.2 Camada de adaptadores (`ResortApiClient`)

Um módulo NestJS que encapsula a API oficial (`EXPO_PUBLIC_API` do app) com:

- tipos TS copiados de `src/services/types.d.ts`, **corrigindo as divergências** listadas em 03 (§Inconsistências);
- normalização de status (`aprovada | pago` → `confirmed`, etc.);
- **fuso America/Sao_Paulo** em todas as datas de saída;
- cache por chave semelhante às queryKeys do app:

  | Dado | TTL |
  |---|---|
  | Catálogo | 30 min |
  | Disponibilidade | 5 min (`services/concierge/catalog.ts:37-44`) |
  | Dados pessoais | sem cache entre usuários |

- resolução de N+1 em paralelo (cardápio: E18 + E19×N; lazer: E11 + E12×N; reservas de restaurante: E24 + E18×N).

| Adaptador | Endpoints | Tools |
|---|---|---|
| `RestaurantsAdapter` | E16, E17, E18, E19, E21, E22, E24, E25 | T02–T06, T12, T13, T15 |
| `ExperiencesAdapter` | E28, E29, E30, E31, E32, E33, E34, E49 | T07–T11, T12–T14 |
| `EventsAdapter` | E35 | T17, T18 |
| `FavoritesAdapter` | E36, E37, E39 | T28–T30 |
| `RequestsAdapter` | E06, E07, E08, E09 | T19–T23 |
| `LeisureAdapter` | E10, E11, E12, E14, E15 | T24–T27 |
| `InfoAdapter` | E40–E48 | T31–T34 |
| `QuizAdapter` | E50, E53 | T35 |
| `SystemAdapter` | E02 | ctx |

### 3.3 Regras a reimplementar (hoje só no app)

Prioridade: mover para a **API oficial**. Se não for possível, criar um pacote compartilhado app ↔ IA.

| Regra | Ref. no app | Usada por |
|---|---|---|
| Elegibilidade por idade em experiências (R-EXP-03 a 07) | `src/utils/experienceAgeRules.ts` (testado em `src/__tests__`) | T09, T11 |
| Janela `maxBookingHour` / `closure` (R-EXP-09, R-GAS-07, R-GAS-15) | `Booking/*/screens/SelectDate.tsx`, `MyReservation/screens/*` | T05, T10, T11, T14, T15 |
| Filtro `minimumDaily` e `minimumAge` de restaurante (R-GAS-01, 05) | `screens/Gastronomy/actions.ts:26-31`; `Booking/Gastronomy/actions.ts:84-96` | T02, T05 |
| Uma reserva aprovada por restaurante (R-GAS-06) | `Booking/Gastronomy/screens/Details.tsx:42-44` | T05, T06 |
| Hierarquia de itens e remoção do pai (R-REQ-02, 04) | `services/department/index.ts:28-36`; `screens/Requests/actions.ts:16-23` | T20, T21 |
| Faixas etárias de lazer (R-LAZ-03) | `screens/Leisure/actions.ts:28-39` (**UUIDs fixos no código**) | T24 |
| Expansão de `dayOfWeek` em datas (R-LAZ-01) | `screens/Leisure/actions.ts:61-69` | T24 |
| "Hoje" no fuso do resort (R-EVT-01/02) | — (o app usa UTC) | T17 |

### 3.4 Orquestração de tools e ações

- **Registro de tools** com schema (zod/class-validator) conforme o [04](04-ai-tools-catalog.md). O LLM chama tools, e o servidor monta as `actions`.
- **Store de previews**: `{previewId, conversationId, guestHolderId, operation, payload, expiresAt, status, updatedAt}`, com lock por `previewId`.
  - Generalizar o mecanismo atual de `experience.booking.card` para `operation.card`.
- **Novos `ChatActionRequestType`**: `operation.confirm`, `operation.cancel`, `favorite.add`, `favorite.remove`.
- **Novas ações**: `catalog.list`, `menu.view`, `booking.list`, `request.list`, `operation.card` e `favorite.changed` (ver 05).
- **Lista permitida de `navigate.screen`** igual à do [06](06-navigation-contracts.md).
- **Montagem de imagens**: o app usa `${EXPO_PUBLIC_BUCKET}/<pasta>/<arquivo>`, com as pastas `restaurant`, `menu`, `experience/logos`, `spa`, `tip`, `image` e `department`. O servidor deve devolver a URL absoluta, ou deixar que o app a monte, como já faz para as experiências.
- **Auditoria**: logar a operação, o hóspede (id), o `previewId`, o status e o código HTTP da API oficial.
- **RAG**: indexar ESG (texto), dicas (todos os `tipItems`), descrições de restaurantes, experiências e SPA, informações de departamentos e lazer, e as diretrizes do resort (link no login).
  - **Não** indexar dados pessoais.
  - Reindexar a partir dos endpoints, e não de texto livre.

### 3.5 Contrato de resposta

- Manter `ChatResponse` e as ações existentes **sem quebrar compatibilidade**.
- Novas ações só aparecem para apps que declararem suporte. Sugestão: header `X-Client-Capabilities: catalog.list,operation.card,...`. O app antigo já ignora tipos desconhecidos, mas o `reply` deveria continuar autossuficiente em texto.
- Quando houver cards, o `reply` deve ser uma introdução curta (dependência 3 de `docs/concierge-cards-reserva.md`).

## 4. Lacunas (o que impede funcionalidades)

| ID | Lacuna | Impacto | Onde resolver |
|---|---|---|---|
| **G1** | Não há endpoint para obter o contexto do hóspede a partir do token (`/me`). O app só o recebe no login (E01). | Bloqueia a identidade segura na IA | API oficial: `GET access-control/me` (ou similar), devolvendo `IUser` sem o token |
| **G2** | A Yago AI usa o snapshot e reservas simuladas. | Reserva real impossível | `yago-ai-api` (adaptadores) |
| **G3** | Não há detalhe por id de reserva, solicitação nem evento. | Exige buscar a lista inteira | API oficial (opcional) |
| **G4** | O cancelamento de restaurante é por `lodgingIdPms + restaurantId`, não por reserva. | Pode cancelar mais de uma | API oficial: `PATCH booking-restaurant/:id/update-situation` |
| **G5** | `NÃO CONFIRMADO` se a API oficial valida `lodgingIdPms` e os ids de hóspedes (body) contra o token. | Risco de IDOR | Auditoria de segurança da API oficial |
| **G6** | Os lembretes (favoritos, reservas) são **locais** (notifee), agendados só pelo app. | Ações via chat não geram lembrete | App: reagir a `favorite.changed` / `operation.card confirmed`; ou push no servidor |
| **G7** | As faixas etárias de lazer estão fixas no app por UUID. | Regra invisível para a IA | API oficial: campos `minAge`/`maxAge` na categoria |
| **G8** | `POST experience/sign` pode não existir em produção (`docs/expsign-yago-mobile-api.md`). | Ficha não registrada | API oficial |
| **G9** | Sem idempotência em E08, E23 e E31. | Duplicidade em retries | API oficial (`Idempotency-Key`) ou deduplicação na IA |
| **G10** | Sem agendamento de SPA nem compra na boutique. | Funcionalidades inexistentes | Produto |
| **G11** | O contrato real do quiz não está documentado no repo (`api/quiz/` desatualizado). | — | Backend do quiz |
| **G12** | `numberOfGuests` na disponibilidade e na reserva de restaurante = hospedagem inteira. | Disponibilidade imprecisa | Decidir a semântica com o backend |
| **G13** | `responsibleId` depende de um registro com `name === "Hospede"`. | Frágil | API oficial: derivar no servidor |
| **G14** | Os erros da API oficial vêm em formatos variados (`validateError[]`, texto livre). | Mensagens ruins na IA | Padronizar (como a §7.1 de experiências) |

## 5. Operações implementáveis imediatamente (após G1 + adaptadores)

Leitura, que exige só autenticação real:

- T02–T05
- T07–T10
- T12–T13
- T17–T20
- T22
- T24–T25
- T28
- T31–T35

Escrita com confirmação, com endpoint e regras conhecidos:

- T21 (criar solicitação)
- T23 (cancelar solicitação)
- T14 (cancelar experiência)
- T27 (cancelar inscrição)
- T11 (reservar experiência **sem termo/ficha**)
- T30 (remover favorito)

Navegação: T06, T16, T26 e T36, que exigem ampliar `CHAT_SCREEN_ROUTES` no app.
