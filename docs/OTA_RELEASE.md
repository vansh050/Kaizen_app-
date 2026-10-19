# Kaizen signed OTA releases

## 2026-10-19 — Kaizen signed, exact-target OTA wired (native build required)

- Revopush apps: **`Kaizen-Android`** and **`Kaizen-iOS`** (Production + Staging), owned by this tenant only.
- Signing key: `AlphaQuark/keys/kaizen/ota/kaizen-ota-private.pem` (outside Git; never commit, paste or bundle it). The public half is embedded in `android/app/src/main/res/values/strings.xml` and `ios/AlphaQuark/Info.plist` (`CodePushPublicKey`).
- Deployment keys: Android `build.gradle` default (`CODEPUSH_DEPLOYMENT_KEY` overrides), iOS `Info.plist` `CodePushDeploymentKey` — both this app's **Production** deployment.
- JS policy: `index.js` checks manually and installs only a release whose description carries `[aq-target <platform> <exact binary version>]` (`src/utils/otaPolicy.js`), activating on the next restart. Pinned by `src/__tests__/otaInstallPolicy.test.js` (also asserts this app does not embed AlphaPro's public key).
- iOS deployment target is 15.5 (Revopush requirement); CI `pod install` adds the CodePush pod.
- **Nothing reaches customers until a store build containing this commit is installed.** An OTA published before that has nothing to replace.
- Release: set `config.ota_android_target` / `ota_ios_target` in `package.json` to the exact installed binary version (currently `3.9.75` / `1.0`), then `npm run ota:login` and `npm run ota:<platform>:staging` → test on a Staging-key build → `ota:<platform>:promote`. See the cross-repo runbook `prod-alphaquark-github/docs/MOBILE_OTA_RELEASES.md`.
- Per user (2026-10-19): **no OTA is to be published for now**.
