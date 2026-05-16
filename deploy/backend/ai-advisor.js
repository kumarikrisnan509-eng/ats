// ai-advisor.js -- Tier 69c: BYOK (Bring Your Own Key) LLM portfolio advisor.
//
// Each user provides their own Anthropic / OpenAI / Gemini API key. Keys are
// libsodium-sealed in the ai_keys table. We never store plaintext, never log,
// never share across users.
//
// On analyze: gather the user's risk metrics + factor exposure + top holdings,
// build a structured prompt, send to the chosen LLM, parse the JSON response.
// Caller wraps any side effects (recording, notifications). This module is
// pure orchestration -- no DB, no I/O outside the HTTP call.

'use strict';

const SUPPORTED_PROVIDERS = ['anthropic', 'openai', 'gemini'];

const DEFAULT_MODEL_BY_PROVIDER = {
  anthropic: 'claude-sonnet-4-6',
  openai:    'gpt-5.5',
  gemini:    'gemini-3.1-pro',
};

// T92: Map deprecated/aged-off model aliases to the current default for that provider.
// When a saved model_pref hits this map, we swap to the current default at call-time so
// users don't have to manually re-pick. Keep this list small and only add proven-deprecated aliases.
const DEPRECATED_MODEL_ALIASES = {
  // Anthropic
  'claude-sonnet-4-5': 'claude-sonnet-4-6',
  'claude-opus-4-1':   'claude-opus-4-6',
  'claude-3-5-sonnet-20241022': 'claude-sonnet-4-6',
  // OpenAI
  'gpt-4o-mini':       'gpt-5.5',
  'gpt-4o':            'gpt-5.5',
  'gpt-4.1':           'gpt-5.5',
  // Gemini
  'gemini-2.0-flash':  'gemini-3.1-pro',
  'gemini-2.5-pro':    'gemini-3.1-pro',
  'gemini-2.5-flash':  'gemini-3.1-flash-lite',
};

function resolveModel(provider, requested) {
  if (!requested) return DEFAULT_MODEL_BY_PROVIDER[provider];
  // Auto-upgrade deprecated aliases
  if (DEPRECATED_MODEL_ALIASES[requested]) return DEPRECATED_MODEL_ALIASES[requested];
  return requested;
}

/**
 * Build the user-facing system prompt + structured output schema.
 * Returns the JSON-shaped response we expect back from the LLM.
 *
 * Schema:
 *   {
 *     summary: string,                       // 1-2 sentences
 *     risk_concerns: string[],               // 0-5 items, each <= 200 chars
 *     opportunities: string[],               // 0-5 items
 *     suggested_actions: [
 *       { priority: 1|2|3, action: string, rationale: string, target_symbol?: string }
 *     ],
 *     overall_risk_grade: 'A'|'B'|'C'|'D'|'F',
 *   }
 */
function buildPrompt({ user, riskMetrics, factorExposure, holdings, marketContext }) {
  const userName = (user && user.name) || 'the user';
  const riskBlock = JSON.stringify({
    annualizedReturn: riskMetrics?.annualizedReturn,
    volatilityAnnual: riskMetrics?.volatilityAnnual,
    sharpeRatio: riskMetrics?.sharpeRatio,
    sortinoRatio: riskMetrics?.sortinoRatio,
    maxDrawdown: riskMetrics?.maxDrawdown,
    var95Daily: riskMetrics?.var95Daily,
    var99Daily: riskMetrics?.var99Daily,
  }, null, 2);

  const factorBlock = JSON.stringify({
    portfolio: factorExposure?.portfolio,
    concentration: factorExposure?.concentration,
    holdingCount: factorExposure?.holdingCount,
  }, null, 2);

  const holdingsBlock = (holdings || []).slice(0, 15).map(h =>
    `- ${h.symbol}: weight=${(h.weight * 100).toFixed(1)}%, momentum1M=${h.momentum1M != null ? (h.momentum1M * 100).toFixed(1) + '%' : 'n/a'}, vol=${(h.volatilityAnnual * 100).toFixed(1)}%`
  ).join('\n');

  return {
    system: `You are an experienced portfolio risk advisor for an Indian retail trader. You analyze a portfolio's risk metrics and factor exposure, then return STRICTLY JSON-formatted advice.

You are NOT a SEBI-registered advisor. You always include a disclaimer in your summary that this is informational and not personalized financial advice. You never recommend leverage or options strategies the user did not already use.

Output schema (you MUST return ONLY valid JSON in this shape, no commentary outside JSON):
{
  "summary": "1-2 sentence portfolio overview, including the disclaimer",
  "risk_concerns": ["..."],
  "opportunities": ["..."],
  "suggested_actions": [
    {"priority": 1|2|3, "action": "...", "rationale": "...", "target_symbol": "OPTIONAL"}
  ],
  "overall_risk_grade": "A"|"B"|"C"|"D"|"F"
}

Grading rubric:
A = well-diversified, Sharpe > 1.5, max DD < 10%, no concentration warnings
B = diversified, Sharpe > 0.8, max DD < 20%
C = moderate concentration OR Sharpe between 0 and 0.8
D = significant concentration warnings OR negative Sharpe
F = single-stock > 25%, or extreme drawdown > 35%`,
    user: `Analyze this portfolio for ${userName}.

RISK METRICS (computed from daily equity history):
${riskBlock}

FACTOR EXPOSURE (returns-based, 1Y lookback):
${factorBlock}

TOP HOLDINGS:
${holdingsBlock || '(no holdings)'}

MARKET CONTEXT:
${marketContext || '(none provided)'}

Return ONLY the JSON object. No markdown, no commentary.`,
  };
}

/**
 * Call the chosen LLM. Returns parsed JSON or throws.
 *
 * @param {object} args
 * @param {'anthropic'|'openai'|'gemini'} args.provider
 * @param {string} args.apiKey
 * @param {string} args.model
 * @param {{system:string, user:string}} args.prompt
 * @param {function} [args.fetchImpl]  defaults to global fetch (Node 18+)
 * @returns {Promise<object>} parsed advisor response
 */
async function callLLM({ provider, apiKey, model, prompt, fetchImpl }) {
  const fetchFn = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  if (!fetchFn) throw new Error('global fetch unavailable -- need Node 18+');

  if (provider === 'anthropic') {
    const resp = await fetchFn('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: resolveModel('anthropic', model),
        max_tokens: 1500,
        system: prompt.system,
        messages: [{ role: 'user', content: prompt.user }],
      }),
    });
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`anthropic ${resp.status}: ${txt.slice(0, 200)}`);
    }
    const j = await resp.json();
    const text = (j.content && j.content[0] && j.content[0].text) || '';
    return _parseJsonResponse(text);
  }

  if (provider === 'openai') {
    const resp = await fetchFn('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: resolveModel('openai', model),
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user',   content: prompt.user },
        ],
        max_tokens: 1500,
        response_format: { type: 'json_object' },
      }),
    });
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`openai ${resp.status}: ${txt.slice(0, 200)}`);
    }
    const j = await resp.json();
    const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
    return _parseJsonResponse(text);
  }

  if (provider === 'gemini') {
    const m = resolveModel('gemini', model);
    const resp = await fetchFn(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt.user }] }],
        systemInstruction: { parts: [{ text: prompt.system }] },
        generationConfig: { maxOutputTokens: 1500, responseMimeType: 'application/json' },
      }),
    });
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`gemini ${resp.status}: ${txt.slice(0, 200)}`);
    }
    const j = await resp.json();
    const text = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts && j.candidates[0].content.parts[0] && j.candidates[0].content.parts[0].text) || '';
    return _parseJsonResponse(text);
  }

  throw new Error(`unsupported provider: ${provider}`);
}

/**
 * Try to extract a JSON object from the LLM response. LLMs sometimes wrap their
 * output in markdown ```json fences or add commentary. Strip those before parsing.
 */
function _parseJsonResponse(raw) {
  if (!raw || typeof raw !== 'string') throw new Error('empty LLM response');
  let s = raw.trim();
  // Strip markdown fences
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  }
  // Find the first { and the matching last }
  const start = s.indexOf('{');
  const end   = s.lastIndexOf('}');
  if (start < 0 || end < 0 || end <= start) throw new Error('no JSON object in response');
  const jsonText = s.slice(start, end + 1);
  return JSON.parse(jsonText);
}

/** Normalize the parsed LLM response into our canonical shape, with safe defaults. */
function normalizeAdvice(advice) {
  if (!advice || typeof advice !== 'object') return null;
  return {
    summary: typeof advice.summary === 'string' ? advice.summary.slice(0, 600) : '',
    risk_concerns: Array.isArray(advice.risk_concerns)
      ? advice.risk_concerns.filter(x => typeof x === 'string').slice(0, 5).map(x => x.slice(0, 300))
      : [],
    opportunities: Array.isArray(advice.opportunities)
      ? advice.opportunities.filter(x => typeof x === 'string').slice(0, 5).map(x => x.slice(0, 300))
      : [],
    suggested_actions: Array.isArray(advice.suggested_actions)
      ? advice.suggested_actions.slice(0, 5)
          .filter(a => a && typeof a === 'object')
          .map(a => ({
            priority: [1,2,3].includes(a.priority) ? a.priority : 3,
            action: typeof a.action === 'string' ? a.action.slice(0, 300) : '',
            rationale: typeof a.rationale === 'string' ? a.rationale.slice(0, 300) : '',
            target_symbol: typeof a.target_symbol === 'string' ? a.target_symbol.slice(0, 32) : null,
          }))
          .filter(a => a.action.length > 0)
      : [],
    overall_risk_grade: ['A','B','C','D','F'].includes(advice.overall_risk_grade)
      ? advice.overall_risk_grade
      : 'C',
  };
}

module.exports = {
  SUPPORTED_PROVIDERS,
  DEFAULT_MODEL_BY_PROVIDER,
  DEPRECATED_MODEL_ALIASES,
  resolveModel,
  buildPrompt,
  callLLM,
  normalizeAdvice,
  _internal: { _parseJsonResponse },
};
