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
// in the shipped /src/*.js bundles. Asserting on the bundle (not on rendered
// DOM) keeps the spec dialect-agnostic (no need for storageState, no flaky
// auth, no live-market dependence) and fast.
//
// When you fix a new hardcoded leak, add the literal fake values here so the
// regression is permanent. Do NOT add legitimate strategy names, ticker enums,
// or category labels -- they will reappear naturally as the backend wires real
// data. Only encode VALUES (₹ amounts, %ages, hardcoded sample arrays) that
// would only exist in committed mock data, never in live broker output.

const { test, expect } = require('@playwright/test');

// --- Per-bundle forbidden literals ---------------------------------------
// Format: file path under /src/ -> array of substrings that must NOT appear.
// Each literal includes a short comment naming the original ticket that found
// it, so when the spec fails it's obvious which regression class fired.

const FORBIDDEN = {

  // -------- screen-strategies (T-350 + T-350d) --------
  'screen-strategies.js': [
    // T-350: STRATEGY_CATALOG fallback flash (18 strategies · ₹24.0L · +₹1,10,830)
    'window.STRATEGY_CATALOG || []',
    'STRATEGY_CATALOG || []',
    // T-350d: monthly returns heatmap rows (Momentum AI / Mean Rev / Grid Trader)
    '[2.1, 3.4, -1.2, 4.8, 2.6, 3.1, 5.2, 4.1, 3.8]',
    '[1.6, 2.8, 2.1, -0.8, 3.4, 2.2, 2.9, 3.6, 2.4]',
    '[-0.4, 1.2, -2.1, 0.8, 1.4, -1.8, 0.6, -1.2, -0.8]',
  ],

  // -------- screen-risk (T-353b) --------
  'screen-risk.js': [
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

  // -------- screen-signals (T-344 + T-353c) --------
  'screen-signals.js': [
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
    // T-81 / T-99 original demo KPIs (kept from signals-fake-kpis.spec.js for one source-of-truth)
    'value="47"',
    'value="28%"',
    'value="71%"',
    'inrCompact(182500)',
  ],

  // -------- screen-money (T-353d) --------
  'screen-money.js': [
    // MPT seeded with 3 fake assets
    "symbol: 'NIFTYBEES', expectedReturnPct: 12",
    "symbol: 'GOLDBEES',  expectedReturnPct: 8",
    "symbol: 'BOND-G7',   expectedReturnPct: 7",
  ],

  // -------- screen-dashboard (T-353a) --------
  'screen-dashboard.js': [
    // Watchlist seed prices (T-353a)
    'p: 2948.50',
    'p: 4120.10',
    'p: 1712.80',
    'p: 1876.25',
    'p: 7250.00',
    'p: 3784.65',
    'p:  884.40',
  ],

  // -------- trading-modes (T-351) --------
  // MODE_META.strategies fake per-strategy P&L / win-rate / trades.
  // The strategy names remain as a static catalog (legitimate), but no
  // numeric metric should ship from the committed mock.
  'trading-modes.js': [
    'pnl30:  42340',
    'pnl30:  31200',
    'pnl30:  -4820',
    'pnl30:   2140',
    'pnl30: 18940',
    'pnl30:  6210',
    'pnl30:  3420',
    'pnl30: 8420',
    'pnl30: -1820',
    'pnl30: 1840',
    'winR: 68',
    'winR: 61',
    'winR: 72',
    'cap: 800000, alloc: 28',
    'cap: 600000, alloc: 21',
    'cap: 500000, alloc: 18',
  ],
};

test.describe('bundled JS must not ship known fake-data literals', () => {

  for (const [bundle, literals] of Object.entries(FORBIDDEN)) {
    test(`/src/${bundle} -- no committed fake literals`, async ({ request }) => {
      const r = await request.get(`/src/${bundle}`);
      // 200 expected; 304/404 means deploy mismatch -- fail loudly.
      expect(r.status(), `/src/${bundle} not reachable -- deploy issue?`).toBe(200);
      const js = await r.text();

      const offenders = literals.filter(lit => js.includes(lit));
      if (offenders.length > 0) {
        // Build a human-readable failure that names every regressed literal.
        const lines = offenders.map(l => `  - ${l}`).join('\n');
        throw new Error(
          `${bundle} re-shipped ${offenders.length} forbidden fake literal(s):\n${lines}\n\n` +
          `These were removed in T-350..T-354 because they rendered fake business data\n` +
          `(prices, P&L, strategy caps, hardcoded sample rows) to production users.\n` +
          `If the data is real now, push it through the backend instead of inlining it.`
        );
      }
    });
  }

});
