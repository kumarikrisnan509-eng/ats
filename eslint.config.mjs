// T-381: ESLint flat config (ESLint 9). Scope = deploy/backend/*.js only.
// Goal of this first pass = catch the specific bug class that bit T-377
// (ReferenceError to `verifyTokenForUrl` -- an undefined variable inside
// a function body that node --check cannot detect). no-undef + no-redeclare
// cover that class. Other rules are off so we don't have to triage a
// thousand pre-existing "unused var" warnings before we can ship.
//
// Node globals hardcoded inline (no `globals` package dep) so the config
// works whether ESLint is installed at the repo root or in CI's
// `.ci-tmp-eslint/` throwaway dir.

const NODE_GLOBALS = {
  // CommonJS
  require: 'readonly',
  module: 'readonly',
  exports: 'writable',
  __dirname: 'readonly',
  __filename: 'readonly',
  // Node core
  process: 'readonly',
  Buffer: 'readonly',
  global: 'readonly',
  console: 'readonly',
  // Timers
  setTimeout: 'readonly',
  setInterval: 'readonly',
  setImmediate: 'readonly',
  clearTimeout: 'readonly',
  clearInterval: 'readonly',
  clearImmediate: 'readonly',
  queueMicrotask: 'readonly',
  // Whatwg
  URL: 'readonly',
  URLSearchParams: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  fetch: 'readonly',
  AbortController: 'readonly',
  AbortSignal: 'readonly',
  // Node v18+ globals
  structuredClone: 'readonly',
  performance: 'readonly',
};

export default [
  {
    // Only lint backend Node code -- frontend src/*.jsx uses runtime Babel
    // + window-globals, not module imports, so ESLint's scope analysis
    // would false-positive on every cross-file reference.
    files: ['deploy/backend/**/*.js'],
    ignores: ['**/node_modules/**', 'deploy/backend/test/_runner.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: NODE_GLOBALS,
    },
    rules: {
      'no-undef':     'error',
      'no-redeclare': 'error',
    },
  },
];
