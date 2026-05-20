// T-209 (CODE-AUDIT D.9 #2): Vitest config for the script-tag-loaded frontend.
//
// Why this config is bespoke:
//   The ATS frontend uses a no-build script-tag-loading model where each
//   .jsx file declares top-level consts and ends with `Object.assign(window,
//   {Foo, Bar})` to expose them. There are no ES module imports/exports.
//
//   Vanilla Vitest would `import` the .jsx file, get nothing back (because
//   no exports), and fail. So we provide a helper `lib/load-jsx.js` that
//   reads the file as text, transforms JSX via esbuild, and evals it in a
//   jsdom-backed sandbox where `window` is a fresh object. After eval,
//   `window` holds the file's exports.
//
//   Tests then `const { formatINR } = loadJsx('src/r11-additions.jsx')` to
//   get hold of named exports for testing.
//
// T-248g (2026-05-20): switched environment from 'jsdom' to 'happy-dom'.
//   jsdom 25 + esbuild 0.24 + Node 22 combine to produce
//   "TextEncoder().encode() instanceof Uint8Array is incorrectly false"
//   at every test import because jsdom installs its own TextEncoder whose
//   output Uint8Array has a different identity than the global. happy-dom
//   uses Node's native TextEncoder so esbuild's invariant holds.
//   Our tests only use DOM minimally (document, localStorage, CustomEvent)
//   so happy-dom is a drop-in replacement.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./setup.js'],
    include: ['tests/**/*.test.{js,jsx}'],
  },
});
