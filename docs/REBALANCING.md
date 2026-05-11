# Rebalancing Architecture

> **Last updated**: 2026-05-06

## Overview

Rebalancing allows model portfolio subscribers to realign their holdings with the advisor's target allocation. The flow involves:

1. Fetching current holdings from the connected broker
2. Calling the rebalance/calculate API to get buy/sell trades
3. Reviewing trades in a modal
4. Executing trades via the broker

## End-to-End Flow

```
User navigates to Model Portfolio screen
    │
    ▼
RebalanceAdvices.js renders rebalance cards
    │  Displays pending rebalance signals
    │
    ▼
User taps "Rebalance" → RebalanceModal.js opens
    │
    ▼
Fetches current holdings from broker API
    │  fetchBrokerSpecificHoldings(broker, credentials)
    │
    ▼
Calls rebalance/calculate API
    │  POST /api/model-portfolio/rebalance/calculate
    │  Body: { broker payload fields + portfolio info }
    │
    ▼
API returns buy/sell trades
    │  Displays in review UI
    │
    ▼
User confirms → ProcessTrades.js executes orders
    │  Routes to broker-specific order endpoints
    │
    ▼
Order results displayed → portfolio refreshed
```

## Key Files

| File | Purpose |
|------|---------|
| `src/components/AdviceScreenComponents/RebalanceAdvices.js` | Rebalance card list, initiates rebalance flow |
| `src/components/AdviceScreenComponents/RebalanceModal.js` | Rebalance review modal, broker payload building |
| `src/components/ModelPortfolioComponents/MPReviewTradeModal.js` | MP rebalance review modal — Place Order execution (see § Known pitfalls) |
| `src/utils/rebalanceHelpers.js` | Pure helper functions (payload building, error detection, decryption) |
| `src/utils/ProcessTrades.js` | Trade execution across all brokers |
| `src/services/BrokerOrderBookAPI.js` | Order book fetching |

## Broker Payload Building

The `buildBrokerPayloadFields()` function in `rebalanceHelpers.js` builds broker-specific API payloads:

```javascript
buildBrokerPayloadFields(broker, credentials, decryptFn, angelOneApiKey)
```

### Per-Broker Payload Fields

| Broker | Fields |
|--------|--------|
| Zerodha | `accessToken` (jwtToken) |
| Angel One | `apiKey` (from config), `jwtToken` |
| Upstox | `apiKey` (decrypted), `apiSecret` (decrypted), `accessToken` |
| ICICI Direct | `apiKey` (decrypted), `secretKey` (decrypted), `accessToken` |
| Dhan | `clientId`, `accessToken` |
| Kotak | `consumerKey` (decrypted), `consumerSecret` (decrypted), `accessToken`, `viewToken`, `sid`, `serverId` |
| Hdfc Securities | `apiKey` (decrypted), `accessToken` |
| IIFL Securities | `clientCode` |
| AliceBlue | `clientId`, `accessToken`, `apiKey` |
| Fyers | `clientId`, `accessToken` |
| Motilal Oswal | `clientCode`, `accessToken`, `apiKey` (decrypted) |
| Groww | `accessToken` |
| Axis Securities | `accessToken` |

## Decryption

Broker API keys are stored encrypted. The `defaultDecrypt` function in `rebalanceHelpers.js` handles decryption:

```javascript
export function defaultDecrypt(value) {
  if (!value) return value;
  try {
    const bytes = CryptoJS.AES.decrypt(value, 'ApiKeySecret');
    const decrypted = bytes.toString(CryptoJS.enc.Utf8);
    return decrypted || value;  // Fallback to original if empty
  } catch {
    return value;  // Fallback on error
  }
}
```

**Important**: All components must use `defaultDecrypt` from `rebalanceHelpers.js` — never use local decryption functions without try-catch and fallback logic. This was a bug fixed on 2026-03-31.

## Error Detection Helpers

`rebalanceHelpers.js` provides granular error detection (aligned with web app as of 2026-04-08):

| Function | Returns | Detects |
|----------|---------|---------|
| `isFundsErrorOrMissing(funds, status)` | `boolean` | Missing/error fund data while broker is connected. Short-circuits via `isTransientFundsError` so documented transient codes (Upstox `UDAPI100072`/`UDAPI100074`) do **not** trigger the re-login modal. |
| `isTransientFundsError(resp)` / `isTransientBrokerError` | `boolean` | Known broker transient errors — looks up `error_code`/`errorCode` against `TRANSIENT_NON_AUTH_BROKER_ERROR_CODES` and falls back to message heuristics (`temporarily unavailable`, `try again`, `service window`, `market hours`, `service is accessible from`). Works for both funds responses and per-row trade-place results. |
| `detectTransientOrderWindowError(responseData)` | `string\|null` | Inspects a process-trade response — returns the first transient message iff every failed row is transient from the same maintenance window. Callers use this to swap the all-failed modal for a soft "retry at 5:30 AM IST" toast. Returns `null` when any row is a real failure or any row is a success (so partial/mixed paths fall through to existing UI). |
| `isRebalanceErrorResponse(data)` | `boolean` | Backend error in rebalance API response |
| `isSubscriptionAmountError(msg)` | `boolean` | Missing subscription amount (`subscription_amount_raw`, `subscription amount`, `not set or has been cleared`) |
| `isLowAllowedBalanceError(msg)` | `boolean` | Insufficient balance (`low allowed balance` only) |
| `checkPortfolioShortfall(data)` | `{isShortfall, hasTrades, currentValue, requiredAmount}` | Portfolio value below required minimum (message-based: checks for "less than required minimum") |
| `isBrokerAuthError(msg)` | `boolean` | Expired/invalid broker tokens. Matches (case-insensitive): compound `invalid` + `api_key`/`access_token`/`token`; standalone `session expired`, `token expired`, `unauthorized`, `authentication`; broker-forwarded 401 variants `please login`, `please re-login`, `login required`, `error: 401`, `401 unauthorized`. The 401-variant set was added 2026-04-18 after Groww rebalance errors surfaced as `"Please Login and Try Again (Error: 401)"` and bypassed all earlier keywords, dead-ending the user at the generic `Unable to Rebalance` empty state instead of opening `TokenExpireBrokerModal`. Mobile-only; web's `rebalanceHelpers.isBrokerAuthError` in `prod-alphaquark-github` still has the old keyword set (not synced in this session per user scope). |

**Maintenance-window contract (2026-04-17)**: `TRANSIENT_NON_AUTH_BROKER_ERROR_CODES` is the single source of truth for which broker error codes must bypass re-login. Add new codes here as they're discovered. Upstox's nightly 00:00–05:30 IST funds + place-order window is the current motivating case.

### Wire-up points for `detectTransientOrderWindowError`

Both all-orders-failed sites run the transient detector **before** rendering the internal failure modal so the customer sees a soft toast instead of the scary all-failed UI during a documented service window:

| Site | File | Trigger | On transient |
|---|---|---|---|
| Bespoke / MP rebalance via `rebalance/place-rebalance-order` | `src/components/AdviceScreenComponents/RebalanceModal.js` (right before the `if (allOrdersFailed && backendOrderErrors.length > 0)` block) | `detectTransientOrderWindowError(response?.data)` returns non-null | `Toast.show({ type: 'info', text1: 'Broker service window', text2: <msg> })`, close modal, call `getRebalanceRepair()` + `getModelPortfolioStrategyDetails()`, return. |
| MP subscription order placement via `api/model-portfolio-place-order` | `src/components/ModelPortfolioComponents/MPReviewTradeModal.js` (before the `if (allOrdersFailed)` early-exit) | same | same toast, `enrollStatusCheckQueue()` (async reconciliation), `onCloseReviewTrade()`, return. |
| Fyers publisher path (post-SDK) | `MPReviewTradeModal.js` around the second `allOrdersFailed` block | **intentionally not wired** | Publisher-SDK responses have a different shape, and the status-recording chain (`rebalance/record-publisher-results`, `rebalance/update/subscriber-execution`, `rebalance/add-user/status-check-queue`) must run even on failure so later reconciliation can pick it up. |

## RebalanceCard Execution Status Guard

**File:** `src/UIComponents/RebalanceAdvicesUI/RebalanceCard.js`

Each rebalance card derives its button state from the user's execution record in `latestRebalance.subscriberExecutions`. A critical guard (`hasExecutionRecord`) prevents phantom action buttons:

```
userExecution = subscriberExecutions.find(e => e.user_email === userEmail)
hasExecutionRecord = !!userExecution

// All status booleans require hasExecutionRecord to be true:
isRebalanceExecuted    = hasExecutionRecord && status === 'executed'  && brokerMatches
isPartiallyExecuted    = hasExecutionRecord && status === 'partial'   && brokerMatches
isPendingVerification  = hasExecutionRecord && status === 'pending'   && brokerMatches
```

**Button behavior when `!hasExecutionRecord`:**
- Button is **disabled**
- Label shows "No rebalance pending"
- Prevents phantom "Accept Rebalance" that appeared when broker dropdown was switched to a broker without an execution record

**Bug this fixed (4c869c7):** When `userExecution` is `undefined`, `undefined?.status !== 'executed'` evaluates to `true`, causing the repair-mode branch to activate and display a clickable "Accept Rebalance" button that would fail on interaction.

## DummyBroker Status Update Retry

**File:** `src/components/AdviceScreenComponents/DummyBrokerHoldingConfirmation.js`

After DummyBroker trade recording (POST `/rebalance/process-trade`), the component updates the subscriber-execution status to "executed" via:

```
PUT {ccxtServer}/rebalance/update/subscriber-execution
Body: { userEmail, modelName, model_id, executionStatus: 'executed', user_broker: 'DummyBroker' }
```

If this PUT fails, the component retries once after a 2-second delay. If the retry also fails, it shows a Toast error: "Status update failed. Rebalance recorded but status may be stale. Pull to refresh."

**Why**: The backend may be slow under load. Without the retry, a successful trade recording could leave the execution status stuck at "pending", making the RebalanceCard continue to show an action button despite trades already being placed.

## Parity with Web App

The rebalancing flow in this mobile app mirrors `prod-alphaquark-github`:
- Same `buildBrokerPayloadFields()` function
- Same `rebalanceHelpers.js` utilities
- Same backend API endpoints
- Same decryption logic (`defaultDecrypt`)
- Same `hasExecutionRecord` guard logic in RebalanceCard (added 2026-04-05)

Differences:
- Mobile uses React Native modals, web uses React modals
- Mobile uses `react-native-toast-message`, web uses `react-hot-toast`
- Mobile fetches holdings via `fetchBrokerSpecificHoldings`, web may have different fetch patterns

## Array Mutation Safety Rule

**ALWAYS use spread copy before sorting state-derived arrays:**

```js
// WRONG — mutates state object in-place, causes stale render bugs
const sorted = stateObj?.someArray?.sort((a, b) => ...)

// CORRECT
const sorted = [...(stateObj?.someArray || [])].sort((a, b) => ...)
```

Files fixed (2026-04-07):
- `AfterSubscriptionScreen.js:197-204` — `subscription_amount_raw` and `user_net_pf_model` sorts
- `ModelPortfolioScreen.js:182` — `rebalanceHistory` sort

## DDPI authorize-for-sell — `await getUserDetails` before reopening rebalance modal (2026-04-20)

The rebalance flow invokes `DdpiModal` / `AngleOneTpinModal` / `DhanTpinModal` / `FyersTpinModal` / `OtherBrokerModel` as a SELL-side precheck. If the user hasn't authorized for sell on their broker, the modal fires a `PUT /api/update-edis-status` and calls `reopenRebalanceModal()` to return the user to the rebalance review.

Before the 2026-04-20 fix (commit `a6bbeae`, ports web `e73bd81` Issue 3), the internal `getUserDetails()` call after the PUT was **fire-and-forget** — the reopened rebalance modal read pre-PUT `userDetails.is_authorized_for_sell=false` and re-triggered DDPI immediately, making the authorize-for-sell tick appear to not stick.

**Fix:** all 6 `handleProceed`-style callers in `src/components/DdpiModal.js` now `await getUserDetails()` before closing:

| Line | Function | Context |
|---|---|---|
| ~133 | `handleProceed` | main `DdpiModal` default export |
| ~1115 | `handleProceed` | `AngleOneTpinModal` (invoked from bespoke + rebalance SELL flows) |
| ~1339 | `handleProceed` | `DhanTpinModal` |
| ~1902 | `handleContinue` | `OtherBrokerModel` (add-to-cart flow) |
| ~1966 | `handleAcceptRebalance` | `OtherBrokerModel` (rebalance flow — direct relevance) |
| ~2540 | `handleProceed` | `FyersTpinModal` |

`src/screens/TradeContext.js:getUserDeatils` is already `async` with `await axios.get(...)`, so it returns a Promise — `await` at the DdpiModal call site now properly waits before `reopenRebalanceModal()` runs.

See `docs/BROKER_CONNECTION.md` → *DDPI authorize-for-sell* for the full rationale and `docs/CHANGELOG.md` entry `[3.8.6]` for the commit-scoped summary.

## Rebalance-flow broker-auth error detection — expanded keyword set (2026-04-20, via vansh merge)

`src/utils/rebalanceHelpers.js:isBrokerAuthError` — expanded the keyword set to catch broker-forwarded 401 patterns. Groww (migrated to approval-mode credentials per `[3.8.4]`) surfaces 401s as `"Please Login and Try Again (Error: 401)"`; the older keyword set missed this, so the rebalance flow rendered a dead-end "Unable to Rebalance" dialog instead of opening the `TokenExpireBrokerModal` reconnect path. Added: `please login`, `please re-login`, `login required`, `error: 401`, `401 unauthorized`, `token expired`. Imported via merge of vansh's `3d77710` on 2026-04-20.

## Closure-bound funds — inline `refreshBrokerStatus` pattern (2026-04-22)

Any handler that reads `funds` / `brokerStatus` from React closure immediately after a broker reconnect sees stale values. `TradeContext.setFunds` has committed, but the enclosing component hasn't re-rendered before the handler runs, so `isFundsErrorOrMissing(funds, brokerStatus)` returns `true` against the pre-reconnect `{status:1}` object while the connection is actually live. The observable symptom is the `TokenExpireBrokerModal` ("Authentication Required — Login to {broker}") re-popping on the very next user tap after a successful OAuth reconnect.

**Contract:** any code path that gates on `(funds, brokerStatus)` to open a broker-auth modal should fetch fresh state inline via a local `refreshBrokerStatus` helper instead of reading the closure value. The helper pattern (first introduced in `RebalanceCard.js`, now mirrored in `RebalanceAdvices.js`):

1. GET `api/user/getUser/{userEmail}` → `freshUserDetails`.
2. Call `fetchFunds(freshUserDetails.user_broker, ...)` inline with the just-fetched user object.
3. Return `{brokerStatus, broker, funds}` synchronously to the caller.
4. Caller reads `freshStatus.funds ?? funds` — network value wins, closure value is a fallback on fetch error only.

**Shared hook** (source of truth since [3.9.15]): `src/hooks/useRefreshBrokerStatus.js` — `useRefreshBrokerStatus(userEmail)` → `async () => ({brokerStatus, broker, userDetails, funds})`. New handlers must consume this hook instead of writing a local refresh helper.

**Known call sites applying this pattern:**
- `src/UIComponents/RebalanceAdvicesUI/RebalanceCard.js` — `handleCheckStatus` + `handleCheckBroker` (fixed [3.9.11], refactored to shared hook [3.9.15]).
- `src/components/AdviceScreenComponents/RebalanceAdvices.js` — `handleAcceptRebalance` pre-check (fixed [3.9.14], refactored to shared hook [3.9.15]).
- `src/components/AdviceScreenComponents/AddtoCartModal.js` — `handleTrade` (basket flow, fixed [3.9.15]).
- `src/components/AdviceScreenComponents/StockAdvices.js` — `handleTrade`, `handleTradeBasket`, `handleSingleSelectStock` (bespoke flows, fixed [3.9.15]).

**Known remaining call sites with the same latent bug (not yet ported):** `UserStrategySubscribeModal.js:213`, `MPPerformanceScreen.js:640`, `BespokePerformanceScreen.js:548`, `IgnoreTradesScreen.js:1441`. Port the helper pattern if the modal-re-pop symptom recurs from any of those surfaces.

## Kotak NEO migration — rebalance auth-params shape (BACKEND, ccxt-india, 2026-04-27)

The 2026-04-22 Kotak NEO TradeAPI migration switched the connect flow to store **`apiKey` (UUID API access token)**, **`jwtToken` (view/session token)**, **`sid`**, **`serverId`** in the user document — retiring the legacy `consumerKey`/`consumerSecret` pair. Three downstream consumers in ccxt-india were missed during that migration and continued to map `apiKey → consumerKey` and `secretKey → consumerSecret` (where `secretKey` no longer exists → `None`). Result: rebalance Step 3 raised the user-facing alert

> Unable to Rebalance — You must provide a consumer key and a consumer secret to generate access token or provide an access token.

The error string is verbatim from `neo_api_client/brokers/kotak/kotak.py:99-103` — raised when `Kotak(...)` is instantiated with `access_token=None` AND `consumer_key=None`/`consumer_secret=None`.

### Patched in [3.9.35]

| File | What changed |
|------|--------------|
| `ccxt-india/apps/app_model_portfolio.py` § `normalize_credentials_for_broker` (Kotak branch) | Emits `apiKey` + `jwtToken` + `sid` + `serverId`; stops emitting `consumerKey`/`consumerSecret`. Feeds every rebalance broker class via `BrokerFactory.get_broker(...)`. |
| `ccxt-india/rebalancing/brokers.py` § `KotakBroker` | `__init__` reads `apiKey → self.access_token`, `jwtToken (or accessToken fallback) → self.view_token`. `_get_kotak_instance()` + `process_trades()` pass `access_token=` to `Kotak(...)` / `TradingLogicKotak(...)`. Dropped `consumer_key=`/`consumer_secret=` kwargs. |
| `ccxt-india/rebalancing/order_status_updater/order_book_factory.py` § `KotakBroker` | Same migration. Pre-fix gate raised `Missing required authentication parameters for Kotak` on every status refresh post-NEO; new gate is `if not self.access_token or not self.view_token or not self.sid` (serverId is optional — Kotak() class falls back to `"server1"`). |

### Auth-params shape contract (canonical, post-migration)

Anywhere ccxt-india constructs a Kotak rebalance/holdings/order-status client from a NEO-migrated user, it MUST source these four fields and pass through to `Kotak(...)` as shown:

```python
access_token = db_creds['apiKey']            # UUID API access token
view_token   = db_creds['jwtToken']          # view/session token (Auth header)
sid          = db_creds['sid']
server_id    = db_creds.get('serverId', '')  # may be empty for some account types

Kotak(access_token=access_token, view_token=view_token, sid=sid, server_id=server_id)
TradingLogicKotak(access_token=access_token, view_token=view_token, sid=sid, server_id=server_id)
```

DO NOT pass `consumer_key=`/`consumer_secret=` for NEO-migrated users — those kwargs trigger the SDK's old OAuth `_generate_access_token()` path which expects `developer.kotaksecurities.com/openapi/v1/oauth2/token`, an endpoint the new accounts can't authenticate against.

### Resolved follow-ups ([3.9.37], 2026-04-27)

The four un-migrated call sites originally listed as known follow-ups in `[3.9.35]` are now ported. See `docs/CHANGELOG.md` `[3.9.37]` for the full per-file diff, but in summary:

| File | What was patched |
|------|------------------|
| `ccxt-india/common/utils.py:418` (`Mapping.BROKER_AUTH_KEYS["Kotak"]`) | `["consumerKey","consumerSecret","jwtToken","sid","serverId"]` → `["apiKey","jwtToken","sid","serverId"]`. Schema source-of-truth for projection + validation. |
| `ccxt-india/portfolio/portfolio_all_brokers.py` § Kotak `get_holdings` | Projection + `Kotak(...)` construction migrated to NEO 4-arg shape. `apiKey` decrypted via `CryptoJSWrapper`. |
| `ccxt-india/portfolio/user/holding_allbroker_user.py` § per-user Kotak `get_holdings` | Same migration. Pre-fix code mislabeled `apiKey` as `consumer_key`. |
| `ccxt-india/portfolio/limit_order_status_update.py` § `get_order_status_kotak` | Unpack changed from 6-tuple → 4-tuple (`access_token`, `view_token`, `sid`, `server_id`). |

In addition, `[3.9.37]` patched a related decrypt-correctness bug in `ccxt-india/rebalancing/order_status_updater/status_update.py` § `_get_auth_keys` that became load-bearing once `BROKER_AUTH_KEYS["Kotak"]` introduced plaintext fields (`sid`, `serverId`) — narrowed the decrypt set from "everything except `jwtToken` / Angel One" to the four fields actually encrypted at rest (`apiKey`, `secretKey`, `consumerKey`, `consumerSecret`).

## Rebalance trade `variant` field — AMO vs REGULAR (2026-05-01)

Every trade in the rebalance payload sent to `rebalance/process-trade` (ccxt-india) now carries a `variant: "AMO" | "REGULAR"` string, computed at submit time on the frontend:

```js
variant = (!IsMarketHours() && allowAfterHoursOrders === true) ? "AMO" : "REGULAR"
```

- `IsMarketHours()` — `src/utils/isMarketHours.js`, 09:15–15:30 IST gate.
- `allowAfterHoursOrders` — from `appadvisors.allowAfterHoursOrders` / `featureFlags.allowAfterHoursOrders` via `ConfigContext`.

The field is **display-only** (no behavioural change to the placement payload — every supported broker auto-converts after-hours orders to AMO server-side anyway). It feeds the amber **AMO** pill rendered next to the status pill on each result card in `RecommendationSuccessModal`.

ccxt-india does NOT need to echo `variant` — the frontend looks up `variant` from its own outgoing trade list when the response item doesn't carry it (three-tier fallback: response field → outgoing payload match by symbol+tradeId+transactionType → default `"REGULAR"`).

See `docs/APP_ARCHITECTURE.md § 4.5.2 Trade variant field` for the full contract, fallback rules, and followups deferred to a later commit (explicit `orderVariety: "AMO"` in payload, pre-flight market-closed banner).

### Why the connect itself worked despite this

The connect route (`aq_backend_github/Routes/Broker/Kotak.js`) calls ccxt's `/kotak/login/totp` directly, which uses Kotak's new `/login/1.0/tradeApiLogin` endpoint and never goes through `normalize_credentials_for_broker`. That's why the bug-report screenshot showed a green "Kotak Broker Connected" card with cash + phone + PAN populated, but rebalance (which DOES go through the normalizer + `KotakBroker`) failed at Step 3.

## Known pitfalls — MPReviewTradeModal.js `placeOrder` error-handling (2026-05-06)

`MPReviewTradeModal.js:placeOrder` is an `async` function called without `await` or `.catch()` from the Place Order button's `onPress`. Any unhandled exception inside `placeOrder` that occurs before `setLoading(true)`, or any exception that escapes the try-catch, becomes a silent promise rejection — `setLoading(false)` never fires, the spinner sticks forever, and no HTTP request reaches the server.

**Guard rule**: the `try {` block MUST immediately follow `setLoading(true)`. Do not add synchronous setup code between `setLoading(true)` and `try {`; if new pre-flight logic is needed, add it inside the existing try block. The catch block's FIRST statement must remain `setLoading(false)`.

This was the root cause of the "Place Order stuck forever" regression confirmed on Axis Securities and Dhan (2026-05-06). Nginx logs showed zero `okhttp` requests for `/rebalance/process-trade` — the request never left the device. Fixed by moving `try {` from line 429 to line 319 (immediately after `setLoading(true)`). See `docs/CHANGELOG.md — 2026-05-06` for the full commit description.

### Future Kotak credential-shape changes

Treat any change to `BrokerKeysSchema["Kotak"]`, `normalize_credentials_for_broker` Kotak branch, or the `KotakBroker` constructors in `rebalancing/brokers.py` / `rebalancing/order_status_updater/order_book_factory.py` as a **fan-out change** — same class as the env-var guardrail in `CLAUDE.md` § "Shared env vars across brokers — BLOCKING GUARDRAIL". Grep all four follow-up files above before merging; Python's `dict.get('<key>')` returns `None` silently so there's no compile-time signal that a downstream consumer fell off the migration.
