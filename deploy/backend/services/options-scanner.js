// T-298a -- Options-strategy scanner (SHADOW MODE).
//
// Composes:
//   regime-detector  -> current market regime
//   option_quotes    -> latest chain snapshot (from DB)
//   holdings-loader  -> normalised user holdings (for covered_call)
//   strategy-selector -> ranked opportunities for the regime
//
// And LOGS the result to option_opportunities. THAT IS ALL.
//
// What this module DOES NOT do:
//   * It does NOT generate signals.
//   * It does NOT submit orders to autorun.
//   * It does NOT call broker.placeOrder() at any layer.
//   * It does NOT touch the 8-gate autorun chain.
//   * It is gated by OPTIONS_AUTORUN_ENABLED -- when unset/false the
//     scan() method short-circuits and writes nothing.
//
// The intent is: let the scanner run silently for days while the operator
// reviews proposed opportunities in the UI. Promotion from a logged
// opportunity to a paper or live order is a separate explicit action --
// outside this module's surface entirely.
//
// Public API:
//   const s = new OptionsScanner({ db, getRegime, log });
//   await s.scan({ underlying, expiry, holdings });

'use strict';

const sel = require('./strategy-selector');

class OptionsScanner {
  /**
   * @param {object} opts
   * @param {object} opts.db                          better-sqlite3 db
   * @param {function} opts.getRegime                 () => { regime, confidence } (or returns from regime-detector)
   * @param {function} [opts.log]
   * @param {function} [opts.now]
   */
  constructor({ db, getRegime, log, now } = {}) {
    if (!db) throw new Error('db required');
    if (typeof getRegime !== 'function') throw new Error('getRegime function required');
    this.db = db;
    this.getRegime = getRegime;
    this.log = log || ((msg) => console.log('[options-scanner]', msg));
    this.now = typeof now === 'function' ? now : (() => new Date());

    this._insertOpp = db.prepare(`
      INSERT INTO option_opportunities (
        user_id, scanned_at, underlying, regime, regime_confidence,
        template, score, raw_score, weight, opportunity_json
      ) VALUES (
        @user_id, datetime('now'), @underlying, @regime, @regime_confidence,
        @template, @score, @raw_score, @weight, @opportunity_json
      )
    `);
  }

  /** Env gate -- the scanner refuses to write rows when this is off. */
  static isEnabled() {
    const v = process.env.OPTIONS_AUTORUN_ENABLED;
    return v === 'true' || v === '1' || v === 'yes';
  }

  /**
   * Run one scan: fetch chain from DB, fetch regime, run selector, log opps.
   * @param {object} args
   * @param {string} args.underlying
   * @param {string} [args.expiry]   defaults to soonest expiry in DB
   * @param {Array}  [args.holdings] normalised user holdings (for covered_call)
   * @param {number} [args.userId]   if set, opps are tagged with this user_id
   * @param {number} [args.maxRows]  cap on rows logged (default 10)
   * @returns {object}  { ok, gated, regime, ranked_count, persisted, errors }
   */
  async scan({ underlying, expiry, holdings, userId, maxRows } = {}) {
    if (!underlying) throw new Error('underlying required');

    if (!OptionsScanner.isEnabled()) {
      this.log(`scan refused: OPTIONS_AUTORUN_ENABLED is not true`);
      return { ok: true, gated: true, persisted: 0 };
    }

    // 1. Pick expiry if not supplied
    let useExpiry = expiry;
    if (!useExpiry) {
      const row = this.db.prepare(
        `SELECT expiry FROM option_quotes WHERE underlying = ? ORDER BY expiry ASC LIMIT 1`
      ).get(underlying);
      if (!row) {
        this.log(`scan ${underlying}: no chain in DB`);
        return { ok: true, gated: false, persisted: 0, errors: ['no_chain_data'] };
      }
      useExpiry = row.expiry;
    }

    // 2. Load chain from DB into the shape the selector expects
    const chainRows = this.db.prepare(`
      SELECT underlying, expiry, strike, type, tradingsymbol AS symbol,
             instrument_token AS instrumentToken, lot_size AS lotSize,
             ltp, iv AS ivUsed, iv_source AS ivSource,
             delta, gamma, vega, theta, theoretical_price AS price, spot
      FROM option_quotes
      WHERE underlying = ? AND expiry = ?
      ORDER BY strike ASC
    `).all(underlying, useExpiry);

    if (chainRows.length === 0) {
      return { ok: true, gated: false, persisted: 0, errors: ['empty_chain'] };
    }

    // Reshape into the selector's expected format (greeks nested object)
    const chain = chainRows.map(r => ({
      symbol: r.symbol,
      type: r.type,
      strike: r.strike,
      expiry: r.expiry,
      lotSize: r.lotSize,
      instrumentToken: r.instrumentToken,
      ltp: r.ltp,
      ivUsed: r.ivUsed,
      ivSource: r.ivSource,
      greeks: {
        delta: r.delta, gamma: r.gamma, vega: r.vega, theta: r.theta,
        price: r.price,
      },
    })).filter(r => r.greeks.delta != null);  // drop rows without Greeks

    if (chain.length === 0) {
      return { ok: true, gated: false, persisted: 0, errors: ['no_greeks_in_chain'] };
    }

    // 3. Get regime
    let regimeOut;
    try {
      regimeOut = await this.getRegime();
    } catch (err) {
      return { ok: false, gated: false, persisted: 0, errors: [`regime_err: ${err.message}`] };
    }
    const regime = regimeOut && regimeOut.regime ? regimeOut.regime : 'unknown';
    const confidence = regimeOut && Number.isFinite(regimeOut.confidence) ? regimeOut.confidence : null;

    // 4. Run selector
    const result = sel.selectStrategies({
      regime,
      chain,
      opts: { asOf: this.now(), holdings: Array.isArray(holdings) ? holdings : [] },
    });

    if (!result.ranked || result.ranked.length === 0) {
      this.log(`scan ${underlying}/${useExpiry} regime=${regime}: no opportunities`);
      return { ok: true, gated: false, persisted: 0, regime, ranked_count: 0 };
    }

    // 5. Log top-K rows to option_opportunities (SHADOW: no orders)
    const cap = Number.isFinite(maxRows) && maxRows > 0 ? maxRows : 10;
    const toLog = result.ranked.slice(0, cap);

    let persisted = 0;
    const errors = [];
    const trx = this.db.transaction((items) => {
      for (const opp of items) {
        try {
          this._insertOpp.run({
            user_id: userId || null,
            underlying,
            regime,
            regime_confidence: confidence,
            template: opp.template,
            score: opp.score,
            raw_score: opp.rawScore,
            weight: opp.weight,
            opportunity_json: JSON.stringify(opp.opportunity),
          });
          persisted++;
        } catch (err) {
          errors.push(`${opp.template}: ${err.message}`);
        }
      }
    });
    trx(toLog);

    this.log(`scan ${underlying}/${useExpiry} regime=${regime}: ${persisted}/${toLog.length} opportunities logged (SHADOW)`);
    return {
      ok: true, gated: false, regime, regime_confidence: confidence,
      ranked_count: result.ranked.length, persisted, errors,
    };
  }
}

// ---- Smoke tests ----

const SMOKE = () => {
  const Database = require('better-sqlite3');
  const fs = require('fs');
  const path = require('path');
  const db = new Database(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf-8'));

  // Pre-populate option_quotes via direct INSERT
  const today = new Date('2026-05-21T10:00:00+05:30');
  const expiry = new Date(today.getTime() + 21 * 24 * 3600 * 1000).toISOString().slice(0, 10);

  // Synthetic full chain with Greeks already computed (mimics fetcher output)
  const oc = require('./option-chain');
  const raw = [];
  for (const k of [22500, 23000, 23500, 23800, 24000, 24200, 24300, 24400, 24500, 24600, 24700, 24800, 25000, 25200, 25500, 26000, 26700, 27000]) {
    raw.push({ name: 'NIFTY', segment: 'NFO-OPT', instrument_type: 'CE',
               tradingsymbol: `NIFTY${k}CE`, instrument_token: 1000000+k,
               strike: k, expiry, lot_size: 75 });
    raw.push({ name: 'NIFTY', segment: 'NFO-OPT', instrument_type: 'PE',
               tradingsymbol: `NIFTY${k}PE`, instrument_token: 2000000+k,
               strike: k, expiry, lot_size: 75 });
  }
  const parsed = oc.parseKiteInstruments(raw, 'NIFTY', { asOf: today });
  const enriched = oc.enrichWithGreeks(parsed, { spot: 24500, riskFreeRate: 0.07, asOf: today, assumedIV: 0.15 });

  const ins = db.prepare(`
    INSERT INTO option_quotes (underlying, expiry, strike, type, tradingsymbol, instrument_token, lot_size, ltp, iv, iv_source, delta, gamma, vega, theta, theoretical_price, spot)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const r of enriched) {
    ins.run('NIFTY', r.expiry, r.strike, r.type, r.symbol, r.instrumentToken, r.lotSize,
            r.greeks.price, r.ivUsed, r.ivSource,
            r.greeks.delta, r.greeks.gamma, r.greeks.vega, r.greeks.theta, r.greeks.price, 24500);
  }

  let pass = 0, fail = 0;
  const check = (lbl, c) => { if (c) { pass++; console.log('  PASS  ' + lbl); } else { fail++; console.log('  FAIL  ' + lbl); } };

  (async () => {
    const scanner = new OptionsScanner({
      db,
      getRegime: async () => ({ regime: 'neutral', confidence: 0.55 }),
      log: () => {},
      now: () => today,
    });

    // Without env gate -> gated:true, no rows
    delete process.env.OPTIONS_AUTORUN_ENABLED;
    const r1 = await scanner.scan({ underlying: 'NIFTY' });
    check('gated when env off', r1.gated === true && r1.persisted === 0);
    check('no rows written when gated', db.prepare('SELECT COUNT(*) AS c FROM option_opportunities').get().c === 0);

    // With env gate -> writes rows for neutral regime -> iron_condor
    process.env.OPTIONS_AUTORUN_ENABLED = 'true';
    const r2 = await scanner.scan({ underlying: 'NIFTY' });
    check('scan succeeds with env on', r2.ok === true && r2.gated === false);
    check('persisted > 0', r2.persisted > 0);
    check('regime = neutral', r2.regime === 'neutral');

    const dbRows = db.prepare('SELECT * FROM option_opportunities ORDER BY id DESC').all();
    check('option_opportunities populated', dbRows.length > 0);
    check('logged row template = iron_condor (neutral playbook)', dbRows[0].template === 'iron_condor');
    check('logged row has user_id NULL (no userId passed)', dbRows[0].user_id === null);
    check('opportunity_json parseable', (() => { try { JSON.parse(dbRows[0].opportunity_json); return true; } catch { return false; } })());

    // Bull regime with holdings -> covered_call should appear
    // FK constraint requires user 42 to exist; insert a test stub.
    db.prepare("INSERT INTO users (id, email, password_hash) VALUES (42, 'smoke-42@test.local', 'x')").run();
    const scannerBull = new OptionsScanner({
      db,
      getRegime: async () => ({ regime: 'bull', confidence: 0.85 }),
      log: () => {},
      now: () => today,
    });
    const r3 = await scannerBull.scan({
      underlying: 'NIFTY',
      holdings: [{ symbol: 'NIFTY', qty: 750, avgPrice: 24000, ltp: 24500 }],
      userId: 42,
    });
    check('bull regime: persisted', r3.persisted > 0);
    const bullRows = db.prepare("SELECT * FROM option_opportunities WHERE regime = 'bull' ORDER BY id DESC").all();
    check('bull rows logged', bullRows.length > 0);
    check('bull rows have user_id=42', bullRows.every(r => r.user_id === 42));
    check('at least one bull row is covered_call', bullRows.some(r => r.template === 'covered_call'));

    // Unknown regime -> nothing logged (selector returns empty)
    const scannerUnk = new OptionsScanner({
      db,
      getRegime: async () => ({ regime: 'unknown', confidence: null }),
      log: () => {},
      now: () => today,
    });
    const r4 = await scannerUnk.scan({ underlying: 'NIFTY' });
    check('unknown regime: 0 persisted', r4.persisted === 0);

    // No chain in DB -> no_chain_data
    const r5 = await scanner.scan({ underlying: 'BANKNIFTY' });
    check('no chain in DB -> error code returned', r5.errors && r5.errors.includes('no_chain_data'));

    delete process.env.OPTIONS_AUTORUN_ENABLED;
    console.log('\nSmoke: ' + pass + ' pass, ' + fail + ' fail.');
    if (fail > 0) process.exit(1);
  })();
};

if (require.main === module && process.argv.includes('--smoke')) {
  SMOKE();
}

module.exports = { OptionsScanner };
