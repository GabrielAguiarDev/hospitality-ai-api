# 07 — Fluxos transacionais

## Classificação geral

| Categoria | Operações |
|---|---|
| **Consulta imediata (segura)** | Catálogos (restaurantes, cardápio, experiências, eventos, lazer, SPA, boutique, ESG, dicas, quiz), disponibilidade, elegibilidade, minhas reservas, minhas solicitações, favoritos |
| **Exige confirmação explícita** | Reservar experiência (sem termo), criar solicitação, cancelar solicitação, cancelar reserva de experiência, cancelar inscrição de lazer, cancelar reserva de restaurante (só se houver uma única no restaurante) |
| **Confirmação leve (reversível)** | Favoritar e desfavoritar evento |
| **Exige tela específica** | Reservar restaurante (seleção de pratos), editar pratos, inscrição de lazer (termo, ficha, responsável), reserva de experiência com termo/ficha, jogar quiz |
| **Não oferecer pelo chat** | Agendar SPA, comprar na boutique (sem API), responder quiz via LLM, qualquer operação sem sessão autenticada real |

## Esqueleto comum (preview → confirmação → execução)

O padrão já existe para experiências (`experience.booking.card` + `POST /chat/actions`, ver `docs/mobile-ai-integration.md` §4.2 e §5). A proposta é generalizá-lo.

```text
1 Intenção          LLM escolhe a tool *.prepare*
2 Consulta          tool lê catálogo/estado com o token do hóspede
3 Parâmetros        faltou algo? → a LLM pergunta (sem chamar a tool de novo com valores inventados)
4 Validação         servidor aplica as regras (03) e resolve as pessoas pela sessão
5 Elegibilidade     disponibilidade e janela de horário consultadas AGORA
6 Resumo            servidor grava o snapshot {previewId, payload, expiresAt} → card status=preview
7 Confirmação       usuário toca Confirmar → POST /chat/actions {type, conversationId, previewId}
8 Execução          servidor revalida 4-5, chama a API oficial com o payload DO SNAPSHOT
9 Erros             status failed/expired/unavailable/changed + reason (texto da API quando houver)
10 Resultado        card status=confirmed + id; reply curto
11 Cache/estado     app invalida as queryKeys afetadas (tabela abaixo)
12 Cancelamento     card oferece o link para Minhas Reservas/Solicitações; cancelar = outro fluxo com confirmação
```

### Idempotência e duplicidade

- A chave de idempotência é o `previewId`, gerado pelo servidor.
  - Uma segunda confirmação devolve `already_confirmed` sem chamar a API oficial.
  - Esse status já existe em `ChatActionStatus` (`chatApi.types.ts:110`).
- Um lock por `previewId` durante a execução evita requisições concorrentes (duplo toque, voz + toque).
- O app trava os botões enquanto o card está em `confirming` (`ChatActionPending`), sem esperar o servidor.
- Para operações sem chave natural na API oficial (E08 `POST order`, E31 `POST experience-booking`):
  - antes de executar, consultar a lista do hóspede (E07, E33);
  - se já existir um item idêntico criado nos últimos N minutos, devolver `changed` ou `already_confirmed`.
- O TTL do preview (`expiresAt`) deve ser curto (sugestão: 10 min), porque a disponibilidade muda.

### Invalidação de cache no app após `confirmed`

Hoje o app não faz isso para as ações do chat. As queryKeys reais de cada operação são:

| Operação | queryKeys |
|---|---|
| Reservar ou cancelar experiência | `["bookingExperience", lodgingIdPms]` |
| Cancelar restaurante | `["bookingGastronomy", lodgingIdPms]` |
| Criar ou cancelar solicitação | `["order"]` |
| Cancelar inscrição | `["leisureSubscription"]` |
| Favoritos | `["notifications"]` + agendar ou cancelar o lembrete local (`useNotification.setNotification` / `cancelNotification`) |

---

## T-EXP — Reservar experiência (P0, operação com confirmação)

| Passo | Detalhe |
|---|---|
| 1 Intenção | "Quero reservar o passeio de barco amanhã para mim e minha filha" |
| 2 Consulta | T08 (detalhe: regras, termo, preços) |
| 3 Parâmetros | `experienceId`, `date`, `hour` (se `isHour`), participantes (por nome), titular (se houver mais de um adulto), **telefone** (obrigatório, R-EXP-11), obs. Perguntar o que faltar. |
| 4 Validação | T09: R-EXP-03 a R-EXP-07 (idade, titular 18+, titular presente quando exigido, sem duplicados, já reservados) |
| 5 Disponibilidade | T10 (E30) com adultos e crianças, e janela `maxBookingHour` |
| 5b Termo/ficha | Se `experience.formId && form`: **parar** e devolver `navigate Experience` (o app conduz o termo e a ficha). Alternativa futura: card de aceite. |
| 6 Resumo | `experience.booking.card` em `preview`: título, data, hora, adultos/crianças, `totalPrice` ou `priceNote`, avisos |
| 7 Confirmação | Botão Confirmar (`experience.booking.confirm`) |
| 8 Execução | E31 com `{date, lodgingIdPms, obs, guestId: titular, responsibleId, experienceId, phone, experienceAvailabilityId, experienceHouryId?, expBookingGuests, adultCompanions, childCompanions}` → E32 se houver ficha |
| 9 Erros | Chaves padronizadas (vagas, idade, duplicidade), traduzidas como em `utils/experienceBookingErrors.ts`. Falha em E32 **não** desfaz E31 (`signFailed`) |
| 10 Resultado | `confirmed` + `bookingId`. Se `form.signature`: avisar sobre a assinatura presencial (R-EXP-13) |
| 11 Cache | `["bookingExperience", lodgingIdPms]`; lembrete local de D-1 às 12:00 (lacuna G6) |
| 12 Cancelamento | T14 |

**Riscos:**

- Hoje a reserva pelo chat é **simulada** e não chega ao sistema do resort.
- A troca para a reserva real depende de G1 (identidade) e G2 (pass-through).
- O valor exibido precisa vir do servidor (`totalValue`). Os preços de `experienceValue` são só informativos.

## T-GAS — Reservar restaurante (P0, mas pela tela)

**Viabilidade da reserva integral pelo chat:** tecnicamente **possível**, porque todos os endpoints existem (E17, E18, E19, E21, E22, E23). **Não é recomendada na fase 1.**

| Dependência | Complexidade no chat |
|---|---|
| Um pedido de pratos **por pessoa** (R-GAS-08) | Alta: N pessoas × M categorias de perguntas |
| Um prato por categoria de 1º nível + "não desejo" (R-GAS-09) | Alta |
| Porções compartilhadas `ceil(pessoas/serves)` (R-GAS-10) | Média: regra só no app, precisa ser reimplementada |
| Bloqueios entre categorias via E21 (R-GAS-11) | Média: regra só no app |
| Ingredientes removíveis por prato (R-GAS-12) | Alta para conversa |
| Uma reserva aprovada por restaurante (R-GAS-06) | Baixa |
| `closure`, turnos e vagas (R-GAS-07) | Baixa |
| Aviso de no-show (R-GAS-14) | Baixa (texto) |

**Riscos de fazer pelo chat:**

- reimplementar no servidor as regras R-GAS-06, 09, 10 e 11, que hoje estão só no app;
- pedidos de pratos interpretados errado;
- `numberOfGuests` inconsistente (R-GAS-13).

**Fluxo recomendado:**

1. Consulta pelo chat: T02 a T05 (restaurantes, cardápio, horários com vaga, aviso de reserva existente).
2. `navigate Gastronomy {restaurantId}` → `bookingGastronomyDetails` (já implementado).
3. Evolução (P2): pré-selecionar pessoas via `bookingGastronomySelectDate`, com revalidação no app.

## T-REQ — Criar solicitação (P0, operação com confirmação)

| Passo | Detalhe |
|---|---|
| 1 | "Preciso de duas toalhas extras" |
| 2 | T20: buscar o item em E06 |
| 3 | Se houver vários itens ou departamentos: card C09 para escolher. Se nenhum: oferecer observação livre no departamento mais provável ou `navigate Requests` |
| 4 | R-REQ-03 (item ou obs), R-REQ-04 (sem pai quando há filho). Quantidade vai para `guestObs` (R-REQ-05) |
| 5 | Não há disponibilidade a checar (só `situation` do item) |
| 6 | `operation.card` (`request.create`): Departamento / Itens / Observação |
| 7–8 | E08 `{departmentId, responsibleId, itemDepartmentIds, guestObs}` |
| 9 | Erro genérico da API |
| 10 | `confirmed` + "Seu pedido foi enviado ao <departamento>" |
| 11 | `["order"]` (o app hoje não invalida nem na própria tela) |
| 12 | T23 enquanto `pendente` |

## T-REQ-CANCEL / T-LAZ-CANCEL — Cancelar solicitação ou inscrição (P1, operação com confirmação)

- **Pré-condições**:
  - o item pertence ao hóspede, ou seja, está na lista E07 ou E14 obtida com o token;
  - `situation === "pendente"`.
- **Execução**:
  - solicitação: E09 `{situation: "cancelada"}`;
  - inscrição: E15 `{situation: "negado"}`.
- **Sem desfazer**: não existe operação para reabrir.

## T-EXP-CANCEL — Cancelar reserva de experiência (P1, operação com confirmação)

- **Pré-condições**: `situation !== "cancelado"` e data/hora > agora (15:00 se não houver hora).
- **Resumo**: título, data, hora, participantes, valor.
- **Execução**: E34 `{situation: "cancelado"}`.
- **Efeito local**: cancelar o lembrete (`cancelNotification(experienceId)`).
- `NÃO CONFIRMADO`: política de reembolso e multa. O app não mostra nada sobre isso, e a IA não deve prometer reembolso.

## T-GAS-CANCEL — Cancelar reserva de restaurante (P2, operação com confirmação e restrições)

- **Pré-condições**: `aprovada` e agora < data + `closure`.
- **Bloqueio**: E25 cancela por `lodgingIdPms + restaurantId`.
  - Se houver **mais de uma** reserva aprovada no mesmo restaurante, recusar e navegar para `MyReservation {tab: "Gastronomy"}`.
  - Isso vale até existir cancelamento por id (G4).
- **Resumo**: deve citar o aviso de no-show (R-GAS-14).

## T-FAV — Favoritar evento (P1, confirmação leve)

- **Execução**: E37 `{event, eventType: "evento", eventId}`, com o `event` obtido pelo servidor em E35.
- **Antes de executar**: checar duplicidade em E36.
- **Desfazer**: E39 (botão no card).
- **Lembrete**: o local (1 h antes) depende do app. Ver a ação `favorite.changed` proposta no [05](05-chat-cards-catalog.md) e a lacuna G6.

## T-LAZ — Inscrição em lazer (P1, pela tela)

**Requisitos levantados** (`screens/Signature/**`):

- escolher um responsável ≥ 18 (exceto regra adulta com todos adultos);
- autorizar os participantes (faixas 4–7 e 8–11 fixas no app, R-LAZ-03);
- campos dinâmicos da ficha (`texto`, `data`, `numero`, `condicional`);
- aceite de um ou mais termos HTML em sequência;
- "autorizar todos os termos pendentes".

O payload resultante é um POST por leisureForm, com `situation: "pendente"`.

**Decisão:** `navigate Leisure`, com a categoria. Um fluxo pelo chat exigiria:

- mover as faixas etárias para a API (G7);
- um card de formulário dinâmico;
- um card de aceite de termo.

## T-QZ — Quiz (P3, widget, não LLM)

Jogar no chat é viável **apenas** como widget nativo que reutiliza `useQuizSession`. Condições:

- o hook vive no nível da tela de chat;
- o timer é derivado de `startedAt + durationMs` do servidor;
- o avanço automático do modo async é movido de `Play.tsx:56-83` para o hook;
- as bolhas antigas ficam somente leitura;
- seleção de hóspede, PIN e `holder_only` acontecem antes do jogo.

**A LLM não recebe as perguntas nem as respostas.** Fase 1: `navigate Quiz`.

## Requisitos transversais

| Requisito | Onde se aplica | Origem dos dados |
|---|---|---|
| Assinatura gráfica | Nenhum fluxo: é sempre presencial ou checkbox | — |
| Data de nascimento | Experiência, lazer, restaurante (`minimumAge`) | Sessão (PMS). Não pedir ao usuário |
| Seleção de acompanhantes | Experiência, restaurante, lazer | Sessão. O LLM refere-se a eles por nome |
| Quantidade de pessoas | Experiência (= participantes), restaurante (= titular + acompanhantes) | Derivada da seleção |
| Datas e horários | Experiência, restaurante | Disponibilidade (E30/E22), fuso do resort |
| Restrições alimentares | Restaurante (ingredientes removíveis) | E19 `menuItem` |
| Idade mínima | Experiência, restaurante, lazer | Cadastro + regras no app |
| Limite de reservas | Restaurante: 1 aprovada por restaurante; experiência: 1 por pessoa salvo `repeat` | E24/E33 |
| Confirmação de valores | Experiência | `totalValue` calculado pela API |
| Permissões | Todas | Token do hóspede (08) |
