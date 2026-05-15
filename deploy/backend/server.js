// ATS backend v0.2 — rajasekarselvam.com
//
// What's new vs v0.1:
//   - Broker-pluggable: BROKER=mock|zerodha selects MockBroker or ZerodhaBroker.
//   - Real Kite Connect OAuth callback at /api/brokers/zerodha/callback.
//   - Realtime tick fan-out from the chosen broker into all /ws subscribers.
//   - libsodium-sealed per-user access_token storage on disk.
//
// What still is NOT here, deliberately:
//   - Real order placement. /api/orders/dry-run is the only order endpoint and it only
//     writes to the audit log. Wire real orders in a separate, deliberate change.

const express = require('express');
const http    = require('http');
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');
const cookie  = require('cookie');
const { WebSocketServer } = require('ws');

const { createBroker } = require('./brokers');
const { Vault }        = require('./crypto-vault');
const { SessionStore } = require('./sessions');
const { LoginVault }   = require('./login-vault');
const { notify }       = require('./notify');
const { Alerts }       = require('./alerts');
const { Watchlist }    = require('./watchlist');
const { Scanner, classifyRegime } = require('./scanner');
const { runBacktest, computeSignal } = require('./backtest');
const { PaperTrading } = require('./paper');
const { PnlAttribution } = require('./pnl-attribution');
const { AutoRunner }   = require('./autorun');
const { NewsFeed }     = require('./news');
const { TaxPlanner }   = require('./tax');
const { ClaudeAI }     = require('./ai');
const { SweepEngine }  = require('./sweep');
const { LongTerm }     = require('./longterm');
const { Wealth }       = require('./wealth');
const { MPT }          = require('./mpt');
const { FactorTilt }   = require('./factor-tilt');
const { WormAudit }    = require('./worm-audit');
const { Rebalance }    = require('./rebalance');
const { Replay }       = require('./replay');
const { EmailAlerts }  = require('./email-alerts');
const { WhatsAppAlerts } = require('./whatsapp-alerts');
const { runPreflight } = require('./preflight');
const csvImport        = require('./csv-import');

// ---------- Config ----------
const PORT            = parseInt(process.env.PORT || '8080', 10);
const KILL_SWITCH     = String(process.env.KILL_SWITCH || 'true').toLowerCase() === 'true';
// Tier 11: even with KILL_SWITCH=false, live trading also requires LIVE_TRADING=true.
// Two independent env gates so flipping one doesn't accidentally start real trading.
const LIVE_TRADING    = String(process.env.LIVE_TRADING || 'false').toLowerCase() === 'true';
// Tier 15: pre-trade risk-gate circuits. All values default to safe levels.
const MAX_DAILY_LOSS_INR     = Number(process.env.MAX_DAILY_LOSS_INR     || 10000);   // halt new orders if today's paper realizedPnl <= -₹10k
const MAX_ORDERS_PER_MIN     = Number(process.env.MAX_ORDERS_PER_MIN     || 30);      // per-user (today: global)
const MAX_POSITION_SIZE_INR  = Number(process.env.MAX_POSITION_SIZE_INR  || 500000);  // qty*price cap per order (₹5L)
const MAX_AGGREGATE_EXPOSURE = Number(process.env.MAX_AGGREGATE_EXPOSURE || 2000000); // sum(holdings + open paper positions) cap (₹20L)
const ENV_NAME        = process.env.ENV_NAME || 'dev';
const AUDIT_LOG       = process.env.AUDIT_LOG || path.join(__dirname, 'audit.log');
const MAX_WS_CLIENTS  = parseInt(process.env.MAX_WS_CLIENTS || '200', 10);
const BROKER_NAME     = (process.env.BROKER || 'mock').toLowerCase();
const MASTER_KEY_PATH = process.env.MASTER_KEY_PATH || path.join(__dirname, 'master.key');
const TOKENS_DIR      = process.env.TOKENS_DIR || path.join(__dirname, 'tokens');
const SESSION_SECRET  = process.env.SESSION_SECRET || 'dev-only-change-me';
const DEFAULT_SYMBOLS = (process.env.DEFAULT_SYMBOLS || 'NIFTY 50,BANKNIFTY,RELIANCE,HDFCBANK,TCS,INFY')
    .split(',').map(s => s.trim()).filter(Boolean);

// ---------- Audit ----------
let auditSeq = 0;
// Tier 15: rolling-window order rate counter (in-memory, per-process).
// On restart this resets, which is fine -- the cap is per-minute, not per-day.
const _orderTimes = [];
function _orderRateOk() {
  const now = Date.now();
  const cutoff = now - 60 * 1000;
  while (_orderTimes.length && _orderTimes[0] < cutoff) _orderTimes.shift();
  return _orderTimes.length < MAX_ORDERS_PER_MIN;
}
function _orderRateRecord() {
  _orderTimes.push(Date.now());
}

function audit(event, data) {
  auditSeq += 1;
  // Tier 32: mirror into the WORM (tamper-evident) log if initialized.
  // Failure here never breaks the primary audit.log stream below.
  try { if (wormAudit && wormAudit._initialized) wormAudit.append(event, data); } catch (_e) {}
  try {
    fs.mkdirSync(path.dirname(AUDIT_LOG), { recursive: true });
    fs.appendFileSync(AUDIT_LOG, JSON.stringify({
      seq: auditSeq, ts: new Date().toISOString(), env: ENV_NAME, event, data,
    }) + '\n');
  } catch (err) {
    console.error('FATAL: audit log write failed:', err);
    process.exit(1);
  }
}

// ---------- Boot: broker + vault + sessions + alerts ----------
let broker, vault, sessions, alerts, watchlist, scanner, paper, pnl, autorun, news, tax, ai, sweep, longterm, wealth, mpt, factorTilt, wormAudit, rebalance, replay, emailAlerts, whatsAppAlerts;

async function init() {
  broker = createBroker(process.env);
  await broker.start();
  audit('broker.start', { name: broker.name });

  alerts = new Alerts({
    storePath: process.env.ALERTS_PATH || '/var/lib/ats/tokens/_alerts.json',
    notify,
    audit,
  });
  alerts.load();

  watchlist = new Watchlist({
    storePath: process.env.WATCHLIST_PATH || '/var/lib/ats/tokens/_watchlist.json',
    audit,
  });
  watchlist.load();

  scanner = new Scanner({
    broker,
    watchlist,
    notify,
    audit,
    storePath: process.env.SCANNER_PATH || '/var/lib/ats/tokens/_scanner.json',
  });
  scanner.load();
  scanner.scheduleDaily();

  paper = new PaperTrading({
    storePath:    process.env.PAPER_PATH || '/var/lib/ats/tokens/_paper.json',
    startingCash: parseInt(process.env.PAPER_STARTING_CASH || '1000000', 10),
    audit,
    // Provide a tick-cache accessor so positions screen can mark-to-market.
    lastTicks: () => {
      if (typeof broker.getLastTicks !== 'function') return new Map();
      const arr = broker.getLastTicks();
      return new Map(arr.map(t => [t.symbol, t.ltp]));
    },
  });
  paper.load();

  pnl = new PnlAttribution({
    getStats:  () => paper.stats(),
    getTrades: (n) => paper.trades(n),
    storePath: process.env.PNL_PATH || '/var/lib/ats/tokens/_pnl-daily.json',
    audit,
  });
  pnl.load();
  pnl.start();   // initial snapshot + recurring every 6h

  autorun = new AutoRunner({
    broker, paper, computeSignal, audit,
    storePath: process.env.AUTORUN_PATH || '/var/lib/ats/tokens/_autorun.json',
  });
  autorun.load();
  autorun.start();   // re-arms timer if config is enabled

  news = new NewsFeed({
    watchlist, audit,
    storePath: process.env.NEWS_PATH || '/var/lib/ats/tokens/_news.json',
  });
  news.load();
  news.start();   // initial fetch + 10-min interval

  tax = new TaxPlanner({
    storePath: process.env.TAX_PATH || '/var/lib/ats/tokens/_tax.json',
    audit,
    getClosedTrades: () => paper ? paper.trades(2000) : [],
  });
  tax.load();

  ai = new ClaudeAI({ audit });

  sweep = new SweepEngine({
    getPaperStats: () => paper ? paper.stats() : {},
    audit,
    storePath: process.env.SWEEP_PATH || '/var/lib/ats/tokens/_sweep.json',
  });
  sweep.load();

  // Tier 18: long-term wealth engine (SIPs, buckets, SWP simulator, goal inflation).
  longterm = new LongTerm({
    audit,
    storePath: process.env.LONGTERM_PATH || '/var/lib/ats/tokens/_longterm.json',
  });
  longterm.load();

  // Tier 21: curated reference catalogs for bonds / REITs / smallcases / traders.
  wealth = new Wealth();

  // Tier 22: MPT optimiser (Monte Carlo on small universes).
  mpt = new MPT();

  // Tier 31: factor-tilt portfolio construction (momentum / value / quality / low-vol / size).
  factorTilt = new FactorTilt();

  // Tier 32: Write-Once-Read-Many tamper-evident audit log.
  wormAudit = new WormAudit({
    path: process.env.WORM_PATH || '/var/log/ats/audit.worm.jsonl',
    merkleEvery: Number(process.env.WORM_MERKLE_EVERY) || 100,
    onMerkle: (label, root, range) => {
      try { console.log(JSON.stringify({ level:'info', t:Date.now(), event:label, root, range })); }
      catch (_) {}
    },
  });
  const _wormInit = wormAudit.init();
  if (!_wormInit.ok) {
    console.error(`!! WORM audit chain BROKEN at entry ${_wormInit.brokenAt} (${_wormInit.count} total)`);
    audit('worm.init.broken', { brokenAt: _wormInit.brokenAt, count: _wormInit.count });
  } else {
    console.log(`worm-audit: ${_wormInit.fresh ? 'fresh log' : 'resumed'} (count=${_wormInit.count})`);
  }

  // Tier 23: bucket-target rebalancing engine.
  rebalance = new Rebalance();

  // Tier 27: replay engine (uses backtest's computeSignal) and email alerts.
  replay = new Replay({ computeSignal });
  emailAlerts = new EmailAlerts({ audit });
  whatsAppAlerts = new WhatsAppAlerts({ audit });

  if (BROKER_NAME === 'zerodha') {
    if (!fs.existsSync(MASTER_KEY_PATH)) {
      console.error(`!! ${MASTER_KEY_PATH} not found. Run: npm run init-master-key`);
      process.exit(2);
    }
    vault = await Vault.open(MASTER_KEY_PATH);
    sessions = new SessionStore({ tokensDir: TOKENS_DIR, vault });
    // Try to rehydrate any saved Zerodha access token (single-user prod use)
    const userIds = sessions.listAllUserIds();
    if (userIds.length === 1) {
      const tok = await sessions.loadTokens(userIds[0]);
      if (tok && tok.accessToken) {
        broker.setAccessToken(tok.accessToken);
        audit('broker.rehydrate', { userId: userIds[0] });
      }
    }
  }
}

// ---------- Cookies ----------
function sign(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');
}
function setSessionCookie(res, sid) {
  const v = `${sid}.${sign(sid)}`;
  res.setHeader('Set-Cookie', cookie.serialize('ats.sid', v, {
    httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 7,
  }));
}
function readSessionCookie(req) {
  const raw = req.headers.cookie || '';
  const c = cookie.parse(raw)['ats.sid'];
  if (!c) return null;
  const [sid, mac] = c.split('.');
  if (!sid || !mac) return null;
  if (sign(sid) !== mac) return null;
  return sid;
}

// ---------- Express ----------
const app = express();
app.use(express.json({ limit: '64kb' }));
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');

app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
  next();
});

// ---------- Rate limit (per-IP, in-memory, /api/* only) ----------
// Loopback + Docker private networks are whitelisted (internal auto-login flows).
const RATE_WINDOW_MS = parseInt(process.env.RATE_WINDOW_MS || '60000', 10); // 1 minute
const RATE_MAX       = parseInt(process.env.RATE_LIMIT     || '300',   10); // requests / window / IP
const _rateBuckets   = new Map();

function isInternalIp(ra) {
  ra = (ra || '').replace('::ffff:', '');
  if (ra === '127.0.0.1' || ra === '::1') return true;
  return /^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)/.test(ra);
}

app.use('/api', (req, res, next) => {
  const ra = (req.ip || req.connection.remoteAddress || '').replace('::ffff:', '');
  if (isInternalIp(ra)) return next(); // never throttle internal callers
  const now = Date.now();
  let b = _rateBuckets.get(ra);
  if (!b || b.resetAt < now) {
    b = { count: 0, resetAt: now + RATE_WINDOW_MS };
    _rateBuckets.set(ra, b);
  }
  b.count++;
  // Soft GC: if map gets huge, prune expired buckets.
  if (_rateBuckets.size > 5000) {
    for (const [k, v] of _rateBuckets) if (v.resetAt < now) _rateBuckets.delete(k);
  }
  if (b.count > RATE_MAX) {
    res.setHeader('Retry-After', Math.max(1, Math.ceil((b.resetAt - now) / 1000)));
    res.setHeader('X-RateLimit-Limit', String(RATE_MAX));
    res.setHeader('X-RateLimit-Window', String(Math.floor(RATE_WINDOW_MS / 1000)));
    audit('api.rateLimit', { ip: ra, count: b.count, path: req.path });
    return res.status(429).json({ ok: false, reason: 'rate_limit', retryAfterSec: Math.ceil((b.resetAt - now) / 1000) });
  }
  next();
});

// ---------- Optional bearer-token auth (env-gated) ----------
// If ATS_OPS_KEY is set in /etc/ats/backend.env, the following routes require
// Authorization: Bearer <ATS_OPS_KEY>. Internal IPs are exempt (auto-login flows).
//
// Protected:
//   - GET  /api/audit          (operational event log)
//   - any POST/PUT/DELETE on /api/*  (mutations: alerts CRUD, watchlist mutations,
//     order place, scanner trigger, backtest endpoints)
// Public:
//   - GETs on health/quotes/symbols/historical/etc (already public, market data)
const ATS_OPS_KEY = process.env.ATS_OPS_KEY || '';
const AUTH_REQUIRED = !!ATS_OPS_KEY;

function authMiddleware(req, res, next) {
  if (!AUTH_REQUIRED) return next(); // dev / opt-out mode
  const ra = (req.ip || req.connection.remoteAddress || '').replace('::ffff:', '');
  if (isInternalIp(ra)) return next();  // internal callers always allowed
  const h = req.headers['authorization'] || '';
  if (!h.startsWith('Bearer ')) {
    res.setHeader('WWW-Authenticate', 'Bearer realm="ats"');
    return res.status(401).json({ ok: false, reason: 'missing_bearer' });
  }
  const token = h.slice(7).trim();
  if (token !== ATS_OPS_KEY) {
    audit('api.auth.fail', { ip: ra, path: req.path });
    return res.status(403).json({ ok: false, reason: 'invalid_token' });
  }
  next();
}

// Apply: gate all mutating methods + /api/audit
app.use('/api', (req, res, next) => {
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE' || req.method === 'PATCH') {
    return authMiddleware(req, res, next);
  }
  if (req.path === '/audit' || req.path.startsWith('/audit?')) {
    return authMiddleware(req, res, next);
  }
  next();
});

// Tell clients whether auth is enabled (frontend uses this to know if Bearer needed).
app.get('/api/auth-mode', (_req, res) => {
  res.json({ ok: true, authRequired: AUTH_REQUIRED });
});

// ---------- Dashboard summary ----------
// One call returns everything the cockpit's home view needs.
// Failures of any single broker call degrade gracefully — partial responses
// are tagged with an `errors` map so the UI can render whatever succeeded.
app.get('/api/summary', async (_req, res) => {
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

  // Compact aggregates so a tiny dashboard card has everything pre-computed.
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

// ---------- System info (ops dashboard aggregator) ----------
// One call returns everything an "Infrastructure" panel needs.
app.get('/api/system/info', (_req, res) => {
  const fs = require('fs');
  let auditSize = 0, auditLastTs = null;
  try {
    if (fs.existsSync(AUDIT_LOG)) {
      const stat = fs.statSync(AUDIT_LOG);
      auditSize = stat.size;
      auditLastTs = new Date(stat.mtimeMs).toISOString();
    }
  } catch {}

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
        ordersInWindow: _orderTimes.length,
      },
    },
    auditLog: { path: AUDIT_LOG, sizeBytes: auditSize, lastWriteTs: auditLastTs, seq: auditSeq },
    config: {
      maxWsClients: MAX_WS_CLIENTS,
      defaultSymbols: DEFAULT_SYMBOLS,
      brokerName: broker.name,
    },
  });
});

// ---------- Prometheus /metrics ----------
// Plain text exposition format (no client lib). Scrapeable by Prometheus / Datadog / VictoriaMetrics.
// Loopback or internal IPs only -- public exposure of internal counters is a small info leak.
app.get('/metrics', (req, res) => {
  const ra = (req.ip || req.connection.remoteAddress || '').replace('::ffff:', '');
  if (!isInternalIp(ra)) {
    // Allow GH Actions + monitoring tools that pass a shared metrics token if configured.
    const tok = process.env.ATS_METRICS_TOKEN || '';
    if (!tok || req.headers['x-metrics-token'] !== tok) {
      return res.status(403).type('text/plain').send('forbidden');
    }
  }
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
  push('Audit log seq number',           'counter', 'ats_audit_seq_total',     auditSeq);
  push('Active /ws client connections',  'gauge',   'ats_ws_clients',          wsClients.size);
  push('Process uptime seconds',         'counter', 'ats_process_uptime_seconds', Math.floor(process.uptime()));
  push('Process RSS bytes',              'gauge',   'ats_process_rss_bytes',   process.memoryUsage().rss);
  push('KILL_SWITCH active (1=killed)',  'gauge',   'ats_kill_switch',         KILL_SWITCH ? 1 : 0);
  res.type('text/plain; version=0.0.4').send(lines.join('\n') + '\n');
});

// ---------- Kite order postback webhook ----------
// Kite calls this URL when order events fire (FILLED, REJECTED, CANCELLED, MODIFIED, etc).
// Configure the URL in the Kite developer dashboard: https://developers.kite.trade/apps/
// Set "Postback URL" to:  https://ats.rajasekarselvam.com/api/brokers/zerodha/postback
//
// Kite signs the payload with sha256(order_id + status + api_secret).
// We verify, audit, fan out to /ws clients, and Telegram-notify on FILLED/REJECTED.
app.post('/api/brokers/zerodha/postback', (req, res) => {
  const body = req.body || {};
  if (!body.order_id || !body.status || !body.checksum) {
    audit('postback.invalid', { reason: 'missing_required_fields', body });
    return res.status(400).json({ ok: false, reason: 'missing required fields' });
  }
  // HMAC verification
  const expected = crypto
    .createHash('sha256')
    .update(String(body.order_id) + String(body.status) + (process.env.ZERODHA_API_SECRET || process.env.KITE_API_SECRET || ''))
    .digest('hex');
  if (expected !== String(body.checksum).toLowerCase()) {
    audit('postback.invalid', { reason: 'checksum_mismatch', orderId: body.order_id, status: body.status });
    return res.status(401).json({ ok: false, reason: 'checksum mismatch' });
  }
  // Verified — audit it.
  audit('postback.received', {
    orderId: body.order_id,
    status: body.status,
    symbol: body.tradingsymbol,
    side: body.transaction_type,
    qty: body.filled_quantity,
    avg: body.average_price,
  });

  // Fan out to /ws clients so the UI can update order tables in real time.
  const payload = JSON.stringify({
    type: 'order_update',
    orderId:     body.order_id,
    status:      body.status,
    symbol:      body.tradingsymbol,
    exchange:    body.exchange,
    side:        body.transaction_type,
    quantity:    body.quantity,
    filledQty:   body.filled_quantity,
    pendingQty:  body.pending_quantity,
    price:       body.price,
    avgPrice:    body.average_price,
    statusMsg:   body.status_message,
    ts:          Date.now(),
  });
  for (const ws of wsClients) {
    if (ws.readyState === 1) ws.send(payload);
  }

  // Telegram notification on terminal states.
  const terminal = ['COMPLETE', 'REJECTED', 'CANCELLED'];
  if (terminal.includes(String(body.status).toUpperCase())) {
    const emoji = body.status === 'COMPLETE' ? 'success' : 'warn';
    notify(emoji, `Order ${body.status}: ${body.tradingsymbol}`, {
      body: body.status_message || '',
      fields: {
        orderId:  body.order_id,
        side:     body.transaction_type,
        qty:      `${body.filled_quantity || 0} / ${body.quantity || 0}`,
        avgPrice: body.average_price || '-',
      },
    }).catch(() => {});
  }

  res.json({ ok: true, received: true });
});

// Health
app.get('/api/health', (_req, res) => {
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
  });
});

// ---------- Watchlist snapshot ----------
// GET /api/watchlist/snapshot
// Returns watchlist symbols + per-symbol LTP + day change (in absolute and %).
// One round trip for the dashboard's watchlist table.
app.get('/api/watchlist/snapshot', async (_req, res) => {
  if (!watchlist) return res.status(503).json({ ok: false, reason: 'watchlist_not_initialized' });
  const symbols = watchlist.list();
  if (symbols.length === 0) return res.json({ ok: true, rows: [] });
  try {
    // Strip indices from /quotes (Kite uses different keying); we'll still include them but with null prices.
    const eq = symbols.filter(s => !/^(NIFTY|BANKNIFTY|SENSEX|FINNIFTY|MIDCPNIFTY|INDIA VIX)/i.test(s));
    const quotes = eq.length ? await broker.getQuotes(eq) : {};
    const rows = symbols.map((sym) => {
      const key = `NSE:${sym}`;
      const q = quotes[key];
      if (!q || typeof q.last_price !== 'number') {
        return { symbol: sym, ltp: null, close: null, change: null, changePct: null, volume: null };
      }
      const close = q.ohlc && typeof q.ohlc.close === 'number' ? q.ohlc.close : q.last_price;
      const change = +(q.last_price - close).toFixed(2);
      const changePct = close ? +(((q.last_price - close) / close) * 100).toFixed(2) : 0;
      return {
        symbol: sym,
        ltp: q.last_price,
        close,
        change,
        changePct,
        volume: q.volume || null,
        ohlc: q.ohlc || null,
      };
    });
    res.json({ ok: true, count: rows.length, rows });
  } catch (e) {
    res.status(500).json({ ok: false, reason: e.message });
  }
});

// ---------- Top movers ----------
// GET /api/movers?limit=10
// Reuses the snapshot logic, sorts by abs(changePct), splits into gainers/losers.
app.get('/api/movers', async (req, res) => {
  if (!watchlist) return res.status(503).json({ ok: false, reason: 'watchlist_not_initialized' });
  const limit = Math.max(1, Math.min(50, parseInt(req.query.limit || '10', 10) || 10));
  const symbols = watchlist.list().filter(s => !/^(NIFTY|BANKNIFTY|SENSEX|FINNIFTY|MIDCPNIFTY|INDIA VIX)/i.test(s));
  if (symbols.length === 0) return res.json({ ok: true, gainers: [], losers: [] });
  try {
    const quotes = await broker.getQuotes(symbols);
    const rows = [];
    for (const sym of symbols) {
      const q = quotes[`NSE:${sym}`];
      if (!q || typeof q.last_price !== 'number') continue;
      const close = q.ohlc && typeof q.ohlc.close === 'number' ? q.ohlc.close : q.last_price;
      if (!close) continue;
      const changePct = +(((q.last_price - close) / close) * 100).toFixed(2);
      rows.push({ symbol: sym, ltp: q.last_price, close, change: +(q.last_price - close).toFixed(2), changePct });
    }
    const gainers = [...rows].filter(r => r.changePct > 0).sort((a, b) => b.changePct - a.changePct).slice(0, limit);
    const losers  = [...rows].filter(r => r.changePct < 0).sort((a, b) => a.changePct - b.changePct).slice(0, limit);
    res.json({ ok: true, gainers, losers, total: rows.length });
  } catch (e) {
    res.status(500).json({ ok: false, reason: e.message });
  }
});

// ---------- Audit log reader ----------
// GET /api/audit?since=ISO&event=order.dryRun&limit=50
// Read-only paginated view of the JSONL audit log.
app.get('/api/audit', (req, res) => {
  try {
    if (!fs.existsSync(AUDIT_LOG)) return res.json({ ok: true, rows: [], note: 'no audit log yet' });
    const limit  = Math.max(1, Math.min(500, parseInt(req.query.limit || '50', 10) || 50));
    const sinceQ = req.query.since ? new Date(String(req.query.since)).getTime() : 0;
    const eventQ = typeof req.query.event === 'string' ? String(req.query.event) : null;

    // Slurp & parse — audit log is rotated daily (logrotate keeps it well under a few MB).
    const raw = fs.readFileSync(AUDIT_LOG, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    // Walk in reverse to find newest matches first.
    const rows = [];
    for (let i = lines.length - 1; i >= 0 && rows.length < limit; i--) {
      let obj;
      try { obj = JSON.parse(lines[i]); } catch { continue; }
      if (!obj || !obj.ts) continue;
      if (sinceQ && new Date(obj.ts).getTime() < sinceQ) break; // log is roughly chronological
      if (eventQ && obj.event !== eventQ) continue;
      rows.push(obj);
    }
    res.json({ ok: true, count: rows.length, rows });
  } catch (e) {
    res.status(500).json({ ok: false, reason: e.message });
  }
});

// ---------- Symbol metadata ----------
// GET /api/symbol/:symbol  - lot/segment/strike/expiry + latest quote
app.get('/api/symbol/:symbol', async (req, res) => {
  try {
    const sym = req.params.symbol;
    const meta = typeof broker.symbolMeta === 'function' ? broker.symbolMeta(sym) : null;
    if (!meta) return res.status(404).json({ ok: false, reason: 'symbol_not_found' });

    let quote = null;
    try {
      const q = await broker.getQuotes([sym]);
      const k = `${meta.exchange}:${meta.tradingsymbol}`;
      quote = q[k] || q[`NSE:${meta.tradingsymbol}`] || null;
    } catch { /* quote fetch can fail for indices, that's fine */ }

    res.json({ ok: true, symbol: sym, meta, quote });
  } catch (e) {
    res.status(500).json({ ok: false, reason: e.message });
  }
});

// ---------- Option chain ----------
// GET /api/option-expiries?underlying=NIFTY
app.get('/api/option-expiries', (req, res) => {
  try {
    const u = String(req.query.underlying || '').trim();
    if (!u) return res.status(400).json({ ok: false, reason: 'underlying required' });
    const list = typeof broker.listOptionExpiries === 'function' ? broker.listOptionExpiries(u) : [];
    res.json({ ok: true, underlying: u.toUpperCase(), expiries: list, count: list.length });
  } catch (e) {
    res.status(500).json({ ok: false, reason: e.message });
  }
});

// GET /api/option-chain?symbol=NIFTY&expiry=2026-05-29&includeQuotes=true&strikes=10&spot=23400
app.get('/api/option-chain', async (req, res) => {
  try {
    const underlying = String(req.query.symbol || req.query.underlying || '').trim();
    const expiry     = String(req.query.expiry || '').trim();
    if (!underlying || !expiry) return res.status(400).json({ ok: false, reason: 'symbol and expiry required' });
    const includeQuotes = req.query.includeQuotes === '1' || req.query.includeQuotes === 'true';
    const strikesAround = Math.max(1, Math.min(50, parseInt(req.query.strikes || '10', 10) || 10));

    const chain = broker.getOptionChain(underlying, expiry);

    // Spot resolution order: explicit ?spot query > in-memory tick cache > REST quote (indices) > null.
    let spot = null;
    if (req.query.spot) {
      const s = Number(req.query.spot);
      if (Number.isFinite(s) && s > 0) spot = s;
    }
    if (spot == null) {
      try {
        const ticks = broker.getLastTicks ? broker.getLastTicks() : [];
        const indexSymbolMap = { 'NIFTY':'NIFTY 50', 'BANKNIFTY':'NIFTY BANK', 'FINNIFTY':'NIFTY FIN SERVICE' };
        const want = indexSymbolMap[underlying.toUpperCase()] || underlying;
        const hit = ticks.find(t => t.symbol === want);
        if (hit) spot = hit.ltp;
      } catch {}
    }

    // If still no spot, try REST quote for indices (needs "NSE:NIFTY 50" key).
    if (spot == null && typeof broker.getQuotes === 'function') {
      try {
        const indexSymbolMap = { 'NIFTY':'NIFTY 50', 'BANKNIFTY':'NIFTY BANK', 'FINNIFTY':'NIFTY FIN SERVICE' };
        const idxSym = indexSymbolMap[underlying.toUpperCase()];
        if (idxSym) {
          const q = await broker.getQuotes([idxSym]);
          const v = q && (q[`NSE:${idxSym}`] || q[idxSym]);
          if (v && typeof v.last_price === 'number') spot = v.last_price;
        }
      } catch {}
    }

    // Quote enrichment for top-N strikes around ATM.
    let enrichedCount = 0;
    if (includeQuotes && chain.strikes.length > 0) {
      let atmIdx = Math.floor(chain.strikes.length / 2);
      if (spot != null) {
        let bestDiff = Infinity;
        for (let i = 0; i < chain.strikes.length; i++) {
          const diff = Math.abs(chain.strikes[i].strike - spot);
          if (diff < bestDiff) { bestDiff = diff; atmIdx = i; }
        }
      }
      const lo = Math.max(0, atmIdx - strikesAround);
      const hi = Math.min(chain.strikes.length - 1, atmIdx + strikesAround);

      const symbols = [];
      for (let i = lo; i <= hi; i++) {
        const r = chain.strikes[i];
        if (r.ce) symbols.push(`NFO:${r.ce.tradingsymbol}`);
        if (r.pe) symbols.push(`NFO:${r.pe.tradingsymbol}`);
      }
      if (symbols.length > 0) {
        try {
          const quotes = await broker.getQuotes(symbols);
          for (let i = lo; i <= hi; i++) {
            const r = chain.strikes[i];
            const decorate = (leg) => {
              if (!leg) return;
              const k = `NFO:${leg.tradingsymbol}`;
              const v = quotes[k];
              if (v) {
                leg.ltp = v.last_price;
                leg.oi = v.oi;
                leg.volume = v.volume;
                leg.netChange = v.net_change;
                if (v.ohlc) leg.ohlc = v.ohlc;
                enrichedCount++;
              }
            };
            decorate(r.ce);
            decorate(r.pe);
          }
        } catch (e) {
          // Don't fail the whole request -- return the structure without quotes.
          console.warn('[option-chain] quote enrichment failed:', e.message);
        }
      }
      chain.atmIndex = atmIdx;
      chain.enriched = { from: lo, to: hi, legsQuoted: enrichedCount };
    }

    res.json({ ok: true, spot, ...chain });
  } catch (e) {
    res.status(400).json({ ok: false, reason: e.message });
  }
});

// ---------- Indices snapshot ----------
// Returns current LTPs for major indices from the in-memory tick cache (since /quotes
// doesn't return indices cleanly via NSE:NIFTY key).
app.get('/api/indices/snapshot', (_req, res) => {
  try {
    const ticks = broker.getLastTicks ? broker.getLastTicks() : [];
    const wanted = ['NIFTY 50','NIFTY BANK','BANKNIFTY','SENSEX','FINNIFTY','NIFTY FIN SERVICE','MIDCPNIFTY','NIFTY MIDCAP 100','INDIA VIX'];
    const map = new Map(ticks.map(t => [t.symbol, t]));
    const rows = [];
    for (const sym of wanted) {
      const t = map.get(sym);
      if (t) rows.push({ symbol: sym, ltp: t.ltp, ts: t.ts });
    }
    res.json({ ok: true, count: rows.length, rows });
  } catch (e) {
    res.status(500).json({ ok: false, reason: e.message });
  }
});

// ---------- Position-size calculator ----------
// GET /api/calc/position-size?account=100000&riskPct=1&stopLossPct=2&entryPrice=100
// Pure math: qty = floor((account * riskPct/100) / (entryPrice * stopLossPct/100))
app.get('/api/calc/position-size', (req, res) => {
  try {
    const account     = Number(req.query.account);
    const riskPct     = Number(req.query.riskPct || 1);
    const stopLossPct = Number(req.query.stopLossPct);
    const entryPrice  = Number(req.query.entryPrice || 0);
    if (!Number.isFinite(account) || account <= 0)         return res.status(400).json({ ok:false, reason:'account must be positive' });
    if (!Number.isFinite(riskPct) || riskPct <= 0)         return res.status(400).json({ ok:false, reason:'riskPct must be positive' });
    if (!Number.isFinite(stopLossPct) || stopLossPct <= 0) return res.status(400).json({ ok:false, reason:'stopLossPct must be positive' });

    const riskAmount = +(account * (riskPct / 100)).toFixed(2);
    // If entryPrice given, compute qty using per-share risk. Else just return riskAmount.
    let qty = null, perShareRisk = null, capitalDeployed = null;
    if (entryPrice > 0) {
      perShareRisk = +(entryPrice * (stopLossPct / 100)).toFixed(4);
      qty = Math.floor(riskAmount / perShareRisk);
      capitalDeployed = +(qty * entryPrice).toFixed(2);
    }

    res.json({
      ok: true,
      inputs: { account, riskPct, stopLossPct, entryPrice: entryPrice || null },
      riskAmount,
      perShareRisk,
      suggestedQty: qty,
      capitalDeployed,
      capitalUtilizationPct: capitalDeployed != null ? +(capitalDeployed / account * 100).toFixed(2) : null,
    });
  } catch (e) {
    res.status(500).json({ ok: false, reason: e.message });
  }
});

// ---------- Strategy registry ----------
// Source-of-truth catalog for backtest + scanner + future UI.
const STRATEGIES = [
  {
    id: 'rsi_mean_revert',
    name: 'RSI mean reversion',
    description: 'Long-only: BUY when RSI(period) < entryRsi; SELL when RSI > exitRsi.',
    bias: 'mean-reverting markets, range-bound',
    params: [
      { name: 'period',   type: 'int',   default: 14, min: 2,  max: 100 },
      { name: 'entryRsi', type: 'float', default: 30, min: 1,  max: 99 },
      { name: 'exitRsi',  type: 'float', default: 70, min: 1,  max: 99 },
    ],
  },
  {
    id: 'ema_cross',
    name: 'EMA cross',
    description: 'Long-only: BUY when close crosses above N-EMA; SELL when crosses below.',
    bias: 'trending markets',
    params: [
      { name: 'period', type: 'int', default: 20, min: 2, max: 200 },
    ],
  },
  {
    id: 'macd_cross',
    name: 'MACD signal cross',
    description: 'Long-only: BUY when MACD(fast,slow) line crosses above signal line; SELL on opposite cross.',
    bias: 'trending markets, momentum',
    params: [
      { name: 'fast',   type: 'int', default: 12, min: 2,  max: 50 },
      { name: 'slow',   type: 'int', default: 26, min: 3,  max: 200 },
      { name: 'signal', type: 'int', default: 9,  min: 2,  max: 50 },
    ],
  },
  {
    id: 'bollinger',
    name: 'Bollinger band mean reversion',
    description: 'Long-only: BUY when close crosses below lower band (oversold); SELL when close crosses above middle band.',
    bias: 'mean-reverting markets, range-bound',
    params: [
      { name: 'period', type: 'int',   default: 20, min: 5,    max: 200 },
      { name: 'k',      type: 'float', default: 2,  min: 0.5,  max: 5 },
    ],
  },
  // ---------- Tier 16: 3 new TA strategies (toward the 22-layer goal) ----------
  {
    id: 'supertrend',
    name: 'Supertrend',
    description: 'Long-only: BUY on Supertrend flip up; SELL on flip down. Uses ATR-based upper/lower bands.',
    bias: 'trending markets',
    params: [
      { name: 'period',     type: 'int',   default: 10, min: 5,   max: 50 },
      { name: 'multiplier', type: 'float', default: 3,  min: 1,   max: 8 },
    ],
  },
  {
    id: 'adx_trend',
    name: 'ADX trend filter',
    description: 'Long-only: BUY when ADX > threshold and +DI > -DI (strong uptrend); SELL on opposite. Skips trade when ADX < threshold.',
    bias: 'strongly trending markets',
    params: [
      { name: 'period',    type: 'int',   default: 14, min: 5,   max: 50 },
      { name: 'threshold', type: 'float', default: 25, min: 10,  max: 50 },
    ],
  },
  {
    id: 'donchian',
    name: 'Donchian breakout',
    description: 'Long-only: BUY when close breaks above N-period rolling high; SELL when close breaks below rolling low. Classic Turtle-trader rule.',
    bias: 'trending markets, breakout',
    params: [
      { name: 'period', type: 'int', default: 20, min: 5, max: 100 },
    ],
  },
  // ---------- Tier 17: 3 more TA strategies (10 total, building toward 22-layer goal) ----------
  {
    id: 'stochastic',
    name: 'Stochastic %K cross',
    description: 'Long-only: BUY when %K crosses above %D in oversold region; SELL when %K crosses below %D in overbought region.',
    bias: 'mean-reverting markets, oscillating',
    params: [
      { name: 'period',     type: 'int',   default: 14, min: 5,  max: 50 },
      { name: 'smoothK',    type: 'int',   default: 3,  min: 1,  max: 10 },
      { name: 'smoothD',    type: 'int',   default: 3,  min: 1,  max: 10 },
      { name: 'oversold',   type: 'float', default: 20, min: 0,  max: 50 },
      { name: 'overbought', type: 'float', default: 80, min: 50, max: 100 },
    ],
  },
  {
    id: 'williams_r',
    name: "Williams %R",
    description: 'Long-only: BUY when %R crosses up through oversold (-80 default); SELL when %R crosses down through overbought (-20).',
    bias: 'mean-reverting markets, oscillating',
    params: [
      { name: 'period',     type: 'int',   default: 14, min: 5,    max: 50 },
      { name: 'oversold',   type: 'float', default: -80, min: -100, max: -50 },
      { name: 'overbought', type: 'float', default: -20, min: -50,  max: 0   },
    ],
  },
  {
    id: 'heikin_ashi',
    name: 'Heikin-Ashi trend',
    description: 'Long-only: BUY after N consecutive bullish Heikin-Ashi candles; SELL after N consecutive bearish ones.',
    bias: 'trending markets, momentum',
    params: [
      { name: 'run', type: 'int', default: 3, min: 2, max: 10 },
    ],
  },
  // ---------- Tier 18: 4 more TA strategies (14 total) ----------
  {
    id: 'cci',
    name: 'Commodity Channel Index',
    description: 'Long-only: BUY when CCI crosses up through -threshold (oversold exit); SELL when CCI crosses down through +threshold.',
    bias: 'mean-reverting markets',
    params: [
      { name: 'period',    type: 'int',   default: 20,  min: 5,  max: 100 },
      { name: 'threshold', type: 'float', default: 100, min: 50, max: 200 },
    ],
  },
  {
    id: 'keltner',
    name: 'Keltner Channels',
    description: 'Long-only: BUY on close break above EMA + k*ATR; SELL on close break below EMA - k*ATR. Breakout strategy.',
    bias: 'trending markets, breakout',
    params: [
      { name: 'period',     type: 'int',   default: 20, min: 5,   max: 100 },
      { name: 'multiplier', type: 'float', default: 2,  min: 0.5, max: 5 },
    ],
  },
  {
    id: 'obv',
    name: 'OBV divergence',
    description: 'Long-only: BUY on bullish OBV/price divergence (price lower-low + OBV higher-low); SELL on bearish divergence.',
    bias: 'turn-detection, mean-reverting',
    params: [
      { name: 'lookback', type: 'int', default: 20, min: 5, max: 100 },
    ],
  },
  {
    id: 'psar',
    name: 'Parabolic SAR',
    description: 'Long-only: BUY on SAR flip from downtrend to uptrend; SELL on flip back. Trend-following stop-and-reverse.',
    bias: 'trending markets, stop-and-reverse',
    params: [
      { name: 'acceleration',    type: 'float', default: 0.02, min: 0.005, max: 0.1 },
      { name: 'maxAcceleration', type: 'float', default: 0.2,  min: 0.05,  max: 0.5 },
    ],
  },
  // ---------- Tier 19: 4 more TA strategies (18 total) ----------
  {
    id: 'aroon',
    name: 'Aroon oscillator',
    description: 'Long-only: BUY when Aroon Up crosses above Aroon Down; SELL when crosses below. Trend-strength oscillator.',
    bias: 'trending markets, regime-change',
    params: [
      { name: 'period', type: 'int', default: 14, min: 5, max: 50 },
    ],
  },
  {
    id: 'cmf',
    name: 'Chaikin Money Flow',
    description: 'Long-only: BUY when CMF crosses up through +threshold (accumulation); SELL when CMF crosses down through -threshold (distribution).',
    bias: 'volume-confirmation, trending',
    params: [
      { name: 'period',    type: 'int',   default: 20,   min: 5,    max: 100 },
      { name: 'threshold', type: 'float', default: 0.05, min: 0.01, max: 0.3 },
    ],
  },
  {
    id: 'atr_trail',
    name: 'ATR trailing stop',
    description: 'Long-only: enter when close above EMA; exit when close drops below highest-high minus k*ATR trailing stop.',
    bias: 'trending markets, exit-discipline',
    params: [
      { name: 'period',     type: 'int',   default: 14, min: 5,   max: 50 },
      { name: 'multiplier', type: 'float', default: 3,  min: 1,   max: 8 },
    ],
  },
  {
    id: 'ichimoku',
    name: 'Ichimoku Tenkan/Kijun cross',
    description: 'Long-only: BUY when Tenkan (9-period mid) crosses above Kijun (26-period mid); SELL on opposite cross. Simplified Ichimoku.',
    bias: 'trending markets, momentum',
    params: [
      { name: 'tenkan', type: 'int', default: 9,  min: 3, max: 30 },
      { name: 'kijun',  type: 'int', default: 26, min: 9, max: 60 },
    ],
  },
  // ---------- Tier 20: 4 final TA strategies (22 total -- spec target reached) ----------
  {
    id: 'vwap',
    name: 'VWAP cross (rolling)',
    description: 'Long-only: BUY when close crosses above N-period rolling VWAP; SELL on opposite. Volume-weighted trend filter.',
    bias: 'trending markets, volume-aware',
    params: [
      { name: 'period', type: 'int', default: 20, min: 5, max: 100 },
    ],
  },
  {
    id: 'pivot',
    name: 'Pivot Points (R1/S1)',
    description: 'Long-only: BUY when close breaks above prior-day R1 pivot; SELL when close breaks below S1. Classic floor-trader rule.',
    bias: 'breakout markets',
    params: [],
  },
  {
    id: 'mfi',
    name: 'Money Flow Index',
    description: 'Long-only: BUY when MFI crosses up through oversold; SELL when MFI crosses down through overbought. Volume-weighted RSI.',
    bias: 'mean-reverting markets, volume-aware',
    params: [
      { name: 'period',     type: 'int',   default: 14, min: 5,  max: 50 },
      { name: 'oversold',   type: 'float', default: 20, min: 5,  max: 40 },
      { name: 'overbought', type: 'float', default: 80, min: 60, max: 95 },
    ],
  },
  {
    id: 'trix',
    name: 'TRIX',
    description: 'Long-only: BUY when TRIX (triple-smoothed EMA momentum) crosses above its signal line; SELL on opposite. Noise-resistant momentum.',
    bias: 'trending markets, momentum',
    params: [
      { name: 'period', type: 'int', default: 15, min: 5, max: 50 },
      { name: 'signal', type: 'int', default: 9,  min: 3, max: 30 },
    ],
  },
];

app.get('/api/strategies', (_req, res) => {
  res.json({ ok: true, strategies: STRATEGIES });
});

// ---------- Backtest ----------
// POST /api/backtest  body: { symbol, strategy, from, to, qty?, params? }
const BACKTEST_MAX_DAYS = parseInt(process.env.BACKTEST_MAX_DAYS || '1825', 10); // 5 years
app.post('/api/backtest', async (req, res) => {
  try {
    const { symbol, strategy, from, to, qty, params, interval } = req.body || {};
    if (!symbol)   return res.status(400).json({ ok:false, reason:'symbol required' });
    if (!strategy) return res.status(400).json({ ok:false, reason:'strategy required (rsi_mean_revert | ema_cross | macd_cross | bollinger)' });
    if (!from || !to) return res.status(400).json({ ok:false, reason:'from and to required (YYYY-MM-DD)' });
    // Bound date range.
    const dFrom = new Date(String(from));
    const dTo   = new Date(String(to));
    if (!isFinite(dFrom.getTime()) || !isFinite(dTo.getTime())) {
      return res.status(400).json({ ok: false, reason: 'from/to must be valid dates' });
    }
    const days = Math.floor((dTo.getTime() - dFrom.getTime()) / (86400 * 1000));
    if (days < 0) return res.status(400).json({ ok: false, reason: 'to must be after from' });
    if (days > BACKTEST_MAX_DAYS) {
      return res.status(400).json({ ok: false, reason: `range too wide: ${days}d > ${BACKTEST_MAX_DAYS}d max (set BACKTEST_MAX_DAYS env to override)` });
    }

    const candles = await broker.getHistorical({
      symbol, interval: interval || 'day', from, to,
    });
    if (!Array.isArray(candles) || candles.length < 30) {
      return res.status(400).json({ ok:false, reason:`need >= 30 candles, got ${candles ? candles.length : 0}` });
    }

    const result = runBacktest({
      candles,
      strategy,
      params: params || {},
      qty: Number(qty) || 1,
    });
    audit('backtest.run', { symbol, strategy, bars: result.bars, trades: result.stats.trades, pnl: result.stats.totalPnl });
    res.json({ ok: true, symbol, from, to, ...result });
  } catch (e) {
    res.status(400).json({ ok: false, reason: e.message });
  }
});

// ---------- Paper trading ----------
app.get('/api/paper', (_req, res) => {
  if (!paper) return res.status(503).json({ ok:false, reason:'paper_not_initialized' });
  res.json({ ok:true, stats: paper.stats() });
});
app.get('/api/paper/orders', (_req, res) => {
  if (!paper) return res.status(503).json({ ok:false, reason:'paper_not_initialized' });
  res.json({ ok:true, orders: paper.list() });
});
app.get('/api/paper/positions', (_req, res) => {
  if (!paper) return res.status(503).json({ ok:false, reason:'paper_not_initialized' });
  res.json({ ok:true, positions: paper.positions() });
});
app.get('/api/paper/trades', (req, res) => {
  if (!paper) return res.status(503).json({ ok:false, reason:'paper_not_initialized' });
  const lim = parseInt(req.query.limit || '50', 10) || 50;
  res.json({ ok:true, trades: paper.trades(lim) });
});
app.post('/api/paper/order', (req, res) => {
  if (!paper) return res.status(503).json({ ok:false, reason:'paper_not_initialized' });
  try {
    const o = paper.placeOrder(req.body || {});
    res.status(201).json({ ok:true, order:o });
  } catch (e) { res.status(400).json({ ok:false, reason:e.message }); }
});
app.delete('/api/paper/order/:id', (req, res) => {
  if (!paper) return res.status(503).json({ ok:false, reason:'paper_not_initialized' });
  res.json({ ok:true, ...paper.cancelOrder(req.params.id) });
});
app.post('/api/paper/reset', (req, res) => {
  if (!paper) return res.status(503).json({ ok:false, reason:'paper_not_initialized' });
  // Tier 28: optional { tier: '10L' | '25L' | '50L' } or { startingCash: <int> }.
  try {
    const r = paper.reset(req.body || {});
    res.json({ ok:true, ...r, stats: paper.stats() });
  } catch (e) { res.status(400).json({ ok:false, reason:e.message }); }
});

// Tier 28: expose available paper tiers.
app.get('/api/paper/tiers', (_req, res) => {
  if (!paper) return res.status(503).json({ ok:false, reason:'paper_not_initialized' });
  res.json({ ok:true, tiers: paper.availableTiers(), current: paper.stats().cash + paper.stats().totalEquity ? paper.stats() : null });
});

// ---------- P&L Attribution ----------
// GET /api/pnl/daily?days=30 -- equity time series
app.get('/api/pnl/daily', (req, res) => {
  if (!pnl) return res.status(503).json({ ok:false, reason:'pnl_not_initialized' });
  const days = Math.max(1, Math.min(730, parseInt(req.query.days || '30', 10) || 30));
  res.json({ ok:true, days, rows: pnl.history(days), stats: pnl.stats() });
});
// GET /api/pnl/by-strategy -- aggregated closed-trade ledger
app.get('/api/pnl/by-strategy', (_req, res) => {
  if (!pnl) return res.status(503).json({ ok:false, reason:'pnl_not_initialized' });
  res.json({ ok:true, strategies: pnl.byStrategy() });
});
// POST /api/pnl/snapshot -- manual snapshot trigger (ops endpoint)
app.post('/api/pnl/snapshot', (_req, res) => {
  if (!pnl) return res.status(503).json({ ok:false, reason:'pnl_not_initialized' });
  const row = pnl.snapshot();
  res.json({ ok:true, row });
});

// ---------- Strategy auto-runner ----------
// GET /api/autorun -- current config + last 25 runs + stats
app.get('/api/autorun', (_req, res) => {
  if (!autorun) return res.status(503).json({ ok:false, reason:'autorun_not_initialized' });
  res.json({ ok:true, config: autorun.config(), stats: autorun.stats(), history: autorun.history(25) });
});
// PUT /api/autorun  body: { enabled, strategy, symbol, params, qty, interval, intervalMinutes, candleLookbackDays }
app.put('/api/autorun', (req, res) => {
  if (!autorun) return res.status(503).json({ ok:false, reason:'autorun_not_initialized' });
  try {
    const cfg = autorun.setConfig(req.body || {});
    res.json({ ok:true, config: cfg, stats: autorun.stats() });
  } catch (e) { res.status(400).json({ ok:false, reason:e.message }); }
});
// POST /api/autorun/run -- manual evaluation trigger
app.post('/api/autorun/run', async (_req, res) => {
  if (!autorun) return res.status(503).json({ ok:false, reason:'autorun_not_initialized' });
  try {
    const run = await autorun.runOnce({ source: 'manual' });
    res.json({ ok:true, run });
  } catch (e) { res.status(500).json({ ok:false, reason:e.message }); }
});
// DELETE /api/autorun -- clear config + stop timer
app.delete('/api/autorun', (_req, res) => {
  if (!autorun) return res.status(503).json({ ok:false, reason:'autorun_not_initialized' });
  autorun.clearConfig();
  res.json({ ok:true, stats: autorun.stats() });
});

// ---------- News feed ----------
// GET /api/news?limit=50&symbol=RELIANCE&source=Moneycontrol
app.get('/api/news', (req, res) => {
  if (!news) return res.status(503).json({ ok:false, reason:'news_not_initialized' });
  const items = news.list({ limit: req.query.limit, symbol: req.query.symbol, source: req.query.source });
  res.json({ ok:true, items, stats: news.stats() });
});
// POST /api/news/refresh -- manual fetch trigger (returns summary)
app.post('/api/news/refresh', async (_req, res) => {
  if (!news) return res.status(503).json({ ok:false, reason:'news_not_initialized' });
  const summary = await news.refresh();
  res.json({ ok:true, summary, stats: news.stats() });
});
// GET /api/news/sources -- configured sources + last-fetch counts
app.get('/api/news/sources', (_req, res) => {
  if (!news) return res.status(503).json({ ok:false, reason:'news_not_initialized' });
  res.json({ ok:true, sources: news.stats().sources, lastSummary: news.stats().lastSummary });
});

// ---------- Tax planning ----------
app.get('/api/tax/goals', (_req, res) => {
  if (!tax) return res.status(503).json({ ok:false, reason:'tax_not_initialized' });
  res.json({ ok:true, goals: tax.getGoals() });
});
app.put('/api/tax/goals', (req, res) => {
  if (!tax) return res.status(503).json({ ok:false, reason:'tax_not_initialized' });
  try {
    const goals = tax.setGoals((req.body && req.body.goals) || []);
    res.json({ ok:true, goals });
  } catch (e) { res.status(400).json({ ok:false, reason:e.message }); }
});
app.get('/api/tax/harvest', (_req, res) => {
  if (!tax) return res.status(503).json({ ok:false, reason:'tax_not_initialized' });
  res.json({ ok:true, rules: tax.getHarvestRules(), opportunities: tax.findHarvestOpportunities() });
});
app.put('/api/tax/harvest', (req, res) => {
  if (!tax) return res.status(503).json({ ok:false, reason:'tax_not_initialized' });
  try {
    const rules = tax.setHarvestRules((req.body && req.body.rules) || {});
    res.json({ ok:true, rules });
  } catch (e) { res.status(400).json({ ok:false, reason:e.message }); }
});
app.post('/api/tax/realize', (req, res) => {
  if (!tax) return res.status(503).json({ ok:false, reason:'tax_not_initialized' });
  try {
    const entry = tax.realizeHarvest((req.body && req.body.tradeIds) || [], req.body && req.body.note);
    res.json({ ok:true, entry });
  } catch (e) { res.status(400).json({ ok:false, reason:e.message }); }
});

// ---------- Sweep (profit -> long-term) ----------
app.get('/api/sweep', (_req, res) => {
  if (!sweep) return res.status(503).json({ ok:false, reason:'sweep_not_initialized' });
  res.json({ ok:true, rules: sweep.getRules(), history: sweep.history(50), stats: sweep.stats() });
});
app.put('/api/sweep', (req, res) => {
  if (!sweep) return res.status(503).json({ ok:false, reason:'sweep_not_initialized' });
  try {
    const rules = sweep.setRules((req.body && req.body.rules) || []);
    res.json({ ok:true, rules });
  } catch (e) { res.status(400).json({ ok:false, reason:e.message }); }
});
app.get('/api/sweep/evaluate', (_req, res) => {
  if (!sweep) return res.status(503).json({ ok:false, reason:'sweep_not_initialized' });
  res.json({ ok:true, ...sweep.evaluate() });
});
app.post('/api/sweep/execute', (_req, res) => {
  if (!sweep) return res.status(503).json({ ok:false, reason:'sweep_not_initialized' });
  const r = sweep.execute();
  res.json({ ok:true, ...r });
});

// ---------- AI features (no-op if ANTHROPIC_API_KEY not set) ----------
app.post('/api/ai/news-sentiment', async (req, res) => {
  if (!ai || !ai.enabled()) return res.status(503).json({ ok:false, reason:'ai_disabled', detail:'set ANTHROPIC_API_KEY env to enable' });
  try {
    const items = Array.isArray(req.body && req.body.items) ? req.body.items : (news ? news.list({ limit: 10 }) : []);
    const out = await ai.newsSentiment(items);
    res.json({ ok:true, sentiments: out, stats: ai.stats() });
  } catch (e) { res.status(500).json({ ok:false, reason:e.message }); }
});
app.post('/api/ai/position-review', async (_req, res) => {
  if (!ai || !ai.enabled()) return res.status(503).json({ ok:false, reason:'ai_disabled' });
  try {
    const positions = paper ? paper.positions() : [];
    const out = await ai.positionReview(positions);
    res.json({ ok:true, review: out, stats: ai.stats() });
  } catch (e) { res.status(500).json({ ok:false, reason:e.message }); }
});
app.post('/api/ai/strategy-explain', async (req, res) => {
  if (!ai || !ai.enabled()) return res.status(503).json({ ok:false, reason:'ai_disabled' });
  try {
    const out = await ai.strategyExplain(req.body || {});
    res.json({ ok:true, ...out, stats: ai.stats() });
  } catch (e) { res.status(500).json({ ok:false, reason:e.message }); }
});

// ---------- Settlement CSV reconcile ----------
app.post('/api/reconcile/import-csv', (req, res) => {
  try {
    const csv = (req.body && (req.body.csv || req.body.text)) || '';
    if (!csv || typeof csv !== 'string') return res.status(400).json({ ok:false, reason:'csv string required in body' });
    if (csv.length > 1024 * 1024) return res.status(400).json({ ok:false, reason:'csv too large (>1MB)' });
    const backendOrders = paper ? paper.list() : [];
    const result = csvImport.reconcileCsv(csv, backendOrders);
    audit('reconcile.csv', { parsed: result.parsed, matched: result.matched, onlyInCsv: result.onlyInCsv.length });
    res.json({ ok:true, ...result });
  } catch (e) { res.status(500).json({ ok:false, reason:e.message }); }
});

// ---------- Going-live preflight ----------
app.get('/api/preflight', async (_req, res) => {
  try {
    const result = await runPreflight({
      broker, paper, pnl,
      env: process.env,
      getReconcile: async () => {
        // Build a minimal reconcile snapshot inline (don't recurse through HTTP)
        if (!paper) return null;
        const stats = paper.stats();
        const list = paper.list();
        const paperPending = list.filter(o => o.status === 'PENDING').length;
        let brokerPending = 0;
        try { const o = await broker.getOrders(); brokerPending = (o || []).filter(x => String(x.status||'').toUpperCase() === 'OPEN').length; } catch {}
        return { summary: { cashDrift: 0, brokerPendingCnt: brokerPending, paperPendingCnt: paperPending } };
      },
    });
    res.json({ ok:true, ...result });
  } catch (e) { res.status(500).json({ ok:false, reason:e.message }); }
});

// ---------- Hyperparameter tuner ----------
// POST /api/tune  body: { symbol, strategy, paramGrid, from, to, qty?, interval?, top? }
//   paramGrid: object mapping param-name -> array of values.
//   e.g. for rsi_mean_revert:
//     { period:[10,14,20], entryRsi:[25,30,35], exitRsi:[65,70,75] }
//   Returns top-N (default 10) combinations ranked by totalPnl.
app.post('/api/tune', async (req, res) => {
  try {
    const { symbol, strategy, paramGrid, from, to, qty, interval } = req.body || {};
    if (!symbol)    return res.status(400).json({ ok:false, reason:'symbol required' });
    if (!strategy)  return res.status(400).json({ ok:false, reason:'strategy required' });
    if (!paramGrid || typeof paramGrid !== 'object') {
      return res.status(400).json({ ok:false, reason:'paramGrid required (object of name -> values[])' });
    }
    if (!from || !to) return res.status(400).json({ ok:false, reason:'from and to required' });
    const top = Math.max(1, Math.min(50, parseInt(req.body.top || '10', 10) || 10));

    // Explode grid into all combinations (cartesian product). Cap at 200 to prevent abuse.
    const keys = Object.keys(paramGrid);
    let combos = [{}];
    for (const k of keys) {
      const vals = Array.isArray(paramGrid[k]) ? paramGrid[k] : [paramGrid[k]];
      const next = [];
      for (const c of combos) for (const v of vals) next.push({ ...c, [k]: v });
      combos = next;
      if (combos.length > 200) {
        return res.status(400).json({ ok:false, reason:`grid too large: ${combos.length} combinations (cap 200)` });
      }
    }

    // Fetch candles ONCE; reuse across all combos.
    const candles = await broker.getHistorical({ symbol, interval: interval || 'day', from, to });
    if (!Array.isArray(candles) || candles.length < 30) {
      return res.status(400).json({ ok:false, reason:`need >= 30 candles, got ${candles ? candles.length : 0}` });
    }

    const results = [];
    for (const params of combos) {
      try {
        const r = runBacktest({ candles, strategy, params, qty: Number(qty) || 1 });
        results.push({
          params,
          trades:        r.stats.trades,
          winRate:       r.stats.winRate,
          totalPnl:      r.stats.totalPnl,
          maxDrawdown:   r.stats.maxDrawdown,
          buyAndHoldPnl: r.stats.buyAndHoldPnl,
          vsBuyAndHold:  r.stats.vsBuyAndHold,
        });
      } catch (e) {
        results.push({ params, error: e.message });
      }
    }
    // Sort: prefer totalPnl desc, tiebreak by lower drawdown
    results.sort((a, b) => {
      const ap = a.totalPnl || -Infinity;
      const bp = b.totalPnl || -Infinity;
      if (bp !== ap) return bp - ap;
      return (a.maxDrawdown || Infinity) - (b.maxDrawdown || Infinity);
    });
    audit('tune.run', { symbol, strategy, combos: combos.length, bestPnl: results[0] && results[0].totalPnl });
    res.json({
      ok: true, symbol, strategy, from, to,
      candlesUsed: candles.length,
      combinations: combos.length,
      top: results.slice(0, top),
      worst: results.slice(-3).reverse(),
    });
  } catch (e) {
    res.status(500).json({ ok:false, reason: e.message });
  }
});

// GET /api/regime?symbol=NIFTY+50&interval=day&lookback=365
// Classifies current market state into one of:
//   trending_up | trending_down | range | high_vol | low_vol
// Uses ATR (volatility), ADX (trend strength), SMA50/200 (trend direction).
app.get('/api/regime', async (req, res) => {
  try {
    const symbol = req.query.symbol || 'NIFTY 50';
    const interval = req.query.interval || 'day';
    const lookback = Math.max(60, Math.min(800, parseInt(req.query.lookback || '365', 10) || 365));
    const to = new Date();
    const from = new Date(to.getTime() - lookback * 86400000);
    const fromStr = from.toISOString().slice(0, 10);
    const toStr   = to.toISOString().slice(0, 10);

    const candles = await broker.getHistorical({ symbol, interval, from: fromStr, to: toStr });
    if (!Array.isArray(candles) || candles.length < 50) {
      return res.status(400).json({ ok:false, reason:`need >= 50 candles, got ${candles ? candles.length : 0}` });
    }
    const r = classifyRegime(candles);
    res.json({
      ok: true,
      symbol, interval, from: fromStr, to: toStr,
      candles: candles.length,
      ...r,
      asOf: candles[candles.length - 1].date,
    });
  } catch (e) {
    res.status(500).json({ ok:false, reason: e.message });
  }
});

// GET /api/benchmark?strategy=rsi_mean_revert&symbol=RELIANCE&from=...&to=...&qty=10&benchmark=NIFTY+50
// Runs the strategy backtest, then fetches benchmark over the SAME window,
// computes daily returns for both, then reports alpha + beta + Sharpe + vs-benchmark drawdown.
app.get('/api/benchmark', async (req, res) => {
  try {
    const symbol    = req.query.symbol;
    const strategy  = req.query.strategy;
    const from      = req.query.from;
    const to        = req.query.to;
    const qty       = parseInt(req.query.qty || '1', 10) || 1;
    const benchmark = req.query.benchmark || 'NIFTY 50';
    const interval  = req.query.interval  || 'day';
    if (!symbol)   return res.status(400).json({ ok:false, reason:'symbol required' });
    if (!strategy) return res.status(400).json({ ok:false, reason:'strategy required' });
    if (!from || !to) return res.status(400).json({ ok:false, reason:'from and to required' });

    // Parse strategy params from query (e.g. ?period=14&entryRsi=30)
    const params = {};
    for (const k of ['period','entryRsi','exitRsi','fast','slow','signal','k']) {
      if (req.query[k] != null) params[k] = Number(req.query[k]);
    }

    // Fetch both series in parallel
    const [stratCandles, benchCandles] = await Promise.all([
      broker.getHistorical({ symbol,    interval, from, to }),
      broker.getHistorical({ symbol: benchmark, interval, from, to }),
    ]);
    if (!Array.isArray(stratCandles) || stratCandles.length < 30) {
      return res.status(400).json({ ok:false, reason:`strategy symbol needs >= 30 candles, got ${stratCandles ? stratCandles.length : 0}` });
    }
    if (!Array.isArray(benchCandles) || benchCandles.length < 30) {
      return res.status(400).json({ ok:false, reason:`benchmark symbol needs >= 30 candles, got ${benchCandles ? benchCandles.length : 0}` });
    }

    // Run strategy
    const bt = runBacktest({ candles: stratCandles, strategy, params, qty });

    // Align equity curve to benchmark by date
    const benchByDate = new Map();
    for (const c of benchCandles) benchByDate.set(c.date.slice(0, 10), c.close);

    // Strategy equity / benchmark close per shared date
    const aligned = [];
    for (const e of bt.equity) {
      const d = e.date.slice(0, 10);
      if (benchByDate.has(d)) aligned.push({ date: d, eq: e.equity, bench: benchByDate.get(d) });
    }
    if (aligned.length < 30) {
      return res.status(400).json({ ok:false, reason:`only ${aligned.length} aligned bars between symbol and benchmark` });
    }

    // Convert strategy equity into total-return basis:
    //   strategy starts at notional = entryPrice * qty (so its % return is comparable to buy-and-hold).
    const notional = stratCandles[0].close * qty;
    const stratRet = []; // daily simple returns
    const benchRet = [];
    let prevS = notional + aligned[0].eq;
    let prevB = aligned[0].bench;
    for (let i = 1; i < aligned.length; i++) {
      const sNow = notional + aligned[i].eq;
      const bNow = aligned[i].bench;
      stratRet.push((sNow - prevS) / prevS);
      benchRet.push((bNow - prevB) / prevB);
      prevS = sNow;
      prevB = bNow;
    }
    const n = stratRet.length;
    const mean = a => a.reduce((s,x)=>s+x,0) / a.length;
    const std  = (a, m) => Math.sqrt(a.reduce((s,x)=>s+(x-m)*(x-m),0) / a.length);
    const cov  = (a, b, ma, mb) => {
      let s = 0; for (let i = 0; i < a.length; i++) s += (a[i]-ma)*(b[i]-mb);
      return s / a.length;
    };
    const mS = mean(stratRet), mB = mean(benchRet);
    const sS = std(stratRet, mS), sB = std(benchRet, mB);
    const c  = cov(stratRet, benchRet, mS, mB);
    const beta  = sB === 0 ? 0 : c / (sB * sB);
    // Annualized using 252 trading days
    const annStratRet = (1 + mS) ** 252 - 1;
    const annBenchRet = (1 + mB) ** 252 - 1;
    const alpha       = annStratRet - beta * annBenchRet;
    // Annualized Sharpe (assume rf = 0)
    const sharpe      = sS === 0 ? 0 : (mS / sS) * Math.sqrt(252);
    const benchSharpe = sB === 0 ? 0 : (mB / sB) * Math.sqrt(252);
    // Annualized volatility
    const annVol = sS * Math.sqrt(252);
    const benchAnnVol = sB * Math.sqrt(252);
    // Max drawdown on strategy equity curve (reuse bt.equity values)
    // bt.stats.maxDrawdown is in absolute units; keep that, plus compute benchmark max drawdown
    let bPeak = -Infinity, bMaxDd = 0, bMaxDdPct = 0;
    for (const a of aligned) {
      if (a.bench > bPeak) bPeak = a.bench;
      const dd = bPeak - a.bench;
      if (dd > bMaxDd) {
        bMaxDd = dd;
        bMaxDdPct = bPeak !== 0 ? dd / bPeak * 100 : 0;
      }
    }
    // Correlation
    const corr = (sS === 0 || sB === 0) ? 0 : c / (sS * sB);

    res.json({
      ok: true,
      symbol, strategy, benchmark, from, to,
      candlesUsed: stratCandles.length,
      benchmarkCandles: benchCandles.length,
      alignedBars: aligned.length,
      strategy_: {
        trades:         bt.stats.trades,
        winRate:        bt.stats.winRate,
        totalPnl:       bt.stats.totalPnl,
        annualReturn:   +(annStratRet * 100).toFixed(2),
        annualVol:      +(annVol * 100).toFixed(2),
        sharpe:         +sharpe.toFixed(2),
        maxDrawdown:    bt.stats.maxDrawdown,
        maxDrawdownPct: bt.stats.maxDrawdownPct,
      },
      benchmark_: {
        annualReturn:   +(annBenchRet * 100).toFixed(2),
        annualVol:      +(benchAnnVol * 100).toFixed(2),
        sharpe:         +benchSharpe.toFixed(2),
        maxDrawdown:    +bMaxDd.toFixed(2),
        maxDrawdownPct: +bMaxDdPct.toFixed(2),
      },
      vs: {
        alpha:          +(alpha * 100).toFixed(2),    // % annualized
        beta:           +beta.toFixed(3),
        correlation:    +corr.toFixed(3),
        excessSharpe:   +(sharpe - benchSharpe).toFixed(2),
        excessReturn:   +((annStratRet - annBenchRet) * 100).toFixed(2),
      },
    });
  } catch (e) {
    res.status(500).json({ ok:false, reason: e.message });
  }
});

// ---------- Scanner ----------
app.get('/api/scanner', (_req, res) => {
  if (!scanner) return res.status(503).json({ ok: false, reason: 'scanner_not_initialized' });
  res.json({ ok: true, ...scanner.stats() });
});

app.get('/api/scanner/history', (req, res) => {
  if (!scanner) return res.status(503).json({ ok: false, reason: 'scanner_not_initialized' });
  const limit = parseInt(req.query.limit || '25', 10);
  res.json({ ok: true, history: scanner.history(limit) });
});

app.post('/api/scanner/run', async (req, res) => {
  if (!scanner) return res.status(503).json({ ok: false, reason: 'scanner_not_initialized' });
  // Async: kick it off and return immediately so the HTTP request doesn't hold open
  // for 15+ seconds across the watchlist.
  scanner.runOnce({ manual: true, limit: req.body && req.body.limit })
    .then((r) => audit('scanner.runOnce', r))
    .catch((e) => audit('scanner.runOnce.error', { msg: e.message }));
  res.status(202).json({ ok: true, accepted: true, note: 'scanning in background — poll /api/scanner/history' });
});

// ---------- Watchlist ----------
app.get('/api/watchlist', (_req, res) => {
  if (!watchlist) return res.status(503).json({ ok: false, reason: 'watchlist_not_initialized' });
  res.json({ ok: true, symbols: watchlist.list() });
});

app.put('/api/watchlist', (req, res) => {
  if (!watchlist) return res.status(503).json({ ok: false, reason: 'watchlist_not_initialized' });
  try {
    const symbols = watchlist.set(req.body && req.body.symbols);
    // Push the new list to the broker subscription set so /ws ticks start flowing.
    if (typeof broker.ensureSubscribed === 'function') {
      broker.ensureSubscribed(symbols).catch(() => {});
    }
    res.json({ ok: true, symbols });
  } catch (e) {
    res.status(400).json({ ok: false, reason: e.message });
  }
});

app.post('/api/watchlist/add', (req, res) => {
  if (!watchlist) return res.status(503).json({ ok: false, reason: 'watchlist_not_initialized' });
  try {
    const sym = req.body && req.body.symbol;
    const out = watchlist.add(sym);
    if (out.added && typeof broker.ensureSubscribed === 'function') {
      broker.ensureSubscribed([sym]).catch(() => {});
    }
    res.json({ ok: true, ...out });
  } catch (e) {
    res.status(400).json({ ok: false, reason: e.message });
  }
});

app.post('/api/watchlist/remove', (req, res) => {
  if (!watchlist) return res.status(503).json({ ok: false, reason: 'watchlist_not_initialized' });
  try {
    const out = watchlist.remove(req.body && req.body.symbol);
    res.json({ ok: true, ...out });
  } catch (e) {
    res.status(400).json({ ok: false, reason: e.message });
  }
});

// ---------- Alerts ----------
app.get('/api/alerts', (_req, res) => {
  if (!alerts) return res.status(503).json({ ok: false, reason: 'alerts_not_initialized' });
  res.json({ ok: true, alerts: alerts.list() });
});

app.post('/api/alerts', (req, res) => {
  if (!alerts) return res.status(503).json({ ok: false, reason: 'alerts_not_initialized' });
  try {
    const a = alerts.add(req.body || {});
    res.status(201).json({ ok: true, alert: a });
  } catch (e) {
    res.status(400).json({ ok: false, reason: e.message });
  }
});

app.delete('/api/alerts/:id', (req, res) => {
  if (!alerts) return res.status(503).json({ ok: false, reason: 'alerts_not_initialized' });
  const ok = alerts.remove(req.params.id);
  res.status(ok ? 200 : 404).json({ ok });
});

app.post('/api/alerts/:id/reset', (req, res) => {
  if (!alerts) return res.status(503).json({ ok: false, reason: 'alerts_not_initialized' });
  const ok = alerts.reset(req.params.id);
  res.status(ok ? 200 : 404).json({ ok });
});

app.get('/api/alerts/stats', (_req, res) => {
  if (!alerts) return res.status(503).json({ ok: false, reason: 'alerts_not_initialized' });
  res.json({ ok: true, ...alerts.stats() });
});

// Config exposed to the front-end
app.get('/api/config', (_req, res) => {
  res.json({
    env: ENV_NAME,
    features: { liveTrading: false, paperTrading: true, backtest: true, aiReview: true },
    killSwitch: KILL_SWITCH,
    liveTrading: LIVE_TRADING,
    wsUrl: '/ws',
    broker: broker.name,
    defaultSymbols: DEFAULT_SYMBOLS,
  });
});

app.get('/api/symbols', async (_req, res) => {
  const syms = await broker.listSymbols();
  res.json({ ok: true, symbols: syms.length ? syms : DEFAULT_SYMBOLS });
});

app.get('/api/quote/:symbol', async (req, res) => {
  try {
    const q = await broker.getQuote(req.params.symbol);
    res.json({ ok: true, symbol: req.params.symbol, ...q });
  } catch (e) {
    res.status(404).json({ ok: false, reason: e.message });
  }
});

// Bulk quote — /api/quotes?symbols=RELIANCE,INFY,TCS
app.get('/api/quotes', async (req, res) => {
  try {
    const raw = (req.query.symbols || '').toString();
    const symbols = raw.split(',').map(s => s.trim()).filter(Boolean);
    if (symbols.length === 0) return res.status(400).json({ ok: false, reason: 'no_symbols' });
    const data = await broker.getQuotes(symbols);
    res.json({ ok: true, quotes: data });
  } catch (e) {
    res.status(500).json({ ok: false, reason: e.message });
  }
});

// ---------- Portfolio / orders REST (read-only) ----------

app.get('/api/portfolio/holdings', async (_req, res) => {
  try {
    const rows = await broker.getHoldings();
    res.json({ ok: true, rows });
  } catch (e) {
    res.status(500).json({ ok: false, reason: e.message });
  }
});

app.get('/api/portfolio/positions', async (_req, res) => {
  try {
    const data = await broker.getPositions();
    res.json({ ok: true, ...data });
  } catch (e) {
    res.status(500).json({ ok: false, reason: e.message });
  }
});

app.get('/api/orders', async (_req, res) => {
  try {
    const rows = await broker.getOrders();
    res.json({ ok: true, rows });
  } catch (e) {
    res.status(500).json({ ok: false, reason: e.message });
  }
});

app.get('/api/profile', async (_req, res) => {
  try {
    res.json({ ok: true, profile: await broker.getProfile() });
  } catch (e) {
    res.status(500).json({ ok: false, reason: e.message });
  }
});

app.get('/api/margins', async (_req, res) => {
  try {
    res.json({ ok: true, margins: await broker.getMargins() });
  } catch (e) {
    res.status(500).json({ ok: false, reason: e.message });
  }
});

// ---------- Reconciliation ----------
// GET /api/reconcile -- side-by-side: broker live state vs backend (paper) state.
// While KILL_SWITCH=true (paper-only mode), the broker side reflects the user's
// real Kite account (holdings, intraday positions, today's orders, cash). Paper
// side is the simulator. This surfaces any drift -- useful pre-go-live as a
// sanity check, and post-go-live to catch silent mismatches between what
// the backend thinks it placed vs what Kite actually accepted.
app.get('/api/reconcile', async (_req, res) => {
  if (!paper) return res.status(503).json({ ok:false, reason:'paper_not_initialized' });
  const safe = async (fn) => {
    try { return { ok: true, data: await fn() }; }
    catch (e) { return { ok: false, error: e.message }; }
  };

  const [holdingsR, positionsR, ordersR, marginsR] = await Promise.all([
    safe(() => broker.getHoldings()),
    safe(() => broker.getPositions()),
    safe(() => broker.getOrders()),
    safe(() => broker.getMargins()),
  ]);

  // ---- Cash drift ----
  let brokerCash = null;
  if (marginsR.ok && marginsR.data) {
    const eq = marginsR.data.equity || {};
    const av = eq.available || {};
    brokerCash = typeof av.cash === 'number' ? av.cash
               : typeof av.live_balance === 'number' ? av.live_balance
               : typeof eq.net === 'number' ? eq.net
               : null;
  }
  const paperStats = paper.stats();

  // ---- Holdings diff ----
  // Broker holdings: kc.getHoldings() returns [{ tradingsymbol, quantity, average_price, last_price, ... }]
  // Paper holdings: derived from paper.positions() (only long net positions matter for compare)
  const brokerHoldings = holdingsR.ok && Array.isArray(holdingsR.data) ? holdingsR.data : [];
  const paperPositions = paper.positions();
  const holdingsBySymbol = new Map();
  for (const h of brokerHoldings) {
    const s = (h.tradingsymbol || h.symbol || '').toUpperCase();
    if (!s) continue;
    holdingsBySymbol.set(s, {
      symbol: s,
      brokerQty: Number(h.quantity || 0),
      brokerAvg: Number(h.average_price || 0),
      brokerLtp: Number(h.last_price || 0),
      paperQty: 0,
      paperAvg: 0,
    });
  }
  for (const p of paperPositions) {
    const s = p.symbol.toUpperCase();
    const cur = holdingsBySymbol.get(s) || { symbol: s, brokerQty: 0, brokerAvg: 0, brokerLtp: p.ltp || 0, paperQty: 0, paperAvg: 0 };
    cur.paperQty = p.qty;
    cur.paperAvg = p.avgPrice;
    holdingsBySymbol.set(s, cur);
  }
  const holdingsRows = Array.from(holdingsBySymbol.values()).map(r => ({
    ...r,
    qtyDrift: r.brokerQty - r.paperQty,
    matches: r.brokerQty === r.paperQty,
  }));

  // ---- Pending-orders diff ----
  // Backend (paper) pending orders: status=PENDING
  // Broker pending: status === 'OPEN' or 'TRIGGER PENDING' (Kite values)
  const allPaperOrders = paper.list();
  const paperPending = allPaperOrders.filter(o => o.status === 'PENDING');
  const brokerOrdersAll = ordersR.ok && Array.isArray(ordersR.data) ? ordersR.data : [];
  const brokerPending = brokerOrdersAll.filter(o => {
    const s = String(o.status || '').toUpperCase();
    return s === 'OPEN' || s === 'TRIGGER PENDING' || s === 'PENDING';
  });

  const summary = {
    cashDrift:        (brokerCash != null) ? +(brokerCash - paperStats.cash).toFixed(2) : null,
    holdingsDrifts:   holdingsRows.filter(r => !r.matches).length,
    paperPendingCnt:  paperPending.length,
    brokerPendingCnt: brokerPending.length,
  };

  res.json({
    ok: true,
    asOf: new Date().toISOString(),
    killSwitch: KILL_SWITCH,
    liveTrading: LIVE_TRADING,
    brokerName: broker.name,
    brokerConnected: !!(broker.health && broker.health().connected),
    cash: {
      paper:    paperStats.cash,
      broker:   brokerCash,
      drift:    summary.cashDrift,
      brokerOk: marginsR.ok,
      brokerErr: marginsR.ok ? null : marginsR.error,
    },
    holdings: {
      rows:       holdingsRows,
      brokerOk:   holdingsR.ok,
      brokerErr:  holdingsR.ok ? null : holdingsR.error,
    },
    pendingOrders: {
      paper:     paperPending,
      broker:    brokerPending,
      brokerOk:  ordersR.ok,
      brokerErr: ordersR.ok ? null : ordersR.error,
    },
    paperStats: {
      totalEquity:   paperStats.totalEquity,
      realizedPnl:   paperStats.realizedPnl,
      unrealizedPnl: paperStats.unrealizedPnl,
      filledOrders:  paperStats.filledOrders,
      closedTrades:  paperStats.closedTrades,
    },
    summary,
  });
});

// ---------- Historical OHLCV ----------
// GET /api/historical?symbol=RELIANCE&interval=5minute&from=2026-05-12&to=2026-05-13
const HISTORICAL_MAX_DAYS = parseInt(process.env.HISTORICAL_MAX_DAYS || '730', 10); // 2 years
app.get('/api/historical', async (req, res) => {
  try {
    const { symbol, interval, from, to, continuous, oi } = req.query;
    if (!symbol || !interval || !from || !to) {
      return res.status(400).json({ ok: false, reason: 'symbol, interval, from, to are required' });
    }
    // Bound the date range to avoid Kite rate-limit storms.
    const dFrom = new Date(String(from));
    const dTo   = new Date(String(to));
    if (!isFinite(dFrom.getTime()) || !isFinite(dTo.getTime())) {
      return res.status(400).json({ ok: false, reason: 'from/to must be valid dates' });
    }
    const days = Math.floor((dTo.getTime() - dFrom.getTime()) / (86400 * 1000));
    if (days < 0) return res.status(400).json({ ok: false, reason: 'to must be after from' });
    if (days > HISTORICAL_MAX_DAYS) {
      return res.status(400).json({ ok: false, reason: `range too wide: ${days}d > ${HISTORICAL_MAX_DAYS}d max` });
    }
    const candles = await broker.getHistorical({
      symbol: String(symbol),
      interval: String(interval),
      from: String(from),
      to: String(to),
      continuous: continuous === '1' || continuous === 'true',
      oi: oi === '1' || oi === 'true',
    });
    res.json({ ok: true, symbol: String(symbol), interval: String(interval), count: candles.length, candles });
  } catch (e) {
    res.status(400).json({ ok: false, reason: e.message });
  }
});

// ---------- Instrument search ----------
// GET /api/instruments/search?q=RELI&limit=20
app.get('/api/instruments/search', (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit || '20', 10) || 20));
    if (q.length < 1) return res.status(400).json({ ok: false, reason: 'q is required' });
    const results = broker.searchInstruments(q, limit);
    res.json({ ok: true, q, count: results.length, results });
  } catch (e) {
    res.status(500).json({ ok: false, reason: e.message });
  }
});

app.get('/api/kill-switch', (_req, res) => res.json({ killSwitch: KILL_SWITCH }));

// ---------- Watchlist backtest ----------
// POST /api/backtest/watchlist  body: { strategy, from, to, qty?, params?, interval? }
// Runs the strategy across every scannable symbol in the watchlist (skips indices),
// returns per-symbol stats sorted by totalPnl desc.
app.post('/api/backtest/watchlist', async (req, res) => {
  try {
    if (!watchlist) return res.status(503).json({ ok: false, reason: 'watchlist_not_initialized' });
    const { strategy, from, to, qty, params, interval } = req.body || {};
    if (!strategy)    return res.status(400).json({ ok: false, reason: 'strategy required' });
    if (!from || !to) return res.status(400).json({ ok: false, reason: 'from and to required' });

    const symbols = watchlist.list().filter(s =>
      !/^(NIFTY|BANKNIFTY|SENSEX|FINNIFTY|MIDCPNIFTY|INDIA VIX)/i.test(s) &&
      !/(CE|PE|FUT)$/.test(s)
    );
    if (symbols.length === 0) return res.json({ ok: true, results: [], note: 'no scannable symbols in watchlist' });

    const results = [];
    const errors = {};
    for (const symbol of symbols) {
      try {
        const candles = await broker.getHistorical({
          symbol, interval: interval || 'day', from, to,
        });
        if (!Array.isArray(candles) || candles.length < 30) {
          errors[symbol] = `only ${candles ? candles.length : 0} candles`;
          continue;
        }
        const r = runBacktest({
          candles,
          strategy,
          params: params || {},
          qty: Number(qty) || 1,
        });
        results.push({
          symbol,
          trades: r.stats.trades,
          winRate: r.stats.winRate,
          totalPnl: r.stats.totalPnl,
          buyAndHoldPnl: r.stats.buyAndHoldPnl,
          vsBuyAndHold: r.stats.vsBuyAndHold,
          maxDrawdown: r.stats.maxDrawdown,
          avgWin: r.stats.avgWin,
          avgLoss: r.stats.avgLoss,
        });
      } catch (e) {
        errors[symbol] = e.message;
      }
      // Polite pacing for Kite REST.
      await new Promise(r => setTimeout(r, 250));
    }

    results.sort((a, b) => b.totalPnl - a.totalPnl);

    const aggregate = {
      symbolsScanned: results.length,
      totalPnl: +results.reduce((s, r) => s + r.totalPnl, 0).toFixed(2),
      profitable: results.filter(r => r.totalPnl > 0).length,
      losing:     results.filter(r => r.totalPnl < 0).length,
      avgWinRate: results.length ? +(results.reduce((s, r) => s + r.winRate, 0) / results.length).toFixed(2) : 0,
    };

    audit('backtest.watchlist', { strategy, ...aggregate });
    res.json({ ok: true, strategy, from, to, qty: Number(qty) || 1, aggregate, results, errors: Object.keys(errors).length ? errors : null });
  } catch (e) {
    res.status(500).json({ ok: false, reason: e.message });
  }
});

// ---------- Tier 18: Long-term wealth endpoints (SIP / buckets / SWP / inflate) ----------
app.get('/api/sip', (_req, res) => {
  if (!longterm) return res.status(503).json({ ok:false, reason:'longterm_not_initialized' });
  res.json({ ok:true, sips: longterm.getSips(), stats: longterm.stats() });
});
app.put('/api/sip', (req, res) => {
  if (!longterm) return res.status(503).json({ ok:false, reason:'longterm_not_initialized' });
  try {
    const sips = longterm.setSips((req.body && req.body.sips) || []);
    res.json({ ok:true, sips });
  } catch (e) { res.status(400).json({ ok:false, reason:e.message }); }
});
app.get('/api/buckets', (_req, res) => {
  if (!longterm) return res.status(503).json({ ok:false, reason:'longterm_not_initialized' });
  res.json({ ok:true, buckets: longterm.getBuckets() });
});
app.put('/api/buckets', (req, res) => {
  if (!longterm) return res.status(503).json({ ok:false, reason:'longterm_not_initialized' });
  try {
    const b = longterm.setBuckets((req.body && req.body.buckets) || {});
    res.json({ ok:true, buckets: b });
  } catch (e) { res.status(400).json({ ok:false, reason:e.message }); }
});
app.post('/api/swp/simulate', (req, res) => {
  if (!longterm) return res.status(503).json({ ok:false, reason:'longterm_not_initialized' });
  try {
    const r = longterm.simulateSwp(req.body || {});
    res.json({ ok:true, ...r });
  } catch (e) { res.status(400).json({ ok:false, reason:e.message }); }
});
app.post('/api/goals/inflate', (req, res) => {
  if (!longterm) return res.status(503).json({ ok:false, reason:'longterm_not_initialized' });
  try {
    const r = longterm.inflateGoal(req.body || {});
    res.json({ ok:true, ...r });
  } catch (e) { res.status(400).json({ ok:false, reason:e.message }); }
});

// ---------- Tier 21: Wealth reference catalogs (bonds / REITs / smallcases / traders) ----------
app.get('/api/bonds', (_req, res) => {
  if (!wealth) return res.status(503).json({ ok:false, reason:'wealth_not_initialized' });
  res.json(wealth.getBonds());
});
app.get('/api/reits', (_req, res) => {
  if (!wealth) return res.status(503).json({ ok:false, reason:'wealth_not_initialized' });
  res.json(wealth.getReits());
});
app.get('/api/smallcase/baskets', (_req, res) => {
  if (!wealth) return res.status(503).json({ ok:false, reason:'wealth_not_initialized' });
  res.json(wealth.getSmallcases());
});
app.get('/api/copy/traders', (_req, res) => {
  if (!wealth) return res.status(503).json({ ok:false, reason:'wealth_not_initialized' });
  res.json(wealth.getTraders());
});

// ---------- Tier 22: MPT portfolio optimiser ----------
app.post('/api/portfolio/optimize', (req, res) => {
  if (!mpt) return res.status(503).json({ ok:false, reason:'mpt_not_initialized' });
  try {
    const out = mpt.optimize(req.body || {});
    res.json(out);
  } catch (e) {
    res.status(400).json({ ok:false, reason:e.message });
  }
});

// ---------- Tier 31: factor-tilt portfolio construction ----------
// POST body shape:
//   { universe:      [{symbol, momentum, value, quality, lowVol, size, marketCap}, ...],
//     factorWeights: { momentum:0.4, value:0.3, quality:0.2, lowVol:0.1, size:0 },
//     mode:          'long-only' | 'long-short',         // default 'long-only'
//     topPct:        0.2,                                 // top quintile to long
//     bottomPct:     0.2 }                                // bottom quintile to short (long-short only)
app.post('/api/portfolio/factor-tilt', (req, res) => {
  if (!factorTilt) return res.status(503).json({ ok:false, reason:'factor_tilt_not_initialized' });
  try {
    const out = factorTilt.build(req.body || {});
    res.json(out);
  } catch (e) {
    res.status(400).json({ ok:false, reason:e.message });
  }
});

// ---------- Tier 32: WORM tamper-evident audit log ----------
// GET /api/audit/root    -- chain head hash, head seq, merkle root, entry count.
//                          fast: O(file size) once per call; cache-friendly.
// GET /api/audit/verify  -- walks the entire chain, recomputes every hash.
//                          slower; for periodic integrity audits.
// GET /api/audit/tail?n  -- last N entries (read-only, default 100, max 10000).
app.get('/api/audit/root', (_req, res) => {
  if (!wormAudit) return res.status(503).json({ ok:false, reason:'worm_not_initialized' });
  try { res.json({ ok:true, ...wormAudit.root() }); }
  catch (e) { res.status(500).json({ ok:false, reason:e.message }); }
});
app.get('/api/audit/verify', (_req, res) => {
  if (!wormAudit) return res.status(503).json({ ok:false, reason:'worm_not_initialized' });
  try { res.json(wormAudit.verify()); }
  catch (e) { res.status(500).json({ ok:false, reason:e.message }); }
});
app.get('/api/audit/tail', (req, res) => {
  if (!wormAudit) return res.status(503).json({ ok:false, reason:'worm_not_initialized' });
  try { res.json({ ok:true, entries: wormAudit.tail(Number(req.query.n) || 100) }); }
  catch (e) { res.status(500).json({ ok:false, reason:e.message }); }
});

// Tier 23: rebalance suggestions. Auto-derives buckets + holdings + paper equity + cash if not in body.
app.post('/api/rebalance', async (req, res) => {
  if (!rebalance) return res.status(503).json({ ok:false, reason:'rebalance_not_initialized' });
  try {
    const body = req.body || {};
    let buckets = body.buckets;
    if (!buckets && longterm) buckets = longterm.getBuckets();
    if (!buckets) return res.status(400).json({ ok:false, reason:'no buckets supplied or initialized' });

    let holdingsValueINR = Number(body.holdingsValueINR);
    let paperEquityINR   = Number(body.paperEquityINR);
    let cashINR          = Number(body.cashINR);

    if (!Number.isFinite(holdingsValueINR)) {
      try {
        const hs = await broker.getHoldings();
        holdingsValueINR = (hs || []).reduce((s, h) => s + (h.quantity || 0) * (h.last_price || h.ltp || 0), 0);
      } catch (_e) { holdingsValueINR = 0; }
    }
    if (!Number.isFinite(paperEquityINR) && paper) {
      const ps = paper.stats() || {};
      paperEquityINR = ps.totalEquity || 0;
    }
    if (!Number.isFinite(cashINR) && paper) {
      const ps = paper.stats() || {};
      // Use cash sitting in paper trading as a rough proxy for emergency funds.
      cashINR = ps.cash || 0;
    }

    const out = rebalance.suggest({
      buckets,
      holdingsValueINR: holdingsValueINR || 0,
      paperEquityINR:   paperEquityINR   || 0,
      cashINR:          cashINR          || 0,
      thresholdPct:     body.thresholdPct,
    });
    res.json(out);
  } catch (e) {
    res.status(400).json({ ok:false, reason:e.message });
  }
});

// Tier 18: AI-generated monthly review narrative (spec §4 Stage 4).

// ---------- Tier 27: Historical replay (step-through candles + signals) ----------
app.post('/api/paper/replay', async (req, res) => {
  if (!replay) return res.status(503).json({ ok:false, reason:'replay_not_initialized' });
  try {
    const { symbol, from, to, strategy, params, qty, interval, candles } = req.body || {};
    if (!strategy) return res.status(400).json({ ok:false, reason:'strategy required' });
    let bars;
    if (Array.isArray(candles) && candles.length >= 30) {
      // Caller-supplied candles -- skip Kite fetch (useful when broker is offline)
      bars = candles;
    } else {
      if (!symbol)   return res.status(400).json({ ok:false, reason:'symbol required (or pass candles[])' });
      if (!from || !to) return res.status(400).json({ ok:false, reason:'from and to required (YYYY-MM-DD)' });
      try {
        bars = await broker.getHistorical({ symbol, interval: interval || 'day', from, to });
      } catch (e) {
        return res.status(502).json({ ok:false, reason:`historical fetch failed: ${e.message}`, hint:'Pass candles[] in body to bypass broker.' });
      }
      if (!Array.isArray(bars) || bars.length < 30) {
        return res.status(400).json({ ok:false, reason:`need >= 30 candles, got ${bars ? bars.length : 0}` });
      }
    }
    const result = replay.replay({ candles: bars, strategy, params: params || {}, qty: Number(qty) || 1 });
    audit('paper.replay', { symbol, strategy, bars: bars.length, trades: result.stats.trades });
    res.json({ symbol, from, to, ...result });
  } catch (e) {
    res.status(400).json({ ok:false, reason:e.message });
  }
});

// ---------- Tier 27: Email alerts ----------
app.get('/api/email/status', (_req, res) => {
  if (!emailAlerts) return res.status(503).json({ ok:false, reason:'email_not_initialized' });
  res.json({ ok:true, ...emailAlerts.status() });
});
app.post('/api/email/send', async (req, res) => {
  if (!emailAlerts) return res.status(503).json({ ok:false, reason:'email_not_initialized' });
  const { to, subject, text } = req.body || {};
  const r = await emailAlerts.send({ to, subject, text });
  res.json(r);
});

// ---------- Tier 28: WhatsApp alerts (Twilio HTTP) ----------
app.get('/api/whatsapp/status', (_req, res) => {
  if (!whatsAppAlerts) return res.status(503).json({ ok:false, reason:'whatsapp_not_initialized' });
  res.json({ ok:true, ...whatsAppAlerts.status() });
});
app.post('/api/whatsapp/send', async (req, res) => {
  if (!whatsAppAlerts) return res.status(503).json({ ok:false, reason:'whatsapp_not_initialized' });
  const { to, body } = req.body || {};
  const r = await whatsAppAlerts.send({ to, body });
  res.json(r);
});


app.post('/api/ai/monthly-review', async (req, res) => {
  if (!ai || !ai.enabled()) return res.status(503).json({ ok:false, reason:'ai_disabled', detail:'set ANTHROPIC_API_KEY env to enable' });
  try {
    const body = req.body || {};
    let arg = body;
    if (!body.trades && paper) {
      const stats = paper.stats() || {};
      const trades = paper.trades ? paper.trades(50) : [];
      arg = {
        month: new Date().toLocaleString('en-IN', { month: 'long', year: 'numeric' }),
        realizedPnl: stats.realizedPnl || 0,
        winRate: stats.winRate,
        tradeCount: stats.tradeCount || 0,
        totalEquity: stats.totalEquity || 0,
        trades: trades.slice(0, 30),
        ...body,
      };
    }
    const out = await ai.monthlyReview(arg);
    res.json({ ok:true, ...out });
  } catch (e) {
    res.status(500).json({ ok:false, reason:e.message });
  }
});

// ---------- Order placement (kill-switch gated) ----------
//
// Real order placement is INTENTIONALLY gated. The route exists so that:
//   - Payload validation, audit, idempotency-key flow are all wired and tested
//   - Frontend can wire the "Place order" button now
//   - When you're ready to actually trade, flip KILL_SWITCH=false in /etc/ats/backend.env
//     and (separately) wire the broker.placeOrder() call. That broker method is NOT
//     present yet by design — adding it is the deliberate moment you decide to trade live.
//
// Until then this endpoint validates + audits + returns 503 with reason:'KILL_SWITCH_ON'.
const VALID_SIDES         = new Set(['BUY', 'SELL']);
const VALID_PRODUCTS      = new Set(['CNC', 'NRML', 'MIS', 'BO', 'CO']);
const VALID_ORDER_TYPES   = new Set(['MARKET', 'LIMIT', 'SL', 'SL-M']);
const VALID_VARIETIES     = new Set(['regular', 'amo', 'co', 'iceberg', 'auction']);
const VALID_VALIDITY      = new Set(['DAY', 'IOC', 'TTL']);

app.post('/api/orders/place', async (req, res) => {
  const body = req.body || {};
  // Tier 15: SEBI Algo-ID is now required. Under the 1 Apr 2026 framework every
  // algo-routed order must carry an exchange-issued Algo-ID. We require the caller
  // to pass it explicitly -- the value comes from the broker after empanelment.
  const required = ['strategyTag', 'algoId', 'symbol', 'side', 'quantity', 'product', 'orderType'];
  for (const k of required) {
    if (!(k in body)) return res.status(400).json({ ok: false, reason: `missing:${k}` });
  }

  // Normalize + validate
  const side       = String(body.side).toUpperCase();
  const product    = String(body.product).toUpperCase();
  const orderType  = String(body.orderType).toUpperCase();
  const variety    = String(body.variety || 'regular').toLowerCase();
  const validity   = String(body.validity || 'DAY').toUpperCase();
  const quantity   = Number(body.quantity);
  const price      = body.price != null ? Number(body.price) : null;
  const triggerPx  = body.triggerPrice != null ? Number(body.triggerPrice) : null;
  const symbol     = String(body.symbol).trim();
  const exchange   = String(body.exchange || 'NSE').toUpperCase();

  if (!VALID_SIDES.has(side))             return res.status(400).json({ ok:false, reason:`invalid side: ${side}` });
  if (!VALID_PRODUCTS.has(product))       return res.status(400).json({ ok:false, reason:`invalid product: ${product}` });
  if (!VALID_ORDER_TYPES.has(orderType))  return res.status(400).json({ ok:false, reason:`invalid orderType: ${orderType}` });
  if (!VALID_VARIETIES.has(variety))      return res.status(400).json({ ok:false, reason:`invalid variety: ${variety}` });
  if (!VALID_VALIDITY.has(validity))      return res.status(400).json({ ok:false, reason:`invalid validity: ${validity}` });
  if (!Number.isFinite(quantity) || quantity <= 0) return res.status(400).json({ ok:false, reason:'quantity must be > 0' });
  if (orderType === 'LIMIT' && (!Number.isFinite(price) || price <= 0))
    return res.status(400).json({ ok:false, reason:'LIMIT order requires price > 0' });
  if ((orderType === 'SL' || orderType === 'SL-M') && (!Number.isFinite(triggerPx) || triggerPx <= 0))
    return res.status(400).json({ ok:false, reason:`${orderType} order requires triggerPrice > 0` });

  const clientOrderId = body.clientOrderId || crypto.randomUUID();

  const normalizedPayload = {
    strategyTag: String(body.strategyTag),
    algoId:      String(body.algoId),
    symbol, exchange, side, quantity, product, orderType, variety, validity,
    price, triggerPrice: triggerPx,
    clientOrderId,
    // Tier 15: rationale captured for audit trail (SEBI traceability)
    rationale:   body.rationale ? String(body.rationale).slice(0, 500) : null,
  };

  // Hard safety: while kill-switch is on, NEVER route to broker. Just audit.
  if (KILL_SWITCH) {
    audit('order.blocked.killSwitch', normalizedPayload);
    return res.status(503).json({
      ok: false,
      reason: 'KILL_SWITCH_ON',
      message: 'Live orders are disabled while KILL_SWITCH=true. Set KILL_SWITCH=false in /etc/ats/backend.env to enable.',
      clientOrderId,
      validatedPayload: normalizedPayload,
    });
  }

  // Tier 11 second gate: even with KILL_SWITCH=false, also require LIVE_TRADING=true.
  // This way operator must consciously flip TWO env vars to enable real orders.
  if (!LIVE_TRADING) {
    audit('order.blocked.liveTradingDisabled', normalizedPayload);
    return res.status(503).json({
      ok: false,
      reason: 'LIVE_TRADING_DISABLED',
      message: 'KILL_SWITCH is off but LIVE_TRADING env is not true. Set LIVE_TRADING=true in /etc/ats/backend.env to enable real orders.',
      clientOrderId,
      validatedPayload: normalizedPayload,
    });
  }

  // Tier 15 pre-trade risk-gate #1: order-rate circuit
  if (!_orderRateOk()) {
    audit('order.blocked.rateLimit', { ...normalizedPayload, ordersInWindow: _orderTimes.length, capPerMin: MAX_ORDERS_PER_MIN });
    return res.status(429).json({
      ok: false,
      reason: 'ORDER_RATE_LIMIT',
      message: `Max ${MAX_ORDERS_PER_MIN} orders/minute exceeded. ${_orderTimes.length} already placed in the last 60s.`,
      clientOrderId,
    });
  }

  // Tier 15 pre-trade risk-gate #2: per-order notional size cap
  const refPrice = Number(normalizedPayload.price || 0);
  const orderNotional = refPrice > 0 ? refPrice * normalizedPayload.quantity : 0;
  if (orderNotional > MAX_POSITION_SIZE_INR) {
    audit('order.blocked.notionalCap', { ...normalizedPayload, orderNotional, capINR: MAX_POSITION_SIZE_INR });
    return res.status(400).json({
      ok: false,
      reason: 'ORDER_NOTIONAL_TOO_LARGE',
      message: `Order notional ₹${Math.round(orderNotional)} exceeds per-order cap ₹${MAX_POSITION_SIZE_INR}.`,
      clientOrderId,
    });
  }

  // Tier 16 pre-trade risk-gate #4: max aggregate exposure check.
  // Sums: open paper positions (qty * lastPrice) + live holdings (qty * ltp) + this new order's notional.
  try {
    let exposure = orderNotional;
    if (paper) {
      const pos = paper.positions ? paper.positions() : [];
      for (const p of pos) exposure += Math.abs((p.qty || 0) * (p.ltp || p.avgPrice || 0));
    }
    if (typeof broker.getHoldings === 'function') {
      const hs = await broker.getHoldings().catch(() => []);
      for (const h of hs) exposure += Math.abs((h.quantity || 0) * (h.last_price || h.ltp || 0));
    }
    if (exposure > MAX_AGGREGATE_EXPOSURE) {
      audit('order.blocked.aggregateExposure', { ...normalizedPayload, exposure, capINR: MAX_AGGREGATE_EXPOSURE });
      return res.status(400).json({
        ok: false,
        reason: 'AGGREGATE_EXPOSURE_TOO_HIGH',
        message: `Adding this order would push aggregate exposure to ₹${Math.round(exposure)}, exceeding cap ₹${MAX_AGGREGATE_EXPOSURE}.`,
        clientOrderId,
      });
    }
  } catch (_e) {}

  // Tier 15 pre-trade risk-gate #3: daily-loss circuit (uses paper realizedPnl as proxy today)
  try {
    const stats = paper ? paper.stats() : null;
    const realizedToday = stats ? (stats.realizedPnl || 0) : 0;
    if (realizedToday <= -Math.abs(MAX_DAILY_LOSS_INR)) {
      audit('order.blocked.dailyLoss', { ...normalizedPayload, realizedToday, capINR: MAX_DAILY_LOSS_INR });
      return res.status(503).json({
        ok: false,
        reason: 'MAX_DAILY_LOSS_HIT',
        message: `Today's realized P&L ${realizedToday} has hit the daily-loss circuit (cap ₹${MAX_DAILY_LOSS_INR}). New live orders are blocked until tomorrow.`,
        clientOrderId,
      });
    }
  } catch (_e) {}

  if (typeof broker.placeOrder !== 'function') {
    audit('order.blocked.notImplemented', normalizedPayload);
    return res.status(501).json({
      ok: false,
      reason: 'PLACE_ORDER_NOT_IMPLEMENTED',
      message: 'Broker adapter has no placeOrder() method. Add it deliberately when wiring live trading.',
      clientOrderId,
      validatedPayload: normalizedPayload,
    });
  }

  // Reserved for the future. Unreachable today.
  _orderRateRecord();
  broker.placeOrder(normalizedPayload)
    .then((result) => {
      audit('order.placed', { clientOrderId, result });
      res.json({ ok: true, clientOrderId, ...result });
    })
    .catch((err) => {
      audit('order.placeError', { clientOrderId, msg: err.message });
      res.status(502).json({ ok: false, reason: err.message, clientOrderId });
    });
});

// Tier 11: cancel a working order. Same dual gating as place.
app.post('/api/orders/cancel', async (req, res) => {
  const body = req.body || {};
  const orderId = String(body.orderId || '').trim();
  const variety = String(body.variety || 'regular').toLowerCase();
  if (!orderId) return res.status(400).json({ ok: false, reason: 'missing:orderId' });
  if (KILL_SWITCH)  { audit('order.cancel.blocked.killSwitch', { orderId }); return res.status(503).json({ ok:false, reason:'KILL_SWITCH_ON' }); }
  if (!LIVE_TRADING){ audit('order.cancel.blocked.liveTradingDisabled', { orderId }); return res.status(503).json({ ok:false, reason:'LIVE_TRADING_DISABLED' }); }
  if (typeof broker.cancelOrder !== 'function') {
    audit('order.cancel.blocked.notImplemented', { orderId });
    return res.status(501).json({ ok: false, reason: 'CANCEL_ORDER_NOT_IMPLEMENTED' });
  }
  try {
    const r = await broker.cancelOrder({ orderId, variety });
    audit('order.cancelled', { orderId, result: r });
    res.json({ ok: true, ...r });
  } catch (e) {
    audit('order.cancelError', { orderId, msg: e.message });
    res.status(502).json({ ok: false, reason: e.message, orderId });
  }
});

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

// ---------- Broker OAuth: Zerodha ----------
// Step 1: send the user to Kite to log in
app.get('/api/brokers/zerodha/login', (_req, res) => {
  if (BROKER_NAME !== 'zerodha') {
    return res.status(400).send('BROKER is not "zerodha" on this server.');
  }
  const url = broker.buildLoginUrl();
  audit('zerodha.loginUrl', {});
  res.redirect(url);
});

// Step 2: Kite redirects back with ?request_token=...
app.get('/api/brokers/zerodha/callback', async (req, res) => {
  if (BROKER_NAME !== 'zerodha') return res.status(400).send('Not configured for Zerodha.');
  const rt = req.query.request_token;
  if (!rt) return res.status(400).send('Missing request_token in callback.');
  try {
    const session = await broker.exchangeRequestToken(rt);
    broker.setAccessToken(session.accessToken);
    await sessions.saveTokens(session.userId, {
      accessToken: session.accessToken,
      publicToken: session.publicToken,
      userId: session.userId,
      issuedAt: new Date().toISOString(),
    });
    const sid = sessions.newSession(session.userId);
    setSessionCookie(res, sid);
    audit('zerodha.connected', { userId: session.userId });

    // Redirect back to the cockpit. The user lands on the dashboard with a live feed.
    res.redirect('/?connected=zerodha');
  } catch (err) {
    audit('zerodha.callback.error', { msg: err.message });
    res.status(500).send(`Zerodha exchange failed: ${err.message}`);
  }
});

// ---------- Auto-login helpers (loopback-only) ----------
//
// The actual browser automation runs on the HOST (via Playwright installed
// directly on Ubuntu). These two routes exist for the host script to:
//   (a) fetch the loginUrl + sealed credentials
//   (b) hand back the captured request_token for sealing
//
// Both require X-ATS-Internal header AND loopback IP. KILL_SWITCH stays TRUE.

function requireInternal(req, res) {
  // Allow loopback AND docker private network IPs (10.x, 172.16-31.x, 192.168.x).
  // When the host curl 127.0.0.1:8080 → docker proxy → container, the container
  // sees the docker bridge gateway as the source (e.g. 172.18.0.1), NOT 127.0.0.1.
  // Nginx, which proxies real public traffic, is configured upstream to STRIP the
  // X-ATS-Internal header — so the header check is the actual security boundary.
  const ra = (req.ip || req.connection.remoteAddress || '').replace('::ffff:', '');
  const isLoopback = ra === '127.0.0.1' || ra === '::1';
  const isPrivate  = /^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)/.test(ra);
  if (!isLoopback && !isPrivate) {
    audit('internal.rejected', { reason: 'non_internal_ip', ip: ra });
    res.status(403).json({ ok: false, reason: 'external_ip' });
    return false;
  }
  if (req.headers['x-ats-internal'] !== '1') {
    audit('internal.rejected', { reason: 'missing_header', ip: ra });
    res.status(403).json({ ok: false, reason: 'missing_header' });
    return false;
  }
  return true;
}

// Host-side script calls this to fetch credentials + loginUrl in one trip.
app.get('/api/brokers/zerodha/auto-login/bundle', async (req, res) => {
  if (!requireInternal(req, res)) return;
  if (BROKER_NAME !== 'zerodha') {
    return res.status(400).json({ ok: false, reason: 'broker_not_zerodha' });
  }
  try {
    if (!vault) return res.status(503).json({ ok: false, reason: 'vault_not_open' });
    const lv = new LoginVault(vault);
    if (!lv.exists()) {
      return res.status(412).json({ ok: false, reason: 'no_creds_run_install_script' });
    }
    const creds = await lv.load();
    audit('autologin.bundle.served', { userId: creds.userId });
    res.json({
      ok: true,
      loginUrl: broker.buildLoginUrl(),
      userId:   creds.userId,
      password: creds.password,
      totpSeed: creds.totpSeed,
    });
  } catch (err) {
    audit('autologin.bundle.error', { msg: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Host-side script POSTs the request_token here once Kite redirects.
app.post('/api/brokers/zerodha/auto-login/exchange', express.json(), async (req, res) => {
  if (!requireInternal(req, res)) return;
  if (BROKER_NAME !== 'zerodha') {
    return res.status(400).json({ ok: false, reason: 'broker_not_zerodha' });
  }
  const rt = req.body && req.body.requestToken;
  if (!rt) return res.status(400).json({ ok: false, reason: 'missing_request_token' });
  try {
    const session = await broker.exchangeRequestToken(rt);
    broker.setAccessToken(session.accessToken);
    await sessions.saveTokens(session.userId, {
      accessToken: session.accessToken,
      publicToken: session.publicToken,
      userId:      session.userId,
      issuedAt:    new Date().toISOString(),
    });
    audit('autologin.connected', { userId: session.userId });
    notify('success', 'ATS auto-login OK', {
      body: 'Kite session established. Ticker connecting.',
      fields: { userId: session.userId, time: new Date().toISOString() },
    }).catch(() => {});
    res.json({ ok: true, userId: session.userId });
  } catch (err) {
    audit('autologin.exchange.error', { msg: err.message });
    notify('error', 'ATS auto-login exchange FAILED', {
      body: err.message.slice(0, 200),
      url: 'https://ats.rajasekarselvam.com/api/brokers/zerodha/login',
    }).catch(() => {});
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/brokers/disconnect', async (req, res) => {
  const sid = readSessionCookie(req);
  if (!sid) return res.status(401).json({ ok: false });
  const uid = sessions.userIdFor(sid);
  if (uid) {
    await sessions.forgetTokens(uid);
    audit('zerodha.disconnect', { userId: uid });
  }
  res.json({ ok: true });
});

app.use('/api', (_req, res) => res.status(404).json({ ok: false, reason: 'not_found' }));

// ---------- HTTP + WebSocket server ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// Single shared subscription against the broker. Adapter does the heavy lifting.
const wsClients = new Set(); // Set<WebSocket>
let brokerUnsubscribe = null;

async function startBrokerFanout() {
  if (brokerUnsubscribe) return;
  brokerUnsubscribe = await broker.subscribeTicks(DEFAULT_SYMBOLS, (tick) => {
    // 1. Evaluate alerts (synchronous, no I/O).
    try { if (alerts) alerts.evaluate(tick); } catch (e) { /* keep loop alive */ }
    // 2. Drive paper trading fills (synchronous, debounced persist).
    try { if (paper) paper.onTick(tick); } catch (e) { /* keep loop alive */ }
    // 3. Fan out to /ws clients.
    const payload = JSON.stringify({ type: 'tick', ...tick });
    for (const ws of wsClients) {
      if (ws.readyState === 1) ws.send(payload);
    }
  });
}

wss.on('connection', (ws, req) => {
  if (wsClients.size > MAX_WS_CLIENTS) { ws.close(1013, 'too many clients'); return; }
  wsClients.add(ws);
  audit('ws.connect', { ip: req.socket.remoteAddress, total: wsClients.size });

  // Build the effective subscribe set: defaults + persisted watchlist (deduped).
  const userSaved = watchlist ? watchlist.list() : [];
  const merged = Array.from(new Set([...DEFAULT_SYMBOLS, ...userSaved]));

  ws.send(JSON.stringify({
    type: 'welcome',
    broker: broker.name,
    killSwitch: KILL_SWITCH,
    liveTrading: LIVE_TRADING,
    symbols: merged,
    defaultSymbols: DEFAULT_SYMBOLS,
    watchlist: userSaved,
    note: broker.name === 'mock'
      ? 'Simulated ticks for UI only. Not a real market feed.'
      : 'Live ticks via Kite Ticker. Subject to market hours.',
  }));

  // Auto-subscribe so this client gets ticks immediately during market hours.
  if (typeof broker.ensureSubscribed === 'function') {
    broker.ensureSubscribed(merged).catch((err) =>
      console.error('[ws] auto-subscribe failed:', err && err.message)
    );
  }

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
      return;
    }

    if (msg.type === 'subscribe' && Array.isArray(msg.symbols)) {
      const symbols = msg.symbols.filter(s => typeof s === 'string').slice(0, 200);
      if (typeof broker.ensureSubscribed === 'function') {
        broker.ensureSubscribed(symbols)
          .then((result) => {
            audit('ws.subscribe', { count: symbols.length, ...result });
            ws.send(JSON.stringify({ type: 'subscribed', symbols, ...result }));
          })
          .catch((err) => {
            ws.send(JSON.stringify({ type: 'error', reason: err.message }));
          });
      }
      return;
    }
  });

  ws.on('close', () => {
    wsClients.delete(ws);
    audit('ws.disconnect', { total: wsClients.size });
  });
});

// ---------- Boot ----------
(async () => {
  try {
    await init();
    await startBrokerFanout();
    // Bind 0.0.0.0 inside the container; host exposure is restricted by docker-compose port mapping to 127.0.0.1.
    server.listen(PORT, '0.0.0.0', () => {
      audit('server.start', { port: PORT, env: ENV_NAME, killSwitch: KILL_SWITCH, broker: broker.name });
      console.log(`ats-backend listening on 127.0.0.1:${PORT} (env=${ENV_NAME}, broker=${broker.name}, killSwitch=${KILL_SWITCH})`);
    });
  } catch (err) {
    console.error('FATAL boot error:', err);
    audit('server.bootError', { msg: err.message });
    process.exit(1);
  }
})();

// ---------- Shutdown ----------
function shutdown(sig) {
  audit('server.stop', { signal: sig });
  console.log(`\nCaught ${sig}, shutting down...`);
  Promise.resolve(broker && broker.stop()).finally(() => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  });
}
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (r) => {
  audit('error.unhandledRejection', { reason: String(r) });
  console.error('unhandledRejection:', r);
});
process.on('uncaughtException', (e) => {
  audit('error.uncaughtException', { message: e.message, stack: e.stack });
  console.error('uncaughtException:', e);
  process.exit(1);
});
 