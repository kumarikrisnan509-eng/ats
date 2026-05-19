// T-218 (CODE-AUDIT F.5 M1.4 piece 4): per-user portfolio routes.
//
// Lifted from server.js where 4 routes lived inline:
//   GET /api/portfolio/holdings       (uses resolveUserBroker)
//   GET /api/me/portfolio/mf          (auth-only, returns empty until CAS pipeline)
//   GET /api/me/portfolio/etf         (auth-only, returns empty + hint)
//   GET /api/portfolio/positions      (uses resolveUserBroker)
//
// The audit (CODE-AUDIT.md A.6) flagged these as a natural extract --
// they're already routed per-user via the existing resolveUserBroker
// helper. No business-logic change in this commit.

'use strict';

function mountPortfolioRoutes(app, deps) {
  const { resolveUserBroker } = deps;

  app.get('/api/portfolio/holdings', async (req, res) => {
    try {
      const r = await resolveUserBroker(req);
      if (!r.broker) return res.json({ ok: true, brokerConnected: false, reason: r.reason, rows: [] });
      const rows = await r.broker.getHoldings();
      res.json({ ok: true, brokerConnected: true, rows });
    } catch (e) {
      res.status(500).json({ ok: false, reason: e.message });
    }
  });

  // T99-T66: per-user mutual-fund holdings. Kite has no MF API; data comes
  // from the user uploading their CAS (Consolidated Account Statement) PDF
  // via /api/cas/parse + future UI. Until that pipeline persists results
  // to a per-user table, this endpoint returns an empty list so the frontend
  // can render a clean 'no MF data yet, upload your CAS' empty state instead
  // of showing hardcoded sample data.
  app.get('/api/me/portfolio/mf', (req, res) => {
    if (!req.user) return res.status(401).json({ ok: false, reason: 'auth_required' });
    // TODO: when CAS-upload persistence lands, query a per-user mf_holdings table here.
    res.json({ ok: true, holdings: [], source: 'awaiting_cas_upload' });
  });

  // T99-T66: per-user ETF holdings. ETFs trade on NSE/BSE so they DO show up
  // in Kite's getHoldings() — they're listed alongside equity holdings (just
  // with instrument_type=ETF). Until the frontend filters them out cleanly,
  // return empty list with a hint pointing to the equity holdings endpoint.
  app.get('/api/me/portfolio/etf', (req, res) => {
    if (!req.user) return res.status(401).json({ ok: false, reason: 'auth_required' });
    res.json({ ok: true, holdings: [], source: 'see_equity_holdings', note: 'ETFs are returned by /api/portfolio/holdings; filter by instrument_type=ETF client-side' });
  });

  app.get('/api/portfolio/positions', async (req, res) => {
    try {
      const r = await resolveUserBroker(req);
      if (!r.broker) return res.json({ ok: true, brokerConnected: false, reason: r.reason, day: [], net: [] });
      const data = await r.broker.getPositions();
      res.json({ ok: true, brokerConnected: true, ...data });
    } catch (e) {
      res.status(500).json({ ok: false, reason: e.message });
    }
  });
}

module.exports = { mountPortfolioRoutes };
