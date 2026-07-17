/**
 * BrokerConnectModalDispatch — single source of truth for SDK vs
 * legacy broker-connect modal routing.
 *
 * Background: ModalManager.js was the original Phase 3 dispatch site,
 * but the codebase has many bypasses that render legacy modals
 * inline via local React useState (StockAdvices.js, AddtoCartModal,
 * RebalanceAdvices, IIFLReviewTradeModal, GlobalBrokerModals). Those
 * paths NEVER hit ModalManager so Phase 3 routing was a no-op for
 * them — user-reported regression 2026-04-28: AliceBlue and Dhan
 * stayed on legacy even with REACT_APP_USE_SDK_BROKER_FLOW=true.
 *
 * Fix: extract the routing into THIS component, render it from BOTH
 * ModalManager AND every inline-render site, with the `brokerName`
 * prop driving the legacy switch. Single source of truth — when the
 * dispatch rules change, this is the only file to edit.
 *
 * Routing rules (post 2026-04-29 reauth-via-initialValue):
 *   1. If REACT_APP_USE_SDK_BROKER_FLOW is on → ALL brokers (first-
 *      connect AND re-auth) go through Phase3SdkBrokerModal.
 *   2. Otherwise → legacy per-broker modal.
 *
 * Re-auth on the SDK route works through stored-creds pre-fill —
 * `Phase3SdkBrokerModal` fetches userDetails on mount, reads
 * `connected_brokers[broker]` via `getStoredBrokerCreds`, and feeds
 * `BrokerCredentialForm` a per-broker `schemaOverride` whose fields
 * carry `initialValue` (and for Kotak `transformValue`). On reconnect
 * the user sees apiKey + secretKey + clientCode + ucc + mobileNumber
 * pre-filled; on first-connect (no stored entry) every initialValue
 * resolves to '' and the form renders empty — same UX as today.
 *
 * Mirror of tidi_new `Phase3SdkConnectScreen._buildKotakSchemaOverride`
 * (commit 2d44fbf — Kotak smart-prefill + Groww silent refresh +
 * Fyers field inversion). The legacy pre-signed `authUrl` flow
 * (`reauthHelpers.handleSmartReauth`) is unused on the SDK lane —
 * SDK always mints a fresh login URL via `client.getBrokerLoginUrl`.
 * The legacy `reauthConfig` is still resolved by `ManageConnections
 * Modal` for the legacy lane (flag off), where modals like
 * UpstoxModal continue to consume `reauthConfig.authUrl` to skip the
 * form. SDK lane ignores it.
 *
 * What changed at 2026-04-29:
 *   - Dropped `SDK_ELIGIBLE_MODALS` allowlist + `SDK_LEGACY_FALLBACK`
 *     kill-switch. Per-broker SDK gating lived for ~2 days while we
 *     audited each broker; with the audit complete and
 *     `BrokerFormField.initialValue + transformValue` ported from
 *     Flutter to RN (mobile-SDK commit 64d4eff parity), the SDK route
 *     can host every broker's first-connect flow. tidi_new (Flutter)
 *     has been routing all 13 brokers through SDK since
 *     `bd1b501 feat(sdk-integration): Phase 3 — flag-gated SDK-primary
 *     broker connect for all 13 brokers`. Alphab2bapp now matches.
 *   - If a specific broker is broken in the RN SDK at any point, the
 *     fix is to fix the SDK widget — NOT to add it back to a per-app
 *     allowlist. The flag is the single switch.
 *
 * What changed at 2026-04-30 (regression fix):
 *   - Re-introduced `SDK_LEGACY_FALLBACK` Set BUT scoped to brokers
 *     whose audit verdict is SDK-broken with no near-term path through
 *     the SDK. Angel One is the canonical case: shared-mode advisors
 *     (default for every B2B tenant) need an empty-fields publisher-
 *     OAuth schema like Zerodha, but the SDK schema currently always
 *     renders the per-customer apiKey+secretKey+clientCode form (see
 *     Phase3SdkBrokerModal.js:264-268 "Tracked as Known Gap"). The
 *     "fix the SDK widget — not the allowlist" rule still applies, but
 *     it's not acceptable for the user-facing app to show the broken
 *     form for Angel One while the SDK widget is being fixed. The
 *     allowlist is the targeted, documented escape hatch — every entry
 *     gets a verdict + ETA reference in PHASE3_BROKER_AUDIT.md.
 *
 * See:
 *   docs/PHASE3_ARCHITECTURE.md § Routing rules
 *   docs/SDK_PARITY_AUDIT.md
 *   CLAUDE.md § Phase 3 SDK Broker Migration — BLOCKING DOCUMENTATION REQUIREMENT
 */

import React, {useState} from 'react';
import Config from 'react-native-config';
import {useConfig} from '../../context/ConfigContext';

// Legacy per-broker modals
import IIFLModal from '../iiflmodal';
import ICICIUPModal from './icicimodal';
import UpstoxModal from './upstoxModal';
import AngleOneBookingTrueSheet from './AngleoneBookingModal';
import MotilalModal from './MotilalModal';
import ZerodhaConnectModal from './ZerodhaConnectModal';
import HDFCconnectModal from './HDFCconnectModal';
import DhanConnectModal from './DhanConnectModal';
import AliceBlueConnect from './AliceBlueConnect';
import FyersConnect from './FyersConnect';
import KotakModal from './KotakModal';
import GrowwConnectModal from './GrowwConnectModal';
import AxisConnectModal from './AxisConnectModal';
import ArihantConnectModal from './ArihantConnectModal';
import DefinEdgeConnectModal from './DefinEdgeConnectModal';

// SDK modal (all brokers when flag on, except re-auth)
import Phase3SdkBrokerModal from './Phase3SdkBrokerModal';

// Angel One pre-connect cautionary-listing warning (rendered as an
// interstitial above whichever connect modal would normally show).
import AngelOneCautionaryWarning from './AngelOneCautionaryWarning';

// Brokers that ALWAYS route to the legacy modal even when
// REACT_APP_USE_SDK_BROKER_FLOW=true. Each entry MUST have a verdict
// row in docs/PHASE3_BROKER_AUDIT.md explaining why and a removal
// criterion. Keep this Set tiny — every entry is tech debt against the
// "single switch" intent above.
//
// 2026-04-30 added Angel One — SDK widget always rendered the
//   per-customer apiKey+secretKey+clientCode form; shared-mode
//   advisors (default) needed the empty-fields publisher-OAuth schema
//   like Zerodha, AND backend /exchange-token didn't yet handle
//   auth_token for shared mode.
//
// 2026-05-01 removed Angel One — both gaps closed:
//   - Backend `/sdk/v1/connections/Angel One/{login-url,exchange-token}`
//     learned shared-mode dispatch (commit `177ce21` + follow-ups).
//   - SDK form `BrokerFormSchema` `useSharedAngelOneKey` schema-override
//     pattern shipped (Flutter `_buildAngelOneSharedSchemaOverride`,
//     RN equivalent) so shared-mode advisors see empty fields and
//     hand off straight to OAuth.
//   - Backend `/login-url` now returns `callbackUrl` for brokers whose
//     vendor app has a fixed post-auth redirect (Angel One →
//     `prod.alphaquark.in/stock-recommendation`); SDK
//     `WebViewBrokerAuthFlow` (Flutter + RN) prefers it over the
//     consumer-passed redirectUrl for the matcher. Closes the
//     "WebView lands on AQ login page" issue user-reported on both
//     apps 2026-05-01.
//
// 2026-07-17 added Arihant Capital + DefinEdge Securities — CRASH FIX.
//   These two brokers were added to the display tile list + normalizeBrokerKey
//   (2026-06-09 web parity) with purpose-built legacy modals
//   (ArihantConnectModal 2-step OTP flow, DefinEdgeConnectModal credential
//   flow) but were NEVER added to the SDK's `BROKER_FORM_SCHEMAS` map
//   (mobile-sdk packages/rn/src/components/brokerFormSchema.ts — neither
//   broker is in the `BrokerName` union at all). With the flag on and this
//   Set empty, every broker routed to Phase3SdkBrokerModal, which mounts
//   `<BrokerCredentialForm broker={brokerName}>`; that widget's initial-state
//   seeding does `for (const f of baseSchema.fields)` where
//   `baseSchema = BROKER_FORM_SCHEMAS[broker]` — `undefined` for these two —
//   so the app crashed with a TypeError on the very first render
//   (BrokerCredentialForm.tsx:159), on every tap of "Connect Arihant Capital"
//   / "Connect DefinEdge Securities". Adding them here routes to their
//   legacy modals, which is correct and complete today.
//   RULE: any broker added to normalizeBrokerKey / the display tile list
//   MUST either get a BROKER_FORM_SCHEMAS entry in the SDK repo, or be
//   listed in this Set — otherwise the SDK lane crashes on an undefined
//   schema for that broker. See also the defensive guard added in
//   Phase3SdkBrokerModal.js the same day, which prevents this crash class
//   even if a future broker is forgotten here.
//
// Otherwise the Set is intentionally kept small — keep it so future
// near-term gaps have a documented home rather than scattering fallback
// decisions across files.
const SDK_LEGACY_FALLBACK = new Set(['Arihant Capital', 'DefinEdge Securities']);

const useSdkBrokerFlow = () => {
  const v = String(Config?.REACT_APP_USE_SDK_BROKER_FLOW || '')
    .trim()
    .toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
};

// Normalize the broker key — ModalManager uses 'ICICI', 'HDFC',
// 'Motilal', 'IIFL'; some inline-render sites use 'ICICIDirect',
// 'Hdfc', 'IIFLSecurities', etc. Normalize so the dispatch matches
// regardless of caller.
const normalizeBrokerKey = (raw) => {
  if (!raw) return '';
  const trimmed = String(raw).trim();
  if (trimmed === 'ICICI Direct') return 'ICICI';
  if (trimmed === 'Hdfc Securities' || trimmed === 'HDFC Securities')
    return 'HDFC';
  if (trimmed === 'Motilal Oswal') return 'Motilal';
  if (trimmed === 'IIFL Securities') return 'IIFL';
  if (trimmed === 'Aliceblue') return 'AliceBlue';
  if (trimmed === 'AngleOne') return 'Angel One';
  // New (2026-06-09 web parity). Mobile display tile keys are
  // 'Arihant Capital' and 'DefinEdge Securities' to match the
  // user_broker / connected_brokers slot names the backend uses.
  if (trimmed === 'DefinEdge' || trimmed === 'Definedge') return 'DefinEdge Securities';
  if (trimmed === 'Arihant') return 'Arihant Capital';
  return trimmed;
};

const BrokerConnectModalDispatch = ({
  brokerName,
  isVisible,
  onClose,
  setShowBrokerModal,
  fetchBrokerStatusModal,
  reauthConfig,
  ...rest
}) => {
  // Hook must run unconditionally (before the isVisible early-return).
  const runtimeConfig = useConfig();
  if (!isVisible) return null;

  const key = normalizeBrokerKey(brokerName);
  // Per-customer Angel One (advisor `useSharedAngelOneKey === false`)
  // MUST use the SDK modal — that's the only path with the
  // apiKey/secretKey/clientCode form + per-customer egress-IP whitelist.
  // The legacy AngleOneBookingTrueSheet is the SHARED-key publisher-login
  // WebView and has no per-customer story. This override is additive:
  // shared-key Angel One (the default) is completely untouched, so no
  // existing advisor's connect flow changes. See
  // prod-alphaquark-github/docs/IPV4_EGRESS_BILLING_DESIGN.md.
  const angelOnePerCustomer =
    key === 'Angel One' && runtimeConfig?.useSharedAngelOneKey === false;
  const commonProps = {
    isVisible: true,
    onClose,
    setShowBrokerModal,
    fetchBrokerStatusModal,
    reauthConfig: reauthConfig || null,
    ...rest,
  };

  // Resolve which connect modal would normally show for this broker
  // (SDK lane vs legacy lane). Wrap Angel One specifically with the
  // pre-connect cautionary-listing warning sheet — fresh connects
  // see it once, re-auth (`reauthConfig` non-null) skips it.
  let modal;
  if (
    angelOnePerCustomer ||
    (useSdkBrokerFlow() && !SDK_LEGACY_FALLBACK.has(key))
  ) {
    modal = <Phase3SdkBrokerModal {...commonProps} brokerName={key} />;
  } else {
    modal = renderLegacyModal(key, commonProps);
  }

  return modal;
};

const renderLegacyModal = (key, commonProps) => {
  switch (key) {
    case 'ICICI':
      return <ICICIUPModal {...commonProps} />;
    case 'Upstox':
      return <UpstoxModal {...commonProps} />;
    case 'Angel One':
      return <AngleOneBookingTrueSheet {...commonProps} />;
    case 'Motilal':
      return <MotilalModal {...commonProps} />;
    case 'Zerodha':
      return <ZerodhaConnectModal {...commonProps} />;
    case 'HDFC':
      return <HDFCconnectModal {...commonProps} />;
    case 'Dhan':
      return <DhanConnectModal {...commonProps} />;
    case 'AliceBlue':
      return <AliceBlueConnect {...commonProps} />;
    case 'Fyers':
      return <FyersConnect {...commonProps} />;
    case 'Kotak':
      return <KotakModal {...commonProps} />;
    case 'Groww':
      return <GrowwConnectModal {...commonProps} />;
    case 'Axis Securities':
      return <AxisConnectModal {...commonProps} />;
    case 'IIFL':
      return <IIFLModal {...commonProps} />;
    case 'Arihant Capital':
      return <ArihantConnectModal {...commonProps} />;
    case 'DefinEdge Securities':
      return <DefinEdgeConnectModal {...commonProps} />;
    default:
      return null;
  }
};

export default BrokerConnectModalDispatch;
export { normalizeBrokerKey };
