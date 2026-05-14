// csv-import.js -- parse Zerodha Console tradebook CSV exports + reconcile against audit log.
//
// Zerodha Console tradebook CSV columns (as of 2026, may evolve):
//   symbol, isin, trade_date, exchange, segment, series, trade_type, auction,
//   quantity, price, trade_id, order_id, execution_time, order_execution_time
//
// We are permissive about header names (case-insensitive, whitespace-tolerant)
// so the same parser works with Console / Kite / 3rd-party exports.

const fs = require('fs');

/** Parse a CSV string into rows of objects. Handles quoted fields, escaped quotes, CRLF. */
function parseCsv(text) {
  if (typeof text !== 'string') return [];
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i+1];
    if (inQuotes) {
      if (c === '"' && n === '"') { field += '"'; i++; }
      else if (c === '"')         { inQuotes = false; }
      else                          { field += c; }
    } else {
      if (c === '"')              { inQuotes = true; }
      else if (c === ',')         { row.push(field); field = ''; }
      else if (c === '\r')        { /* skip */ }
      else if (c === '\n')        { row.push(field); rows.push(row); row = []; field = ''; }
      else                          { field += c; }
    }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const header = rows[0].map(h => String(h || '').trim().toLowerCase().replace(/\s+/g, '_'));
  return rows.slice(1).filter(r => r.some(c => c && c.length)).map(r => {
    const obj = {};
    for (let i = 0; i < header.length; i++) obj[header[i]] = (r[i] || '').trim();
    return obj;
  });
}

/** Coerce a parsed-row into a canonical trade record. Returns null if essential fields are missing. */
function normalizeTrade(row) {
  const sym = row.symbol || row.tradingsymbol || row.scrip || '';
  const qty = parseFloat(row.quantity || row.qty || row.filled_quantity || '');
  const px  = parseFloat(row.price || row.average_price || row.fill_price || '');
  if (!sym || !Number.isFinite(qty) || !Number.isFinite(px)) return null;
  const sideRaw = String(row.trade_type || row.transaction_type || row.side || '').toUpperCase();
  const side = sideRaw.startsWith('S') ? 'SELL' : 'BUY';
  return {
    symbol: sym.trim().toUpperCase(),
    side,
    qty: Math.abs(qty),
    price: px,
    tradeId: row.trade_id || row.id || '',
    orderId: row.order_id || row.broker_order_id || '',
    ts:      row.execution_time || row.order_execution_time || row.trade_date || '',
    rawSymbol: sym,
  };
}

/**
 * Reconcile uploaded CSV against backend's known orders.
 * @param {string} csvText
 * @param {Array} backendOrders   list of orders backend believes exist (paper or live)
 * @returns {object} { parsed, matched, onlyInCsv, onlyInBackend }
 */
function reconcileCsv(csvText, backendOrders = []) {
  const rows = parseCsv(csvText);
  const csvTrades = rows.map(normalizeTrade).filter(Boolean);

  // Index backend orders by (symbol, side, qty) -- approximate match
  const beIdx = new Map();
  for (const o of backendOrders) {
    const key = `${(o.symbol||'').toUpperCase()}|${o.side}|${o.qty}`;
    if (!beIdx.has(key)) beIdx.set(key, []);
    beIdx.get(key).push(o);
  }
  const usedBackend = new Set();
  const matched = [];
  const onlyInCsv = [];
  for (const t of csvTrades) {
    const key = `${t.symbol}|${t.side}|${t.qty}`;
    const candidates = beIdx.get(key) || [];
    const free = candidates.find(o => !usedBackend.has(o.id));
    if (free) {
      usedBackend.add(free.id);
      matched.push({ csv: t, backend: free });
    } else {
      onlyInCsv.push(t);
    }
  }
  const onlyInBackend = backendOrders.filter(o => !usedBackend.has(o.id) && (o.status === 'FILLED' || o.status === 'COMPLETE'));

  return {
    parsed: csvTrades.length,
    matched: matched.length,
    onlyInCsv,
    onlyInBackend,
    summary: {
      matchedCount: matched.length,
      onlyInCsvCount: onlyInCsv.length,
      onlyInBackendCount: onlyInBackend.length,
      totalCsvTrades: csvTrades.length,
      totalBackendOrders: backendOrders.length,
    },
  };
}

module.exports = { parseCsv, normalizeTrade, reconcileCsv };
