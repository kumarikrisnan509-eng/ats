// whatsapp-alerts.js -- Tier 28: opt-in WhatsApp alerts via Twilio HTTP API.
//
// Spec §0: "Alerts via Telegram, email, in-app, WhatsApp". This closes the last
// alerting channel.
//
// Config (env):
//   WHATSAPP_PROVIDER=twilio       ('twilio' | 'none')
//   WHATSAPP_ACCOUNT_SID=<sid>
//   WHATSAPP_AUTH_TOKEN=<token>
//   WHATSAPP_FROM=whatsapp:+14155238886   (Twilio sandbox by default)
//   WHATSAPP_TO=whatsapp:+91...           (default recipient)
//
// Twilio's sandbox is free for dev. Production needs a registered WhatsApp Business sender.

class WhatsAppAlerts {
  constructor({ audit } = {}) {
    this.provider = (process.env.WHATSAPP_PROVIDER || 'none').toLowerCase();
    this.sid      = process.env.WHATSAPP_ACCOUNT_SID || '';
    this.token    = process.env.WHATSAPP_AUTH_TOKEN  || '';
    this.from     = process.env.WHATSAPP_FROM        || '';
    this.to       = process.env.WHATSAPP_TO          || '';
    this.audit    = audit || (() => {});
    this._sentToday = 0;
    this._resetAt   = this._tomorrowMs();
    this._maxDaily  = parseInt(process.env.WHATSAPP_DAILY_CAP || '50', 10);
  }

  enabled() {
    return this.provider === 'twilio' && this.sid && this.token && this.from;
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

  async send({ to, body }) {
    if (!this.enabled()) return { ok: false, reason: 'disabled' };
    if (Date.now() > this._resetAt) { this._sentToday = 0; this._resetAt = this._tomorrowMs(); }
    if (this._sentToday >= this._maxDaily) return { ok: false, reason: 'daily_cap_reached' };
    const recipient = String(to || this.to || '').trim();
    if (!recipient) return { ok: false, reason: 'no_recipient' };
    if (!body) return { ok: false, reason: 'body_required' };
    // Twilio expects whatsapp:+<E.164>
    const normRecipient = recipient.startsWith('whatsapp:') ? recipient : `whatsapp:${recipient}`;
    const normFrom      = this.from.startsWith('whatsapp:')      ? this.from      : `whatsapp:${this.from}`;

    try {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${this.sid}/Messages.json`;
      const params = new URLSearchParams();
      params.append('From', normFrom);
      params.append('To',   normRecipient);
      params.append('Body', String(body).slice(0, 1600));
      const auth = Buffer.from(`${this.sid}:${this.token}`).toString('base64');
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type':  'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });
      const respBody = await res.json().catch(() => ({}));
      if (!res.ok) {
        this.audit('whatsapp.send.error', { status: res.status, error: respBody });
        return { ok: false, reason: `twilio_${res.status}`, detail: respBody };
      }
      this._sentToday++;
      this.audit('whatsapp.sent', { to: recipient, sid: respBody.sid, status: respBody.status });
      return { ok: true, sid: respBody.sid, status: respBody.status };
    } catch (e) {
      this.audit('whatsapp.send.exception', { error: e.message });
      return { ok: false, reason: e.message };
    }
  }
}

module.exports = { WhatsAppAlerts };
