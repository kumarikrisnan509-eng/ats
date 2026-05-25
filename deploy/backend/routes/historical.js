// historical.js -- T-406 (architecture audit #1, server.js split #34).
// Broker historical OHLCV + instrument search.

'use strict';

const HISTORICAL_MAX_DAYS = parseInt(process.env.HISTORICAL_MAX_DAYS || '730', 10); // 2 years

function mountHistoricalRoutes(app, deps) {
  const { getBroker } = deps;
  if (typeof getBroker !== 'function') throw new Error('historical: getBroker required');

  // GET /api/historical?symbol=RELIANCE&interval=5minute&from=2026-05-12&to=2026-05-13
  app.get('/api/historical', async (req, res) => {
    try {
      const { symbol, interval, from, to, continuous, oi } = req.query;
      if (!symbol || !interval || !from || !to) {
        return res.status(400).json({ ok: false, reason: 'symbol, interval, from, to are required' });
      }
      const dFrom = new Date(String(from));
      const dTo   = new Date(String(to));
      if (!isFinite(dFrom.getTime()) || !isFinite(dTo.getTime())) {
        return res.status(400).json({ ok: false, reason: 'from/to must be valid dates' });
      }
      const days = Math.floor((dTo.getTime() - dFrom.getTime()) / (86400 * 1000));
      if (days < 0) return res.status(400).json({ ok: false, reason: 'to must be after from' });
      if (days > HISTORICAL_MAX_DAYS) {
        return res.status(400).json({ ok: false, reason: `range too wide: ${days}d > ${HISTORICAL_MAX_DAYS}d max` });
      }
      const broker = getBroker();
      const candles = await broker.getHistorical({
        symbol: String(symbol),
        interval: String(interval),
        from: String(from),
        to: String(to),
        continuous: continuous === '1' || continuous === 'true',
        oi: oi === '1' || oi === 'true',
      });
      res.json({ ok: true, symbol: String(symbol), interval: String(interval), count: candles.length, candles });
    } catch (e) {
      res.status(400).json({ ok: false, reason: e.message });
    }
  });

  // GET /api/instruments/search?q=RELI&limit=20
  app.get('/api/instruments/search', (req, res) => {
    try {
      const q = String(req.query.q || '').trim();
      const limit = Math.max(1, Math.min(100, parseInt(req.query.limit || '20', 10) || 20));
      if (q.length < 1) return res.status(400).json({ ok: false, reason: 'q is required' });
      const results = getBroker().searchInstruments(q, limit);
      res.json({ ok: true, q, count: results.length, results });
    } catch (e) {
      res.status(500).json({ ok: false, reason: e.message });
    }
  });
}

module.exports = { mountHistoricalRoutes };
