// cron-reauth.js -- Tier 80: daily per-user auto-reauth scheduler.
//
// Runs once at 05:45 AM IST on weekdays (well before Kite tokens expire at 07:30 IST).
// Iterates over every broker_account row that has totp_seed + feed_token + auto_reauth_enabled,
// calls runAutoReauth (same code path as the manual "Auto reauth" button), with a 5-second
// inter-user delay to stay under Kite's IP-based rate limit (~3 req/sec).
//
// Results are logged to cron_reauth_history. On failure, a Telegram message is sent if
// the global telegram bot is wired up (best-effort).
//
// API:
//   const cron = createCronReauth({ db, vault, audit, postTelegram });
//   cron.start();   // begins the 60s check loop
//   cron.runNow();  // manual trigger (used by an admin endpoint)
//   cron.stop();    // halts the timer (for tests)

'use strict';

const INTER_USER_DELAY_MS = 5000;     // 5s between users -> stays under Kite rate limit
const TARGET_HOUR_IST    = 5;         // 05:45 IST  (00:15 UTC)
const TARGET_MINUTE_IST  = 45;
const CHECK_INTERVAL_MS  = 60 * 1000; // every 1 minute

function nowIst() {
  // Convert current UTC time to IST (+05:30) clock values.
  const d = new Date();
  const istMs = d.getTime() + (5.5 * 60 * 60 * 1000);
  const ist = new Date(istMs);
  return {
    hour: ist.getUTCHours(),
    minute: ist.getUTCMinutes(),
    dayOfWeek: ist.getUTCDay(),  // 0=Sun .. 6=Sat
    dateKey: `${ist.getUTCFullYear()}-${String(ist.getUTCMonth()+1).padStart(2,'0')}-${String(ist.getUTCDate()).padStart(2,'0')}`,
  };
}

function createCronReauth({ db, vault, audit, postTelegram }) {
  let _timer = null;
  let _lastRunDateKey = null;  // YYYY-MM-DD of last successful trigger -- prevents double-fire
  let _inFlight = false;

  let _runAutoReauth;
  try { _runAutoReauth = require('./me-broker')._runAutoReauth; }
  catch (e) { console.error('[cron-reauth] cannot import runAutoReauth:', e.message); return { start(){}, stop(){}, runNow: async () => ({ ok:false, reason:'no_runner' }) }; }

  async function runForAllEligible(triggerLabel) {
    if (_inFlight) return { ok: false, reason: 'already_running' };
    _inFlight = true;
    try {
      const rows = db.brokers.listEligible();
      const startedAt = new Date().toISOString();
      try { audit && audit('cron.reauth.start', { trigger: triggerLabel, count: rows.length }); } catch (_) {}
      const results = [];
      for (const row of rows) {
        const t0 = Date.now();
        let result;
        try {
          result = await _runAutoReauth({ db, vault, userId: row.user_id, brokerRow: row });
        } catch (e) {
          result = { ok: false, reason: 'exception', detail: e.message };
        }
        const elapsed = Date.now() - t0;
        try { db.cron.addHistory(row.user_id, row.broker, !!result.ok, result.reason || (result.ok ? null : 'unknown'), elapsed); } catch (_) {}
        if (!result.ok && typeof postTelegram === 'function') {
          // Best-effort user notification. We don't have per-user TG handles yet, so this just goes
          // to the global TG channel with the user_id called out.
          try { postTelegram(`ATS auto-reauth failed for user_id=${row.user_id} broker=${row.broker} reason=${result.reason || 'unknown'}`); } catch (_) {}
        }
        results.push({ user_id: row.user_id, broker: row.broker, ok: !!result.ok, reason: result.reason, elapsed_ms: elapsed });
        // Spacing between users to respect Kite rate limit + give the headless browser time to reset.
        if (rows.indexOf(row) < rows.length - 1) {
          await new Promise(r => setTimeout(r, INTER_USER_DELAY_MS));
        }
      }
      const okCount = results.filter(r => r.ok).length;
      try { audit && audit('cron.reauth.done', { trigger: triggerLabel, ok: okCount, total: results.length, results }); } catch (_) {}
      if (typeof postTelegram === 'function' && results.length > 0) {
        try { postTelegram(`ATS daily auto-reauth: ${okCount}/${results.length} ok at ${startedAt}`); } catch (_) {}
      }
      return { ok: true, total: results.length, okCount, results };
    } finally {
      _inFlight = false;
    }
  }

  function checkAndMaybeRun() {
    const t = nowIst();
    // Skip weekends entirely (no NSE trading) but allow Monday catch-up.
    if (t.dayOfWeek === 0 || t.dayOfWeek === 6) return;
    // Hit the window 05:45-05:50 IST exactly once per day.
    const inWindow = (t.hour === TARGET_HOUR_IST && t.minute >= TARGET_MINUTE_IST && t.minute < TARGET_MINUTE_IST + 5);
    if (!inWindow) return;
    if (_lastRunDateKey === t.dateKey) return;
    _lastRunDateKey = t.dateKey;
    runForAllEligible('schedule').catch(e => console.error('[cron-reauth] error:', e.message));
  }

  return {
    start() {
      if (_timer) return;
      _timer = setInterval(checkAndMaybeRun, CHECK_INTERVAL_MS);
      console.log(`[cron-reauth] scheduler started -- daily 05:45 IST weekdays`);
    },
    stop() { if (_timer) { clearInterval(_timer); _timer = null; } },
    runNow: () => runForAllEligible('manual'),
    _internal: { nowIst, runForAllEligible },
  };
}

module.exports = { createCronReauth };
