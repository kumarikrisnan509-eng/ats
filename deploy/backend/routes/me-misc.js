// me-misc.js -- T-403 (architecture audit #1, server.js split #26).
// 6 small user-scoped routes that don't cluster elsewhere:
//   calibration + recommend-retire (signal-calibration)
//   macro-signals + macro-signals/refresh (nseMacroFetcher)
//   portfolio/aggregates + portfolio/stress (portfolio-aggregates)

'use strict';

const { rollupOptionGreeks }  = require('../services/portfolio-aggregates');
const { NseMacroFetcher }     = require('../services/nse-macro-fetcher');

function mountMeMiscRoutes(app, deps) {
  const { getSignalCalibration, getNseMacroFetcher, getPortfolioAggregates, getDb } = deps;
  if (typeof getSignalCalibration   !== 'function') throw new Error('me-misc: getSignalCalibration required');
  if (typeof getNseMacroFetcher     !== 'function') throw new Error('me-misc: getNseMacroFetcher required');
  if (typeof getPortfolioAggregates !== 'function') throw new Error('me-misc: getPortfolioAggregates required');
  if (typeof getDb                  !== 'function') throw new Error('me-misc: getDb required');

  app.get('/api/me/calibration', (req, res) => {
    if (!req.user) return res.status(401).json({ ok: false, reason: 'auth_required' });
    const sc = getSignalCalibration();
    if (!sc) return res.status(503).json({ ok: false, reason: 'signal_calibration_not_initialized' });
    const windowDays = Math.max(1, Math.min(365, parseInt(req.query.windowDays, 10) || 30));
    try { res.json({ ok: true, windowDays, calibration: sc.calibrate(windowDays) }); }
    catch (e) { res.status(500).json({ ok: false, reason: e.message }); }
  });

  // T-280c: macro signals
  app.get('/api/me/macro-signals', (req, res) => {
    if (!req.user) return res.status(401).json({ ok: false, reason: 'auth_required' });
    try {
      const nse = getNseMacroFetcher();
      const latest = nse ? nse.cachedLatest() : null;
      res.json({
        ok: true,
        fetcherEnabled: typeof NseMacroFetcher.isEnabled === 'function' ? NseMacroFetcher.isEnabled() : false,
        fetcherInstantiated: !!nse,
        latest,
      });
    } catch (e) {
      res.status(500).json({ ok: false, reason: e.message });
    }
  });

  app.post('/api/me/macro-signals/refresh', async (req, res) => {
    if (!req.user) return res.status(401).json({ ok: false, reason: 'auth_required' });
    const nse = getNseMacroFetcher();
    if (!nse) return res.status(503).json({ ok: false, reason: 'fetcher_not_initialized' });
    try {
      const result = await nse.fetchAll();
      res.json({ ok: true, ...result, latest: nse.cachedLatest() });
    } catch (e) {
      res.status(500).json({ ok: false, reason: e.message });
    }
  });

  app.get('/api/me/recommend-retire', (req, res) => {
    if (!req.user) return res.status(401).json({ ok: false, reason: 'auth_required' });
    const sc = getSignalCalibration();
    if (!sc) return res.status(503).json({ ok: false, reason: 'signal_calibration_not_initialized' });
    const windowDays = Math.max(1, Math.min(365, parseInt(req.query.windowDays, 10) || 30));
    try { res.json({ ok: true, ...sc.recommend(windowDays) }); }
    catch (e) { res.status(500).json({ ok: false, reason: e.message }); }
  });

  // T-272: unified position view aggregate (with T-294b optional greeks rollup)
  app.get('/api/me/portfolio/aggregates', (req, res) => {
    if (!req.user) return res.status(401).json({ ok: false, reason: 'auth_required' });
    const pa = getPortfolioAggregates();
    if (!pa) return res.status(503).json({ ok: false, reason: 'portfolio_aggregates_not_initialized' });
    try {
      const aggregates = pa.compute();
      const db = getDb();
      let optionGreeks = null;
      try {
        if (db && Array.isArray(aggregates.positions) && aggregates.positions.length > 0) {
          const optPositions = aggregates.positions
            .map(p => ({ tradingsymbol: p.tradingsymbol || p.symbol, qty: p.qty || p.quantity, lotSize: p.lotSize }))
            .filter(p => p.tradingsymbol && /(CE|PE)$/.test(p.tradingsymbol));
          if (optPositions.length > 0) {
            const symbols = optPositions.map(p => p.tradingsymbol);
            const placeholders = symbols.map(() => '?').join(',');
            const quotes = db._conn.prepare(
              `SELECT tradingsymbol, lot_size, delta, gamma, vega, theta, ltp, spot FROM option_quotes WHERE tradingsymbol IN (${placeholders})`
            ).all(...symbols);
            if (quotes.length > 0) {
              optionGreeks = rollupOptionGreeks(optPositions, quotes);
            } else {
              optionGreeks = { note: 'no_matching_option_quotes', positionCount: optPositions.length };
            }
          }
        }
      } catch (gErr) {
        optionGreeks = { error: gErr.message };
      }
      res.json({ ok: true, aggregates, optionGreeks });
    } catch (e) {
      res.status(500).json({ ok: false, reason: e.message });
    }
  });

  // T-275: scenario stress test
  app.post('/api/me/portfolio/stress', (req, res) => {
    if (!req.user) return res.status(401).json({ ok: false, reason: 'auth_required' });
    const pa = getPortfolioAggregates();
    if (!pa) return res.status(503).json({ ok: false, reason: 'portfolio_aggregates_not_initialized' });
    try {
      const shock = req.body || {};
      res.json({ ok: true, stress: pa.stress(shock) });
    } catch (e) {
      res.status(400).json({ ok: false, reason: e.message });
    }
  });
}

module.exports = { mountMeMiscRoutes };
