// ai-router.test.js — T-155 regression guard for ai-router.js (Tier H0).
//
// The router decides which (provider, model) handles each of 15 AI workflows
// based on user mode (quality/balanced/economy) and which BYOK keys the user
// has. Critical because:
//   - A regression that maps intraday_critic to FAST in 'balanced' mode silently
//     downgrades every signal critique from Claude Sonnet to Claude Haiku
//   - A regression in availableProvidersFromKeys produces 'no_provider_available'
//     for users who DO have keys
//   - A regression in the FAMILY_MODELS ordering picks the wrong model
//
// Tests work entirely against pure helpers (pickModel + availableProvidersFromKeys
// + WORKFLOW_MATRIX/FAMILY_MODELS). route() is async with db+vault deps and is
// covered by integration paths.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  WORKFLOW_MATRIX,
  FAMILY_MODELS,
  FAMILY,
  VALID_MODES,
  pickModel,
  preview,
} = require('../ai-router');

// ---------- module shape ----------

test('exports FAMILY constants', () => {
  assert.deepEqual(Object.keys(FAMILY).sort(), ['CHEAP', 'FAST', 'PREMIUM', 'STRONG']);
  for (const v of Object.values(FAMILY)) assert.equal(typeof v, 'string');
});

test('exports VALID_MODES set with quality/balanced/economy', () => {
  assert.ok(VALID_MODES instanceof Set);
  assert.ok(VALID_MODES.has('quality'));
  assert.ok(VALID_MODES.has('balanced'));
  assert.ok(VALID_MODES.has('economy'));
  assert.equal(VALID_MODES.size, 3);
});

test('FAMILY_MODELS has entries for all four families', () => {
  for (const f of Object.values(FAMILY)) {
    assert.ok(Array.isArray(FAMILY_MODELS[f]), `${f} missing`);
    assert.ok(FAMILY_MODELS[f].length >= 1, `${f} empty`);
    for (const row of FAMILY_MODELS[f]) {
      assert.ok(row.provider, `${f} entry missing provider`);
      assert.ok(row.model, `${f} entry missing model`);
    }
  }
});

test('FAMILY_MODELS lists anthropic first per v11 quality ordering', () => {
  // T-127 / v11 contract: Anthropic must be the first fallback in every family.
  // If a regression reorders this, BYOK users with only Anthropic configured
  // could see degraded selection.
  for (const f of Object.values(FAMILY)) {
    assert.equal(FAMILY_MODELS[f][0].provider, 'anthropic',
      `${f} first fallback must be anthropic; got ${FAMILY_MODELS[f][0].provider}`);
  }
});

// ---------- availableProvidersFromKeys (via pickModel observability) ----------

test('pickModel returns no_provider_available when user has no keys', () => {
  const r = pickModel({
    workflow: 'intraday_critic',
    mode: 'balanced',
    availableProviders: new Set(),
  });
  assert.equal(r.ai, false);
  assert.equal(r.reason, 'no_provider_available');
});

// ---------- pickModel: workflow + mode resolution ----------

test('pickModel: intraday_critic in balanced mode resolves to STRONG (anthropic claude-sonnet)', () => {
  // T-127 v11 quality-first contract: decision-influencing workflows use STRONG
  // even in Balanced mode. A regression to FAST silently degrades signal quality.
  const r = pickModel({
    workflow: 'intraday_critic',
    mode: 'balanced',
    availableProviders: new Set(['anthropic']),
  });
  assert.equal(r.ai, true);
  assert.equal(r.family, 'STRONG');
  assert.equal(r.provider, 'anthropic');
  assert.match(r.model, /sonnet/i, `expected a Sonnet variant; got ${r.model}`);
});

test('pickModel: signal_critique in balanced also STRONG (mirror of intraday_critic)', () => {
  const r = pickModel({
    workflow: 'signal_critique',
    mode: 'balanced',
    availableProviders: new Set(['anthropic']),
  });
  assert.equal(r.family, 'STRONG');
});

test('pickModel: monthly_review in quality mode resolves to PREMIUM', () => {
  const r = pickModel({
    workflow: 'monthly_review',
    mode: 'quality',
    availableProviders: new Set(['anthropic']),
  });
  assert.equal(r.family, 'PREMIUM');
  assert.match(r.model, /opus/i);
});

test('pickModel: test workflow always CHEAP or FAST', () => {
  for (const mode of ['quality', 'balanced', 'economy']) {
    const r = pickModel({
      workflow: 'test',
      mode,
      availableProviders: new Set(['anthropic']),
    });
    assert.ok(['FAST', 'CHEAP'].includes(r.family),
      `test workflow in ${mode} must be FAST or CHEAP; got ${r.family}`);
  }
});

test('pickModel: unknown workflow falls back to default matrix entry', () => {
  const r = pickModel({
    workflow: 'totally_made_up_workflow_xyz',
    mode: 'balanced',
    availableProviders: new Set(['anthropic']),
  });
  // The router has a 'default' entry — should produce a deterministic result,
  // not throw.
  assert.ok(r);
  // ai may be true or false depending on what 'default' is set to; we just
  // assert no throw and a sane shape.
  assert.ok(typeof r.ai === 'boolean');
});

test('pickModel: unknown mode falls back to balanced', () => {
  const balanced = pickModel({
    workflow: 'intraday_critic',
    mode: 'balanced',
    availableProviders: new Set(['anthropic']),
  });
  const bogus = pickModel({
    workflow: 'intraday_critic',
    mode: 'futuremode',
    availableProviders: new Set(['anthropic']),
  });
  assert.equal(bogus.family, balanced.family);
  assert.equal(bogus.model, balanced.model);
});

// ---------- pickModel: cross-provider fallback ----------

test('pickModel: falls through to next provider when first is unavailable', () => {
  // User has openai only — router should pick the openai entry for STRONG.
  const r = pickModel({
    workflow: 'intraday_critic',
    mode: 'balanced',
    availableProviders: new Set(['openai']),
  });
  assert.equal(r.ai, true);
  assert.equal(r.provider, 'openai');
});

test('pickModel: gemini-only user gets a Gemini model', () => {
  const r = pickModel({
    workflow: 'intraday_critic',
    mode: 'balanced',
    availableProviders: new Set(['gemini']),
  });
  assert.equal(r.ai, true);
  assert.equal(r.provider, 'gemini');
});

test('pickModel: user with all three providers gets anthropic-first', () => {
  const r = pickModel({
    workflow: 'intraday_critic',
    mode: 'balanced',
    availableProviders: new Set(['anthropic', 'openai', 'gemini']),
  });
  assert.equal(r.provider, 'anthropic');
});

// ---------- WORKFLOW_MATRIX coverage gates ----------

test('WORKFLOW_MATRIX has at least 10 workflows defined', () => {
  // Soft floor — v11 master plan defines 15 workflows. If a regression deletes
  // half of them, signals/monthly-review/strategy-explainer etc. silently
  // start returning no_ai_call.
  const realWorkflows = Object.keys(WORKFLOW_MATRIX).filter(k => k !== 'default');
  assert.ok(realWorkflows.length >= 10,
    `WORKFLOW_MATRIX shrunk to ${realWorkflows.length} workflows; expected >=10`);
});

test('every WORKFLOW_MATRIX entry defines all three modes', () => {
  // null is permitted — it signals "this workflow doesn't route to AI" and
  // pickModel returns ai:false with reason:'no_ai_call'.
  const validFamilies = new Set(Object.values(FAMILY));
  for (const [name, entry] of Object.entries(WORKFLOW_MATRIX)) {
    for (const mode of ['quality', 'balanced', 'economy']) {
      assert.ok(mode in entry,
        `${name} missing mode key '${mode}'`);
      const v = entry[mode];
      assert.ok(v === null || validFamilies.has(v),
        `${name}/${mode} = ${JSON.stringify(v)} is not null or a known FAMILY`);
    }
  }
});

test('intraday_critic and signal_critique remain in STRONG in balanced (T-127 quality-first)', () => {
  // This is the canonical decision-influencing pair from T-127. If anyone ever
  // edits WORKFLOW_MATRIX to downgrade these to FAST in balanced, the test fails.
  assert.equal(WORKFLOW_MATRIX.intraday_critic.balanced, FAMILY.STRONG);
  assert.equal(WORKFLOW_MATRIX.signal_critique.balanced, FAMILY.STRONG);
});

// ---------- preview() smoke ----------

test('preview returns workflows[] when db has zero keys (graceful degradation)', () => {
  const fakeDb = {
    _conn: { prepare: () => ({ all: () => [] }) },
  };
  const r = preview({ db: fakeDb, userId: 'u1', mode: 'balanced' });
  assert.equal(r.mode, 'balanced');
  assert.deepEqual(r.availableProviders, []);
  assert.ok(Array.isArray(r.workflows));
  assert.ok(r.workflows.length > 0);
  // With no providers, every workflow should report ai:false.
  for (const w of r.workflows) {
    assert.equal(w.ai, false, `${w.workflow} should be ai:false when no providers configured`);
  }
});

test('preview returns workflows[] with ai:true when user has anthropic key', () => {
  const fakeDb = {
    _conn: { prepare: () => ({ all: () => [{ provider: 'anthropic' }] }) },
  };
  const r = preview({ db: fakeDb, userId: 'u1', mode: 'balanced' });
  assert.deepEqual(r.availableProviders, ['anthropic']);
  // At least the decision-influencing workflows should be ai:true.
  const intraday = r.workflows.find(w => w.workflow === 'intraday_critic');
  assert.ok(intraday);
  assert.equal(intraday.ai, true);
  assert.equal(intraday.provider, 'anthropic');
});

test('preview clamps unknown mode to balanced', () => {
  const fakeDb = { _conn: { prepare: () => ({ all: () => [] }) } };
  const r = preview({ db: fakeDb, userId: 'u1', mode: 'futuremode' });
  assert.equal(r.mode, 'balanced');
});
