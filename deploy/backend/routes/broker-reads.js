// broker-reads.js -- T-409 (architecture audit #1, server.js split #38).
// Five broker-read routes (no money-movement, all GET):
//   - GET /api/orders      (resolveUserBroker, all-paper-orders shape)
//   - GET /api/profile     (withAuth + pickBroker, user-or-global)
//   - GET /api/margins     (withAuth + pickBroker, user-or-global)
//   - GET /api/reconcile   (withAuth, side-by-side broker vs paper)
//   - GET /api/benchmark   (strategy backtest vs benchmark candles)
//
// All five are read-only and safe to relocate. /api/profile and /api/margins
// were T-357-gated with withAuth (security audit fixed cross-user data leak).
// /api/reconcile is also T-357-gated.

'use strict';

function mountBrokerReadsRoutes(app, deps) {
  const {
    withAuth,
    KILL_SWITCH,
    LIVE_TRADING,
    getBroker,
    getPaper,
    resolveUserBroker,
    pickBroker,
    runBacktest,
  } = deps;
  if (typeof withAuth          !== 'function') throw new Error('broker-reads: withAuth required');
  if (typeof getBroker         !== 'function') throw new Error('broker-reads: getBroker required');
  if (typeof getPaper          !== 'function') throw new Error('broker-reads: getPaper required');
  if (typeof resolveUserBroker !== 'function') throw new Error('broker-reads: resolveUserBroker required');
  if (typeof pickBroker        !== 'function') throw new Error('broker-reads: pickBroker required');
  if (typeof runBacktest       !== 'function') throw new Error('broker-reads: runBacktest required');

  // /api/orders -- per-user broker orders (read).
  app.get('/api/orders', async (req, res) => {
    try {
      const r = await resolveUserBroker(req);
      if (!r.broker) return res.json({ ok: true, brokerConnected: false, reason: r.reason, rows: [] });
      const rows = await r.broker.getOrders();
      res.json({ ok: true, brokerConnected: true, rows });
    } catch (e) {
      res.status(500).json({ ok: false, reason: e.message });
    }
  });

  // /api/profile -- T-357 gated. Returns user's broker profile (or global if user
  // not connected, but only when the caller is authenticated).
  app.get('/api/profile', withAuth(async (req, res) => {
    try {
      const p = await pickBroker(req);
      if (!p.broker) return res.status(503).json({ ok: false, reason: 'broker_unavailable' });
      res.json({ ok: true, profile: await p.broker.getProfile(), isUserOwn: p.isUserOwn });
    } catch (e) {
      res.status(500).json({ ok: false, reason: e.message });
    }
  }));

  // /api/margins -- T-357 gated.
  app.get('/api/margins', withAuth(async (req, res) => {
    try {
      const p = await pickBroker(req);
      if (!p.broker) return res.status(503).json({ ok: false, reason: 'broker_unavailable' });
      res.json({ ok: true, margins: await p.broker.getMargins(), isUserOwn: p.isUserOwn });
    } catch (e) {
      res.status(500).json({ ok: false, reason: e.message });
    }
  }));

  // /api/reconcile -- side-by-side broker vs paper state.
  // T-357 gated. KILL_SWITCH/LIVE_TRADING captured by value at mount time
  // (these are config consts that don't change at runtime).
  app.get('/api/reconcile', withAuth(async (_req, res) => {
    const paper  = getPaper();
    const broker = getBroker();
    if (!paper) return res.status(503).json({ ok: false, reason: 'paper_not_initialized' });

    const safe = async (fn) => {
      try { return { ok: true, data: await fn() }; }
      catch (e) { return { ok: false, error: e.message }; }
    };

    const [holdingsR, positionsR, ordersR, marginsR] = await Promise.all([
      safe(() => broker.getHoldings()),
      safe(() => broker.getPositions()),
      safe(() => broker.getOrders()),
      safe(() => broker.getMargins()),
    ]);

    // ---- Cash drift ----
    let brokerCash = null;
    if (marginsR.ok && marginsR.data) {
      const eq = marginsR.data.equity || {};
      const av = eq.available || {};
      brokerCash = typeof av.cash === 'number' ? av.cash
                 : typeof av.live_balance === 'number' ? av.live_balance
                 : typeof eq.net === 'number' ? eq.net
                 : null;
    }
    const paperStats = paper.stats();

    // ---- Holdings diff ----
    const brokerHoldings = holdingsR.ok && Array.isArray(holdingsR.data) ? holdingsR.data : [];
    const paperPositions = paper.positions();
    const holdingsBySymbol = new Map();
    for (const h of brokerHoldings) {
      const s = (h.tradingsymbol || h.symbol || '').toUpperCase();
      if (!s) continue;
      holdingsBySymbol.set(s, {
        symbol: s,
        brokerQty: Number(h.quantity || 0),
        brokerAvg: Number(h.average_price || 0),
        brokerLtp: Number(h.last_price || 0),
        paperQty: 0,
        paperAvg: 0,
      });
    }
    for (const p of paperPositions) {
      const s = p.symbol.toUpperCase();
      const cur = holdingsBySymbol.get(s) || { symbol: s, brokerQty: 0, brokerAvg: 0, brokerLtp: p.ltp || 0, paperQty: 0, paperAvg: 0 };
      cur.paperQty = p.qty;
      cur.paperAvg = p.avgPrice;
      holdingsBySymbol.set(s, cur);
    }
    const holdingsRows = Array.from(holdingsBySymbol.values()).map(r => ({
      ...r,
      qtyDrift: r.brokerQty - r.paperQty,
      matches: r.brokerQty === r.paperQty,
    }));

    // ---- Pending-orders diff ----
    const allPaperOrders = paper.list();
    const paperPending = allPaperOrders.filter(o => o.status === 'PENDING');
    const brokerOrdersAll = ordersR.ok && Array.isArray(ordersR.data) ? ordersR.data : [];
    const brokerPending = brokerOrdersAll.filter(o => {
      const s = String(o.status || '').toUpperCase();
      return s === 'OPEN' || s === 'TRIGGER PENDING' || s === 'PENDING';
    });

    const summary = {
      cashDrift:        (brokerCash != null) ? +(brokerCash - paperStats.cash).toFixed(2) : null,
      holdingsDrifts:   holdingsRows.filter(r => !r.matches).length,
      paperPendingCnt:  paperPending.length,
      brokerPendingCnt: brokerPending.length,
    };

    res.json({
      ok: true,
      asOf: new Date().toISOString(),
      killSwitch: KILL_SWITCH,
      liveTrading: LIVE_TRADING,
      brokerName: broker.name,
      brokerConnected: !!(broker.health && broker.health().connected),
      brokerStalledOnToken: !!(broker.health && broker.health().stalledOnToken),
      brokerTickStale:      !!(broker.health && broker.health().tickStale),
      cash: {
        paper:    paperStats.cash,
        broker:   brokerCash,
        drift:    summary.cashDrift,
        brokerOk: marginsR.ok,
        brokerErr: marginsR.ok ? null : marginsR.error,
      },
      holdings: {
        rows:       holdingsRows,
        brokerOk:   holdingsR.ok,
        brokerErr:  holdingsR.ok ? null : holdingsR.error,
      },
      pendingOrders: {
        paper:     paperPending,
        broker:    brokerPending,
        brokerOk:  ordersR.ok,
        brokerErr: ordersR.ok ? null : ordersR.error,
      },
      paperStats: {
        totalEquity:   paperStats.totalEquity,
        realizedPnl:   paperStats.realizedPnl,
        unrealizedPnl: paperStats.unrealizedPnl,
        filledOrders:  paperStats.filledOrders,
        closedTrades:  paperStats.closedTrades,
      },
      summary,
    });
  }));

  // /api/benchmark -- strategy backtest with benchmark comparison (alpha/beta/sharpe).
  app.get('/api/benchmark', async (req, res) => {
    try {
      const broker = getBroker();
      const symbol    = req.query.symbol;
      const strategy  = req.query.strategy;
      const from      = req.query.from;
      const to        = req.query.to;
      const qty       = parseInt(req.query.qty || '1', 10) || 1;
      const benchmark = req.query.benchmark || 'NIFTY 50';
      const interval  = req.query.interval  || 'day';
      if (!symbol)   return res.status(400).json({ ok:false, reason:'symbol required' });
      if (!strategy) return res.status(400).json({ ok:false, reason:'strategy required' });
      if (!from || !to) return res.status(400).json({ ok:false, reason:'from and to required' });

      const params = {};
      for (const k of ['period','entryRsi','exitRsi','fast','slow','signal','k']) {
        if (req.query[k] != null) params[k] = Number(req.query[k]);
      }

      const [stratCandles, benchCandles] = await Promise.all([
        broker.getHistorical({ symbol,    interval, from, to }),
        broker.getHistorical({ symbol: benchmark, interval, from, to }),
      ]);
      if (!Array.isArray(stratCandles) || stratCandles.length < 30) {
        return res.status(400).json({ ok:false, reason:`strategy symbol needs >= 30 candles, got ${stratCandles ? stratCandles.length : 0}` });
      }
      if (!Array.isArray(benchCandles) || benchCandles.length < 30) {
        return res.status(400).json({ ok:false, reason:`benchmark symbol needs >= 30 candles, got ${benchCandles ? benchCandles.length : 0}` });
      }

      const bt = runBacktest({ candles: stratCandles, strategy, params, qty });

      const benchByDate = new Map();
      for (const c of benchCandles) benchByDate.set(c.date.slice(0, 10), c.close);

      const aligned = [];
      for (const e of bt.equity) {
        const d = e.date.slice(0, 10);
        if (benchByDate.has(d)) aligned.push({ date: d, eq: e.equity, bench: benchByDate.get(d) });
      }
      if (aligned.length < 30) {
        return res.status(400).json({ ok:false, reason:`only ${aligned.length} aligned bars between symbol and benchmark` });
      }

      const notional = stratCandles[0].close * qty;
      const stratRet = [];
      const benchRet = [];
      let prevS = notional + aligned[0].eq;
      let prevB = aligned[0].bench;
      for (let i = 1; i < aligned.length; i++) {
        const sNow = notional + aligned[i].eq;
        const bNow = aligned[i].bench;
        stratRet.push((sNow - prevS) / prevS);
        benchRet.push((bNow - prevB) / prevB);
        prevS = sNow;
        prevB = bNow;
      }
      const mean = a => a.reduce((s,x)=>s+x,0) / a.length;
      const std  = (a, m) => Math.sqrt(a.reduce((s,x)=>s+(x-m)*(x-m),0) / a.length);
      const cov  = (a, b, ma, mb) => {
        let s = 0; for (let i = 0; i < a.length; i++) s += (a[i]-ma)*(b[i]-mb);
        return s / a.length;
      };
      const mS = mean(stratRet), mB = mean(benchRet);
      const sS = std(stratRet, mS), sB = std(benchRet, mB);
      const c  = cov(stratRet, benchRet, mS, mB);
      const beta  = sB === 0 ? 0 : c / (sB * sB);
      const annStratRet = (1 + mS) ** 252 - 1;
      const annBenchRet = (1 + mB) ** 252 - 1;
      const alpha       = annStratRet - beta * annBenchRet;
      const sharpe      = sS === 0 ? 0 : (mS / sS) * Math.sqrt(252);
      const benchSharpe = sB === 0 ? 0 : (mB / sB) * Math.sqrt(252);
      const annVol = sS * Math.sqrt(252);
      const benchAnnVol = sB * Math.sqrt(252);
      let bPeak = -Infinity, bMaxDd = 0, bMaxDdPct = 0;
      for (const a of aligned) {
        if (a.bench > bPeak) bPeak = a.bench;
        const dd = bPeak - a.bench;
        if (dd > bMaxDd) {
          bMaxDd = dd;
          bMaxDdPct = bPeak !== 0 ? dd / bPeak * 100 : 0;
        }
      }
      const corr = (sS === 0 || sB === 0) ? 0 : c / (sS * sB);

      res.json({
        ok: true,
        symbol, strategy, benchmark, from, to,
        candlesUsed: stratCandles.length,
        benchmarkCandles: benchCandles.length,
        alignedBars: aligned.length,
        strategy_: {
          trades:         bt.stats.trades,
          winRate:        bt.stats.winRate,
          totalPnl:       bt.stats.totalPnl,
          annualReturn:   +(annStratRet * 100).toFixed(2),
          annualVol:      +(annVol * 100).toFixed(2),
          sharpe:         +sharpe.toFixed(2),
          maxDrawdown:    bt.stats.maxDrawdown,
          maxDrawdownPct: bt.stats.maxDrawdownPct,
        },
        benchmark_: {
          annualReturn:   +(annBenchRet * 100).toFixed(2),
          annualVol:      +(benchAnnVol * 100).toFixed(2),
          sharpe:         +benchSharpe.toFixed(2),
          maxDrawdown:    +bMaxDd.toFixed(2),
          maxDrawdownPct: +bMaxDdPct.toFixed(2),
        },
        vs: {
          alpha:          +(alpha * 100).toFixed(2),
          beta:           +beta.toFixed(3),
          correlation:    +corr.toFixed(3),
          excessSharpe:   +(sharpe - benchSharpe).toFixed(2),
          excessReturn:   +((annStratRet - annBenchRet) * 100).toFixed(2),
        },
      });
    } catch (e) {
      res.status(500).json({ ok:false, reason: e.message });
    }
  });
}

module.exports = { mountBrokerReadsRoutes };
