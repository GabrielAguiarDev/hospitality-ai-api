# Yago AI — capacidades implementadas

> **Público:** time do `yago-ai-api`, produto e quem planeja as próximas fases.
> **Base:** a auditoria do app em [`yago-ai-audit/`](yago-ai-audit/), com IDs `T##` (ferramentas), `C##` (cards), `R-*` (regras) e `G##` (lacunas), comparada ao código desta versão.
> Contratos do app: [`mobile-ai-cards-integration.md`](mobile-ai-cards-integration.md). Ferramentas: [`ai-tools-reference.md`](ai-tools-reference.md).

## 1. Ponto de partida (auditoria do backend)

Antes desta versão, o backend já tinha:

- **Orquestração determinística:** `IntentClassifierService` (regras, com o modelo Qwen só como fallback de leitura), `ConversationContextService` (estado persistido com controle otimista, referências "essa"/"a única"/"sim", pergunta pendente, fase da conversa), `OperationsDispatcherService` e handlers por domínio.
- **Tool Registry fechado** com 22 ferramentas: restaurantes, eventos/lazer do dia, experiências (lista, detalhe, vagas, reservas, pré-reserva simulada), solicitações (catálogo, histórico, pré-visualização simulada) e módulos (SPA, Boutique, Dicas, Quiz, ESG).
- **Ações:** `navigate` (10 telas), `experience.options`, `experience.booking.card`, `restaurant.options`, `event.list` e `request.card`, todas validadas por `isValidChatAction`.
- **Operações simuladas com preview → confirmação**, idempotentes por `previewId`: reserva de experiência e solicitação a departamento.
- **RAG** (ChromaDB + embeddings) para conteúdo descritivo, com resposta fixa quando não há evidência.
- **Segurança de demonstração:** `DemoGuestGuard` (dev, loopback, hosts permitidos, IDs proibidos no header), `GuestStayService` (titular com hospedagem ativa) e o snapshot somente leitura.

Lacunas encontradas e tratadas nesta versão:

1. Cardápio sem nenhuma fonte (o RAG não indexa `tb_cardapio`).
2. "Minhas Reservas" só com restaurantes: as reservas de experiência ficavam em outro fluxo.
3. "Minhas Solicitações" sem as inscrições de lazer.
4. Favoritos inexistentes no chat.
5. SPA, Boutique, Dicas, ESG e Quiz só com texto, sem cards nem referência por posição.
6. Navegação restrita a telas de módulo: sem `Restaurant`, `Experience`, `MyReservation`, `MyRequests` e `MyFavorites`. Restaurantes sem reserva iam para a tela de reserva.
7. **Defeito no fluxo de reserva:** depois de "Quero reservar essa" → "preciso saber quantos adultos…", a resposta "Para duas pessoas" virava consulta de vagas, e "Pode confirmar" criava a pré-reserva em vez de confirmá-la.
8. "Qual minha próxima reserva?" não era reconhecida como pergunta pessoal (ia para o RAG).

## 2. Matriz de capacidades

`CAPACIDADE DO MOBILE → IMPLEMENTAÇÃO ATUAL DA IA → LACUNA → SOLUÇÃO → PRIORIDADE`

Status: ✅ implementado · 🟡 parcial · 🔁 por navegação · ⛔ não implementado.

| Módulo | Capacidade do app | Implementação na IA | Status | Lacuna restante | Solução / dependência | Prior. |
| --- | --- | --- | --- | --- | --- | --- |
| Gastronomia | Listar restaurantes, bares e lanches por tipo (E16) | `restaurants.list` + `restaurant.options` | ✅ | `minimumDaily` (R-GAS-01) não filtrado: exige as noites da estadia no filtro | Aplicar `minimumDaily` com `GuestStay` | P1 |
| Gastronomia | Detalhes, horário, local, idade mínima (E17) | `restaurant.details` | ✅ | — | — | P0 |
| Gastronomia | Cardápio por categoria e prato (E18, E19) | **Novo** `restaurants.menu` + `menu.view` | ✅ | Ingredientes removíveis (`tb_cardapioitem` vazio no snapshot) | Expor quando houver dados | P0 |
| Gastronomia | Horários com vaga (E22) | Turnos cadastrados no texto | 🟡 | `tb_disprestaurante` não consultado; R-GAS-07 (`closure`) | `restaurants.checkAvailability` sobre o snapshot ou a API oficial | P1 |
| Gastronomia | Reservar restaurante (E23) | `restaurant.booking` → `navigate Gastronomy` | 🔁 | Pratos por pessoa, porções, bloqueios (R-GAS-06 a 11) | Manter na tela (decisão da auditoria 07) | — |
| Gastronomia | Restrições alimentares | RAG sobre descrições; categorias do cardápio ("Vegetariano") | 🟡 | Não há campo estruturado | Cadastro estruturado no backend oficial | P2 |
| Experiências | Listar, filtrar, detalhar, preços, regras (E28, E29) | `experiences.list/details` + `experience.options` | ✅ | Banner/logo não enviados | `imagePath` com pasta `experience/logos` | P2 |
| Experiências | Elegibilidade por idade, responsável (R-EXP-03 a 07) | `experience-rules.ts` na pré-reserva | ✅ | Participantes por **nome** (só contagem adultos/crianças) | Exige acompanhantes e nascimentos da sessão (G1) | P1 |
| Experiências | Disponibilidade por data/hora (E30) | Snapshot − simuladas − horários passados | 🟡 | Não é tempo real | API oficial (G2) | P1 |
| Experiências | Reservar (E31) | Pré-reserva **simulada** + confirmação idempotente | 🟡 | Não chega ao sistema oficial; termo/ficha (R-EXP-12) e telefone (R-EXP-11) não coletados | Adaptador da API oficial após G1/G2; termo → navegação | P0 (simulado) |
| Experiências | Cancelar reserva (E34) | — | 🔁 | Sem escrita no sistema oficial | `navigate MyReservation {tab: 'Experience'}` | P1 |
| Eventos | Programação por dia, período, público (E35) | `events.list` + `event.list` | ✅ | Fuso de `tb_evento.data_evento` **não confirmado** (UTC × local) | Confirmar com o backend oficial | P0 |
| Eventos | Detalhe / local | Texto do evento citado | ✅ | Mapa (`Map`) não enviado | Ação `Map` com entidade (auditoria 06) | P2 |
| Lazer | Programação semanal e categorias (E10, E11) | `events.list` (kind `leisure`) | ✅ | Faixas etárias fixas no app (G7) | API oficial: `minAge`/`maxAge` | P1 |
| Lazer | Inscrição (E13) | **Novo** `leisure.enroll` → `navigate Leisure` | 🔁 | Ficha, termo e responsável dinâmicos | Manter na tela | — |
| Lazer | Minhas inscrições (E14) | **Novo** `leisure.enrollments` em `request.list` | ✅ | — | — | P1 |
| Lazer | Cancelar inscrição (E15) | — | 🔁 | Sem escrita | `navigate MyRequests` | P2 |
| Solicitações | Departamentos, itens, avisos (E06) | `requests.catalog` | ✅ | — | — | P0 |
| Solicitações | Criar solicitação (E08) | Preview + confirmação **simulada** (`request.card`) | 🟡 | Não chega ao departamento | Adaptador E08 após G1 + idempotência (G9) | P0 (simulado) |
| Solicitações | Status e histórico (E07) | `requests.list` + **novo** `request.list` | ✅ | — | — | P0 |
| Solicitações | Cancelar (E09) | — | 🔁 | Sem escrita | `navigate MyRequests` | P1 |
| Minhas Reservas | Restaurantes + experiências, por data, "próxima", por tipo (E24, E33) | **Novo** handler unificado + `booking.list` | ✅ | Pratos por pessoa não exibidos | Detalhe por reserva (G3) | P0 |
| Minhas Reservas | Cancelar / editar pratos (E25–E27) | — | 🔁 | G4 (cancela por restaurante) | `navigate MyReservation` | P2 |
| Favoritos | Listar eventos favoritados (E36) | **Novo** `favorites.list` + `catalog.list` `event` | ✅ | — | — | P1 |
| Favoritos | Favoritar / remover (E37, E39) | **Novo** `favorite.manage` → `navigate Events/MyFavorites` | 🔁 | Lembrete local (G6); sem escrita | Ação `favorite.changed` + escrita oficial | P1 |
| SPA | Serviços, categorias, valores, duração (E42–E44) | `spa.list` + **novo** `catalog.list` `spa_service` | ✅ | Contato WhatsApp (`spa.link`) não enviado | Botão `open_url` com lista de domínios (S10) | P1 |
| SPA | Agendamento | — | ⛔ | Não existe no app (G10) | Produto | — |
| Boutique | Produtos, categorias, preços (E40, E41) | `boutique.list` + **novo** `catalog.list` `product` | ✅ | Galeria: pasta de imagem não confirmada | Confirmar pasta e enviar `imagePath` | P2 |
| Boutique | Compra | — | ⛔ | Não existe no app (G10) | Produto | — |
| ESG | Texto institucional (E45) | `esg.info` + **novo** `catalog.list` `esg` | ✅ | Iniciativas/parceiros sem título no cadastro | Cadastro | P2 |
| Dicas | Dicas e itens (E48) | `tips.list` + **novo** `catalog.list` `tip` | ✅ | — | — | P2 |
| Quiz | Lista de quizzes (E50) | `quiz.list` + **novo** `catalog.list` `quiz` → `navigate Quiz` | ✅ | "Já participou" (E53) | Consulta pessoal ao quiz | P3 |
| Quiz | Jogar / responder (E51–E56) | — | ⛔ | Por desenho: a LLM não vê perguntas (R-QZ-05) | Widget nativo fora da LLM | P3 |
| Contexto | Referências ordinais e demonstrativas | Experiências, restaurantes e **novo** catálogo (SPA/Boutique/Dicas/ESG/Quiz/favoritos) | ✅ | — | — | P0 |
| Contexto | Coleta de parâmetros de uma operação | **Novo** `awaiting: 'booking'` (experiência), `awaiting: 'menu'` (restaurante) | ✅ | — | — | P0 |
| Navegação | Telas por ID | **Novas** `Restaurant`, `Experience`, `Events {date}`, `MyReservation {tab}`, `MyRequests`, `MyFavorites` | ✅ | `Map`, `WebView` | Fase 3 | P2 |
| Identidade | Contexto do hóspede pelo token | `DemoGuestGuard` (`X-Demo-Guest-Id`) | ⛔ | G1: sem `/me` na API oficial | JWT + `/me` (bloqueante para produção) | P0 |

## 3. O que foi implementado nesta versão

| Área | Entrega | Arquivos |
| --- | --- | --- |
| Contrato | `catalog.list`, `menu.view`, `booking.list`, `request.list`, `CardButton`, telas e parâmetros novos, validação (imagem relativa, botões, IDs únicos, datas, status) | `src/contracts/chat-actions.ts`, `src/capabilities/capabilities.ts` |
| Ferramentas | `restaurants.menu`, `favorites.list`, `leisure.enrollments`; metadados de todas (domínio, acesso, origem, modo, confirmação, entrada, saída, cards) | `src/operations/operations-tool-registry.service.ts`, `src/operations/tool-inputs.ts` |
| Leitura do snapshot | Cardápio, favoritos e inscrições de lazer, sempre escopo da estadia | `src/resort/restaurant-menus.service.ts`, `favorites.service.ts`, `leisure-enrollments.service.ts` |
| Intenções | `restaurant.menu`, `favorite.list`, `favorite.manage`, `leisure.enroll`; "minhas inscrições" → `request.list`; "minha próxima reserva" → `reservation.list` | `src/chat/chat-intent.types.ts`, `src/chat/intent-detectors/personal.ts`, `src/chat/intent-classifier.service.ts` |
| Handlers | Minhas Reservas unificada e Favoritos; cardápio; inscrições em Minhas Solicitações; cards dos módulos; inscrição de lazer por navegação | `src/operations/guest-operations.service.ts`, `restaurant-operations.service.ts`, `requests-operations.service.ts`, `module-operations.service.ts`, `event-operations.service.ts` |
| Cards | Montagem única a partir das ferramentas | `src/operations/card-builders.ts` |
| Contexto | `catalog` (última lista do módulo), `restaurant.awaiting`, `experience.awaiting`, cardápio do restaurante em conversa | `src/contracts/conversation-state.ts`, `src/chat/conversation-context.service.ts` |
| Correção | "Para duas pessoas" continua a reserva que pediu os participantes; restaurante sem reserva abre `Restaurant`, não a tela de reserva | `experience-operations.service.ts`, `intent-classifier.service.ts`, `restaurant-operations.service.ts` |

## 4. Operações: real, simulada, navegação ou indisponível

| Operação | Classificação |
| --- | --- |
| Todas as consultas (catálogos, cardápio, eventos, lazer, reservas, solicitações, inscrições, favoritos) | **Leitura real** do snapshot (dados podem estar defasados em relação ao sistema vivo) |
| Reserva de experiência | **Simulada** (`simulated_experience_bookings`, código `SIM-…`), com preview e confirmação |
| Solicitação a departamento | **Simulada** (`simulated_guest_requests`, protocolo `SIM-…`), com preview e confirmação |
| Reserva de restaurante, inscrição de lazer, favoritar/remover, cancelamentos, editar pratos, jogar quiz | **Navegação** para a tela do app |
| Agendar SPA, comprar na boutique, responder quiz pela LLM | **Indisponível** |

Nenhuma operação é apresentada como confirmada no sistema oficial: cards e textos de simulação dizem "simulada" e "não registrada no sistema oficial".

## 5. Dependências pendentes

| ID | Dependência | Bloqueia |
| --- | --- | --- |
| G1 | `/me` (ou introspecção) na API oficial e validação de JWT no `yago-ai-api` | Produção; participantes por nome; qualquer escrita real |
| G2 | Adaptadores sobre a API oficial com o token do hóspede | Reservas e solicitações reais; disponibilidade em tempo real |
| G4 | Cancelamento de restaurante por ID de reserva | Cancelar restaurante pelo chat |
| G5 | Auditoria: a API oficial valida `lodgingIdPms` e IDs de hóspedes contra o token? | Encaminhar escritas com segurança |
| G6 | Lembrete de favoritos criado fora do app | Favoritar pelo chat |
| G7 | Faixas etárias de lazer na API | Elegibilidade de lazer no chat |
| G9 | Idempotência nas criações oficiais (E08, E23, E31) | Escritas reais com retry |
| — | Fuso de `tb_evento.data_evento` (UTC ou local) | Horários de eventos exatos |
| — | Pastas de imagem de eventos, produtos e banners de experiência | `imagePath` nesses cards |

## 6. Fontes de dados usadas

Nenhum endpoint da API oficial é chamado nesta versão. As leituras usam o snapshot (somente leitura): `tb_restaurante`, `tb_horariorestaurante`, `tb_catcardapio`, `tb_cardapio`, `tb_reservarestaurante`, `tb_pedidorestaurante`, `tb_experiencia`, `tb_valorexperiencia`, `tb_dispexperiencia`, `tb_horaexperiencia`, `tb_reservaexperiencia`, `tb_reservaexphospede`, `tb_evento`, `tb_programacaolazer`, `tb_categorialazer`, `tb_lazerform`, `tb_lazerassinatura`, `tb_formulario`, `tb_notificacao`, `tb_departamento`, `tb_itemdepartamento`, `tb_infodepartamento`, `tb_solicitacao`, `tb_itemsolicitacao`, `tb_servicospa`, `tb_categoriaspa`, `tb_produto`, `tb_categoriaproduto`, `tb_dicaitem`, `tb_esg`, `tb_quiz`, `tb_quiztema`, `tb_localizacao` e `tb_hospede` (só a estadia).

O banco da IA guarda conversas, mensagens, estado da conversa, pré-reservas e reservas simuladas, e solicitações simuladas. Esta versão **não** criou migrações.

## 7. Regras relevantes aplicadas

- Datas relativas ("hoje", "amanhã", "sábado") no fuso do resort (`RESORT_TIMEZONE`, padrão `America/Bahia`). Horários passados de hoje não são oferecidos.
- Estadia: titular com hospedagem ativa da véspera do check-in ao check-out (R-CTX-07). Dados pessoais filtrados pela mesma hospedagem e datas sobrepostas.
- R-EXP-15: `pago` exibido como confirmada. R-LAZ-06: `negado` exibido como "Negada ou cancelada". R-LAZ-07: inscrições em Minhas Solicitações. R-FAV-01: só eventos são favoritos. R-SPA-01, R-BTQ-01: SPA e Boutique só consulta. R-QZ-05: sem perguntas do quiz.
- Confirmação por texto só com uma pré-visualização pendente da própria conversa. Um "sim" a outra pergunta nunca confirma.

## 8. Limitações conhecidas

- **Identidade de demonstração** (`X-Demo-Guest-Id`): não usar com dados reais fora do ambiente controlado.
- **Snapshot defasado:** vagas, status e favoritos refletem a data da cópia do banco.
- **Participantes por contagem**, não por nome: "para mim e minha esposa" vira 2 adultos. Acompanhantes da sessão exigem G1.
- **Restrições alimentares** não são estruturadas. O chat não afirma que um prato é vegano ou sem glúten, a não ser pela categoria ou pelo texto do cadastro.
- **Leitura repetida da estadia:** "Minhas Reservas" resolve a estadia duas vezes (restaurantes e experiências). O custo é baixo, mas pode ser unificado.
- O app atual (v5.18.1) só renderiza `navigate` (`Gastronomy`), `experience.options` e `experience.booking.card`. Os demais cards dependem da implementação descrita em `mobile-ai-cards-integration.md`.

## 9. Próximas prioridades

1. **G1 + JWT** no `yago-ai-api`, com o contexto da estadia (acompanhantes, nascimentos) no servidor.
2. **Adaptadores da API oficial** (G2): solicitações (E08/E09) e reservas de experiência (E30/E31/E34) reais, com o mesmo ciclo de preview → confirmação e um card de operação genérico.
3. `restaurants.checkAvailability` (E22 / `tb_disprestaurante`) com R-GAS-07 e R-GAS-06, e o filtro `minimumDaily`.
4. Favoritar pelo chat com `favorite.changed` para o app agendar o lembrete (G6).
5. Contato do SPA (`open_url` com lista de domínios), imagens com pastas confirmadas e mapa (`Map`).
6. Confirmar o fuso de `tb_evento.data_evento`.
