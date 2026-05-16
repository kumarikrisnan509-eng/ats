// ip-allowlist.js -- Tier 35: static IP allowlist middleware.
//
// SEBI 1 April 2026 algo framework, §"Access control":
//   "Every retail algo trading platform shall restrict access to its
//    order-placement and account-management endpoints to a pre-registered
//    set of IP addresses or CIDR ranges declared by the user during
//    onboarding."
//
// This module implements that as Express middleware. Off by default so the
// existing setup keeps working until you opt in via env.
//
// Env contract:
//   API_IP_WHITELIST          -- comma-separated list. Empty/unset = disabled.
//                                Examples:
//                                  '192.0.2.1'
//                                  '203.0.113.0/24,198.51.100.5,2001:db8::/32'
//   API_IP_WHITELIST_MODE     -- 'enforce' (default if WHITELIST set) | 'audit'.
//                                'audit' logs blocks but doesn't actually block.
//                                Useful for safe rollout: run audit-only for a
//                                week, check that your real IP isn't getting
//                                false-positive flagged, then flip to enforce.
//   API_IP_WHITELIST_BYPASS   -- comma-separated path prefixes always allowed.
//                                Default: '/api/health,/api/brokers/zerodha/callback,/api/status'
//                                (health for uptime monitors, Kite OAuth callback
//                                redirected from kite.zerodha.com).
//
// Public API:
//   const { buildIpAllowlist } = require('./ip-allowlist');
//   const mw = buildIpAllowlist({ audit });
//   app.use(mw);   // applies to all routes that come after
//
// IPv6 support: only direct string match (no CIDR for v6). If you need v6 CIDR
// pass each /128 explicitly. ~99% of retail Indian residential connections are
// v4-only (ISPs use CGNAT), so this is rarely a real constraint.

'use strict';

// --- IP matching primitives ------------------------------------------------

function ipv4ToInt(ip) {
  const parts = String(ip).split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = (n * 256) + v;
  }
  // JS bitwise ops are signed-32; this stays a regular Number unsigned in [0, 2^32).
  return n;
}

/**
 * @param {string} entry -- single IP or CIDR (e.g. '192.0.2.0/24')
 * @returns {(ip:string)=>boolean} matcher, or null if entry invalid
 */
function compileEntry(entry) {
  const s = String(entry || '').trim();
  if (!s) return null;
  if (!s.includes('/')) {
    // Single IP -- exact string match (handles v4 and v6 alike).
    return (ip) => ip === s;
  }
  const [base, bitsStr] = s.split('/');
  const bits = Number(bitsStr);
  if (!Number.isInteger(bits) || bits < 0) return null;
  // IPv4 path
  const baseInt = ipv4ToInt(base);
  if (baseInt != null && bits <= 32) {
    if (bits === 0) return () => true;
    const mask = (0xFFFFFFFF << (32 - bits)) >>> 0;   // unsigned mask
    const network = (baseInt & mask) >>> 0;
    return (ip) => {
      const ipInt = ipv4ToInt(ip);
      if (ipInt == null) return false;
      return ((ipInt & mask) >>> 0) === network;
    };
  }
  // IPv6 CIDR not supported -- fall through to invalid
  return null;
}

/** Parse a comma-separated allowlist string into an array of matchers. */
function compileAllowlist(spec) {
  const matchers = [];
  for (const entry of String(spec || '').split(',')) {
    const m = compileEntry(entry);
    if (m) matchers.push({ entry: entry.trim(), match: m });
  }
  return matchers;
}

/** Extract the real client IP from the request, trusting nginx-set headers. */
function clientIp(req) {
  const xrip = req.headers['x-real-ip'];
  if (xrip && typeof xrip === 'string') return xrip.trim();
  const xff = req.headers['x-forwarded-for'];
  if (xff && typeof xff === 'string') {
    // First hop is the real client; nginx adds itself + intermediate proxies.
    return xff.split(',')[0].trim();
  }
  // Fallback: direct socket peer (only reliable in dev / direct-to-Node).
  const ra = req.socket && req.socket.remoteAddress;
  if (!ra) return null;
  // Strip IPv4-mapped IPv6 prefix ('::ffff:1.2.3.4') -> '1.2.3.4'.
  return ra.startsWith('::ffff:') ? ra.slice(7) : ra;
}

// --- Middleware factory ----------------------------------------------------

/**
 * @param {object} [opts]
 * @param {(event:string,data:object)=>void} [opts.audit]  -- audit hook
 * @param {string} [opts.whitelist]   -- override env API_IP_WHITELIST
 * @param {string} [opts.mode]        -- 'enforce' | 'audit', override env
 * @param {string} [opts.bypass]      -- comma-separated path prefixes
 * @returns {(req,res,next)=>void} Express middleware
 */
function buildIpAllowlist(opts = {}) {
  const spec   = opts.whitelist != null ? opts.whitelist : (process.env.API_IP_WHITELIST || '');
  const mode   = opts.mode      != null ? opts.mode      : (process.env.API_IP_WHITELIST_MODE || 'enforce');
  const bypass = opts.bypass    != null ? opts.bypass    : (process.env.API_IP_WHITELIST_BYPASS || '/api/health,/api/brokers/zerodha/callback,/api/status');
  const audit  = typeof opts.audit === 'function' ? opts.audit : null;

  const matchers      = compileAllowlist(spec);
  const bypassPrefixes = String(bypass).split(',').map(s => s.trim()).filter(Boolean);
  const enabled       = matchers.length > 0;
  const enforcing     = enabled && mode !== 'audit';

  const mw = (req, res, next) => {
    if (!enabled) return next();

    // Bypass: matches any configured prefix.
    for (const p of bypassPrefixes) {
      if (req.path === p || req.path.startsWith(p + '/') || req.path.startsWith(p + '?')) {
        return next();
      }
    }

    const ip = clientIp(req);
    const allowed = ip ? matchers.some(m => m.match(ip)) : false;

    if (allowed) return next();

    // Blocked
    if (audit) {
      try { audit('api.block.ip', { ip, path: req.path, method: req.method, mode }); }
      catch (_) {}
    }
    if (!enforcing) {
      // 'audit' mode: log only, let the request through.
      return next();
    }
    res.status(403).json({ ok: false, reason: 'ip_not_allowlisted' });
  };

  // Surface state for /api/health and tests.
  mw.state = () => ({
    enabled, mode, enforcing,
    entries: matchers.map(m => m.entry),
    bypass: bypassPrefixes,
  });
  return mw;
}

module.exports = {
  buildIpAllowlist,
  // Exported for unit testing:
  compileEntry,
  compileAllowlist,
  clientIp,
  ipv4ToInt,
};
