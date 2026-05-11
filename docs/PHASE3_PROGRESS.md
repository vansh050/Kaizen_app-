# Phase 3 — SDK Migration Progress Log

> **Chronological record of every Phase 3 commit, broker verdict change, regression observed, and rollback decision.** Append-only. See `CLAUDE.md § Phase 3 SDK Broker Migration — BLOCKING DOCUMENTATION REQUIREMENT`.

## Entry format

```
## YYYY-MM-DD — <commit SHA> — <commit subject>

**Broker(s) affected:** <list>
**Files touched:** <list>
**Change summary:** <2-4 sentences>
**Verdict change(s):** <broker: old → new, with one-line reason>
**Regression(s) observed:** <list, or "none">
**Rollback decision:** <yes/no, with reasoning>
**Next step:** <if any>
```

---

## 2026-05-01 — _pending commit_ — fix(fyers-exchange): 4-round saga finally resolved (CLAUDE.md lesson recorded)

**Broker(s) affected:** Fyers (all paths)

**Files touched (across 4 rounds):**
- Round 1+2: `aq_backend_github/Routes/Broker/Fyers.js` — appId resolution + tryDecrypt heuristic on both apiKey and clientCode
- Round 3: `aq_backend_github/Routes/multiBrokerRoutes.js` — Fyers smart-reauth branch (parallel decrypt logic — found by grepping for every callsite that hits `ccxtServerUrl/fyers/login-url`)
- Round 4: `aq_backend_github/Routes/sdk/v1/connections.js` — Fyers exchange-token branch — schema-aware resolution (form path: `decrypt(apiKey)` = App ID, `decrypt(secretKey)` = App Secret; autojump path: `clientCode` = App ID, `decrypt(secretKey)` = App Secret) + persistence writes plaintext App ID under both `apiKey` and `clientCode` fields
- `Alphab2bapp/CLAUDE.md` — top-level "Lesson — broker auth bugs" section
- `tidi_new/tidistockmobileapp/pubspec.yaml` — 2.8.7+77 → 2.8.8+78

**Change summary:**

The same-morning SDK schema fix (Fyers form labels) introduced a fan-out problem: SDK now sends `apiKey=App ID` (encrypted), `secretKey=App Secret` (encrypted), `clientCode=FY user ID` (plaintext display only). But the BACKEND had multiple consumers of those fields — each with its own field-meaning convention. The login-URL endpoint (`/api/fyers/update-key`) was fixed in rounds 1-2. The smart-reauth endpoint (`multiBrokerRoutes.js`) was fixed in round 3. The SDK exchange-token endpoint (`connections.js` Fyers branch) was fixed in round 4 — it had been computing `SHA-256("YR17597:UMEG2NCP7W-200")` (FY user ID + App ID) which is meaningless to Fyers, instead of the correct `SHA-256("UMEG2NCP7W-200:<App Secret>")`.

Each round's fix was correct in isolation but didn't address the user's flow because their attempt happened to hit a different un-fixed path. The user retried 4× and rightly lost patience.

**Verdict change(s):** none (Fyers stays SDK-clean — all paths now correct).

**Regression(s) observed:**
- DB corruption from round-1 half-fix: encrypted blob written to `clientCode` field; recovered by `tryDecrypt`-or-passthrough heuristic AND by direct mongo cleanup of the affected user's record.
- Fyers `connected_brokers[Fyers]` had stale `apiKey: 'YR15597'` after user reconnected with bad input; cleared via `$pull` + `$unset` to force fresh form path. The user typed correct App ID `UMEG2NCP7W-200` on retry.

**Rollback decision:** none.

**Lessons recorded** (CLAUDE.md):
1. Enumerate ALL callsites hitting ccxt's auth endpoint BEFORE writing any fix. Concrete grep commands documented.
2. Encryption symmetry — if `secretKey` is decrypted, assume `apiKey`/`clientCode` need the same transform.
3. App ID vs user ID disambiguation in form labels is non-negotiable — past form labels confused users into typing the wrong values.
4. Data-corruption recovery: route resilience (decrypt-or-passthrough) AND DB cleanup, both.

**Next step:**
- Build + ship tidi AAB v2.8.8+78 (done).
- Apply the same multi-path enumeration when touching any other broker's auth flow (Upstox, ICICI, HDFC, Motilal, AliceBlue all have analogous structure).

---

## 2026-05-01 — _pending commit_ — port: Flutter SDK + tidi_new same-day deltas → RN SDK + Alphab2bapp

**Broker(s) affected:**
- All 13 (matcher hardening — multi-target list + OAuth-param anchor)
- Fyers (SDK form labels)
- Angel One (pre-connect cautionary warning)

**Files touched:**
- `../alphaquark-mobile-sdk/packages/rn/src/components/brokerFormSchema.ts` — Fyers: `apiKey` → "App ID", `secretKey` → "App Secret", `clientCode` → "Fyers User ID" with explicit helpers and rewritten intro/prerequisites.
- `../alphaquark-mobile-sdk/packages/rn/src/components/WebViewBrokerAuthFlow.tsx` — `activeRedirect` (string) → `matchTargets` (string[]); `targetOriginLower` (string) → `targetOrigins` (string[]); origin gate iterates the list; `hasCallbackParam` extended with `authCode`, `dhan_access_token`, `ssoId`, `jwtToken`.
- `../alphaquark-mobile-sdk/packages/rn/src/components/BrokerCredentialForm.tsx` — added `headerSlot?: React.ReactNode` prop, rendered above the title inside the ScrollView.
- `src/components/AngelOneCautionaryWarning.js` (new).
- `src/components/BrokerSelectionModal.js` — gates Angel One first-connect on the warning sheet.
- `src/components/BrokerConnectionModal/Phase3SdkBrokerModal.js` — drop outer ScrollView in the form phase; route EgressIpCallout + Phase3BrokerHelp + errorBox via `BrokerCredentialForm.headerSlot`; pre-fill loader keeps its own ScrollView.

**Change summary:**
1. Multi-target callback URL: previously the backend-supplied `callbackUrl` REPLACED the consumer-passed `redirectUrl` in the matcher's accept-list. That broke Upstox 2026-05-01 — Upstox honors the consumer URL, but the matcher had switched to `prod.alphaquark.in`. Both now ride together; either firing wins.
2. OAuth-param-anchored matcher: callback match requires a known OAuth param name (`code`, `request_token`, `apisession`, `auth_token`, `authCode`, `auth_code`, `access_token`, `dhan_access_token`, `ssoId`, `jwtToken`, etc.). Prevents the matcher firing on intermediate broker pages or the AQ-web fallback page that just renders an empty querystring.
3. Fyers form labels: production user `YR17597` hit "invalid clientId" because the form's `clientCode` field (helper "Your Fyers ID e.g. XL12345") was filled with the user's Fyers login ID. Backend treats `clientCode` as the OAuth `client_id` (App ID from myapi.fyers.in). Relabel removes the ambiguity.
4. headerSlot: previously EgressIpCallout + help content lived in an outer ScrollView, with BrokerCredentialForm having its own internal ScrollView. Nested-scroll dead zone reported on Zerodha. Threading them through the SDK form's headerSlot puts them in the same scroll surface.
5. Angel One pre-connect cautionary sheet: states broker-side restriction up front, asks for explicit ack before opening the connect modal.

**Verdict change(s):** none (no broker moves between SDK-clean / SDK-with-gap / SDK-broken — these are matcher-hardening + UX fixes within the existing verdicts).

**Regression(s) observed:** none yet — RN typecheck green, no breaking schema changes (all additions are optional props or backward-compatible matcher widening).

**Rollback decision:** none.

**Next step:** Bundle Alphab2bapp release build, mirror the AAB upload cadence used for tidi_new today.

---

## 2026-04-30 — _pending commit_ — fix(phase3-reauth): direct-to-OAuth on SDK lane + only-mpin/totp Kotak

**Broker(s) affected:**
- Auto-jump to WebView on re-auth: Zerodha, Upstox, ICICI Direct, Hdfc
  Securities, Motilal Oswal, Fyers, Dhan, AliceBlue, Axis Securities
- Hide-static-fields-on-reauth: Kotak (RN + Flutter)

**Files touched:**
- `../alphaquark-mobile-sdk/packages/rn/src/components/brokerFormSchema.ts`
- `../alphaquark-mobile-sdk/packages/rn/src/components/BrokerCredentialForm.tsx`
- `src/components/BrokerConnectionModal/Phase3SdkBrokerModal.js`
- `../tidi_new/tidistockmobileapp/lib/components/home/portfolio/BrokerCredentialPage.dart`
- `docs/CHANGELOG.md`, `docs/PHASE3_PROGRESS.md`

**Change summary:** User reported that legacy modals took the user
straight to the broker's OAuth page (or only-totp/mpin entry) on
re-auth, whereas the SDK lane re-rendered the full credential form on
every reconnect. Phase3SdkBrokerModal now detects re-auth via stored
`connected_brokers` entry and short-circuits to `WebViewBrokerAuthFlow`
for OAuth-flow brokers (cookies usually mean only TOTP is needed) or
hides apiKey+mobileNumber+ucc for Kotak so only mpin+totp render. The
SDK widget gained a generic `hideFromUi` field flag for the same UX in
any future credentials-flow broker. Flutter mirrors the Kotak fix in
`BrokerCredentialPage.dart` since tidi_new hasn't migrated to Phase 3
SDK yet.

**Verdict change(s):** None. Auto-jump path uses the same SDK endpoints
as first-connect (`/login-url` → WebView → `/exchange-token`); broker
compatibility unchanged.

**Regression(s) observed:** None at time of writing. To watch for:
(a) auto-jump firing on stale `connected_brokers` where stored creds
are no longer valid — backend returns `broker_login_url_failed` which
the new humanizer renders verbatim. (b) Kotak `_hiddenFieldKeys` masking
malformed pre-fill — guarded by `hasFullStored` check that requires
apiKey + clientCode + 10-digit mobile.

**Rollback decision:** No — opt-in per broker via the auto-jump set,
fully reversible.

**Next step:** Watch tidi backend logs for `broker_login_url_failed`
spike on auto-jumped brokers in next 48h. If a specific broker shows
elevated re-auth failure rate, remove it from
`OAUTH_REAUTH_AUTOJUMP_BROKERS` pending investigation.

---

## 2026-04-30 — `81225636` (ccxt-india) + `88ada54` (aq_backend_github) — fix(kotak): surface real validate-step error message + per-user DC URL for orders

**Broker(s) affected:** Kotak.

**Files touched:**
- `ccxt-india/brokers/kotak/kotak.py` — `_kotak_extract_error_message`
  helper used in `get_final_session` validate-failed branch.
- `aq_backend_github/Routes/Broker/Kotak.js` — defensive coerce of
  `response.message` to a string before forwarding.
- `aq_backend_github/Routes/sdk/v1/connections.js` — surface upstream
  message as `detail` field in `broker_credential_update_failed`.
- `Alphab2bapp/src/utils/sdkErrorHumanize.js` — prefer free-form
  `detail` over generic stage body when it looks like a sentence.
- `tidi_new/lib/components/home/portfolio/BrokerCredentialPage.dart` —
  `_handleApiError` coerces non-string `data['message']` via
  `_coerceErrorString`.

**Change summary:** User screenshots showed Kotak failing with the
generic "Failed to connect broker. Please verify your credentials" copy.
ssh tidi log inspection found Kotak's actual rejection
(`{"error":[{"code":"10520","message":"Incorrect M-PIN. You have N more
attempts remaining."}]}`) was being forwarded as a non-string list all
the way to Flutter where a silent Dart type error fell back to the
generic copy. The user retried 4× with wrong MPIN, never seeing why.
Five layers along the message path made defensive — every one would
have caught this on its own. Issue 2 (per-user DC URL missing for
orders) auto-resolves once the user successfully reconnects, since
`Routes/Broker/Kotak.js` already persists `baseUrl` from the validate
response (top-level + connected_brokers slot, since 2026-04-29 commit
`2a39937`).

**Verdict change(s):** None. Kotak verdict in PHASE3_BROKER_AUDIT.md
remains as-is; this is an error-surfacing fix, not a flow change.

**Regression(s) observed:** None — strictly broadens what error text
can be displayed, never narrows.

**Rollback decision:** No.

**Deployment:** `alphaquark.service` and `ccxt_prod.service` restarted
on tidi via systemctl (12:00 UTC 2026-04-30). Mobile app changes ship
in next build.

**Next step:** Watch for any other broker route returning non-string
error fields (same pattern likely exists in at least one of
Upstox/Fyers/Motilal/HDFC). When seen, port the same shape-coerce
helper or rely on the now-defensive humanizer.

---

## 2026-04-30 — _pending commit_ — feat(execution-gate): RN port of tidi `<ExecutionGate>` (greenfield, no entry points migrated)

**Broker(s) affected:** none directly — composable primitive that any
broker entry point will eventually be able to wrap.

**Files touched:**
- `src/components/BrokerConnectionModal/ExecutionGate.js` — new file.
- `docs/CHANGELOG.md` — entry under 2026-04-30.
- `docs/PHASE3_PROGRESS.md` — this entry.

**Cross-repo (tracked separately, not in this commit):**
- `../alphaquark-mobile-sdk/docs/EXECUTION_GATE_COMPOSITION.md` — design
  doc that enumerates the next 4 SDK helpers needed before any tidi or
  Alphab2bapp entry point can actually migrate.

**Change summary:** Shipped the RN counterpart of
`tidi_new/lib/widgets/ExecutionGate.dart` (Flutter commit `7203a13`).
Same lifecycle: `evaluateSessionGate` from `@alphaquark/mobile-sdk`
(stateless probe), Toast on transient, "Session Expired" alert dialog
on `tokenExpired`/`notConnected`, reconnect via the existing
`BrokerConnectModalDispatch` (so `REACT_APP_USE_SDK_BROKER_FLOW` keeps
its single-switch behaviour — the gate does NOT bypass the
dispatcher), post-reconnect re-evaluation, exactly-once `onProceed`.
`cacheInvalidator` calls `useRefreshBrokerStatus({forceNetwork: true})`
(RN's analogue of tidi's `AqApiService.invalidateUserCache`).
`livenessProbe` reuses `validateBrokerSession` so we don't introduce a
second pre-trade probe — Funds API stays the authoritative liveness
check both legacy and SDK already use.

**Verdict change(s):** None. ExecutionGate is a composable primitive,
not a broker-specific routing change; the per-broker SDK_ELIGIBLE/
SDK_BROKEN verdict matrix is unaffected.

**Regression(s) observed:** None — component is greenfield and not
wired into any existing screen. Existing inline pre-trade probe paths
(`StockAdvices.js`, `RebalanceCard.js`, `RebalanceAdvices.js`) remain
unchanged.

**Rollback decision:** Not applicable — additive only. If the
component is later found to be misdesigned, the rollback is "stop
referencing it from new screens" — there are no existing references to
unwind.

**Next step:** Land the SDK design doc in
`alphaquark-mobile-sdk/docs/EXECUTION_GATE_COMPOSITION.md`. It
enumerates the 4 SDK helpers (`evaluateMismatchOutcome`,
`isEdisRequiredError`, `isDummyBroker`/`isMixedDummyAndRealSetup`,
optional funds-floor check) that block any actual migration of
existing entry points. Per the doc, no Alphab2bapp screen should
adopt `<ExecutionGate>` until at least the broker-mismatch helper
ships, because the existing entry points (`RebalanceCard`,
`StockAdvices`) carry mismatch logic inline that would silently regress
if we wrapped them in a gate that doesn't yet handle it.

---

## 2026-04-28 — `4aca2d4` — fix(sdk-phase3): default OFF + always-legacy for re-auth — honest acknowledgement of regressions

**Broker(s) affected:** all 13.

**Files touched:**
- `.env` — `REACT_APP_USE_SDK_BROKER_FLOW=true` → `false`
- `src/GlobalUIModals/ModalManager.js` — added `isReauthFlow` short-circuit, added `SDK_LEGACY_FALLBACK = {Angel One, Zerodha}`, added long-form rationale comments
- `android/app/build.gradle` — versionCode 43 → 44, versionName 3.9.43 → 3.9.44

**Change summary:** Rolled back Phase 3 master flag to OFF after user confirmed multiple production-visible regressions: Axis `broker_login_url_failed`, AliceBlue showing wrong UX, Zerodha 302 intercept loss, Angel One SmartAPI rejection, re-auth misrouted. Re-auth flow now ALWAYS routes to legacy regardless of flag (legacy modals consume `reauthConfig`, SDK widget doesn't). Angel One and Zerodha added to `SDK_LEGACY_FALLBACK` so even when flag is on they route to legacy.

**Verdict change(s):**
- Zerodha: untracked → SDK-broken (Android 302 race not fixable in-app).
- Angel One: untracked → SDK-broken (per-customer flow shape mismatch + `/exchange-token` missing).

**Regression(s) observed:** Axis, AliceBlue, ICICI step-by-step UI all broken when flag was on.

**Rollback decision:** Yes — flag flipped to false. SDK_ELIGIBLE_MODALS still includes all 13 (planned cleanup in Task 66) but flag-off makes it a no-op.

**Next step:** Documentation-first reset (this commit cycle).

---

## 2026-04-28 — `093e5d8` — fix(sdk-phase3): Phase3SdkBrokerModal full-height + WebView intercept fix in SDK

**Broker(s) affected:** All Phase 3 OAuth brokers; Zerodha specifically.

**Files touched:**
- `src/components/BrokerConnectionModal/Phase3SdkBrokerModal.js` — `minHeight: 60% / maxHeight: 92%` → `height: 95%`.
- `../alphaquark-mobile-sdk/packages/rn/src/components/WebViewBrokerAuthFlow.tsx` — added `onLoadStart` hook for redirect detection (commit `d3c628b` on the SDK package).

**Change summary:** Modal was opening as a tiny bottom sheet (60% min) which left no room for `BrokerCredentialForm` prerequisites + 3-5 fields, or for WebView OAuth screens. Resized to 95%. Added `onLoadStart` to `WebViewBrokerAuthFlow` to attempt earlier interception for Android 302s — turned out to be insufficient for Zerodha (Android resolves 302 internally before any JS hook).

**Verdict change(s):** None — Zerodha still SDK-broken after this attempt.

**Regression(s) observed:** Zerodha intercept still misses on Android.

**Rollback decision:** No — full-height + onLoadStart kept; both are improvements. Zerodha gap remains and is documented.

---

## 2026-04-28 — `040b24d` — fix(sdk-phase3): close button on Phase3SdkBrokerModal + restore Angel One in BrokerSelectionModal

**Broker(s) affected:** All Phase 3 brokers (close button); Angel One (selection list).

**Files touched:**
- `src/components/BrokerConnectionModal/Phase3SdkBrokerModal.js` — added `Header` with top-right `✕` close, scrim tap-dismiss via outer `Pressable`.
- `src/config/brokerDisplayConfig.js` — restored Angel One row that was incorrectly commented out.

**Change summary:** Phase3SdkBrokerModal had no way to dismiss when user landed in error state — there was no close button and no back affordance. Added top-right `✕` and tap-outside-to-dismiss. Separately, Angel One had been removed from the broker selection list during an earlier Phase 3 commit; restored.

**Verdict change(s):** None.

**Regression(s) observed:** None new.

**Rollback decision:** No.

---

## 2026-04-28 — `c85f85f` — feat(sdk): Phase 3 Angel One — fall back to legacy when useSharedAngelOneKey=true

**Broker(s) affected:** Angel One.

**Files touched:**
- `src/GlobalUIModals/ModalManager.js` — added `useSharedAngelOneKey` resolver (mirrors web `AppConfigContext`).
- Angel One routing: when shared mode true, fall back to legacy regardless of Phase 3 flag.

**Change summary:** First attempt at making Angel One Phase 3 work safely. Recognized that the SDK route family doesn't yet have a shared-mode `/login-url` handler, so shared-mode advisors must continue to use legacy `AngleoneBookingTrueSheet`. Per-customer mode was assumed to work via SDK widget — turned out to be wrong (see `4aca2d4` rollback).

**Verdict change(s):** Angel One: not-audited → SDK-with-gap (later demoted to SDK-broken on `4aca2d4`).

**Regression(s) observed:** Per-customer mode SmartAPI rejection ("Invalid API Key or App not found").

**Rollback decision:** Partial — `c85f85f` kept the `useSharedAngelOneKey` resolver and shared-mode legacy fallback. Subsequent `4aca2d4` extended the legacy fallback to per-customer mode too (via `SDK_LEGACY_FALLBACK`).

---

## 2026-04-28 — `09ee40d` — feat(sdk): Phase 3 — flag-gated SDK-primary broker connect modal for all 13 brokers

**Broker(s) affected:** All 13.

**Files touched:**
- `src/GlobalUIModals/ModalManager.js` — added Phase 3 dispatch with `SDK_ELIGIBLE_MODALS = {all 13}`, `useSdkBrokerFlow()` getter.
- `src/components/BrokerConnectionModal/Phase3SdkBrokerModal.js` — new file, ~370 lines.
- `src/components/BrokerConnectionModal/EgressIpCallout.js` — port from legacy modals.
- `.env` — added `REACT_APP_USE_SDK_BROKER_FLOW=true` (this branch).

**Change summary:** Initial Phase 3 commit — SDK-primary broker flow. Flag-gated so flipping to false reverts. Flag was set to true on this branch for QA. Allowlisted all 13 brokers without per-broker audit — root cause of the regressions later.

**Verdict change(s):** All 13: untracked → not-audited.

**Regression(s) observed:** Discovered AFTER user tested:
- Axis `broker_login_url_failed`.
- AliceBlue wrong UX (form instead of partner-OAuth).
- Zerodha 302 intercept loss.
- Angel One SmartAPI rejection.
- ICICI / Kotak / Groww IP-callout content thinner than legacy.
- Re-auth flow misrouted.

**Rollback decision:** Eventually yes — `4aca2d4` flipped flag off and added `SDK_LEGACY_FALLBACK` for the worst offenders.

**Lesson:** The mistake was shipping a global allowlist for all 13 brokers without auditing each one's legacy UX surface. Per-broker audit (`PHASE3_BROKER_AUDIT.md`) must be the gate, not the artifact-after-the-fact.

---

## Backfilled — pre-Phase 3 (Phase 1 / Phase 2)

These commits are upstream of Phase 3 and provide context. Not detailed here — see `docs/SDK_MOBILE_FIT_ASSESSMENT.md` and the commit log:

- `c4d89ba` — multi-tenant mint server `X-Advisor-Subdomain` header
- `6267217` — aq-sdk-mint-server live on tidi
- `ec0cf5d` — all 13 brokers dual-write to SDK
- `5fb003f` — swap 4 brokers onto SDK (Zerodha/Kotak/Angel One/AliceBlue)
- `fc4007b` — Metro resolver + provider client + `.env` wiring
- `17ba650` — initial wiring of @alphaquark/mobile-sdk behind feature flag

Phase 3 (this doc's scope) starts at `09ee40d`.

---

## 2026-04-28 — Documentation reset (no commit yet)

**Broker(s) affected:** All 13 (process change, no code change).

**Files touched:**
- `CLAUDE.md` — added "Phase 3 SDK Broker Migration — BLOCKING DOCUMENTATION REQUIREMENT" section, extended session checklist, extended "When to update these docs".
- `docs/PHASE3_ARCHITECTURE.md` — new (this commit cycle).
- `docs/PHASE3_BROKER_AUDIT.md` — new, with framework + initial verdicts.
- `docs/PHASE3_PROGRESS.md` — new (this file).

**Change summary:** Documentation-first reset triggered by user feedback on Phase 3 regressions. CLAUDE.md now blocks any Phase 3 code change without matching updates to all three Phase 3 docs in the same commit. PHASE3_BROKER_AUDIT.md is the new gate for `SDK_ELIGIBLE_MODALS` membership — broker stays out unless verdict=SDK-clean.

**Verdict change(s):** Initial verdicts captured for all 13 brokers — Zerodha, Angel One, AliceBlue, Axis = SDK-broken. Other 9 = Not-audited (functional default = SDK-broken until audited).

**Regression(s) observed:** None (process change).

**Rollback decision:** N/A.

**Next step:** Task 65 — read each of the 9 not-audited legacy modals, populate audit rows. Task 66 — refactor `SDK_ELIGIBLE_MODALS` to be empty by default, derived from this doc. Task 67 — final APK build + commit/push.

---

## 2026-04-28 — Per-broker audit complete (no commit yet)

**Broker(s) affected:** All 13.

**Files touched:**
- `docs/PHASE3_BROKER_AUDIT.md` — populated all 13 broker rows with concrete file:line references, submit endpoints, encryption envelopes, OAuth intercept details, reauth handling, IP-callout gates, broker-specific quirks, gap-vs-SDK analysis, and verdicts.

**Change summary:** Read 13 legacy broker modals end-to-end (delegated to Explore subagent). Replaced "Not-audited" placeholder rows with detailed audits.

**Verdict change(s):**
- Upstox: Not-audited → **SDK-with-gap** (reauthConfig pre-fill, defensive URL parsing).
- ICICI Direct: Not-audited → **SDK-with-gap** (apisession→session_token CCXT exchange, IP callout content).
- Kotak Securities: Not-audited → **SDK-broken** (TOTP + mpin + 30s debounce; SDK schema mismatched with NEO API).
- Dhan: Not-audited → **SDK-with-gap** (prefetch + 302-chain follow optimization).
- Fyers: Not-audited → **SDK-with-gap** (apiKey↔secretKey field naming inversion vs DB).
- IIFL Securities: Not-audited → **SDK-broken** (AsyncStorage-only persistence, no MongoDB).
- Motilal Oswal: Not-audited → **SDK-with-gap** (30s session-affinity debounce, Restart-on-error callback, schema mismatch).
- HDFC Securities: Not-audited → **SDK-clean** (subject to emulator verification + add HDFC to `IP_WHITELIST_BROKERS` set).
- Groww: Not-audited → **SDK-broken** (Base32 TOTP secret + dual-TOTP collection).
- Axis Securities: SDK-broken → **SDK-with-gap** (REVISED — legacy is solid; SDK gap is backend-side `/login-url` proxy).
- AliceBlue: SDK-broken → **SDK-with-gap** (REVISED — legacy is empty-fields OAuth like Zerodha; SDK schema needs change to `flow=oauth, fields=[]` and hardcoded `prod.alphaquark.in` redirect override).
- Zerodha: SDK-broken → **Incomplete-audit** (wrapper-only audit; ZerodhaConnectUI deeper read pending).
- Angel One: SDK-broken (unchanged — confirmed pure publisher-OAuth with embedded apiKey, fundamentally incompatible with SDK widget pair).

**Regression(s) observed:** None (audit-only).

**Rollback decision:** N/A.

**Cross-cutting findings (from audit):**
- `IP_WHITELIST_BROKERS` set in Phase3SdkBrokerModal is INCOMPLETE: should ALSO include HDFC, Upstox, Fyers, Motilal Oswal (all gate on egressReady in legacy). AliceBlue is in the set but legacy does NOT gate — verify before removing.
- Backend `/sdk/v1/connections/:broker/exchange-token` must accept broker-specific query params: `apisession` (ICICI), `requestToken` (HDFC), `accessToken` (Motilal), `auth_token` (Angel One/AliceBlue), `ssoId` (Axis).
- SDK schema for AliceBlue must change to `flow=oauth, fields=[]` (matches Zerodha's shape).
- Cross-cutting reauth pre-fill gap remains — no SDK widget API for pre-filled creds.

**Next step:** Task 66 — refactor `SDK_ELIGIBLE_MODALS` to empty default; gate per-broker promotion on emulator verification + this audit's verdict. HDFC and Axis are the closest to ready (after backend Axis fix). Task 67 — build APK + commit/push the docs reset.

---

## 2026-04-28 — `SDK_ELIGIBLE_MODALS` reset to empty (no commit yet)

**Broker(s) affected:** All 13.

**Files touched:**
- `src/GlobalUIModals/ModalManager.js` — `SDK_ELIGIBLE_MODALS = new Set([all 13])` → `new Set([])`. Updated the surrounding comment to reference `docs/PHASE3_BROKER_AUDIT.md` as the gate for any future addition.

**Change summary:** Inverted the Phase 3 default. Previously: opt-OUT (every broker allowlisted by default; flag-on routes to SDK; `SDK_LEGACY_FALLBACK` carved out exceptions). Now: opt-IN (allowlist empty; flag-on becomes a no-op until a broker is explicitly promoted in the audit doc). With this change, flipping `REACT_APP_USE_SDK_BROKER_FLOW=true` cannot regress any broker — every broker continues to use its legacy modal regardless of the flag.

`SDK_LEGACY_FALLBACK = new Set(['Angel One', 'Zerodha'])` is kept defensively for now. Once a broker is added to `SDK_ELIGIBLE_MODALS` and verified, the SDK_LEGACY_FALLBACK entries can be re-evaluated. If the empty allowlist sticks long-term, the SDK_LEGACY_FALLBACK and the entire `useSdkBrokerFlow() && !isReauthFlow && ...` branch are dead code and can be removed.

**Verdict change(s):** None — verdicts captured in prior entry stand.

**Regression(s) observed:** None (allowlist empty → no behavior change vs flag-off).

**Rollback decision:** N/A.

**Architecture impact:** `docs/PHASE3_ARCHITECTURE.md § SDK_ELIGIBLE_MODALS — the allowlist` already describes the intended end-state; this commit makes it the actual state. Remove the "Today's allowlist is the FULL set of 13 ..." paragraph from the architecture doc when refactor is committed.

**Next step:** Task 67 — build APK + commit/push the full docs-first reset (CLAUDE.md blocker + PHASE3_ARCHITECTURE.md + PHASE3_BROKER_AUDIT.md + PHASE3_PROGRESS.md + ModalManager allowlist reset).

---

## 2026-04-28 — Inline-render bypass fix + help content + Angel One redirect URL parity

**Broker(s) affected:** All 13 (bypass fix); Kotak / Groww / AliceBlue / ICICI / Motilal / HDFC / Fyers / Upstox / Zerodha / Dhan (help content); Angel One (redirect URL).

**Files touched:**
- **NEW** `src/components/BrokerConnectionModal/BrokerConnectModalDispatch.js` — single source of truth for Phase 3 vs legacy routing. Imports all 13 legacy modals + Phase3SdkBrokerModal, applies `useSdkBrokerFlow() && !isReauthFlow && SDK_ELIGIBLE_MODALS.has(key) && !SDK_LEGACY_FALLBACK.has(key)` predicate. Used by ModalManager AND inline-render call sites. Includes `normalizeBrokerKey()` to handle visibleModal/wire-name aliases (`'ICICI Direct' ↔ 'ICICI'`, `'Hdfc Securities' ↔ 'HDFC'`, etc.).
- **NEW** `src/components/BrokerConnectionModal/Phase3BrokerHelp.js` — per-broker help content dispatcher. Renders the existing legacy `*HelpContent.js` components (HDFC, Fyers, Upstox, Motilal, AliceBlue, Zerodha, Groww, Kotak, Dhan, ICICI) inline in Phase3SdkBrokerModal so users get the same step-by-step guides + videos + IP-whitelist warnings the legacy modals show. Default expanded.
- **REWRITTEN** `src/GlobalUIModals/ModalManager.js` — delegates broker-modal rendering to BrokerConnectModalDispatch. ModalManager itself is now thin: handles only the Zustand `visibleModal` store unwrapping + DdpiHelp special-case.
- **EDITED** `src/components/BrokerConnectionModal/Phase3SdkBrokerModal.js` — renders `<Phase3BrokerHelp brokerName={brokerName} />` between `EgressIpCallout` and `BrokerCredentialForm`.
- **EDITED** `src/components/BrokerConnectionModal/AngleoneBookingModal.js` — switched authUrl from `https://smartapi.angelbroking.com/publisher-login?api_key=...` (direct SmartAPI) to `${ccxtUrl}angelone/login-url?apiKey=...&origin=...&returnPath=...&redirectUrl=https%3A%2F%2Falphaquark.in%2Fapi%2Fdeploy%2Fbroker%2Fcallback` (ccxt-relay). Mirror of `prod-alphaquark-github` commit 741d8412 + ccxt-india `_publisher_redirect_url` constant in 81ff50f9. Without this, SmartAPI returns "Invalid redirect URL" when the platform Trading credential has multiple Apps registered.
- **EDITED** `src/components/AdviceScreenComponents/StockAdvices.js` — replaced 11 inline `<LegacyXxxModal />` renders with `<BrokerConnectModalDispatch brokerName="..." ... />`. Removed unused legacy modal imports.
- **EDITED** `src/components/AdviceScreenComponents/RebalanceAdvices.js` — same migration; 10 inline renders replaced; legacy imports removed.
- **EDITED** `src/components/AdviceScreenComponents/AddtoCartModal.js` — removed dead legacy modal imports (file imported them but never rendered).
- **EDITED** `src/components/IIFLReviewTradeModal.js` — removed dead legacy modal imports + dead `GlobalBrokerModals` import (never rendered).
- **DELETED** `src/UIComponents/BrokerConnectionUI/GlobalBrokerModals.js` — duplicate dispatcher that bypassed Phase 3 routing. Zero callers (the only import was a dead reference in IIFLReviewTradeModal).

**Change summary:** Three structural fixes triggered by user feedback after testing Phase 3 with all 13 brokers in the allowlist:

1. **Inline-render bypass** — `StockAdvices.js`, `RebalanceAdvices.js` rendered legacy modals via local React `useState` + inline JSX, completely bypassing `ModalManager.js` and its Phase 3 routing. Result: AliceBlue, Dhan (and the other 9 brokers in those screens) ALWAYS opened legacy regardless of `REACT_APP_USE_SDK_BROKER_FLOW`. Fix extracts the dispatch logic into `BrokerConnectModalDispatch` and replaces every inline render with it. Now Phase 3 routing applies uniformly across all entry points.

2. **Missing help content** — Phase3SdkBrokerModal showed only `EgressIpCallout` + bare `BrokerCredentialForm`. Legacy modals each have rich instructional content (4-8 step guides, video tutorial, broker portal links, IP-whitelist warnings, broker-specific gotchas like Fyers' "Order Placement permission" or Upstox UDAPI1154). Fix reuses the existing `*HelpContent.js` components (HDFC/Fyers/Upstox/Motilal/AliceBlue/Zerodha/Groww/Kotak/Dhan/ICICI all have one) inside the SDK modal via a new `Phase3BrokerHelp` dispatcher. Default expanded since SDK form has no inline copy-text adjacent to inputs.

3. **Angel One redirect URL parity** — mobile legacy `AngleoneBookingTrueSheet` constructed `https://smartapi.angelbroking.com/publisher-login?api_key=...` directly, bypassing ccxt-india's server-side `_publisher_redirect_url` default added in commit 81ff50f9. SmartAPI returns "Invalid redirect URL" when our platform Trading credential has multiple Apps registered (verified live 2026-04-28 in prod-alphaquark-github 741d8412). Fix switches mobile to ccxt-relay with the same `&redirectUrl=https%3A%2F%2Falphaquark.in%2Fapi%2Fdeploy%2Fbroker%2Fcallback` query the web frontend now passes.

**Verdict change(s):**
- Help-content gap from cross-cutting findings closed for the 10 brokers with `*HelpContent` components. Axis, IIFL, Angel One still have no help content (their legacy modals never had one either) — separate gap.
- Routing-bypass gap (NEW; not previously documented) closed across all entry points.
- Angel One legacy mobile parity restored with web — Angel One stays SDK-broken per the audit (pure publisher-OAuth incompatible with SDK widget pair) but the legacy fallback now works correctly.

**Regression(s) observed:** None new (these are fixes to regressions previously documented).

**Rollback decision:** N/A — fixes pending verification on emulator.

**Local test state (NOT committed):**
- `.env`: `REACT_APP_USE_SDK_BROKER_FLOW=true` (master flag on for testing).
- `BrokerConnectModalDispatch.SDK_ELIGIBLE_MODALS` populated with all 13 brokers (LOCAL-TEST OVERRIDE — DO NOT COMMIT marker present).
- `SDK_LEGACY_FALLBACK = {Angel One, Zerodha}` retained — both confirmed SDK-broken in audit.

**Architecture impact:** `PHASE3_ARCHITECTURE.md § Routing rules` should be updated to reference the new `BrokerConnectModalDispatch` as the single source of truth. ModalManager's role shrinks to "Zustand-store unwrapper that delegates to the dispatch". The architecture rule "the only place where SDK-vs-legacy routing happens" still holds — it just moved to a new file that is now invoked from BOTH ModalManager AND inline render sites.

**Next step:** Rebuild APK with the local-test allowlist + flag on, install, user retests Phase 3 across all brokers.

---

## 2026-04-28 — HDFC Securities promoted to SDK-clean (first Phase 3 production promotion)

**Broker(s) affected:** HDFC Securities only.

**Files touched:**
- `src/components/BrokerConnectionModal/Phase3SdkBrokerModal.js` — added `'HDFC'` and `'Hdfc Securities'` to `IP_WHITELIST_BROKERS` set. Comment block now lists the audit-derived membership rule and references each legacy modal's egress gate file:line.
- `src/components/BrokerConnectionModal/BrokerConnectModalDispatch.js` — committed `SDK_ELIGIBLE_MODALS = new Set(['HDFC'])` (replaces the empty default + the local-test override of all 13). HDFC is the first broker promoted to the committed allowlist. Comment now documents the per-broker promotion log.
- `aq_backend_github/Routes/sdk/v1/connections.js` — added `else if (broker === "Hdfc Securities") { ... }` branch in the `/exchange-token` route. Calls ccxt `/hdfc/access-token` with `{apiKey, apiSecret, requestToken}`, extracts `accessToken`, returns `{jwtToken, apiKey, secretKey}` for the persist step. **Backend deploy required**: `scp` modified file to tidi + `sudo systemctl restart alphaquark.service`. Without this deploy, HDFC SDK flow will fail at the exchange step (the fallthrough else-branch treats `requestToken` as the final token, which is wrong).
- `docs/PHASE3_BROKER_AUDIT.md` — HDFC verdict promoted from "SDK-clean (subject to verification)" to "SDK-clean (PROMOTED 2026-04-28)" with full closure of the three blockers (backend dispatch, IP_WHITELIST_BROKERS, allowlist).
- `docs/CHANGELOG.md` — entry for `3.9.46`.
- `android/app/build.gradle` — versionCode 45 → 46, versionName 3.9.45 → 3.9.46.

**UX parity assessment (legacy `HDFCconnectModal` vs Phase 3 `Phase3SdkBrokerModal`):**

| Surface | Legacy | Phase 3 | Match? |
|---------|--------|---------|--------|
| Form fields (apiKey + secretKey, both encrypted with `'ApiKeySecret'`) | ✅ | ✅ via `BrokerCredentialForm` schema | ✅ |
| Video tutorial (YouTube `XFLjL8hOctI`) | Yes via `HDFCHelpContent` | Yes via `Phase3BrokerHelp → HDFCHelpContent` (default expanded) | ✅ |
| 5-step guide ("Go to developer.hdfcsec.com", "Login", "Accept Risk Disclosure", "Create app + IP whitelist + redirect URL", "Copy API + Secret Key") | Yes | Yes (same component) | ✅ |
| Egress IP gate (claim IP → ack checkbox → unblock Connect) | Yes via `EgressIpCallout` | Yes via `EgressIpCallout` (broker now in `IP_WHITELIST_BROKERS`) | ✅ |
| WebView OAuth flow + `requestToken=` redirect intercept | Yes | Yes via `WebViewBrokerAuthFlow` | ✅ |
| Token exchange (ccxt `/hdfc/access-token`) | Client-side POST | Server-side POST in `/exchange-token` route (after backend deploy) | ✅ |
| Persistence (PUT `/api/user/connect-broker`) | Direct | Via `_selfCallLegacy` from `/exchange-token` | ✅ |
| Success Toast wording | "Connected Successfully" / "Your HDFC broker has been connected successfully!" | SDK widget calls `fetchBrokerStatusModal()` then closes; success toast comes from `fetchBrokerStatusModal` if not in migration mode | ⚠️ (toast wording may differ) |
| Error handling: `Connection Error` (HTTP) vs `Connection Issue` (network) | Yes via `showAlert` | SDK `onError` renders error in inline error box | ⚠️ (UX surface differs — banner vs alert) |
| Reauth pre-fill (smart reauth from `reauthConfig`) | Yes (HDFCconnectModal:290-300) | NO — re-auth flows still route to legacy via `isReauthFlow` short-circuit in `BrokerConnectModalDispatch` | ✅ via routing (legacy handles reauth, SDK handles initial) |

**My opinion on UX similarity:** Strong. The two visible regressions (success toast wording, error display surface) are minor. The main connect flow — form → IP gate → help content → WebView → success — is identical at every step. Reauth deliberately stays legacy to preserve the `reauthConfig` pre-fill, which the SDK widget cannot do today. If the user reports the toast wording matters, I'll add a `Toast.show('success', ...)` to `Phase3SdkBrokerModal.onSuccess` matching the legacy copy.

**Verdict change:** HDFC: SDK-clean (subject to verification) → **SDK-clean (PROMOTED)**.

**Regression(s) observed:** None yet (commit pending user testing).

**Rollback decision:** N/A pending. If user reports issues, revert by setting `SDK_ELIGIBLE_MODALS = new Set([])` and removing the HDFC dispatch from backend. Legacy modal stays untouched and remains the fallback.

**Backend deploy steps (required before HDFC SDK flow works):**
```
scp /home/pk/Alphaquark_docs/AlphaQuark/codes/github/aq_backend_github/Routes/sdk/v1/connections.js tidi:servers/server1/aq_backend_github/Routes/sdk/v1/
ssh tidi "sudo systemctl restart alphaquark.service"
```

**Next step:** Upstox migration. Same pattern: extend `IP_WHITELIST_BROKERS`, verify backend `/exchange-token` Upstox dispatch, add to `SDK_ELIGIBLE_MODALS`, audit verdict promotion, commit.

---

## 2026-04-28 — Upstox promoted to SDK-clean (2nd Phase 3 promotion)

**Broker(s) affected:** Upstox.

**Files touched:**
- `src/components/BrokerConnectionModal/Phase3SdkBrokerModal.js` — added `'Upstox'` to `IP_WHITELIST_BROKERS`. Legacy `upstoxModal.js:130` gates Connect button on `egressReady` → SDK now matches.
- `src/components/BrokerConnectionModal/BrokerConnectModalDispatch.js` — `SDK_ELIGIBLE_MODALS` extended to `new Set(['HDFC', 'Upstox'])`.
- `aq_backend_github/Routes/sdk/v1/connections.js` — added `else if (broker === "Upstox") { ... }` branch in `/exchange-token`. Calls ccxt `/upstox/gen-access-token` with `{user_email, apiKey, apiSecret, code, redirectUri}`, extracts `access_token`, returns persistable shape. Backend deploy required.
- `docs/PHASE3_BROKER_AUDIT.md` — Upstox row updated to SDK-clean (PROMOTED 2026-04-28).
- `docs/CHANGELOG.md` — entry for `3.9.48`.
- `android/app/build.gradle` — versionCode 47 → 48, versionName 3.9.47 → 3.9.48.

**UX parity assessment (legacy `upstoxModal` vs Phase 3):**

| Surface | Legacy | Phase 3 | Match? |
|---------|--------|---------|--------|
| Form fields (apiKey + secretKey, both encrypted with `'ApiKeySecret'`) | ✅ | ✅ via `BrokerCredentialForm` | ✅ |
| Help content (YouTube `yfTXrjl0k3E`, 5-step guide, UDAPI1154 IP warning) | Yes via `UpstoxHelpContent` | Yes via `Phase3BrokerHelp → UpstoxHelpContent` (default expanded) | ✅ |
| Egress IP gate (claim → ack → unblock Connect) | Yes | Yes (with this commit) | ✅ |
| WebView OAuth + `code=` redirect intercept | Yes | Yes via `WebViewBrokerAuthFlow` | ✅ |
| Token exchange (ccxt `/upstox/gen-access-token`) | Client-side | Server-side via `/exchange-token` (after backend deploy) | ✅ |
| Persistence (PUT `/api/user/connect-broker`) | Direct | Via `_selfCallLegacy` | ✅ |
| Defensive URL error parsing (Upstox `+`-encoded errors before WebView opens) | Yes (lines 172-210) | NO — relies on backend to surface error via 502 | ⚠️ thinner than legacy but acceptable |
| Re-auth pre-fill (smart reauth from `reauthConfig`) | Yes (lines 421-432) | NO — re-auth flows route to legacy via `isReauthFlow` short-circuit | ✅ via routing |

**My opinion on UX similarity:** Strong. The defensive URL error parsing is a minor regression — instead of showing the broker's specific `error_message` inline in the form before opening WebView, the SDK opens the WebView and lets the user see the broker's error page. Acceptable; users still see the error, just one navigation step later.

**Verdict change:** Upstox: SDK-with-gap → **SDK-clean (PROMOTED)**.

**Backend deploy steps:**
```
scp /home/pk/Alphaquark_docs/AlphaQuark/codes/github/aq_backend_github/Routes/sdk/v1/connections.js tidi:servers/server1/aq_backend_github/Routes/sdk/v1/
ssh tidi "sudo systemctl restart alphaquark.service"
```

**Next step:** ICICI Direct migration. Already in IP_WHITELIST; audit shows backend dispatch already exists for ICICI Direct (line 1180-1205). Should be just SDK_ELIGIBLE_MODALS addition + audit verdict update + commit.

---

## 2026-04-28 — ICICI Direct promoted to SDK-clean (3rd promotion)

**Broker(s) affected:** ICICI Direct.

**Files touched:**
- `src/components/BrokerConnectionModal/BrokerConnectModalDispatch.js` — `SDK_ELIGIBLE_MODALS` extended to `{HDFC, Upstox, ICICI}`. Note allowlist uses the SHORT visibleModal key after `normalizeBrokerKey` (which collapses `'ICICI Direct'` → `'ICICI'`).
- `docs/PHASE3_BROKER_AUDIT.md` — ICICI Direct row updated to SDK-clean (PROMOTED).
- `docs/CHANGELOG.md` — entry for `3.9.49`.
- `android/app/build.gradle` — versionCode 48 → 49.

**No backend changes needed** — `connections.js:1180-1205` already has ICICI Direct dispatch in `/exchange-token`. Already deployed.
**No new IP_WHITELIST_BROKERS entry needed** — `'ICICI'` and `'ICICI Direct'` were already in the set from the foundation commit.

**UX parity assessment:**

| Surface | Legacy | Phase 3 | Match? |
|---------|--------|---------|--------|
| Form fields (apiKey + secretKey, AES "ApiKeySecret" encrypted) | ✅ | ✅ | ✅ |
| Help content (YouTube `XFLjL8hOctI`, 3-step guide, Breeze IP whitelist instructions) | Yes via `ICICIHelpContent` | Yes via `Phase3BrokerHelp → ICICIHelpContent` | ✅ |
| EgressIpCallout gate | Yes | Yes | ✅ |
| WebView OAuth + `apisession=` redirect intercept | Yes (regex parse) | Yes via `WebViewBrokerAuthFlow` | ✅ |
| `apisession` → `session_token` exchange (ccxt `/icici/customer-details`) | Client-side POST | Server-side via `/exchange-token` (already deployed) | ✅ |
| Persistence | Direct `/api/user/connect-broker` | Via `_selfCallLegacy` | ✅ |

**My opinion on UX similarity:** Strong. ICICI Direct was already structurally aligned — just needed the allowlist promotion. The non-standard `apisession` query param (vs OAuth `code`) is handled correctly by the existing backend dispatch.

**Verdict change:** ICICI Direct: SDK-with-gap → **SDK-clean (PROMOTED)**.

**Backend deploy steps:** None — `connections.js:1180-1205` already deployed.

**Next step:** Motilal Oswal migration. Add to IP_WHITELIST + add backend `/exchange-token` Motilal dispatch (handles `accessToken=` from Motilal's non-standard redirect, no separate gen-access-token call) + add to SDK_ELIGIBLE_MODALS.

---

## 2026-04-28 — Motilal Oswal promoted to SDK-clean (4th promotion)

**Files touched:**
- `Phase3SdkBrokerModal.js` — added `'Motilal Oswal'` to IP_WHITELIST_BROKERS.
- `BrokerConnectModalDispatch.js` — `SDK_ELIGIBLE_MODALS` extended to `{HDFC, Upstox, ICICI, Motilal}`.
- `aq_backend_github/Routes/sdk/v1/connections.js` — added Motilal Oswal `/exchange-token` dispatch. Motilal returns `accessToken` directly in callback (no separate gen-access-token call), so the dispatch just forwards `{accessToken, apiKey, clientCode}` to persist via `_selfCallLegacy`. Backend deployed.
- `docs/PHASE3_BROKER_AUDIT.md`, `docs/CHANGELOG.md` (3.9.50), `android/app/build.gradle` (versionCode 50).

**UX parity vs legacy MotilalModal:**
- Form (apiKey + clientCode, AES "ApiKeySecret" encrypted apiKey only) ✅
- Help content (YouTube `gGKedxU-sQ0` + 8-step guide with redirect URL instruction) ✅ via Phase3BrokerHelp
- IP gate ✅ (with this commit)
- WebView OAuth + `accessToken=` intercept ✅
- Persistence ✅
- **Minor diff (user-accepted):** Legacy enforces 30s session-affinity debounce + `handleRequestRestart` callback (MotilalModal:116-136, 339-344). SDK widget has no equivalent. User accepted "minor diffs are fine" — Motilal's session-affinity bug surfaces as "Authorization Invalid" on rapid retry; user can retry after 30s manually.

**Verdict:** Motilal Oswal: SDK-with-gap → **SDK-clean (PROMOTED)**.

**Next step:** Dhan migration. Already partner-OAuth — empty fields. Add backend dispatch + SDK_ELIGIBLE.

---

## 2026-04-28 — Dhan promoted to SDK-clean (5th promotion)

**Files touched:** `BrokerConnectModalDispatch.js` (`SDK_ELIGIBLE_MODALS` += Dhan), audit doc, progress doc, changelog (3.9.51), build.gradle (versionCode 51).

**No backend changes** — fallthrough else-branch in `/exchange-token` already handles Dhan's `{dhan_client_id, dhan_access_token}` payload (line 1207-1221). No IP gate (partner broker).

**UX parity ✅** — partner-OAuth via CCXT, empty form auto-skips to WebView, WebView captures `dhan_client_id` + `dhan_access_token`, persists.

**Minor diffs (user-accepted):** Prefetch consent ID optimization (DhanConnectModal:101-127, ~200ms saved) and manual credential fallback (`Enter Access Token manually instead`) not in SDK widget. Custom User-Agent spoofing (DhanOAuthUI:97-101) may not be applied by SDK's `WebViewBrokerAuthFlow`.

**Verdict:** Dhan: SDK-with-gap → **SDK-clean (PROMOTED)**.

**Next step:** Kotak migration. Backend dispatch needed (credentials + TOTP, not OAuth).

---

## 2026-04-28 — Kotak Securities promoted to SDK-clean (6th promotion)

`SDK_ELIGIBLE_MODALS` += 'Kotak'. No backend change — `/update-credentials` route already dispatches Kotak to `/api/kotak/connect-broker` (line 1423-1425).

UX parity ✅ except minor diffs (user-accepted): 30s TOTP cooldown not in SDK widget; TOTP-specific error parsing returns generic upstream error instead of "regenerate TOTP" hint.

`build.gradle` 3.9.51 → 3.9.52.

**Next step:** AliceBlue. Backend dispatch + schema change to flow=oauth, fields=[].

---

## 2026-04-28 — AliceBlue promoted to SDK-clean (7th promotion)

Three changes:
1. SDK schema (`brokerFormSchema.ts`) — AliceBlue changed from `flow=credentials, fields=[apiKey, secretKey, clientId]` to `flow=oauth, fields=[]` matching Zerodha. Empty form auto-skips to WebView. **SDK package update required** (npm publish + bump in Alphab2bapp `package.json`).
2. Backend `/sdk/v1/connections/AliceBlue/login-url` — added dispatch hardcoding `origin=https://prod.alphaquark.in&returnPath=/stock-recommendation`. Why hardcoded: AliceBlue's partner appcode is allow-listed against `prod.alphaquark.in` only; tenants on `app-links.alphaquark.in` get silently bounced (verified live 2026-04-26).
3. Backend `/sdk/v1/connections/AliceBlue/exchange-token` — added dispatch that takes `{access_token, client_id}` from WebView capture and persists. No upstream exchange (broker callback yields the final tokens).
4. `BrokerConnectModalDispatch.SDK_ELIGIBLE_MODALS` += AliceBlue.

UX parity ✅: legacy is empty-fields OAuth (no form), SDK now matches.

`build.gradle` 3.9.52 → 3.9.53.

**Next step:** Fyers. IP_WHITELIST + reauth pre-fill (mitigated by isReauthFlow short-circuit) + field-naming clarification.

---

## 2026-04-28 — Fyers promoted to SDK-clean (8th promotion)

- IP_WHITELIST_BROKERS += 'Fyers'.
- Backend `/exchange-token` Fyers dispatch: takes `{apiKey, secretKey, code}` from SDK widget, translates to ccxt `{clientId=secretKey, clientSecret=apiKey, authCode=code}` (field-naming inversion handled server-side), persists `{clientCode=secretKey, secretKey=apiKey}`. Mirror of legacy FyersConnect:165-186.
- SDK_ELIGIBLE_MODALS += 'Fyers'.

UX parity ✅. Field-naming inversion is opaque to user — they enter "API Key" + "Secret Key" same as legacy; backend translates correctly. Reauth still routes to legacy.

`build.gradle` 3.9.53 → 3.9.54.

**Next step:** Axis. Backend `/login-url` + `/exchange-token` Axis dispatch.

---

## 2026-04-28 — Axis Securities promoted to SDK-clean (9th promotion)

Axis backend dispatches were ALREADY in place — the earlier "broker_login_url_failed" reports were either an upstream Axis bug 1083 (Axis-side) or pre-deploy state. Verified:
- `connections.js:894` — `/login-url` calls `/api/axis/login-url` via _selfCallLegacy.
- `connections.js:1117` — `/exchange-token` calls ccxt `/axis/callback` and handles 5+ authToken envelope paths.

Changes:
- Removed Axis from SDK_LEGACY_FALLBACK.
- Added 'Axis Securities' to SDK_ELIGIBLE_MODALS.

UX parity ✅. Subject to upstream Axis SSO bug 1083 (deterministic per Axis-side account state — needs Axis support contact). When that hits, both legacy and SDK fail with the same error (now surfaced as "Axis Securities — temporary SSO issue" via the recent error-toast improvement in AxisConnectModal).

`build.gradle` 3.9.54 → 3.9.55.

**Next step:** Angel One — needs SDK widget `flow=publisher-oauth` shape (broker-initiated, embedded shared apiKey, no user form). Or alternatively: when shared-mode + per-customer mode share routes correctly. Will likely STAY in SDK_LEGACY_FALLBACK with an explanation of the gap. Audit verdict will note this.

---

## 2026-04-28 — Final batch (IIFL + DummyBroker promoted; Angel One / Zerodha / Groww stay legacy)

### IIFL Securities — promoted (10th)

SDK promotion actually FIXES the legacy AsyncStorage-only gap. Backend `/exchange-token` fallthrough else-branch handles `{auth_token, clientid}` from WebView capture and persists to MongoDB via `_selfCallLegacy`. Legacy modal continues to also write AsyncStorage; SDK path writes only MongoDB. Both produce a connected IIFL. **Architectural improvement, not regression.**

### DummyBroker — promoted (11th)

Stub flow. Trivial.

### Angel One — STAYS in SDK_LEGACY_FALLBACK

Legacy is publisher-OAuth (broker-initiated, embedded shared apiKey, no user form). SDK schema is per-customer (apiKey + secretKey + clientCode). Fundamentally different flows. Backend `/exchange-token` handler for Angel One shared-mode is documented as not yet implemented. Stays legacy until SDK schema gains `flow=publisher-oauth` shape.

### Zerodha — STAYS in SDK_LEGACY_FALLBACK

Android 302 redirect race in WebView intercept. `prod.alphaquark.in/stock-recommendation` 302's unauthenticated visitors before WebView JS hooks fire. Real fix is out-of-band — Kite developer portal redirect URL change to a non-302 endpoint. Stays legacy until that ops change lands.

### Groww — STAYS legacy (NOT in SDK_ELIGIBLE_MODALS)

SDK schema mismatch. Legacy collects 2 separate fields (apiKey JWT + Base32 totpToken secret). SDK schema today is `flow=credentials, fields=[accessToken]` — single field. SDK package update needed: dual-field shape + Base32 validator + per-error-code mapping (NOT_BASE32, WRONG_LENGTH, GROWW_REJECTED). Significant SDK widget work; deferred.

`build.gradle` 3.9.55 → 3.9.56.

# Final state of SDK_ELIGIBLE_MODALS

```
new Set(['HDFC', 'Upstox', 'ICICI', 'Motilal', 'Dhan', 'Kotak',
         'AliceBlue', 'Fyers', 'Axis Securities', 'IIFL',
         'IIFL Securities', 'DummyBroker'])
```

# Final state of SDK_LEGACY_FALLBACK

```
new Set(['Angel One', 'Zerodha'])
```

11 of 14 brokers promoted. 2 stay legacy via fallback (Angel One shared-mode, Zerodha Android 302). 1 stays legacy without allowlist (Groww — SDK schema mismatch deferred).

---

## 2026-04-29 — Audit revision: IIFL rolled back + OAuth-with-creds gap fix

User-requested audit verified each broker's actual SDK routing end-to-end. Two critical issues found and fixed.

### Finding 1 — `/login-url` gap for OAuth-with-creds brokers (HDFC / Upstox / ICICI / Motilal / Fyers)

These brokers have `flow=oauth` schema with credential fields. The SDK widget collected creds via `BrokerCredentialForm` but `WebViewBrokerAuthFlow.getBrokerLoginUrl` sent only `redirectUrl` to `/login-url` — NOT the creds. Backend `/login-url` for these 5 brokers had no dispatch and returned 400 `broker_login_url_not_applicable`. Result: SDK flow died at first step with `broker_login_url_failed` error, never reached OAuth screen.

**Fix:**
- `alphaquark-mobile-sdk` `AqSdkClient.getBrokerLoginUrl` now accepts a `credentials` arg and merges into POST body. `WebViewBrokerAuthFlow` forwards `extraExchangeBody` (the form's collected creds) to it.
- `aq_backend_github` `connections.js` `/login-url` route gained an `else if` branch for these 5 brokers that proxies to `/api/<slug>/update-key` via `_selfCallLegacy` and parses the OAuth URL from any of `{loginUrl, login_url, authUrl, auth_url, response, top-level-string}` shapes.

These 5 brokers stay in `SDK_ELIGIBLE_MODALS`. Now functional end-to-end.

### Finding 2 — IIFL Securities reverted to legacy

SDK schema declares `flow=credentials_totp, fields=[apiKey, clientCode, password, dob]`. Legacy `iiflmodal.js` is empty-fields OAuth at hardcoded `markets.iiflcapital.com/?v=1&appkey=nHjYctmzvrHrYWA`. Plus: no IIFL slug in `LEGACY_PER_BROKER_SLUG`, no `/login-url` dispatch, no `Phase3BrokerHelp` entry. SDK promotion would surface a credentials form (wrong UX) followed by a 400 error.

**Fix:** removed `'IIFL'` and `'IIFL Securities'` from `SDK_ELIGIBLE_MODALS`. Future work tracked in audit doc — schema reshape + backend dispatch + AsyncStorage-vs-MongoDB persistence decision.

### Final state of `SDK_ELIGIBLE_MODALS`

```
new Set(['HDFC', 'Upstox', 'ICICI', 'Motilal', 'Dhan', 'Kotak',
         'AliceBlue', 'Fyers', 'Axis Securities', 'DummyBroker'])
```

10 of 14 brokers SDK-clean (down from 11; IIFL rolled back). 2 in `SDK_LEGACY_FALLBACK` (Angel One, Zerodha). 2 unlisted (Groww, IIFL).

### Files changed

- `alphaquark-mobile-sdk/packages/rn/src/client/AqSdkClient.ts` — `getBrokerLoginUrl` accepts credentials.
- `alphaquark-mobile-sdk/packages/rn/src/components/WebViewBrokerAuthFlow.tsx` — forwards extraExchangeBody.
- `aq_backend_github/Routes/sdk/v1/connections.js` — `/login-url` dispatch for HDFC/Upstox/ICICI Direct/Motilal Oswal/Fyers.
- `Alphab2bapp/src/components/BrokerConnectionModal/BrokerConnectModalDispatch.js` — IIFL rolled back.
- `Alphab2bapp/docs/SDK_MOBILE_FIT_ASSESSMENT.md` — §9 Phase 3 actual rollout audit appended.
- `Alphab2bapp/docs/PHASE3_BROKER_AUDIT.md` — IIFL row updated.
- `Alphab2bapp/docs/CHANGELOG.md` — 3.9.57 entry.
- `Alphab2bapp/android/app/build.gradle` — versionCode 56 → 57.

### Verification (UX parity)

For each of the 10 promoted brokers, traced legacy vs SDK at every touchpoint (form fields, encryption envelope, help content, IP-whitelist gate, OAuth URL minting, WebView OAuth screen, redirect intercept, token exchange, persistence). All match. Detailed table in `SDK_MOBILE_FIT_ASSESSMENT.md § §9`.

---

## 2026-04-29 — promote Groww to SDK route

**Broker(s) affected:** Groww.

**Files touched:**
- `Alphab2bapp/src/components/BrokerConnectionModal/BrokerConnectModalDispatch.js` — added `'Groww'` to `SDK_ELIGIBLE_MODALS` (before the IIFL removal comment).
- `Alphab2bapp/docs/PHASE3_BROKER_AUDIT.md` — Groww row verdict promoted SDK-broken → SDK-clean.
- `Alphab2bapp/docs/PHASE3_ARCHITECTURE.md` — allowlist membership updated, Groww-specific note added under SDK widget contract.
- `Alphab2bapp/docs/CHANGELOG.md` — entry added.

**Cross-repo dependencies (already shipped, not in this commit):**
- `alphaquark-mobile-sdk` commit `0291e02` — `feat(sdk): Groww schema — 2 fields (drop secretKey), permissive Base32 pattern`. Reshaped Groww schema in `packages/rn/src/components/brokerFormSchema.ts` + rebuilt `lib/`.
  - Before: `flow=credentials, fields=[apiKey, secretKey, growwTotpSeed (16-char strict)], submitEndpoint=connect`. Three fields, strict 16-char Base32 — neither matches what Groww actually emits or what legacy collects.
  - After: `flow=credentials, fields=[apiKey, growwTotpSeed (any-length Base32)], submitEndpoint=connect`. Two fields, permissive `^[A-Z2-7]+$/i`. Mirrors legacy `GrowwConnectModal` exactly.
- `aq_backend_github/Routes/sdk/v1/connections.js` — `CREDENTIAL_BROKER_VALIDATE_DISPATCH.Groww` (lines 602-614) maps the SDK body `{apiKey, growwTotpSeed | totp_seed}` → POST `/api/groww/update-key` `{uid, user_email, user_broker, apiKey, totp_seed}`. The SDK `/connect` route now goes through full ccxt-india validation (`app_groww.py` mints a fresh 6-digit TOTP via the Base32 seed, calls Groww `/v1/login`, persists jwtToken + token_expire on success, returns broker-specific error codes — `NOT_BASE32`, `WRONG_LENGTH`, `GROWW_REJECTED` — on failure). This closes the gap that originally blocked Groww promotion (legacy validates via ccxt; bare `/connect` was persist-only).

**Change summary:** Promotes Groww from `SDK-broken` → `SDK-clean` in the audit and adds it to the SDK eligibility allowlist. The blocking issues called out at the prior audit (3-field schema vs 2 fields; 16-char strict pattern vs ~32-char Base32; `/connect` persist-only with no ccxt validation) are all resolved upstream — SDK schema reshape + backend dispatch land outside this repo. This commit only flips the in-repo allowlist + docs. Groww help content (`Phase3BrokerHelp` → `GrowwHelpContent`) and IP-whitelist gate (`Phase3SdkBrokerModal` `IP_WHITELIST_BROKERS`) were already wired during prior Phase 3 ground-laying.

**Verdict change(s):**
- Groww: SDK-broken → SDK-clean. Reason: SDK schema now matches legacy field shape; backend `/connect` route validates via ccxt before persistence; help + IP-callout already in place.

**Accepted minor diffs (matching the Kotak/Motilal precedent, not blockers):**
- Per-error-code custom rendering — legacy `GrowwConnectModal` renders 5 broker-specific actionable messages for `NOT_BASE32` / `WRONG_LENGTH` / `GROWW_REJECTED` / `INVALID_SEED` / `INVALID_CREDENTIALS`. SDK widget surfaces these as a generic `SdkRequestError` with the upstream `detail`. Tracked as a Known SDK Gap in `tidi_new docs/SDK_CHANGELOG.md` (mirror of the Kotak TOTP-error parsing diff).
- Silent-refresh: legacy backend has `/api/groww/refresh-token` for one-tap daily re-auth. SDK reauth route doesn't yet expose this; reauth still routes to legacy via the existing `isReauthFlow` short-circuit. No regression — reauth works exactly as before.
- Inline help-panel toggle (Read More / See Less) — SDK uses `Phase3BrokerHelp` with `▾ Hide help` toggle, default expanded. Visual chrome differs slightly but all step content and IP-whitelist instructions ARE shown.

**Regression(s) observed:** None at code-read time. End-to-end emulator verification PENDING.

**Rollback decision:** No (forward-only). If user reports a regression during testing, revert this commit only — SDK schema and backend dispatch can stay in place since the legacy modal still works alongside.

**Cross-repo note:** `tidi_new` (Flutter) explicitly held Groww on legacy at commit `e064e6e` (2026-04-28) due to the `/connect` persist-only gap. That gap closed with the backend `CREDENTIAL_BROKER_VALIDATE_DISPATCH` dispatch table; `tidi_new` can now promote Groww symmetrically. Tracked separately — not part of this Alphab2bapp commit.

**Next step:** Emulator verification on Groww connect: (1) wrong-length Base32 → SDK form surfaces `WRONG_LENGTH` upstream detail; (2) valid creds → ccxt validates → `connected_brokers[]` updated; (3) reauth flow → legacy `GrowwConnectModal` still opens. If parity holds, mirror the change in `tidi_new`.

---

## 2026-04-29 — SDK parity sweep + simplified routing

**Broker(s) affected:** all 13 (allowlist removed).

**Files touched:**
- `alphaquark-mobile-sdk/packages/rn/src/components/brokerFormSchema.ts` — `BrokerFormField` gained `initialValue` and `transformValue` (mirror of Flutter commit `64d4eff`).
- `alphaquark-mobile-sdk/packages/rn/src/components/BrokerCredentialForm.tsx` — `useState` initialiser seeds from `initialValue` (base + override merged), `readField()` helper applies `transformValue` before validation and body construction.
- `alphaquark-mobile-sdk/packages/rn/src/__tests__/brokerFormSchema.spec.ts` — added a Flutter-parity test for the new field shapes (idempotent + non-null contract for `transformValue`).
- `alphaquark-mobile-sdk/packages/rn/lib/**` — rebuilt via `tsc`.
- `Alphab2bapp/src/components/BrokerConnectionModal/BrokerConnectModalDispatch.js` — DROPPED `SDK_ELIGIBLE_MODALS` allowlist + `SDK_LEGACY_FALLBACK` kill-switch. Routing collapses to `useSdkBrokerFlow() && !isReauthFlow` → `Phase3SdkBrokerModal` for ALL brokers; reauth still legacy.
- `Alphab2bapp/src/components/BrokerConnectionModal/Phase3SdkBrokerModal.js` — pass `renderHeader={() => null}` to `WebViewBrokerAuthFlow` so the SDK widget's default header is suppressed (consumer renders its own `<Header>` above). Fixes the double-header bug called out in `docs/SDK_PARITY_AUDIT.md § 3`.

**Change summary:** Three blocker items from `docs/SDK_PARITY_AUDIT.md` resolved in one sweep:

1. **Flutter-only `initialValue` / `transformValue` ported to RN SDK.** This was the only material divergence between the two SDK packages — schemas matched 14/14, widgets matched contract, but the reconnect-pre-fill / paste-tolerant-input hooks shipped on Flutter (commit `64d4eff` 2026-04-29 05:17:39) were never carried to RN. Now both packages expose the same `BrokerFormField` shape; future schema overrides on RN can pre-fill stable fields (Kotak mobileNumber/ucc, Upstox/Fyers/HDFC/ICICI/Motilal apiKey/secretKey) on reauth without re-typing.

2. **Per-broker allowlist removed from Alphab2bapp.** The `SDK_ELIGIBLE_MODALS` set lived for ~2 days while we audited each broker; with the audit complete and the SDK package at parity with Flutter, gating per-broker is no longer load-bearing. The flag is the single switch. tidi_new (Flutter) has been routing all 13 brokers through SDK on a single flag since `bd1b501`. Alphab2bapp now matches.

3. **Double-header WebView bug fixed in Alphab2bapp.** `Phase3SdkBrokerModal` was rendering its own `<Header>` above the SDK widget AND the SDK widget was rendering its own default close-button header inside `WebViewBrokerAuthFlow`. The SDK widget already supports `renderHeader: () => null` to suppress; Alphab2bapp now passes that. Flutter side never had this bug — the Flutter `WebViewBrokerAuthFlow` doesn't have an AppBar/Scaffold of its own, so Scaffold ownership stays with the consumer.

**Verdict change(s):** none per-broker — verdicts in `PHASE3_BROKER_AUDIT.md` are no longer load-bearing for routing decisions (the allowlist they fed is gone). Audit doc retained for archaeological value but the "promotion" semantics no longer apply.

**Regression(s) observed:** None at code-read time. End-to-end emulator verification PENDING for: (a) every broker's first-connect via SDK with flag on, (b) every broker's reauth (still legacy) preserves prior UX, (c) WebView screen renders one header not two.

**Rollback decision:** No — forward-only. If a specific broker breaks under SDK with the flag on, the fix is to fix the SDK widget for that broker, NOT to add it back to a per-app allowlist.

**Deferred follow-up:** SDK reauth via `initialValue` + pre-signed `authUrl`. Plumbing exists on the SDK side now (`initialValue` ported); needs (a) `Phase3SdkBrokerModal` to consume `reauthConfig` and feed `schemaOverride.fields[].initialValue`, and (b) `WebViewBrokerAuthFlow` to skip the `getBrokerLoginUrl` fetch when an authUrl is supplied. Once shipped, the `isReauthFlow` short-circuit in `BrokerConnectModalDispatch` comes out and reauth goes SDK too. Mirrors tidi_new commit `2d44fbf` ("Kotak smart-prefill + Groww silent refresh + Fyers field inversion").

**Next step:** rebuild release APK; emulator-verify with `REACT_APP_USE_SDK_BROKER_FLOW=true` against at least one broker per flow kind (oauth: Zerodha; oauth-with-creds: Upstox; credentials: Groww; credentials_totp: Kotak); then mirror docs in tidi_new's `SDK_CHANGELOG.md` so both apps' parity audits stay in sync.

---

## 2026-04-29 — SDK reauth via initialValue (drop isReauthFlow short-circuit)

**Broker(s) affected:** all credential brokers (Kotak, Upstox, ICICI Direct, Hdfc Securities, Motilal Oswal, Fyers, Angel One per-customer, Groww). OAuth-only brokers (Zerodha, Dhan, AliceBlue, Axis) unaffected because they have no fields to pre-fill.

**Files touched:**
- `Alphab2bapp/src/components/BrokerConnectionModal/Phase3SdkBrokerModal.js` — new `buildSchemaOverride(brokerName, userDetails)` helper builds per-broker `schemaOverride` from `getStoredBrokerCreds` output. New `useEffect` fetches `userDetails` on mount and resolves the override; new `schemaOverridePending` state gates the form on the fetch. Kotak gets a `transformValue: normaliseKotakMobile` (mirror of tidi_new `_normaliseKotakMobile`). The form re-mounts via a `key` prop change when override resolves so the SDK's `useState` initialiser re-seeds from the new `initialValue`.
- `Alphab2bapp/src/components/BrokerConnectionModal/BrokerConnectModalDispatch.js` — DROPPED the `isReauthFlow` short-circuit. SDK lane now handles both first-connect AND re-auth. Header docstring updated to describe the stored-creds → `schemaOverride.fields[].initialValue` pattern.
- `Alphab2bapp/docs/PHASE3_ARCHITECTURE.md` — routing rule simplified to a single-flag check; new "Per-broker schema override builder" table.
- `Alphab2bapp/docs/PHASE3_PROGRESS.md` — this entry.
- `Alphab2bapp/docs/CHANGELOG.md` — `[3.9.61]` entry.

**Cross-repo dependencies (already shipped, not in this commit):**
- `alphaquark-mobile-sdk` commit (just pushed on `develop`) — RN SDK port of Flutter `64d4eff`: `BrokerFormField.initialValue` + `transformValue`. Without these, this commit's `schemaOverride` would have no effect.

**Change summary:** Closes the deferred half of Task #14. The SDK lane now handles re-auth too — no separate code path, no pre-signed `authUrl` injection. When the user reconnects a broker, the modal fetches `userDetails`, reads stored creds via `getStoredBrokerCreds`, and feeds `BrokerCredentialForm` a `schemaOverride` carrying `initialValue` (and for Kotak `transformValue`). On first-connect (no stored entry) every `initialValue` resolves to `''` and the form renders empty. One unified path.

The legacy `reauthHelpers.handleSmartReauth` flow (which fetches a pre-signed broker OAuth URL via `/api/<broker>/reauth-url` and pipes it through `reauthConfig.authUrl`) stays in place for the LEGACY lane only — when the flag is off, modals like `UpstoxModal` continue to consume `reauthConfig.authUrl` to skip the form. SDK lane ignores `reauthConfig` entirely. tidi_new shipped the same architecture in `2d44fbf` (Kotak smart-prefill + Groww silent refresh + Fyers field inversion).

**Per-broker mapping** (matches `getStoredBrokerCreds` in `src/utils/brokerCredentials.js`):

| Broker | initialValue fields | transformValue fields |
|--------|--------------------|-----------------------|
| Zerodha / Dhan / AliceBlue / Axis | (none — OAuth-only schemas) | (none) |
| Kotak | apiKey, ucc, mobileNumber (mpin + totp NEVER pre-filled) | mobileNumber → `normaliseKotakMobile` |
| Groww | apiKey, growwTotpSeed | (none) |
| Motilal Oswal | apiKey, clientCode | (none) |
| Fyers | apiKey, secretKey, clientCode | (none) — DB-naming inversion already absorbed in `getStoredBrokerCreds` |
| Angel One per-customer | apiKey, secretKey, clientCode | (none) — shared mode needs separate override (Known Gap) |
| Upstox / ICICI Direct / Hdfc Securities | apiKey, secretKey | (none) |
| IIFL Securities | (legacy-only — no override) | (none) |

**Verdict change(s):** none per-broker. Routing rule simplified — `isReauthFlow` short-circuit removed.

**Regression(s) observed:** None at code-read time. End-to-end emulator verification PENDING. Smoke-test priorities: (a) Kotak reconnect with all 3 stable fields pre-filled + mobile normalisation on `+91 9876543210` paste; (b) Upstox reconnect skips re-typing apiKey + secretKey; (c) Groww reconnect pre-fills both fields; (d) Zerodha first-connect renders empty form (no override).

**Rollback decision:** No — forward-only. If a regression is reported, the immediate rollback is `REACT_APP_USE_SDK_BROKER_FLOW=false`. Per-broker rollback inside the SDK lane requires fixing `buildSchemaOverride` for that broker.

**Next step:** rebuild release APK; emulator-verify the four smoke-test scenarios; if parity holds, mirror the per-broker override coverage in tidi_new (today only Kotak has a builder there).

---

## How to add a new entry

When you ship a Phase 3 commit:

1. Append a new dated section at the BOTTOM of this file using the entry format above.
2. Cross-link any verdict change to the corresponding row update in `PHASE3_BROKER_AUDIT.md`.
3. If the change altered the design (routing, widget contract, backend route shape), also update `PHASE3_ARCHITECTURE.md` in the SAME commit.
4. The CHANGELOG.md entry for the same commit should reference this log entry's date.

Append-only — never delete or edit prior entries. Corrections go in a new entry that references the prior one.
