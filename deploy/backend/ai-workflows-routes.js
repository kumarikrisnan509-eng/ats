/* eslint-disable */
// ai-workflows-routes.js — T99-A1 (critique) + T99-A4 (explain)
// Wraps the auto-router for two specific purposes:
//   POST /api/me/ai-workflows/critique  — A1 intraday signal critic (Sonnet)
//   POST /api/me/ai-workflows/explain   — A4 strategy plain-English (Haiku)
// Both go through ai-router (Day 2), enforce daily spend cap (Day 1 C1),
// log to ai_calls (Day 1 A3), and cache by prompt hash to avoid double-charging.

'use strict';

const crypto = require('crypto');
const aiRouter = require('./ai-router');
const { callLLM, estimateCost } = require('./ai-advisor');

const CACHE_MAX = 500;
const _cache = new Map();
function _cacheGet(k) { const h = _cache.get(k); if (!h) return null; _cache.delete(k); _cache.set(k, h); return h; }
function _cachePut(k, v) { _cache.set(k, v); if (_cache.size > CACHE_MAX) _cache.delete(_cache.keys().next().value); }
function _hashPrompt(parts) {
  const h = crypto.createHash('sha256');
  for (const p of parts) h.update(String(p == null ? '' : p) + ' ');
  return h.digest('hex').slice(0, 24);
}

function buildCritiquePrompt(c) {
  const system = `You are a senior NSE/BSE intraday risk advisor. Given one trading signal, return a SHORT JSON verdict.

Output STRICTLY this JSON:
{
  "verdict": "agree" | "caution" | "reject",
  "confidence": 0-100 (integer),
  "summary": "one sentence < 25 words",
  "key_risks": ["risk 1", "risk 2"] (at most 3),
  "next_step": "specific action the user should take next"
}

Guidance:
- "agree" only if the signal is technically sound AND the symbol context supports it.
- "caution" when the signal is valid but timing/size needs adjustment.
- "reject" for known false-positive patterns (RSI oversold on a falling-knife, EMA cross on restricted stock).
- Be skeptical. Most retail signals deserve "caution".
- DO NOT recommend specific position sizes or stop-loss levels — the strategy + risk engine handles that.
- Indian market: T+1 settlement, 20% circuits, SEBI surveillance categories matter.`;
  const user = `Signal: ${c.signal}
Symbol: ${c.symbol}
Value/level: ${c.value}
Scanner message: ${c.message}
Latest close (Rs): ${c.close == null ? 'unknown' : c.close}
Timeframe: ${c.timeframe || 'daily'}

Return JSON verdict only.`;
  return { system, user };
}

function buildExplainPrompt({ strategy }) {
  const system = `You are an Indian retail-trading educator. Explain a JSON strategy definition in plain English.

Output STRICTLY this JSON:
{
  "what_it_does": "one-sentence summary",
  "how_it_decides": "2-3 sentences on the signal logic in plain words",
  "when_it_works": "type of market regime the strategy is designed for",
  "when_it_fails": "common false-positive scenarios or risks",
  "example": "A worked example in INR using a NIFTY-50 stock"
}

Avoid code snippets, hyped language, specific entry/exit prices.`;
  const user = `Strategy definition:\n${JSON.stringify(strategy, null, 2)}`;
  return { system, user };
}

function _capCheck(db, userId, workflow, provider, model, est_cost_inr) {
  const cap = db.ai.dailyCapInr(userId);
  const spent = db.ai.dailySpend(userId);
  if (spent + est_cost_inr > cap) {
    try { db.ai.logCall({ user_id: userId, workflow, provider, model, prompt_tokens: 0, completion_tokens: 0, cost_inr: 0, status: 'blocked_by_cap', error: `cap Rs${cap} (spent Rs${spent.toFixed(2)})` }); } catch (_) {}
    return { blocked: true, cap_inr: cap, spent_inr: +spent.toFixed(2) };
  }
  return { blocked: false };
}

function createAiWorkflowsRouter({ db, vault, requireAuth, STRATEGIES }) {
  const express = require('express');
  const router = express.Router();
  router.use(express.json({ limit: '32kb' }));
  router.use(requireAuth);

  router.post('/critique', async (req, res) => {
    const b = req.body || {};
    const symbol = (b.symbol || '').toString().toUpperCase().trim();
    const signal = (b.signal || '').toString();
    if (!symbol || !signal) return res.status(400).json({ ok: false, reason: 'bad_request', detail: 'symbol + signal required' });

    try {
      const mode = b.mode || 'balanced';
      const cacheKey = _hashPrompt([req.user.id, 'critique', mode, symbol, signal, b.value, b.message]);
      const cached = _cacheGet(cacheKey);
      if (cached) return res.json({ ok: true, cached: true, ...cached.response, provider: cached.provider, model: cached.model, cost_inr: 0 });

      const routed = await aiRouter.route({ db, vault, userId: req.user.id, workflow: 'intraday_critic', mode });
      if (!routed.ok) return res.status(routed.reason === 'no_ai_key' ? 412 : 404).json(routed);

      const capCheck = _capCheck(db, req.user.id, 'intraday_critic', routed.provider, routed.model, routed.est_cost_inr);
      if (capCheck.blocked) return res.status(429).json({ ok: false, reason: 'spend_cap_exceeded', ...capCheck });

      const prompt = buildCritiquePrompt({ symbol, signal, value: b.value, message: b.message, close: b.close, timeframe: b.timeframe });
      const llmResult = await callLLM({ provider: routed.provider, apiKey: routed.apiKey, model: routed.model, prompt });
      const advice = (llmResult && llmResult.advice) ?? llmResult;
      const usage = (llmResult && llmResult.usage) || { prompt_tokens: 0, completion_tokens: 0 };
      const cost_inr = estimateCost({ provider: routed.provider, model: routed.model, prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens });

      try { db.ai.logCall({ user_id: req.user.id, workflow: 'intraday_critic', provider: routed.provider, model: routed.model, prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens, cost_inr, status: 'ok', error: null }); } catch (e) { console.warn('[ai-workflows] critique log:', e.message); }

      const norm = {
        verdict: ['agree','caution','reject'].includes(String(advice && advice.verdict).toLowerCase()) ? String(advice.verdict).toLowerCase() : 'caution',
        confidence: Math.max(0, Math.min(100, parseInt(advice && advice.confidence) || 50)),
        summary: String(advice && advice.summary || '').slice(0, 200),
        key_risks: Array.isArray(advice && advice.key_risks) ? advice.key_risks.slice(0, 3).map(x => String(x).slice(0, 200)) : [],
        next_step: String(advice && advice.next_step || '').slice(0, 300),
      };
      _cachePut(cacheKey, { ts: Date.now(), response: norm, cost_inr, provider: routed.provider, model: routed.model });
      res.json({ ok: true, cached: false, ...norm, provider: routed.provider, model: routed.model, cost_inr, usage });
    } catch (e) {
      try { db.ai.logCall({ user_id: req.user.id, workflow: 'intraday_critic', provider: null, model: null, prompt_tokens: 0, completion_tokens: 0, cost_inr: 0, status: 'error', error: (e && e.message || 'critique_failed').slice(0,200) }); } catch (_) {}
      res.status(500).json({ ok: false, reason: 'critique_failed', detail: e.message });
    }
  });

  router.post('/explain', async (req, res) => {
    const b = req.body || {};
    const strategy_id = (b.strategy_id || '').toString();
    if (!strategy_id) return res.status(400).json({ ok: false, reason: 'bad_request', detail: 'strategy_id required' });
    const strategy = (STRATEGIES || []).find(s => s.id === strategy_id);
    if (!strategy) return res.status(404).json({ ok: false, reason: 'strategy_not_found', detail: `Unknown strategy: ${strategy_id}` });

    try {
      const mode = b.mode || 'balanced';
      const cacheKey = _hashPrompt(['explain', mode, strategy_id, JSON.stringify(strategy.params || [])]);
      const cached = _cacheGet(cacheKey);
      if (cached) return res.json({ ok: true, cached: true, ...cached.response, provider: cached.provider, model: cached.model, cost_inr: 0 });

      const routed = await aiRouter.route({ db, vault, userId: req.user.id, workflow: 'strategy_explain', mode });
      if (!routed.ok) return res.status(routed.reason === 'no_ai_key' ? 412 : 404).json(routed);

      const capCheck = _capCheck(db, req.user.id, 'strategy_explain', routed.provider, routed.model, routed.est_cost_inr);
      if (capCheck.blocked) return res.status(429).json({ ok: false, reason: 'spend_cap_exceeded', ...capCheck });

      const prompt = buildExplainPrompt({ strategy });
      const llmResult = await callLLM({ provider: routed.provider, apiKey: routed.apiKey, model: routed.model, prompt });
      const advice = (llmResult && llmResult.advice) ?? llmResult;
      const usage = (llmResult && llmResult.usage) || { prompt_tokens: 0, completion_tokens: 0 };
      const cost_inr = estimateCost({ provider: routed.provider, model: routed.model, prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens });

      try { db.ai.logCall({ user_id: req.user.id, workflow: 'strategy_explain', provider: routed.provider, model: routed.model, prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens, cost_inr, status: 'ok', error: null }); } catch (e) { console.warn('[ai-workflows] explain log:', e.message); }

      const norm = {
        what_it_does: String(advice && advice.what_it_does || '').slice(0, 400),
        how_it_decides: String(advice && advice.how_it_decides || '').slice(0, 600),
        when_it_works: String(advice && advice.when_it_works || '').slice(0, 400),
        when_it_fails: String(advice && advice.when_it_fails || '').slice(0, 400),
        example: String(advice && advice.example || '').slice(0, 600),
      };
      _cachePut(cacheKey, { ts: Date.now(), response: norm, cost_inr, provider: routed.provider, model: routed.model });
      res.json({ ok: true, cached: false, ...norm, provider: routed.provider, model: routed.model, cost_inr, usage });
    } catch (e) {
      try { db.ai.logCall({ user_id: req.user.id, workflow: 'strategy_explain', provider: null, model: null, prompt_tokens: 0, completion_tokens: 0, cost_inr: 0, status: 'error', error: (e && e.message || 'explain_failed').slice(0,200) }); } catch (_) {}
      res.status(500).json({ ok: false, reason: 'explain_failed', detail: e.message });
    }
  });

  return router;
}

module.exports = { createAiWorkflowsRouter, buildCritiquePrompt, buildExplainPrompt };
