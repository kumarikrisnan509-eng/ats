// order-retry.js -- T-512 (Phase 4 part 1): retry/backoff wrapper for broker.placeOrder.
//
// Today every broker.placeOrder call is a single-shot HTTP request. A
// transient network blip (DNS, Kite gateway 502, TCP RST) on the wire
// surfaces as a hard failure to the caller. For autorun this means the
// next 5-min tick retries the same signal with a fresh dedupe check --
// effectively a 5-minute retry window with no exponential backoff.
//
// This wrapper turns one placeOrder call into up to RETRIES retries
// (default 3) with exponential backoff (2s, 4s, 8s) for *transient*
// failures only. Broker-side hard rejections (margin shortfall, lot-size
// wrong, symbol invalid, circuit-breaker hit, price-band violation) are
// NOT retried -- they will never succeed on retry and would just spam
// the broker.
//
// Failure classification:
//   - Network / 5xx        -> retry with backoff
//   - HTTP 401/403/429     -> single retry (auth/rate may clear)
//   - HTTP 400 + Kite      -> NO retry (caller's bug)
//   - Kite RMS error codes -> NO retry (will fail same way)

'use strict';

const DEFAULT_OPTS = Object.freeze({
  retries:        3,
  baseDelayMs: 2000,
  audit:        () => {},
  notify:        null,
});

// Regex / substring scanners for known terminal errors.
const TERMINAL_PATTERNS = [
  /margin\s*shortfall/i,
  /lot[\s-]*size/i,
  /circuit/i,
  /price.*band/i,
  /trading.*halt/i,
  /symbol.*invalid/i,
  /invalid\s*tradingsymbol/i,
  /reject(?:ed)?\s*by\s*rms/i,
  /freeze\s*quantity/i,
];

function _isTerminal(err) {
  const msg = (err && err.message) ? String(err.message) : '';
  for (const p of TERMINAL_PATTERNS) if (p.test(msg)) return true;
  // HTTP 4xx (other than 401/403/429) are caller-side, don't retry.
  const status = err && (err.status || err.statusCode || (err.response && err.response.status));
  if (status && status >= 400 && status < 500 && ![401, 403, 429].includes(status)) return true;
  return false;
}

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function withRetry(fn, opts = {}) {
  const cfg = Object.assign({}, DEFAULT_OPTS, opts);
  const _audit = cfg.audit;
  const _notify = cfg.notify;
  return async function retried(...args) {
    let lastErr = null;
    for (let attempt = 0; attempt <= cfg.retries; attempt++) {
      try {
        const result = await fn.apply(this, args);
        if (attempt > 0) {
          _audit('order.retry.recovered', { attempt, payload: args[0] });
        }
        return result;
      } catch (e) {
        lastErr = e;
        if (_isTerminal(e)) {
          _audit('order.retry.terminal', { attempt, msg: e.message, payload: args[0] });
          throw e;
        }
        if (attempt >= cfg.retries) {
          _audit('order.retry.exhausted', { attempts: attempt + 1, msg: e.message, payload: args[0] });
          if (_notify && typeof _notify.notify === 'function') {
            _notify.notify({
              title: '⚠️ ATS: order retry exhausted',
              body: `placeOrder failed after ${attempt + 1} attempts. Last error: ${e.message}`,
            }).catch(() => {});
          }
          throw e;
        }
        const delay = cfg.baseDelayMs * Math.pow(2, attempt);
        _audit('order.retry.attempt', { attempt: attempt + 1, nextDelayMs: delay, msg: e.message });
        await _sleep(delay);
      }
    }
    throw lastErr || new Error('order-retry: unexpected exit');
  };
}

module.exports = { withRetry, _isTerminal, TERMINAL_PATTERNS };
