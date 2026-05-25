// misc-trading.js -- T-415 (architecture audit #1, server.js split #41).
// Two isolated routes that didn't fit anywhere else:
//
//   - POST /api/rebalance    (Tier 23: portfolio rebalance suggestions from
//                             buckets + holdings/paper-equity/cash. Pure
//                             computation -- no orders, no money movement.)
//   - POST /api/paper/replay (Tier 27: step-through historical-candle replay
//                             of a strategy. Runs against either caller-supplied
//                             candles or broker.getHistorical() -- the result is
//                             just stats, no positions, no orders.)
//
// Both gated by KILL_SWITCH at the server level via the gate middleware
// (they don't fire any orders themselves, but they ARE on the /api/ surface).
// Singletons passed as getters since rebalance/replay/paper/broker/longterm
// are all assigned during async init().

'use strict';

function mountMiscTradingRoutes(app, deps) {
  const {
    audit,
    pickBroker,
    getRebalance,
    getLongterm,
    getPaper,
    getBroker,
    getReplay,
  } = deps;
  if (typeof audit         !== 'function') throw new Error('misc-trading: audit required');
  if (typeof pickBroker    !== 'function') throw new Error('misc-trading: pickBroker required');
  if (typeof getRebalance  !== 'function') throw new Error('misc-trading: getRebalance required');
  if (typeof getLongterm   !== 'function') throw new Error('misc-trading: getLongterm required');
  if (typeof getPaper      !== 'function') throw new Error('misc-trading: getPaper required');
  if (typeof getBroker     !== 'function') throw new Error('misc-trading: getBroker required');
  if (typeof getReplay     !== 'function') throw new Error('misc-trading: getReplay required');

  // ---------- Tier 23: /api/rebalance ----------
  app.post('/api/rebalance', async (req, res) => {
    const rebalance = getRebalance();
    const longterm  = getLongterm();
    const paper     = getPaper();
    if (!rebalance) return res.status(503).json({ ok: false, reason: 'rebalance_not_initialized' });
    try {
      const body = req.body || {};
      let buckets = body.buckets;
      if (!buckets && longterm) buckets = longterm.getBuckets();
      if (!buckets) return res.status(400).json({ ok: false, reason: 'no buckets supplied or initialized' });

      let holdingsValueINR = Number(body.holdingsValueINR);
      let paperEquityINR   = Number(body.paperEquityINR);
      let cashINR          = Number(body.cashINR);

      if (!Number.isFinite(holdingsValueINR)) {
        try {
          const p = await pickBroker(req);
          const hs = p.broker ? await p.broker.getHoldings() : [];
          holdingsValueINR = (hs || []).reduce((s, h) => s + (h.quantity || 0) * (h.last_price || h.ltp || 0), 0);
        } catch (_e) { holdingsValueINR = 0; }
      }
      if (!Number.isFinite(paperEquityINR) && paper) {
        const ps = paper.stats() || {};
        paperEquityINR = ps.totalEquity || 0;
      }
      if (!Number.isFinite(cashINR) && paper) {
        const ps = paper.stats() || {};
        cashINR = ps.cash || 0;
      }

      const out = rebalance.suggest({
        buckets,
        holdingsValueINR: holdingsValueINR || 0,
        paperEquityINR:   paperEquityINR   || 0,
        cashINR:          cashINR          || 0,
        thresholdPct:     body.thresholdPct,
      });
      res.json(out);
    } catch (e) {
      res.status(400).json({ ok: false, reason: e.message });
    }
  });

  // ---------- Tier 27: /api/paper/replay (historical candle step-through) ----------
  app.post('/api/paper/replay', async (req, res) => {
    const replay = getReplay();
    const broker = getBroker();
    if (!replay) return res.status(503).json({ ok: false, reason: 'replay_not_initialized' });
    try {
      const { symbol, from, to, strategy, params, qty, interval, candles } = req.body || {};
      if (!strategy) return res.status(400).json({ ok: false, reason: 'strategy required' });
      let bars;
      if (Array.isArray(candles) && candles.length >= 30) {
        bars = candles;
      } else {
        if (!symbol)   return res.status(400).json({ ok: false, reason: 'symbol required (or pass candles[])' });
        if (!from || !to) return res.status(400).json({ ok: false, reason: 'from and to required (YYYY-MM-DD)' });
        try {
          bars = await broker.getHistorical({ symbol, interval: interval || 'day', from, to });
        } catch (e) {
          return res.status(502).json({ ok: false, reason: `historical fetch failed: ${e.message}`, hint: 'Pass candles[] in body to bypass broker.' });
        }
        if (!Array.isArray(bars) || bars.length < 30) {
          return res.status(400).json({ ok: false, reason: `need >= 30 candles, got ${bars ? bars.length : 0}` });
        }
      }
      const result = replay.replay({ candles: bars, strategy, params: params || {}, qty: Number(qty) || 1 });
      audit('paper.replay', { symbol, strategy, bars: bars.length, trades: result.stats.trades });
      res.json({ symbol, from, to, ...result });
    } catch (e) {
      res.status(400).json({ ok: false, reason: e.message });
    }
  });
}

module.exports = { mountMiscTradingRoutes };
