// promotion-rate.js — T-159: paper→live promotion-readiness proxy.
//
// Foundation for ungating the Signals screen's "Paper → Live rate" KPI tile
// (T-81 left it as "—" with sub-text "needs promotion ledger"). A real
// promotion ledger (tracking which paper trades actually got placed as live
// broker orders) is a more invasive change — needs frontend instrumentation
// at the "place live order" CTA and a new table linking the two.
//
// This module ships the PROXY version that's computable from existing data:
//
//   Promotion-readiness rate =
//     # of (symbol, strategy_tag) groups with >= N closed paper trades in window
//     # of (symbol, strategy_tag) groups in window
//
// Interpretation: "fraction of your paper strategy×symbol pairs that have
// enough trade history to credibly promote to live." Not a true paper→live
// conversion rate, but a meaningful operational metric a user can act on.
//
// Storage shape (schema.sql):
//   paper_closed_trades(id, user_id, symbol, side, qty, ..., strategy_tag,
//                       exited_at)

'use strict';

const DEFAULT_MIN_TRADES = 5;

/**
 * Pure aggregation: take rows from paper_closed_trades and return the
 * promotion-readiness summary.
 *
 * @param {Array<{symbol:string, strategy_tag?:string, exited_at:string, pnl:number}>} rows
 * @param {object} [opts]
 * @param {number} [opts.minTrades=5]  threshold for "established edge"
 * @returns {{
 *   total_groups: number,
 *   ready_groups: number,
 *   rate: number,
 *   total_trades: number,
 *   groups: Array<{symbol:string, strategy:string|null, trades:number, wins:number, win_rate:number, net_pnl:number, ready:boolean}>,
 * }}
 */
function computePromotionRate(rows, { minTrades = DEFAULT_MIN_TRADES } = {}) {
  const empty = { total_groups: 0, ready_groups: 0, rate: 0, total_trades: 0, groups: [] };
  if (!Array.isArray(rows) || rows.length === 0) return empty;

  // Filter out malformed rows.
  const clean = rows.filter(r =>
    r && typeof r.symbol === 'string' && r.symbol.length > 0
    && Number.isFinite(Number(r.pnl))
  );
  if (clean.length === 0) return empty;

  // Group by (symbol, strategy_tag). Null strategy → 'untagged'.
  const groupKey = (r) => `${r.symbol.toUpperCase()}::${r.strategy_tag || 'untagged'}`;
  const byGroup = new Map();
  for (const r of clean) {
    const k = groupKey(r);
    if (!byGroup.has(k)) {
      byGroup.set(k, {
        symbol: r.symbol.toUpperCase(),
        strategy: r.strategy_tag || null,
        trades: 0,
        wins: 0,
        net_pnl: 0,
      });
    }
    const g = byGroup.get(k);
    g.trades++;
    if (Number(r.pnl) > 0) g.wins++;
    g.net_pnl += Number(r.pnl);
  }

  // Mark ready + compute win_rate + round.
  const groups = [...byGroup.values()].map(g => ({
    symbol: g.symbol,
    strategy: g.strategy,
    trades: g.trades,
    wins: g.wins,
    win_rate: g.trades > 0 ? +(g.wins / g.trades).toFixed(4) : 0,
    net_pnl: Math.round(g.net_pnl * 100) / 100,
    ready: g.trades >= minTrades,
  }));
  // Sort: ready first, then by trade count desc.
  groups.sort((a, b) => (b.ready - a.ready) || (b.trades - a.trades) || a.symbol.localeCompare(b.symbol));

  const ready = groups.filter(g => g.ready);

  return {
    total_groups: groups.length,
    ready_groups: ready.length,
    rate: groups.length > 0 ? +(ready.length / groups.length).toFixed(4) : 0,
    total_trades: clean.length,
    groups,
  };
}

module.exports = { computePromotionRate, DEFAULT_MIN_TRADES };
