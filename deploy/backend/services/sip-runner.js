// T-276 -- SIP runner. The missing piece that makes DCA mix actually do something.
//
// Until T-276, the user_risk_config.dcaAllocation field was a wish list:
// the UI persisted "2.92% to NIFTYBEES every month" but no code in the
// backend ever fired the order. This file is the cron + plan computer +
// idempotent order placer that closes the loop.
//
// Algorithm (runs daily at 09:30 IST + on-boot catch-up):
//   For each user with a risk config:
//     1. today_ist = current date in IST (YYYY-MM-DD)
//     2. if it's not a weekday -> skip
//     3. if today.day-of-month < cfg.sipDayOfMonth -> skip (too early in month)
//     4. fire_month = today.YYYY-MM
//     5. for each (symbol, allocation) in cfg.dcaAllocation:
//          if a sip_fires row exists with status='placed' for (user, symbol, fire_month) -> skip
//          if allocation <= 0 -> skip
//          amountINR = cfg.capital * allocation
//          if amountINR < 100 -> skip (sub-rupee positions are noise)
//          ltp = getLastTick(symbol); if missing -> skip + log
//          qty = floor(amountINR / ltp); if qty < 1 -> skip
//          place paper order BUY ${qty} ${symbol} MARKET strategy='dca_etf'
//          INSERT into sip_fires (user, symbol, fire_month, status=placed)
//          fire Telegram receipt
//
// Idempotency: the UNIQUE INDEX on (user_id, symbol, fire_month) WHERE status='placed'
// makes double-fires impossible even under cron-restart-race-condition. SQLite
// will throw on the conflict and the runner swallows it as "already_fired".
//
// Catch-up: on boot, runOnce() is called once. If today's nominal fire time
// (09:30 IST) has passed but nothing fired yet, the boot pass picks it up.
//
// Public API:
//   const r = createSipRunner({ db, riskConfigService, paper, audit, notify, getLastTick });
//   r.runOnce(userId, { dryRun }) -> { date, results }
//   r.plan(userId)                -> what WOULD fire today (pure, no side effects)
//   r.history(userId, days=30)    -> recent sip_fires rows
//   r.start() / r.stop()
//   r.stats()                     -> { lastRunAt, lastResults, nextFireAt }

'use strict';

const FIRE_HOUR_IST   = 9;
const FIRE_MINUTE_IST = 30;
const TICK_INTERVAL_MS = 60 * 1000;          // poll once per minute
const MIN_SIP_INR     = 100;                 // skip dust-sized SIPs
const DCA_STRATEGY_TAG = 'dca_etf';

function _nowIST() {
  const now = new Date();
  return new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
}
function _todayISTDate()      { return _nowIST().toISOString().slice(0, 10); } // YYYY-MM-DD
function _monthISTKey()       { return _nowIST().toISOString().slice(0, 7);  } // YYYY-MM
function _istHourMinute() {
  const d = _nowIST();
  return { h: d.getUTCHours(), m: d.getUTCMinutes() };
}
function _isWeekday(dateStr) {
  // SQLite stores YYYY-MM-DD; Date treats this as UTC midnight but day-of-week
  // is the same as IST date because IST = UTC+5:30 always positive.
  const dow = new Date(dateStr + 'T00:00:00Z').getUTCDay();
  return dow !== 0 && dow !== 6; // 0=Sun 6=Sat
}

// T-496: marketMeta is optional (only used for the holiday gate in plan()).
function createSipRunner({ db, riskConfigService, paper, audit, notify, getLastTick, marketMeta }) {
  if (!db || !db._conn) throw new Error('createSipRunner: db with _conn required');
  if (!riskConfigService) throw new Error('createSipRunner: riskConfigService required');
  if (!paper) throw new Error('createSipRunner: paper required');
  const conn = db._conn;
  const _audit = audit || (() => {});
  const _notify = notify || null;
  const _getLastTick = getLastTick || ((_sym) => null);

  // Prepared statements
  const stmtIsPlaced = conn.prepare(
    "SELECT 1 FROM sip_fires WHERE user_id = ? AND symbol = ? AND fire_month = ? AND status = 'placed' LIMIT 1"
  );
  const stmtInsertFire = conn.prepare(
    `INSERT INTO sip_fires (user_id, symbol, fired_date, fire_month, order_id, amount_inr, allocation_pct, status, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const stmtHistory = conn.prepare(
    `SELECT * FROM sip_fires
     WHERE user_id = ? AND fired_at >= datetime('now', ?)
     ORDER BY id DESC LIMIT 200`
  );

  let _timer = null;
  let _lastRunAt = null;
  let _lastResults = null;
  let _firedTodayFlag = false; // session-level cache; cleared at midnight

  function _alreadyPlacedThisMonth(userId, symbol, fireMonth) {
    return !!stmtIsPlaced.get(userId, symbol, fireMonth);
  }

  /**
   * Pure plan: what WOULD fire today for this user. No side effects.
   * Returns { eligible:[{symbol, allocation, amountINR, ltp, qty, reason}], skipped:[], reason }
   */
  function plan(userId) {
    const cfg = riskConfigService.cachedGet(userId);
    if (!cfg) return { result: 'no_config', eligible: [], skipped: [] };
    const today = _todayISTDate();
    const fireMonth = _monthISTKey();
    const dayOfMonth = Number(today.slice(8));

    // T-496: prefer marketMeta.isHolidayOrWeekend() so SIP defers on Diwali
    // etc., not just weekends. Falls back to _isWeekday() if marketMeta is
    // unavailable (boot race) so SIP never silently runs on every day.
    if (marketMeta && typeof marketMeta.isHolidayOrWeekend === 'function') {
      const day = marketMeta.isHolidayOrWeekend(today);
      if (day && day.closed) {
        return { result: 'non_market_day', today, reason: day.reason, holidayName: day.holidayName, eligible: [], skipped: [] };
      }
    } else if (!_isWeekday(today)) {
      return { result: 'non_market_day', today, reason: 'weekend_fallback', eligible: [], skipped: [] };
    }
    if (dayOfMonth < cfg.sipDayOfMonth) {
      return { result: 'too_early', today, sipDayOfMonth: cfg.sipDayOfMonth, eligible: [], skipped: [] };
    }

    const eligible = [];
    const skipped = [];
    const allocation = cfg.dcaAllocation || {};
    for (const [symbol, alloc] of Object.entries(allocation)) {
      if (!Number.isFinite(alloc) || alloc <= 0) {
        skipped.push({ symbol, reason: 'zero_allocation' });
        continue;
      }
      if (_alreadyPlacedThisMonth(userId, symbol, fireMonth)) {
        skipped.push({ symbol, reason: 'already_placed_this_month' });
        continue;
      }
      const amountINR = cfg.capital * alloc;
      if (amountINR < MIN_SIP_INR) {
        skipped.push({ symbol, reason: `amount_below_min_${MIN_SIP_INR}`, amountINR });
        continue;
      }
      const ltp = _getLastTick(symbol);
      if (!Number.isFinite(ltp) || ltp <= 0) {
        skipped.push({ symbol, reason: 'no_price', amountINR });
        continue;
      }
      const qty = Math.floor(amountINR / ltp);
      if (qty < 1) {
        skipped.push({ symbol, reason: 'qty_below_1', amountINR, ltp });
        continue;
      }
      eligible.push({
        symbol,
        allocation: alloc,
        amountINR: Math.round(amountINR),
        ltp: round2(ltp),
        qty,
        approxCostINR: Math.round(qty * ltp),
      });
    }
    return { result: 'ok', today, fireMonth, sipDayOfMonth: cfg.sipDayOfMonth, eligible, skipped };
  }

  /**
   * Execute the plan for one user. Idempotent: re-running on the same day
   * will not place duplicate orders.
   */
  function runOnce(userId, { dryRun = false } = {}) {
    const p = plan(userId);
    if (p.result !== 'ok') {
      _lastRunAt = new Date().toISOString();
      _lastResults = { userId, ...p, placed: 0, failed: 0 };
      return _lastResults;
    }

    const today = p.today;
    const fireMonth = p.fireMonth;
    const placed = [];
    const failed = [];

    for (const e of p.eligible) {
      if (dryRun) {
        placed.push({ ...e, status: 'would_place' });
        continue;
      }
      try {
        const order = paper.placeOrder({
          symbol:   e.symbol,
          side:     'BUY',
          qty:      e.qty,
          type:     'MARKET',
          strategy: DCA_STRATEGY_TAG,
        });
        try {
          stmtInsertFire.run(userId, e.symbol, today, fireMonth, order.id, e.approxCostINR, e.allocation, 'placed', null);
        } catch (idemErr) {
          // UNIQUE INDEX violated -> race / double-call. Treat as already-placed.
          _audit('sip.fire.race', { userId, symbol: e.symbol, fireMonth, msg: idemErr.message });
          failed.push({ ...e, status: 'idempotency_race', reason: idemErr.message });
          continue;
        }
        placed.push({ ...e, orderId: order.id, status: 'placed' });
        _audit('sip.fire.placed', { userId, symbol: e.symbol, qty: e.qty, amount: e.approxCostINR, orderId: order.id });
        if (_notify && _notify.notifyOrderPlaced) {
          _notify.notifyOrderPlaced({ ...order, strategy: DCA_STRATEGY_TAG }).catch(() => {});
        }
      } catch (err) {
        failed.push({ ...e, status: 'failed', reason: err.message });
        try {
          stmtInsertFire.run(userId, e.symbol, today, fireMonth, null, e.approxCostINR, e.allocation, 'failed', err.message);
        } catch (_ignored) { /* logging failure is non-fatal */ }
        _audit('sip.fire.failed', { userId, symbol: e.symbol, msg: err.message });
      }
    }

    _lastRunAt = new Date().toISOString();
    _lastResults = {
      userId, date: today, fireMonth,
      placedCount: placed.length, failedCount: failed.length,
      skippedCount: p.skipped.length,
      placed, failed, skipped: p.skipped,
    };
    _firedTodayFlag = placed.length > 0;
    return _lastResults;
  }

  function history(userId, days = 30) {
    const since = `-${Math.max(1, Math.min(365, days))} days`;
    return stmtHistory.all(userId, since);
  }

  function _onTick(userId) {
    const { h, m } = _istHourMinute();
    if (h < FIRE_HOUR_IST) return;
    if (h === FIRE_HOUR_IST && m < FIRE_MINUTE_IST) return;
    // Past the daily fire window. Idempotency guards re-runs.
    try {
      runOnce(userId);
    } catch (e) {
      _audit('sip.tick.error', { userId, msg: e.message });
    }
  }

  function start(userId = 1) {
    if (_timer) return;
    // Boot catch-up: if we're already past the fire time, run immediately.
    _onTick(userId);
    _timer = setInterval(() => _onTick(userId), TICK_INTERVAL_MS);
    if (_timer.unref) _timer.unref();
    _audit('sip.runner.started', { userId, fireAt: `${FIRE_HOUR_IST}:${String(FIRE_MINUTE_IST).padStart(2, '0')} IST` });
  }

  function stop() {
    if (_timer) { clearInterval(_timer); _timer = null; }
  }

  function stats() {
    const ist = _istHourMinute();
    const fired = (ist.h > FIRE_HOUR_IST) || (ist.h === FIRE_HOUR_IST && ist.m >= FIRE_MINUTE_IST);
    return {
      lastRunAt: _lastRunAt,
      lastResults: _lastResults,
      fireWindow: `${FIRE_HOUR_IST}:${String(FIRE_MINUTE_IST).padStart(2, '0')} IST`,
      fireWindowReachedToday: fired,
      timerArmed: !!_timer,
    };
  }

  return { runOnce, plan, history, start, stop, stats };
}

function round2(n) { return Math.round(n * 100) / 100; }

module.exports = { createSipRunner };
