# ATS End-to-End Test Suite

Playwright specs that guard the production app contract. Live target by default
is `https://ats.rajasekarselvam.com` — override with `ATS_BASE_URL`.

## One-time setup

```sh
cd test-e2e
npm install
npm run install-browsers   # downloads Chromium (~150MB)
```

## Run the full suite

```sh
# Against prod (default)
npx playwright test

# Against local dev
ATS_BASE_URL=http://localhost:8080 npx playwright test

# Run a single spec
npx playwright test happy-path
```

## What each spec covers

| Spec | Guards |
|---|---|
| `smoke.spec.js`             | Every hash-route renders without console errors |
| `happy-path.spec.js`        | **Tier 78** end-to-end: anonymous flow → public APIs → auth gate → critical screens → 404 contract → /ws handshake → health-deep fingerprint |
| `me-endpoints.spec.js`      | T-67/T-70 per-user endpoint auth contract |
| `health-deep-fields.spec.js`| T-34/T-37 broker WS + DR operational signals |
| `obs-middleware.spec.js`    | T-78 latency/error observability headers |
| `request-id-error.spec.js`  | T-79 x-request-id propagation |
| `callback-state-absent.spec.js` | OAuth callback rejects missing `state` |
| `internal-header-strip.spec.js` | Nginx strips internal-token from external requests |
| `ai-trace.spec.js`          | T-122 admin LLM trace viewer |
| `attribution-fake-pnl.spec.js` | T-80 honest-data sweep (no fake ₹1,24,800) |
| `signals-fake-kpis.spec.js` | T-81 honest-data sweep (no fake 47/28%/71%) |
| `status-page-fields.spec.js`| /api/status v11-mandated fields |

## CI integration

CI runs `npm run install-browsers && npx playwright test` on every push to
`main` (see `.github/workflows/`). Specs are written to be safe against
varying-state values — they only assert shapes + status codes, never values
that change by time-of-day (broker connected, market open, last reauth time,
etc.).

## Adding new specs

1. Drop the spec in `tests/<name>.spec.js`
2. Reference the Tier or T-id in a header comment so future readers can map it
   back to the master plan
3. Prefer asserting *shape* over *value* unless the value is a contract
   constant (status code, error reason string)
4. If the spec is flaky off-hours (market closed), gate the value assertions
   on an `if (isMarketHours())` check rather than skipping the whole test
