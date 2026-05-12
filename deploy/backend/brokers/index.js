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
      apiKey:      env.ZERODHA_API_KEY,
      apiSecret:   env.ZERODHA_API_SECRET,
      redirectUrl: env.ZERODHA_REDIRECT_URL,
    });
  }

  throw new Error(`unknown BROKER="${which}". Use "mock" or "zerodha".`);
}

module.exports = { createBroker };
