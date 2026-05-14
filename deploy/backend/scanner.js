// scanner.js — daily momentum scanner.
//
// For each symbol in the watchlist, fetches 60 days of daily candles from the
// broker, computes RSI(14) + 20-EMA cross, and fires Telegram on new signals.
// Dedupes by (symbol, signalType) per UTC day so the user isn't spammed if a
// signal is true for multiple consecutive days.
//
// Trigger paths:
//   - daily cron at ~15:35 IST (10:05 UTC, +/- 60s jitter) Mon–Fri
//   - manual POST /api/scanner/run
//
// Persistence: /var/lib/ats/tokens/_scanner.json (debounce state + history).
// Signal history is kept to last 100 entries.

const fs = require('fs');
const path = require('path');

const DEFAULT_STORE = '/var/lib/ats/tokens/_scanner.json';
const HISTORY_MAX = 100;
const FETCH_DAYS = 60;          // 60 calendar-days → ~40 trading-day candles
const SYMBOL_DELAY_MS = 250;    // gentle pacing between Kite historical calls
const RSI_PERIOD = 14;
const EMA_PERIOD = 20;

// ---------- Technical indicators ----------

/** Wilder-smoothed RSI. Returns NaN until at least period+1 candles. */
function rsi(closes, period = RSI_PERIOD) {
  if (!Array.isArray(closes) || closes.length <= period) return NaN;
  let avgGain = 0, avgLoss = 0;
  // Seed
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) avgGain += d; else avgLoss -= d;
  }
  avgGain /= period;
  avgLoss /= period;
  // Smooth
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** Returns array of EMA values aligned to `closes`. NaN until index = period-1. */
function ema(closes, period = EMA_PERIOD) {
  const k = 2 / (period + 1);
  const out = new Array(closes.length).fill(NaN);
  if (closes.length < period) return out;
  // seed = SMA of first `period`
  let seed = 0;
  for (let i = 0; i < period; i++) seed += closes[i];
  seed /= period;
  out[period - 1] = seed;
  for (let i = period; i < closes.length; i++) {
    out[i] = closes[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

// ---------- Scanner ----------

class Scanner {
  /**
   * @param {object} opts
   * @param {object} opts.broker
   * @param {object} opts.watchlist
   * @param {(level:string,title:string,details:object)=>Promise<any>} opts.notify
   * @param {(event:string,data:object)=>void} [opts.audit]
   * @param {string} [opts.storePath]
   */
  constructor({ broker, watchlist, notify, audit, storePath }) {
    this.broker = broker;
    this.watchlist = watchlist;
    this.notify = notify || (() => Promise.resolve());
    this.audit = audit || (() => {});
    this.storePath = storePath || DEFAULT_STORE;
    /** Map<"SYMBOL|SIGNAL", { date:'YYYY-MM-DD', value:number }> */
    this._fired = new Map();
    /** Array of { ts, symbol, signal, value, message } — most-recent-first. */
    this._history = [];
    this._lastRun = null;
    this._inflight = false;
    this._cronTimer = null;
  }

  load() {
    try {
      if (!fs.existsSync(this.storePath)) return;
      const raw = JSON.parse(fs.readFileSync(this.storePath, 'utf8'));
      if (raw && typeof raw === 'object') {
        this._fired = new Map(Object.entries(raw.fired || {}));
        this._history = Array.isArray(raw.history) ? raw.history.slice(0, HISTORY_MAX) : [];
        this._lastRun = raw.lastRun || null;
        console.log(`[scanner] loaded ${this._fired.size} debounce keys, ${this._history.length} history`);
      }
    } catch (e) {
      console.warn('[scanner] load failed:', e.message);
    }
  }

  _persist() {
    try {
      fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
      fs.writeFileSync(this.storePath, JSON.stringify({
        fired: Object.fromEntries(this._fired),
        history: this._history.slice(0, HISTORY_MAX),
        lastRun: this._lastRun,
      }, null, 2));
    } catch (e) {
      console.error('[scanner] persist failed:', e.message);
    }
  }

  stats() {
    return {
      lastRun: this._lastRun,
      historyCount: this._history.length,
      debounceKeys: this._fired.size,
      inflight: this._inflight,
    };
  }

  history(limit) {
    return this._history.slice(0, Math.max(1, Math.min(HISTORY_MAX, limit || 25)));
  }

  /** Skip indices and derivatives — focus on equity symbols only. */
  _isScannable(sym) {
    if (typeof sym !== 'string') return false;
    if (sym.startsWith('TOKEN:')) return false;
    // Skip indices (no fundamental concept of RSI on a synthetic index level)
    const SKIP = /^(NIFTY|BANKNIFTY|SENSEX|FINNIFTY|MIDCPNIFTY|INDIA VIX)/i;
    if (SKIP.test(sym)) return false;
    // Skip derivatives (option strikes, futures)
    if (/(CE|PE|FUT)$/.test(sym)) return false;
    if (/\d{6,}/.test(sym)) return false;
    return true;
  }

  _todayUTC() {
    return new Date().toISOString().slice(0, 10);
  }

  /** Evaluate one symbol; returns array of signals fired (after dedupe). */
  async _scanOne(symbol) {
    const to = new Date();
    const from = new Date(to.getTime() - FETCH_DAYS * 86400 * 1000);
    const fromStr = from.toISOString().slice(0, 10);
    const toStr   = to.toISOString().slice(0, 10);

    let candles;
    try {
      candles = await this.broker.getHistorical({ symbol, interval: 'day', from: fromStr, to: toStr });
    } catch (e) {
      return [{ symbol, signal: 'ERROR', value: 0, message: `fetch failed: ${e.message}` }];
    }
    if (!Array.isArray(candles) || candles.length < EMA_PERIOD + 2) {
      return [{ symbol, signal: 'INSUFFICIENT_DATA', value: candles ? candles.length : 0, message: `only ${candles ? candles.length : 0} candles` }];
    }

    const closes = candles.map(c => c.close);
    const last = closes[closes.length - 1];
    const prevClose = closes[closes.length - 2];
    const r = rsi(closes);
    const e = ema(closes);
    const eNow = e[e.length - 1];
    const ePrev = e[e.length - 2];

    const out = [];
    const today = this._todayUTC();

    // RSI signals
    if (Number.isFinite(r)) {
      if (r < 30) out.push({ symbol, signal: 'RSI_OVERSOLD',   value: +r.toFixed(2), message: `RSI(14)=${r.toFixed(1)} — oversold (close ₹${last})` });
      else if (r > 70) out.push({ symbol, signal: 'RSI_OVERBOUGHT', value: +r.toFixed(2), message: `RSI(14)=${r.toFixed(1)} — overbought (close ₹${last})` });
    }

    // 20-EMA cross
    if (Number.isFinite(eNow) && Number.isFinite(ePrev)) {
      if (last > eNow && prevClose <= ePrev) {
        out.push({ symbol, signal: 'EMA20_CROSS_UP',   value: +eNow.toFixed(2), message: `crossed above 20-EMA (close ₹${last} > EMA ${eNow.toFixed(2)})` });
      }
      if (last < eNow && prevClose >= ePrev) {
        out.push({ symbol, signal: 'EMA20_CROSS_DOWN', value: +eNow.toFixed(2), message: `crossed below 20-EMA (close ₹${last} < EMA ${eNow.toFixed(2)})` });
      }
    }

    // Dedupe: drop signals already fired for this (symbol, signal) on this UTC day.
    const novel = [];
    for (const sig of out) {
      if (sig.signal.startsWith('RSI_') || sig.signal.startsWith('EMA20_')) {
        const key = `${sig.symbol}|${sig.signal}`;
        const prev = this._fired.get(key);
        if (prev && prev.date === today) continue;
        this._fired.set(key, { date: today, value: sig.value });
      }
      novel.push(sig);
    }
    return novel;
  }

  /** One full pass over the watchlist. Sequential with delay so we respect Kite rate limits. */
  async runOnce({ limit, manual } = {}) {
    if (this._inflight) return { ok: false, reason: 'already_running' };
    this._inflight = true;

    const startedAt = Date.now();
    const symbols = (this.watchlist ? this.watchlist.list() : [])
      .filter(s => this._isScannable(s));
    const subset = Number.isFinite(limit) ? symbols.slice(0, limit) : symbols;

    let scanned = 0;
    let fired = 0;
    const results = [];

    for (const sym of subset) {
      const sigs = await this._scanOne(sym);
      scanned++;
      for (const s of sigs) {
        results.push({ ...s, ts: new Date().toISOString() });
        // Only "real" signals fire notify (skip ERROR/INSUFFICIENT_DATA).
        if (s.signal.startsWith('RSI_') || s.signal.startsWith('EMA20_')) {
          fired++;
          this._history.unshift({ ts: new Date().toISOString(), ...s });
          if (this._history.length > HISTORY_MAX) this._history.length = HISTORY_MAX;
          const arrow =
            s.signal === 'RSI_OVERSOLD'    ? '↘ buy zone' :
            s.signal === 'RSI_OVERBOUGHT'  ? '↗ sell zone' :
            s.signal === 'EMA20_CROSS_UP'  ? '↗ trend up' :
            s.signal === 'EMA20_CROSS_DOWN' ? '↘ trend down' : '•';
          this.notify('info', `${arrow} ${s.symbol}`, {
            body: s.message,
            fields: { signal: s.signal, value: s.value, scanRunMode: manual ? 'manual' : 'scheduled' },
          }).catch(() => {});
          this.audit('scanner.signal', { symbol: s.symbol, signal: s.signal, value: s.value });
        }
      }
      // Polite pacing.
      if (subset.length > 1) await new Promise(r => setTimeout(r, SYMBOL_DELAY_MS));
    }

    this._lastRun = {
      at: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      scanned,
      fired,
      manual: !!manual,
    };
    this._persist();
    this._inflight = false;
    return { ok: true, scanned, fired, durationMs: this._lastRun.durationMs, results };
  }

  /** Schedule the daily run at 15:35 IST (10:05 UTC). Mon–Fri only. */
  scheduleDaily() {
    const arm = () => {
      const now = new Date();
      // target = 10:05 UTC today; if past, tomorrow
      const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 10, 5, 0));
      if (target.getTime() <= now.getTime()) target.setUTCDate(target.getUTCDate() + 1);
      // skip Sat/Sun
      const day = target.getUTCDay(); // 0=Sun, 6=Sat
      if (day === 6) target.setUTCDate(target.getUTCDate() + 2);
      else if (day === 0) target.setUTCDate(target.getUTCDate() + 1);
      const ms = target.getTime() - now.getTime() + Math.floor(Math.random() * 60000); // +0-60s jitter
      console.log(`[scanner] next scheduled run: ${new Date(now.getTime() + ms).toISOString()}`);
      this._cronTimer = setTimeout(async () => {
        try {
          const r = await this.runOnce({ manual: false });
          console.log(`[scanner] scheduled run: scanned=${r.scanned} fired=${r.fired}`);
        } catch (e) {
          console.error('[scanner] scheduled run failed:', e.message);
        }
        arm();
      }, ms);
      this._cronTimer.unref();
    };
    arm();
  }
}

// ---------- More indicators (used by backtest module too) ----------

/** Simple moving average aligned to closes. NaN until index = period-1. */
function sma(closes, period) {
  const out = new Array(closes.length).fill(NaN);
  if (closes.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += closes[i];
  out[period - 1] = sum / period;
  for (let i = period; i < closes.length; i++) {
    sum += closes[i] - closes[i - period];
    out[i] = sum / period;
  }
  return out;
}

/** Population standard deviation over a rolling window. */
function stddev(closes, period) {
  const out = new Array(closes.length).fill(NaN);
  if (closes.length < period) return out;
  for (let i = period - 1; i < closes.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += closes[j];
    const mean = sum / period;
    let varSum = 0;
    for (let j = i - period + 1; j <= i; j++) varSum += (closes[j] - mean) ** 2;
    out[i] = Math.sqrt(varSum / period);
  }
  return out;
}

/**
 * MACD(fast, slow, signal). Returns {line, sig, hist} aligned to closes.
 * line = EMA(fast) - EMA(slow)
 * sig  = EMA of line (with `signal` period)
 * hist = line - sig
 */
function macd(closes, fast = 12, slow = 26, signal = 9) {
  const fastE = ema(closes, fast);
  const slowE = ema(closes, slow);
  const line = new Array(closes.length).fill(NaN);
  for (let i = 0; i < closes.length; i++) {
    if (Number.isFinite(fastE[i]) && Number.isFinite(slowE[i])) {
      line[i] = fastE[i] - slowE[i];
    }
  }
  const firstValid = line.findIndex(x => Number.isFinite(x));
  const sig = new Array(closes.length).fill(NaN);
  const hist = new Array(closes.length).fill(NaN);
  if (firstValid >= 0) {
    const macdValid = line.slice(firstValid);
    const sigOfValid = ema(macdValid, signal);
    for (let i = 0; i < sigOfValid.length; i++) {
      if (Number.isFinite(sigOfValid[i])) {
        sig[firstValid + i] = sigOfValid[i];
        hist[firstValid + i] = line[firstValid + i] - sigOfValid[i];
      }
    }
  }
  return { line, sig, hist };
}

/**
 * Bollinger Bands(period, k). Returns {middle, upper, lower} aligned to closes.
 * middle = SMA(period); upper = middle + k*stddev; lower = middle - k*stddev.
 */
function bollinger(closes, period = 20, k = 2) {
  const middle = sma(closes, period);
  const stdev  = stddev(closes, period);
  const upper = new Array(closes.length).fill(NaN);
  const lower = new Array(closes.length).fill(NaN);
  for (let i = 0; i < closes.length; i++) {
    if (Number.isFinite(middle[i]) && Number.isFinite(stdev[i])) {
      upper[i] = middle[i] + k * stdev[i];
      lower[i] = middle[i] - k * stdev[i];
    }
  }
  return { middle, upper, lower };
}

module.exports = { Scanner, rsi, ema, sma, stddev, macd, bollinger };
