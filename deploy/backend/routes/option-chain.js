// T-290d -- Read routes for the option_quotes table.
//
// These are READ-ONLY. The fetcher writes the table on a cron; these
// routes never modify state. POST /api/option-chain/refresh is the one
// exception -- a manual trigger gated behind the ops key.
//
// Public:
//   GET  /api/option-chain/:underlying                  -> latest snapshot
//   GET  /api/option-chain/:underlying/expiries         -> available expiries
// Ops-gated:
//   POST /api/option-chain/refresh                       -> manual refresh
//
// Mount with: require('./routes/option-chain')(app, { db, fetcher, opsKey })

'use strict';

function mountOptionChainRoutes(app, deps) {
  const { db, fetcher, opsKey } = deps || {};
  if (!db) throw new Error('option-chain routes: db required');

  // GET /api/option-chain/:underlying?expiry=YYYY-MM-DD
  // If expiry omitted, returns the nearest expiry's full chain.
  app.get('/api/option-chain/:underlying', (req, res) => {
    try {
      const underlying = String(req.params.underlying || '').toUpperCase();
      if (!underlying) return res.status(400).json({ ok: false, reason: 'underlying_required' });

      let expiry = req.query.expiry ? String(req.query.expiry) : null;
      if (!expiry) {
        // Pick the soonest expiry present in the table for this underlying.
        const row = db.prepare(`
          SELECT expiry FROM option_quotes
          WHERE underlying = ?
          ORDER BY expiry ASC
          LIMIT 1
        `).get(underlying);
        if (!row) return res.json({ ok: true, underlying, expiry: null, rows: [], note: 'no_data' });
        expiry = row.expiry;
      }

      const rows = db.prepare(`
        SELECT underlying, expiry, strike, type, tradingsymbol, instrument_token,
               lot_size AS lotSize, ltp, iv, iv_source AS ivSource,
               delta, gamma, vega, theta, theoretical_price AS theoreticalPrice,
               oi, volume, spot, snapshot_at AS snapshotAt
        FROM option_quotes
        WHERE underlying = ? AND expiry = ?
        ORDER BY strike ASC, type ASC
      `).all(underlying, expiry);

      // Group call+put per strike for the UI's convenience.
      const byStrike = new Map();
      for (const r of rows) {
        if (!byStrike.has(r.strike)) byStrike.set(r.strike, { strike: r.strike });
        byStrike.get(r.strike)[r.type] = r;
      }
      const grouped = Array.from(byStrike.values()).sort((a, b) => a.strike - b.strike);

      // Pull spot off the first row (all rows share spot for one snapshot)
      const spot = rows.length > 0 ? rows[0].spot : null;
      const snapshotAt = rows.length > 0 ? rows[0].snapshotAt : null;

      res.json({
        ok: true,
        underlying,
        expiry,
        spot,
        snapshotAt,
        count: rows.length,
        strikes: grouped,
      });
    } catch (e) {
      res.status(500).json({ ok: false, reason: e.message });
    }
  });

  // GET /api/option-chain/:underlying/expiries
  app.get('/api/option-chain/:underlying/expiries', (req, res) => {
    try {
      const underlying = String(req.params.underlying || '').toUpperCase();
      const rows = db.prepare(`
        SELECT DISTINCT expiry,
               COUNT(*) AS count,
               MAX(snapshot_at) AS latest
        FROM option_quotes
        WHERE underlying = ?
        GROUP BY expiry
        ORDER BY expiry ASC
      `).all(underlying);
      res.json({ ok: true, underlying, expiries: rows });
    } catch (e) {
      res.status(500).json({ ok: false, reason: e.message });
    }
  });

  // POST /api/option-chain/refresh
  // Body: { underlying, expiry, spot? }
  // Header: X-ATS-Ops-Key must match env ATS_OPS_KEY
  // Manual trigger -- only useful when the cron is off or for a one-shot fetch.
  app.post('/api/option-chain/refresh', async (req, res) => {
    try {
      // Ops-key gate (same pattern as other ops endpoints)
      const supplied = req.get('X-ATS-Ops-Key') || '';
      const expected = opsKey || process.env.ATS_OPS_KEY || '';
      if (!expected) return res.status(503).json({ ok: false, reason: 'ops_key_not_configured' });
      if (supplied !== expected) return res.status(403).json({ ok: false, reason: 'bad_ops_key' });

      if (!fetcher) return res.status(503).json({ ok: false, reason: 'fetcher_not_initialized' });

      const { underlying, expiry, spot, riskFreeRate, assumedIV } = req.body || {};
      if (!underlying || !expiry) {
        return res.status(400).json({ ok: false, reason: 'underlying_and_expiry_required' });
      }

      const result = await fetcher.refresh({ underlying, expiry, spot, riskFreeRate, assumedIV });
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ ok: false, reason: e.message });
    }
  });
}

module.exports = mountOptionChainRoutes;
