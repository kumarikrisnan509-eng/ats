// ai-keys-routes.js -- Tier 69c: CRUD for user's BYOK AI keys + analyze endpoint.
//
// Schema lives in ai_keys table (added by Tier 69c migration in db.js).
//   user_id, provider, sealed_key, model_pref, created_at
//
// We use the existing libsodium vault for sealing. Same security model as broker creds.

'use strict';

const { SUPPORTED_PROVIDERS, DEFAULT_MODEL_BY_PROVIDER, buildPrompt, callLLM, normalizeAdvice } = require('./ai-advisor');

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
