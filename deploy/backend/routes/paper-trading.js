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
  app.get('/api/me/paper', withAuth((req, res) => {
    const db = getDb();
    res.json({ ok: true,
      state:     db.paper.getState(req.user.id),
      orders:    db.paper.listOrders(req.user.id),
      positions: db.paper.listPositions(req.user.id),
    });
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
    const minTrades = Math.max(5, Math.min(200, parseInt(b.min_trades || '20', 10)));
    const minWinRate = Math.max(0.3, Math.min(0.9, parseFloat(b.min_win_rate) || 0.55));

    if (!strategy) return res.status(400).json({ ok: false, reason: 'bad_request', detail: 'strategy required' });

    try {
      // === Gate 1: win-rate over last 30 days ===
      const cutoff = new Date(Date.now() - 30 * 86400_000).toISOString();
      const params = [req.user.id, strategy, cutoff];
      let where = "user_id = ? AND strategy_tag = ? AND exited_at > ?";
      if (symbol) { where += " AND symbol = ?"; params.push(symbol); }
      const rows = db._conn.prepare(`SELECT pnl FROM paper_closed_trades WHERE ${where}`).all(...params);
      const trades = rows.length;
      const wins = rows.filter(r => Number(r.pnl) > 0).length;
      const winRate = trades > 0 ? +(wins / trades).toFixed(4) : 0;
      const grossPnl = rows.reduce((s, r) => s + Number(r.pnl || 0), 0);
      const winRateGate = { pass: trades >= minTrades && winRate >= minWinRate, trades, wins, win_rate: winRate, gross_pnl_inr: +grossPnl.toFixed(2), min_trades: minTrades, min_win_rate: minWinRate };

      // === Gate 2: surveillance ===
      let surveillanceGate = { pass: true, reason: 'no_symbol_check' };
      if (symbol && _surveillance) {
        const v = _surveillance.classifySync(symbol);
        surveillanceGate = v
          ? { pass: false, reason: v.reason, list: v.list, stage: v.stage }
          : { pass: true, reason: 'clean' };
      }

      // === Gate 3: 2FA reachable ===
      let twofaGate = { pass: false, reason: 'no_notif_row' };
      try {
        const n = db.notif.get(req.user.id);
        const ready = !!(n && n.telegram_enabled && n.telegram_bot_token && n.telegram_chat_id);
        twofaGate = ready
          ? { pass: true, reason: 'telegram_ready' }
          : { pass: false, reason: 'telegram_not_configured', detail: 'Enable Telegram alerts in Settings so the 2FA confirm-before-trade challenge can reach you.' };
      } catch (e) { console.warn('[paper-trading] swallowed:', e && e.message); }

      // === Gate 4: earnings blackout ===
      let earningsGate = { pass: true, reason: 'no_symbol_check' };
      if (symbol && _earningsCal && typeof _earningsCal.inResultsBlackout === 'function') {
        const v = _earningsCal.inResultsBlackout(symbol, { windowDays: 3 });
        earningsGate = v
          ? { pass: false, reason: 'results_blackout', days_until: v.daysUntil, event_date: v.eventDate, detail: `${symbol} has results in ${v.daysUntil}d (${v.eventDate}). Promote after the announcement to avoid IV-crush + gap risk.` }
          : { pass: true, reason: 'no_event_in_window' };
      }

      const can_promote = winRateGate.pass && surveillanceGate.pass && twofaGate.pass && earningsGate.pass;
      res.json({
        ok: true,
        can_promote,
        strategy, symbol: symbol || null,
        gates: { win_rate: winRateGate, surveillance: surveillanceGate, twofa: twofaGate, earnings: earningsGate },
        window: '30d',
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
