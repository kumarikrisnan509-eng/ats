// T-224 (CODE-AUDIT F.5 M1.4 piece 6b): full /api/orders/* route handler set.
//
// Builds on T-223 (6a, dry-run only) by pulling the 4 live-money order
// routes from server.js: place, confirm-2fa, cancel-2fa (GET+POST sharing
// handleCancel2fa), and cancel. Plus the dry-run route from 6a.
//
// MUTABLE DEPS via GETTERS (see T-228 for why):
//   server.js declares `let broker, paper, twoFactor` at module scope and
//   only assigns inside init(), which runs AT THE BOTTOM of server.js
//   (after all top-level mount calls). Passing these as values to
//   mountOrdersRoutes captures `undefined` permanently. The handlers must
//   call getter functions AT REQUEST TIME, after init() has run.
//
//   getBroker, getPaper, getTwoFactor are arrow functions defined in
//   server.js scope that close over the live `let` bindings.
//
// Other 16 deps are safe to pass by value:
//   - KILL_SWITCH/LIVE_TRADING/MAX_* are `const` immediately assigned at top
//   - audit, withAuth, pickBroker are function declarations (hoisted)
//   - VALID_* Sets + _orderRate* helpers + MAX_ORDERS_PER_MIN + _orderTimes
//     are imported via require() from services/ -- their values are stable.
//
// Test-file updates landing in the SAME commit (per the handoff doc):
//   - test/broker-gateway-safety.test.js: scan BOTH server.js AND
//     routes/orders.js for broker.placeOrder call sites.
//   - test/order-guards.test.js: change HANDLER_PATH to point at
//     routes/orders.js (the place handler moved).

'use strict';

const crypto = require('crypto');

function mountOrdersRoutes(app, deps) {
  const {
    // Env-derived numeric caps + flags (constants, safe to pass by value)
    KILL_SWITCH,
    LIVE_TRADING,
    MAX_POSITION_SIZE_INR,
    MAX_AGGREGATE_EXPOSURE,
    MAX_DAILY_LOSS_INR,
    MAX_ORDERS_PER_MIN,
    // Function declarations + audit writer + middleware (all hoisted in server.js, safe)
    audit,
    withAuth,
    pickBroker,
    // Mutable singletons — call AT REQUEST time (see header)
    getBroker,
    getPaper,
    getTwoFactor,
    // Order-rate-limit helpers from services/order-rate-limit
    _orderRateOk,
    _orderRateRecord,
    _orderTimes,
    // Validation Sets from services/order-validation
    VALID_SIDES,
    VALID_PRODUCTS,
    VALID_ORDER_TYPES,
    VALID_VARIETIES,
    VALID_VALIDITY,
    // T-277: per-user tradingMode guard. Optional -- if absent, behaves as before
    // (env-only gating). When present, paper-mode users are blocked from live
    // order placement even with KILL_SWITCH off + LIVE_TRADING on.
    getRiskConfig,
    // T-273: consolidated pre-trade pipeline. If provided, replaces the
    // KILL_SWITCH + LIVE_TRADING + tradingMode inline gates AND adds the
    // new leverage + sector concentration gates. Backward compatible: when
    // absent, the existing inline gates still apply.
    getPreTradeCheck,
  } = deps;

  // ---------- /api/orders/dry-run (moved here in T-223 piece 6a) ----------
  app.post('/api/orders/dry-run', (req, res) => {
    if (KILL_SWITCH) {
      audit('order.blocked', { reason: 'KILL_SWITCH_ON', payload: req.body });
      return res.status(503).json({ ok: false, reason: 'KILL_SWITCH_ON' });
    }
    const required = ['strategyTag', 'instrument', 'side', 'quantity', 'product', 'orderType'];
    for (const k of required) if (!(k in (req.body || {}))) {
      return res.status(400).json({ ok: false, reason: `missing:${k}` });
    }
    const clientOrderId = crypto.randomUUID();
    audit('order.dryRun', { clientOrderId, payload: req.body });
    res.json({ ok: true, mode: 'dry-run', clientOrderId,
               note: 'Scaffold only. No broker called. No real order placed.' });
  });

  // ---------- /api/orders/place (T-224 6b: moved from server.js) ----------
  app.post('/api/orders/place', withAuth(async (req, res) => {
    const broker = getBroker();
    const paper = getPaper();
    const twoFactor = getTwoFactor();
    const body = req.body || {};
    // Tier 15: SEBI Algo-ID is now required. Under the 1 Apr 2026 framework every
    // algo-routed order must carry an exchange-issued Algo-ID. We require the caller
    // to pass it explicitly -- the value comes from the broker after empanelment.
    const required = ['strategyTag', 'algoId', 'symbol', 'side', 'quantity', 'product', 'orderType'];
    for (const k of required) {
      if (!(k in body)) return res.status(400).json({ ok: false, reason: `missing:${k}` });
    }

    // Normalize + validate
    const side       = String(body.side).toUpperCase();
    const product    = String(body.product).toUpperCase();
    const orderType  = String(body.orderType).toUpperCase();
    const variety    = String(body.variety || 'regular').toLowerCase();
    const validity   = String(body.validity || 'DAY').toUpperCase();
    const quantity   = Number(body.quantity);
    const price      = body.price != null ? Number(body.price) : null;
    const triggerPx  = body.triggerPrice != null ? Number(body.triggerPrice) : null;
    const symbol     = String(body.symbol).trim();
    const exchange   = String(body.exchange || 'NSE').toUpperCase();

    if (!VALID_SIDES.has(side))             return res.status(400).json({ ok:false, reason:`invalid side: ${side}` });
    if (!VALID_PRODUCTS.has(product))       return res.status(400).json({ ok:false, reason:`invalid product: ${product}` });
    if (!VALID_ORDER_TYPES.has(orderType))  return res.status(400).json({ ok:false, reason:`invalid orderType: ${orderType}` });
    if (!VALID_VARIETIES.has(variety))      return res.status(400).json({ ok:false, reason:`invalid variety: ${variety}` });
    if (!VALID_VALIDITY.has(validity))      return res.status(400).json({ ok:false, reason:`invalid validity: ${validity}` });
    if (!Number.isFinite(quantity) || quantity <= 0) return res.status(400).json({ ok:false, reason:'quantity must be > 0' });
    if (orderType === 'LIMIT' && (!Number.isFinite(price) || price <= 0))
      return res.status(400).json({ ok:false, reason:'LIMIT order requires price > 0' });
    if (product === 'BO') {
      const sq = Number(body.squareoff || body.targetOffset || 0);
      const sl = Number(body.stoploss || body.slOffset || 0);
      if (sq <= 0 || sl <= 0) return res.status(400).json({ ok:false, reason:'BO requires squareoff (target offset) and stoploss (offset) > 0' });
    }
    if ((orderType === 'SL' || orderType === 'SL-M') && (!Number.isFinite(triggerPx) || triggerPx <= 0))
      return res.status(400).json({ ok:false, reason:`${orderType} order requires triggerPrice > 0` });

    const clientOrderId = body.clientOrderId || crypto.randomUUID();

    const normalizedPayload = {
      strategyTag: String(body.strategyTag),
      algoId:      String(body.algoId),
      symbol, exchange, side, quantity, product, orderType, variety, validity,
      price, triggerPrice: triggerPx,
      clientOrderId,
      // Tier 45: BRACKET (BO) and Cover (CO) order extras. Zerodha's BO/CO products
      // require these absolute-points fields. Accept them from the body OR derive
      // from the offset shape the UI sends (Tier 33 Bracket builder).
      ...(product === 'BO' ? {
        squareoff:        Number(body.squareoff        || body.targetOffset || 0),
        stoploss:         Number(body.stoploss         || body.slOffset     || 0),
        trailing_stoploss:Number(body.trailing_stoploss || 0),
      } : {}),
      ...(product === 'CO' && triggerPx != null ? {
        trigger_price: triggerPx,
      } : {}),
      // Tier 15: rationale captured for audit trail (SEBI traceability)
      rationale:   body.rationale ? String(body.rationale).slice(0, 500) : null,
    };

    // T-273: consolidated pre-trade pipeline. If wired, this single call
    // replaces the next THREE gates (KILL_SWITCH, LIVE_TRADING, tradingMode)
    // and adds two more (leverage, sector concentration). When the dep is
    // absent (e.g. older deploy or test config), the legacy inline gates
    // below still fire -- always have a backstop, never depend on a service
    // being initialised for safety.
    const _pt = (typeof getPreTradeCheck === 'function') ? getPreTradeCheck() : null;
    if (_pt && typeof _pt.check === 'function') {
      const verdict = _pt.check({ userId: req.user && req.user.id, payload: normalizedPayload });
      if (!verdict.ok) {
        // T-358 (security): server-side audit gets the full detail, but the
        // client response now ships only {ok, reason, clientOrderId}. Previous
        // version leaked verdict.detail (pre-trade-check internals) and
        // validatedPayload (echo of user's order params, useful for an attacker
        // to confirm a probe). Reason code remains so the UI can show a
        // meaningful message.
        audit('order.blocked.preTrade', {
          ...normalizedPayload,
          reason: verdict.reason,
          detail: verdict.detail,    // logged server-side for ops
          message: verdict.message,
        });
        return res.status(verdict.status || 503).json({
          ok: false,
          reason: verdict.reason,
          clientOrderId,
        });
      }
      // All gates passed -- skip the legacy inline checks below. They're
      // duplicates of GATES 1-3 in pre-trade.js and would be no-ops anyway,
      // but the early-return avoids running them twice.
    } else {
      // ---- Legacy inline gates (fallback when preTradeCheck unavailable) ----
    // Hard safety: while kill-switch is on, NEVER route to broker. Just audit.
    if (KILL_SWITCH) {
      audit('order.blocked.killSwitch', normalizedPayload);
      return res.status(503).json({
        ok: false,
        reason: 'KILL_SWITCH_ON',
        message: 'Live orders are disabled while KILL_SWITCH=true. Set KILL_SWITCH=false in /etc/ats/backend.env to enable.',
        clientOrderId,
        validatedPayload: normalizedPayload,
      });
    }

    // Tier 11 second gate: even with KILL_SWITCH=false, also require LIVE_TRADING=true.
    // This way operator must consciously flip TWO env vars to enable real orders.
    if (!LIVE_TRADING) {
      audit('order.blocked.liveTradingDisabled', normalizedPayload);
      return res.status(503).json({
        ok: false,
        reason: 'LIVE_TRADING_DISABLED',
        message: 'KILL_SWITCH is off but LIVE_TRADING env is not true. Set LIVE_TRADING=true in /etc/ats/backend.env to enable real orders.',
        clientOrderId,
        validatedPayload: normalizedPayload,
      });
    }

    // T-277: per-user trading-mode guard. The two env-var gates above protect
    // against deploy-level misconfiguration. This third gate is the operator's
    // explicit UI consent: if they have not flipped Settings -> Risk management
    // -> Trading mode to micro_live or full_live, live orders are refused.
    // The intent is to make accidental live trading from a UI button
    // impossible even when env vars are permissive (e.g. operator forgot to
    // flip them back after a maintenance window).
    if (typeof getRiskConfig === 'function' && req.user && req.user.id) {
      try {
        const cfg = getRiskConfig(req.user.id);
        if (cfg && cfg.tradingMode === 'paper') {
          audit('order.blocked.paperMode', { ...normalizedPayload, userId: req.user.id });
          return res.status(403).json({
            ok: false,
            reason: 'LIVE_ORDERS_DISABLED_BY_MODE',
            message: 'Your account is in Paper mode. Open Settings -> Risk management and switch to Micro-live or Full-live to allow live orders.',
            currentMode: cfg.tradingMode,
            clientOrderId,
            validatedPayload: normalizedPayload,
          });
        }
      } catch (e) {
        // Reading risk config is best-effort -- if it fails, fall through to
        // the existing env gates. Never block live trading on a config-read
        // failure; that would lock the operator out during a DB hiccup.
        audit('order.riskConfigLookup.failed', { msg: e.message, userId: req.user.id });
      }
    }
    } // close T-273 else fallback

    // Tier 15 pre-trade risk-gate #1: order-rate circuit
    if (!_orderRateOk()) {
      audit('order.blocked.rateLimit', { ...normalizedPayload, ordersInWindow: _orderTimes.length, capPerMin: MAX_ORDERS_PER_MIN });
      return res.status(429).json({
        ok: false,
        reason: 'ORDER_RATE_LIMIT',
        message: `Max ${MAX_ORDERS_PER_MIN} orders/minute exceeded. ${_orderTimes.length} already placed in the last 60s.`,
        clientOrderId,
      });
    }

    // Tier 15 pre-trade risk-gate #2: per-order notional size cap
    const refPrice = Number(normalizedPayload.price || 0);
    const orderNotional = refPrice > 0 ? refPrice * normalizedPayload.quantity : 0;
    if (orderNotional > MAX_POSITION_SIZE_INR) {
      audit('order.blocked.notionalCap', { ...normalizedPayload, orderNotional, capINR: MAX_POSITION_SIZE_INR });
      return res.status(400).json({
        ok: false,
        reason: 'ORDER_NOTIONAL_TOO_LARGE',
        message: `Order notional ₹${Math.round(orderNotional)} exceeds per-order cap ₹${MAX_POSITION_SIZE_INR}.`,
        clientOrderId,
      });
    }

    // Tier 16 pre-trade risk-gate #4: max aggregate exposure check.
    // Sums: open paper positions (qty * lastPrice) + live holdings (qty * ltp) + this new order's notional.
    try {
      let exposure = orderNotional;
      if (paper) {
        const pos = paper.positions ? paper.positions() : [];
        for (const p of pos) exposure += Math.abs((p.qty || 0) * (p.ltp || p.avgPrice || 0));
      }
      if (typeof broker.getHoldings === 'function') {
        const _pp = await pickBroker(req); const hs = _pp.broker ? await _pp.broker.getHoldings().catch(() => []) : [];
        for (const h of hs) exposure += Math.abs((h.quantity || 0) * (h.last_price || h.ltp || 0));
      }
      if (exposure > MAX_AGGREGATE_EXPOSURE) {
        audit('order.blocked.aggregateExposure', { ...normalizedPayload, exposure, capINR: MAX_AGGREGATE_EXPOSURE });
        return res.status(400).json({
          ok: false,
          reason: 'AGGREGATE_EXPOSURE_TOO_HIGH',
          message: `Adding this order would push aggregate exposure to ₹${Math.round(exposure)}, exceeding cap ₹${MAX_AGGREGATE_EXPOSURE}.`,
          clientOrderId,
        });
      }
    } catch (_e) {}

    // Tier 15 pre-trade risk-gate #3: daily-loss circuit (uses paper realizedPnl as proxy today)
    try {
      const stats = paper ? paper.stats() : null;
      const realizedToday = stats ? (stats.realizedPnl || 0) : 0;
      if (realizedToday <= -Math.abs(MAX_DAILY_LOSS_INR)) {
        audit('order.blocked.dailyLoss', { ...normalizedPayload, realizedToday, capINR: MAX_DAILY_LOSS_INR });
        return res.status(503).json({
          ok: false,
          reason: 'MAX_DAILY_LOSS_HIT',
          message: `Today's realized P&L ${realizedToday} has hit the daily-loss circuit (cap ₹${MAX_DAILY_LOSS_INR}). New live orders are blocked until tomorrow.`,
          clientOrderId,
        });
      }
    } catch (_e) {}

    // T-196 (CODE-AUDIT C.10 #1): per-user broker resolution. The legacy module-
    // level `broker` singleton check would let user A's order succeed because user B
    // (the operator) has a real broker adapter. Each user must have their own.
    const _preCheckBroker = await pickBroker(req);
    if (!_preCheckBroker.broker || typeof _preCheckBroker.broker.placeOrder !== 'function') {
      audit('order.blocked.notImplemented', { ...normalizedPayload, isUserOwn: _preCheckBroker.isUserOwn });
      return res.status(501).json({
        ok: false,
        reason: 'PLACE_ORDER_NOT_IMPLEMENTED',
        message: 'No broker adapter for this user, or it lacks placeOrder(). Connect a broker in Settings -> Brokers.',
        clientOrderId,
        validatedPayload: normalizedPayload,
      });
    }

    // T-245 (P1): F&O lot-size pre-flight. Kite (and every other broker) rejects
    // F&O orders whose quantity isn't a multiple of the contract lot size --
    // NIFTY=50, BANKNIFTY=15, FINNIFTY=40, and so on. The broker's error
    // ("Quantity not in multiples of lot size") is technically correct but
    // happens AFTER the 2FA prompt, AFTER the order rate-limit increments,
    // and shows up to the user as a generic `broker.placeError`. Checking
    // here gives a clean 400 with the offending lot-size and suggested
    // alternative quantities, before any of those side effects fire.
    //
    // Scope: only F&O segments. Equity (NSE/BSE) has no lot-size concept --
    // 1 share is a valid quantity. Brokers that don't expose symbolMeta
    // (Mock/Upstox/Dhan/AngelOne adapters as of T-230) are skipped silently;
    // their own server-side validation still catches misuse.
    const FNO_EXCHANGES = new Set(['NFO', 'BFO', 'MCX', 'CDS']);
    if (FNO_EXCHANGES.has(exchange) && typeof _preCheckBroker.broker.symbolMeta === 'function') {
      try {
        const meta = _preCheckBroker.broker.symbolMeta(`${exchange}:${symbol}`);
        const lot = meta && Number(meta.lotSize) || 0;
        if (lot > 0 && (quantity % lot) !== 0) {
          const down = Math.floor(quantity / lot) * lot;
          const up   = Math.ceil(quantity  / lot) * lot;
          audit('order.blocked.lotSize', { ...normalizedPayload, lotSize: lot, qty: quantity });
          return res.status(400).json({
            ok: false,
            reason: 'LOT_SIZE_MISMATCH',
            lotSize: lot,
            quantity,
            suggested: { down, up },
            message: `${exchange}:${symbol} trades in lots of ${lot}. Quantity ${quantity} is not a multiple. Try ${down > 0 ? down : up} (next valid down/up).`,
            clientOrderId,
            validatedPayload: normalizedPayload,
          });
        }
      } catch (_e) {
        // Instruments master miss is non-fatal -- fall through and let the
        // broker's own validation catch it. T-359: but DO emit an audit line
        // so ops can spot a repeatedly-stale instruments table or a broker
        // adapter that doesn't expose getInstrument(). Previously silent.
        try {
          audit('order.lotSizeCheck.skipped', {
            symbol: normalizedPayload.symbol,
            exchange: normalizedPayload.exchange,
            error: _e && _e.message,
          });
        } catch (_audit) { /* never let audit kill the order path */ }
      }
    }

    // Tier 38: 2FA confirm-before-trade gate. Fires on the FIRST order of the
    // day per {userId, strategyTag} pair. If active, the order is held in a
    // 5-minute bucket and the user is asked to confirm via Telegram.
    // The actual broker.placeOrder() call is deferred to /api/orders/confirm-2fa/:token.
    // T-196 (CODE-AUDIT C.10 #1): the 2FA challenge key is now the per-session
    // user id (not the process-global broker.userId). Without this, one user's
    // confirmation would exempt every user from 2FA for the rest of the day.
    try {
      const userId = String(req.user.id);
      const sTag   = normalizedPayload.strategyTag || 'unknown';
      if (twoFactor && twoFactor.shouldChallenge({ userId, strategyTag: sTag })) {
        const issued = await twoFactor.issue({
          userId, strategyTag: sTag,
          payload: { ...normalizedPayload, clientOrderId },
        });
        return res.status(202).json({
          ok: true,
          pending: true,
          reason: '2FA_REQUIRED',
          token: issued.token,
          telegramSent: issued.sent,
          message: issued.sent
            ? 'First order of the day. Confirm via Telegram within 5 minutes.'
            : 'First order of the day. Telegram delivery failed; confirm manually via POST /api/orders/confirm-2fa/' + issued.token,
          clientOrderId,
        });
      }
    } catch (e) {
      // T-196 (CODE-AUDIT C.10 #1): 2FA error must HARD-FAIL the order. Falling
      // through to broker.placeOrder() on a 2FA exception defeats the purpose of
      // the gate. Operator can retry, escalate, or disable 2FA explicitly via
      // env var if there's a real outage.
      audit('order.2fa.error', { clientOrderId, msg: e.message });
      return res.status(503).json({ ok: false, reason: '2fa_unavailable', detail: e.message, clientOrderId });
    }

    // Reserved for the future. Unreachable today.
    // T-196 (CODE-AUDIT C.10 #1): route to the AUTHENTICATED user's broker via
    // pickBroker(req), not the process-global `broker` singleton. Otherwise every
    // user's "place order" would execute on the operator's connection.
    _orderRateRecord();
    const _p = await pickBroker(req);
    if (!_p.broker || typeof _p.broker.placeOrder !== 'function') {
      audit('order.blocked.brokerUnavailable', { clientOrderId, isUserOwn: _p.isUserOwn });
      return res.status(503).json({ ok: false, reason: 'broker_unavailable', clientOrderId });
    }
    _p.broker.placeOrder(normalizedPayload)
      .then((result) => {
        audit('order.placed', { clientOrderId, result, isUserOwn: _p.isUserOwn });
        res.json({ ok: true, clientOrderId, isUserOwn: _p.isUserOwn, ...result });
      })
      .catch((err) => {
        audit('order.placeError', { clientOrderId, msg: err.message, isUserOwn: _p.isUserOwn });
        res.status(502).json({ ok: false, reason: err.message, clientOrderId });
      });
  }));

  // ---------- /api/orders/confirm-2fa/:token (T-224 6b) ----------
  app.post('/api/orders/confirm-2fa/:token', async (req, res) => {
    const twoFactor = getTwoFactor();
    if (!twoFactor) return res.status(503).json({ ok:false, reason:'two_factor_not_initialized' });
    const token = String(req.params.token || '').trim();
    const c = twoFactor.consume(token);
    if (!c.ok) {
      return res.status(c.reason === 'expired' ? 410 : 404).json({ ok:false, reason: c.reason });
    }
    const p = await pickBroker(req);
    if (!p.broker || typeof p.broker.placeOrder !== 'function') {
      audit('order.2fa.blocked.notImplemented', { token });
      return res.status(501).json({ ok:false, reason:'PLACE_ORDER_NOT_IMPLEMENTED' });
    }
    audit('order.2fa.placing', { token, clientOrderId: c.payload && c.payload.clientOrderId, isUserOwn: p.isUserOwn });
    try {
      _orderRateRecord();
      const result = await p.broker.placeOrder(c.payload);
      audit('order.placed.viaTwoFactor', { clientOrderId: c.payload.clientOrderId, result });
      res.json({ ok:true, confirmed:true, clientOrderId: c.payload.clientOrderId, ...result });
    } catch (err) {
      audit('order.2fa.placeError', { token, msg: err.message });
      res.status(502).json({ ok:false, reason: err.message });
    }
  });

  // ---------- /api/orders/cancel-2fa/:token (GET + POST, T-224 6b) ----------
  async function handleCancel2fa(req, res) {
    const twoFactor = getTwoFactor();
    if (!twoFactor) return res.status(503).json({ ok:false, reason:'two_factor_not_initialized' });
    const token = String(req.params.token || '').trim();
    const r = twoFactor.reject(token);
    if (!r.ok) return res.status(404).json({ ok:false, reason: r.reason });
    res.json({ ok:true, rejected:true, message:'Order rejected. No broker call was made.' });
  }
  app.get( '/api/orders/cancel-2fa/:token', handleCancel2fa);
  app.post('/api/orders/cancel-2fa/:token', handleCancel2fa);

  // ---------- /api/orders/cancel (T-224 6b) ----------
  app.post('/api/orders/cancel', withAuth(async (req, res) => {
    const body = req.body || {};
    const orderId = String(body.orderId || '').trim();
    const variety = String(body.variety || 'regular').toLowerCase();
    if (!orderId) return res.status(400).json({ ok: false, reason: 'missing:orderId' });
    if (KILL_SWITCH)  { audit('order.cancel.blocked.killSwitch', { orderId }); return res.status(503).json({ ok:false, reason:'KILL_SWITCH_ON' }); }
    if (!LIVE_TRADING){ audit('order.cancel.blocked.liveTradingDisabled', { orderId }); return res.status(503).json({ ok:false, reason:'LIVE_TRADING_DISABLED' }); }
    const p = await pickBroker(req);
    if (!p.broker || typeof p.broker.cancelOrder !== 'function') {
      audit('order.cancel.blocked.notImplemented', { orderId });
      return res.status(501).json({ ok: false, reason: 'CANCEL_ORDER_NOT_IMPLEMENTED' });
    }
    try {
      const r = await p.broker.cancelOrder({ orderId, variety });
      audit('order.cancelled', { orderId, result: r });
      res.json({ ok: true, ...r });
    } catch (e) {
      audit('order.cancelError', { orderId, msg: e.message });
      res.status(502).json({ ok: false, reason: e.message, orderId });
    }
  }));
}

module.exports = { mountOrdersRoutes };
