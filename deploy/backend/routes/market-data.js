// market-data.js -- T-391 (architecture audit #1, server.js god-object split #8).
//
// Five small read-only market data GETs that don't fit any larger module:
//   - GET /api/movers                -- gainers/losers from watchlist + broker quotes
//   - GET /api/symbol/:symbol        -- per-symbol meta + latest quote
//   - GET /api/option-expiries       -- list of expiry dates for an underlying
//   - GET /api/indices/snapshot      -- current LTP for major Indian indices
//   - GET /api/calc/position-size    -- pure-math risk-based position sizer
//
// Public API
// ==========
//   const { mountMarketDataRoutes } = require('./routes/market-data');
//   mountMarketDataRoutes(app, { getBroker, getWatchlist });
//
// `getBroker` / `getWatchlist` are getters because both are lazily initialised
// inside server.js's async init(). Position-size doesn't need any deps but
// keeps the same signature for consistency.

'use strict';

function mountMarketDataRoutes(app, deps) {
  const { getBroker, getWatchlist } = deps;
  if (typeof getBroker    !== 'function') throw new Error('market-data: getBroker getter required');
  if (typeof getWatchlist !== 'function') throw new Error('market-data: getWatchlist getter required');

  // GET /api/movers?limit=10
  // Reuses watchlist + getQuotes; sorts by abs(changePct); splits into gainers/losers.
  app.get('/api/movers', async (req, res) => {
    const watchlist = getWatchlist();
    const broker    = getBroker();
    if (!watchlist) return res.status(503).json({ ok: false, reason: 'watchlist_not_initialized' });
    const limit = Math.max(1, Math.min(50, parseInt(req.query.limit || '10', 10) || 10));
    const symbols = watchlist.list().filter(s => !/^(NIFTY|BANKNIFTY|SENSEX|FINNIFTY|MIDCPNIFTY|INDIA VIX)/i.test(s));
    if (symbols.length === 0) return res.json({ ok: true, gainers: [], losers: [] });
    try {
      const quotes = await broker.getQuotes(symbols);
      const rows = [];
      for (const sym of symbols) {
        const q = quotes[`NSE:${sym}`];
        if (!q || typeof q.last_price !== 'number') continue;
        const close = q.ohlc && typeof q.ohlc.close === 'number' ? q.ohlc.close : q.last_price;
        if (!close) continue;
        const changePct = +(((q.last_price - close) / close) * 100).toFixed(2);
        rows.push({ symbol: sym, ltp: q.last_price, close, change: +(q.last_price - close).toFixed(2), changePct });
      }
      const gainers = [...rows].filter(r => r.changePct > 0).sort((a, b) => b.changePct - a.changePct).slice(0, limit);
      const losers  = [...rows].filter(r => r.changePct < 0).sort((a, b) => a.changePct - b.changePct).slice(0, limit);
      res.json({ ok: true, gainers, losers, total: rows.length });
    } catch (e) {
      res.status(500).json({ ok: false, reason: e.message });
    }
  });

  // GET /api/symbol/:symbol -- lot/segment/strike/expiry + latest quote
  app.get('/api/symbol/:symbol', async (req, res) => {
    const broker = getBroker();
    try {
      const sym = req.params.symbol;
      const meta = typeof broker.symbolMeta === 'function' ? broker.symbolMeta(sym) : null;
      if (!meta) return res.status(404).json({ ok: false, reason: 'symbol_not_found' });

      let quote = null;
      try {
        const q = await broker.getQuotes([sym]);
        const k = `${meta.exchange}:${meta.tradingsymbol}`;
        quote = q[k] || q[`NSE:${meta.tradingsymbol}`] || null;
      } catch { /* quote fetch can fail for indices, that's fine */ }

      res.json({ ok: true, symbol: sym, meta, quote });
    } catch (e) {
      res.status(500).json({ ok: false, reason: e.message });
    }
  });

  // GET /api/option-expiries?underlying=NIFTY
  app.get('/api/option-expiries', (req, res) => {
    const broker = getBroker();
    try {
      const u = String(req.query.underlying || '').trim();
      if (!u) return res.status(400).json({ ok: false, reason: 'underlying required' });
      const list = typeof broker.listOptionExpiries === 'function' ? broker.listOptionExpiries(u) : [];
      res.json({ ok: true, underlying: u.toUpperCase(), expiries: list, count: list.length });
    } catch (e) {
      res.status(500).json({ ok: false, reason: e.message });
    }
  });

  // GET /api/indices/snapshot
  // Returns current LTPs for major Indian indices from the in-memory tick cache
  // (since /quotes doesn't return indices cleanly via the NSE:NIFTY key).
  app.get('/api/indices/snapshot', (_req, res) => {
    const broker = getBroker();
    try {
      const ticks = broker.getLastTicks ? broker.getLastTicks() : [];
      const wanted = ['NIFTY 50','NIFTY BANK','BANKNIFTY','SENSEX','FINNIFTY','NIFTY FIN SERVICE','MIDCPNIFTY','NIFTY MIDCAP 100','INDIA VIX'];
      const map = new Map(ticks.map(t => [t.symbol, t]));
      const rows = [];
      for (const sym of wanted) {
        const t = map.get(sym);
        if (t) rows.push({ symbol: sym, ltp: t.ltp, ts: t.ts });
      }
      res.json({ ok: true, count: rows.length, rows });
    } catch (e) {
      res.status(500).json({ ok: false, reason: e.message });
    }
  });

  // GET /api/calc/position-size?account=100000&riskPct=1&stopLossPct=2&entryPrice=100
  // Pure math: qty = floor((account * riskPct/100) / (entryPrice * stopLossPct/100))
  app.get('/api/calc/position-size', (req, res) => {
    try {
      const account     = Number(req.query.account);
      const riskPct     = Number(req.query.riskPct || 1);
      const stopLossPct = Number(req.query.stopLossPct);
      const entryPrice  = Number(req.query.entryPrice || 0);
      if (!Number.isFinite(account) || account <= 0)         return res.status(400).json({ ok: false, reason: 'account must be positive' });
      if (!Number.isFinite(riskPct) || riskPct <= 0)         return res.status(400).json({ ok: false, reason: 'riskPct must be positive' });
      if (!Number.isFinite(stopLossPct) || stopLossPct <= 0) return res.status(400).json({ ok: false, reason: 'stopLossPct must be positive' });

      const riskAmount = +(account * (riskPct / 100)).toFixed(2);
      let qty = null, perShareRisk = null, capitalDeployed = null;
      if (entryPrice > 0) {
        perShareRisk = +(entryPrice * (stopLossPct / 100)).toFixed(4);
        qty = Math.floor(riskAmount / perShareRisk);
        capitalDeployed = +(qty * entryPrice).toFixed(2);
      }

      res.json({
        ok: true,
        inputs: { account, riskPct, stopLossPct, entryPrice: entryPrice || null },
        riskAmount,
        perShareRisk,
        suggestedQty: qty,
        capitalDeployed,
        capitalUtilizationPct: capitalDeployed != null ? +(capitalDeployed / account * 100).toFixed(2) : null,
      });
    } catch (e) {
      res.status(500).json({ ok: false, reason: e.message });
    }
  });
}

module.exports = { mountMarketDataRoutes };
