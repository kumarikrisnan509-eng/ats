// visual-rendering.spec.js -- Phase C + T-322d
//
// Goes beyond smoke.spec.js (which only checks "console didn't error and #root
// has children") to catch the rendering bug class that types alone can't:
//
//   1. {r.regime} when r.regime is { label, confidence }  ->  [object Object]
//   2. Number(r.tradeCount) when field is r.trades        ->  NaN
//   3. setData(undefined); render data.foo                ->  undefined
//   4. screen throws -> ErrorBoundary catches -> "Something broke" UI shown
//      (T-322d: the T-322c bug class -- screen-attribution rendering an
//       object as React child -- slipped through the prior version of this
//       spec because the boundary catches the throw before [object Object]
//       reaches the DOM. We now also assert the boundary's signature phrase
//       does not appear on any route.)
//
// React happily renders any value as a child (because in our globals.d.ts
// React: any, and JSX children are unchecked). The shape-mismatch typedefs
// in api-shapes.d.ts catch most of these at the field-access level, but
// indirect paths (helper that returns the wrong shape, default value via
// ||, ternary that picks an object) can still leak through. This spec is
// the last-line visual gate.
//
// T-322d: auth-gated routes only render their real content when logged in;
// running anonymously just exercises the login screen and silently weakens
// coverage. We now opt in to the storageState fixture global-setup.js wrote
// (same one visual-snapshots.spec.js uses), and skip the spec entirely if
// the fixture is empty -- because that means we'd be testing login again.
//
// For each route, after the screen mounts:
//   * Wait for React to be done flushing
//   * Read all visible text from #root
//   * Assert no "[object Object]" / leaked NaN / leaked undefined
//   * Assert no ErrorBoundary signature phrase
//   * Assert the rendered text isn't trivially small

const { test, expect } = require('@playwright/test');
const path = require('path');
const fs   = require('fs');

const AUTH_FILE = path.resolve(__dirname, '..', 'playwright/.auth/user.json');

function hasAuthCookies() {
  try {
    const j = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
    return Array.isArray(j.cookies) && j.cookies.length > 0;
  } catch { return false; }
}

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

// Auth-gated by storageState. If global-setup.js wasn't able to log in
// (e.g. PR from a fork without secrets access), every spec here skips
// rather than silently degrading to "login screen passes all assertions".
test.describe('visual rendering (auth-gated)', () => {
  test.use({ storageState: AUTH_FILE });

for (const route of ROUTES) {
  test(`route ${route} -- no [object Object] / leaked NaN / undefined / ErrorBoundary in rendered output`, async ({ page }) => {
    test.skip(!hasAuthCookies(),
      'No auth cookies in fixture -- visual-rendering would only exercise the login screen.');

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

    // 4. T-322d: ErrorBoundary catch. The boundary at src/r8-primitives.js
    //    swallows a screen's render-time throw and shows
    //      "Something broke on this screen"
    //      "The error has been logged. Your positions and orders are unaffected..."
    //      "<error.message>"
    //    The T-322c regression (screen-attribution rendering r.regime as
    //    a React child) hit this exact path -- but visual-rendering passed
    //    because [object Object] never reached the DOM. The boundary
    //    intercepted before React could flush the bad subtree.
    //    Catch this class explicitly by asserting the signature phrase
    //    doesn't appear. (If a future screen *intentionally* needs that
    //    phrase, this assertion is the trigger to refactor it.)
    if (text.includes('Something broke on this screen')) {
      // Surface the inner error message so the failure is debuggable.
      const m = text.match(/Something broke on this screen[\s\S]{0,400}/);
      expect.fail(`${route} hit the ErrorBoundary. Excerpt:\n${m ? m[0] : '(no detail)'}\n`);
    }

    // 5. The screen must actually have rendered some non-empty UI. Catches
    //    the bare-error-screen case where loadFailed === true and we show
    //    only "Error" with no further info.
    const trimmed = text.trim();
    expect(trimmed.length, `${route} rendered an empty or tiny page (${trimmed.length} chars)`)
      .toBeGreaterThan(30);
  });
}

}); // end describe('visual rendering (auth-gated)')
