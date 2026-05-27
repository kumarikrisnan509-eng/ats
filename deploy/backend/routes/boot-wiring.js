// boot-wiring.js -- T-414 (architecture audit #1, server.js split #40).
// Seven cheap operational endpoints. All are public reads (some auth-gated,
// none mutating state). Largest dep surface in the codebase so far -- almost
// every backend singleton has a getter passed in, because /api/health-deep
// and /api/system/info aggregate stats across all of them.
//
//   - GET  /api/health        (T-380 audit-degraded surface, broker.health)
//   - GET  /api/health-deep   (Tier 70 -- db/vault/broker/surveillance/DR/...)
//   - GET  /api/status        (60s-cached summary; T-172 services map)
//   - GET  /api/csrf-token    (returns HMAC(SESSION_SECRET, 'csrf:' + sid))
//   - GET  /api/summary       (dashboard one-shot: holdings/positions/orders/...)
//   - GET  /api/system/info   (ops panel: process/components/riskCaps/audit/config)
//   - GET  /metrics           (Prometheus text format; internal-IP or token-gated)
//
// Mount placement: at the very end of routes setup so all singletons have been
// initialised (init() finished). Earlier mount works for handler registration
// because getters defer the read until request-time, but mounting near where
// the routes used to live keeps the diff localised.

'use strict';

const crypto = require('crypto');
const fs = require('fs');

function mountBootWiringRoutes(app, deps) {
  const {
    // config consts (passed by value -- never reassigned)
    ENV_NAME,
    KILL_SWITCH,
    LIVE_TRADING,
    SESSION_SECRET,
    MAX_DAILY_LOSS_INR,
    MAX_ORDERS_PER_MIN,
    MAX_POSITION_SIZE_INR,
    MAX_AGGREGATE_EXPOSURE,
    MAX_WS_CLIENTS,
    DEFAULT_SYMBOLS,
    AUDIT_LOG,

    // mutable singletons (must be getters -- assigned during async init())
    getDb,
    getVault,
    getBroker,
    getAlerts,
    getWatchlist,
    getScanner,
    getPaper,
    getPnl,
    getAutorun,
    getNews,
    getTax,
    getAi,
    getSweep,
    getLongterm,
    getBrokerResolver,
    getSurveillance,
    getEarningsCal,
    getFiidii,
    getBulkDeals,
    getWsClients,

    // mutable scalars (audit counters change at runtime; getter returns snapshot)
    getAuditState,
    getOrderTimesLength,
    getMetricCounters,

    // helpers (pure functions hoisted -- pass by value)
    readSessionCookie,
    isInternalIp,
    getClientIp,
    ensureDrTable,

    // status cache + builder (cache object is mutable -- getter; builder is pure async fn)
    getStatusCache,
    setStatusCache,
    STATUS_CACHE_MS,
    buildStatus,
  } = deps;

  if (typeof getBroker !== 'function') throw new Error('boot-wiring: getBroker required');
  if (typeof getDb     !== 'function') throw new Error('boot-wiring: getDb required');
  if (typeof readSessionCookie !== 'function') throw new Error('boot-wiring: readSessionCookie required');
  if (typeof buildStatus !== 'function') throw new Error('boot-wiring: buildStatus required');

  // ---------- /api/status ----------
  app.get('/api/status', async (_req, res) => {
    res.set('Cache-Control', 'public, max-age=30');
    res.set('Access-Control-Allow-Origin', '*');
    const now = Date.now();
    const cache = getStatusCache();
    if (cache.payload && (now - cache.ts) < STATUS_CACHE_MS) {
      return res.json({ ...cache.payload, cached: true, cache_age_sec: Math.round((now - cache.ts) / 1000) });
    }
    try {
      const payload = await buildStatus();
      setStatusCache({ ts: now, payload });
      res.json({ ...payload, cached: false });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ---------- /api/health-deep (Tier 70) ----------
  app.get('/api/health-deep', async (_req, res) => {
    const checks = {};
    const db          = getDb();
    const vault       = getVault();
    const broker      = getBroker();
    const _brokerResolver = getBrokerResolver();
    const _surveillance   = getSurveillance();
    const _earningsCal    = getEarningsCal();
    const _fiidii         = getFiidii();
    const _bulkDeals      = getBulkDeals();

    try { checks.db = !!(db && db._conn && db._conn.prepare('SELECT 1').get()); } catch (e) { checks.db = false; checks.dbErr = e.message; }
    try { checks.vault = !!vault; } catch (e) { checks.vault = false; }
    try { checks.brokerResolver = !!_brokerResolver; } catch (e) { checks.brokerResolver = false; }
    try { checks.broker = !!(broker && broker.name); } catch (e) { checks.broker = false; }
    try {
      if (_surveillance) {
        const st = _surveillance.status();
        checks.surveillance = st.ready;
        checks.surveillanceCounts = st.counts;
        checks.surveillanceAgeMin = st.ageMs != null ? Math.round(st.ageMs / 60000) : null;
      } else {
        checks.surveillance = false;
      }
    } catch (e) { checks.surveillance = false; }
    try {
      if (_earningsCal) {
        const st = _earningsCal.status();
        checks.earningsCal = st.ready;
        checks.earningsCalCount = st.eventCount;
        checks.earningsCalAgeMin = st.ageMs != null ? Math.round(st.ageMs / 60000) : null;
      } else { checks.earningsCal = false; }
    } catch (e) { checks.earningsCal = false; }
    try {
      if (_fiidii) {
        const st = _fiidii.status();
        checks.fiidii = st.ready;
        checks.fiidiiDate = st.lastDate;
        checks.fiidiiAgeMin = st.ageMs != null ? Math.round(st.ageMs / 60000) : null;
      } else { checks.fiidii = false; }
    } catch (e) { checks.fiidii = false; }
    try {
      if (_bulkDeals) {
        const st = _bulkDeals.status();
        checks.bulkDeals = st.ready;
        checks.bulkDealsDate = st.asOn;
        checks.bulkDealsCounts = { bulk: st.bulk, block: st.block, short: st.short };
      } else { checks.bulkDeals = false; }
    } catch (e) { checks.bulkDeals = false; }

    // T-I1: DR test history
    try {
      if (ensureDrTable && ensureDrTable() && db && db._conn) {
        const row = db._conn.prepare("SELECT ts, payload FROM dr_test_history ORDER BY id DESC LIMIT 1").get();
        if (row) {
          const ageMs = Date.now() - new Date(row.ts).getTime();
          const ageDays = Math.round(ageMs / 86400000);
          let lastOk = false;
          try { const p = JSON.parse(row.payload || '{}'); lastOk = p.ok === true; } catch (e) { console.debug('[boot-wiring] swallowed:', e && e.message); }
          checks.drLastTestAgo = ageDays + 'd';
          checks.drLastTestOk = lastOk;
          checks.drStale = ageDays > 30;
        } else {
          checks.drLastTestAgo = 'never';
          checks.drLastTestOk = false;
          checks.drStale = true;
        }
      } else {
        checks.drLastTestAgo = 'unavailable';
        checks.drLastTestOk  = false;
        checks.drStale       = true;
      }
    } catch (e) {
      checks.drLastTestAgo = 'error:' + (e.message || 'unknown').slice(0, 40);
      checks.drLastTestOk  = false;
      checks.drStale       = true;
    }

    // T99-T34/T37/T55: broker WS + tick + token age
    try {
      if (broker) {
        checks.brokerWsConnected = broker._connected === true;
        checks.brokerWsStalled = broker._stalledOnToken === true;
        if (typeof broker._reconnectAttempts === 'number') {
          checks.brokerWsReconnectAttempts = broker._reconnectAttempts;
        }
        checks.brokerTickStale = broker._tickStale === true;
        if (typeof broker._lastTickAt === 'number' && broker._lastTickAt > 0) {
          checks.brokerTickLagSec = Math.round((Date.now() - broker._lastTickAt) / 1000);
        }
        if (typeof broker._lastAccessTokenSetAt === 'number' && broker._lastAccessTokenSetAt > 0) {
          const ageMs = Date.now() - broker._lastAccessTokenSetAt;
          checks.brokerAccessTokenAgeMin = Math.round(ageMs / 60000);
        } else {
          checks.brokerAccessTokenAgeMin = null;
        }
      }
    } catch (_e) { /* don't fail health on introspection */ }

    checks.uptimeSec = Math.round(process.uptime());
    checks.memMB = Math.round(process.memoryUsage().rss / 1024 / 1024);
    const hardChecks = ['db', 'vault', 'brokerResolver'];
    res.json({ ok: hardChecks.every(k => checks[k] !== false), checks });
  });

  // ---------- /api/csrf-token ----------
  function _csrfToken(sid) {
    if (!sid) return null;
    return crypto.createHmac('sha256', SESSION_SECRET).update('csrf:' + sid).digest('base64url');
  }
  app.get('/api/csrf-token', (req, res) => {
    const sid = readSessionCookie(req);
    if (!sid) {
      // T-463 (audit-2026-05-26 backend L7): UX fix. Frontend bootstrap
      // fetches /api/csrf-token unconditionally on page load. Before this
      // change every anon visit produced a 401 in browser dev tools and
      // any error-tracking dashboard (Sentry, _lastRequestId observer).
      // Not a security issue — the caller had no cookie so no CSRF token
      // is needed yet — but the 401 noise muddied real error signals.
      // Return 200 + csrfToken:null so the caller knows "no session yet,
      // come back after login" without flagging the request as an error.
      return res.json({ ok: true, csrfToken: null, reason: 'no_session' });
    }
    const token = _csrfToken(sid);
    return res.json({ ok: true, csrfToken: token });
  });

  // ---------- /api/summary (dashboard one-shot) ----------
  app.get('/api/summary', async (_req, res) => {
    const broker    = getBroker();
    const watchlist = getWatchlist();
    const alerts    = getAlerts();
    const errors = {};
    const safe = async (name, p) => {
      try { return await p; }
      catch (e) { errors[name] = e.message; return null; }
    };

    const [holdings, positions, orders, profile, margins] = await Promise.all([
      safe('holdings', broker.getHoldings()),
      safe('positions', broker.getPositions()),
      safe('orders', broker.getOrders()),
      safe('profile', broker.getProfile()),
      safe('margins', broker.getMargins()),
    ]);

    const aggregates = {
      holdingsCount: Array.isArray(holdings) ? holdings.length : 0,
      holdingsValue: Array.isArray(holdings)
        ? +holdings.reduce((s, h) => s + (h.quantity || 0) * (h.ltp || 0), 0).toFixed(2)
        : 0,
      holdingsPnl: Array.isArray(holdings)
        ? +holdings.reduce((s, h) => s + (h.pnl || 0), 0).toFixed(2)
        : 0,
      positionsNetCount: positions && Array.isArray(positions.net) ? positions.net.length : 0,
      positionsDayCount: positions && Array.isArray(positions.day) ? positions.day.length : 0,
      ordersTotal: Array.isArray(orders) ? orders.length : 0,
      ordersOpen: Array.isArray(orders)
        ? orders.filter(o => ['OPEN', 'TRIGGER PENDING', 'PENDING'].includes(String(o.status).toUpperCase())).length
        : 0,
    };

    res.json({
      ok: true,
      time: new Date().toISOString(),
      env: ENV_NAME,
      killSwitch: KILL_SWITCH,
      liveTrading: LIVE_TRADING,
      broker: broker.health(),
      profile,
      aggregates,
      holdings,
      positions,
      orders,
      margins,
      watchlist: watchlist ? watchlist.list() : [],
      alerts: alerts ? alerts.list() : [],
      errors: Object.keys(errors).length ? errors : null,
    });
  });

  // ---------- /api/system/info ----------
  app.get('/api/system/info', (_req, res) => {
    const broker    = getBroker();
    const alerts    = getAlerts();
    const watchlist = getWatchlist();
    const scanner   = getScanner();
    const paper     = getPaper();
    const pnl       = getPnl();
    const autorun   = getAutorun();
    const news      = getNews();
    const tax       = getTax();
    const ai        = getAi();
    const sweep     = getSweep();
    const longterm  = getLongterm();
    const audit     = getAuditState();

    let auditSize = 0, auditLastTs = null;
    try {
      if (fs.existsSync(AUDIT_LOG)) {
        const stat = fs.statSync(AUDIT_LOG);
        auditSize = stat.size;
        auditLastTs = new Date(stat.mtimeMs).toISOString();
      }
    } catch (e) { console.warn('[boot-wiring] swallowed:', e && e.message); }

    res.json({
      ok: true,
      time: new Date().toISOString(),
      env: ENV_NAME,
      killSwitch: KILL_SWITCH,
      liveTrading: LIVE_TRADING,
      process: {
        uptimeSec: Math.floor(process.uptime()),
        nodeVersion: process.version,
        memMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
        pid: process.pid,
      },
      broker: broker.health(),
      components: {
        alerts:    alerts    ? alerts.stats()    : null,
        watchlist: watchlist ? watchlist.stats() : null,
        scanner:   scanner   ? scanner.stats()   : null,
        paper:     paper     ? paper.stats()     : null,
        pnl:       pnl       ? pnl.stats()       : null,
        autorun:   autorun   ? autorun.stats()   : null,
        news:      news      ? news.stats()      : null,
        tax:       tax       ? tax.stats()       : null,
        ai:        ai        ? ai.stats()        : null,
        sweep:     sweep     ? sweep.stats()     : null,
        longterm:  longterm  ? longterm.stats()  : null,
        riskCaps: {
          killSwitch: KILL_SWITCH,
          liveTrading: LIVE_TRADING,
          maxDailyLossINR: MAX_DAILY_LOSS_INR,
          maxOrdersPerMin: MAX_ORDERS_PER_MIN,
          maxPositionSizeINR: MAX_POSITION_SIZE_INR,
          maxAggregateExposureINR: MAX_AGGREGATE_EXPOSURE,
          ordersInWindow: getOrderTimesLength(),
        },
      },
      auditLog: { path: AUDIT_LOG, sizeBytes: auditSize, lastWriteTs: auditLastTs, seq: audit.seq },
      config: {
        maxWsClients: MAX_WS_CLIENTS,
        defaultSymbols: DEFAULT_SYMBOLS,
        brokerName: broker.name,
      },
    });
  });

  // ---------- /metrics (Prometheus) ----------
  app.get('/metrics', (req, res) => {
    const ra = getClientIp(req).replace('::ffff:', '');
    if (!isInternalIp(ra)) {
      const tok = process.env.ATS_METRICS_TOKEN || '';
      if (!tok || req.headers['x-metrics-token'] !== tok) {
        return res.status(403).type('text/plain').send('forbidden');
      }
    }
    const broker    = getBroker();
    const alerts    = getAlerts();
    const watchlist = getWatchlist();
    const scanner   = getScanner();
    const wsClients = getWsClients();
    const audit     = getAuditState();

    const lines = [];
    const push = (help, type, name, value, labels) => {
      lines.push(`# HELP ${name} ${help}`);
      lines.push(`# TYPE ${name} ${type}`);
      const lbl = labels ? '{' + Object.entries(labels).map(([k,v]) => `${k}="${String(v).replace(/"/g,'')}"`).join(',') + '}' : '';
      lines.push(`${name}${lbl} ${value}`);
    };
    const b = broker.health();
    push('Broker connection (1=connected)',        'gauge', 'ats_broker_connected',              b.connected ? 1 : 0);
    push('Subscribed Kite instrument tokens',      'gauge', 'ats_broker_subscribed_instruments', b.subscribedInstruments || 0);
    push('Active /ws subscribers',                 'gauge', 'ats_broker_ws_subscribers',         b.subscribers || 0);
    push('Ticker reconnect attempts (cumulative)', 'gauge', 'ats_broker_reconnect_attempts',     b.reconnectAttempts || 0);
    push('Has access token cached',                'gauge', 'ats_broker_has_access_token',       b.hasAccessToken ? 1 : 0);
    push('Last tick epoch (ms)',                   'gauge', 'ats_broker_last_tick_ms',           b.lastTickAt || 0);
    push('Tick lag in ms',                         'gauge', 'ats_broker_lag_ms',                 b.lagMs || 0);
    push('Instruments master size',                'gauge', 'ats_instruments_count',             (b.instruments && b.instruments.size) || 0);
    if (alerts) {
      const a = alerts.stats();
      push('Total alerts',     'gauge',   'ats_alerts_total',     a.total || 0);
      push('Active alerts',    'gauge',   'ats_alerts_active',    a.active || 0);
      push('Triggered alerts', 'gauge',   'ats_alerts_triggered', a.triggered || 0);
      push('Alert eval count', 'counter', 'ats_alerts_evals_total', a.evals || 0);
      push('Alert fire count', 'counter', 'ats_alerts_fires_total', a.fires || 0);
    }
    if (watchlist) {
      push('Watchlist symbol count', 'gauge', 'ats_watchlist_count', watchlist.stats().count || 0);
    }
    if (scanner) {
      const s = scanner.stats();
      push('Scanner history count',  'gauge', 'ats_scanner_history_count',   s.historyCount || 0);
      push('Scanner debounce keys',  'gauge', 'ats_scanner_debounce_keys',   s.debounceKeys || 0);
    }
    push('Audit log seq number',           'counter', 'ats_audit_seq_total',     audit.seq);
    push('Active /ws client connections',  'gauge',   'ats_ws_clients',          wsClients.size);
    push('Process uptime seconds',         'counter', 'ats_process_uptime_seconds', Math.floor(process.uptime()));
    push('Process RSS bytes',              'gauge',   'ats_process_rss_bytes',   process.memoryUsage().rss);
    push('KILL_SWITCH active (1=killed)',  'gauge',   'ats_kill_switch',         KILL_SWITCH ? 1 : 0);
    // T-419: business metrics for alerting. All counters; reset on process restart.
    const metricCounters = (typeof getMetricCounters === 'function')
      ? (getMetricCounters() || {}) : {};
    push('Orders placed (paper + live)',           'counter', 'ats_orders_placed_total',         metricCounters.ordersPlaced       || 0);
    push('Broker disconnects (manual + forced)',   'counter', 'ats_broker_disconnects_total',    metricCounters.brokerDisconnects  || 0);
    push('Audit-log write failures (degraded)',    'counter', 'ats_audit_write_failures_total',  metricCounters.auditWriteFailures || 0);
    push('OAuth callback / exchange failures',     'counter', 'ats_oauth_failures_total',        metricCounters.oauthFailures      || 0);
    // T-458 (audit-2026-05-26 backend L3): Telegram notify delivery failures.
    try {
      const { getNotifyFailureStats } = require('../notify');
      const ns = getNotifyFailureStats();
      push('Telegram notify delivery failures',     'counter', 'ats_notify_failures_total',       ns.count || 0);
    } catch (_) { /* notify module not loaded yet — skip */ }
    res.type('text/plain; version=0.0.4').send(lines.join('\n') + '\n');
  });

  // ---------- /api/health (T-380 audit-degraded surface) ----------
  app.get('/api/health', (_req, res) => {
    const broker    = getBroker();
    const alerts    = getAlerts();
    const watchlist = getWatchlist();
    const scanner   = getScanner();
    const audit     = getAuditState();
    res.json({
      ok: true,
      env: ENV_NAME,
      killSwitch: KILL_SWITCH,
      liveTrading: LIVE_TRADING,
      uptimeSec: Math.floor(process.uptime()),
      time: new Date().toISOString(),
      broker: broker.health(),
      alerts: alerts ? alerts.stats() : null,
      watchlist: watchlist ? watchlist.stats() : null,
      scanner: scanner ? scanner.stats() : null,
      audit: {
        seq: audit.seq,
        degradedCount: audit.degradedCount,
        lastError: audit.lastError,
        lastAt: audit.lastAt,
      },
    });
  });
}

module.exports = { mountBootWiringRoutes };
