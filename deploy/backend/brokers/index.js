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

  if (which === 'upstox') {
    const { UpstoxBroker } = require('./upstox-broker');
    return new UpstoxBroker({
      apiKey:       env.UPSTOX_API_KEY,
      apiSecret:    env.UPSTOX_API_SECRET,
      accessToken:  env.UPSTOX_ACCESS_TOKEN,
      redirectUrl:  env.UPSTOX_REDIRECT_URL,
    });
  }

  // Tier 29: DhanHQ adapter
  if (which === 'dhan') {
    const { DhanBroker } = require('./dhan-broker');
    return new DhanBroker({
      apiKey:      env.DHAN_API_KEY,
      accessToken: env.DHAN_ACCESS_TOKEN,
      clientId:    env.DHAN_CLIENT_ID,
    });
  }

  // Tier 29: AngelOne SmartAPI adapter
  if (which === 'angelone' || which === 'angel') {
    const { AngelOneBroker } = require('./angelone-broker');
    return new AngelOneBroker({
      apiKey:       env.ANGELONE_API_KEY,
      clientCode:   env.ANGELONE_CLIENT_CODE,
      password:     env.ANGELONE_PASSWORD,
      totpSecret:   env.ANGELONE_TOTP_SECRET,
      jwtToken:     env.ANGELONE_JWT_TOKEN,
      refreshToken: env.ANGELONE_REFRESH_TOKEN,
      feedToken:    env.ANGELONE_FEED_TOKEN,
    });
  }

  throw new Error(`unknown BROKER="${which}". Use "mock", "zerodha", "upstox", "dhan", or "angelone".`);
}

module.exports = { createBroker };
