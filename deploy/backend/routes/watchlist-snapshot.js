// watchlist-snapshot.js -- T-408 (architecture audit #1, server.js split #36).
// GET /api/watchlist/snapshot -- watchlist symbols + per-symbol LTP + day change.
// One round trip for the dashboard's watchlist table.

'use strict';

function mountWatchlistSnapshotRoutes(app, deps) {
  const { getWatchlist, getBroker } = deps;
  if (typeof getWatchlist !== 'function') throw new Error('watchlist-snapshot: getWatchlist required');
  if (typeof getBroker    !== 'function') throw new Error('watchlist-snapshot: getBroker required');

  app.get('/api/watchlist/snapshot', async (_req, res) => {
    const watchlist = getWatchlist();
    const broker = getBroker();
    if (!watchlist) return res.status(503).json({ ok: false, reason: 'watchlist_not_initialized' });
    const symbols = watchlist.list();
    if (symbols.length === 0) return res.json({ ok: true, rows: [] });
    try {
      const eq = symbols.filter(s => !/^(NIFTY|BANKNIFTY|SENSEX|FINNIFTY|MIDCPNIFTY|INDIA VIX)/i.test(s));
      const quotes = eq.length ? await broker.getQuotes(eq) : {};
      const rows = symbols.map((sym) => {
        const key = `NSE:${sym}`;
        const q = quotes[key];
        if (!q || typeof q.last_price !== 'number') {
          return { symbol: sym, ltp: null, close: null, change: null, changePct: null, volume: null };
        }
        const close = q.ohlc && typeof q.ohlc.close === 'number' ? q.ohlc.close : q.last_price;
        const change = +(q.last_price - close).toFixed(2);
        const changePct = close ? +(((q.last_price - close) / close) * 100).toFixed(2) : 0;
        return {
          symbol: sym,
          ltp: q.last_price,
          close,
          change,
          changePct,
          volume: q.volume || null,
          ohlc: q.ohlc || null,
        };
      });
      res.json({ ok: true, count: rows.length, rows });
    } catch (e) {
      res.status(500).json({ ok: false, reason: e.message });
    }
  });
}

module.exports = { mountWatchlistSnapshotRoutes };
