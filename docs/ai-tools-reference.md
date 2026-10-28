# Yago AI — referência das ferramentas (Tool Registry)

> **Público:** engenheiros do `yago-ai-api` e quem integra o app.
> **Fonte de verdade:** `src/operations/operations-tool-registry.service.ts` (definições e execução) e `src/operations/intent-tool-map.ts` (intenção → ferramenta). A tabela abaixo foi gerada a partir de `listTools()` desta versão. Um teste garante que toda ferramenta tem os metadados preenchidos.

## Como as ferramentas são usadas

```text
mensagem → IntentClassifierService (regras determinísticas; modelo só com vocabulário fechado de leitura)
         → ConversationContextService (resolve "essa", "a segunda", "sim" a partir do estado)
         → OperationsDispatcherService (intenção → handler do domínio)
         → handler monta os argumentos com IDs do cadastro ou da conversa
         → OperationsToolRegistryService.execute(nome, guest, input)
         → resultado tipado → handler monta reply + actions (cards) → isValidChatAction
```

- **O modelo de linguagem não escolhe ferramentas nem argumentos.** Não existe chamada genérica de ferramenta, endpoint, URL ou SQL. A única exceção é `POST /operations/ask`, que testa o *function calling* nativo com uma ferramenta de leitura e mesmo assim executa `reservations.list` pelo Registry.
- **Lista fechada:** um nome fora do `switch` do Registry é recusado com `400 Ferramenta não permitida.`.
- **Entradas validadas** em `src/operations/tool-inputs.ts`: objeto simples, campos permitidos por ferramenta (campo extra → `400`), formatos `AAAA-MM-DD`, `HH:MM`, UUID e limites numéricos.
- **IDs do cadastro só de saídas anteriores:** `restaurants.menu` confere o `restaurantId` no catálogo ativo; experiências são relidas pelo ID; itens de solicitação são conferidos no departamento.
- **Ambiente:** o Registry falha fechado fora de `NODE_ENV=development` (`403`), porque a identidade ainda é de demonstração.
- **Contexto do hóspede:** toda ferramenta recebe `GuestContext { resortId, guestId }` do `DemoGuestGuard`. As ferramentas pessoais (`access: guest`) resolvem a estadia no servidor (`GuestStayService.resolve`: titular com hospedagem ativa no `RESORT_ID` configurado) e filtram pela subconsulta da estadia (`STAY_PARTY_SUBQUERY`: mesma hospedagem e datas sobrepostas). Nenhum `guestId`, `lodgingId` ou data vem do cliente ou do modelo.
- **Snapshot somente leitura:** todo acesso passa por `ResortSnapshotGateway.select`, que só aceita `SELECT`/`WITH` sem `;` nem comandos de escrita, sobre um usuário MySQL só com `SELECT`.

## Legenda das colunas

| Coluna | Valores |
| --- | --- |
| `access` | `catalog`: dado público do resort. `guest`: dado da estadia do titular (exige hospedagem ativa). |
| `source` | `snapshot`: banco do resort (somente leitura). `ai_db`: banco interno da IA. `snapshot+ai_db`: ambos. |
| `mode` | `read`: consulta. `simulated_write`: grava **somente** no banco da IA; nunca no sistema oficial. |
| `confirmation` | `none`: sem confirmação. `explicit`: pré-visualização persistida + confirmação por botão (`POST /chat/actions`) ou texto inequívoco. |
| `cards` | Ações (`actions`) que os handlers montam a partir do resultado. |

## Catálogo

| Ferramenta | Domínio | Descrição | Entrada | Saída | access | source | mode | confirmation | Cards | Intenções |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `reservations.list` | reservations | Consulta reservas de restaurante do hóspede atual. | — (nenhum argumento) | RestaurantReservation[] da estadia | guest | snapshot | read | none | `booking.list` | `reservation.list`, `reservation.details`, `reservation.status` |
| `requests.list` | requests | Consulta solicitações do hóspede atual. | — (nenhum argumento) | GuestRequest[] (oficiais do snapshot + simuladas pelo chat) | guest | snapshot+ai_db | read | none | `request.list` | `request.list`, `request.status` |
| `requests.catalog` | requests | Lista departamentos que aceitam solicitação, seus itens ativos e avisos. | — (nenhum argumento) | RequestDepartment[] | catalog | snapshot | read | none | `navigate` | `request.catalog` |
| `requests.preview` | requests | Prepara uma solicitação SIMULADA com itens do catálogo (banco interno da IA). | `conversationId`: UUID da conversa (servidor)<br>`departmentId`: string: ID do cadastro<br>`items`: [{ itemId: ID do cadastro, quantity: 1-10 }], 1-10 itens<br>`note`: string? até 2000 | RequestPreviewResult | guest | snapshot+ai_db | simulated_write | explicit | `request.card` | `request.create` |
| `requests.confirm` | requests | Confirma uma solicitação simulada da conversa (não envia ao departamento). | `conversationId`: conversationId: UUID da conversa (servidor)<br>`previewId`: previewId: UUID da pré-visualização (servidor) | RequestConfirmResult (protocolo SIM-…) | guest | ai_db | simulated_write | explicit | `request.card` | `request.confirm` |
| `requests.cancel` | requests | Descarta uma solicitação simulada pendente. | `conversationId`: conversationId: UUID da conversa (servidor)<br>`previewId`: previewId: UUID da pré-visualização (servidor) | { cancelled } | guest | ai_db | simulated_write | none | `request.card` | `request.cancel` |
| `requests.cards` | requests | Consulta o estado atual dos cards de solicitação da conversa. | `conversationId`: conversationId: UUID da conversa (servidor)<br>`previewIds`: UUID[] (1-50) | RequestCardState[] | guest | ai_db | read | none | `request.card` | — (interno) |
| `boutique.list` | boutique | Lista produtos ativos da boutique e da conveniência, com preços. | — (nenhum argumento) | BoutiqueProduct[] | catalog | snapshot | read | none | `catalog.list`, `navigate` | `boutique.info` |
| `spa.list` | spa | Lista serviços ativos do SPA e do salão de beleza. | — (nenhum argumento) | SpaService[] | catalog | snapshot | read | none | `catalog.list`, `navigate` | `spa.info` |
| `tips.list` | tips | Lista as dicas publicadas para a estadia. | — (nenhum argumento) | Tip[] | catalog | snapshot | read | none | `catalog.list`, `navigate` | `tips.list` |
| `quiz.list` | quiz | Lista quizzes ativos (sem participações nem PIN). | — (nenhum argumento) | QuizInfo[] (sem perguntas nem respostas) | catalog | snapshot | read | none | `catalog.list`, `navigate` | `quiz.info` |
| `esg.info` | esg | Textos publicados de ESG do resort. | — (nenhum argumento) | EsgInfo[] | catalog | snapshot | read | none | `catalog.list`, `navigate` | `esg.info` |
| `restaurants.list` | gastronomy | Lista restaurantes, bares e opções de alimentação ativos, com filtro opcional por tipo ou nome. | `type`: 'restaurante' | 'bar' | 'alimentacao'?<br>`name`: string? até 120 (busca no cadastro) | RestaurantInfo[] | catalog | snapshot | read | none | `restaurant.options`, `navigate` | `restaurant.booking`, `restaurant.list`, `restaurant.details` |
| `restaurants.menu` | gastronomy | Cardápio publicado de um restaurante: categorias e pratos ativos (somente leitura). | `restaurantId`: string: ID do cadastro | RestaurantMenu | catalog | snapshot | read | none | `menu.view`, `navigate` | `restaurant.menu` |
| `favorites.list` | favorites | Eventos favoritados (lembretes) pelos hóspedes da estadia. | — (nenhum argumento) | FavoriteEvent[] | guest | snapshot | read | none | `catalog.list`, `navigate` | `favorite.list`, `favorite.manage` |
| `leisure.enrollments` | leisure | Inscrições de lazer dos hóspedes da estadia e seu status. | — (nenhum argumento) | LeisureEnrollment[] | guest | snapshot | read | none | `request.list` | `leisure.enroll` |
| `events.list` | events | Lista eventos, shows e a programação de lazer de uma data. | `date`: AAAA-MM-DD (fuso do resort) | { date, events: ResortEvent[] } | catalog | snapshot | read | none | `event.list`, `navigate` | `event.list` |
| `experiences.list` | experiences | Lista ou busca experiências ativas com filtros opcionais (data, período, faixa de horário, gratuitas, para crianças, com reserva, grupo) e, com data, as vagas registradas no snapshot. | `date`: AAAA-MM-DD?<br>`includeInactive`: boolean?<br>`period`: 'morning' | 'afternoon' | 'evening'?<br>`after`: HH:MM?<br>`before`: HH:MM?<br>`free`: true?<br>`forChildren`: true?<br>`bookable`: true?<br>`adults`: 0-10?<br>`children`: 0-10? | { date, experiences: ExperienceInfo[], slots: ExperienceSlot[] } | catalog | snapshot+ai_db | read | none | `experience.options`, `navigate` | `experience.list`, `experience.search` |
| `experiences.details` | experiences | Consulta descrição, regras e preços de uma experiência. | `experienceId`: string: ID do cadastro | ExperienceInfo | null | catalog | snapshot | read | none | `experience.options`, `navigate` | `experience.details`, `experience.price` |
| `experiences.availability` | experiences | Consulta horários e vagas registrados de uma experiência. | `experienceId`: string: ID do cadastro<br>`date`: AAAA-MM-DD | { experience, date, slots: ExperienceSlot[] } | catalog | snapshot+ai_db | read | none | `experience.options`, `navigate` | `experience.availability` |
| `experiences.reservations` | reservations | Consulta reservas de experiências da hospedagem atual. | — (nenhum argumento) | { official: StayExperienceReservation[], simulated: SimulatedExperienceBooking[] } | guest | snapshot+ai_db | read | none | `booking.list` | `experience.reservations` |
| `experiences.booking.preview` | experiences | Cria uma pré-reserva simulada após validar as regras. | `conversationId`: conversationId: UUID da conversa (servidor)<br>`experienceId`: string: ID do cadastro<br>`date`: AAAA-MM-DD<br>`time`: HH:MM | null<br>`adults`: 0-10<br>`children`: 0-10 | PreviewResult | guest | snapshot+ai_db | simulated_write | explicit | `experience.booking.card` | `experience.booking` |
| `experiences.booking.confirm` | experiences | Confirma uma pré-reserva simulada persistida. | `conversationId`: conversationId: UUID da conversa (servidor)<br>`previewId`: previewId: UUID da pré-visualização (servidor) | ConfirmResult (código SIM-…) | guest | snapshot+ai_db | simulated_write | explicit | `experience.booking.card` | `experience.booking.confirm` |
| `experiences.booking.cancel` | experiences | Cancela uma pré-reserva simulada pendente. | `conversationId`: conversationId: UUID da conversa (servidor)<br>`previewId`: previewId: UUID da pré-visualização (servidor) | { cancelled } | guest | ai_db | simulated_write | none | `experience.booking.card` | `experience.booking.cancel` |
| `experiences.booking.cards` | experiences | Consulta o estado atual dos cards de reserva da conversa. | `conversationId`: conversationId: UUID da conversa (servidor)<br>`previewIds`: UUID[] (1-50) | BookingCardState[] | guest | ai_db | read | none | `experience.booking.card` | — (interno) |

**Total: 25 ferramentas.** São 22 anteriores a esta versão e 3 novas: `restaurants.menu`, `favorites.list` e `leisure.enrollments`. Todas as escritas são simuladas.

## Intenções sem ferramenta de escrita

| Intenção | Ferramenta (somente leitura) | Resultado |
| --- | --- | --- |
| `restaurant.booking` | `restaurants.list` | Texto + `navigate Gastronomy {restaurantId}`. A reserva exige a seleção de pratos no app (R-GAS-06 a 11). |
| `favorite.manage` | nenhuma consulta | Texto + `navigate Events` e `navigate MyFavorites`. O favorito e o lembrete local são criados pela tela (G6). |
| `leisure.enroll` | `leisure.enrollments` | Texto + `navigate Leisure` (+ `MyRequests` se já houver inscrições). A inscrição exige ficha, termo e responsável (R-LAZ-04). |
| `quiz.info` | `quiz.list` | Cards e `navigate Quiz`. Perguntas e respostas nunca são lidas (R-QZ-05). |

## Erros

| Situação | Exceção | Efeito no chat |
| --- | --- | --- |
| Ferramenta desconhecida | `BadRequestException('Ferramenta não permitida.')` | `400` (bug do servidor; o handler só chama nomes do mapa) |
| Argumento inválido ou extra | `BadRequestException` com o campo | `400` |
| `restaurantId` fora do catálogo ativo | `BadRequestException('Restaurante não encontrado.')` | `400` (o handler só envia IDs do catálogo) |
| Fora de `development` | `ForbiddenException('Ferramentas de demonstração desabilitadas.')` | `403` |
| Titular sem hospedagem ativa | `ForbiddenException('Hospedagem não identificada.' / 'Hospedagem não está ativa.')` | `403` |
| Snapshot indisponível | erro do driver | `500` |
| Pré-visualização inexistente, de outra conversa ou de outro hóspede | resultado `not_found` | `404` em `/chat/actions`; texto "Não há … aguardando confirmação" no chat |
| Pré-visualização vencida, sem vaga ou valor alterado | resultado `expired` / `unavailable` / `changed` | card no novo estado com `reason` |

## Regras por domínio

### Gastronomia

- `restaurants.list`: ativos (`situacao_restaurante = 1`), em ordem de cadastro. Filtros de tipo, cozinha, reserva e "aberto agora" são aplicados no handler sobre o resultado, sem SQL livre.
- `restaurants.menu`: categorias `situation_catcardapio = 1` e `ordem_catcardapio > 0`, pratos `situacao_cardapio = 1` e `ordem_cardapio > 0` (os mesmos filtros do app). Subcategorias recebem o nome da categoria pai. Categorias sem pratos não aparecem. `serves` só quando ≥ 1. Imagem só como nome de arquivo (`menu/<arquivo>` no card).
- O chat **não** cria reserva de restaurante e não infere restrições alimentares. Perguntas como "tem opção vegana?" vão ao RAG (descrições do cadastro), e o cardápio mostra apenas as categorias existentes (ex.: "Principal - Vegetariano").

### Experiências

- Vagas e horários vêm do snapshot (`tb_dispexperiencia` / `tb_horaexperiencia`), descontadas as reservas simuladas e os horários já passados no fuso do resort. O texto avisa que não é disponibilidade em tempo real.
- Pré-reserva: valida a estadia, a experiência ativa e reservável, a idade e o responsável (`experience-rules.ts`), a capacidade, o horário-limite de marcação, o valor e o máximo de pessoas. Persiste a pré-reserva com TTL. A confirmação revalida tudo, é idempotente por `previewId` e grava `simulated_experience_bookings` com código `SIM-…`.

### Solicitações

- Catálogo: departamentos `situacao_departamento = 1` com `solicitacao_departamento = 'sim'`, itens ativos, avisos (`tb_infodepartamento`), cache de 60 s.
- Criação simulada: itens só do cadastro, quantidade de 1 a 10, um departamento por solicitação, TTL e confirmação idempotente. Grava `simulated_guest_requests` com protocolo `SIM-…`.
- `requests.list`: solicitações reais da estadia (snapshot) + simuladas da conversa (banco da IA), sempre identificadas.

### Minhas Reservas, Minhas Solicitações e Favoritos (dados pessoais)

- `reservations.list`: `tb_reservarestaurante` da hospedagem, dentro da estadia, com titular da mesma estadia. Pessoas = pedidos de pratos (um por pessoa).
- `experiences.reservations`: reservas oficiais da estadia + simuladas do hóspede.
- `leisure.enrollments`: `tb_lazerassinatura` dos hóspedes da estadia, dentro da janela da estadia. Título: atividade, categoria ou formulário. Status `pendente`/`aprovado`/`negado`.
- `favorites.list`: `tb_notificacao` com `tipo_evento = 'evento'` dos hóspedes da estadia, juntando eventos ativos dentro da estadia, um por evento.
- Nenhuma dessas ferramentas devolve nome, nascimento, documento, telefone ou UH de outros hóspedes, nem os envia ao modelo.

### Módulos informativos

- `spa.list`, `boutique.list`, `tips.list`, `esg.info` e `quiz.list` leem apenas itens ativos e publicados. A Boutique usa cache de 60 s. Não há agendamento (SPA), compra (Boutique) nem resposta de quiz pelo chat.

## Como adicionar uma ferramenta

1. Acrescente o nome em `OperationToolName` e a definição completa em `definitions` (descrição, domínio, `access`, `source`, `mode`, `confirmation`, `input`, `output`, `cards`).
2. Escreva o parser em `tool-inputs.ts` (campos permitidos, formatos) e o `case` em `run()`. Dados pessoais sempre via `guestStay.resolve(guest)`.
3. Acrescente o tipo do resultado em `OperationToolResult` e a intenção em `INTENT_TOOL_MAP` (o compilador exige o mapeamento de toda intenção operacional).
4. Monte os cards no handler com `card-builders.ts` e valide com `isValidChatAction`.
5. Testes: parser (campo extra, formato), escopo da estadia, metadados (`operations-tool-registry.service.spec.ts`) e uma conversa em `chat-conversations.integration.spec.ts`.
