// Unit tests for news.js -- RSS news ingestion + symbol tagging.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { NewsFeed } = require('../news');

const tmp = () => path.join('/tmp', 'news-test-' + Math.random().toString(36).slice(2) + '.json');
const wl  = (symbols) => ({ list: () => symbols });

test('RSS 2.0 parser extracts title, link, pubDate, description', () => {
  const n = new NewsFeed({ watchlist: wl([]), storePath: tmp() });
  const xml = `<?xml version="1.0"?>
<rss><channel>
<item>
  <title>RELIANCE shares jump 5%</title>
  <link>https://example.com/a</link>
  <pubDate>Wed, 14 May 2026 10:00:00 +0530</pubDate>
  <description><![CDATA[Strong Q4 numbers]]></description>
</item>
</channel></rss>`;
  const items = n._parseXml(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'RELIANCE shares jump 5%');
  assert.equal(items[0].link, 'https://example.com/a');
  assert.equal(items[0].summary, 'Strong Q4 numbers');
  assert.match(items[0].pubDate, /^2026-/);
});

test('Atom feed parsing also works', () => {
  const n = new NewsFeed({ watchlist: wl([]), storePath: tmp() });
  const xml = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<entry>
  <title>NIFTY closes higher</title>
  <link href="https://example.com/n"/>
  <published>2026-05-14T10:00:00Z</published>
  <summary>Index up 1%</summary>
</entry>
</feed>`;
  const items = n._parseXml(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'NIFTY closes higher');
  assert.equal(items[0].link, 'https://example.com/n');
});

test('HTML entity decoding in titles', () => {
  const n = new NewsFeed({ watchlist: wl([]), storePath: tmp() });
  const xml = `<rss><channel><item><title>Bharti &amp; Reliance vs Adani</title><link>https://x</link></item></channel></rss>`;
  const items = n._parseXml(xml);
  assert.equal(items[0].title, 'Bharti & Reliance vs Adani');
});

test('symbol tagging matches whole words only', () => {
  const n = new NewsFeed({ watchlist: wl(['RELIANCE', 'INFY', 'TCS', 'NIFTY']), storePath: tmp() });
  const tag = (title) => n._tagSymbols({ title, summary: '' });
  assert.deepEqual(tag('RELIANCE hits high'), ['RELIANCE']);
  assert.deepEqual(tag('IT trio INFY, TCS and Wipro report').sort(), ['INFY', 'TCS']);
  assert.deepEqual(tag('NIFTY closes flat'), ['NIFTY']);
  // word boundary -- "INFYT" should NOT match INFY
  assert.deepEqual(tag('INFYTECHFEEDBACK is not real'), []);
  // case insensitive
  assert.deepEqual(tag('reliance reports earnings'), ['RELIANCE']);
});

test('symbol tagging searches title + summary', () => {
  const n = new NewsFeed({ watchlist: wl(['TCS']), storePath: tmp() });
  const tag = (title, summary) => n._tagSymbols({ title, summary });
  assert.deepEqual(tag('IT sector update', 'TCS announces buyback'), ['TCS']);
});

test('_clean strips HTML tags and decodes entities', () => {
  const n = new NewsFeed({ watchlist: wl([]), storePath: tmp() });
  assert.equal(n._clean('<p>Hello&nbsp;world</p>'), 'Hello world');
  assert.equal(n._clean('a &lt;b&gt; c &amp; d &quot;e&quot;'), 'a <b> c & d "e"');
  assert.equal(n._clean('  multi   space  '), 'multi space');
});

test('_idFor is deterministic + short', () => {
  const n = new NewsFeed({ watchlist: wl([]), storePath: tmp() });
  const id1 = n._idFor('https://example.com/a');
  const id2 = n._idFor('https://example.com/a');
  const id3 = n._idFor('https://example.com/b');
  assert.equal(id1, id2);
  assert.notEqual(id1, id3);
  assert.equal(id1.length, 16);
});

test('list() filters by symbol and source', () => {
  const n = new NewsFeed({ watchlist: wl([]), storePath: tmp() });
  n._items = [
    { id: '1', source: 'A', title: 'a', symbols: ['RELIANCE'], pubDate: '2026-05-14' },
    { id: '2', source: 'B', title: 'b', symbols: [], pubDate: '2026-05-13' },
    { id: '3', source: 'A', title: 'c', symbols: ['TCS', 'INFY'], pubDate: '2026-05-12' },
  ];
  assert.equal(n.list({}).length, 3);
  assert.equal(n.list({ symbol: 'RELIANCE' }).length, 1);
  assert.equal(n.list({ symbol: 'INFY' }).length, 1);
  assert.equal(n.list({ source: 'A' }).length, 2);
  assert.equal(n.list({ source: 'A', symbol: 'RELIANCE' }).length, 1);
  assert.equal(n.list({ limit: 2 }).length, 2);
});

test('stats() returns counts + sources', () => {
  const n = new NewsFeed({ watchlist: wl([]), storePath: tmp() });
  n._items = [
    { id: '1', symbols: ['RELIANCE'] },
    { id: '2', symbols: [] },
    { id: '3', symbols: ['TCS'] },
  ];
  const s = n.stats();
  assert.equal(s.count, 3);
  assert.equal(s.taggedCount, 2);
  assert.deepEqual(s.sources, ['Moneycontrol', 'Mint Markets', 'ET Markets']);
});

test('persistence round-trip', () => {
  const store = tmp();
  const n1 = new NewsFeed({ watchlist: wl([]), storePath: store });
  n1._items = [{ id: 'abc', title: 't', symbols: [], pubDate: '2026-05-14' }];
  n1._lastFetchAt = '2026-05-14T10:00:00Z';
  n1._persist();
  const n2 = new NewsFeed({ watchlist: wl([]), storePath: store });
  n2.load();
  assert.equal(n2._items.length, 1);
  assert.equal(n2._items[0].id, 'abc');
  fs.unlinkSync(store);
});
