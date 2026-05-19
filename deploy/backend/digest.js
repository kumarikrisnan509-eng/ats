// digest.js -- Tier 47: daily/weekly digest email.
//
// Builds an HTML summary email of recent activity and ships it through
// the existing Tier 27 EmailAlerts module (Resend/Brevo HTTP). Designed
// to be invoked from cron (or the /api/digest/send endpoint) at:
//   - 18:00 IST daily for trading-day recap
//   - Sunday 09:00 IST for weekly summary
//
// Pulls data from already-running components -- no new state. Public API:
//   const d = new Digest({ paper, pnl, autorun, wormAudit, news, ... });
//   const out = await d.send({ to, kind: 'daily' | 'weekly' });

'use strict';

function fmtINR(n) {
  if (!Number.isFinite(n)) return '—';
  return '₹' + Math.round(n).toLocaleString('en-IN');
}
function fmtPct(n, decimals) {
  if (!Number.isFinite(n)) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(decimals != null ? decimals : 2) + '%';
}
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

class Digest {
  constructor(opts = {}) {
    this.paper      = opts.paper      || null;
    this.pnl        = opts.pnl        || null;
    this.autorun    = opts.autorun    || null;
    this.wormAudit  = opts.wormAudit  || null;
    this.news       = opts.news       || null;
    this.emailAlerts= opts.emailAlerts|| null;   // Tier 27
    this.audit      = typeof opts.audit === 'function' ? opts.audit : null;
  }

  /** Build the HTML body for a given kind. Pure: no I/O. */
  build({ kind }) {
    const k = kind === 'weekly' ? 'weekly' : 'daily';
    const now = new Date();
    const title = k === 'weekly' ? `ATS weekly digest -- ${now.toISOString().slice(0,10)}`
                                 : `ATS daily digest -- ${now.toISOString().slice(0,10)}`;

    const paperStats = this.paper && typeof this.paper.stats === 'function' ? (this.paper.stats() || {}) : {};
    const pnlRows    = this.pnl   && typeof this.pnl.recent === 'function' ? (this.pnl.recent(k === 'weekly' ? 7 : 1) || []) : [];

    let autorunHistory = [];
    try {
      if (this.autorun && typeof this.autorun.state === 'function') autorunHistory = (this.autorun.state().history || []).slice(-50);
      else if (this.autorun && this.autorun.history) autorunHistory = this.autorun.history.slice(-50);
    } catch (e) { console.warn('[digest] swallowed:', e && e.message); }

    let wormState = {};
    try { if (this.wormAudit && typeof this.wormAudit.root === 'function') wormState = this.wormAudit.root(); } catch (e) { console.warn('[digest] swallowed:', e && e.message); }

    let newsTop = [];
    try {
      if (this.news && typeof this.news.top === 'function') newsTop = this.news.top(8) || [];
      else if (this.news && this.news.items) newsTop = this.news.items.slice(-8);
    } catch (e) { console.warn('[digest] swallowed:', e && e.message); }

    const totalPnl = paperStats.totalEquity != null && paperStats.cash != null
      ? (paperStats.realizedPnl || 0) + (paperStats.unrealizedPnl || 0)
      : null;

    const body = `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
body { font: 14px/1.5 -apple-system, system-ui, sans-serif; color: #1f2937; max-width: 720px; margin: 0 auto; padding: 24px; }
h1   { font-size: 22px; border-bottom: 2px solid #2563eb; padding-bottom: 8px; }
h2   { font-size: 16px; color: #2563eb; margin-top: 24px; }
.card{ background: #f9fafb; padding: 12px 14px; border-radius: 6px; margin: 8px 0; }
.kv  { display: inline-block; margin-right: 18px; font-size: 13px; }
.kv .k { color: #6b7280; }
.kv .v { font-family: 'JetBrains Mono', Consolas, monospace; font-weight: 600; }
table{ width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 6px; }
th,td{ padding: 4px 8px; text-align: left; border-bottom: 1px solid #e5e7eb; }
th   { background: #f3f4f6; }
.up  { color: #16a34a; }
.dn  { color: #dc2626; }
.muted{ color: #6b7280; font-size: 12px; }
.foot{ margin-top: 32px; padding-top: 12px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 11px; }
</style></head><body>
<h1>${esc(title)}</h1>
<p class="muted">Generated at ${esc(now.toISOString())}.</p>

<h2>Paper trading</h2>
<div class="card">
  <span class="kv"><span class="k">Cash</span> <span class="v">${fmtINR(paperStats.cash)}</span></span>
  <span class="kv"><span class="k">Equity</span> <span class="v">${fmtINR(paperStats.totalEquity)}</span></span>
  <span class="kv"><span class="k">Realized P&amp;L</span> <span class="v ${paperStats.realizedPnl >= 0 ? 'up' : 'dn'}">${fmtINR(paperStats.realizedPnl)}</span></span>
  <span class="kv"><span class="k">Unrealized P&amp;L</span> <span class="v ${paperStats.unrealizedPnl >= 0 ? 'up' : 'dn'}">${fmtINR(paperStats.unrealizedPnl)}</span></span>
  <span class="kv"><span class="k">Open positions</span> <span class="v">${esc(paperStats.openPositions != null ? paperStats.openPositions : '—')}</span></span>
</div>

${pnlRows.length > 0 ? `<h2>Daily P&amp;L (${k === 'weekly' ? 'last 7 days' : 'today'})</h2>
<table><thead><tr><th>Date</th><th>Realized</th><th>Unrealized</th><th>Equity</th></tr></thead>
<tbody>${pnlRows.map(r => `<tr>
  <td>${esc(r.date || r.d || '')}</td>
  <td class="${(r.realizedPnl || 0) >= 0 ? 'up' : 'dn'}">${fmtINR(r.realizedPnl)}</td>
  <td class="${(r.unrealizedPnl || 0) >= 0 ? 'up' : 'dn'}">${fmtINR(r.unrealizedPnl)}</td>
  <td>${fmtINR(r.equity)}</td>
</tr>`).join('')}</tbody></table>` : ''}

${autorunHistory.length > 0 ? `<h2>Auto-runner activity (last ${Math.min(autorunHistory.length, 20)})</h2>
<table><thead><tr><th>ts</th><th>strategy</th><th>symbol</th><th>signal</th><th>action</th></tr></thead>
<tbody>${autorunHistory.slice(-20).reverse().map(h => `<tr>
  <td class="muted">${esc(String(h.ts || h.t || '').slice(0, 19))}</td>
  <td>${esc(h.strategy || '—')}</td>
  <td>${esc(h.symbol || '—')}</td>
  <td>${esc(h.signal || '—')}</td>
  <td>${esc(h.action || h.status || '—')}</td>
</tr>`).join('')}</tbody></table>` : ''}

${wormState && wormState.count != null ? `<h2>Audit log (WORM)</h2>
<div class="card">
  <span class="kv"><span class="k">Total entries</span> <span class="v">${esc(wormState.count)}</span></span>
  <span class="kv"><span class="k">Head seq</span> <span class="v">${esc(wormState.headSeq)}</span></span>
  <span class="kv"><span class="k">Merkle root</span> <span class="v" style="font-size: 11px">${esc((wormState.merkleRoot || '').slice(0, 16))}…${esc((wormState.merkleRoot || '').slice(-8))}</span></span>
</div>` : ''}

${newsTop.length > 0 ? `<h2>Top news (${newsTop.length})</h2>
<ul style="font-size: 12px; padding-left: 18px;">${newsTop.map(n => `<li>
  <a href="${esc(n.link || n.url || '#')}">${esc(n.title || n.headline || '(untitled)')}</a>
  ${n.source ? `<span class="muted"> -- ${esc(n.source)}</span>` : ''}
</li>`).join('')}</ul>` : ''}

<p class="foot">
  Sent by ATS @ ats.rajasekarselvam.com. To opt out, unset DIGEST_TO in /etc/ats/backend.env.<br>
  Audit Merkle root above is also written into the WORM chain on send, so this email is itself part of the tamper-evident audit.
</p>
</body></html>`;

    const text = `${title}
Paper: cash=${fmtINR(paperStats.cash)}  equity=${fmtINR(paperStats.totalEquity)}  realized=${fmtINR(paperStats.realizedPnl)}  unrealized=${fmtINR(paperStats.unrealizedPnl)}
Open positions: ${paperStats.openPositions != null ? paperStats.openPositions : '—'}
Autorun runs in window: ${autorunHistory.length}
WORM: ${wormState.count != null ? wormState.count + ' entries, head ' + (wormState.headSeq || '?') : 'unavailable'}`;

    return { subject: title, html: body, text };
  }

  /** Build + send via the Tier 27 EmailAlerts module. */
  async send({ to, kind }) {
    if (!this.emailAlerts || typeof this.emailAlerts.send !== 'function') {
      return { ok: false, reason: 'emailAlerts not configured' };
    }
    const target = to || process.env.DIGEST_TO || '';
    if (!target) return { ok: false, reason: 'no recipient (set DIGEST_TO env or pass to)' };
    const { subject, html, text } = this.build({ kind });
    const r = await this.emailAlerts.send({ to: target, subject, text, html });
    if (this.audit) {
      try { this.audit('digest.sent', { kind, to: target, ok: r && r.ok }); } catch (e) { console.warn('[digest] swallowed:', e && e.message); }
    }
    return r;
  }
}

module.exports = { Digest };
