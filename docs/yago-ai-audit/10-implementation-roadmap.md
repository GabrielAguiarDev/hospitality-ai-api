# 10 — Roadmap de implementação

A ordem considera as dependências técnicas encontradas no app, não apenas o valor de cada funcionalidade. Os IDs remetem aos documentos anteriores:

| Prefixo | Documento |
|---|---|
| `T##` | tools ([04](04-ai-tools-catalog.md)) |
| `C##` | cards ([05](05-chat-cards-catalog.md)) |
| `G##` | lacunas ([09](09-backend-requirements.md)) |

## Fase 0 — Fundamentos (bloqueante)

| Item | Lado | Depende de |
|---|---|---|
| Endpoint `/me` (ou introspecção) na API oficial | API oficial | — (G1) |
| Autenticação por JWT no `yago-ai-api` (remover `X-Demo-Guest-Id`) | IA + app (`chatApi.ts:44-52`) | G1 |
| Montagem do `ctx` da sessão + `responsibleId` | IA | G1 |
| `ResortApiClient` + adaptadores de leitura | IA | — |
| Auditoria de autorização da API oficial (`lodgingIdPms`, ids no body) | API oficial / segurança | — (G5) |
| Fuso America/Sao_Paulo e normalização de status | IA | — |

**Saída:** a IA lê dados reais com a identidade do hóspede.

## Fase 1 — Consultas P0 + cards básicos

| Item | Tools | Cards |
|---|---|---|
| Restaurantes, cardápio, horários com vaga | T02–T05 | C01, C02, C03 |
| Experiências (lista, detalhe, elegibilidade, disponibilidade) | T07–T10 | C04 (`experience.options` existente) |
| Eventos de hoje, à noite, no fim de semana | T17, T18 | C05 |
| Minhas reservas (restaurante + experiência) | T12, T13 | C12 |
| Minhas solicitações (departamento + lazer) | T22 | C11 |
| Navegação ampliada | T06, T36 | `navigate` ampliado (06) |

**No app:**

- `catalog.list`, `booking.list` e `request.list` em `KNOWN_ACTION_TYPES`;
- mapeamento para `ConciergeCard`;
- `CHAT_SCREEN_ROUTES` ampliado.

## Fase 2 — Operações com confirmação

| Item | Tools | Pré-requisitos |
|---|---|---|
| Generalizar o preview (`operation.card`) | — | Store de previews + lock |
| Criar solicitação | T19, T20, T21 | Hierarquia de itens no servidor |
| Cancelar solicitação / inscrição | T23, T27 | — |
| Reserva **real** de experiência sem termo | T11 | G2 (substituir a simulação), regras de idade no servidor |
| Cancelar experiência | T14 | — |
| Favoritos | T28, T29, T30 | G6 (lembrete local via `favorite.changed`) |
| Invalidação de cache no app após `confirmed` | — | Tabela do 07 |

## Fase 3 — Complementos (P1/P2)

| Item | Tools |
|---|---|
| Lazer: programação e info + navegação para inscrição | T24, T25, T26 |
| SPA, boutique, ESG, dicas (consulta + RAG) | T31–T34 |
| Cancelar restaurante (com a restrição G4) | T15 |
| Editar pratos (navegação) | T16 |
| Experiência com termo: card de aceite (`form.text` + checkbox) ou navegação | T11 (extensão) |

## Fase 4 — Evoluções (P3)

- Cancelamento de restaurante por id (G4), idempotência na API oficial (G9) e faixas etárias de lazer na API (G7).
- Pré-preenchimento de pessoas em `bookingExperienceSelectDate` / `bookingGastronomySelectDate`.
- Deep links pelo push usando a mesma lista permitida de navegação.
- Quiz como widget nativo no chat (T35 + `useQuizSession`).
- Reserva integral de restaurante pelo chat, só se o produto quiser e com as regras R-GAS-06/09/10/11 movidas para a API.

## Prioridades consolidadas

| Prioridade | Funcionalidades |
|---|---|
| **P0** | Contexto/identidade, restaurantes + cardápio + disponibilidade, experiências + reserva, eventos, solicitações (criar + consultar), minhas reservas, minhas solicitações, navegação por cards |
| **P1** | Cancelamentos (experiência, solicitação), favoritos, lazer (consulta), SPA |
| **P2** | Cancelar restaurante, editar pratos, boutique, ESG, dicas, cancelar inscrição |
| **P3** | Quiz no chat, reserva de restaurante integral, deep links |

> **Ajuste em relação à prioridade inicial sugerida:** Lazer desce de P0 para P1, porque a inscrição depende de formulário e termo dinâmicos e de faixas etárias fixas no app (G7). A consulta é simples, mas a operação não cabe no chat agora. Favoritos sobem para P1 por serem baratos (E36, E37, E39), mas dependem de G6.
