/**
 * useHomeMarketSummary — derives the alphanomy variant's HomeScreen header
 * data (live tickers + portfolio P&L summary).
 *
 * Returns:
 *   {
 *     tickers: [{ name, value, change, dir }, ...],
 *     pnlSummary: { currentPnl, invested, currentValue, returnsPct },
 *   }
 *
 * **Tickers** — live LTPs via the existing `WebSocketManager` singleton
 * (socket.io-client, already used by `<MarketIndices>`, watchlist, etc.).
 * The `MarketDataContext` was the original source but it never opens a
 * WebSocket of its own — `WebSocketManager` is the actually-working
 * pipeline. We subscribe to NIFTY / SENSEX / BANKNIFTY (mirrors
 * `indicesConfig` in `src/components/HomeScreenComponents/MarketIndices.js`)
 * and fetch each index's previous-close from
 * `${ccxtServer}misc/indices-previous-close` so the change indicator
 * (▼ 97.00 (0.40%)) can be computed.
 *
 * **P&L** — sum of `MultiBrokerContext.aggregatedHoldings` (already
 * normalized + ltp-multiplied by `useMultiBrokerHoldings`). Returns
 * all-zero when no broker is connected.
 *
 * Both data sources degrade silently when their providers / sockets are
 * unavailable — the hook always returns the same shape, just with empty
 * arrays / zero values. Consumers fall back to design-preview placeholders.
 */

import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useTrade } from '../../TradeContext';
import server from '../../../utils/serverConfig';
import Config from '../../../utils/safeConfig';
import { generateToken } from '../../../utils/SecurityTokenManager';
import { getAdvisorSubdomain } from '../../../utils/variantHelper';
import WebSocketManager from '../../../components/AdviceScreenComponents/DynamicText/WebSocketManager';

// Mirror of `indicesConfig` in MarketIndices.js — kept here to avoid
// importing that ~600-line component when all we need is the config.
const INDICES = [
    {
        key: 'nifty50',
        symbol: 'NIFTY',
        exchange: 'NSE',
        displayName: 'Nifty 50',
        alts: ['NIFTY 50', 'Nifty 50', 'NIFTY_50'],
    },
    {
        key: 'sensex',
        symbol: 'SENSEX',
        exchange: 'BSE',
        displayName: 'Sensex',
        alts: ['Sensex', 'BSE SENSEX', 'SENSEX 30'],
    },
    {
        key: 'bankNifty',
        symbol: 'BANKNIFTY',
        exchange: 'NSE',
        displayName: 'BankNifty',
        alts: ['NIFTY BANK', 'NIFTYBANK', 'Nifty Bank', 'BANK NIFTY'],
    },
];

const formatNumber = (n) => {
    if (!Number.isFinite(n) || n === 0) return '—';
    if (n >= 10000) {
        return n.toLocaleString('en-IN', {
            maximumFractionDigits: 1,
            minimumFractionDigits: 1,
        });
    }
    return n.toFixed(2);
};

const formatChange = (change, prevClose) => {
    if (!Number.isFinite(change) || !Number.isFinite(prevClose) || prevClose === 0) {
        return '';
    }
    const arrow = change >= 0 ? '▲' : '▼';
    const pct = Math.abs((change / prevClose) * 100).toFixed(2);
    return `${arrow} ${Math.abs(change).toFixed(2)} (${pct}%)`;
};

export default function useHomeMarketSummary() {
    const trade = useTrade() || {};
    const { configData, allHoldingsData, getAllHoldings, broker, brokerStatus } = trade;

    // Mirror what `<PortfolioScreen>` does on mount: ensure
    // `allHoldingsData` is populated for the connected broker. The
    // TradeContext `useEffect([userDetails])` already calls
    // `getAllHoldings()` once when user data loads, but the request
    // is fire-and-forget — if it errored or never fired (e.g. user
    // signed in via a path that didn't trigger getUserDeatils), the
    // P&L hero would stay at ₹0.00 forever. Re-fire on mount of any
    // surface using this hook, idempotently.
    useEffect(() => {
        if (
            !allHoldingsData &&
            broker &&
            brokerStatus !== 'Disconnected' &&
            typeof getAllHoldings === 'function'
        ) {
            getAllHoldings().catch(() => {});
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [broker, brokerStatus, !!allHoldingsData]);

    // Live LTPs by primary symbol (and alt fallback). Each entry is the
    // most recent ltp_update payload received via WebSocketManager.
    const [ltps, setLtps] = useState({});
    // Previous-close values keyed by primary symbol — fetched once.
    const [previousClose, setPreviousClose] = useState({});
    // Comparison mode (mirrors legacy MarketIndices.js):
    //   'prevClose' — server returned valid prev-close prices; tickers
    //                 show change vs yesterday's close.
    //   'opening'   — prev-close fetch failed; use the FIRST live LTP per
    //                 index as the baseline so change/% start at 0 and
    //                 grow during the session. Better UX than rendering
    //                 no change indicator at all.
    const [comparisonType, setComparisonType] = useState('prevClose');
    const [openingPrices, setOpeningPrices] = useState({});

    // Subscribe + listen via WebSocketManager. Each index is registered
    // with both its primary symbol and its alts so the LTP arrives
    // regardless of which name the server emits. Mirrors the legacy
    // `<MarketIndices>` flow:
    //   - DO NOT call `WebSocketManager.initialize(...)` — that overwrites
    //     the singleton's `configData` / `userEmail` and breaks every
    //     other subscriber. `websocketInitializer.js` owns the lifecycle.
    //   - Subscribe to every (primary + alt) symbol pair eagerly. The
    //     server emits whichever name it knows; we accept all of them and
    //     normalize back to the canonical symbol.
    useEffect(() => {
        if (!configData) return undefined;
        const ws = WebSocketManager.getInstance();
        if (!ws) return undefined;

        const pairs = [];
        INDICES.forEach((cfg) => {
            pairs.push({ canonicalSymbol: cfg.symbol, name: cfg.symbol, exchange: cfg.exchange });
            cfg.alts.forEach((alt) =>
                pairs.push({ canonicalSymbol: cfg.symbol, name: alt, exchange: cfg.exchange }),
            );
        });

        pairs.forEach(({ canonicalSymbol, name, exchange }) => {
            const cb = ({ ltp }) => {
                const num = Number(ltp);
                if (!Number.isFinite(num) || num <= 0) return;
                setLtps((prev) =>
                    prev[canonicalSymbol] === num
                        ? prev
                        : { ...prev, [canonicalSymbol]: num },
                );
            };
            ws.subscribe(name, exchange, cb);
        });
        // WebSocketManager doesn't expose a per-callback unsubscribe API —
        // the legacy MarketIndices accepts the leak too. The closures are
        // cheap and only fire setLtps; if the consumer unmounts, React
        // will discard the queued state update with no observable effect.
        return undefined;
    }, [configData]);

    // One-shot fetch of previous-close.
    useEffect(() => {
        let cancelled = false;
        const fetchPrev = async () => {
            try {
                const url = `${server.ccxtServer.baseUrl}misc/indices-previous-close`;
                const payload = {
                    symbols: INDICES.map((i) => ({ symbol: i.symbol, exchange: i.exchange })),
                };
                const headers = {
                    'Content-Type': 'application/json',
                    'X-Advisor-Subdomain': getAdvisorSubdomain(),
                    'aq-encrypted-key': generateToken(
                        Config?.REACT_APP_AQ_KEYS,
                        Config?.REACT_APP_AQ_SECRET,
                    ),
                };
                const res = await axios.post(url, payload, { headers, timeout: 8000 });
                if (cancelled) return;
                const data = res?.data?.data;
                if (!data || typeof data !== 'object') {
                    setComparisonType('opening');
                    return;
                }
                const next = {};
                INDICES.forEach((cfg) => {
                    let price = data[cfg.symbol];
                    if (!price) {
                        for (const alt of cfg.alts) {
                            if (data[alt] != null) {
                                price = data[alt];
                                break;
                            }
                        }
                    }
                    const num = Number(price);
                    if (Number.isFinite(num)) next[cfg.symbol] = num;
                });
                if (Object.keys(next).length === 0) {
                    setComparisonType('opening');
                    return;
                }
                setPreviousClose(next);
                setComparisonType('prevClose');
            } catch {
                // Server unreachable / errored — switch to opening-price mode.
                setComparisonType('opening');
            }
        };
        fetchPrev();
        return () => {
            cancelled = true;
        };
    }, []);

    // Snapshot the first LTP per index when comparisonType is 'opening' so
    // we have a stable baseline. Done in an effect rather than inline so
    // re-renders don't keep resetting the baseline to the latest tick.
    useEffect(() => {
        if (comparisonType !== 'opening') return;
        let changed = false;
        const next = { ...openingPrices };
        INDICES.forEach((cfg) => {
            const ltp = ltps[cfg.symbol];
            if (ltp && !next[cfg.symbol]) {
                next[cfg.symbol] = ltp;
                changed = true;
            }
        });
        if (changed) setOpeningPrices(next);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ltps, comparisonType]);

    const tickers = useMemo(() => {
        const rows = INDICES.map((cfg) => {
            const ltp = ltps[cfg.symbol] || 0;
            const base =
                comparisonType === 'prevClose'
                    ? previousClose[cfg.symbol] || 0
                    : openingPrices[cfg.symbol] || 0;
            const change = ltp && base ? ltp - base : 0;
            return {
                name: cfg.displayName,
                value: ltp ? formatNumber(ltp) : '—',
                change: formatChange(change, base),
                dir: change > 0 ? 'up' : change < 0 ? 'down' : 'flat',
                _debug: { ltp, base, comparisonType, symbol: cfg.symbol },
            };
        });
        // Dev-only verification log — prints raw LTP + baseline values for
        // every render of the home header so they can be cross-checked
        // against NSE / BSE / Google Finance live data. Remove once
        // verified. Each line maps 1:1 to a chip on the alphanomy header.
        if (__DEV__) {
            // console.log(
            //     '[Tickers debug]',
            //     rows
            //         .map(
            //             (r) =>
            //                 `${r.name}: ltp=${r._debug.ltp} base=${r._debug.base} cmp=${r._debug.comparisonType}`,
            //         )
            //         .join(' | '),
            // );
        }
        return rows.map(({ _debug, ...rest }) => rest);
    }, [ltps, previousClose, openingPrices, comparisonType]);

    // Portfolio P&L summary — sourced from `TradeContext.allHoldingsData`,
    // the same broker-aggregated holdings doc used by `<PortfolioCard>`
    // and `<PortfolioScreen>`. The shape comes straight from
    // `${ccxtServer}<broker>/all-holdings` (server-side aggregation):
    //   { totalprofitandloss, totalpnlpercentage, totalinvvalue,
    //     totalholdingvalue }
    // Returns all-zero when no broker is connected (allHoldingsData is
    // undefined / shape doesn't match) — matches the "Connect a broker"
    // empty state on the Home P&L hero.
    const pnlSummary = useMemo(() => {
        const h = allHoldingsData;
        if (!h || typeof h !== 'object') {
            return { currentPnl: 0, invested: 0, currentValue: 0, returnsPct: 0 };
        }
        const invested = Number(h.totalinvvalue) || 0;
        const currentValue = Number(h.totalholdingvalue) || 0;
        // Prefer the server-supplied totals (already accounts for any
        // broker-specific reconciliation) over a client-side subtraction;
        // fall back to (currentValue - invested) when the field is absent.
        const serverPnl = Number(h.totalprofitandloss);
        const currentPnl = Number.isFinite(serverPnl)
            ? serverPnl
            : currentValue - invested;
        const serverPct = Number(h.totalpnlpercentage);
        const returnsPct = Number.isFinite(serverPct)
            ? serverPct
            : invested > 0
            ? (currentPnl / invested) * 100
            : 0;
        return { currentPnl, invested, currentValue, returnsPct };
    }, [allHoldingsData]);

    return { tickers, pnlSummary };
}
