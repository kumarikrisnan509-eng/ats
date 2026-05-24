// news.js -- T-392 (architecture audit #1, server.js god-object split #9).
//
// Three news-feed endpoints:
//   - GET  /api/news?limit=&symbol=&source=   -- list recent items, filtered
//   - POST /api/news/refresh                  -- manual fetch trigger, returns summary
//   - GET  /api/news/sources                  -- configured sources + last-fetch counts
//
// Public API
// ==========
//   const { mountNewsRoutes } = require('./routes/news');
//   mountNewsRoutes(app, { getNews });
//
// `getNews` is a getter because the `news` singleton is lazily initialised
// inside server.js's async init(). Passing a closure avoids stale snapshots.

'use strict';

function mountNewsRoutes(app, deps) {
  const { getNews } = deps;
  if (typeof getNews !== 'function') throw new Error('news: getNews getter required');

  app.get('/api/news', (req, res) => {
    const news = getNews();
    if (!news) return res.status(503).json({ ok: false, reason: 'news_not_initialized' });
    const items = news.list({ limit: req.query.limit, symbol: req.query.symbol, source: req.query.source });
    res.json({ ok: true, items, stats: news.stats() });
  });

  app.post('/api/news/refresh', async (_req, res) => {
    const news = getNews();
    if (!news) return res.status(503).json({ ok: false, reason: 'news_not_initialized' });
    const summary = await news.refresh();
    res.json({ ok: true, summary, stats: news.stats() });
  });

  app.get('/api/news/sources', (_req, res) => {
    const news = getNews();
    if (!news) return res.status(503).json({ ok: false, reason: 'news_not_initialized' });
    res.json({ ok: true, sources: news.stats().sources, lastSummary: news.stats().lastSummary });
  });
}

module.exports = { mountNewsRoutes };
