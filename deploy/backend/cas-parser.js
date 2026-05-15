// cas-parser.js -- Tier 46: parse NSDL/CDSL CAS PDF for MF/ETF holdings.
//
// CAS (Consolidated Account Statement) is the monthly PDF emailed by NSDL/CDSL
// that lists all demat + MF holdings across folios. Parsing it gives us the
// MF/ETF position data the broker APIs don't expose (Kite has no MF holdings
// endpoint; CAMS/Karvy are paid API and India-only).
//
// This module is a TEXT-BASED parser. It does NOT use a PDF library -- it
// expects the caller to extract text with `pdftotext` or similar (every
// Linux distro ships it) and pass the resulting string in. That keeps the
// dependency surface tiny and the parsing testable with fixed strings.
//
// What we extract:
//   - PAN, statement period, total value
//   - For each folio: AMC name, folio number, scheme name, units, NAV, value
//
// Public API:
//   const out = parseCASText(textContent);
//   -> {
//        pan, period: { from, to },
//        totalValue, folios: [{ amc, folioNo, schemes: [{ name, isin, units, nav, value, costValue, pnl }] }]
//      }

'use strict';

function parseAmount(s) {
  if (!s) return 0;
  // Indian-format: 1,23,456.78 or '(1,234.56)' for negative
  let str = String(s).trim();
  const neg = str.startsWith('(') && str.endsWith(')');
  // Strip parens, commas, whitespace, currency markers (Rs., INR, Rupee sign).
  str = str
    .replace(/[(),\s]/g, '')
    .replace(/\u20B9/g, '')             // ₹
    .replace(/^Rs\.?/i, '')
    .replace(/^INR/i, '')
    .replace(/[^\d.\-]/g, '');         // anything left over (NOT '.' or digits)
  const n = parseFloat(str);
  if (!Number.isFinite(n)) return 0;
  return neg ? -n : n;
}

function parseCASText(text) {
  if (typeof text !== 'string' || text.length < 100) {
    return { error: 'CAS text too short or missing', pan: '', period: { from: null, to: null }, totalValue: 0, folios: [] };
  }
  const out = {
    pan: '', period: { from: null, to: null },
    totalValue: 0, folios: [],
  };

  // --- PAN ---
  const panMatch = text.match(/\bPAN\s*[:\-]?\s*([A-Z]{5}[0-9]{4}[A-Z])\b/i);
  if (panMatch) out.pan = panMatch[1].toUpperCase();

  // --- Period ---
  const period = text.match(/Statement\s+for\s+the\s+period\s+(?:from\s+)?(\d{1,2}[\-\/\s\.][A-Z][a-z]+[\-\/\s\.]\d{4}|\d{4}-\d{2}-\d{2})\s+(?:to|-)\s+(\d{1,2}[\-\/\s\.][A-Z][a-z]+[\-\/\s\.]\d{4}|\d{4}-\d{2}-\d{2})/i);
  if (period) {
    out.period = { from: period[1].trim(), to: period[2].trim() };
  }

  // --- Total value ---
  const total = text.match(/(?:Total\s+(?:Portfolio\s+)?Value|Grand\s+Total)\s*[:\-]?\s*(?:INR|Rs\.?|₹)?\s*([\d,]+\.\d{2})/i);
  if (total) out.totalValue = parseAmount(total[1]);

  // --- Folios + schemes ---
  // CAS format varies by RTA (CAMS vs Karvy). We parse a normalized line shape:
  //   AMC NAME ... Folio No: XXXX
  //   <scheme name> ISIN: INFxxxYYY  Units: 123.456 NAV: 99.99 Value: 12,345.67
  const lines = text.split(/\r?\n/);
  let currentFolio = null;
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];

    // New folio line. Example: "Folio No: 12345678 / 99"
    const folioM = L.match(/Folio\s+No\.?\s*[:\-]?\s*([A-Z0-9]+(?:\s*[\/\-]\s*[A-Z0-9]+)*)/i);
    if (folioM) {
      // Try to grab AMC name from previous non-empty line
      let amc = '';
      for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
        const prev = (lines[j] || '').trim();
        if (prev && !/^\s*$/.test(prev) && !prev.toLowerCase().startsWith('folio')) { amc = prev; break; }
      }
      currentFolio = { amc, folioNo: folioM[1].replace(/\s+/g, ''), schemes: [] };
      out.folios.push(currentFolio);
      continue;
    }

    // Scheme line. Look for ISIN INF[A-Z0-9]{9} which only mutual funds use.
    const isinM = L.match(/\b(INF[A-Z0-9]{9})\b/);
    if (isinM && currentFolio) {
      // Extract Units, NAV, Value via separate regexes; tolerant of order.
      const unitsM  = L.match(/Units?\s*[:\-]?\s*([\d,]+\.\d+)/i);
      const navM    = L.match(/NAV\s*[:\-]?\s*([\d,]+\.\d+)/i);
      const valM    = L.match(/Value\s*[:\-]?\s*(?:INR|Rs\.?|₹)?\s*([\d,]+\.\d{2})/i);
      const costM   = L.match(/Cost\s*[:\-]?\s*(?:INR|Rs\.?|₹)?\s*([\d,]+\.\d{2})/i);

      // Best-effort scheme name: text before the ISIN, with cruft trimmed.
      const nameEnd = L.indexOf(isinM[1]);
      let name = L.slice(0, nameEnd).trim();
      name = name.replace(/\s{2,}/g, ' ').replace(/^[-\s]+|[-\s]+$/g, '');
      // If nothing on this line, look at the preceding line.
      if (!name && i > 0) name = lines[i - 1].trim();

      const units = parseAmount(unitsM && unitsM[1]);
      const nav   = parseAmount(navM   && navM[1]);
      const value = parseAmount(valM   && valM[1]);
      const cost  = parseAmount(costM  && costM[1]);
      const pnl   = cost ? value - cost : 0;

      currentFolio.schemes.push({
        name: name || '(unparsed)',
        isin: isinM[1],
        units, nav, value, costValue: cost, pnl,
      });
    }
  }

  // If totalValue wasn't found in header, sum scheme values as fallback
  if (out.totalValue === 0) {
    out.totalValue = out.folios.reduce((s, f) => s + f.schemes.reduce((a, b) => a + b.value, 0), 0);
  }

  return out;
}

module.exports = { parseCASText, parseAmount };
