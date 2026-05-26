// ai-features.js -- T-396 (architecture audit #1, server.js god-object split #13).
//
// Three legacy AI POST endpoints that use the SINGLE shared ANTHROPIC_API_KEY
// (vs the per-user BYOK keys handled by routes/ai-admin.js + ai-workflows-routes.js).
//
//   - POST /api/ai/news-sentiment      -- score news items as positive/negative
//   - POST /api/ai/position-review     -- describe open positions in plain English
//   - POST /api/ai/strategy-explain    -- deprecated; superseded by
//                                          POST /api/me/ai-workflows/explain (BYOK)
//
// strategy-explain stays for backward compat with screen-ai-review.jsx and any
// external clients that haven't migrated yet -- see deprecation note in the
// handler comment.
//
// Public API
// ==========
//   const { mountAiFeatureRoutes } = require('./routes/ai-features');
//   mountAiFeatureRoutes(app, { getAi, getNews, getPaper });

'use strict';

function mountAiFeatureRoutes(app, deps) {
  // T-428 (audit-2026-05-26 backend H2): added withAuth dep.
  const { getAi, getNews, getPaper, withAuth } = deps;
  if (typeof getAi    !== 'function') throw new Error('ai-features: getAi getter required');
  if (typeof getNews  !== 'function') throw new Error('ai-features: getNews getter required');
  if (typeof getPaper !== 'function') throw new Error('ai-features: getPaper getter required');
  if (typeof withAuth !== 'function') throw new Error('ai-features: withAuth required');

  // T-428 (audit-2026-05-26 backend H2): wrapped with withAuth. Was unauth -- any
  // cookie-auth user could drain shared ANTHROPIC budget in a tight loop.
  app.post('/api/ai/news-sentiment', withAuth(async (req, res) => {
    const ai = getAi();
    if (!ai || !ai.enabled()) return res.status(503).json({ ok: false, reason: 'ai_disabled', detail: 'set ANTHROPIC_API_KEY env to enable' });
    try {
      const news = getNews();
      const items = Array.isArray(req.body && req.body.items) ? req.body.items : (news ? news.list({ limit: 10 }) : []);
      const out = await ai.newsSentiment(items);
      res.json({ ok: true, sentiments: out, stats: ai.stats() });
    } catch (e) { res.status(500).json({ ok: false, reason: e.message }); }
  }));

  // T-428 (audit-2026-05-26 backend H2): wrapped with withAuth.
  app.post('/api/ai/position-review', withAuth(async (_req, res) => {
    const ai = getAi();
    if (!ai || !ai.enabled()) return res.status(503).json({ ok: false, reason: 'ai_disabled' });
    try {
      const paper = getPaper();
      const positions = paper ? paper.positions() : [];
      const out = await ai.positionReview(positions);
      res.json({ ok: true, review: out, stats: ai.stats() });
    } catch (e) { res.status(500).json({ ok: false, reason: e.message }); }
  }));

  // @deprecated T-186 (SCREENS-AUDIT F-11): use POST /api/me/ai-workflows/explain
  // instead. The new endpoint is auth-required and BYOK (per-user API key via
  // vault), so spend is attributed and capped per user instead of charged to
  // the single legacy ANTHROPIC_API_KEY this route reads. It also takes a
  // strategy_id (must exist in STRATEGIES) and returns a structured shape.
  // This handler stays for back-compat with screen-ai-review.jsx; a future
  // commit will migrate the screen and remove this route. Do not add new callers.
  // T-428 (audit-2026-05-26 backend H2): wrapped with withAuth.
  app.post('/api/ai/strategy-explain', withAuth(async (req, res) => {
    const ai = getAi();
    if (!ai || !ai.enabled()) return res.status(503).json({ ok: false, reason: 'ai_disabled' });
    try {
      const out = await ai.strategyExplain(req.body || {});
      res.json({ ok: true, ...out, stats: ai.stats() });
    } catch (e) { res.status(500).json({ ok: false, reason: e.message }); }
  }));
}

module.exports = { mountAiFeatureRoutes };
