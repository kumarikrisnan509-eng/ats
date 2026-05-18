// pnl-monthly.js — T-156: per-month aggregation over paper_closed_trades.
//
// This is the foundation that unblocks the AI Review screen's currently-gated
// per-month KPIs (Net PnL, trades, win rate, Sharpe, Max DD) shipped behind
// MockData.isDemoOn() in T-136 / T-139.
//
// Pure aggregation logic lives here. The /api/me/pnl/monthly route in
// server.js just queries paper_closed_trades by user_id + date range, hands
// rows to aggregateMonthly(), and serves the result.
//
// Storage shape (schema.sql):
//   paper_closed_trades(id, user_id, symbol, side, qty, entry_price,
//                       exit_price, pnl, strategy_tag, entered_at, exited_at)
//
// Output time-series rows:
//   { month: '2026-05', net_pnl: 12450.0, trades: 28, wins: 18,
//     win_rate: 0.643, max_drawdown_inr: -3400.0 }
//
// Sharpe is intentionally omitted at this layer — it requires a benchmark
// + risk-free rate that lives in the risk-metrics module. Callers compose
// the two endpoints.

'use strict';

/**
 * Extract 'YYYY-MM' bucket from an exited_at TEXT field. Accepts ISO timestamps
 * ('2026-05-18T03:42:00.000Z') AND SQLite datetime() format ('2026-05-18 03:42:00').
 * Returns null on parse failure.
 *
 * @param {string} exitedAt
 * @returns {string|null}
 */
function monthBucket(exitedAt) {
  if (typeof exitedAt !== 'string' || exitedAt.length < 7) return null;
  // Both formats start with 'YYYY-MM' — just slice.
  const m = exitedAt.slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(m)) return null;
  return m;
}

/**
 * Aggregate paper_closed_trades rows into per-month KPI rows.
 *
 * @param {Array<{pnl:number, exited_at:string, strategy_tag?:string}>} rows
 * @returns {Array<{
 *   month: string,
 *   net_pnl: number,
 *   trades: number,
 *   wins: number,
 *   losses: number,
 *   win_rate: number,
 *   avg_win_inr: number,
 *   avg_loss_inr: number,
 *   max_drawdown_inr: number,
 * }>}  sorted oldest-month first
 */
function aggregateMonthly(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  // 1. Sort by exited_at so running-drawdown math is causally correct.
  const sorted = [...rows]
    .filter(r => r && Number.isFinite(Number(r.pnl)) && typeof r.exited_at === 'string')
    .sort((a, b) => a.exited_at < b.exited_at ? -1 : a.exited_at > b.exited_at ? 1 : 0);

  if (sorted.length === 0) return [];

  // 2. Group by month bucket.
  const byMonth = new Map();
  for (const r of sorted) {
    const m = monthBucket(r.exited_at);
    if (!m) continue;
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push(r);
  }

  // 3. Compute KPIs per month.
  const out = [];
  for (const [month, monthRows] of byMonth) {
    let netPnl = 0, wins = 0, losses = 0;
    let sumWinPnl = 0, sumLossPnl = 0;

    // Drawdown is computed per-month over the trade-equity curve (cumulative
    // pnl this month). max_drawdown_inr is the largest peak-to-trough drop.
    let cumPnl = 0;
    let peakCum = 0;
    let maxDrawdown = 0;

    for (const r of monthRows) {
      const p = Number(r.pnl);
      netPnl += p;
      if (p > 0) { wins++;   sumWinPnl  += p; }
      else if (p < 0) { losses++; sumLossPnl += p; }
      // else: pnl exactly 0 — count as neither win nor loss

      cumPnl += p;
      if (cumPnl > peakCum) peakCum = cumPnl;
      const dd = cumPnl - peakCum;     // ≤ 0
      if (dd < maxDrawdown) maxDrawdown = dd;
    }

    const trades = monthRows.length;
    out.push({
      month,
      net_pnl: round2(netPnl),
      trades,
      wins,
      losses,
      win_rate: trades > 0 ? +(wins / trades).toFixed(4) : 0,
      avg_win_inr:  wins > 0   ? round2(sumWinPnl  / wins)   : 0,
      avg_loss_inr: losses > 0 ? round2(sumLossPnl / losses) : 0,
      max_drawdown_inr: round2(maxDrawdown),
    });
  }

  // 4. Sorted oldest-month first (Map preserves insertion order, and we
  //    inserted in date order via sorted[]).
  return out;
}

/** Round to 2 dp without floating-point fuzz. */
function round2(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/**
 * Compute a single summary for a date range (used by AI Review headline KPIs).
 *
 * @param {Array<{pnl:number, exited_at:string}>} rows
 * @returns {{net_pnl:number, trades:number, wins:number, win_rate:number,
 *           best_month_pnl:number, worst_month_pnl:number,
 *           max_drawdown_inr:number}}
 */
function summarize(rows) {
  const byMonth = aggregateMonthly(rows);
  if (byMonth.length === 0) {
    return {
      net_pnl: 0, trades: 0, wins: 0, win_rate: 0,
      best_month_pnl: 0, worst_month_pnl: 0, max_drawdown_inr: 0,
    };
  }
  let total = 0, trades = 0, wins = 0;
  let best = byMonth[0].net_pnl, worst = byMonth[0].net_pnl;
  let maxDD = 0;
  for (const m of byMonth) {
    total += m.net_pnl;
    trades += m.trades;
    wins += m.wins;
    if (m.net_pnl > best)  best  = m.net_pnl;
    if (m.net_pnl < worst) worst = m.net_pnl;
    if (m.max_drawdown_inr < maxDD) maxDD = m.max_drawdown_inr;
  }
  return {
    net_pnl: round2(total),
    trades,
    wins,
    win_rate: trades > 0 ? +(wins / trades).toFixed(4) : 0,
    best_month_pnl: round2(best),
    worst_month_pnl: round2(worst),
    max_drawdown_inr: round2(maxDD),
  };
}

module.exports = { monthBucket, aggregateMonthly, summarize };
