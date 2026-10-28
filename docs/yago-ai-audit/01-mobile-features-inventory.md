# 01 — Inventário de funcionalidades do app

Este inventário segue a organização módulo → tela → funcionalidade. Os IDs `E##` remetem ao [02](02-api-endpoints-inventory.md) e os IDs `R-*` ao [03](03-business-rules.md).

## Legendas

**Status atual**

| Código | Significado |
|---|---|
| **IMPL** | Implementada no mobile, com API identificada |
| **IMPL-BE** | Implementada no mobile, mas o comportamento no backend precisa ser investigado |
| **PARCIAL** | Parcialmente implementada |
| **SEM** | Sem suporte confirmado |

**Tipo de dado**

| Código | Significado |
|---|---|
| **EST** | Estático: cadastro do resort, muda pouco |
| **DIN** | Dinâmico: disponibilidade e status |
| **PES** | Pessoal: depende do hóspede |
| **TRX** | Transacional |

---

## Estrutura geral

- **Navegação**: um stack nativo único (`src/routes/Config/stack.routes.tsx`).
  - Raiz: `update` | `login` (+ `webView`) | `main`.
  - Dentro de `main`, há 32 rotas declaradas em `src/routes/Models/stack.ts:15-48`.
  - Stacks e abas internas aparecem em Requests, Signature, Quiz, Config, Leisure, Events, MyReservation e SelectDish.
- **Entrada**: a Home tem uma grade de 10 módulos (`screens/Home/actions.ts:34-43`), banner, atalho para o Concierge e drawer com Minhas Reservas, Minhas Solicitações, Meus Favoritos, Configurações e Sair (`components/Header/actions.ts:34`).
- **Estado global**: zustand persistido em MMKV (`loggedUser`, idioma, tema, banners, token FCM) e cache do TanStack Query persistido.
- **Concierge (chat)**: duas implementações, escolhidas em `services/concierge/index.ts:26`.
  - Com `EXPO_PUBLIC_CONCIERGE_API`: Yago AI API.
  - Sem ela: concierge local por palavras-chave, sobre o catálogo real.

---

## 1. Solicitações (`requests`)

| Funcionalidade | Tela / arquivo | API | Status | Dado |
|---|---|---|---|---|
| Listar departamentos (logo, nome, descrição) | `screens/Requests/index.tsx` (rota interna `DepartmentList`) | E06 | IMPL | EST |
| Ver informações do departamento (`infosDepartment`) | `screens/Requests/screens/[departmentId].tsx:46-64` | E06 | IMPL | EST |
| Selecionar itens e subitens (checkbox hierárquico) | `[departmentId].tsx:65-145` | E06 | IMPL | EST |
| Observação livre | `[departmentId].tsx` | — | IMPL | — |
| Criar solicitação | `screens/Requests/actions.ts:46-63` | E08 | IMPL | TRX |
| Quantidade por item | — | — | **SEM** (só via observação) | — |

- **Rotas**: `requests`. A rota interna de cada departamento usa o nome `department.name` e recebe o objeto `IDepartment` como param.
- **Não confirmado**: quais itens existem de fato ("toalhas", "travesseiros", "limpeza"). Isso depende do cadastro do resort.

## 2. Gastronomia (`gastronomy`)

| Funcionalidade | Tela / arquivo | API | Status | Dado |
|---|---|---|---|---|
| Listar restaurantes por aba (restaurante/bar/alimentação) | `screens/Gastronomy/index.tsx`, `actions.ts` | E16 | IMPL | EST |
| Ver horário (turnos ou `operation`) e local no card | `components/CardRestaurant.tsx` | E16 | IMPL | EST |
| Página informativa + cardápio em accordion (restaurante sem reserva) | `screens/Gastronomy/screens/[gastronomyId].tsx` | E17, E18, E19 | IMPL | EST |
| Detalhe para reserva: escolher titular (18+) e acompanhantes, "vou sozinho" | `Booking/Gastronomy/screens/Details.tsx` | E17, E24 | IMPL | PES |
| Bloqueio quando já existe reserva aprovada no restaurante | `Details.tsx:42-44` | E24 | IMPL | PES |
| Escolher data e turno com vagas | `Booking/Gastronomy/screens/SelectDate.tsx` | E22 | IMPL | DIN |
| Escolher pratos por pessoa e por categoria, com porções e bloqueios | `Booking/Gastronomy/screens/SelectDish/*` | E18, E19, E21 | IMPL | EST/DIN |
| Remover ingredientes (restrições) | `SelectDish/DishList.tsx:285-360` | E19 | IMPL | — |
| Observação por pessoa e observação geral | `DishSummary.tsx`, `OrderSummary.tsx` | — | IMPL | — |
| Criar reserva | `Booking/Gastronomy/actions.ts:166-203` | E23 | IMPL-BE | TRX |
| Confirmação + lembrete local | `screens/Confirmation.tsx`; `services/gastronomy/index.ts:233-268` | — | IMPL | — |
| Editar pratos e observações de uma reserva | `MyReservation/actions.ts:100-134` → `bookingGastronomySelectDish` | E26, E27 | IMPL | TRX |
| Cancelar reserva | `MyReservation/screens/Gastronomy.tsx:238-250` | E25 | IMPL-BE (cancela por restaurante) | TRX |
| Seções de cardápio | — | E20 | **SEM** (endpoint não usado) | — |
| Restrições alimentares genéricas (vegano, glúten) | — | — | **SEM** | — |
| Fotos dos pratos | `[gastronomyId].tsx:100-103` (só o 1º prato de cada categoria), `DishList.tsx` | E19 | IMPL | EST |

**Rotas**:

- `gastronomy`
- `gastronomyId {id}`
- `bookingGastronomyDetails {id}`
- `bookingGastronomySelectDate`
- `bookingGastronomySelectDish`
- `bookingGastronomyConfirmation`

## 3. Experiências (`experiences`)

| Funcionalidade | Tela / arquivo | API | Status | Dado |
|---|---|---|---|---|
| Listar por aba (incluso / taxa extra) | `screens/Experiences/index.tsx` | E28 | IMPL | EST |
| Página informativa (`text`, `obs`) | `screens/Experiences/screens/[experienceId].tsx` | E29 | IMPL | EST |
| Detalhe para reserva: preços por categoria, regras de idade, titular e participantes | `Booking/Experience/screens/Details.tsx` | E29, E33 | IMPL | EST/PES |
| Disponibilidade por data e hora | `Booking/Experience/screens/SelectDate.tsx` | E30 | IMPL | DIN |
| Telefone e observação | `SelectDate.tsx` | — | IMPL | PES |
| Termo de risco / ficha (HTML + aceite) | `Booking/Experience/screens/Terms.tsx` | E49 | IMPL | EST |
| Formulário da ficha (campos dinâmicos) | `Booking/Experience/screens/Form.tsx` | E49 | IMPL | PES |
| Resumo e confirmação da reserva | `Summary.tsx`; `Booking/Experience/actions.ts:65-132` | E31 | IMPL | TRX |
| Registro da ficha / termo na reserva | `services/experience/index.ts:167-190` | E32 | IMPL-BE (rota possivelmente nova) | TRX |
| Assinatura gráfica | — | — | **SEM** (presencial) | — |
| Cancelar reserva | `MyReservation/screens/Experiences.tsx:80` | E34 | IMPL | TRX |
| Editar reserva | — | — | **SEM** | — |
| Banner da Home que abre uma experiência | `screens/Home/index.tsx:31` | E04 | IMPL | EST |

**Rotas**:

- `experiences`
- `experienceId {id}`
- `bookingExperienceDetails {id}`
- `bookingExperienceSelectDate`
- `bookingExperienceTerms`
- `bookingExperienceForm`
- `bookingExperienceSummary`
- `bookingExperienceConfirmation`

## 4. Eventos (`events`)

| Funcionalidade | Tela / arquivo | API | Status | Dado |
|---|---|---|---|---|
| Programação dos próximos 7 dias, em abas por dia da semana | `screens/Events/index.tsx`, `actions.ts:16-34` | E35 | IMPL | EST/DIN |
| Card com título, descrição, data e hora, local e galeria | `screens/Events/components/CardEvent.tsx` | E35 | IMPL | EST |
| Favoritar / desfavoritar (lembrete 1 h antes) | `CardEvent.tsx:116-151` | E36, E37, E39 | IMPL | PES |
| Detalhe de evento | — | — | **SEM** (o card é o detalhe) | — |
| Inscrição em evento | — | — | **SEM** | — |
| Filtros (período do dia, categoria) | — | — | **SEM** | — |

## 5. Lazer (`leisure`)

| Funcionalidade | Tela / arquivo | API | Status | Dado |
|---|---|---|---|---|
| Abas por categoria (ex.: infantil, adulto) | `screens/Leisure/index.tsx` | E11 | IMPL | EST |
| Informações da categoria | `Leisure/screens/[leisureId].tsx:72-83` | E12 | IMPL | EST |
| Programação semanal (7 dias, contagem por dia, hora, local) | `[leisureId].tsx:109-284` | E10 | IMPL | EST |
| Abrir local no mapa | `[leisureId].tsx:284` → `map` | — | IMPL | EST |
| Ficha de inscrição da categoria / da atividade | `[leisureId].tsx:84-106,257-280` → `signature` | E49 | IMPL | — |
| Fluxo de inscrição (termo → responsável → participantes + ficha → autorizar termos pendentes → resumo) | `screens/Signature/**`, `contexts/signatureForm.tsx` | E13, E14, E49 | IMPL | TRX |
| Regras de faixa etária | `Leisure/actions.ts:28-39` (UUIDs fixos no código) | — | PARCIAL (configuração fixa no código) | — |

## 6. Boutique (`boutique`)

| Funcionalidade | API | Status |
|---|---|---|
| Categorias (`priority`) e produtos (nome, descrição, preço, galeria) | E40, E41 | IMPL (somente informativo) |
| Compra, carrinho, reserva de produto, contato | — | **SEM** |
| Variações, estoque, favoritos | — | **SEM** |

## 7. SPA (`spa`)

| Funcionalidade | API | Status |
|---|---|---|
| Banner, descrição, observação | E42 | IMPL |
| Categorias e serviços (título, descrição, valor, duração) | E43, E44 | IMPL |
| Contato por WhatsApp (`spa.link`, `Linking.openURL`) | E42 | IMPL (externo) |
| Agendamento, horários, disponibilidade | — | **SEM** |

## 8. ESG (`esg`)

| Funcionalidade | API | Status |
|---|---|---|
| Texto institucional com imagem | E45 | IMPL |
| Iniciativas e parceiros (imagem/ícone + link para WebView) | E46, E47 | IMPL |
| Participação do hóspede, favoritos, categorias | — | **SEM** |

## 9. Dicas (`tip`)

| Funcionalidade | API | Status |
|---|---|---|
| Uma dica com imagem e itens (título + descrição) | E48 | IMPL (só o 1º registro) |
| Categorias, filtros, favoritos, várias dicas | — | **SEM** (a API retorna lista; a tela usa `[0]`) |

## 10. Quiz (`quiz`)

| Funcionalidade | Tela / arquivo | API | Status |
|---|---|---|---|
| Lista de quizzes (tema, modo, status, PIN) | `screens/Quiz/screens/List.tsx` | E50, E04 | IMPL |
| Lobby: escolher hóspede, PIN, ver ranking final | `Lobby.tsx` | E51, E53, E56 | IMPL |
| Jogo solo (async): perguntas com tempo, resposta, próxima | `Play.tsx`, `services/quiz/apiSession.ts` | E52–E55 | IMPL |
| Jogo ao vivo (live), com host | `services/quiz/liveSession.ts` | Socket `/quiz` | IMPL |
| Resultado (acertos, erros, pontos, posição) | `Result.tsx` | E56 | IMPL |
| Histórico de participações | — | — | **SEM** |
| Leaderboard completo na UI | — | dados chegam, não são renderizados | PARCIAL |

**Rotas internas**:

- `QuizList`
- `QuizLobby {quiz}`
- `QuizPlay {quiz, pin?, guestId?}`
- `QuizResult {...}`

## 11. Minhas Reservas (`myReservation {tab?}`)

| Funcionalidade | Arquivo | API | Status |
|---|---|---|---|
| Aba Gastronomia: reservas `aprovada` com pratos, restrições e observações por pessoa | `MyReservation/screens/Gastronomy.tsx` | E24 (+E18) | IMPL |
| Editar pratos (até o `closure`) | `MyReservation/actions.ts:100-134` | E26, E27 | IMPL |
| Cancelar restaurante (até o `closure`) | `Gastronomy.tsx:238-250` | E25 | IMPL-BE |
| Aba Experiências: status (pago/pendente/cancelado), valor, telefone, participantes | `MyReservation/screens/Experiences.tsx` | E33 | IMPL |
| Cancelar experiência (antes do horário) | `Experiences.tsx:80` | E34 | IMPL |
| Separação passadas/futuras, filtros, histórico de canceladas de restaurante | — | — | **SEM** |

## 12. Minhas Solicitações (`myRequests`)

| Funcionalidade | Arquivo | API | Status |
|---|---|---|---|
| Lista unificada (mais recentes primeiro) de solicitações a departamentos + inscrições de lazer | `MyRequests/actions.ts:56-72` | E07, E06, E14 | IMPL |
| Status de departamento: `pendente`, `executando`, `atendida`, `cancelada` | `components/CardDepartment.tsx` | E07 | IMPL |
| Status de lazer: `pendente`, `aprovado`, `negado` | `components/CardSubscription.tsx` | E14 | IMPL |
| Cancelar (só `pendente`) | `MyRequests/index.tsx:67-117` | E09, E15 | IMPL |
| Filtros, detalhe separado | — | — | **SEM** |

> As **inscrições de lazer não aparecem na Home**. Elas só aparecem aqui, como "solicitações".

## 13. Meus Favoritos (`myFavorites`)

| Funcionalidade | Arquivo | API | Status |
|---|---|---|---|
| Listar eventos favoritados | `MyFavorites/actions.ts:26-56` | E36 + cache E35 | IMPL (limitado à janela de eventos) |
| Remover favorito | `MyFavorites/actions.ts` | E39 | IMPL |
| Favoritar restaurante, experiência, lazer, SPA, boutique | — | — | **SEM** |

## 14. Outras funcionalidades

| Funcionalidade | Arquivo | API | Status | Relevância para o concierge |
|---|---|---|---|---|
| Login por UH + sobrenome | `screens/Login/*` | E01 | IMPL | Origem de todo o contexto (ver 08) |
| Dados da estadia (titular, acompanhantes, UH, check-in/out, nascimento) | `stores/slices/user.ts` | E01 (só no login) | IMPL | **Contexto da IA**; não há endpoint `/me` |
| Perfil: foto local, idioma (pt/en), tema | `screens/Config/**` | — | IMPL (sem API) | Idioma pode guiar a resposta |
| Notificações (painel do Header, marcar como lidas) | `components/Header/actions.ts:73-148` | E36, E38 | IMPL | Baixa |
| Push FCM (recebe e exibe; o `link` não é tratado) | `services/useNotification.ts:84-119`, `index.js` | E05 | PARCIAL | Deep links **não existem** |
| Mapa de um local (lat/long, satélite, marcador) | `screens/Map` | — (dados de `location` embutidos) | IMPL | "Onde fica?" → abrir mapa |
| Mapa geral do resort / rotas a pé | — | — | **SEM** | — |
| WebView (só http/https) | `screens/WebView` | — | IMPL | Links institucionais |
| Diretrizes do resort (link fixo no login) | `screens/Login/index.tsx:133-147` | — | IMPL | Fonte para RAG |
| Atualização obrigatória | `screens/Update` | E03 | IMPL | — |
| Concierge texto + voz (Orb, TTS, STT) | `screens/Concierge/**`, `services/speech`, `services/transcription` | A01–A04 | IMPL (MVP) | É o próprio chat |
| Modo demo com áudios gravados | `services/yagoDemo/*` | — | IMPL (demo) | — |
| Abertura de portas por NFC | `docs/PLANO-NFC-ABERTURA-PORTAS.md` | — | **SEM** (só plano) | — |

## Contagem

| Grupo | Quantidade |
|---|---|
| Módulos funcionais analisados | 13 (+ Auth/Contexto, Notificações, Mapa, Config, Concierge) |
| Funcionalidades listadas | ~85 |
| Operações de leitura distintas | 45 |
| Operações de escrita/transacionais no app | 15 |

As 15 operações de escrita são:

- criar solicitação;
- cancelar solicitação;
- inscrever em lazer;
- cancelar inscrição;
- reservar restaurante;
- editar pratos;
- editar observação;
- cancelar restaurante;
- reservar experiência;
- registrar ficha;
- cancelar experiência;
- favoritar;
- desfavoritar;
- marcar notificação como lida;
- quiz (participar, responder, avançar).
