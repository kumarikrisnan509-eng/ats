// T-283 -- Daily performance attribution (Phase 3, vision doc §6.4).
//
// Writes a once-a-day snapshot of: total realised PnL, breakdown by
// strategy + symbol + sector + gate-skip-reason, autorun execution
// counts, regime label at snapshot time. The operator opens the file
// (or the upcoming UI screen) tomorrow morning to see "what did I
// actually do today and why".
//
// Storage: append-only JSONL at /var/lib/ats/tokens/_attribution.jsonl
// (one line per day). Cap at ~365 days; older lines pruned at write.
//
// Trigger: setInterval daily at 16:00 IST (post-market close 15:30 +
// 30 min settle buffer). Plus a manual POST /api/me/attribution/snapshot.
//
// Public API:
//   const a = createAttribution({ getTrades, getAutorunHistory, getRegime,
//                                  getPortfolioAggregates, storePath, audit });
//   a.snapshot()             -> writes today's row + returns it
//   a.recent(n=30)           -> last N daily rows (most recent first)
//   a.start() / a.stop()     -> arm/disarm the daily tick
//   a.stats()                -> { lastSnapshotAt, rowCount, nextTickAt }

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_STORE      = '/var/lib/ats/tokens/_attribution.jsonl';
const MAX_ROWS_RETAINED  = 365;
const SNAPSHOT_HOUR_IST  = 16;
const SNAPSHOT_MIN_IST   = 0;
const TICK_INTERVAL_MS   = 60 * 1000; // poll once per minute

function _nowIST() {
  return new Date(Date.now() + (5.5 * 60 * 60 * 1000));
}
function _todayISTDate() {
  return _nowIST().toISOString().slice(0, 10);
}
function _istHM() {
  const d = _nowIST();
  return { h: d.getUTCHours(), m: d.getUTCMinutes() };
}
function _round(n, p = 2) {
  const m = Math.pow(10, p);
  return Math.round(n * m) / m;
}

function createAttribution({
  getTrades,
  getAutorunHistory,
  getRegime,
  getPortfolioAggregates,
  storePath,
  audit,
}) {
  if (typeof getTrades !== 'function') throw new Error('getTrades required');
  const _path = storePath || DEFAULT_STORE;
  const _audit = audit || (() => {});
  let _timer = null;
  let _lastSnapDate = null;

  // ---- File helpers ----
  function _readAll() {
    try {
      if (!fs.existsSync(_path)) return [];
      const raw = fs.readFileSync(_path, 'utf8');
      return raw.split('\n').filter(Boolean).map(line => {
        try { return JSON.parse(line); } catch (_e) { return null; }
      }).filter(Boolean);
    } catch (e) { console.warn('[attribution] read failed:', e.message); return []; }
  }
  function _writeAll(rows) {
    try {
      fs.mkdirSync(path.dirname(_path), { recursive: true });
      const capped = rows.slice(-MAX_ROWS_RETAINED);
      fs.writeFileSync(_path, capped.map(r => JSON.stringify(r)).join('\n') + '\n');
    } catch (e) { console.error('[attribution] write failed:', e.message); }
  }

  // ---- Snapshot computation ----
  function _computeSnapshot() {
    const today = _todayISTDate();
    const trades = (getTrades(500) || []).filter(t => {
      // Today's closed trades only
      const closedDate = (t.closedAt || t.exitTs || '').slice(0, 10);
      return closedDate === today;
    });

    // Total realised PnL today
    let totalPnl = 0;
    for (const t of trades) totalPnl += Number(t.pnl) || 0;

    // By strategy
    const byStrategy = {};
    for (const t of trades) {
      const tag = t.strategy || 'manual';
      if (!byStrategy[tag]) byStrategy[tag] = { count: 0, pnl: 0 };
      byStrategy[tag].count += 1;
      byStrategy[tag].pnl += Number(t.pnl) || 0;
    }
    for (const k of Object.keys(byStrategy)) byStrategy[k].pnl = _round(byStrategy[k].pnl, 2);

    // By symbol
    const bySymbol = {};
    for (const t of trades) {
      const s = t.symbol;
      if (!bySymbol[s]) bySymbol[s] = { count: 0, pnl: 0 };
      bySymbol[s].count += 1;
      bySymbol[s].pnl += Number(t.pnl) || 0;
    }
    for (const k of Object.keys(bySymbol)) bySymbol[k].pnl = _round(bySymbol[k].pnl, 2);

    // Autorun gate-skip distribution today (from autorun history if available)
    const gateSkips = {};
    let autorunRuns = 0, autorunPlaced = 0;
    if (typeof getAutorunHistory === 'function') {
      try {
        const hist = getAutorunHistory(500) || [];
        for (const h of hist) {
          const ts = (h.ts || '').slice(0, 10);
          if (ts !== today) continue;
          autorunRuns += 1;
          if (h.result === 'placed') autorunPlaced += 1;
          else if (h.result && h.result.startsWith('skipped_')) {
            gateSkips[h.result] = (gateSkips[h.result] || 0) + 1;
          }
        }
      } catch (_e) { /* best-effort */ }
    }

    // Regime at snapshot time
    let regimeLabel = 'unknown';
    let regimeConf  = null;
    if (typeof getRegime === 'function') {
      try {
        const r = getRegime();
        if (r && typeof r.then === 'function') {
          // skip async; caller can pass a sync wrapper
        } else if (r && r.regime) {
          regimeLabel = r.regime;
          regimeConf  = r.confidence;
        }
      } catch (_e) { /* best-effort */ }
    }

    // Portfolio aggregates at snapshot time
    let portfolio = null;
    if (typeof getPortfolioAggregates === 'function') {
      try {
        const a = getPortfolioAggregates();
        if (a && a.totalValue != null) {
          portfolio = {
            totalValue: a.totalValue,
            cash: a.cash,
            grossExposure: a.grossExposure,
            netExposure: a.netExposure,
            leverage: a.leverage,
            positionCount: a.positionCount,
          };
        }
      } catch (_e) { /* best-effort */ }
    }

    return {
      date: today,
      asOf: new Date().toISOString(),
      totalPnl: _round(totalPnl, 2),
      tradeCount: trades.length,
      autorun: { runs: autorunRuns, placed: autorunPlaced, gateSkips },
      byStrategy,
      bySymbol,
      regime: { label: regimeLabel, confidence: regimeConf },
      portfolio,
      _schema: 'attribution-v1',
    };
  }

  function snapshot() {
    const row = _computeSnapshot();
    const rows = _readAll();
    // Replace any existing row for today (idempotent if called multiple times)
    const filtered = rows.filter(r => r.date !== row.date);
    filtered.push(row);
    _writeAll(filtered);
    _lastSnapDate = row.date;
    _audit('attribution.snapshot', { date: row.date, tradeCount: row.tradeCount, totalPnl: row.totalPnl });
    return row;
  }

  function recent(n = 30) {
    const rows = _readAll();
    const limit = Math.max(1, Math.min(MAX_ROWS_RETAINED, n));
    return rows.slice(-limit).reverse();
  }

  function _onTick() {
    const today = _todayISTDate();
    if (_lastSnapDate === today) return;
    const { h, m } = _istHM();
    if (h < SNAPSHOT_HOUR_IST) return;
    if (h === SNAPSHOT_HOUR_IST && m < SNAPSHOT_MIN_IST) return;
    try {
      snapshot();
    } catch (e) {
      _audit('attribution.tick.error', { msg: e.message });
    }
  }

  function start() {
    if (_timer) return;
    // Boot catch-up: try once immediately (idempotent if today's snapshot already written)
    _onTick();
    _timer = setInterval(_onTick, TICK_INTERVAL_MS);
    if (_timer.unref) _timer.unref();
    _audit('attribution.runner.started', { snapshotAt: `${SNAPSHOT_HOUR_IST}:${String(SNAPSHOT_MIN_IST).padStart(2, '0')} IST` });
  }
  function stop() { if (_timer) { clearInterval(_timer); _timer = null; } }

  function stats() {
    const rows = _readAll();
    return {
      lastSnapshotAt: rows.length ? rows[rows.length - 1].asOf : null,
      rowCount: rows.length,
      snapshotWindow: `${SNAPSHOT_HOUR_IST}:${String(SNAPSHOT_MIN_IST).padStart(2, '0')} IST daily`,
      timerArmed: !!_timer,
    };
  }

  return { snapshot, recent, start, stop, stats };
}

module.exports = { createAttribution };
