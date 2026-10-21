# SYNC.md — Kaizen Alpha (Kaizen_app) white-label fork

Fork of Alphab2bapp. Remotes: `origin` (alpha112233/Kaizen_app) and
`vansh050` (vansh050/Kaizen_app-) — push to BOTH.

## Upstream

- Tracked branch: Alphab2bapp `release/deploy_5.1`
- Last sync: 2026-10-21 — port through `94f41855` (see Sync log).
- Previous: 2026-10-17 — full content sync to `222267d5` (per-file
  classification: fork copies equal to an older upstream version → upstream;
  new upstream files added). Shared `src/` and `designs/default/` equal
  upstream except the divergences below.

## Intentional divergences

- OTA: since 2026-10-19 (`cc2ccb10`) this app has its OWN signed Revopush
  deployment (`Kaizen-Android` / `Kaizen-iOS`, own key — see
  `docs/OTA_RELEASE.md`). `index.js` and `src/utils/executionBundleSafety.js`
  now match upstream code; never copy AlphaPro's deployment keys, public key
  or `package.json` `ota:*` app names.
- `designs/registry.js` — default variant only (no upstream `moneyman_app`).
- `whitelabel/content.js` — upstream neutral defaults, brand "Kaizen Alpha".
- Tests needing AlphaB2B-only infra (visual CI, Maestro, prod blue theme,
  Moneyman variant) are skipped/removed; contract tests find this app's
  Android package dynamically.

## Sync log

| Date | Upstream tip | Ported | Kept fork | Skipped |
|------|--------------|--------|-----------|---------|
| 2026-10-17 | `222267d5` | full content sync (see above) | divergences above | — |
| 2026-10-21 | `94f41855` | sell-auth sheet only on classified rejection + today's approval first / DDPI optional + wait for reconciliation (`29dde59b` `41a609a4` `eba275ba`); auth bearer survives a pre-sign-in request (`3ef3e17f`); admin-featured plans of any type, admin-added bespoke subscribers, chart width, legal WebView guard (`4a6c2d85`); design-literal compile validator skips tests (`94f41855`); exact-target OTA install on a stale execution bundle (`executionBundleSafety.js`, OTA infra now exists). `a25969a6` and `f4cfb36a` were already in (`fd7c20dc`, `ad1d5cc4`). | `designs/registry.js`, `whitelabel/content.js`, OTA keys/app names, `package.json`, tests/workflows/scripts for AlphaB2B-only infra (visual CI, Maestro, moneyman_app) | AlphaB2B release/OTA doc commits (`49a1e0e5`, `4cb6cc14`) |

## Native ports done 2026-10-17

Crashlytics (Gradle plugin/classpath, iOS modular-header pods),
react-native-keychain, libphonenumber-js, ModalSoftInput Android module,
ICICI GlobalSign Root R46 network-security config, PhonePe `/phonepe-return`
app-link path, MainActivity `onCreate(null)`, bottom-tabs 7.10.1 + patch.
