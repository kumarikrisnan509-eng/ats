// alerts.js — price alerts engine.
//
// Persistent JSON-file store of alerts; backend evaluates every live tick from
// the broker against active alerts and fires notify() to Telegram + audit log
// when a threshold is crossed.
//
// Storage path defaults to /var/lib/ats/tokens/_alerts.json — sits inside the
// bind-mounted tokens dir (writable from container); underscore prefix keeps
// sessions.js from treating it as a user-token file.
//
// Performance: evaluate() runs on every tick (potentially 50+/sec). It must do
// zero I/O. The persistent file is only rewritten when alerts mutate (add /
// delete / trigger). Triggered alerts default to one-shot; pass repeat:true to
// re-fire each time the threshold is recrossed.
//
// Public API:
//   const a = new Alerts({ storePath, notify, audit });
//   a.load();                                  // sync, on boot
//   a.list()                                   // returns array
//   a.add({ symbol, condition, threshold, message?, repeat? })
//   a.remove(id)
//   a.reset(id)                                // clears triggeredAt so it can fire again
//   a.evaluate(tick)                           // sync, hot-path; tick = {symbol, ltp, ts}
//   a.stats()                                  // for /api/health introspection

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const VALID_CONDITIONS = new Set(['above', 'below']);
const DEFAULT_STORE = '/var/lib/ats/tokens/_alerts.json';

class Alerts {
  /**
   * @param {object} opts
   * @param {string} [opts.storePath]
   * @param {(level:string,title:string,details:object)=>Promise<any>} opts.notify
   * @param {(event:string,data:object)=>void} [opts.audit]
   */
  constructor({ storePath, notify, audit }) {
    this.storePath = storePath || DEFAULT_STORE;
    this.notify = notify || (() => Promise.resolve());
    this.audit = audit || (() => {});
    /** @type {Array<object>} */
    this._alerts = [];
    /** @type {Map<string, Array<object>>}  symbol -> [alert] for O(1) lookup */
    this._bySymbol = new Map();
    this._loadedAt = 0;
    this._evals = 0;
    this._fires = 0;
  }

  load() {
    try {
      if (!fs.existsSync(this.storePath)) return;
      const raw = JSON.parse(fs.readFileSync(this.storePath, 'utf8'));
      if (Array.isArray(raw && raw.alerts)) {
        this._alerts = raw.alerts.filter(a => this._valid(a));
        this._rebuildIndex();
        this._loadedAt = Date.now();
        console.log(`[alerts] loaded ${this._alerts.length} from ${this.storePath}`);
      }
    } catch (e) {
      console.warn('[alerts] load failed:', e.message);
    }
  }

  _persist() {
    try {
      fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
      fs.writeFileSync(this.storePath, JSON.stringify({ alerts: this._alerts }, null, 2));
    } catch (e) {
      console.error('[alerts] persist failed:', e.message);
    }
  }

  _valid(a) {
    return a
      && typeof a.id === 'string'
      && typeof a.symbol === 'string'
      && VALID_CONDITIONS.has(a.condition)
      && Number.isFinite(a.threshold);
  }

  _rebuildIndex() {
    this._bySymbol.clear();
    for (const a of this._alerts) {
      if (!this._bySymbol.has(a.symbol)) this._bySymbol.set(a.symbol, []);
      this._bySymbol.get(a.symbol).push(a);
    }
  }

  list() {
    return this._alerts.map(a => ({ ...a }));
  }

  add({ symbol, condition, threshold, message, repeat }) {
    if (typeof symbol !== 'string' || !symbol.trim()) throw new Error('symbol required');
    if (!VALID_CONDITIONS.has(condition)) throw new Error('condition must be above|below');
    const th = Number(threshold);
    if (!Number.isFinite(th)) throw new Error('threshold must be numeric');

    const alert = {
      id: crypto.randomUUID(),
      symbol: symbol.trim(),
      condition,
      threshold: th,
      message: typeof message === 'string' && message.trim() ? message.trim() : null,
      repeat: !!repeat,
      createdAt: new Date().toISOString(),
      triggeredAt: null,
      triggerCount: 0,
      lastSeenLtp: null,
      lastSeenAt: null,
    };
    this._alerts.push(alert);
    this._rebuildIndex();
    this._persist();
    this.audit('alert.add', { id: alert.id, symbol: alert.symbol, condition, threshold: th });
    return alert;
  }

  remove(id) {
    const before = this._alerts.length;
    this._alerts = this._alerts.filter(a => a.id !== id);
    if (this._alerts.length === before) return false;
    this._rebuildIndex();
    this._persist();
    this.audit('alert.remove', { id });
    return true;
  }

  reset(id) {
    const a = this._alerts.find(x => x.id === id);
    if (!a) return false;
    a.triggeredAt = null;
    this._persist();
    this.audit('alert.reset', { id });
    return true;
  }

  /**
   * Hot path — called on every tick. Must be cheap; no I/O.
   * @param {{symbol:string, ltp:number, ts?:number}} tick
   */
  evaluate(tick) {
    this._evals++;
    if (!tick || typeof tick.symbol !== 'string' || typeof tick.ltp !== 'number') return;
    const matches = this._bySymbol.get(tick.symbol);
    if (!matches || matches.length === 0) return;

    let mutated = false;
    for (const a of matches) {
      a.lastSeenLtp = tick.ltp;
      a.lastSeenAt = tick.ts || Date.now();
      mutated = true;

      // Skip if already triggered and not in repeat mode.
      if (a.triggeredAt && !a.repeat) continue;

      const hit =
        (a.condition === 'above' && tick.ltp >= a.threshold) ||
        (a.condition === 'below' && tick.ltp <= a.threshold);

      if (hit) {
        // Repeat mode: only re-fire after price has crossed back.
        if (a.repeat && a.triggeredAt) {
          const stillHit =
            (a.condition === 'above' && tick.ltp >= a.threshold) ||
            (a.condition === 'below' && tick.ltp <= a.threshold);
          // Only fire on a re-trigger if we have evidence price had moved away.
          if (a._lastUncrossedLtp == null || !stillHit) continue;
        }
        a.triggeredAt = new Date().toISOString();
        a.triggerCount = (a.triggerCount || 0) + 1;
        a._lastUncrossedLtp = null;
        this._fires++;
        this._fire(a, tick);
      } else if (a.repeat) {
        // Remember that we've seen an uncrossed price so the next cross can re-fire.
        a._lastUncrossedLtp = tick.ltp;
      }
    }

    // Persist throttled — we don't want to write on every single tick.
    if (mutated) this._schedulePersist();
  }

  _schedulePersist() {
    if (this._persistTimer) return;
    this._persistTimer = setTimeout(() => {
      this._persistTimer = null;
      this._persist();
    }, 5000).unref();
  }

  _fire(a, tick) {
    const arrow = a.condition === 'above' ? '↗' : '↘';
    const title = `${arrow} ${a.symbol} ${a.condition} ${a.threshold}`;
    const body  = a.message || `${a.symbol} crossed ${a.threshold} (now ${tick.ltp})`;
    const fields = {
      symbol: a.symbol,
      condition: a.condition,
      threshold: a.threshold,
      ltp: tick.ltp,
      triggers: a.triggerCount,
    };
    this.notify('warn', title, { body, fields }).catch(e => console.warn('[alerts] promise rejected:', e && e.message));
    this.audit('alert.fire', { id: a.id, symbol: a.symbol, condition: a.condition, threshold: a.threshold, ltp: tick.ltp });
  }

  stats() {
    return {
      total: this._alerts.length,
      active: this._alerts.filter(a => !a.triggeredAt || a.repeat).length,
      triggered: this._alerts.filter(a => a.triggeredAt).length,
      symbols: this._bySymbol.size,
      evals: this._evals,
      fires: this._fires,
      loadedAt: this._loadedAt,
    };
  }
}

module.exports = { Alerts };
