// preflight.js -- going-live readiness checklist.
//
// Returns an array of checks, each with { id, name, severity, ok, detail }.
// A "blocker" failing prevents going live. "warn" items are advisory.
// Call from GET /api/preflight to surface the current state.

function check(id, name, severity, ok, detail) {
  return { id, name, severity, ok: !!ok, detail: String(detail || '') };
}

/**
 * @param {object} ctx
 * @param {object} ctx.broker            broker instance
 * @param {object} ctx.paper             PaperTrading instance
 * @param {object} ctx.pnl               PnlAttribution instance
 * @param {Function} ctx.getReconcile    async () => latest reconcile result
 * @param {object} ctx.env               process.env snapshot
 * @returns {Promise<{ok: boolean, checks: Array, summary: string}>}
 */
async function runPreflight(ctx) {
  const out = [];
  const env = ctx.env || {};

  // Broker connectivity
  const bh = ctx.broker && ctx.broker.health && ctx.broker.health();
  out.push(check('broker.connected', 'Broker connected to live ticks', 'blocker',
    bh && bh.connected, bh ? `name=${bh.name} connected=${bh.connected}` : 'no broker'));
  out.push(check('broker.access_token', 'Broker access token present', 'blocker',
    bh && bh.hasAccessToken, bh && bh.hasAccessToken ? 'token rehydrated' : 'no token -- login needed'));

  // Kill switch -- INFORMATIONAL not blocker; the user explicitly flips it
  out.push(check('killSwitch.armed', 'KILL_SWITCH=true (paper-only mode)', 'info',
    String(env.KILL_SWITCH || 'true').toLowerCase() === 'true',
    `KILL_SWITCH=${env.KILL_SWITCH}`));

  // Paper trading sanity
  if (ctx.paper) {
    const s = ctx.paper.stats();
    out.push(check('paper.has_history', 'Paper trading has filled orders', 'warn',
      s.filledOrders > 0, `filledOrders=${s.filledOrders} closedTrades=${s.closedTrades}`));
    out.push(check('paper.profitable_or_neutral', 'Paper realized P&L is not deeply negative', 'warn',
      s.realizedPnl >= -1000, `realizedPnl=INR ${s.realizedPnl}`));
  }

  // P&L daily snapshots
  if (ctx.pnl) {
    const pst = ctx.pnl.stats();
    out.push(check('pnl.has_snapshots', 'P&L attribution has snapshots', 'warn',
      pst.rows > 0, `rows=${pst.rows} oldest=${pst.oldest}`));
  }

  // Master key + secrets
  out.push(check('master_key.present', 'Master key file readable', 'blocker',
    !!env.MASTER_KEY_PATH, `MASTER_KEY_PATH=${env.MASTER_KEY_PATH || 'unset'}`));
  out.push(check('telegram.configured', 'Telegram notifications wired', 'warn',
    !!env.TELEGRAM_BOT_TOKEN && !!env.TELEGRAM_CHAT_ID, 'for alerts on fills/errors'));

  // Reconciliation snapshot
  if (ctx.getReconcile) {
    try {
      const r = await ctx.getReconcile();
      out.push(check('reconcile.cash_drift_acceptable',
        'Cash drift between paper and broker is within tolerance',
        'warn',
        r && r.summary && Math.abs(r.summary.cashDrift || 0) < 100000,
        `cashDrift=INR ${r && r.summary && r.summary.cashDrift}`));
      out.push(check('reconcile.no_unexpected_broker_orders',
        'Broker has no pending orders the backend did not initiate',
        'blocker',
        r && r.summary && r.summary.brokerPendingCnt === r.summary.paperPendingCnt,
        `brokerPending=${r && r.summary && r.summary.brokerPendingCnt} paperPending=${r && r.summary && r.summary.paperPendingCnt}`));
    } catch (e) {
      out.push(check('reconcile.callable', 'Reconcile endpoint callable', 'blocker', false, e.message));
    }
  }

  // Process env basics
  out.push(check('env.production', 'ENV_NAME=prod', 'info',
    env.ENV_NAME === 'prod', `ENV_NAME=${env.ENV_NAME}`));
  out.push(check('env.ops_key', 'ATS_OPS_KEY set (mutations gated)', 'warn',
    !!env.ATS_OPS_KEY, 'if unset, /api/audit + mutations are open to internal IPs only'));
  out.push(check('env.metrics_token', 'ATS_METRICS_TOKEN set', 'warn',
    !!env.ATS_METRICS_TOKEN, '/metrics is loopback-only without it'));

  // Audit log healthy (we can't check actual size from here -- rely on /api/system/info's auditLog block)

  const blockers = out.filter(c => c.severity === 'blocker' && !c.ok);
  const warns    = out.filter(c => c.severity === 'warn'    && !c.ok);
  const ok       = blockers.length === 0;
  const summary  = ok
    ? (warns.length === 0 ? 'all green' : `${warns.length} warning(s), no blockers -- safe to go live`)
    : `${blockers.length} BLOCKER(s) -- DO NOT flip KILL_SWITCH`;

  return { ok, summary, checks: out, blockers: blockers.length, warns: warns.length, total: out.length };
}

module.exports = { runPreflight };
