#!/usr/bin/env node
// scripts/test-local.js -- run the Playwright E2E suite against the local
// dev orchestrator. Cross-shell wrapper so the operator doesn't have to set
// BASE_URL by hand (PowerShell uses $env:, bash uses BASE_URL=...).
//
// Usage (from repo root):
//   npm run test:local
//
// Assumes `npm run dev` is already running in another terminal on :8080.
// Any extra CLI args are forwarded to playwright:
//   npm run test:local -- --grep "happy"
//   npm run test:local -- tests/smoke.spec.js

'use strict';

const { spawnSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';

// Quick liveness probe so the operator sees a clear error if they forgot
// to start the dev server, instead of 90 specs failing on connection refused.
async function probe() {
  return new Promise((resolve) => {
    try {
      const http = require('http');
      const u = new URL(BASE_URL);
      const req = http.get({
        hostname: u.hostname,
        port:     u.port || 80,
        path:     '/api/health',
        timeout:  1500,
      }, (res) => {
        let body = '';
        res.on('data', (c) => body += c);
        res.on('end', () => resolve({ ok: res.statusCode === 200, body }));
      });
      req.on('error', () => resolve({ ok: false }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false }); });
    } catch (_) { resolve({ ok: false }); }
  });
}

(async () => {
  const ok = await probe();
  if (!ok.ok) {
    console.error('');
    console.error('  ✗ ' + BASE_URL + ' is not responding to /api/health.');
    console.error('    Start the dev server in another terminal first:');
    console.error('      npm run dev');
    console.error('');
    process.exit(2);
  }

  const e2eDir = path.resolve(__dirname, '..', 'test-e2e');
  if (!fs.existsSync(path.join(e2eDir, 'node_modules'))) {
    console.error('  ✗ test-e2e/node_modules missing. Run once:');
    console.error('      cd test-e2e && npm install && npx playwright install chromium');
    process.exit(3);
  }

  const extra = process.argv.slice(2);
  const args = ['playwright', 'test', '--reporter=list', ...extra];
  console.log(`[test-local] BASE_URL=${BASE_URL}`);
  console.log(`[test-local] cwd=${e2eDir}`);
  console.log(`[test-local] npx ${args.join(' ')}`);

  const res = spawnSync('npx', args, {
    cwd:    e2eDir,
    stdio:  'inherit',
    shell:  true,
    env:    { ...process.env, BASE_URL },
  });

  process.exit(res.status == null ? 1 : res.status);
})();
