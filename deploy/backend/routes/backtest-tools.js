// backtest-tools.js -- T-410 (architecture audit #1, server.js split #39).
// Five compute-only routes (no money movement, all read-broker / read-csv):
//   - GET  /api/option-chain
//   - POST /api/backtest
//   - POST /api/backtest/watchlist
//   - POST /api/tune                (hyperparameter sweep)
//   - POST /api/reconcile/import-csv
//
// Pure computation. All historical-data fetches go through broker.getHistorical;
// only side-effect is audit() entries on backtest/tune/reconcile.

'use strict';

const csvImport = require('../csv-import');

function mountBacktestToolsRoutes(app, deps) {
  const {
    BACKTEST_MAX_DAYS,
    audit,
    getBroker,
    getPaper,
    getWatchlist,
    runBacktest,
  } = deps;
  if (typeof BACKTEST_MAX_DAYS !== 'number') throw new Error('backtest-tools: BACKTEST_MAX_DAYS required');
  if (typeof audit        !== 'function') throw new Error('backtest-tools: audit required');
  if (typeof getBroker    !== 'function') throw new Error('backtest-tools: getBroker required');
  if (typeof getPaper     !== 'function') throw new Error('backtest-tools: getPaper required');
  if (typeof getWatchlist !== 'function') throw new Error('backtest-tools: getWatchlist required');
  if (typeof runBacktest  !== 'function') throw new Error('backtest-tools: runBacktest required');
  // T-428 (audit-2026-05-26 backend H5): added withAuth for backtest routes
  // that hit broker.getHistorical -- was unauth, any cookie-auth user could
  // loop them to drain operator's Kite quota.
  const withAuth = deps.withAuth;
  if (typeof withAuth !== 'function') throw new Error('backtest-tools: withAuth required');

  // ---------- Option chain ----------
  app.get('/api/option-chain', async (req, res) => {
    try {
      const broker = getBroker();
      const underlying = String(req.query.symbol || req.query.underlying || '').trim();
      const expiry     = String(req.query.expiry || '').trim();
      if (!underlying || !expiry) return res.status(400).json({ ok: false, reason: 'symbol and expiry required' });
      const includeQuotes = req.query.includeQuotes === '1' || req.query.includeQuotes === 'true';
      const strikesAround = Math.max(1, Math.min(50, parseInt(req.query.strikes || '10', 10) || 10));

      const chain = broker.getOptionChain(underlying, expiry);

      let spot = null;
      if (req.query.spot) {
        const s = Number(req.query.spot);
        if (Number.isFinite(s) && s > 0) spot = s;
      }
      if (spot == null) {
        try {
          const ticks = broker.getLastTicks ? broker.getLastTicks() : [];
          const indexSymbolMap = { 'NIFTY':'NIFTY 50', 'BANKNIFTY':'NIFTY BANK', 'FINNIFTY':'NIFTY FIN SERVICE' };
          const want = indexSymbolMap[underlying.toUpperCase()] || underlying;
          const hit = ticks.find(t => t.symbol === want);
          if (hit) spot = hit.ltp;
        } catch (e) { console.warn('[option-chain] swallowed:', e && e.message); }
      }

      if (spot == null && typeof broker.getQuotes === 'function') {
        try {
          const indexSymbolMap = { 'NIFTY':'NIFTY 50', 'BANKNIFTY':'NIFTY BANK', 'FINNIFTY':'NIFTY FIN SERVICE' };
          const idxSym = indexSymbolMap[underlying.toUpperCase()];
          if (idxSym) {
            const q = await broker.getQuotes([idxSym]);
            const v = q && (q[`NSE:${idxSym}`] || q[idxSym]);
            if (v && typeof v.last_price === 'number') spot = v.last_price;
          }
        } catch (e) { console.warn('[option-chain] swallowed:', e && e.message); }
      }

      let enrichedCount = 0;
      if (includeQuotes && chain.strikes.length > 0) {
        let atmIdx = Math.floor(chain.strikes.length / 2);
        if (spot != null) {
          let bestDiff = Infinity;
          for (let i = 0; i < chain.strikes.length; i++) {
            const diff = Math.abs(chain.strikes[i].strike - spot);
            if (diff < bestDiff) { bestDiff = diff; atmIdx = i; }
          }
        }
        const lo = Math.max(0, atmIdx - strikesAround);
        const hi = Math.min(chain.strikes.length - 1, atmIdx + strikesAround);

        const symbols = [];
        for (let i = lo; i <= hi; i++) {
          const r = chain.strikes[i];
          if (r.ce) symbols.push(`NFO:${r.ce.tradingsymbol}`);
          if (r.pe) symbols.push(`NFO:${r.pe.tradingsymbol}`);
        }
        if (symbols.length > 0) {
          try {
            const quotes = await broker.getQuotes(symbols);
            for (let i = lo; i <= hi; i++) {
              const r = chain.strikes[i];
              const decorate = (leg) => {
                if (!leg) return;
                const k = `NFO:${leg.tradingsymbol}`;
                const v = quotes[k];
                if (v) {
                  leg.ltp = v.last_price;
                  leg.oi = v.oi;
                  leg.volume = v.volume;
                  leg.netChange = v.net_change;
                  if (v.ohlc) leg.ohlc = v.ohlc;
                  enrichedCount++;
                }
              };
              decorate(r.ce);
              decorate(r.pe);
            }
          } catch (e) {
            console.warn('[option-chain] quote enrichment failed:', e.message);
          }
        }
        chain.atmIndex = atmIdx;
        chain.enriched = { from: lo, to: hi, legsQuoted: enrichedCount };
      }

      res.json({ ok: true, spot, ...chain });
    } catch (e) {
      res.status(400).json({ ok: false, reason: e.message });
    }
  });

  // ---------- Backtest (single symbol) ----------
  app.post('/api/backtest', withAuth(async (req, res) => {
    try {
      const broker = getBroker();
      const { symbol, strategy, from, to, qty, params, interval } = req.body || {};
      if (!symbol)   return res.status(400).json({ ok:false, reason:'symbol required' });
      if (!strategy) return res.status(400).json({ ok:false, reason:'strategy required (rsi_mean_revert | ema_cross | macd_cross | bollinger)' });
      if (!from || !to) return res.status(400).json({ ok:false, reason:'from and to required (YYYY-MM-DD)' });
      const dFrom = new Date(String(from));
      const dTo   = new Date(String(to));
      if (!isFinite(dFrom.getTime()) || !isFinite(dTo.getTime())) {
        return res.status(400).json({ ok: false, reason: 'from/to must be valid dates' });
      }
      const days = Math.floor((dTo.getTime() - dFrom.getTime()) / (86400 * 1000));
      if (days < 0) return res.status(400).json({ ok: false, reason: 'to must be after from' });
      if (days > BACKTEST_MAX_DAYS) {
        return res.status(400).json({ ok: false, reason: `range too wide: ${days}d > ${BACKTEST_MAX_DAYS}d max (set BACKTEST_MAX_DAYS env to override)` });
      }

      const candles = await broker.getHistorical({ symbol, interval: interval || 'day', from, to });
      if (!Array.isArray(candles) || candles.length < 30) {
        return res.status(400).json({ ok:false, reason:`need >= 30 candles, got ${candles ? candles.length : 0}` });
      }

      const result = runBacktest({
        candles, strategy, params: params || {}, qty: Number(qty) || 1,
      });
      audit('backtest.run', { symbol, strategy, bars: result.bars, trades: result.stats.trades, pnl: result.stats.totalPnl });
      res.json({ ok: true, symbol, from, to, ...result });
    } catch (e) {
      res.status(400).json({ ok: false, reason: e.message });
    }
  }));

  // ---------- Backtest (whole watchlist) ----------
  app.post('/api/backtest/watchlist', withAuth(async (req, res) => {
    try {
      const broker = getBroker();
      const watchlist = getWatchlist();
      if (!watchlist) return res.status(503).json({ ok: false, reason: 'watchlist_not_initialized' });
      const { strategy, from, to, qty, params, interval } = req.body || {};
      if (!strategy)    return res.status(400).json({ ok: false, reason: 'strategy required' });
      if (!from || !to) return res.status(400).json({ ok: false, reason: 'from and to required' });

      const symbols = watchlist.list().filter(s =>
        !/^(NIFTY|BANKNIFTY|SENSEX|FINNIFTY|MIDCPNIFTY|INDIA VIX)/i.test(s) &&
        !/(CE|PE|FUT)$/.test(s)
      );
      if (symbols.length === 0) return res.json({ ok: true, results: [], note: 'no scannable symbols in watchlist' });

      const results = [];
      const errors = {};
      for (const symbol of symbols) {
        try {
          const candles = await broker.getHistorical({ symbol, interval: interval || 'day', from, to });
          if (!Array.isArray(candles) || candles.length < 30) {
            errors[symbol] = `only ${candles ? candles.length : 0} candles`;
            continue;
          }
          const r = runBacktest({
            candles, strategy, params: params || {}, qty: Number(qty) || 1,
          });
          results.push({
            symbol,
            trades: r.stats.trades,
            winRate: r.stats.winRate,
            totalPnl: r.stats.totalPnl,
            buyAndHoldPnl: r.stats.buyAndHoldPnl,
            vsBuyAndHold: r.stats.vsBuyAndHold,
            maxDrawdown: r.stats.maxDrawdown,
            avgWin: r.stats.avgWin,
            avgLoss: r.stats.avgLoss,
          });
        } catch (e) {
          errors[symbol] = e.message;
        }
        await new Promise(r => setTimeout(r, 250));
      }

      results.sort((a, b) => b.totalPnl - a.totalPnl);

      const aggregate = {
        symbolsScanned: results.length,
        totalPnl: +results.reduce((s, r) => s + r.totalPnl, 0).toFixed(2),
        profitable: results.filter(r => r.totalPnl > 0).length,
        losing:     results.filter(r => r.totalPnl < 0).length,
        avgWinRate: results.length ? +(results.reduce((s, r) => s + r.winRate, 0) / results.length).toFixed(2) : 0,
      };

      audit('backtest.watchlist', { strategy, ...aggregate });
      res.json({ ok: true, strategy, from, to, qty: Number(qty) || 1, aggregate, results, errors: Object.keys(errors).length ? errors : null });
    } catch (e) {
      res.status(500).json({ ok: false, reason: e.message });
    }
  }));

  // ---------- Hyperparameter tuner ----------
  app.post('/api/tune', async (req, res) => {
    try {
      const broker = getBroker();
      const { symbol, strategy, paramGrid, from, to, qty, interval } = req.body || {};
      if (!symbol)    return res.status(400).json({ ok:false, reason:'symbol required' });
      if (!strategy)  return res.status(400).json({ ok:false, reason:'strategy required' });
      if (!paramGrid || typeof paramGrid !== 'object') {
        return res.status(400).json({ ok:false, reason:'paramGrid required (object of name -> values[])' });
      }
      if (!from || !to) return res.status(400).json({ ok:false, reason:'from and to required' });
      const top = Math.max(1, Math.min(50, parseInt(req.body.top || '10', 10) || 10));

      const keys = Object.keys(paramGrid);
      let combos = [{}];
      for (const k of keys) {
        const vals = Array.isArray(paramGrid[k]) ? paramGrid[k] : [paramGrid[k]];
        const next = [];
        for (const c of combos) for (const v of vals) next.push({ ...c, [k]: v });
        combos = next;
        if (combos.length > 200) {
          return res.status(400).json({ ok:false, reason:`grid too large: ${combos.length} combinations (cap 200)` });
        }
      }

      const candles = await broker.getHistorical({ symbol, interval: interval || 'day', from, to });
      if (!Array.isArray(candles) || candles.length < 30) {
        return res.status(400).json({ ok:false, reason:`need >= 30 candles, got ${candles ? candles.length : 0}` });
      }

      const results = [];
      for (const params of combos) {
        try {
          const r = runBacktest({ candles, strategy, params, qty: Number(qty) || 1 });
          results.push({
            params,
            trades:        r.stats.trades,
            winRate:       r.stats.winRate,
            totalPnl:      r.stats.totalPnl,
            maxDrawdown:   r.stats.maxDrawdown,
            buyAndHoldPnl: r.stats.buyAndHoldPnl,
            vsBuyAndHold:  r.stats.vsBuyAndHold,
          });
        } catch (e) {
          results.push({ params, error: e.message });
        }
      }
      results.sort((a, b) => {
        const ap = a.totalPnl || -Infinity;
        const bp = b.totalPnl || -Infinity;
        if (bp !== ap) return bp - ap;
        return (a.maxDrawdown || Infinity) - (b.maxDrawdown || Infinity);
      });
      audit('tune.run', { symbol, strategy, combos: combos.length, bestPnl: results[0] && results[0].totalPnl });
      res.json({
        ok: true, symbol, strategy, from, to,
        candlesUsed: candles.length,
        combinations: combos.length,
        top: results.slice(0, top),
        worst: results.slice(-3).reverse(),
      });
    } catch (e) {
      res.status(500).json({ ok:false, reason: e.message });
    }
  });

  // ---------- Settlement CSV reconcile ----------
  app.post('/api/reconcile/import-csv', (req, res) => {
    try {
      const paper = getPaper();
      const csv = (req.body && (req.body.csv || req.body.text)) || '';
      if (!csv || typeof csv !== 'string') return res.status(400).json({ ok:false, reason:'csv string required in body' });
      if (csv.length > 1024 * 1024) return res.status(400).json({ ok:false, reason:'csv too large (>1MB)' });
      const backendOrders = paper ? paper.list() : [];
      const result = csvImport.reconcileCsv(csv, backendOrders);
      audit('reconcile.csv', { parsed: result.parsed, matched: result.matched, onlyInCsv: result.onlyInCsv.length });
      res.json({ ok:true, ...result });
    } catch (e) { res.status(500).json({ ok:false, reason:e.message }); }
  });
}

module.exports = { mountBacktestToolsRoutes };
