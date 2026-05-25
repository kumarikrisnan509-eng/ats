// me-heavy.js -- T-408 (architecture audit #1, server.js split #35).
// 5 heavy user-scoped aggregator routes.
//
//   - GET /api/me/modes/runtime         (T-185: paper positions + trades aggregated per mode)
//   - GET /api/me/factor-exposure       (Tier 69b: holdings + 252d candles + sector map)
//   - GET /api/me/risk-metrics          (Tier 69a: VaR/maxDD/Sharpe/Sortino/Calmar from pnl_daily)
//   - GET /api/me/dashboard-summary     (Tier 60: holdings + paper + 30d win-rate aggregate)
//   - GET /api/v1/me/orders/by-mode     (Tier 82: paper + live orders bucketed)

'use strict';

function mountMeHeavyRoutes(app, deps) {
  const { withAuth, getDb, getVault, getBroker, getBrokerResolver } = deps;
  if (typeof withAuth          !== 'function') throw new Error('me-heavy: withAuth required');
  if (typeof getDb             !== 'function') throw new Error('me-heavy: getDb required');
  if (typeof getVault          !== 'function') throw new Error('me-heavy: getVault required');
  if (typeof getBroker         !== 'function') throw new Error('me-heavy: getBroker required');
  if (typeof getBrokerResolver !== 'function') throw new Error('me-heavy: getBrokerResolver required');

  // T-185
  app.get('/api/me/modes/runtime', withAuth(async (req, res) => {
    const db = getDb();
    const uid = req.user.id;
    const empty = () => ({ openPositions: 0, utilized: 0, todayPnl: 0, strategiesRunning: 0 });
    const out = { intraday: empty(), swing: empty(), options: empty(), futures: empty() };

    const classify = (sym) => {
      const s = String(sym || '').toUpperCase();
      if (/\bCE\b|\bPE\b|CALL|PUT/.test(s)) return 'options';
      if (/\bFUT\b|FUTURES/.test(s))           return 'futures';
      return 'intraday';
    };

    try {
      const positions = (db && db.paper && typeof db.paper.listPositions === 'function')
        ? (db.paper.listPositions(uid) || []) : [];
      for (const p of positions) {
        const mode = classify(p.symbol);
        const qty  = Number(p.qty || 0);
        const avg  = Number(p.avg_price || 0);
        if (!qty) continue;
        out[mode].openPositions += 1;
        out[mode].utilized      += Math.abs(qty) * avg;
      }
    } catch (e) { console.warn('[modes-runtime] positions:', e && e.message); }

    try {
      if (db && db._conn) {
        const rows = db._conn.prepare(
          "SELECT symbol, pnl FROM paper_closed_trades " +
          "WHERE user_id = ? AND date(exited_at) = date('now')"
        ).all(uid) || [];
        for (const r of rows) {
          const mode = classify(r.symbol);
          out[mode].todayPnl += Number(r.pnl || 0);
        }
      }
    } catch (e) { console.warn('[modes-runtime] todayPnl:', e && e.message); }

    try {
      if (db && db._conn) {
        const rows = db._conn.prepare(
          "SELECT DISTINCT strategy_tag, symbol FROM paper_orders " +
          "WHERE user_id = ? AND strategy_tag IS NOT NULL AND strategy_tag != '' " +
          "  AND created_at >= datetime('now','-7 days')"
        ).all(uid) || [];
        const perMode = { intraday: new Set(), swing: new Set(), options: new Set(), futures: new Set() };
        for (const r of rows) {
          perMode[classify(r.symbol)].add(r.strategy_tag);
        }
        for (const k of Object.keys(perMode)) {
          out[k].strategiesRunning = perMode[k].size;
        }
      }
    } catch (e) { console.warn('[modes-runtime] strategies:', e && e.message); }

    for (const k of Object.keys(out)) {
      out[k].utilized = Math.round(out[k].utilized);
      out[k].todayPnl = Math.round(out[k].todayPnl);
    }

    res.json({ ok: true, runtime: out, asOf: new Date().toISOString() });
  }));

  // Tier 69b
  app.get('/api/me/factor-exposure', withAuth(async (req, res) => {
    try {
      const db = getDb();
      const vault = getVault();
      const broker = getBroker();
      const r = await getBrokerResolver().resolveForRequest({ db, vault, globalBroker: null, fallbackToGlobal: false }, req);
      if (!r.broker) return res.json({ ok: true, brokerConnected: false, enoughData: false, reason: 'broker_not_connected' });
      const holdings = await r.broker.getHoldings();
      if (!Array.isArray(holdings) || holdings.length === 0) {
        return res.json({ ok: true, brokerConnected: true, enoughData: false, reason: 'no_holdings' });
      }

      const candlesBySymbol = {};
      const sectorMap = {};
      const today = new Date();
      const fromDate = new Date(today.getTime() - 380 * 86400 * 1000);
      const toStr = today.toISOString().slice(0, 10);
      const fromStr = fromDate.toISOString().slice(0, 10);

      for (const h of holdings) {
        const sym = h.tradingsymbol || h.symbol;
        if (!sym) continue;
        try {
          const candles = await r.broker.getHistorical({ symbol: sym, interval: 'day', from: fromStr, to: toStr });
          candlesBySymbol[sym] = (candles || []).map(c => ({ date: c.date || c.timestamp, close: Number(c.close || 0) }));
        } catch (e) {
          candlesBySymbol[sym] = [];
        }
        try {
          if (broker && broker.instruments && typeof broker.instruments.lookup === 'function') {
            const meta = broker.instruments.lookup(sym);
            if (meta && meta.sector) sectorMap[sym] = meta.sector;
          }
        } catch (e) { console.warn('[factor-exposure] swallowed:', e && e.message); }
        if (!sectorMap[sym]) {
          try {
            const { sectorOf } = require('../sector-map');
            const s = sectorOf(sym);
            if (s) sectorMap[sym] = s;
          } catch (e) { console.warn('[factor-exposure] swallowed:', e && e.message); }
        }
      }

      const norm = holdings.map(h => ({
        symbol: h.tradingsymbol || h.symbol,
        qty: Number(h.quantity || h.qty || 0),
        ltp: Number(h.ltp || h.last_price || 0),
      }));

      const { computeFactorExposure } = require('../factor-exposure');
      const out = computeFactorExposure({ holdings: norm, candlesBySymbol, sectorMap });
      res.json({ ok: true, brokerConnected: true, ...out });
    } catch (e) {
      res.status(500).json({ ok: false, reason: 'factor_exposure_failed', detail: e.message });
    }
  }));

  // Tier 69a
  app.get('/api/me/risk-metrics', withAuth((req, res) => {
    try {
      const db = getDb();
      const days = Math.min(1095, Math.max(2, Number(req.query.days) || 252));
      const rows = db.pnl.recent(req.user.id, days);
      const dailyEquity = (rows || []).map(r => ({ date: r.date, equity: Number(r.equity || 0) })).reverse();
      const { computeRiskMetrics } = require('../risk-engine');
      const out = computeRiskMetrics(dailyEquity, { rfAnnual: 0.065 });
      res.json({ ok: true, ...out });
    } catch (e) {
      res.status(500).json({ ok: false, reason: 'risk_compute_failed', detail: e.message });
    }
  }));

  // Tier 60
  app.get('/api/me/dashboard-summary', withAuth(async (req, res) => {
    try {
      const db = getDb();
      const vault = getVault();
      const uid = req.user.id;
      const out = {
        brokerConnected: false,
        portfolioValue: 0, portfolioPnl: 0, portfolioPnlPct: 0, portfolioInvested: 0,
        holdingsCount: 0,
        todayPnl: 0, paperRealized: 0, paperUnrealized: 0,
        deployedCapital: 0, initialCapital: 0,
        cashPaper: 0,
        winRate30d: null, totalTrades30d: 0, totalWins30d: 0,
        asOf: new Date().toISOString(),
      };
      try {
        const r = await getBrokerResolver().resolveForRequest({ db, vault, globalBroker: null, fallbackToGlobal: false }, req);
        if (r.broker) {
          out.brokerConnected = true;
          const holdings = await r.broker.getHoldings();
          const rows = Array.isArray(holdings) ? holdings : [];
          out.holdingsCount = rows.length;
          for (const h of rows) {
            const qty = Number(h.quantity || h.qty || 0);
            const ltp = Number(h.ltp || h.last_price || h.lastPrice || 0);
            const avg = Number(h.average_price || h.avgPrice || h.avg_price || 0);
            const pnl = Number(h.pnl || h.unrealised || 0) || ((ltp - avg) * qty);
            out.portfolioValue    += qty * ltp;
            out.portfolioInvested += qty * avg;
            out.portfolioPnl      += pnl;
          }
          if (out.portfolioInvested > 0) {
            out.portfolioPnlPct = (out.portfolioPnl / out.portfolioInvested) * 100;
          }
        }
      } catch (e) { /* per-user holdings failed; leave zeros */ }
      const paper = db.paper.getState(uid);
      if (paper) {
        out.cashPaper      = Number(paper.cash || 0);
        out.initialCapital = Number(paper.initial_capital || 0);
        out.paperRealized  = Number(paper.realized_pnl || 0);
        const positions   = db.paper.listPositions(uid) || [];
        out.paperUnrealized = 0;
        out.todayPnl        = out.paperRealized + out.paperUnrealized;
        out.deployedCapital = Math.max(0,
          (out.initialCapital - out.cashPaper) +
          positions.reduce((s, p) => s + (p.qty * p.avg_price), 0));
      }
      try {
        const rows30 = db._conn.prepare(
          "SELECT pnl FROM paper_closed_trades WHERE user_id = ? AND exited_at >= datetime('now','-30 days')"
        ).all(uid);
        out.totalTrades30d = rows30.length;
        out.totalWins30d = rows30.filter(r => Number(r.pnl) > 0).length;
        if (out.totalTrades30d > 0) {
          out.winRate30d = (out.totalWins30d / out.totalTrades30d) * 100;
        }
      } catch (e) { /* empty for new users */ }
      res.json({ ok: true, ...out });
    } catch (e) {
      res.status(500).json({ ok: false, reason: 'summary_failed', detail: e.message });
    }
  }));

  // Tier 82
  app.get('/api/v1/me/orders/by-mode', withAuth(async (req, res) => {
    try {
      const db = getDb();
      const vault = getVault();
      const buckets = { intraday: 0, swing: 0, options: 0, futures: 0 };
      let paperOrders = [];
      try { paperOrders = (db && db.paper) ? db.paper.listOrders(req.user.id) : []; } catch (e) { console.warn('[orders-by-mode] swallowed:', e && e.message); }
      let liveOrders = [];
      try {
        const { getBrokerForUser } = require('../broker-resolver');
        const ub = await getBrokerForUser({ db, vault }, req.user.id);
        if (ub && ub.kc && typeof ub.kc.getOrders === 'function') {
          liveOrders = await ub.kc.getOrders().catch(() => []);
        }
      } catch (e) { console.warn('[orders-by-mode] swallowed:', e && e.message); }
      const all = [...paperOrders, ...liveOrders];
      for (const o of all) {
        const prod = String(o.product || o.product_type || '').toUpperCase();
        const sym  = String(o.symbol || o.tradingsymbol || '').toUpperCase();
        const isOpt = /CE$|PE$/.test(sym) || /OPT/.test(sym);
        const isFut = /FUT/.test(sym);
        if (prod === 'MIS') buckets.intraday++;
        else if (prod === 'CNC') buckets.swing++;
        else if (prod === 'NRML' && isOpt) buckets.options++;
        else if (prod === 'NRML' && isFut) buckets.futures++;
        else if (prod === 'NRML') buckets.options++;
      }
      res.json({ ok: true, total: all.length, byMode: buckets, source: liveOrders.length ? 'live+paper' : (paperOrders.length ? 'paper' : 'empty') });
    } catch (e) {
      res.status(500).json({ ok: false, reason: 'orders_by_mode_failed', detail: e.message });
    }
  }));
}

module.exports = { mountMeHeavyRoutes };
