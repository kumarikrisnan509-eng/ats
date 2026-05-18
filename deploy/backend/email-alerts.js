// email-alerts.js -- Tier 27: opt-in SMTP email alerts.
//
// Spec §0: "Alerts via Telegram, email, in-app, WhatsApp". Telegram is already
// wired in notify.js. This module adds email as a parallel channel.
//
// Three transport modes:
//   1. HTTP API: Resend or Brevo (token-only, simplest; preferred when offered)
//   2. SMTP (T-165): Hostinger, Gmail, any real SMTP server (nodemailer)
//   3. none: disabled (returns ok:false reason:'disabled')
//
// Config (all via env, NEVER committed):
//   EMAIL_PROVIDER=smtp        ('smtp' | 'resend' | 'brevo' | 'none')
//   EMAIL_FROM=support@rajasekarselvam.com
//   EMAIL_TO=user@example.com  (default recipient; can override per call)
//
//   --- if EMAIL_PROVIDER=resend or brevo ---
//   EMAIL_API_KEY=<token>
//
//   --- if EMAIL_PROVIDER=smtp (T-165) ---
//   SMTP_HOST=smtp.hostinger.com
//   SMTP_PORT=465            (465 = SSL, 587 = STARTTLS)
//   SMTP_USER=support@rajasekarselvam.com   (full email, not just username)
//   SMTP_PASS=<set in /etc/ats/backend.env on the VM — never commit>
//
// Auth never appears in git: backend.env is operator-managed on the VM,
// outside the repo. The container reads it via docker-compose env_file.

class EmailAlerts {
  constructor({ audit } = {}) {
    this.provider = (process.env.EMAIL_PROVIDER || 'none').toLowerCase();
    this.apiKey   = process.env.EMAIL_API_KEY || '';
    this.from     = process.env.EMAIL_FROM    || 'alerts@ats.local';
    this.to       = process.env.EMAIL_TO      || '';
    // T-165: SMTP transport (Hostinger / Gmail / generic). Lazy-loaded.
    this.smtp = {
      host: process.env.SMTP_HOST || '',
      port: parseInt(process.env.SMTP_PORT || '465', 10),
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || '',
    };
    this._transporter = null;   // nodemailer transport, created on first send
    this.audit    = audit || (() => {});
    this._sentToday = 0;
    this._resetAt   = this._tomorrowMs();
    this._maxDaily  = parseInt(process.env.EMAIL_DAILY_CAP || '100', 10);
  }

  enabled() {
    if (this.provider === 'smtp') {
      return !!(this.smtp.host && this.smtp.user && this.smtp.pass);
    }
    return this.provider !== 'none' && !!this.apiKey;
  }

  status() {
    return {
      enabled: this.enabled(),
      provider: this.provider,
      from: this.from,
      to: this.to,
      // T-165: SMTP config (NEVER include pass)
      smtp: this.provider === 'smtp' ? {
        host: this.smtp.host,
        port: this.smtp.port,
        user: this.smtp.user,
        passConfigured: !!this.smtp.pass,
      } : null,
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
      if (this.provider === 'smtp') {
        // T-165: lazy-require nodemailer so deployments that don't use SMTP
        // don't pay the dep cost. Fail soft if not installed.
        if (!this._transporter) {
          let nodemailer;
          try { nodemailer = require('nodemailer'); }
          catch (_) {
            this.audit('email.send.error', { provider: 'smtp', reason: 'nodemailer_not_installed' });
            return { ok: false, reason: 'nodemailer_not_installed', detail: 'run: cd deploy/backend && npm install nodemailer' };
          }
          this._transporter = nodemailer.createTransport({
            host: this.smtp.host,
            port: this.smtp.port,
            secure: this.smtp.port === 465,   // SSL on 465; STARTTLS on 587
            auth: { user: this.smtp.user, pass: this.smtp.pass },
          });
        }
        const info = await this._transporter.sendMail({
          from: this.from,
          to: recipient,
          subject,
          text,
          html: `<pre style="font-family:monospace">${this._esc(text)}</pre>`,
        });
        this._sentToday++;
        this.audit('email.sent', { provider: 'smtp', to: recipient, subject, id: info.messageId });
        return { ok: true, id: info.messageId, provider: 'smtp' };
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
