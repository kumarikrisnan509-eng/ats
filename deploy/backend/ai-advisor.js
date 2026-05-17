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
  gemini:    'gemini-3.1-pro-preview',
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
  // Gemini -- bare *-pro aliases don't resolve on Gemini API; must use -preview suffix
  'gemini-2.0-flash':  'gemini-3.1-flash-lite',
  'gemini-2.5-pro':    'gemini-3.1-pro-preview',
  'gemini-3.1-pro':    'gemini-3.1-pro-preview',
  'gemini-3-pro':      'gemini-3-pro-preview',
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
    const usage = {
      prompt_tokens: (j.usage && j.usage.input_tokens) || 0,
      completion_tokens: (j.usage && j.usage.output_tokens) || 0,
    };
    return { advice: _parseJsonResponse(text), usage };
  }

  if (provider === 'openai') {
    const resp = await fetchFn('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: (() => {
        const resolvedOpenAI = resolveModel('openai', model);
        // GPT-5+ and o-family reasoning models require max_completion_tokens; legacy gpt-4* still uses max_tokens
        const isNewerOpenAI = /^(gpt-5|o[0-9])/i.test(resolvedOpenAI);
        const body = {
          model: resolvedOpenAI,
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user',   content: prompt.user },
          ],
          response_format: { type: 'json_object' },
        };
        if (isNewerOpenAI) body.max_completion_tokens = 1500;
        else body.max_tokens = 1500;
        return JSON.stringify(body);
      })(),
    });
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`openai ${resp.status}: ${txt.slice(0, 200)}`);
    }
    const j = await resp.json();
    const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
    const usage = {
      prompt_tokens: (j.usage && j.usage.prompt_tokens) || 0,
      completion_tokens: (j.usage && j.usage.completion_tokens) || 0,
    };
    return { advice: _parseJsonResponse(text), usage };
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
    const usage = {
      prompt_tokens: (j.usageMetadata && j.usageMetadata.promptTokenCount) || 0,
      completion_tokens: (j.usageMetadata && j.usageMetadata.candidatesTokenCount) || 0,
    };
    return { advice: _parseJsonResponse(text), usage };
  }

  throw new Error(`unsupported provider: ${provider}`);
}

// T99-A3: Provider+model rate card (USD per 1M tokens). Used by estimateCost() to
// log a real ₹ figure per call into ai_calls. Conservative defaults when model is
// unknown — we pick the priciest in the family so the cap never silently overruns.
// Updated May 2026. USD->INR = 85 (rounded; refresh if FX moves >5%).
const USD_INR = 85;
const PRICE_USD_PER_M = {
  // Anthropic
  'claude-opus-4-7':      { in: 15.00, out: 75.00 },
  'claude-opus-4-6':      { in: 15.00, out: 75.00 },
  'claude-sonnet-4-6':    { in:  3.00, out: 15.00 },
  'claude-haiku-4-5':     { in:  1.00, out:  5.00 },
  // OpenAI
  'gpt-5':                { in:  1.25, out: 10.00 },
  'gpt-5-mini':           { in:  0.25, out:  2.00 },
  'gpt-5-nano':           { in:  0.10, out:  0.40 },
  'o3':                   { in:  2.00, out:  8.00 },
  // Gemini
  'gemini-3.1-pro-preview':   { in:  1.25, out: 10.00 },
  'gemini-3.1-flash':         { in:  0.30, out:  2.50 },
  'gemini-3.1-flash-lite':    { in:  0.10, out:  0.40 },
};
function _priceFor(model) {
  if (!model) return { in: 3.0, out: 15.0 };       // default: Sonnet rate
  if (PRICE_USD_PER_M[model]) return PRICE_USD_PER_M[model];
  // Family fallback
  if (/opus/i.test(model))   return { in: 15.0, out: 75.0 };
  if (/sonnet/i.test(model)) return { in: 3.0,  out: 15.0 };
  if (/haiku/i.test(model))  return { in: 1.0,  out: 5.0 };
  if (/gpt-5-nano/i.test(model))  return { in: 0.10, out: 0.40 };
  if (/gpt-5-mini/i.test(model))  return { in: 0.25, out: 2.00 };
  if (/^(gpt-5|o[0-9])/i.test(model)) return { in: 1.25, out: 10.0 };
  if (/flash-lite/i.test(model))  return { in: 0.10, out: 0.40 };
  if (/flash/i.test(model))       return { in: 0.30, out: 2.50 };
  if (/pro/i.test(model))         return { in: 1.25, out: 10.0 };
  return { in: 3.0, out: 15.0 };  // worst-case default
}
/**
 * H5: redact rupee amounts + holdings counts in a payload before sending to
 * an external LLM. Replaces numbers with bucketed labels so the model gets
 * directional context without seeing the user's actual portfolio value.
 *
 * Buckets (INR):
 *   < 1 L      → 'tiny'
 *   1L–10L     → 'small'
 *   10L–1Cr    → 'medium'
 *   1Cr–10Cr   → 'large'
 *   > 10Cr     → 'very-large'
 *
 * Holdings counts:
 *   < 5  → 'few', 5-20 → 'handful', 20-50 → 'broad', > 50 → 'wide'
 */
function redactRupees(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '~unknown';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs < 1e5) return sign + 'tiny';
  if (abs < 1e6) return sign + 'small';
  if (abs < 1e7) return sign + 'medium';
  if (abs < 1e8) return sign + 'large';
  return sign + 'very-large';
}
function redactHoldingsCount(n) {
  const x = Number(n) || 0;
  if (x < 5) return 'few';
  if (x < 20) return 'handful';
  if (x < 50) return 'broad';
  return 'wide';
}
/** Walks a JSON-able payload, replacing values flagged by a paths key list. Used for buildPrompt input redaction. */
function redactPayload(obj, opts = {}) {
  if (!obj || typeof obj !== 'object') return obj;
  const RUPEE_KEYS = new Set(['portfolio_value', 'equity', 'cash', 'realized_pnl', 'unrealized_pnl', 'pnl', 'total_pnl', 'gross_pnl_inr', 'initialCapital', 'deployedCapital']);
  const COUNT_KEYS = new Set(['holdingCount', 'holdings_count']);
  if (Array.isArray(obj)) return obj.map(x => redactPayload(x, opts));
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (RUPEE_KEYS.has(k) && typeof v === 'number') out[k] = redactRupees(v);
    else if (COUNT_KEYS.has(k) && typeof v === 'number') out[k] = redactHoldingsCount(v);
    else if (v && typeof v === 'object') out[k] = redactPayload(v, opts);
    else out[k] = v;
  }
  return out;
}

/** Compute ₹ cost for a single call given token usage. */
function estimateCost({ provider, model, prompt_tokens, completion_tokens }) {
  const p = _priceFor(model);
  const usd = ((prompt_tokens || 0) * p.in + (completion_tokens || 0) * p.out) / 1_000_000;
  return +(usd * USD_INR).toFixed(4);     // ₹ to 4 decimals
}
/** Cheap pre-call estimate so the spend-cap check has something before the LLM responds. */
function estimateCostBudget({ provider, model, expectedInTokens = 800, expectedOutTokens = 1500 }) {
  return estimateCost({ provider, model, prompt_tokens: expectedInTokens, completion_tokens: expectedOutTokens });
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
  // T99-A3
  estimateCost,
  estimateCostBudget,
  // H5
  redactRupees,
  redactHoldingsCount,
  redactPayload,
  _internal: { _parseJsonResponse, _priceFor },
};
