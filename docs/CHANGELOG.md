# Changelog

All notable changes to the AlphaQuark B2B Mobile App are documented here.

---

## [unreleased] - 2026-05-06

### Fixed — MPReviewTradeModal: Place Order spinner stuck forever (Axis Securities, Dhan, all brokers)

**Problem.** Clicking "Place Order" in the MP rebalance review modal caused the button to spin indefinitely. No HTTP request was ever sent to the backend (`/rebalance/process-trade`). Confirmed via nginx access logs: zero `okhttp`/React Native requests for that endpoint while the Flutter (tidi) app hit it successfully.

**Root cause.** `placeOrder()` called `setLoading(true)` at line 317, but the `try { }` block only started at line 429 — 112 lines of synchronous setup code (exchange validation, Dhan EDIS pre-check, `computeTradeVariant`, payload/config construction, `enrollStatusCheckQueue` definition) ran entirely outside the try-catch. Any unhandled exception in that setup window → unhandled promise rejection → `setLoading(false)` in the catch was never called → spinner stuck forever. Additionally the edit that moved `try {` left an orphaned plain `{` at line 430 (the old `try {` was changed to `{`), which caused a `SyntaxError: Unexpected token 'catch'` at line 649.

**Fix:**
1. Moved `try {` to immediately after `setLoading(true)` so all setup code and the axios call are inside the try-catch. The catch block's first statement is `setLoading(false)`, which now fires for any exception.
2. Removed the orphaned inner `{` at line 430 (syntax error — `} catch` cannot follow a plain block).
3. Added `latestRebalance?.model_Id` optional chaining (defensive — `latestRebalance` starts as `null` and is populated asynchronously).

**Files changed:**
- `src/components/ModelPortfolioComponents/MPReviewTradeModal.js` — `try {` moved to line 319 (was 429), orphaned `{` removed, optional chaining on `latestRebalance?.model_Id`

---

## [unreleased] - 2026-05-04

### Fixed — Kotak connection: NeoFinKey + encrypted MPIN (backend-only)

**Problem.** Kotak connect failed with 3 different NeoFinKey errors across 4 iterations, then finally with "Invalid field 'Mpin'; must contain only numbers" on the validate step.

**Root causes (two independent bugs):**

1. **NeoFinKey header value** — our code overrode the correct literal `"neotradeapi"` with a long alphanumeric key `"X6Nk8cQhUgGmJ2vBdWw4sfzrz4L5En"` from the old Kotak NEO Python SDK. Kotak changed their API validation to reject that key. Fix: use `"neotradeapi"` (per Kotak's own Notion docs). ccxt-india `brokers/kotak/kotak.py`.

2. **MPIN sent encrypted** — SDK form has `encrypt: true` on the MPIN field, so the value arrives as an AES blob. `Routes/Broker/Kotak.js` was passing it raw to ccxt, which then sent the encrypted blob to Kotak's `/tradeApiValidate` → "must contain only numbers". Fix: decrypt via `checkValidApiAnSecret(data.mpin)` before forwarding, same as `data.apiKey`.

**Files changed:**
- `ccxt-india/brokers/kotak/kotak.py` — `neo_fin_key` no longer overridden; always uses `"neotradeapi"`
- `aq_backend_github/Routes/Broker/Kotak.js` — MPIN decrypted before forwarding

### Fixed — Broker connect 500s: Angel One, Axis Securities, IIFL, Kotak catch-all (backend-only)

**Problem.** `broker_persist_failed (HTTP 500)` on Angel One, Axis, IIFL, and any broker hitting the catch-all else block in `userRoutes.js` connect-broker.

**Root cause.** The sell-auth-preserve fix (2026-05-02) sed-replaced `ddpi_enabled: false, is_authorized_for_sell: false` across ALL 14 broker blocks to reference `currentUser?.is_authorized_for_sell`. But only 8 of 14 blocks declared `const currentUser = userData[0]`. The other 6 hit `ReferenceError: currentUser is not defined` → 500.

**Fix:** `aq_backend_github/Routes/userRoutes.js` — inserted `const currentUser = userData[0]` in the 4 blocks that were missing it (IIFL, Axis, Kotak second-path, catch-all).

### Fixed — Rebalance-pending: 3-tier execution matching across 4 files (Alphab2bapp)

**Problem.** "No rebalance pending" shown on vansh/Core Equity portfolio cards even after rebalance was published and subscriberExecutions populated.

**Root cause (3 layers):**

1. **subscriberExecutions empty on publish** — rebalance push didn't pre-populate entries for subscribed users. Fixed in ccxt-india `app_model_portfolio.py` — now builds entries from `subscribed_by` with `status: toExecute` + `user_broker` from users collection.

2. **Single-match find()** — `HomeScreen.js`, `RebalanceAdvices.js`, `RebalanceAdviceContent.js` all had `subscriberExecutions.find(e => e.user_email === email && (!broker || e.user_broker === broker))`. When user switched brokers, the entry (tagged with old broker) didn't match → `undefined` → "No rebalance pending". Fixed with 3-tier fallback (Tier 1: exact broker, Tier 2: DummyBroker, Tier 3: any email — with executed-on-other-broker → toExecute synthesis).

3. **Tier 3 semantics** — executed on broker A ≠ executed on broker B. Other broker's "executed" → synthesize fresh "toExecute" for current broker.

**Files changed:**
- `src/components/AdviceScreenComponents/RebalanceAdvices.js`
- `src/screens/Home/HomeScreen.js`
- `src/components/AdviceScreenComponents/RebalanceAdviceContent.js` (3 callsites)

### Fixed — Admin-subscribe gap: missing Subscription record (backend-only)

**Problem.** Admin-added clients (via prod.alphaquark.in/admin) were in `model_portfolio.subscribed_by` but invisible to `/subscribed-strategies/:email` (which filters by active Subscription). No Subscription doc was created.

**Root cause.** `ccxt-india/client_adder/usage.py add_or_update_client` had Subscription creation COMMENTED OUT with "being updated by FE". FE never did. Also `handle_subscription_saving` skipped for `manual_addition=True`.

**Fix:** Re-enabled + added `PaymentMethod.MANUAL` enum + plan_id resolution from plans collection (normalized name matching). Edit mode also propagates — `add_payment_history` bumps `Subscription.end_date`.

### Fixed — Websocket reconnect storm + auto-recovery (websocket repo)

**Problem.** AngelOne WebSocket reconnecting every ~30 seconds. Auto-recovery threads never ran (were placed AFTER blocking `connect()` call).

**Fix (5 defense-in-depth layers):**
1. try/finally on reconnect thread (flag always clears)
2. Flag-guard thread (clears stuck `_reconnecting` after 10 min)
3. Token refresh loop (re-auth every 8h)
4. Index-specific freshness clock
5. Year-round two-clock watchdog
Plus: 3-second stabilization delay + subscribe debounce. Helper threads moved BEFORE `connect()`.

### Fixed — AliceBlue market→limit for derivatives (ccxt-india only)

AliceBlue rejects derivative MARKET orders. Added `compute_aliceblue_limit_price(ltp, action, is_derivative)` with 0.3% equity / 1.5% derivative buffer. Scoped to AliceBlue only.

### Fixed — Upstox rate limit: per-order budget (ccxt-india only)

Upstox's multi-order counts per-ORDER not per-call. Fixed: 1 bulk-call per 2 seconds + BULK_ORDER_LIMIT 25→10.

---

## [unreleased] - 2026-05-03

### Design-system Phase I — MPInvestNowModal container/presentation split (5364 LOC)

Largest file in the app migrated to the design system. Container (`src/components/ModelPortfolioComponents/MPInvestNowModal.js`) owns ALL payment gateway SDKs (Razorpay, Cashfree, PayU, Apple IAP, Google Play), ALL payment state/callbacks, ALL API calls, Digio e-signature, subscription creation, coupon validation, and investment amount calculation. Presentation (`designs/default/screens/MPInvestNowModal.js`) renders the 3-step wizard UI, plan cards, coupon input, GST breakdown, consent checkbox, and sub-modal shells. Registered as `screens.MPInvestNowModal` in `designs/default/index.js`. Payment SDKs NEVER touched by presentation.

**Files touched**: `src/components/ModelPortfolioComponents/MPInvestNowModal.js` (rewritten as container), `designs/default/screens/MPInvestNowModal.js` (new presentation), `designs/default/index.js` (registration), `docs/DESIGN_COMPONENT_AUDIT.md` (verdict update), `docs/DESIGN_MIGRATION_PROGRESS.md` (work log entry), `docs/CHANGELOG.md` (this entry).

### Phase C-1 — SdkProviderRoot mintSession scopes extended (orders + gtt)

`src/sdk/SdkProviderRoot.js:88-110` — mintSession request body's `scopes` array extended from 3 entries (`connections:read`, `connections:write`, `portfolios:read`) to 7 entries — added `orders:read`, `orders:write`, `gtt:read`, `gtt:write`. Backend `aq_backend_github/utilities/sessionToken.js:56-64` `ALL_SCOPES` already whitelists all 7 (verified 2026-05-03 from deployed file).

**Why now**: Phase B-1 SDK package shipped `useExecuteTrades` / `useOrderBook` widgets calling `/sdk/v1/orders/place` + `/sdk/v1/orders/:id/status` + `/sdk/v1/orders/book` — but the RN app's mint request was still requesting only the 3 connection-only scopes. Any SDK orders call would have 401'd `scope_missing` once Phase C wires callers. Pass 2 cross-cutting agent surfaced the gap.

**GTT note**: Pass 2 found that `StockAdvices.js:812` and `OrderService.js:91` use a separate `/<broker>/process-trades` (per-broker GTT/SL/SL-M) endpoint distinct from `/orders/process-trade`. `gtt:*` ships forward-compatibly so the Phase C orchestrator can route GTT variants through the SDK without a re-mint.

**NOT added today** (deferred to Phase D):
- `sell_auth:read`, `sell_auth:write`, `funds:read` — backend `ALL_SCOPES` does NOT yet include these. CONTRACT § 10 had claimed otherwise; corrected via this commit's source comment. Phase D adds backend whitelist + extends RN/Flutter mint request in the same commit cycle.

**Plural-vs-singular footnote**: backend uses `portfolio:read` (singular) in `ALL_SCOPES`; RN app requests `portfolios:read` (plural). Mint server appears to tolerate unknown scopes (silent-drop) per production track record. Mismatch should be reconciled in a follow-up — left as-is here to avoid coupling a low-risk additive change with a potentially higher-risk reconciliation.

**Verification**: babel-parses cleanly. Runtime smoke-test pending — won't matter until Phase C wires callers.

### Fixed — UserStrategySubscribeModal pre-order EDIS gate with DDPI-priority semantics (Pass 2 defect #1)

`src/components/ModelPortfolioComponents/UserStrategySubscribeModal.js:218-310` — initial fix extended the pre-existing `edisCheckBrokers` Toast pattern from 8 brokers to all 13. User feedback 2026-05-03 ("if DDPI is enabled, no need for separate sell authorization; for brokers without DDPI endpoint, optimistic placement") prompted a revision applying canonical DDPI-priority semantics from new `docs/SELL_AUTH_ARCHITECTURE.md § 7d`:

- **Zerodha**: pre-block ONLY when `!is_authorized_for_sell && !(ddpi_status in ['physical','ddpi'])`. DDPI active ⇒ proceed.
- **Angel One**: pre-block ONLY when `!ddpi_enabled && !is_authorized_for_sell`. DDPI active ⇒ proceed.
- **Dhan + Fyers**: NO PRE-BLOCK (softened). Optimistic placement; trade reaches broker; any EDIS rejection surfaces via existing placeOrder error path.
- **8 portal-side brokers**: pre-block on `!is_authorized_for_sell` KEPT (pre-existing pattern). Phase D `requireSellAuth` softens to optimistic-then-cascade.

### Fixed — Zerodha/Fyers cross-publisher AsyncStorage cleanup (Pass 2 defect #3)

`src/components/AdviceScreenComponents/RebalanceModal.js` — 4 sites patched for cross-publisher cleanup (Zerodha entry/success + Fyers entry/success now wipe each other's pending state).

### Doc-only — SDK orchestration AUDIT Pass 2 reconciliation (parallel-agent gap-finding)

5 fresh Explore agents ran in parallel, each reading the AUDIT pass-1 claims and verifying against actual code FROM COLD. One agent per area: bespoke flows / MP+sell-auth / connect+reauth / Flutter / cross-cutting VISION+CONTRACT. Same parallel-agent technique that surfaced the 2026-05-02 design-system audit findings.

**Findings folded into `docs/SDK_ORCHESTRATION_AUDIT.md` § Pass 2 — independent verification (2026-05-03)**:

- **~12 doc-vs-code mismatches at AUDIT-detail level** — wrong line refs, wrong file paths, misleading framing. Folded as a corrections table (pass-1 claim → pass-2 verification). Notable: Step 5/6 line refs in § 1, `isReturningFromOtherBrokerModal` is split across bespoke (StockAdvices.js:1114) AND MP (RebalanceModal.js:1789) — Pass 1 conflated them. § 6 reauth claim was misleading: `Phase3SdkBrokerModal` does NOT consume `reauthConfig` prop — pre-fill is via `getStoredBrokerCreds` + `buildSchemaOverride.initialValue`. § 3 EDIS matrix verified accurate for RebalanceModal but missing from MPReviewTradeModal + UserStrategySubscribeModal. AUDIT framed sell-auth modals as 5 separate files; actually all live in ONE 2802-LOC `DdpiModal.js` (with a 6th modal `AfterPlaceOrderDdpiModal` Pass-1 missed entirely).
- **Updated RN ↔ Flutter parity matrix** — RN reached parity on 3 patterns Pass 1 said Flutter was ahead on (mark-expired-before-reauth, smart-reauth orchestration, silent-refresh) via `src/utils/reauthHelpers.js` 2026-04-29. Flutter still ahead on 5 patterns: unified DdpiAuthPage (now confirmed even higher leverage — RN's 5 modals are 1 monolith), async email resolution (no `_schemaOverridePending` flag exists — gating is implicit via SDK's null-userRef handling), JWT-extracted Angel One clientCode fallback (Pass 1 missed), `BrokerSessionService.isSessionFresh()` proactive daily-auth (Pass 1 missed), sealed exception types for basket flows (Pass 1 missed).
- **Newly discovered orchestration detail Pass 1 missed**: GTT/triggered orders use a different endpoint (`/<broker>/process-trades`, not `/orders/process-trade`) — orchestrator must support GTT routing. `AfterPlaceOrderDdpiModal` 6th modal in cascade. Per-broker variance: Kotak `normaliseKotakMobile` transformValue, Fyers field-naming inversion, Zerodha env-seeded apiKey.
- **8 suspected code defects flagged for separate verification** — NOT fixed in this commit. Per the user's "branch off if actual code" rule, these go to a separate branch + per-defect verification + fix. Notable: `UserStrategySubscribeModal` lacks pre-order EDIS gate entirely (3 callsites at lines 454, 690, 1054); `MPReviewTradeModal` has only Dhan + Angel-One-surveillance pre-checks (missing Zerodha/Fyers/Angel-One/special-broker gates that RebalanceModal has — looks like copy-paste-then-partial-refactor); Fyers Publisher SDK in Flutter was disabled 2026-04-25 making `FyersBasketRequiredException` dead code; Zerodha publisher AsyncStorage cleanup missing in Fyers success path; no per-trade idempotency on `/rebalance/process-trade` (only payload-level `unique_id`, vs bespoke's `clientTradeId`); `BrokerConnectionError.js` is dead-code stub; `TokenExpireBrokerModal.js` is parallel re-auth implementation that bypasses `BrokerConnectModalDispatch`.

**Targeted fixes in same commit**:

- `docs/SDK_ORCHESTRATION_VISION.md` § 12 — `RecommendationSuccessModal` LOC corrected 1102 → 1152.
- `docs/SDK_ORCHESTRATION_CONTRACT.md` § 2 — added note that the SDK's UPPERCASE `OrderStatus` enum REPLACES the existing `src/utils/orderStatusUtils.js` lowercase categories. Dual-write soak must accept both enums and normalize before comparing.

**Pass 2 verdict**: doc trio is structurally sound. No design-level errors. ~12 detail-level corrections folded in. 8 suspected code defects flagged for separate branch.

**Next session**: verify the 8 suspected code defects (especially #1 + #2 — `UserStrategySubscribeModal` and `MPReviewTradeModal` missing EDIS gates) on a separate branch. Then proceed to Phase C kickoff per `SDK_ORCHESTRATION_PHASES.md`. First concrete code change: `src/sdk/SdkProviderRoot.js:88-92` mintSession scopes — add `orders:read`, `orders:write` (Phase B-1 backend whitelist already has them; RN app just needs to request them).

**Behavior change in app**: zero. Doc-only commit.

---

## [unreleased] - 2026-05-02

### Doc-only — SDK orchestration migration design trio (Phases C/D/E/F)

Per user-approved decision 2026-05-02 to pause Phase B-2 caller wiring and design the SDK orchestration architecture first — the granular per-callsite wiring would be partially throw-away once the orchestrator pattern lands. This commit lands the design source-of-truth as four mutually-consistent docs.

**Files added** (all under `docs/`):

- `SDK_ORCHESTRATION_VISION.md` (483 lines) — north-star architecture: app calls one SDK method, SDK orchestrates broker session + sell-auth + review + place + poll + result. The "inversion principle": today app drives + SDK is leaf utility; vision: SDK drives + app is host shell. Payments firm OUT of scope (3 reasons: app-store policy, merchant identity per-tenant, bundle weight). Native SDK packages, NOT hosted iframe (WebView UX worse, postMessage bridge fragile, Phase 3 already chose native). Themed widgets retain tenant skinnability via SdkTheme + host hooks. Failure semantics: typed `OrchestrationError` enum, never bare strings, never half-states.
- `SDK_ORCHESTRATION_AUDIT.md` (528 lines) — per-flow code walks for BOTH apps with file:line refs and per-step migration verdicts (`STAY` / `ORCHESTRATOR` / `SDK-WIDGET` / `BACKEND` / `GONE`). 8 flows × 2 apps = 13 audits (bespoke is RN-only). Walks span the 14 RN ccxt-direct callsites, the 5-modal sell-auth cascade, the Zerodha/Fyers publisher state machines, the Flutter `DdpiAuthPage` unified pattern (which Phase D adopts as `<SellAuthGate>`), and the Flutter `ReauthHelper` mark-expired-before-reauth ordering (which RN catches up to via SDK orchestrator). Drawn from 3 of 4 parallel Explore agents (Flutter audit, bespoke-RN audit, MP-rebalance-RN audit) + targeted reads of `BrokerConnectModalDispatch.js` (4th agent timed out; covered by direct read).
- `SDK_ORCHESTRATION_CONTRACT.md` (613 lines) — TS + Dart parallel API surface. `executeAdvice` / `connectBroker` / `reauth` / `disconnectBroker` public methods. Shared types: `AdviceInput` tagged union (4 kinds — bespokeSingle / bespokeCart / mpRebalance / mpInitialAllocation), `AdviceResult`, `TradeResultRow`, normalized `OrderStatus` enum (7 values), `OrchestrationError` envelope (10 codes), `RecoveryAction` enum, theme keys, host hooks, idempotency via `clientAdviceId`. Cross-platform parity rules normative (drift = bug).
- `SDK_ORCHESTRATION_PHASES.md` (388 lines) — sequenced migration plan with hard done-when gates per phase. Phases C / D / E / F. Phase C is the centerpiece — `executeAdvice` orchestrator, ~6000 LOC of RN deletion + ~2000 LOC of Flutter deletion. Phase D is `<SellAuthGate>` (Flutter's pattern lifted to SDK). Phase E is `validateBrokerSession` + `reauth`. Phase F is legacy deletion + `2.0.0` major bump. Per-tenant rollout via flag flip. Dual-write soak with `< 0.1%` divergence rate × 14 trading days as success metric. Estimate: 15-21 weeks total (~4-5 months), comparable to Phase 3 connect tempo.

**Cross-repo mirrors** (pointers to canonical trio):
- `../alphaquark-mobile-sdk/docs/ORCHESTRATION_REFERENCE.md`
- `../tidi_new/tidistockmobileapp/docs/SDK_ORCHESTRATION_REFERENCE.md`

**CLAUDE.md update** — new BLOCKING rule mirroring the Phase 3 + sell-auth + design-system patterns. Every commit that touches an orchestrator surface in any of the four repos updates VISION (if architectural), AUDIT (always), CONTRACT (if API-affecting), and PHASES (always — done-when flips) in the SAME commit. **B-2 caller wiring is paused** — explicitly called out so future contributors don't add granular `useExecuteTrades` callsites.

**Self-review pass 1** caught two consistency issues, fixed in same commit:

- AUDIT § 5 referenced "Phase D backend fix" for the SDK `/connect` cred-validation gap; Phase D in PHASES is sell-auth. Reclassified as "Pre-Phase-C backend follow-up" since it's a Phase 3 cleanup, not orchestration territory.
- PHASES Phase C didn't explicitly call out where `requireFunds` sub-orchestrator ships; added a pre-condition note that funds-check is internal to Phase C, not a separate phase.

**Self-review pass 2** (parallel-agent gap-finding — the 2026-05-02 design-system trick) **deferred to next session**. Pass 1 + targeted reads gave high-enough confidence to commit and iterate; pass 2 will spawn fresh agents with no context to find what pass 1 missed.

**Behavior change in app**: zero. Doc-only commit.

**What this unblocks**: Phase C kickoff. Concrete next actions for whoever picks this up next session: (1) pre-Phase-C backend cleanup ticket — `/sdk/v1/connections/:broker/connect` validation; (2) Phase D landing (sell-auth gate widget — Flutter's pattern is the template); (3) Phase E landing (reauth lift). Phase C integrates the others.

### Cleanup — 5 dead/orphan files deleted (design-system audit follow-up)

Per `docs/DESIGN_AUDIT_FINDINGS_2026-05-02.md` § Open follow-ups #2. Each deletion verified by grep — zero consumers across `src/` (excluding the file itself).

**Deleted:**

- `src/screens/Drawer/investContext.js` — orphan `InvestAmountContext` / `InvestAmountProvider`. Zero imports of either symbol; the `invetAmount` references in `MPInvestNowModal.js`, `MPPerformanceScreen.js`, `BespokePerformanceScreen.js`, `PaymentHandle.js`, etc. are all local `useState` / route params / function parameters — none consume this context.
- `src/screens/Drawer/SubscriptionsScreen.js` — 20-line stub rendering only `<Text>Subscriptions</Text>`. Zero imports. Not registered in `Navigation.js`. The active route is `MySubscriptionsScreen` from `src/screens/Home/`.
- `src/screens/Drawer/use.js` — orphan dummy data export (`payments` array). Imported `lucide-react-native` icons it didn't render. Zero imports.
- `src/components/HomeScreenComponents/KnowledgeHubScreen/VideoPlayerModal.js` — empty file (0 bytes). Likely placeholder that never landed.
- `src/components/BrokerOverlay.js` — `FullWindowOverlay`/`Modal` wrapper. Zero imports across the repo. Confirmed orphan by audit. (`CrossPlatformOverlay.js` is the live SDK-bound shell, used in 14 places — kept.)

**Docs updated:**

- `docs/DESIGN_COMPONENT_AUDIT.md` § Modal-shell consolidation — `BrokerOverlay` row marked DELETED. § Per-modal verdicts — same. § Verdict tally `defer` count corrected from ~2 → 1.
- `docs/DESIGN_MIGRATION_PROGRESS.md` — new entry for the cleanup pass.

**Behavior change in app:** zero. All deleted files had zero runtime callers.

### Fixed — sell-auth flag reset on reconnect (per-day persistence) — STRUCTURAL across all 14 brokers

**Problem.** User-reported 2026-05-02 ("sell order issue is also there in upstox - like the one you saw in angel one"). Investigation surfaced TWO structural bugs and a per-day correction:

1. **`Routes/userRoutes.js`** — every broker connect handler hard-coded `ddpi_enabled: false, is_authorized_for_sell: false` in the `findOneAndUpdate` `$set`. Every reconnect wiped the user's prior manual EDIS / DDPI confirmation. 14 sites: IIFL, Zerodha, ICICI Direct, Upstox, HDFC Securities, Dhan, Groww, AliceBlue (×2), Fyers, Motilal Oswal, Axis Securities, Kotak (×2).

2. **`services/MultiBrokerService.js addBrokerConnection`** — the `connected_brokers[broker]` sub-document was independently being reset because each caller's `brokerData` payload omits the flags and the sync did `brokerData.ddpi_enabled || false`. The mobile apps read `connected_brokers[broker].is_authorized_for_sell` (via `getBrokerCreds`), so this was the actual user-visible cause.

3. **Per-day correction** — first preserve-fix kept the flag indefinitely. WRONG. India broker EDIS / TPIN authorizations EXPIRE at end of trading day; a stored TRUE from yesterday is actively misleading (user thinks they can sell, broker rejects mid-trade with POA error). Fix introduces a companion timestamp `sell_auth_set_at` and helper `shouldPreserveSellAuth(flag, setAt)` that returns true iff the flag was set TODAY in IST (Asia/Kolkata fixed offset).

**Files changed (`aq_backend_github`):**

- `Models/userModel.js` — added `sell_auth_set_at: Date` to BOTH the top-level user doc AND the `connectedBrokerSchema` sub-document.
- `utils/sellAuthDayCheck.js` (new) — `shouldPreserveSellAuth(flag, setAt)`, `isSetToday(setAt)`, `_ymdIST(d)` helpers. Pure date-math, no external deps.
- `Routes/UpdateEdisStatus.js` — both PUT paths (tenant-scoped + internal-revoke) now stamp `sell_auth_set_at = new Date()` when `is_authorized_for_sell` flips to TRUE; `null` on FALSE. Mirrored to `connected_brokers[broker].sell_auth_set_at`.
- `Routes/userRoutes.js` — replaced `ddpi_enabled: false, is_authorized_for_sell: false` in all 14 broker connect handlers with `shouldPreserveSellAuth(...)` calls. `ddpi_enabled` preserves `currentUser.ddpi_enabled` unconditionally (DDPI is a SEBI POA, permanent). `is_authorized_for_sell` preserves only when `sell_auth_set_at` is today's IST date.
- `services/MultiBrokerService.js` `addBrokerConnection` — same `shouldPreserveSellAuth` check on the existing `connected_brokers[broker]` entry. Added `sell_auth_set_at` to the projection map.

**Behaviour:**

| Day | Event | Result |
|---|---|---|
| N morning | User authorizes manually via DdpiModal | `is_auth=true`, `set_at=today IST` |
| N reconnect (same day) | Connect path checks `set_at == today IST` → preserve | `is_auth=true` retained, no manual prompt |
| N+1 morning | Connect path checks `set_at != today IST` → reset | `is_auth=false`, manual prompt fires |
| N+1 after re-auth | Same as N morning | preserved across N+1 |

Brokers WITH live server-side check (Zerodha `save-ddpi-status`, Angel One `verify-dis`, Dhan `get-edis-status`) overwrite the preserved flag on the next live probe — preservation is harmless for those. Brokers WITHOUT a live check (Upstox, HDFC, Motilal, AliceBlue, IIFL, Axis, Kotak, Groww, Fyers, ICICI) needed this preservation to avoid forcing manual EDIS on every reconnect.

### Fixed — Alphab2bapp DdpiModal: live verify-edis short-circuit (Angel One)

`src/components/DdpiModal.js` — when the auto-fetched `verify-edis` returns `edis: true` (user already has DDPI / today's TPIN active server-side), now auto-calls `handleProceed` to flip `is_authorized_for_sell=true` in DB and close the modal. User no longer sees the redundant DDPI prompt when SmartAPI already confirms authorization. Mirrors tidi_new `RebalanceReviewPage._checkAngelOneEdisStatus` pattern.

**Cross-repo deploys (2026-05-02):**

- ✅ `aq_backend_github/Ibt-branch` — pushed + deployed via `systemctl restart alphaquark.service` (active)
- ✅ Backend changes apply to BOTH tidi (Flutter) and Alphab2bapp (RN) automatically — same backend.
- ✅ tidi_new `feature/sdk-integration` — Angel One JWT-fallback in DdpiAuthPage + live verify-dis check in RebalanceReviewPage (shipped 2.8.9+79).
- ✅ Alphab2bapp `feature/sdk-plus-config-ui` — DdpiModal live verify-edis short-circuit (this commit).

**RN SDK (`alphaquark-mobile-sdk`):** No change needed. RN SDK has `useSellAuth.ts` + `edisDetection.ts` for post-trade-failure classification, not pre-trade gate logic.

---

## [unreleased] - 2026-05-01 — PHASE-B-1-SDK-LIFT

### Added — SDK trade-execution proxy layer + RN/Flutter hooks/widgets

**Problem.** Phase A landed direct-ccxt for bespoke + cart trade execution and locked the wire shape via internal-only SDK types. Phase B-1 adds the SDK proxy lane (`/sdk/v1/orders/*`) and the RN + Flutter hooks/widgets that consume it, mirroring the Phase 3 connect pattern. App-side caller wiring is deferred to Phase B-2.

**Fix.** Three additive layers in three repos, no app code changes:

1. **`aq_backend_github` (Ibt-branch on tidi):**
   - Extracted `_selfCallLegacy` from `Routes/sdk/v1/connections.js` (lines 119-177) into a shared helper at `Routes/sdk/v1/_helpers/selfCallLegacy.js`. Same JWT-mint logic, same headers, same `validateStatus: () => true` pass-through. `connections.js` refactored to import from the new module — no behavior change.
   - New `Routes/sdk/v1/orders/index.js` — four SDK proxy routes:
     - `POST /sdk/v1/orders/place` (scope `orders:write`) → ccxt `POST /orders/process-trade`
     - `POST /sdk/v1/orders/:orderId/status` (scope `orders:read`) → ccxt `POST /order/status`
     - `GET /sdk/v1/orders/book` (scope `orders:read`) → ccxt `POST /order/book` + client-side filter/paginate
     - `POST /sdk/v1/orders/:orderId/cancel` (scope `orders:write`) → ccxt `POST /order/cancel`
   - Mounted at `/sdk/v1/orders` in `index.js` next to existing `/sdk/v1/connections` line.
   - **No mint server changes** — `ALL_SCOPES` in `utilities/sessionToken.js:56` already had `orders:read` + `orders:write`; mint server is a thin proxy with no allowlist.

2. **`alphaquark-mobile-sdk` (develop):**
   - RN: `packages/rn/src/orders/{hooks,components}/` — `useExecuteTrades`, `useOrderBook`, `TradeReviewSheet`, `TradeResultModal`, `TradeExecutionProgress`. Barrel at `orders/index.ts`. Re-exported from `packages/rn/src/index.ts`. **Hooks + widgets exported; types stay internal** per spec § "Open questions — settled" #5 (major version bump deferred to Phase B-4 flag flip).
   - Flutter: `packages/flutter/lib/src/orders/` — `execute_trades.dart`, `order_book.dart`, three widgets under `widgets/`. Barrel at `orders.dart`, re-exported from `alphaquark_mobile_sdk.dart`.

3. **`Alphab2bapp` (this repo, worktree):** docs only — `APP_ARCHITECTURE.md § Phase B-1`, `SDK_TRADE_EXECUTION_MIGRATION.md § Phase B-1 progress`, this `CHANGELOG.md` entry.

**Files touched:**

Backend (aq_backend_github, branch Ibt-branch on tidi):
- `Routes/sdk/v1/_helpers/selfCallLegacy.js` (NEW) — shared JWT-mint self-call helper
- `Routes/sdk/v1/connections.js` — refactored to import shared helper; inline copy deleted
- `Routes/sdk/v1/orders/index.js` (NEW) — four SDK proxy routes
- `index.js` — mount `/sdk/v1/orders`
- `docs/CHANGELOG.md` — backend dated entry

SDK package (alphaquark-mobile-sdk, branch develop):
- `packages/rn/src/orders/hooks/useExecuteTrades.ts` (NEW)
- `packages/rn/src/orders/hooks/useOrderBook.ts` (NEW)
- `packages/rn/src/orders/components/TradeReviewSheet.tsx` (NEW)
- `packages/rn/src/orders/components/TradeResultModal.tsx` (NEW)
- `packages/rn/src/orders/components/TradeExecutionProgress.tsx` (NEW)
- `packages/rn/src/orders/index.ts` (NEW) — barrel (hooks + widgets only)
- `packages/rn/src/index.ts` — re-export `from "./orders"`
- `packages/flutter/lib/src/orders/execute_trades.dart` (NEW)
- `packages/flutter/lib/src/orders/order_book.dart` (NEW)
- `packages/flutter/lib/src/orders/widgets/trade_review_sheet.dart` (NEW)
- `packages/flutter/lib/src/orders/widgets/trade_result_modal.dart` (NEW)
- `packages/flutter/lib/src/orders/widgets/trade_execution_progress.dart` (NEW)
- `packages/flutter/lib/src/orders/orders.dart` (NEW) — barrel
- `packages/flutter/lib/alphaquark_mobile_sdk.dart` — re-export

App (this repo, worktree off feature/sdk-plus-config-ui):
- `docs/APP_ARCHITECTURE.md` — Phase B-1 architecture section
- `docs/SDK_TRADE_EXECUTION_MIGRATION.md` — Phase B-1 progress sub-section
- `docs/CHANGELOG.md` — this entry

**Why now.** Phase A locked the wire shape; B-1 builds the SDK proxy + consumer module so Phase B-2 (app caller wiring) only touches app code, not infra. Mirror of Phase 3's lift-then-wire sequencing.

**Auth + scope.** `sdkAuthSession({ scope: "orders:write" | "orders:read" })` enforces JWT validity + scope claim. ccxt-india unchanged — proxy uses the same `aq-encrypted-key` Phase 3 connect uses. Mint server unchanged.

**No app callers.** All four ports of `Trade[]` placement (StockAdvices, AddtoCartModal, OrderService, IgnoreTradesScreen — listed in Phase A) still call ccxt direct via `aq-encrypted-key`. The SDK lane is built but unused. Phase B-2 wires the first caller behind `REACT_APP_USE_SDK_TRADE_FLOW` with dual-write soak.

**Restart.** `alphaquark.service` restarted on tidi after backend commit. Verified live.

---

## [unreleased] - 2026-05-01 — PHASE-A-TRADE-EXEC-ALIGN

### Changed — Bespoke + cart trade execution lifted to direct-ccxt `/orders/process-trade`

**Problem.** The bespoke (StockAdvices), cart (AddtoCartModal), ignore-trades reorder (IgnoreTradesScreen), and `OrderService.placeOrders` flows POSTed to Node `${server.baseUrl}api/process-trades/order-place`, which itself hopped to ccxt-india `/<broker>/process-trades`. Meanwhile MP review-trade had moved to direct-ccxt `/rebalance/process-trade`. Two execution lanes for the same conceptual operation, two response envelopes (`response[]` vs `results[]`), two auth-resolution code paths. The Phase B SDK lift needs ONE response shape across both flows.

**Fix.** New ccxt-india endpoint `POST /orders/process-trade` (parallel to `/rebalance/process-trade`). Bespoke callsites POST direct to it; response envelope matches MP's exactly (`{results, orderErrors, fundsRequired, sessionExpired}`). The endpoint internally uses `BrokerFactory` + `self.broker.process_trades(trades)` (same per-broker substrate as MP) and `ProcessTradesDbMananger.update_trade_reco(...)` for `traderecos` writes (top-level + basket_advice). When `basketId` is present, calls `/<broker>/basket/run` for net-position regen.

**Files touched:**

App (RN):
- `src/components/AdviceScreenComponents/StockAdvices.js` — `placeOrder` axios.post URL flipped, response key flipped, fallback added
- `src/components/AdviceScreenComponents/AddtoCartModal.js` — same
- `src/services/OrderService.js` — `placeOrders` URL/body flipped
- `src/screens/Drawer/IgnoreTradesScreen.js` — `placeOrder` URL flipped
- `src/utils/ProcessTrades.js` — DELETED (dead code, only test imports)
- `src/__tests__/utils/ProcessTrades.test.js` — DELETED
- `src/__tests__/integration/brokerTradeFlow.test.js` — rewritten against direct-ccxt mock pattern

Backend (ccxt-india on tidi, scp/git push):
- `apps/app_orders.py` (NEW) — `/orders/process-trade` handler
- `trading_logic/orders/order_processor.py` (NEW) — bespoke trade processor (per-broker dispatch, traderecos writes, basket regen call)

SDK package types (NEW, internal-only — public export deferred to Phase B-1):
- `alphaquark-mobile-sdk/packages/rn/src/orders/types.ts` — `Trade`, `TradeResult`, `OrderStatus`
- `alphaquark-mobile-sdk/packages/flutter/lib/src/orders/types.dart` — same in Dart

Docs:
- `docs/APP_ARCHITECTURE.md` — new `## Trade execution architectural alignment (Phase A)` section
- `docs/SDK_TRADE_EXECUTION_MIGRATION.md` — Phase A progress checklist + work log
- `aq_backend_github/docs/CHANGELOG.md` (on tidi) — cross-repo note about ccxt-india endpoint addition

**Direct-ccxt fallback safety net.** Each callsite has a fallback to legacy Node `/api/process-trades/order-place` on 5xx / network error, gated by `Config.REACT_APP_BESPOKE_DIRECT_CCXT_FALLBACK || 'true'`. Default on. Flip to `'false'` after one release of clean direct-ccxt traffic to retire the fallback path.

**Deprecation.** Node `/api/process-trades/order-place` route stays in service for one release as fallback target. Removal scheduled for next-next release after fallback flag flip.

**Risk.** New backend route untested in prod traffic; fallback flag mitigates. ProcessTrades.js deletion has zero runtime callers (verified via grep) so no risk there. Cart-only `basketId` regen flow tested separately.

---

## [unreleased] - 2026-05-01

### Fixed — Fyers SDK exchange-token: round-4 root cause finally resolved (4 paths, 4 rounds)

**Production user `prikc1333@gmail.com` saw "invalid clientId" / "invalid app id hash" through 4 rounds of failed fixes today.** Root cause across all 4 was the same pattern: a single broker (Fyers) has its OAuth login URL minted from MULTIPLE backend code paths, AND the SDK schema rewrite (App ID/Secret/User ID labels) needed parallel updates to each consumer. Fixing one path at a time was a no-op for the user because their flow hit a different path on each retry.

**The 4 paths and their resolutions:**

| Round | File | Problem | Fix |
|---|---|---|---|
| 1 | `aq_backend_github/Routes/Broker/Fyers.js` | Read `data.clientCode` raw, ignored `data.apiKey` from the new SDK schema | `appId = data.apiKey \|\| data.clientCode` (but missed encryption symmetry) |
| 2 | `aq_backend_github/Routes/Broker/Fyers.js` | Forwarded encrypted blob to ccxt as `clientId` (didn't decrypt `data.apiKey`) | Added `tryDecrypt` heuristic on both `data.apiKey` and `data.clientCode` |
| 3 | `aq_backend_github/Routes/multiBrokerRoutes.js:818-843` | **Different code path for smart-reauth** (SDK auto-jump path) — pulled `credentials.clientCode` raw | Same `tryDec` heuristic; resolution prefers `credentials.apiKey` then `credentials.clientCode` |
| 4 | `aq_backend_github/Routes/sdk/v1/connections.js:1643-1713` | **Yet another code path for SDK exchange-token** — used OLD field semantics (`clientCode`=App ID, `apiKey`=OAuth secret) but new SDK schema swapped them (`apiKey`=App ID, `secretKey`=App Secret, `clientCode`=FY user ID) | Branch on `body.apiKey` presence; form path uses `decrypt(apiKey)` as App ID + `decrypt(secretKey)` as App Secret; autojump path uses `body.clientCode` as App ID + `decrypt(secretKey)` as App Secret |

**Final exchange-token persistence shape** (post-round-4):
- `connected_brokers[Fyers].apiKey` = plaintext App ID (e.g. `UMEG2NCP7W-200`) — for autojump pickup
- `connected_brokers[Fyers].clientCode` = plaintext App ID (legacy convention preserved)
- `connected_brokers[Fyers].secretKey` = AES-encrypted App Secret (downstream `checkValidApiAnSecret` decrypts)

**Hard lesson recorded** in `CLAUDE.md § 🔴 Lesson — broker auth bugs` (top-level): grep for EVERY callsite hitting ccxt's auth endpoint BEFORE writing any fix. Expected paths per broker: `Routes/Broker/<Broker>.js`, `Routes/multiBrokerRoutes.js`, `Routes/sdk/v1/connections.js` (login-url branch + exchange-token branch). Fixing one in isolation invites the user to retry on a broken path and lose confidence — exactly what happened here.

**Encryption symmetry rule:** if `secretKey` is wrapped in `checkValidApiAnSecret(...)`, ASSUME `apiKey` / `clientCode` need the same transform. Read the entire request-body shape and trace each field's encryption state before forwarding.

**Files touched (cross-repo, 2026-05-01):**

- `aq_backend_github/Routes/Broker/Fyers.js` — round-1 + round-2 fixes
- `aq_backend_github/Routes/multiBrokerRoutes.js` — round-3 fix (Fyers smart-reauth branch)
- `aq_backend_github/Routes/sdk/v1/connections.js` — round-4 fix (Fyers exchange-token branch + new persistence shape)
- `alphaquark-mobile-sdk/packages/flutter/lib/src/widgets/broker_form_schema.dart` — Fyers field labels (App ID / App Secret / Fyers User ID)
- `alphaquark-mobile-sdk/packages/rn/src/components/brokerFormSchema.ts` — same, ported
- `Alphab2bapp/CLAUDE.md` — lesson section added (Lesson — broker auth bugs)
- `tidi_new/tidistockmobileapp/pubspec.yaml` — bumped 2.8.7+77 → 2.8.8+78

**Tested end-to-end** on emulator with user prikc1333@gmail.com after final fix: form → OAuth login → callback → exchange-token → broker-connected. SHA-256 hash now matches Fyers's expected `client_id:client_secret` digest.

### Added — Trade-result `variant` field: AMO vs REGULAR badge on order success cards

**Problem.** When tenants enable `appadvisors.allowAfterHoursOrders` (or
`featureFlags.allowAfterHoursOrders`), users can submit trades outside the
09:15–15:30 IST gate. The order is correctly accepted by the broker as an
**After-Market Order (AMO)** and parked for the next market open, but the trade
result UI in `RecommendationSuccessModal` (RN) and `ExecutionStatusPage` /
`MPStatusModal` (Flutter) renders these orders identically to live (REGULAR)
orders — same green "PLACED" badge, same "Ord. Type: MARKET" pill. Several
support tickets have traced back to users panicking that "the order didn't
fire" because they didn't realise their broker had auto-converted the order
to AMO. The fix is **display-only**: tag each trade with a stable
`variant: "AMO" | "REGULAR"` field at submit time, render an **amber AMO
badge** on every result card whose variant is AMO.

**Detection strategy — frontend-computed.** Variant is computed at submit by
the client, not by Node or ccxt-india. This avoids a fan-out into 13 broker
SDK adapters in ccxt-india just to surface a UI signal.

```
variant = (!IsMarketHours() && allowAfterHoursOrders === true) ? "AMO" : "REGULAR"
```

`IsMarketHours()` already lives at `src/utils/isMarketHours.js` (RN, 09:15–15:30
IST gate via moment). The Flutter equivalent lives inline in
`tidistockmobileapp/lib/components/home/portfolio/ExecutionStatusPage.dart`
(`_isMarketOpen`, lines 2605–2609). `allowAfterHoursOrders` is sourced from
`appadvisors.allowAfterHoursOrders` / `featureFlags.allowAfterHoursOrders`,
already wired through `ConfigContext` (RN) and `AqApiService.dart` (Flutter).

**Field contract** (intentional source-of-truth for the future SDK trade
contract — when bespoke + basket execution migrate from legacy ccxt/Node to
the SDK lane the way Phase 3 broker-connect did, this field stays):

- **Field name:** `variant` (not `orderType` — that's already MARKET/LIMIT)
- **Values:** `"AMO" | "REGULAR"` (string literal, not boolean — leaves room for
  future values like `"GTT"`, `"OCO"`, `"BO"`, `"CO"` without a breaking
  schema change)
- **Default fallback when missing:** `"REGULAR"` — treat as live order. Safer
  than treating regular as AMO (a missing AMO badge on a live order is a
  cosmetic miss; a wrong AMO badge on a live order suggests to the user
  "this didn't fire", which is the regression we're trying to prevent).

**Files touched.**

- `src/utils/ProcessTrades.js` — `buildOrderPayload()` now tags every trade
  with `variant` computed from `IsMarketHours()` + `configData.allowAfterHoursOrders`.
- `src/components/AdviceScreenComponents/StockAdvices.js` — `getOrderPayload`
  inlined `variant` per trade (bespoke trade path doesn't go through
  ProcessTrades — it has its own payload builder).
- `src/components/AdviceScreenComponents/RebalanceModal.js` — rebalance
  payload builder for `rebalance/process-trade` tags `variant` per trade.
- `src/components/ModelPortfolioComponents/MPReviewTradeModal.js` — MP review
  trade payload builder tags `variant` per trade.
- `src/components/ModelPortfolioComponents/UserStrategySubscribeModal.js` —
  MP strategy-subscribe submit path tags `variant` per trade.
- `src/components/ModelPortfolioComponents/RecommendationSuccessModal.js` —
  added amber **AMO** pill (uses `theme.colors.status.warning` /
  `warningBg` — already in the design tokens). Pill renders next to the
  PLACED/PENDING/REJECTED status pill on every card whose `variant === "AMO"`.
  Renders nothing on REGULAR / missing variant. Falls back to looking up
  variant from the original `stockDetails` array (passed via new prop) when
  the response item itself doesn't carry the field — defensive against older
  Node deploys that haven't echoed the field yet.
- `tidistockmobileapp/lib/models/order_result.dart` — `OrderResult` gains a
  nullable `variant` field (parsed from JSON `variant`); `factory fromJson`
  reads it case-insensitively.
- `tidistockmobileapp/lib/service/OrderExecutionService.dart` — every trade
  payload builder tags `variant` per trade.
- `tidistockmobileapp/lib/components/home/portfolio/ExecutionStatusPage.dart`
  — `_orderResultCard` renders amber AMO pill next to status pill when
  `result.variant?.toUpperCase() == 'AMO'`.

**Backend echo (Node side, uploaded via scp to tidi).**

- `aq_backend_github/Routes/Broker/ProcessTrades.js` — `/api/process-trades/order-place`
  handler — after the upstream ccxt-india response is mapped onto each output
  trade row, the matching input trade's `variant` is copied onto the output:

  ```js
  return processTradeUpdate({...trade, variant: matchingTrade.variant || 'REGULAR'}, ...);
  ```

  The `tradeDetails` rows returned in the `response` envelope now carry
  `variant`. **No DB persistence** (the field is not written to
  `traderecos`) — it's purely a request-scoped echo for the frontend display
  contract. If the rebalance lane (`rebalance/process-trade`, hitting ccxt
  directly) doesn't echo it, the frontend already falls back to its own
  outgoing payload — no backend dependency for that lane.

**Followup-noted: payload should explicitly send `orderVariety: "AMO"` when
variant is AMO; not done in this commit because behavioral change needs its
own dual-write soak.** Today, when the client submits a regular order during
after-hours, every supported broker (Zerodha, Angel One, Upstox, ICICI,
Kotak, Dhan, Fyers, IIFL, AliceBlue, Motilal Oswal, HDFC, Groww, Axis) auto-
converts it to AMO server-side. This commit relies on that auto-conversion
and does NOT change the place-order payload — it's purely display. A
followup PR will explicitly thread `orderVariety: "AMO"` through to the
broker payload, but that is a behavioral change (some brokers' AMO accept
windows differ from their regular accept windows, and explicit AMO orders
have different cancellation policies). It needs its own review window with a
dual-write phase.

**Pre-flight market-closed banner: NOT in this commit.** A separate UX gate
(banner on the review-trade modal that says "Market is closed — your order
will be parked as AMO and execute at next open") was discussed but
intentionally deferred — the review-trade flow already has the
`marketGateOpen` check that BLOCKS submission when `allowAfterHoursOrders ===
false`, so users with that flag off never see AMO. Users with it ON have
explicitly opted in and currently get no warning — that's the gap the banner
would close, but it's a separate scope.

**Why this is safe (display-only).** The `variant` field is added to the
payload but the Node + ccxt-india broker dispatch layer does not consume it
(it's an unrecognised field; both Node Mongoose schemas and ccxt-india
trade-payload validators already use whitelist or strip-unknown semantics, so
the field passes through harmlessly to display logic without affecting order
routing). Verified by reading
`aq_backend_github/Routes/Broker/ProcessTrades.js` payload construction —
`createPayload()` does not forward arbitrary trade fields to ccxt; it
re-builds `apiTrades` from a known shape. So the `variant` field never
reaches the broker SDK layer.

**Testing.**

- After-hours submit on a tenant with `allowAfterHoursOrders=true`:
  RecommendationSuccessModal renders amber AMO pill on every result card.
- After-hours submit on a tenant with `allowAfterHoursOrders=false`:
  ReviewTradeModal blocks submission as before (existing behaviour, unchanged).
- During-market-hours submit on either tenant: variant is REGULAR, no pill.
- Older Node deploy that doesn't echo `variant`: frontend falls back to
  matching against its own outgoing payload by symbol+tradeId, AMO pill still
  renders.
- Order with no matching outgoing record (e.g. Zerodha publisher
  record-orders path): variant defaults to REGULAR, no pill. Acceptable
  cosmetic miss.

**Architecture docs updated in same commit:**

- `docs/APP_ARCHITECTURE.md` — new section "Trade variant field (AMO vs
  REGULAR)" under "Trade execution flow".
- `docs/REBALANCING.md` — note that rebalance payload now includes `variant`
  per trade.
- `docs/MODEL_PORTFOLIO.md` — note that MP review-trade payload now includes
  `variant` per trade.

**Cross-repo touch.** Backend uploaded via scp to tidi
(`aq_backend_github/Routes/Broker/ProcessTrades.js` only), Flutter app
(`tidi_new/tidistockmobileapp`) updated in parallel. tidi_new has no bespoke
trade execution path (verified by grepping `lib/` — only rebalance/MP go
through `OrderExecutionService.dart`); Flutter scope is rebalance/MP success
display only.

### Cross-repo port batch — Flutter SDK + tidi_new deltas mirrored into RN SDK + Alphab2bapp

The same-day round of fixes that shipped to the Flutter SDK + tidi_new app needed cross-platform parity. This batch ports:

**RN SDK** (`alphaquark-mobile-sdk/packages/rn`):

- `components/brokerFormSchema.ts` — Fyers entry: relabel `apiKey` → "App ID" (placeholder `e.g. UMEG2NCP7W-200`, helper "From myapi.fyers.in → My Apps → App ID. NOT your Fyers user ID."), `secretKey` → "App Secret", `clientCode` → "Fyers User ID" (placeholder `e.g. XL12345 or YR12345`, helper "Your Fyers login ID (used for display only)."). Intro + prerequisites rewritten to enumerate the three values explicitly. Same-as-Flutter (commit 2398e8d).
- `components/WebViewBrokerAuthFlow.tsx`:
  - **Multi-target match list** — `matchTargets` array (consumer-passed `redirectUrl` + backend-supplied `callbackUrl` BOTH ride together; previously the latter REPLACED the former). Mirror of Flutter's `_matchTargets` (commit 7d1b4bd).
  - **OAuth-param-anchored matcher** — added `authCode`, `dhan_access_token`, `ssoId`, `jwtToken` to the recognised callback-param list (was missing from RN; Flutter had them already via 401fdfa).
  - **Origin gate** — iterate over `targetOrigins` instead of single `targetOriginLower`. URL belongs in our accept-list iff its origin is in EITHER target's origin set.
  - 3-intercept callback capture (injectedJavaScript + onShouldStartLoadWithRequest + onLoadStart + onNavigationStateChange + onMessage) was already present in RN — this is a 5-intercept pattern, stricter than Flutter's 3-intercept.
- `components/BrokerCredentialForm.tsx` — added optional `headerSlot?: React.ReactNode` prop, rendered ABOVE the title, INSIDE the form's ScrollView. Use this for IP-whitelist callouts, video tutorials, setup-step accordions that should scroll WITH the fields rather than be frozen above them. Mirror of Flutter's `header` slot (commit d3023c4).

**Alphab2bapp** (`github/Alphab2bapp`):

- `src/components/AngelOneCautionaryWarning.js` (new) — pre-connect bottom-sheet warning with the cautionary-listing notice (Angel One silently rejects exchange-cautionary stocks at order placement, surfacing as confusing partial-success in Trade Details). Mirror of tidi_new `showAngelOneCautionaryWarning` (commit 2e4885e).
- `src/components/BrokerSelectionModal.js` — wires the warning before opening the Angel One modal: state `pendingAngelOneBroker` tracks "Angel One selected, awaiting ack"; `proceedWithBrokerSelect()` runs only after user acks. ManageConnectionsModal is intentionally NOT gated — re-auth users have already acked on the original connect (Flutter parity).
- `src/components/BrokerConnectionModal/Phase3SdkBrokerModal.js` — restructured the form-phase render to use a SINGLE scroll surface. Previously: outer `ScrollView` containing EgressIpCallout + Phase3BrokerHelp + (BrokerCredentialForm with its own internal ScrollView), causing a nested-scroll dead zone (user-reported "scroll down on Zerodha was not working", 2026-05-01). Now: outer container has no ScrollView; EgressIpCallout + Phase3BrokerHelp + errorBox pass via the SDK form's new `headerSlot` prop so they scroll INSIDE the form's own ScrollView. Mirror of tidi_new Phase3SdkConnectScreen unified-scroll fix (commit 2c6cb9c).

**Flutter-only — not ported (no analogue in RN):**

- `fix(zerodha-publisher): drop "I've completed placing orders" button` — this button never existed in Alphab2bapp's RN flow. `ReviewZerodhaTradeModal.js` already relies on URL autodetect (`url.includes('success') || url.includes('completed')`).
- `feat(calendar): rework Moon Phases tab` — TidiStock-only feature, has no equivalent in B2B app.
- `fix(execution-status)` pair (status pills + drop "View / Edit Orders") — TidiStock ExecutionStatusPage has a different UI surface than B2B's ExecutionStatusScreen; not applicable.

### Fixed — Fyers SDK form: relabel fields to disambiguate App ID vs Fyers user ID

**Problem.** Production user `YR17597` (and likely others) hit "invalid clientId" on Fyers OAuth because the SDK form's `clientCode` field was labelled `Client Code` with helper `Your Fyers ID (e.g. XL12345)`. Users typed their **Fyers login user ID** (`YR17597`) into that field, but the legacy backend treats `clientCode` as the OAuth `client_id` — i.e. the **App ID** from myapi.fyers.in (e.g. `UMEG2NCP7W-200`). The form labels never communicated this distinction.

**Fix.**

- `alphaquark-mobile-sdk/packages/flutter/lib/src/widgets/broker_form_schema.dart` — Fyers schema entry rewritten:
  - `apiKey` → label **App ID**, placeholder `e.g. UMEG2NCP7W-200`, helper "From myapi.fyers.in → My Apps → App ID. **NOT your Fyers user ID.**"
  - `secretKey` → label **App Secret**, helper "From myapi.fyers.in → My Apps → App Secret."
  - `clientCode` → label **Fyers User ID**, placeholder `e.g. XL12345 or YR12345`, helper "Your Fyers login ID (used for display only)."
  - Intro text rewritten to call out the App-ID-vs-User-ID confusion explicitly.
  - Prerequisites list now enumerates App ID, App Secret, and Fyers user ID separately.

**Backend pairing (already deployed earlier today).** `aq_backend_github/Routes/Broker/Fyers.js` reads `appId = data.apiKey || data.clientCode` and persists `appId` under both `apiKey` and `clientCode` in `connected_brokers` so legacy autojump and SDK autojump both pick up the App ID correctly.

**Docs updated.** `docs/PHASE3_BROKER_AUDIT.md` § Fyers — sub-section "2026-05-01 — Fyers field labels disambiguated (App ID vs Fyers user ID)".

**Cross-repo touch.** SDK package change (`alphaquark-mobile-sdk`) — Phase 3 SDK widget consumed by both `Alphab2bapp` (RN, via the RN package) and `tidi_new` (Flutter, via path dep). Tidi APK rebuilt + installed; RN app inherits the change next time it ports the schema (it's already on the same monorepo).



### Refactor — design-system Phase E.3 (deep split): HomeScreen container/presentation split

**Files changed:**

- **Replaced**: `src/screens/Home/HomeScreen.js` — was a thin Phase-E.2 resolver; now the **container** (~1654 lines). Owns all hooks, state, useEffects, handlers, Animated refs, the `allTabData` builder, FCM/notifee setup, EventEmitter listeners. Builds a flat `home` prop bag and renders the presentation resolved via `useComponent('screens.HomeScreen')`.
- **Replaced**: `designs/default/screens/HomeScreen.js` — was a re-export from HomeScreenLegacy; now the **presentation** (~642 lines). Receives the `home` prop, destructures all ~50 keys at the top, renders the JSX 1:1 from legacy + the 4 modals (video player / blog viewer / PDF viewer / ethical list) + the app-update modal.
- **Deleted**: `src/screens/Home/HomeScreenLegacy.js` — its body became the container; its JSX became the presentation.
- **Unchanged**: `src/screens/Home/HomeScreen.styles.js` (Phase E.3.1) — both container (for `allTabData` JSX subtrees) and presentation import the same styles file.
- **Unchanged**: `designs/default/index.js` — `screens.HomeScreen` registry entry now resolves to the presentation file.

**Why container imports styles too:** the `allTabData` array — built in container — contains JSX subtrees (RebalanceAdvicesTop, StockAdvicesTop, AllPlanDetailsmp, etc.) that reference `styles.StockTitle`, `styles.viewAll`, etc. Those JSX trees are passed as data to the presentation via `home.allTabData`, but their style references resolve in the container's scope. The presentation imports the SAME styles file independently for the rest of the JSX. Both files share styles via this single source.

**Pattern validation:** matches the OrderScreen + auth-screen template — container holds data + state + effects, builds viewModel-equivalent prop bag, presentation receives + renders. Variant override now works end-to-end: a custom `designs/<variant>/screens/HomeScreen.js` can fully replace the home presentation while the container's data orchestration is preserved.

**Validation:** both new files Babel-parse cleanly with project config.

**Behaviour change in app:** zero. Same JSX, same handlers, same effects. Just split across files. Variants gain real overridability of the home rendering layout while inheriting the container's data flow.

### Refactor — design-system Phase E.3.1: HomeScreen styles extracted to a separate file

**First step of the deferred Phase E.3 deep split.** Pure code-organisation refactor — no behaviour change.

**Files changed:**

- **Added**: `src/screens/Home/HomeScreen.styles.js` (~530 lines) — moved verbatim from `HomeScreenLegacy.js`. Captures the two module-scope identifiers the styles need (`screenWidth` from `Dimensions.get('window')` and `selectedVariant` from `Config?.APP_VARIANT`).
- **Modified**: `src/screens/Home/HomeScreenLegacy.js` — added `import styles from './HomeScreen.styles';` next to the other imports; deleted the inline `StyleSheet.create({...})` block (lines 2126-2656). Container size dropped from 2658 → 2127 lines.

**Why this is E.3.1 and not the full E.3:** the deep container/presentation split requires moving the JSX block (lines 1608-2122) too, plus building a 50-key `home` prop bag. That's higher risk because every closure and identifier the JSX uses must be threaded through. Splitting the styles first is safe (styles don't reference container scope — only the two module-scope identifiers, both moved with them) and reduces the file size before tackling the JSX.

**Plan for the rest of Phase E.3** (subsequent commits):

- E.3.2: extract `allTabData` builder to a hook (`useHomeAllTabData`) — currently mixes container logic with JSX subtrees in a single computation.
- E.3.3: extract the 4 modal renders (video player, blog viewer, PDF viewer, ethical list) to per-modal sub-components.
- E.3.4: final JSX shell → `designs/default/screens/HomeScreen.js`. Container becomes thin.

**Validation:** both touched files Babel-parse cleanly with project config.

**Behaviour change in app:** zero. Same styles, just in a different file.

### Added — design-system Phase E.2: HomeScreen registry hookup (minimal — deep split deferred to E.3)

**Files changed:**

- **Renamed**: `src/screens/Home/HomeScreen.js` → `src/screens/Home/HomeScreenLegacy.js` (same content, ~2657 lines).
- **Added**: new `src/screens/Home/HomeScreen.js` (~25 lines) — thin resolver that calls `useComponent('screens.HomeScreen')`.
- **Added**: `designs/default/screens/HomeScreen.js` — re-exports HomeScreenLegacy as the default variant's home screen.
- **Modified**: `designs/default/index.js` — registered `screens.HomeScreen` → HomeScreenLegacy.

**Phase E.2 is intentionally minimal.** The legacy HomeScreen is 2657 lines with 8+ useEffect chains, Firebase messaging onMessage handlers, notifee permission flows, EventEmitter listeners (cartUpdated + video/PDF requests), 4 Animated.Value refs, and a hand-built `allTabData` array that mixes container logic with JSX subtrees. A render-extraction migration carries very high regression risk and is best done in a dedicated session — deferred to Phase E.3.

**What this delivers:** HomeScreen is now resolvable via the design registry. Custom variants can ship their own `designs/<variant>/screens/HomeScreen.js` to fully replace the home screen. Default variant re-exports HomeScreenLegacy so behaviour is unchanged for the default tenant.

**Validation:** all 4 touched files Babel-parse cleanly.

### Added — design-system Phase F batch 4: ChangeAdvisor migration (Phase F complete)

**Files added:**

- `designs/default/screens/ChangeAdvisor.js` (~190 lines) — pure presentation. Header (back + bell + notification dot) + Manager Settings + current/new RA ID inputs + Update button + info bullets. Initial-loading state has its own gradient + spinner.

**Files modified:**

- `src/screens/AccountSettingScreen/ChangeAdvisor.js` (~190 lines, was 536) — preserves the full restart-app orchestration chain: `RNRestart.Restart` → `DevSettings.reload` (dev) → `softRestart` (reloadConfigData + getAllTrades + getModelPortfolioStrategyDetails + nav reset to Home). RA-ID load order preserved: AsyncStorage `@app:raId` → `getRaId()` → `getUserData().raId`. All Alert dialogs (Confirm Update / Success / Invalid RA ID / Network Error) preserved verbatim.
- `designs/default/index.js` — registered `screens.ChangeAdvisor`.

**Phase F complete (2026-05-01).** All 9 surfaces migrated:

| Surface | Status |
|---|---|
| ResetPassword | ✅ Batch 1 |
| EmailScreenAppleLogin | ✅ Batch 1 |
| TermsModal | ✅ Batch 1 (composite) |
| LogOutScreen | ✅ Batch 1 |
| LoginScreen | ✅ Batch 2 |
| SignupScreen | ✅ Batch 2 |
| SignUpRADetails | ✅ Batch 3 |
| PhoneNumberScreen | ✅ Batch 3 (with incidental Config-import fix) |
| ChangeAdvisor | ✅ Batch 4 |

**Visual deltas vs legacy** (intentional): `Text`/`Icon`/`Spinner` primitives wrap legacy components.

**Validation:** all 3 touched files Babel-parse cleanly.

**Behavior change in app:** functionally equivalent.

**Doc trio updated.**

**Next:** Phase E.2 — HomeScreen migration (last remaining major migration in Phase E/F).

### Added — design-system Phase F batch 3: SignUpRADetails + PhoneNumberScreen migrations

**Files added:**

- `designs/default/screens/SignUpRADetails.js` (~210 lines) — pure presentation. RA-ID input + status banner + Create Account button + success modal.
- `designs/default/screens/PhoneNumberScreen.js` (~70 lines) — pure presentation. LogoSection + CountryCodeDropdownPicker + Proceed button.

**Files modified (containers):**

- `src/screens/Authentication/SignUpRADetails.js` — preserves `validateRaId`, `handleCreateAccount` (updateRACodeAndConfig + tracking + reload + bg trade/portfolio loads), success-modal lifecycle.
- `src/screens/Authentication/PhoneNumberScreen.js` — preserves `calculateProfileCompletion`, `handleProceed` (axios PUT to `/api/user/update-profile`).
- `designs/default/index.js` — registered `screens.SignUpRADetails` + `screens.PhoneNumberScreen`.

**Incidental fix in PhoneNumberScreen migration:**

The legacy file referenced `Config.REACT_APP_AQ_KEYS` / `Config.REACT_APP_AQ_SECRET` without `import Config from 'react-native-config'`. That's a pre-existing ReferenceError bug — the screen would crash if reached (it's wired up in Navigation as the `PhoneNumberScreen` route). Added the missing import so the call actually succeeds. Strictly speaking this is a behavior change from "crash on use" to "encrypted-key gets sent correctly" — flagging it explicitly here. If a tenant somehow relied on the broken behavior, this could surface; unlikely.

**Visual deltas vs legacy** (intentional): `Text`/`Icon`/`Spinner` primitives wrap legacy components. Hardcoded gradient + saturated-green CTA buttons retained.

**Validation:** all 5 touched files Babel-parse cleanly.

**Behavior change in app:** functionally equivalent (modulo the PhoneNumberScreen Config-import fix above).

**Doc trio updated.**

**Next:** Phase F batch 4 — ChangeAdvisor (Account section). Then Phase E.2 — HomeScreen.

### Added — design-system Phase F batch 2: LoginScreen + SignupScreen migrations

**Files added:**

- `designs/default/screens/LoginScreen.js` (~280 lines) — pure presentation. Email/password form + Forgot Password + Login button + Google sign-in + Apple sign-in (iOS only) + signup link + decorative gradient hero.
- `designs/default/screens/SignupScreen.js` (~230 lines) — pure presentation. Name/email/password form + Terms-of-Service checkbox + Create Account button + login link + decorative gradient hero. Note: legacy SignupScreen has no Google/Apple buttons.

**Files modified (containers, rewritten as thin):**

- `src/screens/Authentication/LoginScreen.js` — preserves all auth handlers: `signInWithEmail`, `handleGoogleLogin`, `handleAppleLogin`, `completeAppleSignIn`, `handlePostLoginNavigation` (3-path orchestrator). All Firebase/Google/Apple/backend logic identical to pre-migration. Renders `useComponent('screens.LoginScreen')`.
- `src/screens/Authentication/SignupScreen.js` — preserves `handleSignup` + `handlePostSignupNavigation` (hasAdvisorRaCode + auto-resolve + fallback to SignUpRADetails). All Firebase signup + backend create + tracking logic identical. Renders `useComponent('screens.SignupScreen')`.
- `designs/default/index.js` — registered `screens.LoginScreen` + `screens.SignupScreen`.

**Critical-path note:** Login + Signup are the gates to the entire app. Migration is render-extraction only — every handler is identical to pre-migration.

**Visual deltas vs legacy** (intentional): `Text`/`Icon`/`Spinner` primitives + token typography roles. Hardcoded gradient + saturated-green CTA buttons retained — no token equivalent for `rgba(41, 164, 0, 1)`.

**Validation:** all 5 touched files Babel-parse cleanly.

**Behavior change in app:** functionally equivalent.

**Next:** Phase F batch 3 — SignUpRADetails + PhoneNumberScreen. Then ChangeAdvisor. Then Phase E.2 — HomeScreen.

### Added — design-system Phase F batch 1: 4 clean-extract auth screens + TermsModal

**Files added:**

- `designs/default/screens/LogOutScreen.js` — pure spinner (Spinner primitive + Text). ~50 lines.
- `designs/default/screens/EmailScreenAppleLogin.js` — email form for Apple Sign-In's hidden-email flow. ~140 lines.
- `designs/default/screens/ResetPassword.js` — Forgot Password form with gradient hero + decorative circles + multi-format logo handling. ~190 lines.
- `designs/default/composites/TermsModal.js` — Terms & Conditions modal. Uses `Button` (variant=secondary) for the Accept CTA, `Icon` for X-close, `Text` for headings/body. Hardcoded terms data lives in the container. ~120 lines.

**Files modified (containers, all rewritten as thin):**

- `src/screens/Authentication/LogOutScreen.js` — owns Firebase signOut + GoogleSignin.signOut (best-effort) + AsyncStorage clear + 7 context-state resets + navigate to Login. Renders `useComponent('screens.LogOutScreen')`.
- `src/screens/Authentication/EmailScreenAppleLogin.js` — owns email validation + route.params.onSubmit dispatch. Renders `useComponent('screens.EmailScreenAppleLogin')`.
- `src/screens/Authentication/ResetPassword.js` — owns Firebase sendPasswordResetEmail + form state. Renders `useComponent('screens.ResetPassword')`.
- `src/screens/Authentication/TermsModal.js` — owns the hardcoded terms data + preserves the legacy `{ modalVisible, setModalVisible, setIsChecked }` prop signature so SignupScreen (the consumer) needs no change. Renders `useComponent('composites.TermsModal')`.
- `designs/default/index.js` — registered `composites.TermsModal`, `screens.ResetPassword`, `screens.EmailScreenAppleLogin`, `screens.LogOutScreen`.

**Pattern:** identical container/presentation contract used in Phase E.1 OrderScreen. Container holds hooks/state/effects/orchestration; presentation receives `viewModel + actions` and renders pure JSX. Variant-aware via the registry.

**Visual deltas vs legacy** (intentional, design-system goal):

- Token-driven colors where mapping is unambiguous (text colors, borders, modal bg). Kept hardcoded greens / purples for the gradient hero + submit buttons since they don't map to any current token (legacy used `rgba(41, 164, 0, 1)` for Send Link / Continue — preserved).
- All `<Text>` usages converted to the `Text` primitive with token typography roles + per-instance style overrides for fontFamily/fontSize where the legacy diverges from the standard scale.

**Validation:** all 9 touched files Babel-parse cleanly with project config.

**Behavior change in app:** functionally equivalent. ResetPassword form behaves exactly as before; LogOutScreen still auto-fires logout on mount; EmailScreenAppleLogin still calls `route.params.onSubmit`; TermsModal still triggers `setIsChecked(true)` on Accept.

**Doc trio updated:** `DESIGN_SYSTEM_ARCHITECTURE.md § Migration order` (Phase F partial — batch 1 shipped), `DESIGN_COMPONENT_AUDIT.md § Section 3 Authentication` (4 rows marked migrated), `DESIGN_MIGRATION_PROGRESS.md` (Phase F batch 1 entry).

**Next:** Phase F batch 2 — LoginScreen + SignupScreen (paired, same orchestration shape). Then batch 3: SignUpRADetails + PhoneNumberScreen. Then ChangeAdvisor (Account section). Then Phase E.2 — HomeScreen.

### Perf — design-system Phase E.1 follow-up #2: OrderScreen search via `useDeferredValue`

**Bug:** even after the React.memo + useCallback fixes (previous commit), search felt "a bit laggy" on long lists. The remaining cost: every keystroke still triggered a full filter + FlatList prop-diff.

**Fix:** `designs/default/screens/OrderScreen.js` now uses React 19's `useDeferredValue` to lag `searchText` behind the TextInput. The input updates synchronously for visual responsiveness; the filter consumes `deferredSearchText` which catches up when the user pauses. During fast typing, FlatList sees a stable `data` reference and doesn't re-render rows.

**Bonus:** moved `searchText.toLowerCase()` out of the per-row filter loop into a single computation per filter pass.

**Validation:** Babel-parse clean. React 19.0.0 + RN 0.78.3 confirmed in package.json so `useDeferredValue` is available.

**Why this lands as a separate commit from the memoization fix:** the memoization fix was the structural one (memo + useCallback). `useDeferredValue` is a behavioural-deferral on top of that. Splitting them lets a future bisect locate which optimization is the source of any regression.

### Perf — design-system Phase E.1 follow-up: OrderScreen search/list memoization

**Bug:** typing in OrderScreen's search box was visibly laggy on lists of 30+ orders. Same issue affected delete/remove. User-reported during Phase E.1 QA on emulator.

**Root cause:** standard FlatList anti-pattern. On every keystroke, `setSearchText` re-renders the presentation, which (a) creates a new `renderItem` function reference, (b) creates a new `actions` object reference, (c) creates a new `openDdpiHelp` function reference. FlatList sees a new `renderItem` → re-renders every visible row. Each row's OrderRow rebuilds its JSX + token reads → laggy. Legacy OrderScreen had the same issue but it wasn't surfaced until the migration's QA pass.

**Fix:**

- `designs/default/composites/OrderRow.js` — wrapped in `React.memo` with a custom comparator (`item` / `color1` / `color2` / `onDdpiHelpPress` reference equality). Rows only re-render when their props actually change.
- `designs/default/screens/OrderScreen.js` — `renderItem` wrapped in `useCallback([openDdpiHelp])`. Reference is stable across keystrokes.
- `src/screens/Home/OrderScreen.js` (container) — `openDdpiHelp` wrapped in `useCallback([openModal])`, `actions` and `viewModel` wrapped in `useMemo` so their references are stable across container re-renders.

**Validation:** all 3 touched files Babel-parse cleanly. Behavioural test: typing in the search box should now feel responsive even with 30+ orders.

**Pattern note for future screen migrations:** any FlatList-backed screen following the container/presentation contract MUST memoize:
- `renderItem` via `useCallback`
- per-row composite via `React.memo`
- container actions object via `useMemo`
- container `openX` callbacks via `useCallback`

Otherwise every parent re-render busts row identity. This belongs in the screen-level template the architecture doc describes.

### Refactor — design-system Phase E prep: HomeScreen state consolidation (useHomeScreenTabs + useHomeScreenModals)

**Files added:**

- `src/screens/Home/hooks/useHomeScreenTabs.js` — consolidates HomeScreen's `selectedTab` + 7 see-all overlay booleans behind a single `overlay: string | null` state with backward-compat boolean shims for every legacy name (`seeAllBespoke` / `seeAllBespokeplan` / `seeAllMP` / `seeAllMPplan` / `seeAllBlogs` / `seeAllVideos` / `seeAllPDFs`). Idempotent-close shim: `setSeeAllX(false)` only closes if X is the active overlay.
- `src/screens/Home/hooks/useHomeScreenModals.js` — consolidates 4 modal-visibility booleans (`showEthicalList` / `showUpdateModal` / `videoModalVisible` / `pdfModalVisible`) behind `{ activeModal, activeModalData }` with the same shim pattern.

**Files modified:**

- `src/screens/Home/HomeScreen.js` — 12 useState declarations replaced by 2 hook calls (destructured to expose the same legacy names). ~30 references to those names elsewhere in the 2631-line file are unchanged thanks to the shims.

**Why shims instead of a full call-site refactor:** the hook + shim approach is a ~30-line diff in HomeScreen.js. A real refactor of every legacy name would touch 60+ references. High regression risk for a prep step whose purpose is to make Phase E.2 SAFER. Phase E.2 will do the real refactor when it splits the screen — shims naturally migrate to the canonical viewModel API in the presentation.

**No `designs/` migration in this commit** — internal refactor only. HomeScreen.js still owns all its data deps, useEffects, and inline rendering. Phase E.2 will do the split.

**What this unblocks:** Phase E.2's viewModel can expose `overlay`, `activeModal`, `activeModalData` cleanly instead of trying to flatten 12 booleans into the contract.

**Validation:** all 3 touched files Babel-parse cleanly. `useState` grep against the 12 consolidated names returns zero residual declarations.

**Behavior change in app:** zero. Shims preserve legacy semantics exactly (true → open, false → close-if-active).

**Doc trio updated:** `DESIGN_SYSTEM_ARCHITECTURE.md § Migration order` (E.1.5 prep refactor logged), `DESIGN_COMPONENT_AUDIT.md § HomeScreen risks` (modal/tabs consolidation marked ✅ done), `DESIGN_MIGRATION_PROGRESS.md` (Phase E prep entry).

### Added — design-system Phase E.1: OrderScreen migration (container/presentation split + OrderRow composite)

**Files added:**

- `src/utils/orderUtils.js` — `isToday`, `formatSymbol`, `formatOrderDate`, `getStatusColors`.
- `designs/default/composites/OrderRow.js` — legacy `OrderItem` extracted. Uses `Pill` (profit/loss for BUY/SELL), `Icon` (lucide Check/X/Pause replaces vector-icons), `Text` primitives + `useTokens`.
- `designs/default/screens/OrderScreen.js` — presentation. Search row + FlatList + empty-state hero. Inline `BasketRow` helper.

**Files modified:**

- `src/screens/Home/OrderScreen.js` — rewrote as ~120-line container (was 1195). Owns hooks/state/effects/viewModel/actions. Renders via `useComponent('screens.OrderScreen')`.
- `designs/default/index.js` — registered `composites.OrderRow` + `screens.OrderScreen`.

**~900 lines of dead code removed in same commit:** PanResponder + tab system (callbacks always returned `false`), `imageUrl` / `isModalOpen` / `MODAL_STATE` EventEmitter listener (consumed only by dead PanResponder), `renderStatusIcon` orphan, `fetchUserProfile` (set state never read).

**Visual deltas vs legacy** (intentional, design-system goal):

- BUY/SELL pill switched to `Pill` primitive — pills go from white-on-saturated-bg to dark-text-on-pastel-bg. Pass `style` override if pixel-perfect parity is needed.
- Status icons switched from vector-icons AntDesign to lucide.
- Other layout unchanged.

**Pattern validation:** container/presentation split + extracted composite + extracted utils + registry-resolved screen + variant-aware. Sets template for Phase E.2 (HomeScreen) and Phase F (Auth screens).

**Validation:** all 5 touched files Babel-parse cleanly.

**Doc trio updated:** `DESIGN_SYSTEM_ARCHITECTURE.md § Migration order` (Phase E split into E.1 ✓ + E.2 pending), `DESIGN_COMPONENT_AUDIT.md` (OrderScreen + OrderRow rows updated to Migrated), `DESIGN_MIGRATION_PROGRESS.md` (Phase E.1 entry).

### Added — design-system Phase D: first composite end-to-end (`RebalanceDetailsModal`)

**Files added:**

- `designs/default/composites/RebalanceDetailsModal.js` — first migrated composite. Uses `Button` / `Icon` / `Text` primitives (Phase C) + `useTokens()` (Phase A). RN `Modal` kept as the shell (`ModalShell` primitive deferred to Phase H).

**Files modified:**

- `designs/default/index.js` — `components` map registers `composites.RebalanceDetailsModal`.
- `src/UIComponents/RebalanceAdvicesUI/RebalanceCard.js` — consumer updated to resolve via `useComponent('composites.RebalanceDetailsModal')` instead of a direct import.
- `src/screens/Drawer/IgnoreTradesScreen.js` — removed a dead `import IgnoreStockCard ...` line (the screen actually renders `<StockAdvices type="Ignore" />` — IgnoreStockCard was never used).

**Files deleted:**

- `src/components/AdviceScreenComponents/RebalanceDetailsModal.js` — replaced by the new composite; single consumer migrated.
- `src/components/IgnoreStockCard.js` — dead code. Was Phase D's originally-planned candidate; migration discovered zero consumers across the entire codebase.

**Pivot story:**

Audit doc recommended `IgnoreStockCard` as Phase D's first composite. Migrated it cleanly, then discovered the only import (in `IgnoreTradesScreen.js`) was dead — the screen renders `<StockAdvices type="Ignore" />`, never the `IgnoreStockCard` component. Pivoted to `RebalanceDetailsModal`. New audit-doc policy footnote: future passes MUST verify consumer count, not just data-dep analysis. `BrokerConnectCard.js` flagged "likely dead code" — verify and delete in a follow-up if confirmed.

**Visual deltas vs legacy** (intentional, design-system goal):
- Tag bg / Close button bg flow from `tokens.colors.brand.gradientEnd` (replaces `config.gradient2`).
- All hardcoded colors flow from `tokens.colors.*` mappings.
- Modal-container border radius now `tokens.radii.lg` (12) — was 20.

**Pattern validation (Phase D's goal):** end-to-end confirmed. Composite in `designs/default/composites/`, registered with dot-namespaced key, consumer resolves via `useComponent`, legacy deleted, variant-aware.

**Validation:** all 4 touched files Babel-parse cleanly. Runtime smoke-test pending.

**Doc trio updated:** `DESIGN_SYSTEM_ARCHITECTURE.md` (Phase D shipped), `DESIGN_COMPONENT_AUDIT.md § Section 2` (RebalanceDetailsModal Migrated, IgnoreStockCard DELETED, BrokerConnectCard "likely dead", new consumer-verification footnote), `DESIGN_MIGRATION_PROGRESS.md` (Phase D entry with pivot lessons).

**Next:** Phase E — HomeScreen + OrderScreen.

### Added — design-system Phase C: 9 primitives shipped (Text, Button, Card, Input, Spinner, Icon, Pill, Divider, Toast)

**Files added** (`designs/default/primitives/`):

- `Text.js` — wraps RN `<Text>` with typography-token variant. 8 variants: `heading` / `title` / `subtitle` / `body` (default) / `bodyEmphasis` / `caption` / `muted` / `button`.
- `Button.js` — wraps `TouchableOpacity`, auto-renders `Text variant="button"` for the label. Variants: `primary` (default) / `secondary` / `ghost` / `destructive`. Disabled state uses `text.disabled` colour for bg.
- `Card.js` — `<View>` with token-driven padding/radius. Variants: `default` (soft card shadow) / `elevated` (heavier shadow) / `outlined` (1px border, no shadow).
- `Input.js` — wraps `TextInput`. Variants auto-apply `secureTextEntry` / `keyboardType` / `maxLength` / `autoCorrect` / `autoCapitalize`. Variants: `text` (default) / `password` / `numeric` / `otp`.
- `Spinner.js` — `inline` (default) returns bare `ActivityIndicator`; `overlay` returns absolute-positioned scrim + centered spinner.
- `Icon.js` — **caller-passes-component pattern** (`Component` prop). Reason: a wildcard `import * as` from `lucide-react-native` would force every lucide icon into the Metro bundle. The primitive only owns size/color defaults; the caller imports the specific lucide icon at the call site, preserving tree-shaking.
- `Pill.js` — `<View>` + nested `<Text variant="caption">`. Variants: `neutral` (default) / `profit` (BUY badges, P&L positive) / `loss` (SELL badges, P&L negative) / `warning`.
- `Divider.js` — `solid` (default) is a filled 1px line; `dashed` uses RN's `borderStyle: 'dashed'` on a bordered View.
- `Toast.js` — **imperative API**, not a React component. `Toast.show(message, variant, options?)`. Wraps `react-native-toast-message`. Variants: `info` (default) / `success` / `warning` (maps to RN-toast-message's `error` type) / `error`. Existing `src/components/customToast.js` is left untouched — Phase C is purely additive.

**Files modified:**

- `designs/default/index.js` — `components` map now registers all 9 primitives under `primitives.<Name>` keys (e.g. `primitives.Button`, `primitives.Toast`). Composite and screen layers remain empty pending Phase D+.

**API conventions (uniform across all primitives):**

- `variant` prop with a fixed set of named choices (no free-form variants — adding a new one requires updating the architecture doc + audit Section 1).
- `style` prop merges AFTER the variant style (caller wins — variants cannot block overrides).
- `...rest` passthrough (accessibility, testID, RN-standard props).
- Token reads via `useTokens()` (Phase A) — never reads colour hex directly.

**Validation:** all 10 new/modified files Babel-parse cleanly with the project's babel config.

**Behavior change in app:** zero. No call sites updated. The 9 primitives are registered in the registry but no consumer currently calls `useComponent('primitives.*')`. Existing `<TouchableOpacity>`, raw `<Text>`, `<TextInput>`, `<ActivityIndicator>`, `customToast.js` patterns all continue to render exactly as before.

**Call-site migration policy** (codified in architecture doc): **opportunistic, not scheduled**. When a screen or component is touched for any reason, callers SHOULD migrate ad-hoc patterns to the matching primitive in the same commit. New code MUST use primitives. Wholesale sweeps (e.g. "replace every raw `<Text>` in `src/`") are explicitly NOT scheduled — high-volume, regression-prone, no incremental user value over opportunistic migration.

**Why ship 9 in one drop instead of one-at-a-time:** each primitive is small (~60 lines), the API conventions are uniform, and zero call sites change. Designing them together produces a coherent API surface; piecemeal would create 9 PR cycles for no review-confidence gain. Risk is bounded because the change is purely additive.

**Doc trio updated:**

- `docs/DESIGN_SYSTEM_ARCHITECTURE.md § Primitives` — table replaces prose catalog. Each primitive lists variants + Phase C status. New § "How to consume a primitive in new code" + § "Call-site migration policy" subsections.
- `docs/DESIGN_SYSTEM_ARCHITECTURE.md § Migration order` — Phase C marked shipped.
- `docs/DESIGN_COMPONENT_AUDIT.md § Section 1` — full rewrite. All shipped primitives show "✅ Shipped" with file path + pre-existing call-site count. Verdict tally `needs-creation` row updated to 0 (was 8).
- `docs/DESIGN_MIGRATION_PROGRESS.md` — Phase C entry: per-primitive notes, Icon's tree-shake-preserving design rationale, behavior-change zero, opportunistic-migration policy.

**Next:** Phase D — one composite end-to-end (recommended starting candidate: `IgnoreStockCard`). Validates the container/presentation split pattern. Followed by parallel audit-task queue work (Drawer screens, composite catalog, MP-screen viewModel sketches).

### Added — design-system Phase B: `DesignProvider` skeleton + registry + `useComponent`

**Files added:**

- `src/design/DesignProvider.js` — React context provider for the design-system registry. Uses `useRef` to freeze the resolved registry at mount (variant switching is not supported in v1 — matches how `APP_VARIANT` works today). Variant selection: `<DesignProvider variant="...">` prop → `DESIGN_VARIANT` env var → `APP_VARIANT` env var → `default`. Each selection carries a `source` field so the resolver shapes its dev-warning correctly.
- `src/design/resolveDesign.js` — pure resolver. Throws at startup if `designs/default/` is missing from the registry (contract floor enforcement). Shallow-merges variant's `components` over default's; layer-merges tokens by top-level key. Dev-warning fires only when source is `prop` or `DESIGN_VARIANT` (explicit design selectors). Silent fallback when source is `APP_VARIANT` — `APP_VARIANT` is a business-config selector and not having a design folder for every business variant is the normal case, not a misconfiguration.
- `src/design/useDesign.js` — exports `useDesign()` (returns `{ variant, tokens, components }`) and `useComponent(key)` (returns implementation, throws clear error if key missing in active variant or default). Both hooks throw clear errors when used outside the provider.
- `designs/default/index.js` — default variant root. `tokens` re-exported from existing `designs/default/tokens/` (Phase A). `components` map is empty in Phase B; Phase C populates it primitive-by-primitive.
- `designs/registry.js` — static variant map. Today: just `default`. Tenants register custom variants by adding an import line.

**Files modified:**

- `App.js` — added `import DesignProvider from './src/design/DesignProvider';`. Wrapped the existing provider tree with `<DesignProvider>`, placed inside `GestureHandlerRootView` and outside `SocialProofProvider`. Outside `ConfigProvider` because variant selection is build-time only in v1 (backend per-tenant variant override is deferred).

**Validation:** all 6 new/modified files Babel-parse cleanly with the project's babel config. Stub-registry smoke test of `resolveDesign` confirmed correct behavior on all 4 cases: default fallback, registered variant override, missing variant with `DESIGN_VARIANT` source (warns + falls back), missing variant with `APP_VARIANT` source (silent fallback).

**Behavior change in app:** zero. The provider is mounted but `components` map is empty, so no consumer calls `useComponent`. The app behaves identically to pre-Phase-B.

**Doc trio updated:**

- `docs/DESIGN_SYSTEM_ARCHITECTURE.md § Registry` — rewritten with actual file paths and the design rules that landed (frozen-at-mount via `useRef`, null default context, source-aware dev-warnings, layer-merge for tokens). § Migration order Phase B marked shipped.
- `docs/DESIGN_MIGRATION_PROGRESS.md` — Phase B entry: code drop, validation results, provider-stack diagram showing the new placement, deferred ConfigContext-driven variant selection.
- `docs/DESIGN_COMPONENT_AUDIT.md` — no changes needed (audit doc tracks UI-surface migrations, not the provider plumbing itself).

**Next:** Phase C — primitives. Order: `Toast` → `Text` → `Button` → `Card` → `Input` → `Spinner` → `Icon` → `Pill` → `Divider`. Each primitive lands as implementation file + registry entry + opportunistic call-site updates.

### Policy — design-system: MP-freeze lifted, Model Portfolio surfaces pulled into migration scope

**Decision (2026-05-01):** Model Portfolio + rebalance surfaces are no longer frozen out of the design-system migration. They get migrated alongside everything else, on the same container/presentation contract, scheduled last as Phase I.

**Risk explicitly accepted:** if the SDK MP plan firms up later (per `docs/SDK_MOBILE_FIT_ASSESSMENT.md`), the design-system work on the affected surfaces will be partially or fully thrown away. Highest-risk surfaces flagged in their audit notes — primarily `RebalanceModal` and `RebalanceCard` (calculate-rebalance UX is the most likely SDK absorption target). The trade-off: a consistent fully-tenant-skinnable app today vs. a two-tier UX waiting on an undecided SDK plan. Product chose consistency.

**Verdict reshuffling:** ~38 surfaces previously flagged `SDK-pending` re-verdict-ed by data deps. ~12 → `clean-extract`, ~26 → `needs-logic-extraction`. The verdict `SDK-pending` is retained but its definition narrows — it now applies only to surfaces with an active, committed Phase 3 SDK migration in flight. As of today, zero surfaces hold this verdict.

**New verdict tally:** ~30 `clean-extract`, 8 `needs-creation` (primitives), ~50 `needs-logic-extraction`, 0 `SDK-pending`, ~30 `SDK-bound-skip` (Phase 3 lane unchanged), ~2 `defer`, ~20 TBD. Total in scope: ~88 (roughly doubled from pre-unfreeze ~50).

**Files updated** (no code changes — docs + memory only):

- `CLAUDE.md` — § Design System Migration blocking-rule on MP migration removed; replaced with an MP-aware note. Session checklist box updated.
- `docs/DESIGN_SYSTEM_ARCHITECTURE.md` — § What surfaces are in scope vs deferred rewritten; new "Note on MP and the SDK — accept the risk" subsection. § Verdict legend's `SDK-pending` definition narrowed. § Migration order Phase I redefined from "Reassess MP freeze" to "MP screens".
- `docs/DESIGN_COMPONENT_AUDIT.md` — Section 7 (ModelPortfolioComponents — all 20 files) full rewrite; Section 4 (6 modal rows); Section 5 (8 advice-component rows including 2 borderline resolutions); Section 3 (MP screens block); Section 8 (RebalanceAdvicesUI subfolder); Drawer-screens TBD list; verdict legend; "how to fill a row" rule #4; audit-task queue (task D resolved, G + H added); verdict tally.
- `docs/DESIGN_MIGRATION_PROGRESS.md` — policy-change entry dated today.
- `~/.claude/projects/-home-pratik-PycharmProjects-Alphab2bapp/memory/project_mp_sdk_pending.md` — rewritten to reflect new policy. Memory now records "MP in scope; future SDK migration is a known risk" instead of the prior freeze.

**What did NOT change:** Phase 3 SDK-bound surfaces remain `SDK-bound-skip` (Phase 3 contract unchanged). The architecture's 4-layer model, registry contract, container/presentation split rule, and SDK boundary are all unchanged. Phase A token bundle is unchanged.

### Added — design-system Phase A: token bundle (spacing / typography / radii / shadows + `useTokens()`)

**Files added:**

- `src/theme/spacing.js` — `DEFAULT_SPACING` (`none` 0 / `xs` 4 / `sm` 8 / `md` 12 / `lg` 16 / `xl` 24 / `xxl` 32 / `xxxl` 48) + `buildSpacing(config)`.
- `src/theme/typography.js` — `DEFAULT_TYPOGRAPHY` with 8 roles (`heading` / `title` / `subtitle` / `body` / `bodyEmphasis` / `caption` / `muted` / `button`). Default fontFamily is **Poppins** (full weight set already shipped in `android/app/src/main/assets/fonts/`). `buildTypography(config)` deep-merges `config?.typographyTokens`.
- `src/theme/radii.js` — `DEFAULT_RADII` (`none` / `sm` 4 / `md` 8 / `lg` 12 / `xl` 16 / `pill` 999) + `buildRadii(config)`.
- `src/theme/shadows.js` — `DEFAULT_SHADOWS` (`none` / `card` / `elevated` / `modal` / `floating`). Each token sets BOTH iOS shadow keys AND Android `elevation`. `buildShadows(config)` deep-merges `config?.shadowTokens`.
- `src/theme/useTokens.js` — composite hook returning `{ colors, spacing, typography, radii, shadows }`. Memoized on the colors deps from `useColors.js` plus the four future-override config fields.
- `designs/default/tokens/index.js` — registry-facing re-exports of all five token modules. The `DesignProvider` (Phase B) will import from here.

**Why Phase A is purely additive:** zero call-site changes. Existing `useColors()` continues to work unchanged. Components opt into `useTokens()` going forward. ConfigContext is NOT extended in this PR — the `build*()` functions are config-aware so backend overrides land trivially in a future PR, but today `spacingTokens` / `typographyTokens` / `radiiTokens` / `shadowTokens` resolve to `undefined` for all tenants and defaults apply.

**Doc fix in same commit**: `docs/DESIGN_SYSTEM_ARCHITECTURE.md § Tokens` cited `Inter-Regular` etc. in its example. The repo actually ships **Poppins** + **Satoshi**, not Inter. Section rewritten to describe the actual two-layer setup (implementation in `src/theme/`, registry-facing surface in `designs/<variant>/tokens/`) and the `DEFAULT_*` shapes that landed today.

**Doc trio updated** (per the design-system blocking-doc rule in CLAUDE.md):

- `docs/DESIGN_SYSTEM_ARCHITECTURE.md` — § Tokens rewritten with actual file paths and shapes; § Layer model row for Tokens now reads "Phase A complete"; § Migration order Phase A marked shipped.
- `docs/DESIGN_COMPONENT_AUDIT.md` — already covers Phase A primitives in Section 1 (no row changes needed for Phase A token landing — the audit doc tracks COMPONENT migrations, not token files which are already in scope by virtue of being in `src/theme/` + `designs/default/tokens/`).
- `docs/DESIGN_MIGRATION_PROGRESS.md` — entry added describing Phase A code drop, doc fixes, deferred ConfigContext passthrough, and Phase B as the next step.

**Next**: Phase B — `DesignProvider` skeleton at `src/design/DesignProvider.js`, wired under `AppProvider`. Empty registry. No component registrations yet. Then Phase C primitives starting with `Toast` (only existing `clean-extract` per the audit).

### Docs — design-system audit-task pass complete (no code change)

The 11 open audit tasks from the initial draft of `docs/DESIGN_COMPONENT_AUDIT.md` were the gate before any Phase A code. All resolved. Findings:

- **Primitive fragmentation is high.** 1,248 raw `TouchableOpacity`, 2,123 raw `Text`, 199 `ActivityIndicator`, 151 `TextInput` — Phase C will be high-volume call-site updates. Only `customToast.js` is a usable existing primitive (becomes `Toast`).
- **Modal-shell consolidation deferred to Phase H.** The two existing shell candidates are SDK-bound (`CrossPlatformOverlay`) or unused (`BrokerOverlay`).
- **`OrderScreen`, `WatchlistScreen`, `ResetPassword`, `LogOutScreen`, `EmailScreenAppleLogin`, `TermsModal`, `HoldingScoreModal` are `clean-extract`** — recommended Phase E/F kickoff before tackling `HomeScreen` (which is `needs-logic-extraction` and needs prep refactor).
- **All 20 `ModelPortfolioComponents/` confirmed `SDK-pending`.** `RecommendationSuccessModal` is cross-imported by 5 non-MP advice surfaces but its spec is locked to MP/rebalance trade-success display — frozen with the rest.
- **`StepProgressBar` all 4 call sites are MP/rebalance** — `SDK-pending`, no exception.
- **`ReviewTradeModal` is `needs-logic-extraction`** (used in non-MP `StockAdvices.js` and `AddtoCartModal.js`).
- **`BrokerOverlay.js` is unused (0 imports)** — candidate for deletion in a separate cleanup PR.
- **Two borderline rows queued for verification:** `RebalanceDetailsModal.js` and `RepairConfimationModal.js` (names suggest rebalance coupling; default to `SDK-pending` if call sites are exclusively rebalance).

New audit-task queue opened in `DESIGN_COMPONENT_AUDIT.md § 9` for Drawer screens, composite catalog, `KnowledgeHubScreen/` subfolder, and `AccountSettingScreen/` parent — to land before Phase G.

### Docs — design-system architecture: bring-your-own-UI doc trio + CLAUDE.md blocking rule

**Files added (docs only — no code change):**

- `docs/DESIGN_SYSTEM_ARCHITECTURE.md` — design source of truth for the swappable-UI refactor. Defines a 4-layer model (tokens / primitives / composites / screens), a `DesignProvider` registry that resolves component keys to implementations under `designs/<variant>/` with `designs/default/` as fallback, and a strict container/presentation split rule. SDK-bound surfaces (`Phase3SdkBrokerModal`, all SDK widgets, all legacy `BrokerConnectionModal/*` and `UIComponents/BrokerConnectionUI/*`) are explicitly OUT of `designs/`. Variant selection via `DESIGN_VARIANT` env var (falls back to `APP_VARIANT`, then `default`); build-time only in v1. Backend per-tenant overrides extend from `colorTokens` (existing) to `spacingTokens` / `typographyTokens` / `radiiTokens` (planned). Migration is staged A→I, sequential.
- `docs/DESIGN_COMPONENT_AUDIT.md` — per-surface inventory matrix mirroring `PHASE3_BROKER_AUDIT.md`. Verdicts: `clean-extract` / `needs-logic-extraction` / `SDK-bound-skip` / `SDK-pending` / `defer`. ~25 surfaces flagged `SDK-bound-skip` (all Phase 3 surfaces), ~25 flagged `SDK-pending` (Model Portfolio + rebalance flows, see below), ~15 in-scope `needs-logic-extraction`, ~40 TBD pending audit-task pass (11 audit tasks listed).
- `docs/DESIGN_MIGRATION_PROGRESS.md` — chronological work log mirroring `PHASE3_PROGRESS.md`. Today's entry is the design-doc landing.

**Model Portfolio freeze (FYI from product):** all MP surfaces — calculate-rebalance, MP review trade, MP performance, `ModelPortfolioComponents/*` (15 files), `RebalanceCard`, `RebalancePreferenceModal`, `RebalanceModal`, `RebalanceAdviceContent`, `RebalanceAdvices`, `MPReviewTradeModal`, `ModelPFCard`, `ModelPortfolioScreen`, `MPPerformanceScreen`, `CustomTabbarMPPerformance`, `EmptyStateMP` — flagged `SDK-pending`. They are likely future SDK migrations alongside broker-connect (per `SDK_MOBILE_FIT_ASSESSMENT.md`); migrating them to `designs/` now would be thrown-away work. They stay in `src/` with current shape until the SDK MP plan firms up.

**CLAUDE.md updated:** added the design-system blocking-doc rule (mirrors the Phase 3 rule) so the next code change in this area can't bypass the audit + architecture + progress trio.

**Rationale**: docs-first because this is a fan-out refactor that touches ~80+ UI surfaces. The Phase 3 trio is the proven template — undocumented Phase 3 commits caused every Phase 3 regression we just fixed. Same template here, applied before any code lands. Mandated session-checklist boxes will fail-loud if a future commit slips in code without updating these three docs.

**Next:** the 11 audit tasks in `DESIGN_COMPONENT_AUDIT.md § Open audit tasks` (HomeScreen viewModel sketch, primitive inventory pass, etc.). All doc work — no code yet.

### Fixed — TIDI BACKEND CROSS-REPO: SDK `/login-url` proxy field-name mismatch on `redirect_uri` vs `redirect_url` — Fyers + Motilal silently got `broker_login_url_missing`

**Stacked on `d49568a` uid-resolve and Alphab2bapp `570e45d` autojump-
encrypt.** After the uid + encryption layers were in place, `testaccount@
gmail.com` Fyers re-auth surfaced a NEW error: "your broker did not
return a login url" (mapped from `broker_login_url_missing` 502). The
inner `/api/fyers/update-key` returned 200 (no timeout this time), but
ccxt's response had no usable URL — because the request to ccxt was
made with `redirectUrl: undefined`.

**Root cause** — per-broker audit of legacy `/api/<broker>/update-key`
body field names:

| Broker | Reads from `req.body` |
|--------|------------------------|
| Upstox | `uid`, `apiKey`, `secretKey`, **`redirect_uri`** |
| Fyers | `uid`, `clientCode`, `secretKey`, **`redirect_url`** |
| HDFC | `uid`, `apiKey`, `secretKey` (no redirect needed — mints URL from apiKey) |
| Motilal Oswal | `uid`, `apiKey`, `clientCode`, **`redirect_url`** |

The SDK proxy's shared else-branch (Upstox/Fyers/HDFC/Motilal) was
sending only `redirect_uri: redirectUrl`. Fyers + Motilal both read
`data.redirect_url` (undefined) → forwarded `redirectUrl: undefined`
to ccxt `/fyers/login-url` (or `/motilal-oswal/login`) → ccxt returned
empty / null URL → SDK proxy extracted no `loginUrl` → returned `502
broker_login_url_missing` to mobile.

ICICI Direct, Zerodha, Dhan, AliceBlue, Axis Securities, Groww, Angel
One have their own dedicated SDK branches with correct per-broker
field shapes; not affected.

**Fix (cross-repo on tidi `aq_backend_github`, branch `Ibt-branch`,
commit `1154a96`)** — send BOTH `redirect_uri` AND `redirect_url` in
the SDK proxy's `legacyBody`. Each broker reads only the key its
route was written to use; the other is ignored. Cleaner than
per-broker branching for one field difference.

**File patched on tidi**:

- `Routes/sdk/v1/connections.js` (+12/-1) — SDK `/login-url` Upstox/
  Fyers/HDFC/Motilal shared else-branch now includes `redirect_url`
  alongside `redirect_uri`.

**Mobile-side change** — none.

**Deploy** — committed + pushed + `sudo systemctl restart
alphaquark.service` on tidi. Service active post-restart.

**4-stacked-bug retrospective** (full chain of the same UX symptom
"server hit an unexpected error / spinner / no login URL"):
1. `connected_brokers[<broker>].apiKey` empty (legacy update-key wrote
   only to top-level) → smart-reauth fallback to form. Tidi `b17cde0`.
2. Autojump sent decrypted plaintext → `checkValidApiAnSecret` got
   garbage → ccxt hung 25s. Alphab2bapp `570e45d`.
3. SDK proxy passed `uid: undefined` → legacy `/update-key` silently
   hung (no else branch on `if (data.uid)`). Tidi `d49568a`.
4. SDK proxy passed `redirect_uri` only → Fyers + Motilal read
   `redirect_url` → forwarded undefined to ccxt → ccxt returned no URL
   → `broker_login_url_missing` 502. Tidi `1154a96` (this entry).

Lesson: when ALL legacy routes share a "common" field-name contract,
verify each route actually agrees on the field name. The SDK proxy
inherited an Upstox-shaped body and assumed Fyers/Motilal followed
the same shape. Per-route field audit takes 5 min; debugging
production via logs takes hours.

---

### Fixed — TIDI BACKEND CROSS-REPO: SDK `/login-url` proxy was passing `uid: undefined` to legacy `/api/<broker>/update-key` → silent hang → 25s timeout → "unexpected error" (Upstox / Fyers / HDFC / Motilal)

**Stacked on the autojump-encrypt fix below.** After re-encrypting the
autojump extras (Alphab2bapp `570e45d`) the body finally arrived at
`/api/upstox/update-key` with valid AES-encrypted apiKey + secretKey,
but the SDK proxy was STILL hanging the full 25s on `_selfCallLegacy`.
Backend log on tidi against `testaccount@gmail.com`:

```
[POST /sdk/v1/connections/Upstox/login-url] AxiosError: timeout of 25000ms exceeded
url: 'http://localhost:8001/api/upstox/update-key'
data: '{"user_email":"testaccount@gmail.com","user_broker":"Upstox",
       "apiKey":"U2FsdGVkX1/6R89...",   ← encrypted ✅
       "secretKey":"U2FsdGVkX19Dtfqn...", ← encrypted ✅
       ...}'                              ← but no `uid` field
```

**Root cause** (backend on tidi `aq_backend_github`):

The legacy `/api/<broker>/update-key` routes for **Upstox, Fyers, HDFC,
Motilal Oswal** all share a pattern:

```js
const updateKeyLogic = async (req, res) => {
  try {
    var data = req.body;
    if (data.uid) {
      // ... ccxt call + DB write + res.status(200).send(...)
    }
    // NO else branch, NO catch-all res.send — when uid is missing
    // the route silently never sends a response. Express keeps the
    // connection open. The caller hangs.
  } catch (err) { res.status(500)... }
};
```

The SDK proxy block in `Routes/sdk/v1/connections.js` (Upstox/Fyers/
HDFC/Motilal `/login-url` branch, ~line 1304) was building the proxy
body as:

```js
const legacyBody = {
  uid: undefined,           // ← "legacy resolves uid from email"
  user_email: userEmail,
  ...
};
```

The inline comment "legacy resolves uid from email" was a **false
assumption** — those legacy routes never had email-based uid
resolution. Result: every SDK `/login-url` call for these 4 brokers
hung 25s on the inner `/update-key` proxy regardless of credential
correctness. The earlier autojump-plaintext bug (commit `570e45d`)
masked this by also hanging on undefined ccxt creds inside the `if
(data.uid)` block (which was reached only when the legacy form was
used, with a real uid coming from the mobile-side `getUserObjectId`
lookup) — once encrypted creds arrived from the autojump (which has
no uid plumbing because it bypasses the form's submit), the uid bug
surfaced cleanly.

**Why ICICI was unaffected** — ICICI's SDK `/login-url` branch builds
the OAuth URL inline (`https://api.icicidirect.com/apiuser/login?api
_key=<plain>`) using `decryptKey` on the stored encrypted apiKey from
`MultiBrokerService.getBrokerCredentials`. It never proxies to
`/api/icici/update-key` at all, so the uid bug couldn't bite it.

**Fix (cross-repo on tidi `aq_backend_github`, branch `Ibt-branch`,
commit `d49568a`)** — in the SDK proxy block, resolve uid from
userEmail using the same `connectDB(tenant.db_name) + UserModel
.findOne({email})` pattern the SDK `/connect` handler already uses
(`Routes/sdk/v1/connections.js:705`). Pass `uid: String(userDoc._id)`
to the legacy proxy. Returns `404 user_not_found` if email maps to no
user (cleaner failure than a 25s hang).

**File patched on tidi**:

- `Routes/sdk/v1/connections.js` (+29/-1) — SDK `/login-url` Upstox/
  Fyers/HDFC/Motilal branch now resolves uid via tenant DB lookup
  before calling `_selfCallLegacy` to `/api/<broker>/update-key`.

**Mobile-side change** — none.

**Deploy** — committed + pushed + `sudo systemctl restart
alphaquark.service` on tidi. Service active post-restart.

**Why this was a 3-stacked bug** — same root user-visible symptom
("server hit an unexpected error" + 25s spinner) had three independent
causes that revealed themselves in sequence as each prior layer was
fixed:
1. **`connected_brokers[<broker>].apiKey` empty** because legacy
   `/api/<broker>/update-key` only wrote to top-level `users.apiKey`
   (single-broker schema) → smart-reauth fallback to form path. Fixed
   in tidi `b17cde0` + Alphab2bapp `16342fd` doc entry.
2. **Autojump sent decrypted plaintext** to `/login-url`, which the
   legacy `/update-key` route's `checkValidApiAnSecret` re-decrypted
   into garbage → ccxt hung on undefined creds → 25s timeout. Fixed
   in Alphab2bapp `570e45d`.
3. **SDK proxy passed `uid: undefined`** to legacy `/update-key`,
   which guarded the entire body with `if (data.uid)` and silently
   never sent a response → 25s timeout. Fixed in tidi `d49568a` (this
   entry).

Lessons recorded for future SDK proxy work:
- **Never pass `uid: undefined` based on a comment that legacy "will
  resolve" something** — verify the legacy route actually does the
  resolution. Most legacy routes were written for a single-broker
  era and have rigid `uid` requirements with no email fallback.
- **Always make legacy routes return a clear 4xx when required fields
  are missing**, not silently never respond. The Upstox/Fyers/HDFC/
  Motilal `/update-key` routes silently no-op on missing uid — that's
  a separate hardening project (returning `400 missing_uid` would
  have made this bug debuggable in 2 minutes instead of 3 hours).

---

### Fixed — Phase 3 SDK autojump sent PLAINTEXT credentials to `/login-url`, hung 25s on `/api/<broker>/update-key` decrypt → "unexpected error" UX

**User-reported on `prod` tenant by `testaccount@gmail.com`.** After
disconnecting + reconnecting Upstox to populate
`connected_brokers[Upstox].apiKey/secretKey` (post the same-day backend
dual-write fix below), the next Re-auth tap showed the credential form
with apiKey + secretKey pre-filled, then a long loading spinner, then
"the server hit an unexpected error", then back to the same form. Same
behavior earlier for ICICI Direct.

**Root cause** (mobile-side, RN Phase 3 SDK lane):

`Phase3SdkBrokerModal.js`'s `buildOauthReauthExtras` (the autojump
helper that builds `extraExchangeBody` for `WebViewBrokerAuthFlow` from
stored `connected_brokers[<broker>]` data — see commit `004b406`) was
forwarding the values **decrypted** by `getStoredBrokerCreds`
(`src/utils/brokerCredentials.js:39`) directly into the extras object
WITHOUT re-encrypting them. The flow ended up:

1. Autojump fires for Upstox re-auth → `stored.apiKey = decryptValue
   (entry.apiKey)` = plaintext UUID, `stored.secretKey = decryptValue
   (entry.secretKey)` = plaintext.
2. `extras = { apiKey: plaintext, secretKey: plaintext }` →
   `setOauthExtraBody(extras)` → `WebViewBrokerAuthFlow` mounts.
3. Widget POSTs to `/sdk/v1/connections/Upstox/login-url` with the
   plaintext extras as `credentials`.
4. Backend SDK route (`Routes/sdk/v1/connections.js:1266+`) proxies the
   body verbatim to legacy `/api/upstox/update-key` (POST,
   `_selfCallLegacy`).
5. Legacy `/api/upstox/update-key` calls `checkValidApiAnSecret(data
   .apiKey)` which is `CryptoJS.AES.decrypt(plaintext, 'ApiKeySecret')
   .toString(Utf8)` — for a plaintext UUID this returns `''` /
   undefined.
6. Route then POSTs `{apiKey: undefined, apiSecret: undefined,
   redirectUri: ...}` to ccxt-india `/upstox/login`. ccxt apparently
   hangs on undefined creds → no response within 25 seconds.
7. SDK route's axios timeout fires → returns 500 to mobile →
   `WebViewBrokerAuthFlow.onError` → Phase3SdkBrokerModal `_onError`
   resets `oauthExtraBody = null` → form re-renders with values still
   prefilled by the schema override (`buildSchemaOverride` ~line 376
   for Upstox/ICICI/HDFC reads `stored.apiKey/secretKey` plaintext for
   `initialValue`). User sees prefilled-form-after-spinner-then-error
   loop.

**Why the form path also failed sometimes** — when the user tapped
Connect on the prefilled form, the form's `_buildBody` correctly
encrypts (`encrypt: true` on `apiKey`/`secretKey` field defs), so the
`/update-credentials` call succeeds. Then `onContinueToOauth(body)`
fires with the ENCRYPTED body → autojump's symmetry made
`oauthExtraBody = body` already-encrypted → second `/login-url` call
should have succeeded. But if backend's ccxt-india process is still
holding open the prior connection's hung Upstox call (no early-abort),
the new connection might queue behind it and also time out. Either way
the user-visible symptom is identical.

**Per-broker correctness** (the fix re-encrypts `apiKey` + `secretKey`
with `CryptoJS.AES.encrypt(raw, 'ApiKeySecret')` before they go into
`extras`, mirroring the SDK form's `encryptField` callback):

| Broker | `extras.apiKey` | `extras.secretKey` | `extras.clientCode` |
|---|---|---|---|
| Zerodha | platform env apiKey (plaintext, used as URL param) | (none) | (none) |
| Dhan / AliceBlue / Axis | (empty extras — partner OAuth) | | |
| Upstox / ICICI Direct / Hdfc Securities | **encrypted** apiKey | **encrypted** secretKey | (none) |
| Motilal Oswal | **encrypted** apiKey | (none — Motilal route doesn't read secretKey) | plaintext clientCode |
| Fyers | (none — see note) | **encrypted** OAuth secret | plaintext App ID (`clientId`) |

**Fyers correctness fix** — the prior autojump put the OAuth secret in
`extras.apiKey`, but backend Fyers `/update-key` reads `data.secretKey`
(decrypts via `checkValidApiAnSecret`). The `getStoredBrokerCreds`
helper applies the legacy DB-side ↔ mobile-modal field-naming inversion
(DB `secretKey` → modal `apiKey`) for UI display, but the autojump
hands its body to the BACKEND, not the modal — so we put the encrypted
OAuth secret in `extras.secretKey` to match the backend's expected
shape. This bug was masked by the same plaintext-encrypt issue above
for Upstox/ICICI/HDFC/Motilal, which would have failed on the decrypt
step anyway; for Fyers it would have failed even with encryption,
because the field was in the wrong slot.

**Files touched**:
- `src/components/BrokerConnectionModal/Phase3SdkBrokerModal.js`
  (`buildOauthReauthExtras` — added inline `enc()` helper using
  `CryptoJS.AES.encrypt` with the same `'ApiKeySecret'` envelope used by
  `encryptField` (line ~129) and the legacy modals; per-broker shape
  comments updated to record the backend's expected encryption + field-
  naming contract)

**No backend change needed** — backend `/update-key` already expected
encrypted; mobile was the only side sending plaintext. After this fix +
fresh APK, autojump-via-stored-creds for Upstox/ICICI/HDFC/Motilal/Fyers
re-auth lands directly on the broker's OAuth WebView without the form
intermediate, no spinner-loop, no "unexpected error".

**Verification recipe** (any of the 5 brokers):
1. Pre-existing connection with `connected_brokers[<broker>].apiKey`
   populated (`U2FsdGVkX1+...`-prefixed encrypted blob).
2. Tap Re-auth → expectation: jumps straight to the broker's OAuth
   WebView (no form, no spinner-loop, no error).
3. Backend log shows `[POST /sdk/v1/connections/<Broker>/login-url]` →
   inner `/api/<broker>/update-key` returns 200 promptly (not 25s
   timeout).

---

### Fixed — TIDI BACKEND CROSS-REPO: Upstox / Fyers / HDFC / Motilal smart-reauth always falling back to credential form (apiKey never persisted to `connected_brokers[]`)

**User-reported on tidi by `prikc1333@gmail.com`.** ICICI Direct + Upstox
re-auth on tidi_new (Flutter) was rendering the credential form on every
reconnect instead of jumping straight to the OAuth WebView, even after
the user had pasted their dev-portal apiKey + secretKey on the previous
connect.

**Root cause** — schema-location mismatch between persistence and read:

- `MultiBrokerService.getBrokerCredentials(user, broker)` in
  `aq_backend_github/services/MultiBrokerService.js:519` reads ONLY from
  `connected_brokers[<broker>].apiKey/secretKey` (multi-broker per-slot
  schema). Used by `/api/user/brokers/<broker>/reauth-url` to mint the
  pre-signed OAuth URL handed back to the mobile smart-reauth flow.
- The legacy `/api/<broker>/update-key` routes for Upstox / Fyers / HDFC
  / Motilal Oswal wrote credentials to the **top-level `users.apiKey /
  users.secretKey`** fields only (single-broker legacy slot, shared
  across all brokers, clobbered on every other broker's `/update-key`
  call). They never wrote to `connected_brokers[<broker>]`.
- Result: `connected_brokers[<broker>].apiKey` was always empty for these
  4 brokers → backend `/reauth-url` returned 400 "No saved API key" → the
  Flutter `ReauthHelper.handleSmartReauth` returned `'no-response'`
  fallback → `BrokerCredentialPage` rendered with `reauthConfig: null`
  (the credential form, not the WebView short-circuit).

For `prikc1333@gmail.com` on `tidi` tenant, MongoDB confirmed the
asymmetry: `connected_brokers[Upstox]` had only `jwtToken` (populated by
the post-OAuth callback's `connect-broker` write, which DOES use
multi-broker schema) — no `apiKey`, no `secretKey`. Top-level
`users.apiKey` was populated but with the most recently connected
broker's value (Kotak, in this user's case), not Upstox's, because the
top-level slot is single-broker and clobbered on every connect.

**Why ICICI was already OK** — `Routes/Broker/icici.js` had been
rewritten previously to upsert into `connected_brokers[ICICI Direct]`
and explicitly NOT touch top-level fields (the inline comment block
documents this). The other 4 OAuth brokers were never migrated to that
pattern.

**Why Kotak / Groww were also OK** — both go through
`MultiBrokerService.addBrokerConnection` (called from their connect
routes), which writes to `connected_brokers[]` directly.

**Why Zerodha / Angel One / Dhan / AliceBlue / Axis were never affected**
— partner / public OAuth, no user-supplied apiKey to persist; their
re-auth path uses the same first-connect URL with no stored creds.

**Fix (cross-repo on tidi `aq_backend_github`, branch `Ibt-branch`,
commit `b17cde0`)** — added a `connected_brokers[<broker>]` upsert block
in each of the 4 broken routes, after the existing top-level write.
Mirrors the `Routes/Broker/icici.js` pattern: find the entry by broker
name, update apiKey / secretKey (per-broker shape) + `last_used`, or
push a new `{broker, apiKey, secretKey, status: 'expired',
connected_at}` entry if absent. Wrapped in try/catch so a
`connected_brokers` save failure logs but does not break the existing
connect flow (top-level write already succeeded). Top-level write kept
for backward compat with anything still reading the legacy slot.

**Per-broker shape** (DB-side field names):

| File | Broker | Fields written to `connected_brokers[<broker>]` |
|------|--------|--------------------------------------------------|
| `Routes/Broker/upstox.js` | Upstox | `apiKey`, `secretKey` |
| `Routes/Broker/Fyers.js` | Fyers | `clientCode`, `secretKey` (DB-side; mobile `BrokerCryptoService.getStoredBrokerCreds` re-maps these to its form-side `apiKey`/`secretKey` shape on read — the legacy field-naming inversion) |
| `Routes/Broker/Hdfc.js` | Hdfc Securities | `apiKey`, `secretKey` |
| `Routes/Broker/Motilaloswal.js` | Motilal Oswal | `apiKey`, `clientCode` (Motilal stores `clientCode` in lieu of `secretKey`) |

**Files patched on tidi (paths in `~/servers/server1/aq_backend_github`):**

- `Routes/Broker/upstox.js` (+44 LOC)
- `Routes/Broker/Fyers.js` (+42 LOC)
- `Routes/Broker/Hdfc.js` (+37 LOC)
- `Routes/Broker/Motilaloswal.js` (+42 LOC)

**Mobile-side change** — none. The Flutter `ReauthHelper.handleSmart
Reauth` + `BrokerCredentialPage._maybeHydrateFromReauth` path was already
correct; once `connected_brokers[<broker>].apiKey` is populated on the
backend, the existing direct-to-OAuth flow fires for re-auth without any
mobile code change. Same is true for Alphab2bapp's RN re-auth on the
`feature/sdk-integration` lane (commit `004b406` autojump consumes the
same backend `/reauth-url` response).

**Deploy** — committed locally on tidi as `b17cde0`. NOT yet pushed to
origin and NOT yet restarted (waiting on user approval). Restart will
require `systemctl restart aq-backend` (or equivalent) on tidi srv1314603.

**Per-user repair after deploy** — for users with the same data state as
`prikc1333@gmail.com` (existing `connected_brokers[<broker>]` with no
apiKey for the 4 affected brokers), they need to reconnect each affected
broker once via the credential form so the dual-write fires. After that
the next reconnect goes direct-to-OAuth. No data-only backfill is safe
because the top-level `users.apiKey` slot is whichever broker connected
most recently and rarely the one being re-authed.

**Files touched**:
- `aq_backend_github` (tidi `Ibt-branch`, commit `b17cde0`):
  `Routes/Broker/upstox.js`, `Routes/Broker/Fyers.js`,
  `Routes/Broker/Hdfc.js`, `Routes/Broker/Motilaloswal.js`
- `Alphab2bapp` (this commit): `docs/CHANGELOG.md` (this entry)

---

## [unreleased] - 2026-04-30

### Fixed — Kotak: surface real validate-step error message + per-user data-center URL for orders

**User-reported (Flutter app screenshots, ssh tidi traceback).**
"kotak is still not connecting" + "kotak is still not going forward
for order" — orders failed with "Kotak per-user data-center URL not on
file. Please reconnect Kotak in the app — your existing connection
predates the baseUrl-persistence fix and the Kotak gateway can't route
this request without it."

**Root cause** — two stacked issues, the second one masked by the first:

1. The Kotak validate step was rejecting the user's MPIN
   (`{"error": [{"code":"10520","message":"Incorrect M-PIN. You have N
   more attempts remaining."}]}`) but the rejection message was being
   forwarded as a Python list / JSON array all the way to the mobile
   client. Flutter's `_handleApiError` (`String msg = data['message']`
   on a List throws a Dart type error which is silently caught) then
   fell back to the generic copy "Failed to connect broker. Please
   verify your credentials." The user retried with the same wrong MPIN
   four times before realising the actual reason was hidden — and was
   close to having the account locked by Kotak's per-day attempt cap.
   The same forwarding chain on the SDK route surfaced as
   `credential_submit_failed` → "Broker rejected your details" without
   the broker's specific reason.

2. The user's pre-existing Kotak connection was missing `baseUrl` —
   from a connect that ran before the 2026-04-29 baseUrl-persistence
   fix was deployed. Issue 1 blocked them from reconnecting (every
   attempt looked like "wrong credentials") so the stale connection
   stayed and orders kept failing.

**Fix — every layer on the path Kotak → user made defensive:**

- `ccxt-india/brokers/kotak/kotak.py` (commit `81225636`): added
  `_kotak_extract_error_message` helper that pulls a clean string out
  of Kotak's nested `{error: [{code, message}]}` shape. Used in
  `get_final_session` validate-failed branch. Idempotent.

- `aq_backend_github/Routes/Broker/Kotak.js` (commit `88ada54`):
  belt-and-braces. When `response.message` from ccxt is non-string,
  coerce to a one-line string by reading `[0].message` for arrays,
  `.message` for objects, falling back to JSON.stringify.

- `aq_backend_github/Routes/sdk/v1/connections.js` (same commit):
  surface the upstream broker rejection text as the response `detail`
  field in `broker_credential_update_failed` envelopes. SDK humanizers
  on RN/Flutter render `detail` directly when no UPSTREAM_REFINEMENT
  copy matches.

- `Alphab2bapp/src/utils/sdkErrorHumanize.js`: when the SDK error has
  a free-form `detail` string longer than ~12 chars with whitespace
  (a sentence, not a machine code), prefer it verbatim as the body.
  Surfaces "Incorrect M-PIN. You have 2 more attempts remaining."
  instead of the generic stage body. Pure machine codes still go
  through the UPSTREAM_REFINEMENT mapping.

- `tidi_new/lib/components/home/portfolio/BrokerCredentialPage.dart`:
  `_handleApiError` now coerces `data['message']` and `data['error']`
  through `_coerceErrorString` which handles String, List<Map>, and
  Map shapes (extracts `message` / `error` / `detail` recursively).

**Issue 2 (per-user DC URL missing for orders) auto-resolves once the
user successfully reconnects: `Routes/Broker/Kotak.js` already persists
`baseUrl` from the validate response (top-level + `connected_brokers`
slot, since 2026-04-29 commit `2a39937`).**

### Follow-up — same-day deeper Kotak baseUrl regression

After deploying the error-surfacing fixes, the user reconnected Kotak
(12:23:29 UTC) and orders STILL failed with `baseurl_missing`. Direct
MongoDB query showed `connected_brokers[Kotak].baseUrl =
https://e43.kotaksecurities.com` was correctly persisted, but the
order placement path was hitting the `Kotak._request` short-circuit
anyway. Two additional bugs found:

- `ccxt-india/apps/app_kotak.py:get_kotak_credentials_with_fallback`
  only triggered DB enrichment when `apiAccessToken` *or* `accessToken`
  was missing from the request body. Node's order-place flow always
  sends both — so the enrichment never ran, the body never carried
  `baseUrl`, and the Kotak class instance was created with `base_url=
  None`. **Fix (commit `aae64999`)**: trigger DB enrichment when ANY
  of `{apiAccessToken, accessToken, baseUrl}` is missing. Body fields
  retain precedence via the existing `or` fallthrough.

- `aq_backend_github/Models/userModel.js userSchema` (top-level) was
  missing the `baseUrl` field entirely. Mongoose strict mode silently
  dropped `baseUrl` from every `findOneAndUpdate` and `save()` payload
  — `Routes/Broker/Kotak.js`, `Routes/userRoutes.js` Kotak branch,
  and `Routes/sdk/v1/connections.js` Kotak connect path all wrote
  `baseUrl` into the update doc but it never reached MongoDB. The
  sub-schema on `connected_brokers` declares it (slot persisted fine),
  but the top-level field was a phantom write. The pre-save sync hook
  also didn't copy `primaryBroker.baseUrl` onto root, and the reverse-
  sync block + `MultiBrokerService.addBrokerConnection`'s
  root-credentials promotion didn't propagate `baseUrl` either. **Fix
  (commit `223dce1`)**: declare top-level `baseUrl: { type: String }`,
  add `this.baseUrl = primaryBroker.baseUrl` to the pre-save hook,
  add `baseUrl: this.baseUrl` to the reverse-sync brokerData, and
  set `user.baseUrl = connectionData.baseUrl` in
  `MultiBrokerService.addBrokerConnection` alongside the existing
  apiKey/secretKey/jwtToken/clientCode root-mirrors.

**Backfill**: ran a one-time `users.updateMany` on tidi to populate
top-level `baseUrl` from the `connected_brokers[Kotak]` slot for
every user with a stored Kotak connection, across all tenants
(`tidi`, `prod`, `moneyman`, `zamzamcapital`). Affected: 1 doc on
tidi (`prikc1333@gmail.com`); other tenants returned 0 because no
existing Kotak users had ever had their root `baseUrl` populated
(the strict-mode bug was global). New connects + reconnects now
populate root and slot in lockstep via the schema fix.

**Today's order-execution path is fixed** by the ccxt-india
enrichment widening (`aae64999`) which reads `baseUrl` from the
slot via `fetch_trading_credentials`'s Kotak connected_brokers
fallback (added earlier 2026-04-30). The schema patches are
belt-and-braces so root `user.baseUrl` is also accurate going
forward (legacy code paths, future feature work).

### Follow-up² — rebalance flow had its own baseUrl-stripping path

After deploying `aae64999` + `223dce1`, the user retried the order
and it STILL failed with `baseurl_missing` (12:45 UTC). Every
`/rebalance/process-trade` invocation produced a fresh cascade of
`api.order.place` and `api.order.book` short-circuits. Reason: the
`/rebalance/process-trade` entry point never goes through
`get_kotak_credentials_with_fallback` (the function I widened in
`aae64999`). It uses its own path:
`fetch_trading_credentials` → `normalize_credentials_for_broker`
→ `KotakBroker(auth_params)`. Three places in that path silently
dropped `baseUrl`:

- `apps/app_model_portfolio.py:normalize_credentials_for_broker`
  Kotak branch only copied `apiKey/jwtToken/sid/serverId` from
  `db_creds` into `normalized` — never read `db_creds.get('baseUrl')`.
- `rebalancing/brokers.py:KotakBroker.__init__` didn't read
  `auth_params.get('baseUrl')`, didn't store `self.base_url`, and
  neither `_get_kotak_instance` nor `process_trades` passed
  `base_url` to `Kotak()` / `TradingLogicKotak`.
- `rebalancing/order_status_updater/order_book_factory.py:KotakBroker`
  (used by the order-status updater post-place) had the identical
  gap — every order-book refresh on a reconnected Kotak hit the
  gateway short-circuit too.

**Fix (commit `78515f64` ccxt-india)**: forward `baseUrl` in
`normalize_credentials_for_broker` Kotak branch + `extract_auth_params`
pass-through; `KotakBroker.__init__` reads + stores `self.base_url`,
`_get_kotak_instance` + `process_trades` pass `base_url=self.base_url`;
same in `order_book_factory.py:KotakBroker`. `Kotak()` and
`TradingLogicKotak()` already accept `base_url` (the constructor
parameter has been there since the per-DC fix landed; the rebalance
path just wasn't using it).

`ccxt_prod.service` restarted at 12:50 UTC. The rebalance Kotak path
now reads `baseUrl` from `connected_brokers[Kotak].baseUrl` via
`fetch_trading_credentials` and threads it all the way through.

### Follow-up³ — the whole baseUrl routing premise was wrong

After follow-up² deployed and orders successfully reached the Kotak
host at `e43.kotaksecurities.com`, they immediately failed with a new
shape — `non_json_response` HTTP 404 with body `404 page not found`.
Live probes against Kotak's hosts (2026-04-30 12:58 UTC):

```
curl -sI https://e43.kotaksecurities.com/Orders/2.0/quick/user/orders
  → HTTP 404 / 'text/plain' / '404 page not found'
curl -sI https://gw-napi.kotaksecurities.com/Orders/2.0/quick/user/orders
  → HTTP 502 (gateway 502 without auth headers — works with them)
```

**Conclusion**: per-user `dataCenter` URLs (e.g. `e43.kotaksecurities.
com`) are the **websocket / market-data host** for the user's account.
They do NOT serve the REST Orders / Portfolio / Files API. The path
`/Orders/2.0/quick/user/orders` returns a clean 404 on every per-DC
host probed; nearby paths (`/api/Orders/...`, `/v1/orders`) return 503
which is the per-DC host's catch-all for non-WS HTTP.

The earlier "fix" (routing REST through `self.root` which preferred
`base_url` when set) was reversed. After `223dce1` started persisting
`baseUrl` correctly and `78515f64` plumbed it through the rebalance
path, every order placement began hitting per-DC hosts that don't
serve orders → 404. The original 502 cascade documented in the
`_DC_REQUIRED_ROUTES` comment that triggered the baseUrl-routing
rewrite must have had a different root cause (transient gateway
error or auth-header mismatch) — investigate separately if it
recurs.

**Fix (commit `9a7d7269` ccxt-india)**: in `Kotak._request`, always
route REST through `self._rootUrl` (the gateway
`gw-napi.kotaksecurities.com`). Dropped the `_DC_REQUIRED_ROUTES`
short-circuit guard. Kept `self.base_url` captured on `__init__`
so future websocket code can use it; just removed its use from the
REST path. `ccxt_prod.service` restarted at 12:59 UTC.

Net effect on the Kotak path today:
- Per-DC `baseUrl` IS persisted to MongoDB (`connected_brokers[Kotak]
  .baseUrl` and root `user.baseUrl`) for any future websocket code.
- REST orders go through the gateway, the same way they did before
  the original 502 hunt began.

### Follow-up⁴ — actual root cause of the original 502 cascade

After follow-up³ deployed and orders reached `gw-napi.kotaksecurities.
com` with proper auth headers, every order **immediately came back
with HTTP 502 + empty body** (the same shape that originally triggered
the misguided baseUrl-routing rewrite weeks ago). Two stacked bugs in
`brokers/kotak/kotak.py` that had been hiding under the per-DC
detour:

1. `_request` set `query_params["sId"] = self.serverId` then called
   `route_template.format(**query_params)` — but the route templates
   (`api.order.place` → `/Orders/2.0/quick/order/rule/ms/place`,
   etc.) contain no `{sId}` placeholder, so `.format()` was a no-op
   for sId. `urljoin` doesn't accept query dicts and
   `requests.get/post` was called without `params=`. **`sId` never
   reached any URL.** The Kotak gateway requires `?sId=<shard>` to
   route to the right server cluster — without it, gw-napi 502s
   with empty body for every account.

2. `Kotak.__init__` keyword default is `server_id="server1"`, but
   the rebalance `KotakBroker` callers do
   `auth_params.get('serverId') or ''` and forward an empty string
   when DB has empty (which is most users, since Kotak only fills
   `hsServerId` for non-default shards). Empty string overrode the
   keyword default → `self.serverId = ""` → no useful fallback even
   if the URL had been getting it.

**Fix (commit `125d33e9` ccxt-india)**: in `__init__` coerce empty
or whitespace-only `server_id` to `"server1"`; in `_request` stash
sId in a `request_params` local and pass it via `requests.get/post
(..., params=request_params)` so it reliably lands on the URL as
`?sId=server1` (or whatever the validated shard name is). The
empty-502 path remains as a safety fallback for genuine Kotak-side
blips but should no longer fire for routine order placement.

`ccxt_prod.service` restarted at 13:17 UTC. The full Kotak path is
now: legacy gateway URL + correct `sId` query param + correct auth
headers + DC-aware `baseUrl` saved for future websocket use.

### Follow-up⁵ — wrong neo-fin-key string (the actual final root cause)

The 502 cascade KEPT firing after follow-up⁴. Stopped guessing and
cloned the official Kotak Neo Python SDK (`Kotak-Neo/kotak-neo-api`)
to compare ground truth.

**Found**: the SDK's `neo_api_client/neo_utility.py:get_neo_fin_key`
hardcodes:
- `prod` → `"X6Nk8cQhUgGmJ2vBdWw4sfzrz4L5En"`
- `uat`  → `"bQJNkL5z8m4aGcRgjDvXhHfSx7VpZnE"`

Our `brokers/kotak/kotak.py` had `neo_fin_key="neotradeapi"` as the
keyword default. That value is accepted by Kotak's MIS / login host
(which is why `login.totp` + `tradeApiValidate` have always
succeeded), but `gw-napi.kotaksecurities.com` (the order gateway)
silently 502s empty when this header is wrong. **Every Kotak order
since this class shipped has been failing for this reason.** The
per-DC routing detour, the schema-strict-mode detour, the missing-
sId detour — all symptoms of this one wrong header.

Compounding bug: the same `__init__` signature also had
`environment="uat"` as the keyword default. The hardcoded URLs in
the class are all production (`gw-napi.kotaksecurities.com`,
`mis.kotaksecurities.com`, `napi.kotaksecurities.com`), but
`environment` was vestigial — never actually switched URLs.
Result: even if a caller had passed `environment="prod"` the
fin-key would have stayed at `"neotradeapi"`.

**Fix (commit `90e03dcd` ccxt-india)**:

1. `__init__` keyword default `environment="prod"` (matches the
   hardcoded prod URLs).
2. `neo_fin_key` coercion: when the caller passes the historical
   placeholder `"neotradeapi"` (or empty / None), swap in the
   right env constant from the SDK. Explicit non-placeholder
   callers are respected unchanged.

`ccxt_prod.service` restarted at 13:25 UTC. This is the actual
root cause of every 502 we've been chasing today. Login still works
because the login host accepts `"neotradeapi"`; the order gateway
doesn't, and now both use `"X6Nk8cQhUgGmJ2vBdWw4sfzrz4L5En"`.

### Files touched

- `ccxt-india/brokers/kotak/kotak.py` (deployed via tidi git pull;
  `feature/4.0_broker` branch, commit `81225636`)
- `aq_backend_github/Routes/Broker/Kotak.js` + `Routes/sdk/v1/connections.js`
  (deployed via tidi git pull; `Ibt-branch`, commit `88ada54`)
- `Alphab2bapp/src/utils/sdkErrorHumanize.js`
- `tidi_new/tidistockmobileapp/lib/components/home/portfolio/BrokerCredentialPage.dart`

### Deployment

`alphaquark.service` and `ccxt_prod.service` restarted on tidi via
systemctl (12:00 UTC). Mobile app changes ship in next build.

---

### Changed — Re-auth on SDK lane jumps directly to OAuth WebView (RN) + only-mpin/totp Kotak (RN + Flutter)

**User-reported.** "When I do re-auth - legacy flows directly used to
send to the oauth of the respective brokers (like icici, upstox, kotak
to ask only totp/mpin, etc.) - however, the alphaquark_mobile_sdk and
the flutter version both sends it to fill the details." Legacy modals
consumed `reauthConfig.authUrl` to skip the credential form and open
the broker's OAuth page directly; the SDK lane (RN) and the Flutter
form ignored that pattern and re-rendered every credential field on
every re-auth — for OAuth brokers an unnecessary "review pre-filled
form, hit Connect" step, for Kotak a 5-field form when the user only
needs to retype mpin + totp.

**Fix — three layers:**

1. **SDK widget — `alphaquark-mobile-sdk/packages/rn`**: added
   `BrokerFormField.hideFromUi?: boolean`. When true, the field is
   filtered from `BrokerCredentialForm`'s render but its `initialValue`
   still flows into `buildBody` (which iterates `schema.fields`, not
   the rendered set). Validation + encrypt-on-submit still apply.

2. **RN — `Phase3SdkBrokerModal.js`**:
   - Added `OAUTH_REAUTH_AUTOJUMP_BROKERS` set (Zerodha, Upstox, ICICI
     Direct, Hdfc Securities, Motilal Oswal, Fyers, Dhan, AliceBlue,
     Axis Securities). Angel One excluded — `SDK_LEGACY_FALLBACK`.
   - On mount, after `userDetails` resolves, if
     `getStoredBrokerCreds(userDetails, brokerName)` returns non-null
     AND broker is in the auto-jump set, build extras from stored
     creds via new `buildOauthReauthExtras` and `setOauthExtraBody`
     immediately. Renders `<WebViewBrokerAuthFlow>` straight away —
     the form is never shown.
   - For Kotak (credentials_totp), `buildSchemaOverride` now marks
     `apiKey`, `mobileNumber`, `ucc` with `hideFromUi: true` when
     stored entry is present. Only mpin + totp render.
   - `reauthJumpFiredRef` makes the auto-jump idempotent so a
     userDetails refresh during the WebView phase doesn't yank the
     user back to the form.

3. **Flutter — `tidi_new` `BrokerCredentialPage.dart`**: replaced
   `_maybePreFillKotakMobile` with `_maybePreFillKotakReauth` that, on
   detection of a full Kotak stored entry, pre-fills apiKey + ucc +
   mobileNumber AND adds the keys to a new `_hiddenFieldKeys` set
   filtered out of the field render loop. Falls back to mobile-only
   pre-fill when stored data is partial. The non-Kotak credential
   brokers' re-auth flow already routed via `ReauthHelper.handle
   SmartReauth` → `BrokerCredentialPage(reauthConfig: …)` → WebView;
   that path is unchanged.

### Files touched

- `alphaquark-mobile-sdk/packages/rn/src/components/brokerFormSchema.ts`
  (`hideFromUi` field)
- `alphaquark-mobile-sdk/packages/rn/src/components/BrokerCredentialForm.tsx`
  (filter render)
- `Alphab2bapp/src/components/BrokerConnectionModal/Phase3SdkBrokerModal.js`
- `tidi_new/tidistockmobileapp/lib/components/home/portfolio/BrokerCredentialPage.dart`

### Backend impact

None — re-auth on the SDK lane uses `client.getBrokerLoginUrl(broker,
redirectUrl, extras)` which mints a fresh URL from stored creds.
Identical semantics to legacy `reauthHelpers.handleSmartReauth` — no
new backend route, no schema change.

---

### Fixed — Kotak `connected_brokers[].baseUrl` silently dropped by mongoose strict mode → ccxt-india gateway 502 cascade (cross-repo: aq_backend_github + ccxt-india)

**Tag:** KOTAK-BASEURL-CROSS-REPO

**Smoking gun.** prikc1333 (tidi DB) connected Kotak at 2026-04-30 09:06 — *after* yesterday's commit `b920d96` which added `baseUrl` to the top-level user fields and to the `MultiBrokerService.addBrokerConnection` callsite in both `Routes/Broker/Kotak.js` and `Routes/userRoutes.js#PUT /connect-broker`. Their slot still came back without `baseUrl`. Subsequent /kotak/process-trades / /kotak/orderBook / /kotak/holdings calls all 502'd via gw-napi.kotaksecurities.com.

**Two-layer root cause.**

1. `Models/userModel.js#connectedBrokerSchema` did NOT declare a `baseUrl` field. Mongoose default `strict: true` strips undeclared keys at save time — so every caller passing `baseUrl` (Kotak.js, userRoutes.js Kotak branch, `/sdk/v1/connections/Kotak/connect` via `MultiBrokerService.addBrokerConnection`) silently lost the field.
2. `services/MultiBrokerService.js#addBrokerConnection` builds a fixed `connectionData` object that omits `baseUrl` regardless. Even if (1) were fixed in isolation, the field would never make it to the doc because `addBrokerConnection` doesn't copy it in.

Both layers had to be fixed together; either alone is a no-op.

**Fix (aq_backend_github).**
- `Models/userModel.js` — added `baseUrl: { type: String }` to `connectedBrokerSchema`.
- `services/MultiBrokerService.js#addBrokerConnection` — added `baseUrl: brokerData.baseUrl` to `connectionData`.

**Fail-fast (ccxt-india).** Even after the persistence fix, every existing Kotak connection from before today still has no `baseUrl` on file. Without a guard, `Kotak.__init__` falls back to `_rootUrl` (gw-napi gateway) and the gateway 502's empty for DC-bound endpoints. The previous `empty_response` envelope said "the per-user data-center baseUrl is missing OR the session is invalid", which left the user unsure whether to retry or reconnect.

`brokers/kotak/kotak.py`:
- Defined `_DC_REQUIRED_ROUTES` — the set of routes that need a per-user DC base URL (place_order, modify, cancel, order book, order details, trade book, position, holding, scripmaster, user limits, user fund). Login routes (login.validate, login.viewToken) are intentionally excluded — they MUST work via the gateway pre-validate.
- Patched `_request` to short-circuit with a `baseurl_missing` envelope (status 1, actionable "reconnect Kotak in the app" message) when `self.root == self._rootUrl` AND the route is DC-required. Logs the URL, root, and ucc for forensics.
- Updated the empty-body and non-JSON error paths to log `url` + `self.root` for any future Kotak 502 cascade.
- Reworded the `empty_response` envelope to NOT mention baseUrl missing — that case never reaches here now.

**Sweep query result (2026-04-30).**
- tidi DB: 1 affected user (prikc1333@gmail.com).
- prod DB: 1 affected user (testaccount@gmail.com).

Both will see `baseurl_missing` envelope on next trade until they reconnect Kotak — which now will persist `baseUrl` correctly.

**Files touched.**
- `aq_backend_github/Models/userModel.js` (sub-schema field)
- `aq_backend_github/services/MultiBrokerService.js` (connectionData copy)
- `ccxt-india/brokers/kotak/kotak.py` (fail-fast + logging + envelope wording)

**Deploy.** Both services need restart — see the deploy commands at the end of the session report.

**Why this slipped past commit `b920d96`.** Yesterday's review only inspected the route-level write (which DID pass `baseUrl`) and the `findOneAndUpdate` of top-level fields (which DID work). The slot write is fronted by `addBrokerConnection`, and nobody opened that function or the sub-schema definition — both silently dropped the field. Lesson: when adding a field that crosses a model boundary, grep the *receiving* schema and the *receiving* service, not just the caller.

---

### Fixed — Phase 3 SDK modal: WebView "screen not responding" on Dhan / Upstox / ICICI / etc. (RN-only Pressable bug)

**User-reported.** "Connect Dhan screen not responding"; "similar problem
in Upstox"; "may be SDK has error on most brokers — Flutter SDK is
working fine". Confirmed the bug is RN-only — Flutter consumer
(tidi_new) doesn't use Pressable at this layer.

**Root cause (Phase3SdkBrokerModal.js).** Both the OAuth phase
(`<WebViewBrokerAuthFlow>`) and the form phase
(`<BrokerCredentialForm>`) wrapped their content in:

```js
<Pressable style={styles.scrim} onPress={dismiss}>
  <Pressable style={styles.panel} onPress={() => {}}>  // ← bug
```

The empty-handler inner `Pressable` is the standard "swallow taps"
pattern used to prevent the outer scrim's tap-outside-to-dismiss from
firing on inner taps. On Android, however, `Pressable`'s
gesture-responder press-tracking (haptic feedback timing, long-press
detection, hover state) intercepts touches BEFORE the embedded
`<WebView>` can dispatch them to the page. Result: user sees the
broker's login page rendered (Login via Dhan, mobile input, Proceed)
but tapping inputs / Proceed does nothing — the outer Pressable's
onPress also doesn't fire (it's an inner tap), but the touch is
captured upstream of the WebView's native handler.

This isn't visible on the form phase's TextInputs because RN's
`<TextInput>` claims the responder via its native handler — beating
Pressable's claim. WebView doesn't claim the JS responder the same
way; native MotionEvent dispatch on Android races with RN's gesture
system, and in this nested-Pressable layout RN wins.

**Fix.** Replace the inner `<Pressable>` with a plain `<View>` that
claims the gesture responder explicitly:

```js
<View
  style={styles.panel}
  onStartShouldSetResponder={() => true}
  onResponderTerminationRequest={() => false}>
```

`onStartShouldSetResponder={() => true}` claims the touch via the JS
gesture responder system without engaging Pressable's press-tracking.
`onResponderTerminationRequest={() => false}` denies parent View
attempts to take back the responder mid-gesture. WebView's native
touch handling (via Android MotionEvent dispatch) continues to work
because the JS claim is at a different layer.

Applied to BOTH phases in `Phase3SdkBrokerModal.js`. All 13 brokers
that route through SDK get the fix automatically.

### Fixed — Phase 3 SDK error humanizer: ICICI showed generic copy for `broker_login_url_missing` (HTTP 404)

**User-reported.** ICICI Direct connect attempt showed:

> Something went wrong with ICICI Direct
> Please try again. If the problem keeps happening, contact your advisor or support.
> `broker_login_url_missing (HTTP 404)`

The `broker_login_url_missing` code IS in `sdkErrorHumanize.js`'s
`UPSTREAM_REFINEMENT` map with helpful copy ("The broker didn't
return a login URL. Your developer-portal app may be misconfigured —
check that Order Placement permission is enabled and the redirect URL
matches.") — but the helper looked it up against `sdkError.detail`,
not `sdkError.error`.

**Root cause.** SDK's `_toSdkError` (in
`@alphaquark/mobile-sdk/src/components/WebViewBrokerAuthFlow.tsx` and
3 sibling files) puts the backend's `error` code into the
`SdkError.error` field — NOT `detail` — when the source was an
`SdkRequestError` (which carries the backend response.error in
`Error.message`, see `AqSdkClient.ts:209-214`). So
`UPSTREAM_REFINEMENT[error]` is what would have matched, but the
helper only checked `UPSTREAM_REFINEMENT[detail]`.

**Fix.** `sdkErrorHumanize.js` now consults `UPSTREAM_REFINEMENT`
against EITHER field (`detail` preferred when both present, since
detail is more specific within the SDK-stage code's umbrella). When
the upstream code is matched but no SDK-stage code is, the title
becomes `"Couldn't connect to <broker>"` rather than the generic
`"Something went wrong with <broker>"`.

ICICI's error will now render:

> Couldn't connect to ICICI Direct
> The broker didn't return a login URL. Your developer-portal app may be misconfigured (check that Order Placement permission is enabled and the redirect URL matches).
> `broker_login_url_missing (HTTP 404)`

**Files touched (single commit, both fixes):**
- `src/components/BrokerConnectionModal/Phase3SdkBrokerModal.js`
  (Pressable → View on both phases)
- `src/utils/sdkErrorHumanize.js` (look up UPSTREAM_REFINEMENT against
  error || detail; refined title for upstream-only matches)

---

### Changed — Zerodha "no record in order book" rejection: lead with insufficient balance (cross-repo: aq_backend_github)

**User feedback (tidi_new screenshot)**: Trade Details page showed 3
Zerodha-rejected orders (ADARSHPL, VIKASECO-EQ, GTLINFRA-EQ) all with the
same message: *"Order not accepted by Zerodha (no record in order book).
Likely causes: invalid symbol/exchange combination, restricted stock
(GSM/T2T), or pre-acceptance rejection."* The user pointed out that
**insufficient balance** is also a common cause for this rejection
class, but the message didn't mention it — so users chase
symbol/exchange/GSM issues for what is usually a wallet issue.

**Root cause**. The message is set server-side in
`aq_backend_github/Routes/Broker/zerodha.js:506` for the case where
Zerodha's Publisher flow reports success but the order never appears in
the order book (which happens when the broker rejects pre-acceptance, or
the Publisher popup itself blocks the order for insufficient balance —
neither produces an order-management-system record). The code comment
above the message already acknowledged insufficient balance as a known
cause: *"Pre-validation rejections (insufficient balance, etc.) in the
Kite Publisher popup don't reach the order management system, so they
won't appear in GET /orders."* — but the message text omitted it.

**Fix (`aq_backend_github` Ibt-branch)**. Reworded to lead with
insufficient balance:

> *"Order not accepted by Zerodha (no record in order book). **Most likely
> cause: insufficient balance in your Kite account.** Other possible
> causes: invalid symbol/exchange combination, restricted stock
> (GSM/T2T), or pre-acceptance rejection. Please open your Kite app,
> check your available balance, and verify the order status there."*

**Bonus benefit (no mobile change needed)**. The new message contains
the literal string `insufficient balance`, which both
`RecommendationSuccessModal.js:_lowFundsStocks` and
`ExecutionStatusPage.dart:_lowFundsStocks` already match in their LOW_FUNDS
detector. So once the backend deploys, every user hitting this rejection
class will ALSO see the dedicated red Insufficient Funds banner at the
top of Trade Details (with the "What you need to do" steps) — not just
the per-row chip. The banner gives the prominence the user asked for,
without any mobile app rebuild.

**No mobile code change.** Both apps render `orderStatusMessage` /
`failureReason` verbatim and already match the new wording in their
LOW_FUNDS detectors.

**Deploy**: backend pushed to `Ibt-branch`. Run `ssh tidi → cd
servers/server1/aq_backend_github → git pull → sudo systemctl restart
alphaquark.service`.

**Files touched (cross-repo):**
- `aq_backend_github` (`Ibt-branch`): `Routes/Broker/zerodha.js`
  (`notInBookMessage` reworded; comment updated to call out the user
  feedback).

**Files touched (this repo): none.** Documentation-only entry.

---

### Fixed — Motilal: detect in-page "Authorization is Invalid In Header Parameter" / MO1007 errors via JS watcher (cross-repo: tidi_new)

**User screenshot (tidi_new)**: Connect Motilal Oswal → "OTP Send
Successfully" → user enters OTP → tap SUBMIT → Motilal renders red
"Authorization is Invalid In Header Parameter" inline. Existing 30s
connect-debounce + post-WebView-error guards didn't catch this because
the error is rendered IN-PAGE by Motilal's hosted login JS — no
navigation, no HTTP error, no WebView error event. The host app sees a
"successful" page load and stays passive.

**Root cause** (already documented in `MotilalModal.js:105-117` and
`BROKER_CONNECTION.md § Motilal session-affinity guard`): Motilal binds
OTP + page-side session cookie + apikey-derived `Authorization` header to
a SINGLE page-load. Anything that rotates Motilal's server session
between Send-OTP and Submit-OTP — DNS retry, RESEND OTP click that the
page re-renders, app background/foreground cycle, second `/login` call
firing in parallel — invalidates the typed OTP. Server returns 200 with
the auth-invalid string painted into the response HTML.

**Fix.** New `_kMotilalErrorWatcher` constant in
`src/UIComponents/BrokerConnectionUI/MotilalConnectUI.js` — an IIFE that
polls `document.body.innerText` every 750ms for three patterns:
"Authorization is Invalid In Header Parameter", "MO1007", "Two Factor
Authentication Failed". On the first hit it
`window.ReactNativeWebView.postMessage('motilal_session_rotated')`s the
parent. The WebView's new `injectedJavaScript={_kMotilalErrorWatcher}` +
`onMessage` handler routes the message into the existing
`setPostLoadError` UI with a clear "session has rotated, tap Restart and
wait 30s" message. Idempotent via `window.__aqMotilalWatcher`; stops
polling after the first hit OR 5 minutes (whichever first).

**Why poll vs intercept fetch/XHR?** Motilal's submit endpoint returns
the error in the page HTML (server-rendered), not via a JSON XHR — so
`window.fetch` / `XMLHttpRequest` monkey-patches (the AliceBlue pattern)
don't apply. DOM polling is the only reliable hook.

**Cross-repo paired commit (same session).** tidi_new
`feature/sdk-integration` gets the same watcher in
`BrokerAuthPage.dart` (`_kMotilalErrorWatcher` const + `AqMotilalErrors`
JavaScriptChannel + `_handleMotilalSessionRotated` handler that flips
`_status` to `'error'` with the clear message). Both apps now detect
this class of in-page error.

**Files touched:**
- This repo: `src/UIComponents/BrokerConnectionUI/MotilalConnectUI.js`
  (`_kMotilalErrorWatcher` const, `injectedJavaScript`, `onMessage`).
- Cross-repo: `tidi_new
  /tidistockmobileapp/lib/components/home/portfolio/BrokerAuthPage.dart`
  (`_kMotilalErrorWatcher` const, `_isMotilal` getter,
  `addJavaScriptChannel('AqMotilalErrors')`, `runJavaScript` injection
  in `onPageStarted` + `onPageFinished` for `motilaloswal.com`,
  `_handleMotilalSessionRotated` method).

---

### Changed — Zerodha SDK lane: skip Phase3BrokerHelp + use SDK's "Login to Zerodha" button

**User feedback.** Zerodha is empty-fields OAuth — the only meaningful UI
is one tap to open Kite's WebView. The legacy help block (`Phase3BrokerHelp`
with steps + tutorial video) was rendered above an SDK form that has no
fields to fill, and produced a long scroll. Worse: the long help content +
nested ScrollView (outer panel + inner `BrokerCredentialForm`'s own
ScrollView) caused gesture-handler conflict where dragging in the modal
went to the wrong scroller. User-reported: "scroll down on zerodha was
not working".

**Fix (this repo, `Phase3SdkBrokerModal.js`).** Render `Phase3BrokerHelp`
only when `brokerName !== 'Zerodha'`. For other brokers it stays — they
have at least an apiKey/secretKey form to fill, and the help explains how
to obtain those values from the broker's developer portal.

**Paired SDK change (cross-repo, same session).** The SDK's Zerodha schema
(`brokerFormSchema.ts` and `broker_form_schema.dart`) now sets
`submitLabel: "Login to Zerodha"` (was the default "Connect Zerodha") and
trims the intro from a 3-sentence block to a single sentence. So the SDK
widget renders a single, correctly-labelled login button that opens the
Kite WebView on tap. Both RN + Flutter SDK schemas changed identically so
tidi_new gets the same UX.

**Files touched:**
- `src/components/BrokerConnectionModal/Phase3SdkBrokerModal.js` — skip
  `Phase3BrokerHelp` for Zerodha + comment block on the nested-scroll
  rationale.
- (cross-repo) `alphaquark-mobile-sdk/packages/rn/src/components/brokerFormSchema.ts`,
  `alphaquark-mobile-sdk/packages/flutter/lib/src/widgets/broker_form_schema.dart`
  — `submitLabel` + trimmed `intro` for Zerodha.

---

### Fixed — Copy-link icon in broker help silently failed; install `@react-native-clipboard/clipboard`

**Production trigger.** User-reported: tapping the copy icon next to URLs
in broker connect help (e.g. ICICI Direct's API portal links) didn't copy
anything. The "Long-press the link to copy manually" toast fired on every
tap.

**Root cause.** `src/UIComponents/BrokerConnectionUI/HelpUI/LinkifiedUrl.js`
referenced `Clipboard.setString(url)` as a runtime global with an
`eslint-disable no-undef` comment. RN 0.78 dropped core `Clipboard` and
this project never installed `@react-native-clipboard/clipboard` as an
explicit dep. So every tap threw `ReferenceError: Can't find variable:
Clipboard`, caught by the try/catch, surfaced as the "long-press to copy"
toast — code working as written, but the surface was useless. Same shape
in `DdpiModal.js` which used `require('@react-native-clipboard/clipboard')
.default` — the require throws `Cannot find module`, also caught silently.

**Fix.**
- `npm install @react-native-clipboard/clipboard@^1.16.3` — adds the dep
  and the native Android module. Autolinked on next gradle invocation;
  no manual MainApplication wiring needed (RN 0.78 autolinking).
- `LinkifiedUrl.js` now uses `import Clipboard from '@react-native-clipboard
  /clipboard'` directly. The try/catch fallback is preserved as a
  defensive belt-and-braces.
- `DdpiModal.js` left as-is — its `require(...).default` pattern works
  once the package is on disk; the try/catch becomes harmless.

**Native build required.** Autolinking pulls the new module in at
`assembleRelease` / `assembleDebug` time. The in-flight `assembleRelease`
running when this commit was prepared was killed and re-run after the
install so the APK includes the native module.

**Files touched:**
- `package.json`, `package-lock.json` — new dep.
- `src/UIComponents/BrokerConnectionUI/HelpUI/LinkifiedUrl.js` — real
  import + updated docstring.

---

### Fixed — Phase 3: route Angel One back to legacy modal (`SDK_LEGACY_FALLBACK` Set re-introduced)

**Production trigger.** User screenshot of Connect Angel One showing the
SDK's per-customer form ("Connect your personal Angel One SmartAPI app —
create one at smartapi.angelone.in and paste the API key + secret here.")
with three input fields. Default for every B2B advisor is **shared mode**
(use platform `REACT_APP_ANGEL_ONE_API_KEY` and skip straight to publisher
OAuth — same flow as Zerodha). Per-customer mode is for advisors who have
their own SmartAPI app and explicitly opt in. The SDK widget can't tell the
difference yet.

**Root cause.** Two stacked gaps in the SDK lane:

1. **SDK schema gap.** `Phase3SdkBrokerModal.js:264-268` always returns
   `[apiKey, secretKey, clientCode]` as the schema override for Angel One.
   Comment in that block already calls out the gap: *"Today's
   `useSharedAngelOneKey` toggle is in the SDK backend, not in the consumer;
   first-connect for shared advisors still surfaces the per-customer form.
   Tracked as Known Gap."* So shared-mode advisors get the wrong UX even
   though the backend would happily serve them via the shared key.
2. **Backend exchange-token gap.** `aq_backend_github
   /Routes/sdk/v1/connections.js` POST `/Angel One/exchange-token` doesn't
   yet handle the `auth_token` callback that shared-mode publisher login
   produces — it would need to dispatch to ccxt `/angelone/generate-session`
   to mint the long-lived JWT. Even if (1) were fixed, (2) blocks success.

**Combined**: the SDK lane simply cannot connect Angel One in shared mode
today. The audit (`PHASE3_BROKER_AUDIT.md`) has marked Angel One as
**SDK-broken** since the audit landed; the dispatch's "single switch"
intent (drop the kill-switch, fix the SDK widget) is admirable but not
acceptable while real users are unable to connect.

**Fix.** `BrokerConnectModalDispatch.js` re-introduces a tightly-scoped
`SDK_LEGACY_FALLBACK` `Set`. Today it contains exactly one entry —
`'Angel One'`. The dispatch now reads:

```js
if (useSdkBrokerFlow() && !SDK_LEGACY_FALLBACK.has(key)) {
  return <Phase3SdkBrokerModal {...commonProps} brokerName={key} />;
}
// fall through to legacy switch
```

Angel One falls through to `case 'Angel One': return
<AngleOneBookingTrueSheet {...commonProps} />` which uses the platform
`ANGEL_ONE_API_KEY` and works for every advisor today (no per-customer
form rendered, no broken backend route hit).

The fallback is documented as tech debt: every entry in the Set MUST have
a verdict row in `PHASE3_BROKER_AUDIT.md` AND a removal criterion. Angel
One's removal criterion: SDK schema learns `flow=oauth, fields=[]` for
Angel One when `useSharedAngelOneKey=true`, AND backend `/exchange-token`
gains `auth_token` → ccxt `/angelone/generate-session` dispatch. Both
items tracked in the audit row.

**No backend change here.** The backend gap is already documented; the
fallback re-routes around it without needing a server fix to ship.

**No SDK change here.** The SDK's per-customer form is correct for the
opt-in case; we just stop using it as the default. SDK widget gets the
schema fix later.

**Files touched:**
- `src/components/BrokerConnectionModal/BrokerConnectModalDispatch.js`
  — `SDK_LEGACY_FALLBACK` Set + dispatch guard + comment block.
- `docs/PHASE3_BROKER_AUDIT.md` — Angel One row updated with the regression
  fix, the two open gaps, and the removal criterion.

---

### Fixed — Phase 3 SDK error renderer: stop showing "sdk_error: internal_error" for every broker; humanize SDK error envelope (cross-repo: aq_backend_github + alphaquark-mobile-sdk)

**Production trigger.** User screenshot of Connect Upstox modal showing
`sdk_error: internal_error` as a red banner with no further information.
Same surface for all 5 OAuth-with-creds brokers (Upstox, Fyers, ICICI Direct,
Motilal Oswal, HDFC Securities) and — independently — for any other SDK
error.

**Three stacked bugs caused this single screen.**

1. **Backend (`aq_backend_github` `Routes/sdk/v1/connections.js`).** The
   `POST /sdk/v1/connections/:broker/login-url` handler's
   Upstox/Fyers/ICICI/Motilal/HDFC dispatch branch (line 1159) referenced
   `userEmail` and `body` locals that were never declared at the handler's
   scope. Angel One declares its own `userEmail` _inside_ its branch — the
   other 5 never got the same treatment. Result: `ReferenceError: userEmail
   is not defined`, caught by the route's generic catch, returned as
   `500 {error:"internal_error", detail:"userEmail is not defined"}`. SDK's
   login-URL fetch failed for all 5 brokers on every connect attempt.

2. **SDK (`@alphaquark/mobile-sdk` `packages/rn`).** Each component's
   `_toSdkError` helper (4 copies) read `e.code` from `SdkRequestError`. The
   class's actual fields are `message`, `httpStatus`, `detail`, `raw`. So
   `httpStatus` was dropped on the floor and `error` came out as
   `fallbackCode` ("broker_login_url_failed") with `detail` populated from
   `e.message` — which was the backend's `error` string ("internal_error").
   The shape was also missing `httpStatus` from the `SdkError` interface
   entirely.

3. **Alphab2bapp (`Phase3SdkBrokerModal.js`).** The error renderer read
   `sdkError?.code` and `sdkError?.httpStatus`. `SdkError` ships `error` and
   (now) `httpStatus`, not `code` — so `code` always defaulted to the
   literal string `'sdk_error'` for every broker, every error. The
   user-visible string was always `sdk_error: <whatever-detail-said>`.

**Path through the screenshot.** User taps Connect Upstox → form submits →
SDK calls `/sdk/v1/connections/Upstox/login-url` → backend bug 1 throws
ReferenceError → backend returns 500
`{error:"internal_error", detail:"userEmail is not defined"}` → SDK
`SdkRequestError(message="internal_error", httpStatus=500, detail="userEmail is not defined", raw=...)` →
SDK bug 2's `_toSdkError` produces
`{error:"broker_login_url_failed", detail:"internal_error"}` → Alphab2bapp
bug 3 renders `sdk_error: internal_error`. All three layers are
contributing to the broken UX.

**Fix (this repo, `Phase3SdkBrokerModal.js` + new `sdkErrorHumanize.js`).**

- New `src/utils/sdkErrorHumanize.js` translates the SDK's `SdkError` shape
  into `{title, body, technical}` for the modal banner. `title` and `body`
  are user-facing copy ("Couldn't start Upstox login", "We couldn't reach
  the broker to begin the login flow. Check your internet connection..."),
  picked from a per-stage map (broker_login_url_failed,
  broker_exchange_failed, credential_submit_failed, edis_action_failed,
  rebalance_execute_failed) and refined when an upstream backend code is
  present (internal_error, broker_credential_validate_failed,
  redirect_url_mismatch, invalid_api_key, app_config_ambiguous,
  no_user_email_in_session, ...). `technical` is a small monospace
  breadcrumb like `broker_login_url_failed → internal_error (HTTP 500)`
  rendered as a caption beneath the body — support can still triage without
  asking the user to dig.
- `Phase3SdkBrokerModal.js`: state changed from `errorMessage` (flat string
  built from wrong fields) to `errorInfo` (structured object from
  `humanizeSdkError`). Renderer now shows title + body + technical caption
  instead of one flat error-code line. New `errorTitle`, `errorBody`,
  `errorTechnical` style entries added.

**Cross-repo fixes (paired commits, same session — backend deploy required).**

- **`aq_backend_github` `Ibt-branch`**: `Routes/sdk/v1/connections.js` —
  declare `userEmail` (via `_resolveUserEmail`) and `body = req.body || {}`
  at the top of the Upstox/Fyers/ICICI/Motilal/HDFC branch before
  `legacyBody` is built. Mirrors Angel One's branch-local pattern. Without
  this fix, all 5 brokers fail the SDK login-URL fetch — there's no
  workaround on the consumer side.
- **`alphaquark-mobile-sdk` `develop`**: `SdkError` interface gains optional
  `httpStatus?: number`. All 4 `_toSdkError` helpers updated to detect
  `SdkRequestError` (`httpStatus in e || e.name === "SdkRequestError"`) and
  propagate the HTTP status. Legacy duck-typed `code` branch retained for
  callers that throw plain `{code}` objects. Backwards compatible. All 76
  SDK tests still pass.

**Risk.** Zero regression risk on the consumer side: unmapped error codes
fall through to a generic title + body and still render the technical
breadcrumb. Backend fix is purely additive. SDK fix preserves the legacy
`code in e` branch.

**Deploy required:**
```bash
ssh tidi
cd /root/servers/server1/aq_backend_github
git pull
sudo systemctl restart alphaquark.service
```

**Files touched:**
- This repo: `src/utils/sdkErrorHumanize.js` (new),
  `src/components/BrokerConnectionModal/Phase3SdkBrokerModal.js`,
  `docs/PHASE3_ARCHITECTURE.md`.
- `aq_backend_github` (`Ibt-branch`): `Routes/sdk/v1/connections.js`.
- `alphaquark-mobile-sdk` (`develop`):
  `packages/rn/src/types/index.ts`,
  `packages/rn/src/components/{WebViewBrokerAuthFlow,BrokerCredentialForm,EdisModal,RebalanceReviewModal}.tsx`,
  `packages/rn/README.md`.

---

### Added — `<ExecutionGate>` RN component (greenfield, no entry points migrated)

**RN port of `tidi_new/lib/widgets/ExecutionGate.dart` (commit `7203a13`).** New
file `src/components/BrokerConnectionModal/ExecutionGate.js`. Wraps a
tap-target in a `Pressable` that runs `evaluateSessionGate` from
`@alphaquark/mobile-sdk` (the stateless SDK helper, same one tidi consumes
via Flutter package), shows a "Session Expired" alert on
`tokenExpired`/`notConnected`, dispatches reconnect through
`BrokerConnectModalDispatch` (preserving the
`REACT_APP_USE_SDK_BROKER_FLOW` flag-aware routing — we do NOT bypass it),
re-runs the gate after reconnect, and fires `onProceed(broker)` exactly
once.

**Composition decisions:**
- `cacheInvalidator` calls `useRefreshBrokerStatus({forceNetwork: true})` —
  RN's analogue of tidi's `AqApiService.invalidateUserCache()` +
  `CacheService.instance.invalidate('aq/user/brokers:<email>')`. We don't
  have a separate API-service cache layer; the `forceNetwork` refresh is
  what pushes fresh user/funds into `TradeContext`.
- `livenessProbe` bridges `utils/brokerSessionValidator.js`
  `validateBrokerSession` into the SDK's `GateLivenessProbe` shape (Funds
  API is the authoritative liveness probe both legacy and SDK already use;
  bridging avoids a second probe).
- Reconnect dialog uses inline `<Modal>` + `lucide-react-native` icon,
  matching the visual idiom of `KotakModal.js` / `Phase3SdkBrokerModal.js`
  (no dependency on the Zustand modal store, so the gate works regardless
  of whether `ModalManager` is mounted under it).
- `initialBroker` short-circuit: when supplied AND TradeContext agrees
  it's effectively connected, gate skips the network probe and fires
  `onProceed(initialBroker)` directly. Mirrors tidi's "skip if cached and
  effectively connected" pattern.

**Status: GREENFIELD.** No existing Alphab2bapp entry points
(`StockAdvices.js`, `RebalanceCard.js`, `RebalanceAdvices.js`,
`RebalanceModal.js`, `MPReviewTradeModal.js`) have been migrated. Per
`alphaquark-mobile-sdk/docs/EXECUTION_GATE_COMPOSITION.md` (also added
this commit cycle), migrations are blocked on SDK helpers for
broker-mismatch / Dummy confirmation / EDIS detection — until those land,
the existing inline pre-trade probe code paths must remain in place. The
component is shipped as a reusable primitive for future entry points and
to keep parity with tidi.

**Files touched (Alphab2bapp):**
- `src/components/BrokerConnectionModal/ExecutionGate.js` — new file.
- `docs/CHANGELOG.md` — this entry.
- `docs/PHASE3_PROGRESS.md` — entry (separate commit cycle handles the
  docs cross-ref).

**Files touched (alphaquark-mobile-sdk, separate repo, separate commit):**
- `docs/EXECUTION_GATE_COMPOSITION.md` — composition design + SDK helper
  proposals enumerated for the next 4 deliverables (mismatch, EDIS,
  Dummy, funds).

**Why this doesn't affect runtime:** The component is exported as a
library primitive but not yet wired into any screen. Existing pre-trade
probe code paths (which manually call `useRefreshBrokerStatus` +
`validateBrokerSession` + dispatch reconnect) remain unchanged.

---

### Changed — RecommendationSuccessModal: prefer `classification: 'LOW_FUNDS'` envelope from ccxt-india over message-text matching

**Follow-up to the LOW_FUNDS banner fix below.** ccxt-india's `message_map.py`
has been tagging `classification: 'LOW_FUNDS'` since 2026-04-23 (Angel One
AB4036, Axis ERR_NO_3_IN_1 with `shortFallFlag=BUY_FUND`, broker-specific
shortfall variants). Both mobile clients were ignoring that field and
re-deriving the same conclusion from `orderStatusMessage` text every time.

**Change.** The `lowFundsStocks` filter now checks
`item?.classification === 'LOW_FUNDS'` first; the existing message-text
matchers (`insufficient fund` / `low fund` / `insufficient margin` /
`insufficient balance`) become a fallback path used when classification is
absent (older backend deploys, broker code paths that bypass the classifier).

**Why not also use `RESTRICTED_SCRIP` for the cautionary detector?** The
backend's `RESTRICTED_SCRIP` tag is a broader umbrella covering NSE GSM / ASM
/ T2T / illiquidity / Motilal 100073 — not just cautionary listing. The
"Cautionary Listing Restriction" banner copy is specific, so swapping in the
umbrella tag would mis-trigger it for restricted-scrip categories that need
different user guidance. Cautionary detection stays text-based; added a
comment in the source explaining this asymmetry.

**Risk.** Zero regression on responses that don't carry `classification` — the
existing fallback path is preserved verbatim. New behaviour only applies when
the backend has tagged the response, i.e. on the 2026-04-23+ ccxt-india
deploy.

**Cross-branch + cross-repo sync.** Same change applied on Alphab2bapp
`feature/sdk-integration` (this commit) and `feature/sync-from-rgx`, plus the
analogous edit on tidi_new `feature/sdk-integration` and `feature/mp` (the
latter via the same cherry-pick chain that brings the LOW_FUNDS foundation).

**Files touched:**
- `src/components/ModelPortfolioComponents/RecommendationSuccessModal.js` —
  classification-first short-circuit in `lowFundsStocks` filter; comment on
  cautionary detector explaining why `RESTRICTED_SCRIP` is intentionally not
  used there.

---

### Fixed — RecommendationSuccessModal: surface Insufficient-Funds rejections + unmask "Order Failed" header when cautionary banner is present

**Problem (production trigger).** 2026-04-29 Angel One rebalance batch from
`prikc1333@gmail.com` (placed via tidi_new — same backend, same response shape
applies here): 26 MARKET orders were rejected — 7 cautionary + 19 Insufficient
Funds (available -₹26,38,712.73). The Trade Details modal in Alphab2bapp had
the same three bugs as the Flutter sibling:

1. **Header masked.** `RecommendationSuccessModal.js:295` ("Order Failed") and
   `:336` ("Some orders are not placed") were both gated on
   `!hasCautionaryListingFailures`, so the presence of even one cautionary stock
   suppressed the header summary entirely. The user saw the cautionary callout
   for 7 stocks and zero status header for the remaining 19 — visually implying
   they were still being processed.
2. **Insufficient-Funds invisible.** Every `orderStatusMessage` carried Angel
   One's wording (*"Your order has been rejected due to Insufficient Funds.
   Available funds - Rs. -2638712.73 . You require Rs. {x} ..."*), and the
   model row already exposed it via the `failureReason` chip — but no top-level
   banner explained the cause. The 19 LOW_FUNDS rejections fell into the
   generic "Failed" pile next to a yellow cautionary banner that didn't apply.
3. **No retry-button equivalent.** Unlike tidi_new, this screen has no "Retry
   Failed Orders" button — the modal is read-only post-execution. So the retry
   filter from the tidi_new fix doesn't apply here.

**Fix (`src/components/ModelPortfolioComponents/RecommendationSuccessModal.js`).**

- New `lowFundsStocks` detector matching `insufficient fund` / `low fund` /
  `insufficient margin` (Zerodha/Kotak phrasing) / `insufficient balance`
  (Upstox/Fyers phrasing). Single banner covers every broker.
- New `parseLowFundsAmounts` helper extracting Available + Required from Angel
  One's "Available funds - Rs. {x} . You require Rs. {y}" pattern. Aggregates
  one Available figure (same wallet across the batch) and a sum of Required
  across all rejected rows. Gracefully omits the summary box for brokers that
  don't ship numeric values.
- New Indian-grouping `formatINR` helper (12,34,567.89) — negative renders
  with leading minus to highlight margin-debit balances.
- New `lowFundsStyles` `StyleSheet` and red callout block — title, body,
  parsed Available/Required summary, wrap-of-pills symbol chips, and a 3-step
  "What you need to do" instructions block. Visually parallel to the existing
  `cautionaryStyles` block so the two banners read as a related family when
  both render.
- `failureCount === totalCount` and `successCount > 0 && successCount !==
  totalCount` branches no longer gated on `!hasCautionaryListingFailures` —
  the header summary and per-reason banners coexist now. Header subtitle
  branches on which banners are showing ("All N orders were rejected. See the
  alerts below for the reasons." when both, "Your broker rejected every order
  due to insufficient funds." when only LOW_FUNDS, "Every order was blocked by
  the exchange. See the alert below." when only cautionary, broker-message
  fallback otherwise).

**Pairs with tidi_new commit `c6c61de` and ccxt-india `RESTRICTED_SCRIP`
classifier (already shipped 2026-04-23 in `message_map.py`).** This Flutter +
RN pairing closes the user-visible gap surfaced by the 2026-04-29 incident
across both mobile clients. No backend change required — the LOW_FUNDS
matchers consume the existing `orderStatusMessage` string so this works
regardless of whether the backend has tagged `classification`.

**Cross-branch sync.** Same fix applied on both `feature/sdk-integration`
(currently active) and `feature/sync-from-rgx` per session-end checklist.

**Files touched:**
- `src/components/ModelPortfolioComponents/RecommendationSuccessModal.js` —
  detector, parser, formatter, banner block, status-header gate fix, new
  `lowFundsStyles` block.

---

### Fixed — Pre-broker exception envelope: surface real reason instead of literal "FAILURE" (cross-repo: ccxt-india)

**Problem.** Kotak failed orders showed only a red "FAILURE" chip in the Trade
Details screen with no actionable reason, while Zerodha failures correctly
showed actionable callouts (e.g. "Cautionary Listing Restriction"). Repro:
2026-04-29 08:05 UTC, prikc1333@gmail.com Kotak rebalance — every BUY failed
because Kotak's session was 502'ing on `api.order.book` and the symbol-master
fallback hit a missing `kotak_scrip_data` table, raising `ValueError("error in
converting from angleone symbol to kotak symbol")` BEFORE `place_order` was
called. Same batch on Zerodha showed the broker's actual rejection reasons.

**Root cause.** ccxt-india `TradingUtils.handle_trade_error`
(`trading_logic/utils/trade_utils.py`) is the catch-all for exceptions raised
in `process_single_trade` BEFORE the broker API call. It hardcoded:

```python
"orderStatusMessage": OrderStatus.FAILURE.value,  # literal string "FAILURE"
```

Both mobile clients prefer `orderStatusMessage` over `message` when picking the
display string (`tidi_new lib/models/order_result.dart:58`,
`Alphab2bapp src/screens/Home/OrderScreen.js:257`,
`StockAdviceContent.js:366`). So pre-broker exceptions arrived as a bare
"FAILURE" chip while broker-side rejections (which go through
`handle_failed_order` instead) correctly carried the broker's text.

**Fix (ccxt-india, server-side).** `handle_trade_error` now writes the bare
exception text on `orderStatusMessage` (truncated to 240 chars) and routes it
through `get_shortened_message` for `message_aq`. Two new MESSAGE_MAPPINGS
translate the noisiest internal phrasings:

- `"error in converting from angleone symbol"` → `"Symbol not found in your broker's scrip master — contact support."`
- `"is an issue with payload OR processing payload info"` → `"Order rejected before broker — internal validation failed."`

**No mobile-app code change required.** Both `Alphab2bapp` and `tidi_new` already
prefer `orderStatusMessage` and will pick up the new value on the next
`process_trades` poll. This entry exists because the change is documented in
this repo for cross-repo discoverability per the CLAUDE.md cross-repo sync
rule (the same fix is documented in
`tidi_new/docs/BROKER_TRADING_ARCHITECTURE.md` and
`ccxt-india/docs/ORDER_PLACEMENT_ANALYSIS.md § 11`).

**Files touched (this repo): none.** Documentation-only entry.

**Files touched (ccxt-india):**
- `trading_logic/utils/trade_utils.py` — `handle_trade_error` envelope
- `trading_logic/utils/message_map.py` — two new mappings
- `docs/ORDER_PLACEMENT_ANALYSIS.md` — new § 11

**Deploy required:**
```bash
ssh tidi
cd /root/servers/server2/ccxtprod/ccxt-india
./pull_restart.sh
```

**TODO for the user:** the ccxt-india patch is committed locally + pushed but
NOT auto-deployed to the server. Run `./pull_restart.sh` on `ssh tidi` when
you're ready to ship.

---

## [3.9.61] - 2026-04-29

### SDK reauth via initialValue — drop isReauthFlow short-circuit

Closes the deferred half of the Phase 3 SDK migration. The SDK lane now handles BOTH first-connect AND re-auth on a single code path. End-to-end emulator verification PENDING.

**What changed:**
- `BrokerConnectModalDispatch.js` — dropped the `isReauthFlow` short-circuit. When `REACT_APP_USE_SDK_BROKER_FLOW` is on, every broker connect (first-connect + reconnect) routes to `Phase3SdkBrokerModal`.
- `Phase3SdkBrokerModal.js` — new `buildSchemaOverride(brokerName, userDetails)` helper builds a per-broker `schemaOverride` whose fields carry `initialValue` from `getStoredBrokerCreds` (and for Kotak `transformValue: normaliseKotakMobile`). New `useEffect` fetches `userDetails` on mount and resolves the override; `schemaOverridePending` gates the form on the fetch. Form re-mounts via `key` prop change when override resolves so the SDK's `useState` initialiser re-seeds.
- `BrokerCredentialForm` (SDK) `useState` initialiser merges base schema's `initialValue` with `schemaOverride.fields[].initialValue` — that wiring was added in the prior 3.9.60 SDK port.

**On reconnect:** apiKey + secretKey + clientCode + ucc + mobileNumber are pre-filled from stored creds. User types only the volatile fields (mpin + totp for Kotak; nothing else for credential brokers). Cuts re-entry from 3-5 fields to 0-2.

**On first-connect:** no stored entry → every `initialValue` resolves to `''` → form renders empty. Same UX as before.

**No `authUrl` path.** Unlike legacy `reauthHelpers.handleSmartReauth` (which fetches a pre-signed broker OAuth URL via `/api/<broker>/reauth-url` and pipes it through `reauthConfig.authUrl`), the SDK lane always mints a fresh login URL via `client.getBrokerLoginUrl`. Legacy `reauthConfig` is still resolved by `ManageConnectionsModal` for the legacy lane (flag off) where modals like `UpstoxModal` continue to consume it. SDK lane ignores `reauthConfig` entirely.

**Per-broker coverage** matches `getStoredBrokerCreds` in `src/utils/brokerCredentials.js`:
- Kotak: apiKey + ucc + mobileNumber (with mobile normalisation transform)
- Groww: apiKey + growwTotpSeed
- Motilal Oswal: apiKey + clientCode
- Fyers: apiKey + secretKey + clientCode (DB-naming inversion absorbed)
- Angel One per-customer: apiKey + secretKey + clientCode
- Upstox / ICICI Direct / Hdfc Securities: apiKey + secretKey
- Zerodha / Dhan / AliceBlue / Axis Securities: no override (OAuth-only schemas)

Mirror of tidi_new commit `2d44fbf` (Kotak smart-prefill + Groww silent refresh + Fyers field inversion).

**Files touched:**
- `src/components/BrokerConnectionModal/Phase3SdkBrokerModal.js`
- `src/components/BrokerConnectionModal/BrokerConnectModalDispatch.js`
- `docs/PHASE3_ARCHITECTURE.md` — routing rule + per-broker override builder table
- `docs/PHASE3_PROGRESS.md` — entry
- `docs/CHANGELOG.md` — this entry

`build.gradle` 3.9.60 → 3.9.61.

---

## [3.9.60] - 2026-04-29

### SDK parity sweep — RN SDK + simplified Alphab2bapp routing

Three blocker items from `docs/SDK_PARITY_AUDIT.md` resolved in one sweep. End-to-end emulator verification PENDING.

**1. Ported `BrokerFormField.initialValue` + `transformValue` from Flutter SDK to RN SDK.** Mirror of mobile-SDK Flutter commit `64d4eff`. Files: `alphaquark-mobile-sdk/packages/rn/src/components/brokerFormSchema.ts` (new optional fields), `BrokerCredentialForm.tsx` (state seeded from `initialValue`, `readField()` helper applies `transformValue` before validation + body construction), `__tests__/brokerFormSchema.spec.ts` (Flutter-parity test). Rebuilt `lib/` via `tsc`. Both SDK packages now expose the same `BrokerFormField` shape; reconnect-pre-fill (Kotak smart-prefill, Upstox/Fyers/HDFC/ICICI/Motilal apiKey/secretKey pre-fill) is now possible in RN consumers via `schemaOverride.fields[].initialValue`.

**2. Dropped `SDK_ELIGIBLE_MODALS` allowlist + `SDK_LEGACY_FALLBACK` kill-switch from `BrokerConnectModalDispatch.js`.** Routing collapses to `useSdkBrokerFlow() && !isReauthFlow` → `Phase3SdkBrokerModal` for ALL brokers. The flag is the single switch. tidi_new (Flutter) has been routing all 13 brokers through SDK on a single flag since `bd1b501`; Alphab2bapp now matches. Re-auth still routes legacy as a deferred follow-up (needs SDK plumbing for pre-signed `authUrl` + `initialValue` reauth pre-fill).

**3. Fixed double-header bug in `Phase3SdkBrokerModal`.** Pass `renderHeader={() => null}` to `WebViewBrokerAuthFlow` so SDK widget's default close-button header is suppressed. Consumer's own `<Header>` (close ✕ + title) renders above it. Flutter side never had this — Flutter `WebViewBrokerAuthFlow` doesn't ship its own AppBar/Scaffold.

**Files touched (this commit):**
- `alphaquark-mobile-sdk/packages/rn/src/components/brokerFormSchema.ts`
- `alphaquark-mobile-sdk/packages/rn/src/components/BrokerCredentialForm.tsx`
- `alphaquark-mobile-sdk/packages/rn/src/__tests__/brokerFormSchema.spec.ts`
- `alphaquark-mobile-sdk/packages/rn/lib/**` (rebuilt)
- `Alphab2bapp/src/components/BrokerConnectionModal/BrokerConnectModalDispatch.js`
- `Alphab2bapp/src/components/BrokerConnectionModal/Phase3SdkBrokerModal.js`
- `Alphab2bapp/docs/PHASE3_ARCHITECTURE.md`
- `Alphab2bapp/docs/PHASE3_PROGRESS.md`
- `Alphab2bapp/docs/CHANGELOG.md`

`build.gradle` 3.9.59 → 3.9.60.

**Deferred:** SDK reauth via `initialValue` + pre-signed `authUrl` injection. Plumbing exists on the SDK side now; needs `Phase3SdkBrokerModal` to consume `reauthConfig` and `WebViewBrokerAuthFlow` to skip `getBrokerLoginUrl` when authUrl is supplied. Once shipped, the `isReauthFlow` short-circuit in `BrokerConnectModalDispatch` comes out and reauth goes SDK too.

---

## [3.9.59] - 2026-04-29

### Phase 3 — Groww promoted to SDK route (rebuild of 3.9.58)

`build.gradle` 3.9.58 → 3.9.59 — second APK cut covering the same Groww-to-SDK promotion. No code change between 3.9.58 and 3.9.59; just a fresh build artifact for distribution. See the original work below.

Groww promoted from `SDK-broken` → `SDK-clean` in `docs/PHASE3_BROKER_AUDIT.md`. Added to `SDK_ELIGIBLE_MODALS` in `src/components/BrokerConnectionModal/BrokerConnectModalDispatch.js`. Allowlist is now 11 brokers — `HDFC, Upstox, ICICI, Motilal, Dhan, Kotak, AliceBlue, Fyers, Axis Securities, Groww, DummyBroker`.

The blockers documented in the prior audit closed via two earlier cross-repo commits already deployed:

- `alphaquark-mobile-sdk` `0291e02` — `feat(sdk): Groww schema — 2 fields (drop secretKey), permissive Base32 pattern`. Reshaped `packages/rn/src/components/brokerFormSchema.ts` from `[apiKey, secretKey, growwTotpSeed (16-char strict)]` to legacy-equivalent `[apiKey, growwTotpSeed (any-length Base32 `^[A-Z2-7]+$/i`)]`. Mirrors `GrowwConnectModal` exactly.
- `aq_backend_github/Routes/sdk/v1/connections.js` — `CREDENTIAL_BROKER_VALIDATE_DISPATCH.Groww` (lines 602-614) renames the SDK body `{apiKey, growwTotpSeed | totp_seed}` → POST `/api/groww/update-key` `{uid, user_email, user_broker, apiKey, totp_seed}`. The SDK `/connect` route now goes through full ccxt-india validation in `app_groww.py` (mints a fresh TOTP via Base32 seed → calls Groww `/v1/login` → persists jwtToken on success → returns broker-specific error codes `NOT_BASE32`, `WRONG_LENGTH`, `GROWW_REJECTED` on failure). Closes the original blocker that bare `/connect` was persist-only.

`Phase3SdkBrokerModal` already had `'Groww'` in `IP_WHITELIST_BROKERS` (legacy gates on `egressReady`); `Phase3BrokerHelp` already maps `Groww → GrowwHelpContent`. No changes needed there.

Reauth still routes to legacy via the existing `isReauthFlow` short-circuit — Groww's silent-refresh path `/api/groww/refresh-token` is not yet exposed via the SDK reauth route, but in-app reauth UX is unchanged.

Accepted minor diffs (matching Kotak/Motilal precedent): per-error-code custom rendering surfaces as generic `SdkRequestError` with upstream `detail` instead of the 5 broker-specific actionable messages legacy renders. Tracked as a Known SDK Gap — does not block promotion.

End-to-end emulator verification PENDING. If parity break is reported, revert this commit only — SDK schema and backend dispatch can stay in place.

**Files touched (this commit):**
- `src/components/BrokerConnectionModal/BrokerConnectModalDispatch.js` — added `'Groww'` to `SDK_ELIGIBLE_MODALS` with promotion rationale.
- `docs/PHASE3_BROKER_AUDIT.md` — Groww row + per-broker section verdict promoted.
- `docs/PHASE3_ARCHITECTURE.md` — allowlist membership updated, Groww-specific dispatch note added.
- `docs/PHASE3_PROGRESS.md` — entry appended.
- `docs/CHANGELOG.md` — this entry.

**Cross-repo dependencies (already shipped, not in this commit):**
- `alphaquark-mobile-sdk` commit `0291e02` (Groww schema reshape).
- `aq_backend_github` `CREDENTIAL_BROKER_VALIDATE_DISPATCH.Groww` (`Routes/sdk/v1/connections.js:602-614`). Backend deploy via scp + `sudo systemctl restart alphaquark.service`.

**Cross-app note:** `tidi_new` (Flutter) explicitly held Groww on legacy at commit `e064e6e` (2026-04-28) due to the original `/connect` persist-only gap. With that gap closed in the backend, `tidi_new` can promote Groww symmetrically — tracked separately, not part of this Alphab2bapp commit.

---

## [3.9.57] - 2026-04-29

### Phase 3 audit revision: OAuth-with-creds /login-url gap fix + IIFL rollback

User-requested audit caught two issues with the prior 11-broker promotion:

**1. Backend `/login-url` gap (HDFC / Upstox / ICICI Direct / Motilal Oswal / Fyers)** — these `flow=oauth` brokers have credential fields. SDK `WebViewBrokerAuthFlow.getBrokerLoginUrl` sent only `redirectUrl` to `/login-url`, not the form's collected creds. Backend had no dispatch for these 5 brokers and returned 400 `broker_login_url_not_applicable`. SDK flow died before WebView opened.

Fixes:
- `@alphaquark/mobile-sdk`: `AqSdkClient.getBrokerLoginUrl` accepts a `credentials` parameter and merges into POST body. `WebViewBrokerAuthFlow` forwards `extraExchangeBody` to it.
- `aq_backend_github/Routes/sdk/v1/connections.js`: `/login-url` route gained dispatch for these 5 brokers that proxies to `/api/<slug>/update-key` via `_selfCallLegacy` and parses OAuth URL from any of 5 known response shapes.

**2. IIFL Securities rolled back from `SDK_ELIGIBLE_MODALS`.** Schema declared `credentials_totp` but legacy is empty-fields OAuth at hardcoded `markets.iiflcapital.com`. No `LEGACY_PER_BROKER_SLUG` entry, no `/login-url` dispatch, no `Phase3BrokerHelp` entry. SDK would have shown wrong UX + failed with 400. Stays legacy until schema reshape lands.

Final allowlist (10 brokers): `HDFC, Upstox, ICICI, Motilal, Dhan, Kotak, AliceBlue, Fyers, Axis Securities, DummyBroker`. Unchanged: `Angel One, Zerodha` in `SDK_LEGACY_FALLBACK`. Groww + IIFL unlisted.

UX parity verified per broker in `docs/SDK_MOBILE_FIT_ASSESSMENT.md § §9` — table covering form fields, encryption, help, IP gate, OAuth URL minting, WebView, intercept, exchange, persistence.

`build.gradle` 3.9.56 → 3.9.57.

---

## [3.9.56] - 2026-04-28

### Phase 3: Final batch (IIFL + DummyBroker promoted; 11/14 brokers SDK-clean)

`SDK_ELIGIBLE_MODALS` final: `{HDFC, Upstox, ICICI, Motilal, Dhan, Kotak, AliceBlue, Fyers, Axis Securities, IIFL, IIFL Securities, DummyBroker}`.

- **IIFL Securities** — promoted. SDK path fixes the legacy AsyncStorage-only persistence gap (backend `/exchange-token` fallthrough writes to MongoDB). Architectural improvement.
- **DummyBroker** — promoted. Trivial stub.

Stays legacy:
- **Angel One** — in `SDK_LEGACY_FALLBACK`. Publisher-OAuth shared-mode incompatible with SDK widget per-customer schema.
- **Zerodha** — in `SDK_LEGACY_FALLBACK`. Android 302 redirect race (out-of-band Kite portal change required).
- **Groww** — NOT in allowlist. SDK schema dual-field + Base32 validator work deferred.

`build.gradle` 3.9.55 → 3.9.56.

---

## [3.9.55] - 2026-04-28

### Phase 3: Axis Securities promoted to SDK-clean (9th promotion)

Axis backend dispatches were already in place (verified `connections.js:894, 1117`). Changes:
- Removed `'Axis Securities'` from `SDK_LEGACY_FALLBACK`.
- Added `'Axis Securities'` to `SDK_ELIGIBLE_MODALS`.

UX parity ✅. Subject to upstream Axis SSO bug 1083 (Axis-side) — both legacy and SDK fail with the same error when it hits.

`build.gradle` 3.9.54 → 3.9.55.

---

## [3.9.54] - 2026-04-28

### Phase 3: Fyers promoted to SDK-clean (8th promotion)

- IP_WHITELIST_BROKERS += 'Fyers'.
- Backend `/exchange-token` Fyers dispatch: translates field-naming inversion server-side (modal `apiKey` = OAuth secret → ccxt `clientSecret`; modal `secretKey` = clientId → ccxt `clientId`). Mirror of legacy.
- SDK_ELIGIBLE_MODALS += 'Fyers'.

UX parity ✅. Reauth routes to legacy. `build.gradle` 3.9.53 → 3.9.54.

---

## [3.9.53] - 2026-04-28

### Phase 3: AliceBlue promoted to SDK-clean (7th promotion)

- SDK schema: `flow=oauth, fields=[]` (matches Zerodha shape, empty-fields OAuth). NPM package update required.
- Backend `/login-url` hardcodes `origin=https://prod.alphaquark.in` (AliceBlue's partner appcode allow-listed against prod.alphaquark.in only).
- Backend `/exchange-token` accepts `{access_token, client_id}` from WebView capture, persists.
- `SDK_ELIGIBLE_MODALS` += AliceBlue.

UX parity ✅. `build.gradle` 3.9.52 → 3.9.53.

---

## [3.9.52] - 2026-04-28

### Phase 3: Kotak Securities promoted to SDK-clean (6th promotion)

`SDK_ELIGIBLE_MODALS` += 'Kotak'. No backend change. `/update-credentials` already dispatches Kotak to `/api/kotak/connect-broker` (connections.js:1423-1425).

UX parity ✅ except minor diff: 30s TOTP cooldown + TOTP-specific error parsing not in SDK widget.

`build.gradle` 3.9.51 → 3.9.52.

---

## [3.9.51] - 2026-04-28

### Phase 3: Dhan promoted to SDK-clean (5th promotion)

`SDK_ELIGIBLE_MODALS` extended to `{HDFC, Upstox, ICICI, Motilal, Dhan}`. Dhan is partner-OAuth (CCXT holds the platform PARTNER_ID); no per-user form, no IP gate. Backend fallthrough else-branch already handles `{dhan_client_id, dhan_access_token}`.

UX parity ✅ except minor diffs: prefetch optimization, manual fallback path, custom User-Agent — none in SDK widget. User-accepted.

`build.gradle` 3.9.50 → 3.9.51.

---

## [3.9.50] - 2026-04-28

### Phase 3: Motilal Oswal promoted to SDK-clean (4th promotion)

Three fixes:
1. `Phase3SdkBrokerModal.IP_WHITELIST_BROKERS` extended to include `'Motilal Oswal'`.
2. Backend `/sdk/v1/connections/Motilal Oswal/exchange-token` dispatch added (BACKEND DEPLOY REQUIRED). Motilal returns `accessToken` directly in the redirect URL — no separate gen-access-token call. Dispatch forwards `{accessToken, apiKey, clientCode}` to persist.
3. `BrokerConnectModalDispatch.SDK_ELIGIBLE_MODALS` extended to `{HDFC, Upstox, ICICI, Motilal}`.

UX parity ✅ except documented minor diff: 30s session-affinity debounce + `handleRequestRestart` callback (MotilalModal:116-136) not in SDK widget. User-accepted minor diff.

`build.gradle` 3.9.49 → 3.9.50.

---

## [3.9.49] - 2026-04-28

### Phase 3: ICICI Direct promoted to SDK-clean (3rd promotion)

Tagged: **PHASE 3 — ICICI DIRECT PROMOTION**

ICICI Direct was already structurally aligned (backend dispatch existed at connections.js:1180-1205, IP_WHITELIST_BROKERS already included). Just needed the allowlist promotion.

`BrokerConnectModalDispatch.SDK_ELIGIBLE_MODALS` extended from `{HDFC, Upstox}` to `{HDFC, Upstox, ICICI}`.

UX parity vs legacy: form ✅, encryption ✅, help (YouTube `XFLjL8hOctI` + 3 steps + Breeze IP whitelist instructions) ✅, IP gate ✅, `apisession=` intercept ✅, session_token exchange via ccxt `/icici/customer-details` ✅ (existing backend dispatch), persistence ✅.

**Files**: `BrokerConnectModalDispatch.js`, `docs/PHASE3_BROKER_AUDIT.md`, `docs/PHASE3_PROGRESS.md`, `android/app/build.gradle` (3.9.48 → 3.9.49).
**Backend**: No deploy needed — dispatch already in place.

---

## [3.9.48] - 2026-04-28

### Phase 3: Upstox promoted to SDK-clean (2nd promotion)

Tagged: **PHASE 3 — UPSTOX PROMOTION**

Same pattern as HDFC. Three discrete fixes:
1. `Phase3SdkBrokerModal.IP_WHITELIST_BROKERS` extended to include `'Upstox'`. Legacy `upstoxModal.js:130` gates Connect on `egressReady` (UDAPI1154 errors from non-whitelisted IPs).
2. Backend `/sdk/v1/connections/Upstox/exchange-token` dispatch added (BACKEND DEPLOY REQUIRED). Calls ccxt `/upstox/gen-access-token` with `{user_email, apiKey, apiSecret, code, redirectUri}`. Mirror of legacy `upstoxModal:246-266`.
3. `BrokerConnectModalDispatch.SDK_ELIGIBLE_MODALS` extended to `{HDFC, Upstox}`.

UX parity vs legacy: form ✅, encryption ✅, help (YouTube `yfTXrjl0k3E` + 5 steps + UDAPI1154 IP whitelist warning) ✅, IP gate ✅, OAuth + `code=` intercept ✅, token exchange ✅, persistence ✅. Two minor differences: defensive URL error parsing not in SDK (legacy shows broker-specific error_message before opening WebView; SDK shows it inside WebView one step later — still visible to user). Re-auth still routes to legacy via `isReauthFlow` short-circuit (cross-cutting SDK gap).

**Files**:
- `src/components/BrokerConnectionModal/Phase3SdkBrokerModal.js`
- `src/components/BrokerConnectionModal/BrokerConnectModalDispatch.js`
- `aq_backend_github/Routes/sdk/v1/connections.js` (BACKEND DEPLOY REQUIRED)
- `docs/PHASE3_BROKER_AUDIT.md`, `docs/PHASE3_PROGRESS.md`
- `android/app/build.gradle` — 3.9.47 → 3.9.48

---

## [3.9.47] - 2026-04-28

### Phase 3: HDFC Securities promoted to SDK-clean (first production promotion)

Tagged: **PHASE 3 — HDFC PROMOTION**

First broker promoted to `SDK_ELIGIBLE_MODALS` per the new audit-driven workflow. After the 2026-04-28 audit (`docs/BROKER_FLOW_AUDIT.md` § HDFC Securities), HDFC was the closest-to-clean OAuth broker — needed only three discrete fixes:

1. **`Phase3SdkBrokerModal.IP_WHITELIST_BROKERS`** extended to include `'HDFC'` and `'Hdfc Securities'`. Legacy `HDFCconnectModal` gates the Connect button on `egressReady` (line 303); without this set membership the SDK flow would let users submit credentials before claiming a static egress IP, leading to opaque "IP not whitelisted" errors from HDFC after order placement.
2. **Backend `/sdk/v1/connections/Hdfc Securities/exchange-token`** dispatch added in `aq_backend_github/Routes/sdk/v1/connections.js`. The route's per-broker dispatch had Axis / Zerodha / ICICI Direct branches but no HDFC branch — the fallthrough else-branch wrongly treated `requestToken` as the final long-lived token. New branch calls ccxt `/hdfc/access-token` with `{apiKey, apiSecret, requestToken}`, extracts `accessToken`, returns the persistable shape. **Backend deploy required**: `scp Routes/sdk/v1/connections.js tidi:servers/server1/aq_backend_github/Routes/sdk/v1/ && ssh tidi 'sudo systemctl restart alphaquark.service'`.
3. **`BrokerConnectModalDispatch.SDK_ELIGIBLE_MODALS`** updated from `new Set([])` (empty default after the 2026-04-28 reset) to `new Set(['HDFC'])`. First broker added; the all-13 local-test override is no longer needed for HDFC.

UX parity assessment vs legacy (full table in `docs/PHASE3_PROGRESS.md`): form fields ✅, encryption envelope ✅, help content (video `XFLjL8hOctI` + 5-step guide) ✅ via `Phase3BrokerHelp`, IP-whitelist gate ✅ (with this commit), WebView OAuth ✅, token exchange ✅ (after backend deploy), persistence ✅. Two minor differences: success toast wording differs (SDK calls `fetchBrokerStatusModal` rather than `showAlert('success', ...)`), error display is an inline banner vs legacy alert. Re-auth flows still route to legacy via the `isReauthFlow` short-circuit in `BrokerConnectModalDispatch` to preserve `reauthConfig` pre-fill (cross-cutting SDK gap; tracked in `BROKER_FLOW_AUDIT.md` § Cross-cutting findings #1).

**Files**:
- `src/components/BrokerConnectionModal/Phase3SdkBrokerModal.js` — IP_WHITELIST_BROKERS extension + audit-derived comment block.
- `src/components/BrokerConnectionModal/BrokerConnectModalDispatch.js` — SDK_ELIGIBLE_MODALS = `{HDFC}` + per-broker promotion log comment.
- `aq_backend_github/Routes/sdk/v1/connections.js` — HDFC `/exchange-token` dispatch (BACKEND DEPLOY REQUIRED).
- `docs/PHASE3_BROKER_AUDIT.md` — HDFC verdict promoted to SDK-clean.
- `docs/PHASE3_PROGRESS.md` — work log entry with UX parity table + backend deploy steps.
- `android/app/build.gradle` — versionCode 45 → 47, versionName 3.9.45 → 3.9.47 (skips 3.9.46 because that version is already taken by the prior Kotak round-2 commit).

---

## [3.9.46] - 2026-04-28

### Fixed — Kotak connect: post-2xx false-negative still surfacing as "Connection Issue" (round 2)

Round 1 (3.9.38, commit `172767d`) wrapped the **second** `.then` block of `KotakModal.updateKotakSecretKey` in try/catch, expecting that to swallow all post-success throws. Production retest 2026-04-28 14:09 IST proved that wasn't enough: the user successfully connected (backend log: `POST /kotak/login/totp` 200 + `PUT /api/kotak/connect-broker` 200 with full token / UCC `XL6HF` / greeting `ANKITA`, plus 3 `insert_user_doc` writes to model portfolios) but the app still showed "Connection Issue — credentials may already be saved, please refresh."

The "Connection Issue" wording confirmed the new APK was installed (that's the exact string from the round-1 fix). But the throw was happening in the **first** `.then` (lines 223-262), which round 1 did not wrap. Suspects in that block:

- `sdkBridge.enabled && sdkBridge.ready && sdkBridge.client` — TypeError if `sdkBridge` itself is undefined (unlikely; hook).
- `sdkConnectBroker(sdkBridge.client, 'Kotak', data)` — argument evaluation; the async function itself catches synchronous throws.
- `generateToken(Config.REACT_APP_AQ_KEYS, Config.REACT_APP_AQ_SECRET)` — synchronous call to JWT generator. **Most likely culprit**: env vars missing or token-generation code throws under some condition. Runs synchronously during headers-object construction, BEFORE the inner `axios.request(A1_broker).catch(err => null)` has a chance to catch.
- `JSON.stringify(newBrokerData)`, template literals — vanishingly unlikely.

**Fix (`src/components/BrokerConnectionModal/KotakModal.js`):**

Wrapped the FIRST `.then`'s body in two independent try/catch blocks — one for the SDK dual-write, one for the model-portfolio update setup + axios call. Each logs a `[Kotak Neo] ... threw (connection IS saved DB-side): <msg>` warning and continues. Result: NO post-2xx code path can poison the outer `.catch` anymore. The broker shows as connected (DB-side state is saved); worst case under the new wrap is a missing toast or a missed model-portfolio sync, both recoverable on next refresh.

**Files touched:**
- `src/components/BrokerConnectionModal/KotakModal.js` — wrapped first-`.then` body in two granular try/catch blocks (one for SDK dual-write, one for model-portfolio update).

**Same first-`.then` exposure exists in all 12 sibling modals** (Angel One, AliceBlue, Axis, Dhan, Fyers, Groww, HDFC, ICICI, IIFL, Motilal, Upstox, Zerodha). The 3.9.40 port (commit `0aae0e5`) addressed the second-`.then` block in each, mirroring the round-1 Kotak fix; the same first-`.then` audit pass is needed there too. Holding off until this Kotak round-2 fix is verified working in production, then porting verbatim.

**Test plan:** install new APK, reconnect Kotak with fresh TOTP, expect "Connected Successfully" toast (or silent success if a post-success step still throws). Watch `adb logcat | grep '\[Kotak Neo\]'` for any `threw (connection IS saved DB-side)` warnings — if one fires, that pins the exact thrower for follow-up.

---

## [3.9.45] - 2026-04-28

### Phase 3 SDK Broker Migration — documentation-first reset + allowlist reset to empty

Tagged: **PHASE 3 — DOCS BLOCKER + ALLOWLIST RESET — CROSS-BROKER IMPACT**

Triggered by user feedback on multiple Phase 3 production-visible regressions (Axis `broker_login_url_failed`, AliceBlue showing wrong UX, Zerodha 302 intercept loss on Android, Angel One per-customer SmartAPI rejection, re-auth misrouted). Root cause in every case: SDK widget shipped before the legacy modal's UX surface was actually mapped.

**Documentation-first contract added to `CLAUDE.md`.** Any change touching Phase 3 surfaces (`Phase3SdkBrokerModal.js`, `ModalManager.js` SDK_ELIGIBLE_MODALS / SDK_LEGACY_FALLBACK / re-auth bypass, `REACT_APP_USE_SDK_BROKER_FLOW`, SDK widgets in `../alphaquark-mobile-sdk/packages/rn/src/components/`, `aq_backend_github/Routes/sdk/v1/connections.js`) MUST update all three new docs in the SAME commit:

- `docs/PHASE3_ARCHITECTURE.md` — design source-of-truth (routing rules, allowlist policy, re-auth bypass, Phase3SdkBrokerModal contract, SDK widget contracts, backend route mapping, `useSharedAngelOneKey` resolution).
- `docs/PHASE3_BROKER_AUDIT.md` — per-broker legacy → SDK comparison matrix with verdicts (SDK-clean / SDK-with-gap / SDK-broken / Not-audited / Incomplete-audit). All 13 brokers audited end-to-end: legacy modal file, submit endpoint(s), encryption envelope, form fields, OAuth WebView intercept, reauth handling, IP-callout, broker-specific quirks, SDK gap analysis, verdict.
- `docs/PHASE3_PROGRESS.md` — chronological work log; one entry per Phase 3 commit with broker(s) affected, files touched, verdict change, regressions observed, rollback decisions.

**`SDK_ELIGIBLE_MODALS` reset to empty.** Previously: opt-OUT (all 13 brokers in the set; `SDK_LEGACY_FALLBACK = {Angel One, Zerodha}` carved out exceptions). Now: opt-IN — empty set, every broker routes to legacy regardless of `REACT_APP_USE_SDK_BROKER_FLOW`. Brokers promote one at a time when their audit row reaches verdict=SDK-clean AND emulator verification is recorded.

Audit findings:
- **SDK-broken** (legacy UX shape fundamentally incompatible with `BrokerCredentialForm + WebViewBrokerAuthFlow`): Angel One (publisher-OAuth with embedded apiKey), Kotak (TOTP + mpin + 30s debounce), Groww (Base32 TOTP secret + dual-TOTP collection), IIFL Securities (AsyncStorage-only, no MongoDB persistence).
- **SDK-with-gap** (compatible but gaps): Upstox / ICICI Direct / Dhan / Fyers / Motilal / AliceBlue / Axis Securities. Most need reauth pre-fill API in SDK widget + backend `/exchange-token` per-broker handlers.
- **SDK-clean candidates** (subject to emulator verification + targeted fixes): HDFC Securities (needs `IP_WHITELIST_BROKERS` extension); Axis Securities (needs backend `/sdk/v1/connections/Axis Securities/login-url` proxy fix).
- **Incomplete-audit**: Zerodha (wrapper-only audit; deeper `ZerodhaConnectUI` read pending; out-of-band Kite dev-portal redirect URL change required regardless).

Cross-cutting gaps documented:
- Reauth pre-fill missing in SDK (cross-cutting; mitigated today by `isReauthFlow` short-circuit routing all reauth to legacy).
- `WebViewBrokerAuthFlow.onClose` cred preservation when dropping back to form phase.
- `EgressIpCallout` content thinner than legacy step-by-step IP-claim screens.
- Backend `/exchange-token` per-broker callback handlers needed for non-standard query params (`apisession` ICICI, `requestToken` HDFC, `accessToken` Motilal, `auth_token` Angel One/AliceBlue, `ssoId` Axis).
- `IP_WHITELIST_BROKERS` set in `Phase3SdkBrokerModal` is incomplete: should also include HDFC, Upstox, Fyers, Motilal Oswal (all gate on egressReady in legacy). AliceBlue may need to be removed (legacy doesn't gate).
- SDK schema mismatches with live broker APIs (Kotak NEO, Motilal Oswal, AliceBlue).

**Files**:
- `CLAUDE.md` — new "Phase 3 SDK Broker Migration — BLOCKING DOCUMENTATION REQUIREMENT" section + extended session checklist + extended "When to update these docs" with PHASE3_*.md entries.
- `docs/PHASE3_ARCHITECTURE.md` — new design doc.
- `docs/PHASE3_BROKER_AUDIT.md` — new audit matrix with all 13 broker rows populated.
- `docs/PHASE3_PROGRESS.md` — new work log with backfilled entries for prior Phase 3 commits + audit completion + allowlist reset.
- `src/GlobalUIModals/ModalManager.js` — `SDK_ELIGIBLE_MODALS = new Set([all 13])` → `new Set([])`. Updated comment to reference `docs/PHASE3_BROKER_AUDIT.md` as the gate. `SDK_LEGACY_FALLBACK` kept defensively.
- `android/app/build.gradle` — versionCode 44 → 45, versionName 3.9.44 → 3.9.45.

**Effect**: with empty allowlist, flipping `REACT_APP_USE_SDK_BROKER_FLOW=true` is now safe (no behavior change). Phase 3 promotion is gated by the audit doc and emulator verification, not by what's already shipped. The next Phase 3 code change MUST go through the audit + architecture + progress docs in the same commit.

---

## [3.9.42] - 2026-04-28

### Added — Phase 3 Angel One shared-mode dispatch (useSharedAngelOneKey)

Honors the per-advisor `useSharedAngelOneKey` toggle from
`prod-alphaquark-github` `0f774455` so Phase 3 doesn't break advisors
running shared-mode Angel One. When the flag is ON (default-safe per
the platform's AppConfigContext default-true direction), `Angel One`
in `ModalManager.js` falls through to the legacy
`AngleoneBookingTrueSheet` even with `REACT_APP_USE_SDK_BROKER_FLOW=true`
— because the SDK route family does not yet expose a shared-mode
`/sdk/v1/connections/Angel%20One/login-url` handler. When the
advisor flips the config to FALSE (per-customer SmartAPI app per
0202f27c), the new `Phase3SdkBrokerModal` handles Angel One via
`/update-credentials` → `/api/angel-one/update-key`.

**Files**:
- `src/GlobalUIModals/ModalManager.js` — adds `useSharedAngelOneKey()`
  helper reading `configData.config.useSharedAngelOneKey` (per-advisor
  backend response, authoritative when boolean) → falls back to
  `REACT_APP_USE_SHARED_ANGEL_ONE_KEY` env → defaults to `true`. When
  Phase 3 dispatch sees `Angel One` AND shared mode, lets the legacy
  switch render `AngleoneBookingTrueSheet`. Other brokers always go
  through Phase3SdkBrokerModal when flag on.
- `android/app/build.gradle` — versionCode 41 → 42, versionName 3.9.41 → 3.9.42.

**Per-advisor migration path**:
1. Default state: `useSharedAngelOneKey=true` → legacy Angel One UX
   (no change for current users).
2. Advisor enables per-customer mode: backend returns `false` →
   Phase 3 SDK widget renders for Angel One automatically (no rebuild).
3. Backend extension to expose shared-mode `/login-url` → flag becomes
   moot (Phase 3 handles both modes).

**Verified**: APK 3.9.42 built (24s, 39MB), installed clean.

---

## [3.9.41] - 2026-04-28

### Added — Phase 3 SDK-primary broker connect (flag-gated, opt-in)

When `REACT_APP_USE_SDK_BROKER_FLOW=true` in `.env`, every broker
connect modal renders the new `Phase3SdkBrokerModal` (uses
`BrokerCredentialForm` + `WebViewBrokerAuthFlow` from
`@alphaquark/mobile-sdk`) instead of the per-broker legacy modals
(`AliceBlueConnect`, `KotakModal`, `ZerodhaConnectModal`, etc.).
Mirror of `tidi_new`'s `Phase3SdkConnectScreen`. Default OFF in main;
this branch's `.env` ships true so QA can test the SDK-primary flow.

**Backend prerequisites already deployed** on `ssh tidi`:
- `aq_backend_github` `Ibt-branch@6f25766` — `/sdk/v1/connections/:broker/`
  `connect` proxies credential brokers (AliceBlue/Dhan/Groww-creds)
  to legacy validate-and-persist via `_selfCallLegacy`. Angel One
  routed through `/update-credentials` → `/api/angel-one/update-key`
  per the new per-customer SmartAPI flow (frontend pair:
  `prod-alphaquark-github` `0202f27c`, dual-mode toggle `0f774455`).
- `_selfCallLegacy` mints a fresh JWT via `SecurityTokenManager.`
  `generateServiceToken` per call (proper auth, no `BYPASS_TOKEN`
  abuse).
- Mint server (`aq-sdk-mint-server@15397ba`) is multi-tenant —
  `X-Advisor-Subdomain: prod` (alphaquark variant) routes to
  `AQ_SDK_TENANT_SECRET_PROD`.

**SDK schema migration shipped** in `alphaquark-mobile-sdk@a69712c`:
- Angel One: `flow=credentials_totp + submitEndpoint=connect +
  fields=[apiKey, clientCode, mpin, totp]` →
  `flow=oauth + submitEndpoint=update-credentials +
  fields=[apiKey, secretKey, clientCode]`. The deprecated SmartAPI
  password flow is retired; per-customer SmartAPI app pattern in.

**Files in this commit**:
- `src/components/BrokerConnectionModal/Phase3SdkBrokerModal.js`
  (NEW, ~210 lines) — wraps `BrokerCredentialForm` for the form
  phase, hands off to `WebViewBrokerAuthFlow` on
  `onContinueToOauth`. `encrypt` callback uses the same
  `CryptoJS.AES.encrypt(value, 'ApiKeySecret')` envelope every
  legacy modal uses. `onSuccess` calls `fetchBrokerStatusModal`
  (existing pattern) then closes the modal — symmetric with legacy
  modals so downstream broker-list refresh works unchanged.
- `src/GlobalUIModals/ModalManager.js` — adds `useSdkBrokerFlow()`
  helper reading `REACT_APP_USE_SDK_BROKER_FLOW`. When true AND
  `visibleModal` is one of the 14 broker cases (`SDK_ELIGIBLE_MODALS`
  set), short-circuits to `<Phase3SdkBrokerModal/>`. Otherwise falls
  through to the existing legacy switch — zero change for users on
  the default flag.
- `android/app/build.gradle` — versionCode 40 → 41, versionName 3.9.40
  → 3.9.41.

**Per-broker first-go expectations** (same matrix as `tidi_new` Phase 3):

| Broker | Path | Confidence |
|--------|------|-----------|
| Zerodha | OAuth WebView (empty form, apiKey from env) | High |
| Upstox / Fyers / ICICI / HDFC / Motilal / Axis | OAuth via `/update-credentials` | High |
| Kotak | TOTP `/update-credentials` → `/api/kotak/connect-broker` | High (NEO fix in place) |
| Groww | `/update-credentials` → `/api/groww/update-key` | High |
| Angel One | OAuth via `/update-credentials` → `/api/angel-one/update-key` | High (per-customer mode only) |
| AliceBlue / Dhan / Groww-creds | `/connect` → legacy `/api/user/connect-broker` (proxied) | Medium — depends on broker API |
| IIFL Securities | `/update-credentials` proxies but no legacy `/api/iifl/update-key` | Will fail with 400 |
| DummyBroker | Stub auto-success | High |

**Known gap — `useSharedAngelOneKey` shared mode**:
The dual-mode toggle from `prod-alphaquark-github` `0f774455` (per-
advisor): `true` (default-safe) uses platform-shared OAuth via
`ccxt /angelone/login-url`. **The SDK route family doesn't yet
expose a shared-key path** — advisors running shared-mode should
keep `REACT_APP_USE_SDK_BROKER_FLOW=false` until
`/sdk/v1/connections/Angel%20One/login-url` gains shared-mode
awareness. Default platform direction per the migration commits is
per-customer (`useSharedAngelOneKey=false`), which the SDK schema is
wired for.

**Rollback** — set `REACT_APP_USE_SDK_BROKER_FLOW=false` in `.env`
and rebuild. Every code path returns to legacy.

**Build instructions**:

```bash
cd ../../alphaquark-mobile-sdk/packages/rn && npm run build
cd -
PATH="$HOME/.nvm/versions/node/v20.19.6/bin:$PATH" \
  ./android/gradlew -p android assembleRelease --no-daemon --max-workers=2
```

**Verified before commit**: `tsc --noEmit` clean. `assembleRelease`
58s clean, signed with `MYAPP_UPLOAD_STORE_FILE`. APK 39MB installed
on emulator (`Streamed Install: Success`). Boot screen unchanged
from 3.9.40.

---

## [3.9.40] - 2026-04-27

### Changed — Send `X-Advisor-Subdomain` header on mint to route per-tenant on the multi-tenant mint server

Companion to `aq-sdk-mint-server@15397ba` — the mint server is now
multi-tenant aware (resolves tenant secret from
`X-Advisor-Subdomain` instead of hardcoding the prod tenant).
Without this client-side change every non-prod variant of Alphab2bapp
would silently mint prod-scoped sessions — survivable in Phase 2 dual-
write (errors are swallowed) but architecturally wrong.

**Architecture fact this commit honours:** Alphab2bapp ships
**per-tenant**. `APP_VARIANT` in `.env` selects a config in
`src/utils/Config.js` whose `subdomain` field is the canonical tenant
id (`alphaquark` → `prod`, `zamzamcapital` → `zamzamcapital`,
`rgxresearch` → `rgxresearch`, `arfs` → `arfs`, `magnus` →
`zamzamcapital`). The legacy `/api/*` calls have always sent that as
`X-Advisor-Subdomain`; SDK now matches.

**Files**:
- `src/sdk/SdkProviderRoot.js` — `mintSession` reads
  `getAdvisorSubdomain()` (existing helper from
  `src/utils/variantHelper.js`) and sets `X-Advisor-Subdomain` on the
  POST headers. Falsy result → header omitted (mint server falls back
  to its `AQ_SDK_TENANT_SECRET` default; preserves the dev/no-variant
  build path).
- `android/app/build.gradle` — versionCode 39 → 40, versionName 3.9.39
  → 3.9.40.

**Tenant provisioning prereq before any new variant turns on
`REACT_APP_SDK_INTEGRATION=true`:**

1. `node aq_backend_github/scripts/create_tenant_api_keys.js
   --tenant=<subdomain>` on `ssh tidi` — capture printed `sk_live_…`.
2. Append `AQ_SDK_TENANT_SECRET_<UPPER>=sk_live_…` to
   `/home/ubuntu/servers/server2/aq-sdk-mint-server/.env`.
3. `sudo systemctl restart aq-sdk-mint.service`.

**Provisioned today (2026-04-27)** on the mint server:
- `AQ_SDK_TENANT_SECRET=sk_live_p_…` (legacy default fallback for
  no-header requests)
- `AQ_SDK_TENANT_SECRET_PROD=sk_live_p_…` (sibling of the default —
  added today so the explicit-header path resolves cleanly the moment
  3.9.40 ships)
- `AQ_SDK_TENANT_SECRET_TIDI=sk_live_XYHu…` (provisioned today for
  tidi_new SDK Phase 1)

**NOT yet provisioned**: zamzamcapital, rgxresearch, arfs, magnus
(aliases zamzamcapital), asminsights, japfinserve, wealthorigin,
kaizenalpha. These would 401 `tenant_not_provisioned` if a build
with their `APP_VARIANT` turned on `REACT_APP_SDK_INTEGRATION` —
but Phase 2 dual-write swallows the failure, so legacy keeps working.

**Bundled SDK refresh:** carry-over from [3.9.39] — `lib/` was
already rebuilt with theming + EdisModal/RebalanceReviewModal full
theme support. No re-tsc needed for this build.

**Build instructions** (unchanged from [3.9.39]):

```bash
cd ../../alphaquark-mobile-sdk/packages/rn && npm run build
cd -
PATH="$HOME/.nvm/versions/node/v20.19.6/bin:$PATH" \
  ./android/gradlew -p android assembleRelease --no-daemon --max-workers=2
```

**Backwards compatibility:** APK 3.9.39 (no header) → DEFAULT secret
(still set). APK 3.9.40 (header=prod) → `AQ_SDK_TENANT_SECRET_PROD`
(same value). Both routes mint the same prod-scoped JWT; no behaviour
change for AlphaQuark variant users.

**Mint server reference:** `aq-sdk-mint-server@15397ba`
(`pk1762012/aq-sdk-mint-server`, `main`). Pulled + restarted on
`ssh tidi` 2026-04-27 17:55 UTC.

---

## [3.9.39] - 2026-04-27

### Build — Refresh bundled `@alphaquark/mobile-sdk` lib (Flutter parity + 3 new theme slots)

Re-runs `tsc -p` on the SDK's React Native package so Metro picks up the
theming work landed in `alphaquark-mobile-sdk` `develop@14a1436`. Without
this rebuild Metro keeps bundling the previous `lib/` snapshot from
2026-04-27 09:05 — the new SDK source on disk would be invisible to the
APK, an easy class of "I shipped it but it didn't ship" bug.

What's new in the bundled SDK from this build vs APK 3.9.34's bundle:

- **3 new theme slots** in `DEFAULT_SDK_THEME.colors`: `warning` (`#a65a00`),
  `primaryDisabled` (`#a3bcd4`), `divider` (`#e0e0e0`). Existing 14 slots
  unchanged. Tenants who supply a partial theme will fall through to these
  defaults for any of the three slots they don't override.
- **`EdisModal` and `RebalanceReviewModal` are fully theme-aware** — both
  previously had module-level `StyleSheet.create({ ... })` with hardcoded
  hex literals; they now resolve every colour, font axis, and radius
  through `useAqSdkTheme()`. Side-effect: a tenant's brand override now
  reaches the EDIS sell-auth gate and the rebalance review surface, not
  just `BrokerCredentialForm` and `WebViewBrokerAuthFlow`.
- **Test floor**: 20 Jest tests on the RN side (`SdkTheme` merge correctness,
  broker schema invariants, Kotak NEO sentinel) and 19 Flutter tests with
  identical coverage. Net effect: schema/theme regressions in future SDK
  edits will fail loudly in CI rather than ship silently.

**Files in this app repo**:
- `android/app/build.gradle` — versionCode 38 → 39, versionName 3.9.34 → 3.9.39
  (intermediate slots 3.9.35–3.9.38 are taken: backend-only Kotak NEO fix,
  unrelated frontend funds-404 fix, doc sync, and a Kotak connect false-negative
  fix; the only APK rebuild between [3.9.34] and [3.9.39] is this one).

**Files in `alphaquark-mobile-sdk` (repo `alpha112233/alphaquark-mobile-sdk`,
branch `develop`, commit `14a1436`):**
- `packages/rn/lib/**` — recompiled from current `src/`, picked up by Metro
  via the `file:../../alphaquark-mobile-sdk/packages/rn` dep + `metro.config.js`
  `extraNodeModules` + `watchFolders` wiring.
- New theme types: `packages/flutter/lib/src/theme/sdk_theme.dart` +
  `sdk_theme_inherited.dart` (Flutter parity — does not affect this RN APK
  but is captured here for cross-repo doc-sync per `CLAUDE.md`).

**Build instructions** (so the next person rebuilding from a fresh clone
doesn't ship a stale bundle):

```bash
# Rebuild the SDK whenever its src/ changes — Metro watches lib/, not src/.
cd ../../alphaquark-mobile-sdk/packages/rn
npm run build

# Then build the release APK from this repo:
cd -
PATH="$HOME/.nvm/versions/node/v20.19.6/bin:$PATH" \
  ./android/gradlew -p android assembleRelease --no-daemon --max-workers=2
# Output: android/app/build/outputs/apk/release/app-release.apk
```

Why Node 20: per the `memory/build_node_version.md` note, v22.22.0 crashes
Metro with a V8 TurboFan bug during the JS-bundle stage of release; v20.19.6
+ `--no-daemon` is the canonical recipe.

**No code changes in this app repo.** All visible behaviour comes from the
refreshed SDK bundle. The host app continues to import via `@alphaquark/mobile-sdk`,
the import resolves through the `node_modules` symlink to the SDK repo's
`packages/rn`, and Metro inlines `lib/index.js` and its descendants into
the APK's JS bundle.

---

## [3.9.40] - 2026-04-27

### Fixed — Same false-negative "Incorrect credentials" pattern across all 12 sibling broker modals

Ported the post-success try/catch + HTTP-error gate (landed for Kotak in 3.9.38, commit `172767d`) to every other broker connect modal. After commit `ec0cf5d` rolled out the SDK dual-write across all 13 brokers in identical structure, the same anti-pattern existed in each: a JS runtime error in the post-success block (eventEmitter.emit / fetchBrokerStatusModal / showAlert / SDK call) would bubble to the outer `.catch` and surface as "Incorrect credentials" — which is misleading when the connect HTTP call already returned 2xx.

**Files patched (12):**
- `src/components/BrokerConnectionModal/AliceBlueConnect.js`
- `src/components/BrokerConnectionModal/AngleoneBookingModal.js`
- `src/components/BrokerConnectionModal/AxisConnectModal.js` — preserved the existing 1083 SSO envelope check (matched via `/Axis Securities SSO error/.test(error.message)`); HTTP-error gate added underneath.
- `src/components/BrokerConnectionModal/DhanConnectModal.js`
- `src/components/BrokerConnectionModal/FyersConnect.js` — only the post-success and connect-broker save catch; the pre-connect `updateSecretKey` "Incorrect Credentials" branch is unrelated (runs before the 2xx).
- `src/components/BrokerConnectionModal/GrowwConnectModal.js` — preserved all granular Groww `error_code` branches (NOT_BASE32, WRONG_LENGTH, GROWW_REJECTED, INVALID_SEED, INVALID_CREDENTIALS) untouched; HTTP-error gate added only on the generic else-branch.
- `src/components/BrokerConnectionModal/HDFCconnectModal.js`
- `src/components/BrokerConnectionModal/icicimodal.js` — wrap inside `finalizeConnection`; left the auth-flow catch alone (pre-connect).
- `src/components/BrokerConnectionModal/MotilalModal.js` — left the pre-connect auth-URL fetch catch alone.
- `src/components/BrokerConnectionModal/upstoxModal.js` — left the pre-connect / token-exchange catches alone.
- `src/UIComponents/BrokerConnectionUI/ZerodhaConnectUI.js` — `ZerodhaConnectModal.js` is a 34-line wrapper with no .catch / showAlert; all real connect logic lives in this UI file. Two separate post-success wraps (one for the SDK fast-path success branch, one for the legacy two-step success) plus an HTTP-error gate on the shared outer catch.
- `src/components/iiflmodal.js` — uses `Toast.show` instead of `showAlert`; same logic.

**Pattern applied verbatim from KotakModal.js (the reference):**
1. Wrap `eventEmitter.emit('refreshEvent', …)` + `await fetchBrokerStatusModal()` + `showAlert('success', …)` in `try { … } catch (postSuccessErr) { console.warn('[<Broker>] post-success step threw (connection IS saved DB-side):', postSuccessErr?.message || postSuccessErr); }`.
2. In the outer `.catch`, gate the "Incorrect credentials" wording behind `const isHttpError = !!error?.response`. Non-HTTP errors get title `"Connection Issue"` and body explaining credentials may already be saved — please refresh.

**Verified:** all 12 files parse cleanly via `@babel/parser`. Granular per-broker error parsing preserved everywhere it existed (Axis 1083, Groww error_codes). Pre-connect catches NOT touched (those run before the 2xx, so the credential-rejection wording is correct there).

**Async restructure for non-async `.then` blocks (HDFC, Motilal, Upstox, ICICI):** the original post-success block was inside a non-async `.then(response => { … })`. To `await fetchBrokerStatusModal()` inside the new try/catch, those blocks were converted to a fire-and-forget IIFE: `(async () => { try { … } catch { … } })()`. Same observable behavior — the original was already fire-and-forget once the modal closed.

**alphaquark-mobile-sdk package:** the SDK package itself does NOT need this fix. The SDK is the network client (`client.connectBroker(broker, body)` etc.) and correctly propagates errors as rejected promises. The bug is in the *consumer* code — the legacy modal's `.then` chain that runs after the SDK promise resolves. The SDK is just one of several things called from inside that `.then`.

**See also:** `docs/BROKER_CONNECTION.md § Broker-connect post-success hygiene`.

---

## [3.9.38] - 2026-04-27

### Fixed — Kotak connect false-negative "Connection Error: Incorrect credentials" after a successful login

**Symptom (production):** user submitted Kotak NEO credentials in the React Native app and saw the alert *"Connection Error — Incorrect credentials. Please try again"*. Repeated tapping Connect each time. Each time the alert appeared.

**What actually happened (per nginx + ccxt + alphaquark journals):** every single attempt **succeeded** end-to-end:

```
POST /kotak/login/totp                     200 884   (ccxt — view + trade tokens issued)
PUT  /api/kotak/connect-broker             200 13533 (Node — credentials saved, model portfolio updated)
PUT  /sdk/v1/connections/Kotak/connect/    200 108   (SDK dual-write OK)
```

ccxt's `tradeApiLogin response` log showed full success payload — UCC `XL6HF`, greeting `ANKITA`, dataCenter `E43`, both view and trade tokens, `status: 'success'`. Right after, `insert_user_doc` ran for `testaccount@gmail.com` across three model portfolios. Kotak was connected, fully and correctly.

**Root cause:** the post-success block in `KotakModal.updateKotakSecretKey` (the second `.then` after the connect HTTP call) does several things synchronously after the 200:
- `setShowKotakModal(false)`, `setShowBrokerModal(false)` — setState
- `eventEmitter.emit('refreshEvent', …)` — Node's `events.EventEmitter`. **`emit()` rethrows synchronously if any listener throws synchronously.** Three subscribers exist (SubscriptionScreen, RebalanceAdviceContent, RebalanceAdvices).
- `await fetchBrokerStatusModal()` — has its own internal try/catch, doesn't throw.
- `showAlert('success', …)` — Zustand store call.

If ANY of these threw a JS runtime error after the 2xx, the throw bubbled up to the outer `.catch(error => …)` block. That block treated the runtime error as a network/HTTP error and fell through to the fallback alert body `'Incorrect credentials. Please try again'` (because `error.response?.data?.message` was empty — there was no HTTP error to extract a message from). The user, who had genuinely just connected Kotak successfully, was told their credentials were wrong.

The SDK dual-write commit `ec0cf5d` (today, 11:38 IST) added a `sdkConnectBroker(sdkBridge.client, 'Kotak', data)` call inside this same post-success block, expanding the surface area for post-2xx throws.

**Fix (`src/components/BrokerConnectionModal/KotakModal.js`):**

1. **Wrap the post-success block in its own try/catch** — `eventEmitter.emit`, `fetchBrokerStatusModal`, and `showAlert('success', …)` are now isolated. A throw here logs `[Kotak Neo] post-success step threw (connection IS saved DB-side): <msg>` and is swallowed. The user does not see a "Connection Error" alert. Worst case under the new wrap: the success toast doesn't fire — connection state was already saved DB-side.

2. **Differentiate HTTP error vs JS runtime error in the outer `.catch`** — `error.response` is set if and only if axios received an HTTP-level response. The fallback message *"Incorrect credentials. Please try again"* now only fires when `error.response` is present (i.e. the broker or backend genuinely rejected). When `error.response` is absent (network failure, runtime error), the alert title becomes "Connection Issue" with body *"We couldn't complete the connection because of a network or app error. Your credentials may already be saved — please refresh to check before retrying."* — which is true and actionable.

**Files touched:**
- `src/components/BrokerConnectionModal/KotakModal.js` — wrapped post-success in try/catch (~10 lines); split outer `.catch` into 3 branches (TOTP / HTTP-error / non-HTTP) so a network or runtime error no longer claims the credentials were wrong.

**Same pattern likely affects other broker modals** (Angel One, AliceBlue, Dhan, Fyers, Groww, HDFC, ICICI, IIFL, Motilal Oswal, Upstox, Zerodha, Axis Securities). The SDK dual-write commit `ec0cf5d` added `sdkConnectBroker(...)` calls inside each modal's post-success `.then`; any of them can repeat this false-negative if a downstream step throws. Follow-up audit item: apply the same try/catch + HTTP-error guard to all 12 sibling modals.

**Why we couldn't pin down the exact thrower:** to identify which of the three subscribers (or `showAlert`, or the SDK call) actually threw, we'd need `adb logcat` from the user's device at repro time — line 281's `console.log('Connection error:', error)` already logs the raw error object. The fix is correct regardless of which one threw, because the symptom (telling a successfully-connected user their credentials are wrong) is the bug, not the underlying throw.

---

## [3.9.37] - 2026-04-27

### Fixed — Kotak NEO migration: ported remaining 4 ccxt-india consumers + decrypt-correctness in status_update (BACKEND, ccxt-india)

Companion to `[3.9.35]`. The earlier commit fixed the rebalance auth-params shape on the rebalance path; this commit ports the four downstream consumers documented as "known follow-ups" in `[3.9.35]`, plus a related decrypt-correctness fix in `status_update._get_auth_keys` that became load-bearing once Kotak's NEO schema introduced plaintext `sid` / `serverId` into `BROKER_AUTH_KEYS`.

**Files patched on `ssh tidi`** (paths under `servers/server2/ccxtprod/ccxt-india/`, all under commit `623dd964`):

1. `common/utils.py` — `Mapping.BROKER_AUTH_KEYS["Kotak"]` migrated from `["consumerKey","consumerSecret","jwtToken","sid","serverId"]` → `["apiKey","jwtToken","sid","serverId"]`. Schema source-of-truth for projection + `all(auth_values)` validation across `portfolio/limit_order_status_update.py` + `rebalancing/order_status_updater/status_update.py`. Pre-fix every Kotak NEO user was rejected at the validation gate because `consumerKey`/`consumerSecret` are not written by the NEO connect route.

2. `portfolio/limit_order_status_update.py` § `get_order_status_kotak` — unpack changed from 6-tuple `(access_token, view_token, sid, server_id, consumer_key, consumer_secret)` → 4-tuple `(access_token, view_token, sid, server_id)` matching the new `BROKER_AUTH_KEYS["Kotak"]` order. Decrypts `access_token` (= `apiKey`, encrypted at rest) and constructs `Kotak(access_token, view_token, sid, server_id)` without `consumer_*` kwargs.

3. `portfolio/portfolio_all_brokers.py` § Kotak `get_holdings` — projection migrated from `(accessToken, consumerKey, consumerSecret, viewToken, sid, serverId)` → `(apiKey, jwtToken, sid, serverId)`. `all()` gate narrowed to `(access_token, view_token, sid)` — `serverId` is optional (Kotak() defaults to `"server1"`). Adds `CryptoJSWrapper().decrypt(access_token)` before `Kotak()` construction.

4. `portfolio/user/holding_allbroker_user.py` § per-user Kotak `get_holdings` — same projection migration. Pre-fix code mislabeled `apiKey` as `consumer_key` and gated on `secretKey` being present (which it never is post-NEO), so this function silently dropped every Kotak NEO user from per-user holdings refresh. Now reads the NEO 4-arg shape.

5. `rebalancing/order_status_updater/status_update.py` § `_get_auth_keys` — decrypt logic narrowed from "decrypt every key except `jwtToken`/Angel One" → "decrypt only fields known to be encrypted at rest (`apiKey`, `secretKey`, `consumerKey`, `consumerSecret`)". Pre-fix this was inert for Kotak (legacy schema had only encrypted fields), but post-NEO the schema includes plaintext `sid`/`serverId`, and a blind decrypt would feed garbage to `KotakBroker` via `BrokerFactory`. **Side effect (incidental fix)**: `AliceBlue` / `Dhan` / `Fyers` / `Motilal` / `Axis` consumers (which all have plaintext `clientId` / `clientCode` in their `BROKER_AUTH_KEYS` schemas) stop receiving garbled values from this path too. If those status-updater flows worked pre-fix, it means the path was either not exercised against those brokers or downstream classes were lenient — confirm in monitoring after deploy.

**Decrypt-field policy (now codified in `_get_auth_keys`):**

| Field | Encrypted at rest? |
|-------|-------------------|
| `apiKey` | yes (CryptoJS AES) |
| `secretKey` | yes |
| `consumerKey`, `consumerSecret` | yes (legacy, retained for non-NEO brokers) |
| `jwtToken` | no |
| `sid`, `serverId`, `clientCode`, `clientId` | no |

Future schema changes that add a new encrypted field must update the `ENCRYPTED_FIELDS` set in `status_update._get_auth_keys` AND the equivalent set `ENCRYPTED_CREDENTIAL_KEYS` in `trading_logic/utils/db_manager.py:16`. Keeping these two sets in sync is a fan-out concern.

**Verified before deploy:** `python3 -m py_compile` on all five patched files. Deployed via `./pull_restart.sh` (gunicorn + celery restarted clean, all firebase tenants initialized: alphaquark, prod, rgxresearch, zamzamcapital).

**No mobile-app code changes; APK rebuild not required.**

**Cross-repo doc sync:** `Alphab2bapp/docs/REBALANCING.md` § "Kotak NEO migration — rebalance auth-params shape" already documents the full canonical post-migration auth-params contract. The "Known un-migrated call sites" subsection in that doc is now resolved by this commit.

**Files**: `ccxt-india/common/utils.py`, `ccxt-india/portfolio/limit_order_status_update.py`, `ccxt-india/portfolio/portfolio_all_brokers.py`, `ccxt-india/portfolio/user/holding_allbroker_user.py`, `ccxt-india/rebalancing/order_status_updater/status_update.py`. Backend deployed.

---

## [3.9.36] - 2026-04-25

### Fixed — Stray `POST /funds` 404s for 8 brokers (frontend)

**Symptom (production logs):** `POST /funds HTTP/1.1 404 39` with no broker prefix appearing for users on Angel One, HDFC Securities, Dhan, AliceBlue, Fyers, Groww, Motilal Oswal, and Axis Securities. Funds card never populated for any of those brokers; the `.catch(error => {})` swallow hid the failure from users.

**Root cause:** two screens built funds-fetch URLs without a broker-specific path segment.

1. `src/screens/PortfolioScreen/PortfolioScreen.js` — `getAllFunds()` had explicit branches for IIFL / ICICI / Upstox / Zerodha / Kotak and a catch-all `else` that POSTed to `${baseUrl}funds` with `{apiKey, jwtToken}`. The else hit for the other 8 brokers and 404'd silently every time.
2. `src/screens/Drawer/IgnoreTradesScreen.js` — Angel One branch (line 1074) explicitly built `${baseUrl}funds` instead of `${baseUrl}angelone/funds`. Same 404, same silent swallow.

**Fix:**
- PortfolioScreen.js — removed the broken catch-all body; the else now delegates to `fetchFunds(broker, …)` from `src/FunctionCall/fetchFunds.js`, which already maps each of the 13 brokers to the correct per-broker route + payload shape. Working branches (IIFL/ICICI/Upstox/Zerodha/Kotak) untouched to keep their existing payload quirks (e.g. Zerodha's hardcoded public-app key, Kotak's segment/product/sid/serverId fields).
- IgnoreTradesScreen.js — Angel One URL changed from `${baseUrl}funds` → `${baseUrl}angelone/funds`. One-line fix.

**Files touched:**
- `src/screens/PortfolioScreen/PortfolioScreen.js` — added `fetchFunds` import; replaced broken `else` block in `getAllFunds()`.
- `src/screens/Drawer/IgnoreTradesScreen.js` — fixed Angel One URL.

**Why the screens diverged from `fetchFunds`:** `fetchFunds` was added later as the canonical helper. PortfolioScreen and IgnoreTradesScreen still carried the older inline implementations — and their else-branches were the original "Angel One" fallback before per-broker routing existed on ccxt-india. The 404 has been silent in production for at least the lifetime of those 8 brokers' integrations because every call site catches and swallows.

**Verified:** `grep -rn 'ccxtServer.baseUrl}funds' src` returns no matches.

---

## [3.9.35] - 2026-04-27

### Fixed — Kotak rebalance "You must provide a consumer key and a consumer secret" (BACKEND, ccxt-india)

**Symptom (production, both legacy and SDK builds):** after a successful Kotak NEO connect (broker card showed "Kotak Broker Connected" with cash + phone + PAN populated), tapping Rebalance got to Step 3 and failed with:

> Unable to Rebalance — You must provide a consumer key and a consumer secret to generate access token or provide an access token.

That error string is raised verbatim by `neo_api_client` (the Kotak Neo SDK) in `brokers/kotak/kotak.py:99-103` when the SDK is constructed with `access_token=None` AND `consumer_key=None`/`consumer_secret=None`. The mobile app and SDK dual-write paths were innocent — the bug was in the rebalance pipeline on ccxt-india.

**Root cause:** the Kotak NEO TradeAPI migration on `2026-04-22` (mobile commit `b060ac5f`) switched the connect flow to store `apiKey` (UUID API access token), `jwtToken` (view/session token), `sid`, and `serverId` — retiring the legacy `consumerKey`/`consumerSecret` pair. The connect route + ccxt-india `/kotak/login/totp` and the `TradingLogicKotak` rebalance class were migrated; **but three downstream consumers were missed** and continued to expect the legacy field names. Each route routed Kotak through a normalizer that mapped `apiKey → consumerKey` and `secretKey → consumerSecret` (where `secretKey` no longer exists in the DB at all → always `None`), then constructed `Kotak(consumer_key=<UUID>, consumer_secret=None, view_token=<JWT>)` without ever passing `access_token=`. The SDK saw `access_token is None` AND `consumer_secret is None` → ValueError.

**Files patched on `ssh tidi`** (paths under `servers/server2/ccxtprod/ccxt-india/`):

1. `apps/app_model_portfolio.py` — `normalize_credentials_for_broker` (Kotak branch). Now emits the new shape: `apiKey` (UUID), `jwtToken` (view/session), `sid`, `serverId`. Stops emitting `consumerKey`/`consumerSecret`. This is the auth-params builder that feeds every rebalance broker class.
2. `rebalancing/brokers.py` — `KotakBroker.__init__` reads `apiKey` → `self.access_token`, `jwtToken` (or fallback `accessToken`) → `self.view_token`. `_get_kotak_instance()` and `process_trades()` now pass `access_token=` to `Kotak(...)` and `TradingLogicKotak(...)`. Removed the `consumer_key=`/`consumer_secret=` kwargs entirely. This is the rebalance path that was throwing the user-facing error.
3. `rebalancing/order_status_updater/order_book_factory.py` — `KotakBroker` (status-update class) — same migration as #2. The pre-fix gate `if not self.consumer_key or not self.consumer_secret …` would have raised `Missing required authentication parameters for Kotak` on every order-status refresh post-NEO; replaced with `if not self.access_token or not self.view_token or not self.sid`. `serverId` is no longer required (Kotak() class falls back to `"server1"` when empty).

**Why the connect itself worked despite this:** the connect route (`aq_backend_github/Routes/Broker/Kotak.js`) calls ccxt's `/kotak/login/totp` directly, bypassing `normalize_credentials_for_broker`. That endpoint receives the UUID + mobile + mpin + ucc + totp shape and uses Kotak's new `/login/1.0/tradeApiLogin`. Holdings and funds also worked because they use yet other code paths in `portfolio/user/holding_allbroker_user.py` (which has its own — separately legacy — Kotak handling, see "known follow-ups" below). Only the rebalance flow fanned out through `normalize_credentials_for_broker → KotakBroker(rebalancing/brokers.py)`.

**Known follow-ups (still on legacy `consumerKey`/`consumerSecret` shape, NOT fixed in this commit — track separately):**
- `portfolio/portfolio_all_brokers.py:521-552` (`consumerKey`/`consumerSecret` projection + `Kotak(consumer_key=…, consumer_secret=…)` — would break a Kotak portfolio_all_brokers refresh on a NEO-migrated account)
- `portfolio/user/holding_allbroker_user.py:572-589` (reads `apiKey` and `secretKey` but mislabels them as `consumer_key`/`consumer_secret`, then gates `if not all([…, consumer_secret, …])` — `secretKey` is never present post-NEO so this returns early)
- `portfolio/limit_order_status_update.py:245-249` (limit-order status updater, same legacy 6-tuple)
- `common/utils.py:426` (`BrokerKeysSchema` for Kotak still lists `consumerKey, consumerSecret, jwtToken, sid, serverId` — incorrect; should be `apiKey, jwtToken, sid, serverId`)

These are inert in the *connect → rebalance* path tested today, but will surface when Kotak users hit holdings refresh / portfolio fetch / limit-order status from any code path that goes through them. Recommend porting in a single follow-up commit.

**Verified before deploy:** `python3 -m py_compile` on all three patched files — all clean. Deployed to ssh tidi via `./pull_restart.sh` (uWSGI + Celery restart).

**Why the docs called this out as load-bearing:** this is exactly the class of cross-cutting NEO-migration miss that `CLAUDE.md`'s "Shared env vars across brokers — BLOCKING GUARDRAIL" warns about, except for credential-shape rather than env-var. The same DB rename (`secretKey` removed, `apiKey` repurposed UUID, `jwtToken` is now view-token) breaks every downstream that doesn't update — with no compile-time signal because Python `dict.get('consumerKey')` returns `None` silently. Future Kotak credential-shape changes need a fan-out audit identical to the env-var one.

**Files**: `ccxt-india/apps/app_model_portfolio.py`, `ccxt-india/rebalancing/brokers.py`, `ccxt-india/rebalancing/order_status_updater/order_book_factory.py`. Backend deployed; no mobile app changes (no APK rebuild needed).

---

## [3.9.34] - 2026-04-27

### Added — GrowwHelpContent + Read More / See Less expand pattern in GrowwConnectModal

User feedback: "groww looked different" compared to Zerodha — the connect screen lacked the expandable help panel + Important Notes / Need Help callouts that Zerodha and other brokers have. The Groww modal was always intentionally different (it's a one-time API-key + TOTP-seed paste flow, not OAuth, with a uniquely detailed inline 4-step setup guide), but the *post-setup* notes & support cards Zerodha shows were missing.

**Files**:
- `src/UIComponents/BrokerConnectionUI/HelpUI/GrowwHelpContent.js` — NEW. Mirrors the `expanded`/`onExpandChange` contract of `ZerodhaHelpContent` and `KotakHelpContent`. Collapsed view is a one-line "About this connection" intro; expanded view adds three callout cards: "Which value goes where?" (JWT vs Base32 disambiguation), "Important Notes:" (IP whitelist, encrypted storage, secret rotation, account requirements), and "Need Help?" (support pointer). Visual style matches Zerodha — yellow notes (`#FEF3C7` bg, `#F59E0B` left border, `#92400E` heading), gray support box (`#F3F4F6` bg).
- `src/components/BrokerConnectionModal/GrowwConnectModal.js` — adds `helpExpanded` state (default false), wires `<GrowwHelpContent expanded onExpandChange/>` inside a `guideBox` immediately AFTER the existing 4-step inline setup guide and BEFORE the `EgressIpCallout`. New `Read More` / `See Less` `<TouchableOpacity>` with `ChevronDown`/`ChevronUp` icons toggles `helpExpanded`. Imported `ChevronDown, ChevronUp` from `lucide-react-native` and `GrowwHelpContent`. New styles: `guideBox`, `toggleContainer`, `toggleText`, `toggleIconContainer` — copied verbatim from `ZerodhaConnectUI` for cross-broker visual parity.

**What's intentionally NOT changed**:
- The existing detailed inline 4-step guide (lines 259-357 of GrowwConnectModal) stays as-is — it carries Groww-specific click-path detail (which dropdown to pick on the Trade API page, "Update static IP" instruction) that's load-bearing for first-time users. The new help panel supplements it with cross-broker concerns.
- No data-plane change. SDK dual-write (`sdkConnectBroker(client, 'Groww', payload)` from [3.9.32]) untouched.

**Verification**: Metro `index.bundle?platform=android&dev=true&minify=false` returned HTTP 200 — bundle compiles clean with the new component + imports. Visual verification deferred to next emulator session through main-app navigation (Drawer → Manage Connections → Groww) since Path B is now live and the test harness is no longer the initial route.

---

## [3.9.33] - 2026-04-27

### Added — production aq-sdk-mint-server on tidi + Path B mobile flip

The mobile SDK now mints sessions through a real production endpoint instead of a localhost dev proxy. Release APKs can ship with `REACT_APP_SDK_INTEGRATION=true`.

- **New repo**: `https://github.com/pk1762012/aq-sdk-mint-server` — tiny zero-dep Node proxy. POST `/mint { user_ref, scopes?, ttlSeconds? }` → forwards to `${AQ_SDK_BASE_URL}/sdk/session/create` with the prod tenant secret in `Authorization: Bearer …` (the secret stays server-side; mobile/web never sees it). Reshapes upstream response into the SDK's `SessionToken` contract.

- **Deployment** at `tidi:/home/ubuntu/servers/server2/aq-sdk-mint-server`. Runs as systemd unit `aq-sdk-mint.service` (User=ubuntu, EnvironmentFile=`.env`, listens 127.0.0.1:8787). Nginx vhost `app-links.alphaquark.in` adds two locations:
  - `POST /sdk/mint` → `proxy_pass http://127.0.0.1:8787/mint`
  - `GET /sdk/healthz` → `proxy_pass http://127.0.0.1:8787/healthz`
  - Public URL: `https://app-links.alphaquark.in/sdk/mint`

- **Tenant secret** rotated to v2 for tenant `prod` via `aq_backend_github/scripts/create_tenant_api_keys.js --tenant=prod --force-rotate`. v1 retired with 30-day grace until 2026-05-27 so any in-flight integrations (the previous local dev-mint-server) keep working during the switch. v2 secret loaded into `aq-sdk-mint.service`'s EnvironmentFile and never committed.

- **Mobile `.env`** (untracked, gitignored — captured here for the record):
  - `REACT_APP_SDK_BROKER_TEST_FIRST` flipped from `true` → `false` so the app boots into Splash → Login → Home, NOT into the SDK test harness. Test harness remains reachable for QA via the navigation-stack route registration when the flag is true.
  - `REACT_APP_SDK_MINT_URL` flipped from `http://localhost:8787/mint` → `https://app-links.alphaquark.in/sdk/mint`.
  - `REACT_APP_SDK_INTEGRATION=true` and `REACT_APP_SDK_TEST_USER_REF=pratik@alphaquark.in` unchanged. `TEST_USER_REF` is harmless in release because Firebase auth's userEmail wins over it; the var only kicks in if no Firebase user is logged in (dev-only).

- **Verification (live, from emulator)**:
  - `gradlew app:installDebug` rebuild picked up new env values; `BuildConfig.java` confirmed `REACT_APP_SDK_BROKER_TEST_FIRST = "false"` and `REACT_APP_SDK_MINT_URL = "https://app-links.alphaquark.in/sdk/mint"`.
  - App force-stop + relaunch → home screen, not test screen ✓
  - `journalctl -u aq-sdk-mint` shows POST /mint hits from `okhttp/4.9.2` (device UA) returning HTTP 200 with token ✓
  - `nginx access.log`: `223.181.104.80 - "POST /sdk/mint HTTP/1.1" 200 606 "-" "okhttp/4.9.2"` ✓
  - SDK ready for dual-write on every broker connect.

- **Release APK readiness**: with these `.env` values, a `gradlew assembleRelease` would produce an APK that boots into the normal app, mints SDK sessions through the production endpoint, and exercises every broker's SDK dual-write alongside the legacy save. No localhost / adb-reverse dependency. Pre-existing release-signing config applies unchanged.

---

## [3.9.32] - 2026-04-27

### Added — SDK rewire extended to all 13 brokers in production legacy modals + test screen overlay fix + Axis re-auth shape fallback

**Why this exists.** Continuing from [3.9.31], user requested (a) the test screen overlay to actually cover the screen content (was rendering inline because the legacy modals' `CrossPlatformOverlay` is a `position:'absolute'` View, which inside a `<ScrollView>` is positioned relative to scroll *content*, not screen — Upstox/ICICI tap showed as inline rows between buttons), (b) all 13 broker connect flows in the production app to also dual-write through the SDK so QA can prod-test every broker's `/sdk/v1/connections/:broker/connect` route from the real app, and (c) Axis Securities re-auth was failing with "Failed to connect Axis Securities" / `[Error: Missing auth token from Axis SSO response — please retry]`.

#### 1. Test screen overlay fix — `SdkBrokerTestScreen.js`
Lifted the active broker modal out of `<ScrollView>` into a sibling under a `flex:1` `<View>` root. Legacy modals on Android use `CrossPlatformOverlay` → `position:absolute, zIndex:9999` which now layers above the entire screen as intended. Verified by tapping Upstox/ICICI on emulator (`/tmp/upstox-modal.png`) — Upstox WebView fills the content area instead of showing inline between buttons.

#### 2. SDK dual-write for the remaining 9 brokers
Same `useSdkBridge() + sdkConnectBroker + sdkDualWriteSafely` pattern as the pilot 4 (`brokerSdkBridge.js` from [3.9.31]). After the legacy `axios.put /api/user/connect-broker` (or, for Groww, `axios.post /api/groww/update-key`) succeeds, the modal additionally fires `client.connectBroker(broker, brokerData)` so we exercise `/sdk/v1/connections/<broker>/connect` in real conditions. Failure is logged as `[sdk-bridge] connect <broker> FAILED`; legacy success is never blocked.

Files changed (each gets the import, the `useSdkBridge()` hook call, and a dual-write block at the persist callsite):
- `src/components/BrokerConnectionModal/upstoxModal.js` — broker key `Upstox`
- `src/components/BrokerConnectionModal/icicimodal.js` — broker key `ICICI Direct` (extracted shared `iciciBrokerData` to dual-write the same payload sent to legacy)
- `src/components/iiflmodal.js` — broker key `IIFL Securities`. IIFL is a special case: the legacy persist is upstream in ccxt-india's `/iifl/login/client` and the client only writes `iiflAccessToken` / `iiflClientCode` to AsyncStorage. The SDK call mirrors that to MongoDB via `/sdk/v1/connections/IIFL Securities/connect` so the SDK sees the connection like every other broker.
- `src/components/BrokerConnectionModal/MotilalModal.js` — broker key `Motilal Oswal`
- `src/components/BrokerConnectionModal/HDFCconnectModal.js` — broker key `Hdfc Securities`
- `src/components/BrokerConnectionModal/DhanConnectModal.js` — broker key `Dhan` (extracted shared `dhanBrokerData`)
- `src/components/BrokerConnectionModal/FyersConnect.js` — broker key `Fyers`
- `src/components/BrokerConnectionModal/GrowwConnectModal.js` — broker key `Groww`. Mirrored after legacy `update-key` returns `success:true`; the SDK call hits `connect` (Groww has no separate `connect-broker` step on legacy because `update-key` persists directly).
- `src/components/BrokerConnectionModal/AxisConnectModal.js` — broker key `Axis Securities` (extracted shared `axisBrokerData`)
- `src/sdk/SdkBrokerTestScreen.js` — test screen labels updated (`legacy connect + SDK connect (...)`); added `sdkRewired: true` flag to all 13 entries.

Combined with [3.9.31]'s 4 pilots, all 13 production broker modals (Zerodha, Kotak, Angel One, AliceBlue, Upstox, ICICI Direct, IIFL Securities, Motilal Oswal, Hdfc Securities, Dhan, Fyers, Groww, Axis Securities) now route their final persistence through the SDK alongside legacy when `REACT_APP_SDK_INTEGRATION=true`. Every broker connect from the real app — not just the test harness — exercises the SDK data plane in parallel.

#### 3. Axis re-auth "Missing auth token from Axis SSO response" — wider fallback paths + upstream-error envelope detection

`src/components/BrokerConnectionModal/AxisConnectModal.js`. Logcat (`[Error: Missing auth token from Axis SSO response — please retry]`) showed `/axis/callback` was returning a shape where `data.authToken?.token || data.authToken || data.token` resolved to undefined.

**Two changes:**

(a) Extended the auth-token extraction to walk every known nesting (initial-auth uses flat `data.authToken`; re-auth sometimes wraps under `data.tokens.*` / `data.metadata.*` / `data.result.*` because Axis SSO returns slightly different envelopes for first-auth vs re-auth, and `ccxt-india`'s `jsonify(result)` forwards Axis's shape unchanged):
- `authToken`: `data.authToken?.token` → `data.authToken` → `data.token` → `data.access_token` → `data.accessToken` → `data.tokens.authToken[.token]` → `data.tokens.access_token` → `data.metadata.authToken[.token]` → `data.metadata.tokens.authToken` → `data.result.authToken[.token]` → `data.result.token`
- `refreshToken`: same shape, plus `data.refresh_token`
- On miss, log the response top-level keys + 600-char preview as `console.warn('[Axis] callback response missing authToken …')` so the next unrecognized shape surfaces in logs and we extend the list.

(b) **Live verification on emulator** captured the actual upstream failure mode (the diagnostic warning fired with `top-level keys: [ 'error', 'status', 'statusCode' ]` and a preview showing Axis's SSO Authenticate handler rejecting the request: error code `1083` / `"failed to type cast user id"` / stack at `bulbasaur/api/resources/sso/model.go:326`). So the response isn't an unknown auth-token shape — it's an *error envelope* (HTTP 200 body wrapping an upstream rejection). Added a guard that detects `data.error: {code, error}` before the authToken extraction and surfaces it as a specific user-facing error:

```js
throw new Error(`Axis Securities SSO error ${upstreamCode}: ${upstreamMsg}`);
```

So the user / support now sees `"Axis Securities SSO error 1083: failed to type cast user id"` instead of the misleading `"Missing auth token from Axis SSO response — please retry"` (retrying client-side would never succeed because the upstream rejection is deterministic per the user's account).

**Real fix is upstream** in ccxt-india (`tidi`-hosted): `/axis/callback` is sending a user_id field whose JSON type Axis SSO can't cast. Likely an int-vs-string mismatch in the Authenticate request body. Needs investigation in `ccxt-india/brokers/axis/` or wherever `/axis/callback` builds the SSO request — out of scope for this mobile commit but documented here so it's findable.

#### Verification
- `curl http://localhost:8081/index.bundle?platform=android&dev=true&minify=false…` → HTTP 200, bundle compiles.
- Emulator force-stop + relaunch → test screen renders (`/tmp/final.png`) with all 13 entries labeled "legacy connect + SDK connect (...)".
- Tap Upstox → modal covers screen, WebView loads (Upstox returned upstream 503; not a code issue).

#### What's NOT in this commit
- ZamZam screenshot follow-up (still need user's screenshot of the affected screen — defensive fallback is in place from [3.9.31]).
- Pushing `feature/sdk-integration` to GitHub (waiting for go-ahead).

---

## [3.9.31] - 2026-04-27

### Added — SDK pilot expansion: all 13 broker modals reachable from SDK test screen + 4-broker SDK data-plane dual-write + SDK theme injection

**Why this exists.** Previous turns (3.9.30 era, `feature/sdk-integration`) wired four pilot brokers (Zerodha, Kotak, Angel One, AliceBlue) through a schema-driven `SdkBrokerConnectModal` — the UX deviated from legacy modals (no inline instructions, no LinearGradient header, no per-broker WebView quirks). User feedback was decisive: stop reinventing, mirror the legacy flows that already work, and route their backend persistence through the SDK without changing UX.

**This commit covers three things in one shot**:

1. **Test harness extends to ALL 13 broker connect modals.** `src/sdk/SdkBrokerTestScreen.js` now lists Zerodha, Kotak, Angel One, AliceBlue (rewired — see #2) plus Upstox, ICICI Direct, IIFL Securities, Motilal Oswal, HDFC Securities, Dhan, Fyers, Groww, Axis Securities (legacy modal only — no SDK rewire yet, but reachable from the harness for parity testing). Each entry tap mounts the same legacy `BrokerConnectionModal/<broker>` component used in production by `BrokerModalRenderer.js`. No reinvention.

2. **Pilot 4 SDK data-plane dual-write.** Behind `REACT_APP_SDK_INTEGRATION=true`, four pilot modals additionally route their final persistence call through the SDK so QA can prod-test `/sdk/v1/connections/:broker/{connect,update-credentials,exchange-token}` without changing the visible UX. Pattern differs by broker:
   - **Kotak** (`src/components/BrokerConnectionModal/KotakModal.js`): on `axios.put /api/kotak/connect-broker` success, also fire `client.connectBroker('Kotak', data)`. Failure logged as `[sdk-bridge] connect Kotak FAILED`, does NOT block legacy success.
   - **Angel One** (`src/components/BrokerConnectionModal/AngleoneBookingModal.js`): same pattern after legacy `connect-broker` succeeds — `client.connectBroker('Angel One', brokerData)` dual-writes.
   - **AliceBlue** (`src/components/BrokerConnectionModal/AliceBlueConnect.js`): after legacy `connect-broker` succeeds, `client.exchangeBrokerToken('AliceBlue', {access_token, client_id})` dual-writes. AliceBlue's prod redirect already returned the token, so re-running through SDK exchange-token is idempotent.
   - **Zerodha** (`src/UIComponents/BrokerConnectionUI/ZerodhaConnectUI.js`): SINGLE-PATH SWAP, not dual-write. Zerodha's request token is single-use — calling `/zerodha/gen-access-token` twice fails the second call. When SDK bridge is ready, `processOAuthCallback` routes through `client.exchangeBrokerToken('Zerodha', {requestToken, apiKey})` (which the backend dispatches to gen-access-token + persistence in one round trip). On SDK failure, falls through to legacy two-step. UX unchanged.

   Bridge module: `src/sdk/brokerSdkBridge.js` — exposes `useSdkBridge()` hook + `sdkConnectBroker / sdkUpdateBrokerCredentials / sdkExchangeBrokerToken / sdkDualWriteSafely` helpers. Modules call `useSdkBridge()`; if `enabled && ready`, they fire the SDK call; otherwise it's a no-op. Safe even when SDK provider isn't mounted (try/catch on `useAqSdk`).

3. **SDK theme injection (Phase 2 SDK)**. `<AqSdkProvider/>` now accepts an optional `theme?: PartialSdkTheme` prop. Defaults match the previous hardcoded values, so flipping the prop on/off is visually a no-op.
   - SDK package: `packages/rn/src/theme/SdkTheme.ts` — defines `SdkTheme` (colors / typography / shape), `DEFAULT_SDK_THEME`, `resolveSdkTheme(partial)` deep-merge, `SdkThemeContext`, and `useAqSdkTheme()` hook.
   - `BrokerCredentialForm.tsx` and `WebViewBrokerAuthFlow.tsx` now read theme via `useAqSdkTheme()`. Inline `StyleSheet.create` was converted to `createStyles(theme)` factories.
   - Public exports added to `packages/rn/src/index.ts`: `DEFAULT_SDK_THEME`, `resolveSdkTheme`, `useAqSdkTheme`, plus types.
   - Scope: SDK-rendered surfaces only. Legacy app modals (ZerodhaConnectUI's `#387ed1` LinearGradient, KotakConnectUI's red brand, AliceBlueConnectUI's chrome) are NOT consumers of `useAqSdkTheme` — retheming legacy modals is a separate per-modal sweep.

**Files changed (mobile)**:
- `src/sdk/SdkBrokerTestScreen.js` — `PILOT_BROKERS` extended to 13 entries; `sdkRewired: true` flag tags the four pilot brokers.
- `src/sdk/brokerSdkBridge.js` — NEW. The gated wrapper module.
- `src/components/BrokerConnectionModal/KotakModal.js` — bridge import + dual-write on connect-broker success.
- `src/components/BrokerConnectionModal/AngleoneBookingModal.js` — same.
- `src/components/BrokerConnectionModal/AliceBlueConnect.js` — same, but uses `exchangeBrokerToken` since AliceBlue's flow gives us post-OAuth tokens.
- `src/UIComponents/BrokerConnectionUI/ZerodhaConnectUI.js` — single-path swap pattern (SDK first, legacy fallback).

**Files changed (SDK)** — at `/home/pk/Alphaquark_docs/AlphaQuark/codes/alphaquark-mobile-sdk`:
- `packages/rn/src/theme/SdkTheme.ts` — NEW. Theme module.
- `packages/rn/src/hooks/AqSdkProvider.tsx` — accepts `theme` prop, wraps `<SdkThemeContext.Provider/>`.
- `packages/rn/src/components/BrokerCredentialForm.tsx` — `useAqSdkTheme()` + `createStyles(theme)`.
- `packages/rn/src/components/WebViewBrokerAuthFlow.tsx` — same.
- `packages/rn/src/index.ts` — theme exports.
- SDK rebuilt via `npm run build` in `packages/rn/`.

### Fixed — ZamZam branding silently leaking into AlphaQuark builds (defensive only)

**Symptom (user-reported, 2026-04-27).** ZamZam Capital branding visible inside the AlphaQuark app variant.

**Root cause investigation.**
- `src/assets/AppLogo/logo.png` and `src/assets/AppLogo/Zamzam.png` are byte-identical (md5 `c32625ce5c55162e3d992dc72f46fed6`). The "shared default" logo at `AppLogo/logo.png` is actually the ZamZam logo.
- `src/utils/Config.js` imported it as `ZamzamLogo` and used it as the `logo` / `toolbarlogo` for `sharedUIConfig`. Variants `rgxresearch`, `magnus`, and `zamzamcapital` inherit from `sharedUIConfig` without overriding `logo` — they all display ZamZam branding.
- `src/context/ConfigContext.js` defaulted `selectedVariant` to `'rgxresearch'` when `Config?.APP_VARIANT` was missing, AND fell back to `'rgxresearch'` when the env value didn't match a known variant. Either failure mode silently produced ZamZam branding on AlphaQuark builds.

**Could not reproduce visually** without the user's specific screenshot. Defensive fix only:
1. `src/context/ConfigContext.js`: `DEFAULT_VARIANT` introduced and set to `'alphaquark'`. Both the missing-env and unknown-variant fallback paths use it. A `console.warn` fires when `APP_VARIANT` is missing so the issue is visible during dev/staging builds. White-label tenants forking this repo MUST change `DEFAULT_VARIANT` to their own variant key.
2. `src/utils/Config.js`: renamed `ZamzamLogo` → `SharedDefaultLogo` with a multi-line comment explaining that the file is ZamZam-branded and any variant inheriting `sharedUIConfig` without overriding `logo` will display ZamZam. No functional change — same asset path, just clearer naming.

**Open**: if the leak is happening on a build with `APP_VARIANT=alphaquark` set correctly, the source is elsewhere (likely backend `appadvisors.alphaquark.logo` returning a ZamZam asset URL, or a hardcoded string somewhere not yet found). Need a screenshot of the specific screen to chase further.

---

## [3.9.30] - 2026-04-26

### Fixed — AliceBlue post-connect "Authentication Required" loop + place-order session-expired loop + dual-modal stack

**Symptoms (production reproduction).** After AliceBlue connect succeeded via the OTP-validate interceptor [3.9.29], the user was bounced into a misleading state: tapping Rebalance opened a "Login to AliceBlue" prompt; tapping Place Order on Step 3 returned them to the AliceBlue WebView. Token was valid throughout.

**Root cause — ccxt-side, applies to all client repos.** `aliceblue.py:_parse_funds_response` and `aliceblue.py:validate_session` both collapsed every non-`status:'Ok'` AliceBlue response into a session-expired error, including:
1. `{status:'Info', message:'…temporarily unavailable…'}` — scheduled maintenance window. Token valid.
2. `{status:'EC920', message:'…No trades found…'|'…No positions found…'}` — empty-account / no-data. Token valid.

The collapse stripped upstream context AND set `status:1` / `is_valid=False`. Two failure modes:
- **Rebalance entry**: `validateBrokerSession` saw `status:1` → TOKEN_EXPIRED → opened BrokerSelectionModal "Authentication Required → Login to AliceBlue".
- **Place Order**: `validate_session` returned `False` → trade pipeline marked every order as `session_expired:True` → client opened the AliceBlue reconnect WebView.

**Fix — ccxt-india `brokers/aliceblue/aliceblue.py`** (committed in ccxt repo):
- `_parse_funds_response`: maintenance + no-data → `status:0` with zero-funds payload, errorcode `MAINTENANCE` / `NO_DATA`. Only true I/O / shape failures keep `status:1`.
- `validate_session`: maintenance + no-data return `(True, "")`. Only auth-shaped messages (`token expired`, `invalid token`, `unauthorized`, `session expired`, `please log`, `2fa`, etc.) return `(False, ...)`. Unrecognized non-Ok responses log a warning and return `(True, "")` — fail-open to avoid false expiry; placement endpoint surfaces real errors itself.

**Fix — Alphab2bapp `src/utils/rebalanceHelpers.js`** (this commit):
- Added `'maintenance'` errorcode to `TRANSIENT_NON_AUTH_BROKER_ERROR_CODES` as a hard signal — the existing keyword check already catches `temporarily unavailable`, this is the structured-code dual.

**Dual-modal stacking on broker connect** (this commit):
- After AliceBlue / Kotak connect, `showAlert('success', ...)` fired immediately AND `fetchBrokerStatusModal()` queued the migration sheet 700ms later. Both rendered on screen simultaneously, with the success alert above and the migration sheet below — confusing UX, and the migration sheet didn't block navigation so users could tap "Rebalance" while both modals were open.
- `TradeContext.fetchBrokerStatusModal` now returns `{migrationWillShow: boolean}`. `AliceBlueConnect.saveBrokerConnection` and `KotakModal._connect` await the result and skip the success alert when the migration sheet will appear (the migration sheet itself says "Reconnected to AliceBlue — your holdings are already set up", which is its own success indicator). Underlying broker modal closed first to prevent the migration sheet from stacking under a stale OAuth modal.

### Files
- `src/screens/TradeContext.js` — `fetchBrokerStatusModal` returns `{migrationWillShow}`
- `src/components/BrokerConnectionModal/AliceBlueConnect.js` — await, skip-on-migration
- `src/components/BrokerConnectionModal/KotakModal.js` — same pattern
- `src/utils/rebalanceHelpers.js` — `'maintenance'` errorcode

### Cross-repo
- ccxt-india `brokers/aliceblue/aliceblue.py` — `_parse_funds_response` + `validate_session` (committed `fc01dfd1`)
- tidi_new `lib/components/home/portfolio/BrokerAuthPage.dart` (interceptor port) + `lib/utils/rebalance_helpers.dart` (`maintenance` errorcode)
- prod-alphaquark-github `src/utils/rebalanceHelpers.js` (`maintenance` errorcode)

---

## [3.9.29] - 2026-04-26

### Fixed — AliceBlue: post-OTP redirect bypassed via WebView fetch/XHR interceptor (workaround for AliceBlue's broken Keycloak `getUser` step)

**Symptom (2026-04-26 production reproduction).** After hardcoding `prod.alphaquark.in` in [3.9.28], AliceBlue connect *still* failed — user enters UCC → password → OTP → WebView reloads back to login. Logcat showed every WebView nav stuck at `https://ant.aliceblueonline.com/?appcode=7WMf5NotZe` (the SPA was doing internal routing, never navigating externally), plus a console error: `Uncaught (in promise) FirebaseError: Messaging: This browser doesn't support the API's required to use the Firebase SDK`.

**Root cause — AliceBlue's broken Keycloak client config (server-side, our code is fine).** User captured AliceBlue's actual API responses from web devtools:

- `POST https://antdrn.aliceblueonline.com/omk/auth/access/v1/otp/validate` → `{status:'Ok', result:[{accessToken:'<JWT>', redirectUrl:'https://alphaquark.in/api/deploy/broker/callback?authCode=...&userId=254555', authorized:true}]}` — the OAuth completes successfully and AliceBlue HANDS US the redirectUrl with the authCode.
- `GET https://antdrn.aliceblueonline.com/omk/client-rest/profile/getUser` → **401 Unauthorized**.

The JWT's `allowed-origins` claim contains only localhost: `["http://localhost:3002", "http://localhost:5050", "http://localhost:9943", "http://localhost:9000"]`. AliceBlue's Keycloak `alice-kb` client is mis-configured — `ant.aliceblueonline.com` (their own production SPA host) isn't allowlisted, so when their SPA cross-origins to `getUser` after OTP, Keycloak rejects with 401. The SPA aborts the post-OTP redirect on this 401 — never navigating to the `redirectUrl` AliceBlue's own OTP-validate endpoint just handed it. **This is broken for everyone, including AliceBlue's own web flow** (user confirmed same issue in browser).

**Workaround — fetch/XHR interceptor injected into the WebView.** New `ALICEBLUE_REDIRECT_INTERCEPTOR` const in `AliceBlueConnectUI.js` is passed via `injectedJavaScriptBeforeContentLoaded` so it runs before any AliceBlue page script. It monkey-patches both `window.fetch` and `XMLHttpRequest.prototype.{open,send}`, watches for responses to `/otp/validate`, parses the JSON for `result[0].redirectUrl`, and force-navigates the WebView via `window.location.href = redirectUrl` — bypassing the broken `getUser` step entirely. We don't need profile data; we only need the `authCode` in the redirectUrl, and AliceBlue gives us that in the OTP-validate response itself.

The redirect lands on `https://alphaquark.in/api/deploy/broker/callback?authCode=...&userId=...`, which 302s through ccxt's `/aliceblue/oauth/callback` → exchanges authCode → access_token → 302s to `prod.alphaquark.in/stock-recommendation?user_broker=AliceBlue&status=0&access_token=X&client_id=Y` — captured by the existing `handleWebViewNavigationStateChange` query-param matcher.

### Files
- `src/UIComponents/BrokerConnectionUI/AliceBlueConnectUI.js` — `ALICEBLUE_REDIRECT_INTERCEPTOR` const + `injectedJavaScriptBeforeContentLoaded` prop on the WebView

### Open follow-ups
- This is a workaround for an AliceBlue server-side bug. **Contact AliceBlue partner support** to add `ant.aliceblueonline.com` (and any other production SPA host) to the `alice-kb` Keycloak client's `Web Origins` config.
- Port to tidi_new `lib/components/home/portfolio/BrokerAuthPage.dart` — `webview_flutter` supports `runJavaScript` / `addJavaScriptChannel` for the same patch pattern.
- Dual-modal stacking: success alert `Connected Successfully` + `HoldingsMigrationModal` "Reconnected to AliceBlue" both render simultaneously after connect (700ms migration delay isn't enough). Affects every credential broker (`KotakModal.js:251` and `AliceBlueConnect.js:205` both fire `showAlert` then `fetchBrokerStatusModal`). Tracked separately.

---

## [3.9.28] - 2026-04-26

### Fixed — AliceBlue connect: OTP submission silently bounced back to password screen (cross-broker fan-out from Groww App Links)

**Symptom (2026-04-26 production user reproduction).** AliceBlue connect on Alphab2bapp: user enters UCC → password → AliceBlue OTP screen → enters OTP → WebView reloads back to the AliceBlue PASSWORD screen, not our success/error UI. Repeats every retry. Tidi_new doesn't reproduce because tidi_new hardcoded `prod.alphaquark.in` as the origin in commit `d5fb65b`.

**Root cause — env-var fan-out from Groww App Links work.** `AliceBlueConnect.js:buildAliceBlueAuthUrl` was reading `Config?.REACT_APP_BROKER_CONNECT_REDIRECT_URL` and using its `origin` as the AliceBlue OAuth redirect host. That env var was repurposed in commit `f9f5d0f` (Groww App Links) from `https://prod.alphaquark.in/stock-recommendation` → `https://app-links.alphaquark.in/broker-callback`. ccxt logs confirmed: `GET /aliceblue/login?origin=https%3A%2F%2Fapp-links.alphaquark.in%2Fbroker-callback&returnPath=%2Fstock-recommendation`. AliceBlue's partner appcode `7WMf5NotZe` is **allow-listed against `prod.alphaquark.in` ONLY** — any other origin causes AliceBlue's portal to silently fail the post-OTP redirect and the WebView falls back to the login page. We never see a callback URL to intercept; the user just sees the password screen again.

**This is exactly the fan-out the CLAUDE.md guardrail warns about**: "NEVER modify a broker-related env var (`.env`) without running the audit below. A single env-var change can silently break multiple broker OAuth flows... `f9f5d0f` (Groww App Links) repurposed `REACT_APP_BROKER_CONNECT_REDIRECT_URL` from `https://prod.alphaquark.in/stock-recommendation` → `https://app-links.alphaquark.in/broker-callback` and silently broke Zerodha's publisher basket on prod, and OAuth for 8 brokers × 10 tenants that had no backend override." AliceBlue is the latest casualty — Zerodha and others were called out at f9f5d0f time; AliceBlue's specific failure mode (silent OTP-screen bounce, no error message) wasn't surfaced until now because the appcode-whitelist behaviour is invisible from our side.

**Fix — hardcode `prod.alphaquark.in`** (matching tidi_new's `_getAliceBlueLoginUrl` from commit `d5fb65b`). `AliceBlueConnect.js:buildAliceBlueAuthUrl` no longer reads the env var; the origin and `returnPath` are constants. Safe because the WebView intercepts callback URLs by query params (`user_broker=AliceBlue`, `access_token`, `client_id`) — the redirect host doesn't have to match the runtime app's actual host. Fat comment block on the function explains why and references the d5fb65b precedent.

### Files
- `src/components/BrokerConnectionModal/AliceBlueConnect.js` — `buildAliceBlueAuthUrl` hardcoded
- `docs/BROKER_CONNECTION.md` — Per-broker redirect URL reference table updated for AliceBlue (hardcoded + appcode allow-list note)

### Cross-repo precedent
- tidi_new `lib/components/home/portfolio/BrokerAuthPage.dart:_getAliceBlueLoginUrl` (commit `d5fb65b`)

### Open follow-up
- Audit other partner-broker connect URLs (Dhan, Axis, Angel One) for the same pattern. Each broker's appcode/registered-redirect URL has its own allow-list; if any of them currently use `REACT_APP_BROKER_CONNECT_REDIRECT_URL` and the broker's appcode isn't allow-listed for `app-links.alphaquark.in`, the same silent-bounce class of bug will surface.

---

## [3.9.27] - 2026-04-26

### Fixed — Fyers Publisher SDK registry stubs removed (de-facto already REST-only)

**Why this is a port from tidi_new commit `a063887`** (2026-04-25 — "Fyers execution: drop Publisher-SDK WebView, use REST via ccxt"). tidi_new reproduced "Awaiting Confirmation forever" caused by Flutter's `loadHtmlString` having no real origin → Fyers Publisher SDK silent domain-validation failure → basket WebView never rendered. They retired the Fyers WebView path entirely; basket execution now goes through ccxt-india's `/fyers/process-trades` REST endpoint like every non-Zerodha broker.

**Cross-repo audit on Alphab2bapp.** Surveyed the 3 callsites flagged by the audit (`RebalanceModal.js`, `UserStrategySubscribeModal.js`, `MPReviewTradeModal.js`) — each has a `handleFyersRedirect` function that **already** posts to `${ccxtServer}rebalance/process-trade` (the REST path), NOT a publisher SDK WebView. Verified via grep: `isPublisherSupported('Fyers')` and `BROKER_PUBLISHER_CONFIG.Fyers` are referenced only inside `brokerPublisher.js` itself, never read by any consumer. The Fyers Publisher path was registered in `brokerPublisher.js` but never wired into the order-execution flow on RN — it was always dead code. So Alphab2bapp doesn't have the production bug tidi_new fixed; the de-facto behaviour is already correct.

**What this commit does**: Cleans up the misleading dead-code stubs so a future contributor doesn't re-wire Fyers through the publisher (which would reproduce the tidi_new bug). Removed:
- `'Fyers'` from `PUBLISHER_SUPPORTED_BROKERS` (now `['Zerodha']` only) — replaced with a fat comment explaining the de-facto REST-only state and the tidi_new precedent.
- `BROKER_PUBLISHER_CONFIG.Fyers` entry (`scriptUrl: api-connect-docs.fyers.in/fyers-lib.js` was the SDK we'd have loaded).
- Fyers branches in `getPublisherApiKey` (returned `userBrokerClientCode`), `convertToBasketItem` (built the `NSE:SBIN-EQ` symbol form for Fyers SDK), `getPublisherRecordEndpoint` (`api/fyers/publisher/record-orders`).
- Helper functions `mapFyersOrderType` and `mapFyersProductType` — both now unused.

**Net behaviour change**: zero. All Fyers order placement continues through the existing REST `handleFyersRedirect` paths.

### Files
- `src/utils/brokerPublisher.js` — registry, helper, dead-branch removal

### Cross-repo
- tidi_new `lib/service/OrderExecutionService.dart` (commit `a063887`) — the original ccxt-only flip
- ccxt-india `apps/app_fyers.py:161` (`/fyers/process-trades`) — the REST endpoint everyone now uses

---

## [3.9.26] - 2026-04-25

### Fixed — Fyers instructions: explicit "Order Placement" permission warning + recovery copy

**Symptom (2026-04-25 production logs, ccxt-india).** Once Fyers basket orders started reaching the broker (after the REST endpoint fix `68a4d0a1` on the ccxt side), every multi-order POST was rejected with `Order placement restricted. Algo orders are not allowed from this app UBGF6OHH9P-100`. Same string for every order; no other failures in the same time window. The Alphab2bapp / tidi UI surfaced the rejection in the Order Errors modal, so the user knew SOMETHING was wrong but had no path to fix it from our screens.

**Root cause — user-side permission, not a code bug.** Fyers's app-create UI at https://fyers.in/web/api-dashboard/user-apps exposes a per-permission checklist (Order Placement, Holdings, Funds, etc.) and **defaults the "Order Placement" checkbox to OFF**. Without it ticked, Fyers's order endpoints reject every order with the "algo orders are not allowed for this app" string regardless of how the order is shaped, what API the call goes through, or which app version is making it. Our existing `FyersHelpContent.js` step 3 said `Grant all app permissions and check the box to accept the API Usage Terms and Conditions` — too generic for users to notice that one specific checkbox at the bottom of the list is the make-or-break one.

**Fix — instruction copy on all 3 surfaces.** Documentation only on our side (no code change resolves it; the user MUST enable the permission on Fyers's dashboard). Updated:
- `Alphab2bapp/src/UIComponents/BrokerConnectionUI/HelpUI/FyersHelpContent.js` — step 3 split into create + permissions guidance with a `⚠️ MUST tick "Order Placement" permission` callout in bold; new step 5 with recovery instructions for users who already created the app and are now seeing the algo-orders error (Edit app → tick permission → Save, no need to recreate / re-paste keys)
- `prod-alphaquark-github/src/Home/BrokerConnection/Fyers/FyersConnection.js` — same callout pattern in the Step-3 substep list (amber `⚠️` bullet) + new "!" callout block beneath Step 4 with the recovery steps
- `tidi_new/tidistockmobileapp/lib/models/broker_config.dart` — Flutter equivalent in `Fyers.instructionSteps` step 3 + recovery in `instructionNote` (committed in tidi_new repo)

**Why the recovery copy matters separately.** The "fix at create time" warning is for new users; the "edit existing app" recovery is for everyone already affected (the user who reported it included). Without the recovery copy, an affected user reads our warning, thinks "but I already created it" and assumes they need to delete/recreate the app and re-paste API Key + Secret — which they don't. Fyers's Edit form lets you toggle the permission post-create and the existing keys keep working.

### Files
- `src/UIComponents/BrokerConnectionUI/HelpUI/FyersHelpContent.js` — step 3 expanded + new step 5

### Cross-repo
- `prod-alphaquark-github/src/Home/BrokerConnection/Fyers/FyersConnection.js`
- `tidi_new/tidistockmobileapp/lib/models/broker_config.dart` (committed in tidi_new repo)
- `tidi_new/tidistockmobileapp/lib/components/home/portfolio/ExecutionStatusPage.dart` — bottom-sheet "Close" button on `_showOrderErrorModal` was clipped on devices with system gesture inset; wrapped in `SafeArea(top: false)`. Same commit bundle in tidi_new repo.

### Open follow-up
- The "Order Placement" warning is only on the credential-entry instruction screens. Add the same callout on the broker-error UI when the rejection message contains `algo orders are not allowed` so an affected user gets pointed at the Fyers Edit dashboard from the failure surface itself, not just the (already-completed) connect screen.

---

## [3.9.25] - 2026-04-25

### Fixed — Kotak double-submit trap: "Incorrect credentials" alert overlapping the success migration sheet

**Symptom (2026-04-25 production screenshot, Alphab2bapp).** "Connect to Kotak" page had two conflicting UI elements on screen at once: a `Connection Error: Incorrect credentials. Please try again` alert AND a `Reconnected to Kotak — Your holdings are already set up for Kotak. You're good to go!` bottom sheet (`HoldingsMigrationModal` with `isReconnection = true`). User reported that Kotak connected fine on tidi but not Alphab2bapp.

**Root cause — single-flight gate missing on the Connect button.** `KotakConnectUI.js:239` had:
```jsx
disabled={!apiKey || !mobileNumber || !mpin || !ucc || !totp || !egressReady}
```
`isLoading` was NOT in the disabled list. While a Connect was in flight (spinner up), the button stayed tappable. Sequence that produced the screenshot:
1. User submits credentials → `setIsLoading(true)` → `axios.put(/api/kotak/connect-broker)` fires → spinner shows
2. Backend hits ccxt `/kotak/login/totp` → Kotak accepts the TOTP → backend writes `connect_broker_status: connected` + `connected_brokers[Kotak]` slot → returns 200
3. The `.then` chain runs → `fetchBrokerStatusModal()` → migration check returns `requiresMigration: true` → `setShowMigrationModal(true)` queued for 700ms
4. User, not seeing immediate feedback (the success alert is brief / the migration modal hasn't fired yet), taps Connect AGAIN
5. Second `axios.put` → ccxt forwards the SAME TOTP to Kotak → Kotak rejects (TOTPs are single-use within their 30s window) → backend returns 400 with `Invalid OTP` or similar
6. Mobile's `.catch` fires the generic fallback `Incorrect credentials. Please try again` alert (the actual broker message wasn't surfaced)
7. The 700ms timer from step 3 fires → migration modal opens
8. Both visible — the screenshot

**tidi worked because** its Connect button correctly gates on `_isLoading` so a parallel submit can't happen.

**Three guards.**
- **Single-flight in the UI** (`KotakConnectUI.js:239`). Added `|| isLoading` to the `disabled` list and to the grey-out style. Also added a code comment explicitly tying the flag to the 2026-04-25 incident so a future edit doesn't silently drop it.
- **Single-flight + 30s debounce in the modal** (`KotakModal.js:updateKotakSecretKey`). New `isInFlightRef` blocks parallel submits even if a future UI edit drops the disabled-flag (defence-in-depth). New `lastKotakConnectAtRef` + 30s cooldown (matches Kotak's TOTP rotation window) blocks the user from re-submitting Connect within 30s — generates a clear `'Please wait'` alert that names the exact failure mode (`Incorrect credentials` even when the previous attempt actually succeeded). Both flags are reset in every exit path: each validation early-return, the success `.then`, and the failure `.catch`.
- **Better error message** (`KotakModal.js:.catch`). Surfaces Kotak's actual rejection text first; if it contains TOTP-related keywords (`otp` / `totp` / `two factor` / `two-factor`), title flips from `Connection Error` → `TOTP Rejected` and body appends the explicit "TOTPs rotate every 30s, can't be reused, generate a fresh code in NEO" hint. Generic fallback only when the broker returns no message.

**Files:** `src/UIComponents/BrokerConnectionUI/KotakConnectUI.js` (disabled-list + style fix), `src/components/BrokerConnectionModal/KotakModal.js` (in-flight ref + 30s debounce + improved error parsing), `docs/CHANGELOG.md` (this entry).

**Cross-repo note.** tidi_new (Flutter) is unaffected — its `BrokerCredentialPage._connectKotak` already gates on its loading state. Same Connect-debounce pattern shipped earlier today on Motilal (CHANGELOG `[3.9.24]`); Kotak now matches.

---

## [3.9.24] - 2026-04-25

### Fixed — Motilal session-affinity trap: silent WebView reload + Connect spam → "Authorization Invalid" / `MO1007`

**Symptom (production trigger).** A single user fired `/motilal-oswal/login` 4 times in 4 minutes (12:18–12:22 UTC) and got three different broker-side errors in succession: (1) `net::ERR_NAME_NOT_RESOLVED` on first WebView load (the IPv6 / DNS race we already auto-retry), (2) `Authorization is Invalid In Header Parameter` on OTP submit, (3) `{"status":"ERROR","message":"Two Factor Authentication Failed","errorcode":"MO1007"}` on the next OTP submit. ccxt logs confirmed 4 separate `/motilal-oswal/login` POSTs from the same client over the same 4 minutes.

**Root cause — Motilal binds OTP, page session, and Authorization header to a single page-load.** Motilal's OpenAPI requires the OTP delivered to the user's mobile, the page-side session cookie, and the apikey-derived `Authorization` header on OTP-verify to all originate from the **same** WebView load. Any rotation in between invalidates the others. Two of our behaviours rotated the session without telling the user:
- `MotilalConnectUI.js:onError` was unconditionally `setKey(k+1)`-reloading the WebView on ANY error — including transient errors that fired AFTER Motilal's page had already loaded successfully. The reload silently unmounted + remounted the WebView, wiping the user's typed OTP and rotating Motilal's server-side session, so the OTP they then re-entered came from session N–1 while Motilal had already moved to session N → `Authorization Invalid`.
- `MotilalModal.js:initiateAuth` had no debounce. The user could fire 4 fresh `/motilal-oswal/login` calls in 4 minutes, each issuing a fresh Motilal session and a fresh OTP. Without a clear "wait" signal, the user spam-clicked Connect and ended up entering OTP from session 1 into a page on session 4.

**Fix — two guards.**
- **Post-load failure isolation** (`MotilalConnectUI.js:MotilalWebViewWithRetry`). New `pageLoadedOnceRef` armed in `onLoadEnd`. After it's true, `onError` no longer silently reloads — it surfaces a "Restart connection" UI explaining that reloading would rotate Motilal's session and invalidate any OTP the user has received. The user has to consciously tap Restart, which fires `onRequestRestart` on the parent. Pre-load failures (DNS race, network down before page loaded) keep the existing auto-retry-once behaviour.
- **Connect-button 30s debounce** (`MotilalModal.js:initiateAuth`). New `lastConnectAtRef` blocks repeat Connects within 30s of the previous `/motilal-oswal/update-key` call. The blocking alert names both failure modes (`Authorization Invalid`, `Two Factor Authentication Failed`) so support can diagnose by string match. 30s was chosen empirically — Motilal's session state typically settles within 15–20s; 30s leaves margin without breaking UX.
- **Restart helper** (`MotilalModal.js:handleRequestRestart`). The Restart-connection CTA wired through to a parent handler that closes the WebView and wipes `authUrl` / `jwtToken` / `isToastShown` so the next Connect goes through the full `/motilal-oswal/login` round-trip with fresh state. The 30s debounce still applies to gate Restart→Connect→Restart loops.

**Docs:** `docs/BROKER_CONNECTION.md` — new § Motilal session-affinity guard (2026-04-25) explaining the failure mode, the two guards, and what we deliberately did not build (page-content sniffing — fragile, deferred unless the two guards prove insufficient). Per-broker table row updated. Cross-repo note: web app's Motilal flow uses `window.location.href` not WebView so doesn't have this trap; tidi_new (Flutter) uses `webview_flutter` and likely DOES — flagged for future audit.

**Files:** `src/UIComponents/BrokerConnectionUI/MotilalConnectUI.js`, `src/components/BrokerConnectionModal/MotilalModal.js`, `docs/BROKER_CONNECTION.md`.

---

## [3.9.23] - 2026-04-25

### Fixed — "How to Authorize >" crashes app for Groww and 7 other brokers (DdpiModal.js)

**Symptom.** Tapping "How to Authorize >" on the "Action Required: Stock Authorization to Sell" modal crashed the app. Reproduced with Groww (screenshot 2026-04-25 12:48). Affected all brokers not explicitly listed in `brokerInstructions`.

**Root cause — three bugs in `DdpiModal.js`:**

1. **Missing broker entries (crash).** `brokerInstructions` only had 7 keys: IIFL Securities, ICICI Direct, Upstox, Kotak Securities, HDFC Securities, AliceBlue, Dhan. Zerodha, Angel One, Groww, Motilal Oswal, Axis Securities, and Fyers were absent. When `broker = 'Groww'`, `brokerInstructions['Groww']` = `undefined`, and the render path unconditionally accessed `.videoId` on it → `TypeError: Cannot read properties of undefined` → crash.

2. **Wrong map keys (crash).** `'Kotak Securities'` should be `'Kotak'` (matching `userDetails.user_broker`). `'HDFC Securities'` should be `'Hdfc Securities'`. Users with Kotak or HDFC Securities connected hit the same crash via a different path.

3. **YoutubePlayer rendered unconditionally (crash/blank).** `<YoutubePlayer videoId={brokerInstructions[broker].videoId} />` was rendered even when no `videoId` exists for the broker. For ICICI Direct and Kotak this passed `undefined` to YoutubePlayer (blank/crash). For Dhan the `videoId` was a full URL instead of a YouTube ID — invalid format. Fix: only render `YoutubePlayer` when `brokerInstructions[broker]?.videoId` is truthy.

**Fix.** Replaced the entire `brokerInstructions` map with complete entries for all 13 applicable brokers (DummyBroker excluded). Each entry has a title and steps array describing how to complete EDIS/TPIN authorization on that broker's own app — distinct from the DDPI activation flow (handled by the separate green "Show me how to activate DDPI" button). Guarded the `YoutubePlayer` render with a `?.videoId` check.

**Brokers now covered:** Zerodha, Angel One, Upstox, ICICI Direct, Kotak, Dhan, Fyers, IIFL Securities, AliceBlue, Motilal Oswal, Hdfc Securities, Groww, Axis Securities.

**YouTube walkthroughs available for:** Upstox (`eD6aQ07Ommw`), IIFL Securities (`hpP5M5H52HY`), AliceBlue (`gP06qK8LfYo`), Hdfc Securities (`CkZI_2psXLY`).

**Files changed:**
- `src/components/DdpiModal.js` — `brokerInstructions` map replaced; `YoutubePlayer` guarded with `?.videoId`

---

## [3.9.22] - 2026-04-25

### Fixed — Android hardware back button leaves ghost overlay over wrong screen (all 14 broker modals)

**Symptom.** User opens any broker connection modal (Groww, Zerodha, AliceBlue, etc.), does not fill in credentials, presses the Android hardware back button. The background navigates back to the previous screen but the modal overlay **stays painted on top** — a ghost UI floating over the wrong screen. Screenshot captured 2026-04-25 12:19: Groww instructions screen persisted over "Account Settings" after back press.

**Root cause.** `CrossPlatformOverlay` on Android renders as a plain `View` with `StyleSheet.absoluteFillObject` + `zIndex: 9999`, not a React Native `Modal`. React Navigation's hardware-back handler fires first, pops the underlying screen, but the `View` has no lifecycle tie to navigation so it stays rendered. Additionally, every caller passes `onClose` to `CrossPlatformOverlay` but the component destructured only `{ children, visible }` — `onClose` was silently dropped and never wired to anything.

**Fix.** Added a `BackHandler.addEventListener('hardwareBackPress', …)` inside a `useEffect` in `CrossPlatformOverlay`. When the overlay is visible on Android the handler fires first, calls `onClose?.()` to close the overlay, and returns `true` to consume the event (preventing React Navigation from also popping the screen). Cleaned up via `sub.remove()` on unmount / when `visible` flips to `false`.

**Blast radius fixed (14 surfaces, single file change):**
- `BrokerConnectionModal/GrowwConnectModal.js`
- `UIComponents/BrokerConnectionUI/ZerodhaConnectUI.js`
- `UIComponents/BrokerConnectionUI/AngelOneConnectUI.js`
- `UIComponents/BrokerConnectionUI/AliceBlueConnectUI.js`
- `UIComponents/BrokerConnectionUI/UpstoxConnectUI.js`
- `UIComponents/BrokerConnectionUI/DhanConnectUI.js`
- `UIComponents/BrokerConnectionUI/DhanOAuthUI.js`
- `UIComponents/BrokerConnectionUI/FyersConnectUI.js`
- `UIComponents/BrokerConnectionUI/KotakConnectUI.js`
- `UIComponents/BrokerConnectionUI/MotilalConnectUI.js`
- `UIComponents/BrokerConnectionUI/ICICIConnectUI.js`
- `UIComponents/BrokerConnectionUI/HDFCConnectUI.js`
- `BrokerConnectionModal/AxisConnectModal.js` *(passes no `onClose` — back press is consumed/blocked but overlay doesn't close; pre-existing gap, not introduced here)*
- `components/BrokerDdpiHelpModal.js`

**iOS:** Unaffected — `useEffect` has `Platform.OS !== 'android'` guard; `FullWindowOverlay` path is unchanged.

**Files changed:**
- `src/components/CrossPlatformOverlay.js` — add `BackHandler` + `useEffect`; destructure `onClose`

**Backend:** No changes.

---

## [3.9.21] - 2026-04-24

### Fixed — ICICI broker: holdings mismatch, "Detail on portfolio" blank screen, race condition, stale-broker banner

Five related bugs traced to ICICI Direct users having an empty `model_portfolio_user` record after switching brokers, while cross-broker fallbacks in `subscription-raw-amount` (aq_backend) served old-broker data to some screens but not others.

**(1) MPStatusModal used a strict broker filter the web doesn't have (`MPStatusModal.js`).** The modal's internal fallback fetch passed `params: { broker: userbroker }` to `rebalance/user-portfolio/latest`. The backend's `$project` stage doesn't return `user_broker`, so the broker-mismatch guard (`portfolioBroker !== userbroker`) was dead code — but the `broker` query param caused the backend to return only the empty ICICI Direct record rather than falling back the way the web does. Rebalance Step 2 showed "You do not have holdings associated with THIS model portfolio" even when holdings from another broker existed. **Fix:** removed `params: { broker: userbroker }` and the dead mismatch block, matching `prod-alphaquark-github/MPStatusModal.js` exactly.

**(2) AfterSubscriptionScreen: race condition served wrong-broker data to Portfolio Holdings tab (`AfterSubscriptionScreen.js`).** `getSubscriptionData()` was triggered by `useEffect([strategyDetails])`. `userDetails` (which carries `user_broker`) resolves later. During the gap, `getSubscriptionData` called `subscription-raw-amount` with `user_broker = undefined` — the aq_backend treated this as no broker filter and returned whichever record existed first (often DummyBroker). **Fix:** added `userDetails` to the dependency array so `getSubscriptionData` waits for both `strategyDetails` and `userDetails` before running; `user_broker` is always a real value when the API is called.

**(3) "Detail on portfolio" appeared to do nothing for ICICI users (`AfterSubscriptionScreen.js`).** The button navigated correctly but for ICICI users with wrong/empty holdings data the screen showed `EmptyStateInfoMP` immediately, which the user interpreted as the button failing. Root cause was bug (2). Also hardened `tableData.length` → `tableData?.length` (defensive optional chain matching web style).

**(4) Stale cross-broker data shown without indication (`AfterSubscriptionScreen.js`).** When CCXT returns empty for the current broker and `subscription-raw-amount` falls back to another broker's holdings, the Portfolio Holdings tab silently showed that stale data. Added `isStalebrokerData` detection and a yellow warning banner: *"⚠️ Holdings shown are from a previous broker. To rebalance with [broker], please update your holdings in the rebalance flow."*

**Files changed:**
- `src/components/AdviceScreenComponents/MPStatusModal.js` — removed `params: { broker: userbroker }` + dead broker-mismatch check
- `src/screens/Home/AfterSubscriptionScreen.js` — useEffect race condition fix (`[strategyDetails, userDetails]`), `tableData?.length` guard, `isStalebrokerData` state + stale-data banner

**Backend:** No changes required.

**Docs updated:** `docs/MODEL_PORTFOLIO.md` — new sections on holdings data source discrepancy, broker-switch migration flow, and AfterSubscriptionScreen data flow.

---

## [3.9.20] - 2026-04-24

### Fixed — AliceBlue broker connect: "Your Broker & Funds Info" card appeared truncated after connection

**Symptom.** After connecting AliceBlue (or any broker where the account had prior model-portfolio holdings from a different broker), the "Your Broker & Funds Info" card on the Broker Screen (`SubscriptionScreen`) showed only its title — the six info rows (Broker, Available Cash, Phone, Email, PAN, Account Created) were invisible. Screenshot captured at 2026-04-24 20:09.

**Root cause — race between `navigation.goBack()` and `setShowMigrationModal(true)`.**
`TradeContext.fetchBrokerStatusModal()` is called immediately after a successful broker connection. It calls `getUserDeatils()` → `fetchFunds()` → `broker-migration-summary` API. If `requiresMigration: true` the function called `setShowMigrationModal(true)` synchronously. `BrokerAuthScreen.handleCallback` fires `onSuccess()` (which calls `fetchBrokerStatusModal`) and then immediately fires `navigation.goBack()`. The back-navigation animation takes ~300 ms. When `fetchBrokerStatusModal` finished its three async calls (~400–600 ms), the user had already landed on `SubscriptionScreen` — but the `HoldingsMigrationModal` bottom sheet slid up at exactly that moment, its white background hiding the just-rendered card rows. Visually the card appeared truncated (title only).

**Fix.** Wrap the `setShowMigrationModal(true)` call in a 700 ms `setTimeout` in `TradeContext.js`. This lets `navigation.goBack()` animation (~300 ms) complete and `SubscriptionScreen` fully render before the bottom sheet appears. Matches the web-prod pattern: `prod-alphaquark-github` only triggers the migration check after the user explicitly clicks "Continue" on the broker-success dialog — the delay here achieves the same settled-screen guarantee on mobile.

**Also shipped in this entry:**
- `HoldingsMigrationModal.js` (new) — broker-switch migration bottom sheet: Carry Forward / Start Fresh per model portfolio. Parity with `prod-alphaquark-github/src/Home/ModelPortfolioSection/HoldingsMigrationModal.js`.
- `TradeContext.js` — `showMigrationModal` + `migrationBroker` state; migration check in `fetchBrokerStatusModal`; both exported.
- `Navigation.js` — `HoldingsMigrationModal` mounted globally in `MainTabNavigator`.

**Files changed:**
- `src/screens/TradeContext.js`
- `src/components/HoldingsMigrationModal.js` *(new)*
- `src/components/Navigation.js`

**Docs updated:**
- `docs/APP_ARCHITECTURE.md` — new § 3.11 Post-Connect Holdings Migration Flow.

**Backend:** No changes — `broker-migration-summary` and `handle-broker-migration` endpoints already deployed in `aq_backend_github`.

---

## [3.9.19] - 2026-04-24

### Fixed — pre-trade broker-session correctness across every chokepoint + IIFL reconnect parity + Kotak mobile normalization + DDPI/EDIS inline help on rejection surfaces

Six interlocking fixes landed today. All ship on the next Play/App Store build; cross-repo partners also shipped on tidi_new (`feature/mp`) and prod-alphaquark-github (`feature/4.0` — already live on `prod.alphaquark.in`).

#### 1. Fyers / Dhan / Upstox silent-block on stale-token trades — `b741f0b`

**Symptom.** User opens app at 9 AM with a valid Fyers session → context loads `funds={data:{...}, status:0}`. Token expires during the day (Fyers/Dhan/Upstox tokens are ~daily). User clicks Trade at 6 PM → "doesn't go beyond, doesn't place." No toast, no modal, no rejection — just silent failure.

**Root cause.** `useRefreshBrokerStatus` hook (added yesterday in `8e39e02` as a Trade-Now perf win) has a fast-path at line 57 that returns cached context funds when they look "live" (`brokerStatus === 'connected' && hasLiveFunds(funds)`). Cached funds from 9 AM don't prove the token at 6 PM is still valid — so `isFundsErrorOrMissing` returns false (passes), ReviewTrade opens, user hits Place Order, ccxt/Fyers rejects with 401. Broker-agnostic bug; Fyers just happened to be the first reported.

**Fix.** New `{forceNetwork: true}` option on `refreshBrokerStatus`. When true, skip fast path entirely and always fire `fetchFunds` regardless of cache shape. Wired into all 7 pre-trade chokepoints:
- `StockAdvices.handleTrade` / `handleTradeBasket` / `handleSingleSelectStock`
- `AddtoCartModal.handleTrade`
- `RebalanceAdvices.handleAcceptRebalance`
- `RebalanceCard.handleCheckStatus` / `handleCheckBroker`

Read-only surfaces (no-trade-button screens) keep the fast path — no perf regression on the hot read path.

#### 2. Typed `validateBrokerSession` + `classifyFundsResponse` helpers — `07252fd`, `703f821`

Thin wrapper over existing `fetchFunds` + `isFundsErrorOrMissing` + `isTransientFundsError` that returns `{ok, reason, message, funds}` where `reason ∈ {OK, NOT_CONNECTED, TRANSIENT, TOKEN_EXPIRED, PROBE_FAILED}`. Lets chokepoints branch UX:
- `OK` → proceed
- `TRANSIENT` → soft toast (Upstox 00:00–05:30 IST maintenance, ICICI Breeze base-64 hiccup) — NO reconnect prompt
- `TOKEN_EXPIRED` / `NOT_CONNECTED` → existing `TokenExpire` modal
- `PROBE_FAILED` → let trade proceed; the actual order placement surfaces any real issue

**Two helpers**: `classifyFundsResponse` is sync (for sites that already have fresh funds from the refresh-hook); `validateBrokerSession` is async (fires its own fetchFunds). DRY — async delegates to sync after the network call.

Migrated 9 chokepoints (5 StockAdvices, 1 each AddtoCartModal/RebalanceAdvices/RebalanceCard-×2). Before: boolean `isFundsEmpty` → single modal for everything. After: TRANSIENT gets a dedicated toast path (no more Upstox maintenance window misfiring as "session expired"). Files: `src/utils/brokerSessionValidator.js` (new — 180 LOC), plus in-place migration at each site.

Cross-repo parity:
- tidi_new: `lib/utils/broker_session_validator.dart` (`a7bb53f`), + MP rebalance pre-flight via `validateBrokerSession` (`1311518`), + `OrderExecutionService._validateBrokerSession` live probe using typed validator (`32a15fd`), + `ExecutionStatusPage` catches `TRANSIENT_BROKER_ERROR:` marker as orange snackbar instead of Reconnect Broker error state.
- prod-alphaquark-github: `src/utils/brokerSessionValidator.js` + broker-scoped IST maintenance window in `rebalanceHelpers.js` (`be6639d`), + `BasketModal.executePlaceOrder` / `UserStrategySubscribeModal` / `ModelPortfolioSection/RebalanceCard` all 3 sites migrated (`4f30524`).

#### 3. IIFL reconnect didn't refresh TradeContext — `f05c5e8`

**Symptom.** User reconnects IIFL → "Successfully connected" toast → modal closes → user clicks Trade again → "Login to IIFL Securities" modal pops AGAIN despite the just-completed reconnect.

**Root cause.** `src/components/iiflmodal.js:handleIIFLLogin` was the lone per-broker modal that didn't call `fetchBrokerStatusModal()` on success. Every other broker (Zerodha/Angel One/Upstox/ICICI/Kotak/Dhan/Fyers/AliceBlue/Motilal/HDFC/Axis/Groww) re-hydrates TradeContext on success so the user's next pre-trade check passes. IIFL was just calling `onClose()` — leaving context at its pre-reconnect state, which the next `classifyFundsResponse` check still saw as TOKEN_EXPIRED.

**Fix.** Accept `fetchBrokerStatusModal` via props (already passed by `ModalManager.commonProps` line 33 — IIFLModal just wasn't reading it) and call it on the success path between Toast and onClose. Wrapped in `typeof` guard + try/catch for defence.

**Verified scope across all 14 brokers** — this was the ONLY gap. Note: `src/components/TokenExpireBrokerModal.js` is dead code (never imported; `setOpenTokenExpireModel(true)` renders `BrokerSelectionModal` instead via `(brokerModel || OpenTokenExpireModel)` JSX guards in parent screens). Its `OAUTH_BROKERS` list and per-broker branches are misleading during audits. Worth deleting in a janitorial commit.

#### 4. Kotak mobile number rejected on valid inputs — `1f1fa0b`

**Symptom.** User enters `+91 9876543210` (contacts autofill), `+919876543210`, `09876543210`, `98765 43210`, or `98765-43210` → "Invalid Mobile Number — Please enter a valid 10-digit mobile number."

**Root cause.** `KotakModal.updateKotakSecretKey` tested the raw input directly against `/^\d{10}$/`. The TextInput had no `maxLength` / `inputFormatters`, so anything the user typed or pasted reached the regex unchanged.

**Fix.** Normalize before validating: strip non-digits, strip `91` or `0` prefix only when doing so leaves a 10-digit remainder (so genuine numbers starting with 9 aren't truncated). Write the normalized value back to the input so the user sees what we're submitting; use it in the payload. Cross-repo parity: tidi_new `b94a829`, prod-alphaquark-github `e2b4db7`.

#### 5. "What is DDPI / EDIS?" inline help on rejection surfaces — `32f1f80`

**Symptom.** Users hit a generic "EDIS authorization required" / "DDPI not enabled" / "Insufficient Mandate Qty" rejection with no path forward — had to dismiss and hunt for DDPI help through unrelated flows.

**Fix.** New shared matcher `src/utils/sellAuthMessage.js:isSellAuthRejection(message, classification)` — keyword-liberal regex covering EDIS/DDPI/TPIN/mandate/authorization/SELL_AUTH_REVOKED/SELL_AUTH_REQUIRED/CDSL TPIN/insufficient-mandate/insufficient-stocks-allocated/POA-not-enabled/3-in-1. Prefers server-side classification tag when present; falls back to message regex.

Wired into:
- `OrderScreen.js` — green "What is DDPI / EDIS? How to enable →" link below rejection text in order history; opens `openModal('DdpiHelp', {broker: item.user_broker})`
- `StockCard.js` (via `StockAdviceContent` plumbing `rejectionClassification` + `rejectionBroker` props through) — same link below "Rejected: …" text in advice-screen cards

Broker resolved from `item.user_broker` (order row) or the surrounding advice context. Suppressed when `getBrokerDdpiHelp(broker)` returns null (shouldn't happen — all 14 brokers registered — but defensive).

Cross-repo parity: tidi_new `ea85955` (ExecutionStatusPage rejection box), prod-alphaquark-github `a4a6492` (RecommendationSuccessModal desktop table + mobile card).

#### 6. Minor — dead file

`src/components/TokenExpireBrokerModal.js` exists in the repo but is NOT imported from any production path. Its `OAUTH_BROKERS` list and per-broker render branches reflect an older architecture that the move to `BrokerSelectionModal.handleBrokerSelectOpenExpire` superseded. Left in place this session to avoid scope creep; flagged for janitorial removal.

---

## [3.9.18] - 2026-04-23

### Fixed — OAuth broker connect reliability (Axis / Upstox) + distorted broker screen on foldables/split-screen

Consolidation of five session fixes (commits `7e1a321`, `c0ee009`, `06afe5f`, `7f106ef`, `ce7461d`) that together make the mobile broker connect path match the web's robustness.

**(1) Axis WebView callback never fired (`AxisConnectModal.js`, commit `7e1a321`).** The SSO callback parser was using `new URL(url)` + `searchParams.get('ssoId')`. RN has no `react-native-url-polyfill` installed and its built-in `URL` is partial — `searchParams` can be undefined on intermediate navigations (about:blank, data:, WebView-internal URLs), and without a try/catch any throw killed the handler silently. Result: WebView parked on `app-links.alphaquark.in/broker-callback?ssoId=xxx` forever with no callback POST. Rewrote parsing to defensive string-split matching Upstox/Zerodha in this same folder (`extractSsoId(url)` — guard with `url.includes('ssoId=')`, split on `?`, `decodeURIComponent` each pair in try/catch). Also added `onShouldStartLoadWithRequest` to intercept the redirect landing page BEFORE it loads — user no longer sees the blank callback URL. Split token exchange into standalone `processAxisCallback(ssoId)` so both hooks (`onShouldStartLoad` + `onNavigationStateChange`) share one idempotent path gated by `hasProcessedCallback`.

**(2) Upstox OAuth error message surfacing (`upstoxModal.js`, commits `c0ee009` + `06afe5f`).** When `api/upstox/update-key` returned a URL containing `error_code` / `error_message` (IP not whitelisted, `Invalid redirect_uri`, `Invalid client_id`), the fallback parser used the same brittle `new URL()` + `searchParams.get('error_message')` that silently landed in the generic fallback — users saw "check your keys" instead of e.g. `"Static IP mismatch (UDAPI1154)"`. Replaced with defensive split-on-`?` + `decodeURIComponent`-in-try-catch extracting BOTH `error_code` and `error_message`. Also: Upstox form-encodes spaces as `+` (not `%20`), which `decodeURIComponent` doesn't cover — added `s.replace(/\+/g, ' ')` before decoding so the alert renders `"Check your client_id and redirect_uri; one or both are incorrect. (UDAPI100068)"` instead of `"Check+your+'client_id'+..."`.

**(3) Dropped `.env` fallback for OAuth redirect URI (`upstoxModal.js`, `AxisConnectModal.js`, `ManageConnectionsModal.js`, commit `7f106ef`).** The resolution chain was `freshConfig → configData → Config.REACT_APP_BROKER_CONNECT_REDIRECT_URL`. The `.env` default is `app-links.alphaquark.in/broker-callback` — not registered in any advisor's Upstox / Axis dev portal, so falling back silently sent a known-bad URL that got rejected with cryptic `Invalid redirect_uri` errors. Changed to `freshConfig → configData → ''`. Empty value now fires the existing "Broker redirect URL is not configured" alert (fail-loud) instead of hitting the broker with a doomed URL. Paired with the aq_backend `/frontend-config` fix (commit `63a7a1b`) that derives the correct per-advisor URL so the empty path should never trigger in practice. Partner-OAuth brokers (Zerodha / AliceBlue / Dhan / Groww / Angel One) left alone — they use platform-level Kite-style apps so `.env` is correct for them.

**(4) Broker screen distorted on foldables / split-screen / Android 15 edge-to-edge (`SubscriptionScreen.js`, commit `ce7461d`).** `const { width: screenWidth } = Dimensions.get('window')` at module load time froze the captured width forever. On Galaxy Fold/Flip, Android split-screen / DeX / Samsung Flex Mode, and some MediaTek/Unisoc devices where RN's initial `Dimensions.get()` returns a stale dp value, the captured width diverged from the live width — styles using `screenWidth - 100` / `screenWidth - 60` rendered with a narrower content column than the physical screen. No `SafeAreaView` wrapping the root caused the Android 15 system nav bar to sit on top of scroll content (the thick black bottom band in the 2026-04-23 screenshot). Fix: wrap root in `<SafeAreaView edges={['top', 'bottom']}>` from `react-native-safe-area-context` (already at App root). Drop the frozen `screenWidth - 100` on `.button` (dead code — composed `flex: 1` already overrode it). Replace `screenWidth - 60` on `.loadingBar` with `alignSelf: 'stretch'`. Drop unused `Dimensions` import. **Scoped to this one screen**; the pattern exists in ~130 other files — will audit opportunistically as reports come in.

**Cross-repo:** Paired with backend fixes in `aq_backend_github` (`a0834c5`: Upstox update-key doesn't flip `user_broker` on error; `63a7a1b`: `/frontend-config` derives `brokerConnectRedirectUrl` from `admin → AllAdvisorDetails → subdomain-header` so every advisor gets a valid URL). tidi_new (Flutter) ported the Upstox error parser in the same session.

**Docs updated:** This CHANGELOG entry. `docs/BROKER_CONNECTION.md` Axis row already carries the 2026-04-21 WebView-parsing note.

---

## [3.9.17] - 2026-04-23

### Fixed — Groww TOTP seed capture: users were pasting the JWT-style "TOTP Token" instead of the Base32 secret below the QR

**Symptom.** User clicks "Connect Groww" → toast "TOTP Token format is off — Groww validation failed: TOTP token has non-Base32 characters." No way to recover; instructions and error message both said "TOTP Token", and so does Groww's UI.

**Root cause — field-name collision between Groww's UI and ours.** Groww's "Generate TOTP token" dialog displays two strings adjacent to the QR code:
1. A **field labelled "TOTP Token"** at the top of the dialog containing a long JWT-style value (`eyJraWQi…`). This is a Groww-internal display/activation token, contains base64url chars (`-`, `_`, digits `0/1/8/9`), and fails Base32 validation.
2. A **~32-character Base32 secret shown *below* the QR code** (e.g. `HYSRYAALJ3NPKVQH2K4VW4FQH4AKEENP`) — the actual `secret=` param encoded in the otpauth URI. A-Z and 2-7 only.

Groww's API (`POST /v1/token/api/access` per [groww.in/trade-api/docs/curl](https://groww.in/trade-api/docs/curl)) consumes a 6-digit TOTP code computed from that Base32 seed. Our backend stores the seed, computes the 6-digit code via `pyotp.TOTP(seed).now()` at daily reset. So we need the Base32 seed — NOT the JWT, NOT a one-off 6-digit code.

Our mobile UI (`GrowwConnectModal.js` + `brokerRegistry.js`) labelled its input field "TOTP Token *" and Step 2 said "Click 'Generate TOTP token' … copy the TOTP Token — shown only once" — which unambiguously points at Groww's JWT field. Error toasts also repeated "TOTP Token", so a user who pasted correctly per our instructions hit `NOT_BASE32`, read the toast ("TOTP Token format is off") and repasted the same JWT.

**Fix (UI copy + instructions only — backend validation was already correct).**
- **Field renamed**: "TOTP Token *" → **"TOTP Secret Key (Base32) *"** in `GrowwConnectModal.js` and `brokerRegistry.js`.
- **Step 2 rewrite**: contrasts the JWT top field with the Base32 secret below the QR, shows the example value `HYSRYAALJ3NPKVQH2K4VW4FQH4AKEENP` inline in monospace, explicitly says "ignore the long JWT-style 'TOTP Token' at the top".
- **Placeholder / helper**: "Paste the ~32-char Base32 secret below the QR (A–Z, 2–7)".
- **Error toasts rewritten** for `NOT_BASE32`, `WRONG_LENGTH`, `GROWW_REJECTED`, `INVALID_SEED` — each now names the Base32 seed unambiguously, with the "NOT_BASE32" case diagnosing the most common failure ("you likely pasted the JWT — we need the Base32 secret below the QR").
- **`refreshGrowwSession`** (`src/utils/growwRefresh.js`) — two alerts (`NO_TOTP_SEED`, `INVALID_SEED`/`GROWW_REJECTED`) updated with the same seed-vs-JWT disambiguation.
- **Two new text styles** (`boldText`, `monoText`) in `GrowwConnectModal` to highlight the key distinction inside Step 2.

**Docs:**
- `docs/BROKER_CONNECTION.md` — new section § Groww TOTP seed capture — which value to paste, with a side-by-side table of the two strings Groww's dialog displays. Also corrected the Per-Broker-Details row to say "Base32 seed" instead of "TOTP Token".

**Files:**
- `src/components/BrokerConnectionModal/GrowwConnectModal.js`
- `src/utils/growwRefresh.js`
- `src/config/brokerRegistry.js`
- `docs/BROKER_CONNECTION.md`

**Cross-repo porting required.** This copy lives identically in the web app (`../prod-alphaquark-github`) and the Flutter app (`../tidi_new`). Both need the same UI-copy fix or web/Flutter users will hit the same trap. Tracked for same-day port.

**Backend:** no changes. ccxt-india `app_groww.py:_normalize_totp_token` validation is correct as-is.

---

## [3.9.16] - 2026-04-23

### Fixed — Upstox service-window false "Login to {broker}" + slow Trade Now + invisible cart UX + DDPI-help popup regressions

Four user-reported regressions in one commit cycle.

**1. Upstox 12:00–05:30 IST maintenance window incorrectly forced re-login.** Both the bespoke "Trade Now" and basket/cart handlers gated on a raw `funds?.status === 1 || funds?.status === 2 || funds === null` check. During Upstox's nightly funds-service outage, ccxt responded either `{status: 1, message: "Service is accessible from 5:30 AM..."}` (caught by the existing `isTransientFundsError` keyword match) OR `{status: 2, message: undefined}` (no match possible — no distinguishing signal in the body). The raw check treated both as "token expired" and re-popped the auth modal even though `connect_broker_status` was still `'connected'`.

  - Replaced every raw `funds.status === 1 || ...` check in `StockAdvices.js` (5 sites: `handleTrade`, `handleTradeBasket`, `handleSingleSelectStock`, `placeOrder`, `handleConnectAndPlaceOrder`), `AddtoCartModal.js` (`handleTrade`), and `RebalanceCard.js` (`handleCheckBroker` — the sibling of `handleCheckStatus` which was already correct) with `isFundsErrorOrMissing(funds, brokerStatus, broker)`. All of those now go through the transient-aware helper uniformly.
  - `isTransientFundsError(resp, broker)` now takes the broker name and — scoped to Upstox only — returns `true` for any `status: 1` or `status: 2` response during 12:00–05:30 IST. `isInUpstoxMaintenanceWindow()` shifts `Date.now()` by +5:30 and reads UTC hours, so it works irrespective of the device's local timezone. Broker-scoped so a genuinely expired Zerodha token at 3 AM IST still correctly triggers re-login.
  - All call sites updated to pass `broker` as the third arg of `isFundsErrorOrMissing`.

**2. Trade Now was slow (2×~2s network calls).** `useRefreshBrokerStatus` previously serialized `GET /api/user/getUser/{email}` → `fetchFunds(...)`. The context usually already held a fresh connected broker + live funds — no network call was needed.

  - Added a **fast path**: if `brokerStatus === 'connected'` and `funds.data.availablecash` is present, return context values instantly without hitting the network.
  - Cold path now fires both requests in **parallel** via `Promise.all`, using context credentials for the optimistic fetchFunds; a second serialized fetchFunds only kicks in if `getUser` revealed the broker changed mid-flight (rare — e.g. disconnect from another device).
  - Hot path: instant. Cold path: ~2s (was ~3.5s).

**3. Add-to-Cart had no visible cart.** The `ShoppingCart` icon was imported in `CustomToolbar.js` but never rendered; the only cart affordance was the bottom `Trade (N)` bar inside `StockAdviceContent` which scrolled off-screen with the list. Users hit "Add to Cart" and got zero feedback or persistent indicator.

  - Wired the `ShoppingCart` icon into the top toolbar next to the Bell, with a red badge showing `cartCount` (`99+` cap). Tap → existing `AddToCartModal` tray.
  - `CartContext` now self-syncs: subscribes to the `cartUpdated` event, re-reads `AsyncStorage.cartItems` on every emit, and exposes the live count. No caller needs to `setCartCount` manually — every Add/Remove in `StockAdvices.handleSelectStock` already emits `cartUpdated`, so the badge is always accurate.
  - Toast feedback on Add (`Added to cart — AAPL · 3 items in cart`) and Remove (`Removed from cart — AAPL · 2 items left`). Cheap but important because the toolbar icon can scroll out of frame on long lists.

**4. Cart tray "not opening".** The 100px-tall cart bottom sheet (rendered in `Navigation.js`) was actually animating in — but `getBottomSheetPosition` only subtracted the tab-bar height from `screenHeight`, leaving most of the 100px body tucked *behind* the tab bar (which wins zIndex 99 vs sheet's 98). Users saw at most a thin sliver peeking above the tab bar — indistinguishable from "nothing happened".

  - `getBottomSheetPosition` now subtracts `CART_SHEET_HEIGHT` as well, so the entire 100px sheet sits above the tab bar.

**5. DDPI help modal UX fixes** (follow-up from [3.9.15]):
  - Converted from bottom-sheet → centered card popup (`borderRadius: 16`, `maxWidth: 460`, `maxHeight: 85%`). The help sheet is informational content, not a persistent bottom-sheet drawer.
  - Added three closable paths: (a) tap backdrop, (b) X button in header, (c) Android hardware back — the back-handler closes the stacked WebView first if open, else the whole modal.
  - When the in-app WebView sub-overlay is open, the header now has both a back arrow (returns to steps) AND a full X close (dismisses the whole help modal) so users coming from "Retry sell order" can close and resume the retry flow in one tap instead of two.

**Files:**
- `src/hooks/useRefreshBrokerStatus.js` — fast path + parallel network.
- `src/utils/rebalanceHelpers.js` — `isTransientFundsError(resp, broker)`, Upstox-scoped maintenance-window guard, `isFundsErrorOrMissing(f, s, b)`.
- `src/UIComponents/RebalanceAdvicesUI/RebalanceCard.js` — `handleCheckBroker` routed through `isFundsErrorOrMissing`.
- `src/components/AdviceScreenComponents/StockAdvices.js` — 5 raw-check sites replaced + Toast feedback on add/remove.
- `src/components/AdviceScreenComponents/AddtoCartModal.js` — raw-check replaced with `isFundsErrorOrMissing`.
- `src/components/AdviceScreenComponents/RebalanceAdvices.js` — broker arg passed to `isFundsErrorOrMissing`.
- `src/components/CartContext.js` — self-syncing via `cartUpdated` event.
- `src/components/CustomToolbar.js` — cart icon + badge.
- `src/components/Navigation.js` — bottom-sheet geometry fixed.
- `src/components/BrokerDdpiHelpModal.js` — centered popup, 3 close paths, `Pressable` backdrop, `BackHandler` on Android.

**Still-open gaps (same class, different surface):** `UserStrategySubscribeModal.js:213`, `MPPerformanceScreen.js:640`, `BespokePerformanceScreen.js:548`, `IgnoreTradesScreen.js:1441` — raw `funds.status === 1 || …` pattern. Port if the symptom recurs there.

---

## [3.9.15] - 2026-04-23

### Fixed — DDPI help module: broken URLs + external-browser CTA replaced with closable in-app WebView + fresh-funds gate extended to basket & bespoke

**Broken DDPI URLs.** 9 of the 13 broker entries in `src/config/brokerDdpiHelp.js` shipped with URLs that 404'd, 500'd, or redirected to login/error pages. Verified all 13 via curl with full Chrome UA; replaced the bad ones:

| Broker | Old URL | New URL |
|---|---|---|
| Zerodha | `support.zerodha.com/category/account-opening/...activate-ddpi` | `support.zerodha.com/category/your-zerodha-account/your-profile/ddpi/articles/activate-ddpi` (followed the real 2xx redirect target) |
| Upstox | `help.upstox.com/support/solutions/articles/260000008762-what-is-ddpi-` (500) | `upstox.com/help-center/t-260205/` |
| Fyers | `fyers.in/support/solutions/articles/103000114524-...` (404) | `support.fyers.in/portal/en/kb/articles/how-do-i-activate-ddpi-on-fyers-online-and-offline` |
| Dhan | `knowledge.dhan.co/support/solutions/articles/82000900258-...` | `dhan.freshdesk.com/support/solutions/articles/82000900258-from-where-ddpi-service-can-be-activated-` (real origin) |
| AliceBlue | `aliceblueonline.com/support/account-opening/ddpi-activation-guide/` | `wp.aliceblueonline.com/support/account-opening/ddpi-activation-guide/` (real origin; the bare domain 3xx's here anyway) |
| ICICI Direct | `icicidirect.com/customerservice/questions-detail/what-is-ddpi` (redirects to login) | `icicidirect.com/faqs/my-account/how-can-i-activate-ddpi-with-icici-securities` |
| HDFC Securities | `null` | `hdfcsec.com/Products/FAQ/2633` (live FAQ; self-serve DDPI flow is still form-based but this gives users a landing page) |
| IIFL Securities | `indiainfoline.com/customer-service/customer-service-faqs` (404) | `indiainfoline.com/knowledge-center/demat-account/demat-debit-and-pledge-instruction` |
| Motilal Oswal | `motilaloswal.com/blog-details/What-is-a-Demat-Debit-and-Pledge-Instruction-...` (404) | `motilaloswal.com/learning-centre/2025/1/what-is-ddpi-the-role-of-demat-debit-and-pledge-instructions` |
| Kotak Securities | `kotaksecurities.com/faqs/demat-account/what-is-ddpi/` (redirects to 404) | `kotakneo.com/investing-guide/share-market/what-is-ddpi/` |
| Axis Securities | `simplehai.axisdirect.in/help-and-support/demat-account` (redirects to /error) | `simplehai.axisdirect.in/544-faqs-ri/demat-account/6396-what-is-demat-debit-pledge-instruction-ddpi-how-to-download-it` |
| Groww | `groww.in/p/ddpi` (404) | `groww.in/help/stocks,-f&o,-ipo-&-mtf/searchable/how-can-i-opt-for-ddpi--60` |

Angel One's old URL was already correct.

**Why the old URLs rotted.** Fresh-desk sub-domains renamed (Dhan, Fyers), WP origin domains exposed (AliceBlue), FAQ hubs restructured (ICICI, Kotak, Motilal), Cloudflare error pages behind redirects (Axis), Upstox migrated from Freshdesk-style article IDs to shorter `/t-XXXXXX/` slugs, Groww replaced their `/p/ddpi` vanity page with a help-center searchable path. All verified 200 via curl with a realistic Chrome UA; ICICI and HDFC block the default curl UA (return 404) but render correctly in an in-app WebView with the mobile Chrome UA string.

**In-app WebView replaces `Linking.openURL`.** The "Open {broker}'s DDPI page" CTA previously kicked the user out to Chrome — bad UX generally, worse when the destination was broken. `src/components/BrokerDdpiHelpModal.js` now stacks a second closable overlay on top of the help sheet that renders the broker's DDPI page in a `react-native-webview`. Header has a back arrow (returns to the help sheet), the broker name, and an external-browser escape hatch (still uses `Linking.openURL` so users who prefer Chrome aren't blocked). WebView sets a desktop-Chrome-ish UA on Android so pages that 404 to the default Android WebView UA render correctly.

**Fresh-funds gate extended to basket and bespoke surfaces.** [3.9.11] fixed `RebalanceCard.js`; [3.9.14] fixed `RebalanceAdvices.js`. Same class of bug (closure-bound `funds` / `brokerStatus` re-popping the TokenExpire modal right after a successful reconnect) was still live on two other entry points that the user surfaced:

- **Basket** (`src/components/AdviceScreenComponents/AddtoCartModal.js:handleTrade`) — the `isFundsEmpty` pre-check across Zerodha / Fyers / default-broker branches now reads `freshStatus.funds ?? funds` / `freshStatus.brokerStatus ?? brokerStatus` via the new shared hook.
- **Bespoke** (`src/components/AdviceScreenComponents/StockAdvices.js`) — three handlers touched: `handleTrade` (line ~1565, previously refetched only user), `handleTradeBasket` (line ~1704, had no refresh at all), `handleSingleSelectStock` (line ~2308, previously refetched only user). All three now shadow `broker` / `brokerStatus` / `funds` from `refreshBrokerStatus()` output before any downstream branch reads them.

**Shared hook extraction.** Rather than a 4th copy-paste of the refresh-user-then-refresh-funds helper, extracted the logic to `src/hooks/useRefreshBrokerStatus.js`. Returns `{brokerStatus, broker, userDetails, funds}`; hit-counts internal `getUserDeatils()` so context also converges on the next render. `RebalanceCard.js` and `RebalanceAdvices.js` refactored to use the shared hook (deleted their local duplicates).

**Files:**
- `src/config/brokerDdpiHelp.js` — URL replacements.
- `src/components/BrokerDdpiHelpModal.js` — in-app WebView overlay, back arrow, external-browser escape, Android desktop UA.
- `src/hooks/useRefreshBrokerStatus.js` (new) — shared hook.
- `src/UIComponents/RebalanceAdvicesUI/RebalanceCard.js` — swap local helper → shared hook.
- `src/components/AdviceScreenComponents/RebalanceAdvices.js` — swap local helper → shared hook.
- `src/components/AdviceScreenComponents/AddtoCartModal.js` — add hook + use fresh state in `handleTrade`.
- `src/components/AdviceScreenComponents/StockAdvices.js` — add hook + use fresh state in `handleTrade`, `handleTradeBasket`, `handleSingleSelectStock`.

**Still-known gaps (not this PR):** `UserStrategySubscribeModal.js:213`, `MPPerformanceScreen.js:640`, `BespokePerformanceScreen.js:548`, `IgnoreTradesScreen.js:1441` — same `funds.status === 1 || ...` pattern, different surface. Port when those surfaces show the symptom.

---

## [3.9.14] - 2026-04-22

### Fixed — "Login to {broker}" modal re-pops on Home screen Rebalance tap after successful reconnect (RebalanceAdvices closure-bound funds)

**Symptom.** Right after connecting Upstox (e.g. from settings or the broker-selection modal), tapping Rebalance on a Portfolio Recommendation card on Home re-opened the `TokenExpireBrokerModal` ("Authentication Required — Login to Upstox") even though the broker was already connected and the access token valid.

**Root cause.** The known remaining gap called out in [3.9.11] (`src/components/AdviceScreenComponents/RebalanceAdvices.js:682`). After [3.9.10]/[3.9.11] fixed `RebalanceCard.js`, this second entry point still ran `isFundsErrorOrMissing(funds, brokerStatus)` against the **closure-bound context values**. Immediately after a broker reconnect, `TradeContext.setFunds` has committed but this parent component hasn't re-rendered before the handler runs — closure still holds the pre-reconnect `{status:1}` (or `null`) funds object while `brokerStatus` has already flipped to `'connected'`. Helper returns `true` → `setOpenTokenExpireModel(true)` → modal re-pops.

**Fix.** Ported the same `refreshBrokerStatus` pattern from `RebalanceCard.js`:
- Added `fetchFunds` import.
- Added a local `refreshBrokerStatus` helper that re-fetches the user via `api/user/getUser/{email}` and calls `fetchFunds` inline with the just-fetched user object, returning `{brokerStatus, broker, funds}`.
- Replaced the `handleAcceptRebalance` pre-check so the funds/status read happens against **network-fresh values**; closure `funds` / `brokerStatus` are only the fallback when the refresh call errors.

**Files:** `src/components/AdviceScreenComponents/RebalanceAdvices.js` (import + helper + updated pre-check at the former line 682).

**Remaining known gaps with the same class of bug (not triggered by the user's current flow, flagged for future):**
- `src/components/AdviceScreenComponents/AddtoCartModal.js:381,433,443` — same stale `funds?.status === 1 || ... || null` pattern across Zerodha / Fyers / default-broker branches. Cart flow is user-action gated so less likely to self-fire right after a reconnect, but the pattern is identical. Apply the same fix if the symptom recurs there.
- `src/components/ModelPortfolioComponents/UserStrategySubscribeModal.js:213`, `src/screens/Drawer/MPPerformanceScreen.js:640`, `src/screens/Drawer/BespokePerformanceScreen.js:548`, `src/screens/Drawer/IgnoreTradesScreen.js:1441` — same class. Not audited in this PR.

---

## [3.9.13] - 2026-04-23

### Added — Reusable DDPI/EDIS help module (config + modal + global-store wiring)

Centralized the "how to activate DDPI" nudge so every surface that encounters a sell-authorization error, EDIS prompt, or manual-authorize screen can invoke the same, content-rich, per-broker help modal with one function call.

**Motivation.** DDPI activation guidance was previously:
- Hardcoded inline in `ManualSellModal.js` (ICICI-only, ignored other brokers)
- Duplicated across three separate `brokerInstructions` maps inside `DdpiModal.js`
- Missing entirely for 8 brokers (Upstox, ICICI Direct, Fyers, IIFL, Motilal, Axis, Groww, Kotak was partial)
- Had a copy-paste bug (Dhan entry said "Log in to your IIFL account")
- Never nudged users on brokers with online EDIS (Angel One, Dhan) — those users kept hitting the per-day EDIS friction with no path to the one-time DDPI upgrade

**New module.**

| File | Role |
|---|---|
| `src/config/brokerDdpiHelp.js` | Per-broker registry. All 14 brokers covered. Schema: `{title, intro, steps[], directLink, portalUrl, hasOnlineEdis, customerCare?, videoId?}`. Exports `getBrokerDdpiHelp(broker)` with case-insensitive lookup. |
| `src/components/BrokerDdpiHelpModal.js` | Reusable bottom-sheet. Renders title + persuasive broker-specific intro + optional EDIS callout (conditional on `hasOnlineEdis: true`) + numbered step list + customer-care contact footer + primary CTA ("Open {broker}'s DDPI page") + dismiss. Pure consumer of the config. |
| `src/GlobalUIModals/ModalManager.js` | Registered as `case 'DdpiHelp'`. Payload: `{broker: '<name>'}`. |
| `src/components/ManualSellModal.js` | Replaced hardcoded ICICI-only text with broker-aware copy + prominent green nudge row that calls `openModal('DdpiHelp', {broker})`. Accepts `broker` prop (default `'ICICI Direct'` for backward compat with existing callsites). |
| `src/components/DdpiModal.js` | Added the same green nudge row below the "authorize manually" text so users on the DDPI modal can jump directly to the activation guide for their broker. |

**Persuasion-first content**, not a dry instruction list:

- Every broker's `intro` explains what DDPI is in one sentence AND why this user should activate it right now (*"without it, every sell you place here will require a per-session TPIN prompt on the broker's site, which often fails from third-party apps"*).
- For Angel One and Dhan (online-EDIS brokers), the modal renders an additional *"Why DDPI even though {broker} has online EDIS?"* callout — acknowledges EDIS works but pitches DDPI as the one-time upgrade that removes the per-day friction. Without this nudge, those users skip DDPI assuming it's unnecessary and come back with the same issue next rebalance cycle.
- For HDFC Securities (no self-serve DDPI flow), `directLink: null` and the customer-care email/phone are surfaced instead — CTA becomes "Open HDFC's portal". Honest degradation.

**Docs.** New "DDPI/EDIS Help module" section added to `docs/BROKER_CONNECTION.md` covering module layout, invocation patterns, persuasion-copy design choices, consumer surfaces, the "when adding a new broker" checklist, and explicit tech debt (three inline `brokerInstructions` maps still inside `DdpiModal.js` at lines ~886/1799/2180 — deferred to a follow-up PR since that file is 2685 lines with pre-existing eslint issues).

**Cross-repo follow-up**: port the same pattern to tidi_new (Flutter). Not in this PR.

---

## [3.9.12] - 2026-04-23

### Fixed — Kite publisher multi-layer fix: scripmaster / LTP fallback / MARKET-protection centralization

End-to-end fix for Zerodha publisher basket orders failing or mis-routing. Four distinct bugs, all shipped together because they share the `/zerodha/convert-symbol` → `applyKiteMarketProtection` pipeline.

#### 1. Per-broker scripmaster disambiguation (Zerodha + HDFC) — wrong-security risk class

Two distinct scripmasters had the same class of bug — `fetchone()` returning whichever row SQLite's B-tree yielded first when multiple rows shared the lookup key. Different data, same class.

**Zerodha**: INFY-EQ → NIFTY TOP 20 EW

`brokers/zerodha/zerodha_scrip_master.py: get_zerodha_symbol_from_angelone_symbol()` SQL was:

```sql
SELECT tradingsymbol FROM zerodha_scrip_data WHERE exchange_token = ? AND exchange = ?
```

Zerodha's scripmaster carries **multiple rows with the same `(exchange_token, exchange)`** — one for the tradable equity (`segment='NSE'`) and one for an index composition marker (`segment='INDICES'`). SQLite's `fetchone()` picked whichever came first in the B-tree — in practice the INDICES row. Consequence: `INFY-EQ` resolved to `NIFTY TOP 20 EW` (an unrelated ETF) and orders would have gone to the wrong security or been rejected. Audit found dozens of other `(exchange_token, NSE)` pairs with the same collision pattern.

Fix: added `AND segment = ?` with exchange as the third bind arg (NSE/BSE rows have `segment = exchange`; INDICES rows have `segment = 'INDICES'`). Belt-and-braces fallback query uses `segment != 'INDICES'` if the strict match returns nothing. Single WHERE-clause fix corrects every collision simultaneously.

Verification: `INFY-EQ` before → `NIFTY TOP 20 EW`. After → `INFY`. Other 6 representative symbols (ADARSHPL, GTLINFRA-EQ, VIKASECO-EQ, TCS-EQ, RELAXO-EQ, INFRAIETF-EQ, JIOFIN-EQ) unchanged (were already correct).

**HDFC**: equity tokens collided with currency futures on the same `exch_security_id`

`brokers/hdfc/hdfcsec_scrip_master.py: get_hdfcsec_symbol_from_angelone_symbol()` had `WHERE exch_security_id = ? AND exchange = ?` — which could match TWO rows, one equity (`instrument_segment='EQUITY'`) and one currency future (`instrument_segment='FUTCUR'`). E.g. token 1011 on NSE resolves to BOTH SCHAEFFLER (equity) AND EURINR (FUTCUR). SCHAEFFLER equity orders could silently have been placed on EURINR currency futures.

Fix: disambiguate by the original AngelOne segment — for NSE/BSE equity lookups, filter `instrument_segment = 'EQUITY'`; for NFO/BFO/CDS/MCX, filter to the matching derivative types. Belt-and-braces fallback drops the filter if strict match returns nothing, logging for audit.

**Audit across other broker scripmasters** (performed 2026-04-23): ICICI (schema keyed on `ExchangeCode + Series` — naturally unique), AliceBlue, Upstox, Fyers, Dhan, Groww, Motilal, IIFL, Axis — all confirmed SAFE. Their lookup code already includes the correct disambiguator (e.g. Axis: `AND segment = 'EQ'`; Upstox: `AND instrument_type` filter in the broker module). Only Zerodha and HDFC were missing the segment filter. Documented in `docs/BROKER_CONNECTION.md § Per-broker scripmaster disambiguation`.

#### 2. `/zerodha/convert-symbol` returns `ltp: null` for BSE-primary stocks

`apps/app_zerodha.py: _get_cached_ltp()` reads from Redis DB 11 where the websocket server (`servers/server2/websocket`) writes `ltp:{EXCH}:{SYMBOL}` keys. Only symbols in some user's active subscription pool get written — BSE-primary stocks that aren't actively ticked never appear, so the cache returns None. Consequence: `applyKiteMarketProtection` falls through to plain MARKET and Kite rejects GSM/T2T/BE stocks.

Fix: added `_live_fetch_ltps(fetch_specs)` which does a single batched live Angel One market-data call for Redis-miss symbols, merges the response back into the `results` array. Silent best-effort — if the live fetch fails the `ltp` stays `null` and the client falls through to the existing behaviour. One extra round-trip (~200–500ms) per `/zerodha/convert-symbol` call if ANY symbol missed Redis.

Verification: VIKASECO LTP now populates via the live-fetch fallback even when Redis is cold.

#### 3. Centralized MARKET→LIMIT conversion across ALL equity brokers

`brokers/market_order_conversion.py` is now the single source of truth for every broker's MARKET-order protection:

| Broker | Before | After |
|---|---|---|
| ICICI | Used shared helper ✓ | Unchanged |
| AliceBlue | Used shared helper ✓ | Unchanged |
| Zerodha | Rejected MARKET silently; no protection | Uses shared helper (`compute_ioc_limit_price`, `converted_validity_for_exchange`, `fetch_ltp_for_symbol`) |
| Motilal Oswal | Had its own MARKET→LIMIT but used LTP as-is (no buffer, no tick rounding) | Keeps its fast Redis-cached LTP source but delegates buffer+tick math to the shared helper |

Tick schedule updated to the Kite-compatible buckets (`₹0.10` < ₹500, `₹0.20` for ₹500–5000, `₹0.50` > ₹5000) — replaces the old `₹1.00 above ₹5000, else ₹0.10` which was Kite-incompatible in the ₹500–5000 band. Kite's ticks are a strict superset of ICICI/AliceBlue's, so the change tightens without regressing either. Mirrors the client-side `src/utils/brokerPublisher.js: roundToKiteTick`.

Tiered buffer (0.3% / 0.5% / 1.0% by LTP) unchanged.

The shared helper's top-of-file docstring now prescribes the template every new equity broker's `place_order` should follow. Derivatives (NFO/BFO) skip the conversion because exchange-level MARKET handling is correct for options/futures.

#### 4. Client-side UI: `useZerodhaSymbolMap` hook + `resolveZerodhaSymbol` + `roundToKiteTick` + 6 publisher callsites

- `src/utils/brokerPublisher.js` — fixed 3 latent bugs in `convertSymbolsToZerodha` (wrong imports, wrong auth header, wrong response-shape unwrap) so the helper actually works. Added `resolveZerodhaSymbol(stock, symbolMap)` and `roundToKiteTick(price)`. `applyKiteMarketProtection` now snaps the buffered price to the same Kite tick schedule as the server.
- `src/hooks/useZerodhaSymbolMap.js` (new) — React hook that fetches the scripmaster map on advice-symbol-list change. Memoized.
- 6 Zerodha publisher basket builders wired: `ReviewZerodhaTradeModal`, `UserStrategySubscribeModal`, `MPReviewTradeModal`, `RebalanceModal`, `StockAdvices`, `AddtoCartModal`. Each calls `useZerodhaSymbolMap` + uses `resolveZerodhaSymbol` for outgoing `tradingsymbol`/`exchange` in the Kite basket POST. LTP precedence: live-ws on resolved symbol → live-ws on raw symbol → server-cached `ltp` from `/zerodha/convert-symbol`.
- `RebalanceModal.js: getLTPForSymbol` wrapper also consults the scripmaster map in the priority chain, so the Step-3 review UI's "Current Price" column shows the scripmaster-provided LTP for BE/BSE-primary stocks instead of ₹0.

### Deploy ordering

All backend changes are live on tidi (ccxt-india restarted 22:21 UTC). Mobile JS changes take effect on next Metro reload / APK rebuild. Backend is forward-compatible with older clients.

### Remaining follow-up (deferred)

- 5 of 6 mobile publisher callsites still pass raw `stock.exchange` to `useWebSocketCurrentPrice`. For BE/BSE-primary stocks the live websocket won't emit; the scripmaster cached LTP covers the MARKET-protection path but the review UI may briefly show ₹0 until the cache arrives. Only `RebalanceModal` subscribes with the resolved exchange today. Non-blocking — fix in a later pass.
- Motilal's redis-LTP cache is a different key format than the shared helper — functional but not unified. No action needed today.

---

## [3.9.11] - 2026-04-23

### Fixed — "Login to {broker}" re-pops on first Retry Rebalance tap after successful reconnect (RebalanceCard closure-bound funds)

**Symptom.** User re-auths ICICI Direct → "Connected Successfully" → taps Retry Rebalance → "Login to ICICI Direct" appears *again*. Wait 10 seconds, tap again, works. Repro-rate: ~every first tap immediately after reconnect.

**Root cause.** Even after [3.9.10] made `fetchBrokerStatusModal` eagerly refresh funds in `TradeContext`, `RebalanceCard.handleCheckStatus` / `handleCheckBroker` (`src/UIComponents/RebalanceAdvicesUI/RebalanceCard.js:234,599`) still read the **closure-bound `funds` prop** that the parent passes down. Between the reconnect and the next Retry Rebalance tap, TradeContext's `setFunds` has committed but the parent `RebalanceAdvices` hasn't re-rendered *before* the handler runs — so the closure still holds the pre-reconnect `{status:1}` object. `isFundsErrorOrMissing` trips → `setOpenTokenExpireModel(true)` → TokenExpire modal re-opens despite the broker actually being connected.

**Fix.** Extended `refreshBrokerStatus` (same file, line 93) to also fetch funds inline with the just-fetched user object and return them alongside `brokerStatus` / `broker` / `userDetails`. Updated both `handleCheckStatus` (line ~234) and `handleCheckBroker` (line ~599) to read `freshStatus.funds ?? funds` instead of closure `funds` — network-fresh value wins, closure prop is only the fallback on fetch error. Falls back gracefully if the funds endpoint is flaky (same behaviour as before, just with the stale reference narrowed to the error path).

**Files:** `src/UIComponents/RebalanceAdvicesUI/RebalanceCard.js` (added `fetchFunds` import; extended `refreshBrokerStatus`; tweaked both handlers).

**Known remaining gap.** `src/components/AdviceScreenComponents/RebalanceAdvices.js:682` has the same closure-bound `funds` read in its own check path. Not touched here because it's a different entry point (not hit by HomeScreen's Retry Rebalance button). If the symptom recurs from a different surface, apply the same pattern.

---

## [3.9.10] - 2026-04-23

### Fixed — "Login to Zerodha" loop after successful OAuth reconnect; Groww mid-trade now one-tap refreshes

**Symptom 1 (loop).** User taps Retry Rebalance → "Login to Zerodha" appears → reconnects Zerodha → "Connected Successfully". User taps Retry Rebalance again → "Login to Zerodha" re-appears. Forever.

**Root cause.** `fetchBrokerStatusModal` in `src/screens/TradeContext.js` refreshed `userDetails` but relied on the `useEffect([userDetails, configData])` at line 1236 to trigger `getAllFunds()`. That effect gates on the **stale** `broker` state variable (not a dep), and `getAllFunds` closes over a `userDetails` snapshot that may not be committed when it runs. Result: `funds` stayed at its pre-reconnect value (likely `null` or `{status:1}`). On the next Retry Rebalance tap, `RebalanceCard.handleCheckStatus` (`src/UIComponents/RebalanceAdvicesUI/RebalanceCard.js:200-216`) called `refreshBrokerStatus()` (OK — returned `connect_broker_status:'connected'`), then hit the second door: `isFundsErrorOrMissing(funds, currentBrokerStatus)` returned `true` because funds was stale → `setOpenTokenExpireModel(true)` re-fired. Broker was actually connected; client-side funds state just hadn't caught up.

**Fix.** Rewrote `fetchBrokerStatusModal` (`src/screens/TradeContext.js:1013-1060`) to await `getUserDeatils()`, **then synchronously call `fetchFunds` with the fresh user object** it returned — bypassing the stale-closure / ref-equality pitfalls of the `useEffect`. Every OAuth broker (Zerodha / Dhan / Angel One / AliceBlue / Axis / Fyers / Upstox / ICICI / HDFC / Motilal) benefits because they all call `fetchBrokerStatusModal` via `commonProps` in `ModalManager` after their `connect-broker` save.

### Changed — Groww mid-trade session-expiry: one-tap refresh instead of credential form

**Symptom 2.** When a Groww user hit a mid-trade "Login to Groww" modal and tapped it, our [3.9.9] fix opened the full `GrowwConnectModal` (4-step credential-paste form). That's wrong — Groww stores a TOTP seed server-side (AES-256 at rest), so `POST /api/groww/refresh-token` can mint fresh tokens silently. `TokenExpireBrokerModal.handleGrowwRefresh` already does exactly this; the mid-trade `BrokerSelectionModal` path was the exception.

**Fix.** Added a Groww-specific branch to `BrokerSelectionModal.handleBrokerSelectOpenExpire` (`src/components/BrokerSelectionModal.js`) that calls `refreshGrowwSession` directly. Falls back to `openModal('Groww')` only on `NO_TOTP_SEED` / `INVALID_SEED` (legacy customers without a stored seed, or a key revoked on Groww's dashboard). Success path re-hydrates state via `fetchBrokerStatusModal` + `refreshEvent` emit so the next Retry Rebalance tap isn't caught by Symptom 1's funds-stale trap. Button label and security-note copy now switch to "Refresh Groww session" / "Takes about 2 seconds, no credentials needed" when `broker === 'Groww'`, and an `ActivityIndicator` replaces the arrow icon while refreshing.

**Files:**
- `src/screens/TradeContext.js:1013-1060` — `fetchBrokerStatusModal` now eagerly refreshes funds with the fresh user object.
- `src/components/BrokerSelectionModal.js` — added `refreshGrowwSession` + `eventEmitter` imports; pulled `fetchBrokerStatusModal` + `showModalAlert` out of hooks; added Groww branch to `handleBrokerSelectOpenExpire`; Groww-specific button label / security note / loading spinner.

---

## [3.9.9] - 2026-04-23

### Fixed — Mid-trade session-expiry modal: "Login to ICICI Direct" (+ 4 other brokers) silently no-opped AND re-opened the full credential form instead of the smart OAuth WebView

**Symptom.** User clicks "Retry Rebalance" on an MP with an expired broker session → "Authentication Required / Login to ICICI Direct" modal appears → tapping the button either (a) did nothing at all, or (b) opened the full ICICI credential form asking for API Key + Secret again even though credentials were already saved. Correct behaviour is the same smart-reauth flow `ManageConnectionsModal` uses — jump straight into the OAuth WebView with stored creds.

**Root causes — two separate bugs in the same handler.**

1. **Key mismatch → silent no-op.** `BrokerSelectionModal.handleBrokerSelectOpenExpire` passed raw `userDetails.user_broker` (e.g. `'ICICI Direct'`) into `useModalStore.openModal()`. `GlobalUIModals/ModalManager.js` dispatches on a `switch (visibleModal)` whose cases use the shorter modal key (`'ICICI'`, `'HDFC'`, `'Motilal'`, `'Kotak'`, `'Angel One'`). Any unmatched key hit `default: return null` — zero visible feedback. Five `user_broker` values affected: `ICICI Direct` → `ICICI`, `Kotak Neo` → `Kotak` (written by `KotakModal.js:162`), `Hdfc Securities` → `HDFC`, `Motilal Oswal` → `Motilal`, `AngelOne` (alt writer) → `Angel One`.

2. **Bypassed the smart-reauth router.** Even once the key-mismatch was fixed, `openModal('ICICI')` just opens the stock `ICICIUPModal` with an empty credential form — the pre-signed-OAuth-URL shortcut from `src/utils/reauthHelpers.js:handleSmartReauth` was never invoked. Web (`subscription.js:handleCredentialReauth`) and mobile `ManageConnectionsModal.handleReconnect` both go through this router; `BrokerSelectionModal` was the odd one out.

**Fix.** Rewrote `handleBrokerSelectOpenExpire` to call `flipPrimaryBroker` + `handleSmartReauth` first. For credential brokers (Upstox/ICICI Direct/Hdfc Securities/Motilal Oswal/Fyers) the backend `/reauth-url` returns a pre-signed OAuth URL, stored creds are decrypted locally, and the per-broker modal opens with `modalPayload.reauthConfig` so it skips the credential form entirely (its existing hydration `useEffect` picks it up and jumps straight to the WebView). For partner-OAuth / Kotak TOTP / Groww / anything that returns `requiresForm` or `requiresTotp`, falls back to `openModal(modalKey)` where `modalKey` is resolved via the new `USER_BROKER_TO_MODAL_KEY` lookup (fixing bug #1). Modal unmount is sequenced before `openModal` with a 100ms setTimeout so Android doesn't swallow the second transparent Modal — matches the pattern documented in `reauthHelpers.js:167`.

**Files:** `src/components/BrokerSelectionModal.js` (added `useConfig` + `handleSmartReauth`/`flipPrimaryBroker` imports; pulled `configData` + `userDetails` out of `useTrade`; rewrote `handleBrokerSelectOpenExpire`).

---

## [3.9.8] - 2026-04-23

### Fixed — Kite publisher basket: BE-series / BSE-primary stocks silently dropped (VIKASECO)

**Symptom.** A Zerodha publisher rebalance included VIKASECO-EQ and it showed up in the Kite basket with `order_type: MARKET, price: 0`. Kite rejects plain MARKET orders on GSM/T2T/BE stocks and silently drops BSE-primary symbols sent to NSE. User-visible outcome: mysterious partial basket with no broker-side reason.

**Root causes.**

1. `convertSymbolsToZerodha()` in `src/utils/brokerPublisher.js` has been **broken since inception** — (a) imports `Config from './Config'` (local APP_VARIANTS) instead of `react-native-config`, so `Config.AQ_KEY` was always undefined; (b) uses `Bearer` auth header but the backend route `/zerodha/convert-symbol` decorator is `@validate_token` which expects `aq-encrypted-key`; (c) dereferences `ccxtServer` as a named import from `serverConfig` but that file default-exports `server`, so the URL resolved to `"undefined/zerodha/convert-symbol"` → every request 404'd. Zero callers used it anyway (grep: no hits), so the bug was invisible.
2. The 6 Zerodha basket builders (`ReviewZerodhaTradeModal.js`, `UserStrategySubscribeModal.js`, `MPReviewTradeModal.js`, `RebalanceModal.js`, `StockAdvices.js`, `AddtoCartModal.js`) all built the basket with raw `stock.tradingSymbol` + `stock.exchange`. No scripmaster consultation. So a stock tagged `VIKASECO-EQ` on NSE in tradeReco was sent to Kite as exactly that, even though the NSE scripmaster no longer has it — Kite silently drops.
3. `useWebSocketCurrentPrice` subscribes `-EQ` / `-BE` / `-SM` / `-ST` symbols to NSE with no BSE fallback. If VIKASECO moved to NSE-BE (trade-to-trade) or to BSE-only, the NSE feed emits nothing → `getLTPForSymbol` returns 0 → `applyKiteMarketProtection` falls through to plain MARKET → Kite rejection. The backend ccxt-india BE→BSE fix (2026-04-22) only covers the ProcessTrades path, not the publisher basket path.

**Fixes.**

1. **`src/utils/brokerPublisher.js`** — fixed imports (`import RNConfig from 'react-native-config'`, `import server from './serverConfig'`), rewrote `convertSymbolsToZerodha()` to use `aq-encrypted-key` header with `generateToken(RNConfig.REACT_APP_AQ_KEYS, RNConfig.REACT_APP_AQ_SECRET)`, parse the `{results: [...]}` shape correctly, and return a map keyed by `angelone_symbol`. Added `resolveZerodhaSymbol(stock, symbolMap)` helper that returns `{tradingsymbol, exchange, cachedLtp}` — single place for `-EQ` strip + scripmaster override + server-cached LTP extraction.
2. **New `src/hooks/useZerodhaSymbolMap.js`** — `useZerodhaSymbolMap(stockDetails, enabled)` hook. Fires `convertSymbolsToZerodha` on mount / when the advice-symbol list changes. Keyed on sorted joined symbol list so unrelated re-renders don't refetch.
3. **All 6 publisher basket builders wired**: each calls `useZerodhaSymbolMap` at the component top and uses `resolveZerodhaSymbol(stock, symbolMap)` during basket build to drive `tradingsymbol` + `exchange`. LTP preference becomes: live-ws on resolved symbol → live-ws on raw symbol → server-cached `ltp` from `/zerodha/convert-symbol`. The server-cached fallback is the load-bearing piece for BE-series / BSE-primary stocks — it's returned by ccxt-india's Redis-cached LTP lookup (`_get_cached_ltp` in `apps/app_zerodha.py:convert_symbol`) and covers exactly the symbols that live-ws can't.
   - `src/components/ReviewZerodhaTradeModal.js:76` + `:420` basket build. Derivative (NFO/BFO) branch intentionally preserves advice-side exchange since scripmaster's equity answer doesn't apply.
   - `src/components/ModelPortfolioComponents/UserStrategySubscribeModal.js:394` + `:831` basket build.
   - `src/components/ModelPortfolioComponents/MPReviewTradeModal.js:270` + `:857` basket build.
   - `src/components/AdviceScreenComponents/RebalanceModal.js:310` + `:602` basket build + `useWebSocketCurrentPrice` subscription updated to subscribe with the resolved exchange so live LTP flows for BE/BSE-primary stocks without relying on the server-cached fallback.
   - `src/components/AdviceScreenComponents/StockAdvices.js:236` + `:1113` basket build.
   - `src/components/AdviceScreenComponents/AddtoCartModal.js:206` + `:973` basket build.

**Architectural note.** ccxt-india's `ZERODHA_SCRIP_MASTER.get_zerodha_symbol_from_angelone_symbol()` is the single source of truth for NSE ↔ BSE / EQ ↔ BE decisions — it reads NSE's daily circular and BSE's scripmaster to determine where each symbol trades today. Never replicate the mapping client-side; always go through `/zerodha/convert-symbol`. `brokerPublisher.resolveZerodhaSymbol` is a pure consumer of that map.

**Not fixed (deferred).**
- `useWebSocketCurrentPrice.subscribeViaAPI` still subscribes to the list with whatever exchange the caller passed. For callsites that DON'T rewrite `wsSymbols` via the resolved symbol (5 of 6 — only RebalanceModal does), live LTP for BE-series stocks remains empty and `applyKiteMarketProtection` falls back to the server-cached LTP. That's sufficient for market-protection correctness but shows a stale price in the review UI for a few seconds. Follow-up: wire the `wsSymbols` rewrite into the remaining 5 callsites.
- BSE fallback on `useWebSocketCurrentPrice` itself (subscribe to NSE, retry with BSE on timeout) is a bigger refactor deferred separately.

---

## [3.9.7] - 2026-04-23

### Fixed — Zerodha publisher basket + shared-env-var coupling with Groww

**ENV-VAR CHANGE — CROSS-BROKER IMPACT.** Reverted commit `f9f5d0f`'s `.env` change of `REACT_APP_BROKER_CONNECT_REDIRECT_URL` and isolated the Zerodha publisher WebView's origin from it.

**Root cause.** Commit `f9f5d0f` (2026-04, "Groww OAuth via Android App Links") changed `.env`'s `REACT_APP_BROKER_CONNECT_REDIRECT_URL` from `https://prod.alphaquark.in/stock-recommendation` → `https://app-links.alphaquark.in/broker-callback`. That var is a **shared-across-8-broker-flows** value. Groww's actual App Links behaviour lives in `AndroidManifest.xml`'s `<intent-filter>` (hardcoded `app-links.alphaquark.in`) and does **not** read this env var — confirmed by `grep -rn REACT_APP_BROKER_CONNECT_REDIRECT_URL src/components/BrokerConnectionModal/GrowwConnectModal.js src/utils/growwRefresh.js` returning zero hits. So the `.env` change was redundant for Groww and silently flipped the fallback for 10 of 12 backend tenants (those without `appadvisors.brokerConnectRedirectUrl`), and flipped the Zerodha basket Referer origin for the `prod` tenant because the Kite basket WebView had never had a `baseUrl` and Referer was defaulting to `about:blank` — Kite rejects that with a misleading `Invalid 'api_key'` error.

**Fixes.**

1. **`.env` reverted** — `REACT_APP_BROKER_CONNECT_REDIRECT_URL=https://prod.alphaquark.in/stock-recommendation` restored, with a blocking in-file comment pointing at `docs/BROKER_CONNECTION.md § Per-broker redirect URL reference` and explicitly calling out that Groww does not need this var.
2. **Zerodha basket Referer isolated** — `src/utils/brokerPublisher.js` gains `getPublisherWebViewBaseUrl(configData)` which derives the Kite basket `baseUrl` from `configData.customDomain` → `configData.subdomain` / `REACT_APP_HEADER_NAME` → `prod.alphaquark.in`. **Intentionally does NOT read `REACT_APP_BROKER_CONNECT_REDIRECT_URL`.** Comment in code records the isolation reason.
3. **5 Zerodha basket WebView callsites wired** — `source.baseUrl` added so Kite sees a valid Referer:
   - `src/components/ReviewZerodhaTradeModal.js:946` + `:1073` (two WebView instances)
   - `src/components/ModelPortfolioComponents/UserStrategySubscribeModal.js:1266`
   - `src/components/ModelPortfolioComponents/MPReviewTradeModal.js:1632`
   - `src/components/AdviceScreenComponents/RebalanceModal.js:1849`
4. **`docs/BROKER_CONNECTION.md`** — new "§ Per-broker redirect URL reference (MANDATORY reading before touching `REACT_APP_BROKER_CONNECT_REDIRECT_URL`)" section with a per-broker consumer map (12 brokers × { auth type, reads the shared var?, where the URL is sent, dev-portal registration requirement, publisher/basket `baseUrl` needed }), a shared-env-var coupling table, and a post-mortem of the incident.
5. **`CLAUDE.md`** — new "§ Shared env vars across brokers — BLOCKING GUARDRAIL" section enumerating the 6-step audit protocol any future contributor must follow before editing a shared broker env var. Designed to make this class of regression impossible to introduce again without tripping an explicit blocking checkpoint.

**Not fixed (deferred).**

- Help-content screens (`FyersHelpContent`, `KotakHelpContent`, `MotilalHelpContent`, `DhanHelpContent`, `AliceblueHelpContent`, `HDFCHelpContent`) read `Config.REACT_APP_BROKER_CONNECT_REDIRECT_URL` directly instead of going through `configData`. For any tenant with a backend override, they'll display the `.env` fallback (wrong) while runtime actually uses the backend value (right). Only `UpstoxHelpContent` has the proper `redirectURLProp || Config...` pattern. Tracked as a follow-up — low priority since affected tenants have backend overrides for the values users consume.
- 10 of 12 backend tenants still have no `appadvisors.brokerConnectRedirectUrl` set, meaning they'd fall back to whatever `.env` ships in their respective app builds. For THIS repo's prod build, that's now correctly `prod.alphaquark.in/stock-recommendation` again. Other repos / variants should verify the same.

**Why this isn't just reverting `f9f5d0f`.** The intent-filter for Groww App Links in `AndroidManifest.xml` is load-bearing and correct — it's what makes Android route `app-links.alphaquark.in/broker-callback` into the app. That part of `f9f5d0f` stays. Only the `.env` line was revertible, because it was redundant.

---

## [3.9.6] - 2026-04-23

### Removed — dead Groww connect-UI trio with pre-migration copy

Three files were left behind by the 2026-04-20 Groww OAuth → credential migration and the 2026-04-21 follow-up to TOTP-Token mode. They survived because they formed a self-contained import island (one imports the other; nothing in the active tree imports any of them), so the Metro bundler never pulled them in and their stale guidance never reached users. But they still sat in the repo with `"Click Generate API Key" → "copy the Access Token"` copy that contradicts the current `Generate TOTP token` flow — a trap for any future contributor searching the codebase for Groww UX references.

Deleted:

- `src/UIComponents/BrokerConnectionUI/GrowwConnectUI.js` (330 lines)
- `src/UIComponents/BrokerConnectionUI/GrowwConnectUI1.js` (318 lines — imports `GrowwHelpContent`)
- `src/UIComponents/BrokerConnectionUI/HelpUI/GrowwHelpContent.js` (119 lines — imported only by `GrowwConnectUI1.js`)

Verified zero imports from the active tree via `grep -rln GrowwConnectUI src/` before removal. `BROKER_CONNECTION.md` "Known follow-ups (deferred)" entry that flagged these as vestigial is now struck-through and annotated with the deletion date.

---

## [3.9.5] - 2026-04-22

### Fixed — Kotak consumer_secret fully retired across mobile + ccxt (follow-up to 3.9.4)

The 2026-04-22 morning commit (`11b099c`) correctly simplified the Kotak connect form to a single UUID "API Access Token", but left every downstream Kotak payload in the mobile app still referencing the now-absent `credentials.secretKey`. Most sites would have sent an empty `consumerSecret` to ccxt; `BrokerOrderBookAPI.js:120` would have hard-thrown `Kotak: Missing required credentials` on the first order-book call. Since the Kotak user cohort had no legacy carry-over, this was a pure regression for every new Kotak connect.

**Mobile — 9 call sites cleaned up**:

| File:Line | Fix |
|---|---|
| `src/services/BrokerOrderBookAPI.js:119` | Dropped `!secretKey` from the validation throw; dropped `consumerSecret` from `kotak/order-book` body. |
| `src/services/BrokerOrderBookAPI.js:270` | Dropped `consumerSecret` from `kotak/order-cancel` body. |
| `src/utils/rebalanceHelpers.js:252` | Dropped `consumerSecret` from `buildBrokerPayloadFields('Kotak')`. |
| `src/utils/ProcessTrades.js:320` | Dropped `consumerSecret` from the Kotak credentials dict. |
| `src/FunctionCall/fetchBrokerAllHoldings.js:103` | Dropped both the `!secretKey` guard and `consumerSecret` from `kotak/all-holdings`. |
| `src/FunctionCall/fetchBrokerSpecificHoldings.js:101` | Same as above for `kotak/holdings`. |
| `src/screens/Drawer/IgnoreTradesScreen.js:1126` | Dropped `consumerSecret` from the ignore-trades payload. |
| `src/screens/Drawer/MPPerformanceScreen.js:697` | Dropped `consumerSecret` from MP performance payload. |
| `src/screens/Drawer/BespokePerformanceScreen.js:605` | Dropped `consumerSecret` from bespoke performance payload. |
| `src/screens/PortfolioScreen/PortfolioScreen.js:232, :413` | Dropped `consumerSecret` from positions + funds payloads. |
| `src/components/AdviceScreenComponents/RebalanceModal.js:1229` | Dropped `consumerSecret` from the basket-run credential builder. |
| `src/components/ModelPortfolioComponents/UserStrategySubscribeModal.js:268, :633` | Dropped `consumerSecret` from both MP subscribe payload builders. |

**ccxt-india — `apps/app_kotak.py` `/kotak/v2/modify-order` realigned**:

The v2 modify-order endpoint was the last holdout still doing `credentials.get("secretKey")` and passing `consumer_secret=...` into `Kotak()`. It was also reading the wrong DB fields (treated `jwtToken` as `access_token`, `viewToken` as `view_token`) — inverted from every other NEO-UUID-flow handler. Realigned to match the v1 `/kotak/order-modify` + `create_kotak_instance` pattern: `apiKey` (UUID) → `access_token`, `jwtToken` (trading/session token) → `view_token`, no `consumer_secret`.

After this commit, there are zero `consumerSecret` references in mobile and zero `consumer_secret=...` arguments in `app_kotak.py`. The broker class `brokers/kotak/kotak.py` still accepts `consumer_secret` as an optional `__init__` parameter — left intact as no caller passes it anymore and the constructor gracefully handles `None`.

Docs updated: `BROKER_CONNECTION.md` Kotak section now documents the UUID-only payload shape.

---

## [3.9.4] - 2026-04-22

### Fixed — Kotak connect flow simplified to single "API Access Token" (matches web)

The Kotak credential form was collecting **Consumer Key** + **Consumer Secret** as two separate fields (6 inputs total) and sending both in the `PUT /api/kotak/connect-broker` body as `apiKey` + `secretKey`. The web source of truth (`prod-alphaquark-github/src/Home/BrokerConnection/Kotak/KotakConnection.js`) now collects a **single "API Access Token"** (UUID from NEO → TradeAPI → API Dashboard, e.g. `ec6a746c-e44b-455e-abf2-c13352b2fc45`) and sends only `apiKey`. The backend derives any downstream secret; the stored `connected_broker` record still has a `secretKey` field populated by the backend on success, so the rebalance/order-book payload builders (`rebalanceHelpers.js`, `ProcessTrades.js`, `fetchBrokerAllHoldings.js`, etc.) that still read `decrypt(secretKey)` at execution time are unaffected.

**Changes —**

- `src/components/BrokerConnectionModal/KotakModal.js`: dropped `consumerKey` / `consumerSecret` form state → renamed to single `apiKey`; removed `secretKey` from the PUT body; deleted 7 unused state vars (`clientCode`, `showProceedModal`, `selectedOption`, `panNumber`, `password`, `storeResponse`, `openOtpBox`) and the unreachable `submitOtp()` function (80 lines — stale two-stage OTP flow that was simplified to single-stage but never cleaned up).
- `src/UIComponents/BrokerConnectionUI/KotakConnectUI.js`: removed the "Consumer Secret" input; renamed "Consumer Key" → "API Access Token" with the UUID-example placeholder; removed the `openOtpBox` branch (unreachable); tightened the disabled-condition for Connect to `!apiKey || !mobileNumber || !mpin || !ucc || !totp || !egressReady`.
- `src/config/brokerRegistry.js`: Kotak `fields` trimmed from 6 to 5 — dropped `secretKey`, relabeled `apiKey` to "API Access Token" with `isSecret: true` so the generic credential screen masks it.
- `src/UIComponents/BrokerConnectionUI/HelpUI/KotakHelpContent.js`: instructions rewritten to match the web KotakSteps content — Step 1 (NEO → TradeAPI → API Dashboard → Create Application → copy UUID), Step 2 (TOTP Registration via `http://bit.ly/4h4LByx` + authenticator), Step 3 (UCC + MPIN lookup), Step 4 (enter on the form).
- **Deleted** `src/components/Kotakproceedmodal.js` — orphan file, internally labeled "Connect IIFL Securities", never imported anywhere.
- **Deleted** `src/components/BrokerConnectionModal/KotakConsumerKeySteps.js` — orphan legacy component for the two-key flow, referenced only in doc comments.

Mirrors the same simplification shipped to the Flutter retail app (tidi_new `feature/mp` — `lib/models/broker_config.dart`, `lib/service/AqApiService.dart`, `lib/components/home/portfolio/BrokerCredentialPage.dart`).

No migration needed for users already connected: the stored `connected_broker.secretKey` remains valid and the rebalance payloads continue to decrypt it. New connections skip the secret-key exchange entirely.

Docs updated: `BROKER_CONNECTION.md` — Kotak row now reflects the 5-field flow.

---

## [3.9.3] - 2026-04-22

### Fixed — Broker connect-instruction URLs now tap-to-open AND tap-to-copy (all 9 brokers)

The broker-help screens (`src/UIComponents/BrokerConnectionUI/HelpUI/*`, the legacy `src/components/BrokerConnectionModal/HelpModal.js` modal, and the developer-portal link inside `EgressIpCallout.js`) rendered every login/portal URL as a `<Text onPress={Linking.openURL(...)}>` — so the URL *opened* on tap, but there was no way to *copy* it. Users on a phone without the target browser installed (or trying to paste the URL into a desktop session) had no recourse. Worse, the Upstox block had a subtle display bug: the tappable target was `https://shorturl.at/plWYJ` (lowercase L) but the displayed text was `pIWYJ` (capital I) — users who copied the visible text landed on the wrong URL.

**Fix —** added `src/UIComponents/BrokerConnectionUI/HelpUI/LinkifiedUrl.js`, a small drop-in component that renders a URL as three inline `<Text>` nodes: the selectable, tappable, blue-underlined URL itself (tap → `Linking.openURL`), followed by a tappable copy-icon glyph (tap → `Clipboard.setString` + "Link copied" toast via `react-native-toast-message`). Same runtime-global `Clipboard` pattern as `MotilalConnectUI` / `HelpModal` / `KotakConsumerKeySteps` — no new native dep needed on RN 0.78 — with a graceful fallback toast telling the user to long-press if the shim isn't present. `selectable` on the URL span also enables native long-press-to-select as a second copy path.

Swapped the `<Text onPress={Linking.openURL(...)}>` pattern (and the `<TouchableOpacity><Text>URL</Text></TouchableOpacity>` block-link variant used for Kotak / Motilal callback URLs) to `<LinkifiedUrl url={...} />` across:

- `HelpUI/GrowwHelpContent.js` (2 URLs)
- `HelpUI/UpstoxHelpContent.js` (2 URLs — fixed the `plWYJ` vs `pIWYJ` display bug)
- `HelpUI/FyersHelpContent.js` (1 URL)
- `HelpUI/ICICIHelpContent.js` (2 URLs — the dynamic `iciciCallbackUrl` used to render as non-tappable plain text)
- `HelpUI/HDFCHelpContent.js` (2 URLs)
- `HelpUI/MotilalHelpContent.js` (2 URLs)
- `HelpUI/KotakHelpContent.js` (4 URLs)
- `HelpUI/DhanHelpContent.js` (1 URL — promoted `http://login.dhan.co` → `https://login.dhan.co`)
- `HelpUI/AliceblueHelpContent.js` (1 URL)
- `components/BrokerConnectionModal/HelpModal.js` (~15 URLs across ICICI / AliceBlue / Fyers / Dhan / HDFC / Kotak / Upstox / Motilal / Zerodha)
- `components/BrokerConnectionModal/EgressIpCallout.js` (developer-portal link)

Mirrors the same fix shipped to the Flutter retail app (tidi_new `feature/mp` commit `da63c92`).

Docs updated: `BROKER_CONNECTION.md` — note on the shared `LinkifiedUrl` helper + the Upstox `pIWYJ` display fix.

---

## [3.9.2] - 2026-04-22

### Fixed — Groww TOTP Token never parsed ("TOTP seed could not be parsed")

Groww's "Generate TOTP token" dialog labels the Base32 value **"TOTP Token"**, but the mobile form was asking for a "TOTP Seed (Base32)" — users hunting for a field literally called "Seed" on Groww's screen never found one. Those who did paste a value often pasted it with whitespace, hyphens, or as an `otpauth://` URL (scanned from Groww's QR with a generic scanner), all of which `pyotp.TOTP()` rejects with an opaque "Incorrect padding" / "Non-base32 digit" message. That surfaced as the generic `"TOTP seed could not be parsed"` error on almost every first-connect attempt.

**Backend (ccxt-india, `apps/app_groww.py`)** — added `_normalize_totp_token(raw)` which runs ahead of `pyotp.TOTP(...)`. It extracts `secret=` from `otpauth://` URLs, strips whitespace/hyphens/underscores, uppercases, pads to a multiple of 8, and validates the Base32 alphabet. Parse failures now return one of three granular error codes (`NOT_BASE32`, `WRONG_LENGTH`, `GROWW_REJECTED`) so the mobile UI can steer the user to the specific fix instead of showing the generic "could not be parsed" copy.

**Mobile —**

- `src/components/BrokerConnectionModal/GrowwConnectModal.js`: field relabeled "TOTP Seed (Base32)" → "TOTP Token", state variable `totpSeed` → `totpToken`, placeholder and helper copy updated, step-2 instruction rewritten to match Groww's actual dialog wording, three new error-code branches with targeted alerts.
- `src/config/brokerRegistry.js`: Groww field `label: 'TOTP Seed (Base32)' → 'TOTP Token'` and placeholder updated. Wire field name (`key: 'totp_seed'`) unchanged — only the user-facing label moved, so backend contract stays intact.
- `src/utils/growwRefresh.js`: user-facing copy changed to "TOTP Token"; `GROWW_REJECTED` added alongside `INVALID_SEED` in the "stored token rejected" branch.

Docs updated: `BROKER_CONNECTION.md` — Groww overview-table entry rewritten to reflect the TOTP-token flow; new "Groww TOTP Token — parsing hardening + UX fix (2026-04-22)" section added.

---

## [3.9.1] - 2026-04-21

### Fixed — Axis Securities WebView callback never fired

`src/components/BrokerConnectionModal/AxisConnectModal.js` — the WebView
navigation handler parsed the SSO callback with `new URL(url)` +
`searchParams.get('ssoId')`. React Native has no `react-native-url-polyfill`
installed, and its built-in `URL` is partial — `searchParams` can be
undefined on intermediate navigations (about:blank, data:, WebView-
internal URLs), and no try/catch was in place, so any throw killed the
handler silently. Result: WebView parked on
`app-links.alphaquark.in/broker-callback?ssoId=xxx` and the callback
POST was never issued.

Rewrote parsing to match Upstox/Zerodha in this same folder: guard with
`url.includes('ssoId=')`, split on `?`, `decodeURIComponent` each pair
in a try/catch. Also added `onShouldStartLoadWithRequest` so the
redirect landing page is intercepted BEFORE the WebView loads it — the
ssoId is snatched and the WebView closes without the user ever seeing
the blank callback URL. Split the token exchange into a standalone
`processAxisCallback(ssoId)` so both hooks (`onShouldStartLoad` and
`onNavigationStateChange`) reuse the same idempotent path gated by
`hasProcessedCallback`.

---

## [3.9.0] - 2026-04-21

### Changed — Groww: TOTP-seed default flow (parity with web)

Ported the 2026-04-21 Groww TOTP-seed migration from `prod-alphaquark-github`.
Groww deprecated partner OAuth in 2026-04; the mobile app was already on
the approval-mode credential form (2026-04-20 migration). This commit
takes it the rest of the way: approval-mode `secretKey` → Base32 TOTP
seed. Customers paste the API Key + Base32 seed once; the backend stores
the seed AES-256-CBC encrypted; daily refresh is a one-tap call to
`POST /api/groww/refresh-token` that mints a fresh TOTP server-side
(`pyotp.TOTP(seed).now()`) and swaps it for a new access token.

- **GrowwConnectModal.js**: second field relabelled "API Secret" → "TOTP
  Seed (Base32)"; instructions rewritten around Groww's "Generate TOTP
  token" dialog (not "API Key & Secret"). Payload to
  `POST /api/groww/update-key` now sends `{apiKey, totp_seed}` instead
  of `{apiKey, secretKey}`. `EgressIpCallout` integration from the
  2026-04-20 approval-mode work preserved — IP whitelist gate still
  blocks submit until the customer claims + whitelists + acknowledges.
  Calls `saveBrokerSessionTime('Groww')` on success.
- **src/utils/growwRefresh.js** (new): `refreshGrowwSession` helper with
  `Alert.alert` confirm → POST `/api/groww/refresh-token` → error-code
  routing: `NO_TOTP_SEED` → re-open connect modal (legacy
  approval-mode user upgrading), `INVALID_SEED` → external
  `Linking.openURL('https://groww.in/trade-api/api-keys')` + re-open
  connect modal (revoked-key recovery), `RATE_LIMITED` → silent
  (backend's 30s cooldown is a correctness guardrail, not a UX signal).
- **TokenExpireBrokerModal.js**: Groww no longer in `OAUTH_BROKERS`
  (moved from the generic "Reconnect {broker}" path). Dedicated Groww
  branch renders "Refresh Groww session" button that calls the helper;
  fallback to `checkValidApiAnSecret('Groww')` on NO_TOTP_SEED /
  INVALID_SEED opens the connect modal for seed (re)capture.
- **docs/BROKER_CONNECTION.md**: Groww row updated (approval-mode
  → TOTP-seed). Added §"Groww (TOTP-seed, 2026-04-21)" with flow
  diagram, error-code table, and file list.

Cross-repo: rides on already-deployed Node (`c6cfd43`) + ccxt
(`3e63a32`) + web frontend (`9ed5c25`) commits. No backend changes
required on this commit — mobile app consumes existing endpoints.

**Release timing**: no CodePush/Expo OTA in this repo — ships on the
next Play/App Store build. A backend backward-compat bridge
(2026-04-21, separate `aq_backend_github` + `ccxt-india` commits) lets
legacy builds keep working during the store rollout window — see the
Follow-up section below. Remove the bridge after the new build is
broadly adopted.

### Follow-up — parallel surface parity + backward-compat bridge

After the initial port, two gaps surfaced:

1. **Parallel settings-page surface.** `BrokerSelectionScreen` →
   `BrokerCredentialScreen` (the 2026-04-20 web-parity settings flow)
   dispatched Groww via the generic `default:` branch to
   `/api/user/connect-broker` — which bypasses `/api/groww/update-key`
   entirely and trusts an upstream-validated `jwtToken`. Bypass would
   paper over credential errors at connect-time and fail at
   order-time. Fixed:
   - `src/config/brokerRegistry.js`: Groww fields switched from
     `secretKey` → `totp_seed` (`isSecret: true`), labels updated
     to "TOTP Seed (Base32)". Also fixed an upstream `name:` typo
     → `key:` so the data-driven form actually renders.
   - `src/utils/brokerAuth.js`: Groww `BROKER_OAUTH_CONFIG` entry
     renamed `requiresSecretKey` → `requiresTotpSeed`; added
     `refreshEndpoint: '/api/groww/refresh-token'`.
   - `src/components/BrokerConnectionModal/EgressIpCallout.js`:
     `BROKER_WHITELIST_HINT.groww` now says "Generate TOTP token"
     (was "Create API Key + Secret").
   - `src/screens/Broker/BrokerCredentialScreen.js`: NEW explicit
     `case 'groww':` that POSTs to `/api/groww/update-key` with
     `{apiKey, totp_seed}` — matches `GrowwConnectModal` shape.

2. **Backward-compat bridge (backend side, no RN change).** Stale
   mobile-app builds from before 2026-04-21 still POST
   `{apiKey, secretKey}`. The backend was updated
   (`aq_backend_github` `/api/groww/update-key` + ccxt
   `/groww/generate-token`) to temporarily accept either
   `totp_seed` or `secretKey`, with a matching
   `_mint_groww_approval_mode` fallback in ccxt. Legacy payloads do
   NOT persist a seed — those users stay on the daily re-paste flow
   until their app updates. Remove this bridge after the rollout is
   broadly adopted (monitor deprecation log → zero hits for ~30 days).

---

## [unreleased] - 2026-04-21

### Change — Market-hours gate restored behind `allowAfterHoursOrders` feature flag

**Why this matters:** the previous entry (below) fully removed the client-side
market-hours gate across every order-placement surface. That was too blunt:
most advisors still want the gate (brokers reject non-AMO orders after 15:30
and the failures look like broker bugs to end users), while a smaller set of
advisors genuinely want the 24×7 queue behavior. Rather than pick one default
for everyone, the gate is now conditional on an admin-controlled flag.

**Mechanism:** `ConfigContext` now reads an `allowAfterHoursOrders` boolean
from the advisor record served by `/api/app-advisor/get` (same
`featureFlags` object that already carries `modelPortfolioEnabled`,
`bespokePlansEnabled`, `brokerConnectEnabled`). Default is `true` — the
gate is bypassed and every placement surface remains enabled 24×7 unless an
admin explicitly sets the flag to `false` on an advisor's config record (in
which case the original 09:15–15:30 IST "Market is Closed" behavior returns
for that advisor).

**Surfaces wired to the flag (all use `IsMarketHours() || allowAfterHoursOrders`):**

1. `src/components/AdviceScreenComponents/RebalanceModal.js` — Step-3 "Place
   Order" button.
2. `src/components/ReviewTradeModal.js` — basket and single-stock review
   buttons.
3. `src/components/ReviewZerodhaTradeModal.js` — both slider variants.
4. `src/components/AdviceScreenComponents/StockAdvices.js` — `placeOrder`
   guard and orderscreen `handleCheckOrder` guard.
5. `src/components/AdviceScreenComponents/AddtoCartModal.js` — `handleTrade`
   guard.

**Not touched** (cleanup-only changes from the previous entry stay):
`UserStrategySubscribeModal.js`, `RebalanceCard.js`, `BasketTradeModal.js`.
Those had either dead declarations or no user-blocking gate to begin with.

**Files changed:**
- `src/context/ConfigContext.js` (added `allowAfterHoursOrders` to the
  feature-flags pass-through)
- `src/components/AdviceScreenComponents/RebalanceModal.js`
- `src/components/ReviewTradeModal.js`
- `src/components/ReviewZerodhaTradeModal.js`
- `src/components/AdviceScreenComponents/StockAdvices.js`
- `src/components/AdviceScreenComponents/AddtoCartModal.js`
- `docs/APP_ARCHITECTURE.md`

**Backend contract:** the admin-side advisor record may include
`featureFlags.allowAfterHoursOrders: boolean`. Missing/undefined → treated as
`true` (24×7 placement). A top-level `allowAfterHoursOrders` field on the
response is also honoured for backward compatibility. Advisors who want the
intraday-only gate restored must explicitly set the flag to `false`.

---

### Change — Remove client-side market-hours gate on order placement

**Why this matters:** advisors / power users wanted the ability to queue orders
outside market hours (09:15–15:30 IST). The app was blocking every
order-placement surface with a client-side `moment()` time check and a disabled
"Market is Closed" button — no API was consulted, no AMO variety was offered,
orders were simply refused even when brokers could have queued them.

**Behavior change:** every Place Order / Slide-to-Place-Order affordance is
now enabled 24×7. Whether the broker accepts the order is now entirely a
broker-side decision (error surfaced via the usual order-status poll). No AMO
payload switching was added — the order goes out with `variety: 'regular'`
and any broker-side rejection returns as a regular order failure.

**Surfaces unblocked:**

1. `src/components/AdviceScreenComponents/RebalanceModal.js` — Step-3 "Place
   Order" button (the one in the bug report screenshot).
2. `src/components/ReviewTradeModal.js` — both button variants (basket and
   single-stock review).
3. `src/components/ReviewZerodhaTradeModal.js` — both slider variants.
4. `src/components/AdviceScreenComponents/StockAdvices.js` — two `placeOrder`
   guards (early-return on `!isMarketHours`).
5. `src/components/ModelPortfolioComponents/UserStrategySubscribeModal.js` —
   `calculateRebalance` guard.
6. `src/components/AdviceScreenComponents/AddtoCartModal.js` — `handleTrade`
   guard.

**Code hygiene:** removed now-dead `IsMarketHours` imports and call sites from
all six files above plus `UIComponents/RebalanceAdvicesUI/RebalanceCard.js`
and `components/BasketTradeModal.js` (which had dead declarations even before
this change). Also removed `BasketTradeModal.js`'s `false ? 'Market is
Closed' : ...` hardcoded ternaries — the slider labels are now clean. The
util `src/utils/isMarketHours.js` itself is retained for potential future
informational use (e.g. an advisory banner that does not block action).

**Files changed:**
- `src/components/AdviceScreenComponents/RebalanceModal.js`
- `src/components/ReviewTradeModal.js`
- `src/components/ReviewZerodhaTradeModal.js`
- `src/components/AdviceScreenComponents/StockAdvices.js`
- `src/components/ModelPortfolioComponents/UserStrategySubscribeModal.js`
- `src/components/AdviceScreenComponents/AddtoCartModal.js`
- `src/UIComponents/RebalanceAdvicesUI/RebalanceCard.js`
- `src/components/BasketTradeModal.js`
- `docs/APP_ARCHITECTURE.md` (rebalance-flow step removed; util entry annotated)

**Caveat to surface to users later if needed:** after-hours orders will be
rejected at the broker side for most Indian brokers unless the payload sets
AMO variety. If the user sees "broker rejected" after 15:30 IST, this is
expected with the current payload. Adding per-broker AMO variety support is
a follow-up (Option B in the investigation notes).

---

### Feature — Broker picker display config + hide Angel One

**What:** Extracted the hardcoded `brokersmain` array in `BrokerSelectionModal.js` into a new standalone config file `src/config/brokerDisplayConfig.js`. The modal now reads its grid of tiles from that config — changing which brokers appear in the picker, and in what order, is a one-line edit in the config.

**Why:** Business asked to remove Angel One from the broker picker without deleting any auth code (may be re-enabled later). An inline array in the modal made that a scattershot change; a single config makes it one commented-out entry.

**Changes:**

- **New file** `src/config/brokerDisplayConfig.js` — plain array of `{ name, key, logo }` in display order. Angel One entry is present but commented out.
- **`src/components/BrokerSelectionModal.js`** — `brokersmain` is now `brokerDisplayConfig` imported from the config file. Dropped the unused `url` field (the modal never read it — taps route through `openModal(broker.key)` into `ModalManager`). Removed the now-unused `configData` destructure from `useTrade()`.
- **Angel One auth plumbing untouched.** `AngleoneBookingModal`, `ModalManager`'s `'Angel One'` case, the `registerCallback('angelone', ...)` nonce branch in `handleBrokerSelect`, `brokerSupport`/`brokerAuth`/`ProcessTrades`/`fetchFunds`/backend — all still intact. Existing users with an Angel One connection continue to work; `ManageConnectionsModal` still shows their Angel One row with Re-auth/Switch/Remove. Only the "Connect new broker" picker hides the tile.

**To re-enable Angel One:** uncomment the first entry in `brokerDisplayConfig.js`. No other code changes needed.

### Fix — Order exchange routing (Kite Publisher silent-drop) + rebalance auto-trigger leak

**Why this matters:** a user's Zerodha basket rebalance silently dropped a BSE-only
symbol (ADARSHPL) because the app sent `exchange: "NSE"` to Kite Publisher. Kite
silently skipped the mismatched item — no order created, no error to the user —
and the post-flow status poll reported "Order rejected by broker (not found in
order book)", which sounded like a broker rejection but was actually a
pre-validation silent drop.

**Two classes of bug fixed:**

1. **Silent exchange default** — mobile order/basket builders fell back to
   `'NSE'` if `stock.exchange` was blank. That silently mis-routes BSE-only
   symbols. Removed every `|| 'NSE'` fallback in order-placement paths and
   added a single validation helper `validateStockExchanges()` in
   `src/utils/brokerPublisher.js` that every order entry now gates on. If any
   stock in the basket is missing exchange, the whole basket is rejected with
   a user-facing list of the offending symbols — no order ever leaves the
   device in a mis-routable state.

2. **Exchange lost in backend round-trip** — the backend
   `/api/zerodha/publisher/record-orders` and `/api/fyers/publisher/record-orders`
   endpoints didn't include the `exchange` field in their response payloads.
   Mobile stored those empty `exchange` values in `user_net_pf_model.order_results`,
   so the next Repair Trades flow read back blank — which then triggered bug #1.
   The backend now preserves `exchange` in every branch (matched / publisher-
   reported-success-but-missing / unmatched / error-fallback). A one-time Mongo
   backfill repopulated 211 stale records in `model_portfolio_user.advice_executed`
   from the advice source of truth (`model_portfolio.model.rebalanceHistory.adviceEntries`).

**Also fixed — rebalance auto-trigger on unrelated broker connect:**

`RebalanceAdvices.js` had a reactive `useEffect` that, when `storeModalName`
was set and the global broker modal closed with `brokerStatus==='connected'`,
automatically fetched holdings and opened the model-portfolio rebalance flow.
`storeModalName` was never cleared, so a stale value from a previous MP tap
caused "connect a broker from Settings" to unexpectedly open a rebalance for
that MP. Changed the intent tracker from a sticky boolean ref to a timestamp
ref with a 2-minute TTL — legitimate auto-continue still works; stale intent
can't fire.

**Also updated — more informative Zerodha "not in order book" message:**
Replaced `"Order rejected by broker (not found in order book). Please check
your Kite app for details."` with `"Order not accepted by Zerodha (no record
in order book). Likely causes: invalid symbol/exchange combination, restricted
stock (GSM/T2T), or pre-acceptance rejection. Please verify in your Kite app."`

**Files — mobile:**
- `src/utils/brokerPublisher.js` — new `validateStockExchanges()` helper; removed silent NSE default in `convertToBasketItem()` for both Zerodha and Fyers
- `src/components/ModelPortfolioComponents/MPReviewTradeModal.js` — gate in `handleZerodhaRedirect` + `handleFyersRedirect`; removed inline NSE default in Zerodha basket builder
- `src/components/ReviewZerodhaTradeModal.js` — gate in `handleZerodhaRedirect`; removed NSE default
- `src/components/AdviceScreenComponents/StockAdvices.js` — gate + removed NSE default
- `src/components/AdviceScreenComponents/RebalanceModal.js` — gate + removed NSE default
- `src/components/AdviceScreenComponents/AddtoCartModal.js` — gate + removed NSE default
- `src/screens/Drawer/IgnoreTradesScreen.js` — gate + removed NSE default
- `src/components/AdviceScreenComponents/RebalanceAdvices.js` — rebalance auto-trigger timestamp TTL

**Files — backend (`aq_backend_github`):**
- `Routes/Broker/zerodha.js` — preserve `exchange` in all 4 `orderResult`/response branches of `/publisher/record-orders`; update "not in order book" message
- `Routes/Broker/Fyers.js` — preserve `exchange` in all 3 response branches of `/publisher/record-orders`

**Data — one-time Mongo backfill (production `prod` DB):**
211 records in `model_portfolio_user.advice_executed[*].order_results[*]` had
blank `exchange`; backfilled from the symbol→exchange map derived from all
`model_portfolio.model.rebalanceHistory[*].adviceEntries`. One `tcs` test
record intentionally left alone (not in advice).

---

## [earlier-2026-04-21] - 2026-04-21

### Fix — ICICI Direct and Upstox broker connection on mobile

**Root causes fixed:**

**ICICI Direct:**
1. `ccxt-india/apps/app_icici.py` — `/icici/auth-callback/<subdomain>` and `/icici/auth-callback/website/<site>` only accepted `POST`, but ICICI redirects the browser via GET. Changed to `['GET', 'POST']`.
2. `icicimodal.js` — The WebView handler was designed around a false assumption that CCXT does the `apisession → session_token` exchange server-side before redirecting. CCXT is actually a pass-through relay to the web frontend URL. The mobile never detected the final redirect (wrong URL pattern) and the legacy-detection code fired instead. Replaced the handler with the same client-side exchange that the web app uses: detect `apisession=` in any WebView URL → POST to `icici/customer-details` → PUT to `api/user/connect-broker`.

**Upstox:**
1. `upstoxModal.js` — `hasConnectedUpstox.current` was set but never checked in `connectUpstox`, so double API calls could occur when `userDetails` changed after `upstoxCode` was set. Fixed to mirror web app (guard before starting the request, not after).
2. `upstoxModal.js` — Silent failure when `gen-access-token` returned HTTP 200 with an error body (no `access_token`). Added explicit check and user-facing error message.
3. `UpstoxHelpContent.js` — Help text always showed `.env`'s redirect URL, not the config-resolved URL that the modal actually uses. Fixed to accept `brokerConnectRedirectURL` as a prop.

**White-labeling note:** Each advisor registers their own ICICI API app with callback URL `https://ccxtprod.alphaquark.in/icici/auth-callback/{subdomain}`. Upstox redirect URI must match what's registered in the advisor's Upstox developer portal — the app uses `REACT_APP_BROKER_CONNECT_REDIRECT_URL` from the advisor config API (falls back to `.env`).

**Files:**
- `ccxt-india/apps/app_icici.py` (GET method on auth-callback routes)
- `src/components/BrokerConnectionModal/icicimodal.js` (WebView handler rewrite)
- `src/components/BrokerConnectionModal/upstoxModal.js` (guard + error handling)
- `src/UIComponents/BrokerConnectionUI/UpstoxConnectUI.js` (prop passthrough)
- `src/UIComponents/BrokerConnectionUI/HelpUI/UpstoxHelpContent.js` (accept redirect URL prop)

---

## [3.10.0-color-tokens] - 2026-04-21

### Feat — Semantic color token system + `colorTokens` slot in advisor config

**Scope**: Infrastructure only — zero visual change. Components keep their existing hardcoded colors and keep rendering identically. This change lays the foundation for advisor-configurable theming and the upcoming migration of ~4,618 hardcoded hex values across 224 files.

**What shipped:**

1. `src/theme/colors.js` (new) — canonical `DEFAULT_TOKENS` tree grouped into `brand`, `text`, `surface`, `border`, `status`, `pnl`, `nav`, `basket`, `chart.series[]`, `emptyState`, `overlay`, `shadow`. Exposes `buildColors(config)` that resolves defaults ← legacy branding fields (`mainColor`, `themeColor`, `gradient1/2`, `basket1`, `bottomTabbg`, `tabIconColor`, `selectedTabcolor`, `basketcolor`, `basketsymbolbg`, `EmptyStateUi`) ← `colorTokens` advisor overrides.
2. `src/theme/useColors.js` (new) — memoized hook `useColors()` for component consumption.
3. `src/context/ConfigContext.js` — reads new `apiData.colorTokens` field from `/api/app-advisor/get` and surfaces it in the React context. Existing fields untouched.
4. Backend `aq_backend_github/Models/appAdvisorModel.js` — added `colorTokens: { type: Schema.Types.Mixed, default: {} }`. `Mixed` chosen so the mobile app owns the token shape without requiring schema migrations.
5. Backend `aq_backend_github/Routes/AppAdvisor/AppAdvisorRouter.js` — `PUT /update-theme` now destructures and writes `colorTokens`. `GET /get` returns it automatically via `.lean()`.
6. Support UI `supportAQ/src/components/AppAdvisorConfig.jsx` — new **Semantic Color Tokens** section under Theme Configuration, with grouped color pickers for `text`, `surface`, `border`, `status`, `pnl`, plus a raw-JSON escape hatch for advanced fields (`chart.series[]`, `overlay`, `shadow`, `emptyState`).
7. Docs: `docs/COLOR_TOKENS.md` (full catalog + override shape) and `docs/COLOR_SYSTEM.md` (data flow, where to change colors, FAQ).

**API verified**: `GET https://server.alphaquark.in/api/app-advisor/get?appSubdomain=rgxresearch` returns the advisor config with all existing branding fields (themeColor, mainColor, gradient1/2, basket1/2, etc.) plus the new `colorTokens` slot (empty `{}` for existing advisors — they keep rendering with defaults + legacy branding).

**Security note**: The `/get` endpoint currently returns `fcmServiceAccount.private_key` and decrypted broker API keys in the response body. This is pre-existing behavior and unrelated to this change, but worth flagging — any color edit in support also hands out the Firebase service account private key to whoever can call the endpoint with a valid `aq-encrypted-key`.

**Files**:
- `src/theme/colors.js` (new)
- `src/theme/useColors.js` (new)
- `src/context/ConfigContext.js` (added `colorTokens` passthrough)
- `docs/COLOR_TOKENS.md` (new)
- `docs/COLOR_SYSTEM.md` (new)
- `docs/APP_ARCHITECTURE.md` (cross-reference to theme module)
- `aq_backend_github/Models/appAdvisorModel.js` (schema field)
- `aq_backend_github/Routes/AppAdvisor/AppAdvisorRouter.js` (update-theme route)
- `supportAQ/src/components/AppAdvisorConfig.jsx` (UI section + form plumbing)

**Next**: component migration (waves A–F in `docs/COLOR_SYSTEM.md` §4) replaces hardcoded hex literals with `useColors()` reads. This commit is a safe land — nothing in existing component code paths has changed.

---

## [3.9.1] - 2026-04-21

### Fix — JWT expiry bumped 15s → 300s so clock-drifted devices can auth

**Symptom**: Login returned `401 "Token has expired"` (server response body: `{"success":false,"message":"Token has expired","triedConfigurations":["altqube","default","common"]}`). Observed on Android emulator where the device clock had drifted ~33 seconds behind real UTC. Every request signed with `aq-encrypted-key` — `/api/user/getUser/*`, `POST /api/user/`, `/api/gst/config`, etc. — 401'd identically. Error surfaced to users as "Something went wrong. Please try again." (email/password path) or "Authentication failed. Please try again." (Google path).

**Root cause**: `src/utils/SecurityTokenManager.js` `generateServiceToken()` minted JWTs with a **15-second expiry window** (`exp = iat + 15`). The server compares `exp` against its own clock (which is NTP-synced in prod). Any client with clock drift > 15 sec — trivially easy on emulators, also happens on real phones with stale time — ships tokens whose `exp` is already in the past when they land at the server, so the server answers 401.

**Subtlety: IST offset is NOT the bug.** Both app and server add +5h30m to UTC epoch before comparing `iat`/`exp`. Verified by curl: a token with UTC-only timestamps returns `401 "Token has expired"` from `server.alphaquark.in`; a token with the same IST offset returns `200`. The offset is self-consistent across the two sides; only the window size was wrong.

**Fix**: `src/utils/SecurityTokenManager.js:57-60` — changed `1000 * 15` to `1000 * 300`. 5 minutes covers typical NTP drift (seconds to low-minutes) and all emulator skew seen in practice, while still being short enough to limit replay-attack exposure. No server change needed — server already tolerates varied `exp` claims as long as `exp > now`.

**Why 15s slipped through**: works perfectly on NTP-synced dev machines (macOS auto-syncs), works perfectly on freshly-booted physical devices, works perfectly for localhost testing. Only fails on stale clocks — emulators that have been suspended/resumed, phones with manual time, airplane-mode devices recovering connectivity.

**How to reproduce in future**: `adb shell "date"` vs host `date -u`. Any difference >15 sec and the old 15-sec window would break. The 300-sec window tolerates ~4 min of drift before re-breaking.

**Files**: `src/utils/SecurityTokenManager.js` only.

---

## [3.9.0-color-restore] - 2026-04-21

### Fix — Restore AlphaQuark palette (reverts collateral damage from "sync with rgx app")

**Symptom**: Login/splash/signup/reset screens showed Zamzam purple gradient + "Z" logo instead of the AlphaQuark navy gradient + alpha-symbol logo. Only the `alphaquark` build variant was affected.

**Culprit**: commit `36514de` ("sync with rgx app", 2026-03-31) bulk-copied Config.js and 5 screen files from the RGX fork. Three regressions in one commit:
1. Collapsed `APP_VARIANTS.alphaquark` (and 4 other variants) into a single shared `zamzamConfig` block — alphaquark lost its teal `mainColor: '#4CAAA0'`, `layout2`, and `paymentModal` block.
2. Redirected six logo import/require paths from `../assets/logo.png` (AlphaQuark alpha-symbol) to `../assets/AppLogo/logo.png` (Zamzam "Z"). Variable names (`AlphaQuarkLogo`) were preserved, so the regression was invisible in review.
3. `LoginScreen.js` rewritten to read `gradient1`/`gradient2` from config with blue fallbacks — because shared config fed it `gradient2: '#773D9A'`, login screen rendered purple.

A later commit (`3223331`) renamed `zamzamConfig` → `sharedUIConfig` but did not restore per-variant palettes.

**Fix**: 6 files.
1. `src/utils/Config.js` — added `import AlphaQuarkLogo from '../assets/logo.png'`; replaced `alphaquark: {...sharedUIConfig, subdomain: 'prod', advisorRaCode: 'ALPHAQUARK'}` with the full explicit pre-sync palette block (teal `#4CAAA0`, layout2, paymentModal `#0056B7`/`#29A400`, `basket1/2` red tones, AlphaQuarkLogo). Other variants still spread `sharedUIConfig` unchanged.
2. `src/components/SplashScreen.js:5` — `require('../assets/AppLogo/logo.png')` → `require('../assets/logo.png')`.
3. `src/screens/Authentication/LoginScreen.js:49` — same path revert. Lines 56-58 (config-driven gradient1/gradient2 variables) removed; `LinearGradient` colors prop hard-coded back to `['rgba(0, 38, 81, 1)', 'rgba(0, 86, 183, 1)']` (pre-sync state).
4. `src/screens/Authentication/SignupScreen.js:49` — same path revert.
5. `src/screens/Authentication/ResetPassword.js:24` — same path revert.
6. `src/components/HomeScreenComponents/PlanCard.js:74` — same inline `require` path revert.

**Not done**: no `git revert 36514de` — that commit also carried legitimate sync work (broker, WebSocket, MP Performance). File-scoped restore preserves all of those.

**Verified**: login screen now renders navy gradient + AlphaQuark alpha-symbol + green Log In button on `emulator-5554` (release APK, clean build).

---

## [3.9.0] - 2026-04-21

### Feat — Session-expired detection util + top-card state + cross-repo 5 AM IST cron

Three fixes that together make the "is this broker usable right now?" signal actually accurate end-to-end, not just on the row badge:

1. **`src/utils/brokerStateUtils.js` (new)** — `isBrokerSessionExpired(entry)` checks BOTH `entry.status` ∈ {`'expired'`, `'error'`} AND `entry.token_expire` in the past. `getPrimaryBrokerEntry(userDetails)` looks up the primary broker's entry. `ManageConnectionsModal.fetchConnections` now uses this instead of the status-only check so expiry derived from `token_expire` is caught.

2. **`SubscriptionScreen.js` top card** — now renders three states instead of two: Connected (green, session live) / **Session Expired (amber, new state with "Re-auth" button)** / Disconnected (red, no primary). Previously the card blindly said "Connected" whenever the top-level `connect_broker_status` was truthy, even if the primary broker's session was dead. Also hides the Disconnect button when the primary is expired (nothing to disconnect). Verified on emulator: after tapping Reconnect on Dhan and backing out of the OAuth WebView, the card correctly flips to "Dhan Session Expired" with a Re-auth button.

3. **`aq_backend_github/CronJob/CronBrokerDailyResetExpiry.js` (new, cross-repo)** — the client util alone can't detect expiry for brokers whose backend `status` field stays `'connected'` across the broker-side daily reset (ICICI is the canonical offender). Added a backend cron that runs **daily at 5 AM IST** (`0 5 * * *` with `timezone: "Asia/Kolkata"`), iterates every advisor database, and unconditionally flips every `status: 'connected'` entry to `status: 'expired'` with `last_error: 'Daily 5 AM IST reset'`. Mirrors the legacy top-level `connect_broker_status` when the primary is flipped. Wired into `CronJob/index.js` as slot [4/8], complementing the existing `brokerTokenRefresh.js` (which only catches `token_expire`-based expiry). Documented in `aq_backend_github/docs/BACKEND_API_ARCHITECTURE.md` §10.1.

**Gate fix** (earlier in this session): `SubscriptionScreen.js` — Manage Connections button is now visible whenever `userDetails.connected_brokers[].length > 0`, not only when `brokerStatus !== 'Disconnected'`. Users with saved broker credentials but no active primary can now reach Manage Connections to re-auth.

**Deployment note**: The cron side requires `ssh tidi` → pull on the backend server → `sudo systemctl restart aq-cron-jobs.service` (see `CronJob/aq-cron-jobs.service`).

---

## [3.9.0-phase12] - 2026-04-21

### Feat — Web-parity Settings broker UX (Phase 1 + 2)

Ports the `/subscriptions` page's two headline UX wins from web (`prod-alphaquark-github/src/Home/Subscriptions/subscription.js`) into the mobile `ManageConnectionsModal`:

**Phase 1 — "+ Connect new broker" CTA inside Manage Connections** (`src/screens/Home/ManageConnectionsModal.js` + `src/screens/Home/SubscriptionScreen.js`). Previously the mobile "Connect Broker" button only rendered when zero brokers were connected, so adding a 2nd/3rd broker required closing Settings and finding another entry point. Manage Connections now includes a dashed-outline button above the list that fires a new `onAddBroker` prop; `SubscriptionScreen` wires it to close Manage Connections and open `BrokerSelectionModal`.

**Phase 2 — Smart credential re-auth routing** (new `src/utils/reauthHelpers.js` + `src/utils/brokerCredentials.js`, plumbed through `modalStore.openModal(name, payload)` → `ModalManager` → per-broker modals). For Upstox / ICICI Direct / HDFC Securities / Motilal Oswal / Fyers, clicking Reconnect now:

1. Calls `PUT /api/user/brokers/{broker}/primary` to flip primary up-front (matches web `subscription.js:161` intent-to-primary).
2. Calls `GET /api/user/brokers/{broker}/reauth-url`, which uses saved credentials on the backend to build the broker's OAuth URL.
3. Decrypts the stored `apiKey` / `secretKey` / `clientCode` client-side from `userDetails.connected_brokers[]` (CryptoJS AES with `'ApiKeySecret'` passphrase — same scheme used by every credential modal already).
4. Dispatches `openModal(key, { reauthConfig: { authUrl, apiKey, secretKey, clientCode } })`. Each of the 5 credential modals gains a `reauthConfig` prop + hydration `useEffect` that pre-fills state and jumps straight to `showWebView=true` — the credential-form step is skipped entirely.

Result: session-expired re-auth for the 5 credential brokers no longer requires re-entering API keys, matching the web experience. Kotak (TOTP) and Groww (fresh creds) are unaffected — backend returns `requiresTotp` / `requiresForm` and the code falls back to opening the full modal. Partner-OAuth brokers (Zerodha / Angel One / Dhan / AliceBlue / Axis) are also unaffected — they never had a credential form to skip.

**Fyers naming quirk**: Fyers' modal state uses `apiKey` for the OAuth secret and `secretKey` for the clientId, opposite of DB storage (`credentials.secretKey` = secret, `credentials.clientCode` = clientId). The hydration `useEffect` in `FyersConnect.js` does the swap; the `reauthConfig` payload itself uses DB field names to stay uniform.

**Out of scope (Phase 3 + 4, next PR)**: Primary-broker star badge, token-expiry date display, tri-state status (Connected/Expired/Saved) sort, promoting the Settings surface. Documented in `BROKER_CONNECTION.md` `## Smart re-auth routing (2026-04-21)`.

Files changed:
- `src/screens/Home/ManageConnectionsModal.js` — `onAddBroker` prop + CTA button, rewritten `handleReconnect` with smart routing + per-broker `reauthing` loading state.
- `src/screens/Home/SubscriptionScreen.js` — wires `onAddBroker` to `setModalVisible(true)`.
- `src/utils/reauthHelpers.js` — new (`handleSmartReauth`, `flipPrimaryBroker`, `CREDENTIAL_REAUTH_BROKERS`).
- `src/utils/brokerCredentials.js` — new (`getStoredBrokerCreds`).
- `src/GlobalUIModals/modalStore.js` — `modalPayload` state + `openModal(name, payload)`.
- `src/GlobalUIModals/ModalManager.js` — forwards `modalPayload.reauthConfig` to modals.
- `src/components/BrokerConnectionModal/upstoxModal.js` — `reauthConfig` prop + hydration `useEffect`.
- `src/components/BrokerConnectionModal/icicimodal.js` — ditto.
- `src/components/BrokerConnectionModal/HDFCconnectModal.js` — ditto.
- `src/components/BrokerConnectionModal/MotilalModal.js` — ditto.
- `src/components/BrokerConnectionModal/FyersConnect.js` — ditto (with the Fyers naming swap).
- `docs/BROKER_CONNECTION.md` — new `## Smart re-auth routing (2026-04-21)` section + updated Manage Connections bullets.

---

## [3.8.9] - 2026-04-20

### Docs — APP_ARCHITECTURE + REBALANCING backfill for B1/B2/DDPI commits

Backfill doc update for three earlier commits that landed their code + BROKER_CONNECTION.md + CHANGELOG.md entries but missed their secondary architecture docs. The app's `CLAUDE.md` overlap rule requires that a change to `StockAdvices.js` (listed in APP_ARCHITECTURE.md) update APP_ARCHITECTURE.md too, and DDPI changes invoked from the rebalance flow (`OtherBrokerModel.handleAcceptRebalance`, `AngleOneTpinModal` in rebalance-SELL path) warrant a REBALANCING.md entry.

**APP_ARCHITECTURE.md** — added two new subsections:

- *Trade/basket payload `user_email` contract (2026-04-20)* — documents the hard contract with the ccxt-india egress request hook: every `api/process-trades/order-place` payload must carry top-level `user_email` or whitelist-enforcing brokers reject the order. Lists all 7 app trade-flow callsites (the 3 patched in B1 `b36d981`, plus the 4 pre-existing). Covers the dual-key contract (snake_case `user_email` for new code, camelCase `userEmail` still accepted for 5 legacy `verify-edis` sites).
- *DDPI authorize-for-sell race (2026-04-20)* — documents the 6-callsite `await getUserDetails()` fix from `a6bbeae`, cross-references TradeContext's async `getUserDeatils` that returns the axios promise so the `await` takes effect.

**REBALANCING.md** — added two new subsections:

- *DDPI authorize-for-sell — `await getUserDetails` before reopening rebalance modal* — explains why the DDPI fix matters specifically for the rebalance flow: `OtherBrokerModel.handleAcceptRebalance` (line ~1966) and `AngleOneTpinModal` (line ~1115) are invoked from the rebalance SELL-side precheck, and the stale-userDetails race would re-trigger DDPI right after the user ticked authorize-for-sell. Same 6-callsite table as APP_ARCHITECTURE.md with rebalance context.
- *Rebalance-flow broker-auth error detection — expanded keyword set* — documents `isBrokerAuthError` keyword expansion from vansh's `3d77710` merge, specifically flagging Groww's `"Please Login and Try Again (Error: 401)"` pattern that previously caused dead-end "Unable to Rebalance" dialogs instead of the reconnect modal.

**Net code change: zero.** Pure doc backfill. Cites the original commit hashes (`b36d981` B1, `837975c` B2, `a6bbeae` DDPI, `3d77710` vansh merge) for traceability per the CLAUDE.md post-commit recovery guidance.

No CHANGELOG entry in BROKER_CONNECTION.md this time — it's already fully up to date from the earlier commits.

---

## [3.8.8] - 2026-04-20

### Docs — EgressIpCallout parity audit (Group D, no code change)

Ports web `b25d105` (UI polish + visible error state + steps preamble), `0f1f3bf` (no-opt-out hard-gate), and `fca0620`'s red-flash half (the HDFC/ICICI/Upstox step-text half was ported in Group C3/C4/C5).

**Net code change: zero.** The app's `src/components/BrokerConnectionModal/EgressIpCallout.js` (706 lines) already implements every feature covered by these three web commits — they were ported piecewise during the earlier broker wire-up commits (`321fb92` wired Upstox/Fyers/Motilal/HDFC/ICICI + `99a0c69` wired Kotak). Groww was added in `7fa7e10` (Group G).

Audited the app file line-by-line against web's final state:

- `showUnmetAck` → `flashAck` red pulse (`Animated.sequence`, lines 216–248) ✅
- Red-ring + `⚠ Please tick this box...` warning when flashing (lines 441–472) ✅
- Hard-gate: `onAcknowledgeChange(false)` for `unclaimed`, `ipv4_provisioning`, `loading`, `error`, `claiming`, and `claimed` pre-acknowledgment (line 213) ✅
- Visible error state + Retry button (lines 308–326) ✅
- Steps preamble + a/b/c numbered steps in `claimed` state using `brokerDevPortal` + `brokerHint` maps (lines 408–439) ✅
- Partner broker short-circuit with `onAcknowledgeChange(true)` (lines 205–207) ✅
- `ipv4_provisioning` amber hard-block panel with SEBI rationale, no opt-out (lines 328–353) ✅
- Migration banner (lines 276–290) ✅

Wire-up count: 7 app screens now render `EgressIpCallout` (Upstox, Fyers, HDFC, ICICI, Kotak, Groww, BrokerCredentialScreen/Fyers branch). Motilal intentionally doesn't — swapped in Group C2 for the shared-server-IPv4 static callout.

The 230-line delta between app (706) and web (936) is cosmetic (Tailwind classes vs inline `StyleSheet`). No behavioural divergence.

See `docs/BROKER_CONNECTION.md` → *EgressIpCallout polish — parity audit* for the full per-feature table.

---

## [3.8.7] - 2026-04-20

### Changed — Per-broker polish [Group C]

Five focused per-broker fixes bundled (each ports a discrete web commit).

**C1 — Kotak mobile pre-fill on reconnect** (web `933e9a4`): `src/components/BrokerConnectionModal/KotakModal.js` — on mount/when `userDetails` arrives, read `connected_brokers[broker=Kotak].mobileNumber` (primary) with fallback to legacy top-level `phone_number`, strip the `+91` prefix, and pre-fill the 10-digit input so returning users don't have to retype it every reconnect. Only fires when the form field is empty, so in-progress edits aren't overwritten.

**C2 — Motilal server-IPv4 static callout** (web `156589e`): `src/UIComponents/BrokerConnectionUI/MotilalConnectUI.js` — Motilal is IPv4-only; all calls route through the server's shared static IPv4 (`72.61.251.253`) via an IPv4-pinned session on ccxt-india. Replaced the broker's `<EgressIpCallout broker="motilaloswal" ...>` render with an inline static callout (IP + Copy + acknowledgment checkbox + red-flash on unmet ack). Dropped the `EgressIpCallout` import from MotilalConnectUI. Copy button uses the app-wide global-`Clipboard` pattern (same as `HelpModal.js`, `KotakConsumerKeySteps.js`, `DdpiModal.js`) with a try/catch fallback toast for platforms that don't expose a shim.

**C3 — Upstox Help Content step 3 "Allowed IPs" mention** (web `608c9d4`): `src/UIComponents/BrokerConnectionUI/HelpUI/UpstoxHelpContent.js` — prepended a sentence to step 3 telling the user to paste the dedicated static IP (from the in-form whitelist panel) into Upstox's "Allowed IPs" field, with `UDAPI1154 "static IP mismatch"` as the rejection rationale. The IP guidance now comes before the Redirect URL text so it's less likely to be missed on Upstox's "Create App" form.

**C4 — HDFC Help Content step 4 "Allowed IPs" mention**: `src/UIComponents/BrokerConnectionUI/HelpUI/HDFCHelpContent.js` — step 4 now instructs the user to paste the dedicated static IP into InvestRight's "Allowed IPs" field alongside setting the redirect URL. Same structural change as Upstox C3.

**C5 — ICICI Help Content step 2 "IP Whitelist" mention**: `src/UIComponents/BrokerConnectionUI/HelpUI/ICICIHelpContent.js` — step 2 now instructs the user to paste the dedicated static IP into Breeze's "IP Whitelist" field alongside the Redirect URL. Same structural change as Upstox C3 and HDFC C4.

See `docs/BROKER_CONNECTION.md` → *Per-broker polish (Group C)* for per-file rationale.

---

## [3.8.6] - 2026-04-20

### Fixed — DDPI authorize-for-sell race (await getUserDetails before reopening)

Ports web `e73bd81` Issue 3. Fixes the sporadic "authorize-for-sell checkbox isn't sticking" UX — user ticks Authorize for Sell in DDPI, modal closes, rebalance/review modal reopens and immediately re-fires DDPI as if the tick never happened.

**Root cause:** `DdpiModal.handleProceed` writes `PUT /api/update-edis-status` (server-side flip of `is_authorized_for_sell: true`) then calls `setIsOpen(false)` + `reopenRebalanceModal()`. `getUserDetails()` was **fire-and-forget** — the reopened modal read stale userDetails (`is_authorized_for_sell=false`) and re-triggered DDPI.

**Fix:** Added `await` to all 6 `handleProceed`-style callers in `src/components/DdpiModal.js`:

- `handleProceed` (main `DdpiModal` default export, line ~133)
- `AngleOneTpinModal.handleProceed` (line ~1115)
- `DhanTpinModal.handleProceed` (line ~1339)
- `OtherBrokerModel.handleContinue` (add-to-cart flow, line ~1902)
- `OtherBrokerModel.handleAcceptRebalance` (rebalance flow, line ~1966)
- `FyersTpinModal.handleProceed` (line ~2540)

All 6 containing functions were already `async`, so no function-signature changes were needed. `TradeContext.getUserDeatils` (the central source) is already `async` with `await axios.get(...)`, so it implicitly returns a Promise — `await` at the DdpiModal call site now properly waits. For unported parent pages whose `getUserDetails` doesn't yet return a promise, `await` on a sync function is a no-op — the fix degrades gracefully.

**Backend counterpart** (per web commit message, tracked server-side): `aq_backend_github/.../UpdateEdisStatus.js` returns `{new:true}` and only `$sets` the fields the client sent, so partial payloads stop clobbering sibling flags.

See `docs/BROKER_CONNECTION.md` → *DDPI authorize-for-sell* for the full rationale.

---

## [3.8.5] - 2026-04-20

### Docs — `angelone/verify-edis` dual-key contract (B3, no code change)

Ports web `e8b83eb` as a **doc-only port**. Web's commit added `user_email: userDetails?.email` to its own `DdpiModal.js` `AngleOneTpinModal` verify-edis call (a real miss on web that dropped `cid` resolution to `None`) AND locked in the **dual-key contract** — the ccxt-india egress hook accepts both `user_email` (snake_case) and `userEmail` (camelCase) so legacy callsites that have been sending camelCase for years keep working without a rewrite.

Audited all 5 app `angelone/verify-edis` callsites — **all 5 already send camelCase `userEmail`**:

- `src/components/DdpiModal.js:~1029` — AngleOneTpinModal auto-fetch EDIS status
- `src/components/AdviceScreenComponents/StockAdvices.js:~145` — bespoke flow
- `src/components/AdviceScreenComponents/AddtoCartModal.js:~272` — Add-to-Cart flow
- `src/components/AdviceScreenComponents/RebalanceAdviceContent.js:~307` — rebalance flow
- `src/screens/Drawer/MPPerformanceScreen.js:~577` — MP performance screen

All resolve `cid` correctly on the server per the dual-key contract and bind the right per-customer IPv6 for the Angel One verify-edis call. No payload change required — rewriting five well-tested snake_case-equivalent payloads for no behavioral gain would be churn.

**Contract boundary going forward:** legacy callsites keep camelCase `userEmail`; new callsites added from 2026-04-15 onward (B1 trade/basket payloads, B2 finish-connection endpoints, G Groww submit) use snake_case `user_email` — the new canonical.

**Note on payload shape vs web:** the app's AngleOneTpinModal verify-edis payload omits `clientCode` because the Angel One app API key on mobile is advisor-level (`configData.config.REACT_APP_ANGEL_ONE_API_KEY`), not per-user encrypted. Both shapes resolve the same server-side.

See `docs/BROKER_CONNECTION.md` → *angelone/verify-edis — camelCase/snake_case dual-key contract* for the full contract.

---

## [3.8.4] - 2026-04-20

### Changed — Groww migrated from partner OAuth to API-Key + API-Secret + IP whitelist

Ports web `9ee7aed` + `1b090e3` + the Groww-relevant parts of `e73bd81`. Groww deprecated partner-API order placement in 2026-04 — the only supported path is now user-created approval-mode keys at [`groww.in/trade-api/api-keys`](https://groww.in/trade-api/api-keys), with a per-customer Route64 IPv6 whitelisted against those keys. Web's intermediate `635b6ef` live-TOTP form was reverted same-day (Groww's dashboard actually exposes two opaque strings, not a TOTP QR, for approval-mode keys); the app ports directly to the end state without the intermediate commit.

**`src/components/BrokerConnectionModal/GrowwConnectModal.js` — full rewrite.** Dropped the InAppBrowser OAuth flow (`InAppBrowser.openAuth` + Linking deep-link race + `handleGrowwCallbackUrl`). New flow: `EgressIpCallout` at top (gates submit via `egressReady` + `unmetAck` — same pattern as Upstox/Fyers/Motilal/HDFC/ICICI/Kotak), 4-step scrollable instructions, two `TextInput`s for API Key + API Secret. `handleSubmit` AES-encrypts both with `'ApiKeySecret'` (symmetric with every other credential broker — backend `checkValidApiAnSecret()` decrypts) and POSTs `{uid, user_email, user_broker: 'Groww', apiKey, secretKey}` to `${server}api/groww/update-key`. Amber note in Step 2 explains Groww's **daily approval requirement** — access tokens reset at 6 AM IST, users must re-approve each morning.

**`src/components/BrokerConnectionModal/EgressIpCallout.js`** — added `'groww'` to `WHITELIST_BROKERS` plus entries in `BROKER_DISPLAY_NAMES` ("Groww"), `BROKER_DEV_PORTAL_URLS` (`groww.in/trade-api/api-keys`), and `BROKER_WHITELIST_HINT` ("Trade API → Create API Key + Secret → Whitelisted IPs").

**`src/components/TokenExpireBrokerModal.js`** — removed `'Groww'` from `OAUTH_BROKERS` AND added a `handleGrowwReconnect` handler + dedicated `broker === 'Groww'` reconnect button that dispatches `useModalStore.getState().openModal('Groww')` — the RN equivalent of web `e73bd81`'s `aq:open-broker-connect` DOM event pattern. Without this, Groww users with expired sessions would see the modal render neither the OAuth button nor a credential form and get stuck.

**`src/config/brokerRegistry.js`** — Groww `authType: OAUTH → CREDENTIAL`. Added `fields: [{apiKey}, {secretKey}]` for any generic registry-driven renderer.

**`src/utils/brokerAuth.js`** — Groww config `authType: 'oauth_pkce' → 'credential'`. Dropped `loginUrlEndpoint` / `callbackEndpoint` / `maxConnections` (OAuth-specific). Added `requiresApiKey`, `requiresSecretKey`, `tokenGenEndpoint: '/api/groww/update-key'`, `tokenExpiry: 'daily_6am_ist'`.

**Existing Groww users on partner OAuth tokens** keep working until their tokens expire (~24h), then flow through the new credential form on reconnect. No proactive migration UI — same approach as the web-side rollout. Deploy ordering: ccxt-india first (makes `/groww/generate-token` available), then `aq_backend_github` (new `/api/groww/update-key` + daily refresh cron), then this app build.

**Known follow-ups (deferred):** `SubscriptionScreen.js:77-97` still calls `${ccxtServer}groww/revoke` on disconnect — after migration that endpoint may not exist server-side; the call is already wrapped in try/catch so it's non-fatal, but should be dropped in a cleanup pass. `src/UIComponents/BrokerConnectionUI/GrowwConnectUI.js` + `GrowwConnectUI1.js` are vestigial (not imported anywhere) and should be deleted. Web `e73bd81` also fixed a DDPI / authorize-for-sell race (unrelated to Groww) — tracked as separate task.

**Vansh's `3d77710`** already added Groww to `ManageConnectionsModal.BROKER_MODAL_KEY_MAP` (`'Groww' → 'Groww'`), so the per-row Reconnect button on expired Groww sessions dispatches to `openModal('Groww')` → renders the new credential form. No additional changes needed in ManageConnectionsModal.

See `docs/BROKER_CONNECTION.md` → *Groww migration* for the full rationale.

---

## [3.8.3] - 2026-04-20

### Fixed — `user_email` at top level of post-OAuth finish-connection endpoints (egress IP hook) — B2

Ported web commit `d3f9078` (`fix(broker-connect): pass user_email on post-OAuth finish-connection calls`). After a broker OAuth WebView returns with an auth code/request token, the app POSTs to a ccxt-india "finish-connection" endpoint (e.g. `/zerodha/gen-access-token`) to exchange it for a session token. That outbound call proxies to the broker's API and needs the customer's whitelisted IPv6 — the ccxt egress hook resolves the customer from top-level `user_email` in the request body; without it, the call binds the shared `72.61.251.253` and brokers reject with session-mismatch / IP-not-whitelisted errors. On ICICI specifically this manifests as a Status:500 body returned as HTTP 200, so the frontend's `status === 200` check passes but `sessionToken` stays null and the success dialog never opens.

Added top-level `user_email` to 10 callsites across 10 files:

- **Zerodha** (`/zerodha/gen-access-token`, 5 sites): `src/UIComponents/BrokerConnectionUI/ZerodhaConnectUI.js` (step-1 access-token exchange), `src/UIComponents/BrokerConnectionUI/HelpUI/ZerodhaConnectModal.js`, `src/screens/Drawer/IgnoreTradesScreen.js`, `src/screens/Broker/BrokerAuthScreen.js` (generic WebView — Zerodha branch), `src/components/AdviceScreenComponents/StockAdvices.js` (connectZerodha). All parallel code paths patched per web-parity guidance since `BrokerModalRenderer` and the ignored-trades/advice flows still dispatch through the legacy UIs alongside the generic BrokerAuthScreen.
- **Upstox** (`/upstox/gen-access-token`, 1 site): `src/components/BrokerConnectionModal/upstoxModal.js` (connectUpstox).
- **Fyers** (`/fyers/gen-access-token`, 2 sites): `src/components/BrokerConnectionModal/FyersConnect.js` (connectFyers), `src/screens/Broker/BrokerCredentialScreen.js` (generic credential screen — Fyers branch).
- **IIFL** (`/iifl/login/client`, 2 sites): `src/components/iiflmodal.js`, `src/components/iiflproceedmodal.js` — both `handleIIFLLogin` postback handlers.

Every targeted file already had `userEmail` in scope (either via Firebase `getAuth().currentUser?.email`, a passed prop, or a local `const userEmail = user?.email` — no new imports needed).

**Already had `user_email` (no change):** `src/components/BrokerConnectionModal/HDFCconnectModal.js` was patched on 2026-04-18 as part of the HDFC payload-parity fix; `src/utils/ProcessTrades.js` already carried top-level `user_email` on trade payloads from an earlier port.

**Intentionally skipped:**
- **Groww** — prod migrated Groww from partner OAuth to API-key + IP whitelist (commits 9ee7aed + 635b6ef, 2026-04-20). The app's current Groww OAuth code path is being retired in the follow-up G1+G2 commits; adding `user_email` to a to-be-deleted path would be churn.
- **AliceBlue** — app uses a WebView redirect URL (`${ccxtServer}aliceblue/login?origin=…`), not a body POST, so there's no JSON body to carry `user_email`. Web's commit added it to a client-side `aliceblue/login` POST site that doesn't exist on the app after the 2026-04-18 AliceBlue WebView migration.
- **ICICI customer-details** — removed on app in the Option-B ICICI migration (2026-04-17), handled server-side in `icici/auth-callback/{subdomain}`.

See `docs/BROKER_CONNECTION.md` → *Finish-connection endpoints* for the full callsite table. B3 (verify-edis) is the follow-up.

---

## [3.8.2] - 2026-04-20

### Fixed — `user_email` at top level of `/api/process-trades/order-place` payloads (egress IP hook) — B1

Ported web commit `ea970e4` (`fix(broker-connect): top-level user_email in basket + trade payloads`). The ccxt-india egress request hook resolves the customer's Route64 IPv6 from `request.body.user_email` — when missing, the outbound broker call binds the shared `72.61.251.253` and whitelist-enforcing brokers (Upstox in particular) reject with `UDAPI1154 — static IP does not match request origin IP`. The Node backend's `Routes/Broker/ProcessTrades.js → createPayload()` only forwards `user_email` to ccxt if it was present on the incoming body at the **top level** (per-trade-row copies get stripped during payload construction). Three files carried basePayloads that constructed the trade-place payload without a top-level `user_email`:

- `src/components/AdviceScreenComponents/StockAdvices.js` — bespoke trade flow. Added `user_email: userEmail` to both the GTT `gttPayload` (line ~569) and regular `basePayload` (line ~586). The `userEmail` prop is already passed into the component (`StockAdvices = React.memo(({ userEmail, ... })`).
- `src/components/AdviceScreenComponents/AddtoCartModal.js` — Add-to-Cart review flow. Two payload sites: the broker-switch `basePayload` (line ~484) and the cart-path `getOrderPayload` returning `{trades: cartItems, user_broker, accessToken}` (line ~624). Both now include `user_email: userEmail` (already in scope via `const userEmail = user?.email;`).
- `src/screens/Drawer/IgnoreTradesScreen.js` — ignored-trades retry flow. Added `user_email: userEmail` to the `basePayload` at line ~484 (already in scope via `const userEmail = user && user.email;`).

`src/utils/ProcessTrades.js` already carried `user_email` at the top level of both GTT and regular payloads (lines 242, 270) — no change needed.

Without this fix, basket/bespoke order placement from these three flows would fail on whitelist-required brokers even after the customer's IPv6 was correctly provisioned, because the egress hook had no way to resolve the customer identity from the payload.

See `docs/BROKER_CONNECTION.md` → *Per-customer egress IP contract* for the full contract. B2 (OAuth finish-connection endpoints) and B3 (`verify-edis`) are follow-ups.

---

## [3.8.1] - 2026-04-17

### Fixed — LTP stream was never delivering prices; app showed ₹0 Total Current and N/A table rows (2026-04-20)

`src/FunctionCall/useWebSocketCurrentPrice.js` — the hook connected to the wrong socket server on the wrong namespace with the wrong handshake, so `getLTPForSymbol` returned 0 for every symbol. The only reason some screens looked like they had prices before yesterday was the `averagePrice` fallback in the MP Performance table (removed yesterday to match web's N/A behavior) — which exposed the underlying dataflow break.

Four divergences from `prod-alphaquark-github/src/context/MarketDataContext.js` fixed:

| Aspect | Before (broken) | After (matches web) |
|---|---|---|
| Server | `wss://ccxt.alphaquark.in` (from `serverConfig.ccxtWs.baseUrl`) | `https://websocket.alphaquark.in` — derived from `server.websocket.baseUrl` which was already in `serverConfig.js` but unused; matches web (`prod-alphaquark-github/src/utils/serverConfig.js:13` → `MarketDataContext.js:268`). The earlier attempt in 40b0dcb pointed at `ccxtprod.alphaquark.in` which hosts the same ccxt app but mounts the REST route at `/websocket/subscribe-array` (not `/subscribe-array`). `websocket.alphaquark.in` is the canonical host for the price feed and matches web's path layout. |
| Namespace | default `/` | `/ltp` — `io(`${ccxtUrl}/ltp`, …)` |
| Handshake | none | `socket.emit('subscribe_me', { userEmail, dbName })` on `connect`; `userEmail` from `getAuth().currentUser`, `dbName` from `Config.REACT_APP_HEADER_NAME || REACT_APP_URL || REACT_APP_ADVISOR_SUBDOMAIN` |
| Subscribe REST | per-symbol `POST /websocket/subscribe` (unrelated endpoint) | batched `POST ${ccxtUrl}/subscribe-array` with `{ symbolExchange, userEmail, dbName }` |
| Events | only `market_data` | both `ltp_update` (primary payload `{ symbol, ltp }`) AND `market_data` (alt payload `{ stockSymbol, last_traded_price }`) |

Kept the hook's public surface identical (`{ ltp, getLTPForSymbol }`) so all 7 callers (`AfterSubscriptionScreen`, `ModelPFCard`, `PortfolioScreen`, `MPStatusModal`, `RebalanceModal`, `MPReviewTradeModal`, `UserStrategySubscribeModal`) work without any call-site changes. Added queueing for subscriptions requested before the socket finishes connecting, and re-subscribe logic for the reconnect case. Prices now round-trip for all screens consuming the hook, so the MP Performance screen shows real Current Price / Returns / Total Current values instead of N/A / ₹0.

### Fixed — Duplicate tab bar + under-featured holdings table on MP Performance screen (2026-04-20)

`src/screens/Home/AfterSubscriptionScreen.js` — the Portfolio Distribution tab rendered `<DistributionGrid />` without a `type` prop, which made the child render its own internal "Portfolio Distribution / Portfolio Holdings" tab switcher on top of the screen's own outer TabView — two tab bars stacked, showing "Portfolio Holdings" twice. Additionally the outer Portfolio Holdings table was a 4-column simplified view (Stock / Current / Avg Buy / P&L %) while the inner duplicate one had a more detailed 6-column version (Stock / Current Price / Avg. Buy / Returns / Weight / Shares) users preferred.

Fix:
1. Pass `type="MPPerformanceScreen"` to `DistributionGrid` — `DistributionRowGrid.js:240-272` already branches on this and hides the inner tabs, rendering only the distribution grid. Removes the duplicate tab bar.
2. Rebuilt the outer holdings table to the 6-column detailed layout: Stock / Current Price / Avg. Buy / Returns / Weight / Shares, wrapped in a horizontal `ScrollView` since six columns don't fit on narrow phones. Kept the 2026-04-20 N/A fallback behavior (no `avg` fallback for current price), kept header/cell widths consistent, kept the "Prices may be delayed" footer. `MPPerformanceScreen.js` already passes `type={'MPPerformanceScreen'}` to its own `DistributionGrid` call, so only `AfterSubscriptionScreen` was affected.

Net effect: one tab bar ("Portfolio Holdings" / "Portfolio Distribution"), and the Portfolio Holdings tab now shows the fuller table users wanted.

### Fixed — MP Performance table rows silently fell back to avg when LTP missing (2026-04-20)

`src/screens/Home/AfterSubscriptionScreen.js` — the top-card `TOTAL CURRENT` correctly skips stocks without an LTP (matching web `StrategyDetailsWithPortfolioData.js:596-601`), but `tableData.currentPrice` was falling back to `averagePrice` when live WebSocket + saved snapshot + ccxt cache all missed. Symptom: MP plan showed "TOTAL CURRENT ₹0 / CURRENT RETURNS -100%" while the Portfolio Holdings rows read "GTLINFRA-EQ Current ₹1.24 / Avg Buy ₹1.24 / P&L +0.0%" — a user-confusing split signal where row-level "Current" was actually just the avg-buy number echoed back.

Aligned with web's `tableData` block (`StrategyDetailsWithPortfolioData.js:614-632`): added a `hasValidPrice` gate (`resolvedLtp !== null && !isNaN && !== 0 && avg !== 0`) and emit the string `'N/A'` for `currentPrice` / `returns` when LTP is unavailable. Kept the mobile-only snapshot + ccxt-cache fallbacks in the resolution chain (legitimate offline sources — mobile WebSocket isn't always connected); only the `avg` last-resort fallback was dropped. Row renderer updated to show literal `N/A` text and a neutral gray for the returns cell in those cases. `avgBuyPrice` still renders so users can see what they paid.

### Fixed — Broker header and Funds Info card show different brokers after aborted Reconnect (2026-04-20)

`src/screens/Home/SubscriptionScreen.js` — the `onReconnect` handler wired on 2026-04-18 did an optimistic `setBroker(expiredBroker)` before dispatching the per-broker modal. Symptom seen on 2026-04-20: header showed "**Dhan** Broker Connected" while the "Your Broker & Funds Info" card below still said "Broker: **Groww**" with Groww's ₹0 cash.

Root cause was classic optimistic-update-without-rollback. `TradeContext`'s `broker` and `userDetails.user_broker` are two copies of the same logical value — `getUserDeatils()` (`TradeContext.js:937-941`) always updates both atomically from the same backend response. They can only drift when `setBroker()` fires without an accompanying `setUserDetails()`. The optimistic `setBroker('Dhan')` in `onReconnect` did exactly that, and if the user then **aborted** the per-broker modal (closed it before finishing OAuth), nothing else would ever resync — `DhanConnectModal.js:170-174`'s `fetchBrokerStatusModal` + `getUserDeatils` calls only fire on successful `PUT /api/user/connect-broker`.

Fix: removed the `setBroker(expiredBroker)` line. The handler now only calls `fetchBrokerStatusModal()`, which is a no-op on abort (backend state unchanged). On a real reconnect, the per-broker modal's own `PUT /api/user/connect-broker` sets `user_broker` on the backend and the follow-up `getUserDeatils()` snaps both `broker` and `userDetails` to the new value in a single commit.

No parity concern with web: web's reconnect path writes via the same `/api/user/connect-broker` route and doesn't pre-switch active state either. Aligned behavior.

### Changed — Manage Connections Reconnect opens per-broker modal directly (2026-04-20)

Removed the one-tap detour introduced on 2026-04-18 where the Reconnect button funneled through `BrokerSelectionModal` (the broker picker). Now matches web's `TokenExpireBrokarModal` pattern: one tap → the expired broker's own connect modal opens directly.

- **`src/screens/Home/ManageConnectionsModal.js`** — added a `BROKER_MODAL_KEY_MAP` that translates the backend `connected_brokers[].broker` value to the `ModalManager` switch key (e.g., `'ICICI Direct' → 'ICICI'`, `'Hdfc Securities' → 'HDFC'`, `'Motilal Oswal' → 'Motilal'`, `'IIFL Securities' → 'IIFL'`). `handleReconnect()` now closes Manage Connections, optionally fires `registerCallback('angelone', '/stock-recommendation')` when the broker is Angel One (matching `BrokerSelectionModal.handleBrokerSelect:240-242`), calls `onReconnect?.(broker)` so the parent can refresh state, then dispatches `useModalStore.getState().openModal(modalKey)` — the globally mounted `ModalManager` (mounted at `App.js:217` inside `TradeProvider`) renders the per-broker modal. If a broker isn't in the map (shouldn't happen now that all 13 are covered), we fall back to the parent's `onReconnect` callback.
- **`src/screens/Home/SubscriptionScreen.js`** — the `onReconnect` callback no longer opens `BrokerSelectionModal` via `setTimeout(setModalVisible(true), 0)`. It just calls `setBroker(expiredBroker)` + `fetchBrokerStatusModal()` so the header reflects the newly-active broker while the per-broker modal is open. One fewer modal on screen, one fewer tap for the user.
- **`src/GlobalUIModals/ModalManager.js`** — added `case 'IIFL'` / `case 'IIFL Securities'` → `IIFLModal` (the import was already there; just the switch case was missing). `case 'Axis Securities'` was already added in the 2026-04-20 Axis-palette fix. All 13 supported brokers now route through `ModalManager`.

Behavior: user opens Manage Connections → sees expired brokers with amber "Session Expired" + "Reconnect" button → taps Reconnect → Manage Connections closes → the broker's own partner-OAuth consent flow (Angel One / Dhan / Groww / AliceBlue / Axis) or dev-credential form (Zerodha / Upstox / Fyers / ICICI / HDFC / Motilal / Kotak / IIFL) appears immediately. No picker in between. Matches web parity.

### Fixed
- **Axis Securities missing from broker palette** (2026-04-20): `BrokerSelectionModal.js:brokersmain` hard-codes 11 brokers and Axis wasn't among them, so the tile never rendered even though all downstream plumbing — `brokerRegistry.js`, `AxisConnectModal.js` (full SSO flow: `axis/login-url` → WebView → `ssoId` intercept → `axis/callback` → `PUT /api/user/connect-broker`), `brokerAuth.js`, `brokerSupport.js`, `ProcessTrades.js`, `fetchFunds.js`, `TokenExpireBrokerModal.js` — was already wired. Additionally `GlobalUIModals/ModalManager.js` had no `case 'Axis Securities'` branch, so even adding the tile wouldn't have opened anything. Fix: (1) copied `prod-alphaquark-github/src/assests/Broker/Axis.png` to `src/assets/axis.png`; (2) added Axis entry to `brokersmain` keyed as `'Axis Securities'` (matches the `user_broker` value the rest of the codebase expects) with `simplehai.axisdirect.in` URL; (3) imported `AxisConnectModal` in `ModalManager.js` and added the `case 'Axis Securities'`; (4) renamed the modal's prop `isOpen` → `isVisible` (consistent with every other modal the dispatcher renders) and moved `userEmail`/`userId`/`configData` sourcing to internal hooks (`getAuth()` + `useTrade()` + `GET /api/user/getUser/<email>`) to match `FyersConnect.js`, since `commonProps` in `ModalManager` doesn't spread them. No backend change; no flow change.
- **Limit-price lost on cart refresh + decimals silently truncated**: `StockAdvices.js:handleLimitOrderInputChange` — the handler called `parseInt(value)` and only updated local state, so a user-entered ₹123.45 became `123` and anything entered was wiped by the next `getCartAllStocks()` refresh. Aligned with web `NewStockCard.js:774-820`: validates input against `/^\d*\.?\d{0,2}$/` and stores the string as-is (no `parseInt`), then `POST ${server.server.baseUrl}api/cart/update` with `{ tradeId, price: formattedValue }` using the existing `generateToken` + `REACT_APP_HEADER_NAME` header pattern, and re-pulls cart state via `getCartAllStocks()` on success. Errors are logged and non-fatal — local state is already updated so the user sees their entry immediately.
- **Transient broker errors force re-login during maintenance windows**: `src/utils/rebalanceHelpers.js` — ported `TRANSIENT_NON_AUTH_BROKER_ERROR_CODES`, `isTransientFundsError` (alias `isTransientBrokerError`), and `detectTransientOrderWindowError` from web (`prod-alphaquark-github/src/utils/rebalanceHelpers.js:15-105`). Updated `isFundsErrorOrMissing` to short-circuit (`return false`) when the response is a known transient error (Upstox `UDAPI100072`/`UDAPI100074` during the nightly 00:00–05:30 IST funds/place-order maintenance window, plus message-based heuristics like "temporarily unavailable" / "try again" / "service window" / "market hours"). Rebalance flow now keeps cached funds instead of bouncing the user into the broker-reconnect modal when the failure is documented-transient. Wired `detectTransientOrderWindowError(response?.data)` at the two all-orders-failed sites to swap the internal failure modal for a soft "Broker service window" toast and clean exit: `RebalanceModal.js:~1417` (bespoke/MP rebalance via backend process-trade) and `MPReviewTradeModal.js:~486` (MP subscription order placement via `api/model-portfolio-place-order`). Both call `enrollStatusCheckQueue` / `getRebalanceRepair` so the failed rows come back ready for retry when the window reopens. Fyers publisher path at `MPReviewTradeModal.js:~1291` intentionally left unchanged — publisher SDK flow is mobile-specific and its status-recording chain must run even on transient failure.
- **Basket card color drift from web**: `BasketCard.js` — regular-state basket card was a pure green gradient (`#0F3E00 → #29A400`), while the web user-side uses a dark navy gradient (`#000C18 → #002C59 → #000C18`) with a translucent green accent border (`#1E9F40` @ 30%). Swapped `getGradientColors()` regular-state return to the navy palette and conditionally applied the green accent border when `!isExpired && !isClosureBasket`. Expired (gray) and closure (red) recolorings retained as app-specific visual cues — minimal parity, not full parity with web's badge-only differentiation.
- **Recommendation visibility window ignored on app (shows ~15 days regardless of admin 7-day setting)**: `TradeContext.js:134` — `fetchAdviceShowDays` was reading `response.data?.adviceShowLatestDays`, but `/api/admin/frontend-config` returns `{ success, data: { adviceShowLatestDays } }`. The wrong path yielded `undefined` → `Number(undefined) === NaN` → `setAdviceShowDays` never fired → the app kept the `useState(15)` fallback. Fixed to `response.data?.data?.adviceShowLatestDays` (matching web `AdminSettings.js:1311`). Paired with an `aq_backend_github` fix so the admin UI's saved value actually persists — `Routes/Admin/updateTermsConditions.js` now writes to both `AdminAccess.adviceShowLatestDays` (legacy) and `AllAdvisorDetails.advice_show_latest_days` (what `loginRoutes.js:92` reads first; previously the admin's POST never touched this field so refresh always reverted to the schema default `7`).
- **Research Report row action**: `ResearchReportScreen.js` — replaced the external-link icon with a download icon and swapped the tap handler from "open in in-app `WebView`" to a silent `RNFS.downloadFile` into `DownloadDirectoryPath` (iOS: `DocumentDirectoryPath`). Android WebView can't render PDF presigned URLs natively, so the prior flow opened a blank/closing modal. The new flow fetches the presigned URL (falling back to `comms/research-report-link/<advisorTag>/<symbol>`), streams the PDF to `<symbol>_report_<ts>.pdf`, and toasts on completion. Removed unused state (`showPdfModal`, `selectedPdfUrl`, `webViewLoading`, `shouldLoadPdf`) and the entire PDF `Modal`/`WebView` block.
- **Plans tab missing Model Portfolio tab**: `ModelPortfolioScreen.js` — tab visibility is now driven purely by the `config.bespokePlansEnabled` / `config.modelPortfolioEnabled` feature flags (defaulting to enabled when undefined, matching web). Previously a tab was hidden when its list had zero items, which collapsed the UI to a single full-width pill and hid MP entirely when an advisor had no MP strategies. Each tab's scene already renders its own empty state. Also aligned the bespoke flag source from `configData.config.REACT_APP_BESPOKE_PLANS_STATUS` to `config.bespokePlansEnabled` for consistency, and added `config` to the `useMemo` dep array.
- **Portfolio top card shows ₹0 P&L/Invested/Returns when plan selected**: `PortfolioScreen.js` — added a `planSummary` `useMemo` that aggregates `totalInvested` / `totalCurrent` / `totalReturns` / `returnsPercentage` client-side from `planHoldings` using live LTP, and wired `profitAndLoss` / `pnlPercentage` / `effectiveHoldingsData` to prefer it when the `All Holdings` tab is active AND a plan is selected. Previously these only switched on the MP tab (`selectedInnerTab === 1`), so plan-filtered rows rendered correctly in the list below but the summary card kept showing broker-wide aggregates (₹0 for test accounts with no direct broker holdings).

### Added
- **Bespoke Recommendations → Rejected tab**: `HomeScreen.js` — the "View All" page now has an Active / Rejected tab switcher above `<StockAdvices>`. Active renders `type='All'`; Rejected renders `type='OSrejected'` against `rejectedTrades`. `TradeContext.js` no longer double-pushes rejected bespoke into `recommended`, so rejected cards appear only in the Rejected tab (previously they showed in both). `StockCard.js` now renders `Ignore + Trade Now` buttons when `type === 'OSrejected'` (replacing `Add to Cart + Retry`) — Ignore wires into the existing `IgnoreAdviceModal` → `PUT /api/recommendation { trade_place_status: 'ignored' }`, Trade Now reuses `handleSingleSelectStock` to re-trigger the order via `ReviewTradeModal`. Basket-card behavior left unchanged (baskets never land in `rejectedTrades` today).

### Broker connection web-parity alignment (in progress)

Bringing every mobile broker-connection flow in line with the user-side web flow in `prod-alphaquark-github`. Container difference (WebView vs full-page redirect) is mobile-inherent and stays; everything else aligns. After a fresh per-file audit (replacing the initial plan which was based on incomplete data), the real state is:

**Decisions:**
- **Zerodha** — intentional divergence, no change. Mobile uses an advisor-shared Kite Connect app (`REACT_APP_ZERODHA_API_KEY`); web requires each user to register their own Kite Connect app and bring its apiKey + secretKey. Swapping would force adding a per-user credential form on mobile and break the simpler existing flow. Documented as "mobile variant".

**Verified already aligned (no change needed):**
- **Fyers** — `POST /api/fyers/update-key` with same payload as web.
- **Groww** — same `GET ccxt/groww/login/oauth?redirectUri=…` backend call as web; mobile uses `InAppBrowser` + Android App Links callback. Earlier "client-side PKCE" claim was incorrect.
- **Upstox / ICICI / HDFC entry points** — all already hit Node's `/api/<broker>/update-key` endpoints.
- **Angel One / Kotak / Dhan** — already aligned.

**Changed (2026-04-17):**
- **Motilal Oswal**: `MotilalModal.js:97-105` — added `user_broker: 'Motilal Oswal'` field to the `PUT /api/motilal-oswal/update-key` request body to match web's payload shape. Single-field payload parity fix, no UI change, no flow change.
- **Upstox**: `upstoxModal.js:114-119` — added `user_broker: 'Upstox'` field to the `POST /api/upstox/update-key` request body to match web's payload shape. Same pattern as Motilal.
- **AliceBlue**: `AliceBlueConnect.js` — swapped the hardcoded `https://ant.aliceblueonline.com/?appcode=7WMf5NotZe` authUrl for a new `buildAliceBlueAuthUrl()` that constructs `${ccxtServer}aliceblue/login?origin=…&returnPath=…` (matches web's `handleAliceBlueConnect` in `AllBrokerList.js:55-65`). `origin` + `returnPath` split from `REACT_APP_BROKER_CONNECT_REDIRECT_URL` via `URL` parser (fallback to static defaults if malformed). Existing WebView callback interception unchanged — the final redirect back to the mobile app still carries `user_broker=AliceBlue&status=0&access_token=…&client_id=…`. Now uses the same MongoDB origin-tracking flow web uses instead of going to AliceBlue's appcode URL directly.
- **ICICI Direct** (Option B — full web parity, breaking change): `icicimodal.js` + `HelpUI/ICICIHelpContent.js` — removed the client-side `apisession` interception → `ccxt/icici/customer-details` exchange → `PUT /api/user/connect-broker` chain. WebView now intercepts only the final `REACT_APP_BROKER_CONNECT_REDIRECT_URL` redirect after CCXT's server-side `/icici/auth-callback/{advisorSubdomain}` finishes the handshake and saves `session_token` server-side (matches web's `connectBroker.js:820-856` + instructions at `connectBroker.js:1697-1728`). Help content updated to show the new required Redirect URL `{ccxtServer}icici/auth-callback/{REACT_APP_HEADER_NAME}`. **Migration required**: existing mobile ICICI users must log into their ICICI developer dashboard and update the Redirect URL to the CCXT callback before reconnecting — the app shows a guided error if the legacy URL is still registered. No UI/form changes otherwise.
- **Axis Securities** (response-parsing bug fix, not a flow change): `AxisConnectModal.js` — on investigation, web's Axis flow also exchanges `ssoId` client-side (not server-side as the plan originally stated), so no Option-B shift was needed. But mobile's parsing of the `ccxt/axis/callback` response was stale: it read flat fields `authTokenAxis` / `refreshTokenAxis` off `.data` (which don't exist in the actual response), causing every Axis connect attempt to throw `"Missing auth token or account ID from Axis"`. Aligned to web (`StockRecommendation.js:1716-1728`): now reads the nested `.data.data` envelope, unwraps `authToken.token \|\| authToken` and `refreshToken.token \|\| refreshToken || ''`, and adds `metadata?.accounts?.[0]?.subAccountId` as a `subAccountId` fallback. Error messaging switched to "Missing credentials from Axis SSO response" to match web's wording.
- **HDFC Securities** (payload parity only): `HDFCconnectModal.js` — on investigation, web also does the `requestToken → accessToken` exchange client-side (`StockRecommendation.js:1500-1555`), so no Option-B shift was needed. Two payload fields aligned: (1) added `user_broker: 'Hdfc Securities'` to the `POST /api/hdfc/update-key` body (matching web `connectBroker.js:778-783`), (2) added `user_email` to the `POST ccxt/hdfc/access-token` body (matching web `StockRecommendation.js:1510-1515`). No UI/flow change.

### Fixed — Rebalance shows dead-end "Unable to Rebalance" for Groww 401 instead of Reconnect modal (2026-04-18)

`src/utils/rebalanceHelpers.js:170-189` — `isBrokerAuthError()` was missing several broker-forwarded 401 phrasings, which caused the rebalance flow to dead-end at `RebalanceModal.js:1972-2026` (the generic `calculatedPortfolioData.status === 1` empty state with a "Go Back" button) instead of routing into the `TokenExpireBrokerModal` for reconnection.

Reproduction seen on 2026-04-18 with Groww as the active broker: `POST ccxt/rebalance/calculate` returned `{ status: 1, message: "Please Login and Try Again (Error: 401)" }`. The existing keyword set (`invalid token`, `session expired`, `unauthorized`, `authentication`) matched **none** of that string, so `RebalanceAdvices.js:730-736` fell past the `setOpenTokenExpireModel(true)` branch and stored the response verbatim, leaving the user with no way forward short of killing the flow.

Added these case-insensitive keyword matches:
- `please login` / `please re-login` / `login required`
- `error: 401`
- `401 unauthorized`
- `token expired` (complement to existing `session expired`)

Now a Groww (or any broker) 401 routes into the per-broker reconnect modal automatically. Does NOT change any DB state — the stored `connected_brokers[].status` for Groww may still read `'connected'` in Manage Connections until the next reconcile; that's a separate backend concern tracked below.

**Backend reconciliation gap (not fixed here, documented for the next pass):** when the user sees an expired Groww token mid-rebalance, the backend route that surfaces the 401 doesn't currently write `status: 'expired'` back to the `connected_brokers[].status` field. So Manage Connections keeps showing Groww as "Active" until a successful reconnect resets state. A backend hook (in `ccxtprod.alphaquark.in`'s rebalance handler or a Node-side `api/user/brokers/{broker}/status` endpoint) is the correct fix — requires a separate backend PR and is out of scope for this mobile-only change.

### Added — Manage Connections surfaces session-expiry + Reconnect (2026-04-18)

Ports web's "expired broker" treatment into the mobile Manage Connections modal (`src/screens/Home/ManageConnectionsModal.js`), which previously showed a flat list of brokers and silently discarded the backend `status` field. Now matches web `BrokerCard.js:54-58`.

- **`ManageConnectionsModal.js`**:
  - Fetch mapping preserves `b.status` + `b.token_expire` from the `/api/user/brokers` response (previously stripped to only `broker`/`connected_at`/`is_active`/`has_credentials`). Added a derived `is_expired` flag covering `status === 'expired'` or `status === 'error'` (case-insensitive), matching the backend enum in `aq_backend_github/Models/userModel.js:78-82` and `MultiBrokerContext.js` BROKER_STATUS constants.
  - Renders an amber "Session Expired" badge next to the broker name when `is_expired` is true (same hue family as web's amber badge).
  - Renders a solid amber **Reconnect** button for expired rows. Clicking it fires `onReconnect(brokerName)` and closes the modal. For expired rows the Switch and Stored-Credentials badges are suppressed (Remove is still available to disconnect explicitly).
- **`SubscriptionScreen.js:499-512`**: wired a new `onReconnect` callback that calls `setBroker(expiredBroker)` to make the expired broker the active one in `TradeContext`, closes Manage Connections, then defers `setModalVisible(true)` via `setTimeout(..., 0)` so `BrokerSelectionModal` mounts after the previous modal has fully unmounted (matches the same RN commit-ordering pattern used in the Trade Now / review-modal fix in commit `ad68380`). From there the user taps the broker to start the correct per-broker auth path — partner OAuth for Angel One/Dhan/Groww/AliceBlue/Axis, dev-credential form for non-partners.

Scope note: mobile lacks per-broker modal state at `SubscriptionScreen` level (unlike web's inline connect flow), so Reconnect funnels through the existing `BrokerSelectionModal` rather than jumping straight into the per-broker modal. One extra tap vs web; no risk of mis-wiring individual broker modals. Deeper refactor (dispatching directly to the per-broker modal) deferred — `TokenExpireBrokerModal` still handles the mid-trade reconnect path that matters most.

### Fixed — Axis Securities missing from reconnect modal (2026-04-18)

`src/components/TokenExpireBrokerModal.js:10` — the `OAUTH_BROKERS` list omitted `'Axis Securities'`. When an Axis user's session expired, the modal would render with the generic title but **no button or form** — leaving the user stuck with no way to reconnect from the modal. Added `'Axis Securities'` to the list so the same partner-OAuth "Reconnect {broker}" button renders (matching web `TokenExpireBrokarModal.js:1027`). No other broker logic changed.

Note on wider reconnect-modal architecture (flagged, not fixed here): the `handleOAuthReconnect` callback wiring (the `checkValidApiAnSecret` prop) is vestigial — it closes the modal and calls an AES-decrypt helper with the broker name as input, which no-ops. Reconnection actually works only because closing the modal lets the parent flow re-trigger the broker-selection path on the next trade. Deeper fix deferred.

### Fixed — Bottom-bar "Trade (N)" counter stuck at 0 after Add to Cart (2026-04-17)

`src/components/AdviceScreenComponents/StockAdviceContent.js:740-745` — after the Option-B cart/trade-intent split (commit `ad68380`), the bottom-bar counter still read `stockDetails.length`, but `stockDetails` is no longer populated on Add-to-Cart — it's only set when the user hits a trade-intent boundary (single Trade Now or bottom-bar Trade N). Result: user tapped Add to Cart, cart grew, but the button label stayed "Trade (0)" and the button stayed disabled, making the cart-then-trade flow impossible.

Fix: the three references on that button (`disabled` check, the visual disabled style, and the label text) now read `cartContainer.length` — same source as the existing Select All / Deselect All toggle right next to it. When the user finally taps Trade (N), `handleTrade` already (since `ad68380`) merges `cartContainer` into `stockDetails` before opening the review modal, so the downstream flow is unchanged.

### Fixed — "Scale quantities by amount" Update button is a no-op (2026-04-17)

`src/components/ReviewTradeModal.js:handleFixSize` — entering an amount and tapping Update left all quantities at 1, silently doing nothing. Two root causes fixed together:

1. **Wrong price source.** The function read `getLastKnownPrice(symbol)` from `DynamicText/websocketPrice.js`, which is backed by a `WebSocketManager.lastPrices` Map populated by the legacy `market_data` socket event. The current deployment emits `ltp_update` instead, which writes to the Zustand `useLTPStore` (what `TotalAmountText` reads). The old Map stays empty, so `getLastKnownPrice` returned `null` for every symbol → `totalCurrentValue === 0` → fell into the fallback branch where the same null price meant quantities were set to `1`.

2. **Wrong allocation algorithm.** Even if the price source had worked, the proportional-by-current-value algorithm produced results inconsistent with the Note text above the button ("ensuring the total investment stays within the specified budget"). For a two-stock cart at ₹500 + ₹300 with a 2000 input, proportional gave 2 + 2 = ₹1600 (not maxing out budget); the label implied equal-budget split (2 + 3 = ₹1900, which is what users expect and what actually matches the Note). Web's `ReviewTradeModel.js:266-277` does something else again — `floor(2000/price)` per stock, producing ₹3800 on the same input, which exceeds the budget the user just entered. Mobile's Note text is correct; web's code contradicts its own label.

Fix: rewrote `handleFixSize` to (a) read prices from `useLTPStore.getState().ltps[symbol]` and (b) use equal-budget allocation — `amountPerStock = targetAmount / stockDetails.length`, then `quantity = Math.floor(amountPerStock / livePrice)`. Kept `Math.max(…, 1)` floor to avoid zero-qty orders. Dropped the unused `getLastKnownPrice` import (left a comment breadcrumb).

**Intentional divergence from web** on the algorithm — mobile matches the label it shows to the user, web's code doesn't. Flagged for a future web-side fix rather than porting web's bug to mobile.

### Fixed — "Trade Now" review modal shows extra cart items (2026-04-17)

`src/components/AdviceScreenComponents/StockAdvices.js` — tapping "Trade Now" on a single stock card was opening `ReviewTradeModal` with every item in the persistent cart (including stale rejected trades from prior sessions), not just the clicked stock. Root cause: mobile was using `stockDetails` as both "cart state" and "trade-intent state", which web keeps separate. `handleSingleSelectStock` calls `handleSelectStock('add')` first, which internally ran `updateCartStates(cartItems)` → `setStockDetails(cartItems)` — writing the full cart into trade-intent state right before the intended `setStockDetails([newStock])` reset. Because both writes happen post-`await`, React's commit ordering could leak the cart-write into the modal render.

Option-B structural fix (matches web `NewStockCard.js:561-587` + `StockRecommendation.js:544`):

- `updateCartStates` — now only writes `cartContainer`. The old `setStockDetails(items)` line is gone. `cartContainer` is the cart; `stockDetails` is the trade-intent payload the modal consumes. They stop sharing writes.
- `handleSingleSelectStock` — new inner `openReviewForSingle()` helper that sets `stockDetails` to `[newStock]` and defers `setOpenReviewTrade(true)` via `setTimeout(…, 0)`, matching web's one-tick deferral (`NewStockCard.js:585-587`). Applied to all 17 broker-specific branches in that function.
- `handleTrade` + `handleTradeNow1` (bottom-bar "Trade (N)") — now explicitly populate `stockDetails` from `cartContainer` before opening the modal, merging any in-flight `stockDetails` edits (quantity/price changes) so user edits are preserved. Since `updateCartStates` no longer mirrors cart → stockDetails, this sync has to happen at the trade-intent boundary.
- `syncCartWithStockDetails` useEffect — no longer writes `stockDetails`. Now populates `cartContainer` + `stocksWithoutSource` on mount/tab-change. `stockDetails` stays empty until the user actually triggers a trade-intent action (either single "Trade Now" or bottom-bar "Trade (N)"). Matches web's separation.

See `APP_ARCHITECTURE.md` §4.5.0 for the state-separation contract.

### DummyBroker — doc correction (no code change needed, 2026-04-17)

Audited DummyBroker handling on both sides. **It's already functionally aligned** — web and mobile hit the same endpoints with identical payload shapes, same retry-once-with-2s logic, same `HOLDINGS_REFRESH` event, same `getRebalanceRepair` call, same 2s/5s delayed resync. The prior `BROKER_CONNECTION.md` entry that labeled DummyBroker "mobile-only simulation" was incorrect — it's a cross-platform sentinel (`user_broker: "DummyBroker"`) for the "Continue without broker" and "manually placed" flows. Corrected the doc entry and added a "DummyBroker Flow" section to `BROKER_CONNECTION.md` with a per-step endpoint/payload parity table citing line numbers on both sides.

The only differences that remain are intentional platform-specific UX: toast library (react-hot-toast vs react-native-toast-message), wording ("Refresh the page" vs "Pull to refresh"), and header value source (`process.env.REACT_APP_URL` vs `configData.config.REACT_APP_HEADER_NAME`). Mobile also has an "already aligned" auto-execute optimization (`RebalanceModal.js:375-444`) that web doesn't — keeping it, since it's an improvement, not a drift.

### Trade placement — web-parity fixes (2026-04-17)

Audited `src/utils/ProcessTrades.js` against web's `prod-alphaquark-github/src/Home/ProcessTrades/ProcessTrades.js`. Per-broker credential payloads already matched exactly; three **response-handling** divergences found. Landed the two unambiguously safe fixes; two higher-risk GTT items and one EDIS-architecture item deferred pending a real GTT order test / product decision.

- **Case-insensitive rejection status detection**: `ProcessTrades.js:detectEdisFailures` — mobile was matching `orderStatus === 'REJECTED' \|\| orderStatus === 'FAILURE'` (uppercase-exact), silently treating `Rejected` / `cancelled` / `Failure` responses as successful and therefore never firing the TPIN/EDIS modal for them. Replaced the comparison with a `REJECTED_ORDER_STATUSES` set covering all 9 variants web checks (`ProcessTrades.js:363-373`): `REJECTED`/`Rejected`/`rejected`, `CANCELLED`/`Cancelled`/`cancelled`, `FAILURE`/`Failure`/`failure`. Strictly additive — catches cases previously missed, never un-catches anything.
- **HTTP-level session expiry detection**: `ProcessTrades.js:executeOrder` + caller — mobile previously only checked `regularResponse?.sessionExpired` body flag. Now also catches network-level errors (fetch throw) and HTTP `401`/`403` responses, throwing a tagged error (`err.sessionExpired = true`) that `placeOrders` routes through the `onSessionExpired` callback. Matches web's axios error handling at `ProcessTrades.js:449-454` which treats `ERR_NETWORK` / `ECONNABORTED` / 401 / 403 as session-class failures with the "reconnect your broker" toast. Body-level `sessionExpired` flag path preserved for backwards compatibility.

**Landed (2026-04-17, follow-up after user approval):**

- **GTT leg payload — ported web's per-trade structure**: `ProcessTrades.js:buildOrderPayload` — when `isGtt`, legs now live INSIDE each trade object (not at the payload top level) and field names are transformed: `Symbol` → `tradingSymbol`, `Exchange` → `exchange`, `Type` → `transactionType`, `OrderType` → `orderType`, `ProductType` → `productType`. `parseFloat()` applied to `triggerPrice` and `ltp` (both also feed `price`). `quantity` is pulled from `stock.quantity` per-trade. Matches web `ProcessTrades.js:93-144` exactly. The old top-level `payload.entryLeg/leg1/leg2` assignment is removed.
- **GTT response path — array body**: `ProcessTrades.js:placeOrders` — the CCXT `{broker}/process-trades` endpoint returns an array; mobile now spreads the whole array into `allResults` when it sees `Array.isArray(gttResponse)`. Web-compat fallback retained for the old `{ response: [...] }` envelope shape in case any backend version still returns it. Matches web `ProcessTrades.js:346`.
- **TPIN modal — drop keyword filter**: `ProcessTrades.js:detectEdisFailures` — removed the `EDIS_ERROR_KEYWORDS` substring match. Mobile now returns every rejected SELL and lets the caller fire the TPIN callback, matching web's explicit comment (`ProcessTrades.js:382-383`: "*Don't rely on CDSL keyword detection — error message formats can change*"). Trade-off: TPIN modal may now fire on market-hours/insufficient-funds rejections too — accepted, same as web, for reliability against changing broker error phrasings. `EDIS_ERROR_KEYWORDS` constant deleted.

**Remaining mobile-only / intentional divergences (unchanged):**

- **IIFL Securities** — kept as mobile-only (web has it commented out in `AllBrokerList.js`). No change.
- **Zerodha** — intentional divergence (Option B, advisor-shared Kite Connect app). No change.

**Still to do**: none — all 14 brokers either already aligned, intentionally diverged (Zerodha), or fixed under this pass.

**Out of scope**: order execution / `ProcessTrades.js` / broker order-book APIs; backend changes (every endpoint referenced already exists server-side); IIFL removal (mobile-only, pending product decision); DummyBroker (mobile-only simulation).

---

## [3.8.0] - 2026-04-08

### Changed — Web Consistency Alignment (Phase 1-2: Utilities)
- **rebalanceHelpers.js**: Aligned all 6 helper functions to match web app (source of truth):
  - `isFundsErrorOrMissing` now returns `boolean` (was `{isError, reason}` object)
  - `isSubscriptionAmountError` keywords aligned: `subscription_amount_raw`, `subscription amount`, `not set or has been cleared`
  - `isLowAllowedBalanceError` narrowed to single check: `low allowed balance`
  - `checkPortfolioShortfall` now uses message-based detection (`less than required minimum` + regex) instead of numeric comparison
  - `isBrokerAuthError` uses compound conditions matching web pattern
  - `buildBrokerPayloadFields` removed Angel One fallback, DummyBroker explicit case, default now returns `{}`
- **basketUtils.js**: `netBasketTrades` aligned with web:
  - Added `cancel !== true` filter for recommend trades
  - Added rejected trade deduplication by symbol (Map, keeps first occurrence)
  - Added `consolidatedClosures` to recommend-trades return path
- **fetchFunds.js**: Refactored to web's `userEmail` pattern — server fetches API keys from DB instead of decrypting client-side. Fixed IIFL Securities (was hardcoded unavailable). Removed Bearer prefix stripping for Motilal Oswal. Error return now passes `error?.response?.data` instead of `null`.
- **RebalanceAdvices.js**: Updated `isFundsErrorOrMissing` caller to handle boolean return (was branching on `reason` codes)

### Changed — Web Consistency Alignment (Phase 3: Rebalance Flow)
- **RebalanceCard.js**: Added broker validation + funds check before `handleCheckStatus`. Added zero-quantity holdings filter. Added `skipRepairRef` to bypass stale repair data on fresh rebalance.
- **RebalanceModal.js**: Added `caPendingInfo` to process-trade payload for split settlement tracking. Added sell-against-holdings filter (prevents selling stocks user doesn't own). Added `allOrdersFailed` detection from `orderErrors`/`fundsRequired` backend response. Added publisher timeout fallback (90s) for Zerodha WebView.
- **RebalanceAdvices.js**: Subscription amount error now navigates to AfterSubscriptionScreen with modify-investment option (was alert-only).

### Added
- **rebalanceDiffUtils.js**: Ported `computeRowsDiff` from web — compares two consecutive rebalance snapshots to show added/removed/increased/decreased stocks

---

## [3.7.2] - 2026-04-05

### Fixed
- **Phantom Accept Rebalance button**: `RebalanceCard.js` — `hasExecutionRecord` guard prevents phantom Accept Rebalance button when no execution record exists for selected broker. (`4c869c7`)
- **DummyBroker status update retry**: `DummyBrokerHoldingConfirmation.js` — subscriber-execution status update retries once with 2s delay, shows error toast on failure. (`4c869c7`)
- **Zerodha auth-sell per-user credentials**: `DdpiModal.js` — added `userEmail` + proper headers to Zerodha auth-sell request for per-user credential lookup. (`4c869c7`)

### Added
- **Basket expiry utilities**: `basketUtils.js` — ported `parseExpiryFromSymbol`, `isBasketExpired`, `netBasketTrades` from web. (`4c869c7`)
- **Bespoke manually_placed flow**: `StockAdvices.js` — added `handleContinueWithoutBrokerBespoke` and `handleConfirmManuallyPlaced`. "Continue without broker" now marks trades as `manually_placed` via `PUT /api/recommendation`. (`4c869c7`)

---

## [3.7.1] - 2026-04-04

### Fixed
- **Blog name appearing twice**: Removed duplicate `<h1>` title from blog detail WebView in `KnowledgeHub.js` and `EducationalBlogs.js` — title was already shown in the `LinkOpeningWeb` modal header.
- **Blog short description missing**: Added `description` field display in the blog detail WebView HTML template.
- **"Sign In" on RA ID screen**: Removed redundant "Already registered? Sign In" link from `SignUpRADetails.js` — user already authenticated on the previous screen.
- **Privacy Policy / T&C WebView back button**: In-page "Back" links were navigating the WebView to the advisor's landing page instead of going back in the app. Added `onShouldStartLoadWithRequest` navigation protection to `PrivacyPolicyScreen.js`, `TermandConditionsScreen.js`, `LinkOpeningWeb.js`, and `ResearchReportScreen.js`.
- **Model Portfolio / Bespoke Plans intermittent empty state**: `ModelPortfolioScreen` was fetching data with `useEffect([userEmail])` but the API call requires `advisorTag` (from `configData`). When config wasn't loaded yet, the fetch used `undefined` advisorTag and returned no data. Added `advisorTag` to the dependency array so the fetch waits for config and re-runs when it arrives.
- **TradeContext unnecessary re-fetches**: `adviceShowDays` in the main fetch useEffect dependency array caused all fetches (videos, trades, notifications, model portfolios) to re-trigger when only trades needed refreshing. Separated into its own effect.

### Added
- **Auto-resolve advisor (central email_advisor_map)**: New backend system that auto-maps clients to advisors during signup/login, skipping the RA ID screen when the client's email exists in only one advisor's clientList. Falls back to RA ID screen when email maps to multiple advisors or is not found.
  - Backend: `EmailAdvisorMap` model in common DB, `GET /api/user/resolve-advisor/:email` endpoint, sync hooks in clientList CRUD routes, migration script (1,017 existing mappings backfilled).
  - App: `tryResolveAdvisor()` utility in `storageUtils.js`, integrated into `SignupScreen.js`, `LoginScreen.js`, and `SplashScreen.js`.

---

## [3.7.0] - 2026-03-31

### Fixed
- **Rebalancing decryption bug**: `checkValidApiAnSecret` in `RebalanceAdvices.js` and `RebalanceModal.js` lacked try-catch error handling and returned `undefined` on empty decryption instead of falling back to original value. Replaced local implementations with `defaultDecrypt` from `rebalanceHelpers.js` which has proper error handling and fallback logic. This affected brokers requiring decrypted API keys: Upstox, ICICI Direct, Hdfc Securities, Kotak, Motilal Oswal.
- **Kotak/Motilal Oswal missing decryption in rebalanceHelpers**: `buildBrokerPayloadFields()` was sending raw encrypted API keys for Kotak (`consumerKey`, `consumerSecret`) and Motilal Oswal (`apiKey`). Now uses `decrypt()` to match prod web app.
- **Axis Securities field names**: `buildBrokerPayloadFields()` was sending `{authToken, subAccountId}` but prod sends `{accessToken}`. Aligned with prod.
- **Motilal Oswal URL slug**: `ProcessTrades.js` used `'motilal'` but backend expects `'motilal-oswal'`. Orders would 404. Fixed to match prod.
- **GTT broker filtering**: `ProcessTrades.js` was routing ALL brokers' GTT orders to the GTT endpoint. Prod only routes Upstox and Zerodha. Other brokers' GTT-flagged orders now go through regular `/process-trades` endpoint.
- **`isRebalanceErrorResponse(null)` logic inversion**: Mobile returned `true` for null, prod returns `false`. Aligned with prod.
- **MultiBrokerContext selectedBroker default**: Was `null` (causing empty holdings on first load), prod uses `'ALL'`. Fixed to match prod, `getSelectedBrokerHoldings()` now returns aggregated holdings when `'ALL'`.
- **Axis Securities missing from brokerSupport.js**: Added Axis Securities config with Market/Limit order support and name aliases.
- **brokerAuth.js missing `encodeURIComponent`**: OAuth state parameter was not URL-encoded in Angel One login URLs, could break if base64 contains `+`, `/`, `=`. Added `encodeURIComponent()` to match prod.
- **Config.js missing variants**: Added `alphaquark` and `rgxresearch` variants that were referenced throughout the codebase but missing from `Config.js`, causing "Cannot read property 'logo' of undefined" crash on app launch.
- **formatCurrency case mismatch**: Renamed `formatcurrency.js` → `formatCurrency.js` to match import casing across the codebase.
- **SignupScreen missing dependency**: `react-native-elements` was not installed but imported in `SignupScreen.js`. Installed the package.
- **SVG import path**: Fixed broken import `../LandingPage/assests/logo.svg` → `../assets/logo.svg` in `Config.js`.

### Changed
- **Version bumped**: `versionCode` 36→37, `versionName` 3.6.0→3.7.0 to match Play Store version and suppress false "Update Available" modal.
- **New Architecture enabled**: Set `newArchEnabled=true` in `gradle.properties` (required by `react-native-reanimated`).
- **Java home path**: Updated `org.gradle.java.home` from openjdk@17/17.0.16 to 17.0.17 in `gradle.properties`.

### Added
- **Architecture documentation**: Created `docs/BROKER_CONNECTION.md`, `docs/REBALANCING.md`, `docs/MODEL_PORTFOLIO.md` with detailed flow diagrams and per-broker details.
- **CLAUDE.md**: Created project orchestration file linking all architecture documents.
- **CHANGELOG.md**: This file — tracking all changes going forward.

---

## [3.6.0] - 2026-03-26 (Previous)

### Added
- Sync updates from RGX: auth improvements, MP performance, config, bespoke features
- IIFL/Kotak modal improvements
- Security token management
- Dependency upgrades
- Dummy broker flow aligned with prod
- DDPI support
- Multi-broker context (`MultiBrokerContext.js`)
- Broker auth utilities (`brokerAuth.js`)
- Broker publisher utilities (`brokerPublisher.js`)
- Portfolio events (`portfolioEvents.js`)
- Rebalance helpers (`rebalanceHelpers.js`)
- Process trades utilities (`ProcessTrades.js`)

---

## Changelog Format

Each entry follows:
```
## [version] - YYYY-MM-DD

### Added (new features)
### Changed (modifications to existing features)
### Fixed (bug fixes)
### Removed (removed features)
### Security (security-related changes)
```

