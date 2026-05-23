// bundle-no-fake-data.spec.js -- T-354
//
// CI gate against the "claimed-fix-that-wasn't-real" regression class.
// Between T-342 and T-350d we found FOUR separate commits whose messages
// described gating hardcoded fake data but whose JSX was never actually
// modified:
//   * T-342 said it gated risk.jsx Global limits + Per-strategy caps -- didn't.
//   * T-344 said it gated signals.jsx 5-stage pipeline -- didn't.
//   * T-346 said it gated dashboard __seedSymbols + strategies heatmap -- didn't.
//   * T-349 said it created prod-readiness.spec.js -- file never existed.
//
// This spec encodes the values that WERE leaking and now must never reappear
// in committed source. It reads the .jsx source files from DISK (not the
// deployed bundle via HTTP), which has two benefits:
//   * No chicken-and-egg in CI: spec asserts on what's about to ship, not on
//     what's currently deployed. CI on a fixed branch keeps passing as the
//     deploy itself updates the live bundle.
//   * Catches regressions at the source-of-truth level. JSX-to-JS transpile
//     doesn't transform numeric literals, so a leak in .jsx == a leak in .js.
//
// To add new prohibited literals (when fixing future leaks), append to the
// FORBIDDEN map. Each literal needs a ticket-prefixed comment so spec
// failures are debuggable. Only encode VALUES (₹ amounts, %ages, exact row
// arrays, hardcoded sample inputs) -- not strategy names, ticker enums, or
// category labels, which will legitimately reappear when backend wires them.

const { test, expect } = require('@playwright/test');
const fs   = require('fs');
const path = require('path');

const SRC_DIR = path.resolve(__dirname, '..', '..', 'src');

// --- Per-source-file forbidden literals ----------------------------------
// Format: file path under src/ -> array of substrings that must NOT appear.

const FORBIDDEN = {

  // -------- screen-strategies.jsx (T-350 + T-350d) --------
  'screen-strategies.jsx': [
    // T-350: STRATEGY_CATALOG fallback flash (18 strategies · ₹24.0L · +₹1,10,830)
    'window.STRATEGY_CATALOG || []',
    // T-350d: monthly returns heatmap rows (Momentum AI / Mean Rev / Grid Trader)
    '[2.1, 3.4, -1.2, 4.8, 2.6, 3.1, 5.2, 4.1, 3.8]',
    '[1.6, 2.8, 2.1, -0.8, 3.4, 2.2, 2.9, 3.6, 2.4]',
    '[-0.4, 1.2, -2.1, 0.8, 1.4, -1.8, 0.6, -1.2, -0.8]',
  ],

  // -------- screen-risk.jsx (T-353b) --------
  'screen-risk.jsx': [
    // Per-mode hardcoded rows
    'lossUsed: 2840',
    'lossUsed: 1180',
    'lossUsed: 3120',
    'deployed:  840000',
    'deployed: 1120000',
    'deployed:  380000',
    // Global limits literal copy
    'val: "₹15,000"',
    'val: "₹3,00,000"',
    'val: "3.0x"',
    'val: "15 min"',
    'val: "₹1,00,000"',
    // Per-strategy caps
    'cap: 800000, sl: 8000',  // Momentum AI fake cap
    'cap: 600000, sl: 6000',  // Mean Reversion v2 fake cap
    'cap: 400000, sl: 4000',  // Grid Trader fake cap
  ],

  // -------- screen-signals.jsx (T-344 + T-353c) --------
  'screen-signals.jsx': [
    // 5-stage pipeline hardcoded cards (T-353c)
    'sym: "NIFTY 22600 PE"',
    'sym: "GOLD MCX"',
    'sym: "USDINR FUT"',
    'sym: "NIFTY 22550 CE"',
    'pnl: "+₹1,995"',
    'pnl: "+₹2,227"',
    'realized: 4210',  // TITAN
    'realized: 2840',  // BAJFINANCE
    'realized: 7540',  // NIFTY PE
  ],

  // -------- screen-money.jsx (T-353d) --------
  'screen-money.jsx': [
    // MPT seeded with 3 fake assets
    "symbol: 'NIFTYBEES', expectedReturnPct: 12",
    "symbol: 'GOLDBEES',  expectedReturnPct: 8",
    "symbol: 'BOND-G7',   expectedReturnPct: 7",
  ],

  // -------- screen-dashboard.jsx (T-353a) --------
  'screen-dashboard.jsx': [
    // Watchlist seed prices (T-353a)
    'p: 2948.50',
    'p: 4120.10',
    'p: 1712.80',
    'p: 1876.25',
    'p: 7250.00',
    'p: 3784.65',
    'p:  884.40',
  ],

  // -------- trading-modes.jsx (T-351) --------
  // MODE_META.strategies fake per-strategy P&L / win-rate / trades.
  // The strategy names remain as a static catalog (legitimate), but no
  // numeric metric should ship from the committed mock.
  'trading-modes.jsx': [
    // pnl30 values from the 18 hardcoded strategies
    'pnl30:  42340',  // Momentum AI
    'pnl30:  31200',  // Mean Reversion v2
    'pnl30:  -4820',  // Grid Trader
    'pnl30:   2140',  // Breakout Scalper
    'pnl30: 18940',   // Trend Follow
    'pnl30:  6210',   // Sector Rotator
    'pnl30:  3420',   // Breakout Swing
    'pnl30: 8420',    // Iron Condor Weekly
    'pnl30: -1820',   // PE Hedge
    'pnl30:  2140',   // Covered Call
    'pnl30: 1840',    // Stock Futures Momentum
    // winR / sharpe / trades / cap+alloc combinations
    'winR: 68',
    'winR: 61',
    'winR: 72',
    'cap: 800000, alloc: 28',
    'cap: 600000, alloc: 21',
    'cap: 500000, alloc: 18',
  ],
};

test.describe('committed source must not ship known fake-data literals', () => {

  for (const [file, literals] of Object.entries(FORBIDDEN)) {
    test(`src/${file} -- no committed fake literals`, async () => {
      const abs = path.join(SRC_DIR, file);
      const src = fs.readFileSync(abs, 'utf8');

      const offenders = literals.filter(lit => src.includes(lit));
      if (offenders.length > 0) {
        const lines = offenders.map(l => `  - ${l}`).join('\n');
        throw new Error(
          `src/${file} re-shipped ${offenders.length} forbidden fake literal(s):\n${lines}\n\n` +
          `These were removed in T-350..T-354 because they rendered fake business data\n` +
          `(prices, P&L, strategy caps, har