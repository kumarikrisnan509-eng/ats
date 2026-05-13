// Broker factory — selects an adapter based on env.

const { MockBroker } = require('./mock-broker');

function createBroker(env = process.env) {
  const which = (env.BROKER || 'mock').toLowerCase();

  if (which === 'mock') {
    return new MockBroker();
  }

  if (which === 'zerodha') {
    // Lazy require so missing kiteconnect package doesn't break mock mode.
    const { ZerodhaBroker } = require('./zerodha-broker');
    return new ZerodhaBroker({
      apiKey:               env.ZERODHA_API_KEY      || env.KITE_API_KEY,
      apiSecret:            env.ZERODHA_API_SECRET   || env.KITE_API_SECRET,
      redirectUrl:          env.ZERODHA_REDIRECT_URL || env.KITE_REDIRECT_URL,
      // Cache lives inside the bind-mounted tokens dir (container FS is read-only otherwise).
      // sessions.js correctly skips files starting with "_" so this won't be treated as a user token.
      instrumentsCachePath: env.INSTRUMENTS_CACHE_PATH || '/var/lib/ats/tokens/_instruments-cache.json',
    });
  }

  throw new Error(`unknown BROKER="${which}". Use "mock" or "zerodha".`);
}

module.exports = { createBroker };
