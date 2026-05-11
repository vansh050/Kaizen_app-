# Design System Architecture — Bring-Your-Own-UI

> **Source of truth for the swappable-UI design system.** Update this doc BEFORE writing the matching code change. See `CLAUDE.md § Architecture Documentation — MANDATORY` for the blocking-doc rule. Mirrors the Phase 3 doc trio: this file + `DESIGN_COMPONENT_AUDIT.md` (per-surface inventory) + `DESIGN_MIGRATION_PROGRESS.md` (chronological work log).

## What this is

A staged refactor that splits every UI surface in the app into **logic** (lives in `src/`, never swappable) and **presentation** (lives in `designs/<variant>/`, fully swappable). The goal is "bring your own UI": a tenant or partner can ship a custom skin — tokens only, primitives only, or all the way up to whole screens — without forking the app or touching business logic.

This is a **layered, opt-in extension of the existing theme system** (`src/theme/colors.js` + `useColors()`), not a replacement. Today only `colors` are swappable; this doc extends the same model to spacing/typography/primitives/composites/screens.

This is **not** a bundling change, not a package extraction, not a separate npm release. Everything ships in this repo. A future variant lives at `designs/<variant>/` next to `designs/default/`.

## The non-negotiable boundaries

These three rules are what keep the refactor safe. Every PR that touches `designs/` is reviewed against them.

### 1. SDK-bound surfaces are NEVER in `designs/`

The Phase 3 SDK migration is its own contract (`docs/PHASE3_ARCHITECTURE.md`). The following surfaces stay in `src/` and stay non-swappable:

- `src/components/BrokerConnectionModal/Phase3SdkBrokerModal.js` — the SDK modal shell wrapping `BrokerCredentialForm` / `WebViewBrokerAuthFlow`
- `../alphaquark-mobile-sdk/packages/rn/src/components/BrokerCredentialForm` — owned by the SDK package
- `../alphaquark-mobile-sdk/packages/rn/src/components/WebViewBrokerAuthFlow` — owned by the SDK package
- Any future SDK-routed widget added under `SDK_ELIGIBLE_MODALS`

A custom design CAN theme the visual chrome around these (the modal backdrop, the header bar, the close button, the page background). It CANNOT replace the form rendering itself. The SDK is sacred because it owns the legal/security/correctness contract with the backend. Skinning the SDK form would re-introduce every Phase 3 regression we just fixed.

### 2. No data fetching, no contexts, no services in `designs/`

Composites and screens in `designs/` are **pure presentation**: props in, JSX out. They never call:

- React hooks that touch context (`useTradeContext`, `useMultiBrokerContext`, `useConfig`, `useMarketData`, `useGstConfig`)
- Service modules (`ModelPortfolioService`, `OrderService`, `BrokerOrderBookAPI`, `ReconciliationService`, anything in `src/services/`, `src/FunctionCall/`)
- Async-storage / network / native modules
- `EventEmitter`, `portfolioEvents`, any cross-component bus

What they CAN call:

- Other components from the same `designs/<variant>/`
- Pure utility functions from `src/utils/` that take args and return a value (`formatCurrency`, `symbolNormalizer`) — these are not state.
- `useColors()` and any future `useTokens()` / `useTypography()` — design-system hooks only.

This is the rule that makes a design swappable. If a composite reaches into context, swapping the composite means swapping its data dependencies too, and the variant is now coupled to the app's internal state shape forever. Everything goes through props.

### 3. Containers own the data; presentation receives props

Every screen and feature surface gets split:

- **Container** (in `src/screens/` or `src/components/`) — calls hooks, contexts, services, services, services. Computes props. Renders the resolved presentation component from the registry. No JSX layout beyond the wrapper.
- **Presentation** (in `designs/<variant>/`) — receives those props. Renders layout + composites + primitives. No data calls.

The container is the only place business logic touches the screen tree. Swapping the design swaps the presentation; the container is unchanged.

## Layer model

| Layer | What it is | Swappable? | Lives in | Today |
|---|---|---|---|---|
| **Tokens** | colors, spacing, typography, radii, shadows, motion | yes | implementation in `src/theme/`, registry-facing surface in `designs/<variant>/tokens/` | **Phase A complete (2026-05-01)** — colors + spacing + typography + radii + shadows live in `src/theme/`; `useTokens()` composite hook available; `designs/default/tokens/index.js` re-exports. Backend overrides for non-color tokens still need ConfigContext passthrough (separate PR). |
| **Primitives** | `Button`, `Input`, `Text`, `Card`, `ModalShell`, `Toast`, `Spinner`, `Icon` | yes | `designs/<variant>/primitives/` | Scattered across `src/components/` and `src/UIComponents/`. To extract. |
| **Composites** | `BrokerCard`, `AdviceRow`, `RebalanceCard`, `MPCard`, `HoldingRow`, `OrderRow` | yes | `designs/<variant>/composites/` | Today these are coupled to contexts. To split into container + presentation. |
| **Screens** | layout shell + which composites to render where | yes (layout only) | `designs/<variant>/screens/` | Today screens both fetch and render. To split. |
| **Containers / hooks** | `TradeContext`, `useMultiBrokerHoldings`, `FunctionCall/*`, `services/*` | **no** | `src/` (unchanged) | Already isolated. Stays. |
| **SDK-bound surfaces** | `Phase3SdkBrokerModal`, SDK widgets | **no** | `src/components/BrokerConnectionModal/`, SDK package | Stays. Phase 3 owns this. |

### Tokens

Tokens live in two layers:

- **Implementation** in `src/theme/` (existing pattern — integrates with `ConfigContext` for advisor overrides). Phase A (2026-05-01) shipped `colors.js`, `spacing.js`, `typography.js`, `radii.js`, `shadows.js`, plus a composite `useTokens()` hook.
- **Registry-facing surface** at `designs/<variant>/tokens/index.js` — re-exports the `DEFAULT_*` objects + `build*()` builders. The `DesignProvider` (Phase B) imports from here. A custom variant ships `designs/<variant>/tokens/index.js` with variant-specific values in the same shape.

Default values shipped in Phase A:

```js
// src/theme/spacing.js
DEFAULT_SPACING = { none: 0, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 }

// src/theme/radii.js
DEFAULT_RADII = { none: 0, sm: 4, md: 8, lg: 12, xl: 16, pill: 999 }

// src/theme/typography.js — Poppins (full weight set shipped in
// android/app/src/main/assets/fonts/). Roles: heading / title / subtitle /
// body / bodyEmphasis / caption / muted / button. Each is an RN style object
// with fontFamily / fontSize / lineHeight / fontWeight.

// src/theme/shadows.js — RN style objects (iOS shadow* keys + Android
// elevation, both set). Roles: none / card / elevated / modal / floating.
```

Backend overrides (already supported for colors via `appadvisors.colorTokens`) extend to spacing/typography/radii/shadows in the same shape. Resolution order is unchanged from `COLOR_TOKENS.md`: default → legacy fields → backend tokens (deep merge). The `build*()` functions accept config and look for `spacingTokens` / `typographyTokens` / `radiiTokens` / `shadowTokens` — but `ConfigContext` does NOT yet passthrough these fields, so today they're undefined and resolution falls to defaults. Wiring them through `ConfigContext` is a separate, additive PR (zero behavior change for existing tenants).

Components SHOULD prefer the composite hook `useTokens()` going forward; the existing `useColors()` continues to work unchanged for color-only consumers.

### Primitives

A fixed catalog. The names are part of the design contract — adding a new primitive is a doc change first.

| Primitive | Variants | Phase C status |
|---|---|---|
| `Text`    | `body` (default) / `title` / `heading` / `subtitle` / `bodyEmphasis` / `caption` / `muted` / `button` | ✅ Shipped |
| `Button`  | `primary` (default) / `secondary` / `ghost` / `destructive` | ✅ Shipped |
| `Card`    | `default` / `elevated` / `outlined` | ✅ Shipped |
| `Input`   | `text` (default) / `password` / `numeric` / `otp` | ✅ Shipped |
| `Spinner` | `inline` (default) / `overlay` | ✅ Shipped |
| `Icon`    | (no variants — caller passes the lucide-react-native component via the `Component` prop; preserves Metro tree-shaking) | ✅ Shipped |
| `Pill`    | `neutral` (default) / `profit` / `loss` / `warning` | ✅ Shipped |
| `Divider` | `solid` (default) / `dashed` | ✅ Shipped |
| `Toast`   | `info` / `success` / `warning` / `error` (imperative API: `Toast.show(msg, variant, options?)`) | ✅ Shipped |
| `ModalShell` | `bottomSheet` / `fullScreen` / `centered` | Deferred to Phase H — design fresh when the first non-SDK-bound modal migrates. |
| `Skeleton` | `line` / `block` / `card` | Deferred indefinitely — no current loading-state pattern uses skeletons. |

Every primitive accepts a `variant` prop, a `style` prop (RN style override that the variant cannot block — caller wins), and standard accessibility props (passed through `...rest`). Token reads via `useTokens()`; never reads colour hex directly. Variants are documented in each primitive's file-level docstring; adding a new variant requires updating this table AND the audit doc Section 1.

**Component-key naming**: dot-namespaced. `primitives.Button`, `primitives.Text`, etc. The same convention applies for composites and screens (`composites.IgnoreStockCard`, `screens.Home`). Registered in `designs/default/index.js`'s `components` map.

**Call-site migration policy (Phase C+):** when a screen or component is touched for any reason, callers SHOULD migrate ad-hoc `<TouchableOpacity>` / `<Text>` / `<TextInput>` / `<View>` patterns to the matching primitive in the same commit. New code MUST use primitives. Wholesale call-site sweeps (e.g. "replace every `<Text>` in `src/`") are explicitly NOT scheduled — they're high-volume, regression-prone, and provide no incremental user value over opportunistic migration.

### Composites

Composites are domain-shaped: they know about brokers, holdings, advices, rebalances. But they only know **about** these concepts — they don't fetch them. A `BrokerCard` takes a `broker` prop with a fixed shape; it doesn't call `useMultiBrokerContext`.

The composite contract per surface lives in the audit (`DESIGN_COMPONENT_AUDIT.md`). Each row spells out: what props the composite receives, what callbacks it emits, and the shape contract that the container must honour.

### Screens

Screens in `designs/<variant>/screens/` receive a `viewModel` prop (everything the container computed) and `actions` prop (callbacks). They lay out composites. Example:

```js
// designs/default/screens/Home.js
export default function HomeScreen({ viewModel, actions }) {
  return (
    <ScreenShell>
      <Greeting name={viewModel.user.name} />
      <BrokerStrip brokers={viewModel.brokers} onConnect={actions.connectBroker} />
      <AdviceList advices={viewModel.advices} onAccept={actions.acceptAdvice} />
      ...
    </ScreenShell>
  );
}
```

A custom variant can re-arrange these, drop sections, or re-skin them. It CANNOT make `viewModel` deeper or expect callbacks the container doesn't emit — that's a contract change, not a design change, and goes through the audit.

## Registry: the `DesignProvider`

A single React context at the app root, mounted just inside `GestureHandlerRootView` and outside every other app provider. Resolves a key (e.g. `"primitives.Button"`) to a component implementation.

**Shipped Phase B (2026-05-01)** — files:

- `src/design/DesignProvider.js` — the provider component. Uses `useRef` to freeze the resolved registry at mount (the `variant` prop is read once and ignored thereafter; runtime variant switching is not supported in v1).
- `src/design/resolveDesign.js` — pure resolution function. Throws at startup if `designs/default/` is missing from the registry. Warns in dev when a non-default variant is requested via `DESIGN_VARIANT` or the `variant` prop but isn't registered.
- `src/design/useDesign.js` — exports `useDesign()` (returns `{ variant, tokens, components }`) and `useComponent(key)` (throws if key is missing in active variant or default).
- `designs/registry.js` — static map of all variants. To add a custom variant, add an import + entry here.
- `designs/default/index.js` — default variant root. `tokens` re-exported from `designs/default/tokens/`. `components` map is empty as of Phase B; Phase C populates it.

The `DesignContext` defaults to `null` so calling `useDesign()` outside the provider throws a clear error rather than returning a misleading empty bundle.

### Resolution

For variant `"acme"`:

1. Start with `designs/default/` (every key MUST exist here — default is the contract floor).
2. Shallow-merge `designs/acme/`'s `components` over default's `components`. Tokens layer-merge by namespace (variant's `tokens.X` replaces default's `tokens.X` if the variant exports it, otherwise default's wins).
3. The resolved registry is frozen at provider mount via `useRef`; variant switching requires app restart (matches how `APP_VARIANT` works today).

The default variant is the canonical source. **Adding a primitive, composite, or screen always lands in `designs/default/index.js` first.** Variants opt in by overriding; they cannot add new keys that default doesn't have.

### Variant selection

Three sources, in order of precedence (resolved by `pickSelection()` in `DesignProvider.js`):

1. `<DesignProvider variant="...">` prop — wins over env. Mostly useful for tests and Storybook.
2. `DESIGN_VARIANT` env var — set this in `.env` to ship a tenant skin.
3. `APP_VARIANT` env var — fallback only.
4. `default`.

A name with no matching entry in `designs/registry.js` falls back to `default`. The dev-only warning fires only when the source is `prop` or `DESIGN_VARIANT` (those are explicit design selectors). When the source is `APP_VARIANT` and there's no matching folder, fallback is silent — `APP_VARIANT` is primarily a business-config selector; not having a design folder for every business variant is the normal case.

Backend per-tenant override (`appadvisors.designVariant`) is reserved for future work and not wired in v1. Tenants who want a custom skin ship a build with `DESIGN_VARIANT` set.

## Container / presentation split — the worked example

Today's `HomeScreen.js`:

```js
// src/screens/Home/HomeScreen.js — 600+ lines, mixed
export default function HomeScreen() {
  const { advices, holdings, funds } = useTradeContext();
  const { brokers } = useMultiBrokerContext();
  // ... 100 lines of state and handlers ...
  return (
    <View style={...}>
      <Text style={...}>Hi {name}</Text>
      {/* 400 lines of inline JSX */}
    </View>
  );
}
```

After:

```js
// src/screens/Home/HomeScreen.js — container, ~80 lines
export default function HomeScreen() {
  const { advices, holdings, funds } = useTradeContext();
  const { brokers } = useMultiBrokerContext();
  // ... handlers ...
  const HomePresentation = useComponent('screens.Home');
  const viewModel = { user: { name }, advices, holdings, funds, brokers };
  const actions = { connectBroker, acceptAdvice, ... };
  return <HomePresentation viewModel={viewModel} actions={actions} />;
}
```

```js
// designs/default/screens/Home.js — pure presentation
export default function Home({ viewModel, actions }) {
  /* layout + composites */
}
```

A custom variant overrides `designs/acme/screens/Home.js` and gets a different visual without ever touching `TradeContext`.

## What surfaces are in scope vs deferred

### In scope for v1

Effectively the entire app **except** the SDK-bound Phase 3 surfaces (see "Out of scope" below). Concretely:

- `screens/Home/*`
- `screens/PortfolioScreen/*`
- `screens/AccountSettingScreen/*`
- `screens/Authentication/*`
- `screens/Drawer/*` — including the Model Portfolio screens (`ModelPortfolioScreen`, `MPPerformanceScreen`, `CustomTabbarMPPerformance`, `EmptyStateMP`)
- `components/AdviceScreenComponents/*` — except inline broker-modal renders (Phase 3 surface)
- `components/ModelPortfolioComponents/*` (all 20 files) — **policy reversal 2026-05-01: MP surfaces are now in scope** (was previously frozen — see "Note on MP and the SDK" below)
- `UIComponents/StockAdvicesUI/*`, `UIComponents/RebalanceAdvicesUI/*`
- All standalone modals not in the SDK lane (`BasketTradeModal`, `DeleteAdviceModal`, `IgnoreAdviceModal`, `GttDetailsModal`, `GttSuccessModal`, `DdpiModal`, `TokenExpireBrokerModal`, `HoldingsMigrationModal`, `RebalanceModal`, `RebalanceAdviceContent`, `RebalancePreferenceModal`, `MPReviewTradeModal`, `MPInvestNowModal`, etc.)

### Out of scope — SDK-bound Phase 3 surfaces

The only surfaces that NEVER migrate to `designs/`:

- `src/components/BrokerConnectionModal/Phase3SdkBrokerModal.js`
- All `src/components/BrokerConnectionModal/*` legacy modals (scheduled for deletion as Phase 3 reaches 100%)
- All `src/UIComponents/BrokerConnectionUI/*` (12 broker-specific UIs — same fate)
- `src/components/CrossPlatformOverlay.js` (used by SDK-bound surfaces only)
- `src/screens/Drawer/ManageConnectionsModal.js`, `DisconnectBrokerModal.js`, `BrokerConnectionError.js`
- The SDK package's own widgets (`BrokerCredentialForm`, `WebViewBrokerAuthFlow`) at `../alphaquark-mobile-sdk/packages/rn/src/components/`

These have their own contract under `docs/PHASE3_*.md`. The design-system migration may theme the visual chrome around them (modal backdrop, header bar) via primitives, but cannot replace the form rendering itself.

### Note on MP and the SDK — accept the risk

There is a non-trivial chance the Model Portfolio flows (calculate-rebalance, MP review trade, MP performance, basket subscription) migrate into the `@alphaquark/mobile-sdk` package alongside broker-connect later — see `docs/SDK_MOBILE_FIT_ASSESSMENT.md`. **The 2026-05-01 product decision is to migrate MP surfaces into the design system anyway**, accepting that some or all of that design-system work gets thrown away if/when MP moves to SDK.

Why migrate them now even with that risk:

- A consistent, fully-tenant-skinnable app today is more valuable than waiting on an undecided SDK plan.
- A two-tier UX where MP screens look different from the rest of the app is a worse user experience than a unified design.
- The container/presentation split work has reuse value even if presentation goes — the container shape (data deps, viewModel) is what the future SDK widget will consume.

When the SDK MP plan resolves:

- **If MP ships as SDK**: the affected rows in `DESIGN_COMPONENT_AUDIT.md` flip from `clean-extract` / `needs-logic-extraction` / migrated → **`SDK-pending`**, and the design work for those surfaces is unwound or absorbed into the SDK widget. A `DESIGN_MIGRATION_PROGRESS.md` entry records the unwind.
- **If MP plan is dropped**: nothing changes. MP surfaces stay in the design system.

The verdict `SDK-pending` is **kept in the legend** but its meaning narrows — it now applies only to surfaces that have an active, committed SDK migration in flight (i.e. a Phase 3 commit is open or imminent for that surface). It is no longer applied preemptively for "this might move to SDK someday".

## Migration order

Strictly sequential. Each phase ships, soaks, and is reviewed before the next starts. Each phase has its own progress log entry.

1. **Phase A — Tokens absorption. ✅ Shipped 2026-05-01.** Extended `src/theme/` to a full token bundle (`spacing.js` / `typography.js` / `radii.js` / `shadows.js` on top of existing `colors.js`). `useTokens()` composite hook live. `designs/default/tokens/index.js` re-exports the canonical values. No component changes. ConfigContext passthrough for non-color overrides deferred to a follow-up PR.
2. **Phase B — `DesignProvider` skeleton. ✅ Shipped 2026-05-01.** Provider at `src/design/DesignProvider.js`, resolver at `src/design/resolveDesign.js`, hooks at `src/design/useDesign.js`, registry at `designs/registry.js`, default variant root at `designs/default/index.js`. Wired under `GestureHandlerRootView` in `App.js`. Variant selection: prop → `DESIGN_VARIANT` → `APP_VARIANT` → `default`. Empty components map. Frozen-at-mount via `useRef`.
3. **Phase C — Primitives. ✅ Shipped 2026-05-01.** 9 primitives shipped in one drop at `designs/default/primitives/`: `Text`, `Button`, `Card`, `Input`, `Spinner`, `Icon`, `Pill`, `Divider`, `Toast`. All registered in `designs/default/index.js` with dot-namespaced keys (`primitives.Text`, etc.). `ModalShell` deferred to Phase H per the audit; `Skeleton` deferred indefinitely (no current loading-state pattern in the codebase). Call-site updates are NOT bundled with this drop — they happen opportunistically (new code uses primitives; old code migrates as it's touched).
4. **Phase D — One composite end-to-end. ✅ Shipped 2026-05-01.** First composite migrated: `RebalanceDetailsModal` (164 lines, single consumer in `RebalanceCard.js`, pure presentation). Pivoted from the originally-planned `IgnoreStockCard` after the migration discovered it was orphan dead code (zero consumers — deleted in the same commit). New file at `designs/default/composites/RebalanceDetailsModal.js`, registered as `composites.RebalanceDetailsModal`. Consumer (`src/UIComponents/RebalanceAdvicesUI/RebalanceCard.js`) updated to resolve via `useComponent`. Legacy `src/components/AdviceScreenComponents/RebalanceDetailsModal.js` deleted.
5. **Phase E — Home + Order screens.**
   - **E.1 — OrderScreen ✅ Shipped 2026-05-01.** Container at `src/screens/Home/OrderScreen.js` (1195 lines → ~120 lines after dropping dead code: PanResponder + tab system + `imageUrl` / `isModalOpen` / `MODAL_STATE` listener that was never reached). Presentation at `designs/default/screens/OrderScreen.js`. `OrderRow` composite extracted to `designs/default/composites/OrderRow.js`. Date / symbol / status-color helpers extracted to `src/utils/orderUtils.js`. Sets the container/presentation template for whole-screen migrations.
   - **E.1.5 — HomeScreen prep refactor ✅ Shipped 2026-05-01.** Two new hooks at `src/screens/Home/hooks/`: `useHomeScreenTabs` (consolidates `selectedTab` + 7 see-all overlay booleans behind a single `overlay: string | null` state with backward-compat boolean shims) and `useHomeScreenModals` (consolidates 4 modal-visibility booleans behind `{ activeModal, activeModalData }` with shims). HomeScreen.js sheds 12 useState declarations; call sites unchanged thanks to the shims. No `designs/` migration in this commit — internal refactor only, prepares the surface for E.2.
   - **E.2 — HomeScreen registry hookup ✅ Shipped 2026-05-02.** **Minimal scope.** `src/screens/Home/HomeScreen.js` is now a thin registry resolver (`useComponent('screens.HomeScreen')`). The legacy implementation moved to `src/screens/Home/HomeScreenLegacy.js`; default variant re-exports it. Custom variants can fully replace HomeScreen by shipping `designs/<variant>/screens/HomeScreen.js` (variants take responsibility for re-calling useTrade / useConfig / useNavigation themselves).
   - **E.3 — HomeScreen deep container/presentation split ✅ Shipped 2026-05-02.** Container at `src/screens/Home/HomeScreen.js` (~1654 lines — all hooks, state, effects, handlers, `allTabData` builder, FCM/notifee, EventEmitter). Presentation at `designs/default/screens/HomeScreen.js` (~642 lines — JSX render + 4 modals). Styles in shared `src/screens/Home/HomeScreen.styles.js`. `HomeScreenLegacy.js` deleted. The split passes a single ~50-key `home` prop bag from container to presentation. Variant overridability now works end-to-end. Sub-steps shipped: E.3.1 (styles extraction), E.3 deep split (JSX extraction).
6. **Phase F — Authentication / Account settings.**
   - **Batch 1 ✅ Shipped 2026-05-01.** 4 clean-extracts: `ResetPassword`, `EmailScreenAppleLogin`, `TermsModal` (composite), `LogOutScreen`. All container/presentation split + registered. ~470 lines of presentation across 4 files.
   - **Batch 2 ✅ Shipped 2026-05-01.** `LoginScreen` + `SignupScreen` — paired auth screens, container/presentation split. All Firebase / Google / Apple / post-login orchestration preserved exactly in containers. Render-extraction only.
   - **Batch 3 ✅ Shipped 2026-05-01.** `SignUpRADetails` + `PhoneNumberScreen` — paired onboarding. Container/presentation split. PhoneNumberScreen migration also fixed a pre-existing missing-`Config`-import ReferenceError bug.
   - **Batch 4 ✅ Shipped 2026-05-01.** `ChangeAdvisor` (Account section). All Phase F surfaces complete.
7. **Phase G — Advice screens (non-MP).** Rebalance flows excluded (deferred).
8. **Phase H — Modals (non-SDK-bound).** The long tail.
9. **Phase I — MP screens. ✅ Shipped 2026-05-03.** ModelPortfolioScreen (1115 LOC), MPPerformanceScreen (2220 LOC), MPCard, ModelPFCard, CustomTabbarMPPerformance, EmptyStateMP — all container/presentation split. MPInvestNowModal (5364 LOC) — container/presentation split with payment gateway code in container.
   - **NOT in `designs/`** (SDK-replaced): `MPReviewTradeModal` (2151 LOC), `RebalanceModal` (2650 LOC), `RebalanceAdviceContent` — these are replaced by SDK orchestrator widgets (`tradeReviewSheet`, `tradeResultModal`, `tradeExecutionProgress`, `sellAuthGate`). Customizable via `designs/<variant>/sdk/` instead. See `docs/SDK_DESIGN_PASSTHROUGH.md § 9`.

**All phases (A–I) are now complete.** The design system covers 61+ surfaces. Any new surface follows the same pattern: container at `src/`, presentation at `designs/default/`, registered in `designs/default/index.js`.

Each phase is the smallest atomic unit that ships value and can be reverted cleanly. Don't bundle them.

## Backend overrides

Tokens already integrate with `appadvisors.colorTokens`. The same per-tenant override pattern extends to:

- `appadvisors.spacingTokens` — partial override of the `spacing` object
- `appadvisors.typographyTokens` — partial override of the `typography` object
- `appadvisors.radiiTokens` — partial override of the `radii` object

Component-level overrides (e.g. "use `MyBrokerCard` for advisor X") are **not** backend-driven in v1. They require a build-time `DESIGN_VARIANT`. This is a deliberate scope cut: per-tenant component swaps would need either (a) bundle splitting or (b) shipping every variant in every build, both of which are non-trivial.

## Testing strategy

- **Snapshot tests per primitive** in `designs/default/`. A variant ships its own snapshots.
- **Container-only tests** for screens in `src/` — mock the resolved presentation, assert the container builds the right viewModel.
- **Visual regression** (Storybook or similar) lives at `designs/default/.storybook/`. Variants get their own. Out of scope for v1 — flag for follow-up.

## What's NOT in this design

Calling these out so they don't get smuggled in:

- No CSS-in-JS / styled-components migration. RN `StyleSheet` stays.
- No new state-management library. Zustand + contexts stay.
- No package extraction. `designs/` is part of this repo.
- No runtime variant switching. Variant is fixed at provider mount.
- No per-component backend override. v1 = build-time only.
- No new tooling, codegen, or build pipeline changes beyond what's needed to read `designs/<variant>/`.
- No refactor of business logic, hooks, or services. Containers MAY be cleaned up incidentally during the split, but cleanup is not the goal — separation is.

## When to update this doc

Same rule as Phase 3: this doc is the design source of truth, the audit is the per-surface implementation tracker, the progress log is the work history. Update this file BEFORE the matching code change. Specifically:

- Adding/removing a primitive from the catalog
- Changing the registry resolution rules
- Changing the provider API or adding a new hook
- Changing the variant selection precedence
- Changing the SDK boundary (surfaces in/out of `designs/`)
- Changing the container/presentation contract
- Promoting or freezing a screen group (e.g. lifting the MP freeze)

Cosmetic-only changes (token defaults, internal primitive layout) need an audit row update + progress log entry, not necessarily an architecture-doc change.
