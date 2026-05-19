// two-factor.js -- Tier 38: confirm-before-trade on FIRST order of the day.
//
// Motivation: stolen sessions, compromised API keys, and runaway algos all
// share a failure mode -- they fire orders the user didn't approve. A simple
// out-of-band confirmation on the FIRST order of each trading day catches
// these without adding friction to subsequent in-session activity.
//
// Flow:
//   1. /api/orders/place is called.
//   2. If today is a new day for this {user,strategy} pair AND Telegram is
//      configured, the order is held in a short-lived (5-min) bucket and a
//      Telegram message is sent with:
//        - human-readable summary (symbol, side, qty, product, R:R if BO)
//        - a confirm URL with one-time token
//        - the algo ID + strategy tag (SEBI traceability)
//      The endpoint returns 202 Accepted with {pending: true, token}.
//   3. User clicks the confirm URL -> POST /api/orders/confirm-2fa/:token.
//      The held payload is replayed through the real broker.placeOrder path.
//   4. After successful confirmation, the {user,strategy} pair is marked
//      "confirmed for today" and subsequent orders skip 2FA until midnight IST.
//   5. Tokens expire after 5 minutes; expired tokens return 410 Gone.
//   6. If Telegram is not configured, 2FA is silently disabled (legacy path
//      preserved). Same if env DISABLE_2FA=true.
//
// All confirmations and expirations are audited (WORM-chained).
//
// Public API:
//   const tf = new TwoFactor({ audit, postTelegram, baseUrl, ttlMs });
//   tf.shouldChallenge({ userId, strategyTag })  -> boolean
//   tf.issue({ userId, strategyTag, payload })   -> Promise<{ token, sent }>
//   tf.consume(token)                            -> { ok, payload, reason? }
//   tf.markConfirmed({ userId, strategyTag })    -> void
//   tf.stats()                                   -> { ... }

'use strict';

const crypto = require('crypto');

// ---- Day-key helpers (IST: UTC+5:30) -------------------------------------
function istDayKey(now) {
  const t = (now != null ? now : Date.now()) + 5.5 * 3600_000;
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

class TwoFactor {
  /**
   * @param {object} [opts]
   * @param {(event:string,data:object)=>void} [opts.audit]
   * @param {(text:string)=>Promise<{sent:boolean}>} [opts.postTelegram]
   * @param {string} [opts.baseUrl]   e.g. 'https://ats.rajasekarselvam.com'
   * @param {number} [opts.ttlMs]     default 5 * 60_000
   * @param {boolean} [opts.disabled] explicit kill-switch (default false)
   */
  constructor(opts = {}) {
    this.audit         = typeof opts.audit === 'function' ? opts.audit : null;
    this.postTelegram  = typeof opts.postTelegram === 'function' ? opts.postTelegram : null;
    this.baseUrl       = String(opts.baseUrl || 'https://ats.rajasekarselvam.com').replace(/\/$/, '');
    this.ttlMs         = Number.isFinite(opts.ttlMs) ? opts.ttlMs : 5 * 60_000;
    this.disabled      = Boolean(opts.disabled);
    this._confirmed    = new Map();    // dayKey -> Set of `userId|strategyTag`
    this._pending      = new Map();    // token  -> { dayKey, userId, strategyTag, payload, exp }
  }

  /** Whether this {user, strategy} pair needs to confirm today. */
  shouldChallenge({ userId, strategyTag }) {
    if (this.disabled) return false;
    if (!this.postTelegram) return false;
    const dayKey = istDayKey();
    const set = this._confirmed.get(dayKey);
    if (set && set.has(`${userId}|${strategyTag}`)) return false;
    return true;
  }

  /** Issue a token + send Telegram. Resolves with { token, sent }. */
  async issue({ userId, strategyTag, payload }) {
    const token = crypto.randomBytes(16).toString('hex');
    const dayKey = istDayKey();
    const exp = Date.now() + this.ttlMs;
    this._pending.set(token, { dayKey, userId, strategyTag, payload, exp });

    const confirmUrl = `${this.baseUrl}/api/orders/confirm-2fa/${token}`;
    const msg = this._formatTelegram({ payload, confirmUrl, strategyTag, exp });

    let sent = false;
    if (this.postTelegram) {
      try { const r = await this.postTelegram(msg); sent = Boolean(r && r.sent); }
      catch (_e) { sent = false; }
    }

    if (this.audit) {
      try { this.audit('order.2fa.issued', { token, userId, strategyTag, symbol: payload && payload.symbol, sent }); }
      catch (_) {}
    }
    return { token, sent };
  }

  /** Consume a token. Returns {ok, payload} or {ok:false, reason}. */
  consume(token) {
    const e = this._pending.get(token);
    if (!e) {
      if (this.audit) { try { this.audit('order.2fa.consumeMiss', { token }); } catch (e) { console.warn('[two-factor] swallowed:', e && e.message); } }
      return { ok: false, reason: 'unknown_or_used' };
    }
    if (Date.now() > e.exp) {
      this._pending.delete(token);
      if (this.audit) { try { this.audit('order.2fa.expired', { token, userId: e.userId }); } catch (e) { console.warn('[two-factor] swallowed:', e && e.message); } }
      return { ok: false, reason: 'expired' };
    }
    // Consume + mark today's pair confirmed
    this._pending.delete(token);
    const set = this._confirmed.get(e.dayKey) || new Set();
    set.add(`${e.userId}|${e.strategyTag}`);
    this._confirmed.set(e.dayKey, set);

    if (this.audit) {
      try { this.audit('order.2fa.confirmed', { token, userId: e.userId, strategyTag: e.strategyTag }); }
      catch (_) {}
    }
    return { ok: true, payload: e.payload };
  }

  /** Mark a {user, strategy} pair as confirmed for today (e.g. for re-use). */
  markConfirmed({ userId, strategyTag }) {
    const dayKey = istDayKey();
    const set = this._confirmed.get(dayKey) || new Set();
    set.add(`${userId}|${strategyTag}`);
    this._confirmed.set(dayKey, set);
  }

  stats() {
    return {
      disabled: this.disabled,
      hasTelegram: Boolean(this.postTelegram),
      pendingCount: this._pending.size,
      confirmedDays: this._confirmed.size,
      confirmedTodayCount: (this._confirmed.get(istDayKey()) || new Set()).size,
    };
  }

  /** Reject a pending token (the order is discarded). */
  reject(token) {
    const e = this._pending.get(token);
    if (!e) {
      if (this.audit) { try { this.audit('order.2fa.rejectMiss', { token }); } catch (e) { console.warn('[two-factor] swallowed:', e && e.message); } }
      return { ok: false, reason: 'unknown_or_used' };
    }
    this._pending.delete(token);
    if (this.audit) {
      try { this.audit('order.2fa.rejected', { token, userId: e.userId, strategyTag: e.strategyTag, symbol: e.payload && e.payload.symbol }); }
      catch (_) {}
    }
    return { ok: true, rejected: true, payload: e.payload };
  }

    _formatTelegram({ payload, confirmUrl, strategyTag, exp }) {
    const p = payload || {};
    const lines = [
      '🛡️ *First order of the day -- confirm to proceed*',
      '',
      `*Strategy:* \`${strategyTag || '?'}\``,
      `*Symbol:*   \`${p.symbol || '?'}\``,
      `*Side:*     \`${p.side || '?'}\``,
      `*Qty:*      \`${p.quantity || '?'}\``,
      `*Product:*  \`${p.product || '?'}\``,
      `*Type:*     \`${p.orderType || '?'}\``,
    ];
    if (p.price)        lines.push(`*Price:*    \`${p.price}\``);
    if (p.triggerPrice) lines.push(`*Trigger:*  \`${p.triggerPrice}\``);
    if (p.algoId)       lines.push(`*Algo ID:*  \`${p.algoId}\``);
    const secs = Math.max(0, Math.round((exp - Date.now()) / 1000));
    const cancelUrl = confirmUrl.replace('/confirm-2fa/', '/cancel-2fa/');
    lines.push('', `*Confirm* (expires in ${secs}s):`, confirmUrl, '', '*Cancel:*', cancelUrl);
    return lines.join('\n');
  }
}

module.exports = { TwoFactor, istDayKey };
