// T-219 (CODE-AUDIT F.5 M1.4 piece 5a): order-payload validation constants.
//
// Pure data extracted from server.js where the 5 VALID_* Sets lived
// inline. Used by the /api/orders/place handler at server.js:~4550 to
// validate payload shape before any risk-gate or broker call.
//
// Kept as a separate concern so:
//   1. server.js shrinks (small but cumulative with the other M1.4 extracts).
//   2. Future risk-gate.js extraction (the 6 pre-trade gates) can pull
//      from a stable module rather than reading globals.
//   3. Unit tests for individual broker adapters can import the same
//      validators without spinning up the whole HTTP stack.

'use strict';

const VALID_SIDES         = new Set(['BUY', 'SELL']);
const VALID_PRODUCTS      = new Set(['CNC', 'NRML', 'MIS', 'BO', 'CO']);
const VALID_ORDER_TYPES   = new Set(['MARKET', 'LIMIT', 'SL', 'SL-M']);
const VALID_VARIETIES     = new Set(['regular', 'amo', 'co', 'iceberg', 'auction']);
const VALID_VALIDITY      = new Set(['DAY', 'IOC', 'TTL']);

module.exports = {
  VALID_SIDES,
  VALID_PRODUCTS,
  VALID_ORDER_TYPES,
  VALID_VARIETIES,
  VALID_VALIDITY,
};
