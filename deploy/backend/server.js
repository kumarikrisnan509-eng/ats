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
// T-220: rate-limit helpers moved to services/order-rate-limit.js.
// Names preserved (underscore prefix) so existing route handler call sites
// + the order-guards.test.js source-grep assertion continue to work.
const _orderRateLimit = require('./services/order-rate-limit');
const _orderTimes = _orderRateLimit._orderTimes;
const _orderRateOk = _orderRateLimit.orderRateOk;
const _orderRateRecord = _orderRateLimit.orderRateRecord;
// T-219 (CODE-AUDIT F.5 M1.4 piece 5a): order-payload validation constants extracted.
const { VALID_SIDES, VALID_PRODUCTS, VALID_ORDER_TYPES, VALID_VARIETIES, VALID_VALIDITY } = require('./services/order-validation');
// T-218 (CODE-AUDIT F.5 M1.4 piece 4): /api/portfolio + /api/me/portfolio routes extracted.
const { mountPortfolioRoutes } = require('./routes/portfolio');
// T-241: Mutual-fund read-side endpoints (Kite Connect MF is GET-only)
// T-248: mountMfRoutes require removed (routes/mf.js deleted; 410 Gone stubs serve the URLs).
// T-217 (CODE-AUDIT F.5 M1.4 piece 3 + A.2 fix): OAuth state-signer.
const _oauthState = require('./services/oauth-state');
const _pendingNonces = _oauthState._pendingNonces;
const _signState = _oauthState.signState;
const _verifyState = _oauthState.verifyState;
// T-216 (CODE-AUDIT F.5 M1.4 piece 2): /api/auth/* routes extracted.
const { mountAuthRoutes } = require('./routes/auth');
// T-262: /api/me/risk-config GET/PUT (replaces SETUP-TRADING.cmd CLI).
const { mountRiskConfigRoutes } = require('./routes/risk-config');
// T-484: soft-kill endpoints (UI Kill button backing).
const { mountAdminKillRoutes } = require('./routes/admin-kill');
// T-496: panic square-off endpoint (flatten all open broker positions).
const { mountAdminSquareOffRoutes } = require('./routes/admin-square-off');
const { createRiskConfigService } = require('./services/risk-config');
// T-264: tax-aware trade economics service (per-trade STT/GST/SEBI/brokerage math).
const { createTradeEconomics } = require('./services/trade-economics');
// T-276: daily SIP runner -- cron + idempotent order placer for DCA mix.
const { createSipRunner } = require('./services/sip-runner');
// T-499: nightly paper->live promotion scheduler (uses promotion-policy).
const { createPromoteScheduler } = require('./services/promote-scheduler');
// T-272: unified position view aggregator (Phase 2).
const { createPortfolioAggregates } = require('./services/portfolio-aggregates');
// T-280: market regime detector (Phase 3).
const { createRegimeDetector } = require('./services/regime-detector');
// T-283: daily performance attribution (Phase 3 close-out).
const { createAttribution } = require('./services/attribution');
// T-300: slippage observational service (Phase 5 kickoff).
const { createSlippageTracker } = require('./services/slippage-tracker');
// T-273: consolidated pre-trade gate pipeline.
const { createPreTradeCheck } = require('./services/pre-trade');
// T-268: full notify namespace (AutoRunner needs notify.notifyOrderPlaced etc).
const _notifyModule = require('./notify');
const _tradeEconomics = createTradeEconomics();
// T-214 (CODE-AUDIT F.5 M1.4 piece 1): strategies registry extracted.
const { STRATEGIES, mountStrategiesRoutes, isStrategyEligibleInRegime } = require('./routes/strategies');
// T-223 (CODE-AUDIT F.5 M1.4 piece 6a): /api/orders/dry-run extracted.
const { mountOrdersRoutes } = require('./routes/orders');
// T-226 (CODE-AUDIT F.5 M1.4 piece 7a): broker tick fan-out + upstream-state broadcaster.
const { attachUpstreamFanout } = require('./services/tick-fanout');
// T-227 (CODE-AUDIT F.5 M1.4 piece 7b): /ws WebSocketServer + connection handler.
const { mountWs } = require('./routes/ws');
// T-290e: option-chain fetcher + read routes (env-gated).
const { OptionChainFetcher } = require('./services/option-chain-fetcher');
const mountOptionChainRoutes = require('./routes/option-chain');
// T-298a: options scanner -- SHADOW MODE only, never fires orders.
const { OptionsScanner } = require('./services/options-scanner');
// T-294b: rollupOptionGreeks helper from portfolio-aggregates.
const { rollupOptionGreeks } = require('./services/portfolio-aggregates');
// T-302a/T-303a: signal calibration + auto-retire recommender (pure service).
const { createSignalCalibration } = require('./services/signal-calibration');
// T-280c: NSE macro fetcher (FII/DII, breadth, 52w highs/lows) -- env-gated cron.
const { NseMacroFetcher } = require('./services/nse-macro-fetcher');
// T-301a: walk-forward parameter optimization helpers.
const { createWalkForward } = require('./services/walk-forward');
const { runBacktest: _wfRunBacktest } = require('./backtest');
const http    = require('http');
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');
const cookie  = require('cookie');

const { createBroker } = require('./brokers');
const { Vault }        = require('./crypto-vault');
const { SessionStore } = require('./sessions');
const { LoginVault }   = require('./login-vault');
const { notify, postTelegram } = require('./notify');
const { Alerts }       = require('./alerts');
const { Watchlist }    = require('./watchlist');
const { Scanner, classifyRegime } = require('./scanner');
const { NseSurveillance } = require('./nse-surveillance');     // T99-E2 ASM/GSM/T2T gate
const { EarningsCalendar } = require('./earnings-calendar');   // E4 NSE event-calendar feed
const { FiiDii } = require('./fii-dii');                       // E7 NSE FII/DII activity feed
const { BulkDeals } = require('./bulk-deals');                 // E8 NSE bulk + block deals
// T-248: MfData require removed -- mf-data.js can be deleted after 2026-06-19.
let _surveillance = null;     // T99-E2 NseSurveillance instance (lazy refresh)
let _earningsCal = null;       // E4 EarningsCalendar instance (lazy refresh)
let _fiidii = null;             // E7 FiiDii instance (lazy refresh)
let _bulkDeals = null;          // E8 BulkDeals instance (lazy refresh)
// T-248: _mfData binding removed; nothing references it anymore.
const { runBacktest, computeSignal } = require('./backtest');
const { PaperTrading } = require('./paper');
const { PnlAttribution } = require('./pnl-attribution');
const { AutoRunner }   = require('./autorun');
// T-497: strategy id -> mode lookup so AutoRunner can gate on user_risk_config.activeModes.
const { STRATEGIES: _ALL_STRATEGIES } = require('./routes/strategies');
const _strategyModeMap = new Map((_ALL_STRATEGIES || []).map(x => [x.id, x.mode || 'intraday']));
function _getStrategyMode(strategyId) { return _strategyModeMap.get(strategyId) || 'intraday'; }
const { NewsFeed }     = require('./news');
const { TaxPlanner }   = require('./tax');
const { ClaudeAI }     = require('./ai');
const { SweepEngine }  = require('./sweep');
const { LongTerm }     = require('./longterm');
const { Wealth }       = require('./wealth');
const { MPT }          = require('./mpt');
const { FactorTilt }   = require('./factor-tilt');
const { WormAudit }    = require('./worm-audit');
const { SpanSim }      = require('./span-sim');
const { buildIpAllowlist } = require('./ip-allowlist');
const { TwoFactor }    = require('./two-factor');
const { Digest }       = require('./digest');
const { parseCASText } = require('./cas-parser');
const { open: openDb } = require('./db');
const { createUsers } = require('./users');
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
// T-195 (CODE-AUDIT C.10 #5): refuse to boot in prod with the default secret.
// In dev/test we tolerate it so contributors can run the suite without env wiring.
// T-443 (audit-2026-05-26 vm-scripts M2): also reject the
// setup-oracle-linux-docker.sh placeholder CHANGE-ME-BASE64 in case an
// operator runs an older copy of that script that didn't auto-generate.
const _BAD_SESSION_SECRETS = new Set([
  'dev-only-change-me',
  'CHANGE-ME-BASE64',
  '__SESSION_SECRET_GENERATED__',
  '',
]);
if (_BAD_SESSION_SECRETS.has(SESSION_SECRET) && (process.env.ENV_NAME === 'prod' || process.env.NODE_ENV === 'production')) {
  console.error('FATAL: SESSION_SECRET is still a placeholder value in a prod-flagged environment.');
  console.error('       Set SESSION_SECRET=$(openssl rand -base64 48) in /etc/ats/backend.env and re-deploy.');
  process.exit(1);
}
// Also enforce a minimum length so a too-short manual value doesn't slip through.
if (SESSION_SECRET.length < 32 && (process.env.ENV_NAME === 'prod' || process.env.NODE_ENV === 'production')) {
  console.error('FATAL: SESSION_SECRET is shorter than 32 chars in a prod-flagged environment.');
  process.exit(1);
}
const DEFAULT_SYMBOLS = (process.env.DEFAULT_SYMBOLS || 'NIFTY 50,BANKNIFTY,RELIANCE,HDFCBANK,TCS,INFY')
    .split(',').map(s => s.trim()).filter(Boolean);

// ---------- Audit ----------
let auditSeq = 0;
// T-380 (security audit #9 HIGH): track call-site swallow attempts that
// would have hidden audit degradation. Call sites in users.js etc. wrap
// audit() in try/catch to defend against rare failures (circular-ref data
// crashing JSON.stringify before the appendFileSync). Without this counter
// those failures were silent. Now they're surfaced via /api/health so an
// operator can see if audit() is dropping events even though the file
// itself is healthy.
let auditDegradedCount = 0;
let auditLastDegradedError = null;
let auditLastDegradedAt    = null;
// T-419 (production-readiness audit, infra fix #4): business-metric counters
// declared BEFORE recordAuditSwallow / audit() so neither function hits a TDZ
// reference at call time. Surfaced via /metrics for Prometheus alerting.
// Counter semantics: monotonic; reset only on process restart.
const _metricCounters = {
  ordersPlaced:        0,   // order.placed + order.confirmed events
  brokerDisconnects:   0,   // zerodha.disconnect (manual or forced)
  auditWriteFailures:  0,   // mirrors auditDegradedCount as a counter
  oauthFailures:       0,   // zerodha.callback.*.error + autologin.*.error + bulkrotate.*.error
};
function _bumpMetric(event) {
  if (!event || typeof event !== 'string') return;
  if (event === 'order.placed' || event === 'order.confirmed') {
    _metricCounters.ordersPlaced += 1;
  } else if (event === 'zerodha.disconnect') {
    _metricCounters.brokerDisconnects += 1;
  } else if (event.endsWith('.error') && (
    event.startsWith('zerodha.callback.') ||
    event.startsWith('autologin.') ||
    event.startsWith('bulkrotate.')
  )) {
    _metricCounters.oauthFailures += 1;
  }
}
// T-458 (audit-2026-05-26 backend L4): one-shot Telegram alert at
// escalating audit-degradation thresholds. Operator has /metrics for
// quantitative monitoring but no push notification — by the time
// auditDegradedCount crosses 100 the JSONL stream may have been
// silently dropping events for hours. Thresholds (10, 50, 100, 500)
// fire each at most once per process lifetime; the alert goes via
// console.error + notify() if it's wired (the notify() module is
// loaded late so we guard).
const _AUDIT_DEGRADED_THRESHOLDS = [10, 50, 100, 500];
const _auditAlertsFired = new Set();
function _maybeAlertAuditDegraded() {
  for (const t of _AUDIT_DEGRADED_THRESHOLDS) {
    if (auditDegradedCount >= t && !_auditAlertsFired.has(t)) {
      _auditAlertsFired.add(t);
      console.error(`[audit] DEGRADED count crossed ${t}: ${auditLastDegradedError}`);
      try {
        if (typeof notify === 'function') {
          notify('warn', `ATS audit log degraded (${t}+ failures)`, {
            body: 'audit() write path is dropping events into console fallback.',
            fields: {
              'count': String(auditDegradedCount),
              'lastError': auditLastDegradedError || '(none)',
              'lastAt': auditLastDegradedAt || '(none)',
            },
          }).catch(() => {});
        }
      } catch (_) { /* notify may not be loaded yet */ }
    }
  }
}

function recordAuditSwallow(source, msg) {
  auditDegradedCount += 1;
  _metricCounters.auditWriteFailures += 1;
  auditLastDegradedError = String(source || 'unknown') + ': ' + String(msg || 'unknown');
  auditLastDegradedAt    = new Date().toISOString();
  _maybeAlertAuditDegraded();
}
// Tier 15: rolling-window order rate counter (in-memory, per-process).
// On restart this resets, which is fine -- the cap is per-minute, not per-day.


function audit(event, data) {
  auditSeq += 1;
  _bumpMetric(event);
  // T-380: serialize defensively. A circular-ref or BigInt in `data` would
  // make JSON.stringify throw -- previously this propagated to call sites
  // and got swallowed. Now we degrade to an _error stub line so the audit
  // chain stays continuous and the degraded counter ticks.
  let line;
  try {
    line = JSON.stringify({
      seq: auditSeq, ts: new Date().toISOString(), env: ENV_NAME, event, data,
    });
  } catch (jsonErr) {
    recordAuditSwallow('audit/serialize', jsonErr && jsonErr.message);
    line = JSON.stringify({
      seq: auditSeq, ts: new Date().toISOString(), env: ENV_NAME, event,
      _error: 'data_serialize_failed', _msg: String(jsonErr && jsonErr.message),
    });
  }
  // Tier 32: mirror into the WORM (tamper-evident) log if initialized.
  // Failure here never breaks the primary audit.log stream below.
  try { if (wormAudit && wormAudit._initialized) wormAudit.append(event, data); } catch (_e) {}
  try {
    fs.mkdirSync(path.dirname(AUDIT_LOG), { recursive: true });
    // T-437 (audit-2026-05-26 backend M7): force mode 0600 on every append so
    // a misconfigured deploy (e.g. /var/log/ats/ with o+rx for nginx) doesn't
    // silently inherit world-readable perms. The audit log contains 2FA token
    // hashes + path traces that must stay operator-only.
    fs.appendFileSync(AUDIT_LOG, line + '\n', { mode: 0o600 });
    // Defense-in-depth: if the file already existed with looser perms (it
    // does on legacy deploys), force-tighten it. fs.chmodSync is a no-op if
    // already 0600 on most filesystems; tolerant of EPERM if not owner.
    try { fs.chmodSync(AUDIT_LOG, 0o600); } catch (_) { /* not owner */ }
  } catch (err) {
    console.error('FATAL: audit log write failed:', err);
    process.exit(1);
  }
}

// ---------- Boot: broker + vault + sessions + alerts ----------
let broker, vault, sessions, alerts, watchlist, scanner, paper, pnl, autorun, news, tax, ai, sweep, longterm, wealth, mpt, factorTilt, wormAudit, spanSim, twoFactor, digest, db, auth, rebalance, replay, emailAlerts, whatsAppAlerts, riskConfigService, sipRunner, portfolioAggregates, regimeDetector, attribution, slippageTracker, preTradeCheck, optionChainFetcher, optionsScanner, signalCalibration, nseMacroFetcher, promoteScheduler;  // T-381: nseMacroFetcher was previously assigned without declaration -> created an implicit global (works only because CommonJS files arent strict mode). ESLint no-undef caught this.

async function init() {
  // T-447 (audit-2026-05-26 backend M9): wormAudit MUST come first so
  // every subsequent audit() call lands on the tamper-evident chain, not
  // just the JSONL log. The original constructor was ~400 lines down,
  // after broker.start + 20 other inits — meaning the very first audit
  // events were silently dropped from the chain.
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
    // Cannot use audit('worm.init.broken') here because audit() would
    // try to write to the very chain we just failed to init. Plain console
    // error; the JSONL audit.log still gets it via the audit() call below.
    console.error(`!! WORM audit chain BROKEN at entry ${_wormInit.brokenAt} (${_wormInit.count} total)`);
  } else {
    console.log(`worm-audit: ${_wormInit.fresh ? 'fresh log' : 'resumed'} (count=${_wormInit.count})`);
  }

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

  // T99-E2: build surveillance gate once; it will refresh lazily on first scanner run
  // and re-fetch every 60min thereafter. Failures are tolerated (cached or empty maps).
  _surveillance = new NseSurveillance({});
  // Kick off a warm-up refresh in the background; don't block boot.
  _surveillance.refresh().catch(e => console.warn('[server] surveillance warm-up failed:', e.message));

  // E4 earnings calendar
  _earningsCal = new EarningsCalendar({});
  _earningsCal.refresh().catch(e => console.warn('[server] earnings-cal warm-up failed:', e.message));

  // E7 FII/DII feed
  _fiidii = new FiiDii({});
  _fiidii.refresh().catch(e => console.warn('[server] fii-dii warm-up failed:', e.message));

  // E8 bulk / block deals
  _bulkDeals = new BulkDeals({});
  _bulkDeals.refresh().catch(e => console.warn('[server] bulk-deals warm-up failed:', e.message));

  // T-248: G8 MfData init removed -- scheme master + NAV refresh no longer needed
  // now that MF endpoints are retired. Stays null so straggler refs no-op.

  scanner = new Scanner({
    broker,
    watchlist,
    notify,
    audit,
    storePath: process.env.SCANNER_PATH || '/var/lib/ats/tokens/_scanner.json',
    surveillance: _surveillance,
    // T99-T125 (v11-E3): pass earningsCal so scanner can apply results-day blackout
    earningsCal: _earningsCal,
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
    // T-269: TSL config getter. Reads operator's tslActivatePct + tslGapPct
    // from risk-config (60s cached). Null/missing = paper uses safe defaults.
    getTslConfig: () => {
      if (!riskConfigService) return null;
      const cfg = riskConfigService.cachedGet(1);
      if (!cfg) return null;
      return { tslActivatePct: cfg.tslActivatePct, tslGapPct: cfg.tslGapPct };
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
    // T-263..T-267: risk-aware engine wiring. Engine reads operator's user_risk_config
    // via cachedGet (60s TTL) and runs all gates (golden window, daily cap, economics,
    // Telegram receipts) before placing paper orders.
    getRiskConfig:  (userId) => riskConfigService ? riskConfigService.cachedGet(userId) : null,
    tradeEconomics: _tradeEconomics,
    notify:         _notifyModule,
    userId:         1,   // operator account; multi-user comes in Phase 2 (T-272+)
    // T-282: regime-aware strategy gate. autorun consults the regime detector
    // (5-min cached) + strategy regime map on every signal evaluation. If the
    // current strategy is not eligible in the current regime, the trade is
    // skipped with 'skipped_wrong_regime'. Permissive on detector failure.
    getRegime: async () => regimeDetector ? regimeDetector.cachedDetect() : null,
    isStrategyEligibleInRegime,
    // T-496: market-hours/holiday gate for autorun.runOnce. Getter form so
    // AutoRunner is robust to _marketMeta being assigned later in init().
    getMarketMeta: () => _marketMeta,
    // T-497: strategy -> mode lookup so autorun gates on user_risk_config.activeModes.
    getStrategyMode: _getStrategyMode,
    // T-502: route paper vs live for strategies in liveEnabledStrategies. The
    // live path runs payload through preTradeCheck.check() (12-gate stack).
    preTradeCheck: { check: (args) => preTradeCheck ? preTradeCheck.check(args) : { ok: false, reason: 'preTradeCheck_not_initialized' } },
    // T-298b: SHADOW-only options scanner. Passed by reference but unused
    // until OPTIONS_AUTORUN_ENABLED=true at scan() call time. autorun's
    // shadow-runner is fire-and-forget after the existing 8-gate chain.
    // Note: optionsScanner is assigned later in init(); pass a getter
    // function so autorun resolves the current binding at call time.
    getOptionsScanner: () => optionsScanner || null,
    getHoldings: async () => {
      try {
        const { loadHoldingsFromBroker } = require('./services/holdings-loader');
        if (!broker) return [];
        return await loadHoldingsFromBroker(broker);
      } catch { return []; }
    },
    optionsUnderlyings: (process.env.OPTIONS_SCANNER_UNDERLYINGS || '')
      .split(',').map(s => s.trim()).filter(Boolean)
      .map(u => ({ underlying: u, maxRows: 5 })),
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
// Tier 49 + 50: SQLite-backed user accounts.
  try {
    db = openDb();
    auth = createUsers({ db, emailAlerts: null, audit, secureCookie: ENV_NAME === 'prod' });
    console.log(`db: ${db.users.count()} users registered`);

    // Phase E v4: test-user seed. When ATS_TEST_USER_SEED=1, ensure a
    // deterministic test account exists so Playwright visual snapshots can
    // log in and capture auth-gated screens against a known shape. The
    // seed user is created idempotently; if it already exists we leave
    // it alone. Hard-gated to non-prod via ENV_NAME check so prod can
    // never accidentally seed a known-password account.
    if (process.env.ATS_TEST_USER_SEED === '1' && ENV_NAME !== 'prod') {
      try {
        const TEST_EMAIL = 'test@local.invalid';
        const TEST_PASSWORD = 'LocalTestUser_2026!';
        const existing = db.users.byEmail(TEST_EMAIL);
        if (!existing) {
          await auth.signup({ email: TEST_EMAIL, password: TEST_PASSWORD, name: 'Local Test User' });
          console.log(`[server] Phase E v4 test-user seeded: ${TEST_EMAIL}`);
        } else {
          console.log(`[server] Phase E v4 test-user already present: ${TEST_EMAIL}`);
        }
      } catch (e) {
        console.warn('[server] test-user seed failed (non-fatal):', e && e.message);
      }
    }
  } catch (e) {
    console.error('!! DB init failed:', e.message);
    db = null; auth = null;
  }
  // T-262: per-user risk-management config service. Depends on db, so
  // construct it right after openDb() succeeds. Used by the
  // /api/me/risk-config routes and (via cachedGet) by the autorun + DCA
  // engines so the operator's UI changes propagate without restart.
  try {
    if (db) riskConfigService = createRiskConfigService(db);
  } catch (e) {
    console.error('!! riskConfigService init failed:', e.message);
    riskConfigService = null;
  }

  // T-447 (audit-2026-05-26 backend M8): construct _marketMeta HERE, inside
  // init() where db + broker are guaranteed available. Previously this lived
  // as a top-level IIFE that ran before init() and silently failed the guard,
  // so the daily holiday refresh cron never auto-armed.
  try {
    if (db && broker) {
      const { createMarketMeta } = require('./market-meta');
      _marketMeta = createMarketMeta({ db, broker });
      _marketMeta.scheduleDailyRefresh();
      audit('market-meta.init', { ok: true });
    }
  } catch (e) {
    console.error('[server] market-meta init failed:', e && e.message);
    audit('market-meta.init.failed', { reason: e && e.message });
  }

  // T-276: SIP runner. Daily cron at 09:30 IST + idempotent order placement.
  // Depends on db (sip_fires table), riskConfigService (read dcaAllocation +
  // capital), paper (place orders), broker (getLastTicks for spot price).
  // Skipped silently if any dep missing -- the rest of the engine keeps running.
  try {
    if (db && riskConfigService && paper) {
      sipRunner = createSipRunner({
        db, riskConfigService, paper, audit, notify: _notifyModule,
        getLastTick: (sym) => {
          if (typeof broker.getLastTicks !== 'function') return null;
          const arr = broker.getLastTicks();
          const hit = arr.find(t => t.symbol === sym);
          return hit ? hit.ltp : null;
        },
        // T-496: SIP plan() consults marketMeta.isHolidayOrWeekend() so SIPs
        // defer on Diwali/Holi etc., not just weekends.
        marketMeta: _marketMeta,
      });
      sipRunner.start(1);   // operator account; multi-user comes with T-272+
      console.log('[server] SIP runner armed (09:30 IST daily + boot catch-up)');
    }
  } catch (e) {
    console.error('!! sipRunner init failed:', e.message);
    sipRunner = null;
  }

  // T-499: nightly paper->live promotion scheduler. Re-evaluates each
  // strategy's paper performance against promotion-policy at 23:30 IST
  // and updates risk_config.liveEnabledStrategies accordingly. Fires
  // Telegram on every promote/demote so the operator always sees the
  // live-enabled set without polling.
  try {
    if (db && riskConfigService) {
      promoteScheduler = createPromoteScheduler({
        db, riskConfigService, notify: _notifyModule, audit,
      });
      promoteScheduler.start();
      console.log('[server] promote-scheduler armed (23:30 IST daily)');
    }
  } catch (e) {
    console.error('!! promoteScheduler init failed:', e.message);
    promoteScheduler = null;
  }

  // T-272: portfolio aggregator (Phase 2). Pure read service -- consults
  // paper.positions(), paper.stats().cash, broker.getLastTicks(), paper.trades().
  // Powers GET /api/me/portfolio/aggregates and the Risk Cockpit screen.
  try {
    if (paper) {
      portfolioAggregates = createPortfolioAggregates({
        getPositions: () => paper.positions ? paper.positions() : [],
        getCash:      () => (paper.stats && paper.stats().cash) || 0,
        getTicks:     () => {
          if (typeof broker.getLastTicks !== 'function') return new Map();
          const arr = broker.getLastTicks();
          return new Map(arr.map(t => [t.symbol, t.ltp]));
        },
        getTrades:    (n) => paper.trades ? paper.trades(n) : [],
      });
      console.log('[server] portfolio aggregator armed');
    }
  } catch (e) {
    console.error('!! portfolioAggregates init failed:', e.message);
    portfolioAggregates = null;
  }

  // T-280: regime detector. Reads NIFTY 50 daily candles + India VIX from
  // the live broker connection. Cached 5 min so callers can poll cheaply.
  try {
    if (broker) {
      regimeDetector = createRegimeDetector({ broker, audit });
      console.log('[server] regime detector armed (NIFTY + VIX classifier)');
    }
  } catch (e) {
    console.error('!! regimeDetector init failed:', e.message);
    regimeDetector = null;
  }

  // T-283: daily attribution writer (post-close 16:00 IST snapshot)
  try {
    if (paper) {
      attribution = createAttribution({
        getTrades:               (n) => paper.trades ? paper.trades(n) : [],
        getAutorunHistory:       (n) => autorun ? autorun.history(n) : [],
        getRegime:               () => null,   // sync only; regime fetch is async, skipped in snapshot v1
        getPortfolioAggregates:  () => portfolioAggregates ? portfolioAggregates.compute() : null,
        storePath: process.env.ATTRIBUTION_PATH || '/var/lib/ats/tokens/_attribution.jsonl',
        audit,
      });
      attribution.start();
      console.log('[server] daily attribution armed (16:00 IST snapshot)');
    }
  } catch (e) {
    console.error('!! attribution init failed:', e.message);
    attribution = null;
  }

  // T-300: slippage tracker (observational read service)
  try {
    if (paper) {
      slippageTracker = createSlippageTracker({
        getTrades: (n) => paper.trades ? paper.trades(n) : [],
        getOrders: ()  => paper.list   ? paper.list()    : [],
      });
      console.log('[server] slippage tracker armed');
    }
  } catch (e) {
    console.error('!! slippageTracker init failed:', e.message);
    slippageTracker = null;
  }

  // T-273: pre-trade pipeline (consolidates KILL_SWITCH + LIVE_TRADING +
  // tradingMode + new leverage + sector gates). routes/orders.js delegates
  // to this; autorun.js still has its own 8-gate chain (different concerns).
  try {
    preTradeCheck = createPreTradeCheck({
      KILL_SWITCH, LIVE_TRADING,
      getRiskConfig: (userId) => riskConfigService ? riskConfigService.cachedGet(userId) : null,
      getPortfolioAggregates: () => portfolioAggregates ? portfolioAggregates.compute() : null,
      // T-496: market-hours/holiday gate. Getter form so preTrade can be
      // constructed before _marketMeta is initialised lower in init().
      getMarketMeta: () => _marketMeta,
      // T-503: notify wired so permissive-failure branches fire throttled
      // Telegram instead of staying silent.
      notify: _notifyModule,
      audit,
    });
    console.log('[server] pre-trade pipeline armed (3 legacy + 2 new gates)');
  } catch (e) {
    console.error('!! preTradeCheck init failed:', e.message);
    preTradeCheck = null;
  }

  // T-290e: option chain fetcher. Env-gated -- OPTION_CHAIN_FETCH_ENABLED
  // controls both the cron timer AND any auto-start at boot. The module
  // exists but stays idle until the operator explicitly enables it.
  try {
    if (db && broker) {
      optionChainFetcher = new OptionChainFetcher({
        db, broker,
        log: (m) => console.log('[option-chain-fetcher]', m),
      });
      // Auto-start the cron ONLY when env var set + at least one underlying configured
      const enabled = OptionChainFetcher.isEnabled();
      const cfgUnderlyings = (process.env.OPTION_CHAIN_UNDERLYINGS || '').split(',').map(s => s.trim()).filter(Boolean);
      if (enabled && cfgUnderlyings.length > 0) {
        const exp = process.env.OPTION_CHAIN_EXPIRY || null;
        const underlyings = cfgUnderlyings.map(u => ({ underlying: u, expiry: exp || undefined }));
        const intervalMs = Math.max(60000, parseInt(process.env.OPTION_CHAIN_INTERVAL_MS, 10) || 5 * 60 * 1000);
        optionChainFetcher.start({ underlyings, intervalMs });
        console.log(`[server] option-chain fetcher armed (${cfgUnderlyings.length} underlyings @ ${intervalMs}ms)`);
      } else {
        console.log('[server] option-chain fetcher instantiated (idle -- env gate off or no underlyings)');
      }
    }
  } catch (e) {
    console.error('!! optionChainFetcher init failed:', e.message);
    optionChainFetcher = null;
  }

  // T-298a: options scanner SHADOW MODE. Writes proposed opportunities to
  // option_opportunities table only; never generates signals or places orders.
  // Gated by OPTIONS_AUTORUN_ENABLED -- with the env var unset the scan()
  // method short-circuits before touching the DB.
  try {
    if (db && regimeDetector) {
      optionsScanner = new OptionsScanner({
        db,
        getRegime: async () => regimeDetector.detect ? regimeDetector.detect() : { regime: 'unknown', confidence: null },
        log: (m) => console.log('[options-scanner]', m),
      });
      console.log('[server] options scanner instantiated (SHADOW only, gated by OPTIONS_AUTORUN_ENABLED)');
    }
  } catch (e) {
    console.error('!! optionsScanner init failed:', e.message);
    optionsScanner = null;
  }

  // T-302a/T-303a: signal calibration + auto-retire recommender. Pure: just
  // takes injected readers; no DB handle, no engine touch.
  try {
    signalCalibration = createSignalCalibration({
      getClosedTrades:    (n) => paper ? paper.trades(n || 2000) : [],
      getAutorunHistory:  (n) => autorun ? autorun.history(n || 1000) : [],
    });
    console.log('[server] signal calibration armed (advisory only -- never auto-retires)');
  } catch (e) {
    console.error('!! signalCalibration init failed:', e.message);
    signalCalibration = null;
  }

  // T-280c: NSE macro fetcher. Auto-starts ONLY when env gate set.
  try {
    if (db) {
      nseMacroFetcher = new NseMacroFetcher({ db, log: (m) => console.log('[nse-macro]', m) });
      if (NseMacroFetcher.isEnabled()) {
        nseMacroFetcher.start({ intervalMs: 24 * 60 * 60 * 1000 });
        console.log('[server] NSE macro fetcher armed (daily cron + boot fetch)');
      } else {
        console.log('[server] NSE macro fetcher instantiated (idle -- NSE_MACRO_FETCH_ENABLED off)');
      }
    }
  } catch (e) {
    console.error('!! nseMacroFetcher init failed:', e.message);
    nseMacroFetcher = null;
  }

  // T-447 (audit-2026-05-26 backend M9): wormAudit was constructed HERE
  // (mid-init, ~400 lines after broker.start) but audit() at line ~236
  // refers to it. The first ~20-30 boot audit events (broker.start, db
  // init, riskConfigService init, autorun load, ...) fired BEFORE
  // wormAudit existed, so they only landed in audit.log JSONL — never on
  // the WORM chain. Construction is now at the TOP of init() (see
  // wormAudit = new WormAudit(...) block above the broker.start call).
  // This block stays as a no-op for diff history; the real init is now
  // at the top.

  // Tier 34: F&O SPAN-style margin simulator (pre-trade estimator).
  spanSim = new SpanSim();

  // Tier 38: 2FA confirm-before-trade on FIRST order of the day.
  // Off when Telegram is not configured; off if DISABLE_2FA=true.
  twoFactor = new TwoFactor({
    audit,
    postTelegram: typeof postTelegram === 'function' ? postTelegram : null,
    baseUrl: process.env.PUBLIC_BASE_URL || 'https://ats.rajasekarselvam.com',
    ttlMs: Number(process.env.TWO_FACTOR_TTL_MS) || 5 * 60_000,
    disabled: String(process.env.DISABLE_2FA || '').toLowerCase() === 'true',
  });

  // Tier 47: daily/weekly digest emails (uses Tier 27 EmailAlerts under the hood).
  digest = new Digest({
    paper, pnl, autorun, wormAudit, news, emailAlerts, audit,
  });

  // Tier 23: bucket-target rebalancing engine.
  rebalance = new Rebalance();

  // Tier 27: replay engine (uses backtest's computeSignal) and email alerts.
  replay = new Replay({ computeSignal });
  emailAlerts = new EmailAlerts({ audit });
  whatsAppAlerts = new WhatsAppAlerts({ audit });

  // Phase A.5: vault + sessions init is now unconditional. Pre-A.5 these were
  // gated behind BROKER_NAME === 'zerodha', which meant local backend running
  // BROKER=mock had vault=null -> /api/me/ai-keys, /api/v1/me/notifications, and
  // the internal bulk-rotate / seal-token endpoints all returned 503 ("vault not
  // open"). Per-user encrypted state (AI keys, notification tokens) is
  // independent of broker choice, so vault should always initialize when
  // master.key exists. Broker-specific features (cron-reauth, token
  // rehydration) remain gated below.
  if (fs.existsSync(MASTER_KEY_PATH)) {
    try {
      vault = await Vault.open(MASTER_KEY_PATH);
      sessions = new SessionStore({ tokensDir: TOKENS_DIR, vault });
    } catch (e) {
      console.error('!! vault init failed:', e.message);
      if (BROKER_NAME === 'zerodha') process.exit(2);
    }
  } else if (BROKER_NAME === 'zerodha') {
    console.error(`!! ${MASTER_KEY_PATH} not found. Run: npm run init-master-key`);
    process.exit(2);
  } else {
    console.warn(`[server] vault NOT initialized -- ${MASTER_KEY_PATH} missing. AI keys + notifications endpoints will 503.`);
  }

  if (BROKER_NAME === 'zerodha') {

    // Tier 80: daily auto-reauth cron — moved INSIDE init() because db+vault are
    // populated asynchronously here; the previous module-level init at line 368
    // ran before either was set so the guard silently no-op'd and the scheduler
    // never started. (Caught Sat 2026-05-17 from missing [cron-reauth] line in
    // docker logs.)
    try {
      const { createCronReauth } = require('./cron-reauth');
      // T99-T106: pass the global broker so cron-reauth can also resume
      // the in-memory zerodha-broker singleton after a successful token
      // rotation. Without this, the broker stays in _stalledOnToken state
      // from the prior day even after the DB has a fresh token.
      // T99-T106b: also pass sessions so cron can refresh the filesystem
      // token store that boot-rehydrate reads from.
      _cronReauth = createCronReauth({ db, vault, audit, postTelegram, broker, sessions });
      _cronReauth.start();
      // T99-T115: wire reactive reauth — when broker hits 3-strike 403 stall,
      // immediately trigger cron-reauth.runNow() instead of waiting until the
      // next 05:45 IST scheduled cycle. Rate-limited inside the broker
      // (max 1 per 15 min, max 3 per 24h).
      if (broker && typeof broker.setOnStall === 'function') {
        broker.setOnStall(async (reason) => {
          try {
            console.log('[server] reactive reauth triggered by broker stall:', reason);
            try { audit('broker.stall.reactive-reauth', { reason }); } catch (e) { console.warn('[server] swallowed:', e && e.message); }
            await _cronReauth.runNow();
          } catch (e) {
            console.error('[server] reactive reauth error:', e && e.message);
          }
        });
        console.log('[server] reactive reauth trigger wired (T-115)');
      }
    } catch (e) {
      console.error('[server] cron-reauth init failed:', e && e.message);
    }
    // Try to rehydrate any saved Zerodha access token (single-user prod use).
    // T99-T106b: prefer DB token over file token when both exist and DB is newer.
    // Cron-reauth writes to DB (and now also to file via the cron→sessions path),
    // but during the window BEFORE the cron has fired with the new code, only the
    // DB has a fresh token. Reading DB-first means a deploy that lands between
    // crons still picks up the freshest available token.
    const userIds = sessions.listAllUserIds();
    if (userIds.length === 1) {
      const uid = userIds[0];
      let chosenToken = null;
      let chosenSource = null;
      // Try DB first if the userIds[0] matches a real DB user id (numeric).
      try {
        const numericUid = parseInt(uid, 10);
        if (Number.isFinite(numericUid)) {
          const list = db.brokers.list(numericUid) || [];
          const row = list.find(r => r.broker === 'zerodha' && r.is_default) ||
                      list.find(r => r.broker === 'zerodha');
          if (row) {
            const fullRow = db.brokers.getFull(numericUid, row.id);
            if (fullRow && fullRow.access_token) {
              const tk = await vault.open(fullRow.access_token);
              if (tk) { chosenToken = tk; chosenSource = 'db'; }
            }
          }
        }
      } catch (e) { /* fall through to file */ }
      if (!chosenToken) {
        try {
          const tok = await sessions.loadTokens(uid);
          if (tok && tok.accessToken) { chosenToken = tok.accessToken; chosenSource = 'file'; }
        } catch (e) { console.warn('[server] swallowed:', e && e.message); }
      }
      if (chosenToken) {
        broker.setAccessToken(chosenToken);
        audit('broker.rehydrate', { userId: uid, source: chosenSource });
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
  // T-453 (audit-2026-05-26 backend L1): gate Secure on env so dev over
  // plain http://localhost:8080 actually persists the cookie. users.js
  // already does this via the `secureCookie` flag; the server.js helper
  // had `secure: true` hardcoded which broke dev sign-in. Match the
  // ENV_NAME check used for users.js construction (line 417).
  const secure = (ENV_NAME === 'prod' || process.env.NODE_ENV === 'production');
  res.setHeader('Set-Cookie', cookie.serialize('ats.sid', v, {
    httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 7,
  }));
}
function readSessionCookie(req) {
  const raw = req.headers.cookie || '';
  const c = cookie.parse(raw)['ats.sid'];
  if (!c) return null;
  const [sid, mac] = c.split('.');
  if (!sid || !mac) return null;
  // T-195 (CODE-AUDIT C.10 #5): constant-time MAC compare avoids the theoretical
  // timing side-channel in `!==` (low risk over a network but trivial to fix).
  const a = Buffer.from(sign(sid), 'utf8');
  const b = Buffer.from(String(mac), 'utf8');
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;
  return sid;
}

// ---------- Express ----------
const app = express();
app.use(express.json({ limit: '64kb' }));

// T99-T78: observability + request-logging MUST run before route handlers, so
// they live right after express.json. Early routes (health-deep, status, admin
// observability) are registered immediately after this block. Without this,
// the x-request-id header is missing on those endpoints and they never appear
// in stdout request logs.
app.use(_obsMiddleware);
app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
  next();
});

// ---------- Tier 71: market metadata cache (holidays from Kite) ----------
// T-447 (audit-2026-05-26 backend M8): _marketMeta init was a top-level
// IIFE that ran on require('./server') — BEFORE init() had assigned db and
// broker. The guard `if (db && broker)` was always false here so the
// daily-holiday-refresh cron never auto-armed. Moved into init() (see
// _initMarketMeta() call near the end of init() below) where db + broker
// are guaranteed populated.
let _marketMeta = null;

// T-406 (god-object split #32): /api/market/holidays moved to routes/misc.js.

// ---------- Tier 80: daily auto-reauth cron (per-user headless Kite login) ----------
// _cronReauth is initialised inside init() once db + vault are ready.
let _cronReauth = null;

// T-388 (architecture audit #1, god-object split #5): 3 admin singleton
// routes (market/refresh-holidays, cron-reauth/run, observability) extracted
// to routes/admin-misc.js. The underlying singletons (_marketMeta /
// _cronReauth / _obs) stay in server.js because other code paths still
// reference them directly; getters pass through the latest value.
const { mountAdminMiscRoutes } = require('./routes/admin-misc');
mountAdminMiscRoutes(app, {
  getMarketMeta: () => _marketMeta,
  getCronReauth: () => _cronReauth,
  getObs,
});

// ---------- Tier 70: observability (request-id, latency, error capture) ----------
// FIX: db is undefined at module-load time (it's assigned inside async init()).
// Use a lazy-init helper so the route grabs the db once it exists.
let _obs = null;
function getObs() {
  if (_obs) return _obs;
  if (!db) return null;
  try {
    const { createObservability } = require('./observability');
    _obs = createObservability({ db });
    return _obs;
  } catch (e) {
    console.error('[server] observability init failed:', e && e.message);
    return null;
  }
}

// T-387 (architecture audit #1, god-object split #4): 3 AI admin routes
// (ai-trace, ai-replay, ai-compare) extracted to routes/ai-admin.js.
// See that module's header for T99-T122 / T-162 history.
const { mountAiAdminRoutes } = require('./routes/ai-admin');
mountAiAdminRoutes(app, { getDb: () => db, getVault: () => vault, express });

// T99-T78: lazy obs middleware wrappers. The observability module needs db to
// be ready before it can prepare its insert statement. We defer first-binding
// until the first request after db is initialised. Once bound, each request
// gets x-request-id, latency sampling on res.finish, and errors persisted to
// errors_log. Cheap: getObs() short-circuits on the cached singleton after the
// first hit.
function _obsMiddleware(req, res, next) {
  const obs = getObs();
  if (obs && obs.middleware) return obs.middleware(req, res, next);
  return next();
}
function _obsErrorMiddleware(err, req, res, next) {
  const obs = getObs();
  if (obs && obs.errorMiddleware) return obs.errorMiddleware(err, req, res, next);
  if (res.headersSent) return next(err);
  res.status(500).json({ ok: false, reason: 'internal_error', detail: (err && err.message) || 'unknown' });
}

// T-I2: public status page endpoint. No auth. 60s server-side cache so a runaway
// uptime monitor + curious users don't hammer upstream providers. Probes a small
// set of external dependencies (Kite, NSE, the 3 AI providers' status pages) and
// returns a structured JSON the /status HTML page renders as a green/yellow/red
// dashboard.
let _statusCache = { ts: 0, payload: null };
const STATUS_CACHE_MS = 60_000;

async function _checkUrl(url, expectedContentType, timeoutMs = 6000) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const r = await fetch(url, { method: 'GET', signal: ctl.signal, headers: { 'User-Agent': 'ATS-StatusBot/1.0' } });
    const elapsed = Date.now() - t0;
    const ct = r.headers.get('content-type') || '';
    const expectedOk = !expectedContentType || ct.includes(expectedContentType);
    return { ok: r.ok && expectedOk, http: r.status, elapsed_ms: elapsed, content_type: ct };
  } catch (e) {
    return { ok: false, error: (e && e.message || 'error').slice(0, 100), elapsed_ms: Date.now() - t0 };
  } finally { clearTimeout(to); }
}

async function _buildStatus() {
  const t0 = Date.now();
  const out = { ok: true, ts: new Date().toISOString(), services: {} };

  // 1. ATS app self — DB read latency
  try {
    const t = Date.now();
    if (db && db._conn) {
      db._conn.prepare('SELECT 1').get();
      out.services.ats_app = { ok: true, elapsed_ms: Date.now() - t, note: 'db read ok' };
    } else {
      out.services.ats_app = { ok: false, error: 'db not initialized' };
    }
  } catch (e) { out.services.ats_app = { ok: false, error: e.message }; }

  // 2. Surveillance freshness (already cached in NseSurveillance)
  try {
    const st = _surveillance ? _surveillance.status() : { ready: false };
    out.services.nse_surveillance = {
      ok: st.ready,
      counts: st.counts || {},
      age_minutes: st.ageMs != null ? Math.round(st.ageMs / 60000) : null,
    };
  } catch (e) { out.services.nse_surveillance = { ok: false, error: e.message }; }

  // 3. Kite public reachability (no auth — just a HEAD-ish on api.kite.trade root)
  out.services.kite = await _checkUrl('https://api.kite.trade/', null, 5000);

  // 4. NSE archive (the same URL surveillance uses)
  out.services.nse_archive = await _checkUrl('https://archives.nseindia.com/content/equities/sec_list.csv', 'csv', 8000);

  // 5. AI provider public status (just reachability of their docs/API roots)
  const aiProbes = await Promise.all([
    _checkUrl('https://status.anthropic.com/api/v2/status.json', 'json', 5000),
    _checkUrl('https://status.openai.com/api/v2/status.json', 'json', 5000),
    _checkUrl('https://status.cloud.google.com/incidents.json', 'json', 5000),
  ]);
  out.services.anthropic = aiProbes[0];
  out.services.openai    = aiProbes[1];
  out.services.gemini    = aiProbes[2];

  // 6. T99-T50: internal operational signals — public-safe (no counts/PII).
  //    Lets the /status page reflect WS feed health + backup freshness without
  //    operators needing to curl /api/health-deep.
  try {
    if (broker && typeof broker.health === 'function') {
      const bh = broker.health();
      const stalled = !!(bh && bh.stalledOnToken);
      const frozen  = !!(bh && bh.tickStale);
      const connected = !!(bh && bh.connected);
      out.services.live_data_feed = {
        ok: connected && !stalled && !frozen,
        state: stalled ? 'stalled (token expired)'
               : frozen ? 'frozen (no ticks while market open)'
               : connected ? 'streaming'
               : 'disconnected',
      };
    }
  } catch (_) { out.services.live_data_feed = { ok: false, error: 'introspection_failed' }; }
  try {
    if (db && db._conn && typeof _ensureDrTable === 'function' && _ensureDrTable()) {
      const row = db._conn.prepare("SELECT ts, payload FROM dr_test_history ORDER BY id DESC LIMIT 1").get();
      if (row) {
        const ageMs = Date.now() - new Date(row.ts).getTime();
        const ageDays = Math.round(ageMs / 86400000);
        let lastOk = false;
        try { const pd = JSON.parse(row.payload || '{}'); lastOk = pd.ok === true; } catch (e) { console.debug('[server] swallowed:', e && e.message); }
        out.services.backups_verified = {
          ok: lastOk && ageDays <= 30,
          state: lastOk ? (ageDays <= 30 ? 'last verified ' + ageDays + 'd ago' : 'STALE — last test ' + ageDays + 'd ago')
                       : 'last DR test failed',
        };
      } else {
        out.services.backups_verified = { ok: false, state: 'never tested (run setup-dr-cron.sh)' };
      }
    }
  } catch (_) { out.services.backups_verified = { ok: false, error: 'introspection_failed' }; }

  // 7. Build summary
  const hardOk = out.services.ats_app.ok;
  const softWarn = Object.entries(out.services).filter(([k, v]) => k !== 'ats_app' && !v.ok).map(([k]) => k);
  out.ok = hardOk;
  out.degraded = softWarn.length > 0;
  out.degraded_services = softWarn;
  out.build_ms = Date.now() - t0;
  return out;
}

// T-414 (god-object split #40): /api/status moved to routes/boot-wiring.js.

// T-414 (god-object split #40): /api/health-deep moved to routes/boot-wiring.js.

// T-I1: DR test history table (lazy-created on first admin call; same goes for
// the health-deep DR section). db may not be ready at module load.
// T-385 (architecture audit #1, god-object split continuation):
// dr-status routes + ensureDrTable extracted to routes/dr-status.js.
// See that module's header for T-40 / T-99-T40 / T-99-T65 history.
// ensureDrTable() is re-exported because /api/health-deep and
// /api/system/info above also call it.
const { mountDrStatusRoutes, ensureDrTable: _ensureDrTableImpl } = require('./routes/dr-status');
function _ensureDrTable() { return _ensureDrTableImpl(db); }
mountDrStatusRoutes(app, { getDb: () => db, express });

app.disable('x-powered-by');
app.set('trust proxy', 'loopback');

// Tier 50: attach req.user to every request if a valid session cookie is present.
// Does NOT enforce auth -- that's done per-route via auth.requireAuth.
app.use((req, res, next) => {
  if (auth && typeof auth.optionalAuth === 'function') return auth.optionalAuth(req, res, next);
  next();
});

// ---------- Tier 35: static IP allowlist (SEBI access-control compliance) ----------
// Off by default. Set API_IP_WHITELIST env to a comma-separated CIDR list to enable.
// Set API_IP_WHITELIST_MODE=audit to log-only without blocking (safe rollout).
// Bypass list: /api/health and /api/brokers/zerodha/callback are always allowed
// (uptime monitors + Kite OAuth redirect from kite.zerodha.com).
const ipAllowlist = buildIpAllowlist({ audit: (e, d) => { try { audit(e, d); } catch (e) { console.warn('[server] swallowed:', e && e.message); } } });
app.use(ipAllowlist);

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

// T-183: req.ip reports the immediate hop, which in our deploy topology is
// the docker bridge gateway (172.18.0.1 / docker0). That matches our RFC1918
// private-IP regex in isInternalIp(), silently neutering every middleware
// that did `if (isInternalIp(req.ip)) return next()` -- meaning rate limiting,
// bearer-token auth (when AUTH_REQUIRED is on), and the /metrics gate were
// exempting ALL traffic regardless of where it came from. Fix: read the real
// client IP from nginx's X-Real-IP header (set by both ats.rajasekarselvam.com.conf
// and rajasekarselvam.com.conf via `proxy_set_header X-Real-IP $remote_addr`).
function getClientIp(req) {
  const x = (req.headers && req.headers['x-real-ip']) ? String(req.headers['x-real-ip']).trim() : '';
  if (x) return x;
  return req.ip || (req.connection && req.connection.remoteAddress) || (req.socket && req.socket.remoteAddress) || '';
}

// T-411: health-check endpoints bypass the rate-limit entirely.
//
// These are cheap, public, idempotent reads used by:
//   - monitoring systems (Pingdom, UptimeRobot, internal Prometheus scrape)
//   - load balancers + reverse proxies (nginx upstream health checks)
//   - CI smoke tests (Playwright suite hits /api/health early in every spec
//     to assert deploy-switchover completed before exercising auth-gated routes)
//
// Rate-limiting them was causing CI flake -- the GitHub runner makes ~80 specs
// with retries from a single IP, exhausting the 300/min/IP budget. Failed
// health pings then cascade into structural-rendering failures because the
// app shell never confirms the backend is ready. None of these endpoints
// expose user data; they're already public, so excluding them from rate-limit
// has no security cost. (Cost-of-compute is also negligible: they read from
// in-memory state, not the DB or broker.)
// T-413: paths matched against req.path which, inside app.use('/api', ...) is
// RELATIVE to the mount prefix -- /api/health arrives as req.path === '/health'.
// T-411 stored '/api/health' and the check always returned false, leaving the
// rate-limit firing. CI proof (T-412d diagnostic): runner saw HTTP 429 with
// body {"reason":"rate_limit"}. Fix: store paths WITHOUT /api prefix.
// T-494: /version added so post-deploy drift-check polling can't be throttled.
const RATE_LIMIT_BYPASS = new Set(['/health', '/health-deep', '/status', '/version']);

app.use('/api', (req, res, next) => {
  if (RATE_LIMIT_BYPASS.has(req.path)) return next();
  const ra = getClientIp(req).replace('::ffff:', '');
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

// ---------- T-181 CSRF defense-in-depth (SCREENS-AUDIT F-4) ----------
// Session cookie is already SameSite=Lax (deploy/backend/users.js _setCookie),
// which blocks the most common CSRF vector (cross-origin POST from a malicious
// site cannot ride the cookie). This middleware adds belt-and-suspenders Origin
// (with Referer fallback) verification on state-changing /api/* requests.
//
// Skips:
//   - Internal IPs (auto-login daemons, internal cron, Docker private nets)
//   - Bearer-token requests (server-to-server, ops scripts) -- not cookie-auth
//   - GET/HEAD/OPTIONS (no state change; also covers /api/brokers/zerodha/callback
//     which is GET-only, but we still keep an explicit path skip below for clarity)
//   - Requests where Origin matches the production origin, localhost dev, or null
//     (programmatic curl without Origin -- already filtered by bearer/internal-ip
//     checks above)
//
// Rejected requests return 403 { ok:false, reason:'cross_origin_rejected' } and
// are audited via the existing audit() helper.
// T-431 (audit-2026-05-26 sec-ops X-H3): allowed origins are env-driven so a
// staging/preview domain can be added by setting CSRF_ALLOWED_ORIGINS=... in
// the VM env (comma-separated) WITHOUT a code+deploy round-trip. The list
// always includes prod + localhost so misconfig can't lock us out. Empty,
// whitespace-only, or malformed entries are silently dropped.
const CSRF_ALLOWED_ORIGINS = (() => {
  const baseline = [
    'https://ats.rajasekarselvam.com',
    'http://localhost:8080',
    'http://127.0.0.1:8080',
  ];
  const extra = String(process.env.CSRF_ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(s => /^https?:\/\/[^\s,]+$/i.test(s));
  return new Set([...baseline, ...extra]);
})();
app.use('/api', (req, res, next) => {
  const m = req.method;
  if (m !== 'POST' && m !== 'PUT' && m !== 'PATCH' && m !== 'DELETE') return next();
  // Bearer-token callers are server-to-server, not cookie-auth -> not CSRF-able.
  if ((req.headers['authorization'] || '').startsWith('Bearer ')) return next();
  // Explicit skip for Zerodha OAuth callback (GET-only today, but defensive).
  if (req.path === '/brokers/zerodha/callback') return next();
  if (req.path === '/v1/oauth/zerodha/callback') return next();
  // Internal callers (auto-login daemon, ops scripts) tag themselves with this
  // header AND hit 127.0.0.1:8080 directly without going through nginx.
  if (req.headers['x-ats-internal'] === '1') return next();
  // NOTE: cannot use isInternalIp(req.ip) here -- the backend container sits
  // behind nginx + a docker bridge, so EVERY external client appears as an
  // internal IP from the container's POV. Instead, true server-local callers
  // (auto-login daemon hitting 127.0.0.1:8080 directly, NOT through nginx)
  // are identified by the absence of X-Forwarded-For. nginx always sets XFF;
  // direct loopback callers do not.
  const xff = req.headers['x-forwarded-for'];
  if (!xff) return next(); // trusted local caller (no proxy hop)
  const rawOrigin = req.headers['origin'] || '';
  const rawReferer = req.headers['referer'] || '';
  // Accept missing Origin AND missing Referer ONLY when XFF is also absent
  // (handled above). If we got here, request came through nginx -> browser-side
  // caller -> Origin or Referer MUST be present, else reject.
  if (!rawOrigin && !rawReferer) {
    audit('api.csrf.reject', { ip: req.ip, path: req.path, method: m, reason: 'no_origin_no_referer' });
    return res.status(403).json({ ok: false, reason: 'cross_origin_rejected' });
  }
  let checkOrigin = rawOrigin;
  if (!checkOrigin && rawReferer) {
    try { const u = new URL(rawReferer); checkOrigin = `${u.protocol}//${u.host}`; } catch (_e) { checkOrigin = ''; }
  }
  if (CSRF_ALLOWED_ORIGINS.has(checkOrigin)) return next();
  audit('api.csrf.reject', { ip: req.ip, path: req.path, method: m, origin: rawOrigin || null, referer: rawReferer || null });
  return res.status(403).json({ ok: false, reason: 'cross_origin_rejected' });
});

// ---------- T-205 (CODE-AUDIT F.5 M2.1): CSRF token defense-in-depth ----------
//
// The Origin/Referer check above is a strong defense, but adds defense-in-depth
// by also requiring an X-CSRF-Token header on authed mutating requests. The
// token is derived from the session id via HMAC(SESSION_SECRET, 'csrf:' + sid),
// so:
//   - No DB schema change needed.
//   - The token is unforgeable without SESSION_SECRET.
//   - The token rotates whenever the session rotates.
//
// SOFT-FAIL phase: this commit only AUDITS missing or mismatched tokens
// (audit events: csrf.token.missing, csrf.token.mismatch). It does NOT reject
// the request. This gives the frontend a transition window to start sending
// the header on every mutating fetch via window.fetchApi. A follow-up commit
// flips to hard-fail (403 reason:'csrf_token_invalid') once `grep audit.log`
// shows the token is being sent consistently.

function _csrfToken(sid) {
  if (!sid) return null;
  return crypto.createHmac('sha256', SESSION_SECRET).update('csrf:' + sid).digest('base64url');
}

// T-414 (god-object split #40): /api/csrf-token moved to routes/boot-wiring.js.

// Middleware: audit (don't reject) on mutating requests whose X-CSRF-Token
// doesn't match the expected HMAC. Applied to /api/* after the Origin gate.
app.use('/api', (req, res, next) => {
  const m = req.method;
  if (m !== 'POST' && m !== 'PUT' && m !== 'PATCH' && m !== 'DELETE') return next();
  // Skip bearer auth + internal callers (same logic as Origin check above).
  if ((req.headers['authorization'] || '').startsWith('Bearer ')) return next();
  if (req.headers['x-ats-internal'] === '1') return next();
  if (!req.headers['x-forwarded-for']) return next();
  // OAuth callback path can't carry headers from the broker -- skip explicitly.
  if (req.path === '/brokers/zerodha/callback') return next();
  if (req.path === '/v1/oauth/zerodha/callback') return next();
  // Anonymous requests: auth check will fail first; no point in CSRF noise.
  const sid = readSessionCookie(req);
  if (!sid) return next();

  const expected = _csrfToken(sid);
  const got = req.headers['x-csrf-token'] || '';
  if (!got) {
    audit('csrf.token.missing', { path: req.path, method: m, ip: req.ip });
    // T-247 (M2.1 phase 2): HARD-FAIL. T-246 frontend pre-flight ships
    // X-CSRF-Token on every same-origin mutating fetch (mock-data.jsx).
    // After verifying csrf.token.missing audit count stayed flat post-deploy,
    // we flip to 403 here. Anonymous users were already bypassed above
    // (sid null) so the only requests that hit this branch are authed
    // mutating requests without the header -- exactly what CSRF protects
    // against.
    return res.status(403).json({
      ok: false,
      reason: 'csrf_token_invalid',
      detail: 'Missing X-CSRF-Token header. Reload the page; the frontend should attach it automatically on every mutating call.',
    });
  }
  // T-428 (audit-2026-05-26 backend H6): timing-safe compare.
  // Sibling code at line 778 already uses timingSafeEqual for the session
  // cookie HMAC; CSRF check forgot.
  let csrfOk = false;
  try {
    const a = Buffer.from(String(got));
    const b = Buffer.from(String(expected));
    csrfOk = a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (_) { csrfOk = false; }
  if (!csrfOk) {
    audit('csrf.token.mismatch', { path: req.path, method: m, ip: req.ip });
    return res.status(403).json({
      ok: false,
      reason: 'csrf_token_invalid',
      detail: 'X-CSRF-Token did not match the HMAC expected for this session. Session may have rotated; reload the page.',
    });
  }
  return next();
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
  const ra = getClientIp(req).replace('::ffff:', '');
  if (isInternalIp(ra)) return next();  // internal callers always allowed
  const h = req.headers['authorization'] || '';
  if (!h.startsWith('Bearer ')) {
    res.setHeader('WWW-Authenticate', 'Bearer realm="ats"');
    return res.status(401).json({ ok: false, reason: 'missing_bearer' });
  }
  const token = h.slice(7).trim();
  // T-424 (audit-2026-05-26 backend C6): timing-safe compare. Old `!==`
  // leaked digest prefixes one char at a time. Equal-length buffers only;
  // unequal length is an immediate reject.
  let ok = false;
  try {
    const a = Buffer.from(token);
    const b = Buffer.from(ATS_OPS_KEY);
    ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (_) { ok = false; }
  if (!ok) {
    audit('api.auth.fail', { ip: ra, path: req.path });
    return res.status(403).json({ ok: false, reason: 'invalid_token' });
  }
  next();
}

// T-261 (P0 INCIDENT FIX): public auth endpoints MUST bypass the bearer gate.
// Otherwise users can't sign up, log in, log out, verify email, or reset their
// password — every POST gets blocked with 401 missing_bearer the moment
// ATS_OPS_KEY is set in backend.env. (Discovered when T-254 enabled the key
// in prod, locking out the operator's own account.)
//
// These paths run their own cookie/session/CSRF stack; gating them with the
// ops bearer makes zero sense.
const PUBLIC_AUTH_PATHS = new Set([
  '/auth/signup',
  '/auth/login',
  '/auth/logout',
  '/auth/verify-email',
  '/auth/forgot-password',
  '/auth/reset-password',
]);

// Apply: gate all mutating methods + /api/audit
app.use('/api', (req, res, next) => {
  // T-261: skip bearer check for public auth endpoints.
  if (PUBLIC_AUTH_PATHS.has(req.path)) return next();
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE' || req.method === 'PATCH') {
    // T-362: cookie-authenticated browser users (req.user populated by
    // optionalAuth at line 1313) MUST NOT be forced through the ops-bearer
    // gate. Otherwise every legit browser POST to /api/me/* gets
    // 401 missing_bearer the moment ATS_OPS_KEY is set in backend.env
    // (which it is on prod). Same pattern T-322b/T-323 used for /api/audit
    // below, generalized to all mutating cookie-auth paths.
    //
    // Defense-in-depth still holds for cookie-auth paths:
    //   - Origin gate (line 1398) blocks cross-origin POSTs
    //   - CSRF middleware (line 1469) HARD-FAILS 403 on missing X-CSRF-Token
    //   - Per-handler withAuth() / `if (!req.user)` does role/auth gating
    // Bearer callers (server-to-server ops scripts) still go through
    // authMiddleware and need a valid ATS_OPS_KEY.
    //
    // Caught when T-349's prod-readiness spec failed on every commit since
    // b19ec1f with "2 API failures on #riskcockpit -- 401 /api/me/portfolio/stress".
    if (req.user && req.user.id) return next();
    return authMiddleware(req, res, next);
  }
  // T-322b/T-323: /api/audit can be read by either the ops bearer (CI / CLI
  // tools) OR a logged-in user session (so the operator can see their own
  // audit trail in the UI without needing to paste a bearer token into the
  // browser). The data is the operator's own activity log; gating it
  // strictly behind the bearer locked the audit-trail page to "401: Could
  // not load live data" for normal in-app use.
  if (req.path === '/audit' || req.path.startsWith('/audit?')) {
    if (req.user && req.user.id) return next();   // session-authenticated
    return authMiddleware(req, res, next);         // else require ops bearer
  }
  next();
});

// T-414 (god-object split #40): /api/summary moved to routes/boot-wiring.js.

// T-414 (god-object split #40): /api/system/info moved to routes/boot-wiring.js.

// T-414 (god-object split #40): /metrics moved to routes/boot-wiring.js.

// ---------- Kite order postback webhook ----------
// Kite calls this URL when order events fire (FILLED, REJECTED, CANCELLED, MODIFIED, etc).
// Configure the URL in the Kite developer dashboard: https://developers.kite.trade/apps/
// Set "Postback URL" to:  https://ats.rajasekarselvam.com/api/brokers/zerodha/postback
//
// Kite signs the payload with sha256(order_id + status + api_secret).
// We verify, audit, fan out to /ws clients, and Telegram-notify on FILLED/REJECTED.
// T-417: /api/brokers/zerodha/postback moved to routes/broker-oauth.js.

// T-414 (architecture audit #1, god-object split #40): 7 boot-wiring routes
// (/api/health, /api/health-deep, /api/status, /api/csrf-token, /api/summary,
// /api/system/info, /metrics) extracted to routes/boot-wiring.js. Mounted
// HERE so all singletons (db, broker, alerts, ...) have been declared.
// Singletons are passed as getters so the mount call can run before init()
// completes -- the actual reads happen at request-time.
const { mountBootWiringRoutes } = require('./routes/boot-wiring');
mountBootWiringRoutes(app, {
  ENV_NAME, KILL_SWITCH, LIVE_TRADING, SESSION_SECRET,
  MAX_DAILY_LOSS_INR, MAX_ORDERS_PER_MIN, MAX_POSITION_SIZE_INR, MAX_AGGREGATE_EXPOSURE,
  MAX_WS_CLIENTS, DEFAULT_SYMBOLS, AUDIT_LOG,
  // T-503: holiday-cache health + permissive-failure registry for /api/health
  // and /api/version. Single aggregator -- callers see one degraded snapshot
  // covering both autorun and pre-trade rather than having to poll each.
  getMarketMeta:      () => _marketMeta,
  getDegradedRegistry: () => ({
    snapshot: () => {
      const out = { autorun_regime: 0, autorun_economics: 0, autorun_runOnceThrows: 0,
                    preTrade_aggregator: 0, preTrade_sectorCheck: 0, preTrade_marketMeta: 0 };
      try {
        if (autorun && typeof autorun.getDegradedSnapshot === 'function') {
          const a = autorun.getDegradedSnapshot();
          out.autorun_regime         = a.regime || 0;
          out.autorun_economics      = a.economics || 0;
          out.autorun_runOnceThrows  = a.runOnceThrows || 0;
        }
      } catch { /* permissive */ }
      try {
        if (preTradeCheck && typeof preTradeCheck.getDegradedSnapshot === 'function') {
          const p = preTradeCheck.getDegradedSnapshot();
          out.preTrade_aggregator   = p.aggregator || 0;
          out.preTrade_sectorCheck  = p.sectorCheck || 0;
          out.preTrade_marketMeta   = p.marketMeta || 0;
        }
      } catch { /* permissive */ }
      return out;
    },
  }),
  getDb:              () => db,
  getVault:           () => vault,
  getBroker:          () => broker,
  getAlerts:          () => alerts,
  getWatchlist:       () => watchlist,
  getScanner:         () => scanner,
  getPaper:           () => paper,
  getPnl:             () => pnl,
  getAutorun:         () => autorun,
  getNews:            () => news,
  getTax:             () => tax,
  getAi:              () => ai,
  getSweep:           () => sweep,
  getLongterm:        () => longterm,
  getBrokerResolver:  () => _brokerResolver,
  getSurveillance:    () => _surveillance,
  getEarningsCal:     () => _earningsCal,
  getFiidii:          () => _fiidii,
  getBulkDeals:       () => _bulkDeals,
  getWsClients:       () => wsClients,
  getAuditState:      () => ({ seq: auditSeq, degradedCount: auditDegradedCount, lastError: auditLastDegradedError, lastAt: auditLastDegradedAt }),
  getOrderTimesLength: () => _orderTimes.length,
  getMetricCounters:  () => _metricCounters,
  readSessionCookie,
  isInternalIp,
  getClientIp,
  ensureDrTable: () => _ensureDrTableImpl(db),
  getStatusCache:     () => _statusCache,
  setStatusCache:     (v) => { _statusCache = v; },
  STATUS_CACHE_MS,
  buildStatus:        _buildStatus,
});

// ---------- Watchlist snapshot ----------
// T-408 (architecture audit #1, god-object split #36): /api/watchlist/snapshot
// extracted to routes/watchlist-snapshot.js. One round trip for the dashboard's
// watchlist table (symbols + per-symbol LTP + day change in abs and %).
const { mountWatchlistSnapshotRoutes } = require('./routes/watchlist-snapshot');
mountWatchlistSnapshotRoutes(app, { getWatchlist: () => watchlist, getBroker: () => broker });

// ---------- Top movers ----------
// T-391 (architecture audit #1, god-object split #8): 5 small market-data
// GETs (movers, symbol, option-expiries, indices/snapshot, calc/position-size)
// extracted to routes/market-data.js.
const { mountMarketDataRoutes } = require('./routes/market-data');
mountMarketDataRoutes(app, { getBroker: () => broker, getWatchlist: () => watchlist });

// ---------- Audit log reader ----------
// T-408 (architecture audit #1, god-object split #37): /api/audit
// extracted to routes/audit-log.js. Read-only paginated view of the
// JSONL audit log (rotated daily by logrotate).
const { mountAuditLogRoutes } = require('./routes/audit-log');
mountAuditLogRoutes(app, { AUDIT_LOG });

// T-410 (architecture audit #1, god-object split #39): 5 compute routes
// (/api/option-chain, /api/backtest, /api/backtest/watchlist, /api/tune,
// /api/reconcile/import-csv) extracted to routes/backtest-tools.js.
// Mount call is below, after BACKTEST_MAX_DAYS const declaration.

// ---------- Indices snapshot ----------
// Returns current LTPs for major indices from the in-memory tick cache (since /quotes
// doesn't return indices cleanly via NSE:NIFTY key).
// ---------- Strategy registry ----------
// Source-of-truth catalog for backtest + scanner + future UI.
// T-214: STRATEGIES const moved to deploy/backend/routes/strategies.js.
// Imported at top of file. The ai-workflows router (server.js:~4015) still
// receives STRATEGIES as a constructor param; the require makes it available
// in this module scope.


mountStrategiesRoutes(app); // T-214: was GET /api/strategies inline; see routes/strategies.js

// ---------- Backtest ----------
// T-410: 5 compute routes (/api/option-chain, /api/backtest,
// /api/backtest/watchlist, /api/tune, /api/reconcile/import-csv) extracted
// to routes/backtest-tools.js. Mount call below.
const BACKTEST_MAX_DAYS = parseInt(process.env.BACKTEST_MAX_DAYS || '1825', 10); // 5 years
const { mountBacktestToolsRoutes } = require('./routes/backtest-tools');
mountBacktestToolsRoutes(app, {
  BACKTEST_MAX_DAYS,
  audit,
  getBroker:    () => broker,
  getPaper:     () => paper,
  getWatchlist: () => watchlist,
  runBacktest,
  withAuth, // T-428 H5
});

// ---------- Paper trading (legacy + stats) ----------
// T-405 (god-object split #30): /api/paper + 7 deprecated /api/paper/* routes
// extracted to routes/legacy-paper.js.
const { mountLegacyPaperRoutes } = require('./routes/legacy-paper');
mountLegacyPaperRoutes(app, { getPaper: () => paper, withDeprecation });

// T-416: /api/me/paper/promote-check moved to routes/paper-trading.js or routes/admin-internal.js.

// ============ E4 / E7 / E8 user-scoped market data ============
// T-395 (god-object split #12): 5 routes (earnings + fiidii + bulk-deals)
// extracted to routes/me-market.js.
const { mountMeMarketRoutes } = require('./routes/me-market');
mountMeMarketRoutes(app, {
  getEarningsCal: () => _earningsCal,
  getFiidii:      () => _fiidii,
  getBulkDeals:   () => _bulkDeals,
});

// T-382 (architecture audit #9): /api/me/mf/* 410 Gone stubs extracted to
// routes/legacy-gone.js. See that module's header for T-248 history and
// the planned drop date (2026-06-19+).
const { mountLegacyGoneRoutes } = require('./routes/legacy-gone');
mountLegacyGoneRoutes(app);

// ---------- P&L Attribution ----------
// T-401 (god-object split #18): 3 pnl routes extracted to routes/pnl.js.
const { mountPnlRoutes } = require('./routes/pnl');
mountPnlRoutes(app, { getPnl: () => pnl });

// ---------- Strategy auto-runner ----------
// T-393 (god-object split #10): 4 autorun routes extracted to routes/autorun.js.
const { mountAutorunRoutes } = require('./routes/autorun');
mountAutorunRoutes(app, { getAutorun: () => autorun, withAuth });

// ---------- News feed ----------
// T-392 (god-object split #9): 3 news routes extracted to routes/news.js.
const { mountNewsRoutes } = require('./routes/news');
mountNewsRoutes(app, { getNews: () => news });

// ---------- Tax planning + Sweep (profit -> long-term) ----------
// T-394 (god-object split #11): 9 tax + sweep routes extracted to routes/tax-sweep.js.
const { mountTaxSweepRoutes } = require('./routes/tax-sweep');
mountTaxSweepRoutes(app, { getTax: () => tax, getSweep: () => sweep });

// ---------- AI features (no-op if ANTHROPIC_API_KEY not set) ----------
// T-396 (god-object split #13): 3 legacy AI POST routes extracted to
// routes/ai-features.js. /api/me/ai-workflows/* (BYOK, per-user) lives
// separately in ai-workflows-routes.js.
const { mountAiFeatureRoutes } = require('./routes/ai-features');
mountAiFeatureRoutes(app, { getAi: () => ai, getNews: () => news, getPaper: () => paper, withAuth });

// T-410: /api/reconcile/import-csv moved to routes/backtest-tools.js.

// T-410: /api/tune moved to routes/backtest-tools.js.

// T-389 (architecture audit #1, god-object split #6): /api/preflight +
// /api/regime extracted to routes/diagnostic.js. /api/benchmark stays here
// for now -- its handler embeds 135 lines of inline alpha/beta/Sharpe/
// drawdown math that needs to be factored into its own analytics module
// before the route can move cleanly. Own ticket.
const { mountDiagnosticRoutes } = require('./routes/diagnostic');
mountDiagnosticRoutes(app, {
  getBroker: () => broker,
  getPaper:  () => paper,
  getPnl:    () => pnl,
  runPreflight,
  pickBroker,
  classifyRegime,
});

// T-409: /api/benchmark (strategy vs benchmark candles, alpha/beta/sharpe)
// moved to routes/broker-reads.js (mounted below).

// ---------- Scanner ----------
// T-390 (architecture audit #1, god-object split #7): 3 scanner routes
// (status, history, run) extracted to routes/scanner.js.
const { mountScannerRoutes } = require('./routes/scanner');
mountScannerRoutes(app, { getScanner: () => scanner, audit });

// ---------- Legacy watchlist + alerts ----------
// T-405 (god-object split #31): 9 deprecated /api/watchlist + /api/alerts routes
// extracted to routes/legacy-watchlist-alerts.js. New per-user equivalents are
// /api/me/watchlist + /api/me/alerts (routes/me-watchlist-alerts.js from T-404).
const { mountLegacyWatchlistAlertsRoutes } = require('./routes/legacy-watchlist-alerts');
mountLegacyWatchlistAlertsRoutes(app, {
  getWatchlist: () => watchlist,
  getAlerts:    () => alerts,
  getBroker:    () => broker,
  withDeprecation,
});

// T-406 (god-object split #32): /api/config + 3 boot/wiring routes
// extracted to routes/misc.js (mount call below).

// T-402 (god-object split #21): 3 quote routes (symbols, quote/:sym, quotes)
// extracted to routes/quote.js. Quotes use the GLOBAL broker (market data
// is not user-isolated -- user-scoped routes use resolveUserBroker below).
const { mountQuoteRoutes } = require('./routes/quote');
mountQuoteRoutes(app, { getBroker: () => broker, DEFAULT_SYMBOLS });

// ---------- Tier 58: per-user broker resolver ----------
// Holdings/positions/orders MUST route through the requesting user's broker.
const _brokerResolver = require('./broker-resolver');
async function resolveUserBroker(req) {
  if (!db || !vault) return { broker: null, isUserOwn: false, reason: 'storage_unavailable' };
  if (!req.user || !req.user.id) return { broker: null, isUserOwn: false, reason: 'auth_required' };
  const r = await _brokerResolver.resolveForRequest({ db, vault, globalBroker: null, fallbackToGlobal: false }, req);
  if (!r.broker) return { broker: null, isUserOwn: false, reason: 'broker_not_connected' };
  return r;
}

// ---------- Portfolio / orders REST (read-only, per-user) ----------
// Tier 58: route through user's own broker. If not connected, return empty + flag.

mountPortfolioRoutes(app, { resolveUserBroker }); // T-218: was 4 inline /api/portfolio + /api/me/portfolio routes; see routes/portfolio.js
// T-248: mountMfRoutes removed (routes/mf.js deleted). 410 Gone stubs added inline below at the search/nav block for all 6 retired /api/me/mf/* + /api/me/portfolio/mf endpoints.

// T-409 (architecture audit #1, god-object split #38): 5 broker-read routes
// (/api/orders, /api/profile, /api/margins, /api/reconcile, /api/benchmark)
// extracted to routes/broker-reads.js. The pickBroker + resolveUserBroker
// helpers are defined further down in this file; we mount the routes after
// those declarations to keep the closure references resolvable. See the
// mountBrokerReadsRoutes(app, ...) call below.

// Tier 63: helper to pick user's broker if authenticated+connected, else fall back to global.
// Keeps unauthenticated callers working (returns the admin broker), authenticated callers
// get their own. Returns null only if even the global broker is unavailable.
//
// T-466 (audit-2026-05-26 backend M1): when an authed user without their
// own broker hits a broker route, the silent global fallback effectively
// runs their request against the OPERATOR's Zerodha account. In a
// single-operator deploy this is the legitimate path; in a multi-tenant
// future it is a privilege-escalation primitive. Two safety improvements:
//   1) AUDIT every fallback so unexpected usage shows up in audit.log
//   2) STRICT_PER_USER_BROKER=1 env switch — when set, refuses the
//      fallback and returns { broker: null, isUserOwn: false }. Default
//      off so the existing single-operator behaviour is unchanged.
const _STRICT_PER_USER_BROKER = process.env.STRICT_PER_USER_BROKER === '1';
async function pickBroker(req) {
  try {
    if (req.user && req.user.id && _brokerResolver) {
      const r = await _brokerResolver.resolveForRequest({ db, vault, globalBroker: null, fallbackToGlobal: false }, req);
      if (r.broker) return { broker: r.broker, isUserOwn: true };
    }
  } catch (e) { console.warn('[server] swallowed:', e && e.message); }
  // T-466 M1: instrument the fallback path.
  if (req.user && req.user.id && broker) {
    try {
      audit('broker.fallback-to-global', {
        userId: req.user.id,
        path: req.path,
        method: req.method,
        strict: _STRICT_PER_USER_BROKER,
      });
    } catch (_) { /* don't block the request on audit failure */ }
    if (_STRICT_PER_USER_BROKER) {
      // Refuse the silent fallback. Caller sees null broker and surfaces
      // a "connect your own broker" error to the user instead of
      // unknowingly running against the operator's account.
      return { broker: null, isUserOwn: false };
    }
  }
  return { broker: broker || null, isUserOwn: false };
}

// T-409 (architecture audit #1, god-object split #38): 5 broker-read routes
// extracted to routes/broker-reads.js.
//   - /api/orders     (resolveUserBroker, per-user orders)
//   - /api/profile    (withAuth + pickBroker)
//   - /api/margins    (withAuth + pickBroker)
//   - /api/reconcile  (withAuth, side-by-side broker vs paper)
//   - /api/benchmark  (strategy backtest vs benchmark, alpha/beta/sharpe)
// Mounted HERE -- after pickBroker + resolveUserBroker declarations and after
// _brokerResolver is loaded, so the dep getters resolve cleanly.
const { mountBrokerReadsRoutes } = require('./routes/broker-reads');
mountBrokerReadsRoutes(app, {
  withAuth,
  KILL_SWITCH,
  LIVE_TRADING,
  getBroker: () => broker,
  getPaper:  () => paper,
  resolveUserBroker,
  pickBroker,
  runBacktest,
});

// T-406 (god-object split #33): me/prefs + me/identity extracted to routes/me-identity.js.
const { mountMeIdentityRoutes } = require('./routes/me-identity');
mountMeIdentityRoutes(app, { getDb: () => db });

// Mount the misc cluster (config + auth-mode + kill-switch + market/holidays)
const { mountMiscRoutes } = require('./routes/misc');
mountMiscRoutes(app, {
  ENV_NAME, KILL_SWITCH, LIVE_TRADING, AUTH_REQUIRED, DEFAULT_SYMBOLS,
  getBroker:     () => broker,
  getDb:         () => db,
  getMarketMeta: () => _marketMeta,
  setMarketMeta: (mm) => { _marketMeta = mm; },
});

// Mount historical + instruments-search
const { mountHistoricalRoutes } = require('./routes/historical');
mountHistoricalRoutes(app, { getBroker: () => broker });

// T-185 (SCREENS-AUDIT F-7): per-mode runtime aggregates for the Trading Modes
// screen. The screen previously rendered a hardcoded RUNTIME object with zeros
// for every mode and a banner that admitted as much. This endpoint aggregates
// the user's paper_positions + paper_closed_trades into the same shape so the
// screen can display real (or partial) numbers when the user has activity.
//
// Mode classification is symbol-based because paper_positions has no product
// column. Heuristics match src/trading-modes.jsx inferModeFromSymbol():
//   options : symbol matches /\bCE\b|\bPE\b|CALL|PUT/
//   futures : symbol matches /\bFUT\b|FUTURES/
//   intraday: everything else (default). Swing is not separable from intraday
//             without per-order product info, so swing returns zeros for now.
//             Better honest zeros than fake numbers.
//
// strategiesRunning is derived from distinct strategy_tag values across
// recent (last 7d) paper_orders, classified the same way. Zero when the user
// has no orders in window.
//
// Shape matches the hardcoded RUNTIME in screen-modes.jsx exactly:
//   { intraday: { openPositions, utilized, todayPnl, strategiesRunning },
//     swing:    { ... }, options: { ... }, futures: { ... } }
// T-408 (architecture audit #1, god-object split #35): 5 heavy per-user
// aggregator routes extracted to routes/me-heavy.js. This single mount call
// covers:
//   - /api/me/modes/runtime       (T-185)
//   - /api/me/factor-exposure     (Tier 69b)
//   - /api/me/risk-metrics        (Tier 69a)
//   - /api/me/dashboard-summary   (Tier 60)
//   - /api/v1/me/orders/by-mode   (Tier 82)
const { mountMeHeavyRoutes } = require('./routes/me-heavy');
mountMeHeavyRoutes(app, {
  withAuth,
  getDb: () => db,
  getVault: () => vault,
  getBroker: () => broker,
  getBrokerResolver: () => _brokerResolver,
});

// T-357 + T-409: /api/margins moved to routes/broker-reads.js (mounted below).

// ---------- Reconciliation ----------
// T-357 + T-409: /api/reconcile moved to routes/broker-reads.js (mounted below).

// T-406 (god-object split #34): /api/historical + /api/instruments/search extracted to routes/historical.js (mount call above).

// T-406 (god-object split #32): /api/kill-switch moved to routes/misc.js.

// T-410: /api/backtest/watchlist moved to routes/backtest-tools.js.

// ---------- Tier 18/21/22/31: Wealth / longterm / MPT / factor-tilt ----------
// T-401 (god-object split #19): 11 wealth routes (longterm + bonds/reits +
// MPT + factor-tilt) extracted to routes/wealth.js.
const { mountWealthRoutes } = require('./routes/wealth');
mountWealthRoutes(app, {
  getLongterm:   () => longterm,
  getWealth:     () => wealth,
  getMpt:        () => mpt,
  getFactorTilt: () => factorTilt,
});

// ---------- Tier 34: F&O SPAN-style margin simulator (pre-trade estimator) ----------
// POST body shape:
//   { legs: [{symbol, type:'CALL'|'PUT'|'FUT', side:'BUY'|'SELL', strike, expiry,
//             qty, lotSize, spotPrice, iv?}, ...] }
// Returns total/SPAN/exposure margin, per-leg breakdown, detected spread structures.
// Accurate to within ~10-15% of real broker margin (uses public NSE formulas; real
// SPAN files are exchange-distributed and proprietary).
// T-399 (god-object split #16): SPAN estimator + 3 WORM audit-chain routes
// extracted to routes/risk-audit.js.
const { mountRiskAuditRoutes } = require('./routes/risk-audit');
mountRiskAuditRoutes(app, {
  getSpanSim:   () => spanSim,
  getWormAudit: () => wormAudit,
  audit,
});

// T-400 (god-object split #17): 3 /api/security/* routes extracted to routes/security.js.
const { mountSecurityRoutes } = require('./routes/security');
mountSecurityRoutes(app, { getIpAllowlist: () => ipAllowlist, getTwoFactor: () => twoFactor });

// Tier 37: echo the IP the server sees for this client, so users can paste
// it into their API_IP_WHITELIST. Mirrors what nginx puts in X-Real-IP.
// ---------- Tier 53: per-user data routes (require auth) ----------
function withAuth(handler) {
  return async (req, res) => {
    if (!auth) return res.status(503).json({ ok:false, reason:'auth_not_initialized' });
    if (!req.user) return res.status(401).json({ ok:false, reason:'auth_required' });
    try { await handler(req, res); }
    catch (e) { res.status(400).json({ ok:false, reason: e.message }); }
  };
}

// T-202 (CODE-AUDIT C.10 #3): wrap legacy unscoped routes with auth + a
// Deprecation header. The pre-Tier 75 routes (/api/watchlist, /api/alerts,
// /api/paper/*) read/write module-level singletons with no req.user.id
// filter. In single-tenant prod this works because there's only one user
// (the operator); but the audit flagged them as a multi-tenant data-leak
// class. This wrapper:
//   (1) Forces auth (anon callers get 401 via withAuth).
//   (2) Adds `Deprecation: true` and `Link: </api/me/...>; rel="successor-version"`
//       so the frontend (or any future client) can detect deprecated calls.
//   (3) Audits each hit as `legacy.route.hit` so we can see when the last
//       caller clears and the route is safe to delete.
function withDeprecation(successorPath, handler) {
  return withAuth(async (req, res) => {
    res.setHeader('Deprecation', 'true');
    res.setHeader('Link', '<' + successorPath + '>; rel="successor-version"');
    audit('legacy.route.hit', { path: req.path, method: req.method, userId: req.user && req.user.id, successor: successorPath });
    return handler(req, res);
  });
}

// Watchlist
//
// T-132 (Tier 75 Phase 3): mutation hooks. When a user adds/removes a symbol
// from their watchlist, we (a) push subscribe/unsubscribe to all of their
// currently-connected /ws clients so ws.symbolSet stays in sync without a
// reconnect, and (b) tell the upstream broker to ensureSubscribed so the
// Kite ticker actually starts streaming the new symbol.
//
// Hoisted as a module-scope-ish helper closure so all three routes use it.
function _notifyWatchlistChange(userId, op /* 'add' | 'remove' */, symbol) {
  if (!userId || !symbol) return;
  let pushed = 0;
  try {
    for (const ws of wsClients) {
      if (ws.userId !== userId) continue;
      if (ws.readyState !== 1) continue;
      if (ws.symbolSet) {
        if (op === 'add') ws.symbolSet.add(symbol);
        else if (op === 'remove') ws.symbolSet.delete(symbol);
      }
      try {
        ws.send(JSON.stringify({ type: 'watchlist_update', op, symbol }));
        pushed++;
      } catch (e) { console.warn('[server] swallowed:', e && e.message); }
    }
  } catch (e) {
    console.warn('[ws] notifyWatchlistChange fanout error:', e && e.message);
  }
  // On add: make sure upstream is subscribed so the tick stream includes it.
  // On remove: deliberately leave upstream alone — other users may still
  // want this symbol; the per-WS filter (T-131) handles isolation at zero
  // upstream cost.
  if (op === 'add') {
    try {
      if (broker && typeof broker.ensureSubscribed === 'function') {
        broker.ensureSubscribed([symbol]).catch((err) =>
          console.warn('[ws] upstream ensureSubscribed failed for', symbol, ':', err && err.message)
        );
      }
    } catch (e) { console.warn('[server] swallowed:', e && e.message); }
  }
  audit('watchlist.notify', { userId, op, symbol, fanout: pushed });
}

// T-404 (god-object split #27): /api/me/watchlist + /api/me/alerts (6 routes)
// extracted to routes/me-watchlist-alerts.js.
const { mountMeWatchlistAlertsRoutes } = require('./routes/me-watchlist-alerts');
mountMeWatchlistAlertsRoutes(app, {
  withAuth,
  getDb: () => db,
  notifyWatchlistChange: _notifyWatchlistChange,
});

// T-416: /api/me/paper moved to routes/paper-trading.js or routes/admin-internal.js.

// T-416: /api/me/paper/order moved to routes/paper-trading.js or routes/admin-internal.js.

// T-416: /api/me/paper/capital moved to routes/paper-trading.js or routes/admin-internal.js.

// Autorun config (per user)
// T-404 (god-object split #28): 3 /api/me/autorun routes extracted to routes/me-autorun.js.
const { mountMeAutorunRoutes } = require('./routes/me-autorun');
mountMeAutorunRoutes(app, { withAuth, getDb: () => db });

// T-402 (god-object split #22): 3 /api/me/pnl* + /api/me/sweep/monthly
// routes extracted to routes/me-pnl.js.
const { mountMePnlRoutes } = require('./routes/me-pnl');
mountMePnlRoutes(app, {
  withAuth,
  getDb:    () => db,
  getSweep: () => sweep,
});

// T-159: paper→live promotion-readiness rate. Foundation for the Signals
// screen's Paper→Live rate tile (T-81 left it as "—"). Computes a proxy:
// "fraction of paper (symbol, strategy_tag) groups with enough trades to
// credibly promote to live." A real promotion ledger that tracks paper→live
// order linking is future work.
// T-404 (god-object split #29): /api/me/signals/promotion-rate extracted to routes/me-promotion-rate.js.
const { mountMePromotionRateRoutes } = require('./routes/me-promotion-rate');
mountMePromotionRateRoutes(app, { withAuth, getDb: () => db });

// T-408: Tier 69b/69a/60 routes (/api/me/factor-exposure, /api/me/risk-metrics,
// /api/me/dashboard-summary) moved to routes/me-heavy.js (mounted above).

// ---------- Tier 69c: BYOK AI keys + advisor routers ----------
let _aiKeysRouter = null;
let _advisorRouter = null;
let _aiWorkflowsRouter = null;     // T99-A1/A4 critique + explain router
app.use('/api/me/ai-keys', (req, res, next) => {
  try {
    if (_aiKeysRouter) return _aiKeysRouter(req, res, next);
    if (db && auth && vault) {
      const { createAiKeysRouter } = require('./ai-keys-routes');
      _aiKeysRouter = createAiKeysRouter({ db, vault, requireAuth: auth.requireAuth, brokerResolver: _brokerResolver });
      return _aiKeysRouter(req, res, next);
    }
    return res.status(503).json({ ok: false, reason: 'ai_storage_not_initialized' });
  } catch (e) {
    console.error('[server] /api/me/ai-keys mount error:', e && e.message);
    return res.status(500).json({ ok: false, reason: 'mount_failed', detail: e.message });
  }
});
app.use('/api/me/ai-advisor', (req, res, next) => {
  try {
    if (_advisorRouter) return _advisorRouter(req, res, next);
    if (db && auth && vault && _brokerResolver) {
      const { createAdvisorAnalyzeRouter } = require('./ai-keys-routes');
      _advisorRouter = createAdvisorAnalyzeRouter({ db, vault, requireAuth: auth.requireAuth, brokerResolver: _brokerResolver });
      return _advisorRouter(req, res, next);
    }
    return res.status(503).json({ ok: false, reason: 'advisor_not_initialized' });
  } catch (e) {
    console.error('[server] /api/me/ai-advisor mount error:', e && e.message);
    return res.status(500).json({ ok: false, reason: 'mount_failed', detail: e.message });
  }
});

// T99-A1 + A4 — lazy mount the workflow router (critique + explain)
app.use('/api/me/ai-workflows', (req, res, next) => {
  try {
    if (_aiWorkflowsRouter) return _aiWorkflowsRouter(req, res, next);
    if (db && auth && vault) {
      const { createAiWorkflowsRouter } = require('./ai-workflows-routes');
      _aiWorkflowsRouter = createAiWorkflowsRouter({
        db, vault, requireAuth: auth.requireAuth, STRATEGIES,
        brokerResolver: _brokerResolver, surveillance: _surveillance,
        earningsCal: _earningsCal, bulkDeals: _bulkDeals, // T-248: mfData arg removed (workflow retired)
      });
      return _aiWorkflowsRouter(req, res, next);
    }
    return res.status(503).json({ ok: false, reason: 'ai_workflows_not_initialized' });
  } catch (e) {
    console.error('[server] /api/me/ai-workflows mount error:', e && e.message);
    return res.status(500).json({ ok: false, reason: 'mount_failed', detail: e.message });
  }
});

// ---------- Tier 57: per-user broker credentials ----------
// Lazy-mount so we wait until vault is ready (vault.open is async, but route
// registration runs synchronously at module load). On first request, if the
// deps are ready we build + cache the router; otherwise return a 503.
let _meBrokerRouter = null;
app.use('/api/me/broker', (req, res, next) => {
  try {
    if (_meBrokerRouter) return _meBrokerRouter(req, res, next);
    if (db && auth && vault) {
      const { createMeBrokerRouter } = require('./me-broker');
      _meBrokerRouter = createMeBrokerRouter({ db, vault, requireAuth: auth.requireAuth });
      return _meBrokerRouter(req, res, next);
    }
    return res.status(503).json({
      ok: false,
      reason: 'broker_storage_not_initialized',
      detail: 'vault/db/auth not yet ready -- retry in a moment',
    });
  } catch (e) {
    console.error('[server] /api/me/broker mount error:', e && e.message);
    return res.status(500).json({ ok: false, reason: 'mount_failed', detail: e.message });
  }
});

// ---------- Tier 82: GET /api/v1/me/orders/by-mode ----------
// T-408: extracted to routes/me-heavy.js (mounted above).

// ---------- Tier 84: account / preferences / notifications / export ----------
let _accountRouter = null;
app.use('/api/v1/me', (req, res, next) => {
  // Only intercept the specific Tier 84 paths so we don't shadow /api/v1/me/brokers/*
  const t84paths = ['/account', '/preferences', '/notifications', '/export'];
  if (!t84paths.some(p => req.path === p || req.path.startsWith(p + '/'))) return next();
  try {
    if (_accountRouter) return _accountRouter(req, res, next);
    if (db && auth && vault) {
      const { createAccountRouter } = require('./account-routes');
      _accountRouter = createAccountRouter({ db, vault, requireAuth: auth.requireAuth, auth });
      return _accountRouter(req, res, next);
    }
    return res.status(503).json({ ok: false, reason: 'account_router_not_initialized' });
  } catch (e) {
    return res.status(500).json({ ok: false, reason: 'account_mount_failed', detail: e.message });
  }
});

// ---------- Tier 81: v1 API surface ----------
// RESTful, versioned, plural nouns. Mounted alongside legacy /api/me/broker for
// 30-day backward-compat window. Frontend should call /api/v1/me/brokers/*.
let _v1BrokersRouter = null;
app.use('/api/v1/me/brokers', (req, res, next) => {
  try {
    if (_v1BrokersRouter) return _v1BrokersRouter(req, res, next);
    if (db && auth && vault) {
      const { createV1BrokersRouter } = require('./me-broker');
      _v1BrokersRouter = createV1BrokersRouter({ db, vault, requireAuth: auth.requireAuth });
      return _v1BrokersRouter(req, res, next);
    }
    return res.status(503).json({ ok: false, reason: 'broker_storage_not_initialized' });
  } catch (e) {
    return res.status(500).json({ ok: false, reason: 'v1_mount_failed', detail: e.message });
  }
});

// ---------- Tier 64: Test Connection endpoint ----------
// POST /api/me/broker-test
// Uses the requesting user's per-user broker to call Kite /profile.
// Returns profile name + segments + products on success, or detailed error.
// T-417: /api/me/broker-test moved to routes/broker-oauth.js.

// ---------- Tier 62: per-user Kite OAuth flow ----------
// HMAC-signed state token so callback can identify the user without trusting URL query.
// state = base64url(userId).base64url(nonce).hex(HMAC_SHA256(userId|nonce, masterKey))
// T-417: /api/me/broker-oauth-url moved to routes/broker-oauth.js.

// Per-user callback. If state is present, prefer per-user flow over legacy global.
// Kite redirects with ?request_token=...&action=login&status=success&state=...
// Tier 81: callback handler now lives at both legacy and v1 paths
// T-417: _zerodhaCallback moved to routes/broker-oauth.js.
// T-417: /api/me/broker-callback (alias) moved to routes/broker-oauth.js.
// T-417: /api/v1/oauth/zerodha/callback (alias) moved to routes/broker-oauth.js.

// ---------- Tier 50/51: auth endpoints (signup, login, logout, verify, reset) ----------
mountAuthRoutes(app, { getAuth: () => auth, getEmailAlerts: () => emailAlerts }); // T-216 + T-228 fix: getter pattern (auth is `let` populated in init, was captured undefined)
// T-262: per-user risk-management config. Same getter pattern as auth
// because riskConfigService is assigned inside init() (after openDb)
// but mountX is called at module top-level; capturing now = undefined.
mountRiskConfigRoutes(app, { getRiskConfig: () => riskConfigService, getAuth: () => auth, getNotify: () => _notifyModule, getAudit: () => audit });
// T-484: soft-kill endpoints. Backs the UI top-right Kill button.
mountAdminKillRoutes(app, { getAuth: () => auth, getAudit: () => audit, getNotify: () => _notifyModule, getRiskConfig: () => riskConfigService });  // T-490: getRiskConfig added so soft-kill can pause/restore activeModes
// T-496: panic-square-off route. Auth-gated POST that walks broker.getPositions(),
// places reverse MARKET orders, and engages soft-kill so autorun won't re-enter.
mountAdminSquareOffRoutes(app, { getBroker: () => broker, getMarketMeta: () => _marketMeta, notify: _notifyModule, audit });
// T-290e: option-chain READ routes + ops-key gated manual refresh.
// fetcher may be null if init failed; the route checks for that.
app.use((req, res, next) => {
  // Make fetcher available to the mounted routes via deps closure (mounted once at startup).
  next();
});
mountOptionChainRoutes(app, {
  // Getter pattern: db is assigned inside init(); mountX runs at module load.
  // Lazy lookup avoids the undefined-at-mount-time problem the other routes
  // dodge via their own getX patterns (e.g. getAuth, getRiskConfig).
  getDb: () => db,
  fetcher: { refresh: async (args) => optionChainFetcher ? optionChainFetcher.refresh(args) : { ok: false, reason: 'fetcher_not_initialized' } },
  opsKey: process.env.ATS_OPS_KEY || '',
});

// T-416 (architecture audit #1, god-object split #43): 5 paper-trading +
// walk-forward routes extracted to routes/paper-trading.js.
//   - GET  /api/me/paper
//   - POST /api/me/paper/order
//   - PUT  /api/me/paper/capital
//   - POST /api/me/paper/promote-check
//   - POST /api/me/walk-forward
const { mountPaperTradingRoutes } = require('./routes/paper-trading');
mountPaperTradingRoutes(app, {
  withAuth,
  getDb:             () => db,
  getBroker:         () => broker,
  getSurveillance:   () => _surveillance,
  getEarningsCal:    () => _earningsCal,
  createWalkForward,
  runBacktest:       _wfRunBacktest,
});

// T-403 (split #26): /api/me/calibration moved to routes/me-misc.js.
// T-403 (split #26): macro-signals routes moved to routes/me-misc.js.

// T-403 (split #26): /api/me/recommend-retire moved to routes/me-misc.js.

// T-403 (split #24/25/26): mount me-options + sip-engine + me-misc + me-portfolio-meta routes.
const { mountMeOptionsRoutes }        = require('./routes/me-options');
const { mountSipEngineRoutes }        = require('./routes/sip-engine');
const { mountMeMiscRoutes }           = require('./routes/me-misc');
const { mountMePortfolioMetaRoutes }  = require('./routes/me-portfolio-meta');
mountMeOptionsRoutes(app, {
  getDb: () => db,
  getOptionChainFetcher: () => optionChainFetcher,
  getOptionsScanner: () => optionsScanner,
});
mountSipEngineRoutes(app, { getSipRunner: () => sipRunner });
mountMeMiscRoutes(app, {
  getSignalCalibration:   () => signalCalibration,
  getNseMacroFetcher:     () => nseMacroFetcher,
  getPortfolioAggregates: () => portfolioAggregates,
  getDb:                  () => db,
});
mountMePortfolioMetaRoutes(app, {
  getRegimeDetector:  () => regimeDetector,
  getAttribution:     () => attribution,
  getSlippageTracker: () => slippageTracker,
});


// T-403 (split #25): /api/sip/* moved to routes/sip-engine.js.

// T-403 (split #26): /api/me/portfolio/aggregates + /api/me/portfolio/stress moved to routes/me-misc.js.

// T-403 (split #23): regime + attribution + slippage moved to routes/me-portfolio-meta.js.

// T-415 (god-object split #41): /api/rebalance moved to routes/misc-trading.js.

// Tier 18: AI-generated monthly review narrative (spec §4 Stage 4).

// T-415 (architecture audit #1, god-object split #41): 2 misc routes
// (/api/rebalance, /api/paper/replay) extracted to routes/misc-trading.js.
const { mountMiscTradingRoutes } = require('./routes/misc-trading');
mountMiscTradingRoutes(app, {
  audit, pickBroker,
  getRebalance: () => rebalance,
  getLongterm:  () => longterm,
  getPaper:     () => paper,
  getBroker:    () => broker,
  getReplay:    () => replay,
});

// ---------- Tier 27: Email alerts ----------
// T-401 (god-object split #20): 2 email routes extracted to routes/email.js.
const { mountEmailRoutes } = require('./routes/email');
mountEmailRoutes(app, { getEmailAlerts: () => emailAlerts, withAuth });

// T-166: admin-gated email status + test. Mirrors /api/email/* but locked
// behind requireInternal() (loopback IP + X-ATS-Internal header) so it can
// be safely called from operator tooling like SETUP-SMTP-ON-VM.cmd without
// exposing send to the public internet.
//
// T-386 (architecture audit #1, god-object split #3): /api/admin/email-*
// routes extracted to routes/email-admin.js. See that module's header for
// history. requireInternal stays in server.js (used by many other routes)
// and is injected as a dep.
const { mountEmailAdminRoutes } = require('./routes/email-admin');
mountEmailAdminRoutes(app, { getEmailAlerts: () => emailAlerts, audit, requireInternal, express });

// ---------- Tier 28 (WhatsApp) + Tier 47 (email digest) ----------
// T-397 (god-object split #14): 4 notification routes (whatsapp/status,
// whatsapp/send, digest/preview, digest/send) extracted to routes/notifications.js.
const { mountNotificationRoutes } = require('./routes/notifications');
mountNotificationRoutes(app, { getWhatsApp: () => whatsAppAlerts, getDigest: () => digest });

// Tier 46 (CAS parser) + Tier 27/T-186 (deprecated monthly-review)
// T-398 (god-object split #15): 2 routes extracted to routes/cas-monthly.js.
const { mountCasMonthlyRoutes } = require('./routes/cas-monthly');
mountCasMonthlyRoutes(app, {
  parseCASText, audit,
  getAi:    () => ai,
  getPaper: () => paper,
  express,
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

// T-224 (CODE-AUDIT F.5 M1.4 piece 6b): /api/orders/* full route-handler set extracted.
// All 5 routes (place, confirm-2fa, cancel-2fa GET+POST, cancel, dry-run) + handleCancel2fa now live in routes/orders.js.
// Mutable singletons (broker/paper/twoFactor) passed as getters -- see T-228 for why.
mountOrdersRoutes(app, {
  KILL_SWITCH, LIVE_TRADING,
  MAX_POSITION_SIZE_INR, MAX_AGGREGATE_EXPOSURE, MAX_DAILY_LOSS_INR, MAX_ORDERS_PER_MIN,
  audit, withAuth, pickBroker,
  getBroker:    () => broker,
  getPaper:     () => paper,
  getTwoFactor: () => twoFactor,
  _orderRateOk, _orderRateRecord, _orderTimes,
  VALID_SIDES, VALID_PRODUCTS, VALID_ORDER_TYPES, VALID_VARIETIES, VALID_VALIDITY,
  // T-277: per-user trading-mode guard. Live orders are refused when the
  // operator's risk config says tradingMode='paper'.
  getRiskConfig: (userId) => riskConfigService ? riskConfigService.cachedGet(userId) : null,
  // T-273: consolidated pre-trade pipeline. orders.js uses this if available;
  // otherwise falls back to the inline gates (backward-compatible).
  getPreTradeCheck: () => preTradeCheck,
  // T-465 (audit-2026-05-26 backend L8): pass db getter so the daily-loss
  // circuit can read pnl_daily for live-order realized PnL (not just paper).
  getDb: () => db,
});

// Tier 38: confirm a 2FA-pending order. Replays the held payload through
// the same broker.placeOrder path so all the same audit + risk checks apply.

// Tier 41: reject a pending 2FA token. Useful when the user spots a
// suspicious order in the Telegram alert and wants to abort.
// GET so it can be one-click from Telegram; POST also accepted.

// Tier 11: cancel a working order. Same dual gating as place.


// ---------- Broker OAuth: Zerodha ----------
// Step 1: send the user to Kite to log in
// T-417: /api/brokers/zerodha/login moved to routes/broker-oauth.js.

// Step 2: Kite redirects back with ?request_token=...
// Tier 62: If state= is present, this is a per-user OAuth callback. Decode the state,
// look up the user, and route the exchange through their own broker_accounts row.
// T-417: /api/brokers/zerodha/callback moved to routes/broker-oauth.js.

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
  //
  // Defense-in-depth: nginx strips X-ATS-Internal from public traffic (verified
  // in T-41 -- both rajasekarselvam.com.conf and ats.rajasekarselvam.com.conf
  // have `proxy_set_header X-ATS-Internal ""`). So even if a public attacker
  // somehow had a private source IP, they'd still fail the header check. The
  // IP check is the primary boundary; the header check is the backstop.
  const ra = getClientIp(req).replace('::ffff:', '');
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
// T-417: /api/brokers/zerodha/auto-login/bundle moved to routes/broker-oauth.js.

// Host-side script POSTs the request_token here once Kite redirects.
// T-417: /api/brokers/zerodha/auto-login/exchange moved to routes/broker-oauth.js.

// ---------- T-133 (Tier 76 Phase 1): bulk per-user TOTP rotation ----------
//
// These two routes power the host-side daily auto-reauth script that runs
// Playwright headless Kite logins for every user opted into auto_reauth_enabled.
//
// The flow:
//   1. Host script calls POST /api/admin/internal/bulk-rotate to fetch the
//      list of eligible users + their unsealed credentials. Credentials cross
//      the wire UNSEALED — safe because the route is gated by
//      requireInternal() (loopback/private IP + X-ATS-Internal header) and
//      nginx strips X-ATS-Internal from public traffic (T-41).
//   2. For each row, the host script:
//      a. Opens a headless browser
//      b. Drives the Kite login (user_id + password + TOTP)
//      c. Captures the redirect's request_token
//      d. Exchanges request_token → access_token via the Kite API directly
//      e. POSTs access_token back to /api/admin/internal/seal-token which
//         seals + persists it.
//
// Eligibility: broker_accounts.auto_reauth_enabled=1 AND all four sealed
// columns present (api_key, refresh_token=api_secret, totp_seed, feed_token=password).
// That filter lives in db.brokers.listEligible (Tier 80).

// T-416: /api/admin/internal/bulk-rotate moved to routes/paper-trading.js or routes/admin-internal.js.

// T-416 (architecture audit #1, god-object split #42): 2 internal admin
// routes (bulk-rotate, seal-token) extracted to routes/admin-internal.js.
const { mountAdminInternalRoutes } = require('./routes/admin-internal');
mountAdminInternalRoutes(app, {
  audit, requireInternal, express,
  getVault: () => vault,
  getDb:    () => db,
});

// T-417 (architecture audit #1, god-object split #44 -- FINAL): all 10 broker
// OAuth handlers extracted to routes/broker-oauth.js. server.js is now
// completely free of inline routes -- everything mounts via routes/*.js modules.
const { mountBrokerOAuthRoutes } = require('./routes/broker-oauth');
mountBrokerOAuthRoutes(app, {
  BROKER_NAME,
  audit, notify, withAuth, requireInternal, setSessionCookie, readSessionCookie,
  signState:   _signState,
  verifyState: _verifyState,
  getBroker:          () => broker,
  getVault:           () => vault,
  getDb:              () => db,
  getSessions:        () => sessions,
  getBrokerResolver:  () => _brokerResolver,
  getWsClients:       () => wsClients,
  express,
});

// T99-T78: observability error middleware. Catches any thrown error from a
// route handler, persists to errors_log with request_id/user_id/path/duration,
// and returns a structured 500. Must come AFTER all routes but BEFORE the 404
// fallback (which is itself a 404, not an error).
app.use(_obsErrorMiddleware);

app.use('/api', (_req, res) => res.status(404).json({ ok: false, reason: 'not_found' }));

// ---------- HTTP + WebSocket server ----------
const server = http.createServer(app);
// T-198 (CODE-AUDIT C.10 #4): reject WebSocket upgrades that don't carry an
// allowed Origin. Reuses the same CSRF_ALLOWED_ORIGINS Set used by the HTTP
// CSRF middleware so the two policies stay in lock-step. Without this gate,
// a page at evil.example.com can open wss://ats.rajasekarselvam.com/ws with
// the user's cookie and read their watchlist + tick stream.

// Single shared subscription against the broker. Adapter does the heavy lifting.
const wsClients = new Set(); // Set<WebSocket>
// T-226 (CODE-AUDIT F.5 M1.4 piece 7a): tick fan-out + broker-health broadcaster
// extracted to services/tick-fanout.js. broker/alerts/paper passed as getters (T-228 pattern).
// Returns { startBrokerFanout } -- the boot IIFE awaits it after init() populates broker.
const _tickFanout = attachUpstreamFanout({
  wsClients,
  DEFAULT_SYMBOLS,
  getBroker: () => broker,
  getAlerts: () => alerts,
  getPaper:  () => paper,
  notify,
});
const startBrokerFanout = _tickFanout.startBrokerFanout;

// T-227 (M1.4 piece 7b): WSS ctor + connection handler extracted to routes/ws.js.
// wsClients Set stays here -- it's also iterated by the metrics gauge, alerts
// broadcast, and kill-switch broadcast elsewhere in this file. Mutations are
// visible across the module boundary because Sets are objects (ref equality).
const wss = mountWs(server, {
  wsClients,
  MAX_WS_CLIENTS, DEFAULT_SYMBOLS, KILL_SWITCH, LIVE_TRADING,
  CSRF_ALLOWED_ORIGINS,
  audit, readSessionCookie,
  getDb:        () => db,
  getBroker:    () => broker,
  getWatchlist: () => watchlist,
});


// T99-T47: session janitor. db.sessions.purgeExpired() existed but was never
// called anywhere — expired user_sessions rows accumulated forever (every
// login adds one + every session expiry stays as dead weight in the table +
// in every nightly backup). Runs once an hour; logs only when something was
// actually cleaned so quiet weeks don't pollute the log.
const _sessionJanitorTimer = setInterval(() => {
  try {
    if (db && db.sessions && typeof db.sessions.purgeExpired === 'function') {
      const removed = db.sessions.purgeExpired();
      if (removed && removed > 0) {
        console.log(`[sessions] janitor purged ${removed} expired session(s)`);
      }
    }
  } catch (e) { console.warn('[sessions] janitor error:', e && e.message); }
}, 60 * 60 * 1000);   // 1 hour
if (_sessionJanitorTimer.unref) _sessionJanitorTimer.unref();
// Also run once at boot so a server that has been down a while doesn't wait
// Also run once at boot so a server that has been down a while doesn't wait
// an hour before its first cleanup.
setTimeout(() => {
  try {
    if (db && db.sessions && typeof db.sessions.purgeExpired === 'function') {
      const removed = db.sessions.purgeExpired();
      console.log(`[sessions] janitor boot-sweep removed ${removed} expired session(s)`);
    }
  } catch (e) { console.warn('[sessions] boot janitor error:', e && e.message); }
}, 30_000);  // wait 30s so db/init has settled


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

// ---------- Shutdow
