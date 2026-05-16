// ai-keys-routes.js -- Tier 69c: CRUD for user's BYOK AI keys + analyze endpoint.
//
// Schema lives in ai_keys table (added by Tier 69c migration in db.js).
//   user_id, provider, sealed_key, model_pref, created_at
//
// We use the existing libsodium vault for sealing. Same security model as broker creds.

'use strict';

const { SUPPORTED_PROVIDERS, DEFAULT_MODEL_BY_PROVIDER, DEPRECATED_MODEL_ALIASES, resolveModel, buildPrompt, callLLM, normalizeAdvice } = require('./ai-advisor');

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
  router.put('/', async (req, res) => {
    try {
      const { provider, apiKey, model } = req.body || {};
      const p = String(provider || '').toLowerCase();
      if (!SUPPORTED_PROVIDERS.includes(p)) {
        return res.status(400).json({ ok: false, reason: 'unsupported_provider', supported: SUPPORTED_PROVIDERS });
      }
      if (!apiKey || typeof apiKey !== 'string' || apiKey.length < 10) {
        return res.status(400).json({ ok: false, reason: 'api_key_required' });
      }
      const sealed = await vault.seal(apiKey);
      const modelPref = (model && typeof model === 'string') ? model.slice(0, 64) : DEFAULT_MODEL_BY_PROVIDER[p];
      upsertStmt.run(req.user.id, p, sealed, modelPref);
      res.json({ ok: true, provider: p, model_pref: modelPref });
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
      res.json({ ok: true, provider, elapsed_ms, sample: typeof result === 'string' ? result.slice(0, 80) : null });
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
      res.status(400).json({ ok: false, provider: req.body && req.body.provider, reason, detail: msg });
    }
  });


  // Tier 86: GET /api/me/ai-keys/usage -- aggregate per-provider call counts from audit
  router.get('/usage', (req, res) => {
    try {
      // Aggregate from errors_log or audit if available. Conservative implementation:
      // count entries from a hypothetical ai_advisor_calls table if it exists, else return zeros.
      const out = {};
      for (const p of SUPPORTED_PROVIDERS) out[p] = { calls_30d: 0, est_cost_inr: 0 };
      try {
        // If we ever add an ai_calls table, query it here. For now return placeholder.
        const tableExists = db._conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ai_calls'").get();
        if (tableExists) {
          const rows = db._conn.prepare("SELECT provider, COUNT(*) AS calls, COALESCE(SUM(cost_inr),0) AS cost FROM ai_calls WHERE user_id = ? AND ts > datetime('now','-30 days') GROUP BY provider").all(req.user.id);
          for (const r of rows) {
            if (out[r.provider]) { out[r.provider].calls_30d = r.calls; out[r.provider].est_cost_inr = r.cost; }
          }
        }
      } catch (_) {}
      res.json({ ok: true, usage: out, period: '30d' });
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

      const raw = await callLLM({ provider: chosen.provider, apiKey, model, prompt });
      const advice = normalizeAdvice(raw);

      res.json({
        ok: true,
        provider: chosen.provider,
        model,
        advice,
        // Echo inputs for transparency (no secrets)
        inputs: {
          hasRiskMetrics: !!(riskMetrics && riskMetrics.enoughData),
          hasFactorExposure: !!(factorExposure && factorExposure.enoughData),
          holdingCount: factorExposure?.holdingCount || 0,
        },
      });
    } catch (e) {
      res.status(500).json({ ok: false, reason: 'analyze_failed', detail: e.message });
    }
  });

  return router;
}

module.exports = { createAiKeysRouter, createAdvisorAnalyzeRouter };
