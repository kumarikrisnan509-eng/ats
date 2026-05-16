/* eslint-disable */
// ai-router.js — T99-H0 auto-routing engine.
//
// Decides which (provider, model) to use for a given workflow + mode, taking
// into account which BYOK keys the user has saved. The downstream is hidden
// from callers: they pass {workflow, mode} and we return a ready-to-use
// {provider, model, apiKey, est_cost_inr}.
//
// Why this exists: per Master Plan v11, AI Signals critique, monthly review,
// strategy explainer, etc. should always pick the right model — not let the
// user fiddle with dropdowns. Sonnet for decision-influencing workflows,
// Haiku for explainers, Flash-lite for batch. Cross-provider fallback when
// the user's preferred provider isn't configured.

'use strict';

const { resolveModel, estimateCostBudget } = require('./ai-advisor');

// === Workflow matrix ====================================================
// 15 workflows. Each maps to a {quality, balanced, economy} preference
// expressed as model FAMILIES. The router then picks the actual provider's
// implementation of that family from the user's available keys.
//
// Families:
//   PREMIUM  — highest quality reasoning (Claude Opus, GPT-5, Gemini Pro)
//   STRONG   — production default (Claude Sonnet, GPT-5, Gemini Pro)
//   FAST     — cheap explainer (Claude Haiku, GPT-5-mini, Gemini Flash)
//   CHEAP    — high-volume batch (Haiku still, GPT-5-nano, Gemini Flash-lite)
//
// quality-first defaults per v7: decision-influencing workflows use STRONG
// even when user picks Balanced.
const FAMILY = { PREMIUM: 'PREMIUM', STRONG: 'STRONG', FAST: 'FAST', CHEAP: 'CHEAP' };

const WORKFLOW_MATRIX = {
  // Connectivity check on /test — keep cheap always.
  test:              { quality: FAMILY.FAST,    balanced: FAMILY.FAST,    economy: FAMILY.CHEAP   },

  // Portfolio advisor — single call, high stakes. Always STRONG except in Economy.
  analyze:           { quality: FAMILY.STRONG,  balanced: FAMILY.STRONG,  economy: FAMILY.FAST    },

  // A1 — per-signal critique fired during/after scanner runs.
  // v7 quality-first: Sonnet even in Balanced. Economy still allows Haiku.
  intraday_critic:   { quality: FAMILY.STRONG,  balanced: FAMILY.STRONG,  economy: FAMILY.FAST    },
  signal_critique:   { quality: FAMILY.STRONG,  balanced: FAMILY.STRONG,  economy: FAMILY.FAST    },

  // A2 — monthly review, one call per user per month. Cheapest workflow that
  // touches every user, so STRONG is fine; nothing to economise.
  monthly_review:    { quality: FAMILY.PREMIUM, balanced: FAMILY.STRONG,  economy: FAMILY.STRONG  },

  // A4 — translate strategy code to plain English. Pure explainer; FAST.
  strategy_explain:  { quality: FAMILY.FAST,    balanced: FAMILY.FAST,    economy: FAMILY.CHEAP   },

  // D1 — multi-provider consensus, picks across all 3 providers regardless.
  consensus:         { quality: FAMILY.STRONG,  balanced: FAMILY.STRONG,  economy: FAMILY.STRONG  },

  // D2 — weekly hyperparameter auto-tune; runs once/week, can afford STRONG.
  strategy_autotune: { quality: FAMILY.STRONG,  balanced: FAMILY.STRONG,  economy: FAMILY.FAST    },

  // D3 — vision/chart upload extraction.
  vision:            { quality: FAMILY.STRONG,  balanced: FAMILY.STRONG,  economy: FAMILY.FAST    },

  // B3 — news/sentiment chip on signal cards. Fires often, FAST is fine.
  news_sentiment:    { quality: FAMILY.FAST,    balanced: FAMILY.FAST,    economy: FAMILY.CHEAP   },

  // F2 — email digest synthesis (one call per user per day).
  email_digest:      { quality: FAMILY.FAST,    balanced: FAMILY.FAST,    economy: FAMILY.CHEAP   },

  // First-time user "explain what this page does" tooltips.
  onboarding_help:   { quality: FAMILY.FAST,    balanced: FAMILY.CHEAP,   economy: FAMILY.CHEAP   },

  // G9 — mutual-fund picker explainer. Decision-influencing.
  mf_pick:           { quality: FAMILY.STRONG,  balanced: FAMILY.STRONG,  economy: FAMILY.FAST    },

  // E6 — inject current market regime as context into critic prompts.
  // No AI call here — regime is computed locally in scanner. Keep entry for
  // matrix completeness so /preview endpoint returns 'no AI call' rather
  // than 'workflow unknown'.
  regime_inject:     { quality: null, balanced: null, economy: null      },

  // Catch-all default. Used when caller passes a workflow we don't recognise.
  default:           { quality: FAMILY.STRONG,  balanced: FAMILY.FAST,    economy: FAMILY.CHEAP   },
};

// === Provider/model preference within each family ========================
// First entry preferred; router falls through to next if user lacks that key.
// Anthropic-first per v11 (highest quality on Indian retail finance text).
const FAMILY_MODELS = {
  PREMIUM: [
    { provider: 'anthropic', model: 'claude-opus-4-7' },
    { provider: 'openai',    model: 'gpt-5' },
    { provider: 'gemini',    model: 'gemini-3.1-pro-preview' },
  ],
  STRONG: [
    { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    { provider: 'openai',    model: 'gpt-5' },
    { provider: 'gemini',    model: 'gemini-3.1-pro-preview' },
  ],
  FAST: [
    { provider: 'anthropic', model: 'claude-haiku-4-5' },
    { provider: 'openai',    model: 'gpt-5-mini' },
    { provider: 'gemini',    model: 'gemini-3.1-flash' },
  ],
  CHEAP: [
    { provider: 'anthropic', model: 'claude-haiku-4-5' },
    { provider: 'openai',    model: 'gpt-5-nano' },
    { provider: 'gemini',    model: 'gemini-3.1-flash-lite' },
  ],
};

const VALID_MODES = new Set(['quality', 'balanced', 'economy']);

/** Given the user's row set from ai_keys, build a Set of providers they can use. */
function availableProvidersFromKeys(keys) {
  const out = new Set();
  for (const k of (keys || [])) {
    if (k && k.provider) out.add(k.provider);
  }
  return out;
}

/**
 * Pick a {provider, model} for a workflow given which providers the user has.
 * Returns null if no provider is available, the workflow doesn't use AI, or
 * the mode/workflow combo is misconfigured.
 */
function pickModel({ workflow, mode = 'balanced', availableProviders }) {
  const wf = WORKFLOW_MATRIX[workflow] || WORKFLOW_MATRIX.default;
  const family = wf[VALID_MODES.has(mode) ? mode : 'balanced'];
  if (!family) return { workflow, family: null, ai: false, reason: 'no_ai_call' };
  const candidates = FAMILY_MODELS[family] || [];
  for (const c of candidates) {
    if (availableProviders.has(c.provider)) {
      return { workflow, family, ai: true, provider: c.provider, model: c.model };
    }
  }
  return { workflow, family, ai: false, reason: 'no_provider_available' };
}

/**
 * Full route() — looks up the user's keys, picks a provider/model, opens the
 * sealed key, and returns everything the caller needs to invoke callLLM().
 *
 * On success:
 *   { ok: true, provider, model, apiKey, family, workflow, est_cost_inr }
 *
 * On failure:
 *   { ok: false, reason: 'no_ai_key' | 'no_provider_available' | 'no_ai_call', detail }
 */
async function route({ db, vault, userId, workflow, mode }) {
  if (!db || !vault) throw new Error('route() requires db + vault');
  const keys = db._conn.prepare("SELECT provider, sealed_key, model_pref FROM ai_keys WHERE user_id = ?").all(userId);
  if (!keys.length) return { ok: false, reason: 'no_ai_key', detail: 'No BYOK AI provider configured.' };

  const available = availableProvidersFromKeys(keys);
  const pick = pickModel({ workflow, mode, availableProviders: available });

  if (!pick.ai) {
    return { ok: false, reason: pick.reason, detail: `Workflow ${workflow}/${mode} doesn\'t route to AI` };
  }

  const keyRow = keys.find(k => k.provider === pick.provider);
  if (!keyRow) return { ok: false, reason: 'no_provider_available', detail: 'race condition: key vanished mid-route' };

  const apiKey = await vault.open(keyRow.sealed_key);
  const resolvedModel = resolveModel(pick.provider, pick.model);

  // Pre-call budget for the spend-cap check at the call site.
  const est_cost_inr = estimateCostBudget({ provider: pick.provider, model: resolvedModel });

  return {
    ok: true,
    workflow,
    mode: VALID_MODES.has(mode) ? mode : 'balanced',
    family: pick.family,
    provider: pick.provider,
    model: resolvedModel,
    apiKey,
    est_cost_inr,
  };
}

/**
 * Read-only preview for the AI providers transparency view. Returns what
 * route() WOULD pick — without opening the sealed key — for every workflow.
 */
function preview({ db, userId, mode = 'balanced' }) {
  const keys = db._conn.prepare("SELECT provider FROM ai_keys WHERE user_id = ?").all(userId);
  const available = availableProvidersFromKeys(keys);
  const out = [];
  for (const workflow of Object.keys(WORKFLOW_MATRIX)) {
    if (workflow === 'default') continue;     // internal fallback, don't surface
    const pick = pickModel({ workflow, mode, availableProviders: available });
    out.push({
      workflow,
      family: pick.family,
      ...(pick.ai
        ? { provider: pick.provider, model: pick.model, ai: true }
        : { ai: false, reason: pick.reason }
      ),
    });
  }
  return {
    mode: VALID_MODES.has(mode) ? mode : 'balanced',
    availableProviders: Array.from(available),
    workflows: out,
  };
}

module.exports = {
  WORKFLOW_MATRIX,
  FAMILY_MODELS,
  FAMILY,
  VALID_MODES,
  pickModel,
  route,
  preview,
};
