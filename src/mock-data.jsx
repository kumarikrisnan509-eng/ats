/* eslint-disable */
/* R11 #3 — Single source of truth for demo / sample data.
   Screens currently hardcode their own arrays; they can migrate to these
   helpers gradually. Everything respects `isDemoMode()` so flipping demo
   off uniformly empties the dataset.

   Usage:
     const holdings = window.MockData.holdings();    // [] when demo is off
     const symbols  = window.MockData.symbols();
     const orders   = window.MockData.orders({ limit: 5 });

   Each helper returns a fresh array — safe to filter/sort downstream.
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

const ifLive = (arr) => {
  if (window.isDemoMode && window.isDemoMode()) return [];
  return arr.slice();
};

const MockData = {
  holdings: () => ifLive(__holdings),
  symbols: () => __symbols.slice(),
  orders: ({ limit, status } = {}) => {
    let r = ifLive(__orders);
    if (status) r = r.filter(o => o.status === status);
    if (limit)  r = r.slice(0, limit);
    return r;
  },
  raw: { holdings: __holdings, symbols: __symbols, orders: __orders },
};

window.MockData = MockData;
