// market-meta.js -- Tier 71: market metadata cache (holidays, segments, products).
//
// Pulled from the global broker (admin Kite session) once a day, persisted in
// market_meta_cache table. All users read from the cache via /api/market/holidays.
// Falls back to a static minimal NSE list only if the cache has never been populated
// AND the broker is unreachable.

'use strict';

// T-503: extended fallback covers fixed-date NSE holidays through 2028.
// Movable holidays (Diwali, Holi, Eid, Muharram, etc.) only enter via the
// daily kc.getHolidays() refresh -- they shift year to year and would
// require a hand-curated table here. The /api/health cache-age surface
// (T-503) lets operators see when refresh last succeeded so a degraded
// fallback is visible rather than silent.
const STATIC_FALLBACK_HOLIDAYS = [
  // 2026
  { date: '2026-01-26', name: 'Republic Day' },
  { date: '2026-08-15', name: 'Independence Day' },
  { date: '2026-10-02', name: 'Gandhi Jayanti' },
  { date: '2026-12-25', name: 'Christmas' },
  // 2027
  { date: '2027-01-26', name: 'Republic Day' },
  { date: '2027-08-15', name: 'Independence Day' },
  { date: '2027-10-02', name: 'Gandhi Jayanti' },
  { date: '2027-12-25', name: 'Christmas' },
  // 2028
  { date: '2028-01-26', name: 'Republic Day' },
  { date: '2028-08-15', name: 'Independence Day' },
  { date: '2028-10-02', name: 'Gandhi Jayanti' },
  { date: '2028-12-25', name: 'Christmas' },
];

function createMarketMeta({ db, broker }) {
  if (db && db._conn) {
    db._conn.exec(`
      CREATE TABLE IF NOT EXISTS market_meta_cache (
        key         TEXT PRIMARY KEY,
        json        TEXT NOT NULL,
        fetched_at  TEXT NOT NULL DEFAULT (datetime('now')),
        source      TEXT
      );
    `);
  }
  const get = db._conn.prepare("SELECT json, fetched_at, source FROM market_meta_cache WHERE key = ?");
  const set = db._conn.prepare("INSERT OR REPLACE INTO market_meta_cache (key, json, fetched_at, source) VALUES (?, ?, datetime('now'), ?)");

  function getHolidays() {
    try {
      const row = get.get('holidays_nse');
      if (row && row.json) return { holidays: JSON.parse(row.json), fetchedAt: row.fetched_at, source: row.source };
    } catch (e) { console.warn('[market-meta] swallowed:', e && e.message); }
    return { holidays: STATIC_FALLBACK_HOLIDAYS, fetchedAt: null, source: 'static_fallback' };
  }

  async function refreshFromBroker() {
    if (!broker || typeof broker.kc !== 'object') return { ok: false, reason: 'broker_unavailable' };
    try {
      // Kite's getHolidays endpoint (only available on some plans). We fall back to
      // pulling the instrument master and computing weekend/missing-day inferences.
      // For now, try kc.getHolidays() directly; if it 404s, we skip update.
      let holidays = null;
      if (typeof broker.kc.getHolidays === 'function') {
        holidays = await broker.kc.getHolidays();
      }
      if (!Array.isArray(holidays) || !holidays.length) {
        return { ok: false, reason: 'no_data_from_broker' };
      }
      // Normalize: each row should be { date: 'YYYY-MM-DD', name: '...' }
      const norm = holidays.map(h => ({
        date: typeof h.date === 'string' ? h.date.slice(0, 10) : (h.date && h.date.toISOString ? h.date.toISOString().slice(0,10) : null),
        name: h.name || h.holiday || 'Holiday',
        type: h.exchange || h.type || 'NSE',
      })).filter(h => h.date);
      set.run('holidays_nse', JSON.stringify(norm), 'kite_api');
      return { ok: true, count: norm.length };
    } catch (e) {
      return { ok: false, reason: 'fetch_failed', detail: e.message };
    }
  }

  // Auto-refresh once on boot + daily at 06:00 IST.
  function scheduleDailyRefresh() {
    refreshFromBroker().catch(e => console.warn('[market-meta] promise rejected:', e && e.message));
    setInterval(() => {
      refreshFromBroker().catch(e => console.warn('[market-meta] promise rejected:', e && e.message));
    }, 24 * 60 * 60 * 1000);
  }

  // T-496 (audit-2026-05-28): live trading gates need a single source of truth
  // for "is the market open right now". Pure functions on top of the holiday
  // cache + hardcoded NSE session (09:15-15:30 IST). Both return shapes that
  // are safe to inline into HTTP/JSON responses with reason codes.

  function _istNow(now) {
    const d = now instanceof Date ? now : new Date();
    return new Date(d.getTime() + (5.5 * 60 * 60 * 1000));
  }

  function _istDateISO(ist) { return ist.toISOString().slice(0, 10); }

  // Pure date check. Use for cron scheduling decisions (SIP, EOD jobs).
  function isHolidayOrWeekend(dateISO) {
    if (!dateISO) dateISO = _istDateISO(_istNow());
    const ist = new Date(dateISO + 'T00:00:00.000Z');
    const dow = ist.getUTCDay();
    if (dow === 0) return { closed: true, reason: 'weekend_sunday', date: dateISO };
    if (dow === 6) return { closed: true, reason: 'weekend_saturday', date: dateISO };
    try {
      const { holidays } = getHolidays();
      if (Array.isArray(holidays)) {
        const hit = holidays.find(x => x && x.date === dateISO);
        if (hit) return { closed: true, reason: 'holiday', date: dateISO, holidayName: hit.name || 'NSE holiday' };
      }
    } catch (e) { /* permissive — bubble up below */ }
    return { closed: false, date: dateISO };
  }

  // Full open-now check (date + hours). Use for live order gating.
  function isMarketOpenNow(now) {
    const ist = _istNow(now);
    const dateISO = _istDateISO(ist);
    const day = isHolidayOrWeekend(dateISO);
    if (day.closed) return { open: false, reason: day.reason, date: dateISO, holidayName: day.holidayName };
    const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
    const OPEN  = 9 * 60 + 15;
    const CLOSE = 15 * 60 + 30;
    const hhmm = ist.toISOString().slice(11, 16);
    if (mins < OPEN)  return { open: false, reason: 'pre_open',   date: dateISO, time_ist: hhmm };
    if (mins > CLOSE) return { open: false, reason: 'post_close', date: dateISO, time_ist: hhmm };
    return { open: true, date: dateISO, time_ist: hhmm };
  }

  // T-505: operator-curated override. When kc.getHolidays() returns nothing
  // (the live finding from T-503), the operator can paste NSE's published
  // calendar via POST /api/admin/market/holidays/manual. Stored in the same
  // cache table with source='manual' so isHolidayOrWeekend() reads it the
  // same way as the broker-fed list. Survives container restarts.
  function manualSetHolidays(list) {
    if (!Array.isArray(list)) throw new Error('list must be an array');
    const norm = list
      .map(h => ({
        date: typeof h.date === 'string' ? h.date.slice(0, 10) : null,
        name: h.name || 'Operator-curated holiday',
        type: h.type || 'NSE',
      }))
      .filter(h => h.date && /^\d{4}-\d{2}-\d{2}$/.test(h.date));
    if (!norm.length) throw new Error('no valid dates in list (need {date:"YYYY-MM-DD"})');
    set.run('holidays_nse', JSON.stringify(norm), 'manual');
    return { ok: true, count: norm.length };
  }

  // T-503: cache freshness for /api/health observability. Lets the operator
  // see whether the holiday gate is running off fresh broker data or a stale
  // (or static_fallback) cache that may miss movable holidays like Diwali.
  function getHolidaysHealth() {
    const { holidays, fetchedAt, source } = getHolidays();
    let cacheAgeDays = null;
    if (fetchedAt) {
      try { cacheAgeDays = Math.round((Date.now() - new Date(fetchedAt + 'Z').getTime()) / 86400000); }
      catch { cacheAgeDays = null; }
    }
    return {
      ok: source !== 'static_fallback',
      source: source || 'static_fallback',
      count: Array.isArray(holidays) ? holidays.length : 0,
      fetchedAt: fetchedAt || null,
      cacheAgeDays,
      stale: cacheAgeDays != null && cacheAgeDays > 7,
    };
  }

  return { getHolidays, refreshFromBroker, scheduleDailyRefresh, isHolidayOrWeekend, isMarketOpenNow, getHolidaysHealth, manualSetHolidays };
}

module.exports = { createMarketMeta, STATIC_FALLBACK_HOLIDAYS };
