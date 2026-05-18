// scanner-plugins/index.js — T-162 G0: scanner plugin registry + base interface.
//
// v11 master plan calls for G0-G10: 11 multi-style scanners. Instead of
// adding 11 if-branches to scanner.js, this is the pluggable framework:
// each scanning style is its own file in scanner-plugins/, exports a
// {name, label, evaluate(bars, ctx)} object, and gets auto-registered.
//
// Plugin contract:
//   evaluate(bars, ctx) → { hit: boolean, score?: number, note?: string } | null
//
//   bars = Array<{t, o, h, l, c, v}>   (ohlc candles, oldest-first)
//   ctx  = { symbol, sector?, surveillance?, blackout? }  (shared context)
//
//   Return null when there isn't enough data to evaluate.
//
// Add a new plugin: create scanner-plugins/g<N>-<name>.js exporting a
// plugin object. It will be auto-loaded by listPlugins() below.

'use strict';

const fs = require('fs');
const path = require('path');

let _cached = null;

/**
 * Discover and load all scanner plugins in this directory.
 * Cached after first call.
 */
function listPlugins() {
  if (_cached) return _cached;
  const out = [];
  for (const f of fs.readdirSync(__dirname).sort()) {
    if (f === 'index.js') continue;
    if (!f.endsWith('.js')) continue;
    try {
      const mod = require(path.join(__dirname, f));
      if (mod && typeof mod.evaluate === 'function' && typeof mod.name === 'string') {
        out.push(mod);
      }
    } catch (e) {
      console.warn('[scanner-plugins] failed to load', f, ':', e.message);
    }
  }
  _cached = out;
  return out;
}

/**
 * Run every registered plugin against a single symbol's bars. Returns the
 * array of hits (only plugins where evaluate() returned {hit: true}).
 *
 * @param {Array} bars   ohlc candles, oldest-first
 * @param {object} ctx   shared context (symbol, sector, surveillance, blackout)
 * @returns {Array<{plugin: string, label: string, score?: number, note?: string}>}
 */
function runAll(bars, ctx) {
  const hits = [];
  for (const p of listPlugins()) {
    try {
      const r = p.evaluate(bars, ctx);
      if (r && r.hit) {
        hits.push({ plugin: p.name, label: p.label, score: r.score, note: r.note });
      }
    } catch (e) {
      // A buggy plugin must not crash the scanner loop.
      console.warn(`[scanner-plugins] ${p.name} threw:`, e && e.message);
    }
  }
  return hits;
}

/** For tests — reset the cache between runs. */
function _resetForTests() {
  _cached = null;
}

module.exports = { listPlugins, runAll, _resetForTests };
