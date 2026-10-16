# SYNC.md — Kaizen Alpha (Kaizen_app) white-label fork

Fork of Alphab2bapp. Remotes: `origin` (alpha112233/Kaizen_app) and
`vansh050` (vansh050/Kaizen_app-) — push to BOTH.

## Upstream

- Tracked branch: Alphab2bapp `release/deploy_5.1`
- Last sync: 2026-10-17 — full content sync to `222267d5` (per-file
  classification: fork copies equal to an older upstream version → upstream;
  new upstream files added). Shared `src/` and `designs/default/` equal
  upstream except the divergences below.

## Intentional divergences

- `index.js` + `src/utils/executionBundleSafety.js` — no signed OTA
  deployment for this app: bundled entry point (upstream minus the Revopush
  wrapper) and a store-update prompt instead of an OTA install.
- `designs/registry.js` — default variant only (no upstream `moneyman_app`).
- `whitelabel/content.js` — upstream neutral defaults, brand "Kaizen Alpha".
- Tests needing AlphaB2B-only infra (visual CI, Maestro, prod blue theme,
  Moneyman variant) are skipped/removed; contract tests find this app's
  Android package dynamically.

## Native ports done 2026-10-17

Crashlytics (Gradle plugin/classpath, iOS modular-header pods),
react-native-keychain, libphonenumber-js, ModalSoftInput Android module,
ICICI GlobalSign Root R46 network-security config, PhonePe `/phonepe-return`
app-link path, MainActivity `onCreate(null)`, bottom-tabs 7.10.1 + patch.
