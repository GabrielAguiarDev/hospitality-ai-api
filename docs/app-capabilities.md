# Capacidades do Yago por módulo do aplicativo

O que o concierge faz em cada módulo, de onde vêm os dados, o que fica fora do chat e quais ações o React Native recebe. O contrato técnico das ações está em [mobile-ai-integration.md](mobile-ai-integration.md).

A fonte única deste mapa no código é [`src/capabilities/capabilities.ts`](../src/capabilities/capabilities.ts). Cada módulo informa a descrição, as intenções, os parâmetros, o tipo de operação, as limitações, a tela do app e as pistas de roteamento. Um teste garante que toda intenção operacional pertence a um módulo e que toda ferramenta existe no `OperationsToolRegistry`.

## Como o Yago escolhe a operação

1. **Regras determinísticas.** Classificam a mensagem por módulo, sem modelo. Exemplos: "Preciso de toalhas", "Solicitações.", "Tem quiz hoje?", "Quanto custa a drenagem?".
2. **Ferramentas do Registry.** Executam consultas fixas no `resort_snapshot`, sempre somente leitura e com parâmetros validados. A LLM nunca monta SQL.
3. **RAG.** É usado só para perguntas abertas, como horários, regras e informações gerais. O modelo local recebe apenas os documentos recuperados e as últimas mensagens.
4. **Sem evidência.** Se a pergunta cita um produto da Boutique, o Yago procura no cadastro. Se cita um módulo, a resposta diz qual e oferece a tela. Nos demais casos, a resposta é curta e indica a recepção.

O catálogo de capacidades nunca é enviado ao modelo. Saudações, agradecimentos, solicitações, cards e módulos informativos respondem sem LLM, em menos de 1 s.

## Módulos

| Módulo | Faz pelo chat | Fonte | Tipo | Limitações | Ações |
| --- | --- | --- | --- | --- | --- |
| **Solicitações** | Lista os departamentos e itens que podem ser pedidos. Prepara uma solicitação **simulada** ("Preciso de toalhas", "o ar não gela") para confirmar. Consulta as solicitações da estadia e o status ("E a minha solicitação anterior?"). | `tb_departamento`, `tb_itemdepartamento`, `tb_infodepartamento`, `tb_solicitacao`, `tb_itemsolicitacao`. Simuladas em `simulated_guest_requests` (banco da IA). | leitura, escrita simulada, navegação | Nada é enviado ao departamento. Só itens ativos do cadastro. Até 5 pré-visualizações abertas e 10 confirmadas em 24 h por hóspede e estadia. | `request.card`, `navigate` → `Requests` (`departmentId`) |
| **Gastronomia** | Lista restaurantes, bares e lanches com filtros (tipo, cozinha, horário, "com reserva", "agora"). Mostra detalhes. Diz se está aberto. Responde sobre as reservas de restaurante do hóspede. | `tb_restaurante`, `tb_horariorestaurante`, reservas da estadia | leitura, navegação | Não cria reserva de restaurante: o app exige escolher os pratos. | `restaurant.options`, `navigate` → `Gastronomy` (`restaurantId`) |
| **Experiências** | Mostra catálogo, busca de vagas por data e período, detalhes, preço e pré-reserva **simulada** com confirmação. | `tb_experiencia`, `tb_dispexperiencia`, `tb_horaexperiencia`, `tb_valorexperiencia` | leitura, escrita simulada | Reservas simuladas não vão ao sistema oficial. | `experience.options`, `experience.booking.card` |
| **Eventos** | Mostra eventos e shows por data e período ("Tem algum evento hoje?" → "E amanhã?"). | `tb_evento` | leitura | Só os próximos dias registrados no snapshot. | `event.list` |
| **Lazer** | Mostra a programação semanal por data, período e público (crianças, adolescentes, adultos, esportes). | `tb_programacaolazer`, `tb_categorialazer` | leitura | O público vem só da categoria cadastrada. | `event.list` (`kind: 'leisure'`) |
| **Boutique** | Dá a visão geral, os produtos de uma categoria e o preço de um produto citado ("Tem protetor solar?"). | `tb_produto`, `tb_categoriaproduto` | leitura, navegação | Não vende nem reserva. Não há card de produto no app: a resposta é texto curto com botão. | `navigate` → `Boutique` |
| **SPA** | Lista serviços por categoria e informa valor e duração cadastrados. | `tb_servicospa`, `tb_categoriaspa` | leitura, navegação | Não agenda. Quando o valor está só no texto do cadastro, ele é mostrado como está; nunca aparece "R$ 0". | `navigate` → `Spa` |
| **ESG** | Mostra o texto institucional publicado. | `tb_esg` | leitura, navegação | Iniciativas e parceiros não têm conteúdo publicado no snapshot (títulos vazios). | `navigate` → `Esg` |
| **Dicas** | Lista as dicas e detalha uma pelo assunto ("águas-vivas", "henna"). | `tb_dicaitem` | leitura, navegação | — | `navigate` → `Tips` |
| **Quiz** | Informa se há quiz ativo. | `tb_quiz` (sem participações nem PIN) | leitura, navegação | Não inscreve nem responde. Hoje todos os quizzes do snapshot estão inativos. | `navigate` → `Quiz` |

Também existe "O que você pode fazer?". A resposta cita os dez módulos em uma frase.

## Exemplos de conversa (respostas reais)

| Hóspede | Yago | Ações |
| --- | --- | --- |
| "Solicitações." | "Pelo app você pode pedir a Governança, Manutenção, TI, Guest Experience e mais 5. É só dizer do que precisa, por exemplo "preciso de toalhas"." | `navigate` |
| "Preciso de toalhas." | "Preparei a solicitação simulada para Governança: Toalha de banho. Confirme no card ou responda "confirmo"." | `request.card` (preview) |
| "Obrigado!" | "Por nada! A solicitação continua aguardando: confirme pelo card ou responda "confirmo"." | — |
| "confirmo" | "Pronto! Solicitação simulada registrada com o protocolo SIM-C3C6186D. Ela não foi enviada a Governança: para atendimento real, use a tela de Solicitações." | `request.card` (confirmed), `navigate` |
| "E a minha solicitação anterior?" | "Sua solicitação simulada de Governança (Toalha de banho) foi registrada em 26/10/2026 15:47, protocolo SIM-…. Ela não chega ao departamento." | `navigate` |
| "O ar condicionado não está gelando" | "Preparei a solicitação simulada para Manutenção: Ar Condicionado. …" | `request.card` |
| "Tem algum evento hoje?" → "E amanhã?" | "Para hoje: Show de Circo (22:00) e Música ao vivo (23:00)." → "Para amanhã: Oficina de circo (12:00), Bingo La Torre (21:30) e Música ao vivo (23:00)." | `event.list` |
| "Tem atividade para crianças hoje à tarde?" | "Para hoje à tarde, para crianças: O mistério do circo (16:10) e Camarim do palhacinho (16:20)." | `event.list` |
| "Me mostra os restaurantes." | "Encontrei 4 restaurantes: Gino Praia Gastronomia, Clube de Praia, Restaurante Central e mais 1." | `restaurant.options`, `navigate` |
| "Tem protetor solar?" | "Na Boutique: Protetor Solar aerosol, R$ 125,00 e Protetor Solar Loção, R$ 100,00." | `navigate` |
| "Quanto custa a drenagem linfática?" | "Drenagem Linfática: R$ 300,00, 50 min. O agendamento é feito pelo SPA." | `navigate` |
| "Tem quiz hoje?" | "Não há quiz ativo no momento. Quando houver, ele aparece na tela de Quiz." | `navigate` |

## Contexto e isolamento

- O estado de cada conversa pertence a `conversation_id + resort_id + guest_id`. Uma conversa de outro hóspede retorna 404.
- As solicitações da estadia são filtradas pelo grupo da hospedagem. As simuladas são filtradas por hóspede, alojamento e data de check-in.
- Existe **uma** confirmação por texto pendente por conversa: uma pré-reserva de experiência **ou** uma solicitação. "confirmo", "sim" e "não" vão para ela.
  - Abrir outro assunto descarta a confirmação **por texto**.
  - O botão do card continua válido até expirar.
- Assuntos encadeados ("E amanhã?", "Governança" → "kit pet", "E a anterior?") usam só o estado estruturado. Ao modelo vão apenas as últimas mensagens, e só nas perguntas abertas.

## Segurança da escrita simulada

- **Onde grava:** somente no banco interno da IA (`simulated_guest_requests`). O snapshot nunca é alterado.
- **Origem dos dados:** departamento e itens vêm do cadastro do snapshot (ativos e do mesmo departamento) e são revalidados na confirmação. Os nomes são copiados do cadastro.
- **Confirmação:**
  - É atômica e idempotente: um segundo toque devolve o mesmo protocolo `SIM-…`.
  - Exige o mesmo hóspede, a mesma conversa e a mesma estadia (alojamento e check-in).
  - Uma referência de outro hóspede recebe 404 sem revelar se existe.
- **Texto do hóspede:** é guardado como nota, sem caracteres de controle, com até 500 caracteres. O card exibe até 200. A nota nunca vai ao modelo nem ao estado da conversa, e é apagada no descarte ou na expiração.
- **Identificação:** cards, respostas e protocolo identificam a solicitação como simulada.
- **Ambiente:** o modo de demonstração identifica o hóspede pelo header `X-Demo-Guest-Id`, sem autenticação real. A escrita simulada não deve ir para produção antes do token real do app.

## Limitações conhecidas

- Os nomes de tela (`Requests`, `Boutique`, `Spa`, `Esg`, `Tips`, `Quiz`, `Events`, `Leisure`, `Experiences`) são provisórios. O app deve mapeá-los para as rotas reais e ignorar telas desconhecidas.
- Não há card de produto, de serviço de SPA nem de dica no app. Esses módulos respondem com texto curto e botão de navegação.
- Pedidos fora do cadastro (por exemplo, um item que nenhum departamento oferece) recebem a lista de departamentos, não uma solicitação.
- A correspondência de itens é por palavras do nome cadastrado (com singular e plural). Sinônimos que não aparecem no nome, como "papel higiênico", não são reconhecidos e o Yago pergunta o item.
- Depois de "O que você precisa?", uma resposta curta só é procurada nos itens daquele departamento. Uma pergunta ("a piscina é aquecida?", "senha do wifi") segue para o RAG ou recebe "Não encontrei esse item em …", sem criar solicitação.
