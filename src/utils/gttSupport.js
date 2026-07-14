// GTT broker support — SINGLE SOURCE OF TRUTH for the frontend
// (docs/GTT_ARCHITECTURE.md §4; CLAUDE.md tracking item 21).
//
// Adding a broker here lights up: the customer GTT routing in
// ProcessTrades, the ReviewTradeModel execution notes, and the advisor
// compose-time banner in SendAdviceModal — the communications derive from
// this list, so they can never drift from the routing.
//
// DO NOT add a broker until its server-side lifecycle is certified
// (placement wrapper + poller adapter + fired-order attribution — the
// place+cancel cert and live-fire cert in GTT_ARCHITECTURE §6). The
// server-side poller runs per-broker shadow/enforce modes independently;
// this list is the CUSTOMER-FACING gate and must lag, never lead, the
// server certs.
// 2026-07-12: Angel One / Groww / Dhan customer-enabled (Pratik) — placement
// classes live in ccxt buy_sell_gtt_all_brokers.py; lifecycle poller in
// enforce (status writes). NOTE per-broker capability: Groww = full GTT+OCO;
// Angel One + Dhan = SINGLE-trigger only — an OCO (stoploss+target) advice on
// those brokers is REFUSED server-side with a clear per-leg message (never
// silently downgraded; two unlinked exits could both fire = double exit).
// 2026-07-12 (2): ICICI Direct enabled with SEGMENT gating — their API
// offers GTT for F&O ONLY, so an ICICI GTT leg is native only when its
// exchange is NFO/BFO; ICICI EQUITY gtt advices stay on the synthetic
// price-alert rail (the ccxt cron mirrors this same rule — keep in sync).
// 2026-07-12 (3): ZERODHA REMOVED (Pratik) — the platform's Zerodha order
// flow is Kite Publisher-only, and the Publisher cannot place GTT; the API
// placement path has no customer legs. Zerodha customers get the synthetic
// price-alert rail like other non-native brokers. (Server-side Zerodha GTT
// lifecycle + the tokenless postback webhook remain built for any future
// API-app scenario.)
export const GTT_NATIVE_BROKERS = [
  "upstox",
  "angel one",
  "groww",
  "dhan",
  "icici direct",
  "dummybroker",
];

// Per-broker GTT capability (GTT_ARCHITECTURE §4, doc-verified 2026-07-12):
// which SEGMENTS the broker's API can hold a trigger for, and whether it
// supports OCO. A leg outside a broker's capability is NOT native — it
// routes to the synthetic price-alert rail (never a doomed placement).
const GTT_BROKER_CAPS = {
  upstox: { equity: true, fno: true, oco: true },
  "angel one": { equity: true, fno: false, oco: false }, // SmartAPI: equity DELIVERY/MARGIN only
  groww: { equity: true, fno: true, oco: true },
  dhan: { equity: true, fno: true, oco: false },
  "icici direct": { equity: false, fno: true, oco: true }, // Breeze: F&O only
  dummybroker: { equity: true, fno: true, oco: true },
};
const FNO_EXCHANGES = new Set(["NFO", "BFO"]);

const GTT_BROKER_DISPLAY = {
  zerodha: "Zerodha",
  upstox: "Upstox",
  "angel one": "Angel One",
  groww: "Groww",
  dhan: "Dhan",
  "icici direct": "ICICI Direct",
  dummybroker: null, // internal sandbox — never shown in customer copy
};

// per-leg OCO detection: the 3-leg advice shape, or SL+PT set together.
export const isGttOcoLeg = (stock) =>
  !!(stock &&
    ((stock.entryLeg && stock.leg1 && stock.leg2) ||
      (Number(stock.stopLoss) > 0 && Number(stock.profitTarget) > 0) ||
      stock.slptCheck === true));

// 🔴 Kaizen KILL SWITCH — GTT customer routing is DISABLED until each
// upstream-native broker (Upstox, Angel One, Groww, Dhan, ICICI Direct)
// has a place+cancel cert (docs/GTT_MOBILE_CERT_CHECKLIST.md) run on the
// Kaizen backend + ccxt deploy. Until then, every GTT-flagged leg falls
// through to the REGULAR order path (synthetic price-alert rail) — matches
// pre-Tier-3-port behavior. To ENABLE per-broker after cert, delete the
// early-return `false` below (or replace with a per-broker allowlist).
// See fork b2b/feature/sdk-plus-config_forkv2 d663083 for the full-native
// version + GTT_MOBILE_CERT_CHECKLIST.md for the certification gate.
const KAIZEN_GTT_CUSTOMER_ROUTING_ENABLED = false;

// exchange / oco are OPTIONAL: omitted = broker-level check (labels);
// pass the leg's exchange AND its OCO-ness wherever a ROUTING decision
// is made so F&O-only and single-only brokers gate correctly per leg.
export const isGttNativeBroker = (broker, exchange, isOco) => {
  if (!KAIZEN_GTT_CUSTOMER_ROUTING_ENABLED) return false;
  const b = String(broker || "").toLowerCase();
  if (!GTT_NATIVE_BROKERS.includes(b)) return false;
  const caps = GTT_BROKER_CAPS[b];
  if (!caps) return false;
  if (exchange !== undefined) {
    const isFno = FNO_EXCHANGES.has(String(exchange || "").toUpperCase());
    if (isFno && !caps.fno) return false;
    if (!isFno && !caps.equity) return false;
  }
  if (isOco === true && !caps.oco) return false;
  return true;
};

// Human-readable list for banners/notes ("Zerodha, Upstox, Angel One, Groww & Dhan").
export const gttNativeBrokerLabel = () => {
  const names = GTT_NATIVE_BROKERS.map((b) => GTT_BROKER_DISPLAY[b]).filter(Boolean);
  const joined =
    names.length <= 1
      ? names[0] || ""
      : names.slice(0, -1).join(", ") + " & " + names[names.length - 1];
  // capability caveats spelled out so "(F&O only)" can never read as
  // applying to the whole list
  return joined + " (ICICI: F&O only; Angel One: equity single-trigger only; Dhan: single-trigger only)";
};
