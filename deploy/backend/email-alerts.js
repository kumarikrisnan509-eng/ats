// email-alerts.js -- Tier 27: opt-in SMTP email alerts.
//
// Spec §0: "Alerts via Telegram, email, in-app, WhatsApp". Telegram is already
// wired in notify.js. This module adds email as a parallel channel.
//
// We use Node's built-in HTTP-based providers via fetch (no nodemailer dep).
// Two modes:
//   1. SMTP via Brevo/Mailjet/Resend HTTP API (preferred -- token-only, no SMTP creds).
//   2. SMTP via direct TCP (deferred to a later tier if needed; HTTP path covers most).
//
// Config (all via env):
//   EMAIL_PROVIDER=resend      ('resend' | 'brevo' | 'none')
//   EMAIL_API_KEY=<token>
//   EMAIL_FROM=alerts@ats.local
//   EMAIL_TO=user@example.com  (default recipient; can override per call)
//
// If EMAIL_API_KEY is unset, send() returns ok:false reason:'disabled'.

class EmailAlerts {
  constructor({ audit } = {}) {
    this.provider = (process.env.EMAIL_PROVIDER || 'none').toLowerCase();
    this.apiKey   = process.env.EMAIL_API_KEY || '';
    this.from     = process.env.EMAIL_FROM    || 'alerts@ats.local';
    this.to       = process.env.EMAIL_TO      || '';
    this.audit    = audit || (() => {});
    this._sentToday = 0;
    this._resetAt   = this._tomorrowMs();
    this._maxDaily  = parseInt(process.env.EMAIL_DAILY_CAP || '100', 10);
  }

  enabled() {
    return this.provider !== 'none' && !!this.apiKey;
  }

  status() {
    return {
      enabled: this.enabled(),
      provider: this.provider,
      from: this.from,
      to: this.to,
      sentToday: this._sentToday,
      dailyCap: this._maxDaily,
      dailyResetAt: new Date(this._resetAt).toISOString(),
    };
  }

  _tomorrowMs() {
    const d = new Date();
    d.setUTCHours(24, 0, 0, 0);
    return d.getTime();
  }

  /**
   * @param {object} arg
   * @param {string} [arg.to]      override recipient
   * @param {string} arg.subject
   * @param {string} arg.text      plain-text body (HTML is auto-wrapped)
   */
  async send({ to, subject, text }) {
    if (!this.enabled()) return { ok: false, reason: 'disabled' };
    if (Date.now() > this._resetAt) { this._sentToday = 0; this._resetAt = this._tomorrowMs(); }
    if (this._sentToday >= this._maxDaily) return { ok: false, reason: 'daily_cap_reached' };
    const recipient = String(to || this.to || '').trim();
    if (!recipient) return { ok: false, reason: 'no_recipient' };
    if (!subject || !text) return { ok: false, reason: 'subject_and_text_required' };

    try {
      if (this.provider === 'resend') {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type':  'application/json',
          },
          body: JSON.stringify({
            from: this.from,
            to: [recipient],
            subject,
            text,
            html: `<pre style="font-family:monospace">${this._esc(text)}</pre>`,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          this.audit('email.send.error', { provider: 'resend', status: res.status, error: body });
          return { ok: false, reason: `resend_${res.status}`, detail: body };
        }
        this._sentToday++;
        this.audit('email.sent', { provider: 'resend', to: recipient, subject, id: body.id });
        return { ok: true, id: body.id, provider: 'resend' };
      }
      if (this.provider === 'brevo') {
        const res = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            'api-key':       this.apiKey,
            'Content-Type':  'application/json',
          },
          body: JSON.stringify({
            sender: { email: this.from, name: 'ATS Alerts' },
            to: [{ email: recipient }],
            subject,
            textContent: text,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          this.audit('email.send.error', { provider: 'brevo', status: res.status, error: body });
          return { ok: false, reason: `brevo_${res.status}`, detail: body };
        }
        this._sentToday++;
        this.audit('email.sent', { provider: 'brevo', to: recipient, subject, id: body.messageId });
        return { ok: true, id: body.messageId, provider: 'brevo' };
      }
      return { ok: false, reason: 'unknown_provider' };
    } catch (e) {
      this.audit('email.send.exception', { error: e.message });
      return { ok: false, reason: e.message };
    }
  }

  _esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}

module.exports = { EmailAlerts };
