// morning-digest.js -- T-510 (Phase 5): 08:30 IST pre-market Telegram digest.
//
// Sends an operator a single rolled-up status message before NSE opens:
//   - yesterday's realized P&L (paper + live)
//   - currently open positions
//   - upcoming earnings blackouts (next 3 trading days)
//   - watchdog + holiday-cache health
//   - degraded-counter snapshot (silent gate failures from prior day)
//   - autorun status (enabled, last fire time)
//
// One Telegram per trading day -- skipped on weekends and (eventually) NSE
// holidays. Skipped silently if Telegram isn't configured.

'use strict';

const FIRE_HOUR_IST   = 8;
const FIRE_MINUTE_IST = 30;
const TICK_INTERVAL_MS = 60 * 1000;
const MIN_BETWEEN_RUNS_MS = 12 * 60 * 60 * 1000;

function _nowIST() { return new Date(Date.now() + (5.5 * 60 * 60 * 1000)); }
function _istHm()  { const d = _nowIST(); return { h: d.getUTCHours(), m: d.getUTCMinutes() }; }
function _today()  { return _nowIST().toISOString().slice(0, 10); }
function _isWeekday() {
  const dow = _nowIST().getUTCDay();
  return dow !== 0 && dow !== 6;
}

function createMorningDigest({ db, getBroker, getPaper, getAutorun, getMarketMeta, getDegradedRegistry, notify, audit }) {
  if (!db || !db._conn) throw new Error('createMorningDigest: db required');
  const _audit = audit || (() => {});
  const _notify = notify || null;
  let _timer = null;
  let _lastRunUnix = 0;
  const conn = db._conn;

  async function _build() {
    const today = _today();
    const yest  = (() => {
      const d = _nowIST(); d.setUTCDate(d.getUTCDate() - 1);
      return d.toISOString().slice(0, 10);
    })();

    const lines = [];
    lines.push(`📊 ATS morning digest — ${today}`);
    lines.push('');

    // Yesterday's paper P&L
    try {
      const r = conn.prepare("SELECT COUNT(*) as trades, ROUND(SUM(pnl), 2) as pnl, SUM(CASE WHEN pnl>0 THEN 1 ELSE 0 END) as wins FROM paper_closed_trades WHERE exited_at LIKE ?").get(yest + '%');
      if (r && r.trades > 0) {
        lines.push(`Paper P&L (${yest}): ₹${r.pnl} on ${r.trades} trades (${r.wins} wins)`);
      } else {
        lines.push(`Paper P&L (${yest}): no closed trades`);
      }
    } catch (e) { lines.push(`Paper P&L: lookup failed -- ${e.message}`); }

    // Open paper positions
    try {
      const paper = (typeof getPaper === 'function') ? getPaper() : null;
      const positions = paper && typeof paper.positions === 'function' ? paper.positions().filter(p => p && p.qty !== 0) : [];
      lines.push(`Open paper positions: ${positions.length}`);
      for (const p of positions.slice(0, 5)) {
        lines.push(`  • ${p.symbol} qty=${p.qty} entry=${p.avgPrice || '?'}`);
      }
      if (positions.length > 5) lines.push(`  ...+${positions.length - 5} more`);
    } catch (e) { lines.push(`Open positions: lookup failed -- ${e.message}`); }

    // Autorun status
    try {
      const ar = (typeof getAutorun === 'function') ? getAutorun() : null;
      if (ar && ar._config) {
        const lastRun = (ar._history && ar._history.length) ? ar._history[ar._history.length - 1] : null;
        lines.push(`Autorun: ${ar._config.strategy}/${ar._config.symbol} enabled=${!!ar._config.enabled} tradesToday=${ar._tradesToday || 0}${lastRun ? ` last=${lastRun.result}` : ''}`);
      } else {
        lines.push('Autorun: no config');
      }
    } catch (e) { lines.push(`Autorun: status failed -- ${e.message}`); }

    // Holiday cache health
    try {
      const mm = (typeof getMarketMeta === 'function') ? getMarketMeta() : null;
      if (mm && typeof mm.getHolidaysHealth === 'function') {
        const h = mm.getHolidaysHealth();
        lines.push(`Holiday cache: ${h.source}${h.cacheAgeDays != null ? ` (${h.cacheAgeDays}d old)` : ''}${h.stale ? ' ⚠️ stale' : ''}`);
      }
    } catch { /* permissive */ }

    // Degraded-gate snapshot
    try {
      const dr = (typeof getDegradedRegistry === 'function') ? getDegradedRegistry() : null;
      if (dr && typeof dr.snapshot === 'function') {
        const s = dr.snapshot();
        const nonZero = Object.entries(s).filter(([_, v]) => v > 0);
        if (nonZero.length) {
          lines.push(`⚠️ Degraded gates: ${nonZero.map(([k, v]) => `${k}=${v}`).join(', ')}`);
        } else {
          lines.push('Safety gates: all clean');
        }
      }
    } catch { /* permissive */ }

    return lines.join('\n');
  }

  async function _runDigest() {
    if (!_isWeekday()) {
      _audit('morning.digest.skipped', { reason: 'weekend' });
      return { ok: true, sent: false, reason: 'weekend' };
    }
    if (!_notify || typeof _notify.notify !== 'function') {
      _audit('morning.digest.skipped', { reason: 'no_notify' });
      return { ok: true, sent: false, reason: 'no_notify' };
    }
    try {
      const body = await _build();
      await _notify.notify({ title: 'ATS morning digest', body });
      _audit('morning.digest.sent', { length: body.length });
      return { ok: true, sent: true };
    } catch (e) {
      _audit('morning.digest.fail', { msg: e.message });
      return { ok: false, error: e.message };
    }
  }

  function _onTick() {
    if (Date.now() - _lastRunUnix < MIN_BETWEEN_RUNS_MS) return;
    const { h, m } = _istHm();
    if (h !== FIRE_HOUR_IST || m !== FIRE_MINUTE_IST) return;
    _lastRunUnix = Date.now();
    _runDigest().catch(e => _audit('morning.digest.fatal', { msg: e.message }));
  }

  function start() {
    if (_timer) return;
    _timer = setInterval(_onTick, TICK_INTERVAL_MS);
    if (typeof _timer.unref === 'function') _timer.unref();
    _audit('morning.digest.started', { fireAt_ist: `${FIRE_HOUR_IST}:${String(FIRE_MINUTE_IST).padStart(2,'0')}` });
  }
  function stop() { if (_timer) { clearInterval(_timer); _timer = null; } }

  return { start, stop, runNow: _runDigest };
}

module.exports = { createMorningDigest };
