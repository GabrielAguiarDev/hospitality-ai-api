# 00 — Sumário executivo: auditoria do Yago Mobile para o Yago AI

> **Escopo**: o código-fonte do `yago-mobile-front` (v5.18.1, branch `feat/chat`), lido em 28/10/2026. Esta etapa é só de investigação: nenhum código de produção foi alterado.
>
> **Método**: rastreamento tela → hook → serviço → endpoint, com referências `arquivo:linha`. O que não pôde ser determinado pelo código está marcado como `NÃO CONFIRMADO`.

## Documentos

| # | Documento | Conteúdo |
|---|---|---|
| 01 | [Inventário de funcionalidades](01-mobile-features-inventory.md) | Módulos, telas e funcionalidades, com status |
| 02 | [Inventário de endpoints](02-api-endpoints-inventory.md) | Os 56 endpoints da API, 1 socket e 4 rotas da IA, com tipos e exemplos |
| 03 | [Regras de negócio](03-business-rules.md) | 81 regras com ID, origem (app/API) e referência |
| 04 | [Catálogo de tools](04-ai-tools-catalog.md) | 36 tools propostas, com schemas |
| 05 | [Catálogo de cards](05-chat-cards-catalog.md) | 17 tipos de card e a evolução do contrato `actions` |
| 06 | [Contratos de navegação](06-navigation-contracts.md) | Rotas, params e a lista permitida do chat |
| 07 | [Fluxos transacionais](07-transactional-flows.md) | Preview, confirmação e execução de cada operação |
| 08 | [Autenticação e segurança](08-auth-context-and-security.md) | Contexto do hóspede, o que não aceitar do cliente e achados |
| 09 | [Requisitos do backend](09-backend-requirements.md) | O que o `yago-ai-api` precisa implementar e as 14 lacunas |
| 10 | [Roadmap](10-implementation-roadmap.md) | Fases e prioridades |
| — | [capabilities.json](capabilities.json) | Inventário legível por máquina |

## Números

| Item | Quantidade |
|---|---|
| Módulos analisados | 13 pedidos, mais Auth/Contexto, Mapa, Notificações, Config e Concierge |
| Funcionalidades inventariadas | ~85 |
| Endpoints da API principal | **56**: 49 de domínio e 7 de quiz. 55 estão em uso; `section-menu` não é chamado |
| Leitura × escrita | 40 READ · 16 WRITE/TRANSACTIONAL |
| Socket.IO | 1 namespace (`/quiz`), com 3 eventos de cliente e 13 de servidor |
| Rotas da Yago AI API já integradas | 4 (`/chat`, `/chat/actions`, `/chat/voice`, `/chat/:id/messages`) |
| Rotas de navegação | 32 no stack principal, mais stacks e abas internas |
| Regras de negócio catalogadas | 81 |
| Tools propostas | **36**: 24 de leitura, 6 transacionais com preview, 2 de escrita leve e 4 de navegação |
| Tipos de card propostos | **17** |
| Lacunas de backend | 14 (G1–G14) |

## Principais conclusões

1. **O chat já tem um contrato de ações sólido, que deve ser estendido e não substituído.** São três ações:
   - `navigate`;
   - `experience.booking.card`, com ciclo preview → confirmação, idempotente por `cardId`;
   - `experience.options`.

   O app descarta tipos desconhecidos, o que torna a evolução compatível com versões anteriores. A proposta acrescenta `catalog.list`, `booking.list`, `request.list`, `menu.view`, `operation.card` (o mesmo ciclo da pré-reserva, generalizado) e `favorite.changed`.

2. **Muitas regras importantes vivem só no app.** Exemplos:
   - elegibilidade por idade em experiências;
   - janela de `closure`/`maxBookingHour`;
   - "uma reserva aprovada por restaurante";
   - porções compartilhadas e bloqueios entre categorias de pratos;
   - hierarquia de itens de solicitação;
   - faixas etárias de lazer, fixas no código por UUID.

   Ler o banco direto (como o MVP faz com o snapshot) **não** traz essas regras. É preciso movê-las para a API oficial ou replicá-las no backend da IA.

3. **Não existe hoje uma forma segura de a IA saber quem é o hóspede.**
   - O MVP usa `X-Demo-Guest-Id`, um UUID público.
   - A API oficial não tem `/me`: o contexto (titular, acompanhantes, nascimentos, `lodgingIdPms`, datas) só chega na resposta do login.

   Este é o bloqueio número 1 (G1).

4. **Vários "módulos" são apenas informativos.**
   - SPA: sem agendamento, contato por WhatsApp.
   - Boutique: sem compra.
   - ESG: só conteúdo.
   - Dicas: a tela mostra só a primeira.

   A IA deve consultar e redirecionar, nunca prometer uma operação.

5. **"Favoritos" = lembretes de eventos.** São registros `notification` com `eventType: "evento"`, e o lembrete é agendado **localmente** pelo app. Restaurantes e experiências não podem ser favoritados.

6. **Inscrições de lazer aparecem em Minhas Solicitações**, não em Minhas Reservas. O "cancelamento" do hóspede grava `negado`, o mesmo valor da recusa pelo resort.

## Principais regras de negócio

- O titular de qualquer reserva tem 18 anos ou mais. Em experiências, ele pode não participar, salvo quando há participantes na faixa `[minimumAge, minimumAgeAlone)` com `requiresResponsible` (R-EXP-04).
- Reserva de restaurante:
  - exige um pedido de pratos **por pessoa**;
  - aceita um prato por categoria;
  - limita porções a `ceil(pessoas/serves)`;
  - aplica bloqueios entre categorias;
  - permite no máximo uma aprovada por restaurante na estadia (R-GAS-06 a R-GAS-11).
- Editar e cancelar restaurante só até `data + closure`. Cancelar experiência só antes do horário. Solicitações e inscrições só se canceladas enquanto `pendente`.
- Reserva de experiência:
  - exige telefone e `experienceAvailabilityId`;
  - pode exigir termo ou ficha;
  - se exigir assinatura, ela é presencial.
- Disponibilidade é sempre consultada para a janela da estadia (check-in → check-out, inclusive).
- Datas: o app mistura UTC, fuso do aparelho e +3 h. O backend deve padronizar em America/Sao_Paulo (R-DT-*).

## Maiores bloqueios para uma integração completa

| # | Bloqueio | Ref. |
|---|---|---|
| 1 | Identidade: falta `/me` e validação de JWT no `yago-ai-api` | G1 |
| 2 | Reservas pelo chat são simuladas, e os dados vêm de snapshot | G2 |
| 3 | Regras de negócio só no app (idade, janelas, limites, faixas de lazer) | 03, G7 |
| 4 | Não confirmado se a API oficial valida `lodgingIdPms` e ids de hóspedes contra o token | G5 |
| 5 | Cancelamento de restaurante por restaurante, não por reserva | G4 |
| 6 | Lembretes são locais ao app | G6 |
| 7 | Sem idempotência nas criações | G9 |
| 8 | Contrato real do quiz não documentado | G11 |

## Implementável logo após G1 e os adaptadores

| Tipo | Itens |
|---|---|
| **Consultas** | restaurantes, cardápio e horários com vaga; experiências, elegibilidade e disponibilidade; eventos; minhas reservas; minhas solicitações; favoritos; lazer (programação); SPA, boutique, ESG, dicas; lista de quizzes |
| **Operações com confirmação** | criar solicitação; cancelar solicitação, inscrição ou experiência; reservar experiência **sem termo**; remover favorito |
| **Navegação** | reservar restaurante, inscrever no lazer, editar pratos, jogar quiz e abrir qualquer módulo (após ampliar `CHAT_SCREEN_ROUTES`) |

## Ordem recomendada

1. **Fase 0**: identidade (G1), JWT no `yago-ai-api`, adaptadores sobre a API oficial, auditoria de autorização (G5).
2. **Fase 1**: consultas P0 com cards (`catalog.list`, `booking.list`, `request.list`) e navegação ampliada.
3. **Fase 2**: `operation.card` genérico, criar e cancelar solicitação, reserva real de experiência, cancelamentos, favoritos.
4. **Fase 3**: lazer (consulta e navegação), SPA, boutique, ESG, dicas, cancelamento de restaurante, termo no chat.
5. **Fase 4**: correções na API oficial (G4, G7, G9), deep links, quiz como widget, reserva integral de restaurante (opcional).

## Inconsistências encontradas no app (registro)

- `TSituationTypeExperience` declara `"confirmado"`, mas a API usa `"pago"`, e a ordenação das reservas não tem efeito.
- `numberOfGuests` da gastronomia conta toda a hospedagem, e não as pessoas selecionadas.
- Eventos calculam "hoje" em UTC.
- Há tipos com erro de digitação ou duplicados em `types.d.ts`.
- Inscrição de lazer sem participante autorizado mostra a confirmação sem enviar nada.

Detalhes no [03](03-business-rules.md), seção "Inconsistências".
