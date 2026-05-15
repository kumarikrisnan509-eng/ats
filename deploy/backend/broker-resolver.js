// broker-resolver.js -- Tier 58: per-user broker instance routing.
//
// Each authenticated user can have their own broker_accounts row with sealed credentials.
// This module:
//   1. Looks up the user's default broker row in DB
//   2. Unseals the credentials via the vault
//   3. Instantiates a per-user broker adapter (ZerodhaBroker / DhanBroker / etc.)
//   4. Caches the instance with LRU eviction to bound memory under high user counts
//   5. Returns null if no broker is connected (caller should respond with empty data + flag)
//
// Design notes:
//   - The shared global broker (legacy) is STILL used for system services that aren't
//     user-specific: market data ticker (one WS for everyone), instrument master refresh,
//     daily scanner. Those services are admin-grade and run with env-var credentials.
//   - User-facing REST routes (/api/portfolio/*, /api/orders, /api/quote) now route through
//     here: if the user has their own broker connected, use that; else return empty + flag.
//   - We never expose unsealed credentials anywhere outside this module. Even cached
//     instances hold the raw access_token in memory only, never logged.

'use strict';

const MAX_CACHE = 256;                       // upper bound on simultaneously-cached user brokers
const TTL_MS    = 60 * 60 * 1000;            // 1 hour -- forces a re-unseal after that to pick up rotations

/** @type {Map<number, {broker: object, createdAt: number, lastUsedAt: number}>} */
const cache = new Map();

function evictIfNeeded() {
  while (cache.size > MAX_CACHE) {
    // Find LRU entry
    let oldestUid = null;
    let oldestTs = Infinity;
    for (const [uid, entry] of cache.entries()) {
      if (entry.lastUsedAt < oldestTs) { oldestTs = entry.lastUsedAt; oldestUid = uid; }
    }
    if (oldestUid != null) cache.delete(oldestUid);
    else break;
  }
}

/**
 * Build a per-user broker instance from the DB row + vault.
 * Returns null if the row is incomplete (missing api_key or access_token).
 *
 * @param {object} row     broker_accounts row (from db.brokers.getFull)
 * @param {object} vault   crypto-vault.Vault instance
 * @param {object} deps    optional injected ctor for testing
 */
async function buildBroker(row, vault, deps = {}) {
  if (!row || !row.broker) return null;
  const broker = String(row.broker).toLowerCase();

  // Unseal credentials
  const apiKey      = row.api_key       ? await vault.open(row.api_key)       : null;
  const apiSecret   = row.refresh_token ? await vault.open(row.refresh_token) : null; // per Tier 57 convention
  const accessToken = row.access_token  ? await vault.open(row.access_token)  : null;

  if (!apiKey) return null;

  if (broker === 'zerodha') {
    // Lazy-require to avoid hard dependency when only mock is used in tests
    const { ZerodhaBroker } = deps.ZerodhaBroker
      ? { ZerodhaBroker: deps.ZerodhaBroker }
      : require('./brokers/zerodha-broker');
    const b = new ZerodhaBroker({
      apiKey,
      apiSecret: apiSecret || '',
      redirectUrl: process.env.ZERODHA_REDIRECT_URL || process.env.KITE_REDIRECT_URL,
      instrumentsCachePath: process.env.INSTRUMENTS_CACHE_PATH || '/var/lib/ats/tokens/_instruments-cache.json',
    });
    if (accessToken) b.setAccessToken(accessToken);
    return b;
  }

  // TODO: dhan, angelone, upstox -- adapters exist server-side; wire them when needed
  return null;
}

/**
 * Get or create a per-user broker.
 *
 * @param {object} deps
 * @param {object} deps.db       db.js repo (must have brokers.getByBroker)
 * @param {object} deps.vault    crypto-vault.Vault
 * @param {number} userId
 * @returns {Promise<object|null>}  broker instance or null if user has none connected
 */
async function getBrokerForUser({ db, vault }, userId) {
  if (!userId || !db || !vault) return null;

  const cached = cache.get(userId);
  const now = Date.now();
  if (cached && (now - cached.createdAt) < TTL_MS) {
    cached.lastUsedAt = now;
    return cached.broker;
  }

  // Fresh build
  const list = db.brokers.list(userId);
  const defaultRow = list.find(r => r.is_default) || list[0];
  if (!defaultRow) return null;

  const fullRow = db.brokers.getFull(userId, defaultRow.id);
  if (!fullRow) return null;

  const broker = await module.exports.buildBroker(fullRow, vault);
  if (!broker) return null;

  cache.set(userId, { broker, createdAt: now, lastUsedAt: now });
  evictIfNeeded();
  return broker;
}

/**
 * Invalidate a user's cached broker (e.g. after they update credentials).
 */
function invalidate(userId) {
  cache.delete(userId);
}

/**
 * Resolve the broker for an Express request.
 * - If user has own broker connected, return that.
 * - Else fall back to the provided global broker (admin / legacy).
 * - Returns { broker, isUserOwn } so callers can flag which one they used.
 */
async function resolveForRequest({ db, vault, globalBroker, fallbackToGlobal = false }, req) {
  if (req && req.user && req.user.id) {
    const own = await getBrokerForUser({ db, vault }, req.user.id);
    if (own) return { broker: own, isUserOwn: true };
  }
  if (fallbackToGlobal) return { broker: globalBroker || null, isUserOwn: false };
  return { broker: null, isUserOwn: false };
}

function _statsForTest() {
  return { size: cache.size, keys: Array.from(cache.keys()) };
}

function _clearForTest() { cache.clear(); }

module.exports = {
  getBrokerForUser,
  invalidate,
  resolveForRequest,
  buildBroker,
  _statsForTest,
  _clearForTest,
};
