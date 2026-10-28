# 03 — Regras de negócio

Este documento reúne as regras que a IA precisa respeitar. Cada regra tem um ID (`R-<MÓDULO>-nn`), a referência no código e a indicação de onde ela é aplicada:

- **[APP]**: a regra está só no front. O backend da IA **precisa reimplementá-la** ou chamar a API de produção, que pode ou não validá-la.
- **[API]**: a regra é aplicada pelo servidor.
- **[AMBOS]**: o front valida e o servidor também.
- **[NÃO CONFIRMADO]**: não foi possível determinar pelo código.

> **Princípio geral:** várias regras importantes só existem no app (idade, janela de corte, limite por restaurante, porções compartilhadas). Para respeitá-las, o backend da IA tem três caminhos: replicar a lógica, extraí-la para a API oficial ou devolver navegação para a tela que já a aplica. Ler o banco diretamente **não** traz essas regras junto.

---

## Contexto da estadia (vale para todos os módulos)

| ID | Regra | Onde | Ref. |
|---|---|---|---|
| R-CTX-01 | O hóspede logado tem `guestHolder` (titular da hospedagem) e `companions[]`. Quem participa de reservas e inscrições é sempre `[guestHolder, ...companions]`. | [APP] | `services/types.d.ts:15-22` |
| R-CTX-02 | A janela de reserva é a estadia: `guestHolder.dateCheckin` → `dateCheckout`, **incluindo o dia do checkout**. | [APP] | `screens/Booking/Gastronomy/screens/SelectDate.tsx:31-51`; `services/concierge/catalog.ts:113-117` |
| R-CTX-03 | `responsibleId` é o id do registro "Hospede" em `GET system/responsible`. É obrigatório em solicitações, reservas de restaurante e reservas de experiência. | [APP] (obtenção) / [API] (exigência: NÃO CONFIRMADO) | `services/system/index.ts:64-87` |
| R-CTX-04 | `lodgingIdPms` (id da hospedagem no PMS) identifica as reservas da estadia. Deve vir da sessão, nunca do texto do usuário. | [APP] | `services/gastronomy/index.ts:280-284`; `services/experience/index.ts:244-248` |
| R-CTX-05 | A idade é calculada a partir de `birthDate`. Experiências usam a data "pura" comparada ao "hoje" do resort (`NewDate()`, America/Sao_Paulo). Gastronomia e Lazer usam `new Date()` do aparelho. Pode haver divergência na véspera de aniversários. | [APP] | `utils/experienceAgeRules.ts:55-67`; `screens/Booking/Gastronomy/actions.ts:44-54`; `utils/validate.ts` |
| R-CTX-06 | O titular de qualquer reserva tem 18 anos ou mais (`RESPONSIBLE_AGE = 18`). | [AMBOS] para experiências, [APP] para gastronomia | `utils/experienceAgeRules.ts:13`; `Booking/Gastronomy/screens/Details.tsx:118` |
| R-CTX-07 | A Yago AI API atual só aceita titular com **hospedagem ativa**, ou seja, da véspera do check-in até o check-out. | [API IA] | `docs/mobile-ai-integration.md` §2 |

---

## Solicitações (departamentos)

| ID | Regra | Onde | Ref. |
|---|---|---|---|
| R-REQ-01 | Só aparecem departamentos com `infosDepartment` **ou** `itemsDepartment`, e só itens com `situation === true`. | [APP] | `services/department/index.ts:43-53` |
| R-REQ-02 | Os itens são hierárquicos (`subItemId` = pai). A tela renderiza um nível de subitens. | [APP] | `services/department/index.ts:28-36` |
| R-REQ-03 | É obrigatório **ao menos um item ou uma observação** (a observação não passa por `trim`). | [APP] | `screens/Requests/actions.ts:48-51` |
| R-REQ-04 | Quando um subitem está marcado, o pai **não é enviado**. Marcar um subitem marca o pai visualmente. | [APP] | `screens/Requests/actions.ts:16-23`; `[departmentId].tsx:81-145` |
| R-REQ-05 | **Não existe quantidade.** "Duas toalhas" só pode ir como texto em `guestObs`. | [APP]/[API] | `types.d.ts:87-92` |
| R-REQ-06 | Um departamento sem itens não permite criar solicitação, nem só com observação. | [APP] | `[departmentId].tsx:65` |
| R-REQ-07 | Situações: `pendente`, `executando`, `atendida`, `cancelada`. O hóspede **só cancela quando está `pendente`**, sempre com confirmação. | [APP] (UI), [API] NÃO CONFIRMADO | `MyRequests/index.tsx:67-117` |
| R-REQ-08 | A transição para `executando` ou `atendida` é feita pelo colaborador (`collaboratorId`, `collaboratorObs`). Não há notificação push de mudança de status implementada no app. | NÃO CONFIRMADO no servidor | `types.d.ts:68-85` |
| R-REQ-09 | A solicitação é vinculada ao hóspede pelo token. A UH (`uh`) vem na resposta. | [API] | `types.d.ts:83` |

## Gastronomia

| ID | Regra | Onde | Ref. |
|---|---|---|---|
| R-GAS-01 | Um restaurante aparece se `situation && order > 0 && noites_da_estadia >= minimumDaily`. | [APP] | `screens/Gastronomy/actions.ts:26-31` |
| R-GAS-02 | O agrupamento é por `type`: `restaurante`, `bar` e `alimentacao`. | [APP] | `screens/Gastronomy/actions.ts:32-46` |
| R-GAS-03 | `existsBooking === "sim"` leva ao fluxo de reserva; caso contrário, a tela é só informativa (cardápio). | [APP] | `screens/Gastronomy/index.tsx:70,109,153`; `services/concierge/catalogCards.ts:31-49` |
| R-GAS-04 | Horário exibido: com reserva, os `timeRestaurant[].description` ativos; sem reserva, `operation` (texto livre). `closure` não é exibido. | [APP] | `components/CardRestaurant.tsx:84-88` |
| R-GAS-05 | Participantes elegíveis: se `minimumAge != null`, só quem tem idade ≥ `minimumAge`. | [APP] | `Booking/Gastronomy/actions.ts:84-96` |
| R-GAS-06 | **No máximo uma reserva `aprovada` por restaurante por hospedagem.** Com uma já aprovada, a tela bloqueia e manda para Minhas Reservas. | [APP] (+ [API] NÃO CONFIRMADO) | `Booking/Gastronomy/screens/Details.tsx:42-44` |
| R-GAS-07 | Uma data só pode ser reservada se `agora < data + closure` e houver slot `isAvailable`. O slot do dia de hoje fica bloqueado se a hora já passou (fuso do resort). | [APP] | `SelectDate.tsx:41-76` |
| R-GAS-08 | É obrigatório escolher **pratos para todas as pessoas** (titular + acompanhantes) antes de finalizar. | [APP] | `SelectDish/OrderSummary.tsx:227-263` |
| R-GAS-09 | Na prática, **um prato por categoria de primeiro nível** (incluindo subcategorias), com opção "não desejo" por categoria. | [APP] | `SelectDish/DishList.tsx:67-85,139-147` |
| R-GAS-10 | **Porções compartilhadas**: um prato com `serves > 0` pode ser escolhido no máximo `ceil(pessoas / serves)` vezes na reserva. | [APP] | `SelectDish/DishList.tsx:92-107` |
| R-GAS-11 | **Bloqueio entre categorias**: `{categoryMenuId: X, blockCategoryId: Y}` faz com que escolher um prato de X desabilite Y. | [APP] (dados da [API]) | `Booking/Gastronomy/actions.ts:107-157` |
| R-GAS-12 | Restrições = remover ingredientes (`menuItem`) do prato. Ficam gravadas em `json.restrictionDish`. **Não são** "restrições alimentares" genéricas (vegano, sem glúten etc.). | [APP] | `SelectDish/DishList.tsx:285-360` |
| R-GAS-13 | `numberOfGuests` enviado = **todos os hóspedes da hospedagem**, e não os selecionados (inconsistência). | [APP] | `Booking/Gastronomy/actions.ts:172`; `SelectDate.tsx:38` |
| R-GAS-14 | Aviso exibido: não comparecer ou cancelar impede nova reserva; tolerância de 10 min. **O app não aplica essa regra.** | [API] NÃO CONFIRMADO | `msgWarningBookingRestaurant` (`OrderSummary.tsx`) |
| R-GAS-15 | Editar e cancelar só é possível com `situation === "aprovada"` **e** `agora < data + closure`. A edição altera somente os pratos e as observações. | [APP] | `MyReservation/screens/Gastronomy.tsx:76-77,113,238` |
| R-GAS-16 | **O cancelamento é por `lodgingIdPms + restaurantId`** e não pelo id da reserva. | [API] | `services/gastronomy/index.ts:328-332` |
| R-GAS-17 | Minhas Reservas mostra só as `aprovada`. O serviço descarta reservas sem `orderRestaurant`. | [APP] | `MyReservation/actions.ts:55-77`; `services/gastronomy/index.ts:306` |
| R-GAS-18 | A data da reserva é enviada como `${YYYY-MM-DD}T12:00:00.000Z`. Na exibição, o app soma +3 h. | [APP] | `Booking/Gastronomy/actions.ts`; `MyReservation/actions.ts:60` |

## Experiências

| ID | Regra | Onde | Ref. |
|---|---|---|---|
| R-EXP-01 | A lista mostra `situation && order > 0`, agrupada por `type`: `allinclusive` (incluso) e `reserva` (rótulo "taxa extra"). | [APP] | `screens/Experiences/actions.ts` |
| R-EXP-02 | `allinclusive` com `existsBooking === "sim"` abre a reserva; sem `existsBooking`, abre a página informativa. A aba `reserva` **sempre** abre a reserva. | [APP] | `screens/Experiences/index.tsx:68-72,116` |
| R-EXP-03 | Idade mínima: `minimumAge <= 0/null` significa sem restrição. | [AMBOS] | `utils/experienceAgeRules.ts:69-92` |
| R-EXP-04 | Se `requiresResponsible === true`, um participante com idade em [`minimumAge`, `minimumAgeAlone`) **exige o titular participando**. | [AMBOS] | `utils/experienceAgeRules.ts:96-120` |
| R-EXP-05 | O titular (`guestId` da reserva) tem 18 anos ou mais e **não precisa participar**, salvo pela R-EXP-04. | [AMBOS] | `types.d.ts:234`; `docs/regras-reserva-experiencia-frontend.md` |
| R-EXP-06 | Um hóspede já inscrito em uma reserva `pago` ou `pendente` da mesma experiência não pode ser selecionado de novo, salvo se `repeat === true`. | [AMBOS] | `utils/experienceAgeRules.ts:16,151` |
| R-EXP-07 | Ordem de validação do grupo: titular → idade do titular → ≥ 1 participante → idade dos participantes → titular presente quando exigido → sem duplicados. | [APP] | `validateExperienceGroup` (`experienceAgeRules.ts:180-202`) |
| R-EXP-08 | Disponibilidade: um POST com a janela da estadia e os participantes separados em adultos (≥ 18) e crianças. | [API] | `Booking/Experience/screens/SelectDate.tsx:54-67` |
| R-EXP-09 | Uma data só fica habilitada se a soma de vagas ≥ número de participantes e `agora < data + maxBookingHour`. Sem `maxBookingHour`, o dia de hoje fica excluído (efeito do parse UTC, NÃO CONFIRMADO se é intencional). | [APP] | `SelectDate.tsx:69-94` |
| R-EXP-10 | Disponibilidade por hora (`isHour === 1`) exige escolher a hora. `experienceAvailabilityId` vem da hora, se houver, ou da data. | [AMBOS] | `SelectDate.tsx:102-139` |
| R-EXP-11 | **Telefone é obrigatório** (≥ 10 dígitos, máscara de celular). Observação é opcional. | [APP] | `SelectDate.tsx:134,182-195` |
| R-EXP-12 | Termo ou ficha: se `formId && form`, o hóspede precisa ler e aceitar (checkbox). Campos ativos são opcionais. A ficha é registrada **uma vez, no titular**, depois da reserva criada. | [APP] + [API] | `Booking/Experience/screens/Terms.tsx`, `Form.tsx`; `services/experience/index.ts:167-190` |
| R-EXP-13 | Se `form.signature === true`, o hóspede deve **assinar presencialmente**. O app não captura assinatura gráfica. | [APP] | `services/experience/index.ts:220-224` |
| R-EXP-14 | Preços (`experienceValue[]`, por categoria de cobrança) são informativos. O valor final é calculado pelo servidor (`totalValue`). | [API] | `Booking/Experience/screens/Details.tsx:168-183` |
| R-EXP-15 | Situações da reserva: `pendente`, `pago` (exibido como "confirmada") e `cancelado`. O tipo `"confirmado"` / `"finalizado"` em `types.d.ts:388` **não corresponde** à API. | [API] | `types.d.ts:364,388` |
| R-EXP-16 | Cancelamento disponível quando `data/hora > agora && situation !== "cancelado"`. Sem hora, o app assume 15:00. Não há edição. | [APP] | `MyReservation/screens/Experiences.tsx:80`; `MyReservation/actions.ts:83-87` |
| R-EXP-17 | Erros de reserva vêm como chaves padronizadas traduzidas no app. Texto livre é exibido como veio. | [API] | `utils/experienceBookingErrors.ts` |
| R-EXP-18 | O campo `link` da experiência não é usado. `obs` e `text` (HTML) só aparecem na página informativa ou no detalhe. | [APP] | — |

## Eventos e favoritos

| ID | Regra | Onde | Ref. |
|---|---|---|---|
| R-EVT-01 | A tela de Eventos busca 7 dias a partir de "hoje" calculado em **UTC** (`toISOString`). Depois das 21 h (BRT), "hoje" vira amanhã. | [APP] | `utils/date.ts:142-151`; `screens/Events/actions.ts:16-34` |
| R-EVT-02 | Os eventos são agrupados por dia da semana e exibidos no **fuso do aparelho** (`Intl`). Os rótulos das abas usam `+3 h`. Para o backend: **usar sempre America/Sao_Paulo** ao responder "hoje" ou "à noite". | [APP] | `screens/Events/index.tsx`; `components/CardEvent.tsx` |
| R-EVT-03 | Não existe inscrição nem reserva em evento. A única ação é **favoritar**, que cria um lembrete. | [APP] | `CardEvent.tsx:116-151` |
| R-FAV-01 | Favorito = registro `notification` com `eventType: "evento"`. **Só eventos** podem ser favoritados. `gastronomia` e `experiencia` existem no tipo, mas a UI nunca os cria. | [APP] | `services/notification/index.ts:45-91`; `types.d.ts:586` |
| R-FAV-02 | Ao favoritar, o app agenda **localmente** uma notificação 1 h antes, só se o horário ainda não passou. Ao remover, cancela o agendamento. | [APP] | `services/notification/index.ts:58-79`; `services/useNotification.ts:138` |
| R-FAV-03 | Meus Favoritos só mostra favoritos cujo evento está no cache `events` da janela check-in → hoje+6. Favoritos fora dessa janela "somem". | [APP] | `screens/MyFavorites/actions.ts:26-56` |

## Lazer

| ID | Regra | Onde | Ref. |
|---|---|---|---|
| R-LAZ-01 | As atividades são **semanais e recorrentes** (`dayOfWeek` + `hour`), não datadas. A tela mostra 7 dias a partir de hoje e filtra pelo nome do dia. | [APP] | `screens/Leisure/actions.ts:61-69` |
| R-LAZ-02 | Categorias visíveis: `order > 0 && situation`. Cada categoria tem `leisureInfo` (textos) e `registrationForm = leisureForms[0].form`. | [APP] | `services/leisure/index.ts:52-77` |
| R-LAZ-03 | **Faixas etárias fixas no código por UUID de categoria**: 4–7, 8–11 e 18–100 anos. Quem tem 18 anos ou mais sempre passa. Categoria sem regra aceita todos. | [APP] | `screens/Leisure/actions.ts:28-39` |
| R-LAZ-04 | Inscrição: escolher um **responsável ≥ 18** (exceto quando a regra é "adulto" e todos são adultos), autorizar os participantes, preencher a ficha (`texto`/`data`/`numero`/`condicional`, nenhum campo obrigatório) e aceitar o termo. | [APP] | `screens/Signature/**` |
| R-LAZ-05 | Um hóspede já inscrito (inscrição não `negado`) na mesma categoria ou formulário não aparece de novo. | [APP] | `Leisure/actions.ts:83-121`; `[leisureId].tsx:224-239` |
| R-LAZ-06 | Toda inscrição nasce `pendente`. Aprovar (`aprovado`) ou recusar (`negado`) é feito pelo resort. O hóspede "cancela" gravando `negado`, e só quando está `pendente`. | [APP] + [API] | `Signature/actions.ts:50-120`; `CardSubscription.tsx:162-178` |
| R-LAZ-07 | Inscrições aparecem em **Minhas Solicitações**, não em Minhas Reservas. | [APP] | `MyRequests/actions.ts:56-72` |
| R-LAZ-08 | Se nenhum participante for autorizado no último formulário, **nenhum POST é feito**, mas a confirmação é exibida mesmo assim (bug). | [APP] | `Signature/actions.ts:110-116` |

## SPA, Boutique, ESG, Dicas

| ID | Regra | Ref. |
|---|---|---|
| R-SPA-01 | O SPA é **somente consulta**: serviços com `title`, `description`, `value` (texto) e `time` (texto). **Não há agendamento.** O contato é por WhatsApp (`spa.link`). | `services/spa/index.ts`; `screens/SPA/actions.ts:19-28` |
| R-BTQ-01 | A Boutique é **somente catálogo**: produtos com `status === 1`, `price` (string) e galeria. **Não há compra, carrinho nem contato.** Também não há variações nem estoque. | `services/boutique/index.ts` |
| R-ESG-01 | ESG = um texto institucional + listas de parceiros e iniciativas (imagem + link externo). Não há participação do hóspede nem favoritos. | `services/esg/index.ts` |
| R-TIP-01 | Dicas: só o **primeiro** `tip` é exibido, com seus `tipItems` (título + descrição). Não há categorias, filtros nem favoritos. | `screens/Tip/index.tsx:35` |

## Quiz

| ID | Regra | Ref. |
|---|---|---|
| R-QZ-01 | Uma participação por (quiz, hóspede). Não é possível refazer. | `api/quiz/typeorm/.../QuizParticipation.entity.ts:25`; `services/quiz/apiSession.ts:133-169` |
| R-QZ-02 | A resposta correta **nunca** é enviada antes da resposta do jogador. A pontuação e o tempo são calculados no servidor (+1000 por acerto; desempate por tempo total). | `api/quiz/rules.md`; `services/quiz/types.ts` |
| R-QZ-03 | `participationScope: "holder_only"` restringe a participação ao titular. `requiresPin` exige PIN. | `screens/Quiz/screens/Lobby.tsx:47-63` |
| R-QZ-04 | O modo `live` depende de um host e de socket. O modo `async` é individual e pode ser retomado. | `services/quiz/liveSession.ts`, `apiSession.ts` |
| R-QZ-05 | **A LLM não deve ver nem gerar perguntas ou respostas do quiz.** | recomendação (ver 07) |

## Datas, fusos e horários (consistência entre listagem, detalhe e card)

| ID | Situação | Recomendação ao backend |
|---|---|---|
| R-DT-01 | Eventos: `date` em ISO UTC. O app exibe no fuso do aparelho. | Converter para America/Sao_Paulo antes de responder ou montar o card. Enviar ISO com offset. |
| R-DT-02 | Reserva de restaurante: `date` = `YYYY-MM-DDT12:00:00.000Z` (meio-dia UTC como data "pura"). O turno está em `timeRestaurant.description` (texto "19:30"). | Tratar como data local + `HH:mm` do turno. |
| R-DT-03 | Reserva de experiência: `date` em `YYYY-MM-DD`; a hora está em `experienceAvailability.experienceHoury[].hour` (via `experienceHouryId`). Sem hora, a vaga vale para o dia (o app usa 15:00 como referência de cancelamento). | Expor `time: null` quando não houver hora (como o `ExperienceBookingSummary` já faz). |
| R-DT-04 | Lazer: `dayOfWeek` em inglês + `hour` `HH:mm:ss`. | Expandir para datas concretas dentro da estadia. |
| R-DT-05 | `closure` (restaurante) e `maxBookingHour` (experiência) são horas-limite **do próprio dia** do serviço. | Comparar com a hora atual no fuso do resort. |
| R-DT-06 | O app tem `serverNow()` (offset pelo header `Date`), mas a maioria das telas usa o relógio do aparelho. | O backend é a fonte de verdade para "agora". |

## Inconsistências registradas

1. `TSituationTypeExperience` (`"confirmado" | "finalizado"`) ≠ `IResponseBookingExperience.situation` (`"pago"`). O sort por `"confirmado"` não tem efeito (`services/experience/index.ts:250-254`).
2. `numberOfGuests` / `numberGuests` da gastronomia contam a hospedagem inteira (R-GAS-13).
3. O cancelamento de restaurante é feito por restaurante e não por reserva (R-GAS-16).
4. `types.d.ts:198-201` tem o tipo `stirng` (erro de digitação).
5. `IResponseBookingGastronomy` não declara `orderRestaurant` de forma consistente com o uso. `TTimeRestaurant` está declarado duas vezes, com tipos diferentes (`situation: string` vs `boolean`).
6. `IResponseForm.signature` e `situation` são `string`, mas são usados como boolean.
7. `screens/Signature/screens/Children.tsx:26` filtra `situation !== "negado"` em um objeto que não declara esse campo.
8. Os eventos usam UTC para "hoje" (R-EVT-01) e o fuso do aparelho para exibir.
9. O "cancelamento" de inscrição de lazer grava `negado`, o mesmo valor de uma recusa do resort. Não dá para diferenciar os dois casos.
10. `getSectionListRestaurantId` (seções de cardápio) não é usado.
11. `docs/mobile-ai-integration.md` (§8) diz que a IA conta as pessoas de uma reserva de restaurante pelos pedidos de pratos, e isso **é coerente** com o app: há um `orderRestaurant` por pessoa.
