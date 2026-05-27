// notify.js — outbound notifications for operator alerts.
//
// Channels (in priority order):
//   1. Telegram bot (preferred — instant, mobile, free)
//   2. console.log fallback (always on, for VM logs + journald)
//
// Configuration (from process.env via /etc/ats/backend.env):
//   TELEGRAM_BOT_TOKEN  — from @BotFather
//   TELEGRAM_CHAT_ID    — your own chat id (get from @userinfobot)
//
// If either is unset, notifications silently degrade to console.log only.
// Never throws — failures here must not crash the backend.

const https = require('https');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID   = process.env.TELEGRAM_CHAT_ID   || '';
const ENABLED            = Boolean(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID);

function postTelegram(text) {
  if (!ENABLED) {
    return Promise.resolve({ sent: false, reason: 'not_configured' });
  }
  return new Promise((resolve) => {
    const data = JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    });
    const req = https.request(
      {
        hostname: 'api.telegram.org',
        path: `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
        timeout: 5000,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          resolve({ sent: res.statusCode === 200, status: res.statusCode, body: body.slice(0, 200) });
        });
      }
    );
    req.on('error', (err) => resolve({ sent: false, error: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ sent: false, error: 'timeout' }); });
    req.write(data);
    req.end();
  });
}

/**
 * High-level notify. Always logs to console as well.
 * @param {'info'|'warn'|'error'|'success'} level
 * @param {string} title
 * @param {{ body?: string, fields?: Object<string,string|number>, url?: string }} details
 */
async function notify(level, title, details = {}) {
  // T-154: coerce level to a safe string so notify(null|undefined|<non-string>)
  // doesn't crash on .toUpperCase(). Callers SHOULD pass info/warn/error/success
  // but a defensive default keeps the operator-alert path crash-free if a
  // caller (e.g. an error handler) forwards an Error object by mistake.
  const safeLevel = (typeof level === 'string' && level) ? level : 'info';

  const emoji = {
    info:    'ℹ️',
    warn:    '⚠️',
    error:   '❌',
    success: '✅',
  }[safeLevel] || '•';

  const consoleLine = `[NOTIFY:${safeLevel.toUpperCase()}] ${title}${details.body ? ' — ' + details.body : ''}`;
  console.log(consoleLine);

  const lines = [`${emoji} *${title}*`];
  if (details.body) lines.push('', details.body);
  if (details.fields) {
    lines.push('');
    for (const [k, v] of Object.entries(details.fields)) {
      lines.push(`*${k}:* \`${String(v).slice(0, 100)}\``);
    }
  }
  if (details.url) lines.push('', details.url);
  const text = lines.join('\n');

  return postTelegram(text);
}



// ============================================================================
// T-268 -- Trade-event formatters (added Phase 1 build).
// Reusable templates that compose pretty Telegram messages for the operator's
// trading activity. All take a `details` object and call notify() under the
// hood, so they share the console-log + Telegram pipeline.
// ============================================================================

/**
 * Order placed. Caller passes the just-placed order object.
 */
async function notifyOrderPlaced(order) {
  return notify('info', `Order placed: ${order.side} ${order.qty} ${order.symbol}`, {
    fields: {
      'Type':       order.type || 'MARKET',
      'Strategy':   order.strategy || '(none)',
      'Price':      order.price != null ? `₹${order.price}` : 'market',
      'Stop loss':  order.stopLoss != null ? `₹${order.stopLoss}` : '-',
      'Target':     order.targetPrice != null ? `₹${order.targetPrice}` : '-',
      'Order ID':   order.id ? order.id.slice(0, 8) : '-',
    },
  });
}

/**
 * Order filled. Pass {order, fillPrice, pnl?} -- pnl is realised PnL for closing fills.
 */
async function notifyOrderFilled({ order, fillPrice, pnl }) {
  const fields = {
    'Symbol':     order.symbol,
    'Side':       order.side,
    'Qty':        String(order.qty),
    'Fill price': `₹${fillPrice}`,
    'Strategy':   order.strategy || '(none)',
  };
  if (Number.isFinite(pnl)) {
    fields['Realized PnL'] = pnl >= 0 ? `+₹${pnl}` : `-₹${Math.abs(pnl)}`;
  }
  const level = Number.isFinite(pnl) ? (pnl >= 0 ? 'success' : 'warn') : 'info';
  return notify(level, `Order filled: ${order.side} ${order.qty} ${order.symbol} @ ₹${fillPrice}`, { fields });
}

/**
 * Stop-loss / trailing-SL triggered.
 */
async function notifyStopLossHit({ symbol, side, qty, triggerPrice, fillPrice, pnl, isTrailing }) {
  const kind = isTrailing ? 'Trailing SL hit' : 'Stop-loss hit';
  return notify('warn', `${kind}: ${symbol}`, {
    body: `${side} ${qty} @ trigger ₹${triggerPrice}, filled ₹${fillPrice}`,
    fields: {
      'Realized PnL': pnl >= 0 ? `+₹${pnl}` : `-₹${Math.abs(pnl)}`,
      'Symbol':       symbol,
    },
  });
}

/**
 * Daily loss budget threshold crossed (50%, 75%, 90%, 100%).
 */
async function notifyDailyLossThreshold({ percentUsed, budgetINR, realisedLossINR }) {
  const lvl = percentUsed >= 90 ? 'error' : 'warn';
  return notify(lvl, `Daily loss budget ${percentUsed}% used`, {
    body: `Realised: ₹${realisedLossINR} of ₹${budgetINR} cap.`,
    fields: { 'Budget': `₹${budgetINR}`, 'Used': `₹${realisedLossINR}`, '% used': `${percentUsed}%` },
  });
}

/**
 * Daily trade count cap hit -- engine pauses new entries.
 */
async function notifyTradeCapHit({ tradesToday, capacity }) {
  return notify('warn', `Daily trade cap hit: ${tradesToday}/${capacity}`, {
    body: `Engine pausing new entries for today. Existing positions still managed.`,
  });
}

/**
 * Outside golden trading window -- new signals suppressed.
 * Logged but normally NOT sent to Telegram (would spam every tick outside window).
 */
function logOutsideWindow({ now, windowStart, windowEnd }) {
  // console only -- no Telegram. Reason: this fires on every tick outside the
  // window, which would be 16+ hours of spam.
  // Callers may opt to surface this via UI banner instead.
  console.log(`[notify] outside golden window now=${now} window=${windowStart}..${windowEnd}`);
}

/**
 * Trade rejected by tax-aware economics gate.
 */
async function notifyTradeRejectedUneconomic({ symbol, strategy, projectedNetPnl, minNetPnlINR }) {
  return notify('info', `Trade rejected: economics`, {
    body: `${strategy} on ${symbol} -- projected net PnL after charges ₹${projectedNetPnl} below threshold ₹${minNetPnlINR}.`,
  });
}


// T-458 (audit-2026-05-26 backend L3): Telegram delivery-failure counter.
// Before this, postTelegram failures (bot token rotated, network blip,
// Telegram outage) were swallowed in console.warn at the call sites —
// operator had no visible signal beyond stdout. Counter is monotonic
// since process start; exposed via /metrics so Prometheus / Grafana can
// alert on a sustained non-zero delta. Bumped from a `.catch` wrapper
// added below.
let _notifyFailureCount = 0;
let _notifyLastFailureAt = null;
let _notifyLastFailureReason = null;
function _recordNotifyResult(result) {
  if (result && result.sent === false && result.reason !== 'not_configured') {
    _notifyFailureCount += 1;
    _notifyLastFailureAt = new Date().toISOString();
    _notifyLastFailureReason = (result.error || result.status || 'unknown_failure');
  }
}
function getNotifyFailureStats() {
  return {
    count: _notifyFailureCount,
    lastFailureAt: _notifyLastFailureAt,
    lastFailureReason: _notifyLastFailureReason,
  };
}

// Patch notify() to track delivery results without changing its signature
// or behaviour. Original returns postTelegram(text); we tap the promise.
const _origNotify = notify;
const notifyTracked = async function(level, title, details) {
  const result = await _origNotify(level, title, details);
  _recordNotifyResult(result);
  return result;
};

module.exports = { notify: notifyTracked, postTelegram, ENABLED,
  notifyOrderPlaced, notifyOrderFilled, notifyStopLossHit,
  notifyDailyLossThreshold, notifyTradeCapHit, logOutsideWindow,
  notifyTradeRejectedUneconomic,
  // T-458 backend L3:
  getNotifyFailureStats,
};
