// quote.js -- T-402 (architecture audit #1, server.js god-object split #21).
//
// Three read-only market-data quote endpoints. All use the GLOBAL broker
// because quotes are market data (not user-isolated). User-scoped routes
// like /api/orders use resolveUserBroker; these intentionally don't.
//
//   - GET /api/symbols              -- broker's known symbol list (falls back to DEFAULT_SYMBOLS)
//   - GET /api/quote/:symbol        -- single-symbol quote
//   - GET /api/quotes?symbols=A,B,C -- bulk quote
//
// Public API
// ==========
//   const { mountQuoteRoutes } = require('./routes/quote');
//   mountQuoteRoutes(app, { getBroker, DEFAULT_SYMBOLS });

'use strict';

function mountQuoteRoutes(app, deps) {
  const { getBroker, DEFAULT_SYMBOLS } = deps;
  if (typeof getBroker !== 'function') throw new Error('quote: getBroker getter required');
  if (!Array.isArray(DEFAULT_SYMBOLS)) throw new Error('quote: DEFAULT_SYMBOLS array required');

  app.get('/api/symbols', async (_req, res) => {
    const broker = getBroker();
    const syms = await broker.listSymbols();
    res.json({ ok: true, symbols: syms.length ? syms : DEFAULT_SYMBOLS });
  });

  app.get('/api/quote/:symbol', async (req, res) => {
    const broker = getBroker();
    try {
      const q = await broker.getQuote(req.params.symbol);
      res.json({ ok: true, symbol: req.params.symbol, ...q });
    } catch (e) {
      res.status(404).json({ ok: false, reason: e.message });
    }
  });

  // /api/quotes?symbols=RELIANCE,INFY,TCS
  app.get('/api/quotes', async (req, res) => {
    const broker = getBroker();
    try {
      const raw = (req.query.symbols || '').toString();
      const symbols = raw.split(',').map(s => s.trim()).filter(Boolean);
      if (symbols.length === 0) return res.status(400).json({ ok: false, reason: 'no_symbols' });
      const data = await broker.getQuotes(symbols);
      res.json({ ok: true, quotes: data });
    } catch (e) {
      res.status(500).json({ ok: false, reason: e.message });
    }
  });
}

module.exports = { mountQuoteRoutes };
