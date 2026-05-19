// T-223 (CODE-AUDIT F.5 M1.4 piece 6a): /api/orders/* routes — staged extract.
//
// First sub-commit pulls ONLY /api/orders/dry-run, the safest possible
// extract: no live-money path, no 2FA, no rate-limit, no validation sets.
// Subsequent sub-commits (6b, 6c) move /api/orders/place + /cancel +
// /confirm-2fa + /cancel-2fa with the full 19-dep mount surface.
//
// Why incremental: the audit's hand-off doc (M1.4-PIECE-6-7-HANDOFF.md)
// explicitly warned that the full route move is multi-hour work because
// the place handler has 19 module-level deps and reasoning about
// captured-vs-fresh references for the `broker` singleton is non-trivial.
// Shipping dry-run first proves the mount pattern + require ordering
// (T-215 check) before we touch the live-money handler.
//
// Mount call from server.js:
//   mountOrdersRoutes(app, { KILL_SWITCH, audit });
// In 6b the deps object will expand to the full 19-key set documented
// in M1.4-PIECE-6-7-HANDOFF.md.

'use strict';

const crypto = require('crypto');

function mountOrdersRoutes(app, deps) {
  const { KILL_SWITCH, audit } = deps;

  // /api/orders/dry-run -- scaffold, never hits broker. Used by the
  // frontend strategy editor + by source-grep tests that want to
  // verify route registration without live-trading risk.
  app.post('/api/orders/dry-run', (req, res) => {
    if (KILL_SWITCH) {
      audit('order.blocked', { reason: 'KILL_SWITCH_ON', payload: req.body });
      return res.status(503).json({ ok: false, reason: 'KILL_SWITCH_ON' });
    }
    const required = ['strategyTag', 'instrument', 'side', 'quantity', 'product', 'orderType'];
    for (const k of required) if (!(k in (req.body || {}))) {
      return res.status(400).json({ ok: false, reason: `missing:${k}` });
    }
    const clientOrderId = crypto.randomUUID();
    audit('order.dryRun', { clientOrderId, payload: req.body });
    res.json({ ok: true, mode: 'dry-run', clientOrderId,
               note: 'Scaffold only. No broker called. No real order placed.' });
  });
}

module.exports = { mountOrdersRoutes };
