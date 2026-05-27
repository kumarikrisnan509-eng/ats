// T-262 / T-482: /api/me/risk-config GET/PUT + full_live 2FA gate.
//
// Per-user risk-management config. PUT requests that include
// tradingMode='full_live' (and the user is not already in full_live) do NOT
// immediately apply. Instead the backend issues a 6-digit code via Telegram,
// holds the partial in a 5-min in-memory bucket keyed by a one-time random
// token, and returns 202 with {pending:true, reason:'FULL_LIVE_2FA_REQUIRED',
// token, message}. The client then POSTs the code to
// /api/me/risk-config/confirm-mode-change/:token. If it matches, the held
// partial is applied via svc.upsert() and the user transitions to full_live.
//
// External deps (passed via mount function options):
//   getRiskConfig - () => riskConfigService instance from services/risk-config.js
//   getAuth       - () => auth (only used for the 503 guard, mirroring auth.js)
//   getNotify     - () => notify module ({ postTelegram, ENABLED }) -- optional
//   getAudit      - () => audit function (event, data) -- optional

'use strict';

const crypto = require('crypto');

const _pendingModeChanges = new Map();
const PENDING_TTL_MS = 5 * 60 * 1000;

function _gcExpiredPending() {
  const now = Date.now();
  for (const [k, v] of _pendingModeChanges) {
    if (v.exp < now) _pendingModeChanges.delete(k);
  }
}

function _generateCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function _generateToken() {
  return crypto.randomBytes(16).toString('hex');
}

function mountRiskConfigRoutes(app, deps) {
  const { getRiskConfig, getAuth, getNotify, getAudit } = deps;

  function _audit(event, data) {
    try {
      const a = (typeof getAudit === 'function') ? getAudit() : null;
      if (typeof a === 'function') a(event, data);
    } catch (_) { /* never let audit kill the route */ }
  }

  app.get('/api/me/risk-config', (req, res) => {
    const auth = getAuth();
    if (!auth) return res.status(503).json({ ok: false, reason: 'auth_not_initialized' });
    if (!req.user) return res.status(401).json({ ok: false, reason: 'auth_required' });
    const svc = getRiskConfig();
    if (!svc) return res.status(503).json({ ok: false, reason: 'risk_config_not_initialized' });
    try {
      const config = svc.get(req.user.id);
      const notify = (typeof getNotify === 'function') ? getNotify() : null;
      const telegramConfigured = !!(notify && notify.ENABLED);
      res.json({ ok: true, config, telegramConfigured });
    } catch (e) {
      res.status(500).json({ ok: false, reason: e.message });
    }
  });

  app.put('/api/me/risk-config', async (req, res) => {
    const auth = getAuth();
    if (!auth) return res.status(503).json({ ok: false, reason: 'auth_not_initialized' });
    if (!req.user) return res.status(401).json({ ok: false, reason: 'auth_required' });
    const svc = getRiskConfig();
    if (!svc) return res.status(503).json({ ok: false, reason: 'risk_config_not_initialized' });

    const partial = req.body || {};
    const userId = req.user.id;

    try {
      if (partial.tradingMode === 'full_live') {
        let currentMode = 'paper';
        try {
          const currentCfg = svc.get(userId);
          if (currentCfg && currentCfg.tradingMode) currentMode = currentCfg.tradingMode;
        } catch (_) { /* default to paper -- safer */ }

        if (currentMode !== 'full_live') {
          const notify = (typeof getNotify === 'function') ? getNotify() : null;
          if (!notify || !notify.ENABLED || typeof notify.postTelegram !== 'function') {
            _audit('riskConfig.fullLive.blockedNoTelegram', { userId });
            return res.status(403).json({
              ok: false,
              reason: 'FULL_LIVE_REQUIRES_TELEGRAM',
              message: 'Full-live mode requires out-of-band 2FA via Telegram. The operator must configure TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in /etc/ats/backend.env and restart the backend.',
            });
          }

          _gcExpiredPending();
          const code = _generateCode();
          const token = _generateToken();
          _pendingModeChanges.set(token, {
            userId,
            code,
            partial,
            exp: Date.now() + PENDING_TTL_MS,
            attempts: 0,
          });

          const text = [
            '\ud83d\udd10 *ATS -- Confirm Full-live trading switch*',
            '',
            'Code: `' + code + '`',
            '',
            'Someone (hopefully you) just requested promoting your trading mode',
            'to *Full-live (100% real)* on https://ats.rajasekarselvam.com.',
            '',
            'Type this 6-digit code into the confirmation prompt within 5 minutes.',
            '',
            'If you did NOT make this request, IGNORE this message. The request',
            'will expire automatically and your mode will stay as-is.',
          ].join('\n');

          let sent = false;
          try {
            const r = await notify.postTelegram(text);
            sent = !!(r && r.sent);
          } catch (e) {
            _audit('riskConfig.fullLive.challengeSendFailed', { userId, msg: e.message });
          }

          if (!sent) {
            _pendingModeChanges.delete(token);
            return res.status(503).json({
              ok: false,
              reason: 'CHALLENGE_DELIVERY_FAILED',
              message: 'Could not deliver the 2FA code via Telegram. Try again; if the problem persists check the bot token + chat id in backend.env.',
            });
          }

          _audit('riskConfig.fullLive.challengeIssued', { userId, token });
          return res.status(202).json({
            ok: true,
            pending: true,
            reason: 'FULL_LIVE_2FA_REQUIRED',
            token,
            ttlSec: Math.floor(PENDING_TTL_MS / 1000),
            message: 'A 6-digit code was sent to your Telegram. POST it to /api/me/risk-config/confirm-mode-change/' + token + ' within 5 minutes.',
          });
        }
      }

      const config = svc.upsert(userId, partial);
      _audit('riskConfig.updated', { userId, tradingMode: config.tradingMode });
      res.json({ ok: true, config });
    } catch (e) {
      res.status(400).json({ ok: false, reason: e.message });
    }
  });

  app.post('/api/me/risk-config/confirm-mode-change/:token', (req, res) => {
    const auth = getAuth();
    if (!auth) return res.status(503).json({ ok: false, reason: 'auth_not_initialized' });
    if (!req.user) return res.status(401).json({ ok: false, reason: 'auth_required' });
    const svc = getRiskConfig();
    if (!svc) return res.status(503).json({ ok: false, reason: 'risk_config_not_initialized' });

    const token = String(req.params.token || '');
    const code = String((req.body && req.body.code) || '').replace(/\s+/g, '');

    _gcExpiredPending();
    const pending = _pendingModeChanges.get(token);
    if (!pending) {
      _audit('riskConfig.fullLive.confirmInvalidToken', { userId: req.user.id, token });
      return res.status(410).json({
        ok: false,
        reason: 'TOKEN_INVALID_OR_EXPIRED',
        message: 'Confirmation token not found or expired. Request a fresh challenge.',
      });
    }

    if (pending.userId !== req.user.id) {
      _audit('riskConfig.fullLive.confirmUserMismatch', { initiator: pending.userId, attempter: req.user.id });
      return res.status(403).json({ ok: false, reason: 'TOKEN_USER_MISMATCH' });
    }

    const codeBuf = Buffer.from(code);
    const expBuf  = Buffer.from(pending.code);
    if (codeBuf.length !== expBuf.length || !crypto.timingSafeEqual(codeBuf, expBuf)) {
      pending.attempts = (pending.attempts || 0) + 1;
      _audit('riskConfig.fullLive.confirmBadCode', { userId: req.user.id, token, attempts: pending.attempts });
      if (pending.attempts >= 5) {
        _pendingModeChanges.delete(token);
        return res.status(429).json({
          ok: false,
          reason: 'TOO_MANY_BAD_CODES',
          message: 'Too many wrong code attempts. Request a fresh challenge.',
        });
      }
      return res.status(401).json({
        ok: false,
        reason: 'CODE_MISMATCH',
        attemptsRemaining: 5 - pending.attempts,
      });
    }

    _pendingModeChanges.delete(token);
    try {
      const config = svc.upsert(req.user.id, pending.partial);
      _audit('riskConfig.fullLive.confirmed', { userId: req.user.id, tradingMode: config.tradingMode });
      return res.json({ ok: true, config, mode: config.tradingMode });
    } catch (e) {
      _audit('riskConfig.fullLive.upsertFailedPostConfirm', { userId: req.user.id, msg: e.message });
      return res.status(400).json({ ok: false, reason: e.message });
    }
  });
}

module.exports = { mountRiskConfigRoutes, _pendingModeChanges, _gcExpiredPending };
