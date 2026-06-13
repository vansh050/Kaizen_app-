# SYNC.md — Kaizen Alpha Whitelabel Overlay

This repo is a thin overlay on top of `Alphab2bapp` upstream. It contains:

- `designs/kaizenalpha/` — variant-specific tokens, composites, screens, assets.
- `whitelabel/appVariants.js` — tenant brand/theme config (colors, logos,
  Google clientId, subdomain, RA code).
- Native shell — Android/iOS icons, `applicationId`, signing, splash.
- `.env` — `DESIGN_VARIANT=kaizenalpha`, `APP_VARIANT=kaizenalpha`,
  `REACT_APP_HEADER_NAME=kaizenalpha`, broker keys, etc.
- A 2-line patch on `designs/registry.js` (import + map entry).
- Fork-local `package.json`, `metro.config.js` (iOS deps + watchFolders trim).

**Everything else is upstream.** See `docs/WHITELABEL_RECIPE.md` for the
contract.

## Upstream

- Repo: `https://github.com/alpha112233/Alphab2bapp.git` (sibling at
  `../Alphab2bapp`)
- Tracked branch: `feature/sdk-plus-config_forkv2`
- Last merged commit: `76b943d chore(cashfree): force PRODUCTION via REACT_APP_CASHFREE_ENV override` (2026-06-13)
- Cadence: at least monthly; sooner if upstream ships fixes we want.

## Warning

This fork's `src/` is **byte-identical** to upstream `feature/sdk-plus-config_forkv2`.
Do **not** make tenant-specific edits inside `src/`. Tenant config belongs in
`whitelabel/appVariants.js`; custom UI belongs in `designs/kaizenalpha/`.

## Sync workflow

Two equivalent paths — pick one.

### Local sibling-repo path (no network)

```bash
# Make sure sibling Alphab2bapp is on the upstream branch you want
cd ../Alphab2bapp && git checkout feature/sdk-plus-config_forkv2 && git pull

# From this repo, mirror src/ and designs/default/
cd ../Kaizen_app-
git branch backup/pre-sync-$(date +%Y%m%d)   # safety net
rsync -av --delete ../Alphab2bapp/src/ src/
rsync -av --delete ../Alphab2bapp/designs/default/ designs/default/

# Also sync upstream-managed top-level files
cp ../Alphab2bapp/docs/WHITELABEL_RECIPE.md docs/WHITELABEL_RECIPE.md
cp ../Alphab2bapp/App.js App.js

# Verify byte-identical
diff -rq src ../Alphab2bapp/src | wc -l           # → 0
diff -rq designs/default ../Alphab2bapp/designs/default | wc -l  # → 0
```

### Git-remote path (when sibling repo isn't checked out)

```bash
git remote add upstream https://github.com/alpha112233/Alphab2bapp.git || true
git fetch upstream feature/sdk-plus-config_forkv2
git checkout upstream/feature/sdk-plus-config_forkv2 -- src/ designs/default/ docs/WHITELABEL_RECIPE.md App.js

# Resolve `designs/registry.js` if it conflicts (mechanical — keep both upstream's
# default-only state and the `import kaizenalphaVariant` + map entry from this fork)
```

After either path:

```bash
# Update this file's "Last merged commit" line, then commit.
git add -A
git commit -m "chore: sync src/ + designs/default from upstream <sha>"
```

## Do NOT sync (fork-local — explicit)

| Path | Reason |
|------|--------|
| `package.json` | Fork name `kaizenalpha`; iOS-only deps (apple-auth, react-native-iap); pruned test scripts. |
| `metro.config.js` | `watchFolders` trimmed — parent dir has 50+ sibling projects. |
| `whitelabel/appVariants.js` | Tenant brand/theme; one variant per fork. |
| `designs/kaizenalpha/` | This fork's variant overlay. |
| `designs/registry.js` | Contains the 2-line patch registering `kaizenalpha`. Re-apply on every upstream merge. |
| `ios/` | Xcode project, Podfile, entitlements, Info.plist, Firebase plist. |
| `android/` | Gradle, signing, Firebase google-services.json. |
| `.env` | Tenant + broker keys. |
| `SYNC.md` | This file. |

## iOS-specific files

| Path | Purpose |
|------|---------|
| `ios/` (entire folder) | Xcode project, Podfile, Podfile.lock, entitlements, Info.plist |
| `ios/AlphaQuark/GoogleService-Info.plist` | Firebase iOS config |
| `ios/AlphaQuark/Info.plist` | App permissions, bundle ID, Apple Sign-In entitlement |
| `ios/AlphaQuark/AlphaQuark.entitlements` | Sign in with Apple entitlement |
| `ios/KaizenAlpha.xcscheme` | Build scheme renamed in commit `353aea1` |

## iOS-specific packages (in package.json, absent from Android-only forks)

| Package | Purpose |
|---------|---------|
| `@invertase/react-native-apple-authentication` | Sign in with Apple |
| `react-native-iap` | In-App Purchases (App Store) |

## Tenant variants

| Variant key | Subdomain   | Notes                                   |
|-------------|-------------|-----------------------------------------|
| kaizenalpha | kaizenalpha | dark purple + black, layout2, RA code = kaizenalpha |

## Fork-local dependencies (additions to upstream)

- `@alphaquark/mobile-sdk` — `file:../alphaquark-mobile-sdk/packages/rn`
- `@react-native-clipboard/clipboard` — `^1.16.3`
- `@invertase/react-native-apple-authentication` — iOS Sign in with Apple
- `react-native-iap` — App Store In-App Purchases

## iOS build notes

- Metro `watchFolders` points only to the SDK package (not parent dir) — avoid
  watching 50+ sibling repos.
- `@alphaquark/mobile-sdk` resolved via `extraNodeModules` to bypass symlink
  issues.
- Podfile uses `razorpay-pod 1.5.0` + Firebase modular headers.
- Apple Sign-In requires entitlement in Xcode and Apple Developer portal
  capability enabled.

## Per-fork gotchas

- Kaizen Alpha colors are sourced from the web repo
  `../kaizen_alpha/src/SeperateDesigns/LandingPageDesigns/KaizenLandingPage.jsx`
  (CSS vars: `--purple #A199FF`, `--near-black #0A0A0A`, `--dark #1A1A1A`,
  `--yellow #F2F261`, `--purple-dark #8B82F0`). Recorded in
  `whitelabel/appVariants.js` header.
- iOS Xcode **scheme** is still `AlphaQuark` (filename
  `ios/AlphaQuark.xcodeproj/xcshareddata/xcschemes/AlphaQuark.xcscheme`,
  target `BlueprintName=AlphaQuark`). Only the produced **buildable** was
  renamed in `353aea1` — the `.app` ships as `KaizenAlpha.app` with bundle
  id `com.aq.kaizenalpha`. So invoke with `xcodebuild -scheme AlphaQuark`
  (and `-workspace AlphaQuark.xcworkspace`), NOT `-scheme KaizenAlpha`.
  The iOS GoogleService-Info.plist lives at `ios/GoogleService-Info.plist`
  (referenced via `sourceTree = "<group>"`), not `ios/AlphaQuark/`.
- **Deep-link scheme `kaizenapp://`** is registered in both
  `android/app/src/main/AndroidManifest.xml` (intent-filter on MainActivity)
  and `ios/AlphaQuark/Info.plist` (`CFBundleURLTypes`). Consumed by
  PayUService return URLs and ZerodhaOAuthService WebView close trigger.
  If `REACT_APP_DEEP_LINK_SCHEME` ever changes, BOTH native files must be
  updated in the same commit — env-only changes break PayU/Zerodha silently.
- **Zerodha API key (`REACT_APP_ZERODHA_API_KEY=b0g1r806oitsamoe`) is
  AlphaQuark's shared default — not Kaizen-specific.** Kite Connect's dev
  portal binds a single redirect URL to each API key. Two valid setups:
  - **Recommended:** set
    `appadvisors.kaizenalpha.brokerConnectRedirectUrl` in MongoDB to
    whatever URL the AQ Kite portal has registered (likely
    `https://prod.alphaquark.in/stock-recommendation`). The backend
    override wins over the `.env` default and Zerodha OAuth resolves.
  - **Alternative:** register a Kaizen-specific Kite API key via
    `developers.kite.trade`, with `https://kaizenalpha.in/stock-recommendation`
    as its registered redirect URL, then replace `b0g1r806oitsamoe` here.
    The first time a user runs the OAuth flow on the new key, they'll
    need to re-grant access.

  Until ONE of these is in place, all Zerodha first-connect attempts on
  Kaizen will fail with "Invalid Redirect URL".

## Sync history

| Date       | Upstream SHA  | Branch                              | Notes                                                 |
|------------|---------------|-------------------------------------|-------------------------------------------------------|
| 2026-05-10 | (initial)     | `feature/ios2.6`                    | Initial whitelabel migration (kaizenalpha overlay).   |
| 2026-06-13 | `76b943d`     | `feature/sdk-plus-config_forkv2`    | Full mainline sync. Moved leaked `src/assets/AppLogo/kaizenalpha.png` → `designs/kaizenalpha/assets/logo.png`. Dropped stale `src/components/AlphanomyLogo.js`. Reverted ~24 fork-local `'kaizenalpha'` literal fallbacks in src/ — `.env`'s `APP_VARIANT=kaizenalpha` is now the single source of truth. Added `DESIGN_VARIANT=kaizenalpha` to `.env`. Pulled in Courses, Cashfree, Gumlet, LiveKit, RiaBilling, Webinars, Arihant, DefinEdge, ProvisionalBanner, AumPerformanceCard, NbaBanner, PortfolioHealthSheet, PortfolioTransitionCard. Synced `App.js` (hoisted SDK wrapper — fixes remount state-wipe). |

## What this fork does NOT contain

- Any patch to `src/`. If `src/` ever gets edited here, that's a bug — fix
  it upstream or push the tenant-specific knob into `designs/kaizenalpha/`
  or `whitelabel/appVariants.js`.
- Any patch to backend code. Tenant-specific backend config lives in
  `appadvisors.kaizenalpha` documents in MongoDB.
- A copy of `designs/default/`. The fallback chain in upstream's registry
  handles default-flow-through automatically.

## Known regressions / gaps

None at 2026-06-13 sync. Native iOS build still needs verification after the
App.js refactor — the hoist fix is well-tested upstream but this fork hadn't
exercised it yet.
