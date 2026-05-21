#!/usr/bin/env node
// transform.js — JSX -> JS using esbuild's transform.
//
// Two modes:
//   one-shot (default): used by Docker build. Reads SRC, writes to OUT, exits.
//   --watch:            used by scripts/dev-server.js for local dev. Re-transforms
//                       on every file change in SRC.
//
// Input:  src/*.jsx, src/*.css, src/*.js
// Output: out/src/*.js, out/src/*.css (CSS/JS copied unchanged)
//
// We DO NOT bundle. Each .jsx becomes a standalone .js that's still loaded as
// a <script src="..."> tag in app.html. Preserves the existing 52-script
// load-order semantics and all `window.X = X` global pollution.

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const SRC = process.env.SRC_DIR || 'src';
const OUT = process.env.OUT_DIR || 'out/src';
const WATCH = process.argv.includes('--watch');

fs.mkdirSync(OUT, { recursive: true });

function transformOne(name) {
  const full = path.join(SRC, name);
  let stat;
  try { stat = fs.statSync(full); } catch { return null; }
  if (!stat.isFile()) return null;

  if (name.endsWith('.jsx')) {
    const src = fs.readFileSync(full, 'utf8');
    try {
      const result = esbuild.transformSync(src, {
        loader: 'jsx',
        jsxFactory: 'React.createElement',
        jsxFragment: 'React.Fragment',
        target: 'es2020',
      });
      const outName = name.replace(/\.jsx$/, '.js');
      fs.writeFileSync(path.join(OUT, outName), result.code);
      return { name, action: 'transformed', outName, bytes: result.code.length };
    } catch (e) {
      return { name, action: 'failed', error: e.message };
    }
  } else if (name.endsWith('.css') || name.endsWith('.js')) {
    fs.copyFileSync(full, path.join(OUT, name));
    return { name, action: 'copied' };
  }
  return { name, action: 'skipped' };
}

function transformAll() {
  const files = fs.readdirSync(SRC).filter(f => !f.startsWith('.'));
  let transformed = 0, copied = 0, failed = 0;
  for (const f of files) {
    const r = transformOne(f);
    if (!r) continue;
    if (r.action === 'transformed') {
      transformed++;
      if (!WATCH) console.log(`transformed ${r.name} -> ${r.outName}  (${r.bytes} bytes)`);
    } else if (r.action === 'copied') {
      copied++;
      if (!WATCH) console.log(`copied ${r.name}`);
    } else if (r.action === 'failed') {
      failed++;
      console.error(`FAILED to transform ${r.name}: ${r.error}`);
    } else if (!WATCH) {
      console.log(`skipped ${r.name}`);
    }
  }
  return { transformed, copied, failed };
}

// One-shot
const initial = transformAll();
console.log(`[transform] done -- transformed ${initial.transformed} jsx -> js, copied ${initial.copied} other files${initial.failed ? `, failed ${initial.failed}` : ''}`);
if (initial.failed > 0 && !WATCH) process.exit(1);

if (!WATCH) {
  // One-shot mode: exit
  process.exit(0);
}

// Watch mode
console.log(`[transform] watching ${SRC}/ for changes (Ctrl+C to stop)`);
const debounce = new Map();   // file -> timeout id

function scheduleTransform(name) {
  if (name.startsWith('.')) return;
  if (debounce.has(name)) clearTimeout(debounce.get(name));
  debounce.set(name, setTimeout(() => {
    debounce.delete(name);
    const r = transformOne(name);
    if (!r) return;
    const t = new Date().toLocaleTimeString();
    if (r.action === 'transformed') console.log(`[${t}] transformed ${r.name} -> ${r.outName}`);
    else if (r.action === 'copied')    console.log(`[${t}] copied ${r.name}`);
    else if (r.action === 'failed')    console.error(`[${t}] FAILED ${r.name}: ${r.error}`);
  }, 80));   // 80ms debounce per file (handles editors that write twice)
}

fs.watch(SRC, { persistent: true }, (eventType, filename) => {
  if (filename) scheduleTransform(filename);
});

// Keep process alive
process.stdin.resume();
process.on('SIGINT', () => { console.log('\n[transform] shutting down'); process.exit(0); });
