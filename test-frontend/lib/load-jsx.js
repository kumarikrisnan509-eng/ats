// T-209: Load a script-tag-style .jsx file and return its window-exported names.
//
// The ATS frontend doesn't use ES modules. Each .jsx file does:
//   const Foo = ...;
//   const Bar = (props) => ...;
//   Object.assign(window, { Foo, Bar });
//
// To test those exports from Vitest:
//   1. Read the file as text.
//   2. Transform JSX via esbuild (vitest already includes esbuild as a dep).
//   3. Eval the result in a sandboxed Function so the top-level consts don't
//      leak into our test scope.
//   4. Read the resulting window object — that's the file's "exports".
//
// Side effects (IIFEs, addEventListener, setInterval) run during eval, so
// be aware: loading a file that auto-starts a poller will start the poller
// in your test process. The 5 files we currently load (primitives,
// r11-additions, etc.) have negligible side effects: a couple of harmless
// localStorage clears and a toast event listener. We can isolate further
// with jsdom's window if a file becomes too aggressive.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

// Cache transformed code so repeated loadJsx() calls in the same test run
// don't re-transform. Vitest already isolates test files, so this is per-file.
const _cache = new Map();

export function loadJsx(relPath) {
  if (_cache.has(relPath)) return _cache.get(relPath);

  const abs = resolve(REPO_ROOT, relPath);
  const source = readFileSync(abs, 'utf8');
  const transformed = transformSync(source, {
    loader: 'jsx',
    format: 'cjs',
  }).code;

  // Sandbox: fake window starts empty; React + ReactDOM piped through from
  // global; the rest of the globals (console, Math, Date, ...) come for
  // free from the Function constructor's outer scope.
  const fakeWindow = {};
  const wrapper = new Function(
    'window', 'React', 'ReactDOM', 'document', 'localStorage', 'CustomEvent',
    transformed + '\nreturn window;'
  );

  const exports = wrapper(
    fakeWindow,
    globalThis.React,
    globalThis.ReactDOM,
    globalThis.document,
    globalThis.localStorage,
    globalThis.CustomEvent,
  );

  _cache.set(relPath, exports);
  return exports;
}
