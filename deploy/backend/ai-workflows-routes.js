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

function createAiWorkflowsRouter({ db, vault, requireAuth, STRATEGIES, brokerResolver, surveillance }) {
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
      const mode = b.mode || db.ai.userMode(req.user.id);
      const cacheKey = _hashPrompt([req.user.id, 'critique', mode, symbol, signal, b.value, b.message]);
      const cached = _cacheGet(cacheKey);
      if (cached) return res.json({ ok: true, cached: true, ...cached.response, provider: cached.provider, model: cached.model, cost_inr: 0, call_id: cached.call_id || null });

      const routed = await aiRouter.route({ db, vault, userId: req.user.id, workflow: 'intraday_critic', mode });
      if (!routed.ok) return res.status(routed.reason === 'no_ai_key' ? 412 : 404).json(routed);

      const capCheck = _capCheck(db, req.user.id, 'intraday_critic', routed.provider, routed.model, routed.est_cost_inr);
      if (capCheck.blocked) return res.status(429).json({ ok: false, reason: 'spend_cap_exceeded', ...capCheck });

      const prompt = buildCritiquePrompt({ symbol, signal, value: b.value, message: b.message, close: b.close, timeframe: b.timeframe });
      const llmResult = await callLLM({ provider: routed.provider, apiKey: routed.apiKey, model: routed.model, prompt });
      const advice = (llmResult && llmResult.advice) ?? llmResult;
      const usage = (llmResult && llmResult.usage) || { prompt_tokens: 0, completion_tokens: 0 };
      const cost_inr = estimateCost({ provider: routed.provider, model: routed.model, prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens });

      let call_id = null; try { call_id = db.ai.logCall({ user_id: req.user.id, workflow: 'intraday_critic', provider: routed.provider, model: routed.model, prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens, cost_inr, status: 'ok', error: null }); } catch (e) { console.warn('[ai-workflows] critique log:', e.message); }

      const norm = {
        verdict: ['agree','caution','reject'].includes(String(advice && advice.verdict).toLowerCase()) ? String(advice.verdict).toLowerCase() : 'caution',
        confidence: Math.max(0, Math.min(100, parseInt(advice && advice.confidence) || 50)),
        summary: String(advice && advice.summary || '').slice(0, 200),
        key_risks: Array.isArray(advice && advice.key_risks) ? advice.key_risks.slice(0, 3).map(x => String(x).slice(0, 200)) : [],
        next_step: String(advice && advice.next_step || '').slice(0, 300),
      };
      _cachePut(cacheKey, { ts: Date.now(), response: norm, cost_inr, provider: routed.provider, model: routed.model, call_id });
      res.json({ ok: true, cached: false, ...norm, provider: routed.provider, model: routed.model, cost_inr, usage, call_id });
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
      const mode = b.mode || db.ai.userMode(req.user.id);
      const cacheKey = _hashPrompt(['explain', mode, strategy_id, JSON.stringify(strategy.params || [])]);
      const cached = _cacheGet(cacheKey);
      if (cached) return res.json({ ok: true, cached: true, ...cached.response, provider: cached.provider, model: cached.model, cost_inr: 0, call_id: cached.call_id || null });

      const routed = await aiRouter.route({ db, vault, userId: req.user.id, workflow: 'strategy_explain', mode });
      if (!routed.ok) return res.status(routed.reason === 'no_ai_key' ? 412 : 404).json(routed);

      const capCheck = _capCheck(db, req.user.id, 'strategy_explain', routed.provider, routed.model, routed.est_cost_inr);
      if (capCheck.blocked) return res.status(429).json({ ok: false, reason: 'spend_cap_exceeded', ...capCheck });

      const prompt = buildExplainPrompt({ strategy });
      const llmResult = await callLLM({ provider: routed.provider, apiKey: routed.apiKey, model: routed.model, prompt });
      const advice = (llmResult && llmResult.advice) ?? llmResult;
      const usage = (llmResult && llmResult.usage) || { prompt_tokens: 0, completion_tokens: 0 };
      const cost_inr = estimateCost({ provider: routed.provider, model: routed.model, prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens });

      let call_id = null; try { call_id = db.ai.logCall({ user_id: req.user.id, workflow: 'strategy_explain', provider: routed.provider, model: routed.model, prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens, cost_inr, status: 'ok', error: null }); } catch (e) { console.warn('[ai-workflows] explain log:', e.message); }

      const norm = {
        what_it_does: String(advice && advice.what_it_does || '').slice(0, 400),
        how_it_decides: String(advice && advice.how_it_decides || '').slice(0, 600),
        when_it_works: String(advice && advice.when_it_works || '').slice(0, 400),
        when_it_fails: String(advice && advice.when_it_fails || '').slice(0, 400),
        example: String(advice && advice.example || '').slice(0, 600),
      };
      _cachePut(cacheKey, { ts: Date.now(), response: norm, cost_inr, provider: routed.provider, model: routed.model, call_id });
      res.json({ ok: true, cached: false, ...norm, provider: routed.provider, model: routed.model, cost_inr, usage, call_id });
    } catch (e) {
      try { db.ai.logCall({ user_id: req.user.id, workflow: 'strategy_explain', provider: null, model: null, prompt_tokens: 0, completion_tokens: 0, cost_inr: 0, status: 'error', error: (e && e.message || 'explain_failed').slice(0,200) }); } catch (_) {}
      res.status(500).json({ ok: false, reason: 'explain_failed', detail: e.message });
    }
  });

  // --- A2: monthly review (on-demand; cron scheduling later) ---
  router.post('/monthly-review', async (req, res) => {
    const b = req.body || {};
    try {
      const mode = b.mode || db.ai.userMode(req.user.id);

      // Gather inputs: last 30 days of P&L + paper trades + factor exposure if available.
      const pnlRows = db.pnl.recent(req.user.id, 30) || [];
      let topMoves = { winners: [], losers: [] };
      try {
        const paperOrders = db.paper.listOrders(req.user.id) || [];
        const last30 = paperOrders.filter(o => {
          if (!o.created_at) return true;
          const t = new Date(o.created_at).getTime();
          return t >= Date.now() - 30 * 86400_000;
        });
        // Group P&L per symbol (paper trades only) — net contribution
        const bySym = new Map();
        for (const o of last30) {
          if (!o.fill_price || !o.qty) continue;
          const sign = (o.side === 'BUY') ? -1 : 1;
          const inr = sign * Number(o.fill_price) * Number(o.qty);
          bySym.set(o.symbol, (bySym.get(o.symbol) || 0) + inr);
        }
        const ranked = Array.from(bySym.entries()).map(([symbol, pnl]) => ({ symbol, pnl: +pnl.toFixed(2) }));
        ranked.sort((a, b) => b.pnl - a.pnl);
        topMoves = {
          winners: ranked.filter(r => r.pnl > 0).slice(0, 5),
          losers: ranked.filter(r => r.pnl < 0).slice(-5).reverse(),
        };
      } catch (_) {}

      // AI spend summary
      const spend30d = (() => {
        try {
          const rows = db.ai.byPeriod(req.user.id, '-30 days');
          return rows.reduce((acc, r) => acc + Number(r.cost || 0), 0);
        } catch (_) { return 0; }
      })();

      // Cache key — keyed by current month so two calls in the same month return identical work
      const yyyymm = new Date().toISOString().slice(0, 7);
      const cacheKey = _hashPrompt([req.user.id, 'monthly-review', yyyymm, mode]);
      const cached = _cacheGet(cacheKey);
      if (cached) return res.json({ ok: true, cached: true, ...cached.response, provider: cached.provider, model: cached.model, cost_inr: 0, call_id: cached.call_id || null });

      const routed = await aiRouter.route({ db, vault, userId: req.user.id, workflow: 'monthly_review', mode });
      if (!routed.ok) return res.status(routed.reason === 'no_ai_key' ? 412 : 404).json(routed);

      const capCheck = _capCheck(db, req.user.id, 'monthly_review', routed.provider, routed.model, routed.est_cost_inr);
      if (capCheck.blocked) return res.status(429).json({ ok: false, reason: 'spend_cap_exceeded', ...capCheck });

      const prompt = {
        system: `You are an Indian retail-trading coach reviewing one month of paper-trading activity. Output STRICTLY this JSON:
{
  "headline": "one-sentence verdict on the month",
  "what_went_well": ["bullet 1", "bullet 2"],
  "what_went_wrong": ["bullet 1", "bullet 2"],
  "patterns_observed": "2-3 sentences on what the data suggests about user's style (overtrading, narrow watchlist, late entries, etc.)",
  "suggested_focus": ["specific change 1 for next month", "specific change 2"],
  "ai_spend_assessment": "1 sentence on whether AI spend (Rs) bought useful guidance"
}
No code, no specific entry/exit prices, no Rs targets.`,
        user: `Paper trading P&L (last 30 days):
${JSON.stringify(pnlRows.slice(0, 30), null, 2)}

Top winners:
${JSON.stringify(topMoves.winners, null, 2)}

Top losers:
${JSON.stringify(topMoves.losers, null, 2)}

AI spend (last 30 days): Rs ${spend30d.toFixed(2)}

Return JSON review only.`,
      };

      const llmResult = await callLLM({ provider: routed.provider, apiKey: routed.apiKey, model: routed.model, prompt });
      const advice = (llmResult && llmResult.advice) ?? llmResult;
      const usage = (llmResult && llmResult.usage) || { prompt_tokens: 0, completion_tokens: 0 };
      const cost_inr = estimateCost({ provider: routed.provider, model: routed.model, prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens });

      let call_id = null; try { call_id = db.ai.logCall({ user_id: req.user.id, workflow: 'monthly_review', provider: routed.provider, model: routed.model, prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens, cost_inr, status: 'ok', error: null }); } catch (e) { console.warn('[ai-workflows] monthly_review log:', e.message); }

      const norm = {
        headline: String(advice && advice.headline || '').slice(0, 300),
        what_went_well: Array.isArray(advice && advice.what_went_well) ? advice.what_went_well.slice(0, 5).map(x => String(x).slice(0, 300)) : [],
        what_went_wrong: Array.isArray(advice && advice.what_went_wrong) ? advice.what_went_wrong.slice(0, 5).map(x => String(x).slice(0, 300)) : [],
        patterns_observed: String(advice && advice.patterns_observed || '').slice(0, 800),
        suggested_focus: Array.isArray(advice && advice.suggested_focus) ? advice.suggested_focus.slice(0, 5).map(x => String(x).slice(0, 300)) : [],
        ai_spend_assessment: String(advice && advice.ai_spend_assessment || '').slice(0, 300),
        // Echo inputs for transparency
        inputs: { pnl_days: pnlRows.length, winners: topMoves.winners.length, losers: topMoves.losers.length, ai_spend_inr: +spend30d.toFixed(2) },
        period: yyyymm,
      };
      _cachePut(cacheKey, { ts: Date.now(), response: norm, cost_inr, provider: routed.provider, model: routed.model, call_id });
      res.json({ ok: true, cached: false, ...norm, provider: routed.provider, model: routed.model, cost_inr, usage, call_id });
    } catch (e) {
      try { db.ai.logCall({ user_id: req.user.id, workflow: 'monthly_review', provider: null, model: null, prompt_tokens: 0, completion_tokens: 0, cost_inr: 0, status: 'error', error: (e && e.message || 'monthly_review_failed').slice(0,200) }); } catch (_) {}
      res.status(500).json({ ok: false, reason: 'monthly_review_failed', detail: e.message });
    }
  });

  // --- Phase 2 / E6: enriched critique that fetches market context server-side ---
  // POST /api/me/ai-workflows/critique-rich
  // Body: { symbol, signal, value?, message?, mode? }
  // Gathers regime + recent 5d close/volume + RSI + surveillance status,
  // then calls the SAME workflow (intraday_critic) with a fuller prompt.
  router.post('/critique-rich', async (req, res) => {
    const b = req.body || {};
    const symbol = (b.symbol || '').toString().toUpperCase().trim();
    const signal = (b.signal || '').toString();
    if (!symbol || !signal) return res.status(400).json({ ok: false, reason: 'bad_request', detail: 'symbol + signal required' });

    try {
      const mode = b.mode || db.ai.userMode(req.user.id);

      // 1. Resolve broker for THIS user (per-user OAuth)
      let candles = null;
      let bench = null;
      let regime = null;
      try {
        if (brokerResolver) {
          const r = await brokerResolver.resolveForRequest({ db, vault, globalBroker: null, fallbackToGlobal: false }, req);
          if (r && r.broker) {
            const today = new Date();
            const from = new Date(today.getTime() - 90 * 86400 * 1000).toISOString().slice(0, 10);
            const to   = today.toISOString().slice(0, 10);
            candles = await r.broker.getHistorical({ symbol, interval: 'day', from, to }).catch(() => null);
            // Benchmark: NIFTY 50 same window — small extra call, big context value
            bench = await r.broker.getHistorical({ symbol: 'NIFTY 50', interval: 'day', from, to }).catch(() => null);
          }
        }
      } catch (e) { console.warn('[critique-rich] broker fetch failed:', e.message); }

      // 2. Regime from candles (uses existing classifyRegime in scanner.js)
      try {
        const { classifyRegime, rsi } = require('./scanner');
        if (Array.isArray(candles) && candles.length >= 50) {
          regime = classifyRegime(candles);
        }
      } catch (e) { console.warn('[critique-rich] regime classify failed:', e.message); }

      // 3. Surveillance verdict (re-uses Day 1 gate)
      let surveillanceVerdict = null;
      try {
        if (surveillance) surveillanceVerdict = surveillance.classifySync(symbol);
      } catch (_) {}

      // 4. Recent trend summary (last 5 daily closes + volumes)
      const recent = (() => {
        if (!Array.isArray(candles) || candles.length < 5) return null;
        const last5 = candles.slice(-5);
        const pctMove = +(((last5[4].close - last5[0].close) / last5[0].close) * 100).toFixed(2);
        const avgVol = Math.round(last5.reduce((s, c) => s + (c.volume || 0), 0) / 5);
        return {
          last_5_closes: last5.map(c => +Number(c.close).toFixed(2)),
          last_5_vols:   last5.map(c => Number(c.volume || 0)),
          pct_move_5d:   pctMove,
          avg_vol_5d:    avgVol,
        };
      })();

      // 5. Benchmark same-window move
      const benchMove = (() => {
        if (!Array.isArray(bench) || bench.length < 2) return null;
        const first = bench[0].close, last = bench[bench.length - 1].close;
        const days = bench.length;
        return { days, pct_move: +(((last - first) / first) * 100).toFixed(2), last_close: +Number(last).toFixed(2) };
      })();

      // 6. RSI now
      let rsi_now = null;
      try {
        const { rsi } = require('./scanner');
        if (Array.isArray(candles) && candles.length >= 20) {
          const closes = candles.map(c => c.close);
          const series = rsi(closes, 14);
          const v = series[series.length - 1];
          if (Number.isFinite(v)) rsi_now = +v.toFixed(2);
        }
      } catch (_) {}

      // 7. Cache key includes today's date so a re-click later same day with same context is free,
      //    but tomorrow's context (different candles) bypasses
      const today = new Date().toISOString().slice(0, 10);
      const cacheKey = _hashPrompt([req.user.id, 'critique-rich', mode, symbol, signal, b.value, today]);
      const cached = _cacheGet(cacheKey);
      if (cached) return res.json({ ok: true, cached: true, ...cached.response, provider: cached.provider, model: cached.model, cost_inr: 0, call_id: cached.call_id || null });

      // 8. Route + cap
      const routed = await aiRouter.route({ db, vault, userId: req.user.id, workflow: 'intraday_critic', mode });
      if (!routed.ok) return res.status(routed.reason === 'no_ai_key' ? 412 : 404).json(routed);

      const capCheck = _capCheck(db, req.user.id, 'intraday_critic', routed.provider, routed.model, routed.est_cost_inr);
      if (capCheck.blocked) return res.status(429).json({ ok: false, reason: 'spend_cap_exceeded', ...capCheck });

      // 9. Enriched prompt
      const ctx = {
        symbol, signal,
        value: b.value ?? null,
        message: b.message ?? '',
        close: recent ? recent.last_5_closes[recent.last_5_closes.length - 1] : (b.close ?? null),
        timeframe: 'daily',
      };
      const prompt = buildCritiquePrompt(ctx);
      // Append the enriched context block to user prompt (not system, so verdict format stays stable)
      const enrichedUser = prompt.user + `

----- Additional market context -----
Market regime: ${regime ? `${regime.regime} (confidence ${regime.confidence}) — ${regime.reason}` : 'unknown'}
Symbol RSI(14) now: ${rsi_now == null ? 'unknown' : rsi_now}
Symbol last 5d closes: ${recent ? JSON.stringify(recent.last_5_closes) : 'unknown'}
Symbol last 5d volumes: ${recent ? JSON.stringify(recent.last_5_vols) : 'unknown'}
Symbol 5d move: ${recent ? recent.pct_move_5d + '%' : 'unknown'}
NIFTY 50 ${benchMove ? benchMove.days + 'd move' : 'recent move'}: ${benchMove ? benchMove.pct_move + '%' : 'unknown'}
Surveillance status: ${surveillanceVerdict ? `${surveillanceVerdict.list} (${surveillanceVerdict.reason})` : 'clean'}

Be MORE skeptical when:
- the symbol is in a different regime than NIFTY (e.g. symbol in high_vol while index in trending_up)
- the symbol's 5d move is already >5% in the direction the signal suggests
- surveillance is non-clean (this should usually flip verdict to reject)

Return JSON verdict only.`;
      const fullPrompt = { system: prompt.system, user: enrichedUser };

      const llmResult = await callLLM({ provider: routed.provider, apiKey: routed.apiKey, model: routed.model, prompt: fullPrompt });
      const advice = (llmResult && llmResult.advice) ?? llmResult;
      const usage = (llmResult && llmResult.usage) || { prompt_tokens: 0, completion_tokens: 0 };
      const cost_inr = estimateCost({ provider: routed.provider, model: routed.model, prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens });

      let call_id = null;
      try { call_id = db.ai.logCall({ user_id: req.user.id, workflow: 'intraday_critic', provider: routed.provider, model: routed.model, prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens, cost_inr, status: 'ok', error: null }); } catch (e) { console.warn('[ai-workflows] critique-rich log:', e.message); }

      const norm = {
        verdict: ['agree','caution','reject'].includes(String(advice && advice.verdict).toLowerCase()) ? String(advice.verdict).toLowerCase() : 'caution',
        confidence: Math.max(0, Math.min(100, parseInt(advice && advice.confidence) || 50)),
        summary: String(advice && advice.summary || '').slice(0, 200),
        key_risks: Array.isArray(advice && advice.key_risks) ? advice.key_risks.slice(0, 3).map(x => String(x).slice(0, 200)) : [],
        next_step: String(advice && advice.next_step || '').slice(0, 300),
        context: {
          regime: regime ? { regime: regime.regime, confidence: regime.confidence, reason: regime.reason } : null,
          rsi_now,
          pct_move_5d: recent ? recent.pct_move_5d : null,
          bench_pct_move: benchMove ? benchMove.pct_move : null,
          surveillance: surveillanceVerdict,
        },
      };
      _cachePut(cacheKey, { ts: Date.now(), response: norm, cost_inr, provider: routed.provider, model: routed.model, call_id });
      res.json({ ok: true, cached: false, ...norm, provider: routed.provider, model: routed.model, cost_inr, usage, call_id });
    } catch (e) {
      try { db.ai.logCall({ user_id: req.user.id, workflow: 'intraday_critic', provider: null, model: null, prompt_tokens: 0, completion_tokens: 0, cost_inr: 0, status: 'error', error: (e && e.message || 'critique_rich_failed').slice(0, 200) }); } catch (_) {}
      res.status(500).json({ ok: false, reason: 'critique_rich_failed', detail: e.message });
    }
  });

  // --- T-I5: per-call feedback (thumbs up/down) ---
  router.put('/feedback/:call_id', (req, res) => {
    const callId = parseInt(req.params.call_id, 10);
    const b = req.body || {};
    const feedback = b.feedback === 'up' || b.feedback === 'down' ? b.feedback : null;
    if (!callId || !feedback) return res.status(400).json({ ok: false, reason: 'bad_request', detail: 'call_id + feedback=up|down required' });
    try {
      const row = db.ai.getCall(req.user.id, callId);
      if (!row) return res.status(404).json({ ok: false, reason: 'call_not_found' });
      db.ai.setFeedback(req.user.id, callId, feedback);
      res.json({ ok: true, call_id: callId, feedback });
    } catch (e) {
      res.status(500).json({ ok: false, reason: 'feedback_failed', detail: e.message });
    }
  });

  // --- T-I5: recent thumbs-down for review ---
  router.get('/feedback/recent-down', (req, res) => {
    try {
      const rows = db.ai.recentDown(req.user.id, parseInt(req.query.limit || '20', 10));
      const counts = db.ai.feedbackCounts(req.user.id, '-30 days');
      const sum = { up: 0, down: 0 };
      for (const c of counts) { if (c.verdict === 'up') sum.up = c.n; else if (c.verdict === 'down') sum.down = c.n; }
      res.json({ ok: true, recent_down: rows, counts_30d: sum });
    } catch (e) {
      res.status(500).json({ ok: false, reason: 'feedback_recent_failed', detail: e.message });
    }
  });

  return router;
}

module.exports = { createAiWorkflowsRouter, buildCritiquePrompt, buildExplainPrompt };
