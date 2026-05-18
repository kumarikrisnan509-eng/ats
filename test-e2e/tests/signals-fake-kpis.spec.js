// signals-fake-kpis.spec.js -- T99-T81 regression guard.
// Pre-T-81 the Signals screen showed hardcoded KPI cards:
//   Signals today: 47    (+12 vs yday)
//   Paper → Live rate: 28%  (+4pp)
//   Live accuracy: 71%      (+2pp)
//   Swept to long-term: ₹1,82,500
// All four were demo. T-81 wires 'Signals today' and 'Last scan' to real
// /api/scanner data, and replaces the unbacked KPIs ('Paper → Live rate'
// and 'Swept to long-term') with '—' + honest sub-text. The two strings
// 'Live accuracy' and 'Paper → Live rate' moved to the latter pattern.
//
// We assert the bundled JSX source no longer ships the literal hardcoded values.

const { test, expect } = require('@playwright/test');

test('Signals screen no longer ships hardcoded 47/28%/71%/₹1,82,500 (T-81)', async ({ request }) => {
  // T-172: project uses runtime Babel — frontend file is .jsx, not .js
  const r = await request.get('/src/screen-signals.jsx');
  expect(r.ok()).toBeTruthy();
  const js = await r.text();

  // Old hardcoded KPI values must be gone.
  expect(js).not.toContain('value="47"');
  expect(js).not.toContain('value="28%"');
  expect(js).not.toContain('value="71%"');
  expect(js).not.toContain('inrCompact(182500)');
  expect(js).not.toContain('+12 vs yday');
  expect(js).not.toContain('+4pp');
  expect(js).not.toContain('vs paper');
  expect(js).not.toContain('across 6 sources');

  // New honest sub-text should be present.
  expect(js).toContain('needs promotion ledger');
  expect(js).toContain('needs sweep history endpoint');
});
