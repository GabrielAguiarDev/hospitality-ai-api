# Contexto conversacional de experiências

Este documento registra como o Yago interpreta perguntas contextuais sobre experiências, os casos cobertos por testes e as limitações conhecidas. O contrato com o aplicativo está em [mobile-ai-integration.md](mobile-ai-integration.md).

## 1. Problema corrigido

Depois de listar as experiências sem data, o Yago perguntava "Para qual data?". Nas duas mensagens abaixo, ele respondia "Não identifiquei qual experiência você deseja":

- "Qual tem reserva pra amanhã?"
- "Qual experiência tem reserva para amanhã de manhã?"

**Causa raiz:**

1. **Classificação.** Sem o substantivo "experiência", a primeira mensagem caía no ramo de contexto do `IntentClassifierService` e, por conter uma data, virava `experience.availability`. Na segunda, "qual" (singular) não contava como pergunta de listagem e "tem reserva para" não contava como disponibilidade, então ela virava `experience.details`.
2. **Execução.** Esses dois handlers do `ExperienceOperationsService` exigem uma experiência resolvida. Sem nome ou número, respondiam com o erro.
3. **Entidades.** Não havia extração de período ("de manhã"). "a partir das 15h" era tratado como horário exato.

## 2. Arquitetura

O fluxo continua `ChatService → ChatOrchestratorService → IntentClassifierService → OperationsDispatcherService → ExperienceOperationsService → OperationsToolRegistryService`. Não há serviço novo. O modelo pequeno (`qwen3:1.7b`) só é chamado quando as regras determinísticas não decidem.

### 2.1 Intenções

| Intenção | Uso | Ferramenta |
| --- | --- | --- |
| `experience.list` | Catálogo, com filtros de catálogo opcionais ("Quais são gratuitas?") | `experiences.list` |
| `experience.search` (**nova**) | Vagas em várias experiências: data, período, faixa de horário ("Qual tem reserva pra amanhã?") | `experiences.list` com filtros |
| `experience.details` | Detalhes da experiência escolhida | `experiences.details` |
| `experience.availability` | Horários da experiência escolhida. Sem experiência resolvida, vira `experience.search` | `experiences.availability` |
| `experience.price` | Valores | `experiences.details` |
| `experience.booking` | Pré-reserva (nunca registra a reserva) | `experiences.booking.preview` |
| `experience.booking.confirm` / `.cancel` | Somente com uma pré-reserva pendente | `experiences.booking.confirm` / `.cancel` |
| `experience.reservations` | Reservas de experiências da hospedagem | `experiences.reservations` |

A palavra "reserva" não decide a ferramenta sozinha. Uma **pergunta de seleção** ("quais…", "qual tem…", "qual dá pra reservar…", "tem alguma…") com indício de vagas, data ou período é uma busca, mesmo quando contém "reservar". Só um pedido afirmativo ("Pode reservar.", "Quero reservar a Jaqueira") gera uma pré-reserva.

### 2.2 Entidades (`message-entities.ts`)

Todas as entidades são extraídas sem o modelo:

- **Datas:** hoje, amanhã, depois de amanhã, dia da semana, "próximo sábado" (dito num sábado, é o da semana seguinte), dd/mm e "dia N", no fuso `RESORT_TIMEZONE`.
- **Período (`period`):** manhã (05:00–12:00), tarde (12:00–18:00) e noite (18:00–24:00).
  - "Bom dia", "boa tarde", "café da manhã" e "mais tarde" não são períodos.
  - "tarde" só conta como período quando precedida de "a/à", "de", "pela", "hoje" etc. Sozinha é advérbio: "vou chegar tarde".
- **Faixa (`after`/`before`):** "depois das 15h", "a partir das 14:30", "antes das 10h", "depois das 8 da noite" (20:00).
  - Uma faixa nunca vira `time` e dispensa o período.
  - "a partir dos 5 anos" é idade, não horário.
- **Filtros de catálogo:**
  - `free`: "gratuitas", "de graça".
  - `forChildren`: "para crianças", "infantil". "Para 2 crianças" é a composição do grupo, não um filtro.
  - `bookable`: "tem reserva", "posso reservar", "vagas". Não se aplica quando há negação ("não precisam de reserva", "sem reserva").

### 2.3 Estado da conversa

O estado continua no `ChatConversationState` existente: JSON por `conversationId`, com controle otimista de versão. Não há armazenamento global. Campos novos:

- `lastIntent`: última intenção operacional ou de conhecimento (saudações não alteram).
- `experience.filters`: `period`, `after`, `before`, `free`, `forChildren` e `bookable`.

Os campos que já existiam continuam valendo: `listed` (última lista, na ordem exibida), `selectedId`, `date`, `time`, `adults`, `children` e `pendingPreviewId`.

**Regras de combinação:**

- **Nova busca** ("Quais experiências têm vagas no domingo?"): começa sem filtros e limpa a seleção.
- **Continuação** (`refine: true`): "E de manhã?", "amanhã", "Quais são gratuitas?". Mensagens curtas ou iniciadas por "e/então/mas", após uma busca, mantêm os filtros. Um período novo substitui o anterior; período e faixa nunca coexistem.
- **Com uma experiência escolhida:** "E de manhã?" refina os horários dela (`experience.availability`), não uma nova busca. Se o hóspede informar uma nova data sem período, o período da busca anterior é descartado.
- **Grupo:** o grupo informado na busca ("para 2 adultos") fica guardado para a pré-reserva. Grupos acima de 10 pessoas recebem a orientação de procurar a recepção, sem erro HTTP.
- **Restaurante citado pelo nome:** "Quais horários posso reservar na Trattoria Aurora?" segue para o fluxo de restaurantes, não para a busca de experiências.
- **Busca sem resultado:** a lista fica vazia, mas a conversa continua no contexto de experiências.

### 2.4 Ferramenta `experiences.list`

A ferramenta aceita filtros opcionais, todos validados em `parseExperienceListInput` (chaves desconhecidas são rejeitadas): `date`, `period`, `after`, `before`, `free`, `forChildren`, `bookable`, `adults` e `children`. As regras são funções puras em `experience-search.ts`:

- **Gratuita:** `tipo_reserva = 'allinclusive'`. Preço não cadastrado **não** é gratuito.
- **Para crianças:** exige indício cadastrado (idade mínima abaixo de 12, tarifa "Criança" ou menção no título ou na descrição). Idade mínima ≥ 12 exclui a experiência.
- **Vagas esgotadas** não são oferecidas. Vagas **sem quantidade cadastrada** são mantidas e descritas como tal.
- **Vagas para o dia (sem horário)** são mantidas num filtro de período, com o aviso de que o período não pode ser confirmado.

As consultas ao `resort_snapshot` continuam sendo somente `SELECT`. As respostas sempre trazem o aviso de que as vagas vêm do snapshot e podem não refletir a disponibilidade atual.

### 2.5 Pré-reserva com período

Quando o hóspede informou só um período ou uma faixa:

| Horários registrados no período | Comportamento |
| --- | --- |
| Exatamente um | Usa esse horário. Ele aparece no resumo, que exige confirmação explícita |
| Mais de um | Pergunta qual. Nenhuma pré-reserva é criada |
| Nenhum, só vaga para o dia | Segue sem horário (`time: null`), como antes |
| Nenhum | Informa e lista os horários registrados na data |

### 2.6 Uso do modelo

- A classificação de reservas de restaurante segue como antes (JSON Schema, validação e fallback determinístico).
- **Novo:** dentro de uma conversa sobre experiências, uma mensagem que as regras não decidem pode ser classificada pelo modelo.
  - **Saída:** `format` em JSON Schema, restrito a intenções **somente de leitura** (`search`, `list`, `details`, `availability`, `price`, `knowledge.search`). O modelo nunca escolhe pré-reserva nem confirmação.
  - **Quando é chamado:** só para mensagens de até 10 palavras que não citam outros serviços (refeições, programação, diária, chegada, spa etc.). Fora desse contexto, não há chamada extra.
  - **Tempo limite:** 10 s.
  - **Falhas:** respostas fora do schema, JSON inválido ou erro HTTP levam ao RAG.
- A chamada HTTP ao Ollama foi unificada em `askModel`.

### 2.7 Ações

A nova ação `experience.options` acompanha toda lista numerada e é montada só com IDs do cadastro. O contrato `reply`, `conversationId`, `retrievedSources` e `actions` não mudou. Clientes que não conhecem o tipo o ignoram.

## 3. Casos testados

O arquivo `src/chat/chat-conversations.integration.spec.ts` roda o pipeline real, com o Registry real aplicando os filtros. Ollama, snapshot, banco interno e ChromaDB são simulados, e o classificador por modelo fica indisponível, para provar que as regras bastam. Todas as conversas usam o mesmo `conversationId` do início ao fim.

| Conversa | Verifica |
| --- | --- |
| Catálogo → "Qual tem reserva pra amanhã?" → "Qual experiência tem reserva para amanhã de manhã?" | O erro relatado: intenção `experience.search`, filtros `{date, bookable}` e depois `{date, period: morning, bookable}`, vaga esgotada omitida, nenhuma chamada ao modelo |
| "Quais experiências têm amanhã?" → "E de manhã?" → "Gostei da segunda." → "Quanto custa para dois adultos?" → "Pode reservar." → "confirmo" | O exemplo completo: refinamento, ordinal sobre a lista refinada, preço, pré-reserva com o único horário da manhã (09:00), nenhuma confirmação antes de "confirmo" |
| Busca → "E de manhã?" → "Opção 2" | Ação `experience.options` com IDs reais; a mensagem do botão seleciona a opção |
| Busca → "E à tarde?" → "Quais são gratuitas?" → "Tem alguma para crianças?" | Filtros acumulados e parâmetros exatos enviados à ferramenta |
| Catálogo → "Quais posso reservar de manhã?" → "amanhã" | Período sem data: pergunta a data e completa a busca; nenhuma pré-reserva |
| "...amanhã depois das 15h?" → "Gostei da primeira" → "Pode reservar para 2 adultos" | Faixa como filtro, não como horário exato |
| Busca → opção fora da lista → seleção → "E à noite?" → "Pode reservar" | Ambiguidade e período sem horário: nada é presumido nem pré-reservado |
| Busca sem resultado → "E de manhã?" → "Gostei da segunda" | A conversa continua após uma lista vazia |
| Dois hóspedes intercalados | Isolamento: outro hóspede recebe 404 na conversa alheia; "a segunda" resolve na lista de cada conversa |
| Catálogo → "Qual dá pra reservar amanhã?" → "Quais posso reservar à tarde?" | "reservar" numa pergunta não cria pré-reserva |
| Busca para 12 pessoas → "E para 2 adultos e 1 criança?" | Orientação amigável sem HTTP 400; a data é mantida |
| Busca de manhã para 2 adultos → seleção → "Pode reservar." → nova data | O grupo da busca chega à pré-reserva; uma nova data não herda o período |

**Revisão independente.** Um revisor de código apontou dois problemas HIGH e cinco MEDIUM, todos corrigidos com testes de regressão:

- HTTP 400 em buscas para grupos acima de 10 pessoas.
- "não precisam de reserva" lido como "aceitam reserva".
- Pedido de restaurante pelo nome desviado para a busca.
- "tarde"/"noite" capturando perguntas de conhecimento.
- Fallback do modelo amplo demais.
- Período antigo aplicado a uma nova data.
- Idade lida como horário.

Também há testes unitários de entidades (`message-entities.spec.ts`), regras de busca (`experience-search.spec.ts`), classificação, incluindo o fallback do modelo e seus limites (`intent-classifier.service.spec.ts`), validação de `experience.options` (`chat-actions.spec.ts`), entradas inválidas da ferramenta (`operations-tool-registry.service.spec.ts`) e handlers (`experience-operations.service.spec.ts`).

**Testes existentes alterados (mudança intencional de comportamento):**

- "Quais experiências posso fazer amanhã?": de `experience.list` para `experience.search`. A resposta ao hóspede é a mesma.
- "E no sábado?" com uma lista e sem experiência escolhida: de `experience.availability` para `experience.search`.

## 4. Limitações conhecidas

- **Snapshot histórico:** vagas e horários são os registrados no dump, não a disponibilidade atual. Toda resposta de vagas traz esse aviso.
- **Horários já passados hoje:** numa busca para hoje, horários anteriores ao momento atual não são excluídos. A regra de reserva continua validando na pré-reserva.
- **"Para crianças"** depende do cadastro. Experiências sem idade mínima, sem tarifa infantil e sem menção a crianças não aparecem, mesmo que aceitem crianças na prática.
- **"Gratuita"** considera só o tipo all inclusive. Experiências sem preço cadastrado não são tratadas como gratuitas.
- **Limites dos períodos** (05/12/18h) são convenção do Yago, não do sistema do resort.
- **Botões de listas antigas:** "Opção N" se refere sempre à última lista da conversa. Tocar num botão de uma lista anterior seleciona a posição N da lista atual.
- **Reservas pessoais no contexto de experiências:** "Tenho alguma reserva?" continua consultando as reservas de restaurante. Para experiências, o hóspede precisa citá-las ("minhas reservas de experiências").
- **Fallback por modelo:** depende do Ollama local. Se ele estiver indisponível, mensagens fora das regras vão ao RAG.
- **"Quais não precisam de reserva?"** mostra o catálogo completo, com cada item marcado "com reserva" ou "sem necessidade de reserva". Ainda não há um filtro só para as que dispensam reserva.
- **Escolha de horário:** depois de "tem mais de um horário… Qual você prefere?", responder só "às 10:30" consulta os horários de novo. É preciso pedir a reserva outra vez ("Pode reservar às 10:30").
- **Isolamento multi-resort no snapshot:** as consultas de catálogo e vagas (`listActive`, `findSlots`) não filtram por `resortId`. Isso já era assim antes desta mudança e só é seguro porque cada instância atende um único snapshot. Merece revisão de segurança se um snapshot passar a conter mais de um resort.

---

## 5. Referências, perguntas pendentes e restaurantes (2ª etapa)

### 5.1 Problemas reproduzidos e causas

| Cenário | Comportamento anterior | Causa |
| --- | --- | --- |
| 1. "E como é essa experiência?" com uma única experiência listada | "Não identifiquei qual experiência você deseja." | "essa" não era tratada como referência; sem nome nem posição, o handler não tinha o que resolver |
| 2. "Quer que eu verifique os horários disponíveis?" → "Sim." | Repetia a descrição | A pergunta feita não ficava registrada. O "sim" ia ao fallback do modelo, que escolhia `experience.details` |
| 3. "E sobre os restaurantes, consegue me indicar algum?" → "Sim, os restaurantes." | RAG com dados misturados ("disponibilidade no dia 28", "Chá da Tarde" como restaurante) e depois o fallback | Não havia intenção de catálogo de restaurantes; tudo ia à busca vetorial, sensível à formulação e ao histórico |
| 4. Descrição completa repetida | Até 500 caracteres do texto bruto, com emojis e listas de preço, a cada pergunta | `details()` sempre copiava a descrição do cadastro |

### 5.2 Contexto estruturado (`ConversationContextService`)

Serviço novo em `src/chat/conversation-context.service.ts`, usado pelo `ChatService` e pelo `ChatOrchestratorService`:

- **Persistência por dono:** o estado é lido e gravado por `conversation_id + resort_id + guest_id`, com o mesmo controle otimista de versão de antes.
  - **Migration:** `1792771200003-ConversationStateOwner` adiciona as colunas no banco interno da IA, copia o dono de `chat_conversations` e remove estados sem conversa.
  - **Idempotência:** cada etapa pode ser retomada isoladamente, porque DDL no MySQL não é transacional.
  - **Implantação:** aplique a migration junto com o código novo. Instâncias antigas não gravam as colunas, que passam a ser obrigatórias.
  - O `resort_snapshot` não é alterado.
- **Estado mantido:**
  - assunto (`topic`) e última intenção (`lastIntent`);
  - listas apresentadas com IDs reais e ordem (`experience.listed`, `restaurant.listed`);
  - entidade selecionada;
  - data e filtros da última busca;
  - descrição já apresentada (`describedId`);
  - pergunta pendente (`pendingQuestion`);
  - pré-reserva aguardando confirmação (`pendingPreviewId`).
- **Resolução antes das ferramentas** (`resolve`):

  | Mensagem | Resolução |
  | --- | --- |
  | "Sim" com pergunta pendente | Entidade da pergunta (`pending_question`) |
  | "essa"/"ela" logo após uma lista de **um** item | Esse item (`single_listed`) |
  | "essa" depois de falar da experiência escolhida | A selecionada (`demonstrative`) |
  | "essa" logo após uma lista de **vários** itens | Nenhuma: o Yago pergunta "Você se refere a qual delas?" |
  | Posição ("a segunda") ou nome | Resolvidos pelos handlers sobre o cadastro |

  Um alvo de experiência nunca é aplicado a uma pergunta de restaurante, e vice-versa. Um nome citado na mensagem sempre vence o contexto ("Quero reservar no Omakase" com outro restaurante selecionado). Para restaurantes, o item único só vale logo após uma lista.
- **Pergunta pendente:** vale só para a mensagem seguinte. Uma interação social ("Obrigado!") também a encerra, mas preserva uma pré-reserva pendente. "Ok, obrigado!" não é uma resposta afirmativa. Toda pergunta de sim/não do Yago registra uma:
  - "Quer que eu verifique os horários…?" registra `experience.availability`;
  - "Se quiser, posso preparar a reserva simulada." registra `experience.booking`, que leva à **pré-reserva**, ainda dependente de "confirmo";
  - "Quer que eu abra a Gastronomia?" registra `restaurant.booking`, que só navega.

### 5.3 Classificação

- **Ordem:**
  1. Resposta a pergunta pendente.
  2. Confirmação de pré-reserva.
  3. Solicitações.
  4. Conversa.
  5. Experiências e restaurantes.
  6. Reservas pessoais (com o modelo).
  7. RAG.

  Pergunta pendente e pré-reserva pendente nunca coexistem. Com uma pré-reserva pendente, a etapa 1 é ignorada.
- **"Sim"/"não" sem pergunta pendente:** é conversa. Não aciona ferramentas nem o classificador por modelo.
- **"Sim" com informação nova** ("Sim, para amanhã", "Sim, pode reservar"): segue o fluxo normal.
- **Restaurantes:** `restaurant.list` (catálogo) e `restaurant.details` (um restaurante) mudam o assunto, qualquer que seja o anterior.
  - Horários de funcionamento, cardápio, preços e restrições alimentares continuam no RAG.
  - Reservas pessoais ("Em qual restaurante é a minha reserva?") continuam no fluxo de reservas.

### 5.4 Restaurantes

- **Ferramenta:** `restaurants.list` (somente leitura, `tb_restaurante` ativos) aceita os filtros opcionais e validados `type` (`restaurante`, `bar`, `alimentacao`) e `name`. A pesquisa por nome usa o cadastro, nunca SQL montado a partir do texto.
- **Apresentação:**
  - Lista só o tipo pedido ("restaurantes" ou "bares") e cita os demais tipos em uma linha.
  - Os detalhes trazem resumo, funcionamento, idade mínima e como reservar.
  - Os nomes saem sem emojis ("Omakase🇯🇵" vira "Omakase").
- **Reservas** continuam no aplicativo: a resposta traz a ação `navigate` para `Gastronomy` com o `restaurantId` real. O chat não cria reserva de restaurante.

### 5.5 Composição das respostas

- Descrições resumidas em frases inteiras (até cerca de 220 caracteres), sem emojis e sem as listas de preço do texto livre. Os valores vêm dos campos de preço.
- A descrição de uma experiência ou restaurante aparece **uma vez** por conversa. Depois, só os dados pedidos.
- Se a data já é conhecida, a pergunta de horários a cita ("…de quarta-feira, 28/10/2026?").

### 5.6 Observabilidade (logs de desenvolvimento)

`debug`/`log` registram:
- a intenção;
- o assunto anterior e o novo;
- se a mensagem é refinamento ou resposta a pergunta pendente;
- a referência resolvida (tipo e regra, por exemplo `experience via single_listed`);
- a ferramenta e a quantidade de resultados;
- os motivos de fallback (RAG sem evidências, modelo indisponível, "sim" sem pergunta);
- os **nomes** dos campos do estado alterados.

Não registram o texto das mensagens, tokens nem dados pessoais.

### 5.7 Casos testados

`chat-conversations.integration.spec.ts` (pipeline real, conversas completas):

- Cenário 1: lista de um item → "E como é essa experiência?" → detalhes do City Tour, sem chamar o modelo.
- Cenário 2: … → "Sim." → `experiences.availability` com a experiência e a data do contexto. Nenhuma pré-reserva ou confirmação, sem repetir a descrição.
- "Não, obrigado" encerra a pergunta sem ferramenta; um "Sim" posterior não aciona nada.
- "Sim, para 2 adultos" → oferta de pré-reserva → "Pode sim" → pré-reserva aguardando "confirmo". `confirm` não é chamado.
- Cenário 3: experiência → "E sobre os restaurantes…" → "Sim, os restaurantes." → "Quero a segunda" → "Quero reservar". Catálogo real nas duas primeiras (nunca o fallback), a experiência anterior não é reutilizada e a reserva só navega com o ID real.
- Restaurante com reserva → "Sim" → navegação para a Gastronomia com o `restaurantId`.
- "E os bares?" → somente bares.
- Cenário 4: resumo sem emojis nem preços do texto bruto (≤ 220 caracteres); a segunda pergunta não repete a descrição.
- "essa" com várias opções → "Você se refere a qual delas?", com `experience.options`.
- A pergunta pendente não vaza para outra conversa do mesmo hóspede, nem para outro hóspede (que recebe 404 na conversa alheia).
- Um "Sim" sem contexto, com o modelo de conversa tentando citar horário e preço: a resposta é substituída e nenhuma ferramenta é chamada.

Também há testes unitários de `ConversationContextService`, das respostas pendentes e dos restaurantes no classificador, de `summarizeText`/`stripSymbols`, dos filtros da ferramenta e do isolamento do estado por dono (`chat.service.spec.ts`).

**Testes existentes alterados (mudança intencional):**

- "Olá, quais restaurantes existem?", "Quais restaurantes aceitam reserva?" e "Quais são os restaurantes do resort?" agora usam o catálogo, não o RAG. Os testes de saudação mista passaram a usar outra pergunta.
- `restaurants.list` aceita argumentos (`type`, `name`), então saiu do teste "não aceita argumentos". Argumentos desconhecidos continuam rejeitados.
- O dispatcher envia `restaurant.booking` ao novo `handle` quando há contexto de conversa.

**Revisão independente da 2ª etapa:** dois problemas HIGH e três MEDIUM, todos corrigidos com testes de regressão:

- O contexto vencia um restaurante citado pelo nome, e a reserva abria o restaurante errado.
- No assunto "restaurantes", perguntas sobre piscina, spa, check-in e dieta voltavam ao catálogo.
- "Ok/Perfeito, obrigado!" executava a ação perguntada, inclusive a pré-reserva.
- A pergunta pendente sobrevivia a um "Obrigado!".
- A migration não era retomável após uma falha parcial.

Também foram corrigidos:

- "Sim, quero fazer a reserva" respondia à pergunta de horários em vez de pedir a reserva.
- "Tem restaurante aberto agora?" era capturado pelo catálogo.
- "Onde posso jantar?" não chegava ao catálogo.

### 5.8 Limitações

- **Horário de um restaurante específico** ("Que horas abre o Omakase?") continua no RAG, cuja fonte é o mesmo cadastro. Os detalhes pelo catálogo também mostram o funcionamento.
- **Respostas de sim/não** são reconhecidas por vocabulário fechado. Respostas longas ou indiretas ("acho que sim, mas…") seguem o fluxo normal, sem responder à pergunta.
- **"Segunda que vem"** ainda não é convertida em data. "Na segunda" e "próxima segunda" são.
- **"Sim" a perguntas abertas:** "Quer saber mais sobre algum?" e "Para qual data?" não são de sim/não. Um "sim" isolado em resposta a elas vira conversa, gerada pelo modelo com a proteção que já existia contra horários e preços.
- **Filtros `type` e `name` de `restaurants.list`:** estão disponíveis e validados, mas o chat filtra o catálogo já carregado (precisa dele inteiro para contar os outros tipos).
- **Itens do tipo `alimentacao`** (como "Chá da Tarde") aparecem só quando o hóspede pede lanches/sobremesas ou o catálogo completo. Na lista de restaurantes, são apenas contados.
