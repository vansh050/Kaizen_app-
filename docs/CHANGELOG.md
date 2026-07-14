# Changelog

All notable changes to the Kaizen (AlphaQuark B2B) Mobile App are documented here.

Entries are ported from the upstream `Alphab2bapp` fork (`b2b/feature/sdk-plus-config_forkv2`)
during periodic sync passes, plus Kaizen-native work. Each entry names the upstream commit
where applicable.

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
