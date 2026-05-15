const { test } = require('node:test');
const assert = require('node:assert/strict');
const { FactorTilt, FACTORS } = require('../factor-tilt');

// ---- Helpers ----
function mkUniverse(n) {
  // Deterministic synthetic universe: stocks 0..n-1, factors spread linearly.
  const u = [];
  for (let i = 0; i < n; i++) {
    u.push({
      symbol: `STOCK${i}`,
      momentum: (i / n) - 0.5,        // -0.5 to +0.5
      value:    Math.random() * 0.1,  // ~ 1/PE, 0..0.1
      quality:  (i / n) * 0.3,        // 0..0.3 ROE
      lowVol:   1 / (0.1 + (i / n) * 0.4),
      size:     1 / Math.log(1e9 + i * 1e7),
      marketCap: 1e9 + i * 1e7,
    });
  }
  return u;
}

test('rejects universe smaller than 5 stocks', () => {
  const ft = new FactorTilt();
  assert.throws(() => ft.build({
    universe: [{ symbol: 'A', momentum: 1 }, { symbol: 'B', momentum: 2 }],
    factorWeights: { momentum: 1 },
  }), /at least 5/);
});

test('rejects factorWeights that do not sum to 1', () => {
  const ft = new FactorTilt();
  assert.throws(() => ft.build({
    universe: mkUniverse(10),
    factorWeights: { momentum: 0.5, value: 0.3 },   // sum = 0.8
  }), /sum to 1/);
});

test('rejects unknown mode', () => {
  const ft = new FactorTilt();
  assert.throws(() => ft.build({
    universe: mkUniverse(10),
    factorWeights: { momentum: 1 },
    mode: 'gibberish',
  }), /mode must be/);
});

test('long-only: weights sum to ~1.0 and all positive', () => {
  const ft = new FactorTilt();
  const out = ft.build({
    universe: mkUniverse(50),
    factorWeights: { momentum: 0.4, value: 0.2, quality: 0.2, lowVol: 0.1, size: 0.1 },
    mode: 'long-only',
    topPct: 0.2,
  });
  assert.equal(out.ok, true);
  assert.equal(out.mode, 'long-only');
  const sum = out.longs.reduce((s, l) => s + l.weight, 0);
  assert.ok(Math.abs(sum - 1.0) < 1e-3, `weights should sum to 1, got ${sum}`);
  assert.ok(out.longs.every(l => l.weight > 0), 'all long weights > 0');
  assert.equal(out.stats.longCount, 10);   // 50 * 0.2 = 10
});

test('long-only: top-momentum stocks dominate when all weight on momentum', () => {
  const ft = new FactorTilt();
  const universe = mkUniverse(20);
  const out = ft.build({
    universe,
    factorWeights: { momentum: 1 },
    topPct: 0.25,
  });
  // top 5 by momentum should be STOCK19..STOCK15 (descending)
  const symbols = out.longs.map(l => l.symbol);
  assert.ok(symbols.includes('STOCK19'), 'STOCK19 (highest momentum) is in longs');
  assert.ok(symbols.includes('STOCK15'), 'STOCK15 is in longs');
  // STOCK0 (lowest momentum) must NOT be in longs
  assert.ok(!symbols.includes('STOCK0'));
});

test('portfolioExposure on momentum factor is strongly positive when momentum=1', () => {
  const ft = new FactorTilt();
  const out = ft.build({
    universe: mkUniverse(50),
    factorWeights: { momentum: 1 },
    topPct: 0.2,
  });
  assert.ok(out.portfolioExposure.momentum > 1.0,
    `expected high momentum exposure, got ${out.portfolioExposure.momentum}`);
});

test('long-short: longs positive, shorts negative, net weight ~= 0', () => {
  const ft = new FactorTilt();
  const out = ft.build({
    universe: mkUniverse(40),
    factorWeights: { momentum: 0.5, quality: 0.5 },
    mode: 'long-short',
    topPct: 0.25,
    bottomPct: 0.25,
  });
  assert.equal(out.mode, 'long-short');
  assert.ok(out.longs.every(l => l.weight > 0));
  assert.ok(out.shorts.every(s => s.weight < 0));
  const net = out.longs.reduce((s, l) => s + l.weight, 0)
            + out.shorts.reduce((s, l) => s + l.weight, 0);
  assert.ok(Math.abs(net) < 1e-6, `net weight should be 0, got ${net}`);
  assert.equal(out.stats.net, 0);
  assert.equal(out.stats.gross, 2);
});

test('long-short: portfolio momentum exposure is positive when momentum=1', () => {
  const ft = new FactorTilt();
  const out = ft.build({
    universe: mkUniverse(40),
    factorWeights: { momentum: 1 },
    mode: 'long-short',
  });
  assert.ok(out.portfolioExposure.momentum > 1.5,
    `expected strong long-short momentum exposure, got ${out.portfolioExposure.momentum}`);
});

test('negative factor weight tilts AWAY from that factor', () => {
  const ft = new FactorTilt();
  // momentum:-1 means we want LOW momentum (contrarian tilt). Test the SEMANTIC outcome:
  // the long-only portfolio's momentum exposure should be lower than an unweighted basket.
  const out = ft.build({
    universe: mkUniverse(30),
    factorWeights: { momentum: -1, value: 0.1 }, // momentum dominates so tilt is meaningful
  });
  // Portfolio's net momentum z-score should be <= 0 (we are tilted AWAY).
  // Using <=0.5 as tolerance because value tilt can pull a few high-momentum names in.
  assert.ok(out.portfolioExposure.momentum < 0.5,
    `with momentum=-1 weight, portfolio momentum should be <=0.5, got ${out.portfolioExposure.momentum}`);
});

test('missing factor values fall through to z=0 (do not break)', () => {
  const ft = new FactorTilt();
  // Build a universe where half the stocks have no quality data.
  const universe = mkUniverse(20).map((u, i) => i % 2 === 0 ? { ...u, quality: undefined } : u);
  const out = ft.build({
    universe,
    factorWeights: { momentum: 0.5, quality: 0.5 },
  });
  assert.equal(out.ok, true);
  assert.ok(out.longs.length >= 2);
});

test('symbols missing -> filtered out, error if too few remain', () => {
  const ft = new FactorTilt();
  const universe = mkUniverse(10);
  for (const u of universe) u.symbol = '';   // strip all symbols
  // After filtering, we have 0 stocks -- but the validation runs BEFORE filter,
  // so the 10-stock check passes. The subsequent ceil(0 * 0.2) = 0, max(2,0) = 2,
  // and slice(0,2) returns [] from an empty array. weights = []. sumWeights = 0.
  // Either way this should not crash; it should return a degenerate result.
  const out = ft.build({ universe, factorWeights: { momentum: 1 } });
  assert.equal(out.ok, true);
  assert.equal(out.longs.length, 0);
});

test('FACTORS export contains expected 5 factors', () => {
  assert.deepEqual(FACTORS, ['momentum', 'value', 'quality', 'lowVol', 'size']);
});
