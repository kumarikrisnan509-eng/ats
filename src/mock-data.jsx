/* eslint-disable */
/* R11 #3 — Single source of truth for demo / sample data.
   Screens currently hardcode their own arrays; they can migrate to these
   helpers gradually. Everything respects `isDemoMode()` so flipping demo
   off uniformly empties the dataset (so screens see real data from /api).

   Semantics (FIXED 2026-05-13, was inverted):
     - DEMO MODE ON  → returns the mock arrays (shows sample holdings/orders).
     - DEMO MODE OFF → returns [] (screens must fetch from /api/portfolio/* etc).

   Usage:
     const holdings = window.MockData.holdings();    // sample when demo, [] when live
     const symbols  = window.MockData.symbols();     // always returns symbols (cosmetic list)
     const orders   = window.MockData.orders({ limit: 5 });

   Each helper returns a fresh array — safe to filter/sort downstream.

   Companion: window.fetchApi(path) — small helper used by screens to load real data.
*/

const __holdings = [
  { s: "INFY",       qty: 60,   avg: 1843.00, ltp: 1872.55, sector: "IT",       weight: 8.4 },
  { s: "TCS",        qty: 25,   avg: 3920.50, ltp: 3987.20, sector: "IT",       weight: 7.1 },
  { s: "HDFCBANK",   qty: 80,   avg: 1612.30, ltp: 1644.85, sector: "Banking",  weight: 9.2 },
  { s: "RELIANCE",   qty: 40,   avg: 2480.00, ltp: 2521.40, sector: "Energy",   weight: 6.8 },
  { s: "ICICIBANK",  qty: 100,  avg: 1052.10, ltp: 1078.30, sector: "Banking",  weight: 7.5 },
  { s: "SBIN",       qty: 150,  avg: 720.40,  ltp: 731.85,  sector: "Banking",  weight: 4.3 },
  { s: "ASIANPAINT", qty: 30,   avg: 2840.20, ltp: 2812.50, sector: "Consumer", weight: 3.9 },
  { s: "BHARTIARTL", qty: 70,   avg: 1428.60, ltp: 1452.10, sector: "Telecom",  weight: 4.7 },
  { s: "MARUTI",     qty: 15,   avg: 11240.0, ltp: 11385.5, sector: "Auto",     weight: 5.6 },
  { s: "LT",         qty: 35,   avg: 3520.80, ltp: 3548.20, sector: "Infra",    weight: 4.4 },
  { s: "TATAMOTORS", qty: 200,  avg: 845.30,  ltp: 862.40,  sector: "Auto",     weight: 5.1 },
  { s: "BAJFINANCE", qty: 18,   avg: 7250.40, ltp: 7184.20, sector: "Finance",  weight: 4.1 },
];

const __symbols = [
  "INFY","TCS","HDFCBANK","RELIANCE","ICICIBANK","SBIN","ASIANPAINT","BHARTIARTL",
  "MARUTI","LT","TATAMOTORS","BAJFINANCE","WIPRO","ITC","HCLTECH","NESTLEIND",
];

const __orders = [
  { id: "ORD-26042326-001", symbol: "INFY",      side: "BUY",  qty: 60,  price: 1843.00, status: "FILLED",   mode: "intraday", strategy: "Momentum AI" },
  { id: "ORD-26042326-002", symbol: "TCS",       side: "BUY",  qty: 25,  price: 3920.50, status: "FILLED",   mode: "swing",    strategy: "Mean Rev" },
  { id: "ORD-26042326-003", symbol: "RELIANCE",  side: "SELL", qty: 20,  price: 2521.40, status: "PENDING",  mode: "intraday", strategy: "VWAP scalp" },
  { id: "ORD-26042326-004", symbol: "BANKNIFTY", side: "BUY",  qty: 30,  price: 0.00,    status: "REJECTED", mode: "options",  strategy: "IronCondor" },
  { id: "ORD-26042326-005", symbol: "HDFCBANK",  side: "BUY",  qty: 80,  price: 1612.30, status: "FILLED",   mode: "swing",    strategy: "Breakout" },
];

// Default to DEMO ON when the flag is missing, so first-time visitors see populated
// screens instead of blank ones. Production users explicitly toggle demo OFF via
// the trading-modes panel; that empties the mock arrays and screens then fetch real data.
// Tier 55: default flipped from true -> false. In production (real users with
// real broker connections + real DB data) we want fetchApi() to drive every
// screen. The trading-modes panel still toggles demo ON for tours, screenshots,
// and offline previews.
const isDemoOn = () => {
  if (typeof window.isDemoMode === 'function') return !!window.isDemoMode();
  return false;
};

const ifDemo = (arr) => (isDemoOn() ? arr.slice() : []);

const MockData = {
  holdings: () => ifDemo(__holdings),
  symbols: () => __symbols.slice(),
  orders: ({ limit, status } = {}) => {
    let r = ifDemo(__orders);
    if (status) r = r.filter(o => o.status === status);
    if (limit)  r = r.slice(0, limit);
    return r;
  },
  raw: { holdings: __holdings, symbols: __symbols, orders: __orders },
  isDemoOn,
};

window.MockData = MockData;

// ---------- Tiny fetch helper for screens migrating off hardcoded arrays ----------
// Returns parsed JSON or throws. Screens typically wrap with try/catch and fall back
// to MockData.* when isDemoOn().
//
// T99-T79: when the request fails we now attach the server's x-request-id
// header (set by deploy/backend/observability.js middleware) onto the thrown
// Error AND stash it on window._lastRequestId. Callers that catch the error
// can show it in a toast so end-users can paste it for support to grep
// errors_log by request_id.
window.fetchApi = async (path, init = {}) => {
  const res = await fetch(path, { credentials: 'include', ...init });
  // Always remember the latest request id, success or failure -- helps
  // operators correlate a screen state to a backend log entry.
  try {
    const rid = res.headers.get('x-request-id');
    if (rid) window._lastRequestId = rid;
  } catch (e) { console.warn('[mock-data] swallowed:', e && e.message); }
  if (!res.ok) {
    const err = new Error(`${res.status} ${res.statusText}`);
    err.status = res.status;
    err.requestId = (() => { try { return res.headers.get('x-request-id') || null; } catch (_) { return null; } })();
    // Best-effort parse JSON error body for richer messages (the backend's
    // _obsErrorMiddleware returns { ok:false, reason, requestId, detail }).
    try {
      const body = await res.json();
      if (body && body.reason) err.reason = body.reason;
      if (body && body.detail) err.detail = body.detail;
      if (body && body.requestId && !err.requestId) err.requestId = body.requestId;
    } catch (e) { console.warn('[mock-data] swallowed:', e && e.message); }
    throw err;
  }
  return await res.json();
};

// T99-T79: convenience for showing an error toast that includes the server
// request-id (if we have one) so users can quote it when filing support
// reports. Safe to call from anywhere; no-op if window.toast isn't loaded yet.
window.toastError = (title, errOrMsg) => {
  if (!window.toast) return;
  let sub = '';
  let rid = null;
  if (errOrMsg && typeof errOrMsg === 'object') {
    rid = errOrMsg.requestId || errOrMsg.request_id || null;
    sub = errOrMsg.detail || errOrMsg.reason || errOrMsg.message || '';
  } else if (typeof errOrMsg === 'string') {
    sub = errOrMsg;
  }
  if (rid) sub = (sub ? sub + ' · ' : '') + 'req ' + rid.slice(0, 8);
  window.toast({ kind: 'down', title: title || 'Something went wrong', sub: sub || undefined });
};

// T99-T79: format a thrown Error into a string suitable for inline display
// (e.g. setError(formatErr(ex))). Includes the request-id when fetchApi
// attached one so the user can paste it for support.
window.formatErr = (err) => {
  if (!err) return '';
  if (typeof err === 'string') return err;
  const parts = [];
  if (err.detail) parts.push(err.detail);
  else if (err.reason) parts.push(err.reason);
  else if (err.message) parts.push(err.message);
  else parts.push(String(err));
  const rid = err.requestId || err.request_id;
  if (rid) parts.push('(req ' + String(rid).slice(0, 8) + ')');
  return parts.join(' ');
};
