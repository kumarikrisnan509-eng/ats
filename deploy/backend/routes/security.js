// security.js -- T-400 (architecture audit #1, server.js god-object split #17).
//
// Three read-only security/compliance UI endpoints:
//   - GET /api/security/ip-allowlist   -- current state of the Tier 35 IP gate
//   - GET /api/security/my-ip          -- echo the IP nginx sees for the caller
//                                         (so users can paste it into the env
//                                         allowlist on first connect)
//   - GET /api/security/two-factor     -- Tier 38 2FA stats for the panel
//
// Public API
// ==========
//   const { mountSecurityRoutes } = require('./routes/security');
//   mountSecurityRoutes(app, { getIpAllowlist, getTwoFactor });

'use strict';

function mountSecurityRoutes(app, deps) {
  const { getIpAllowlist, getTwoFactor } = deps;
  if (typeof getIpAllowlist !== 'function') throw new Error('security: getIpAllowlist getter required');
  if (typeof getTwoFactor   !== 'function') throw new Error('security: getTwoFactor getter required');

  // Tier 35: IP allowlist state (for the Brokers/Compliance UI)
  app.get('/api/security/ip-allowlist', (_req, res) => {
    const ipAllowlist = getIpAllowlist();
    if (!ipAllowlist || typeof ipAllowlist.state !== 'function') {
      return res.status(503).json({ ok: false, reason: 'ip_allowlist_not_initialized' });
    }
    res.json({ ok: true, ...ipAllowlist.state() });
  });

  // Tier 37: echo the IP the server sees for this client.
  // Mirrors what nginx puts in X-Real-IP / X-Forwarded-For. Used by the
  // first-time-setup UI: caller hits this, then pastes the result into
  // API_IP_WHITELIST.
  app.get('/api/security/my-ip', (req, res) => {
    const xrip = req.headers['x-real-ip'];
    const xff  = req.headers['x-forwarded-for'];
    let ip = (typeof xrip === 'string' && xrip.trim())
          || (typeof xff  === 'string' && xff.split(',')[0].trim())
          || (req.socket && req.socket.remoteAddress)
          || '';
    if (typeof ip === 'string' && ip.startsWith('::ffff:')) ip = ip.slice(7);
    res.json({ ok: true, ip, source: xrip ? 'x-real-ip' : (xff ? 'x-forwarded-for' : 'socket') });
  });

  // Tier 38: status endpoint for the Compliance 2FA panel.
  app.get('/api/security/two-factor', (_req, res) => {
    const twoFactor = getTwoFactor();
    if (!twoFactor) return res.status(503).json({ ok: false, reason: 'two_factor_not_initialized' });
    res.json({ ok: true, ...twoFactor.stats() });
  });
}

module.exports = { mountSecurityRoutes };
