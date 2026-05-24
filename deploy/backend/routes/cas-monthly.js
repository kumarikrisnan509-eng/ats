// cas-monthly.js -- T-398 (architecture audit #1, server.js god-object split #15).
//
// Two singleton endpoints batched together because both are large-ish
// (8MB CAS upload / monthly AI aggregate) but neither warrants its own
// module:
//   - POST /api/cas/parse           -- parse a Consolidated Account Statement
//                                      (caller passes pdftotext stdout in body.text)
//   - POST /api/ai/monthly-review   -- @deprecated, kept for screen-ai-review.jsx
//                                      back-compat; new BYOK path is
//                                      POST /api/me/ai-workflows/monthly-review.
//
// Public API
// ==========
//   const { mountCasMonthlyRoutes } = require('./routes/cas-monthly');
//   mountCasMonthlyRoutes(app, { parseCASText, audit, getAi, getPaper, express });

'use strict';

function mountCasMonthlyRoutes(app, deps) {
  const { parseCASText, audit, getAi, getPaper, express } = deps;
  if (typeof parseCASText !== 'function') throw new Error('cas-monthly: parseCASText required');
  if (typeof audit        !== 'function') throw new Error('cas-monthly: audit required');
  if (typeof getAi        !== 'function') throw new Error('cas-monthly: getAi getter required');
  if (typeof getPaper     !== 'function') throw new Error('cas-monthly: getPaper getter required');
  if (!express) throw new Error('cas-monthly: express required');

  // Tier 46: parse uploaded CAS PDF text. Caller does
  // `pdftotext your-cas.pdf -` and POSTs the stdout here.
  app.post('/api/cas/parse', express.json({ limit: '8mb' }), (req, res) => {
    try {
      const text = req.body && req.body.text;
      if (!text || typeof text !== 'string') return res.status(400).json({ ok: false, reason: 'body.text (string) required' });
      if (text.length > 5_000_000) return res.status(413).json({ ok: false, reason: 'CAS text too large (5MB max)' });
      const out = parseCASText(text);
      audit('cas.parsed', { pan: out.pan, folios: out.folios.length, totalValue: out.totalValue });
      res.json({ ok: true, ...out });
    } catch (e) { res.status(500).json({ ok: false, reason: e.message }); }
  });

  // @deprecated T-186 (SCREENS-AUDIT F-11): use POST /api/me/ai-workflows/monthly-review
  // instead. The new endpoint is auth-required and BYOK (per-user API key
  // via vault) -- works for any authenticated user, not just the operator
  // who set ANTHROPIC_API_KEY. It aggregates the CALLER's paper_orders /
  // paper_closed_trades / pnl_daily (not the global file-backed paper store
  // this route reads from), returns structured { headline, what_went_well,
  // what_went_wrong, patterns_observed, suggested_focus,
  // ai_spend_assessment }, and respects user redact_pii pref (H5).
  // This handler stays for screen-ai-review.jsx back-compat; a future commit
  // will migrate the screen and remove this route. Do not add new callers.
  app.post('/api/ai/monthly-review', async (req, res) => {
    const ai = getAi();
    if (!ai || !ai.enabled()) return res.status(503).json({ ok: false, reason: 'ai_disabled', detail: 'set ANTHROPIC_API_KEY env to enable' });
    try {
      const body = req.body || {};
      const paper = getPaper();
      let arg = body;
      if (!body.trades && paper) {
        const stats = paper.stats() || {};
        const trades = paper.trades ? paper.trades(50) : [];
        arg = {
          month: new Date().toLocaleString('en-IN', { month: 'long', year: 'numeric' }),
          realizedPnl: stats.realizedPnl || 0,
          winRate: stats.winRate,
          tradeCount: stats.tradeCount || 0,
          totalEquity: stats.totalEquity || 0,
          trades: trades.slice(0, 30),
          ...body,
        };
      }
      const out = await ai.monthlyReview(arg);
      res.json({ ok: true, ...out });
    } catch (e) {
      res.status(500).json({ ok: false, reason: e.message });
    }
  });
}

module.exports = { mountCasMonthlyRoutes };
