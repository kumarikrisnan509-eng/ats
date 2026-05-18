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

module.exports = { notify, postTelegram, ENABLED };
