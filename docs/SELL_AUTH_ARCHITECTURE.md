# Sell-Authorization Architecture (DDPI / TPIN / EDIS)

> **Canonical reference for sell-authorization across all brokers, all repos.**
> Maintained as the single source of truth. tidi_new + alphaquark-mobile-sdk
> mirror this doc by reference (`docs/SELL_AUTH_REFERENCE.md` in those repos).
>
> **🔴 BLOCKING RULE — see § "Documentation update contract" at the bottom.**
> Every code change touching sell-auth (any field, any flag, any broker, any
> persist path, any read path, any UI gate, any SDK widget) MUST update this
> doc IN THE SAME COMMIT.

---

## 1. Conceptual model

When a customer SELLS shares from their demat account, SEBI requires explicit
authorization that the broker is acting on their behalf. India brokers
implement this through three different mechanisms — every flow in our system
ultimately resolves to ONE of these:

| Mechanism | Lifetime | User experience | Notes |
|---|---|---|---|
| **DDPI** (Demat Debit and Pledge Instruction) | **Permanent** until user revokes at depository | One-time form filed at the depository (CDSL/NSDL) — usually via the broker's account-opening flow or a separate POA module | Modern SEBI replacement for POA. If a user has DDPI, they can sell ANY day without per-day authorization. |
| **TPIN / EDIS** (Electronic Delivery Instruction Slip) | **Per-day per-session** — expires at end of trading day | User receives an OTP on the registered mobile, enters it via broker's CDSL/NSDL flow each morning before selling | Manual, per-trading-day. If user authorizes today, they can sell today. Tomorrow they must re-authorize. |
| **POA** (Power of Attorney) | **Permanent** — legacy, mostly deprecated | Physical paper document, scanned + uploaded at account opening | SEBI's pre-DDPI standard. Still honored by older accounts; new accounts use DDPI instead. |

> **Why the day-scope matters.** TPIN/EDIS is the default for users who haven't
> set up DDPI. The TPIN session is bound to the broker's daily settlement cycle
> — once the day rolls over (3:30 PM IST close, then overnight settlement), the
> session is invalidated and the user MUST re-authorize before placing the next
> day's sell orders. **Persisting `is_authorized_for_sell: true` across days
> for a TPIN/EDIS user is actively harmful** — they think they can sell, but
> the broker rejects mid-trade with a POA / EDIS-required error code.

---

## 2. The two flags + the timestamp

These three fields live on BOTH the top-level user document AND every entry
in `connected_brokers[]` (Mongoose schemas in `Models/userModel.js`):

| Field | Type | Set by | Reset by | Lifetime |
|---|---|---|---|---|
| `ddpi_enabled` | Boolean | Broker live check (Zerodha `save-ddpi-status`, Angel One `verify-dis`, Dhan `get-edis-status`) — sets TRUE when broker reports DDPI active. Manual confirmation does NOT set this. | Broker live check returns false (rare — typically only if user revoked DDPI at depository). | **Permanent until broker says otherwise** — survives reconnect AND day rollover. |
| `is_authorized_for_sell` | Boolean | TWO paths: (a) frontend `update-edis-status` after manual TPIN flow; (b) ccxt-side auto-detection after a successful sell order goes through (the order itself proves the auth). | (a) Day rollover via `shouldPreserveSellAuth` check at next reconnect; (b) ccxt-side auto-revoke when a sell rejection is classified as `SELL_AUTH_REVOKED` (see `trading_logic/sell_auth_revoke.py` + `Routes/UpdateEdisStatus.js`). | **Day-scoped — TRUE-only-today.** Reset at next IST calendar-day boundary. |
| `sell_auth_set_at` | Date | Stamped to `new Date()` whenever `is_authorized_for_sell` flips to TRUE (any path). Set to `null` when flipped to FALSE. | Same as `is_authorized_for_sell`. | Companion timestamp — anchors the day-scope. |

### 2a. Why we need BOTH `ddpi_enabled` AND `is_authorized_for_sell`

A boolean alone can't distinguish "permanently authorized via DDPI" from
"authorized just for today via TPIN". The two flags keep them separate so:

- DDPI users (`ddpi_enabled: true`) NEVER see the manual EDIS prompt.
- TPIN users (`is_authorized_for_sell: true` AND `sell_auth_set_at == today`)
  don't see the prompt today, but DO see it tomorrow.
- New users / revoked users (both false) see the prompt every time until they
  authorize once.

### 2b. Why we need `sell_auth_set_at` (introduced 2026-05-02)

Before this field existed, every broker connect handler hard-reset
`is_authorized_for_sell: false`, which forced the user to re-confirm manually
on every reconnect even within the same day. The first attempted fix
preserved the boolean indefinitely — wrong, because TPIN expires daily.

`sell_auth_set_at` is the anchor that lets the connect path distinguish
"set today" (preserve) from "stale from yesterday" (reset to false).

---

## 3. The day-check helper

**File:** `aq_backend_github/utils/sellAuthDayCheck.js`

```js
const { shouldPreserveSellAuth, isSetToday, _ymdIST } = require('./utils/sellAuthDayCheck');

// Returns true iff `flag` is TRUE AND `setAt` is the same calendar date as
// today in IST (Asia/Kolkata, UTC+5:30, no DST).
shouldPreserveSellAuth(storedIsAuthorized, storedSetAt) // → boolean
```

**Used by:**

- `Routes/userRoutes.js` — every broker's `connect-broker` handler (14 sites)
- `services/MultiBrokerService.js addBrokerConnection` — the
  `connected_brokers[broker]` sub-doc sync
- (extensible) any future code path that reads `is_authorized_for_sell`
  alongside `sell_auth_set_at` and needs to honor day-scope

> **Date math is IST, not UTC.** Indian markets reset on the IST calendar.
> The helper does `new Date().getTime() + 5.5 * 3600 * 1000` then formats as
> YYYY-MM-DD. Don't switch to UTC — a sell auth at 11pm IST would silently
> expire 30 minutes later if compared on UTC dates.

---

## 4. Per-broker matrix

| Broker | Sell-auth mechanism | Live server-side check | Stored flag relied on? | EDIS flow file | Notes |
|---|---|---|---|---|---|
| **Zerodha** | TPIN session (per-day) OR DDPI (permanent) | ✅ `/zerodha/save-ddpi-status` — refreshes both `ddpi_status` and `is_authorized_for_sell` from Kite session | Yes (overwritten by live check on rebalance entry) | tidi: `DdpiAuthPage.dart` `_zerodhaFlow`<br>Alphab2bapp: `DdpiModal.js` (Zerodha branch via `ZerodhaTpinModal`) | Web Kite Connect TPIN flow renders inside our WebView. |
| **Angel One** | DDPI OR TPIN (CDSL form) | ✅ `/angelone/verify-dis` (server-side: `app_angelone.py:verify_dis`) — returns `{edis: bool, data: {DPId, ReqId, TransDtls}}`. `edis: true` ⇒ already authorized today / DDPI active. | Yes (preferred); live check is fallback when both flags are false (added 2026-05-02). | tidi: `DdpiAuthPage.dart` `_angelOneFlow`<br>Alphab2bapp: `DdpiModal.js` (auto-fetch `verify-edis` on open; auto-skip when `edis: true` — added 2026-05-02) | clientCode required for `verify-dis`. SmartAPI JWT payload's `username` claim carries it — JWT-fallback added 2026-05-02 in `DdpiAuthPage._angelOneFlow` for users whose `connected_brokers[Angel One].clientCode` is empty (older shared-mode connections didn't persist it; backend persist now extracts from JWT — `Routes/sdk/v1/connections.js` Angel One shared-mode branch). |
| **Dhan** | TPIN (CDSL via Dhan portal) | ✅ `/dhan/edis-status` — returns per-holding `edis: bool`. Authorized iff ALL holdings have `edis === true`. | Yes (preferred); live check is fallback. | tidi: `DdpiAuthPage.dart` `_dhanFlow` (`generate-tpin` → `enter-tpin` → HTML form WebView)<br>Alphab2bapp: `DdpiModal.js` (Dhan branch) | Lives in `RebalanceReviewPage._checkDhanEdisStatus`. ISIN-per-holding flow. |
| **Fyers** | TPIN (Fyers internal flow) | ❌ No `verify-dis` equivalent | Yes — only signal | tidi: `DdpiAuthPage.dart` `_fyersFlow` (`submit-holdings` → HTML form) | Manual flow only. |
| **Upstox** | DDPI ONLY (no online TPIN) | ❌ No live check | Yes — only signal | tidi: `_buildManualAuthContent` (manual instructions screen) | User must set DDPI in Upstox app (one-time). After they confirm, manual flag stays TRUE for the day; resets each midnight IST. Without DDPI, can't sell programmatically — period. |
| **HDFC Securities** | DDPI / POA | ❌ | Yes | Manual content | Same shape as Upstox. |
| **Motilal Oswal** | DDPI / POA | ❌ | Yes | Manual content | Same. |
| **AliceBlue** | DDPI / TPIN at broker portal | ❌ (no AliceBlue-side EDIS API) | Yes | Manual content | User authorizes at AliceBlue portal directly. |
| **IIFL Securities** | DDPI / POA | ❌ | Yes | Manual content | Same. |
| **Axis Securities** | DDPI / POA | ❌ | Yes | Manual content | Same. |
| **Kotak** | DDPI / TPIN | ❌ | Yes | Manual content | Same. |
| **Groww** | DDPI / TPIN | ❌ | Yes | Manual content | Same. |
| **ICICI Direct** | DDPI / POA | ❌ | Yes | Manual content | Same. |
| **DummyBroker** | N/A (simulation) | N/A | N/A | N/A | Always allowed; no auth concept. |

**Live-check brokers** (3): Zerodha, Angel One, Dhan. Stored flag is a hint;
live check is authoritative. Stored flag's day-scope still matters for the
brief window between connect and the next live probe.

**Flag-only brokers** (10): Upstox, HDFC, Motilal, AliceBlue, IIFL, Axis,
Kotak, Groww, Fyers, ICICI. Stored flag is the ONLY signal we have. Day-scope
is the user's safety net.

---

## 5. Lifecycle: what happens when

### 5a. First-ever sell on a new connection

```
1. User opens RebalanceModal (Alphab2bapp) / RebalanceReviewPage (tidi).
2. Pre-trade gate reads connected_brokers[broker].is_authorized_for_sell.
3. Live-check brokers: pre-gate calls verify-dis / save-ddpi-status / get-edis-status.
   - If live returns "authorized" → DB flag flipped to true via update-edis-status,
     gate passes silently.
   - If live returns "not authorized" → manual EDIS UI opens.
4. Flag-only brokers: gate checks DB flag directly.
   - false → manual EDIS UI opens immediately.
5. User completes manual TPIN/EDIS flow in WebView (CDSL/NSDL form).
6. On WebView success callback, frontend calls PUT /api/update-edis-status:
     { uid, is_authorized_for_sell: true, user_broker }
7. Backend (UpdateEdisStatus.js):
     - Sets root user.is_authorized_for_sell = true
     - Sets root user.sell_auth_set_at = new Date()
     - Mirrors to connected_brokers[primary_broker].is_authorized_for_sell = true
     - Mirrors connected_brokers[primary_broker].sell_auth_set_at = new Date()
8. RebalanceModal reopens; gate now passes; trade flow proceeds.
```

### 5b. Same-day reconnect (after disconnect/reconnect within the trading day)

```
1. User reconnects broker via Phase3SdkConnectScreen / BrokerSelectionModal.
2. Backend connect handler (e.g. userRoutes.js Upstox branch line 920):
     - Reads currentUser (existing user doc).
     - Computes preservedSellAuth = shouldPreserveSellAuth(
         currentUser.is_authorized_for_sell,    // true
         currentUser.sell_auth_set_at           // today's date
       ) → returns TRUE (set today).
     - findOneAndUpdate $set:
         is_authorized_for_sell: true (preserved)
         sell_auth_set_at: today (preserved)
3. syncBrokerToMultiBrokerArray → MultiBrokerService.addBrokerConnection:
     - Reads existing connected_brokers[broker] entry.
     - shouldPreserveSellAuth on that entry → TRUE.
     - Writes is_authorized_for_sell: true (preserved) on the slot.
4. User attempts sell → gate sees true → no manual prompt → trade proceeds.
```

### 5c. Next-day reconnect (after midnight IST rollover)

```
1. User reconnects at 9 AM IST (markets just opened on day N+1).
2. Backend connect handler:
     - currentUser.sell_auth_set_at = day N (yesterday IST).
     - shouldPreserveSellAuth → FALSE (set_at != today).
     - $set: is_authorized_for_sell: false, sell_auth_set_at: null.
3. MultiBrokerService.addBrokerConnection:
     - existingEntry.sell_auth_set_at = day N.
     - shouldPreserveSellAuth → FALSE.
     - Writes is_authorized_for_sell: false on the slot.
4. User attempts sell → gate sees false → manual EDIS UI opens →
   user enters today's TPIN → flag flips back to true (set_at = day N+1).
   Same as 5a.
```

### 5d. ccxt-side auto-revoke (sell rejected because broker says not authorized)

```
1. User attempts sell on a flag-only broker.
2. Gate passes (flag is true from prior auth).
3. ccxt forwards order to broker.
4. Broker rejects with EDIS / POA error.
5. ccxt classifies the rejection (sell_auth_revoke.py classifier) →
   SELL_AUTH_REVOKED.
6. ccxt POSTs to internal endpoint:
     PUT /api/update-edis-status (X-Internal-Source header)
     { email, broker, is_authorized_for_sell: false,
       sell_auth_revoked_at: NOW, revoke_reason: "..." }
7. UpdateEdisStatus.js internal path:
     - $set connected_brokers[broker].is_authorized_for_sell = false
     - $set connected_brokers[broker].sell_auth_set_at = null
     - If primary_broker matches, mirrors root flags too.
     - Stamps sell_auth_revoked_at + sell_auth_revoke_reason.
8. Frontend re-fetches user details → sees flag false → on next sell,
   manual EDIS UI opens.
```

---

## 6. Backend persistence schema

### 6a. Top-level user fields (`Models/userModel.js`)

```js
ddpi_enabled: { type: Boolean, default: false },          // permanent
is_authorized_for_sell: { type: Boolean, default: false }, // day-scoped
sell_auth_set_at: { type: Date },                         // companion to above
sell_auth_revoked_at: { type: Date },                     // ccxt-side revoke audit
sell_auth_revoke_reason: { type: String },                // ccxt-side revoke audit
```

### 6b. Per-broker entry (`connectedBrokerSchema`)

Same five fields, mirrored to the `connected_brokers[]` sub-document. Mobile
apps read these per-broker — the top-level fields are legacy mirrors maintained
for older code paths.

### 6c. Required code paths

The following code paths MUST handle sell-auth correctly:

1. **Connect handlers** (userRoutes.js — 14 broker branches): preserve via
   `shouldPreserveSellAuth(currentUser?.is_authorized_for_sell, currentUser?.sell_auth_set_at)`.
2. **MultiBrokerService.addBrokerConnection**: same check on `existingEntry`.
3. **UpdateEdisStatus.js** (both PUT paths): set `sell_auth_set_at = new Date()`
   when `is_authorized_for_sell` flips to TRUE; `null` on FALSE.
4. **SDK connect path** (`Routes/sdk/v1/connections.js`): `_selfCallLegacy`s
   to `/api/user/connect-broker` which inherits the userRoutes.js fix.

If a NEW connect path is added (for a new broker, or a new SDK route, or a
new auto-import flow), it MUST follow #1's pattern.

---

## 7. Mobile app responsibilities

### 7a. Read path (sell-auth gate before showing EDIS UI)

| App | File | Pattern |
|---|---|---|
| **tidi_new** | `lib/components/home/portfolio/RebalanceReviewPage.dart` | Switch on `brokerLower`; live-check brokers (Zerodha, Angel One, Dhan) call broker-specific `_check<Broker>EdisStatus`; flag-only brokers read `effectiveBroker.isAuthorizedForSell`. If `canSell == false`, navigate to `DdpiAuthPage`. |
| **Alphab2bapp** | `src/components/AdviceScreenComponents/RebalanceModal.js` | Per-broker if-blocks read `userDetails.is_authorized_for_sell` (top-level). Opens broker-specific TPIN modal. **2026-05-03: derivatives (NFO/BFO/MCX exchanges, MIS/NRML product types) excluded from EDIS/DDPI checks** — only equity delivery (CNC) sells trigger the gate. DdpiModal auto-fetches `verify-edis` and short-circuits when `edis: true`. Zerodha WebView CDSL flow fixed: confirmation overlay no longer shows prematurely (waits for callback_url or user close). |
| **SDK** | `@alphaquark/mobile-sdk` `SellAuthGate.tsx` `requireSellAuth()` | **2026-05-03: derivatives excluded** — filters to equity delivery (CNC) sells before checking DDPI flags. NFO/BFO/MCX exchanges and MIS/NRML product types pass through without sell-auth gate. |
| **Alphab2bapp** (initial allocation) | `src/components/ModelPortfolioComponents/UserStrategySubscribeModal.js:218-310` | DDPI-priority gate added 2026-05-03. Pre-blocks ONLY for Zerodha (`!is_authorized_for_sell && !ddpi_status in ['physical','ddpi']`) + Angel One (`!ddpi_enabled && !is_authorized_for_sell`) + 8 portal-side brokers (`!is_authorized_for_sell`). **Dhan + Fyers NOT pre-blocked** — optimistic placement per § 7d below. |

### 7d. DDPI-priority semantics (canonical, 2026-05-03)

**The principle**: when DDPI is active at the broker, the user can sell freely without per-day authorization. Pre-blocking when DDPI may be active is wrong UX (false negative).

**Per-broker classification:**

| Class | Brokers | Pre-block strategy |
|---|---|---|
| **DDPI-aware (cheap server-cached flag)** | Zerodha (`ddpi_status` populated by `/zerodha/save-ddpi-status`), Angel One (`ddpi_enabled` populated by `/angelone/verify-dis`) | Pre-block ONLY when `!ddpi_flag && !is_authorized_for_sell`. DDPI active ⇒ proceed. |
| **Live-check available, expensive** | Dhan (`/dhan/edis-status`, per-holding) | Where pre-fetched (RebalanceModal does), use live check. Where not pre-fetched (UserStrategySubscribeModal), prefer optimistic placement over stored-flag fallback — stale flag would falsely block users who cleared EDIS at the portal between sessions. |
| **Flag-only (no DDPI tracking in our schema)** | Fyers + 8 portal-side (Upstox, HDFC, Motilal, AliceBlue, IIFL, Axis, Kotak, Groww, ICICI Direct) | Existing pre-block on `!is_authorized_for_sell` is **acknowledged over-aggressive** — a user with permanent DDPI at the broker portal would be falsely blocked because our schema doesn't store DDPI state for these brokers. Phase D `requireSellAuth` softens to optimistic placement once the post-rejection cascade ships. |

**Phase D direction (per `docs/SDK_ORCHESTRATION_PHASES.md`)**: SDK orchestrator `requireSellAuth` sub-orchestrator implements the canonical pattern:

1. Check DDPI-aware flags (cheap, accurate). DDPI active ⇒ proceed.
2. For DDPI-non-aware brokers, attempt the trade optimistically.
3. If broker rejects with EDIS error (classified by ccxt), open the SDK `<SellAuthGate>` widget for in-app re-auth (Zerodha auth-sell, Angel One verify-dis, Dhan TPIN, Fyers TPIN) OR show "authorize at broker portal" instructions for portal-side brokers.
4. After successful re-auth, retry the trade with the same `clientAdviceId` (idempotent).

This collapses the current 5-modal cascade in RebalanceModal + the Toast pattern in UserStrategySubscribeModal into one unified flow. Until Phase D ships, mobile apps remain on the legacy pre-block-with-flag pattern documented in § 7a.

### 7b. Write path (after WebView completes)

Both apps call `PUT /api/update-edis-status { uid, is_authorized_for_sell: true, user_broker }`
on TPIN/EDIS WebView completion. Backend stamps `sell_auth_set_at` automatically.

### 7c. Day-scope on the read side (NOT YET IMPLEMENTED)

Currently the day-scope is enforced ONLY on the connect path (backend). If a
user stays connected across midnight IST, the backend doesn't proactively
flip the flag — it only resets on the next reconnect.

**Defensive option for future:** mobile apps could also check
`sell_auth_set_at` before trusting `is_authorized_for_sell == true`. If
`set_at != today IST`, treat as false even though the flag says true.

This isn't currently wired because:
- Most users disconnect/reconnect within a 24-hour cycle.
- The ccxt-side auto-revoke catches users who try to sell with a stale flag.
- A backend cron at IST midnight could flip the flag deterministically across
  ALL connected_brokers entries for ALL users — preferred over per-app logic.

If we add the backend cron OR the per-app check, document it here.

---

## 8. SDK boundary (current and future)

### 8a. What the SDK owns today (`alphaquark-mobile-sdk`)

- **Post-trade-failure classification**: `state/edis_detection.dart` (Flutter)
  + `state/edisDetection.ts` (RN) classify whether a sell rejection is
  EDIS-related. Used by `EdisModal` widget to decide whether to surface the
  re-auth UI after a failed trade. Reads ccxt's `classification` field
  ONLY — no keyword fallback.
- **Sell-auth status hook** (`useSellAuth.ts`): wraps
  `GET /sdk/v1/connections/:broker/sell-auth` for SDK consumers who want a
  pre-trade check. Currently advisory — Alphab2bapp + tidi_new read flags
  directly from `connected_brokers`.

### 8b. What the SDK does NOT own today

- **Pre-trade gate logic** (deciding whether to show EDIS UI before placing
  a trade): owned by `RebalanceModal.js` / `RebalanceReviewPage.dart`.
- **Day-scope enforcement**: backend-only (sellAuthDayCheck.js).
- **Per-broker EDIS WebView flow**: owned by `DdpiModal.js` /
  `DdpiAuthPage.dart`.
- **`update-edis-status` write path**: app calls backend directly.

### 8c. If we extend SDK to own this directly (planned)

If the SDK widgets take over the pre-trade gate, they must:

1. **Honor the day-scope**: SDK should expose
   `evaluateSellAuth({ brokerEntry, nowFn?: () => Date }): { authorized: bool, reason: 'ddpi' | 'today_tpin' | 'expired_tpin' | 'never_authorized' }`.
   Pure function. `nowFn` injectable for testability.
2. **Live-check integration**: `useSellAuth` already wraps the backend
   `/sell-auth` endpoint. Pre-trade gate widget should call this and AND it
   with the local flag check.
3. **WebView host**: SDK should ship a `<EdisAuthFlow broker={...} />`
   widget that runs the broker-specific WebView and POSTs `update-edis-status`
   on completion. App-side `DdpiModal` / `DdpiAuthPage` becomes a thin wrapper.
4. **Keep the canonical doc here**. Add a `SELL_AUTH_REFERENCE.md` to the SDK
   `docs/` that points back to this doc as the source of truth.

When this lift happens, update §8a/§8b to reflect the new ownership and add
the migration step to `PHASE3_PROGRESS.md`.

---

## 9. Per-broker quirks recorded so far

This section captures non-obvious behavior discovered through production
incidents. Add new rows when new quirks surface.

| Date | Broker | Quirk | Where it bit us |
|---|---|---|---|
| 2026-05-02 | **Angel One** (shared mode) | `connected_brokers[Angel One].clientCode` was NEVER persisted on shared-mode connect. The client_code was only embedded in the SmartAPI Bearer JWT's `username` claim. EDIS UI required clientCode and errored "Angel One credentials missing. Please reconnect." | Backend fix: `Routes/sdk/v1/connections.js` Angel One shared-mode branch now extracts clientCode from JWT and persists it. App fix: `DdpiAuthPage._angelOneFlow` (tidi) JWT-fallback for older users with empty clientCode. |
| 2026-05-02 | **All 14 brokers** | Every connect handler hard-coded `is_authorized_for_sell: false` on connect, wiping the user's prior manual EDIS confirmation on every reconnect. | Backend fix: `userRoutes.js` 14 sites + `MultiBrokerService.addBrokerConnection` use `shouldPreserveSellAuth`. |
| 2026-05-02 | **TPIN/EDIS class** | First "preserve" fix kept flag indefinitely — wrong, EDIS expires daily. Stored TRUE from yesterday → user thinks they can sell, broker rejects mid-trade with POA error. | `sell_auth_set_at` timestamp + `shouldPreserveSellAuth` IST day-check. |
| (older) | **Zerodha** | `save-ddpi-status` is the only way to know if today's TPIN session is valid — there's no "is current TPIN session active" introspection on Kite. The endpoint returns the current state by attempting a holdings-margin probe under the user's session. | Pattern shipped in tidi_new `RebalanceReviewPage` line 1470-1488. |
| (older) | **Dhan** | EDIS is per-HOLDING. `get-edis-status` returns per-holding flags; if ANY holding has `edis: false`, the user must re-authorize for that holding via `generate-tpin → enter-tpin` flow. | Pattern in `RebalanceReviewPage._checkDhanEdisStatus`. |
| (older) | **Fyers** | No live-check API. The `submit-holdings` endpoint returns the CDSL form HTML directly; user completes in WebView; on success, frontend POSTs `update-edis-status` to flip the flag. | tidi `DdpiAuthPage._fyersFlow`. |
| 2026-05-04 | **IIFL, Axis, Kotak (2nd path), catch-all (Angel One)** | `ReferenceError: currentUser is not defined` → HTTP 500 on connect. The sell-auth-preserve sed replacement used `currentUser?.is_authorized_for_sell` but 4 of 14 broker blocks in `userRoutes.js` didn't declare `const currentUser = userData[0]`. JS optional chaining on an undeclared variable throws ReferenceError (unlike `typeof` which doesn't). | Fix: inserted `const currentUser = userData[0]` in the 4 missing blocks. Lesson: sed across many sites can introduce ReferenceErrors — always verify each block has the variables the replacement references. |

---

## 10. Documentation update contract — BLOCKING

> **🔴 EVERY commit that touches sell-auth surfaces MUST update this doc IN
> THE SAME COMMIT. No exceptions.**

**Surfaces in scope:**

1. Backend persist paths:
   - `Routes/userRoutes.js` (any broker connect-broker handler)
   - `Routes/UpdateEdisStatus.js`
   - `Routes/sdk/v1/connections.js` (any broker exchange-token / connect branch)
   - `services/MultiBrokerService.js`
   - `Routes/Broker/<Broker>.js` (per-broker update-key paths)
   - `Models/userModel.js` (any field on userSchema or connectedBrokerSchema
     in the sell-auth set: `ddpi_enabled`, `is_authorized_for_sell`,
     `sell_auth_set_at`, `sell_auth_revoked_at`, `sell_auth_revoke_reason`,
     `tpin_enabled`)
   - `utils/sellAuthDayCheck.js`

2. Backend live-check endpoints:
   - `aq_backend_github/Routes/Broker/*` proxies to ccxt's verify-dis /
     save-ddpi-status / edis-status / verify-edis endpoints

3. ccxt-side classification + auto-revoke:
   - `trading_logic/sell_auth_revoke.py` (or wherever the SELL_AUTH_REVOKED
     classifier lives)
   - `app_<broker>.py` verify-dis / edis-status routes

4. Mobile app pre-trade gates:
   - tidi_new: `RebalanceReviewPage.dart` (per-broker if-blocks),
     `DdpiAuthPage.dart` (any broker flow)
   - Alphab2bapp: `RebalanceModal.js` (per-broker if-blocks),
     `DdpiModal.js`, `ZerodhaTpinModal.js`, `AngleOneTpinModel`, etc.

5. SDK widgets:
   - `alphaquark-mobile-sdk/packages/flutter/lib/src/widgets/edis_modal.dart`
   - `alphaquark-mobile-sdk/packages/rn/src/components/EdisModal.tsx`
   - `state/edis_detection.dart` / `state/edisDetection.ts`
   - `hooks/useSellAuth.ts`

**What "update this doc" means:**

- New broker added → add a row in §4 per-broker matrix
- New live-check endpoint added → update §4 column "Live server-side check" + §7a + §8
- New flag added → update §2 + §6
- New code path added → update §6c "Required code paths"
- New per-broker quirk discovered → add a row in §9
- SDK ownership changed → update §8

**Mirror docs:**

The SDK + tidi_new should keep lightweight `SELL_AUTH_REFERENCE.md` files
that point here. If those need an update too (because the SDK / tidi-app
side changed), update them in the same commit.

**CLAUDE.md blocking rule:**

This rule is mirrored in:
- `Alphab2bapp/CLAUDE.md` § Sell-auth blocking rule
- `tidi_new/tidistockmobileapp/CLAUDE.md` § Sell-auth blocking rule
- `aq_backend_github/CLAUDE.md` § Sell-auth blocking rule
- `ccxt-india/CLAUDE.md` § Sell-auth blocking rule
- `alphaquark-mobile-sdk/CLAUDE.md` § Sell-auth blocking rule (when added)

A commit that touches a sell-auth surface without updating those CLAUDE.md
references AND this doc is incomplete and must be amended before merging.
