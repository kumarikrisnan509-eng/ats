// T-300 -- Slippage tracker (Phase 5 kickoff, vision doc §6.5).
//
// Observational service. Looks at closed paper trades and computes the
// slippage between the price the strategy MEANT to get (the bar mid-price
// at signal time, or the explicit LIMIT price) and the price the trade
// ACTUALLY filled at.
//
// Purpose: identify strategies / instruments that systematically overpay.
// A 5-bps slippage on a 25-bps edge eats 20% of the edge. Operator needs
// to see this attributed by strategy + instrument so they know which
// pair (strategy, symbol) is leaky.
//
// Out of scope for v1:
//   - Per-tick mid-price reconstruction (would need tick archive)
//   - Volume-weighted reference (VWAP at fill time)
//   - Adverse-selection regime adjustment
// Reference price for slippage is the order's `price` field if it was a
// LIMIT order; otherwise we approximate using `lastTicks` at fill time
// (paper.js stores `filledPrice` on the order; the mid-price proxy is
// the avgPrice of the closed trade pair, which the trade record carries).
//
// Public API:
//   const st = createSlippageTracker({ getTrades, getOrders });
//   st.compute()              -> {
//                                  overall: { trades, avgSlippageBps, totalSlippageINR },
//                                  byStrategy: { stratId: {...} },
//                                  bySymbol:   { symbol: {...} },
//                                  worst:      [{ ... }, ...]  // top 10 worst-slippage trades
//                                }

'use strict';

function _round(n, p = 2) {
  const m = Math.pow(10, p);
  return Math.round(n * m) / m;
}

function createSlippageTracker({ getTrades, getOrders }) {
  if (typeof getTrades !== 'function') throw new Error('getTrades required');
  // getOrders is optional -- if provided, we can match closed trades back to
  // the original order to recover the LIMIT price (vs MARKET, no reference).
  const _getOrders = (typeof getOrders === 'function') ? getOrders : null;

  function _computeOne(trade, orderLookup) {
    // A closed paper trade has: { symbol, side, qty, entry, exit, pnl, strategy, openedAt, closedAt }
    // We compute slippage on the EXIT leg, since that's where the realised
    // PnL lands. Entry slippage is tracked separately but conceptually
    // equivalent. For v1 just exit-leg.
    const fillPrice = Number(trade.exit);
    if (!Number.isFinite(fillPrice) || fillPrice <= 0) return null;

    // Reference price: if we have order metadata, prefer the LIMIT price.
    // Otherwise approximate as the avg of entry+exit (mid of trade range).
    let refPrice = null;
    if (orderLookup && trade.exitOrderId) {
      const ord = orderLookup[trade.exitOrderId];
      if (ord && ord.type === 'LIMIT' && Number.isFinite(ord.price) && ord.price > 0) {
        refPrice = ord.price;
      }
    }
    if (refPrice == null) {
      // Approximation: midpoint of entry/exit. Not perfect; underestimates
      // slippage for one-sided moves but is a defensible v1 baseline.
      const entry = Number(trade.entry);
      if (Number.isFinite(entry) && entry > 0) {
        refPrice = (entry + fillPrice) / 2;
      }
    }
    if (refPrice == null) return null;

    // Slippage in basis points (1 bp = 0.01%). Sign convention: positive
    // means the trade filled WORSE than reference (cost). For a SELL exit
    // filling below reference is bad; for a BUY exit it's good. Normalise
    // so positive = bad.
    const rawDelta = fillPrice - refPrice;
    const exitSide = (trade.side === 'BUY') ? 'SELL' : 'BUY';   // closing side
    const directional = (exitSide === 'BUY') ? rawDelta : -rawDelta;
    const slippageBps = (directional / refPrice) * 10000;
    const slippageINR = directional * Math.abs(Number(trade.qty) || 0);

    return {
      symbol: trade.symbol,
      strategy: trade.strategy || 'manual',
      qty: trade.qty,
      refPrice: _round(refPrice, 2),
      fillPrice: _round(fillPrice, 2),
      slippageBps: _round(slippageBps, 1),
      slippageINR: _round(slippageINR, 2),
      closedAt: trade.closedAt || trade.exitTs || null,
    };
  }

  function compute() {
    const trades = getTrades(500) || [];
    let orderLookup = null;
    if (_getOrders) {
      try {
        const orders = _getOrders() || [];
        orderLookup = {};
        for (const o of orders) {
          if (o && o.id) orderLookup[o.id] = o;
        }
      } catch (_e) { orderLookup = null; }
    }

    const rows = [];
    for (const t of trades) {
      const row = _computeOne(t, orderLookup);
      if (row) rows.push(row);
    }

    if (rows.length === 0) {
      return {
        overall: { trades: 0, avgSlippageBps: 0, totalSlippageINR: 0 },
        byStrategy: {},
        bySymbol: {},
        worst: [],
        _schema: 'slippage-tracker-v1',
      };
    }

    // Aggregates
    let sumBps = 0, sumINR = 0;
    const byStrat = {};
    const bySym = {};
    for (const r of rows) {
      sumBps += r.slippageBps;
      sumINR += r.slippageINR;
      if (!byStrat[r.strategy]) byStrat[r.strategy] = { trades: 0, sumBps: 0, sumINR: 0 };
      byStrat[r.strategy].trades += 1;
      byStrat[r.strategy].sumBps  += r.slippageBps;
      byStrat[r.strategy].sumINR  += r.slippageINR;
      if (!bySym[r.symbol]) bySym[r.symbol] = { trades: 0, sumBps: 0, sumINR: 0 };
      bySym[r.symbol].trades += 1;
      bySym[r.symbol].sumBps  += r.slippageBps;
      bySym[r.symbol].sumINR  += r.slippageINR;
    }

    const byStrategy = Object.fromEntries(
      Object.entries(byStrat).map(([k, v]) => [k, {
        trades: v.trades,
        avgSlippageBps: _round(v.sumBps / v.trades, 1),
        totalSlippageINR: _round(v.sumINR, 2),
      }])
    );
    const bySymbol = Object.fromEntries(
      Object.entries(bySym).map(([k, v]) => [k, {
        trades: v.trades,
        avgSlippageBps: _round(v.sumBps / v.trades, 1),
        totalSlippageINR: _round(v.sumINR, 2),
      }])
    );

    // Worst 10 trades by slippage cost
    const worst = rows
      .slice()
      .sort((a, b) => b.slippageINR - a.slippageINR)
      .slice(0, 10);

    return {
      overall: {
        trades: rows.length,
        avgSlippageBps: _round(sumBps / rows.length, 1),
        totalSlippageINR: _round(sumINR, 2),
      },
      byStrategy,
      bySymbol,
      worst,
      _schema: 'slippage-tracker-v1',
    };
  }

  return { compute };
}

module.exports = { createSlippageTracker };
