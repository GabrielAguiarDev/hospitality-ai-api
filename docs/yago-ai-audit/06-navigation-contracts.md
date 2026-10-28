# 06 — Contratos de navegação

## 1. Estado atual

- **Navigator**:
  - Há um `createNativeStackNavigator` raiz com as telas `update`, `login`, `webView` e `main` (`src/routes/Config/stack.routes.tsx:140-212`).
  - `main` é outro stack nativo com as 32 rotas de `src/routes/Models/stack.ts:15-48`, com `initialRouteName="home"`.
- **Params tipados**: `stackScreens` (`stack.ts:50-72`).
- **Deep links**: **não existem**.
  - O `NavigationContainer` não recebe `linking` (`src/routes/index.tsx:42`).
  - O push guarda `data.link`, mas nada o lê (`src/services/useNotification.ts:84-119`).
- **Navegação fora de componentes**: `navigationRef.navigate` (`src/utils/navigationRef.ts`).
- **Navegação a partir do chat**, em dois mecanismos:
  1. **Yago AI API** (`navigate`): lista fechada `CHAT_SCREEN_ROUTES` (`screens/Concierge/chatScreenRoutes.ts:12-21`). Hoje só existe `Gastronomy`:

     | Condição | Destino |
     |---|---|
     | com `restaurantId` | `bookingGastronomyDetails {id}` |
     | sem `restaurantId` | `gastronomy` |

     Uma tela desconhecida faz o botão não aparecer.
  2. **Concierge local** (`ConciergeNavigation`): aceita qualquer nome presente em `screens` (`screens/Concierge/actions.ts:51-58`), sem validar params.
     - Por isso, **não deve ser usado com dados vindos do servidor**.

## 2. Mapa de rotas

Legenda da coluna "Abrir direto do chat?":

| Valor | Significado |
|---|---|
| SIM | Só precisa de ids |
| OBJ | Precisa de objeto completo. O app deve montá-lo a partir do cache ou de uma busca, **nunca** do payload do servidor |
| NÃO | Não deve ser aberta pelo chat |

| Rota | Tela (arquivo) | Params | IDs | Abrir direto do chat? | Observação |
|---|---|---|---|---|---|
| `home` | `screens/Home` | — | — | SIM | — |
| `requests` | `screens/Requests` (stack interno `DepartmentList` + 1 rota por `department.name`) | — / interno: `IDepartment` | departmentId | SIM (lista); OBJ (departamento) | Abrir um departamento: `navigate("requests", { screen: dept.name, params: dept })`, com `dept` vindo do cache `["departments"]`. Risco: nomes de rota = nome do departamento (colisões). |
| `gastronomy` | `screens/Gastronomy` | — | — | SIM | — |
| `gastronomyId` | `screens/Gastronomy/screens/[gastronomyId].tsx` | `{ id }` | restaurantId | SIM | Página informativa + cardápio |
| `bookingGastronomyDetails` | `Booking/Gastronomy/screens/Details.tsx` | `{ id }` | restaurantId | SIM (já usado) | Só se `existsBooking === "sim"` |
| `bookingGastronomySelectDate` | `.../SelectDate.tsx` | `TRestaurantSelectDate { restaurant, holder, accompanyingGuests }` | — | OBJ | Seria a entrada para "pré-preencher" pessoas. O app resolve `restaurant` e os hóspedes pela sessão. Sem validação de idade aqui: ela fica no Details. **Não recomendado** pular o Details. |
| `bookingGastronomySelectDish` | `.../SelectDish` | `TRestaurantSummary` | — | NÃO | Exige data, hora e turno validados |
| `bookingGastronomyConfirmation` | — | — | — | NÃO | — |
| `experiences` | `screens/Experiences` | — | — | SIM | — |
| `experienceId` | `screens/Experiences/screens/[experienceId].tsx` | `{ id }` | experienceId | SIM | Informativa |
| `bookingExperienceDetails` | `Booking/Experience/screens/Details.tsx` | `{ id }` | experienceId | SIM | Entrada da reserva |
| `bookingExperienceSelectDate` | `.../SelectDate.tsx` | `TExperienceSelectDate { holder, participants, experienceId, maxBookingHour }` | — | OBJ | Possível pré-preencher titular e participantes, **desde que o app revalide** com `validateExperienceGroup` antes de navegar |
| `bookingExperienceTerms`, `Form`, `Summary` | — | `TExperienceSummary` | — | NÃO | — |
| `bookingExperienceConfirmation` | — | `{ requiresSignature?, signFailed? }` | — | NÃO | — |
| `events` | `screens/Events` (abas `sun`…`sat`) | — | — | SIM | Abrir em um dia: aba interna pelo nome do dia. Viável, mas a aba é calculada em UTC + 3 h (R-EVT-01) |
| `leisure` | `screens/Leisure` (abas = `category.name`) | — | — | SIM | Abrir em uma categoria: aba pelo nome |
| `signature` | `screens/Signature` | `TSignature` | — | NÃO | Montagem complexa (ver `Leisure/[leisureId].tsx:84-106`) |
| `spa` | `screens/SPA` | — | — | SIM | — |
| `boutique` | `screens/Boutique` | — | — | SIM | Sem rota de produto |
| `esg` | `screens/ESG` | — | — | SIM | — |
| `tip` | `screens/Tip` | — | — | SIM | — |
| `quiz` | `screens/Quiz` (stack: `QuizList`, `QuizLobby {quiz: IQuiz}`, `QuizPlay`, `QuizResult`) | — | quizId | SIM (lista); OBJ (lobby) | Lobby exige o `IQuiz` (buscar E50/E51) |
| `map` | `screens/Map` | `TLocation { id, name, acronym, latitude, longitude }` | locationId | OBJ | Não há endpoint de local. O app resolve `location` pela entidade de origem (restaurante, evento, atividade) |
| `myReservation` | `screens/MyReservation` | `{ tab?: "Gastronomy" \| "Experience" }` | — | SIM | Não abre uma reserva específica (não há rota de detalhe) |
| `myRequests` | `screens/MyRequests` | — | — | SIM | Sem detalhe por id |
| `myFavorites` | `screens/MyFavorites` | — | — | SIM | — |
| `config` | `screens/Config` | — | — | SIM | — |
| `webView` | `screens/WebView` | `{ title, url }` | — | OBJ com lista permitida | Só domínios permitidos |
| `concierge`, `conciergeVoice` | — | — | — | NÃO | Já está no chat |

## 3. Contrato proposto para `navigate`

Princípio: o servidor envia **nomes de tela do contrato**, e não nomes de rota. O app mantém o único mapeamento, em `chatScreenRoutes.ts`.

```ts
// Proposta — extensão de NavigateAction["params"]
interface NavigateAction {
  type: "navigate"
  label: string
  screen:
    | "Gastronomy" | "Restaurant" | "Experiences" | "Experience" | "Events" | "Leisure"
    | "Requests" | "Spa" | "Boutique" | "Esg" | "Tips" | "Quiz"
    | "MyReservation" | "MyRequests" | "MyFavorites" | "Map"
  params: {
    restaurantId?: string
    experienceId?: string
    departmentId?: string
    leisureCategoryId?: string
    date?: string                 // AAAA-MM-DD (Events: escolhe a aba)
    tab?: "Gastronomy" | "Experience"
    entity?: { kind: "restaurant" | "event" | "leisure"; id: string } // para Map
  }
}
```

| `screen` (contrato) | Resolução no app (`CHAT_SCREEN_ROUTES`) | Validação no app |
|---|---|---|
| `Gastronomy` | existente: `restaurantId` → `bookingGastronomyDetails {id}`; senão `gastronomy` | O `restaurantId` existe no cache `["restaurants"]` e `existsBooking === "sim"`; senão cai em `gastronomyId` |
| `Restaurant` | `gastronomyId {id: restaurantId}` | O id existe |
| `Experiences` | `experiences` | — |
| `Experience` | `existsBooking === "sim"` ou `type === "reserva"` → `bookingExperienceDetails {id}`; senão `experienceId {id}` (R-EXP-02) | O id existe no cache `["experiences"]` |
| `Events` | `events` (+ aba pelo `date`) | `date` dentro dos 7 dias exibidos |
| `Leisure` | `leisure` (+ aba pela categoria) | A categoria existe |
| `Requests` | `departmentId` → `requests` › departamento (objeto do cache); senão `requests` | O departamento existe e tem itens |
| `Spa`, `Boutique`, `Esg`, `Tips` | `spa`, `boutique`, `esg`, `tip` | — |
| `Quiz` | `quiz` | — |
| `MyReservation` | `myReservation {tab}` | `tab` ∈ enum |
| `MyRequests`, `MyFavorites` | `myRequests`, `myFavorites` | — |
| `Map` | `map`, com `TLocation` resolvido de `entity` no cache | Entidade e local existem; lat/long numéricos |

**Regras:**

1. Tela fora da tabela: o botão não aparece. É o comportamento atual (`chatScreenRoutes.ts:19`).
2. Params inválidos ou id inexistente: cair na tela de lista, ou esconder o botão. Nunca navegar com um objeto incompleto.
3. O servidor **nunca** envia objetos de rota (`TRestaurantSummary`, `TSignature`, `TLocation`). Os objetos são montados pelo app.
4. Abrir tela com formulário pré-preenchido fica fora do escopo da fase 1. A única candidata segura é `bookingExperienceSelectDate`, com revalidação no app.

## 4. Deep links (recomendação, não implementado)

- Se as notificações push precisarem abrir telas, implementar `linking` com o **mesmo** conjunto de `screen` do contrato acima, resolvido pela **mesma** função (`resolveChatScreen`).
- Isso evita duas listas permitidas divergentes. Ver o achado S9 no [08](08-auth-context-and-security.md).
