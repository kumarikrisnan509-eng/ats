// promote-scheduler.js -- T-499: nightly paper->live promotion evaluator.
//
// Runs once per day (default 23:30 IST -- after market close + reconciliation,
// before any next-day cron activity). For each user, for each strategy in
// active_strategies_json, computes paper stats over the configured window
// and applies promotion-policy. Strategies that pass ALL gates get added to
// risk_config.live_enabled_strategies (T-501 sidecar field); strategies that
// stop meeting the gates get demoted out of it.
//
// Fires Telegram on every promote / demote so the operator always knows the
// live-enabled set without having to poll the API.
//
// Permissive on dependency failure (db down, scheduler hiccup) -- never
// crashes the host process. All actions audited via WORM chain.

'use strict';

const policy = require('./promotion-policy');

const FIRE_HOUR_IST   = 23;
const FIRE_MINUTE_IST = 30;
const TICK_INTERVAL_MS = 60 * 1000;   // poll once per minute
const MIN_SECONDS_BETWEEN_RUNS = 12 * 60 * 60;   // never run more than 2x/day

function _nowIST() {
  return new Date(Date.now() + (5.5 * 60 * 60 * 1000));
}
function _istHourMinute() {
  const d = _nowIST();
  return { h: d.getUTCHours(), m: d.getUTCMinutes() };
}
function _todayIST() { return _nowIST().toISOString().slice(0, 10); }

function createPromoteScheduler({ db, riskConfigService, notify, audit }) {
  if (!db || !db._conn) throw new Error('createPromoteScheduler: db required');
  if (!riskConfigService) throw new Error('createPromoteScheduler: riskConfigService required');
  const _audit = audit || (() => {});
  const _notify = notify || null;
  const conn = db._conn;
  let _timer = null;
  let _lastRunUnix = 0;

  // Pull trades for one user+strategy over the policy window.
  function _tradesFor(userId, strategy, windowDays) {
    const cutoff = new Date(Date.now() - windowDays * 86400_000).toISOString();
    try {
      return conn.prepare(
        'SELECT pnl, exited_at FROM paper_closed_trades WHERE user_id = ? AND strategy_tag = ? AND exited_at > ?'
      ).all(userId, strategy, cutoff);
    } catch (e) {
      _audit('promote.tradeLookup.failed', { userId, strategy, msg: e.message });
      return [];
    }
  }

  function _telegram2faReady(userId) {
    try {
      const n = db.notif && db.notif.get ? db.notif.get(userId) : null;
      return !!(n && n.telegram_enabled && n.telegram_bot_token && n.telegram_chat_id);
    } catch { return false; }
  }

  // Evaluate one user's full set of strategies. Returns a report; ALSO mutates
  // risk_config.live_enabled_strategies as a side effect.
  function evaluateUser(userId, { dryRun = false } = {}) {
    const cfg = riskConfigService.cachedGet ? riskConfigService.cachedGet(userId)
              : riskConfigService.get ? riskConfigService.get(userId) : null;
    if (!cfg) return { ok: false, reason: 'no_risk_config', userId };
    const active = Array.isArray(cfg.activeStrategies) ? cfg.activeStrategies : [];
    if (!active.length) return { ok: true, userId, evaluated: 0, promotions: [], demotions: [] };

    const telegramReady = _telegram2faReady(userId);
    const currentLive = Array.isArray(cfg.liveEnabledStrategies) ? cfg.liveEnabledStrategies.slice() : [];
    const reports = [];
    const newLive = [];
    const promotions = [];
    const demotions = [];

    for (const strategy of active) {
      const trades = _tradesFor(userId, strategy, policy.DEFAULTS.window_days);
      const report = policy.evaluate(trades, { telegram2faReady: telegramReady });
      reports.push({ strategy, can_promote: report.can_promote, failed_gates: report.failed_gates, stats: report.stats });
      const wasLive = currentLive.includes(strategy);
      if (report.can_promote) {
        newLive.push(strategy);
        if (!wasLive) promotions.push(strategy);
      } else if (wasLive) {
        demotions.push(strategy);
      }
    }

    if (!dryRun && (promotions.length || demotions.length)) {
      try {
        riskConfigService.update(userId, { liveEnabledStrategies: newLive });
        _audit('promote.applied', { userId, promotions, demotions, newLive });
      } catch (e) {
        _audit('promote.apply.failed', { userId, msg: e.message });
      }
    }

    return { ok: true, userId, evaluated: active.length, promotions, demotions, live_after: newLive, reports };
  }

  // Drive evaluateUser for every user_risk_config row. For now (single-operator
  // system) this is typically a single user (id=1).
  function evaluateAll({ dryRun = false } = {}) {
    let rows = [];
    try {
      rows = conn.prepare('SELECT user_id FROM user_risk_config').all();
    } catch (e) {
      _audit('promote.userLookup.failed', { msg: e.message });
      return { ok: false, reason: 'no_users', detail: e.message };
    }
    const out = [];
    for (const r of rows) {
      try { out.push(evaluateUser(r.user_id, { dryRun })); }
      catch (e) { _audit('promote.evalUser.failed', { userId: r.user_id, msg: e.message }); }
    }
    const allPromotions = out.flatMap(o => (o.promotions || []).map(s => ({ userId: o.userId, strategy: s })));
    const allDemotions  = out.flatMap(o => (o.demotions  || []).map(s => ({ userId: o.userId, strategy: s })));

    // Fire Telegram if anything changed.
    if (!dryRun && (allPromotions.length || allDemotions.length) && _notify && typeof _notify.notify === 'function') {
      const lines = [];
      if (allPromotions.length) lines.push(`🟢 Promoted to LIVE: ${allPromotions.map(p => p.strategy).join(', ')}`);
      if (allDemotions.length)  lines.push(`🟡 Demoted to paper: ${allDemotions.map(d => d.strategy).join(', ')}`);
      _notify.notify({ title: 'ATS — paper→live promotion run', body: lines.join('\n') }).catch(() => {});
    }
    return { ok: true, dryRun, ran_at: new Date().toISOString(), users_evaluated: out.length, promotions: allPromotions, demotions: allDemotions, per_user: out };
  }

  function _shouldFire() {
    if (Date.now() - _lastRunUnix < MIN_SECONDS_BETWEEN_RUNS * 1000) return false;
    const { h, m } = _istHourMinute();
    return h === FIRE_HOUR_IST && m === FIRE_MINUTE_IST;
  }

  function _onTick() {
    if (!_shouldFire()) return;
    _lastRunUnix = Date.now();
    try {
      const r = evaluateAll();
      _audit('promote.scheduler.ran', r);
    } catch (e) {
      _audit('promote.scheduler.failed', { msg: e.message });
    }
  }

  function start() {
    if (_timer) return;
    _timer = setInterval(_onTick, TICK_INTERVAL_MS);
    if (typeof _timer.unref === 'function') _timer.unref();
    _audit('promote.scheduler.started', { fireAt_ist: `${FIRE_HOUR_IST}:${String(FIRE_MINUTE_IST).padStart(2,'0')}` });
  }
  function stop() { if (_timer) { clearInterval(_timer); _timer = null; } }

  return { start, stop, evaluateUser, evaluateAll };
}

module.exports = { createPromoteScheduler };
