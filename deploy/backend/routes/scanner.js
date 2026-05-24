// scanner.js -- T-390 (architecture audit #1, server.js god-object split #7).
//
// Three scanner endpoints for the autorun signal pipeline:
//   - GET  /api/scanner          -- current stats (last scan time, throughput, errors)
//   - GET  /api/scanner/history  -- recent scan results (default 25, capped via ?limit)
//   - POST /api/scanner/run      -- kick off a manual scan; returns 202 immediately
//                                   (scan runs in background; poll history endpoint
//                                   for results)
//
// Public API
// ==========
//   const { mountScannerRoutes } = require('./routes/scanner');
//   mountScannerRoutes(app, { getScanner, audit });
//
// `getScanner` is a getter because the scanner singleton is lazily initialised
// inside server.js's async init(). Passing a closure avoids a stale snapshot.
// `audit` is the singleton audit() function from server.js.

'use strict';

function mountScannerRoutes(app, deps) {
  const { getScanner, audit } = deps;
  if (typeof getScanner !== 'function') throw new Error('scanner: getScanner getter required');
  if (typeof audit      !== 'function') throw new Error('scanner: audit required');

  app.get('/api/scanner', (_req, res) => {
    const scanner = getScanner();
    if (!scanner) return res.status(503).json({ ok: false, reason: 'scanner_not_initialized' });
    res.json({ ok: true, ...scanner.stats() });
  });

  app.get('/api/scanner/history', (req, res) => {
    const scanner = getScanner();
    if (!scanner) return res.status(503).json({ ok: false, reason: 'scanner_not_initialized' });
    const limit = parseInt(req.query.limit || '25', 10);
    res.json({ ok: true, history: scanner.history(limit) });
  });

  // Async fire-and-poll: the HTTP request returns 202 immediately so the
  // client doesn't hold the connection open for 15+ seconds while every
  // watchlist symbol gets evaluated. Result lands in /api/scanner/history.
  app.post('/api/scanner/run', async (req, res) => {
    const scanner = getScanner();
    if (!scanner) return res.status(503).json({ ok: false, reason: 'scanner_not_initialized' });
    scanner.runOnce({ manual: true, limit: req.body && req.body.limit })
      .then((r) => audit('scanner.runOnce', r))
      .catch((e) => audit('scanner.runOnce.error', { msg: e.message }));
    res.status(202).json({ ok: true, accepted: true, note: 'scanning in background -- poll /api/scanner/history' });
  });
}

module.exports = { mountScannerRoutes };
