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

  // T-243 (correction): the comment that used to live here said "Kite has no
  // MF API" -- that was wrong. Kite Connect HAS a Mutual Fund API
  // (https://kite.trade/docs/connect/v3/mutual-funds), but it is GET-only:
  // holdings + SIPs + last-7-day orders + instruments master. ORDER PLACEMENT
  // is NOT supported by Zerodha because Coin requires a bank-account payment
  // that the API can't broker. We now expose the read endpoints under
  // /api/me/mf/* (see routes/mf.js, T-241). This route stays as a thin
  // backwards-compat alias to /api/me/mf/holdings so older frontends keep
  // working. CAS upload remains a future option for users who hold MFs
  // OUTSIDE Zerodha (other registrars, AMC-direct, etc).
  app.get('/api/me/portfolio/mf', async (req, res) => {
    if (!req.user) return res.status(401).json({ ok: false, reason: 'auth_required' });
    try {
      const r = await resolveUserBroker(req);
      if (!r.broker || typeof r.broker.getMFHoldings !== 'function') {
        return res.json({
          ok: true, holdings: [],
          source: r.broker ? 'broker_has_no_mf_api' : 'no_broker_connected',
          note: 'Connect a Zerodha account to see Coin MF holdings, or upload a CAS PDF for cross-registrar coverage (CAS upload pipeline pending).',
        });
      }
      const holdings = await r.broker.getMFHoldings();
      res.json({ ok: true, holdings, source: 'zerodha_kite_mf' });
    } catch (e) {
      res.status(500).json({ ok: false, reason: e.message });
    }
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
