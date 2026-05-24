// legacy-gone.js -- T-382 (architecture audit #9): extracted /api/me/mf/*
// 410 Gone stubs from server.js.
//
// History:
//   T-248 (2026-05): retired all 6 /api/me/mf/* MF endpoints + 1
//     /api/me/portfolio/mf alias. The platform never had MF placement
//     (Kite Connect MF API is GET-only by Zerodha/SEBI bank-mandate design)
//     and the surface was a misleading affordance. Long-term passive
//     investing pivoted to ETF baskets at #longterm via /api/orders/place.
//   T-382 (2026-05-24): moved the 7 stubs out of server.js into this
//     module. server.js god-object split work-in-progress.
//
// 410 Gone is the right status code: the resource is permanently gone
// (vs 404 which means "we don't know about this"). Compat window was
// ~30 days post-T-248; drop the stubs and the mount call after 2026-06-19.

'use strict';

function mountLegacyGoneRoutes(app) {
  const _mfGone = (which) => (_req, res) => res.status(410).json({
    ok: false, reason: 'gone', endpoint: which,
    detail: 'MF endpoints retired in T-248. Kite Connect MF API is read-only by Zerodha/SEBI design; platform never had MF placement. Long-term investing moved to ETF baskets at #longterm. Refresh the page for the new UI.',
  });
  app.get('/api/me/mf/search',      _mfGone('search'));
  app.get('/api/me/mf/nav/:code',   _mfGone('nav'));
  app.get('/api/me/mf/holdings',    _mfGone('holdings'));
  app.get('/api/me/mf/sips',        _mfGone('sips'));
  app.get('/api/me/mf/orders',      _mfGone('orders'));
  app.get('/api/me/mf/instruments', _mfGone('instruments'));
  app.get('/api/me/portfolio/mf',   _mfGone('portfolio_mf'));   // T-243 alias retired with the rest
}

module.exports = { mountLegacyGoneRoutes };
