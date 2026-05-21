#!/usr/bin/env node
// dev-server.js -- Phase A local dev loop.
//
// Spawns three things in one terminal:
//   1. backend       (node --watch deploy/backend/server.js)         :3000
//   2. JSX watcher   (node deploy/build/transform.js --watch)        emits to out/src/*.js
//   3. static + proxy server                                          :8080
//        - serves app.html, app/, out/src/, src/css/, anything at repo root
//        - proxies /api/*  + /ws  to localhost:3000
//        - Cache-Control: no-store on EVERY response (so reload always wins)
//
// Open: http://localhost:8080/app.html
//
// Env vars you can override:
//   PORT        default 8080
//   BACKEND_PORT default 3000
//   PROXY_TARGET default http://localhost:${BACKEND_PORT}
//     -- set to https://ats.rajasekarselvam.com to test UI against prod data
//        (READ-ONLY: KILL_SWITCH on prod stays on; live orders blocked anyway)
//   NO_BACKEND  if set, skip spawning local backend (use PROXY_TARGET to point
//               at prod or a separate backend process)
//
// USAGE:
//   npm run dev              # from repo root
//   PROXY_TARGET=https://ats.rajasekarselvam.com NO_BACKEND=1 npm run dev
//
// Stop: Ctrl+C once. Cleans up all child processes.

'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 8080;
const BACKEND_PORT = Number(process.env.BACKEND_PORT) || 3000;
const PROXY_TARGET = process.env.PROXY_TARGET || `http://localhost:${BACKEND_PORT}`;
const NO_BACKEND = !!process.env.NO_BACKEND;

const proxyUrl = new URL(PROXY_TARGET);
const proxyIsHttps = proxyUrl.protocol === 'https:';
const proxyHttp = proxyIsHttps ? https : http;

// Phase A.1: detect ports already in use BEFORE spawning anything, so the
// operator gets a clear error instead of a silent EADDRINUSE crash deep in
// nodemon's stack. Common cause: forgot to Ctrl-C a previous `npm run dev`.
function portInUse(port) {
  return new Promise((resolve) => {
    const probe = require('net').createServer();
    probe.once('error', (e) => resolve(e.code === 'EADDRINUSE'));
    probe.once('listening', () => { probe.close(() => resolve(false)); });
    probe.listen(port, '127.0.0.1');
  });
}

async function preflight() {
  const conflicts = [];
  if (await portInUse(PORT)) conflicts.push({ port: PORT, who: 'static + proxy server (this script)' });
  if (!NO_BACKEND && await portInUse(BACKEND_PORT)) conflicts.push({ port: BACKEND_PORT, who: 'backend (deploy/backend/server.js)' });
  if (conflicts.length === 0) return;

  console.error('');
  console.error('  Port conflict -- cannot start the local dev loop:');
  for (const c of conflicts) {
    console.error(`    × port ${c.port} is already in use (needed for ${c.who})`);
  }
  console.error('');
  console.error('  Most likely cause: a previous `npm run dev` is still running in another terminal.');
  console.error('  Fix: focus that terminal and press Ctrl-C, or in a new terminal run:');
  if (process.platform === 'win32') {
    console.error('    Get-Process -Id (Get-NetTCPConnection -LocalPort ' + conflicts[0].port + ').OwningProcess | Stop-Process');
  } else {
    console.error('    kill $(lsof -ti:' + conflicts[0].port + ')');
  }
  console.error('');
  process.exit(1);
}

const children = [];
function spawnChild(name, cmd, args, opts) {
  const c = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts });
  c.on('exit', (code) => console.log(`[${name}] exited code=${code}`));
  children.push({ name, child: c });
  return c;
}

function shutdown() {
  console.log('\n[dev-server] shutting down child processes...');
  for (const { name, child } of children) {
    try { child.kill('SIGTERM'); } catch {}
  }
  setTimeout(() => process.exit(0), 250);
}
process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);

// ---- 0. Preflight: ports must be free ----
//     (Phase A.1: catch the "forgot to Ctrl-C" case with a clear message)
preflight().then(() => bootstrap()).catch((e) => {
  console.error('[dev-server] preflight failed:', e.message);
  process.exit(1);
});

function bootstrap() {
// ---- 1. Backend (optional) ----
if (!NO_BACKEND) {
  console.log(`[dev-server] starting backend on :${BACKEND_PORT}...`);
  // The backend respects PORT env var; passes through KILL_SWITCH=true by default
  spawnChild('backend', 'npm', ['run', 'dev'], {
    cwd: path.join(ROOT, 'deploy', 'backend'),
    env: {
      ...process.env,
      PORT: String(BACKEND_PORT),
      KILL_SWITCH: 'true',
      LIVE_TRADING: 'false',
      // Local dev never has the prod master.key; the vault degrades gracefully.
      MASTER_KEY_PATH: process.env.MASTER_KEY_PATH || path.join(ROOT, '.local-dev', 'master.key'),
      DATA_DIR: process.env.DATA_DIR || path.join(ROOT, '.local-dev', 'data'),
      DB_PATH: process.env.DB_PATH || path.join(ROOT, '.local-dev', 'ats.db'),
      // Don't auto-start the option-chain fetcher or scanner locally
      OPTION_CHAIN_FETCH_ENABLED: 'false',
      OPTIONS_AUTORUN_ENABLED: 'false',
      NSE_MACRO_FETCH_ENABLED: 'false',
    },
  });
  // Ensure .local-dev exists
  fs.mkdirSync(path.join(ROOT, '.local-dev', 'data'), { recursive: true });
} else {
  console.log(`[dev-server] backend skipped (NO_BACKEND set); proxying /api/* to ${PROXY_TARGET}`);
}

// ---- 2. JSX transform watcher ----
console.log('[dev-server] starting JSX transform watcher...');
spawnChild('transform', 'node', ['deploy/build/transform.js', '--watch'], {
  cwd: ROOT,
  env: { ...process.env, SRC_DIR: 'src', OUT_DIR: 'out/src' },
});

// ---- 3. Static + proxy server ----
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.jsx':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2',
  '.map':  'application/json; charset=utf-8',
};

function staticFile(reqPath, res) {
  // Strip query string
  let p = reqPath.split('?')[0];
  if (p === '/' || p === '') p = '/app.html';
  // Try a few candidate paths in order:
  //   1. out/src/<basename>    (compiled JSX)
  //   2. <repo>/<path>         (app.html, docs.html, etc.)
  //   3. <repo>/src/<basename> (raw .jsx in case we want to serve as text)
  const candidates = [];
  if (p.startsWith('/src/')) {
    // app.html references files via /src/* but the JSX transformer writes to out/src/*
    const basename = p.slice('/src/'.length);
    candidates.push(path.join(ROOT, 'out', 'src', basename));
    candidates.push(path.join(ROOT, 'src', basename));
  } else {
    candidates.push(path.join(ROOT, p.replace(/^\//, '')));
  }

  for (const f of candidates) {
    try {
      const stat = fs.statSync(f);
      if (!stat.isFile()) continue;
      const ext = path.extname(f).toLowerCase();
      const mime = MIME[ext] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': mime,
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
        'Content-Length': stat.size,
      });
      fs.createReadStream(f).pipe(res);
      return true;
    } catch (_e) { /* try next */ }
  }
  return false;
}

function proxyToBackend(req, res) {
  const opts = {
    hostname: proxyUrl.hostname,
    port: proxyUrl.port || (proxyIsHttps ? 443 : 80),
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: proxyUrl.host },
  };
  // Add Origin matching the proxy target so CSRF Origin-check passes
  if (PROXY_TARGET.startsWith('https://')) {
    opts.headers.origin = `https://${proxyUrl.host}`;
    opts.headers.referer = `https://${proxyUrl.host}/`;
  } else {
    opts.headers.origin = `http://localhost:${PORT}`;
  }
  const upstream = proxyHttp.request(opts, (upRes) => {
    res.writeHead(upRes.statusCode, upRes.headers);
    upRes.pipe(res);
  });
  upstream.on('error', (e) => {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, reason: 'proxy_error', detail: e.message }));
  });
  req.pipe(upstream);
}

const server = http.createServer((req, res) => {
  // /api/* -> backend
  if (req.url.startsWith('/api/') || req.url.startsWith('/ws') || req.url === '/metrics' || req.url.startsWith('/healthz')) {
    return proxyToBackend(req, res);
  }
  // static
  if (staticFile(req.url, res)) return;
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end(`Not found: ${req.url}`);
});

server.listen(PORT, () => {
  console.log('');
  console.log('=======================================================');
  console.log(`  Local dev server: http://localhost:${PORT}/app.html`);
  console.log(`  Backend:          ${NO_BACKEND ? 'none (proxy only)' : 'localhost:' + BACKEND_PORT + ' (KILL_SWITCH=true)'}`);
  console.log(`  /api/* proxy:     ${PROXY_TARGET}`);
  console.log('=======================================================');
  console.log('Edit any src/*.jsx and refresh the browser -- changes apply within ~1s.');
  if (!NO_BACKEND && PROXY_TARGET.startsWith('http://localhost')) {
    console.log('');
    console.log('NOTE: this is a LOCAL database in .local-dev/, not a copy of prod.');
    console.log('      Your prod login will NOT work here. Sign up a fresh account');
    console.log('      with any email/password the first time. Wipe the local DB');
    console.log('      anytime with: rm -rf .local-dev/');
  }
  console.log('Stop with Ctrl+C.');
});

// also surface EADDRINUSE if it sneaks through (e.g. race between preflight + listen)
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`[dev-server] port ${PORT} taken after preflight -- another process grabbed it. Retry.`);
  } else {
    console.error('[dev-server] server error:', e.message);
  }
  process.exit(1);
});

} // end bootstrap()
