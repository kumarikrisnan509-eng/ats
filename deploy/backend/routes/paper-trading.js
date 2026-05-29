// paper-trading.js -- T-416 (architecture audit #1, server.js split #43).
// Five paper-trading + walk-forward routes. All withAuth-gated. Real-money
// gated by KILL_SWITCH at the server level (KILL_SWITCH=true on prod blocks
// the live-trading code paths these would feed into).
//
//   - GET  /api/me/paper                 (per-user state + orders + positions)
//   - POST /api/me/paper/order           (Tier 72: paper-trade order placement
//                                         using live LTP from global ticker)
//   - PUT  /api/me/paper/capital         (Tier 66: set initial capital, optional reset)
//   - POST /api/me/paper/promote-check   (E5: paper->live promotion gates --
//                                         pure read, no state change)
//   - POST /api/me/walk-forward          (T-301a: walk-forward parameter
//                                         optimization, CPU-bound, advisory)

'use strict';

// T-499/T-500: canonical paper->live promotion criteria. Single source of
// truth shared with the nightly promote-scheduler so UI and backend can't
// disagree on "is this strategy ready to go live".
const promotionPolicy = require('../services/promotion-policy');

function mountPaperTradingRoutes(app, deps) {
  const {
    withAuth,
    getDb,
    getBroker,
    getSurveillance,
    getEarningsCal,
    createWalkForward,
    runBacktest,
  } = deps;
  if (typeof withAuth          !== 'function') throw new Error('paper-trading: withAuth required');
  if (typeof getDb             !== 'function') throw new Error('paper-trading: getDb required');
  if (typeof getBroker         !== 'function') throw new Error('paper-trading: getBroker required');
  if (typeof getSurveillance   !== 'function') throw new Error('paper-trading: getSurveillance required');
  if (typeof getEarningsCal    !== 'function') throw new Error('paper-trading: getEarningsCal required');
  if (typeof createWalkForward !== 'function') throw new Error('paper-trading: createWalkForward required');
  if (typeof runBacktest       !== 'function') throw new Error('paper-trading: runBacktest required');

  // ---------- GET /api/me/paper ----------
  // T-536: expanded payload — now includes stats + trades so the React paper
  // screen can derive every KPI (Virtual capital, P&L, Trades, win rate, etc.)
  // from a SINGLE API call. Previously the UI made 3 separate calls to the
  // legacy /api/paper endpoints (which read from the global singleton) and
  // mixed that data with per-user data, causing inconsistency.
  app.get('/api/me/paper', withAuth((req, res) => {
    const db = getDb();
    const uid = req.user.id;
    const state     = db.paper.getState(uid);
    const orders    = db.paper.listOrders(uid);
    const positions = db.paper.listPositions(uid);
    const trades    = db._conn.prepare('SELECT * FROM paper_closed_trades WHERE user_id = ? ORDER BY exited_at DESC LIMIT 200').all(uid);

    const totalOrders     = orders.length;
    const filledOrders    = orders.filter(o => String(o.status || '').toUpperCase() === 'FILLED').length;
    const pendingOrders   = orders.filter(o => String(o.status || '').toUpperCase() === 'PENDING' || String(o.status || '').toUpperCase() === 'OPEN').length;
    const cancelledOrders = orders.filter(o => String(o.status || '').toUpperCase() === 'CANCELLED').length;
    const closedTrades    = trades.length;
    const wins            = trades.filter(t => Number(t.pnl) > 0).length;
    const losses          = trades.filter(t => Number(t.pnl) < 0).length;
    const winRate         = closedTrades > 0 ? Math.round((wins / closedTrades) * 100) : 0;
    const realizedPnl     = trades.reduce((s, t) => s + Number(t.pnl || 0), 0);
    // Unrealized P&L would need LTP per position; without a tick cache here,
    // we approximate as 0. The /api/me/paper consumer can hydrate via /api/ticks.
    const unrealizedPnl   = 0;
    const positionsValue  = positions.reduce((s, p) => s + Number(p.avg_price || 0) * Number(p.qty || 0), 0);
    const totalEquity     = Number(state.cash || 0) + positionsValue + unrealizedPnl;

    res.json({
      ok: true,
      state,
      orders,
      positions,
      trades,
      stats: {
        cash:           Number(state.cash || 0),
        initialCapital: Number(state.initial_capital || 0),
        tier:           String(state.tier || ''),
        openPositions:  positions.length,
        totalOrders,
        filledOrders,
        pendingOrders,
        cancelledOrders,
        closedTrades,
        wins,
        losses,
        winRate,
        realizedPnl,
        unrealizedPnl,
        positionsValue,
        totalEquity,
      },
    });
  }));

  // ---------- GET /api/me/paper/equity-curve (T-525) ----------
  // Real paper equity curve derived from this user's closed paper trades.
  // Series = initial_capital baseline + cumulative realized P&L, ordered by
  // trade exit time. Supports ?window=7d|30d|all (default all). Replaces the
  // seriesRandom() demo series the React Paper screen used before T-525.
  app.get('/api/me/paper/equity-curve', withAuth((req, res) => {
    const db = getDb();
    const uid = req.user.id;
    const state = db.paper.getState(uid);
    const baseline = Number(state.initial_capital || state.cash || 0);
    const w = String((req.query && req.query.window) || 'all').toLowerCase();
    const days = w === '7d' ? 7 : w === '30d' ? 30 : null;
    let sql = 'SELECT pnl, exited_at FROM paper_closed_trades WHERE user_id = ?';
    const args = [uid];
    if (days) { sql += " AND exited_at >= datetime('now', ?)"; args.push('-' + days + ' days'); }
    sql += ' ORDER BY exited_at ASC, id ASC';
    let trades = [];
    try { trades = db._conn.prepare(sql).all(...args); } catch (e) { trades = []; }
    const fmt = (iso) => {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return String(iso || '').slice(0, 10);
      return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
    };
    const points = [{ t: 'Start', equity: baseline, realizedCum: 0 }];
    let cum = 0;
    for (const tr of trades) {
      cum += Number(tr.pnl || 0);
      points.push({ t: fmt(tr.exited_at), equity: baseline + cum, realizedCum: cum });
    }
    if (trades.length === 0) points.push({ t: 'Now', equity: baseline, realizedCum: 0 });
    res.json({
      ok: true,
      window: w,
      baseline,
      currency: 'INR',
      realizedPnl: cum,
      count: trades.length,
      series: points.map(p => p.equity),
      labels: points.map(p => p.t),
      points,
    });
  }));

  // ---------- GET /api/me/paper-by-mode (T-526) ----------
  // Per-mode aggregation of this user's closed paper trades. Maps each trade's
  // strategy_tag -> trading mode via the STRATEGIES registry, then rolls up
  // trades / win-rate / realized P&L per mode. Trades whose tag is null or
  // unknown land in `unassigned` (honest — not silently attributed to a mode).
  app.get('/api/me/paper-by-mode', withAuth((req, res) => {
    const db = getDb();
    const uid = req.user.id;
    let STRATEGIES = [];
    try { STRATEGIES = require('./strategies').STRATEGIES || []; } catch (e) { STRATEGIES = []; }
    const tagToMode = {};
    for (const s of STRATEGIES) {
      if (s && s.id)   tagToMode[String(s.id).toLowerCase()]   = s.mode;
      if (s && s.name) tagToMode[String(s.name).toLowerCase()] = s.mode;
    }
    let trades = [];
    try { trades = db._conn.prepare('SELECT pnl, strategy_tag FROM paper_closed_trades WHERE user_id = ?').all(uid); } catch (e) { trades = []; }
    const acc = {};
    const unassigned = { trades: 0, wins: 0, pnl: 0 };
    for (const t of trades) {
      const tag = t.strategy_tag ? String(t.strategy_tag).toLowerCase() : null;
      const mode = (tag && tagToMode[tag]) ? tagToMode[tag] : null;
      const b = mode ? (acc[mode] || (acc[mode] = { trades: 0, wins: 0, pnl: 0 })) : unassigned;
      b.trades += 1;
      if (Number(t.pnl) > 0) b.wins += 1;
      b.pnl += Number(t.pnl || 0);
    }
    const modes = {};
    for (const [mode, b] of Object.entries(acc)) {
      modes[mode] = { trades: b.trades, wins: b.wins, winRate: b.trades ? Math.round((b.wins / b.trades) * 100) : 0, pnl: b.pnl };
    }
    res.json({
      ok: true,
      modes,
      unassigned: { trades: unassigned.trades, wins: unassigned.wins, winRate: unassigned.trades ? Math.round((unassigned.wins / unassigned.trades) * 100) : 0, pnl: unassigned.pnl },
      totalTrades: trades.length,
    });
  }));

  // ---------- GET /api/me/paper/promotion (T-527) ----------
  // Per-strategy promotion-gate evaluation from this user's closed paper
  // trades. Only registered strategies (in the STRATEGIES registry) with >=1
  // paper trade are listed; untagged manual trades are excluded. Gates:
  // >=14 days, >=30 trades, >=60% win, >=1.2 Sharpe (trade-return based).
  app.get('/api/me/paper/promotion', withAuth((req, res) => {
    const db = getDb();
    const uid = req.user.id;
    const state = db.paper.getState(uid);
    const baseline = Number(state.initial_capital || state.cash || 0) || 1;
    let STRATEGIES = [];
    try { STRATEGIES = require('./strategies').STRATEGIES || []; } catch (e) { STRATEGIES = []; }
    const byTag = {};
    for (const s of STRATEGIES) {
      if (s && s.id)   byTag[String(s.id).toLowerCase()]   = s;
      if (s && s.name) byTag[String(s.name).toLowerCase()] = s;
    }
    let trades = [];
    try { trades = db._conn.prepare('SELECT pnl, strategy_tag, entered_at, exited_at FROM paper_closed_trades WHERE user_id = ? ORDER BY exited_at ASC, id ASC').all(uid); } catch (e) { trades = []; }
    const groups = {};
    for (const t of trades) {
      if (!t.strategy_tag) continue;
      const key = String(t.strategy_tag).toLowerCase();
      if (!byTag[key]) continue;
      (groups[key] || (groups[key] = [])).push(t);
    }
    const GATES = { days: 14, trades: 30, win: 60, sharpe: 1.2 };
    const rows = [];
    for (const [key, ts] of Object.entries(groups)) {
      const meta = byTag[key];
      const n = ts.length;
      const wins = ts.filter(t => Number(t.pnl) > 0).length;
      const w = n ? Math.round((wins / n) * 100) : 0;
      const pnls = ts.map(t => Number(t.pnl || 0));
      const first = new Date(ts[0].entered_at || ts[0].exited_at);
      const d = isNaN(first.getTime()) ? 0 : Math.max(0, Math.round((Date.now() - first.getTime()) / 86400000));
      let sh = 0;
      if (n >= 2) {
        const mean = pnls.reduce((a, b) => a + b, 0) / n;
        const variance = pnls.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (n - 1);
        const sd = Math.sqrt(variance);
        if (sd > 0) sh = +(((mean / sd) * Math.sqrt(252))).toFixed(2);
      }
      let cum = 0, peak = 0, maxdd = 0;
      for (const p of pnls) { cum += p; if (cum > peak) peak = cum; const dd = peak - cum; if (dd > maxdd) maxdd = dd; }
      const dd = '-' + ((maxdd / baseline) * 100).toFixed(1) + '%';
      rows.push({ n: meta.name, mode: meta.mode, d, t: n, w, sh, dd,
        promotable: d >= GATES.days && n >= GATES.trades && w >= GATES.win && sh >= GATES.sharpe });
    }
    rows.sort((a, b) => (Number(b.promotable) - Number(a.promotable)) || (b.t - a.t));
    res.json({ ok: true, gates: GATES, rows, count: rows.length });
  }));

  // ---------- GET /api/me/paper/fill-quality (T-528) ----------
  // Fill-quality metrics from this user's paper order log: average slippage
  // (bps), fill rate, rejection rate, partial-fill rate. Paper fills are
  // synchronous, so fill-latency is not modeled (omitted, not faked).
  app.get('/api/me/paper/fill-quality', withAuth((req, res) => {
    const db = getDb();
    const uid = req.user.id;
    let orders = [];
    try { orders = db.paper.listOrders(uid) || []; } catch (e) { orders = []; }
    const up = (s) => String(s || '').toUpperCase();
    const filled = orders.filter(o => up(o.status) === 'FILLED');
    const cancelled = orders.filter(o => up(o.status) === 'CANCELLED' || up(o.status) === 'REJECTED');
    const n = orders.length;
    let slipBpsSum = 0, slipCount = 0;
    for (const o of filled) {
      const reqp = Number(o.req_price || 0), fill = Number(o.fill_price || 0);
      if (reqp > 0) { slipBpsSum += Math.abs(fill - reqp) / reqp * 10000; slipCount++; }
    }
    const avgSlipBps = slipCount ? +(slipBpsSum / slipCount).toFixed(2) : 0;
    const fillRate = n ? Math.round((filled.length / n) * 100) : 0;
    const rejectionRate = n ? +(((cancelled.length / n) * 100)).toFixed(1) : 0;
    res.json({
      ok: true,
      totalOrders: n,
      filledOrders: filled.length,
      cancelledOrders: cancelled.length,
      avgSlippageBps: avgSlipBps,
      avgSlippagePct: +(avgSlipBps / 100).toFixed(3),
      fillRate,
      rejectionRate,
      partialFillRate: 0,
      metrics: [
        { k: 'Avg slippage',   v: avgSlipBps.toFixed(2) + ' bps', note: '|fill - request| / request across filled paper orders' },
        { k: 'Fill rate',      v: fillRate + '%',                 note: filled.length + ' / ' + n + ' orders filled' },
        { k: 'Rejection rate', v: rejectionRate + '%',            note: cancelled.length + ' rejected/cancelled of ' + n },
        { k: 'Partial fills',  v: '0%',                           note: 'Not modeled in the paper engine yet' },
      ],
    });
  }));

  // ---------- T-554: per-user trade-level reconciliation ----------
  // Reconciles the user's EXECUTED (paper) trades for an IST day against the
  // broker's completed orders for the same day. HONEST by design: in paper mode
  // (or whenever the broker returns no trades for that date) our trades are
  // returned with an 'unreconciled' status and reconcilable:false -- we NEVER
  // fabricate broker contract-note rows. Replaces the old hardcoded demo table.
  function _istDayWindowUtc(dateStr) {
    // dateStr 'YYYY-MM-DD' is interpreted as an IST calendar day. Returns the
    // [startIso,endIso) UTC window (to compare against paper_orders.filled_at,
    // which is a UTC ISO string) plus the normalized IST date.
    const IST = 5.5 * 3600 * 1000;
    let y, m, d;
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ''))) {
      const p = String(dateStr).split('-').map(Number); y = p[0]; m = p[1]; d = p[2];
    } else {
      const ist = new Date(Date.now() + IST);
      y = ist.getUTCFullYear(); m = ist.getUTCMonth() + 1; d = ist.getUTCDate();
    }
    const startUtc = Date.UTC(y, m - 1, d) - IST;
    return {
      startIso: new Date(startUtc).toISOString(),
      endIso:   new Date(startUtc + 86400000).toISOString(),
      dateIST:  y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'),
    };
  }

  app.get('/api/me/reconcile/trades', withAuth(async (req, res) => {
    try {
      const db = getDb();
      const uid = req.user.id;
      const { startIso, endIso, dateIST } = _istDayWindowUtc(req.query.date);

      // OUR executed trades for the day = filled paper orders in the IST window.
      let ourOrders = [];
      try {
        ourOrders = (db.paper.listOrders(uid) || []).filter((o) => {
          const f = o.filled_at || '';
          return String(o.status || '').toUpperCase() === 'FILLED' && f >= startIso && f < endIso;
        });
      } catch (_) { ourOrders = []; }
      const ours = ourOrders.map((o) => ({
        id: o.client_order_id || ('OUR-' + o.id),
        sym: String(o.symbol || '').toUpperCase(),
        side: String(o.side || '').toUpperCase(),
        qty: Number(o.qty || 0),
        price: Number(o.fill_price || 0),
        fee: Number(o.slippage || 0),
        strategy: o.strategy_tag || null,
      }));

      // BROKER side: only attempted when a broker is actually connected.
      const broker = getBroker();
      const brokerConnected = !!(broker && broker.health && broker.health().connected);
      let brokerOk = false, brokerErr = null, brokerTrades = [];
      if (brokerConnected) {
        try {
          const orders = await broker.getOrders();
          brokerOk = true;
          brokerTrades = (Array.isArray(orders) ? orders : []).filter((o) => {
            const st = String(o.status || '').toUpperCase();
            if (st !== 'COMPLETE' && st !== 'FILLED') return false;
            const ts = String(o.order_timestamp || o.exchange_timestamp || o.filled_at || '');
            return ts.slice(0, 10) === dateIST || (ts >= startIso && ts < endIso);
          }).map((o) => ({
            brokerId: o.order_id || o.id || null,
            sym: String(o.tradingsymbol || o.symbol || '').toUpperCase(),
            side: String(o.transaction_type || o.side || '').toUpperCase(),
            qty: Number(o.filled_quantity != null ? o.filled_quantity : (o.quantity || 0)),
            price: Number(o.average_price || o.price || 0),
            fee: null,
          }));
        } catch (e) { brokerOk = false; brokerErr = e.message; }
      }

      // Reconcilable only if the broker actually returned trades for this date.
      const reconcilable = brokerConnected && brokerOk && brokerTrades.length > 0;
      const TOL = 0.01; // rupee price tolerance
      const remaining = brokerTrades.slice();
      const rows = [];
      for (const t of ours) {
        let mi = -1;
        if (reconcilable) {
          mi = remaining.findIndex((b) => b.sym === t.sym && b.side === t.side && b.qty === t.qty);
          if (mi === -1) mi = remaining.findIndex((b) => b.sym === t.sym && b.side === t.side);
        }
        if (mi >= 0) {
          const b = remaining.splice(mi, 1)[0];
          let status = 'matched';
          if (b.qty !== t.qty) status = 'qty-diff';
          else if (Math.abs((b.price || 0) - (t.price || 0)) > TOL) status = 'price-diff';
          rows.push({ id: t.id, brokerId: b.brokerId, sym: t.sym, side: t.side, qty: t.qty,
                      ours: t.price, broker: b.price, feeOur: t.fee, feeBk: b.fee, status });
        } else {
          rows.push({ id: t.id, brokerId: null, sym: t.sym, side: t.side, qty: t.qty,
                      ours: t.price, broker: null, feeOur: t.fee, feeBk: null,
                      status: reconcilable ? 'missing-broker' : 'unreconciled' });
        }
      }
      for (const b of remaining) {
        rows.push({ id: null, brokerId: b.brokerId, sym: b.sym, side: b.side, qty: b.qty,
                    ours: null, broker: b.price, feeOur: null, feeBk: b.fee, status: 'missing-ours' });
      }

      const matched = rows.filter((r) => r.status === 'matched').length;
      const mismatched = rows.filter((r) => ['price-diff', 'qty-diff', 'missing-broker', 'missing-ours'].includes(r.status)).length;
      const note = reconcilable
        ? null
        : (brokerConnected
            ? 'No broker trades found for this date — nothing to reconcile against. Rows below are your executed trades.'
            : 'Paper mode (no live broker connected): these are your simulated fills, so there is no broker contract note to match against.');

      res.json({
        ok: true, date: dateIST, brokerConnected, brokerOk, brokerErr, reconcilable,
        brokerName: (broker && broker.name) || null,
        summary: { ourTrades: ours.length, brokerTrades: brokerTrades.length, matched, mismatched },
        note,
        rows,
      });
    } catch (e) {
      res.status(500).json({ ok: false, reason: e.message });
    }
  }));

  app.get('/api/me/reconcile/history', withAuth((req, res) => {
    try {
      const db = getDb();
      const uid = req.user.id;
      let days = parseInt(req.query.days, 10);
      if (!Number.isInteger(days) || days < 1 || days > 120) days = 30;
      const IST = 5.5 * 3600 * 1000;
      let orders = [];
      try { orders = (db.paper.listOrders(uid) || []).filter((o) => String(o.status || '').toUpperCase() === 'FILLED'); } catch (_) { orders = []; }
      const byDay = new Map();
      for (const o of orders) {
        if (!o.filled_at) continue;
        const ist = new Date(new Date(o.filled_at).getTime() + IST);
        const key = ist.toISOString().slice(0, 10);
        byDay.set(key, (byDay.get(key) || 0) + 1);
      }
      const today = new Date(Date.now() + IST);
      const baseUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
      const rows = [];
      for (let i = days - 1; i >= 0; i--) {
        const key = new Date(baseUtc - i * 86400000).toISOString().slice(0, 10);
        rows.push({ date: key, trades: byDay.get(key) || 0, mismatched: 0 });
      }
      const totalTrades = rows.reduce((sum, r) => sum + r.trades, 0);
      const activeDays = rows.filter((r) => r.trades > 0).length;
      res.json({
        ok: true, days, rows,
        summary: {
          totalTrades, activeDays, totalMismatched: 0,
          note: 'Counts are your real executed paper trades per IST day. Paper fills have no broker contract note, so per-day mismatches are 0; daily trade-level mismatches (when a live broker is connected) surface in the trade table above.',
        },
      });
    } catch (e) {
      res.status(500).json({ ok: false, reason: e.message });
    }
  }));

  // ---------- T-555: per-user reconcile STATE (drift) snapshot ----------
  // Mirrors /api/reconcile's cash/holdings/pending drift card, but reads the
  // PER-USER db.paper (the source of truth for this user's paper account and
  // for autorun fills) instead of the legacy global paper singleton. This makes
  // the recon screen fully per-user — its trade table (T-554) and this state
  // card now agree. Broker side is best-effort (safe() wrap), as in /api/reconcile.
  app.get('/api/me/reconcile/state', withAuth(async (req, res) => {
    try {
      const db = getDb();
      const uid = req.user.id;
      const broker = getBroker();
      const safe = async (fn) => { try { return { ok: true, data: await fn() }; } catch (e) { return { ok: false, error: e.message }; } };
      const [holdingsR, ordersR, marginsR] = await Promise.all([
        safe(() => broker.getHoldings()),
        safe(() => broker.getOrders()),
        safe(() => broker.getMargins()),
      ]);

      let brokerCash = null;
      if (marginsR.ok && marginsR.data) {
        const eq = marginsR.data.equity || {};
        const av = eq.available || {};
        brokerCash = typeof av.cash === 'number' ? av.cash
                   : typeof av.live_balance === 'number' ? av.live_balance
                   : typeof eq.net === 'number' ? eq.net
                   : null;
      }

      const state = db.paper.getState(uid);
      const paperCash = Number((state && state.cash) || 0);
      let paperPositions = [];
      try { paperPositions = db.paper.listPositions(uid) || []; } catch (_) { paperPositions = []; }

      const brokerHoldings = holdingsR.ok && Array.isArray(holdingsR.data) ? holdingsR.data : [];
      const bySym = new Map();
      for (const h of brokerHoldings) {
        const s = String(h.tradingsymbol || h.symbol || '').toUpperCase();
        if (!s) continue;
        bySym.set(s, { symbol: s, brokerQty: Number(h.quantity || 0), brokerAvg: Number(h.average_price || 0), brokerLtp: Number(h.last_price || 0), paperQty: 0, paperAvg: 0 });
      }
      for (const p of paperPositions) {
        const s = String(p.symbol || '').toUpperCase();
        const cur = bySym.get(s) || { symbol: s, brokerQty: 0, brokerAvg: 0, brokerLtp: 0, paperQty: 0, paperAvg: 0 };
        cur.paperQty = Number(p.qty || 0);
        cur.paperAvg = Number(p.avg_price || 0);
        bySym.set(s, cur);
      }
      const holdingsRows = Array.from(bySym.values()).map((r) => ({ ...r, qtyDrift: r.brokerQty - r.paperQty, matches: r.brokerQty === r.paperQty }));

      let paperOrders = [];
      try { paperOrders = db.paper.listOrders(uid) || []; } catch (_) { paperOrders = []; }
      const paperPendingCnt = paperOrders.filter((o) => { const s = String(o.status || '').toUpperCase(); return s === 'PENDING' || s === 'OPEN'; }).length;
      const brokerOrdersAll = ordersR.ok && Array.isArray(ordersR.data) ? ordersR.data : [];
      const brokerPendingCnt = brokerOrdersAll.filter((o) => { const s = String(o.status || '').toUpperCase(); return s === 'OPEN' || s === 'TRIGGER PENDING' || s === 'PENDING'; }).length;

      const cashDrift = (brokerCash != null) ? +(brokerCash - paperCash).toFixed(2) : null;
      const h = (broker && broker.health) ? broker.health() : {};
      res.json({
        ok: true,
        asOf: new Date().toISOString(),
        brokerName: (broker && broker.name) || null,
        brokerConnected: !!(h && h.connected),
        brokerStalledOnToken: !!(h && h.stalledOnToken),
        brokerTickStale: !!(h && h.tickStale),
        cash: { paper: paperCash, broker: brokerCash, drift: cashDrift, brokerOk: marginsR.ok, brokerErr: marginsR.ok ? null : marginsR.error },
        holdings: { rows: holdingsRows, brokerOk: holdingsR.ok, brokerErr: holdingsR.ok ? null : holdingsR.error },
        pendingOrders: { paperCnt: paperPendingCnt, brokerCnt: brokerPendingCnt, brokerOk: ordersR.ok },
        summary: { cashDrift, holdingsDrifts: holdingsRows.filter((r) => !r.matches).length, paperPendingCnt, brokerPendingCnt },
      });
    } catch (e) {
      res.status(500).json({ ok: false, reason: e.message });
    }
  }));

  // ---------- POST /api/me/paper/order (Tier 72) ----------
  app.post('/api/me/paper/order', withAuth(async (req, res) => {
    try {
      const db     = getDb();
      const broker = getBroker();
      const b = req.body || {};
      const symbol = String(b.symbol || '').toUpperCase().trim();
      const side = String(b.side || '').toUpperCase();
      const qty = Math.floor(Number(b.qty || 0));
      const slip = Number.isFinite(b.slippageBps) ? Number(b.slippageBps) : 5;
      if (!symbol || !['BUY','SELL'].includes(side) || qty <= 0) {
        return res.status(400).json({ ok: false, reason: 'bad_input', detail: 'symbol/side/qty required' });
      }
      // T99-T42: reject paper orders when LTPs are known stale.
      try {
        if (broker && typeof broker.health === 'function') {
          const bh = broker.health();
          if (bh && bh.stalledOnToken) {
            return res.status(503).json({
              ok: false, reason: 'broker_stalled_on_token',
              detail: 'Live data feed is stalled — Zerodha access token expired. Reconnect from the Brokers screen first.',
            });
          }
          if (bh && bh.tickStale) {
            return res.status(503).json({
              ok: false, reason: 'tick_stale',
              detail: 'Live data feed is frozen — no ticks received for >90s while market is open. Wait for recovery or check Brokers screen.',
            });
          }
        }
      } catch (_) { /* health check failures shouldn't block orders */ }
      // Get current LTP from the global ticker.
      let ltp = null;
      try {
        if (broker && broker._lastLtp && typeof broker._lastLtp.get === 'function') {
          const last = broker._lastLtp.get(symbol);
          if (last && Number(last) > 0) ltp = Number(last);
        }
        if ((ltp == null || !(ltp > 0)) && broker && typeof broker.getQuote === 'function') {
          try {
            const q = await broker.getQuote(symbol);
            if (q && q.ltp) ltp = Number(q.ltp);
          } catch (e) { console.warn('[paper-trading] swallowed:', e && e.message); }
        }
      } catch (e) { console.warn('[paper-trading] swallowed:', e && e.message); }
      if (ltp == null && broker && typeof broker.getQuote === 'function') { /* cold start no-op */ }
      if (ltp == null || !(ltp > 0)) {
        return res.status(503).json({ ok: false, reason: 'no_live_price', detail: 'No live tick yet for this symbol. Try again shortly or pick a watchlist symbol.' });
      }
      const slippage = ltp * (slip / 10000);
      const fillPrice = side === 'BUY' ? ltp + slippage : ltp - slippage;
      const notional = fillPrice * qty;
      const uid = req.user.id;
      const state = db.paper.getState(uid);
      if (side === 'BUY' && state.cash < notional) {
        return res.status(400).json({ ok: false, reason: 'insufficient_cash', cash: state.cash, needed: notional });
      }
      const orderId = 'PO-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
      db.paper.placeOrder({
        user_id: uid,
        client_order_id: orderId,
        strategy_tag: b.strategy || null,
        symbol, side, qty,
        order_type: 'MARKET', product: 'CNC',
        req_price: ltp, fill_price: fillPrice, slippage,
        status: 'filled', filled_at: new Date().toISOString(),
      });
      const positions = db.paper.listPositions(uid) || [];
      const existing = positions.find(p => p.symbol === symbol);
      if (side === 'BUY') {
        if (existing) {
          const newQty = existing.qty + qty;
          const newAvg = ((existing.qty * existing.avg_price) + (qty * fillPrice)) / newQty;
          db._conn.prepare('UPDATE paper_positions SET qty = ?, avg_price = ? WHERE user_id = ? AND symbol = ?').run(newQty, newAvg, uid, symbol);
        } else {
          db._conn.prepare('INSERT INTO paper_positions (user_id, symbol, qty, avg_price) VALUES (?, ?, ?, ?)').run(uid, symbol, qty, fillPrice);
        }
        db.paper.setState({ ...state, cash: state.cash - notional, user_id: uid });
      } else {
        if (!existing || existing.qty < qty) {
          return res.status(400).json({ ok: false, reason: 'insufficient_qty', have: existing ? existing.qty : 0, need: qty });
        }
        const realized = (fillPrice - existing.avg_price) * qty;
        const remaining = existing.qty - qty;
        if (remaining === 0) {
          db._conn.prepare('DELETE FROM paper_positions WHERE user_id = ? AND symbol = ?').run(uid, symbol);
        } else {
          db._conn.prepare('UPDATE paper_positions SET qty = ? WHERE user_id = ? AND symbol = ?').run(remaining, uid, symbol);
        }
        db._conn.prepare('INSERT INTO paper_closed_trades (user_id, symbol, side, qty, entry_price, exit_price, pnl, strategy_tag, entered_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(uid, symbol, 'BUY', qty, existing.avg_price, fillPrice, realized, b.strategy || null, existing.opened_at || new Date().toISOString());
        db.paper.setState({ ...state, cash: state.cash + notional, realized_pnl: (state.realized_pnl || 0) + realized, user_id: uid });
      }
      res.status(201).json({ ok: true, orderId, fillPrice, slippage, ltp, notional });
    } catch (e) {
      res.status(500).json({ ok: false, reason: 'place_failed', detail: e.message });
    }
  }));

  // ---------- GET /api/me/paper/capital (T-530 / follow-on #48) ----------
  // Returns just the capital + tier label, so the frontend can restore
  // the user's last virtual-account selection on page mount without
  // pulling the full /api/me/paper payload.
  app.get('/api/me/paper/capital', withAuth((req, res) => {
    try {
      const db = getDb();
      const s = db.paper.getState(req.user.id) || {};
      res.json({
        ok: true,
        initialCapital: Number(s.initial_capital || s.cash || 0),
        cash:           Number(s.cash || 0),
        tier:           String(s.tier || ''),
      });
    } catch (e) {
      res.status(500).json({ ok: false, reason: 'capital_get_failed', detail: e.message });
    }
  }));

  // ---------- PUT /api/me/paper/capital (Tier 66) ----------
  app.put('/api/me/paper/capital', withAuth((req, res) => {
    try {
      const db = getDb();
      const cap = Number(req.body && req.body.initialCapital);
      if (!Number.isFinite(cap) || cap < 1000 || cap > 10000000000) {
        return res.status(400).json({ ok: false, reason: 'initial_capital_out_of_range', detail: 'Pick a value between INR 1,000 and INR 1,000 Cr.' });
      }
      const tier = (req.body && String(req.body.tier || '').slice(0, 16)) || 'CUSTOM';
      const reset = !!(req.body && req.body.reset);
      const uid = req.user.id;
      if (reset) {
        db._conn.prepare('DELETE FROM paper_orders WHERE user_id = ?').run(uid);
        db._conn.prepare('DELETE FROM paper_positions WHERE user_id = ?').run(uid);
        db._conn.prepare('DELETE FROM paper_closed_trades WHERE user_id = ?').run(uid);
      }
      db.paper.setState({
        user_id: uid,
        tier: tier,
        cash: cap,
        initial_capital: cap,
        realized_pnl: reset ? 0 : Number(db.paper.getState(uid).realized_pnl || 0),
      });
      res.json({ ok: true, state: db.paper.getState(uid) });
    } catch (e) {
      res.status(500).json({ ok: false, reason: 'capital_set_failed', detail: e.message });
    }
  }));

  // ---------- POST /api/me/paper/promote-check (E5) ----------
  // NOTE: this route is NOT wrapped in withAuth here; it does its own
  // auth check via req.user (the global Tier 50 cookie-resolver middleware
  // attaches req.user). Matches original semantics byte-for-byte.
  app.post('/api/me/paper/promote-check', (req, res) => {
    const db             = getDb();
    const _surveillance  = getSurveillance();
    const _earningsCal   = getEarningsCal();
    if (!db || !db._conn) return res.status(503).json({ ok: false, reason: 'db_not_ready' });
    if (!req.user || !req.user.id) return res.status(401).json({ ok: false, reason: 'auth_required' });
    const b = req.body || {};
    const strategy = (b.strategy || '').toString().trim();
    const symbol = (b.symbol || '').toString().toUpperCase().trim();

    if (!strategy) return res.status(400).json({ ok: false, reason: 'bad_request', detail: 'strategy required' });

    try {
      // T-499/T-500: pull trades for the policy window, hand off to canonical
      // promotion-policy module. Symbol-narrowed query if symbol provided
      // (per-symbol promotion); otherwise strategy-wide.
      const cutoff = new Date(Date.now() - promotionPolicy.DEFAULTS.window_days * 86400_000).toISOString();
      // T-434 (audit-2026-05-26 backend M6): split into two fixed prepared
      // statements instead of string-interpolating `where`. Eliminates the
      // future-contributor footgun where someone adds an `if (extra) where +=
      // " AND " + req.body.extra` and accidentally enables SQL injection.
      const rows = symbol
        ? db._conn.prepare(
            'SELECT pnl FROM paper_closed_trades '
            + 'WHERE user_id = ? AND strategy_tag = ? AND exited_at > ? AND symbol = ?'
          ).all(req.user.id, strategy, cutoff, symbol)
        : db._conn.prepare(
            'SELECT pnl FROM paper_closed_trades '
            + 'WHERE user_id = ? AND strategy_tag = ? AND exited_at > ?'
          ).all(req.user.id, strategy, cutoff);
      // === Telegram-2FA readiness (operational gate inside policy) ===
      let telegram2faReady = false;
      try {
        const n = db.notif.get(req.user.id);
        telegram2faReady = !!(n && n.telegram_enabled && n.telegram_bot_token && n.telegram_chat_id);
      } catch (e) { console.warn('[paper-trading] swallowed:', e && e.message); }

      const report = promotionPolicy.evaluate(rows, { telegram2faReady });

      // === Symbol-specific gates layered on top of policy ===
      // (Surveillance + earnings blackout are symbol-scoped; the policy
      // module is symbol-agnostic so it can also run from the nightly
      // promote-scheduler against the full strategy.)
      let surveillanceGate = { pass: true, reason: 'no_symbol_check' };
      if (symbol && _surveillance) {
        const v = _surveillance.classifySync(symbol);
        surveillanceGate = v
          ? { pass: false, reason: v.reason, list: v.list, stage: v.stage }
          : { pass: true, reason: 'clean' };
      }
      let earningsGate = { pass: true, reason: 'no_symbol_check' };
      if (symbol && _earningsCal && typeof _earningsCal.inResultsBlackout === 'function') {
        const v = _earningsCal.inResultsBlackout(symbol, { windowDays: 3 });
        earningsGate = v
          ? { pass: false, reason: 'results_blackout', days_until: v.daysUntil, event_date: v.eventDate, detail: `${symbol} has results in ${v.daysUntil}d (${v.eventDate}). Promote after the announcement to avoid IV-crush + gap risk.` }
          : { pass: true, reason: 'no_event_in_window' };
      }

      const can_promote = report.can_promote && surveillanceGate.pass && earningsGate.pass;
      res.json({
        ok: true,
        can_promote,
        strategy, symbol: symbol || null,
        policy: report,
        symbol_gates: { surveillance: surveillanceGate, earnings: earningsGate },
        window: `${report.window_days}d`,
        ts: new Date().toISOString(),
      });
    } catch (e) {
      res.status(500).json({ ok: false, reason: 'promote_check_failed', detail: e.message });
    }
  });

  // ---------- POST /api/me/walk-forward (T-301a) ----------
  app.post('/api/me/walk-forward', async (req, res) => {
    if (!req.user) return res.status(401).json({ ok: false, reason: 'auth_required' });
    try {
      const broker = getBroker();
      const { strategy, symbol, paramGrid, opts } = req.body || {};
      if (!strategy || typeof strategy !== 'string') return res.status(400).json({ ok: false, reason: 'strategy required' });
      if (!symbol || typeof symbol !== 'string')     return res.status(400).json({ ok: false, reason: 'symbol required' });
      const grid = paramGrid && typeof paramGrid === 'object' ? paramGrid : {};
      let comboCount = 1;
      for (const v of Object.values(grid)) comboCount *= Array.isArray(v) ? Math.max(1, v.length) : 1;
      if (comboCount > 200) return res.status(400).json({ ok: false, reason: `paramGrid too large (${comboCount} combos > 200 cap)` });
      if (!broker || typeof broker.getHistorical !== 'function') {
        return res.status(503).json({ ok: false, reason: 'broker_not_initialized' });
      }
      const candles = await broker.getHistorical(symbol, { interval: 'day', days: 365 });
      if (!Array.isArray(candles) || candles.length < 90) {
        return res.status(400).json({ ok: false, reason: `not enough historical candles for ${symbol} (got ${candles ? candles.length : 0})` });
      }
      const wf = createWalkForward({ runBacktest });
      const result = wf.run({ candles, strategy, paramGrid: grid, opts: opts || {} });
      res.json({ ok: true, symbol, ...result });
    } catch (e) {
      res.status(500).json({ ok: false, reason: e.message });
    }
  });
}

module.exports = { mountPaperTradingRoutes };
