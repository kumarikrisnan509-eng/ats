// T-264 -- Tax-aware trade economics.
//
// Computes the full cost stack of a round-trip trade on Indian markets and
// projects net-of-tax PnL. Borrowed from the hybrid_trading_engine's
// core/risk_manager.py logic, which encodes 2026 NSE F&O regulations.
//
// Why this exists: the website's autorun previously thought every signal with
// gross_pnl > 0 was profitable. In reality, Zerodha + government take ~₹40-100
// per round-trip on small trades. A 25-point Nifty option scalp at lot=75 has
// gross PnL of ₹1875 -- but ~₹120 in charges leaves ₹1755, and after slippage
// the trade can be marginal. For tighter stops (5 points = ₹375 gross), the
// trade is OFTEN net-negative even when "won".
//
// This service is the gatekeeper. Strategies submit a candidate trade with
// expected entry/exit; we return the realistic net-PnL projection AND the
// breakeven point. Caller (autorun / risk layer) rejects the trade if net
// PnL after slippage buffer is <= 0.
//
// All rates per 2026 SEBI/Zerodha schedule. Update when statutes change.
//
// Public API:
//   const te = createTradeEconomics();
//   const result = te.projectRoundTrip({
//     instrumentType: 'EQUITY_INTRADAY' | 'EQUITY_DELIVERY' | 'OPTION_BUY' | 'OPTION_SELL' | 'FUTURE',
//     buyPrice: 100.0,
//     sellPrice: 110.0,
//     qty: 50,
//     slippagePointsPerLeg: 0.25,   // optional, default 0.25
//   });
//   // result = { grossPnl, brokerage, stt, exchTxn, gst, sebi, stampDuty, slippageBuffer, totalCharges, netPnl, profitable, breakeven, breakdown }
//
//   te.breakevenPoints({ instrumentType, midPrice, qty })  // points needed to overcome charges
//
//   te.isWorthFiring({ ...projectRoundTripArgs, minNetPnlINR: 50 })  // boolean gate

'use strict';

/**
 * Rate schedule (2026 NSE/Zerodha). Numbers are fractions (0.001 = 0.1%).
 */
const RATES = {
  // Brokerage: Zerodha flat ₹20 per executed order. Round-trip = ₹40.
  BROKERAGE_PER_ORDER_INR: 20.0,

  // STT (Securities Transaction Tax)
  STT_EQUITY_INTRADAY_SELL: 0.00025,  // 0.025% on sell turnover (intraday equity)
  STT_EQUITY_DELIVERY:      0.001,    // 0.1% on both buy + sell (delivery)
  STT_OPTION_SELL_PREMIUM:  0.001,    // 0.1% on sell-side premium (options seller)
  STT_OPTION_EXERCISE:      0.00125,  // 0.125% on settlement price (exercised)
  STT_FUTURE_SELL:          0.0002,   // 0.02% on sell-side turnover (futures)

  // Exchange Transaction Charge (NSE)
  EXCH_TXN_EQUITY:  0.0000297,        // 0.00297% on turnover
  EXCH_TXN_OPTION:  0.00053,          // 0.053% on premium turnover
  EXCH_TXN_FUTURE:  0.0000173,        // 0.00173%

  // SEBI Turnover Fee
  SEBI_FEE: 0.000001,                 // ₹10 per crore = 0.0001% = 0.000001

  // GST (Goods + Services Tax) -- applies to (brokerage + exch_txn + sebi)
  GST_RATE: 0.18,                     // 18%

  // Stamp Duty (state-level, applied to buy side only)
  STAMP_DUTY_EQUITY_INTRADAY: 0.00003,   // 0.003%
  STAMP_DUTY_EQUITY_DELIVERY: 0.00015,   // 0.015%
  STAMP_DUTY_OPTION:          0.00003,   // 0.003%
  STAMP_DUTY_FUTURE:          0.00002,   // 0.002%
};

const VALID_INSTRUMENT_TYPES = new Set([
  'EQUITY_INTRADAY',
  'EQUITY_DELIVERY',
  'OPTION_BUY',
  'OPTION_SELL',
  'FUTURE',
]);

function _validateArgs(args) {
  const { instrumentType, buyPrice, sellPrice, qty } = args;
  if (!VALID_INSTRUMENT_TYPES.has(instrumentType)) {
    throw new Error(`instrumentType must be one of: ${[...VALID_INSTRUMENT_TYPES].join(', ')}`);
  }
  if (!Number.isFinite(buyPrice) || buyPrice <= 0) throw new Error('buyPrice must be > 0');
  if (!Number.isFinite(sellPrice) || sellPrice <= 0) throw new Error('sellPrice must be > 0');
  if (!Number.isFinite(qty) || qty <= 0) throw new Error('qty must be > 0');
}

/**
 * Project the full cost stack + net-of-tax PnL for a round-trip trade.
 * @returns {object} {grossPnl, brokerage, stt, exchTxn, gst, sebi, stampDuty, slippageBuffer, totalCharges, netPnl, profitable, breakeven, breakdown}
 */
function projectRoundTrip(args) {
  _validateArgs(args);
  const {
    instrumentType,
    buyPrice,
    sellPrice,
    qty,
    slippagePointsPerLeg = 0.25,
  } = args;

  const buyTurnover  = buyPrice  * qty;
  const sellTurnover = sellPrice * qty;
  const totalTurnover = buyTurnover + sellTurnover;
  const grossPnl = (sellPrice - buyPrice) * qty;

  // 1. Brokerage (₹20 per executed order, ₹40 round-trip)
  const brokerage = RATES.BROKERAGE_PER_ORDER_INR * 2;

  // 2. STT
  let stt = 0;
  switch (instrumentType) {
    case 'EQUITY_INTRADAY':
      stt = sellTurnover * RATES.STT_EQUITY_INTRADAY_SELL;
      break;
    case 'EQUITY_DELIVERY':
      stt = totalTurnover * RATES.STT_EQUITY_DELIVERY;
      break;
    case 'OPTION_BUY':
      // No STT on option buyer until expiry exercise; assume squared off before expiry.
      stt = 0;
      break;
    case 'OPTION_SELL':
      stt = sellTurnover * RATES.STT_OPTION_SELL_PREMIUM;
      break;
    case 'FUTURE':
      stt = sellTurnover * RATES.STT_FUTURE_SELL;
      break;
  }

  // 3. Exchange transaction charge
  let exchTxn = 0;
  switch (instrumentType) {
    case 'EQUITY_INTRADAY':
    case 'EQUITY_DELIVERY':
      exchTxn = totalTurnover * RATES.EXCH_TXN_EQUITY;
      break;
    case 'OPTION_BUY':
    case 'OPTION_SELL':
      exchTxn = totalTurnover * RATES.EXCH_TXN_OPTION;
      break;
    case 'FUTURE':
      exchTxn = totalTurnover * RATES.EXCH_TXN_FUTURE;
      break;
  }

  // 4. SEBI turnover fee
  const sebi = totalTurnover * RATES.SEBI_FEE;

  // 5. GST = 18% of (brokerage + exch_txn + sebi)
  const gst = (brokerage + exchTxn + sebi) * RATES.GST_RATE;

  // 6. Stamp duty (buy side only)
  let stampDuty = 0;
  switch (instrumentType) {
    case 'EQUITY_INTRADAY':
      stampDuty = buyTurnover * RATES.STAMP_DUTY_EQUITY_INTRADAY;
      break;
    case 'EQUITY_DELIVERY':
      stampDuty = buyTurnover * RATES.STAMP_DUTY_EQUITY_DELIVERY;
      break;
    case 'OPTION_BUY':
    case 'OPTION_SELL':
      stampDuty = buyTurnover * RATES.STAMP_DUTY_OPTION;
      break;
    case 'FUTURE':
      stampDuty = buyTurnover * RATES.STAMP_DUTY_FUTURE;
      break;
  }

  // 7. Slippage buffer -- realistic execution cost on both legs
  const slippageBuffer = slippagePointsPerLeg * qty * 2;

  // 8. Total round-trip charges
  const totalCharges = brokerage + stt + exchTxn + gst + sebi + stampDuty + slippageBuffer;

  // 9. Net PnL
  const netPnl = grossPnl - totalCharges;

  // 10. Breakeven: how many points must the price move to cover charges?
  // For equal qty, breakeven price-points = totalCharges / qty.
  const breakeven = totalCharges / qty;

  return {
    grossPnl: round2(grossPnl),
    brokerage: round2(brokerage),
    stt: round2(stt),
    exchTxn: round2(exchTxn),
    gst: round2(gst),
    sebi: round2(sebi),
    stampDuty: round2(stampDuty),
    slippageBuffer: round2(slippageBuffer),
    totalCharges: round2(totalCharges),
    netPnl: round2(netPnl),
    profitable: netPnl > 0,
    breakeven: round4(breakeven),
    breakdown: {
      // Human-friendly summary
      brokerage_inr: round2(brokerage),
      stt_inr: round2(stt),
      exch_txn_inr: round2(exchTxn),
      gst_inr: round2(gst),
      sebi_inr: round2(sebi),
      stamp_duty_inr: round2(stampDuty),
      slippage_inr: round2(slippageBuffer),
      total_charges_inr: round2(totalCharges),
      gross_pnl_inr: round2(grossPnl),
      net_pnl_inr: round2(netPnl),
      breakeven_points_per_unit: round4(breakeven),
    },
  };
}

/**
 * Compute breakeven distance (in price points) needed to cover charges from a flat
 * entry, given mid price + qty. Useful for "if I enter at midPrice, how far does price
 * need to move for me to net zero after taxes/fees/slippage?"
 */
function breakevenPoints({ instrumentType, midPrice, qty, slippagePointsPerLeg = 0.25 }) {
  // Simulate a tiny round-trip at midPrice. Breakeven scales with turnover, so we
  // project a 1-point move + extract breakeven directly.
  const proj = projectRoundTrip({
    instrumentType,
    buyPrice: midPrice,
    sellPrice: midPrice + 1,
    qty,
    slippagePointsPerLeg,
  });
  return proj.breakeven;
}

/**
 * Gate function. Returns true if expected net PnL after all costs exceeds the
 * minimum threshold (default ₹50). Use this as the FINAL check before placing
 * an order.
 */
function isWorthFiring(args) {
  const minNetPnlINR = args.minNetPnlINR != null ? Number(args.minNetPnlINR) : 50;
  const proj = projectRoundTrip(args);
  return proj.netPnl >= minNetPnlINR;
}

// ---- helpers ----
function round2(n) { return Math.round(n * 100) / 100; }
function round4(n) { return Math.round(n * 10000) / 10000; }

function createTradeEconomics() {
  return {
    projectRoundTrip,
    breakevenPoints,
    isWorthFiring,
    RATES, // exposed for inspection / UI display
  };
}

module.exports = { createTradeEconomics, projectRoundTrip, breakevenPoints, isWorthFiring, RATES };
