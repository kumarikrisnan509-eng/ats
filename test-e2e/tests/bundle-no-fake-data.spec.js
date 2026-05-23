// bundle-no-fake-data.spec.js -- T-354
//
// Source-of-truth CI gate against the "claimed-fix-that-wasn't-real" pattern.
// Between T-342 and T-350d we found four commits whose messages said they
// gated hardcoded fake data but whose JSX was never touched. This spec
// reads the .jsx source from disk and asserts that specific forbidden
// literals (P&L amounts, win-rates, fake sample row arrays) do not appear.
// Reading from disk avoids the chicken-and-egg where the spec runs against
// the deployed bundle BEFORE the new bundle deploys.
//
// Add new literals to FORBIDDEN whenever you fix a new hardcoded leak.
// Only encode VALUES (numbers, exact row arrays) -- not strategy names or
// ticker enums, which will legitimately reappear when backend wires them.

const { test } = require('@playwright/test');
const fs   = require('fs');
const path = require('path');

const SRC_DIR = path.resolve(__dirname, '..', '..', 'src');

const FORBIDDEN = {
  'screen-strategies.jsx': [
    'window.STRATEGY_CATALOG || []',
    '[2.1, 3.4, -1.2, 4.8, 2.6, 3.1, 5.2, 4.1, 3.8]',
    '[1.6, 2.8, 2.1, -0.8, 3.4, 2.2, 2.9, 3.6, 2.4]',
    '[-0.4, 1.2, -2.1, 0.8, 1.4, -1.8, 0.6, -1.2, -0.8]',
  ],
  'screen-risk.jsx': [
    'lossUsed: 2840',
    'lossUsed: 1180',
    'lossUsed: 3120',
    'deployed:  840000',
    'deployed: 1120000',
    'deployed:  380000',
    'val: "₹15,000"',
    'val: "₹3,00,000"',
    'val: "3.0x"',
    'val: "15 min"',
    'val: "₹1,00,000"',
    'cap: 800000, sl: 8000',
    'cap: 600000, sl: 6000',
    'cap: 400000, sl: 4000',
  ],
  'screen-signals.jsx': [
    'sym: "NIFTY 22600 PE"',
    'sym: "GOLD MCX"',
    'sym: "USDINR FUT"',
    'sym: "NIFTY 22550 CE"',
    'pnl: "+₹1,995"',
    'pnl: "+₹2,227"',
    'realized: 4210',
    'realized: 2840',
    'realized: 7540',
  ],
  'screen-money.jsx': [
    "symbol: 'NIFTYBEES', expectedReturnPct: 12",
    "symbol: 'GOLDBEES',  expectedReturnPct: 8",
    "symbol: 'BOND-G7',   expectedReturnPct: 7",
  ],
  'screen-dashboard.jsx': [
    'p: 2948.50',
    'p: 4120.10',
    'p: 1712.80',
    'p: 1876.25',
    'p: 7250.00',
    'p: 3784.65',
    'p:  884.40',
  ],
  'trading-modes.jsx': [
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

test.describe('committed source must not ship known fake-data literals', () => {
  for (const file of Object.keys(FORBIDDEN)) {
    test('src/' + file + ' -- no committed fake literals', async () => {
      const abs = path.join(SRC_DIR, file);
      const src = fs.readFileSync(abs, 'utf8');
      const offenders = FORBIDDEN[file].filter(function (lit) { return src.indexOf(lit) !== -1; });
      if (offenders.length > 0) {
        const lines = offenders.map(function (l) { return '  - ' + l; }).join('\n');
        const m1 = 'src/' + file + ' re-shipped ' + offenders.length + ' forbidden fake literal(s):\n' + lines + '\n\n';
        const m2 = 'These were removed in T-350..T-354 because they rendered fake business data to production users.\n';
        const m3 = 'If the data is real now, push it through the backend instead of inlining it.\n';
        throw new Error(m1 + m2 + m3);
      }
    });
  }
});
