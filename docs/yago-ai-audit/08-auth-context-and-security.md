# 08 — Contexto de autenticação e segurança

> Valores reais (tokens, chaves, URLs completas, UUIDs de hóspedes) foram omitidos de propósito.

## 1. Como o app obtém o contexto

```text
Login (UH + sobrenome)
  └─ POST access-control/guest-auth  (E01)
       └─ IUser { token, guestId, guestHolder, companions[], responsibleId=null }
            ├─ zustand "global-storage" (MMKV)  ← persistido no aparelho
            ├─ POST notification/assign (E05)   ← token FCM
            └─ Home ao focar:
                 └─ GET system/responsible (E02) → loggedUser.responsibleId = id("Hospede")
```

| Identificador | Origem | Uso | Ref. |
|---|---|---|---|
| `token` (JWT) | E01 | `Authorization: Bearer` em toda a API principal e no socket do quiz | `services/api.ts:10-21`; `quiz/liveSession.ts:249-263` |
| `guestId` | E01 | Hóspede que fez o login. Pode ser um acompanhante? **NÃO CONFIRMADO** | `types.d.ts:17` |
| `guestHolder.id` | E01 | Titular. Vai como `holderId` (restaurante), `guestId` (experiência e ficha) e `X-Demo-Guest-Id` (Yago AI) | `Booking/*/actions.ts`; `concierge/chatApi.ts:44-52` |
| `companions[].id` | E01 | Participantes: `orderRestaurant[].guestId`, `expBookingGuests[]`, `leisureGuestsForm[]`, `guestId` do quiz | idem |
| `birthDate` (todos) | E01 | Regras de idade (03, R-CTX-05) | `utils/experienceAgeRules.ts` |
| `guestHolder.lodgingIdPms` | E01 | Path de E24/E33, query de E25, body de E23/E31 | `services/gastronomy`, `services/experience` |
| `guestHolder.dateCheckin/dateCheckout` | E01 | Janela de disponibilidade, `checkin/checkout` em E23, filtro `minimumDaily` | `SelectDate.tsx` |
| `guestHolder.uh` | E01 | Exibição e nickname do quiz | `Quiz/screens/Play.tsx:329-337` |
| `responsibleId` | E02 | Bodies de E08, E23 e E31 | `services/system/index.ts:71-74` |
| Resort | **Implícito**: cada ambiente da API atende um resort | — | Não há header de resort na API principal; a Yago AI usa `RESORT_ID` no servidor |
| Ids de reserva | Respostas de E24/E33 (`id`), E07 (`id`), E14 (`id`) | Cancelamento e edição | — |

**Dependências:**

- `token` → todas as leituras pessoais (E07, E14, E36, E53, E56).
- `lodgingIdPms` → reservas.
- `responsibleId` → criação de solicitações e reservas. Se a Home não carregou, ele fica `undefined`.
- `birthDate` → elegibilidade.
- `dateCheckin/dateCheckout` → disponibilidade.

## 2. O que o backend de IA NÃO pode aceitar do cliente

O LLM e o app **não podem** escolher livremente nenhum dos valores abaixo:

| Valor | Por quê | Como obter no backend |
|---|---|---|
| `guestHolder.id`, `guestId` | Identidade | A partir do token validado (introspecção ou `/me`) |
| `companions[].id` | Só hóspedes da mesma hospedagem podem participar | Lista da sessão. O LLM refere-se a eles por **nome ou posição**, e o backend resolve o id |
| `lodgingIdPms` | Dá acesso a todas as reservas da hospedagem | Sessão |
| `dateCheckin/dateCheckout` | Define a janela | Sessão |
| `birthDate` | Define a elegibilidade | Sessão (PMS) |
| `responsibleId` | Constante do resort | Configuração ou E02 no servidor |
| `experienceAvailabilityId`, `experienceHouryId`, `timeRestaurantId` | Precisam pertencer à experiência ou ao restaurante e estar disponíveis | Revalidar com E30 ou E22 imediatamente antes de executar |
| Ids de reserva, solicitação ou inscrição a cancelar | Precisam pertencer ao hóspede | Buscar a lista (E07/E14/E24/E33) com o token e verificar se o id está nela |

**Regra de ouro:** cada tool recebe do LLM apenas **parâmetros de negócio**: nomes, datas, quantidades, escolhas por posição e ids de **catálogo** previamente devolvidos por uma tool. O contexto do hóspede é injetado pelo servidor a partir da sessão.

## 3. Situação atual da Yago AI API (MVP)

Fonte: `services/concierge/chatApi.ts:14-52` e `docs/mobile-ai-integration.md` §2 e §11.

- **Autenticação**: header `X-Demo-Guest-Id` = `guestHolder.id`, um UUID **não secreto**. Opcionalmente, `X-Demo-Secret`, que também é `EXPO_PUBLIC_*` e por isso fica embutido no bundle.
  - Qualquer processo com acesso ao loopback e um UUID consegue ler dados daquele titular.
- **Rede**: só loopback (dev).
  - O `.env.production` **não deve** definir `EXPO_PUBLIC_CONCIERGE_API` (comentário em `chatApi.ts:17-19`).
  - Sem essa variável, os builds de loja usam o concierge local (`services/concierge/index.ts:26`).
- **Dados**: snapshot do banco do resort.
- **Reservas de experiência pelo chat**: **simuladas** (`ExperienceBookingSummary.simulated: true`, `chatApi.types.ts:27-28`).

**Antes de produção, é obrigatório:**

1. Trocar `X-Demo-Guest-Id` pelo JWT do app. O ponto único de troca é o interceptor em `chatApi.ts:44-52`.
2. Validar o token no `yago-ai-api`. Duas opções:
   - (a) introspecção na API oficial;
   - (b) validação de assinatura com a chave pública ou o segredo compartilhado.
   - **NÃO CONFIRMADO**: o algoritmo e o emissor do JWT. O app só trata o token como opaco.
3. Obter o contexto da estadia (titular, acompanhantes, `lodgingIdPms`, datas, nascimentos) **no servidor**. Hoje não existe endpoint para isso, e o contexto só vem na resposta do login (lacuna G1 em 09).
4. Encaminhar as operações à API oficial **com o token do hóspede** (pass-through). Assim, as validações da API valem também para a IA.

## 4. Autorização por operação

| Operação | Pré-condições de autorização |
|---|---|
| Ler catálogo (restaurantes, experiências, eventos, lazer, SPA, boutique, ESG, dicas) | Sessão válida. Não é dado pessoal. |
| Ler minhas reservas / solicitações / favoritos | Sessão válida. `lodgingIdPms` vem da sessão. |
| Criar solicitação | Sessão válida + hospedagem ativa + confirmação explícita. |
| Reservar experiência | Sessão + hospedagem ativa + participantes ⊂ hospedagem + titular 18+ + regras de idade + disponibilidade revalidada + **confirmação explícita** + idempotência. |
| Cancelar reserva, solicitação ou inscrição | Sessão + o item pertence à hospedagem + situação cancelável + janela de horário + **confirmação explícita**. |
| Favoritar / desfavoritar evento | Sessão. É reversível e não exige confirmação forte. |
| Inscrição em lazer / reserva de restaurante | **Não executar pelo chat** na fase 1 (exigem formulário, termo e seleção de pratos). Usar navegação. |

## 5. Achados de segurança no app (registro, sem correção nesta etapa)

| # | Achado | Ref. | Impacto para a IA |
|---|---|---|---|
| S1 | Login com fatores fracos: número da UH (3 dígitos) + sobrenome. | `screens/Login/formSchema.ts`; E01 | A IA herda esse nível de garantia. Operações transacionais exigem confirmação explícita. |
| S2 | O MMKV usa uma **chave de criptografia literal no código-fonte**. | `src/stores/storage.ts:11` | O token e os dados pessoais persistidos ficam protegidos só por uma chave pública. |
| S3 | O cache do React Query (reservas, solicitações, dados do hóspede) é **persistido em disco** e **não é limpo no logout**. | `routes/index.tsx:26-43`; `stores/slices/user.ts:25` | O próximo usuário do aparelho pode ver dados do anterior. |
| S4 | O logout não revoga o token nem desregistra o FCM. | `stores/slices/user.ts:25` | O token continua válido até expirar (expiração NÃO CONFIRMADA). |
| S5 | `lodgingIdPms` vai no path ou na query de leituras e cancelamentos. | E24, E25, E33 | **NÃO CONFIRMADO** se a API oficial valida o `lodgingIdPms` contra o token. A IA nunca deve aceitá-lo do LLM. |
| S6 | Os ids de hóspedes vão no body (holderId, guestId, expBookingGuests, leisureGuestsForm, guestId do quiz). | 02 | **NÃO CONFIRMADO** se o servidor valida o vínculo com a hospedagem. O backend da IA deve validar antes de encaminhar. |
| S7 | A chave da ElevenLabs e `X-Demo-Secret` são `EXPO_PUBLIC_*`, embutidos no bundle. | `services/speech/elevenlabsClient.ts:51-52`; `.env.example:46-80` | Mover para um proxy no backend. |
| S8 | O `X-Demo-Guest-Id` não é autenticado. | §3 | Bloqueia o uso em produção. |
| S9 | O push recebe `data.link`, mas o app não o lê. Não há deep links. | `services/useNotification.ts:84-119` | Sem risco atual. Se for implementado, precisa de lista de rotas permitidas. |
| S10 | A WebView aceita só `http/https`. O HtmlView abre links externos só por gesto do usuário. | `screens/WebView/index.tsx:17-24`; `components/HtmlView/index.tsx:151` | Uma ação `open_url` da IA deve ter lista de domínios permitidos. |

## 6. Prevenção de operações indevidas pelo LLM

1. **Tools de domínio fechadas**: nada de URL, SQL ou "chamar endpoint X".
2. **Execução em duas fases**:
   - preview (servidor valida e calcula, guarda o snapshot com `previewId` e TTL);
   - confirmação por **botão** (`POST /chat/actions` com `previewId`), ou por texto inequívoco seguindo a regra já existente na §5 de `mobile-ai-integration.md`.
   - A execução usa o snapshot do preview, **nunca** parâmetros reenviados pelo cliente. É o padrão atual de `experience.booking.card` (`chatApi.ts:110-117`).
3. **Idempotência**: `previewId` como chave. Uma reconfirmação devolve `already_confirmed` (já previsto em `ChatActionStatus`).
4. **Revalidação no momento da execução**: disponibilidade, situação cancelável e janela de horário.
5. **Lista de navegação fechada** no app (`screens/Concierge/chatScreenRoutes.ts:12-21`), com params validados.
6. **Auditoria**: registrar quem confirmou (sessão), quando, o `previewId` e a resposta da API oficial.
7. **PII no LLM**:
   - não enviar `birthDate` completo nem telefone ao modelo; mandar só flags derivadas ("elegível", "precisa do titular");
   - referir-se a acompanhantes por primeiro nome;
   - não gravar tokens no histórico.
8. **Limite de taxa** por hóspede nas tools transacionais.
