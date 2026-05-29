// autorun.js -- single-config strategy auto-runner (paper-only).
//
// Holds ONE active strategy config at a time. On a periodic timer:
//   1. Fetch latest candles via broker.getHistorical()
//   2. Run the strategy's signal generator (from backtest.js)
//   3. Look at the LAST BAR's signal -- if BUY/SELL fires, place a paper
//      order tagged with the strategy name.
//   4. Per-bar dedupe: same bar date can't fire the same direction twice.
//
// Config schema:
//   {
//     enabled:           bool,    default false (off until user enables)
//     strategy:          str,     'rsi_mean_revert' | 'ema_cross' | 'macd_cross' | 'bollinger'
//     symbol:            str,     tradable equity symbol
//     params:            obj,     strategy-specific (period, entryRsi, exitRsi, etc.)
//     qty:               int,     shares per order
//     interval:          str,     candle interval -- 'day' | '5minute' | '15minute' | etc.
//     intervalMinutes:   int,     how often to evaluate (default 5)
//     candleLookbackDays: int,    how far back to fetch (default 60)
//   }
//
// Persistence: /var/lib/ats/tokens/_autorun.json (config + last 100 runs).

const fs   = require('fs');
const path = require('path');
// T-485: soft-kill flag -- autorun pauses when operator fires the kill switch.
const softKill = require('./services/soft-kill');

const DEFAULT_STORE  = '/var/lib/ats/tokens/_autorun.json';
const HISTORY_MAX    = 100;
const MIN_INTERVAL_MS = 60 * 1000;       // never go below 1 minute
const DEFAULT_INTERVAL_MIN = 5;
const DEFAULT_LOOKBACK_DAYS = 60;

// ---- T-267 helpers ----
function _todayIST() {
  // Returns YYYY-MM-DD in IST (UTC+5:30). Used to detect calendar rollover for
  // the daily trade counter -- without IST awareness the rollover happens at
  // 5:30am UTC which is during India market hours.
  const now = new Date();
  const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  return ist.toISOString().slice(0, 10);
}

function _nowIST_HHMM() {
  const now = new Date();
  const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  // toISOString shows UTC, but we've shifted -- so the HH:MM portion is IST.
  return ist.toISOString().slice(11, 16);
}

function _hhmmToMinutes(s) {
  const [h, m] = String(s).split(':').map(Number);
  return h * 60 + m;
}

class AutoRunner {
  /**
   * @param {object} opts
   * @param {object} opts.broker            broker with getHistorical()
   * @param {object} opts.paper             paper trading instance
   * @param {Function} opts.computeSignal   ({candles, strategy, params}) => signal[]
   * @param {(event, data) => void} [opts.audit]
   * @param {string} [opts.storePath]
   */
  constructor({ broker, paper, computeSignal, audit, storePath,
                getRiskConfig, tradeEconomics, notify, userId,
                getRegime, isStrategyEligibleInRegime,
                // T-496: market-hours/holiday gate. Optional -- if absent,
                // engine behaves as pre-T-496 (no calendar check).
                getMarketMeta,
                // T-497: per-strategy mode lookup (strategy id -> 'intraday'|'swing'|'options'|'futures').
                // Optional -- if absent, the mode gate is a no-op and engine behaves as pre-T-497.
                getStrategyMode,
                // T-502: pre-trade pipeline (12-gate stack) for the live order path.
                // Optional -- if absent, autorun behaves as pre-T-502 (paper-only).
                preTradeCheck,
                getOptionsScanner, getHoldings, optionsUnderlyings }) {
    if (!broker)        throw new Error('broker required');
    if (!paper)         throw new Error('paper required');
    if (!computeSignal) throw new Error('computeSignal required');
    this.broker         = broker;
    this.paper          = paper;
    this.computeSignal  = computeSignal;
    this.audit          = audit || (() => {});
    this.storePath      = storePath || DEFAULT_STORE;
    // ---- T-263..T-267 risk-aware engine wiring ----
    // getRiskConfig: () => RiskConfig (per-user, cached). Optional -- if absent,
    // all gates are no-ops and engine behaves like pre-T-263.
    this.getRiskConfig  = (typeof getRiskConfig === 'function') ? getRiskConfig : null;
    this.tradeEconomics = tradeEconomics || null;
    this.notify         = notify || null;
    this.userId         = Number.isInteger(userId) ? userId : 1;
    // T-282: regime-aware strategy gate. Optional -- if either dep is missing,
    // the gate is a no-op and autorun behaves as pre-T-282 (regime ignored).
    this.getRegime      = (typeof getRegime === 'function') ? getRegime : null;
    this.isStrategyEligibleInRegime = (typeof isStrategyEligibleInRegime === 'function')
      ? isStrategyEligibleInRegime : null;
    // T-496: market-hours/holiday gate. autorun.runOnce returns 'skipped' (not
    // an error) when the market is closed so the timer can keep firing without
    // polluting the audit chain with "blocked" events every tick.
    this.getMarketMeta  = (typeof getMarketMeta === 'function') ? getMarketMeta : null;
    // T-497: trading-mode gate. Closes the bug where "modes" (intraday / swing /
    // options / futures) were frontend-only -- disabling Options in the UI did
    // not stop an Options strategy from firing. Now: if user has any modes
    // configured (activeModes !== {}), the strategy's mode must be enabled.
    // Empty activeModes ({}) preserves legacy behaviour -- gate is a no-op.
    this.getStrategyMode = (typeof getStrategyMode === 'function') ? getStrategyMode : null;
    // T-502: pre-trade pipeline. When a strategy is route='live' we run the
    // payload through preTradeCheck.check() before broker.placeOrder. If
    // preTradeCheck is missing, autorun is FORCED to paper-only mode for
    // every strategy -- defensive default that means upgrading without
    // wiring preTrade can never accidentally fire live orders.
    this.preTradeCheck = (preTradeCheck && typeof preTradeCheck.check === 'function') ? preTradeCheck : null;
    // T-298b: options scanner SHADOW MODE -- no orders fired from this path.
    // getOptionsScanner is a function returning the scanner instance (or null)
    // -- using a getter so server.js can construct autorun before scanner.
    // getHoldings is an optional async fn returning normalised holdings for
    // the covered-call template. optionsUnderlyings is a list of {underlying}
    // pairs to scan (e.g. [{underlying:'NIFTY'}, {underlying:'BANKNIFTY'}]).
    this.getOptionsScanner = (typeof getOptionsScanner === 'function') ? getOptionsScanner : null;
    this.getHoldings    = (typeof getHoldings === 'function') ? getHoldings : null;
    this.optionsUnderlyings = Array.isArray(optionsUnderlyings) ? optionsUnderlyings : [];
    this._config        = null;
    this._history       = [];
    this._timer         = null;
    this._inflight      = false;
    this._lastFiredKey  = null;   // dedupe: "SYMBOL|STRATEGY|BARDATE|SIDE"
    // ---- T-266: daily trade counter (resets on calendar-day rollover) ----
    this._tradesToday   = 0;
    this._tradeCountDay = _todayIST();
    // T-503: silent-degradation counters surfaced on /api/health + tracked so
    // operator sees when a "permissive on failure" branch silently disables
    // a safety gate. Throttled to one Telegram notify per 60s per branch.
    this._degradedCounts = { regime: 0, economics: 0, runOnceThrows: 0 };
    this._degradedNotifyAt = { regime: 0, economics: 0, runOnceThrows: 0 };
    // ---- T-511 (Phase 2): multi-config engine ----
    // _configs is the registry of ALL configs (keyed by `${strategy}:${symbol}`).
    // _config remains the legacy "primary" pointer (back-compat with single-
    // config callers, tests, persistence). runOnceAll() context-switches into
    // each enabled config before delegating to the unchanged runOnce().
    this._configs           = new Map();
    this._lastFiredKeys     = new Map();
    this._tradesPerConfig   = new Map();
    this._tradeDayPerConfig = new Map();
  }

  // T-511: stable id for a config. Keying by strategy+symbol means there can
  // never be two configs for the same (strategy, symbol) pair -- enforces
  // idempotent add/remove semantics.
  _configId(cfg) {
    if (!cfg || !cfg.strategy || !cfg.symbol) return null;
    return `${cfg.strategy}:${cfg.symbol}`;
  }

  // T-503: combined audit + counter + throttled Telegram for a permissive-failure
  // branch. Called from any try/catch inside runOnce where the catch deliberately
  // lets the trade through despite the gate failing.
  _gateDegraded(branch, error) {
    try {
      if (this._degradedCounts[branch] != null) this._degradedCounts[branch]++;
      this.audit('autorun.gate.degraded', { branch, msg: error && error.message, count: this._degradedCounts[branch] });
      const now = Date.now();
      if (this.notify && typeof this.notify.notify === 'function'
          && (now - (this._degradedNotifyAt[branch] || 0)) > 60_000) {
        this._degradedNotifyAt[branch] = now;
        this.notify.notify({
          title: '⚠️ ATS — safety gate degraded',
          body: `autorun.${branch} failed and let the trade through (count today: ${this._degradedCounts[branch]}). ${error ? error.message : ''}`,
        }).catch(() => {});
      }
    } catch { /* never let telemetry crash the engine */ }
  }

  // T-503: snapshot for /api/health.
  getDegradedSnapshot() { return Object.assign({}, this._degradedCounts); }

  // T-502: paper-vs-live routing decision. A strategy fires LIVE only when
  // BOTH locks are open: (a) tradingMode != paper, (b) strategy is in
  // liveEnabledStrategies. Either lock alone keeps the strategy in paper.
  // Defensive default: if preTradeCheck is missing OR riskConfig lookup
  // fails, we return 'paper' so a misconfigured engine cannot accidentally
  // fire real money.
  _pickRoute(strategy) {
    if (!this.preTradeCheck) return 'paper';   // defensive: never live without preTrade
    if (!this.getRiskConfig) return 'paper';
    let cfg = null;
    try { cfg = this.getRiskConfig(this.userId); }
    catch (e) { this.audit('autorun.route.cfgLookupFailed', { msg: e.message }); return 'paper'; }
    if (!cfg) return 'paper';
    if (cfg.tradingMode === 'paper' || !cfg.tradingMode) return 'paper';
    if (!Array.isArray(cfg.liveEnabledStrategies)) return 'paper';
    if (!cfg.liveEnabledStrategies.includes(strategy)) return 'paper';
    return 'live';
  }

  load() {
    try {
      if (!fs.existsSync(this.storePath)) return;
      const raw = JSON.parse(fs.readFileSync(this.storePath, 'utf8'));
      if (raw && typeof raw === 'object') {
        this._config       = raw.config || null;
        this._history      = Array.isArray(raw.history) ? raw.history.slice(-HISTORY_MAX) : [];
        this._lastFiredKey = raw.lastFiredKey || null;
        // T-511 (Phase 2): restore multi-config registry + per-config state.
        if (raw.configs && typeof raw.configs === 'object') {
          for (const [id, cfg] of Object.entries(raw.configs)) this._configs.set(id, cfg);
        }
        if (raw.lastFiredKeys && typeof raw.lastFiredKeys === 'object') {
          for (const [id, key] of Object.entries(raw.lastFiredKeys)) this._lastFiredKeys.set(id, key);
        }
        if (raw.tradesPerConfig && typeof raw.tradesPerConfig === 'object') {
          for (const [id, n] of Object.entries(raw.tradesPerConfig)) this._tradesPerConfig.set(id, Number(n) || 0);
        }
        if (raw.tradeDayPerConfig && typeof raw.tradeDayPerConfig === 'object') {
          for (const [id, d] of Object.entries(raw.tradeDayPerConfig)) this._tradeDayPerConfig.set(id, String(d));
        }
        // One-shot migration: legacy persisted state had no `configs` field.
        // Seed _configs from the singular _config so existing setups upgrade
        // cleanly without an empty registry.
        if (this._config && this._configs.size === 0) {
          const id = this._configId(this._config);
          if (id) this._configs.set(id, this._config);
        }
        // T-359: restore the daily trade counter, but rollover if the stored
        // day != today (calendar-day boundary in IST).
        const today = _todayIST();
        if (raw.tradeCountDay && raw.tradeCountDay === today && Number.isFinite(raw.tradesToday)) {
          this._tradesToday = raw.tradesToday;
          this._tradeCountDay = raw.tradeCountDay;
        } else {
          this._tradesToday = 0;
          this._tradeCountDay = today;
        }
        console.log(`[autorun] loaded: enabled=${!!(this._config && this._config.enabled)}, history=${this._history.length}, tradesToday=${this._tradesToday}`);
      }
    } catch (e) { console.warn('[autorun] load failed:', e.message); }
  }

  _persist() {
    try {
      fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
      fs.writeFileSync(this.storePath, JSON.stringify({
        config: this._config,
        history: this._history.slice(-HISTORY_MAX),
        lastFiredKey: this._lastFiredKey,
        // T-359: persist the daily-trade counter so a mid-day process restart
        // doesn't reset it to 0 (otherwise user could exceed maxDailyTrades by
        // restarting the backend, intentionally or otherwise).
        tradesToday: this._tradesToday,
        tradeCountDay: this._tradeCountDay,
        // T-511 (Phase 2): multi-config registry + per-config state.
        configs:           Object.fromEntries(this._configs),
        lastFiredKeys:     Object.fromEntries(this._lastFiredKeys),
        tradesPerConfig:   Object.fromEntries(this._tradesPerConfig),
        tradeDayPerConfig: Object.fromEntries(this._tradeDayPerConfig),
        updatedAt: new Date().toISOString(),
      }, null, 2));
    } catch (e) { console.error('[autorun] persist failed:', e.message); }
  }

  // T-511 (Phase 2): extracted from setConfig so addConfig + setConfig
  // share the same validation. Returns a fully-shaped config (no side effects).
  _validateConfig(cfg) {
    if (!cfg || typeof cfg !== 'object') throw new Error('config required');
    const out = {
      enabled:            !!cfg.enabled,
      strategy:           String(cfg.strategy || '').trim(),
      symbol:             String(cfg.symbol || '').trim().toUpperCase(),
      params:             (cfg.params && typeof cfg.params === 'object') ? cfg.params : {},
      qty:                Math.max(1, parseInt(cfg.qty || 1, 10) || 1),
      interval:           String(cfg.interval || 'day'),
      intervalMinutes:    Math.max(1, parseInt(cfg.intervalMinutes || DEFAULT_INTERVAL_MIN, 10) || DEFAULT_INTERVAL_MIN),
      candleLookbackDays: Math.max(7, Math.min(800, parseInt(cfg.candleLookbackDays || DEFAULT_LOOKBACK_DAYS, 10) || DEFAULT_LOOKBACK_DAYS)),
      // T-508 (Phase 1): per-fire protective orders. Null = no SL/TP (legacy
      // behaviour, naked MARKET). Set as percentages of entry price.
      stopLossPct:        cfg.stopLossPct        != null && Number.isFinite(Number(cfg.stopLossPct))        ? Math.max(0.1, Math.min(20, Number(cfg.stopLossPct)))        : null,
      targetPct:          cfg.targetPct          != null && Number.isFinite(Number(cfg.targetPct))          ? Math.max(0.1, Math.min(50, Number(cfg.targetPct)))          : null,
      trailingStopPct:    cfg.trailingStopPct    != null && Number.isFinite(Number(cfg.trailingStopPct))    ? Math.max(0.1, Math.min(20, Number(cfg.trailingStopPct)))    : null,
    };
    if (!out.strategy) throw new Error('strategy required');
    if (!out.symbol)   throw new Error('symbol required');
    // T-518: extended whitelist to match every strategy implemented in
    // backtest.js computeSignal (22 total). Previously only 4 were accepted
    // even though the engine had handlers for all of them, which made
    // 18 of the 22 catalog strategies un-configurable via the UI.
    const valid = [
      'rsi_mean_revert', 'ema_cross', 'macd_cross', 'bollinger',
      'supertrend', 'adx_trend', 'donchian', 'stochastic', 'williams_r',
      'heikin_ashi', 'cci', 'keltner', 'obv', 'psar', 'aroon', 'cmf',
      'atr_trail', 'ichimoku', 'vwap', 'pivot', 'mfi', 'trix',
    ];
    if (!valid.includes(out.strategy)) throw new Error(`strategy must be one of: ${valid.join(', ')}`);
    return out;
  }

  /** Validate + replace config. Restarts the timer if enabled changes. */
  setConfig(cfg) {
    const out = this._validateConfig(cfg);
    this._config = out;
    // T-511 (Phase 2): single-config setConfig REPLACES the entire registry
    // (matches the existing "PUT /api/autorun = THE config" semantics).
    // Use addConfig() / removeConfig() for multi-config CRUD.
    this._configs.clear();
    this._lastFiredKeys.clear();
    this._tradesPerConfig.clear();
    this._tradeDayPerConfig.clear();
    const id = this._configId(out);
    if (id) this._configs.set(id, out);
    this._persist();
    this._restartTimer();
    this.audit('autorun.config.set', { ...out, params: out.params });
    return out;
  }

  // T-511: add a config without disturbing others. Returns validated config + id.
  addConfig(cfg) {
    const out = this._validateConfig(cfg);
    const id = this._configId(out);
    if (!id) throw new Error('config needs strategy and symbol');
    this._configs.set(id, out);
    if (!this._config) this._config = out;
    this._persist();
    this._restartTimer();
    this.audit('autorun.config.added', { id, ...out });
    return Object.assign({ id }, out);
  }

  // T-511: remove by id. Returns true if existed.
  removeConfig(id) {
    if (!this._configs.has(id)) return false;
    this._configs.delete(id);
    this._lastFiredKeys.delete(id);
    this._tradesPerConfig.delete(id);
    this._tradeDayPerConfig.delete(id);
    const primaryId = this._config ? this._configId(this._config) : null;
    if (primaryId === id) {
      this._config = Array.from(this._configs.values()).find(c => c.enabled) || null;
    }
    this._persist();
    this._restartTimer();
    this.audit('autorun.config.removed', { id });
    return true;
  }

  listConfigs() {
    return Array.from(this._configs.entries()).map(([id, cfg]) => ({ id, ...cfg }));
  }

  clearConfig() {
    this._config = null;
    this._stopTimer();
    this._persist();
    this.audit('autorun.config.cleared', {});
  }

  _stopTimer() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }

  _restartTimer() {
    this._stopTimer();
    // T-511 (Phase 2): use the MIN intervalMinutes across all enabled configs
    // so every config gets at least its requested cadence. With a single config
    // this equals the legacy behaviour.
    const enabledFromRegistry = Array.from(this._configs.values()).filter(c => c && c.enabled);
    const hasLegacySingle = !!(this._config && this._config.enabled);
    if (!enabledFromRegistry.length && !hasLegacySingle) return;
    const minInterval = enabledFromRegistry.length
      ? Math.min(...enabledFromRegistry.map(c => Number(c.intervalMinutes) || DEFAULT_INTERVAL_MIN))
      : this._config.intervalMinutes;
    const ms = Math.max(MIN_INTERVAL_MS, minInterval * 60 * 1000);
    this._timer = setInterval(() => {
      this.runOnceAll({ source: 'timer' })
        .then((results) => {
          for (const r of (Array.isArray(results) ? results : [results])) {
            this.audit('autorun.tick', { configId: r.configId, result: r.result, signal: r.signal, symbol: r.symbol });
          }
        })
        .catch((e) => this.audit('autorun.tick.error', { msg: e.message }));
    }, ms);
    this._timer.unref();
  }

  /**
   * Manually trigger one evaluation. Returns the run record.
   * @param {object} [opts]
   * @param {string} [opts.source]  'manual' | 'timer'
   */
  async runOnce({ source } = {}) {
    if (this._inflight) return { result: 'skipped', reason: 'in_flight' };
    if (!this._config)               return { result: 'skipped', reason: 'no_config' };
    if (!this._config.enabled)       return { result: 'skipped', reason: 'disabled' };
    // T-485: soft-kill pause. When operator fires the in-memory soft-kill flag
    // (POST /api/admin/soft-kill from the UI Kill button), autorun returns
    // early instead of computing signals + attempting blocked orders every
    // tick. Cleaner audit chain (no rejected-attempt noise), lower CPU during
    // halt, and the audit trail clearly shows the engine stopped at the same
    // instant the flag was set rather than the operator having to grep
    // through dozens of `preTrade.blocked.softKill` events to confirm it.
    if (softKill.get()) {
      // Only audit ONCE per soft-kill burst to avoid filling the chain with
      // tick-rate noise. We tag with the soft-kill state so a single entry
      // tells the full story.
      if (!this._softKillNotifiedAt || (Date.now() - this._softKillNotifiedAt) > 60_000) {
        this.audit('autorun.skipped.softKill', { source: source || 'manual', softKillState: softKill.state() });
        this._softKillNotifiedAt = Date.now();
      }
      return { result: 'skipped', reason: 'soft_kill', softKillState: softKill.state() };
    }
    // Reset the throttle once soft-kill is cleared so the next halt audits again.
    if (this._softKillNotifiedAt) this._softKillNotifiedAt = 0;
    // T-496: market-hours / holiday gate. autorun fires every N min regardless
    // of clock; without this check it would compute signals + (in paper) fake
    // a trade on weekends / Diwali / pre-open hours, polluting paper stats and
    // creating a foot-gun for the day LIVE_TRADING flips on. Same throttle
    // pattern as softKill -- audit once per closed-market burst.
    if (this.getMarketMeta) {
      try {
        const mm = this.getMarketMeta();
        if (mm && typeof mm.isMarketOpenNow === 'function') {
          const st = mm.isMarketOpenNow();
          if (st && st.open === false) {
            if (!this._marketClosedNotifiedAt || (Date.now() - this._marketClosedNotifiedAt) > 60_000) {
              this.audit('autorun.skipped.marketClosed', { source: source || 'manual', state: st });
              this._marketClosedNotifiedAt = Date.now();
            }
            return { result: 'skipped', reason: 'market_closed', state: st };
          }
        }
      } catch (e) {
        // Permissive: a marketMeta failure should not stop the engine.
        this.audit('autorun.marketMeta.failed', { msg: e.message });
      }
    }
    // Reset throttle once the market opens again.
    if (this._marketClosedNotifiedAt) this._marketClosedNotifiedAt = 0;
    // T-497: trading-mode gate. Look up the running strategy's mode and
    // confirm the operator has it enabled in their risk_config.activeModes.
    // Fail-open when activeModes is empty {} (legacy users who never set
    // modes via the UI keep firing as before); fail-closed when the user
    // has populated activeModes (= they expect the toggle to mean something).
    if (this.getStrategyMode && this.getRiskConfig && this._config && this._config.strategy) {
      try {
        const stratMode = this.getStrategyMode(this._config.strategy);
        const cfg = this.getRiskConfig(this.userId);
        const activeModes = (cfg && cfg.activeModes && typeof cfg.activeModes === 'object' && !Array.isArray(cfg.activeModes))
          ? cfg.activeModes
          : {};
        const hasAnyModeConfig = Object.keys(activeModes).length > 0;
        if (stratMode && hasAnyModeConfig) {
          const entry = activeModes[stratMode];
          // enabled defaults to true ONLY if there's an entry and it doesn't
          // say enabled:false. Missing entries = disabled (fail-closed once
          // the user has shown they're using the toggle).
          const isEnabled = !!(entry && entry.enabled !== false && entry.enabled != null ? entry.enabled : (entry ? true : false));
          if (!isEnabled) {
            if (!this._modeDisabledNotifiedAt || (Date.now() - this._modeDisabledNotifiedAt) > 60_000) {
              this.audit('autorun.skipped.modeDisabled', { strategy: this._config.strategy, mode: stratMode, activeModes });
              this._modeDisabledNotifiedAt = Date.now();
            }
            return { result: 'skipped', reason: 'mode_disabled', strategy: this._config.strategy, mode: stratMode };
          }
        }
        if (this._modeDisabledNotifiedAt) this._modeDisabledNotifiedAt = 0;
      } catch (e) {
        // Permissive: a config-read failure should not stop the engine.
        this.audit('autorun.modeGate.failed', { msg: e.message });
      }
    }
    this._inflight = true;
    const t0 = Date.now();
    const run = {
      ts:       new Date().toISOString(),
      source:   source || 'manual',
      symbol:   this._config.symbol,
      strategy: this._config.strategy,
      params:   this._config.params,
      qty:      this._config.qty,
    };
    try {
      const to = new Date();
      const from = new Date(to.getTime() - this._config.candleLookbackDays * 86400 * 1000);
      const fromStr = from.toISOString().slice(0, 10);
      const toStr   = to.toISOString().slice(0, 10);
      const candles = await this.broker.getHistorical({
        symbol: this._config.symbol,
        interval: this._config.interval,
        from: fromStr, to: toStr,
      });
      if (!Array.isArray(candles) || candles.length < 30) {
        run.result = 'skipped'; run.reason = `insufficient candles: ${candles ? candles.length : 0}`;
      } else {
        const signal = this.computeSignal({ candles, strategy: this._config.strategy, params: this._config.params });
        const lastSig = signal[signal.length - 1];
        const lastBar = candles[candles.length - 1];
        run.signal     = lastSig;
        run.lastBarDate = lastBar.date;
        run.lastClose   = lastBar.close;
        if (!lastSig) {
          run.result = 'no_signal';
        } else {
          // ============================================================
          // T-263..T-267 risk-aware gates -- evaluated in order. Each one
          // either lets the signal proceed or short-circuits with a
          // 'skipped_<reason>' result that's logged + optionally Telegrammed.
          // ============================================================
          const cfg = this.getRiskConfig ? this.getRiskConfig(this.userId) : null;

          // T-267: golden time window
          if (cfg) {
            const nowHHMM = _nowIST_HHMM();
            const nowMin  = _hhmmToMinutes(nowHHMM);
            const startMin = _hhmmToMinutes(cfg.goldenStartHHMM);
            const endMin   = _hhmmToMinutes(cfg.goldenEndHHMM);
            if (nowMin < startMin || nowMin > endMin) {
              run.result = 'skipped_outside_window';
              run.window = `${cfg.goldenStartHHMM}..${cfg.goldenEndHHMM}`;
              run.now = nowHHMM;
              if (this.notify && this.notify.logOutsideWindow) {
                this.notify.logOutsideWindow({ now: nowHHMM, windowStart: cfg.goldenStartHHMM, windowEnd: cfg.goldenEndHHMM });
              }
            }
          }

          // T-282: regime-aware strategy eligibility. If the current regime
          // and the strategy registry both have an opinion, and the opinion is
          // "this strategy is not eligible right now", short-circuit. Best-effort
          // -- a missing regime or detector failure is permissive (lets the trade
          // through, audited as 'regime_unknown'). The whole gate is wrapped in
          // a try/catch so a transient broker outage in the regime fetch never
          // crashes the autorun tick.
          if (!run.result && this.getRegime && this.isStrategyEligibleInRegime) {
            try {
              const reg = await Promise.resolve(this.getRegime());
              if (reg && reg.regime) {
                run.regime = { label: reg.regime, confidence: reg.confidence };
                const eligible = this.isStrategyEligibleInRegime(this._config.strategy, reg.regime);
                if (!eligible) {
                  run.result = 'skipped_wrong_regime';
                  run.regime.reason = `strategy '${this._config.strategy}' not eligible in '${reg.regime}' regime`;
                }
              } else {
                run.regime = { label: 'unknown' };
              }
            } catch (e) {
              // Permissive on failure: log but let the trade proceed via the
              // remaining gates. The other risk caps (daily cap, economics,
              // window) still protect us. T-503: also fire degraded-counter
              // + throttled Telegram so this can't stay silently broken.
              run.regimeError = e.message;
              this._gateDegraded('regime', e);
            }
          }

          // T-266: daily trade cap (only if T-267 / T-282 didn't already skip)
          if (!run.result && cfg) {
            // Rollover counter on calendar day change (IST)
            const today = _todayIST();
            if (today !== this._tradeCountDay) {
              this._tradesToday = 0;
              this._tradeCountDay = today;
            }
            if (this._tradesToday >= cfg.maxDailyTrades) {
              run.result = 'skipped_daily_cap';
              run.tradesToday = this._tradesToday;
              run.cap = cfg.maxDailyTrades;
              if (this.notify && this.notify.notifyTradeCapHit) {
                this.notify.notifyTradeCapHit({ tradesToday: this._tradesToday, capacity: cfg.maxDailyTrades })
                  .catch(() => {});
              }
            }
          }

          // T-264: tax-aware economics check (only if cfg + tradeEconomics available
          // AND we have a sane price-target estimate from lastBar.close + lastSig)
          if (!run.result && cfg && this.tradeEconomics && lastBar && Number.isFinite(lastBar.close)) {
            // Conservative target: assume 1% gross move in signal direction.
            const gross = lastBar.close * 0.01;
            const buyPrice  = lastBar.close;
            const sellPrice = lastSig === 'BUY' ? buyPrice + gross : buyPrice - gross;
            try {
              const proj = this.tradeEconomics.projectRoundTrip({
                instrumentType: 'EQUITY_INTRADAY',
                buyPrice: Math.min(buyPrice, sellPrice),
                sellPrice: Math.max(buyPrice, sellPrice),
                qty: this._config.qty,
              });
              run.economics = { netPnl: proj.netPnl, totalCharges: proj.totalCharges, breakeven: proj.breakeven };
              if (proj.netPnl < 50) {
                run.result = 'skipped_uneconomic';
                if (this.notify && this.notify.notifyTradeRejectedUneconomic) {
                  this.notify.notifyTradeRejectedUneconomic({
                    symbol: this._config.symbol,
                    strategy: this._config.strategy,
                    projectedNetPnl: proj.netPnl,
                    minNetPnlINR: 50,
                  }).catch(() => {});
                }
              }
            } catch (e) {
              // economics check failed -- log but don't block the signal
              run.economicsError = e.message;
              this._gateDegraded('economics', e);
            }
          }

          // ============================================================
          // T-278: voting confirmation gate. Only enforced when the operator
          // has >1 active strategy AND votingThreshold > 1. Runs each active
          // strategy with default params (NOT this._config.params, which is
          // strategy-specific to the primary). Requires N agreements in the
          // SAME direction as the primary signal before letting it through.
          // This is a confirmation gate -- the primary lastSig still drives,
          // but the ensemble can veto it. Defaults of activeStrategies=3 and
          // votingThreshold=2 mean "primary + 1 more must agree".
          // ============================================================
          if (!run.result && cfg && Array.isArray(cfg.activeStrategies)
              && cfg.activeStrategies.length > 1
              && Number.isInteger(cfg.votingThreshold) && cfg.votingThreshold > 1) {
            const votes = { BUY: 0, SELL: 0, NONE: 0 };
            const individualSignals = {};
            for (const stratId of cfg.activeStrategies) {
              try {
                const sigArr = this.computeSignal({ candles, strategy: stratId, params: {} });
                const sig = sigArr && sigArr[sigArr.length - 1];
                individualSignals[stratId] = sig || null;
                if (sig === 'BUY')      votes.BUY++;
                else if (sig === 'SELL') votes.SELL++;
                else                     votes.NONE++;
              } catch (_) {
                individualSignals[stratId] = 'error';
                votes.NONE++;
              }
            }
            run.votes = votes;
            run.individualSignals = individualSignals;
            const sameDirVotes = votes[lastSig] || 0;
            if (sameDirVotes < cfg.votingThreshold) {
              run.result = 'skipped_no_consensus';
              run.consensus = `${sameDirVotes}/${cfg.activeStrategies.length} agreed (threshold ${cfg.votingThreshold})`;
            }
          }

          // ============================================================
          // T-279a: maxPositionPct cap. Computes the maximum INR position
          // size the operator's config allows for the current capital, then
          // floor-divides by the last close price to derive a qty ceiling.
          // The fire qty is min(this._config.qty, qtyCap). If qtyCap < 1,
          // the trade is uneconomic at this price and we skip.
          // ============================================================
          let effectiveQty = this._config.qty;
          if (!run.result && cfg && Number.isFinite(cfg.capital) && Number.isFinite(cfg.maxPositionPct)
              && Number.isFinite(lastBar.close) && lastBar.close > 0) {
            const maxNotional = cfg.capital * cfg.maxPositionPct;
            const qtyCap = Math.floor(maxNotional / lastBar.close);
            if (qtyCap < 1) {
              run.result = 'skipped_position_size_too_small';
              run.qtyCap = 0;
              run.maxNotional = Math.round(maxNotional);
              run.lastClose = lastBar.close;
            } else if (effectiveQty > qtyCap) {
              run.qtyCappedFrom = effectiveQty;
              run.qtyCap = qtyCap;
              effectiveQty = qtyCap;
            }
          }

          // ============================================================
          // T-279b: maxOpenPositions cap. Counts current open paper
          // positions; refuses a NEW position (symbol not already owned)
          // if count >= cap. Existing-position management (adding to or
          // closing) is allowed since it doesn't increase concurrent
          // exposure to a new symbol.
          // ============================================================
          if (!run.result && cfg && Number.isInteger(cfg.maxOpenPositions)) {
            try {
              const positions = (typeof this.paper.positions === 'function') ? this.paper.positions() : [];
              const openCount = positions.filter(p => p && p.qty !== 0).length;
              const alreadyOwn = positions.some(p => p && p.symbol === this._config.symbol && p.qty !== 0);
              if (!alreadyOwn && openCount >= cfg.maxOpenPositions) {
                run.result = 'skipped_max_open_positions';
                run.openCount = openCount;
                run.maxOpenPositions = cfg.maxOpenPositions;
              }
            } catch (_e) { /* counting positions is best-effort */ }
          }

          // ============================================================
          // Pass-through path: existing dedupe + placeOrder logic
          // ============================================================
          if (!run.result) {
            // Dedupe by (symbol, strategy, barDate, side)
            const key = `${this._config.symbol}|${this._config.strategy}|${lastBar.date}|${lastSig}`;
            if (key === this._lastFiredKey) {
              run.result = 'deduped';
              run.dedupeKey = key;
            } else {
              // T-502: route paper vs live. Default is paper unless the
              // strategy is in liveEnabledStrategies AND tradingMode != paper
              // AND preTradeCheck is wired -- three locks before live.
              const route = this._pickRoute(this._config.strategy);
              run.route = route;
              // T-508 (Phase 1): compute SL/TP prices from the last bar's close.
              // BUY = entry, gets a BRACKET if SL+TP configured. SELL = exit,
              // always MARKET (existing position's protective orders already in
              // flight from the matching BUY's bracket). Live path keeps MARKET
              // for now -- Zerodha BRACKET is deprecated for equity; live SL
              // requires GTT placement which ships in Phase 4.
              const entryPx = (lastBar && Number.isFinite(lastBar.close)) ? lastBar.close : null;
              const wantsBracket = lastSig === 'BUY'
                && entryPx != null && entryPx > 0
                && Number.isFinite(this._config.stopLossPct) && Number.isFinite(this._config.targetPct);
              const paperPayload = {
                symbol:   this._config.symbol,
                side:     lastSig,
                qty:      effectiveQty,
                type:     wantsBracket ? 'BRACKET' : 'MARKET',
                strategy: this._config.strategy,
                // T-536 step 3: bar close as the synchronous-fill reference price
                // for the per-user paperAdapter (broker LTP still preferred when live).
                refPrice: entryPx,
              };
              if (wantsBracket) {
                paperPayload.price       = entryPx;
                paperPayload.stopLoss    = +(entryPx * (1 - this._config.stopLossPct / 100)).toFixed(2);
                paperPayload.targetPrice = +(entryPx * (1 + this._config.targetPct   / 100)).toFixed(2);
                if (Number.isFinite(this._config.trailingStopPct)) {
                  paperPayload.trailingStopPct = this._config.trailingStopPct;
                }
                run.bracket = { stopLoss: paperPayload.stopLoss, targetPrice: paperPayload.targetPrice, trailingStopPct: paperPayload.trailingStopPct || null };
              }
              const payload = {
                symbol:   this._config.symbol,
                side:     lastSig,
                qty:      effectiveQty,
                type:     'MARKET',
                strategy: this._config.strategy,
              };
              try {
                if (route === 'live') {
                  // T-509 (Phase 3): explicit 2FA policy gate for autorun live.
                  // Today's /api/orders/place enforces 2FA on the first order
                  // per (user, strategy) per IST day via Telegram OOB confirm.
                  // autorun.broker.placeOrder bypasses that gate IMPLICITLY
                  // because autorun doesn't go through the HTTP route.
                  // Make the bypass EXPLICIT: operator must set
                  // ATS_AUTORUN_2FA_BYPASS=true to acknowledge that autorun
                  // is unattended-by-design and 2FA cannot be answered. Default
                  // fail-closed so an unaware operator can't accidentally enable
                  // live autorun without facing this decision.
                  const autorun2faBypass = String(process.env.ATS_AUTORUN_2FA_BYPASS || '').toLowerCase() === 'true';
                  if (!autorun2faBypass) {
                    run.result = 'skipped_2fa_policy';
                    run.message = 'Autorun live route requires ATS_AUTORUN_2FA_BYPASS=true to acknowledge unattended-by-design execution. Set the env var OR keep tradingMode=paper.';
                    this.audit('autorun.live.2faPolicyBlock', { strategy: this._config.strategy, symbol: this._config.symbol });
                    return { result: 'skipped', reason: '2fa_policy_block' };
                  }
                  // Bypass is explicit -- audit every fire so the operator can
                  // see this in the WORM chain.
                  this.audit('autorun.live.2faBypassed', { strategy: this._config.strategy, symbol: this._config.symbol, env: 'ATS_AUTORUN_2FA_BYPASS=true' });
                  // T-508 (Phase 1) WARNING: Zerodha BRACKET is deprecated for
                  // equity. Live SL/TP requires GTT placement (Phase 4). Until
                  // Phase 4 ships, live autorun orders are NAKED MARKET even
                  // when stopLossPct/targetPct are configured. Surface in the
                  // run record so operators don't enable live strategies
                  // without protective stops.
                  if (wantsBracket) {
                    run.live_protection_skipped = {
                      reason: 'GTT_NOT_WIRED_YET',
                      message: 'Live route fired without SL/TP -- Zerodha BRACKET deprecated; GTT placement scheduled for Phase 4 (T-510).',
                      configured_sl: paperPayload.stopLoss,
                      configured_target: paperPayload.targetPrice,
                    };
                    this.audit('autorun.live.protectionSkipped', run.live_protection_skipped);
                  }
                  // Run the 12-gate preTrade stack (kill switch / live trading
                  // flag / mode / leverage / sector / market-hours / etc.)
                  // before touching the broker.
                  const pt = this.preTradeCheck.check({ userId: this.userId, payload });
                  if (!pt.ok) {
                    run.result    = 'skipped_preTrade';
                    run.preTrade  = { reason: pt.reason, message: pt.message };
                    this.audit('autorun.order.preTradeBlocked', { strategy: this._config.strategy, payload, preTrade: pt });
                  } else {
                    // T-LIVE-SHADOW: default-safe dry-run for the live route.
                    // ATS_LIVE_SHADOW defaults ON. Even with LIVE_TRADING +
                    // liveEnabledStrategies + ATS_AUTORUN_2FA_BYPASS all set and
                    // the full preTrade stack passed, the order is LOGGED, NOT
                    // sent to the broker, UNLESS ATS_LIVE_SHADOW is explicitly
                    // 'false'. This is an extra fail-safe on top of the existing
                    // live gates: real exchange submission requires a deliberate
                    // operator opt-out (set ATS_LIVE_SHADOW=false).
                    const liveShadow = String(process.env.ATS_LIVE_SHADOW || 'true').toLowerCase() !== 'false';
                    const liveOrderPayload = Object.assign({}, payload, { orderType: 'MARKET' });
                    if (liveShadow) {
                      run.result   = 'placed_shadow';
                      run.shadow    = true;
                      run.orderId   = 'SHADOW-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
                      run.firedQty  = effectiveQty;
                      run.intended  = liveOrderPayload;
                      this._lastFiredKey = key;
                      this._tradesToday += 1;
                      this.audit('autorun.order.shadow', { orderId: run.orderId, intended: liveOrderPayload, note: 'ATS_LIVE_SHADOW on -- live order LOGGED, NOT sent to broker. Set ATS_LIVE_SHADOW=false to submit real orders.' });
                      if (this.notify && this.notify.notifyOrderPlaced) {
                        this.notify.notifyOrderPlaced(Object.assign({}, liveOrderPayload, { id: run.orderId, live: true, shadow: true })).catch(() => {});
                      }
                    } else {
                      const liveOrder = await this.broker.placeOrder(liveOrderPayload);
                      run.result   = 'placed';
                      run.orderId  = (liveOrder && (liveOrder.order_id || liveOrder.orderId || liveOrder.id)) || null;
                      run.firedQty = effectiveQty;
                      this._lastFiredKey = key;
                      this._tradesToday += 1;
                      this.audit('autorun.order.placed.LIVE', { orderId: run.orderId, ...run });
                      if (this.notify && this.notify.notifyOrderPlaced) {
                        this.notify.notifyOrderPlaced(Object.assign({}, payload, { id: run.orderId, live: true })).catch(() => {});
                      }
                    }
                  }
                } else {
                  // Paper path -- T-536 step 3: writes to per-user db.paper via
                  // paperAdapter (synchronous fill). The adapter may return
                  // status 'cancelled' (no price / insufficient cash / no
                  // position to sell) -- treat that as a skip, not a fire.
                  const order = this.paper.placeOrder(paperPayload);
                  if (order && /cancel|reject/i.test(String(order.status || ''))) {
                    run.result      = 'skipped_paper_' + (order.reason || 'rejected');
                    run.paperReject  = order.reason || 'rejected';
                    run.orderId      = order.id || null;
                    this.audit('autorun.order.paperRejected', { orderId: order.id, reason: run.paperReject, strategy: this._config.strategy, symbol: this._config.symbol });
                  } else {
                    run.result   = 'placed';
                    run.orderId  = order.id;
                    run.firedQty = effectiveQty;
                    this._lastFiredKey = key;
                    this._tradesToday += 1;
                    this.audit('autorun.order.placed', { orderId: order.id, ...run });
                    if (this.notify && this.notify.notifyOrderPlaced) {
                      this.notify.notifyOrderPlaced(order).catch(() => {});
                    }
                  }
                }
              } catch (e) {
                run.result = 'error';
                run.error  = `placeOrder (${route}) failed: ${e.message}`;
              }
            }
          }
        }
      }
    } catch (e) {
      run.result = 'error';
      run.error  = e.message;
      // T-503: outer throws used to be silent (only on the .placed path did
      // notify fire). Now surface via the degraded-counter so a stuck engine
      // is visible in /api/health and Telegram.
      this._gateDegraded('runOnceThrows', e);
    } finally {
      this._inflight = false;
      run.durationMs = Date.now() - t0;
      this._history.push(run);
      if (this._history.length > HISTORY_MAX) this._history = this._history.slice(-HISTORY_MAX);
      this._persist();
    }

    // T-298b: SHADOW MODE options scan. Fire-and-forget; errors logged but
    // never fail the autorun run. Scanner's own env gate (OPTIONS_AUTORUN_ENABLED)
    // determines whether anything is actually persisted -- with it off, scan()
    // short-circuits after a single env check.
    this._runScannerShadow().catch(err => {
      try { this.audit('options_scanner_error', { error: err.message }); } catch {}
    });

    return run;
  }

  async _runScannerShadow() {
    if (!this.getOptionsScanner) return;
    const scanner = this.getOptionsScanner();
    if (!scanner) return;
    if (this.optionsUnderlyings.length === 0) return;
    let holdings = [];
    if (this.getHoldings) {
      try { holdings = await this.getHoldings(); } catch { holdings = []; }
    }
    for (const u of this.optionsUnderlyings) {
      try {
        await scanner.scan({
          underlying: u.underlying,
          expiry: u.expiry,
          holdings,
          userId: this.userId,
          maxRows: u.maxRows || 5,
        });
      } catch (err) {
        // Per-underlying error swallowed; next iteration continues.
      }
    }
  }

  config()  { return this._config; }
  history(limit) {
    const n = Math.max(1, Math.min(HISTORY_MAX, limit || 25));
    return this._history.slice(-n).reverse();
  }
  stats() {
    const enabled = !!(this._config && this._config.enabled);
    const last = this._history.length ? this._history[this._history.length - 1] : null;
    const placedCount = this._history.filter(r => r.result === 'placed').length;
    return {
      enabled,
      configSet:  !!this._config,
      symbol:     this._config && this._config.symbol,
      strategy:   this._config && this._config.strategy,
      historyCount: this._history.length,
      placedCount,
      lastRun:    last && { ts: last.ts, result: last.result, signal: last.signal, source: last.source },
      timerArmed: !!this._timer,
    };
  }

  /** Start the timer if config is loaded + enabled. Call at boot after load(). */
  // T-511 (Phase 2): execute every enabled registered config in series.
  // Context-switches `this._config` + per-config dedupe/counter scalars before
  // delegating to the unchanged runOnce() then restores caller context.
  // Sequential, in registry order; per-config intervals are future work.
  async runOnceAll({ source } = {}) {
    const enabled = Array.from(this._configs.entries()).filter(([_, c]) => c && c.enabled);
    if (!enabled.length) {
      return [await this.runOnce({ source })];
    }
    const results = [];
    for (const [id, cfg] of enabled) {
      const prevConfig        = this._config;
      const prevLastFiredKey  = this._lastFiredKey;
      const prevTradesToday   = this._tradesToday;
      const prevTradeCountDay = this._tradeCountDay;
      this._config        = cfg;
      this._lastFiredKey  = this._lastFiredKeys.get(id) || null;
      this._tradesToday   = this._tradesPerConfig.get(id) || 0;
      this._tradeCountDay = this._tradeDayPerConfig.get(id) || _todayIST();
      let r;
      try { r = await this.runOnce({ source }); }
      catch (e) { r = { result: 'error', error: e.message }; }
      this._lastFiredKeys.set(id, this._lastFiredKey);
      this._tradesPerConfig.set(id, this._tradesToday);
      this._tradeDayPerConfig.set(id, this._tradeCountDay);
      this._config        = prevConfig;
      this._lastFiredKey  = prevLastFiredKey;
      this._tradesToday   = prevTradesToday;
      this._tradeCountDay = prevTradeCountDay;
      if (r) results.push(Object.assign({ configId: id }, r));
    }
    return results;
  }

  start() { this._restartTimer(); }
  stop()  { this._stopTimer(); }
}

module.exports = { AutoRunner };
