// promotion-policy.js -- T-499/T-500: single canonical paper->live promotion
// criteria. Used by BOTH the /api/me/paper/promote-check endpoint and the
// nightly promote-scheduler so the UI and backend can never disagree on
// "is this strategy ready to go live".
//
// Closes the audit finding where the UI advertised "≥14 days, ≥30 trades,
// ≥60% win, ≥1.2 Sharpe" but the backend implementation used totally
// different thresholds (≥20 trades, ≥55% win, no Sharpe). Whichever number
// the operator trusted, the other lied.
//
// All thresholds live in DEFAULTS below. evaluate() runs every gate and
// returns a complete report so the UI can show progress against each one
// instead of just pass/fail.

'use strict';

const DEFAULTS = Object.freeze({
  // Sample-size gates -- can't trust any strategy with too little data.
  min_trades:        30,
  min_days_active:   14,
  // Profitability gates.
  min_win_rate:      0.55,
  min_profit_factor: 1.30,   // sum(wins) / abs(sum(losses))
  min_sharpe:        1.20,
  // Risk gates.
  max_drawdown_pct:  20.0,   // |peak-to-trough cumulative pnl| / |peak| * 100
  // Operational gates (live-trading prerequisites).
  require_telegram_2fa: true,
  // Lookback window for "active days" and the rolling stats.
  window_days:       30,
});

function _computeStats(trades) {
  const stats = {
    trades:        trades.length,
    wins:          0,
    losses:        0,
    flat:          0,
    gross_pnl:     0,
    gross_wins:    0,
    gross_losses:  0,
    win_rate:      0,
    profit_factor: 0,
    avg_trade_pnl: 0,
    max_drawdown_pct: 0,
    sharpe:        0,
    days_active:   0,
  };
  if (!trades.length) return stats;

  const days = new Set();
  let cumPnl = 0, peak = 0, maxDD = 0;
  const returns = [];

  for (const t of trades) {
    const pnl = Number(t.pnl) || 0;
    stats.gross_pnl += pnl;
    if (pnl > 0)      { stats.wins++;   stats.gross_wins  += pnl; }
    else if (pnl < 0) { stats.losses++; stats.gross_losses += pnl; }
    else              { stats.flat++; }
    returns.push(pnl);
    cumPnl += pnl;
    if (cumPnl > peak) peak = cumPnl;
    const drawdown = peak - cumPnl;
    if (drawdown > maxDD) maxDD = drawdown;
    if (t.exited_at) days.add(String(t.exited_at).slice(0, 10));
  }

  stats.win_rate     = +(stats.wins / stats.trades).toFixed(4);
  stats.profit_factor = stats.gross_losses < 0
    ? +(stats.gross_wins / Math.abs(stats.gross_losses)).toFixed(4)
    : (stats.gross_wins > 0 ? Infinity : 0);
  stats.avg_trade_pnl = +(stats.gross_pnl / stats.trades).toFixed(2);
  stats.days_active   = days.size;
  stats.gross_pnl     = +stats.gross_pnl.toFixed(2);
  stats.gross_wins    = +stats.gross_wins.toFixed(2);
  stats.gross_losses  = +stats.gross_losses.toFixed(2);

  // Per-trade Sharpe (simplified): mean(returns) / std(returns) * sqrt(trades_per_year).
  // Approximate trades_per_year via the active-days density.
  if (returns.length > 1) {
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1);
    const std = Math.sqrt(variance);
    if (std > 0) {
      // 252 trading days per year; trades/day; scale = sqrt(trades_per_year).
      const tradesPerDay = stats.days_active > 0 ? stats.trades / stats.days_active : 1;
      stats.sharpe = +(mean / std * Math.sqrt(252 * tradesPerDay)).toFixed(3);
    }
  }

  // Drawdown as % of peak. If peak <= 0 (never made money), drawdown % is
  // meaningless -- report 100% to fail the gate.
  stats.max_drawdown_pct = peak > 0 ? +((maxDD / peak) * 100).toFixed(2) : 100;

  return stats;
}

function evaluate(trades, { thresholds = {}, telegram2faReady = false } = {}) {
  const T = { ...DEFAULTS, ...thresholds };
  const stats = _computeStats(trades);

  const gates = {
    sample_size: {
      pass:           stats.trades >= T.min_trades,
      observed:       stats.trades,
      required:       T.min_trades,
      label:          `≥${T.min_trades} trades`,
    },
    active_days: {
      pass:           stats.days_active >= T.min_days_active,
      observed:       stats.days_active,
      required:       T.min_days_active,
      label:          `≥${T.min_days_active} active trading days`,
    },
    win_rate: {
      pass:           stats.win_rate >= T.min_win_rate,
      observed:       +(stats.win_rate * 100).toFixed(2),
      required:       +(T.min_win_rate * 100).toFixed(2),
      label:          `≥${(T.min_win_rate * 100).toFixed(0)}% win rate`,
      unit:           '%',
    },
    profit_factor: {
      pass:           stats.profit_factor >= T.min_profit_factor,
      observed:       stats.profit_factor === Infinity ? '∞' : stats.profit_factor,
      required:       T.min_profit_factor,
      label:          `Profit factor ≥${T.min_profit_factor}`,
    },
    sharpe: {
      pass:           stats.sharpe >= T.min_sharpe,
      observed:       stats.sharpe,
      required:       T.min_sharpe,
      label:          `Sharpe ≥${T.min_sharpe}`,
    },
    drawdown: {
      pass:           stats.max_drawdown_pct <= T.max_drawdown_pct,
      observed:       stats.max_drawdown_pct,
      required:       T.max_drawdown_pct,
      label:          `Max drawdown ≤${T.max_drawdown_pct}%`,
      unit:           '%',
      inverse:        true,   // lower = better
    },
    telegram_2fa: {
      pass:           !T.require_telegram_2fa || telegram2faReady,
      observed:       telegram2faReady ? 'configured' : 'not_configured',
      required:       'configured',
      label:          'Telegram 2FA reachable',
    },
  };

  const failed   = Object.entries(gates).filter(([_, g]) => !g.pass).map(([k]) => k);
  const can_promote = failed.length === 0;

  return {
    can_promote,
    failed_gates: failed,
    gates,
    stats,
    thresholds: T,
    window_days: T.window_days,
    evaluated_at: new Date().toISOString(),
  };
}

module.exports = { evaluate, DEFAULTS, _computeStats };
