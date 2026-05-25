// misc.js -- T-406 (architecture audit #1, server.js split #32).
// 4 small boot/wiring routes (config + auth-mode + kill-switch + market/holidays).

'use strict';

function mountMiscRoutes(app, deps) {
  const { ENV_NAME, KILL_SWITCH, LIVE_TRADING, AUTH_REQUIRED, DEFAULT_SYMBOLS,
          getBroker, getDb, getMarketMeta, setMarketMeta } = deps;
  if (typeof getBroker      !== 'function') throw new Error('misc: getBroker required');
  if (typeof getDb          !== 'function') throw new Error('misc: getDb required');
  if (typeof getMarketMeta  !== 'function') throw new Error('misc: getMarketMeta required');
  if (typeof setMarketMeta  !== 'function') throw new Error('misc: setMarketMeta required');

  // Config exposed to the front-end
  app.get('/api/config', (_req, res) => {
    res.json({
      env: ENV_NAME,
      features: { liveTrading: false, paperTrading: true, backtest: true, aiReview: true },
      killSwitch: KILL_SWITCH,
      liveTrading: LIVE_TRADING,
      wsUrl: '/ws',
      broker: getBroker().name,
      defaultSymbols: DEFAULT_SYMBOLS,
    });
  });

  // Tell clients whether auth is enabled (frontend uses this to know if Bearer needed).
  app.get('/api/auth-mode', (_req, res) => {
    res.json({ ok: true, authRequired: AUTH_REQUIRED });
  });

  app.get('/api/kill-switch', (_req, res) => res.json({ killSwitch: KILL_SWITCH }));

  // Tier 80c: NSE holidays (lazy-init for cases where broker came up after module load).
  app.get('/api/market/holidays', (_req, res) => {
    let mm = getMarketMeta();
    if (!mm) {
      const db = getDb();
      const broker = getBroker();
      if (db && broker) {
        try {
          const { createMarketMeta } = require('../market-meta');
          const created = createMarketMeta({ db, broker });
          created.scheduleDailyRefresh();
          setMarketMeta(created);
          mm = created;
        } catch (e) { console.error('[market-holidays] lazy init failed:', e.message); }
      }
    }
    if (!mm) return res.status(503).json({ ok: false, reason: 'market_meta_unavailable' });
    const r = mm.getHolidays();
    res.json({ ok: true, ...r });
  });
}

module.exports = { mountMiscRoutes };
