/* eslint-disable */
/* Market data — single source of truth.
   Everything that would come from the broker in production is centralized here,
   so swapping Zerodha → Upstox is a single file change.
   Labeled with the exact Kite endpoint it would be fetched from. */

// ============ Today's IST date — everything derives from this ============
const istNow = () => {
  // Convert to IST regardless of user timezone
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + 5.5 * 3600 * 1000);
};

const TODAY = istNow();
const TODAY_STR = TODAY.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); // "24 Apr 2026"
const TODAY_SHORT = TODAY.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });                 // "24 Apr"
const TODAY_ISO = TODAY.toISOString().slice(0, 10);
const FY = TODAY.getMonth() >= 3 ? `${TODAY.getFullYear()}-${(TODAY.getFullYear()+1).toString().slice(2)}`
                                  : `${TODAY.getFullYear()-1}-${TODAY.getFullYear().toString().slice(2)}`;

const daysAgo = (n) => {
  const d = new Date(TODAY.getTime() - n * 86400000);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
};
const fmtTime = (h, m) => `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;

// ============ NSE 2026 holiday calendar (would come from Zerodha /holidays) ============
// Ref: Kite → /instruments/holidays  · static list of official NSE trading holidays for 2026
const NSE_HOLIDAYS_2026 = [
  { date: "2026-01-26", name: "Republic Day" },
  { date: "2026-02-19", name: "Mahashivratri" },
  { date: "2026-03-06", name: "Holi" },
  { date: "2026-03-31", name: "Id-Ul-Fitr (Ramzan)" },
  { date: "2026-04-03", name: "Good Friday" },
  { date: "2026-04-14", name: "Dr. Ambedkar Jayanti" },
  { date: "2026-05-01", name: "Maharashtra Day" },
  { date: "2026-05-27", name: "Id-Ul-Zuha (Bakri Id)" },
  { date: "2026-06-26", name: "Muharram" },
  { date: "2026-08-15", name: "Independence Day" },
  { date: "2026-08-26", name: "Ganesh Chaturthi" },
  { date: "2026-10-02", name: "Gandhi Jayanti" },
  { date: "2026-10-20", name: "Diwali Laxmi Pujan" }, // muhurat trading
  { date: "2026-10-21", name: "Balipratipada" },
  { date: "2026-11-25", name: "Guru Nanak Jayanti" },
  { date: "2026-12-25", name: "Christmas" },
];
// Tier 71: holidays now come from /api/market/holidays (cached from Kite). The static
// array stays as a cold-start fallback only.
let _holidaysCache = NSE_HOLIDAYS_2026;
let _holidaysLoaded = false;
async function _loadHolidays() {
  if (_holidaysLoaded) return;
  try {
    const r = await fetch('/api/market/holidays');
    if (r.ok) {
      const j = await r.json();
      if (j && j.ok && Array.isArray(j.holidays) && j.holidays.length) {
        _holidaysCache = j.holidays;
      }
    }
  } catch (e) { console.warn('[market-data] swallowed:', e && e.message); }
  _holidaysLoaded = true;
}
if (typeof window !== 'undefined') _loadHolidays();
const isHolidayToday = () => _holidaysCache.find(h => h.date === TODAY_ISO);
const nextHoliday = () => {
  const fut = _holidaysCache.filter(h => h.date >= TODAY_ISO);
  return fut[0] || null;
};

// ============ Market hours — respects holidays ============
// Normal session: 09:15 – 15:30 IST, Mon–Fri.
// Pre-open: 09:00–09:15. Post-close: 15:40–16:00.
const marketStatus = () => {
  const hol = isHolidayToday();
  const day = TODAY.getDay();
  const mins = TODAY.getHours() * 60 + TODAY.getMinutes();
  if (day === 0 || day === 6) return { open: false, reason: "weekend", label: "Closed · Weekend" };
  if (hol)                     return { open: false, reason: "holiday", label: `Closed · ${hol.name}` };
  if (mins < 9 * 60)           return { open: false, reason: "pre-market", label: "Pre-market" };
  if (mins < 9 * 60 + 15)      return { open: false, reason: "pre-open", label: "Pre-open auction" };
  if (mins <= 15 * 60 + 30)    return { open: true,  reason: "regular",  label: "Open" };
  if (mins <= 16 * 60)         return { open: false, reason: "post-close", label: "Post-close" };
  return { open: false, reason: "closed", label: "Closed" };
};

// ============ Instrument master (would come from Zerodha /instruments) ============
// Refreshed daily at 06:00 IST. Lot sizes and tick sizes are from NSE's F&O master.
const INSTRUMENTS = {
  // NSE cash equity (tick 0.05, lot 1)
  "RELIANCE":   { seg: "NSE",  lot: 1,    tick: 0.05, isin: "INE002A01018", fno_lot: 250 },
  "HDFCBANK":   { seg: "NSE",  lot: 1,    tick: 0.05, isin: "INE040A01034", fno_lot: 550 },
  "TCS":        { seg: "NSE",  lot: 1,    tick: 0.05, isin: "INE467B01029", fno_lot: 175 },
  "INFY":       { seg: "NSE",  lot: 1,    tick: 0.05, isin: "INE009A01021", fno_lot: 400 },
  "TATASTEEL":  { seg: "NSE",  lot: 1,    tick: 0.05, isin: "INE081A01020", fno_lot: 5500 },
  "SBIN":       { seg: "NSE",  lot: 1,    tick: 0.05, isin: "INE062A01020", fno_lot: 750 },
  "ICICIBANK":  { seg: "NSE",  lot: 1,    tick: 0.05, isin: "INE090A01021", fno_lot: 1375 },
  "AXISBANK":   { seg: "NSE",  lot: 1,    tick: 0.05, isin: "INE238A01034", fno_lot: 625 },
  "BAJFINANCE": { seg: "NSE",  lot: 1,    tick: 0.05, isin: "INE296A01024", fno_lot: 125 },
  "WIPRO":      { seg: "NSE",  lot: 1,    tick: 0.05, isin: "INE075A01022", fno_lot: 3000 },

  // Index F&O (tick 0.05, lot per NSE circular)
  "NIFTY":      { seg: "NFO",  lot: 75,   tick: 0.05, kind: "INDEX_FNO" },
  "BANKNIFTY":  { seg: "NFO",  lot: 30,   tick: 0.05, kind: "INDEX_FNO" },
  "FINNIFTY":   { seg: "NFO",  lot: 65,   tick: 0.05, kind: "INDEX_FNO" },
  "MIDCPNIFTY": { seg: "NFO",  lot: 140,  tick: 0.05, kind: "INDEX_FNO" },
  "SENSEX":     { seg: "BFO",  lot: 20,   tick: 0.05, kind: "INDEX_FNO" },

  // MCX
  "GOLD":       { seg: "MCX",  lot: 100,  tick: 1.0,  kind: "COMMODITY" },
  "SILVER":     { seg: "MCX",  lot: 30,   tick: 1.0,  kind: "COMMODITY" },
  "CRUDEOIL":   { seg: "MCX",  lot: 100,  tick: 1.0,  kind: "COMMODITY" },
};
const lotOf = (sym, mode = "EQ") => {
  const i = INSTRUMENTS[sym];
  if (!i) return 1;
  if (mode === "FNO" && i.fno_lot) return i.fno_lot;
  return i.lot;
};

// ============ Broker-sourced fields registry ============
// Every row is a field the platform shows + where it comes from.
// Used by the Dashboard / Infra 'Data lineage' card and by onboarding audit.
const BROKER_SOURCES = [
  { field: "Live ticks",           endpoint: "Kite WebSocket v3",     freq: "Streaming", cache: "Redis pub/sub" },
  { field: "Market depth (L5)",    endpoint: "Kite WebSocket v3",     freq: "Streaming", cache: "Redis" },
  { field: "Historical candles",   endpoint: "Kite /instruments/historical", freq: "On demand", cache: "Postgres + Timescale" },
  { field: "Instrument master",    endpoint: "Kite /instruments",     freq: "Daily 06:00 IST", cache: "Postgres" },
  { field: "Lot sizes / tick",     endpoint: "Kite /instruments",     freq: "Daily 06:00 IST", cache: "Postgres" },
  { field: "Trading holidays",     endpoint: "Kite /market/holidays", freq: "Daily 06:00 IST", cache: "Postgres" },
  { field: "Corporate actions",    endpoint: "Kite /instruments/corpactions", freq: "Daily 06:00 IST", cache: "Postgres" },
  { field: "Positions (net/day)",  endpoint: "Kite /portfolio/positions", freq: "5s poll",   cache: "Redis" },
  { field: "Holdings",             endpoint: "Kite /portfolio/holdings",  freq: "On trade",  cache: "Redis" },
  { field: "Margins (SPAN + exp)", endpoint: "Kite /user/margins",        freq: "On order",  cache: "Redis 10s TTL" },
  { field: "Order margin preview", endpoint: "Kite /margins/orders",      freq: "Per order", cache: "—" },
  { field: "Order book / trades",  endpoint: "Kite /orders + /trades",    freq: "5s poll",   cache: "Postgres" },
  { field: "GTT orders",           endpoint: "Kite /gtt/triggers",        freq: "On change", cache: "Postgres" },
  { field: "MF orders + SIPs",     endpoint: "Kite MF API",               freq: "Daily",     cache: "Postgres" },
  { field: "Algo-ID (exchange)",   endpoint: "Kite order response",       freq: "On placement", cache: "S3 immutable" },
];

Object.assign(window, {
  TODAY, TODAY_STR, TODAY_SHORT, TODAY_ISO, FY, daysAgo, fmtTime, istNow,
  NSE_HOLIDAYS_2026, isHolidayToday, nextHoliday, marketStatus,
  INSTRUMENTS, lotOf, BROKER_SOURCES,
});
