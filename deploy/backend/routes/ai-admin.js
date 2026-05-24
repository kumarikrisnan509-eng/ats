// ai-admin.js -- T-387 (architecture audit #1, server.js god-object split #4).
//
// Three admin-only endpoints for triaging the BYOK LLM pipeline:
//   - GET  /api/admin/ai-trace    -- recent ai_calls rows (filtered, with stats)
//   - POST /api/admin/ai-replay   -- re-run a past call with a different model
//   - POST /api/admin/ai-compare  -- fire two providers in parallel (A/B)
//
// All three gate on req.user.is_admin (operator-only) and read AI provider
// keys from the user-scoped ai_keys table via libsodium-sealed unseal.
//
// History
// =======
//   T99-T122 (v11-F1): introduced /api/admin/ai-trace for spend monitoring
//   T-162   F2: added ai-replay so the operator can A/B drift-check models
//   T-162   H8: added ai-compare for parallel head-to-head eyeballing
//   T-387   (2026-05-24): extracted from server.js
//
// Public API
// ==========
//   const { mountAiAdminRoutes } = require('./routes/ai-admin');
//   mountAiAdminRoutes(app, { getDb, getVault, express });
//
// `getDb` / `getVault` are getters because both are lazily initialised inside
// server.js's async init() -- passing as closures ensures we always see the
// latest value, not a snapshot from module-load time.

'use strict';

function mountAiAdminRoutes(app, deps) {
  const { getDb, getVault, express } = deps;
  if (typeof getDb !== 'function')    throw new Error('ai-admin: getDb getter required');
  if (typeof getVault !== 'function') throw new Error('ai-admin: getVault getter required');
  if (!express) throw new Error('ai-admin: express required');

  // GET /api/admin/ai-trace -- admin-only LLM call trace viewer.
  // Filters: ?limit=N (default 50, max 200) ?user_id=N ?status=error ?workflow=NAME
  app.get('/api/admin/ai-trace', (req, res) => {
    if (!req.user || !req.user.is_admin) return res.status(403).json({ ok: false, reason: 'admin_only' });
    const db = getDb();
    if (!db || !db._conn) return res.status(503).json({ ok: false, reason: 'db_unavailable' });
    try {
      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10)));
      const filters = [];
      const params = [];
      if (req.query.user_id) { filters.push('user_id = ?'); params.push(parseInt(req.query.user_id, 10)); }
      if (req.query.status)  { filters.push('status = ?'); params.push(String(req.query.status)); }
      if (req.query.workflow) { filters.push('workflow = ?'); params.push(String(req.query.workflow)); }
      const where = filters.length ? 'WHERE ' + filters.join(' AND ') : '';
      const sql = `SELECT id, user_id, ts, workflow, provider, model,
                          prompt_tokens, completion_tokens, cost_inr, status,
                          substr(error, 1, 300) AS error
                   FROM ai_calls ${where}
                   ORDER BY id DESC LIMIT ?`;
      const rows = db._conn.prepare(sql).all(...params, limit);
      // Aggregate quick stats so the UI can show "of the last 50: 47 ok, 3 errors"
      const stats = {
        total: rows.length,
        ok: rows.filter(r => r.status === 'ok').length,
        error: rows.filter(r => r.status === 'error').length,
        totalCostInr: rows.reduce((s, r) => s + (Number(r.cost_inr) || 0), 0),
        byProvider: {},
        byWorkflow: {},
      };
      for (const r of rows) {
        stats.byProvider[r.provider] = (stats.byProvider[r.provider] || 0) + 1;
        if (r.workflow) stats.byWorkflow[r.workflow] = (stats.byWorkflow[r.workflow] || 0) + 1;
      }
      res.json({ ok: true, rows, stats, filters: { limit, ...req.query } });
    } catch (e) {
      res.status(500).json({ ok: false, reason: 'ai_trace_failed', detail: e.message });
    }
  });

  // POST /api/admin/ai-replay  body: { ai_call_id, provider?, model? }
  // Re-run a past ai_calls row with optionally different provider/model.
  app.post('/api/admin/ai-replay', express.json({ limit: '32kb' }), async (req, res) => {
    if (!req.user || !req.user.is_admin) return res.status(403).json({ ok: false, reason: 'admin_only' });
    const db = getDb();
    if (!db || !db._conn) return res.status(503).json({ ok: false, reason: 'db_unavailable' });
    const vault = getVault();
    const id = parseInt((req.body || {}).ai_call_id, 10);
    const overrideProvider = (req.body || {}).provider;
    const overrideModel = (req.body || {}).model;
    if (!id) return res.status(400).json({ ok: false, reason: 'ai_call_id_required' });
    try {
      const row = db._conn.prepare(
        'SELECT id, user_id, ts, workflow, provider, model, prompt_system, prompt_user, response_text, status FROM ai_calls WHERE id = ?'
      ).get(id);
      if (!row) return res.status(404).json({ ok: false, reason: 'ai_call_not_found' });

      const newProvider = overrideProvider || row.provider;
      const newModel = overrideModel || row.model;

      // Resolve API key for the target user + provider via vault.
      let apiKey = null;
      try {
        const k = db._conn.prepare('SELECT sealed_key FROM ai_keys WHERE user_id = ? AND provider = ?').get(row.user_id, newProvider);
        if (k && k.sealed_key && vault) apiKey = await vault.open(k.sealed_key);
      } catch (e) { console.warn('[ai-admin] swallowed:', e && e.message); }
      if (!apiKey) return res.status(404).json({ ok: false, reason: 'no_provider_key_for_user' });

      const { callLLM } = require('../ai-advisor');
      const r = await callLLM({
        provider: newProvider,
        apiKey,
        model: newModel,
        prompt: { system: row.prompt_system || '', user: row.prompt_user || '' },
      });

      res.json({
        ok: true,
        original: { id: row.id, provider: row.provider, model: row.model, ts: row.ts, response_text: row.response_text },
        replay:   { provider: newProvider, model: newModel, response_text: r && r.text, cost_inr: r && r.cost_inr, prompt_tokens: r && r.prompt_tokens, completion_tokens: r && r.completion_tokens },
      });
    } catch (e) {
      res.status(500).json({ ok: false, reason: 'replay_failed', detail: String(e && e.message).slice(0, 300) });
    }
  });

  // POST /api/admin/ai-compare  body: { system?, user, a:{provider,model}, b:{provider,model}, user_id }
  // A/B parallel two providers on the same prompt. No rate-limit / cost-cap.
  app.post('/api/admin/ai-compare', express.json({ limit: '32kb' }), async (req, res) => {
    if (!req.user || !req.user.is_admin) return res.status(403).json({ ok: false, reason: 'admin_only' });
    const db = getDb();
    const vault = getVault();
    const b = req.body || {};
    if (!b.user || !b.a || !b.b || !b.user_id) {
      return res.status(400).json({ ok: false, reason: 'missing_fields', detail: 'user, a, b, user_id required' });
    }
    if (!db || !db._conn) return res.status(503).json({ ok: false, reason: 'db_unavailable' });
    try {
      const { callLLM } = require('../ai-advisor');
      const fetchKey = async (provider) => {
        const k = db._conn.prepare('SELECT sealed_key FROM ai_keys WHERE user_id = ? AND provider = ?').get(b.user_id, provider);
        if (!k || !k.sealed_key || !vault) return null;
        return vault.open(k.sealed_key);
      };
      const [keyA, keyB] = await Promise.all([fetchKey(b.a.provider), fetchKey(b.b.provider)]);
      if (!keyA) return res.status(404).json({ ok: false, reason: 'no_key_for_provider_a' });
      if (!keyB) return res.status(404).json({ ok: false, reason: 'no_key_for_provider_b' });

      const t0 = Date.now();
      const [resA, resB] = await Promise.allSettled([
        callLLM({ provider: b.a.provider, apiKey: keyA, model: b.a.model, prompt: { system: b.system || '', user: b.user } }),
        callLLM({ provider: b.b.provider, apiKey: keyB, model: b.b.model, prompt: { system: b.system || '', user: b.user } }),
      ]);
      res.json({
        ok: true,
        elapsedMs: Date.now() - t0,
        a: resA.status === 'fulfilled' ? { ok: true, ...resA.value } : { ok: false, error: String(resA.reason && resA.reason.message || resA.reason) },
        b: resB.status === 'fulfilled' ? { ok: true, ...resB.value } : { ok: false, error: String(resB.reason && resB.reason.message || resB.reason) },
      });
    } catch (e) {
      res.status(500).json({ ok: false, reason: 'compare_failed', detail: String(e && e.message).slice(0, 300) });
    }
  });
}

module.exports = { mountAiAdminRoutes };
