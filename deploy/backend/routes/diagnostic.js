// diagnostic.js -- T-389 (architecture audit #1, server.js god-object split #6).
//
// Two read-only diagnostic GETs that pull from various subsystems for
// operator inspection. No state mutation, no auth gating beyond what's
// already in the global middleware chain.
//
// Routes
// ======
//   GET /api/preflight     -- aggregated readiness check (broker, paper, pnl,
//                             reconcile drift) -- used by the dashboard's
//                             pre-trade banner.
//   GET /api/regime        -- classify current market state (trending_up /
//                             range / high_vol etc.) using ATR + ADX + SMAs
//                             over a configurable lookback.
//
// /api/benchmark also belongs here in spirit but its handler embeds ~135
// lines of inline alpha/beta/Sharpe/drawdown math. Extracting it cleanly
// requires factoring that math into its own analytics module first --
// own ticket.
//
// Public API
// ==========
//   const { mountDiagnosticRoutes } = require('./routes/diagnostic');
//   mountDiagnosticRoutes(app, {
//     getBroker, getPaper, getPnl, runPreflight, pickBroker, classifyRegime,
//   });
//
// All deps as getters because they're lazily initialised inside server.js's
// async init() and we want to see the latest live value, not a snapshot.

'use strict';

function mountDiagnosticRoutes(app, deps) {
  const { getBroker, getPaper, getPnl, runPreflight, pickBroker, classifyRegime } = deps;
  if (typeof getBroker        !== 'function') throw new Error('diagnostic: getBroker getter required');
  if (typeof getPaper         !== 'function') throw new Error('diagnostic: getPaper getter required');
  if (typeof getPnl           !== 'function') throw new Error('diagnostic: getPnl getter required');
  if (typeof runPreflight     !== 'function') throw new Error('diagnostic: runPreflight required');
  if (typeof pickBroker       !== 'function') throw new Error('diagnostic: pickBroker required');
  if (typeof classifyRegime   !== 'function') throw new Error('diagnostic: classifyRegime required');

  // GET /api/preflight -- aggregated readiness for the dashboard banner.
  app.get('/api/preflight', async (req, res) => {
    try {
      const broker = getBroker();
      const paper  = getPaper();
      const pnl    = getPnl();
      const result = await runPreflight({
        broker, paper, pnl,
        env: process.env,
        getReconcile: async () => {
          // Build a minimal reconcile snapshot inline (don't recurse through HTTP)
          if (!paper) return null;
          const stats = paper.stats();
          const list = paper.list();
          const paperPending = list.filter(o => o.status === 'PENDING').length;
          let brokerPending = 0;
          try {
            const _p = await pickBroker(req);
            if (_p.broker) {
              const o = await _p.broker.getOrders();
              brokerPending = (o || []).filter(x => String(x.status || '').toUpperCase() === 'OPEN').length;
            }
          } catch (e) { console.warn('[diagnostic] swallowed:', e && e.message); }
          return { summary: { cashDrift: 0, brokerPendingCnt: brokerPending, paperPendingCnt: paperPending } };
        },
      });
      res.json({ ok: true, ...result });
    } catch (e) { res.status(500).json({ ok: false, reason: e.message }); }
  });

  // GET /api/regime?symbol=NIFTY+50&interval=day&lookback=365
  // Classifies current market state into one of:
  //   trending_up | trending_down | range | high_vol | low_vol
  // Uses ATR (volatility), ADX (trend strength), SMA50/200 (trend direction).
  app.get('/api/regime', async (req, res) => {
    try {
      const broker = getBroker();
      const symbol = req.query.symbol || 'NIFTY 50';
      const interval = req.query.interval || 'day';
      const lookback = Math.max(60, Math.min(800, parseInt(req.query.lookback || '365', 10) || 365));
      const to = new Date();
      const from = new Date(to.getTime() - lookback * 86400000);
      const fromStr = from.toISOString().slice(0, 10);
      const toStr   = to.toISOString().slice(0, 10);

      const candles = await broker.getHistorical({ symbol, interval, from: fromStr, to: toStr });
      if (!Array.isArray(candles) || candles.length < 50) {
        return res.status(400).json({ ok: false, reason: `need >= 50 candles, got ${candles ? candles.length : 0}` });
      }
      const r = classifyRegime(candles);
      res.json({
        ok: true,
        symbol, interval, from: fromStr, to: toStr,
        candles: candles.length,
        ...r,
        asOf: candles[candles.length - 1].date,
      });
    } catch (e) {
      res.status(500).json({ ok: false, reason: e.message });
    }
  });
}

module.exports = { mountDiagnosticRoutes };
