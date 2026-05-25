// me-options.js -- T-403 (architecture audit #1, server.js split #24).
// T-298a: options scanner status + opportunities log endpoints (3 routes).

'use strict';

const { OptionChainFetcher } = require('../services/option-chain-fetcher');
const { OptionsScanner }     = require('../services/options-scanner');

function mountMeOptionsRoutes(app, deps) {
  const { getDb, getOptionChainFetcher, getOptionsScanner } = deps;
  if (typeof getDb                  !== 'function') throw new Error('me-options: getDb required');
  if (typeof getOptionChainFetcher  !== 'function') throw new Error('me-options: getOptionChainFetcher required');
  if (typeof getOptionsScanner      !== 'function') throw new Error('me-options: getOptionsScanner required');

  app.get('/api/options/opportunities', (req, res) => {
    if (!req.user) return res.status(401).json({ ok: false, reason: 'auth_required' });
    const db = getDb();
    if (!db) return res.status(503).json({ ok: false, reason: 'db_not_initialized' });
    const limit = Math.max(1, Math.min(200, parseInt(req.query.limit, 10) || 50));
    try {
      const rows = db._conn.prepare(`
        SELECT id, scanned_at AS scannedAt, underlying, regime, regime_confidence AS regimeConfidence,
               template, score, raw_score AS rawScore, weight, opportunity_json AS opportunityJson,
               reviewed, reviewed_at AS reviewedAt, reviewed_note AS reviewedNote
        FROM option_opportunities
        WHERE (user_id = ? OR user_id IS NULL)
        ORDER BY scanned_at DESC LIMIT ?
      `).all(req.user.id, limit);
      res.json({ ok: true, count: rows.length, opportunities: rows });
    } catch (e) {
      res.status(500).json({ ok: false, reason: e.message });
    }
  });

  app.post('/api/options/opportunities/:id/review', (req, res) => {
    if (!req.user) return res.status(401).json({ ok: false, reason: 'auth_required' });
    const db = getDb();
    if (!db) return res.status(503).json({ ok: false, reason: 'db_not_initialized' });
    const id = parseInt(req.params.id, 10);
    const note = (req.body && req.body.note) ? String(req.body.note).slice(0, 500) : null;
    try {
      const r = db._conn.prepare(`UPDATE option_opportunities SET reviewed = 1, reviewed_at = datetime('now'), reviewed_note = ? WHERE id = ?`).run(note, id);
      res.json({ ok: r.changes === 1, changes: r.changes });
    } catch (e) {
      res.status(500).json({ ok: false, reason: e.message });
    }
  });

  app.get('/api/options/scanner/status', (req, res) => {
    if (!req.user) return res.status(401).json({ ok: false, reason: 'auth_required' });
    res.json({
      ok: true,
      fetcherEnabled: OptionChainFetcher.isEnabled(),
      scannerEnabled: OptionsScanner.isEnabled(),
      fetcherInstantiated: !!getOptionChainFetcher(),
      scannerInstantiated: !!getOptionsScanner(),
      note: 'Scanner is SHADOW MODE -- never places orders. Set OPTIONS_AUTORUN_ENABLED=true on backend.env to start logging proposed opportunities.',
    });
  });
}

module.exports = { mountMeOptionsRoutes };
