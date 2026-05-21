// T-280 -- Market regime detector (Phase 3 of the vision doc).
//
// Classifies the current market into one of five regimes from public inputs
// the existing broker connection already serves:
//   - NIFTY 50 close, 50-day MA, 200-day MA  (trend direction + strength)
//   - India VIX level                         (volatility regime)
//   - NIFTY ATR(14) / price                   (realised volatility)
//
// This is the v1 cut. Future inputs (T-280b): FII net flow, advance/decline,
// high-low expansion, Hindenburg Omen. Each addition raises the classifier
// accuracy and pushes the confidence scale up.
//
// Output:
//   { regime: 'bull'|'bear'|'neutral'|'volatile'|'crisis',
//     confidence: 0..1,
//     inputs:    { niftyClose, sma50, sma200, vix, atrPct, trendUp, trendStrong },
//     reasoning: [ "NIFTY > SMA50 > SMA200 -> uptrend", "VIX < 14 -> low vol", ... ],
//     asOf:      ISO timestamp,
//   }
//
// Regime rules (simple, tuned for Indian large-cap intraday/swing):
//
//   crisis:    VIX > 30 OR ATR% > 3.5 (extreme stress)
//   volatile:  VIX > 22 OR ATR% > 2.2
//   bull:      close > sma50 > sma200 AND VIX < 18 (trending up, calm)
//   bear:      close < sma50 < sma200 AND VIX > 16 (trending down)
//   neutral:   everything else (range-bound or noise)
//
// Caller pattern:
//   const rd = createRegimeDetector({ broker });
//   const r  = await rd.detect();               // computes from live data
//   const cached = rd.cachedDetect();           // 5-minute TTL
//   const recent = rd.history(50);              // last 50 classifications

'use strict';

const TTL_MS = 5 * 60 * 1000;        // 5-min cache TTL
const HISTORY_MAX = 200;             // keep last 200 classifications

function createRegimeDetector({ broker, audit }) {
  if (!broker) throw new Error('createRegimeDetector: broker required');
  const _audit = audit || (() => {});
  let _cache = null;
  const _history = [];

  // ---- Indicator math (no external deps) ----
  function _sma(values, period) {
    if (!Array.isArray(values) || values.length < period) return null;
    const slice = values.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / period;
  }

  function _atr(candles, period = 14) {
    if (!Array.isArray(candles) || candles.length < period + 1) return null;
    const trs = [];
    for (let i = 1; i < candles.length; i++) {
      const h = candles[i].high, l = candles[i].low, pc = candles[i - 1].close;
      trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    }
    const slice = trs.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / period;
  }

  // ---- Live data fetchers ----
  async function _fetchNifty() {
    // 250 days gives us plenty of room for SMA200 + ATR14.
    const to = new Date();
    const from = new Date(to.getTime() - 365 * 86400 * 1000);
    const candles = await broker.getHistorical({
      symbol: 'NIFTY 50',
      interval: 'day',
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
    });
    if (!Array.isArray(candles) || candles.length < 200) {
      throw new Error(`NIFTY 50 daily candles insufficient: got ${candles ? candles.length : 0}, need 200+`);
    }
    return candles;
  }

  async function _fetchVix() {
    // India VIX is an NSE index, exposed by Kite as "INDIA VIX" or via the
    // standard quote endpoint. We try a couple of common shapes and fall back
    // to null if none work -- the classifier degrades gracefully when VIX is
    // unavailable (relies on ATR% only for vol).
    const candidates = ['INDIA VIX', 'NSE:INDIA VIX', 'INDIAVIX'];
    for (const sym of candidates) {
      try {
        if (typeof broker.getQuote === 'function') {
          const q = await broker.getQuote(sym);
          if (q && Number.isFinite(q.last_price)) return Number(q.last_price);
          if (q && Number.isFinite(q.ltp))        return Number(q.ltp);
        }
      } catch (_) { /* try next */ }
    }
    return null;
  }

  function _classify({ niftyClose, sma50, sma200, vix, atrPct }) {
    const reasoning = [];
    const trendUp     = (sma50 != null && sma200 != null && niftyClose > sma50 && sma50 > sma200);
    const trendDown   = (sma50 != null && sma200 != null && niftyClose < sma50 && sma50 < sma200);
    const trendStrong = (sma50 != null && sma200 != null && Math.abs(sma50 - sma200) / sma200 > 0.02);

    // Crisis tier
    if ((vix != null && vix > 30) || (atrPct != null && atrPct > 3.5)) {
      reasoning.push(`crisis trigger: VIX=${vix} or ATR%=${atrPct?.toFixed(2)}`);
      return { regime: 'crisis', confidence: 0.95, trendUp, trendStrong, reasoning };
    }

    // Volatile tier
    if ((vix != null && vix > 22) || (atrPct != null && atrPct > 2.2)) {
      reasoning.push(`elevated vol: VIX=${vix}, ATR%=${atrPct?.toFixed(2)}`);
      // Direction within volatile still matters
      let dir = '';
      if (trendUp)        { dir = ' (trending up)'; reasoning.push('but SMA50>SMA200 -> still up'); }
      else if (trendDown) { dir = ' (trending down)'; reasoning.push('and SMA50<SMA200 -> down'); }
      return { regime: 'volatile', confidence: 0.80, trendUp, trendStrong, reasoning, subregime: dir.trim() || null };
    }

    // Calm bull
    if (trendUp && (vix == null || vix < 18)) {
      reasoning.push('NIFTY > SMA50 > SMA200, VIX calm -> bull');
      const confidence = trendStrong ? 0.85 : 0.65;
      return { regime: 'bull', confidence, trendUp: true, trendStrong, reasoning };
    }

    // Bear with elevated VIX
    if (trendDown && (vix == null || vix > 16)) {
      reasoning.push('NIFTY < SMA50 < SMA200, VIX risk-off -> bear');
      const confidence = trendStrong ? 0.85 : 0.65;
      return { regime: 'bear', confidence, trendDown: true, trendStrong, reasoning };
    }

    // Default: neutral / range-bound
    reasoning.push('no strong trend or vol signal -> neutral / range-bound');
    return { regime: 'neutral', confidence: 0.55, trendUp, trendStrong, reasoning };
  }

  async function detect() {
    const t0 = Date.now();
    try {
      const candles = await _fetchNifty();
      const closes = candles.map(c => Number(c.close));
      const niftyClose = closes[closes.length - 1];
      const sma50 = _sma(closes, 50);
      const sma200 = _sma(closes, 200);
      const atr14 = _atr(candles, 14);
      const atrPct = (atr14 != null && niftyClose > 0) ? (atr14 / niftyClose) * 100 : null;
      const vix = await _fetchVix();

      const inputs = {
        niftyClose: _round(niftyClose, 2),
        sma50:      sma50 != null ? _round(sma50, 2) : null,
        sma200:     sma200 != null ? _round(sma200, 2) : null,
        vix:        vix != null ? _round(vix, 2) : null,
        atrPct:     atrPct != null ? _round(atrPct, 2) : null,
      };

      const cls = _classify(inputs);
      const result = {
        regime: cls.regime,
        confidence: cls.confidence,
        subregime: cls.subregime || null,
        inputs,
        trendUp: !!cls.trendUp,
        trendDown: !!cls.trendDown,
        trendStrong: !!cls.trendStrong,
        reasoning: cls.reasoning,
        asOf: new Date().toISOString(),
        computedMs: Date.now() - t0,
        _schema: 'regime-detector-v1',
      };
      _cache = { value: result, exp: Date.now() + TTL_MS };
      _history.push(result);
      if (_history.length > HISTORY_MAX) _history.shift();
      _audit('regime.detect', { regime: result.regime, confidence: result.confidence });
      return result;
    } catch (e) {
      _audit('regime.detect.failed', { msg: e.message });
      throw e;
    }
  }

  function cachedDetect() {
    if (_cache && _cache.exp > Date.now()) return Promise.resolve(_cache.value);
    return detect();
  }

  function history(n = 50) {
    return _history.slice(-Math.max(1, Math.min(HISTORY_MAX, n))).reverse();
  }

  return { detect, cachedDetect, history, _classify };
}

function _round(n, places = 2) {
  const m = Math.pow(10, places);
  return Math.round(n * m) / m;
}

module.exports = { createRegimeDetector };
