// visual-rendering.spec.js -- Phase C
//
// Goes beyond smoke.spec.js (which only checks "console didn't error and #root
// has children") to catch the rendering bug class that types alone can't:
//
//   1. {r.regime} when r.regime is { label, confidence }  ->  [object Object]
//   2. Number(r.tradeCount) when field is r.trades        ->  NaN
//   3. setData(undefined); render data.foo                ->  undefined
//
// React happily renders any value as a child (because in our globals.d.ts
// React: any, and JSX children are unchecked). The shape-mismatch typedefs
// in api-shapes.d.ts catch most of these at the field-access level, but
// indirect paths (helper that returns the wrong shape, default value via
// ||, ternary that picks an object) can still leak through. This spec is
// the last-line visual gate.
//
// For each of the 32 known routes, after the screen mounts:
//   * Wait for React to be done flushing
//   * Read all visible text from #root
//   * Assert the visible text does NOT contain "[object Object]"
//   * Assert the visible text does NOT contain " NaN" (with leading space,
//     to allow legitimate words like "FINANCIAL" or "BANANA")
//   * Assert the visible text does NOT contain the literal string "undefined"
//     in a position that suggests it's a leaked value (after ":" or "=")

const { test, expect } = require('@playwright/test');

const ROUTES = [
  '#dashboard', '#settings', '#risk', '#compliance',
  '#modes', '#strategies', '#signals',
  '#trading', '#audit', '#margin',
  '#paper',
  '#portfolio', '#stpswp',
  '#brokers', '#money', '#longterm', '#insights',
  '#recon', '#attribution', '#review', '#ai-keys',
  // T-311 / T-312 new screens
  '#daily-attribution', '#slippage', '#walk-forward',
  '#macro-signals', '#options-ops', '#calibration',
  '#sip', '#options-opportunities',
];

const POISON_STRINGS = [
  '[object Object]',          // React rendered an object as a child
  '[object Array]',           // same, less common
  '[object Promise]',         // someone forgot to await
  '[object Window]',          // window leaked into a render
];

// "NaN" tolerated as part of words like NORMAN, BANANA, FINNAN. Require it to
// follow a non-letter on the left or be preceded by ": " / "= " / a digit.
const NAN_PATTERN = /(?:^|[\s:=,\(\[<>%₹$+\-])NaN(?=[\s,\.\)\]<>%]|$)/;

// "undefined" likewise -- the literal "Cannot read prop ... of undefined" in
// an error message is fine. The bug we want is something like "Price: undefined"
// or "Status = undefined".
const UNDEFINED_LEAKED_PATTERN = /(?::\s*undefined\b|=\s*undefined\b|>\s*undefined\s*<)/;

for (const route of ROUTES) {
  test(`route ${route} -- no [object Object] / leaked NaN / undefined in rendered output`, async ({ page }) => {
    // Suppress console-error reporting clutter; smoke.spec already covers it.
    page.on('console', () => {});
    page.on('pageerror', () => {});

    await page.goto(`/${route}`, { waitUntil: 'networkidle' });

    // Wait for React to flush + the screen's mount-effect fetches to settle.
    // 1200ms covers our typical fetch-then-render path on prod with cold caches.
    await page.waitForTimeout(1200);

    // Pull the rendered visible text from #root.
    const text = await page.evaluate(() => {
      const root = document.getElementById('root');
      if (!root) return '';
      // innerText respects visibility rules (display:none excluded). Plenty
      // for what we want -- we're not testing accessibility, we're testing
      // that no garbage value reaches the DOM.
      return /** @type {HTMLElement} */ (root).innerText || '';
    });

    // 1. [object Object] etc.
    for (const poison of POISON_STRINGS) {
      expect(text, `${route} rendered "${poison}" -- a non-primitive leaked into JSX children`)
        .not.toContain(poison);
    }

    // 2. NaN in a position that looks like a leaked value
    const nanMatch = text.match(NAN_PATTERN);
    if (nanMatch) {
      // Surface 60 chars of surrounding context so the failure message is useful
      const i = text.indexOf(nanMatch[0]);
      const ctx = text.slice(Math.max(0, i - 30), Math.min(text.length, i + 30));
      expect.fail(`${route} rendered leaked NaN. Context: "...${ctx}..."`);
    }

    // 3. literal "undefined" in a value position
    const undefMatch = text.match(UNDEFINED_LEAKED_PATTERN);
    if (undefMatch) {
      const i = text.indexOf(undefMatch[0]);
      const ctx = text.slice(Math.max(0, i - 30), Math.min(text.length, i + 30));
      expect.fail(`${route} rendered leaked undefined. Context: "...${ctx}..."`);
    }

    // 4. The screen must actually have rendered some non-empty UI. Catches
    //    the bare-error-screen case where loadFailed === true and we show
    //    only "Error" with no further info.
    const trimmed = text.trim();
    expect(trimmed.length, `${route} rendered an empty or tiny page (${trimmed.length} chars)`)
      .toBeGreaterThan(30);
  });
}
