// Tier 69c: ai-advisor unit tests. We do NOT make real LLM calls -- we inject a
// fake fetch and verify the request shape + response parsing.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildPrompt, callLLM, normalizeAdvice, _internal, SUPPORTED_PROVIDERS } = require('../ai-advisor');

function mockFetchOK(body) {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}
function mockFetchFail(status, text) {
  return async () => ({
    ok: false, status,
    text: async () => text,
    json: async () => ({ error: text }),
  });
}

test('SUPPORTED_PROVIDERS includes the three providers', () => {
  assert.deepEqual(SUPPORTED_PROVIDERS.sort(), ['anthropic', 'gemini', 'openai']);
});

test('buildPrompt produces system + user messages', () => {
  const p = buildPrompt({
    user: { name: 'Alice' },
    riskMetrics: { sharpeRatio: 1.2, maxDrawdown: -0.15 },
    factorExposure: { portfolio: { momentum1M: 0.05 }, concentration: { top1Weight: 0.12 } },
    holdings: [{ symbol: 'RELIANCE', weight: 0.4, momentum1M: 0.05, volatilityAnnual: 0.25 }],
  });
  assert.ok(p.system.includes('portfolio risk advisor'));
  assert.ok(p.user.includes('Alice'));
  assert.ok(p.user.includes('RELIANCE'));
});

test('normalizeAdvice fills safe defaults from missing fields', () => {
  const out = normalizeAdvice({});
  assert.equal(out.summary, '');
  assert.deepEqual(out.risk_concerns, []);
  assert.equal(out.overall_risk_grade, 'C');
});

test('normalizeAdvice clamps string lengths', () => {
  const longStr = 'x'.repeat(1000);
  const out = normalizeAdvice({ summary: longStr, risk_concerns: [longStr], overall_risk_grade: 'A' });
  assert.ok(out.summary.length <= 600);
  assert.ok(out.risk_concerns[0].length <= 300);
  assert.equal(out.overall_risk_grade, 'A');
});

test('normalizeAdvice filters out malformed actions', () => {
  const out = normalizeAdvice({
    suggested_actions: [
      { priority: 1, action: 'Trim TCS', rationale: 'IT concentration' },
      { priority: 99, action: '' },          // empty action -> filtered
      { priority: 7, action: 'Bad priority', rationale: 'x' }, // priority defaults to 3
      null,
    ],
  });
  assert.equal(out.suggested_actions.length, 2);
  assert.equal(out.suggested_actions[0].priority, 1);
  assert.equal(out.suggested_actions[1].priority, 3);
});

test('callLLM(anthropic) builds the right request and parses content', async () => {
  let captured;
  const fakeFetch = async (url, opts) => {
    captured = { url, opts };
    return {
      ok: true, status: 200,
      json: async () => ({ content: [{ text: '{"summary":"hello","overall_risk_grade":"B"}' }] }),
      text: async () => '',
    };
  };
  const out = await callLLM({
    provider: 'anthropic',
    apiKey: 'sk-test-key',
    model: 'claude-sonnet-4-5',
    prompt: { system: 'sys', user: 'usr' },
    fetchImpl: fakeFetch,
  });
  assert.equal(captured.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(captured.opts.headers['x-api-key'], 'sk-test-key');
  const body = JSON.parse(captured.opts.body);
  assert.equal(body.model, 'claude-sonnet-4-5');
  assert.equal(body.system, 'sys');
  assert.equal(out.summary, 'hello');
});

test('callLLM(openai) sends Authorization header and parses choices[0]', async () => {
  let captured;
  const fakeFetch = async (url, opts) => {
    captured = { url, opts };
    return {
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content: '{"summary":"ok"}' } }] }),
      text: async () => '',
    };
  };
  const out = await callLLM({ provider: 'openai', apiKey: 'sk-x', model: 'gpt-4o-mini', prompt: { system: 's', user: 'u' }, fetchImpl: fakeFetch });
  assert.equal(captured.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(captured.opts.headers.Authorization, 'Bearer sk-x');
  assert.equal(out.summary, 'ok');
});

test('callLLM(gemini) embeds api key in querystring and parses candidates', async () => {
  let captured;
  const fakeFetch = async (url, opts) => {
    captured = { url, opts };
    return {
      ok: true, status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: '{"summary":"g"}' }] } }] }),
      text: async () => '',
    };
  };
  const out = await callLLM({ provider: 'gemini', apiKey: 'gKey', model: 'gemini-2.0-flash', prompt: { system: 's', user: 'u' }, fetchImpl: fakeFetch });
  assert.ok(captured.url.includes('gemini-2.0-flash'));
  assert.ok(captured.url.includes('key=gKey'));
  assert.equal(out.summary, 'g');
});

test('callLLM unsupported provider throws', async () => {
  await assert.rejects(
    callLLM({ provider: 'whatever', apiKey: 'x', model: 'x', prompt: { system: '', user: '' }, fetchImpl: mockFetchOK({}) }),
    /unsupported provider/
  );
});

test('callLLM HTTP error surfaces as thrown Error', async () => {
  await assert.rejects(
    callLLM({ provider: 'anthropic', apiKey: 'x', model: 'x', prompt: { system: '', user: '' }, fetchImpl: mockFetchFail(401, 'unauthorized') }),
    /anthropic 401/
  );
});

test('_parseJsonResponse strips markdown fences', () => {
  const wrapped = '```json\n{"summary":"hi"}\n```';
  const out = _internal._parseJsonResponse(wrapped);
  assert.equal(out.summary, 'hi');
});

test('_parseJsonResponse extracts JSON when LLM adds commentary', () => {
  const noisy = 'Here is your analysis:\n\n{"summary":"ok","overall_risk_grade":"B"}\n\nHope this helps!';
  const out = _internal._parseJsonResponse(noisy);
  assert.equal(out.summary, 'ok');
  assert.equal(out.overall_risk_grade, 'B');
});

test('_parseJsonResponse throws on bad input', () => {
  assert.throws(() => _internal._parseJsonResponse(''), /empty/);
  assert.throws(() => _internal._parseJsonResponse('no json here'), /no JSON/);
});
