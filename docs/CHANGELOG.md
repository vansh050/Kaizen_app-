# Changelog

All notable changes to the Kaizen (AlphaQuark B2B) Mobile App are documented here.

Entries are ported from the upstream `Alphab2bapp` fork (`b2b/feature/sdk-plus-config_forkv2`)
during periodic sync passes, plus Kaizen-native work. Each entry names the upstream commit
where applicable.

---

## [unreleased] - 2026-07-14 — Tier 4 sync from Alphab2bapp: campaign smart links + UTM attribution (4e02453 + 141fce8 + 2fcc5e6)

**Source:** upstream `b2b/feature/sdk-plus-config_forkv2` commits `4e02453`
(2026-06-23), `141fce8` (2026-06-23), `2fcc5e6` (2026-06-25). Fork HEAD's
`src/utils/smartLink.js` (209 LOC) carries all 3.

### JS runtime

- **`src/utils/smartLink.js`** (new, verbatim from fork HEAD) — exports
  `parseSmartLink`, `captureCampaign`, `captureInstallReferrer`,
  `routeSmartLinkDestination`, `handleSmartLink`, `getStoredCampaign`.
  Whitelabel-generic — each fork differentiates by its `REACT_APP_HEADER_NAME`
  tenant slug in the campaign URL, no per-fork code change.
- **`App.js`** — wires `handleSmartLink(url)` at the top of the deep-link
  handler (returns early if the URL is a smart link so the Zerodha callback
  handler doesn't also run). Calls `captureInstallReferrer()` on mount for
  the first-launch deferred-deep-link recovery (Android only; no-op when
  `react-native-play-install-referrer` isn't installed).
- **`src/screens/Authentication/SignupScreen.js`** — reads
  `getStoredCampaign()` after Firebase user creation and attaches it as
  `campaign` on the `POST /api/user/` payload, tying the signup to the
  campaign that brought them in.

### Native

- **`android/app/src/main/AndroidManifest.xml`** — new intent-filter for
  `https://app-links.alphaquark.in/l/*` with `autoVerify="true"`. Kept
  separate from the existing `test.alphaquark.in/subscriptions` filter to
  avoid cross-host confusion.
- **`ios/AlphaQuark/AlphaQuark.entitlements`** — adds
  `com.apple.developer.associated-domains` with
  `applinks:app-links.alphaquark.in`.

### Backend / infra follow-ups (NOT part of this port)

Universal Links / App Links verification requires the backend AASA + assetlinks
files to list Kaizen's IDs. Currently these serve the fork's IDs.

- iOS AASA (`https://app-links.alphaquark.in/.well-known/apple-app-site-association`)
  must include Kaizen `TEAMID.com.aq.kaizenalpha` with the `/l/*` path.
- Android assetlinks (`https://app-links.alphaquark.in/.well-known/assetlinks.json`)
  must include Kaizen `applicationId=com.aq.kaizenalpha` + release signing
  fingerprint.
- `aq_backend_github/Routes/SmartLinks/SmartLinkRouter.js` and
  `Routes/WellKnown/*` maintain both files — the backend team needs to
  register Kaizen there.

Until then: taps still work when the app is open (JS handler fires), but
"open app directly" from a browser tap won't verify. Play Install Referrer
capture is a no-op unless `react-native-play-install-referrer` is
`npm install`-ed and `pod install`'d.

### Docs

- `docs/SMART_LINKS.md` — new file (verbatim from fork).
- `docs/CHANGELOG.md` — this entry.

---

## [unreleased] - 2026-07-14 — Tier 3-d663083 sync from Alphab2bapp: Markup PDF + web-parity (split per user decisions)

**Source:** upstream `b2b/feature/sdk-plus-config_forkv2` commit `d663083`
(2026-07-13, 18-file mega commit). Ported per user decisions:

### ✅ Ported

**New files (verbatim from fork HEAD):**
- `src/utils/gttSupport.js` (with Kaizen kill-switch — see below)
- `src/utils/emailValidation.js` (128 LOC)
- `designs/default/composites/PortfolioSummaryCard.js` (599 LOC)
- `src/FunctionCall/services/PortfolioSummaryService.js` (92 LOC)
- `docs/GTT_MOBILE_CERT_CHECKLIST.md` (123 LOC)

**Cosmetic (Markup PDF change-requests):**
- `designs/default/screens/LoginScreen.js` — "Its" → "It" typo
- `src/components/CustomToolbar.js` — safe-area padding (`insets.left/right`),
  hide-when-null logo circle, name `numberOfLines={1}` + `flexShrink: 1` (fits
  atop Tier 7's onError fallback + Tier 7's remoteLogoFailed state).
- `designs/default/screens/BespokePerformanceScreen.js` — invest-now bottom
  safe-area (`paddingBottom: Math.max(insets.bottom, 8)`).
- `designs/default/screens/MPPerformanceScreen.js` — same bottom safe-area
  on the bottomBar.
- `src/components/ModelPortfolioComponents/MPCardBespoke.js` — card gradient
  swap (white → tenant gradient1/gradient2), text/border/chip colors flipped
  to white/rgba(255,…) variants, invest button flipped to white bg + tenant
  text color. Preserves Tier 1's yearly-GST fix.

**Feature (both gated to DEFAULT):**
- `src/context/ConfigContext.js` — `performanceSummaryEnabled` (default ON,
  mirrors web `!== false`) + `kycBlockingEnabled` (default OFF, mirrors web
  `=== true`). Both added to `parityFlags` fetch, resolved config, and the
  AsyncStorage persistence blob. Fits atop Tier 5's platform-version fields.
- `designs/default/screens/PortfolioScreen.js` — mounts `PortfolioSummaryCard`
  as `ListHeaderComponent`. Self-gates on `performanceSummaryEnabled`.
- `src/components/ModelPortfolioComponents/MPInvestNowModal.js` — adds
  `runKycBlockingGate()` at step 1 (PAN/DoB → payment). Fail-open on infra
  errors; blocks only on active KRA mismatch.
- `src/screens/Authentication/SignupScreen.js` — pre-Firebase email format
  validation via new `src/utils/emailValidation.js` util. Blocks malformed
  emails from reaching `clientlistdatas` (which later break Telegram
  removal cron). Uses normalized email.

### 🔒 GTT: ported but DISABLED (kill switch)

Per user directive: fork's GTT reconciliation code shipped but gated OFF
until per-broker cert (see `docs/GTT_MOBILE_CERT_CHECKLIST.md`).

- `src/utils/gttSupport.js` has a new top-level constant
  `KAIZEN_GTT_CUSTOMER_ROUTING_ENABLED = false` — `isGttNativeBroker()`
  early-returns `false` when this is `false`. To enable per-broker after
  cert, flip the constant (or replace with a per-broker allowlist).
- `src/components/AdviceScreenComponents/StockAdvices.js` — GTT split logic
  fully ported (`isGttNativeBroker` + `isGttOcoLeg` filter, new switch cases
  for Groww / Dhan / Angel One / ICICI Direct). Dark code at runtime — every
  GTT-flagged leg falls into `regularOrders` (matches pre-port behavior).
  The Zerodha GTT-basket log message updated to explain the new routing.

### ❌ SKIPPED per user directive

- **Broker roster change** — `src/config/brokerDisplayConfig.js` NOT
  modified. Fork replaced Motilal Oswal with IIFL Securities in the picker;
  Kaizen kept its `5600481` de-listing (no IIFL), so the fork's change is
  effectively a reversal for Kaizen. Motilal stays visible in Kaizen; IIFL
  stays hidden.
- **`src/components/AdviceScreenComponents/StockAdvices.js` broker roster
  changes** — none in d663083 for this file (it's all GTT); no skip needed.
- **`docs/ENACH_SPIKE_D4.md`** — fork-only doc, not in Kaizen.

### Docs

- `docs/CHANGELOG.md` — this entry.
- `docs/GTT_MOBILE_CERT_CHECKLIST.md` — new file (copied verbatim from fork).
  Cert gate documented; matches the kill-switch above.
- `docs/MODEL_PORTFOLIO_ARCHITECTURE.md` — not updated in this pass (no MP
  schema/endpoint changes; PortfolioSummary is a new render-side composite
  with its own service; already documented in the fork's own CHANGELOG).

---

## [unreleased] - 2026-07-14 — Tier 3 sync from Alphab2bapp: Methodology tab + T+1 settlement heads-up (c08d07e + 4af676c)

**Source:** upstream `b2b/feature/sdk-plus-config_forkv2` commits `c08d07e`
(2026-06-22) + `4af676c` (2026-06-30).

### `src/screens/Home/AfterSubscriptionScreen.js` — Methodology tab (upstream `c08d07e`)

**Web parity fix:** subscribers reported that after subscribing, the
performance graph / methodology / ratios disappeared. Cause:
`AfterSubscriptionScreen` had only Holdings + Distribution tabs and set
`performance_data` raw (field-alias mapping missing).

- Adds a new "Methodology" tab (3rd route). `CustomTabbarMPPerformance`
  already maps routes dynamically, so no tab-bar change needed.
- Content: Overview + methodology sections (definingUniverse, research,
  constituentScreening, weighting, rebalance, assetAllocation) + full
  metrics (Returns/Risk/Drawdown/Ratios/Timing) + the existing-but-unused
  `PerformanceChart` (perf-vs-index).
- New `normalizePerformanceData()` at fetch — mirrors web
  `mapPerformanceData` field aliasing
  (`totalReturnCumulative→total`, `volatilityAnnual→volatility`,
  `drawdowns.*→drawdown.*`, `timings.*→timing.*`) so metric tiles populate.
- Local `MetricTile` / `MethodologyCard` / `formatMetric` helpers + styles.

**Also carried along in the verbatim copy:** the small `bfa5175`
(mpCardColorMap) tweaks to this file that yesterday's `89414c8` sync missed
(3 hardcoded gradient/theme colors → `useTokens()`, Overview method title
themed). ~12 LOC of design-system consistency with Kaizen's earlier sync.

**Port method:** verbatim copy of `b2b/feature/sdk-plus-config_forkv2:HEAD`
`src/screens/Home/AfterSubscriptionScreen.js`. Kaizen's prior file was
byte-identical to upstream snapshot `76b943d`, so the delta is exactly
`c08d07e + bfa5175`'s changes to this one file (1104 → 1418 lines).

### `src/components/AdviceScreenComponents/RebalanceModal.js` — T+1 settlement heads-up (upstream `4af676c`)

Adds a one-time info toast before submitting a rebalance that both sells
and buys (`isMixedPre` branch). Message: "Cash from today's sells settles
tomorrow (T+1). If a few buys don't go through now, just re-run the
rebalance tomorrow — you don't need to add more funds." Informational
only, does not block the rebalance. Mirrors the web
`BrokerPublisherButton` notice (prod-alphaquark-github 2026-06-30).

Inserted right before the `matchingRepairTrade` computation, using the
existing `Toast` import (already present in Kaizen — no new dep).

### Overlap verified

Kaizen's `e17e556` (2026-06-22 — "View More opens on Overview; methodology
first; shorter disclaimer; lock Portfolio by key") touches a DIFFERENT
file (`src/screens/Drawer/MPPerformanceScreen.js`, the pre-subscribe plan
detail view). The fork's `c08d07e` touches `AfterSubscriptionScreen.js`
(post-subscribe view). No conflict — the two commits cover complementary
surfaces.

### Docs

- `docs/CHANGELOG.md` — this entry.
- `docs/MODEL_PORTFOLIO_ARCHITECTURE.md` — not updated (Methodology tab
  is a self-contained render add; no new SDK contract, backend endpoint,
  or persistence schema).

---

## [unreleased] - 2026-07-14 — Tier 6 sync from Alphab2bapp: bespoke label seam (f3b38cb + 933cab9)

**Source:** upstream `b2b/feature/sdk-plus-config_forkv2` commits `f3b38cb` +
`933cab9` (2026-07-06, same day). Adds a `config?.bespokePlanLabel` seam so
per-tenant `whitelabel/appVariants.js` can override every "Bespoke Plan(s)"
string surface without touching `src/` or the backend. Every tenant without
the field falls back to the unchanged literal — safe no-op for Kaizen today.

### Files touched (12)

- `src/screens/Drawer/ProductCatalogScreen.js` — tab title (f3b38cb).
- `designs/default/screens/BespokePerformanceScreen.js` — viewModel `config`
  destructure + section title (933cab9).
- `designs/default/screens/HomeScreen.js` — home "Top Bespoke Plans" (933cab9).
- `designs/default/screens/ModelPortfolioScreen.js` — viewModel `config`
  destructure + plan-type badge (933cab9).
- `src/components/CustomFlatlist.js` — empty-state "No Bespoke Advice Found"
  → "No {label} Recommendations Found" (933cab9).
- `src/help.js` — same empty-state fix mirrored (933cab9).
- `src/components/HomeScreenComponents/AllPlansDetails.js` — 2 plan-type
  badges + 1 section title (933cab9).
- `src/components/ModelPortfolioComponents/PaymentSuccessModal.js` — success
  copy plan-type suffix (933cab9).
- `src/screens/Drawer/BespokePerformanceScreen.js` — container passes `config`
  into viewModel (933cab9).
- `src/screens/Home/HomeScreen.js` — 2× "Bespoke Active Recommendations" +
  1× "Top Bespoke Plans" (933cab9).
- `src/screens/Home/MySubscriptionsScreen.js` — tab title + 2 empty states
  (933cab9).
- `src/screens/PortfolioScreen/PortFolioCard2.js` — arrow-fn body converted
  to block so `useConfig()` can be called; `leftText` uses seam (933cab9).

### Already had the seam

`src/screens/Drawer/ModelPortfolioScreen.js` L137 (bespoke tab title) and
L589 (empty state) — both from an earlier partial sync.

### Backend / config seam

`bespokePlanLabel` is a plain field on the per-variant
`whitelabel/appVariants.js` object (same mechanism as `themeColor`, `logo`) —
it flows through `ConfigContext`'s `initialConfig` spread automatically, no
new wiring required. Kaizen's tenant does not set the field today; every
"Bespoke Plan(s)" surface renders the unchanged literal.

### Docs

- `docs/CHANGELOG.md` — this entry.

---

## [unreleased] - 2026-07-14 — Tier 5 sync from Alphab2bapp: update-gate platform floors + self-heal (c5acccd + 69cafff)

**Source:** upstream `b2b/feature/sdk-plus-config_forkv2` commits `c5acccd` +
`69cafff` (2026-06-24). Additive on top of Kaizen's existing update gate
(commit `0664638`, 2026-06-22 — mandatory + APK exemption + AppUpdateChecker
wire). No conflict — fork's changes only touch code paths Kaizen didn't yet.

### `src/UpdateAppModal.js`

- New `pickPlatformVersion(cfg, base)` helper — resolves `<base>Android` /
  `<base>Ios` first, falls back to the platform-agnostic `<base>` for
  backward compat. Used for both `latestAppVersion` and `minAppVersion`.
- `checkUpdate()` `serverVersion` fallback + `AppUpdateChecker` wrapper
  now use `pickPlatformVersion(config, 'latestAppVersion')` — so a store
  version that only exists on Android doesn't soft-lock the iOS gate
  (and vice-versa).
- Mandatory-vs-optional decision uses `pickPlatformVersion(config, 'minAppVersion')`.
- Self-heal: when `checkUpdate()` runs on a refreshed config and returns
  `!result.updateAvailable` (or `!fromStore`), the modal is now
  proactively hidden (`setShowModal(false)`) instead of just returning —
  so a modal shown earlier from a higher floor closes automatically when
  the floor is lowered in the backend.

### `src/context/ConfigContext.js`

New fields mirrored from `apiData` into the resolved config object:
`latestAppVersionAndroid`, `latestAppVersionIos`, `minAppVersion`,
`minAppVersionAndroid`, `minAppVersionIos`, `forceUpdate`. All default to
`null` / `undefined` when the backend doesn't set them (safe no-op).

### Backend requirement

For platform floors to take effect, set the relevant fields on the tenant's
`appadvisors` doc:
```
db.appadvisors.updateOne({subdomain:'<tenant>'}, {$set: {
  latestAppVersionAndroid: '1.0.38',
  latestAppVersionIos: '1.0.17',
  minAppVersionAndroid: '1.0.30',
  minAppVersionIos: '1.0.15',
}})
```
If only the platform-agnostic `latestAppVersion` / `minAppVersion` fields
are set, behavior is identical to pre-Tier-5.

### Docs

- `docs/CHANGELOG.md` — this entry.

---

## [unreleased] - 2026-07-14 — Tier 7 sync from Alphab2bapp: logo fallback (b198035 + 1199403)

**Source:** upstream `b2b/feature/sdk-plus-config_forkv2` commits `b198035`
(2026-07-13) + `1199403` (2026-07-13). Ported together — both add fallbacks
to the same render path.

### `designs/default/screens/LoginScreen.js`

- New `RemoteLogoImage` wrapper component — `<Image source={{uri}}>` with
  `onError` fallback to the bundled `defaultLogo`. Replaces the two direct
  `<Image>` renders inside `renderLogo` for string and `{uri}` shapes.
- `renderLogo` `configLoading` branch now returns the bundled `defaultLogo`
  instead of `<View style={styles.logo} />`, so the brand mark is visible
  during config load instead of a blank white box.

### `src/components/CustomToolbar.js`

- Header toolbar logo now tracks `remoteLogoFailed` state and flips to the
  bundled variant asset when the backend URL's `<Image>` fires `onError`.
- `onError={() => setRemoteLogoFailed(true)}` added on the remote-URL
  `<Image>` render path.

### Why

Some tenants (e.g. markup — `Markup_falcon.png`) serve private S3 URLs for
`logo` / `toolbarlogo` that 403 on the RN `<Image>` fetch. Without the
fallback, the login screen shows a blank white circle and the header shows
nothing. Proper fix is backend (re-upload publicly / fix ACLs); this ships
the graceful client fallback in the meantime.

### Docs

- `docs/CHANGELOG.md` — this entry.
- No architecture doc touched (these are cosmetic render-path guards; no new
  design-system slot or SDK contract).

---

## [unreleased] - 2026-07-14 — Tier 2 sync from Alphab2bapp: centralize Zerodha sell-auth gate (4-commit series)

**Source:** upstream `b2b/feature/sdk-plus-config_forkv2` commits `2815061`
→ `09230dd` → `7585ff3` → `4dd9e66` (2026-06-24, all in one day). Ported as
one commit here since only the final state matters — the interim SHAs are
intra-day iterations.

### New utility

**`src/utils/zerodhaDdpiGate.js`** (created verbatim from fork HEAD) —
exports `isZerodhaSellAuthorized(userDetails)` +
`SELL_AUTHORIZED_DDPI_STATUSES = ['physical', 'ddpi']`. Single source of
truth for the "can this Zerodha user sell without a per-trade TPIN?" gate.
Previously the rule was inlined at 8 sites which drifted: one site was
missing `'consent'`, and `AddtoCartModal.js` had it in the wrong (consent-first)
order which the centralization sweep missed.

### Callsites migrated to `isZerodhaSellAuthorized`

- `src/components/AdviceScreenComponents/RebalanceModal.js` — 1 site
- `src/components/AdviceScreenComponents/StockAdvices.js` — 4 sites
- `src/components/ModelPortfolioComponents/MPReviewTradeModal.js` — 2 sites
- `src/components/ModelPortfolioComponents/UserStrategySubscribeModal.js` — 1 site

### Fixed outlier

- `src/components/AdviceScreenComponents/AddtoCartModal.js:442` — value
  corrected from `['consent', 'physical', 'ddpi']` to `['physical', 'ddpi']`.
  Kept inline (not migrated to util) to match fork HEAD exactly — this site
  is a status-only gate, doesn't check `is_authorized_for_sell`, so the util
  fits worse than the inline check.

### Policy note (upstream `7585ff3`)

`demat_consent = "consent"` is **not** standing authorization. Per Zerodha
(Kite forum + docs), `"consent"` means "go through CDSL flow for authorization"
— i.e. the user MUST complete CDSL TPIN/eDIS for each sell. Including
`"consent"` in the "can sell" set wrongly skipped the TPIN prompt and CDSL
then rejected the sell server-side. Only `"physical"` and `"ddpi"` are
standing auth.

### Kaizen prior state

Notably, all 8 primary callsites in Kaizen already had `['physical', 'ddpi']`
(no `'consent'`) — some earlier sync had sniped the final value locally. Only
`AddtoCartModal.js` still carried the buggy consent-first pattern. This port
adds the util + centralizes the 8 sites regardless, so future rule changes
touch one file instead of 9.

### Docs

- `docs/SELL_AUTH_ARCHITECTURE.md § 7e` — new section documenting the util,
  its callsites, the `AddtoCartModal.js` outlier, the `"consent"` policy, and
  the cross-repo sync contract (web + ccxt-india).
- `docs/CHANGELOG.md` — this entry.

---

## [unreleased] - 2026-07-14 — Tier 1 sync from Alphab2bapp: payment recovery + bespoke yearly GST fix

**Source:** upstream `b2b/feature/sdk-plus-config_forkv2` commits `8000cfc` + `1c856e6` (2026-07-08) and `5673096` (2026-07-04).

### `src/FunctionCall/PaymentHandle.js` — false "Payment Failed" on success + gateway-verified recovery (upstream `8000cfc` + `1c856e6`)

**Origin:** the 2026-07-07 arfs incident — a paid "KYC only plan" showed a
"Payment Failed" alert ON TOP of the "Payment Successful" screen. Same code
ships in Kaizen and every RN fork.

1. **Error separation** — post-payment processing (`completeSinglePayment` /
   `completeSubscription`) no longer runs inside the Razorpay-checkout `try`.
   A processing error after a captured charge can never again alert
   "Payment Failed". Real checkout failures still alert.
2. **Bespoke guard** — the MP-only `rebalance/insert-user-doc` block in
   `completeSinglePayment` is skipped when `strategyDetails`/`latestRebalance`
   are absent (bespoke plans) — the unguarded `latestRebalance.model_Id` was
   the TypeError behind the false alert. Follow-up commit `1c856e6` guarded
   the remaining `latestRebalance` sites in `completeSubscription` and the
   first MP block.
3. **Gateway-verified recovery** (`recoverOneTimePaymentViaGateway`) — web
   parity with `PricingPage.handlePaymentWithVerification`. When the checkout
   dies without a callback (out-of-band UPI charge) or the first completion
   throws, the app polls `GET /api/admin/razorpay/order-status/:orderId`
   (backend queries the Razorpay Orders API) and, if paid, completes with the
   `razorpay_signature: "verified_signature"` sentinel.

**Backend dependency (already deployed on Kaizen backend, verified 2026-07-14):**
`aq_backend_github/Routes/Admin/Plans/SubscriptionRouter.js` `complete-one-time-payment`
and the subscription twin accept the `"verified_signature"` sentinel and, for
the sentinel ONLY, verify against the Razorpay API directly. Endpoint
`GET /api/admin/razorpay/order-status/:orderId` exists at
`aq_backend_github/Routes/razorpay.js:191` (mounted at
`index.js:567` as `/api/admin/razorpay`).

**Port method:** verbatim copy of `b2b/feature/sdk-plus-config_forkv2:HEAD`
`src/FunctionCall/PaymentHandle.js`. Delta from Kaizen's prior state was
exactly `8000cfc` + `1c856e6` (no other upstream commits touched this file
in between; 5892c1b was already present).

### `src/components/ModelPortfolioComponents/MPCardBespoke.js` — yearly plan card double-counted GST (upstream `5673096`)

**Bug:** the "Top Bespoke Plans" card showed `₹23600.00 + GST` for a plan
whose base price is ₹20000/yr — the GST-inclusive amount (20000 × 1.18 = 23600)
rendered as the base **and then** the `+ GST` suffix appended on top.

**Root cause:** in `getPricingOptions()`, monthly / quarterly / half-yearly
options all read the pre-GST base from `data.pricingWithoutGst.<freq>`, but
the **yearly** branch read `data.pricing.yearly` — the GST-**inclusive** field.
The card's `+ GST` label (this tenant has `gstConfigure=true`,
`gstWithTextConfigure=false`) made it read as if GST were still to be added.

**Fix:** yearly now reads `data.pricingWithoutGst.yearly` like the other
frequencies, falling back to `data.pricing.yearly` only for legacy plans that
lack the without-GST field.

**Note on `MPCard.js`:** the fork commit also touched `MPCard.js`, but Kaizen
already has that fix — it landed on 2026-07-13 as part of the `89414c8` sync
(which carried `bfa5175`'s file state, five commits after `5673096` on the
fork). Only `MPCardBespoke.js` was still on the pre-fix pattern.

### Docs

- `docs/MODEL_PORTFOLIO_ARCHITECTURE.md` — added bespoke pricing GST-display
  warning + payment-confirmation architecture callout (both mirrored from
  upstream doc updates on the same commits).
- `docs/CHANGELOG.md` — this file, created.

### Scope NOT included

- Fork `d663083` (Markup PDF + web-parity bundle) also modified `MPCard.js`
  and `MPCardBespoke.js` for gradient/safe-area — Tier 3, deferred.
- Fork's iOS CI / MARKETING_VERSION commits — not applicable to Kaizen's
  release pipeline.
