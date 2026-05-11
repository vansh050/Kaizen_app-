# CLAUDE.md — AlphaQuark B2B Mobile App

## 🔴 When broker-connect or order-placement times out → check egress /128s on the GRE tunnel

> **First debugging stop** for any "Couldn't connect to <Broker>" /
> "broker_login_url_missing" / "upstream_unreachable" / `connect
> timeout=N` errors on `whitelist_required=true` brokers (Upstox,
> Fyers, Groww, ICICI, HDFC, Kotak, IIFL):
>
> ```
> ssh tidi 'ip -6 addr show t28633R64 | grep "inet6 2a11:6c7:1103:70" | wc -l'
> ```
>
> Should equal customer count in `state.json` (12 as of 2026-05-01).
> If lower, the per-customer /128s aren't configured on the tunnel
> and EVERY customer's broker-connect / order-placement call to those
> brokers will silently TCP-timeout. Fix wiring + full diagnostic
> chain: `../../ccxt-india/docs/PER_CUSTOMER_EGRESS_IP_ARCHITECTURE.md
> § "GRE tunnel /128 host-address requirement (2026-05-01)"`.
>
> Do NOT disable `egress_proxy_enabled` as a workaround — that breaks
> order placement (each user's broker-portal whitelist is the
> per-customer IP, not the server's default IP).

## 🔴 Lesson — broker auth bugs: enumerate EVERY code path before claiming a fix

> **Hard-earned lesson, 2026-05-01 (Fyers "invalid clientId" — 4 rounds of failed fixes):**
>
> A single broker can have its OAuth login URL minted from **multiple
> backend endpoints** that share zero code. For Fyers we found:
>
> 1. `Routes/Broker/Fyers.js` — `/api/fyers/update-key` (the primary
>    legacy endpoint, called by the SDK route's `_selfCallLegacy`
>    when no stored creds exist).
> 2. `Routes/multiBrokerRoutes.js:818-843` — `/api/user/brokers/Fyers/
>    reauth-url` (smart-reauth path; called by SDK auto-jump when
>    `connected_brokers[Fyers]` already has stored credentials —
>    bypasses `update-key` entirely).
> 3. (And the autojump payload from the SDK widget itself omits
>    `apiKey` for Fyers — it only sends `secretKey` + `clientCode`,
>    relying on backend to treat `clientCode` as the App ID per
>    legacy convention.)
>
> Each path had its own decryption logic — and one of them
> (multiBrokerRoutes.js) was forwarding the encrypted blob to ccxt
> RAW. Fixing only the obvious one (Fyers.js) didn't fix the user's
> issue because their flow hit the OTHER path. The user retried 4×,
> got the same error 4×, and rightly lost patience.
>
> **The rule: when fixing a broker auth bug, the FIRST step is to
> grep for every callsite that hits ccxt's auth endpoint. Don't fix
> anything until you've enumerated all of them.**
>
> ```bash
> # Run BEFORE writing any fix:
> grep -rn "/<broker>/login-url\|/<broker>/auth\|/<broker>/gen-access\
> -token" Routes/
> grep -rn "ccxtServerUrl/<broker>" Routes/
> grep -rn "<broker_slug>" Routes/sdk/v1/
> ```
>
> Expect 2-4 paths per broker. Common patterns:
> - `Routes/Broker/<Broker>.js` — fresh-connect / form-submit path
> - `Routes/multiBrokerRoutes.js` — smart-reauth path (uses stored creds)
> - `Routes/sdk/v1/connections.js` — SDK route dispatcher (may call
>   either of the above via `_selfCallLegacy`, OR may call ccxt
>   directly for some brokers)
> - Per-broker route file's `gen-access-token` / `exchange-token`
>   handler — separate from login-URL minting
>
> **Same lesson applies to:**
> - **Encryption symmetry** — if `secretKey` goes through
>   `checkValidApiAnSecret(...)` to decrypt, ASSUME `apiKey` /
>   `clientCode` / any other credential field needs the same
>   transform. Read the ENTIRE request body shape and trace each
>   field's encryption state before any forwarding logic.
> - **Persistence symmetry** — if you write to `connected_brokers[]`,
>   ALSO check the top-level user fields (`user.clientCode`,
>   `user.apiKey`, etc.). Smart-reauth and autojump may read
>   different sources; persisting to only one leaves stale state in
>   the other.
> - **App ID vs user ID confusion** — for Fyers specifically, the
>   App ID is the `UMEG2NCP7W-200`-style identifier from
>   myapi.fyers.in (NOT the user's `YR12345`/`XL12345` Fyers login
>   ID). Form labels matter. Helper text "(NOT your Fyers user ID)"
>   matters. The legacy modal's "Client Code" field is treated as
>   the App ID — call it App ID in the form, never "Client Code".
>
> **When debugging "still the same error after my fix":**
> 1. Add structured log at the entry point of EVERY suspected
>    handler (request body shape + resolved values + payload sent
>    upstream). Don't guess — instrument.
> 2. Check the deployed code matches your fix:
>    `ssh <server> "grep <new_token> <path/to/file>"`.
> 3. Hit the endpoint, pull logs, confirm the request actually
>    reached your fix. If it didn't, you're fixing the wrong path.
> 4. If multiple paths exist, fix ALL of them in one commit — partial
>    fixes invite the user to retry on the broken path and lose
>    confidence.
>
> **Data-corruption recovery:** when an earlier half-fix wrote bad
> state to the DB (e.g. encrypted blob persisted as plaintext-field),
> EITHER (a) make the route resilient via `tryDecrypt`-or-passthrough
> heuristics OR (b) run a MongoDB cleanup script. Both is best. A
> route fix without DB cleanup leaves users with corrupted records
> that auto-jump replays forever; a DB cleanup without route fix
> leaves the next user vulnerable.

## 🔴 BLOCKING: Sell-authorization (DDPI / TPIN / EDIS) — read SELL_AUTH_ARCHITECTURE.md before editing

> **Canonical doc**: `docs/SELL_AUTH_ARCHITECTURE.md` — full conceptual model
> (DDPI vs TPIN vs EDIS), per-broker matrix (live-check vs flag-only), the
> `sell_auth_set_at` timestamp + day-check helper, lifecycle flows, backend
> persistence schema, mobile app responsibilities, SDK boundary, per-broker
> quirks log, and the documentation update contract.
>
> **Mirror docs in sibling repos** (point back to the canonical):
> - `../../tidi_new/tidistockmobileapp/docs/SELL_AUTH_REFERENCE.md`
> - `../../alphaquark-mobile-sdk/docs/SELL_AUTH_REFERENCE.md`
>
> Every commit that touches sell-auth surfaces MUST update the canonical doc
> in the SAME commit. Surfaces include:
> - **Backend persist paths**: `Routes/userRoutes.js` connect handlers (any of
>   the 14 broker branches), `Routes/UpdateEdisStatus.js`, `Routes/sdk/v1/connections.js`,
>   `services/MultiBrokerService.js`, `Routes/Broker/<Broker>.js`, `Models/userModel.js`
>   (any of the sell-auth fields: `ddpi_enabled`, `is_authorized_for_sell`,
>   `sell_auth_set_at`, `sell_auth_revoked_at`, `sell_auth_revoke_reason`,
>   `tpin_enabled`), `utils/sellAuthDayCheck.js`
> - **Backend live-check endpoints**: `Routes/Broker/*` proxies to ccxt's
>   verify-dis / save-ddpi-status / edis-status / verify-edis
> - **ccxt-side** classifier + auto-revoke (`trading_logic/sell_auth_revoke.py`,
>   per-broker `app_<broker>.py` verify-dis endpoints)
> - **Mobile app gates**: `src/components/AdviceScreenComponents/RebalanceModal.js`
>   (per-broker if-blocks), `src/components/DdpiModal.js`,
>   `ZerodhaTpinModal.js`, `AngleOneTpinModel`, `FyersTpinModal`, etc.
> - **SDK widgets**: `EdisModal`, `edisDetection`, `useSellAuth`, any future
>   `<EdisAuthFlow>` widget
>
> **DDPI / TPIN / EDIS is a fundamental component.** Every nuance gets
> recorded so the next contributor doesn't re-derive a known incident from
> production logs.
>
> **What "update the doc" means** (see canonical § 10):
> - New broker added → row in § 4 per-broker matrix
> - New live-check endpoint → update § 4 + § 7a + § 8
> - New flag → update § 2 + § 6
> - New code path → update § 6c "Required code paths"
> - New per-broker quirk discovered → row in § 9
> - SDK ownership changed → update § 8

## 🔴 BLOCKING: SDK orchestration migration — read SDK_ORCHESTRATION_*.md before changing trade-exec / connect / reauth surfaces

> **Canonical doc trio** (drafted 2026-05-02):
> - `docs/SDK_ORCHESTRATION_VISION.md` — north-star architecture, in/out-of-scope, inversion principle, theming, failure semantics, reversibility.
> - `docs/SDK_ORCHESTRATION_AUDIT.md` — per-flow code walks for both consumer apps with file:line refs and per-step migration verdicts.
> - `docs/SDK_ORCHESTRATION_CONTRACT.md` — TS + Dart parallel API surface (executeAdvice / connectBroker / reauth / disconnectBroker).
> - `docs/SDK_ORCHESTRATION_PHASES.md` — sequenced migration plan (Phases C/D/E/F with done-when gates and rollback).
>
> **Mirror docs in sibling repos** (point back to the canonical trio):
> - `../alphaquark-mobile-sdk/docs/ORCHESTRATION_REFERENCE.md`
> - `../tidi_new/tidistockmobileapp/docs/SDK_ORCHESTRATION_REFERENCE.md`
>
> Every commit that touches an orchestrator surface in any of the four
> repos updates the relevant section of VISION (if architectural),
> AUDIT (always — verdict rows for moved files), CONTRACT (if API-affecting),
> and PHASES (always — work-log + done-when checkbox flips) in the SAME commit.
> Undocumented orchestrator deltas block the next orchestrator delta —
> same rule as Phase 3 + sell-auth + design-system.
>
> **Orchestrator surfaces include:**
> - **App callsites**: any `axios.post` to `/orders/process-trade`,
>   `/rebalance/process-trade`, `/api/process-trades/order-place`. Today
>   ~14 in Alphab2bapp (`StockAdvices.js`, `AddtoCartModal.js`,
>   `OrderService.js`, `IgnoreTradesScreen.js`, `RebalanceModal.js`,
>   `MPReviewTradeModal.js`, `UserStrategySubscribeModal.js`,
>   `ModelPortfolioService.js`, `ExecutionStatusScreen.js`,
>   `DummyBrokerHoldingConfirmation.js`) and ~4 in tidi_new
>   (`OrderExecutionService.dart`, `RebalanceReviewPage.dart`).
> - **Trade review modals**: `RebalanceModal.js`, `MPReviewTradeModal.js`,
>   `ReviewTradeModal.js`, `RecommendationSuccessModal.js`. These collapse
>   into SDK widgets in Phase C.
> - **Sell-auth modals**: `DdpiModal.js`, `AngleOneTpinModal.js`,
>   `DhanTpinModal.js`, `FyersTpinModal.js`, `OtherBrokerModel.js`. These
>   collapse into one SDK `<SellAuthGate>` widget in Phase D.
> - **Token-expiry / reauth**: `TokenExpireBrokerModal.js`,
>   `BrokerConnectModalDispatch.js`, `ManageConnectionsModal.js`. These
>   move under `sdk.reauth()` / `sdk.validateBrokerSession()` in Phase E.
> - **Backend SDK routes**: `aq_backend_github/Routes/sdk/v1/orders/`,
>   `sell-auth/`, `connections/`, helpers under `_helpers/`.
> - **SDK package**: `../alphaquark-mobile-sdk/packages/rn/src/orders/`,
>   `connections/`, `sell-auth/`, `client/AqSdkClient.ts` /
>   `aq_sdk_client.dart`, hooks/widgets under each domain folder.
>
> **Cross-platform parity rule**: every contract change ships in BOTH
> SDK packages (`@alphaquark/mobile-sdk` RN + Flutter) in the same
> commit cycle. PR review checklist confirms parity. Drift between RN
> and Flutter is the #1 risk — Phase 3 had two regressions traceable
> to RN/Flutter contract drift.
>
> **B-2 caller wiring is paused.** B-1 SDK package + backend routes
> remain valid foundation. The granular per-callsite wiring originally
> planned for B-2 is superseded by orchestrator-layer wiring in Phase C.
> Do NOT add granular `useExecuteTrades` callsites; wait for Phase C.

## 🔴 BLOCKING: SDK design passthrough + variant system — read SDK_DESIGN_PASSTHROUGH.md + VARIANT_CREATION_GUIDE.md

> **Canonical docs**:
> - `docs/SDK_DESIGN_PASSTHROUGH.md` — component passthrough architecture, 10 overridable SDK widget slots, props contracts, `designs/sdk/` folder pattern, resolution order.
> - `docs/VARIANT_CREATION_GUIDE.md` — how to create a new tenant app variant with custom UI for both app screens and SDK widgets.
> - `docs/SDK_INTEGRATION_GUIDE.md` — public-facing SDK integration guide for third-party developers (auth, methods, types, errors, theming).
> - `docs/SDK_SUBSCRIPTION_DESIGN.md` — subscription management + full-rebalance orchestration.
>
> **Every commit that touches ANY of these surfaces MUST update the relevant doc(s) in the SAME commit:**
>
> - **SDK component passthrough** (`AqSdkComponentOverrides` in `AqSdkProvider.tsx` / `AqSdkScope.dart`, `ExecuteAdviceOverlay.tsx`, `SellAuthGate.tsx`, any SDK widget that resolves from `useSdkComponents()`): update `SDK_DESIGN_PASSTHROUGH.md` § 9 slot table + props contract.
> - **SDK client methods** (any public method on `AqSdkClient.ts` / `aq_sdk_client.dart`): update `SDK_INTEGRATION_GUIDE.md` § 3 API Reference table + `SDK_ORCHESTRATION_CONTRACT.md` if contract-affecting.
> - **SDK backend routes** (`Routes/sdk/v1/*`): update `SDK_INTEGRATION_GUIDE.md` § 3 + route JSDoc.
> - **Design-system surfaces** (`designs/<variant>/`, `src/design/`, container/presentation splits, `DesignProvider`, registry): update `DESIGN_SYSTEM_ARCHITECTURE.md` + `DESIGN_COMPONENT_AUDIT.md` + `DESIGN_MIGRATION_PROGRESS.md` per the existing design-system blocking rule below.
> - **`designs/<variant>/sdk/` folder** (SDK widget overrides in the design system): update `SDK_DESIGN_PASSTHROUGH.md` § 9 + `VARIANT_CREATION_GUIDE.md` § 4.
> - **Subscription / rebalance / modifyInvestment**: update `SDK_SUBSCRIPTION_DESIGN.md`.
> - **Mint server scopes / auth flow**: update `SDK_INTEGRATION_GUIDE.md` § 10-11.
> - **Feature flags** (`REACT_APP_USE_SDK_*`, `USE_SDK_*`): update `SDK_INTEGRATION_GUIDE.md` § 12.
> - **Trading cost model** (`tradingCosts.ts`): update `SDK_INTEGRATION_GUIDE.md` § 14.
> - **Cross-platform parity** (RN method exists but Flutter doesn't, or vice versa): update `SDK_INTEGRATION_GUIDE.md` § 16 divergences table.
>
> **Undocumented SDK deltas block the next SDK delta** — same rule as Phase 3, sell-auth, and the design-system migration. An SDK change that ships without its doc update is tech debt that must be repaid before the next change.

## Project Overview

This is the **AlphaQuark B2B Mobile App** — a React Native application enabling advisory clients to connect stock brokers, receive trade recommendations, subscribe to model portfolios, and execute rebalance trades. It is the mobile counterpart to the web app at `../prod-alphaquark-github`.

## Architecture Documentation — MANDATORY (ABSOLUTE BLOCKER)

> **🔴 BLOCKING REQUIREMENT — NO EXCEPTIONS 🔴**
>
> Every code change that affects runtime behavior MUST ship with:
>
> 1. **An update to the relevant architecture `.md` file's content sections** (not just a changelog row — actual content describing current system state).
> 2. **A new `docs/CHANGELOG.md` entry** dated today, tagged with a short descriptive label, listing every file touched and the "why" of the change.
> 3. **A backend doc / server-side doc update** if the change touches ccxt-india, aq_backend_github, or any tidi-hosted service — even if the backend change was uploaded via scp (i.e. outside this repo), the docs here must still call it out so the repo is self-describing.
>
> If a change slipped in without docs, the NEXT code change by anyone (including you) MUST pause and retrospectively document the prior undocumented change before proceeding. An undocumented delta is treated as tech debt that blocks the next delta.
>
> **This applies to**: trade flow, rebalancing, broker connection, model portfolio, recommendation logic, scripmaster lookup, market-order protection, symbol resolution, LTP fetching, env vars, AndroidManifest, broker SDKs, WebView flows, Metro config, Gradle config, broker-specific API routes on ccxt-india, broker-specific MongoDB writes on aq_backend_github, and the tidi_new Flutter app when cross-synced.
>
> **Rationale**: this codebase has had multiple silent regressions traced to under-documented fan-out changes (`.env` var repurposed across 8 brokers; scripmaster schema collision affecting INFY; `convertSymbolsToZerodha` broken since day one with no callers because it was silently returning `{}`). Every one of those would have been caught at review if the committer had been forced to write down what they changed and which surfaces it touched. The documentation requirement is not bureaucracy — it's the regression-prevention contract.
>
> **Cross-repo sync**: This app shares backend APIs with `../prod-alphaquark-github` (web frontend) and the Flutter app at `../tidi_new/tidistockmobileapp`. When a backend change is made that affects multiple clients, ALL affected repos' architecture docs must be updated in the same commit cycle. When porting a fix from one repo to another, update the receiving repo's docs to describe the ported behavior — the copy in the source repo isn't enough because the target repo's docs are what future contributors to that repo will read.

### Every session's checklist before ending work

Run this mental pass at the end of a coding session:

- [ ] Have I updated `docs/CHANGELOG.md` with an entry covering what I shipped today?
- [ ] Have I updated the relevant architecture `.md` file's content (BROKER_CONNECTION.md for broker work, MODEL_PORTFOLIO.md for MP work, REBALANCING.md for rebalance flows, APP_ARCHITECTURE.md for anything system-level)?
- [ ] If I touched ccxt-india / aq_backend_github / scripmaster DB on tidi, did I document that here too (file paths on tidi, what was patched, why)?
- [ ] If I added a new file (hook, utility), did I describe it in the architecture doc AND add a header docstring that references the doc?
- [ ] If I changed the tidi_new Flutter app in parallel, did I update its `docs/BROKER_TRADING_ARCHITECTURE.md` as well?
- [ ] **If I touched Phase 3 surfaces** (`Phase3SdkBrokerModal.js`, `ModalManager.js` SDK_ELIGIBLE_MODALS / SDK_LEGACY_FALLBACK / re-auth bypass, `REACT_APP_USE_SDK_BROKER_FLOW`, SDK widgets in `../alphaquark-mobile-sdk/packages/rn/src/components/`, `aq_backend_github/Routes/sdk/v1/connections.js`), did I update **all three** of `docs/PHASE3_ARCHITECTURE.md`, `docs/PHASE3_BROKER_AUDIT.md` (relevant broker rows + verdicts), and `docs/PHASE3_PROGRESS.md` (work log entry) in the SAME commit?
- [ ] **If I touched design-system surfaces** (`designs/<variant>/`, `src/design/`, the `DesignProvider` registry, a container/presentation split in `src/screens/` or `src/components/`, `src/theme/` extensions for the token bundle, or an audit-task pass), did I update **all three** of `docs/DESIGN_SYSTEM_ARCHITECTURE.md`, `docs/DESIGN_COMPONENT_AUDIT.md` (relevant rows + verdicts), and `docs/DESIGN_MIGRATION_PROGRESS.md` (work log entry) in the SAME commit? **MP surfaces are in scope** as of 2026-05-01 — verdict by data deps, not by MP-coupling. Only `SDK-bound-skip` (Phase 3 lane) surfaces are off-limits.

If ANY box is unchecked, the session's work is not done.

## Shared env vars across brokers — BLOCKING GUARDRAIL

> **NEVER modify a broker-related env var (`.env`) without running the audit below.** A single env-var change can silently break multiple broker OAuth flows and publisher-basket WebViews simultaneously. **This has happened — commit `f9f5d0f` (Groww App Links) repurposed `REACT_APP_BROKER_CONNECT_REDIRECT_URL` from `https://prod.alphaquark.in/stock-recommendation` → `https://app-links.alphaquark.in/broker-callback` and silently broke Zerodha's publisher basket on prod, and OAuth for 8 brokers × 10 tenants that had no backend override.** See `docs/BROKER_CONNECTION.md § Per-broker redirect URL reference`.

### Before touching ANY of these env vars

`REACT_APP_BROKER_CONNECT_REDIRECT_URL`, `REACT_APP_ZERODHA_API_KEY`, `REACT_APP_ANGEL_ONE_API_KEY`, `REACT_APP_HEADER_NAME`, `REACT_APP_ADVISOR_TAG`, `REACT_APP_DEEP_LINK_SCHEME`, any other `REACT_APP_*` var consumed by `brokerPublisher.js` / `brokerAuth.js` / `brokerSupport.js` / any `src/components/BrokerConnectionModal/*.js` / any `src/UIComponents/BrokerConnectionUI/*.js` — do ALL of these first:

1. **Grep every consumer** before editing:
   ```
   grep -rn "REACT_APP_<VAR_NAME>\|<nested.camelCase>" src --include='*.js' | grep -v __tests__ | grep -v __mocks__
   ```
   If you count more than one broker's flow in the output, the change is a **fan-out change** that affects all of them.
2. **Check `docs/BROKER_CONNECTION.md § Per-broker redirect URL reference`** — every consumer of the shared var is enumerated there with file:line, dev-portal registration requirement, and per-broker implications. If your change would break any row in that table, STOP.
3. **Check backend overrides** — many env vars are per-tenant overridable via `appadvisors.<camelCaseField>` in the backend DB (resolved in `src/context/ConfigContext.js`). A `.env` change is a no-op for tenants with a backend override but production-breaking for those without. Run the audit script in `docs/BROKER_CONNECTION.md § audit-script` to list which tenants currently have/don't have each override.
4. **Prefer a backend-per-tenant override to a `.env` change** — `.env` is the *last-resort fallback*, not the knob for per-tenant customization. If the change only applies to one tenant, update `appadvisors.<field>` in that tenant's backend doc instead of `.env`.
5. **Prefer a new purpose-specific var over repurposing a shared one** — if the new behavior is for ONE broker (e.g. Groww App Links), add a new var like `REACT_APP_GROWW_APP_LINKS_CALLBACK_URL` or hardcode in `AndroidManifest.xml` / `brokerRegistry.js`. Do not repurpose a var that other brokers read.
6. **Every broker dev-portal redirect-URL registration is independent** — if your change requires users to re-register a URL in the broker's dev portal (Zerodha, Upstox, Fyers, ICICI, HDFC, Motilal), that's a production migration, not a code change. Coordinate with support/ops before merging.

### If you must change a shared env var anyway

- Update `docs/BROKER_CONNECTION.md § Per-broker redirect URL reference` in the SAME commit, recording what the new value implies for every broker in the table.
- Update the in-code comment on the `.env` line explaining why and referencing the doc section.
- Add a `CHANGELOG.md` entry tagged "ENV-VAR CHANGE — CROSS-BROKER IMPACT" so it's searchable later.

## Phase 3 SDK Broker Migration — BLOCKING DOCUMENTATION REQUIREMENT

> **🔴 BLOCKING REQUIREMENT — NO EXCEPTIONS 🔴**
>
> The Phase 3 migration replaces per-broker legacy modals (`src/components/BrokerConnectionModal/*`) with SDK widgets from `@alphaquark/mobile-sdk` (`BrokerCredentialForm`, `WebViewBrokerAuthFlow`, `Phase3SdkBrokerModal`). It is gated behind `REACT_APP_USE_SDK_BROKER_FLOW` and a per-broker `SDK_ELIGIBLE_MODALS` allowlist in `src/GlobalUIModals/ModalManager.js`.
>
> **Phase 3 has caused production-visible regressions** (Axis broker_login_url_failed, AliceBlue showing the wrong UX, Zerodha 302 intercept loss on Android, Angel One per-customer SmartAPI rejection, re-auth flow misrouted). Root cause in every case: SDK widget shipped before the legacy modal's UX surface was actually mapped. The fix is documentation-first.
>
> **Any change that touches Phase 3 surfaces MUST update all three docs in the SAME commit, BEFORE the code change is considered complete:**
>
> 1. **`docs/PHASE3_ARCHITECTURE.md`** — design source-of-truth. Routing rules in `ModalManager.js`, the SDK_ELIGIBLE_MODALS allowlist, the SDK_LEGACY_FALLBACK set, the re-auth bypass, the `useSharedAngelOneKey` toggle semantics, the `Phase3SdkBrokerModal` component contract, the `EgressIpCallout` placement rules, the SDK widget API surface (`BrokerCredentialForm`, `WebViewBrokerAuthFlow`), and the SDK ↔ backend route mapping (`/sdk/v1/connections/:broker/{login-url,exchange-token,update-credentials}`). When the design changes, update this doc first; when the code changes to match, the doc was already correct.
>
> 2. **`docs/PHASE3_BROKER_AUDIT.md`** — per-broker legacy → SDK comparison matrix. One row per supported broker (Zerodha, Angel One, Upstox, ICICI Direct, Kotak, Dhan, Fyers, IIFL Securities, AliceBlue, Motilal Oswal, HDFC Securities, Groww, Axis Securities). Each row documents: legacy modal file, legacy submit endpoint, legacy response handling, legacy reauth handling, legacy IP-whitelist callout, legacy broker-specific quirks, the SDK gap analysis vs that legacy behavior, and a verdict — **SDK-clean** (move to SDK), **SDK-with-gap** (move only after gap is closed in the SDK package), or **SDK-broken** (must stay legacy until further notice). The `SDK_ELIGIBLE_MODALS` allowlist in `ModalManager.js` MUST be derived from this doc, not the other way around.
>
> 3. **`docs/PHASE3_PROGRESS.md`** — chronological work log. Every Phase 3 commit gets an entry: date, commit subject, broker(s) affected, files touched, verdict change ("Kotak: SDK-with-gap → SDK-clean — IP-whitelist callout shipped in EgressIpCallout, callback path verified end-to-end on emulator"), regressions observed, rollback decisions. This is what a future contributor reads to understand WHY a broker is in or out of the allowlist on a given commit.
>
> **The blocking rules:**
>
> - **Adding a broker to `SDK_ELIGIBLE_MODALS`** requires its row in `PHASE3_BROKER_AUDIT.md` to read verdict = SDK-clean, with the gap analysis row showing every legacy surface mapped to a working SDK equivalent. No "we'll fix it later" merges. If verdict is SDK-with-gap or SDK-broken, the broker stays out of the allowlist.
> - **Removing a broker from `SDK_ELIGIBLE_MODALS` (rollback)** requires updating its row's verdict and adding a `PHASE3_PROGRESS.md` entry explaining what regressed and why legacy is now the right path.
> - **Editing `Phase3SdkBrokerModal.js`** requires updating `PHASE3_ARCHITECTURE.md § Phase3SdkBrokerModal contract` if the change affects the component's props, layout, IP-callout logic, or close behavior. Cosmetic-only changes (colors, spacing) still need a `PHASE3_PROGRESS.md` entry.
> - **Editing the SDK widgets in `../alphaquark-mobile-sdk/packages/rn/src/components/`** that affect Phase 3 brokers (`BrokerCredentialForm`, `WebViewBrokerAuthFlow`, `brokerFormSchema`) requires the SAME-commit update to `PHASE3_ARCHITECTURE.md § SDK widget contract` AND every audit row in `PHASE3_BROKER_AUDIT.md` whose gap analysis depended on the changed behavior — re-evaluate verdict.
> - **Adding a Phase 3 backend route on `aq_backend_github`** (`Routes/sdk/v1/connections.js`) requires `PHASE3_ARCHITECTURE.md § Backend routes` to be updated with the route, request/response shape, auth model (SecurityTokenManager JWT vs raw key), and which legacy ccxt endpoint it proxies. Backend was uploaded via scp — that is NOT a substitute for documenting it here.
> - **Re-auth path changes** (`reauthConfig` plumbing in `ManageConnectionsModal` / `ModalManager` / per-broker modals) MUST be documented in `PHASE3_ARCHITECTURE.md § Re-auth flow`. Re-auth has its own routing rule (always legacy regardless of flag) and any change to that rule is a fan-out change across all 13 brokers.
>
> **Rationale**: every Phase 3 regression so far traces to a code change that shipped without first writing down what the legacy modal actually did. The Axis SSO endpoint was never proxied because no one wrote down that legacy Axis hits a non-standard endpoint. AliceBlue's partner-OAuth was never modeled because no one wrote down that AliceBlue legacy doesn't show a credential form. Zerodha's Android 302 issue was never caught because no one wrote down that legacy Zerodha uses an Android-specific intercept. Documentation-first turns Phase 3 from "ship and discover regressions" into "discover gaps in the audit doc, then ship".
>
> **If a Phase 3 change slipped in without these doc updates**, the next Phase 3 change MUST pause and retrospectively complete the audit + architecture + progress entries for the prior commit before proceeding. Same rule as the top-level architecture blocker — undocumented Phase 3 deltas are tech debt that block the next delta.

## Design System Migration — BLOCKING DOCUMENTATION REQUIREMENT

> **🔴 BLOCKING REQUIREMENT — NO EXCEPTIONS 🔴**
>
> The design-system migration introduces a layered, swappable UI under `designs/<variant>/` (tokens → primitives → composites → screens) so tenants can bring their own UI without forking the app. It is gated by `DESIGN_VARIANT` (falls back to `APP_VARIANT`, then `default`). SDK-bound surfaces (`Phase3SdkBrokerModal`, all SDK widgets, all legacy `BrokerConnectionModal/*` and `UIComponents/BrokerConnectionUI/*`) are NEVER in `designs/` — Phase 3 owns them.
>
> **Any change that touches design-system surfaces MUST update all three docs in the SAME commit, BEFORE the code change is considered complete:**
>
> 1. **`docs/DESIGN_SYSTEM_ARCHITECTURE.md`** — design source of truth. The 4-layer model, the `DesignProvider` registry contract, variant resolution, fallback rules, the SDK boundary, the container/presentation split rule, the Model Portfolio `SDK-pending` freeze rule, the migration phases A–I, and what's explicitly NOT in scope. When the design changes, update this doc first.
>
> 2. **`docs/DESIGN_COMPONENT_AUDIT.md`** — per-surface verdict matrix. One row per UI surface (every screen, modal, composite, primitive). Verdicts: `clean-extract` / `needs-logic-extraction` / `SDK-bound-skip` / `SDK-pending` / `defer`. Adding a surface to `designs/default/` requires its row to read `clean-extract` or completed-`needs-logic-extraction` here. The migration order is derived from this table, not the other way around.
>
> 3. **`docs/DESIGN_MIGRATION_PROGRESS.md`** — chronological work log. Every commit that touches design-system surfaces gets an entry: date, phase, surfaces touched, verdict changes, what shipped, regressions/rollbacks, what's next.
>
> **The blocking rules:**
>
> - **Adding a surface to `designs/default/`** requires its row in `DESIGN_COMPONENT_AUDIT.md` to read verdict = `clean-extract` or `needs-logic-extraction` (with the proposed viewModel shape documented). No migration without a row.
> - **Model Portfolio / rebalance surfaces ARE in scope** (policy decision 2026-05-01 — supersedes the earlier SDK-pending freeze). They get migrated alongside everything else, with verdicts based on actual data deps. **Be aware**: there is a non-trivial chance MP migrates to the SDK widget tree later (alongside broker-connect under the Phase 3 contract); when that happens, the design-system work on those surfaces is partially or fully thrown away. The product decision is to accept that risk in exchange for a consistent, fully-tenant-skinnable app today rather than a two-tier UX where MP screens look different. If/when the SDK MP plan firms up, affected rows in `DESIGN_COMPONENT_AUDIT.md` flip to verdict = `SDK-pending` and the migration unwinds for those surfaces.
> - **Editing the `DesignProvider` registry contract** (resolution rules, variant selection, fallback semantics) requires updating `DESIGN_SYSTEM_ARCHITECTURE.md § Registry` in the SAME commit.
> - **Adding a primitive to the catalog** requires updating `DESIGN_SYSTEM_ARCHITECTURE.md § Primitives` AND `DESIGN_COMPONENT_AUDIT.md § Section 1` in the SAME commit.
> - **Touching SDK-bound surfaces from a design-system commit** is NOT ALLOWED — those go through the Phase 3 contract (`PHASE3_*.md`), not the design-system trio. Only the visual chrome around an SDK widget (modal backdrop, header bar) MAY be themed via primitives, but the SDK form rendering itself stays SDK-owned.
>
> **Rationale**: this is a fan-out refactor across 80+ UI surfaces. Every Phase 3 regression traced to code shipping before the legacy UX surface was mapped — same risk here, multiplied. Documentation-first turns this from "ship and discover what you broke in tenant N's screen" into "discover gaps in the audit doc, then ship". Same pattern that worked for Phase 3.

All architecture docs are in the `docs/` folder:

| Document | Purpose |
|----------|---------|
| [APP_ARCHITECTURE.md](docs/APP_ARCHITECTURE.md) | System architecture, broker flows, trade execution, state management |
| [BROKER_CONNECTION.md](docs/BROKER_CONNECTION.md) | Per-broker auth details, WebView OAuth, credential flows |
| [REBALANCING.md](docs/REBALANCING.md) | Rebalancing flow, decryption, broker payload building |
| [MODEL_PORTFOLIO.md](docs/MODEL_PORTFOLIO.md) | Model portfolio subscription, basket execution, review trade flow |
| [PHASE3_ARCHITECTURE.md](docs/PHASE3_ARCHITECTURE.md) | Phase 3 SDK migration design — routing, allowlist, re-auth, SDK widget contract, backend routes |
| [PHASE3_BROKER_AUDIT.md](docs/PHASE3_BROKER_AUDIT.md) | Per-broker legacy → SDK comparison matrix with verdicts (SDK-clean / SDK-with-gap / SDK-broken) |
| [PHASE3_PROGRESS.md](docs/PHASE3_PROGRESS.md) | Phase 3 chronological work log — commits, broker verdict changes, regressions, rollbacks |
| [DESIGN_SYSTEM_ARCHITECTURE.md](docs/DESIGN_SYSTEM_ARCHITECTURE.md) | Design-system migration design — 4-layer model, `DesignProvider` registry, container/presentation split, SDK boundary, MP-freeze rule |
| [DESIGN_COMPONENT_AUDIT.md](docs/DESIGN_COMPONENT_AUDIT.md) | Per-surface verdict matrix (clean-extract / needs-logic-extraction / SDK-bound-skip / SDK-pending / defer) |
| [DESIGN_MIGRATION_PROGRESS.md](docs/DESIGN_MIGRATION_PROGRESS.md) | Design-system chronological work log — phases, surfaces touched, verdict changes |
| [BROKER_FLOW_AUDIT.md](docs/BROKER_FLOW_AUDIT.md) | Per-broker deep flow walkthrough — legacy vs SDK side-by-side with file:line references for every API call, WebView intercept, encryption envelope, IP-callout, reauth handling. Source of truth for any per-broker SDK migration step. |
| [CHANGELOG.md](docs/CHANGELOG.md) | All changes, fixes, and updates with dates |

### When to update these docs

1. **APP_ARCHITECTURE.md** — update when changing:
   - `src/screens/TradeContext.js` (core context, state management)
   - `src/components/AdviceScreenComponents/StockAdvices.js` (bespoke trade flow)
   - `src/components/AdviceScreenComponents/DummyBrokerHoldingConfirmation.js`
   - `src/screens/Home/HomeScreen.js`, `src/screens/Home/OrderScreen.js`
   - `src/utils/basketUtils.js`, `src/utils/portfolioEvents.js`
   - Any new screen, context, or global state change

2. **MODEL_PORTFOLIO.md** — update when changing:
   - `src/UIComponents/RebalanceAdvicesUI/RebalanceCard.js`
   - `src/components/AdviceScreenComponents/RebalanceAdvices.js`
   - `src/components/ModelPortfolioComponents/` (any file)
   - `src/screens/PortfolioScreen/ModelPFCard.js`
   - `src/screens/Drawer/MPPerformanceScreen.js`

3. **REBALANCING.md** — update when changing:
   - `src/components/AdviceScreenComponents/RebalanceModal.js`
   - `src/components/AdviceScreenComponents/RebalanceAdviceContent.js`
   - `src/components/ModelPortfolioComponents/MPReviewTradeModal.js`
   - Rebalance calculation, execution, or status logic

4. **BROKER_CONNECTION.md** — update when changing:
   - `src/components/BrokerConnectionModal/` (any broker modal)
   - `src/components/BrokerSelectionModal.js`
   - `src/components/DdpiModal.js` (EDIS/TPIN)
   - `src/components/TokenExpireBrokerModal.js`

5. **PHASE3_ARCHITECTURE.md** — update when changing:
   - `src/GlobalUIModals/ModalManager.js` (SDK_ELIGIBLE_MODALS, SDK_LEGACY_FALLBACK, re-auth bypass, `useSdkBrokerFlow`, `useSharedAngelOneKey`)
   - `src/components/BrokerConnectionModal/Phase3SdkBrokerModal.js` (any prop, layout, IP-callout, close-button change)
   - `.env` lines `REACT_APP_USE_SDK_BROKER_FLOW`, `REACT_APP_USE_SHARED_ANGEL_ONE_KEY`, `REACT_APP_SDK_*`
   - `../alphaquark-mobile-sdk/packages/rn/src/components/` widgets when the change affects Phase 3 brokers (`BrokerCredentialForm`, `WebViewBrokerAuthFlow`, `brokerFormSchema`)
   - `../aq_backend_github/Routes/sdk/v1/connections.js` (any route shape, auth model, or broker dispatch change)
   - Re-auth plumbing in `ManageConnectionsModal` and per-broker modals consuming `reauthConfig`

6. **PHASE3_BROKER_AUDIT.md** — update when changing:
   - Anything in #5 that alters a broker's verdict (SDK-clean / SDK-with-gap / SDK-broken)
   - Adding or removing a broker from `SDK_ELIGIBLE_MODALS` or `SDK_LEGACY_FALLBACK`
   - Discovering a new gap between legacy modal UX and the SDK widget for any of the 13 brokers
   - Closing a previously documented gap (verdict promotion)
   - Backend route additions that change which legacy ccxt endpoint a broker proxies through

7. **PHASE3_PROGRESS.md** — update when changing:
   - Any commit that touches Phase 3 surfaces — one entry per commit with date, broker(s) affected, files touched, verdict changes, regressions observed, rollback decisions
   - Production-visible regressions traced to Phase 3 (with the legacy-vs-SDK divergence root cause)
   - Per-broker QA evidence (emulator screenshots, end-to-end flow verification)

8. **DESIGN_SYSTEM_ARCHITECTURE.md** — update when changing:
   - The `DesignProvider` registry contract (resolution order, variant selection, fallback semantics) once it lands at `src/design/DesignProvider.js`
   - The primitive catalog (adding/removing a primitive in `designs/<variant>/primitives/`)
   - The container/presentation split rule, the SDK boundary, or the Model Portfolio `SDK-pending` freeze rule
   - Token-bundle shape (`designs/<variant>/tokens/`) — adding/removing a token group
   - Variant selection precedence (`DESIGN_VARIANT` / `APP_VARIANT` / fallback)
   - Migration phase definitions (A–I)
   - `src/theme/` extensions that flow into the token bundle (spacing/typography/radii additions)

9. **DESIGN_COMPONENT_AUDIT.md** — update when changing:
   - Adding/removing a row (every UI surface in scope)
   - A row's verdict (e.g. `needs-logic-extraction` → migrated, or lifting an `SDK-pending` freeze)
   - The proposed viewModel shape for a `needs-logic-extraction` row
   - Closing one of the open audit tasks (Section 8) — that task's TBD rows get filled in
   - A surface's classification (primitive / composite / screen / modal / container)

10. **DESIGN_MIGRATION_PROGRESS.md** — update when changing:
    - Any commit that touches design-system surfaces (`designs/<variant>/`, `src/design/`, container splits in `src/screens/` / `src/components/`, `src/theme/` extensions, audit-task PRs)
    - One entry per commit with date, phase, surfaces touched, verdict changes, what shipped, regressions/rollbacks, next
    - MP-freeze reassessments when the SDK MP plan moves either direction

## Key Directories

```
src/
├── components/
│   ├── AdviceScreenComponents/   # Trade advices, rebalancing UI (21 files)
│   ├── BrokerConnectionModal/    # Per-broker auth modals (15 files)
│   ├── ModelPortfolioComponents/ # MP subscription, review trade (15 files)
│   ├── HomeScreenComponents/    # Home screen widgets, Knowledge Hub
│   ├── CustomHomeTabs/          # Custom tab components
│   ├── Navigation.js            # React Navigation setup (Stack/Tab/Drawer)
│   ├── AppProvider.js           # Global context providers wrapper
│   └── ReviewTradeModal.js      # Trade review modal
├── screens/
│   ├── Authentication/          # Login, Signup, Reset Password, RA Details (8 files)
│   ├── Home/                    # HomeScreen, OrderScreen, Watchlist, Advice (31 files)
│   ├── PortfolioScreen/         # Portfolio holdings view (6 files)
│   ├── Drawer/                  # Model Portfolio, MP Performance, Settings (19 files)
│   ├── AccountSettingScreen/    # Account settings
│   └── TradeContext.js          # CORE CONTEXT — 1456 lines, 40+ exports
├── context/
│   ├── ConfigContext.js         # App config from API + static variants
│   ├── MultiBrokerContext.js    # Multi-broker state management
│   ├── MarketDataContext.js     # Real-time prices via WebSocket
│   └── GstConfigContext.js      # GST configuration
├── utils/                       # 42 utility files
│   ├── rebalanceHelpers.js      # Rebalance logic, broker payload, decryption
│   ├── rebalanceDiffUtils.js    # Portfolio diff computation (buy/sell/hold)
│   ├── brokerAuth.js            # OAuth state, callback registration
│   ├── brokerSupport.js         # Per-broker feature matrix (GTT, OCO, etc.)
│   ├── brokerPublisher.js       # Kite/Fyers publisher SDK integration
│   ├── brokerSessionUtils.js    # Token expiry validation
│   ├── ProcessTrades.js         # Trade execution across all brokers
│   ├── SecurityTokenManager.js  # AQ encrypted key generation (JWT, 15s expiry)
│   ├── Config.js                # Static app variant definitions
│   ├── safeConfig.js            # Environment variable wrapper
│   ├── storageUtils.js          # AsyncStorage wrappers
│   ├── portfolioEvents.js       # EventEmitter for cross-component communication
│   ├── formatCurrency.js        # INR currency formatting
│   ├── symbolNormalizer.js      # Cross-broker symbol normalization
│   ├── orderStatusUtils.js      # Order status mapping
│   └── marketDataLTP.js         # Angel One LTP helpers
├── FunctionCall/                # API call functions
│   ├── fetchFunds.js            # Broker cash balance
│   ├── fetchBrokerAllHoldings.js    # Multi-broker aggregated holdings
│   ├── fetchBrokerSpecificHoldings.js # Single broker holdings
│   ├── PaymentHandle.js         # Razorpay/Cashfree/PayU
│   └── useWebSocketCurrentPrice.js  # Real-time price hook
├── services/
│   ├── BrokerOrderBookAPI.js    # Unified order book for all brokers
│   ├── ModelPortfolioService.js # MP backend operations (15+ functions)
│   ├── OrderService.js          # Order management
│   ├── ZerodhaOAuthService.js   # Zerodha OAuth
│   ├── ReconciliationService.js # Trade reconciliation
│   └── GstConfigService.js      # GST config
├── hooks/
│   ├── useMultiBrokerHoldings.js # Multi-broker data aggregation
│   └── useSymbolSearch.js        # Symbol search
├── GlobalUIModals/              # Global modal management (Zustand store)
├── UIComponents/                # Reusable UI components
└── assets/                      # Images, fonts, logos
```

## Core Contexts

| Context | File | Purpose |
|---------|------|---------|
| TradeContext | `screens/TradeContext.js` | Core trading state — 40+ exports, all trades/orders/holdings/funds |
| ConfigContext | `context/ConfigContext.js` | Branding & features from backend API |
| MultiBrokerContext | `context/MultiBrokerContext.js` | Multi-broker portfolio aggregation |
| MarketDataContext | `context/MarketDataContext.js` | Real-time prices via WebSocket |

## Server Endpoints

| Server | URL | Purpose |
|--------|-----|---------|
| API Server | `https://server.alphaquark.in/` | Business logic, user management |
| CCXT Server | `https://ccxtprod.alphaquark.in/` | Broker APIs, order execution |
| WebSocket | `https://ccxtprod.alphaquark.in/` | Real-time price feeds |

## Supported Brokers (14)

Zerodha, Angel One, Upstox, ICICI Direct, Kotak, Dhan, Fyers, IIFL Securities, AliceBlue, Motilal Oswal, Hdfc Securities, Groww, Axis Securities, DummyBroker (simulation)

## Build & Run

```bash
# Install dependencies
cd /Users/pratik/PycharmProjects/Alphab2bapp && npm install

# Start Metro bundler
npx react-native start

# Run on Android emulator (separate terminal)
cd android && ./gradlew app:installDebug -PreactNativeDevServerPort=8081

# Launch on device
adb shell monkey -p com.arpint.alphaquark -c android.intent.category.LAUNCHER 1
```

## Important Notes

- **Java version**: gradle.properties must point to the correct Java 17 path (check `/usr/local/Cellar/openjdk@17/` for actual version)
- **New Architecture**: `newArchEnabled=true` is required (react-native-reanimated dependency)
- **App variant**: Set via `APP_VARIANT` in `.env` — must have a matching entry in `src/utils/Config.js`
- **Shared backend**: Same Node.js (`aq_backend_github`) and Python (`ccxt-india`) as the web app
- **Broker WebViews**: OAuth brokers use in-app WebView for auth, not deep linking. Redirect URLs may differ between web and mobile.

## Relationship to Web App (prod-alphaquark-github)

The web app is at `../prod-alphaquark-github`. Both share:
- Same backend APIs (server.alphaquark.in, ccxtprod.alphaquark.in)
- Same `rebalanceHelpers.js` functions (buildBrokerPayloadFields, decryption)
- Same `brokerSupport.js` feature matrix
- Same `MultiBrokerContext` state shape

Key differences:
- Web uses `react-hot-toast`, mobile uses `react-native-toast-message`
- Web uses `window.location` for OAuth, mobile uses WebView with URL interception
- Web has `AppConfigContext`, mobile has `ConfigContext` (similar but different implementation)
- Some broker auth flows require WebView-specific handling on mobile
