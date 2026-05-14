#!/usr/bin/env node
// transform.js — Docker build-time JSX -> JS using esbuild's transform.
//
// Input:  src/*.jsx, src/*.css, src/*.js
// Output: out/src/*.js, out/src/*.css (CSS copied unchanged)
//
// We DO NOT bundle. Each .jsx becomes a standalone .js that's still loaded as
// a <script src="..."> tag in app.html. Preserves the existing 52-script
// load-order semantics and all `window.X = X` global pollution. The only
// behavioral change is "no Babel-in-browser compile step" -- which is the
// entire point of P3 (eliminate the ~2MB Babel download and runtime JSX
// compile cost; first paint goes from ~3-4s to ~1s).

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const SRC = process.env.SRC_DIR || 'src';
const OUT = process.env.OUT_DIR || 'out/src';

fs.mkdirSync(OUT, { recursive: true });

const files = fs.readdirSync(SRC).filter(f => !f.startsWith('.'));
let transformed = 0, copied = 0;

for (const f of files) {
  const full = path.join(SRC, f);
  const stat = fs.statSync(full);
  if (!stat.isFile()) continue;

  if (f.endsWith('.jsx')) {
    const src = fs.readFileSync(full, 'utf8');
    try {
      const result = esbuild.transformSync(src, {
        loader: 'jsx',
        jsxFactory: 'React.createElement',
        jsxFragment: 'React.Fragment',
        target: 'es2020',
        // Don't minify -- keeps source readable for browser devtools.
      });
      const outName = f.replace(/\.jsx$/, '.js');
      fs.writeFileSync(path.join(OUT, outName), result.code);
      console.log(`transformed ${f} -> ${outName}  (${result.code.length} bytes)`);
      transformed++;
    } catch (e) {
      console.error(`FAILED to transform ${f}: ${e.message}`);
      process.exit(1);
    }
  } else if (f.endsWith('.css') || f.endsWith('.js')) {
    fs.copyFileSync(full, path.join(OUT, f));
    console.log(`copied ${f}`);
    copied++;
  } else {
    console.log(`skipped ${f}`);
  }
}

console.log(`---`);
console.log(`done -- transformed ${transformed} jsx -> js, copied ${copied} other files`);
