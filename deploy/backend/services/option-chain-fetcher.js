// T-290c -- Option chain fetcher service.
//
// Fetches live option chain data from Kite, enriches with BS Greeks,
// upserts into option_quotes table. Gated by env var
// OPTION_CHAIN_FETCH_ENABLED -- when unset/false the fetcher refuses to
// run, so the cron is a no-op until the operator explicitly turns it on.
//
// Safety:
//   * Read-only against Kite (getOptionChain + getQuotes only -- no order APIs)
//   * Write-only against option_quotes (no other table touched)
//   * No interaction with autorun, signals, or live orders
//   * Rate-limit aware: chunks getQuotes into batches of 100 with 350ms gap
//
// Public API:
//   const f = new OptionChainFetcher({ db, broker, log });
//   await f.refresh({ underlying, expiry, spot, riskFreeRate });
//   f.start({ intervalMs, underlyings });   // start the timer
//   f.stop();                                // halt the timer
//
// Pure-ish: depends on a db handle + broker instance (both injected), no
// global state, no module-level mutation.

'use strict';

const oc = require('./option-chain');

const DEFAULTS = Object.freeze({
  intervalMs: 5 * 60 * 1000,          // 5 minutes
  batchSize: 100,                      // getQuotes batch
  batchGapMs: 350,                     // delay between getQuotes batches
  riskFreeRate: 0.07,
  assumedIV: 0.18,                     // fallback when IV not available
});

class OptionChainFetcher {
  /**
   * @param {object} opts
   * @param {object} opts.db        better-sqlite3 Database instance
   * @param {object} opts.broker    a ZerodhaBroker (must expose getOptionChain + getQuotes + getLastTicks)
   * @param {function} [opts.log]   logger (defaults to console.log)
   * @param {function} [opts.now]   () => Date for testing
   */
  constructor({ db, broker, log, now } = {}) {
    if (!db) throw new Error('db required');
    if (!broker) throw new Error('broker required');
    this.db = db;
    this.broker = broker;
    this.log = log || ((msg) => console.log('[option-chain-fetcher]', msg));
    this.now = typeof now === 'function' ? now : (() => new Date());
    this._timer = null;
    this._running = false;

    // Prepared statements -- compiled once.
    this._upsertStmt = db.prepare(`
      INSERT INTO option_quotes (
        underlying, expiry, strike, type, tradingsymbol, instrument_token,
        lot_size, ltp, iv, iv_source, delta, gamma, vega, theta,
        theoretical_price, oi, volume, spot, snapshot_at
      ) VALUES (
        @underlying, @expiry, @strike, @type, @tradingsymbol, @instrument_token,
        @lot_size, @ltp, @iv, @iv_source, @delta, @gamma, @vega, @theta,
        @theoretical_price, @oi, @volume, @spot, datetime('now')
      )
      ON CONFLICT(underlying, expiry, strike, type) DO UPDATE SET
        ltp = excluded.ltp,
        iv = excluded.iv,
        iv_source = excluded.iv_source,
        delta = excluded.delta,
        gamma = excluded.gamma,
        vega = excluded.vega,
        theta = excluded.theta,
        theoretical_price = excluded.theoretical_price,
        oi = excluded.oi,
        volume = excluded.volume,
        spot = excluded.spot,
        snapshot_at = datetime('now')
    `);
  }

  /** Env gate: is the fetcher allowed to run? */
  static isEnabled() {
    const v = process.env.OPTION_CHAIN_FETCH_ENABLED;
    return v === 'true' || v === '1' || v === 'yes';
  }

  /**
   * Fetch + persist one underlying/expiry pair.
   * Returns { underlying, expiry, count, persisted, errors }.
   */
  async refresh({ underlying, expiry, spot, riskFreeRate, assumedIV } = {}) {
    if (!underlying) throw new Error('underlying required');

    const cfg = {
      riskFreeRate: Number.isFinite(riskFreeRate) ? riskFreeRate : DEFAULTS.riskFreeRate,
      assumedIV: Number.isFinite(assumedIV) ? assumedIV : DEFAULTS.assumedIV,
    };
    const asOf = this.now();

    // 1. Get option chain metadata (strikes + tradingsymbols + tokens)
    let chain;
    try {
      chain = this.broker.getOptionChain(underlying, expiry);
    } catch (err) {
      this.log(`getOptionChain(${underlying}, ${expiry}) failed: ${err.message}`);
      return { underlying, expiry, count: 0, persisted: 0, errors: [err.message] };
    }

    if (!chain || !Array.isArray(chain.strikes) || chain.strikes.length === 0) {
      return { underlying, expiry, count: 0, persisted: 0, errors: ['empty chain'] };
    }

    // 2. Flatten into instrument rows the way option-chain.js expects
    const rows = [];
    for (const strikeRow of chain.strikes) {
      if (strikeRow.ce) {
        rows.push({
          name: underlying, segment: 'NFO-OPT', instrument_type: 'CE',
          tradingsymbol: strikeRow.ce.tradingsymbol,
          instrument_token: strikeRow.ce.t,
          strike: strikeRow.strike, expiry,
          lot_size: strikeRow.ce.lotSize || chain.lotSize || 1,
        });
      }
      if (strikeRow.pe) {
        rows.push({
          name: underlying, segment: 'NFO-OPT', instrument_type: 'PE',
          tradingsymbol: strikeRow.pe.tradingsymbol,
          instrument_token: strikeRow.pe.t,
          strike: strikeRow.strike, expiry,
          lot_size: strikeRow.pe.lotSize || chain.lotSize || 1,
        });
      }
    }

    const parsed = oc.parseKiteInstruments(rows, underlying, { asOf });

    // 3. Fetch LTPs in batches via broker.getQuotes (network -- rate-limited)
    const keys = parsed.map(p => `NFO:${p.symbol}`);
    const ltpBySymbol = new Map();
    const ivBySymbol = new Map();
    const oiBySymbol = new Map();
    const volBySymbol = new Map();

    if (typeof this.broker.getQuotes === 'function') {
      for (let i = 0; i < keys.length; i += DEFAULTS.batchSize) {
        const batch = keys.slice(i, i + DEFAULTS.batchSize);
        let quotes;
        try {
          quotes = await this.broker.getQuotes(batch);
        } catch (err) {
          this.log(`getQuotes batch ${i} failed: ${err.message}`);
          continue;
        }
        for (const [key, q] of Object.entries(quotes || {})) {
          const sym = key.split(':')[1];
          if (q && Number.isFinite(q.last_price)) ltpBySymbol.set(sym, q.last_price);
          if (q && q.iv != null && Number.isFinite(q.iv)) ivBySymbol.set(sym, q.iv);
          if (q && Number.isFinite(q.oi)) oiBySymbol.set(sym, q.oi);
          if (q && q.volume != null && Number.isFinite(q.volume)) volBySymbol.set(sym, q.volume);
        }
        // Rate-limit gap between batches
        if (i + DEFAULTS.batchSize < keys.length) {
          await new Promise(r => setTimeout(r, DEFAULTS.batchGapMs));
        }
      }
    }

    // 4. Stuff LTP / IV back onto parsed rows
    for (const row of parsed) {
      if (ltpBySymbol.has(row.symbol)) row.ltp = ltpBySymbol.get(row.symbol);
      if (ivBySymbol.has(row.symbol))  row.iv  = ivBySymbol.get(row.symbol);
    }

    // 5. Determine spot: caller-provided, else from broker last-ticks, else null.
    let effectiveSpot = Number.isFinite(spot) && spot > 0 ? spot : null;
    if (effectiveSpot == null && typeof this.broker.getLastTicks === 'function') {
      try {
        const ticks = this.broker.getLastTicks();
        const t = ticks.find(t => t.symbol === underlying || t.symbol === `NSE:${underlying}` || t.symbol === 'NIFTY 50');
        if (t && Number.isFinite(t.ltp)) effectiveSpot = t.ltp;
      } catch { /* ignore */ }
    }
    if (effectiveSpot == null) {
      // Without a spot we cannot compute Greeks. Persist quotes-only (no Greeks).
      return this._persistWithoutGreeks(parsed, underlying, asOf);
    }

    // 6. Enrich with Greeks
    const enriched = oc.enrichWithGreeks(parsed, {
      spot: effectiveSpot,
      riskFreeRate: cfg.riskFreeRate,
      asOf, assumedIV: cfg.assumedIV,
    });

    // 7. Upsert
    let persisted = 0;
    const errors = [];
    const trx = this.db.transaction((items) => {
      for (const r of items) {
        try {
          this._upsertStmt.run({
            underlying,
            expiry: r.expiry,
            strike: r.strike,
            type: r.type,
            tradingsymbol: r.symbol,
            instrument_token: r.instrumentToken || null,
            lot_size: r.lotSize || 1,
            ltp: Number.isFinite(r.ltp) ? r.ltp : null,
            iv: r.ivUsed != null ? r.ivUsed : null,
            iv_source: r.ivSource || null,
            delta: r.greeks && Number.isFinite(r.greeks.delta) ? r.greeks.delta : null,
            gamma: r.greeks && Number.isFinite(r.greeks.gamma) ? r.greeks.gamma : null,
            vega:  r.greeks && Number.isFinite(r.greeks.vega)  ? r.greeks.vega  : null,
            theta: r.greeks && Number.isFinite(r.greeks.theta) ? r.greeks.theta : null,
            theoretical_price: r.greeks && Number.isFinite(r.greeks.price) ? r.greeks.price : null,
            oi: oiBySymbol.has(r.symbol) ? oiBySymbol.get(r.symbol) : null,
            volume: volBySymbol.has(r.symbol) ? volBySymbol.get(r.symbol) : null,
            spot: effectiveSpot,
          });
          persisted++;
        } catch (err) {
          errors.push(`${r.symbol}: ${err.message}`);
        }
      }
    });
    trx(enriched);

    this.log(`refresh ${underlying}/${expiry}: ${persisted}/${enriched.length} persisted, ${errors.length} errors`);
    return { underlying, expiry, count: enriched.length, persisted, errors };
  }

  _persistWithoutGreeks(parsed, underlying, asOf) {
    let persisted = 0;
    const errors = [];
    const trx = this.db.transaction((items) => {
      for (const r of items) {
        try {
          this._upsertStmt.run({
            underlying,
            expiry: r.expiry,
            strike: r.strike,
            type: r.type,
            tradingsymbol: r.symbol,
            instrument_token: r.instrumentToken || null,
            lot_size: r.lotSize || 1,
            ltp: Number.isFinite(r.ltp) ? r.ltp : null,
            iv: null,
            iv_source: null,
            delta: null, gamma: null, vega: null, theta: null,
            theoretical_price: null,
            oi: null, volume: null,
            spot: null,
          });
          persisted++;
        } catch (err) {
          errors.push(`${r.symbol}: ${err.message}`);
        }
      }
    });
    trx(parsed);
    return { underlying, expiry: parsed[0] && parsed[0].expiry, count: parsed.length, persisted, errors, note: 'no spot -> greeks skipped' };
  }

  /**
   * Start a periodic refresh timer. Refuses if the env gate isn't set.
   * @param {object} opts
   * @param {Array<{underlying:string, expiry:string, spot?:number}>} opts.underlyings
   * @param {number} [opts.intervalMs]
   */
  start({ underlyings, intervalMs } = {}) {
    if (!OptionChainFetcher.isEnabled()) {
      this.log('start refused: OPTION_CHAIN_FETCH_ENABLED is not true');
      return false;
    }
    if (!Array.isArray(underlyings) || underlyings.length === 0) {
      this.log('start refused: no underlyings');
      return false;
    }
    if (this._timer) {
      this.log('already running');
      return false;
    }
    const period = Number.isFinite(intervalMs) && intervalMs > 1000 ? intervalMs : DEFAULTS.intervalMs;
    this._underlyings = underlyings.slice();
    this._timer = setInterval(() => this._tick().catch(err => this.log(`tick failed: ${err.message}`)), period);
    this.log(`started: ${underlyings.length} underlyings @ ${period}ms`);
    // Kick off an immediate first refresh
    this._tick().catch(err => this.log(`initial tick failed: ${err.message}`));
    return true;
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
      this.log('stopped');
    }
  }

  async _tick() {
    if (this._running) return;       // skip if previous tick still running
    this._running = true;
    try {
      for (const u of this._underlyings) {
        await this.refresh(u);
      }
    } finally {
      this._running = false;
    }
  }
}

// ---- Smoke tests (run-once) ----

const SMOKE = () => {
  const Database = require('better-sqlite3');
  const fs = require('fs');
  const path = require('path');
  const db = new Database(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf-8'));

  // Mock broker -- canned getOptionChain + getQuotes
  const today = new Date('2026-05-21T10:00:00+05:30');
  const expiryDt = new Date(today.getTime() + 21 * 24 * 3600 * 1000);
  const expiryStr = expiryDt.toISOString().slice(0, 10);
  const strikes = [];
  for (const k of [24000, 24200, 24400, 24500, 24600, 24800, 25000]) {
    strikes.push({
      strike: k,
      ce: { tradingsymbol: `NIFTY${k}CE`, t: 1000000 + k, lotSize: 75 },
      pe: { tradingsymbol: `NIFTY${k}PE`, t: 2000000 + k, lotSize: 75 },
    });
  }
  const mockBroker = {
    getOptionChain: (underlying, expiry) => ({ underlying, expiry, strikes, count: strikes.length, lotSize: 75 }),
    getQuotes: async (keys) => {
      const out = {};
      for (const k of keys) {
        out[k] = { last_price: 50 + Math.random() * 200, oi: 12345, volume: 6789 };
      }
      return out;
    },
    getLastTicks: () => [{ symbol: 'NIFTY 50', ltp: 24500, ts: Date.now() }],
  };

  let pass = 0, fail = 0;
  const check = (label, cond) => {
    if (cond) { pass++; console.log(`  PASS  ${label}`); }
    else      { fail++; console.log(`  FAIL  ${label}`); }
  };

  (async () => {
    const f = new OptionChainFetcher({ db, broker: mockBroker, log: () => {}, now: () => today });

    // Without env gate, isEnabled() is false
    check('isEnabled false by default', OptionChainFetcher.isEnabled() === false);

    // Refresh works regardless of gate (the gate only affects start())
    const r = await f.refresh({ underlying: 'NIFTY', expiry: expiryStr, spot: 24500 });
    check('refresh returns count + persisted', Number.isFinite(r.persisted) && r.persisted > 0);
    check('refresh persisted = chain rows (CE+PE)', r.persisted === strikes.length * 2);

    // DB now has rows
    const dbCount = db.prepare('SELECT COUNT(*) AS c FROM option_quotes').get().c;
    check('option_quotes rows persisted', dbCount === strikes.length * 2);

    // A persisted row has Greeks
    const sample = db.prepare("SELECT * FROM option_quotes WHERE strike = 24500 AND type = 'call'").get();
    check('sample call row has finite delta', sample && Number.isFinite(sample.delta));
    check('sample call has spot=24500', sample && sample.spot === 24500);
    check('sample call ltp present', sample && Number.isFinite(sample.ltp));
    check('sample call iv_source set', sample && sample.iv_source);

    // Re-running refresh should UPSERT (count stays equal)
    await f.refresh({ underlying: 'NIFTY', expiry: expiryStr, spot: 24500 });
    const dbCount2 = db.prepare('SELECT COUNT(*) AS c FROM option_quotes').get().c;
    check('UPSERT: count unchanged after re-refresh', dbCount2 === dbCount);

    // start() with no env var should refuse
    const startedNoEnv = f.start({ underlyings: [{ underlying: 'NIFTY', expiry: expiryStr, spot: 24500 }] });
    check('start refused without env gate', startedNoEnv === false);

    // Empty chain -> no error, returns count 0
    const emptyBroker = { getOptionChain: () => ({ underlying: 'X', expiry: 'X', strikes: [], count: 0, lotSize: 0 }) };
    const f2 = new OptionChainFetcher({ db, broker: emptyBroker, log: () => {}, now: () => today });
    const er = await f2.refresh({ underlying: 'X', expiry: '2099-01-01', spot: 100 });
    check('empty chain handled', er.persisted === 0);

    console.log(`\nSmoke: ${pass} pass, ${fail} fail.`);
    if (fail > 0) process.exit(1);
  })();
};

if (require.main === module && process.argv.includes('--smoke')) {
  SMOKE();
}

module.exports = { OptionChainFetcher, DEFAULTS };
