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

const DEFAULT_STORE  = '/var/lib/ats/tokens/_autorun.json';
const HISTORY_MAX    = 100;
const MIN_INTERVAL_MS = 60 * 1000;       // never go below 1 minute
const DEFAULT_INTERVAL_MIN = 5;
const DEFAULT_LOOKBACK_DAYS = 60;

class AutoRunner {
  /**
   * @param {object} opts
   * @param {object} opts.broker            broker with getHistorical()
   * @param {object} opts.paper             paper trading instance
   * @param {Function} opts.computeSignal   ({candles, strategy, params}) => signal[]
   * @param {(event, data) => void} [opts.audit]
   * @param {string} [opts.storePath]
   */
  constructor({ broker, paper, computeSignal, audit, storePath }) {
    if (!broker)        throw new Error('broker required');
    if (!paper)         throw new Error('paper required');
    if (!computeSignal) throw new Error('computeSignal required');
    this.broker         = broker;
    this.paper          = paper;
    this.computeSignal  = computeSignal;
    this.audit          = audit || (() => {});
    this.storePath      = storePath || DEFAULT_STORE;
    this._config        = null;
    this._history       = [];
    this._timer         = null;
    this._inflight      = false;
    this._lastFiredKey  = null;   // dedupe: "SYMBOL|STRATEGY|BARDATE|SIDE"
  }

  load() {
    try {
      if (!fs.existsSync(this.storePath)) return;
      const raw = JSON.parse(fs.readFileSync(this.storePath, 'utf8'));
      if (raw && typeof raw === 'object') {
        this._config       = raw.config || null;
        this._history      = Array.isArray(raw.history) ? raw.history.slice(-HISTORY_MAX) : [];
        this._lastFiredKey = raw.lastFiredKey || null;
        console.log(`[autorun] loaded: enabled=${!!(this._config && this._config.enabled)}, history=${this._history.length}`);
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
        updatedAt: new Date().toISOString(),
      }, null, 2));
    } catch (e) { console.error('[autorun] persist failed:', e.message); }
  }

  /** Validate + replace config. Restarts the timer if enabled changes. */
  setConfig(cfg) {
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
    };
    if (!out.strategy) throw new Error('strategy required');
    if (!out.symbol)   throw new Error('symbol required');
    const valid = ['rsi_mean_revert','ema_cross','macd_cross','bollinger'];
    if (!valid.includes(out.strategy)) throw new Error(`strategy must be one of: ${valid.join(', ')}`);

    this._config = out;
    this._persist();
    this._restartTimer();
    this.audit('autorun.config.set', { ...out, params: out.params });
    return out;
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
    if (!this._config || !this._config.enabled) return;
    const ms = Math.max(MIN_INTERVAL_MS, this._config.intervalMinutes * 60 * 1000);
    this._timer = setInterval(() => {
      this.runOnce({ source: 'timer' })
        .then((r) => this.audit('autorun.tick', { result: r.result, signal: r.signal, symbol: r.symbol }))
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
          // Dedupe by (symbol, strategy, barDate, side)
          const key = `${this._config.symbol}|${this._config.strategy}|${lastBar.date}|${lastSig}`;
          if (key === this._lastFiredKey) {
            run.result = 'deduped';
            run.dedupeKey = key;
          } else {
            // Fire paper order
            try {
              const order = this.paper.placeOrder({
                symbol:   this._config.symbol,
                side:     lastSig,
                qty:      this._config.qty,
                type:     'MARKET',
                strategy: this._config.strategy,
              });
              run.result   = 'placed';
              run.orderId  = order.id;
              this._lastFiredKey = key;
              this.audit('autorun.order.placed', { orderId: order.id, ...run });
            } catch (e) {
              run.result = 'error';
              run.error  = `placeOrder failed: ${e.message}`;
            }
          }
        }
      }
    } catch (e) {
      run.result = 'error';
      run.error  = e.message;
    } finally {
      this._inflight = false;
      run.durationMs = Date.now() - t0;
      this._history.push(run);
      if (this._history.length > HISTORY_MAX) this._history = this._history.slice(-HISTORY_MAX);
      this._persist();
    }
    return run;
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
  start() { this._restartTimer(); }
  stop()  { this._stopTimer(); }
}

module.exports = { AutoRunner };
