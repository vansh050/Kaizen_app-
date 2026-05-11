# Phase 3 — Per-Broker Legacy → SDK Audit

> **Source of truth for whether a broker can move from legacy modal → SDK widget.** The `SDK_ELIGIBLE_MODALS` allowlist in `ModalManager.js` MUST be derived from this doc, not the other way around. See `CLAUDE.md § Phase 3 SDK Broker Migration — BLOCKING DOCUMENTATION REQUIREMENT`.

## Verdict definitions

- **SDK-clean** — every legacy UX surface is mapped to a working SDK equivalent. Safe to add to `SDK_ELIGIBLE_MODALS`. End-to-end verified on emulator.
- **SDK-with-gap** — known gaps between legacy and SDK. Stays out of allowlist until gaps close. Each gap is a row in this doc with a fix plan.
- **SDK-broken** — SDK path is fundamentally incomplete or regressed; no near-term plan. Stays legacy.
- **Not-audited** — row exists but the audit hasn't been done. Treat as SDK-broken until audited.
- **Incomplete-audit** — partial audit (e.g. only the wrapper file was read; deeper component requires follow-up).

## Audit row schema

For each broker, the row captures:

- **Legacy modal file** — path under `src/components/BrokerConnectionModal/` (or `src/components/`).
- **Legacy submit endpoint(s)** — backend route(s) the modal posts to, with file:line references.
- **Encryption envelope** — what the legacy modal encrypts before wire transmission.
- **Form fields collected** — what the user enters.
- **OAuth WebView flow** — whether OAuth is used; how the redirect is intercepted.
- **Reauth handling** — whether `reauthConfig` is consumed and what shape it takes.
- **IP-whitelist callout** — whether EgressIpCallout (or equivalent) gates submit.
- **Broker-specific quirks** — anything outside the standard credentials/OAuth shape.
- **Success / error handling** — what the modal does on 2xx / 4xx / network error.
- **Gap vs SDK widget** — concrete gap between legacy and SDK pair (`BrokerCredentialForm` + `WebViewBrokerAuthFlow`).
- **Verdict** — SDK-clean / SDK-with-gap / SDK-broken / Not-audited / Incomplete-audit.
- **Last verified** — date + commit SHA + emulator/device evidence.

## Summary table

| Broker | visibleModal key | SDK BrokerName | Legacy modal | Verdict (today) |
|--------|------------------|----------------|--------------|-----------------|
| Zerodha | `Zerodha` | `Zerodha` | `ZerodhaConnectModal.js` (thin wrapper around `ZerodhaConnectUI`) | **Incomplete-audit** — Android intercept logic in UI component not yet read. Treat as SDK-broken. |
| Angel One | `Angel One` | `Angel One` | `AngleoneBookingModal.js` | **SDK-broken — added to `SDK_LEGACY_FALLBACK` 2026-04-30 (regression fix).** Two open gaps: (1) SDK schema always renders the per-customer `apiKey+secretKey+clientCode` form (Phase3SdkBrokerModal.js:264-268 "Tracked as Known Gap"); shared-mode advisors (default) need an empty-fields publisher-OAuth schema like Zerodha. (2) Backend `/sdk/v1/connections/Angel One/exchange-token` doesn't yet handle `auth_token` callback for shared mode. While both gaps are open the consumer routes to legacy `AngleOneBookingTrueSheet` so Connect Angel One works for every advisor today. Removal criterion: schema gap (1) + backend gap (2) both close — tracked in § Angel One open gaps below. |
| Upstox | `Upstox` | `Upstox` | `upstoxModal.js` | **SDK-clean** (PROMOTED 2026-04-28) — IP_WHITELIST_BROKERS + backend /exchange-token dispatch + SDK_ELIGIBLE_MODALS. Reauth still routes to legacy via `isReauthFlow` short-circuit. |
| ICICI Direct | `ICICI` | `ICICI Direct` | `icicimodal.js` | **SDK-clean** (PROMOTED 2026-04-28) — backend `/exchange-token` ICICI dispatch already existed (connections.js:1180-1205, exchanges `apisession`→`session_token`); IP_WHITELIST_BROKERS already included; just needed allowlist promotion. |
| Kotak Securities | `Kotak` | `Kotak` | `KotakModal.js` | **SDK-clean** (PROMOTED 2026-04-28, with documented minor diff) — credentials_totp; backend `/update-credentials` dispatches to `/api/kotak/connect-broker`. Minor diff: 30s TOTP debounce + TOTP error parsing not in SDK widget. |
| Dhan | `Dhan` | `Dhan` | `DhanConnectModal.js` | **SDK-clean** (PROMOTED 2026-04-28) — partner-OAuth, no IP gate needed, backend `/exchange-token` fallthrough handles `dhan_client_id` + `dhan_access_token`. Just needed allowlist promotion. Minor diff: prefetch optimization + manual fallback path not in SDK widget. |
| Fyers | `Fyers` | `Fyers` | `FyersConnect.js` | **SDK-clean** (PROMOTED 2026-04-28) — IP_WHITELIST extension + backend `/exchange-token` Fyers dispatch (translates field-naming inversion server-side: modal `apiKey` → ccxt `clientSecret`, modal `secretKey` → ccxt `clientId`). Reauth routes to legacy. |
| IIFL Securities | `IIFL` / `IIFL Securities` | `IIFL Securities` | `src/components/iiflmodal.js` | **SDK-broken** (REVERTED 2026-04-29 audit) — SDK schema is `credentials_totp` but legacy is empty-fields OAuth at hardcoded `markets.iiflcapital.com`. No slug in `LEGACY_PER_BROKER_SLUG`, no `/login-url` dispatch, no `Phase3BrokerHelp` entry. Stays legacy until schema reshape + backend dispatches land. |
| AliceBlue | `AliceBlue` | `AliceBlue` | `AliceBlueConnect.js` | **SDK-clean** (PROMOTED 2026-04-28) — schema changed to `flow=oauth, fields=[]`; backend `/login-url` hardcodes `origin=https://prod.alphaquark.in`; backend `/exchange-token` accepts `{access_token, client_id}`. |
| Motilal Oswal | `Motilal` | `Motilal Oswal` | `MotilalModal.js` | **SDK-clean** (PROMOTED 2026-04-28, with documented minor diff) — IP_WHITELIST + backend `/exchange-token` Motilal dispatch + SDK_ELIGIBLE. Minor diff: SDK widget lacks 30s session-affinity debounce (user-accepted minor diff). |
| HDFC Securities | `HDFC` | `Hdfc Securities` | `HDFCconnectModal.js` | **SDK-clean** (PROMOTED 2026-04-28) — added to `IP_WHITELIST_BROKERS` + backend `/exchange-token` HDFC dispatch + `BrokerConnectModalDispatch.SDK_ELIGIBLE_MODALS` |
| Groww | `Groww` | `Groww` | `GrowwConnectModal.js` | **SDK-clean** (PROMOTED 2026-04-29) — SDK schema reshaped to 2 fields (apiKey JWT + growwTotpSeed Base32, permissive `^[A-Z2-7]+$/i`); backend `/sdk/v1/connections/Groww/connect` dispatches to `/api/groww/update-key` via `CREDENTIAL_BROKER_VALIDATE_DISPATCH`, full ccxt validation runs server-side. |
| Axis Securities | `Axis Securities` | `Axis Securities` | `AxisConnectModal.js` | **SDK-clean** (PROMOTED 2026-04-28) — backend dispatches verified present (connections.js:894 `/login-url`, 1117 `/exchange-token`); removed from SDK_LEGACY_FALLBACK + added to SDK_ELIGIBLE_MODALS. Subject to upstream Axis SSO bug 1083 (Axis-side, not ours). |

**Today's intended `SDK_ELIGIBLE_MODALS` membership** (post 2026-04-29 Groww promotion):
```
{HDFC, Upstox, ICICI, Motilal, Dhan, Kotak, AliceBlue, Fyers, Axis Securities, Groww, DummyBroker}
```
11 of 14 brokers SDK-clean. 2 in `SDK_LEGACY_FALLBACK` (Angel One, Zerodha). 1 unlisted (IIFL Securities).

---

## Per-broker rows

### Zerodha — Incomplete-audit (treat as SDK-broken)

- **Legacy modal file:** `src/components/BrokerConnectionModal/ZerodhaConnectModal.js` — thin wrapper that delegates to `ZerodhaConnectUI` (the actual implementation). Wrapper handles `handleConnectionSuccess` (refresh broker status, emit refreshEvent, close modal).
- **Audit status:** Wrapper-only audit completed. The 500+-line `ZerodhaConnectUI` component (Android intercept logic, apiKey-from-env seeding, Kite Publisher SDK fallback) needs a separate read pass.
- **Known facts (from prior context, NOT yet re-verified):**
  - apiKey is read from `Config.REACT_APP_ZERODHA_API_KEY` at modal open time, not collected.
  - Android-aware redirect intercept — custom `onShouldStartLoadWithRequest` + URL-pattern fallback to catch `kite.zerodha.com` → `prod.alphaquark.in/stock-recommendation?request_token=…` even when Android resolves the 302 chain internally.
  - `prod.alphaquark.in/stock-recommendation` 302's unauthenticated visitors to `/login`. Android resolves the 302 internally before JS hooks fire — the SDK widget misses the original `request_token`-bearing URL.
  - **Real fix is out-of-band**: register a non-redirecting redirect URL on Kite developer portal (e.g. `app-links.alphaquark.in/zerodha-callback`).
- **Verdict:** **Incomplete-audit** — treat as SDK-broken. Until ZerodhaConnectUI is read AND the Kite dev-portal redirect is migrated, Zerodha stays legacy. In `SDK_LEGACY_FALLBACK` today.
- **Last verified:** 2026-04-28, commit `4aca2d4`. Wrapper-level audit only.

---

### Angel One — SDK-broken

- **Legacy modal file:** `src/components/BrokerConnectionModal/AngleoneBookingModal.js`
- **Submit endpoint(s):**
  - WebView navigates to `https://smartapi.angelbroking.com/publisher-login?api_key=${REACT_APP_ANGEL_ONE_API_KEY}` (hardcoded broker URL, line 34).
  - `PUT ${server.server.baseUrl}api/user/connect-broker` (line 110) — persists jwtToken + apiKey + ddpi_status.
- **Encryption envelope:** None — publisher OAuth `auth_token` passed plaintext.
- **Form fields collected:** **None.** Pure publisher-OAuth flow.
- **OAuth WebView flow:** Yes. WebView loads Angel One publisher-login URL with embedded `api_key`. Intercepts via `onNavigationStateChange` (line 82), detects `auth_token=` (line 84), extracts and closes (line 89).
- **Reauth handling:** No `reauthConfig` prop.
- **IP-whitelist callout:** None.
- **Broker-specific quirks:**
  - **Partner-OAuth (broker-initiated)** — Angel One owns the flow; the apiKey is embedded in the WebView URL as a query param, not user-supplied.
  - `ddpi_status` field is persisted alongside `jwtToken` for compliance tracking.
  - Per-customer SmartAPI flow (web-only today, per `prod-alphaquark-github` 0202f27c): user supplies their own `apiKey + secretKey + clientCode` to mint a personal publisher-login URL via `/api/angel-one/update-key` BEFORE OAuth. Mobile-side per-customer mode is on the backlog.
- **Success handling:** Close WebView → PUT connect-broker → toast + refreshEvent.
- **Error handling:** "Connection Error" / "Connection Issue" wording (lines 189–204).
- **Gap vs SDK widget:**
  1. SDK schema today: `flow=oauth, fields=[apiKey, secretKey, clientCode]`. Legacy: NO form, broker-initiated OAuth with embedded shared apiKey. The two are fundamentally different.
  2. SDK widget doesn't support `flow=publisher-oauth` (broker-initiated, no user form, embedded apiKey).
  3. Backend `/sdk/v1/connections/Angel One/exchange-token` doesn't yet handle Angel One callback (auth_token → ccxt `/angelone/generate-session` → mint long-lived JWT).
  4. Per-customer mode requires `flow=credentials-then-oauth` (collect creds → POST update-credentials → capture loginUrl → open WebView). SDK widget doesn't support.
- **Verdict:** **SDK-broken** until SDK schema gains a `publisher-oauth` shape (shared mode) AND `flow=credentials-then-oauth` (per-customer mode) AND backend `/exchange-token` learns Angel One callback. In `SDK_LEGACY_FALLBACK` today, regardless of `useSharedAngelOneKey`.
- **Last verified:** 2026-04-28, commit `c85f85f`. User-reported regression: "Invalid API Key or App not found" (per-customer); shared-mode broken at `/exchange-token`.

---

### Upstox — SDK-with-gap

- **Legacy modal file:** `src/components/BrokerConnectionModal/upstoxModal.js`
- **Submit endpoint(s):**
  - `POST api/upstox/update-key` on aq_backend_github (line 150) — credentials + redirect_uri → mints authUrl.
  - `POST upstox/gen-access-token` on ccxt-india (line 256) — exchanges code for access_token.
  - `PUT api/user/connect-broker` on aq_backend_github (line 307) — persists jwtToken + encrypted apiKey/secretKey.
- **Encryption envelope:** `CryptoJS.AES.encrypt(value, 'ApiKeySecret')` (line 73) — apiKey + secretKey encrypted before all three calls.
- **Form fields collected:** apiKey, secretKey (both password-hidden by default).
- **OAuth WebView flow:** Yes. WebView at authUrl. Intercepts via `onNavigationStateChange` (line 224), detects `code=` (line 228).
- **Reauth handling:** Yes — `reauthConfig` pre-fills apiKey, secretKey, authUrl; skips form, jumps to WebView (lines 422–432). Hydration gated by ref.
- **IP-whitelist callout:** Yes — EgressIpCallout, `egressReady` gate at line 130, `unmetAck` flash for 2.5s if user taps Connect without acking.
- **Broker-specific quirks:**
  - Defensive URL-param parsing for Upstox error responses (lines 181–196) — avoids React Native's partial `URL().searchParams`.
  - Form-encodes spaces as `+`, not `%20` (line 187).
  - Validates `redirect_uri` before sending (lines 135–138).
- **Success handling:** Close WebView → POST gen-access-token → PUT connect-broker → optional model-portfolio refresh (line 338) → refreshEvent + toast.
- **Error handling:** Three layers: authUrl error_code/error_message detection (lines 172–210), token-exchange failure with "Connection Error" fallback (line 274), connect-broker HTTP-vs-network distinction (lines 377–395).
- **Gap vs SDK widget:**
  1. **No reauthConfig pre-fill in SDK** — losing reauth optimization (form-skip → straight to WebView with pre-signed authUrl). Cross-cutting gap; affects every credential-OAuth broker.
  2. **Defensive URL parsing** — SDK's `WebViewBrokerAuthFlow` would need to mirror Upstox's bespoke param-decoding (form-encoded spaces).
- **Verdict:** **SDK-with-gap.** Core OAuth flow is SDK-compatible; the reauth + URL-parsing nuances need either SDK widget extensions or a Phase3SdkBrokerModal-level shim. Until reauth pre-fill API exists in `BrokerCredentialForm`, do NOT promote — re-auth would force users to re-enter creds.
- **Last verified:** 2026-04-28, code-read audit; emulator end-to-end NOT yet verified.

---

### ICICI Direct — SDK-with-gap

- **Legacy modal file:** `src/components/BrokerConnectionModal/icicimodal.js`
- **Submit endpoint(s):**
  - `PUT api/icici/update-key` (line 284) — credentials → backend returns login URL.
  - `POST icici/customer-details` on ccxt-india (line 188) — exchanges `apisession` query param for `session_token`.
  - `PUT api/user/connect-broker` (line 222) — persists session_token + encrypted apiKey.
- **Encryption envelope:** `CryptoJS.AES.encrypt(value, 'ApiKeySecret')` (line 258 for apiKey, line 211 for secretKey on persist).
- **Form fields collected:** apiKey, secretKey.
- **OAuth WebView flow:** Yes. WebView navigates to ICICI's direct login URL (line 295). Intercepts via `onNavigationStateChange` (line 168), detects `apisession=` (NOT OAuth `code=`).
- **Reauth handling:** Yes — `reauthConfig` pre-fills apiKey + authUrl, skips credential form (lines 98–106).
- **IP-whitelist callout:** Yes — EgressIpCallout, `egressReady` gate (line 268).
- **Broker-specific quirks:**
  - **ICICI returns `apisession=` not OAuth `code=`** — non-standard query param.
  - **CCXT-relayed exchange** — backend `customer-details` endpoint handles `apisession → session_token` (no direct `/gen-access-token` step like other OAuth brokers).
- **Success handling:** Close WebView → POST customer-details → PUT connect-broker → optional model-portfolio refresh → refreshEvent + toast.
- **Error handling:** Two-level: session exchange fail "Connection Failed" alert (line 203), connect-broker HTTP-vs-network distinction (lines 237–254).
- **Gap vs SDK widget:**
  1. **`apisession` capture vs OAuth `code`** — SDK's `WebViewBrokerAuthFlow` matches generic redirect URL but the param the SDK forwards is whatever it captures; backend `/sdk/v1/connections/ICICI Direct/exchange-token` would need to accept `apisession` and proxy to ccxt `customer-details`. Verify backend behavior.
  2. **No reauthConfig pre-fill in SDK.**
  3. **EgressIpCallout content** — Phase3SdkBrokerModal has the callout for ICICI but the legacy step-by-step IP-claim screens may be richer than what `EgressIpCallout` shows today (user feedback 2026-04-28: "sdk does not show the steps and the static IP claim etc screen").
- **Verdict:** **SDK-with-gap.** Backend `exchange-token` for ICICI must be verified; reauth pre-fill missing; IP callout content thinner than legacy.
- **Last verified:** 2026-04-28, code-read audit.

---

### Kotak Securities — SDK-broken

- **Legacy modal file:** `src/components/BrokerConnectionModal/KotakModal.js`
- **Submit endpoint:** `PUT api/kotak/connect-broker` (line 209) — single comprehensive call with apiKey + mobileNumber + mpin + ucc + totp. No separate `/update-key` or OAuth step.
- **Encryption envelope:** `CryptoJS.AES.encrypt(apiKey, 'ApiKeySecret')` (line 200) — only apiKey encrypted; mobileNumber, mpin, ucc, totp sent plaintext.
- **Form fields collected:** apiKey, mobileNumber (10-digit, normalized), mpin (6-digit), ucc, totp (6-digit TOTP code).
- **OAuth WebView flow:** **No.** Pure credentials + TOTP.
- **Reauth handling:** No `reauthConfig` prop. On reconnect, pre-fills mobileNumber from `connected_brokers[broker='Kotak'].mobileNumber` (lines 80–93). User re-enters mpin + totp.
- **IP-whitelist callout:** Yes — EgressIpCallout, `egressReady` gate (line 130).
- **Broker-specific quirks:**
  - **TOTP rotates every 30s** — Kotak enforces 30s debounce on Connect button to avoid parallel requests reusing a stale TOTP (lines 116–151).
  - Mobile number normalization strips `+91`/`0` prefix (lines 164–182).
  - mpin (6-digit) and totp (6-digit) strict validation (lines 184–196).
  - TOTP-error detection: if error contains 'otp'/'totp'/'two factor', surface hint about regeneration (lines 316–320).
- **Success handling:** Direct PUT (no WebView) → optional model-portfolio refresh → refreshEvent + toast.
- **Error handling:** Granular TOTP-aware error wording.
- **Gap vs SDK widget:**
  1. **SDK schema today: `flow=credentials_totp, fields=[consumerKey, consumerSecret, mobileNumber, password, mpin]`.** This doesn't match legacy fields exactly: legacy has `apiKey + mobileNumber + mpin + ucc + totp`; SDK schema lists `consumerKey + consumerSecret + mobileNumber + password + mpin`. Verify whether SDK schema or legacy is correct for current Kotak NEO API.
  2. SDK widget doesn't support 30s TOTP-debounce gate.
  3. No `ucc` field in SDK schema.
  4. No `totp` field (SDK has `mpin` but `mpin` is a separate piece).
- **Verdict:** **SDK-broken** until the SDK schema matches the live Kotak NEO API exactly AND adds a TOTP-debounce gate. Legacy KotakModal was migrated to NEO recently (commit `b6e3601`); SDK schema may be outdated.
- **Last verified:** 2026-04-28, code-read audit. Schema mismatch flagged for Kotak NEO commit ref.

---

### Dhan — SDK-with-gap

- **Legacy modal file:** `src/components/BrokerConnectionModal/DhanConnectModal.js`
- **Submit endpoint(s):**
  - `GET dhan/login` on ccxt-india (line 91, prefetch) — generates consent URL, follows 302 chain client-side.
  - `PUT api/user/connect-broker` (line 193) — persists clientCode + jwtToken.
- **Encryption envelope:** None — OAuth tokens passed plaintext.
- **Form fields collected:** None in OAuth mode. Fallback manual mode: clientId + accessToken (lines 36–37).
- **OAuth WebView flow:** Yes. WebView loads prefetched OAuth URL (line 283). CCXT relay redirects through ccxt → auth.dhan.co → partner-login.dhan.co. Intercepts via `onNavigationStateChange` (line 132), detects `dhan_client_id=` + `dhan_access_token=` (line 136).
- **Reauth handling:** No `reauthConfig` prop.
- **IP-whitelist callout:** None.
- **Broker-specific quirks:**
  - **Prefetch optimization** (lines 101–127) — on modal mount, fetches OAuth URL in parallel using `fetch({redirect:'follow'})` to follow the 302 chain client-side, lands final URL in state before WebView opens.
  - **Manual fallback path** — if OAuth fails, user can paste clientId + accessToken directly.
- **Success handling:** Close WebView → PUT connect-broker → optional model-portfolio refresh → refreshEvent + toast.
- **Error handling:** Generic "Connection Failed" / "Connection Issue" wording (lines 247–264).
- **Gap vs SDK widget:**
  1. SDK widget today: `flow=credentials, fields=[accessToken], submitEndpoint=connect`. This matches the manual-fallback path, NOT the primary OAuth path.
  2. SDK widget lacks prefetch + 302-chain-follow logic.
  3. No SDK widget shape for "primary OAuth, fallback to credentials" composite flow.
- **Verdict:** **SDK-with-gap.** SDK can cover the manual-fallback path (paste accessToken) but not the primary OAuth-with-prefetch path. Either SDK schema for Dhan switches to `flow=oauth` (losing manual fallback) OR SDK gains a `flow=oauth-with-credentials-fallback` shape.
- **Last verified:** 2026-04-28, code-read audit.

---

### Fyers — SDK-with-gap

- **Legacy modal file:** `src/components/BrokerConnectionModal/FyersConnect.js`
- **Submit endpoint(s):**
  - `POST api/fyers/update-key` (line 300) — mints auth URL from `clientCode + secretKey`.
  - `POST fyers/gen-access-token` on ccxt-india (line 130) — exchanges `auth_code` for accessToken.
  - `PUT api/user/connect-broker` (line 176) — persists jwtToken + clientCode + encrypted secretKey.
- **Encryption envelope:** `CryptoJS.AES.encrypt(apiKey, 'ApiKeySecret')` (line 279) — only apiKey encrypted on persist.
- **Form fields collected:** apiKey (OAuth secret in DB → modal naming `apiKey`), secretKey (clientId in DB → modal naming `secretKey`).
- **OAuth WebView flow:** Yes. Intercepts via `onNavigationStateChange` (line 100), detects `auth_code=` (line 104).
- **Reauth handling:** Yes — `reauthConfig` consumed, with field-name translation (modal `apiKey` ↔ DB `secretKey`, modal `secretKey` ↔ DB `clientCode`) at lines 346–355.
- **IP-whitelist callout:** Yes — EgressIpCallout, `egressReady` gate (line 287).
- **Broker-specific quirks:**
  - **Field-naming inversion** — modal `apiKey` is OAuth secret; modal `secretKey` is clientId. Opposite of DB. Reauth translation handles this.
  - update-key endpoint returns `response.data.response` (not `.authUrl`).
- **Success handling:** Close WebView → POST gen-access-token → PUT connect-broker → toast + refreshEvent.
- **Error handling:** "Connection Error" / "Connection Issue" wording (lines 248–263).
- **Gap vs SDK widget:**
  1. **Field-naming inversion** — SDK `BrokerCredentialForm` for Fyers needs schema mapping `apiKey↔secretKey, secretKey↔clientCode` to match user expectations on screen. If schema is `[apiKey, apiSecret]` (standard OAuth), the user-visible field names won't match Fyers's developer portal naming.
  2. No reauthConfig pre-fill in SDK.
- **Verdict:** **SDK-with-gap.** Schema rename + reauth pre-fill required.
- **Last verified:** 2026-04-28, code-read audit.

#### 2026-05-01 — Fyers backend exchange-token + smart-reauth + update-key fully aligned to new schema (4-round saga)

After the morning's SDK schema rewrite (App ID / App Secret / Fyers User ID labels), THREE backend paths still had old-schema field semantics:

1. **`/api/fyers/update-key`** (login-url path) — `Routes/Broker/Fyers.js`. Was forwarding `data.apiKey` to ccxt as `clientId` WITHOUT decrypting. Fix: `tryDecrypt`-or-passthrough heuristic (`U2FsdGVkX1` prefix → AES-decrypt, else plaintext) on both `data.apiKey` and `data.clientCode`. Resolution: prefer decrypted `data.apiKey` as App ID; fall back to decrypted `data.clientCode` (legacy).
2. **`/api/user/brokers/Fyers/reauth-url`** (smart-reauth path) — `Routes/multiBrokerRoutes.js:818-843`. Was reading `credentials.clientCode` raw and forwarding to ccxt. Fix: same `tryDec` helper; resolution prefers `credentials.apiKey` then `credentials.clientCode`. **This was the actual code path the SDK auto-jump uses** — fixing only `/update-key` (rounds 1-2) was a no-op for the user's flow.
3. **`/sdk/v1/connections/Fyers/exchange-token`** — `Routes/sdk/v1/connections.js:1643-1713`. Was computing `SHA-256("YR17597:UMEG2NCP7W-200")` (FY user ID treated as App ID, App ID treated as App Secret). Fix: branch on `body.apiKey` presence:
   - **Form path** (`body.apiKey` present): `fyClientId = decrypt(body.apiKey)` (App ID), `fyClientSecret = decrypt(body.secretKey)` (App Secret).
   - **Autojump path** (`body.apiKey` absent): `fyClientId = body.clientCode` (App ID, legacy), `fyClientSecret = decrypt(body.secretKey)` (encrypted App Secret).
   - Persistence writes plaintext App ID under BOTH `connected_brokers[Fyers].apiKey` AND `.clientCode` for autojump robustness; encrypted App Secret under `.secretKey`.

**Production impact and recovery:**

User `prikc1333@gmail.com` (tidi tenant) retried 4× and saw "invalid clientId" / "invalid app id hash" each time, because each retry happened to hit a different un-fixed path. After the round-4 fix, end-to-end flow verified on emulator:
- form → /sdk/v1/connections/Fyers/login-url → /api/fyers/update-key → ccxt → Fyers OAuth login → callback with `auth_code` → /sdk/v1/connections/Fyers/exchange-token → ccxt /fyers/gen-access-token (correct SHA-256 hash) → access token persisted.

DB corruption recovery: the round-1 half-fix had written the encrypted `apiKey` blob into the `clientCode` field. Cleaned up via direct mongo `$pull`/`$unset` on the affected user. The `tryDecrypt`-or-passthrough heuristic also auto-recovers any future user in the same corrupted state without manual intervention.

**Verdict:** Fyers stays **SDK-clean** — all three backend paths now correctly resolve App ID and App Secret regardless of whether the user came via form, autojump, or smart-reauth.

**Lessons recorded** in `Alphab2bapp/CLAUDE.md` top-level "🔴 Lesson — broker auth bugs" section: enumerate every ccxt-auth callsite BEFORE writing any fix; encryption symmetry rule; App ID vs user ID labelling; data-corruption recovery via route resilience + DB cleanup.

#### 2026-05-01 — Fyers field labels disambiguated (App ID vs Fyers user ID)

Production users (e.g. clientId `YR17597`) were typing their **Fyers login user ID** into the field labelled `clientCode` and a placeholder `Your Fyers ID (e.g. XL12345)`, then expecting OAuth to succeed. The legacy backend treats `clientCode` as the OAuth `client_id` (App ID from myapi.fyers.in, e.g. `UMEG2NCP7W-200`). The SDK widget inherited this confusion via `broker_form_schema.dart`'s Fyers entry — the field labelled "Client Code" with helper "Your Fyers ID" was actually expected to hold the App ID.

Fix shipped in `alphaquark-mobile-sdk/packages/flutter/lib/src/widgets/broker_form_schema.dart` (Fyers entry):

- **`apiKey` field** relabelled `App ID`, placeholder `e.g. UMEG2NCP7W-200`, helper explicitly stating "From myapi.fyers.in → My Apps → App ID. NOT your Fyers user ID."
- **`secretKey` field** relabelled `App Secret` with helper pointing at myapi.fyers.in.
- **`clientCode` field** relabelled `Fyers User ID` with placeholder `e.g. XL12345 or YR12345` and helper "Your Fyers login ID (used for display only)" — explicitly noting that this is NOT used in OAuth.
- Schema `intro` now reads "Create an app at myapi.fyers.in to get your App ID and App Secret. Do NOT confuse the App ID with your Fyers user ID (YR…/XL…)."
- Prerequisites list expanded to enumerate App ID, App Secret, and Fyers user ID separately.

Backend already accepts the corrected mapping: `aq_backend_github/Routes/Broker/Fyers.js` reads `appId = data.apiKey || data.clientCode`, so the App ID submitted via the SDK form's `apiKey` field flows through as the OAuth client_id correctly.

---

### IIFL Securities — SDK-broken

- **Legacy modal file:** `src/components/iiflmodal.js` (note: in `src/components/`, not `src/components/BrokerConnectionModal/`)
- **Submit endpoint(s):**
  - WebView at `https://markets.iiflcapital.com/?v=1&appkey=nHjYctmzvrHrYWA&redirect_url=${redirectUrl}` (hardcoded broker URL with embedded appkey, line 52).
  - `POST /iifl/login/client` on ccxt-india (line 103) — exchanges `auth_token + clientid` for sessionToken.
  - **No connect-broker step** — sessionToken stored in AsyncStorage (line 123), NOT MongoDB.
- **Encryption envelope:** None — tokens passed plaintext.
- **Form fields collected:** None. Pure OAuth/WebView.
- **OAuth WebView flow:** Yes. Intercepts via `onNavigationStateChange` (line 83), detects `auth_token=` + `clientid=` (line 86).
- **Reauth handling:** No `reauthConfig` prop.
- **IP-whitelist callout:** None.
- **Broker-specific quirks:**
  - **AsyncStorage-only persistence (no MongoDB record)** — major deviation. Every other broker writes `connected_brokers[]` in MongoDB; IIFL writes only to AsyncStorage on the device.
  - **Hardcoded appkey** in WebView URL.
  - SDK dual-write does call `/sdk/v1/connections/IIFL Securities/connect` for parity (lines 132–141).
- **Success handling:** AsyncStorage write → SDK dual-write → Toast + fetchBrokerStatusModal.
- **Error handling:** Toast with HTTP-vs-network distinction (lines 169–187).
- **Gap vs SDK widget:**
  1. **No MongoDB persistence** — SDK widget assumes server-side persistence. IIFL's AsyncStorage-only model means SDK Phase 3 path can't replicate the legacy state shape (UI reads `connected_brokers[]`, not AsyncStorage).
  2. SDK widget would need a special "AsyncStorage-only" persistence mode OR the IIFL backend must start writing MongoDB.
- **Verdict:** **SDK-broken** until either (a) IIFL backend adds MongoDB persistence (server-side change) OR (b) SDK widget gains an AsyncStorage-only mode (architectural change). In neither case is this a near-term move.
- **Last verified:** 2026-04-28, code-read audit.

---

### AliceBlue — SDK-with-gap

- **Legacy modal file:** `src/components/BrokerConnectionModal/AliceBlueConnect.js`
- **Submit endpoint(s):**
  - `GET aliceblue/login?origin=...&returnPath=...` on ccxt-india (line 42) — routes through CCXT for OAuth, returns final URL.
  - `PUT api/user/connect-broker` (line 178) — persists access_token + client_id.
- **Encryption envelope:** None — OAuth tokens passed plaintext.
- **Form fields collected:** **None.** Pure OAuth/WebView.
- **OAuth WebView flow:** Yes. Intercepts via `onNavigationStateChange` (line 120), detects `user_broker=AliceBlue` + `access_token=` + `client_id=` (lines 128–129).
- **Reauth handling:** No `reauthConfig` prop.
- **IP-whitelist callout:** No.
- **Broker-specific quirks:**
  - **HARDCODED `prod.alphaquark.in` origin** (line 40) — DO NOT read from `REACT_APP_BROKER_CONNECT_REDIRECT_URL`. AliceBlue's partner appcode is allow-listed against `prod.alphaquark.in` only. Production incident 2026-04-26: when origin was `app-links.alphaquark.in/broker-callback`, AliceBlue's portal silently bounced users after OTP because redirect URL failed appcode-whitelist check (long comment at lines 24–38).
  - SDK dual-write uses `sdkExchangeBrokerToken` (not `sdkConnectBroker`) because AliceBlue's callback yields `access_token + client_id` not `jwtToken + clientCode`.
- **Success handling:** Close WebView → PUT connect-broker → optional model-portfolio refresh → refreshEvent + toast.
- **Error handling:** "Connection Error" / "Connection Issue" wording (lines 260–275).
- **Gap vs SDK widget:**
  1. **SDK schema today: WRONG.** Likely set to `flow=credentials, fields=[apiKey, userId]` (per the user-reported regression "asked api etc which is not needed"). Legacy is empty-fields OAuth like Zerodha.
  2. **SDK schema needs change to `flow=oauth, fields=[]`** matching Zerodha's shape.
  3. **Hardcoded origin** — SDK's `WebViewBrokerAuthFlow` reads `redirectUrl` prop, which Phase3SdkBrokerModal sets from `Config.REACT_APP_BROKER_CONNECT_REDIRECT_URL`. For AliceBlue specifically this MUST be overridden to `prod.alphaquark.in/stock-recommendation` regardless of the env value; otherwise tenants on non-prod redirect URLs get silent OAuth bounce.
  4. EgressIpCallout — Phase3SdkBrokerModal includes it for AliceBlue (in `IP_WHITELIST_BROKERS`) but legacy AliceBlueConnect doesn't gate on IP. The Phase 3 wrapper's IP gate may be UNNECESSARY for AliceBlue. Verify before removing.
  5. Backend `/sdk/v1/connections/AliceBlue/login-url` must call ccxt `aliceblue/login` with the hardcoded `origin=https://prod.alphaquark.in&returnPath=stock-recommendation` query, not the tenant's redirect URL.
- **Verdict:** **SDK-with-gap.** Two SDK-side fixes (schema → empty-fields OAuth; redirectUrl override hardcoded) + one backend fix (login-url proxy with hardcoded origin) + one Phase3SdkBrokerModal change (remove from `IP_WHITELIST_BROKERS` if legacy doesn't gate).
- **Last verified:** 2026-04-28, code-read audit. User-reported regression: "should have opened the partner based oauth, that also it did not do properly, asked api etc which is not needed".

---

### Motilal Oswal — SDK-with-gap

- **Legacy modal file:** `src/components/BrokerConnectionModal/MotilalModal.js`
- **Submit endpoint(s):**
  - `PUT api/motilal-oswal/update-key` (line 154) — mints auth URL from apiKey + clientCode.
  - WebView intercepts `accessToken=` (line 183) — NO separate `/gen-access-token` step.
  - `PUT api/user/connect-broker` (line 211) — persists jwtToken + apiKey + clientCode.
- **Encryption envelope:** `CryptoJS.AES.encrypt(apiKey, 'ApiKeySecret')` (line 145 update-key, line 204 persist).
- **Form fields collected:** apiKey, clientCode.
- **OAuth WebView flow:** Yes. Intercepts via `onNavigationStateChange` (line 179), detects `accessToken=` (line 183).
- **Reauth handling:** Yes — `reauthConfig` pre-fills apiKey + authUrl (lines 317–325).
- **IP-whitelist callout:** Yes — EgressIpCallout, gate (line 120).
- **Broker-specific quirks:**
  - **Session-affinity guard** — Motilal binds OTP + Authorization header + page session to a single page-load. Back-to-back logins surface "Authorization Invalid" or "Two Factor Authentication Failed". 30s debounce on initiateAuth (lines 116–136).
  - **`handleRequestRestart` callback** (lines 339–344) — wipes authUrl + token + toast flag on WebView error to force full re-auth on next Connect tap.
  - SDK schema lists `[apiKey, apiSecret, userId, password, totpSecret]` — but legacy collects only `apiKey + clientCode`. Verify which is current.
- **Success handling:** Close WebView → PUT connect-broker → optional model-portfolio refresh → refreshEvent + toast.
- **Error handling:** "Connection Error" / "Connection Issue" wording (lines 276–292).
- **Gap vs SDK widget:**
  1. **Schema mismatch** — SDK schema vs legacy field set don't match. Need to verify what Motilal's API expects today and align both.
  2. SDK widget doesn't support 30s session-affinity debounce.
  3. SDK widget doesn't support `handleRequestRestart`-style WebView error → wipe state callback.
  4. No reauthConfig pre-fill in SDK.
  5. **`accessToken` capture vs OAuth `code`** — Motilal's redirect carries `accessToken` directly, no `/gen-access-token` step. Backend `/sdk/v1/connections/Motilal Oswal/exchange-token` must accept `accessToken` and skip the gen-access-token call.
- **Verdict:** **SDK-with-gap.** Schema alignment + session-affinity + reauth + backend exchange-token shape — multiple gaps.
- **Last verified:** 2026-04-28, code-read audit.

---

### HDFC Securities — SDK-clean (PROMOTED 2026-04-28)

- **Legacy modal file:** `src/components/BrokerConnectionModal/HDFCconnectModal.js`
- **Submit endpoint(s):**
  - `POST api/hdfc/update-key` (line 315) — mints auth URL from apiKey + secretKey.
  - `POST hdfc/access-token` on ccxt-india (line 139) — exchanges `requestToken` for accessToken.
  - `PUT api/user/connect-broker` (line 186) — persists jwtToken + apiKey + secretKey.
- **Encryption envelope:** `CryptoJS.AES.encrypt(value, 'ApiKeySecret')` for both apiKey and secretKey (lines 309–310 update-key, line 181 persist).
- **Form fields collected:** apiKey, secretKey.
- **OAuth WebView flow:** Yes. Intercepts via `onNavigationStateChange` (line 109), detects `requestToken=` (line 113).
- **Reauth handling:** Yes — `reauthConfig` pre-fills apiKey + secretKey + authUrl (lines 290–300).
- **IP-whitelist callout:** Yes — EgressIpCallout, gate (line 303).
- **Broker-specific quirks:** Returns `requestToken` (not OAuth `code`); CCXT exchanges via `hdfc/access-token`. Standard pattern, similar to Upstox.
- **Success handling:** Close WebView → POST access-token → PUT connect-broker → toast + refreshEvent.
- **Error handling:** "Connection Error" / "Connection Issue" wording (lines 250–267).
- **Gap vs SDK widget:**
  1. `requestToken` vs `code` — backend `/sdk/v1/connections/Hdfc Securities/exchange-token` must accept `requestToken` query param and proxy to ccxt `hdfc/access-token`. Verify backend behavior.
  2. **Reauth pre-fill missing in SDK** — cross-cutting gap. HDFC reauth would lose the form-skip.
  3. EgressIpCallout for HDFC — Phase3SdkBrokerModal does NOT include HDFC in `IP_WHITELIST_BROKERS` today. Legacy DOES gate on egressReady. If HDFC needs IP whitelist, Phase3SdkBrokerModal `IP_WHITELIST_BROKERS` set must be extended.
- **Verdict:** **SDK-clean (PROMOTED 2026-04-28)**. All three blockers addressed:
  - (a) Backend `/exchange-token` HDFC dispatch added in `aq_backend_github/Routes/sdk/v1/connections.js` (after `Axis Securities` else-if, before `ICICI Direct`). Calls ccxt `/hdfc/access-token` with `{apiKey, apiSecret, requestToken}`, extracts `accessToken`, returns `{jwtToken, apiKey, secretKey}` for the persist step. Backend deploy required (scp to tidi + `sudo systemctl restart alphaquark.service`).
  - (b) `IP_WHITELIST_BROKERS` set in `Phase3SdkBrokerModal.js` extended to include `'HDFC'` and `'Hdfc Securities'`.
  - (c) `BrokerConnectModalDispatch.SDK_ELIGIBLE_MODALS` set updated from `new Set([])` to `new Set(['HDFC'])`. First Phase 3 broker promotion.
  - (d) `Phase3BrokerHelp` already renders `HDFCHelpContent` (existing) — video ID `XFLjL8hOctI` + 5 step guide visible above the form, matching legacy.
- **Last verified:** 2026-04-28 — code-read audit + UX parity assessment. End-to-end emulator verification PENDING (user testing). Commit will be reverted if user reports parity break during testing.

---

### Groww — SDK-clean (PROMOTED 2026-04-29)

- **Legacy modal file:** `src/components/BrokerConnectionModal/GrowwConnectModal.js`
- **Submit endpoint:** `POST api/groww/update-key` (line 139) — single comprehensive call with apiKey + totp_seed (both encrypted). No OAuth, no separate connect-broker step.
- **Encryption envelope:** `CryptoJS.AES.encrypt(plain, 'ApiKeySecret')` for both apiKey and totp_seed (line 44).
- **Form fields collected:**
  - **apiKey** — long JWT-style "TOTP Token" from Groww dialog top.
  - **totpToken** — ~32-char Base32 secret string from below QR code, NOT the JWT.
- **OAuth WebView flow:** **No.** Pure credentials + Base32 TOTP.
- **Reauth handling:** No `reauthConfig` prop. Reauth still routes to legacy via the cross-cutting `isReauthFlow` short-circuit in `BrokerConnectModalDispatch.js`. Note: legacy backend has `/api/groww/refresh-token` for silent reauth — SDK reauth route doesn't yet expose this, but the in-app reauth path is unchanged because reauth always goes legacy.
- **IP-whitelist callout:** Yes — EgressIpCallout, gate (line 110). `IP_WHITELIST_BROKERS` set in `Phase3SdkBrokerModal` already includes `'Groww'`.
- **Broker-specific quirks:**
  - **Dual TOTP values from Groww UI** — JWT ("TOTP Token") + Base32 secret (below QR). User documentation is extensive (lines 292–383) because confusion is common. Both legacy and SDK present 2 fields with helper text spelling out which value goes where.
  - Granular error codes from ccxt-india `app_groww.py`: `NOT_BASE32`, `WRONG_LENGTH`, `GROWW_REJECTED` (line 212).
  - Inline help panel toggles between collapsed (form primary) and expanded ("Important Notes" + "Need Help"), matching Zerodha's pattern.
- **Success handling:** Direct POST update-key (no WebView, no connect-broker) → optional model-portfolio refresh → refreshEvent + toast.
- **Error handling:** Granular per-error-code copy (lines 216–268). SDK widget surfaces these as generic `SdkRequestError` with the upstream `detail` — accepted minor diff (matches Kotak/Motilal precedent).
- **Gap analysis (closed):**
  1. ~~SDK schema [accessToken] vs legacy [apiKey, totp_seed]~~ — **closed by mobile-SDK commit `0291e02`**: schema now `flow=credentials, fields=[apiKey, growwTotpSeed], submitEndpoint=connect`. Field name mismatch (SDK `growwTotpSeed` vs legacy `totp_seed`) absorbed by backend dispatch (`Routes/sdk/v1/connections.js:602-614` accepts either: `body.totp_seed || body.growwTotpSeed`).
  2. ~~16-char strict pattern rejected real Groww secrets~~ — **closed**: pattern relaxed to `^[A-Z2-7]+$/i` (any-length Base32). Wrong-length validation moved server-side in `app_groww.py:_normalize_totp_token` (`NOT_BASE32`, `WRONG_LENGTH` error codes).
  3. ~~`/sdk/v1/connections/Groww/connect` persist-only with no ccxt validation~~ — **closed by backend**: `CREDENTIAL_BROKER_VALIDATE_DISPATCH.Groww` proxies through `/api/groww/update-key` → ccxt validates via Groww `/v1/login` before persistence. Same UX guarantee as legacy (typo'd creds rejected at connect, not at trade-execution time).
- **Accepted minor diffs (not blockers):**
  - Per-error-code custom rendering for `NOT_BASE32` / `WRONG_LENGTH` / `GROWW_REJECTED` / `INVALID_SEED` / `INVALID_CREDENTIALS` — legacy renders 5 broker-specific actionable messages, SDK shows generic `SdkRequestError` with upstream detail. Tracked as Known SDK Gap.
  - Inline help-panel toggle visual chrome — legacy uses "Read More / See Less" with chevron; SDK uses `Phase3BrokerHelp` with `▾ Hide help` toggle (default expanded). Same content, different chrome.
- **Verdict:** **SDK-clean (PROMOTED 2026-04-29)**. Added to `SDK_ELIGIBLE_MODALS` in `BrokerConnectModalDispatch.js`. End-to-end emulator verification PENDING.
- **Last verified:** 2026-04-29, code-read audit + gap closure verified. Note: prior session added Groww App Links via AndroidManifest (commit `f9f5d0f`) but `GrowwConnectModal` does NOT use deep links; pure credential-paste. App Links serve a different broker flow path.

---

### Axis Securities — SDK-with-gap (backend-side)

- **Legacy modal file:** `src/components/BrokerConnectionModal/AxisConnectModal.js`
- **Submit endpoint(s):**
  - `POST axis/login-url` on ccxt-india (line 91) — mints Axis SSO login URL.
  - `POST axis/callback` on ccxt-india (line 177) — exchanges ssoId for authToken + refreshToken.
  - `PUT api/user/connect-broker` (line 305) — persists clientCode + authToken + refreshToken.
- **Encryption envelope:** None — SSO tokens passed plaintext.
- **Form fields collected:** **None.** Pure SSO/WebView (broker-hosted login).
- **OAuth WebView flow:** Yes. **Dual-method intercept:** `onShouldStartLoadWithRequest` (line 147, fires BEFORE WebView loads, returns false to prevent blank landing) + `onNavigationStateChange` (line 158, fallback after URL change). Both extract `ssoId` (lines 124–141) and trigger callback.
- **Reauth handling:** No `reauthConfig` prop. Re-auth uses `existingAxisCode` fallback (line 267) — Axis sometimes omits `accounts[]` array on re-auth because subAccountId is invariant; modal looks up prior `connected_brokers[broker='Axis Securities'].clientCode`.
- **IP-whitelist callout:** None (Axis SSO is broker-hosted).
- **Broker-specific quirks:**
  - Defensive URL parsing avoids React Native's partial `URL().searchParams` (lines 124–141).
  - Axis response envelope can vary: `{data: {...}}` or flat (line 187); authToken nested under multiple paths (`data.authToken`, `data.tokens.authToken`, `data.metadata.authToken`, etc., lines 213–227).
  - `existingAxisCode` fallback for re-auth subAccountId omission (line 267).
  - Uses `CrossPlatformOverlay` instead of raw `<Modal>` (line 391) to avoid Android stacking bugs when opening Axis while ManageConnectionsModal is unmounting.
- **Success handling:** Close WebView → POST callback → PUT connect-broker → toast + refreshEvent.
- **Error handling:** Upstream error detection — Axis can return 200 with `error: {code, error}` envelope (lines 200–206). Network errors get "Connection Issue" (line 364).
- **Gap vs SDK widget:**
  1. **Backend `/sdk/v1/connections/Axis Securities/login-url` proxy is missing or broken** — returns `sdk_error: broker_login_url_failed` per user-reported 2026-04-28 regression. Legacy itself works fine (calls ccxt `axis/login-url` directly); the SDK route doesn't proxy that call. **Fix in `aq_backend_github/Routes/sdk/v1/connections.js`** to add Axis dispatch.
  2. **Robust envelope handling** — backend `/exchange-token` for Axis must handle the multiple authToken nesting paths.
  3. **`existingAxisCode` fallback** — needs server-side awareness for SDK reauth to work.
  4. **CrossPlatformOverlay** — not a widget concern; lives in Phase3SdkBrokerModal which already uses Pressable scrim.
- **Verdict:** **SDK-with-gap.** Legacy is solid; SDK is blocked on backend route. Once the backend `login-url` proxy is implemented and verified, Axis is closest to SDK-clean (after HDFC) given there's no IP gate, no reauth pre-fill issue (no reauthConfig anyway), and the SDK widget's redirect-intercept is generic enough to catch `ssoId=`.
- **Last verified:** 2026-04-28, code-read audit. User-reported SDK regression: `broker_login_url_failed`.

---

## Cross-cutting gaps

These affect multiple brokers and are listed once for visibility:

1. **Re-auth pre-fill missing in SDK** — `BrokerCredentialForm` cannot accept pre-filled stored creds. Affects every credential broker (Upstox, ICICI, HDFC, Motilal, Fyers). Mitigated today by routing all reauth flows to legacy via `isReauthFlow` short-circuit.
2. **`WebViewBrokerAuthFlow.onClose` cred preservation** — When user backs out of WebView, form re-mounts and loses collected creds. Affects every OAuth broker with non-empty fields.
3. **`EgressIpCallout` content vs legacy IP-claim screens** — Legacy modals (Kotak, Groww, AliceBlue, ICICI) have richer step-by-step IP-claim instructions. Phase3SdkBrokerModal's callout may be sparser. **Action:** diff legacy IP UI vs `EgressIpCallout` content for each.
4. **Backend `/exchange-token` per-broker callback handlers** — Brokers with non-standard query params (`apisession` for ICICI, `requestToken` for HDFC, `accessToken` for Motilal, `auth_token` for Angel One/AliceBlue, `ssoId` for Axis) need broker-specific server-side dispatch. Audit `aq_backend_github/Routes/sdk/v1/connections.js` exchange-token implementation against this list.
5. **SDK schema mismatches with live broker APIs** — Kotak NEO and Motilal Oswal show evidence of schema drift between `brokerFormSchema.ts` and the live broker API. Schema audit needed.
6. **30-second debounces / session-affinity** — Kotak (TOTP rotation) and Motilal (page-session affinity) both enforce 30s gaps between submit attempts. SDK widget has no equivalent.
7. **SDK widget schema for "no-form" OAuth brokers** — AliceBlue and (in shared mode) Angel One are pure broker-initiated OAuth with embedded apiKey. SDK shape that fits is `flow=oauth, fields=[]` (Zerodha's shape). For each, verify the SDK schema row and fix.
8. **`IP_WHITELIST_BROKERS` set in Phase3SdkBrokerModal** — currently `{Kotak, Groww, AliceBlue, ICICI, ICICI Direct}`. Audit findings:
   - **HDFC** legacy gates on egressReady but is NOT in the set. Add.
   - **Upstox** legacy gates on egressReady but is NOT in the set. Add.
   - **Fyers** legacy gates on egressReady but is NOT in the set. Add.
   - **Motilal Oswal** legacy gates on egressReady but is NOT in the set. Add.
   - **AliceBlue** is in the set but legacy does NOT gate. Verify whether to remove.
   - **Kotak / Groww** legacy DOES gate. Stay.

## How to update this doc

When you change anything in the Phase 3 surface area:

1. Find the broker row(s) the change affects.
2. Update the relevant fields (legacy submit endpoint, gap analysis, verdict, last verified).
3. If the change closes a gap → promote verdict (e.g. SDK-with-gap → SDK-clean) AND add the broker to `SDK_ELIGIBLE_MODALS` in `ModalManager.js` AND log in `PHASE3_PROGRESS.md`.
4. If the change opens a gap → demote verdict AND remove from `SDK_ELIGIBLE_MODALS` (or add to `SDK_LEGACY_FALLBACK` as a quick mitigation) AND log in `PHASE3_PROGRESS.md`.

Never let `SDK_ELIGIBLE_MODALS` and this doc disagree.
