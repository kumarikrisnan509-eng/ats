// ai-keys-routes.js -- Tier 69c: CRUD for user's BYOK AI keys + analyze endpoint.
//
// Schema lives in ai_keys table (added by Tier 69c migration in db.js).
//   user_id, provider, sealed_key, model_pref, created_at
//
// We use the existing libsodium vault for sealing. Same security model as broker creds.

'use strict';

const { SUPPORTED_PROVIDERS, DEFAULT_MODEL_BY_PROVIDER, DEPRECATED_MODEL_ALIASES, resolveModel, buildPrompt, callLLM, normalizeAdvice, estimateCost, estimateCostBudget } = require('./ai-advisor');

function createAiKeysRouter({ db, vault, requireAuth, brokerResolver }) {
  const express = require('express');
  const router = express.Router();
  router.use(express.json({ limit: '32kb' }));
  router.use(requireAuth);

  // Ensure ai_keys table exists (idempotent)
  db._conn.exec(`
    CREATE TABLE IF NOT EXISTS ai_keys (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider    TEXT NOT NULL,
      sealed_key  TEXT NOT NULL,
      model_pref  TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, provider)
    );
    CREATE INDEX IF NOT EXISTS idx_aikeys_user ON ai_keys(user_id);
  `);

  const listStmt   = db._conn.prepare("SELECT id, provider, model_pref, created_at FROM ai_keys WHERE user_id = ? ORDER BY created_at DESC");
  const getStmt    = db._conn.prepare("SELECT * FROM ai_keys WHERE user_id = ? AND provider = ?");
  const upsertStmt = db._conn.prepare("INSERT INTO ai_keys (user_id, provider, sealed_key, model_pref) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, provider) DO UPDATE SET sealed_key = excluded.sealed_key, model_pref = excluded.model_pref");

  // T92: One-time migration -- rewrite any DB rows with a deprecated model_pref to the current default
  try {
    const allRows = db._conn.prepare("SELECT id, provider, model_pref FROM ai_keys").all();
    const updateModel = db._conn.prepare("UPDATE ai_keys SET model_pref = ? WHERE id = ?");
    let migrated = 0;
    for (const r of allRows) {
      if (r.model_pref && DEPRECATED_MODEL_ALIASES[r.model_pref]) {
        updateModel.run(DEPRECATED_MODEL_ALIASES[r.model_pref], r.id);
        migrated++;
      }
    }
    if (migrated > 0) console.log(`[ai-keys] T92 model migration: rewrote ${migrated} stale model_pref values`);
  } catch (e) {
    console.warn('[ai-keys] T92 migration skipped:', e.message);
  }
  const deleteStmt = db._conn.prepare("DELETE FROM ai_keys WHERE user_id = ? AND provider = ?");

  // GET /api/me/ai-keys -- list connected providers (no key material)
  router.get('/', (req, res) => {
    try {
      const rows = listStmt.all(req.user.id);
      res.json({ ok: true, keys: rows.map(r => ({ provider: r.provider, model_pref: r.model_pref, created_at: r.created_at, has_key: true })), supportedProviders: SUPPORTED_PROVIDERS, defaultModels: DEFAULT_MODEL_BY_PROVIDER });
    } catch (e) {
      res.status(500).json({ ok: false, reason: 'list_failed', detail: e.message });
    }
  });

  // PUT /api/me/ai-keys -- upsert a key for a provider
  // T98: PUT accepts {provider, apiKey?, model?|model_pref?}.
  // - With apiKey: full upsert (seal new key + write model_pref)
  // - Without apiKey: model-only update, requires existing row
  router.put('/', async (req, res) => {
    try {
      const body = req.body || {};
      const provider = String(body.provider || '').toLowerCase();
      // accept either 'model' or 'model_pref' field name from clients
      const incomingModel = body.model || body.model_pref;
      const apiKey = body.apiKey;

      if (!SUPPORTED_PROVIDERS.includes(provider)) {
        return res.status(400).json({ ok: false, reason: 'unsupported_provider', supported: SUPPORTED_PROVIDERS });
      }

      const hasNewKey = apiKey && typeof apiKey === 'string' && apiKey.length >= 10;
      const modelPref = (incomingModel && typeof incomingModel === 'string') ? incomingModel.slice(0, 64) : DEFAULT_MODEL_BY_PROVIDER[provider];

      if (hasNewKey) {
        // Full upsert: new (or replacement) key + model
        const sealed = await vault.seal(apiKey);
        upsertStmt.run(req.user.id, provider, sealed, modelPref);
        return res.json({ ok: true, provider, model_pref: modelPref, updated: 'key+model' });
      }

      // No apiKey -> model-only update. Requires existing row.
      const existing = getStmt.get(req.user.id, provider);
      if (!existing) {
        return res.status(400).json({ ok: false, reason: 'api_key_required', detail: 'No saved key for this provider; paste an API key to create it.' });
      }
      db._conn.prepare("UPDATE ai_keys SET model_pref = ? WHERE user_id = ? AND provider = ?")
        .run(modelPref, req.user.id, provider);
      return res.json({ ok: true, provider, model_pref: modelPref, updated: 'model_only' });
    } catch (e) {
      res.status(500).json({ ok: false, reason: 'save_failed', detail: e.message });
    }
  });

  // DELETE /api/me/ai-keys/:provider
  router.delete('/:provider', (req, res) => {
    try {
      const p = String(req.params.provider || '').toLowerCase();
      const result = deleteStmt.run(req.user.id, p);
      if (result.changes === 0) return res.status(404).json({ ok: false, reason: 'not_found' });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, reason: 'delete_failed', detail: e.message });
    }
  });


  // Tier 86: POST /api/me/ai-keys/test {provider, apiKey?} -- send a minimal request to verify the key works
  router.post('/test', async (req, res) => {
    try {
      const provider = req.body && req.body.provider;
      if (!provider || !SUPPORTED_PROVIDERS.includes(provider)) {
        return res.status(400).json({ ok: false, reason: 'unsupported_provider', supportedProviders: SUPPORTED_PROVIDERS });
      }
      let apiKey = req.body && req.body.apiKey;
      // If no key in request, use the saved one
      if (!apiKey || apiKey === '(unchanged)') {
        const row = getStmt.get(req.user.id, provider);
        if (!row) return res.status(404).json({ ok: false, reason: 'no_key_saved' });
        apiKey = await vault.open(row.sealed_key);
      }
      // T92: prefer request body model > DB saved model_pref > backend default
      // resolveModel auto-upgrades deprecated aliases (e.g. claude-sonnet-4-5 -> 4-6)
      let modelForTest = (req.body && req.body.model);
      if (!modelForTest) {
        const row = getStmt.get(req.user.id, provider);
        if (row && row.model_pref) modelForTest = row.model_pref;
      }
      const resolvedModel = resolveModel(provider, modelForTest);

      // T99-C1: pre-check daily AI spend cap (ping is tiny but still counts)
      const cap = db.ai.dailyCapInr(req.user.id);
      const alreadySpent = db.ai.dailySpend(req.user.id);
      const budget = estimateCostBudget({ provider, model: resolvedModel, expectedInTokens: 20, expectedOutTokens: 20 });
      if (alreadySpent + budget > cap) {
        try { db.ai.logCall({ user_id: req.user.id, workflow: 'test', provider, model: resolvedModel, prompt_tokens: 0, completion_tokens: 0, cost_inr: 0, status: 'blocked_by_cap', error: `daily cap ₹${cap} reached (spent ₹${alreadySpent.toFixed(2)})` }); } catch (_) {}
        return res.status(429).json({ ok: false, reason: 'spend_cap_exceeded', cap_inr: cap, spent_inr: +alreadySpent.toFixed(2), detail: `Daily AI spend cap of ₹${cap} reached. Raise it in Settings to continue today.` });
      }

      const t0 = Date.now();
      // Minimal validation call per provider (cheap "hi" prompt, JSON mode where supported)
      const result = await callLLM({
        provider,
        apiKey,
        model: resolvedModel,
        prompt: {
          system: 'You are a connectivity check. Reply with exactly the JSON: {"ok":true}',
          user: 'ping',
        },
        fetchImpl: globalThis.fetch,
      });
      const elapsed_ms = Date.now() - t0;
      // T99-A3: log to ai_calls with real token usage + cost
      const usage = (result && result.usage) || { prompt_tokens: 0, completion_tokens: 0 };
      const cost_inr = estimateCost({ provider, model: resolvedModel, prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens });
      try { db.ai.logCall({ user_id: req.user.id, workflow: 'test', provider, model: resolvedModel, prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens, cost_inr, status: 'ok', error: null }); } catch (e) { console.warn('[ai-keys] ai_calls log failed:', e.message); }
      res.json({ ok: true, provider, model: resolvedModel, elapsed_ms, cost_inr, usage, sample: typeof result === 'string' ? result.slice(0, 80) : null });
    } catch (e) {
      const msg = e && e.message ? e.message : 'test_failed';
      // T92: explicit 404 / not_found mapping so users see a clean error
      // T95: check 404/not_found BEFORE rate (since 'generate' contains substring 'rate');
      // also use word boundaries on rate-limit to avoid false positives in URLs
      const reason = /401|unauthor|invalid_api_key/i.test(msg) ? 'invalid_api_key'
                  : /404|not_found/i.test(msg) ? 'model_not_available'
                  : /403|permission|forbidden/i.test(msg) ? 'no_access_to_model'
                  : /\b429\b|rate[ _-]?limit/i.test(msg) ? 'rate_limited'
                  : /timeout/i.test(msg) ? 'timeout'
                  : 'send_failed';
      // T99-A3: log error to ai_calls (cost=0, status=error)
      try { db.ai.logCall({ user_id: req.user.id, workflow: 'test', provider: req.body && req.body.provider, model: null, prompt_tokens: 0, completion_tokens: 0, cost_inr: 0, status: 'error', error: `${reason}: ${msg.slice(0,200)}` }); } catch (_) {}
      res.status(400).json({ ok: false, provider: req.body && req.body.provider, reason, detail: msg });
    }
  });


  // Tier 86: GET /api/me/ai-keys/usage -- aggregate per-provider call counts from audit
  router.get('/usage', (req, res) => {
    try {
      // T99-A3: real usage from ai_calls table.
      // Returns today, 7d, 30d breakdown per provider + the user's current daily cap + today's spend.
      const periods = [['today', '-1 day'], ['week', '-7 days'], ['month', '-30 days']];
      const byPeriod = {};
      for (const [name, window] of periods) {
        const out = {};
        for (const p of SUPPORTED_PROVIDERS) out[p] = { calls: 0, cost_inr: 0, prompt_tokens: 0, completion_tokens: 0 };
        try {
          const rows = db.ai.byPeriod(req.user.id, window);
          for (const r of rows) {
            if (out[r.provider]) {
              out[r.provider] = { calls: r.calls, cost_inr: +Number(r.cost || 0).toFixed(4), prompt_tokens: r.prompt_tokens, completion_tokens: r.completion_tokens };
            }
          }
        } catch (_) {}
        byPeriod[name] = out;
      }
      const cap_inr = db.ai.dailyCapInr(req.user.id);
      const spent_today = +db.ai.dailySpend(req.user.id).toFixed(4);
      res.json({
        ok: true,
        period: '30d',
        cap_inr,
        spent_today_inr: spent_today,
        cap_remaining_inr: +Math.max(0, cap_inr - spent_today).toFixed(4),
        cap_used_pct: cap_inr > 0 ? +((spent_today / cap_inr) * 100).toFixed(1) : 0,
        byPeriod,
        // Tier 86 back-compat: callers expecting `usage` keyed by provider w/ calls_30d + est_cost_inr
        usage: Object.fromEntries(Object.entries(byPeriod.month).map(([p, v]) => [p, { calls_30d: v.calls, est_cost_inr: v.cost_inr }])),
      });
    } catch (e) {
      res.status(500).json({ ok: false, reason: 'usage_failed', detail: e.message });
    }
  });


  // T97: GET /api/me/ai-keys/models/:provider -- query provider's actual list-models API
  // Returns the real list of models accessible with the user's saved key, filtered to chat-capable.
  // Falls back gracefully if the user has no key or the provider's list endpoint fails.
  router.get('/models/:provider', async (req, res) => {
    try {
      const provider = req.params.provider;
      if (!SUPPORTED_PROVIDERS.includes(provider)) {
        return res.status(400).json({ ok: false, reason: 'unsupported_provider' });
      }
      const row = getStmt.get(req.user.id, provider);
      if (!row) return res.status(404).json({ ok: false, reason: 'no_key_saved' });
      const apiKey = await vault.open(row.sealed_key);
      const fetchFn = globalThis.fetch;

      let models = [];
      if (provider === 'anthropic') {
        const r = await fetchFn('https://api.anthropic.com/v1/models?limit=100', {
          headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        });
        if (!r.ok) throw new Error(`anthropic ${r.status}: ${(await r.text()).slice(0,150)}`);
        const j = await r.json();
        // Newest first; Anthropic returns created_at; filter to chat-capable Claude models
        models = (j.data || []).filter(m => /^claude-/.test(m.id))
          .sort((a,b) => (b.created_at || '').localeCompare(a.created_at || ''))
          .map(m => ({ id: m.id, display_name: m.display_name || m.id, created: m.created_at || null }));
      } else if (provider === 'openai') {
        const r = await fetchFn('https://api.openai.com/v1/models', {
          headers: { 'Authorization': `Bearer ${apiKey}` },
        });
        if (!r.ok) throw new Error(`openai ${r.status}: ${(await r.text()).slice(0,150)}`);
        const j = await r.json();
        // Filter to chat-capable: gpt-* and o-family; exclude embedding/audio/image/moderation/tts/realtime
        const exclude = /(embedding|tts|whisper|audio|moderation|davinci|babbage|ada|curie|search|edit|transcribe|realtime|image)/i;
        models = (j.data || []).filter(m => /^(gpt-|o[0-9])/i.test(m.id) && !exclude.test(m.id))
          .sort((a,b) => (b.created || 0) - (a.created || 0))
          .map(m => ({ id: m.id, display_name: m.id, created: m.created || null }));
      } else if (provider === 'gemini') {
        const r = await fetchFn(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}&pageSize=100`);
        if (!r.ok) throw new Error(`gemini ${r.status}: ${(await r.text()).slice(0,150)}`);
        const j = await r.json();
        // Only keep models that support generateContent; strip the 'models/' prefix
        models = (j.models || [])
          .filter(m => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
          .filter(m => /^models\/gemini-/.test(m.name))
          .map(m => ({ id: m.name.replace(/^models\//, ''), display_name: m.displayName || m.name, created: null }))
          .sort((a,b) => b.id.localeCompare(a.id));
      }
      res.json({ ok: true, provider, count: models.length, models });
    } catch (e) {
      res.status(502).json({ ok: false, reason: 'list_models_failed', detail: (e && e.message) ? e.message.slice(0, 200) : 'unknown' });
    }
  });

  return router;
}

function createAdvisorAnalyzeRouter({ db, vault, requireAuth, brokerResolver }) {
  const express = require('express');
  const router = express.Router();
  router.use(express.json({ limit: '32kb' }));
  router.use(requireAuth);

  // POST /api/me/ai-advisor/analyze -- run analysis using stored key
  // Body: { provider?: 'anthropic'|'openai'|'gemini', marketContext?: string }
  router.post('/analyze', async (req, res) => {
    try {
      const body = req.body || {};
      const requested = body.provider ? String(body.provider).toLowerCase() : null;

      // Pick provider: explicit or fall back to whichever key exists (anthropic preferred)
      const keys = db._conn.prepare("SELECT provider, sealed_key, model_pref FROM ai_keys WHERE user_id = ?").all(req.user.id);
      if (!keys.length) {
        return res.status(412).json({ ok: false, reason: 'no_ai_key', detail: 'Add a Claude/OpenAI/Gemini API key in Settings first.' });
      }
      const pickOrder = requested ? [requested] : ['anthropic', 'openai', 'gemini'];
      const chosen = pickOrder.map(p => keys.find(k => k.provider === p)).find(Boolean);
      if (!chosen) return res.status(404).json({ ok: false, reason: 'requested_provider_missing' });

      const apiKey = await vault.open(chosen.sealed_key);
      const model = chosen.model_pref || DEFAULT_MODEL_BY_PROVIDER[chosen.provider];

      // T99-C1: pre-check daily AI spend cap
      const cap = db.ai.dailyCapInr(req.user.id);
      const alreadySpent = db.ai.dailySpend(req.user.id);
      const budget = estimateCostBudget({ provider: chosen.provider, model, expectedInTokens: 1500, expectedOutTokens: 1500 });
      if (alreadySpent + budget > cap) {
        try { db.ai.logCall({ user_id: req.user.id, workflow: 'analyze', provider: chosen.provider, model, prompt_tokens: 0, completion_tokens: 0, cost_inr: 0, status: 'blocked_by_cap', error: `daily cap ₹${cap} reached (spent ₹${alreadySpent.toFixed(2)})` }); } catch (_) {}
        return res.status(429).json({ ok: false, reason: 'spend_cap_exceeded', cap_inr: cap, spent_inr: +alreadySpent.toFixed(2), detail: `Daily AI spend cap of ₹${cap} reached. Raise it in Settings to continue today.` });
      }

      // Gather context: risk metrics + factor exposure + top holdings
      const pnlRows = db.pnl.recent(req.user.id, 252);
      const { computeRiskMetrics } = require('./risk-engine');
      const dailyEquity = (pnlRows || []).map(r => ({ date: r.date, equity: Number(r.equity || 0) })).reverse();
      const riskMetrics = computeRiskMetrics(dailyEquity);

      // Factor exposure (best effort -- if no broker, send empty)
      let factorExposure = null;
      let topHoldings = [];
      try {
        const r = await brokerResolver.resolveForRequest({ db, vault, globalBroker: null, fallbackToGlobal: false }, req);
        if (r.broker) {
          const holdings = await r.broker.getHoldings();
          if (Array.isArray(holdings) && holdings.length) {
            const { computeFactorExposure } = require('./factor-exposure');
            // Skip candle fetching for speed -- compute weights + concentration only
            const norm = holdings.map(h => ({
              symbol: h.tradingsymbol || h.symbol,
              qty: Number(h.quantity || h.qty || 0),
              ltp: Number(h.ltp || h.last_price || 0),
            }));
            const fx = computeFactorExposure({ holdings: norm, candlesBySymbol: {} });
            factorExposure = fx;
            topHoldings = fx.perHolding.slice(0, 10);
          }
        }
      } catch (_) {}

      const prompt = buildPrompt({
        user: req.user,
        riskMetrics,
        factorExposure,
        holdings: topHoldings,
        marketContext: body.marketContext || null,
      });

      const llmResult = await callLLM({ provider: chosen.provider, apiKey, model, prompt });
      // T99-A3: callLLM now returns {advice, usage}; tolerate the old shape too in case
      // something else still passes raw JSON through.
      const raw = (llmResult && llmResult.advice !== undefined) ? llmResult.advice : llmResult;
      const usage = (llmResult && llmResult.usage) || { prompt_tokens: 0, completion_tokens: 0 };
      const advice = normalizeAdvice(raw);
      const cost_inr = estimateCost({ provider: chosen.provider, model, prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens });
      try { db.ai.logCall({ user_id: req.user.id, workflow: 'analyze', provider: chosen.provider, model, prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens, cost_inr, status: 'ok', error: null }); } catch (e) { console.warn('[ai-keys] analyze log failed:', e.message); }

      res.json({
        ok: true,
        provider: chosen.provider,
        model,
        advice,
        cost_inr,
        usage,
        // Echo inputs for transparency (no secrets)
        inputs: {
          hasRiskMetrics: !!(riskMetrics && riskMetrics.enoughData),
          hasFactorExposure: !!(factorExposure && factorExposure.enoughData),
          holdingCount: factorExposure?.holdingCount || 0,
        },
      });
    } catch (e) {
      try { db.ai.logCall({ user_id: req.user.id, workflow: 'analyze', provider: req.body && req.body.provider, model: null, prompt_tokens: 0, completion_tokens: 0, cost_inr: 0, status: 'error', error: (e && e.message || 'analyze_failed').slice(0,200) }); } catch (_) {}
      res.status(500).json({ ok: false, reason: 'analyze_failed', detail: e.message });
    }
  });

  return router;
}

module.exports = { createAiKeysRouter, createAdvisorAnalyzeRouter };
