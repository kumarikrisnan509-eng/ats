// T-220 (CODE-AUDIT F.5 M1.4 piece 5b): order rate-limit helpers.
//
// Pre-broker safety gate #3 (audit C.5 / T-200's Gate 3). The helpers
// cap orders/min on a rolling 60-second window. Module-local state means
// the rate counter is process-wide today (audit calls this out as a
// multi-tenant concern -- per-user limits are future work). Behavior
// preserved exactly; only the implementation moved out of server.js.
//
// Public API:
//   const rl = require('./services/order-rate-limit');
//   if (!rl.orderRateOk()) { ... }     // returns true if under cap
//   rl.orderRateRecord();              // record a successful place
//   rl.MAX_ORDERS_PER_MIN              // numeric cap (env-tunable)

'use strict';

const MAX_ORDERS_PER_MIN = Number(process.env.MAX_ORDERS_PER_MIN || 30);

// Rolling window of timestamps (Date.now()) for orders successfully
// queued in the last 60s. Module-local; same lifetime as the Node process.
const _orderTimes = [];

function orderRateOk() {
  const cutoff = Date.now() - 60_000;
  while (_orderTimes.length > 0 && _orderTimes[0] < cutoff) _orderTimes.shift();
  return _orderTimes.length < MAX_ORDERS_PER_MIN;
}

function orderRateRecord() {
  _orderTimes.push(Date.now());
}

module.exports = {
  MAX_ORDERS_PER_MIN,
  orderRateOk,
  orderRateRecord,
  _orderTimes,  // exposed for testing only
};
