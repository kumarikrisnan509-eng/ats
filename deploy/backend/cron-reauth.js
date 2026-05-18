// cron-reauth.js -- Tier 80: daily per-user auto-reauth scheduler.
//
// Runs once at 05:45 AM IST every day (7 days/week — tokens expire daily regardless).
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

// T99-T114: retry backoff schedule for the daily reauth window.
// If the 05:45 attempt fails, retry at +15min, +30min, +60min, +2h, +4h.
// Reaches up to ~9:45 IST (about market open) to cover transient Kite issues.
// On the first success, abort the retry chain.
const RETRY_BACKOFF_MS = [
  15 * 60 * 1000,   // +15min
  30 * 60 * 1000,   // +30min (cumulative 45min)
  60 * 60 * 1000,   // +60min (cumulative 1h45)
  2 * 60 * 60 * 1000, // +2h    (cumulative 3h45)
  4 * 60 * 60 * 1000, // +4h    (cumulative 7h45)
];

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

function createCronReauth({ db, vault, audit, postTelegram, broker, sessions }) {
  let _timer = null;
  let _lastRunDateKey = null;  // YYYY-MM-DD of last successful trigger -- prevents double-fire
  let _inFlight = false;

  let _runAutoReauth;
  try { _runAutoReauth = require('./me-broker')._runAutoReauth; }
  catch (e) { console.error('[cron-reauth] cannot import runAutoReauth:', e.message); return { start(){}, stop(){}, runNow: async () => ({ ok:false, reason:'no_runner' }) }; }

  // T99-T106: after a successful reauth, refresh the global broker's
  // in-memory access_token too. The cron writes the new sealed token to
  // broker_accounts but the global zerodha-broker singleton only learned
  // its token at boot via the rehydrate path — without this, the broker
  // stays in the _stalledOnToken state from the prior day's expired
  // session even though a fresh token is sitting in the DB.
  async function _refreshGlobalBrokerToken(userId, brokerName) {
    if (!broker || typeof broker.setAccessToken !== 'function') return;
    if (brokerName && brokerName !== 'zerodha') return;
    try {
      const list = db.brokers.list(userId) || [];
      const row = list.find(r => r.broker === 'zerodha' && r.is_default) ||
                  list.find(r => r.broker === 'zerodha');
      if (!row) return;
      const fullRow = db.brokers.getFull(userId, row.id);
      if (!fullRow || !fullRow.access_token) return;
      const accessToken = await vault.open(fullRow.access_token);
      if (!accessToken) return;
      broker.setAccessToken(accessToken);
      try { audit && audit('cron.reauth.broker-rehydrate', { userId }); } catch (_) {}
      // T99-T106b: ALSO refresh the file-based token store. The boot rehydrate
      // path (server.js init()) reads from sessions.loadTokens (filesystem),
      // not from DB. Without this update, a container restart between cron
      // runs would load the stale pre-cron token and the broker would re-stall.
      if (sessions && typeof sessions.saveTokens === 'function') {
        try {
          await sessions.saveTokens(userId, {
            accessToken,
            userId: String(userId),
            issuedAt: fullRow.issued_at || new Date().toISOString(),
          });
        } catch (e) {
          console.error('[cron-reauth] sessions.saveTokens failed:', e && e.message);
        }
      }
    } catch (e) {
      console.error('[cron-reauth] global broker rehydrate failed:', e && e.message);
    }
  }

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
        // T99-T107: include the e.message detail in the persisted reason so a
        // failed exchange_failed/daemon_error/persist_failed gives ops something
        // diagnosable without redeploying.
        // T99-T113: also include kite_error_type when Kite REST rejected, and
        // per-step timings. The audit event carries the full structured detail.
        const reasonForLog = result.ok ? null : (result.detail
          ? String(result.reason || 'unknown') + ': ' + String(result.detail).slice(0, 160)
          : String(result.reason || 'unknown'));
        try { db.cron.addHistory(row.user_id, row.broker, !!result.ok, reasonForLog, elapsed); } catch (_) {}
        if (!result.ok) {
          console.error('[cron-reauth] user', row.user_id, 'failed:', reasonForLog);
          if (result.timings) {
            console.error('[cron-reauth] timings (ms):', JSON.stringify(result.timings));
          }
          if (result.kite) {
            // Full Kite response — invaluable for diagnosing exchange_failed
            // (e.g. token_exception vs input_exception vs network_exception).
            console.error('[cron-reauth] kite response:', JSON.stringify(result.kite));
          }
          try {
            audit && audit('cron.reauth.failed', {
              user_id: row.user_id, broker: row.broker,
              reason: result.reason, detail: result.detail,
              timings: result.timings || null,
              kite: result.kite || null,
            });
          } catch (_) {}
        } else if (result.timings) {
          // On success, log timings at info level so weekly reports can spot
          // trend regressions (e.g. daemon slowing down before it breaks).
          console.log('[cron-reauth] user', row.user_id, 'ok timings (ms):', JSON.stringify(result.timings));
        }
        // T99-T106: on success, also resume the global broker if it stalled
        // on the previous day's expired token. No-op if broker not provided
        // (multi-tenant future / non-zerodha brokers).
        if (result && result.ok) {
          try { await _refreshGlobalBrokerToken(row.user_id, row.broker); } catch (_) {}
        }
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

  // T99-T114: retry chain. If the first attempt has any failures, schedule
  // backoff retries. Cancellable by the next-day fire (_lastRunDateKey check).
  // Each retry only re-runs failed rows from the previous attempt (filtered
  // through the broker resolver — the cron-reauth runner naturally re-picks
  // up rows where last_test_ok=0 via listEligible).
  let _retryTimer = null;
  function _cancelRetries() {
    if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null; }
  }
  async function runWithRetries(triggerLabel) {
    _cancelRetries();
    let attemptIdx = 0;
    const attempt = async () => {
      attemptIdx += 1;
      const label = attemptIdx === 1 ? triggerLabel : `${triggerLabel}+retry${attemptIdx - 1}`;
      const result = await runForAllEligible(label);
      const allOk = result && result.okCount === result.total;
      if (allOk) {
        if (attemptIdx > 1) {
          console.log(`[cron-reauth] retry chain succeeded on attempt ${attemptIdx}`);
          try { audit && audit('cron.reauth.retry-recovered', { attempt: attemptIdx, trigger: triggerLabel }); } catch (_) {}
        }
        return;
      }
      // Schedule next retry if we have one left.
      const backoffIdx = attemptIdx - 1; // attempt 1 just ran; next backoff is index 0
      if (backoffIdx >= RETRY_BACKOFF_MS.length) {
        console.error(`[cron-reauth] retry chain exhausted after ${attemptIdx} attempts — giving up until next scheduled cycle`);
        try { audit && audit('cron.reauth.retry-exhausted', { attempts: attemptIdx, trigger: triggerLabel }); } catch (_) {}
        if (typeof postTelegram === 'function') {
          try { postTelegram(`ATS auto-reauth retry chain exhausted (${attemptIdx} attempts). Manual reauth needed via Brokers card.`); } catch (_) {}
        }
        return;
      }
      const delay = RETRY_BACKOFF_MS[backoffIdx];
      console.log(`[cron-reauth] scheduling retry ${attemptIdx} -> in ${Math.round(delay / 60000)}min`);
      try { audit && audit('cron.reauth.retry-scheduled', { attempt: attemptIdx, delayMs: delay, trigger: triggerLabel }); } catch (_) {}
      _retryTimer = setTimeout(() => { attempt().catch(e => console.error('[cron-reauth] retry error:', e.message)); }, delay);
      if (_retryTimer.unref) _retryTimer.unref();
    };
    await attempt();
  }

  function checkAndMaybeRun() {
    const t = nowIst();
    // Run 7 days/week: Zerodha invalidates the access token daily at ~06:00 IST regardless
    // of whether it's a trading day. Reauth on weekends too so portfolio/holdings stay
    // viewable + paper trades work + the Brokers card never shows 'expired' from
    // Saturday morning onwards. ~30 seconds of Playwright on the OCI VM. No Kite
    // rate-limit concerns at once-per-day from a stable IP.
    // Hit the window 05:45-05:50 IST exactly once per day.
    const inWindow = (t.hour === TARGET_HOUR_IST && t.minute >= TARGET_MINUTE_IST && t.minute < TARGET_MINUTE_IST + 5);
    if (!inWindow) return;
    if (_lastRunDateKey === t.dateKey) return;
    _lastRunDateKey = t.dateKey;
    runWithRetries('schedule').catch(e => console.error('[cron-reauth] error:', e.message));
  }

  return {
    start() {
      if (_timer) return;
      _timer = setInterval(checkAndMaybeRun, CHECK_INTERVAL_MS);
      // T99-T48: .unref() so SIGTERM (docker compose down) can exit promptly
      // instead of waiting for the next CHECK_INTERVAL_MS fire. Without this,
      // every deploy waits the full grace period before docker SIGKILLs.
      // The HTTP server keeps the event loop alive on its own.
      if (_timer.unref) _timer.unref();
      console.log(`[cron-reauth] scheduler started -- daily 05:45 IST (7 days/week)`);
    },
    stop() { if (_timer) { clearInterval(_timer); _timer = null; } _cancelRetries(); },
    runNow: () => runWithRetries('manual'),
    runNowNoRetry: () => runForAllEligible('manual-no-retry'),
    _internal: { nowIst, runForAllEligible },
  };
}

module.exports = { createCronReauth };
