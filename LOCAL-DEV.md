# Local dev loop — Phase A

One command on your laptop spins up the entire ATS stack so you can iterate on
both backend and frontend without ever deploying to production. Every change
to a `.jsx` or backend `.js` file is visible in the browser within ~1-2
seconds.

## What it does

```
+-------------------------------+
|  npm run dev   (single cmd)   |
+--------+-------+--------------+
         |       |
         |       +-> spawns: node --watch deploy/backend/server.js   :3000
         |       +-> spawns: node deploy/build/transform.js --watch  (jsx -> out/src/*.js)
         |       +-> serves:  static + /api/* proxy                   :8080
         |
         v
   http://localhost:8080/app.html
```

* **Backend hot-reload.** `node --watch` re-execs server.js on every file
  change in `deploy/backend/`. ~500ms restart. KILL_SWITCH and tradingMode
  are forced to safe defaults locally so no real money is at risk even if
  you accidentally hit a live-order endpoint.
* **Frontend hot-rebuild.** `transform.js --watch` re-emits `out/src/<f>.js`
  whenever you touch `src/<f>.jsx`. ~80ms per file.
* **Cache-busting.** Every static response is served with
  `Cache-Control: no-store`. A normal browser reload always sees the latest
  bundle. No "is this the new code?" guessing.
* **Real broker -- none.** Local backend boots without Zerodha credentials.
  All broker-backed endpoints return `brokerConnected: false`. UI screens
  render their empty / loading states, which is what you want when you're
  iterating on UI code.

## First-time setup

You need **Node.js 20+** installed on your laptop.

```powershell
cd "C:\Users\localuserwin11\Documents\Claude\Projects\ATS\ATS Design"

# One-time: install backend deps (frontend has no separate node_modules)
cd deploy\backend
npm ci --no-audit --no-fund
cd ..\..

# Optional but recommended: install esbuild at repo root for the transform watcher
npm install --save-dev esbuild@0.21.5 --no-audit --no-fund
```

## Daily use

```powershell
cd "C:\Users\localuserwin11\Documents\Claude\Projects\ATS\ATS Design"
npm run dev
```

Open <http://localhost:8080/app.html> in your browser.

* Edit any `src/*.jsx` -> save -> hit refresh. See the change instantly.
* Edit any `deploy/backend/*.js` -> save. Backend restarts itself in ~500ms.

Stop with **Ctrl+C**. All child processes are cleaned up.

## Variants

### Test the UI against PRODUCTION data (READ-ONLY)

When you want to see real broker data (your actual NIFTY/SENSEX ticks,
real holdings, real attribution rows) flowing into your UI changes, point
the proxy at prod:

```powershell
$env:NO_BACKEND=1
$env:PROXY_TARGET="https://ats.rajasekarselvam.com"
npm run dev
```

Now:
* `/api/*` calls from your local `app.html` hit prod, return real data.
* Static files (your edited `.jsx`) are served fresh from your laptop.
* Cookies don't carry across (different origin); use the local backend
  if you need a session.

Safety: prod has `KILL_SWITCH=true` and `tradingMode=paper`. Even if the
UI POSTs to `/api/orders/place`, the 3-gate live-orders chain blocks it.
But: **don't run this with `KILL_SWITCH=false` on prod**. The whole
point of the gate is to make this safe.

### Run only the frontend (no backend at all)

If you only want to tweak JSX and don't care about backend wiring:

```powershell
$env:NO_BACKEND=1
$env:PROXY_TARGET="http://localhost:9999"   # nowhere; proxy will 502
npm run dev
```

All `/api/*` calls fail; screens render their error/empty states. Fast
loop for pure layout work.

### Use a different port

```powershell
$env:PORT=9090
npm run dev
```

## What gets caught locally that would otherwise hit prod

This loop would have caught all 7 bugs shipped in the 2026-05-21 session:

| Bug                                                | Caught by                            |
|----------------------------------------------------|--------------------------------------|
| `_inr` const collision -> blank page                | Browser console on first reload      |
| `attribution` id collision -> wrong screen          | Clicking "PnL attribution" nav       |
| `NseMacroFetcher` missing require                   | Backend log: "init failed: not defined" |
| attribution.jsx reads `r.regime` as string          | `[object Object]` rendered in table  |
| attribution.jsx reads `r.trades` / `r.skipped`      | Always "0" in cells                  |
| slippage.jsx reads `meanBps`/`medianBps`/`p95Bps`   | Every KPI tile shows "-"             |
| walk-forward UI never existed                       | Nav entry would 404 a screen         |

Every one of these is a 5-second visual catch on the local browser.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `Cannot find module 'better-sqlite3'` | Backend deps not installed | `cd deploy/backend && npm ci` |
| `npm: command not found` (Windows) | Node not on PATH | Install Node 20+ from https://nodejs.org/ |
| Port already in use | Another process on :3000 or :8080 | Set `$env:PORT=` / `$env:BACKEND_PORT=` |
| `/api/*` returns 502 with NO_BACKEND mode | PROXY_TARGET unreachable | Check the URL; if hitting prod, verify your network |
| JSX changes don't appear after refresh | Watcher not picking up file change | Check the `[transform]` line in the dev-server log |
| Backend restarts in a loop | Bug crashes node | Read the backend log; node --watch will keep restarting until you fix it |

## Files added for this loop

* `package.json` (repo root) - npm scripts: `dev`, `transform`, `transform:watch`
* `scripts/dev-server.js` - the orchestrator
* `deploy/build/transform.js` - extended with `--watch` mode
* `LOCAL-DEV.md` - this file

Nothing in the production code path is touched. Local-dev is purely
additive.

## What this does NOT cover (Phases B-E)

* **Type checking** (Phase B). Would catch e.g. `r.regime.toUpperCase()`
  when `r.regime` is an object. Add JSDoc typedefs + `tsc --noEmit
  --checkJs`. Estimated 3 hours.
* **Playwright per-screen specs** (Phase C). Headless browser load test
  for every screen. Estimated half day for the 9 new screens.
* **Staging env** (Phase D). A second VM where deploys go before prod.
  Catches env-var / DB-migration issues. Estimated 1 day.
* **Visual regression** (Phase E). Snapshot diff per screen. Estimated
  half day; only needed if there are external users.

When you want any of these, ask -- they layer onto Phase A.
