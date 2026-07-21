# iOS TestFlight CI — Secrets Setup

This repo has a ready-to-run TestFlight workflow at `.github/workflows/ios-build.yml`
(macOS runner, auto-increments the build number via `scripts/asc_versioning.rb`,
uploads to TestFlight). It will **not build until the secrets below are added and an
App Store Connect app exists** for this app's bundle id.

## This app

| | Kaizen | rgx |
|---|---|---|
| **APP_BUNDLE_ID** (in `ios-build.yml`) | `com.aq.kaizenalpha` | `com.aq.rgx` |
| **Build from branch** | `main` | `feature/ios2.0` |
| **Repo** | `vansh050/Kaizen_app-` | `pkc144/rgx_app` |
| **`SDK_REPO_TOKEN` already set?** | ❌ add it | ✅ present |

> ⚠️ Verify the `APP_BUNDLE_ID` in `ios-build.yml` matches the **exact** bundle id of the
> app you register in App Store Connect. The versioning step queries ASC by this id and
> **aborts if no app matches** (safe failure — it won't upload to the wrong app).

## Step 0 — Register the app in App Store Connect (one-time)
App Store Connect → **Apps → +** → New App → set the bundle id (create it first under
**Certificates, Identifiers & Profiles → Identifiers** if it doesn't exist). Enable the
**Sign in with Apple** capability on the identifier (the app uses it).

## The 8 secrets

| Secret | What it is |
|---|---|
| `IOS_CERTIFICATE_BASE64` | Apple **Distribution** certificate `.p12`, base64-encoded |
| `IOS_CERTIFICATE_PASSWORD` | the password you set when exporting the `.p12` |
| `IOS_PROVISIONING_PROFILE_BASE64` | **App Store** provisioning profile `.mobileprovision`, base64-encoded |
| `APP_STORE_CONNECT_API_KEY` | contents of the ASC API key `.p8` file (the whole `-----BEGIN PRIVATE KEY-----…` text) |
| `APP_STORE_CONNECT_ISSUER_ID` | ASC API **Issuer ID** (UUID) |
| `APP_STORE_CONNECT_KEY_ID` | ASC API **Key ID** (10 chars) |
| `APPLE_TEAM_ID` | your Apple Developer **Team ID** (10 chars) |
| `SDK_REPO_TOKEN` | GitHub PAT with **read** access to `alpha112233/alphaquark-mobile-sdk` (this app depends on `@alphaquark/mobile-sdk`) — **Kaizen only; rgx already has it** |

> The **ASC API key trio** (`APP_STORE_CONNECT_*`) and `APPLE_TEAM_ID` are **account-wide** — reuse
> the exact same values already working on markup/arfs. Only the **certificate** and **provisioning
> profile** are per-app (well, the Distribution cert can be shared across your apps; the *profile*
> is per-bundle-id).

## Step 1 — Get the certificate (`.p12`)
On a Mac (Keychain Access):
1. Apple Developer → Certificates → **+** → **Apple Distribution** → follow the CSR flow (Keychain
   Access → Certificate Assistant → Request a Certificate from a CA), download the `.cer`, double-click
   to install.
2. In Keychain Access → **My Certificates**, right-click the *Apple Distribution* cert → **Export** →
   save as `dist.p12`, set a password (→ `IOS_CERTIFICATE_PASSWORD`).
3. Base64 it: `base64 -i dist.p12 -o dist.p12.b64`

*(If markup/arfs already use one shared Distribution cert, you can reuse that same `.p12` here — you
still need a per-bundle-id provisioning profile in Step 2.)*

## Step 2 — Get the App Store provisioning profile
Apple Developer → **Profiles → +** → **App Store** → select this app's App ID (`com.aq.…`) → select
the Distribution cert → download `profile.mobileprovision`, then:
`base64 -i profile.mobileprovision -o profile.b64`

## Step 3 — Get the ASC API key (reuse markup/arfs values)
App Store Connect → **Users and Access → Integrations → App Store Connect API** → key with **App
Manager** role. Note the **Issuer ID** and **Key ID**, download `AuthKey_XXXX.p8` (downloadable once).
If markup/arfs already have a key, reuse its `.p8` + Issuer ID + Key ID as-is.

## Step 4 — Team ID
Apple Developer → **Membership** → **Team ID** (10 chars).

## Step 5 — Set the secrets (`gh` CLI)
Set `SLUG` to this repo, then:

```bash
SLUG=vansh050/Kaizen_app-        # or: pkc144/rgx_app

gh secret set IOS_CERTIFICATE_BASE64          --repo "$SLUG" < dist.p12.b64
gh secret set IOS_CERTIFICATE_PASSWORD        --repo "$SLUG"          # paste the .p12 password
gh secret set IOS_PROVISIONING_PROFILE_BASE64 --repo "$SLUG" < profile.b64
gh secret set APP_STORE_CONNECT_API_KEY       --repo "$SLUG" < AuthKey_XXXX.p8
gh secret set APP_STORE_CONNECT_ISSUER_ID     --repo "$SLUG"          # paste the Issuer ID
gh secret set APP_STORE_CONNECT_KEY_ID        --repo "$SLUG"          # paste the Key ID
gh secret set APPLE_TEAM_ID                   --repo "$SLUG"          # paste the Team ID
# Kaizen ONLY (rgx already has it):
gh secret set SDK_REPO_TOKEN                  --repo "$SLUG"          # paste a PAT with read on alphaquark-mobile-sdk
```
(You can also add these via the GitHub UI: **repo → Settings → Secrets and variables → Actions → New
repository secret**. For the base64 ones, paste the *contents* of the `.b64` file.)

Verify names:
```bash
gh secret list --repo "$SLUG"
```
Expected: all 8 present (7 for rgx + the pre-existing `SDK_REPO_TOKEN`).

## Step 6 — Build & upload to TestFlight
```bash
# Kaizen:
gh workflow run ios-build.yml --repo vansh050/Kaizen_app- --ref main
# rgx:
gh workflow run ios-build.yml --repo pkc144/rgx_app --ref feature/ios2.0
```
Watch it: `gh run watch --repo "$SLUG"` (or the Actions tab). Build number auto-increments off App
Store Connect. On success, the build appears in App Store Connect → TestFlight after Apple processing
(~5–15 min).

## Notes
- The **Apple Guideline-4 Sign-in-with-Apple fix is already in both apps' code**, so a green build here
  is ready to submit for review (reuse the resubmission note from markup).
- The `.p8` key is downloadable **once** — store it in your password manager.
- If the versioning step errors *"No app found on App Store Connect for bundleId …"*, the bundle id in
  `ios-build.yml` doesn't match a registered ASC app — fix one of them.
