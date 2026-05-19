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

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./setup.js'],
    include: ['tests/**/*.test.{js,jsx}'],
  },
});
