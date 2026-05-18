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
const { callLLM, callLLMVision, estimateCost, redactRupees, redactPayload } = require('./ai-advisor');
const { sectorOf } = require('./sector-map');   // T99-T127 (v11-E6)

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

function createAiWorkflowsRouter({ db, vault, requireAuth, STRATEGIES, brokerResolver, surveillance, earningsCal, bulkDeals, mfData }) {
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

      let call_id = null; try { call_id = db.ai.logCall({ user_id: req.user.id, workflow: 'intraday_critic', provider: routed.provider, model: routed.model, prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens, cost_inr, status: 'ok', error: null, context_tag: symbol, verdict: norm && norm.verdict }); } catch (e) { console.warn('[ai-workflows] critique log:', e.message); }

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

      let call_id = null; try { call_id = db.ai.logCall({ user_id: req.user.id, workflow: 'strategy_explain', provider: routed.provider, model: routed.model, prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens, cost_inr, status: 'ok', error: null, context_tag: strategy_id, verdict: null }); } catch (e) { console.warn('[ai-workflows] explain log:', e.message); }

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

      // H5: redact rupee figures when user opted in (default on)
      const _prefs = (() => { try { return db.prefs.get(req.user.id); } catch (_) { return { redact_pii: 1 }; } })();
      const _redact = !!_prefs.redact_pii;
      const _pnlRedacted = _redact ? redactPayload(pnlRows) : pnlRows;
      const _winnersRedacted = _redact ? topMoves.winners.map(w => ({ symbol: w.symbol, pnl: redactRupees(w.pnl) })) : topMoves.winners;
      const _losersRedacted = _redact ? topMoves.losers.map(w => ({ symbol: w.symbol, pnl: redactRupees(w.pnl) })) : topMoves.losers;
      const _spendStr = _redact ? redactRupees(spend30d * 100000) /* convert to scale before bucket */ : `Rs ${spend30d.toFixed(2)}`;
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
        user: `Paper trading P&L (last 30 days)${_redact ? ' (rupee values bucketed for privacy)' : ''}:
${JSON.stringify(_pnlRedacted.slice(0, 30), null, 2)}

Top winners:
${JSON.stringify(_winnersRedacted, null, 2)}

Top losers:
${JSON.stringify(_losersRedacted, null, 2)}

AI spend (last 30 days): ${_redact ? _spendStr : `Rs ${spend30d.toFixed(2)}`}

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

      // 3b. Upcoming corporate events (E4)
      let earningsContext = null;
      try {
        if (earningsCal) {
          const events = await earningsCal.forSymbol(symbol, { days: 45 });
          if (events && events.length) {
            const next = events[0];
            earningsContext = {
              days_until: next.days_until,
              category: next.category,
              purpose: next.purpose.slice(0, 120),
              count_within_45d: events.length,
            };
          }
        }
      } catch (e) { /* non-fatal */ }

      // 3c. Bulk/block deals for this symbol today (E8)
      // H8: if an active experiment toggles bulk-deals on/off, honor it deterministically.
      const _exp = (() => { try { return db.ai.experimentActiveForWorkflow(req.user.id, 'intraday_critic'); } catch (_) { return null; } })();
      let _variant = null;
      let _includeBulkDeals = true;
      if (_exp) {
        // Deterministic per-(user,symbol,today) bucket — same call replays into the same variant
        const h = _hashPrompt([req.user.id, _exp.id, symbol, today]);
        _variant = (parseInt(h.slice(0, 8), 16) % 2) === 0 ? 'a' : 'b';
        // Convention for the first built-in experiment: 'with-bulk-deals' (a) vs 'without-bulk-deals' (b)
        if (_exp.name === 'with-vs-without-bulk-deals' && _variant === 'b') _includeBulkDeals = false;
      }
      let bulkDealsContext = null;
      try {
        if (bulkDeals && _includeBulkDeals) {
          const deals = await bulkDeals.forSymbol(symbol);
          if (deals && deals.length) {
            const buyCr = deals.filter(d => d.side === 'BUY').reduce((s, d) => s + (d.inr_value || 0), 0) / 1e7;
            const sellCr = deals.filter(d => d.side === 'SELL').reduce((s, d) => s + (d.inr_value || 0), 0) / 1e7;
            bulkDealsContext = {
              count: deals.length,
              buy_cr: +buyCr.toFixed(2),
              sell_cr: +sellCr.toFixed(2),
              net_cr: +(buyCr - sellCr).toFixed(2),
              top_clients: deals.slice(0, 3).map(d => `${d.side} ${(d.inr_value/1e7).toFixed(1)}Cr by ${(d.client||'?').slice(0,40)}`),
            };
          }
        }
      } catch (e) { /* non-fatal */ }

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

      // 7a. T99-T127 (v11-E6): sector context. Useful for "TCS is IT, IT sector
      // has been weak vs broader market" kind of reasoning. Static lookup table
      // covers NIFTY 200; null for less liquid names is fine, AI just won't see
      // the sector line.
      const symbolSector = sectorOf(symbol);

      // 7. Cache key includes today's date so a re-click later same day with same context is free,
      //    but tomorrow's context (different candles) bypasses
      const today = new Date().toISOString().slice(0, 10);
      const cacheKey = _hashPrompt([req.user.id, 'critique-rich-v2', mode, symbol, signal, b.value, today, symbolSector || '']);
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
Upcoming corporate event: ${earningsContext ? `${earningsContext.category} in ${earningsContext.days_until} day(s) -- ${earningsContext.purpose}` : 'none in next 45 days'}
Today's bulk/block deals: ${bulkDealsContext ? `${bulkDealsContext.count} deals, net ${bulkDealsContext.net_cr >= 0 ? '+' : ''}${bulkDealsContext.net_cr}Cr — top: ${bulkDealsContext.top_clients.join(' | ')}` : 'none'}
Symbol sector: ${symbolSector || 'unclassified (not in NIFTY 200 sector map)'}

Be MORE skeptical when:
- the symbol is in a different regime than NIFTY (e.g. symbol in high_vol while index in trending_up)
- the symbol's 5d move is already >5% in the direction the signal suggests
- surveillance is non-clean (this should usually flip verdict to reject)
- a financial-results / dividend / fund-raising event is within 3 days (intraday trades into earnings carry asymmetric overnight risk)
- institutional flow today is opposite to the signal (e.g. signal is BUY but bulk deals show large institutional SELL)

Return JSON verdict only.`;
      const fullPrompt = { system: prompt.system, user: enrichedUser };

      const llmResult = await callLLM({ provider: routed.provider, apiKey: routed.apiKey, model: routed.model, prompt: fullPrompt });
      const advice = (llmResult && llmResult.advice) ?? llmResult;
      const usage = (llmResult && llmResult.usage) || { prompt_tokens: 0, completion_tokens: 0 };
      const cost_inr = estimateCost({ provider: routed.provider, model: routed.model, prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens });

      let call_id = null;
      try { call_id = db.ai.logCall({ user_id: req.user.id, workflow: 'intraday_critic', provider: routed.provider, model: routed.model, prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens, cost_inr, status: 'ok', error: null, context_tag: symbol, verdict: norm && norm.verdict, experiment_id: _exp ? _exp.id : null, variant: _variant }); } catch (e) { console.warn('[ai-workflows] critique-rich log:', e.message); }

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
          earnings: earningsContext,
          bulk_deals: bulkDealsContext,
        },
      };
      _cachePut(cacheKey, { ts: Date.now(), response: norm, cost_inr, provider: routed.provider, model: routed.model, call_id });
      res.json({ ok: true, cached: false, ...norm, provider: routed.provider, model: routed.model, cost_inr, usage, call_id });
    } catch (e) {
      try { db.ai.logCall({ user_id: req.user.id, workflow: 'intraday_critic', provider: null, model: null, prompt_tokens: 0, completion_tokens: 0, cost_inr: 0, status: 'error', error: (e && e.message || 'critique_rich_failed').slice(0, 200) }); } catch (_) {}
      res.status(500).json({ ok: false, reason: 'critique_rich_failed', detail: e.message });
    }
  });

  // --- mf_pick: AI-assisted mutual fund picker (uses G8 scheme master + NAV history) ---
  router.post('/mf-pick', async (req, res) => {
    const b = req.body || {};
    const query = (b.query || '').toString().trim();
    if (!query || query.length < 2) return res.status(400).json({ ok: false, reason: 'bad_request', detail: 'query (>=2 chars) required' });

    try {
      const mode = b.mode || db.ai.userMode(req.user.id);
      const horizon = Math.max(1, Math.min(20, parseInt(b.horizon_years || '5', 10)));

      // Cache key — query + today + horizon + mode. Re-searching the same in the same day is free.
      const today = new Date().toISOString().slice(0, 10);
      const cacheKey = _hashPrompt([req.user.id, 'mf-pick', mode, query, b.category || '', horizon, today]);
      const cached = _cacheGet(cacheKey);
      if (cached) return res.json({ ok: true, cached: true, ...cached.response, provider: cached.provider, model: cached.model, cost_inr: 0, call_id: cached.call_id || null });

      if (!mfData) return res.status(503).json({ ok: false, reason: 'mf_data_not_ready' });

      // 1. Search scheme master for matches
      const matches = await mfData.search(query, { limit: 10 });
      if (!matches.length) {
        return res.json({ ok: true, query, count: 0, schemes: [], picks: [], note: 'No schemes matched. Try fewer / different keywords.' });
      }

      // 2. Pull NAV history for top 5 (limit fanout to MFAPI)
      const topFive = matches.slice(0, 5);
      const navs = await Promise.all(topFive.map(s => mfData.navHistory(s.code).catch(e => ({ error: e.message, code: s.code }))));

      // 3. Compute CAGR over 1/3/5y where data exists
      const computeCagr = (history, years) => {
        if (!history || !Array.isArray(history.navs) || history.navs.length < 30) return null;
        const today = history.navs[0];
        const targetDays = years * 365;
        // Find nav closest to (today - targetDays) ago
        let best = null, bestDelta = Infinity;
        for (const n of history.navs) {
          const dDays = (Date.parse(today.date.split('-').reverse().join('-')) - Date.parse(n.date.split('-').reverse().join('-'))) / 86400_000;
          const delta = Math.abs(dDays - targetDays);
          if (delta < bestDelta) { bestDelta = delta; best = n; }
          if (dDays > targetDays + 30) break;     // sorted oldest-last; stop once past window
        }
        if (!best || bestDelta > 60 || best.nav <= 0 || today.nav <= 0) return null;
        const yrs = Math.max(0.5, (Date.parse(today.date.split('-').reverse().join('-')) - Date.parse(best.date.split('-').reverse().join('-'))) / 86400_000 / 365);
        return +(((Math.pow(today.nav / best.nav, 1 / yrs) - 1) * 100).toFixed(2));
      };

      const enriched = topFive.map((s, i) => {
        const h = navs[i];
        if (!h || h.error) return { code: s.code, name: s.name, amc: s.amc, error: h?.error || 'nav fetch failed' };
        return {
          code: s.code,
          name: h.scheme_name || s.name,
          amc: h.fund_house || s.amc,
          category: h.scheme_category || s.category,
          latest_nav: h.navs[0]?.nav,
          latest_nav_date: h.navs[0]?.date,
          cagr_1y: computeCagr(h, 1),
          cagr_3y: computeCagr(h, 3),
          cagr_5y: computeCagr(h, 5),
          nav_data_points: h.navs.length,
        };
      });

      // 4. Route + spend cap
      const routed = await aiRouter.route({ db, vault, userId: req.user.id, workflow: 'mf_pick', mode });
      if (!routed.ok) return res.status(routed.reason === 'no_ai_key' ? 412 : 404).json(routed);

      const capCheck = _capCheck(db, req.user.id, 'mf_pick', routed.provider, routed.model, routed.est_cost_inr);
      if (capCheck.blocked) return res.status(429).json({ ok: false, reason: 'spend_cap_exceeded', ...capCheck });

      // 5. Prompt
      const prompt = {
        system: `You are an experienced Indian mutual-fund analyst. Given 5 candidate funds and a user's horizon, pick the BEST 1-3 with plain English reasoning.

Output STRICTLY this JSON:
{
  "headline": "one-sentence verdict about the user's query",
  "picks": [
    {
      "code": <scheme code>,
      "rank": 1-3,
      "why": "one-sentence reason (mention CAGR, category fit, or risk profile)",
      "caveat": "one-sentence risk/limitation"
    }
  ],
  "discarded": [<list of scheme codes you rejected and why, max 2 entries>],
  "general_advice": "one sentence about how to interpret these for the user's horizon"
}

Be strict:
- Never recommend a fund without >=3y of NAV history.
- Prefer Direct plans over Regular (lower expense ratio).
- For horizon <2y prefer Liquid / Ultra Short / Money Market category.
- For horizon 3-5y prefer Hybrid / Large+Mid Cap / ELSS.
- For horizon >5y prefer Flexi Cap / Mid Cap / Small Cap / Sector funds.
- Past performance is not a guarantee. Always include caveat.`,
        user: `User query: ${query}
Category filter: ${b.category || 'none'}
Horizon: ${horizon} years

Candidate funds with metrics (NAV in Rs, CAGR in %):
${JSON.stringify(enriched, null, 2)}

Return JSON only.`,
      };

      const llmResult = await callLLM({ provider: routed.provider, apiKey: routed.apiKey, model: routed.model, prompt });
      const advice = (llmResult && llmResult.advice) ?? llmResult;
      const usage = (llmResult && llmResult.usage) || { prompt_tokens: 0, completion_tokens: 0 };
      const cost_inr = estimateCost({ provider: routed.provider, model: routed.model, prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens });

      let call_id = null;
      try { call_id = db.ai.logCall({ user_id: req.user.id, workflow: 'mf_pick', provider: routed.provider, model: routed.model, prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens, cost_inr, status: 'ok', error: null }); } catch (e) { console.warn('[ai-workflows] mf-pick log:', e.message); }

      const norm = {
        query, category: b.category || null, horizon_years: horizon,
        headline: String(advice && advice.headline || '').slice(0, 300),
        picks: Array.isArray(advice && advice.picks) ? advice.picks.slice(0, 3).map(p => ({
          code: p.code,
          rank: Math.max(1, Math.min(3, parseInt(p.rank) || 1)),
          why: String(p.why || '').slice(0, 300),
          caveat: String(p.caveat || '').slice(0, 300),
        })) : [],
        discarded: Array.isArray(advice && advice.discarded) ? advice.discarded.slice(0, 2) : [],
        general_advice: String(advice && advice.general_advice || '').slice(0, 400),
        candidates: enriched,
      };

      _cachePut(cacheKey, { ts: Date.now(), response: norm, cost_inr, provider: routed.provider, model: routed.model, call_id });
      res.json({ ok: true, cached: false, ...norm, provider: routed.provider, model: routed.model, cost_inr, usage, call_id });
    } catch (e) {
      try { db.ai.logCall({ user_id: req.user.id, workflow: 'mf_pick', provider: null, model: null, prompt_tokens: 0, completion_tokens: 0, cost_inr: 0, status: 'error', error: (e && e.message || 'mf_pick_failed').slice(0,200) }); } catch (_) {}
      res.status(500).json({ ok: false, reason: 'mf_pick_failed', detail: e.message });
    }
  });

  // --- D1: multi-provider consensus (Anthropic + OpenAI + Gemini in parallel) ---
  // Higher-stakes alternative to /critique. Runs the same prompt across all three
  // providers, returns each verdict + the majority. Triple cost — only worth firing
  // for live-trade critiques or final monthly verdicts.
  router.post('/consensus', async (req, res) => {
    const b = req.body || {};
    const symbol = (b.symbol || '').toString().toUpperCase().trim();
    const signal = (b.signal || '').toString();
    if (!symbol || !signal) return res.status(400).json({ ok: false, reason: 'bad_request', detail: 'symbol + signal required' });

    try {
      // Cache key — symbol+signal+today; same day re-clicks return free
      const today = new Date().toISOString().slice(0, 10);
      const cacheKey = _hashPrompt([req.user.id, 'consensus', today, symbol, signal, b.value, b.message]);
      const cached = _cacheGet(cacheKey);
      if (cached) return res.json({ ok: true, cached: true, ...cached.response, cost_inr: 0 });

      // Discover which provider keys the user has — only consult providers with keys
      const keys = db._conn.prepare("SELECT provider, sealed_key, model_pref FROM ai_keys WHERE user_id = ?").all(req.user.id);
      if (keys.length < 2) {
        return res.status(412).json({ ok: false, reason: 'need_two_providers', detail: 'Consensus needs at least 2 BYOK providers configured. Add another key in Settings.' });
      }

      // Per-call budget check across the providers we're about to invoke
      const cap = db.ai.dailyCapInr(req.user.id);
      const alreadySpent = db.ai.dailySpend(req.user.id);
      // Rough est: 3x the single-call STRONG budget
      const budget = 3 * (require('./ai-advisor').estimateCostBudget({ provider: 'anthropic', model: 'claude-sonnet-4-6', expectedInTokens: 800, expectedOutTokens: 500 }));
      if (alreadySpent + budget > cap) {
        try { db.ai.logCall({ user_id: req.user.id, workflow: 'consensus', provider: 'multi', model: null, prompt_tokens: 0, completion_tokens: 0, cost_inr: 0, status: 'blocked_by_cap', error: `cap Rs${cap}`, context_tag: symbol, verdict: null }); } catch (_) {}
        return res.status(429).json({ ok: false, reason: 'spend_cap_exceeded', cap_inr: cap, spent_inr: +alreadySpent.toFixed(2) });
      }

      // Build the prompt once; run across providers in parallel
      const prompt = buildCritiquePrompt({ symbol, signal, value: b.value, message: b.message, close: b.close, timeframe: b.timeframe });

      const runOne = async (keyRow) => {
        // Map provider -> STRONG-family model
        const FAMILY_STRONG = { anthropic: 'claude-sonnet-4-6', openai: 'gpt-5', gemini: 'gemini-3.1-pro-preview' };
        const model = FAMILY_STRONG[keyRow.provider] || keyRow.model_pref;
        const apiKey = await vault.open(keyRow.sealed_key);
        try {
          const llmResult = await callLLM({ provider: keyRow.provider, apiKey, model, prompt });
          const advice = (llmResult && llmResult.advice) ?? llmResult;
          const usage = (llmResult && llmResult.usage) || { prompt_tokens: 0, completion_tokens: 0 };
          const cost_inr = estimateCost({ provider: keyRow.provider, model, prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens });
          const verdict = ['agree','caution','reject'].includes(String(advice && advice.verdict).toLowerCase()) ? String(advice.verdict).toLowerCase() : 'caution';
          let call_id = null;
          try { call_id = db.ai.logCall({ user_id: req.user.id, workflow: 'consensus', provider: keyRow.provider, model, prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens, cost_inr, status: 'ok', error: null, context_tag: symbol, verdict }); } catch (_) {}
          return { provider: keyRow.provider, model, verdict, confidence: Math.max(0, Math.min(100, parseInt(advice && advice.confidence) || 50)), summary: String(advice && advice.summary || '').slice(0, 200), cost_inr, call_id, usage };
        } catch (e) {
          try { db.ai.logCall({ user_id: req.user.id, workflow: 'consensus', provider: keyRow.provider, model, prompt_tokens: 0, completion_tokens: 0, cost_inr: 0, status: 'error', error: (e.message || 'failed').slice(0,200), context_tag: symbol, verdict: null }); } catch (_) {}
          return { provider: keyRow.provider, model, error: e.message.slice(0, 200) };
        }
      };

      const results = await Promise.all(keys.map(runOne));
      const valid = results.filter(r => r.verdict);
      if (!valid.length) return res.status(502).json({ ok: false, reason: 'all_providers_failed', results });

      // Tally majority — caution counts both ways for the tiebreak
      const tally = { agree: 0, caution: 0, reject: 0 };
      for (const r of valid) tally[r.verdict] += 1;
      const majority = Object.entries(tally).sort((a, b) => b[1] - a[1])[0][0];
      const agreement = tally[majority] / valid.length;
      const total_cost = +valid.reduce((s, r) => s + (r.cost_inr || 0), 0).toFixed(4);

      const norm = {
        symbol, signal,
        providers_consulted: results.length,
        providers_succeeded: valid.length,
        majority,
        agreement_strength: +agreement.toFixed(2),
        tally,
        per_provider: results,
        total_cost_inr: total_cost,
        verdict_note: agreement === 1 ? 'unanimous' :
                      agreement >= 0.66 ? 'strong-majority' :
                      'split — treat with extra caution',
      };
      _cachePut(cacheKey, { ts: Date.now(), response: norm });

      res.json({ ok: true, cached: false, ...norm });
    } catch (e) {
      res.status(500).json({ ok: false, reason: 'consensus_failed', detail: e.message });
    }
  });

  // --- D2: strategy auto-tuner — run grid search over last 90d + ask AI to summarise ---
  router.post('/auto-tune', async (req, res) => {
    const b = req.body || {};
    const strategy_id = (b.strategy_id || '').toString();
    const symbol = (b.symbol || 'NIFTY 50').toString().toUpperCase();
    if (!strategy_id) return res.status(400).json({ ok: false, reason: 'bad_request', detail: 'strategy_id required' });

    const strategy = (STRATEGIES || []).find(x => x.id === strategy_id);
    if (!strategy) return res.status(404).json({ ok: false, reason: 'strategy_not_found' });
    if (!brokerResolver) return res.status(503).json({ ok: false, reason: 'broker_resolver_not_ready' });

    try {
      const mode = b.mode || db.ai.userMode(req.user.id);

      // Cache key — same (strategy, symbol) within a week returns cached
      const week = Math.floor(Date.now() / (7 * 86400_000));
      const cacheKey = _hashPrompt([req.user.id, 'auto-tune', mode, strategy_id, symbol, week]);
      const cached = _cacheGet(cacheKey);
      if (cached) return res.json({ ok: true, cached: true, ...cached.response, provider: cached.provider, model: cached.model, cost_inr: 0, call_id: cached.call_id || null });

      // 1. Resolve user broker + pull last 120 days of daily candles
      const r = await brokerResolver.resolveForRequest({ db, vault, globalBroker: null, fallbackToGlobal: false }, req);
      if (!r || !r.broker) return res.status(412).json({ ok: false, reason: 'broker_not_connected', detail: 'Connect Zerodha to run auto-tune' });

      const today = new Date();
      const from = new Date(today.getTime() - 120 * 86400_000).toISOString().slice(0, 10);
      const to = today.toISOString().slice(0, 10);
      const candles = await r.broker.getHistorical({ symbol, interval: 'day', from, to }).catch(() => null);
      if (!Array.isArray(candles) || candles.length < 60) {
        return res.status(400).json({ ok: false, reason: 'insufficient_data', detail: `need >=60 candles, got ${candles?.length || 0}` });
      }

      // 2. Build a default param grid (3 values per param around the strategy default)
      const grid = {};
      for (const p of (strategy.params || [])) {
        const def = p.default;
        if (p.type === 'int' || p.type === 'float') {
          const step = p.type === 'int' ? Math.max(1, Math.round((p.max - p.min) / 20)) : (p.max - p.min) / 20;
          grid[p.name] = [Math.max(p.min, def - step), def, Math.min(p.max, def + step)];
        } else {
          grid[p.name] = [def];
        }
      }
      // Explode grid (cap 27 — small for AI workflow; full grid is on /api/tune)
      const keys = Object.keys(grid);
      let combos = [{}];
      for (const k of keys) {
        const next = [];
        for (const c of combos) for (const v of grid[k]) next.push({ ...c, [k]: v });
        combos = next;
        if (combos.length > 27) { combos = combos.slice(0, 27); break; }
      }

      // 3. Run backtests
      const { runBacktest } = require('./backtest');
      const results = [];
      for (const params of combos) {
        try {
          const out = runBacktest({ candles, strategy: strategy_id, params, qty: 1 });
          results.push({ params, trades: out.stats.trades, winRate: out.stats.winRate, totalPnl: out.stats.totalPnl, maxDrawdown: out.stats.maxDrawdown });
        } catch (_) { /* skip bad combo */ }
      }
      results.sort((a, b) => (b.totalPnl || -Infinity) - (a.totalPnl || -Infinity));
      const top3 = results.slice(0, 3);
      const currentDefault = Object.fromEntries((strategy.params || []).map(p => [p.name, p.default]));
      const currentRun = results.find(r => JSON.stringify(r.params) === JSON.stringify(currentDefault));

      // 4. AI summary
      const routed = await aiRouter.route({ db, vault, userId: req.user.id, workflow: 'strategy_autotune', mode });
      if (!routed.ok) return res.status(routed.reason === 'no_ai_key' ? 412 : 404).json(routed);

      const capCheck = _capCheck(db, req.user.id, 'strategy_autotune', routed.provider, routed.model, routed.est_cost_inr);
      if (capCheck.blocked) return res.status(429).json({ ok: false, reason: 'spend_cap_exceeded', ...capCheck });

      const prompt = {
        system: `You are a quantitative strategist reviewing a parameter sweep for an Indian equity strategy. Output STRICTLY this JSON:
{
  "headline": "one-sentence verdict on whether to change params",
  "should_change": true | false,
  "proposed_params": { "<paramName>": <value>, ... } OR null if should_change=false,
  "rationale": "2-3 sentences referencing the actual numbers (winRate, totalPnl, maxDrawdown)",
  "risk_note": "one-sentence caveat about overfitting + small sample size"
}
Rules:
- Suggest a param change ONLY if the proposed combo's totalPnl is meaningfully better AND max drawdown isn't much worse.
- Mention the actual % improvement vs the current defaults in the rationale.
- Always include the risk_note. 120 daily bars is small; encourage forward-testing in paper before promotion.`,
        user: `Strategy: ${strategy.name} (${strategy_id})
Symbol: ${symbol}
Window: last 120 daily candles
Current default params: ${JSON.stringify(currentDefault)}
Current run result: ${JSON.stringify(currentRun)}

Top 3 results by totalPnl:
${JSON.stringify(top3, null, 2)}

Return JSON verdict only.`,
      };

      const llmResult = await callLLM({ provider: routed.provider, apiKey: routed.apiKey, model: routed.model, prompt });
      const advice = (llmResult && llmResult.advice) ?? llmResult;
      const usage = (llmResult && llmResult.usage) || { prompt_tokens: 0, completion_tokens: 0 };
      const cost_inr = estimateCost({ provider: routed.provider, model: routed.model, prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens });

      let call_id = null;
      try { call_id = db.ai.logCall({ user_id: req.user.id, workflow: 'strategy_autotune', provider: routed.provider, model: routed.model, prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens, cost_inr, status: 'ok', error: null, context_tag: strategy_id, verdict: advice && advice.should_change ? 'change' : 'keep' }); } catch (e) { console.warn('[ai-workflows] auto-tune log:', e.message); }

      const norm = {
        strategy_id, strategy_name: strategy.name, symbol,
        current_defaults: currentDefault,
        current_result: currentRun || null,
        top_3: top3,
        headline: String(advice && advice.headline || '').slice(0, 300),
        should_change: !!(advice && advice.should_change),
        proposed_params: advice && advice.proposed_params && typeof advice.proposed_params === 'object' ? advice.proposed_params : null,
        rationale: String(advice && advice.rationale || '').slice(0, 600),
        risk_note: String(advice && advice.risk_note || '').slice(0, 300),
      };
      _cachePut(cacheKey, { ts: Date.now(), response: norm, cost_inr, provider: routed.provider, model: routed.model, call_id });
      res.json({ ok: true, cached: false, ...norm, provider: routed.provider, model: routed.model, cost_inr, usage, call_id });
    } catch (e) {
      try { db.ai.logCall({ user_id: req.user.id, workflow: 'strategy_autotune', provider: null, model: null, prompt_tokens: 0, completion_tokens: 0, cost_inr: 0, status: 'error', error: (e.message || 'autotune_failed').slice(0,200), context_tag: strategy_id, verdict: null }); } catch (_) {}
      res.status(500).json({ ok: false, reason: 'autotune_failed', detail: e.message });
    }
  });

  // --- D3: vision — chart image upload + AI extraction ---
  // Body: { image_data_url: 'data:image/png;base64,...', context?: 'free text' }
  // The body limit is bumped to 10mb just for this route (default for the router is 32kb).
  router.post('/vision', express.json({ limit: '10mb' }), async (req, res) => {
    const b = req.body || {};
    const dataUrl = (b.image_data_url || '').toString();
    if (!dataUrl) return res.status(400).json({ ok: false, reason: 'bad_request', detail: 'image_data_url required (data:image/png;base64,XXXX)' });

    const m = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/);
    if (!m) return res.status(400).json({ ok: false, reason: 'bad_image_format', detail: 'expecting data:image/png|jpeg|webp;base64,...' });

    const imageMime = m[1] === 'image/jpg' ? 'image/jpeg' : m[1];
    const imageBase64 = m[2];

    // Hard cap: 7.5MB base64 (~5MB raw). Anthropic accepts up to ~20MB; we cap lower.
    if (imageBase64.length > 7_500_000) {
      return res.status(413).json({ ok: false, reason: 'image_too_large', detail: 'max ~5MB raw' });
    }

    try {
      const mode = b.mode || db.ai.userMode(req.user.id);

      // Cache key — full base64 hash so identical re-uploads are free
      const cacheKey = _hashPrompt([req.user.id, 'vision', mode, imageBase64.length, imageBase64.slice(0, 64), imageBase64.slice(-64), b.context || '']);
      const cached = _cacheGet(cacheKey);
      if (cached) return res.json({ ok: true, cached: true, ...cached.response, provider: cached.provider, model: cached.model, cost_inr: 0, call_id: cached.call_id || null });

      // Route — workflow 'vision' resolves to STRONG family. Force a vision-capable
      // model: Claude Sonnet + Opus + GPT-5 + Gemini Pro/Flash all support inline image.
      const routed = await aiRouter.route({ db, vault, userId: req.user.id, workflow: 'vision', mode });
      if (!routed.ok) return res.status(routed.reason === 'no_ai_key' ? 412 : 404).json(routed);

      // Vision is more expensive (image tokens add up). Use 2x budget.
      const capCheck = _capCheck(db, req.user.id, 'vision', routed.provider, routed.model, routed.est_cost_inr * 2);
      if (capCheck.blocked) return res.status(429).json({ ok: false, reason: 'spend_cap_exceeded', ...capCheck });

      const prompt = {
        system: `You are a chart-reading analyst for Indian equities. Extract structured info from a screenshot of a price chart. Output STRICTLY this JSON:
{
  "chart_type": "candlestick" | "line" | "bar" | "area" | "unknown",
  "symbol_guess": "<ticker if visible, else null>",
  "exchange_guess": "NSE" | "BSE" | "other" | null,
  "date_range": "<text from the chart, e.g. '1 Jan - 31 Mar 2026'>",
  "trend": "uptrend" | "downtrend" | "range" | "unclear",
  "key_levels": [
    {"price": <number>, "kind": "support" | "resistance" | "psychological" | "moving_average"}
  ],
  "annotations": ["text user has drawn on the chart, e.g. 'breakout', 'buy here'"],
  "plain_summary": "1-2 sentences describing what the chart shows, in plain Hindi-English",
  "advisory_note": "1 sentence reminding the user this is pattern reading, not predictions"
}
Rules:
- Never invent a ticker — if not visible, set symbol_guess: null.
- key_levels max 5 entries; pick the most prominent.
- Reading a chart is pattern recognition, not forecasting. Always include advisory_note.`,
        user: b.context ? `Additional context from user: ${String(b.context).slice(0, 500)}\n\nNow analyse the attached chart.` : 'Analyse the attached chart.',
      };

      const llmResult = await callLLMVision({ provider: routed.provider, apiKey: routed.apiKey, model: routed.model, prompt, imageBase64, imageMime });
      const advice = (llmResult && llmResult.advice) ?? llmResult;
      const usage = (llmResult && llmResult.usage) || { prompt_tokens: 0, completion_tokens: 0 };
      const cost_inr = estimateCost({ provider: routed.provider, model: routed.model, prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens });

      let call_id = null;
      try { call_id = db.ai.logCall({ user_id: req.user.id, workflow: 'vision', provider: routed.provider, model: routed.model, prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens, cost_inr, status: 'ok', error: null, context_tag: advice && advice.symbol_guess ? String(advice.symbol_guess).toUpperCase() : null, verdict: advice && advice.trend ? String(advice.trend) : null }); } catch (e) { console.warn('[ai-workflows] vision log:', e.message); }

      const norm = {
        chart_type: String(advice && advice.chart_type || 'unknown'),
        symbol_guess: advice && advice.symbol_guess ? String(advice.symbol_guess).slice(0, 24).toUpperCase() : null,
        exchange_guess: advice && advice.exchange_guess ? String(advice.exchange_guess).slice(0, 10) : null,
        date_range: String(advice && advice.date_range || '').slice(0, 100),
        trend: String(advice && advice.trend || 'unclear'),
        key_levels: Array.isArray(advice && advice.key_levels) ? advice.key_levels.slice(0, 5).map(k => ({ price: Number(k.price), kind: String(k.kind || 'support').slice(0, 24) })) : [],
        annotations: Array.isArray(advice && advice.annotations) ? advice.annotations.slice(0, 6).map(a => String(a).slice(0, 200)) : [],
        plain_summary: String(advice && advice.plain_summary || '').slice(0, 500),
        advisory_note: String(advice && advice.advisory_note || '').slice(0, 200),
      };
      _cachePut(cacheKey, { ts: Date.now(), response: norm, cost_inr, provider: routed.provider, model: routed.model, call_id });
      res.json({ ok: true, cached: false, ...norm, provider: routed.provider, model: routed.model, cost_inr, usage, call_id });
    } catch (e) {
      try { db.ai.logCall({ user_id: req.user.id, workflow: 'vision', provider: null, model: null, prompt_tokens: 0, completion_tokens: 0, cost_inr: 0, status: 'error', error: (e.message || 'vision_failed').slice(0, 200), context_tag: null, verdict: null }); } catch (_) {}
      res.status(500).json({ ok: false, reason: 'vision_failed', detail: e.message });
    }
  });

  // --- H8: A/B experiments registry + results ---
  router.get('/experiments', (req, res) => {
    try { res.json({ ok: true, experiments: db.ai.experimentList(req.user.id) }); }
    catch (e) { res.status(500).json({ ok: false, reason: 'list_failed', detail: e.message }); }
  });

  router.post('/experiments', (req, res) => {
    const b = req.body || {};
    const name = (b.name || '').toString().trim();
    const workflow = (b.workflow || 'intraday_critic').toString();
    const varA = (b.variant_a_key || 'a').toString().slice(0, 32);
    const varB = (b.variant_b_key || 'b').toString().slice(0, 32);
    if (!name) return res.status(400).json({ ok: false, reason: 'bad_request', detail: 'name required' });
    try {
      // End any existing active experiment for the same workflow so we don't double up
      const existing = db.ai.experimentActiveForWorkflow(req.user.id, workflow);
      if (existing) db.ai.experimentEnd(req.user.id, existing.id);
      const id = db.ai.experimentCreate(req.user.id, name, workflow, varA, varB);
      res.json({ ok: true, id, name, workflow, variant_a_key: varA, variant_b_key: varB });
    } catch (e) {
      res.status(500).json({ ok: false, reason: 'create_failed', detail: e.message });
    }
  });

  router.put('/experiments/:id/end', (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const r = db.ai.experimentEnd(req.user.id, id);
      if (!r.changes) return res.status(404).json({ ok: false, reason: 'not_found_or_already_ended' });
      res.json({ ok: true, id });
    } catch (e) {
      res.status(500).json({ ok: false, reason: 'end_failed', detail: e.message });
    }
  });

  router.get('/experiments/:id/results', (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const meta = db.ai.experimentGet(req.user.id, id);
      if (!meta) return res.status(404).json({ ok: false, reason: 'not_found' });
      const days = Math.max(7, Math.min(365, parseInt(req.query.days || '30', 10)));
      const rows = db.ai.experimentResults(req.user.id, id, days);
      const buckets = { a: { calls: 0, matched: 0, wins: 0, losses: 0, total_pnl: 0 },
                        b: { calls: 0, matched: 0, wins: 0, losses: 0, total_pnl: 0 } };
      const seen = new Set();
      for (const r of rows) {
        const v = r.variant;
        if (!buckets[v]) continue;
        const callKey = `${r.ai_ts}|${r.symbol}|${v}`;
        if (!seen.has(callKey)) { buckets[v].calls += 1; seen.add(callKey); }
        if (r.trade_pnl != null) {
          buckets[v].matched += 1;
          if (r.trade_pnl > 0) buckets[v].wins += 1; else buckets[v].losses += 1;
          buckets[v].total_pnl += Number(r.trade_pnl);
        }
      }
      const out = {};
      for (const [k, b] of Object.entries(buckets)) {
        out[k] = {
          calls: b.calls, trades_in_window: b.matched, wins: b.wins, losses: b.losses,
          win_rate: b.matched > 0 ? +(b.wins / b.matched).toFixed(4) : null,
          avg_pnl_inr: b.matched > 0 ? +(b.total_pnl / b.matched).toFixed(2) : null,
          total_pnl_inr: +b.total_pnl.toFixed(2),
        };
      }
      // Headline: simple lift, mark significant only when both sides have enough samples
      let headline = 'Not enough data yet — keep running the experiment.';
      const enough = out.a.matched >= 10 && out.b.matched >= 10;
      if (enough) {
        const lift = (out.a.avg_pnl_inr ?? 0) - (out.b.avg_pnl_inr ?? 0);
        const winner = lift > 0 ? meta.variant_a_key : (lift < 0 ? meta.variant_b_key : 'tie');
        headline = `${winner} leads by Rs ${Math.abs(lift).toFixed(2)} per trade after ${out.a.matched + out.b.matched} trades`;
      }
      res.json({ ok: true, experiment: meta, window_days: days, buckets: out, headline, sample_threshold: 10 });
    } catch (e) {
      res.status(500).json({ ok: false, reason: 'results_failed', detail: e.message });
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

  // --- H4: AI verdict backtest — did past critiques predict actual P&L? ---
  router.get('/verdict-backtest', (req, res) => {
    try {
      const days = Math.max(7, Math.min(365, parseInt(req.query.days || '30', 10)));
      const rows = db.ai.verdictBacktest(req.user.id, days);

      // Aggregate by verdict bucket
      const buckets = { agree: { calls: 0, matched: 0, wins: 0, losses: 0, total_pnl: 0 },
                        caution: { calls: 0, matched: 0, wins: 0, losses: 0, total_pnl: 0 },
                        reject: { calls: 0, matched: 0, wins: 0, losses: 0, total_pnl: 0 } };
      // Unique calls (an AI call may join to multiple subsequent trades; dedupe by ts+symbol+verdict)
      const seenCalls = new Set();
      for (const r of rows) {
        const v = r.verdict;
        if (!buckets[v]) continue;
        const callKey = `${r.ai_ts}|${r.symbol}|${v}`;
        if (!seenCalls.has(callKey)) { buckets[v].calls += 1; seenCalls.add(callKey); }
        if (r.trade_pnl != null) {
          buckets[v].matched += 1;
          if (r.trade_pnl > 0) buckets[v].wins += 1;
          else buckets[v].losses += 1;
          buckets[v].total_pnl += Number(r.trade_pnl);
        }
      }

      // Compute derived stats
      const out = {};
      for (const [k, b] of Object.entries(buckets)) {
        out[k] = {
          calls: b.calls,
          trades_in_window: b.matched,
          wins: b.wins,
          losses: b.losses,
          win_rate: b.matched > 0 ? +(b.wins / b.matched).toFixed(4) : null,
          avg_pnl_inr: b.matched > 0 ? +(b.total_pnl / b.matched).toFixed(2) : null,
          total_pnl_inr: +b.total_pnl.toFixed(2),
        };
      }

      // Headline answer: did following AI advice make money?
      const followed = out.agree;
      const ignored = out.reject;
      const headline =
        followed.matched === 0 && ignored.matched === 0
          ? 'Not enough data yet — need critiques + matching paper trades to measure'
          : followed.matched > 0 && followed.avg_pnl_inr > 0
              ? `Trades AI agreed with: avg Rs ${followed.avg_pnl_inr} per trade (${followed.wins}W/${followed.losses}L)`
              : `Trades AI agreed with: avg Rs ${followed.avg_pnl_inr} per trade — review prompt + verdicts`;

      res.json({ ok: true, window_days: days, total_critique_calls: rows.length, buckets: out, headline });
    } catch (e) {
      res.status(500).json({ ok: false, reason: 'verdict_backtest_failed', detail: e.message });
    }
  });

  return router;
}

module.exports = { createAiWorkflowsRouter, buildCritiquePrompt, buildExplainPrompt };
