# API Surface Migration: `/api/*` legacy → `/api/v1/me/*` and `/api/me/*`

**Last updated:** 2026-05-19 (T-203, after CODE-AUDIT.md §F.5 M3.5)
**Status:** active — frontend migration in flight, backend transitional
**Owner:** ATS operator

## TL;DR

The backend currently exposes **three coexisting API conventions** that grew out of incremental shipping decisions:

1. **`/api/*` legacy unscoped** — pre-Tier 75 routes that read/write module-level singletons (`watchlist.list()`, `alerts.list()`, `paper.stats()`). No auth, no per-user filter. In single-tenant prod they happen to work because there's only one user (the operator), but in a multi-tenant world they leak. As of T-202 (2026-05-19) these are wrapped with `withDeprecation()` — they require auth and emit `Deprecation: true` + `Link: </api/me/...>; rel="successor-version"` response headers.

2. **`/api/me/*` per-user (pre-v1)** — Tier 53+ routes that already enforce `req.user.id` via the `withAuth(handler)` wrapper at `server.js:3365`. These are the canonical per-user surface today for most resources. Stable contracts.

3. **`/api/v1/me/*` per-user (v1)** — Tier 84 + me-broker.js routes that follow RESTful conventions (plural resource names, sub-action paths like `/brokers/:id/actions/test`). These are the *target* convention for new per-user endpoints.

This doc explains which endpoint to use when, the deprecation timeline, and per-screen migration status.

---

## Endpoint inventory by convention

### Legacy `/api/*` (DEPRECATED — being retired)

T-202 added `withDeprecation()` to all 16 routes below. Frontend hits still work but emit a `Deprecation` header. Audit log shows `legacy.route.hit` per call so we can watch usage decay to zero before deletion.

| Legacy endpoint | Successor | Last frontend caller |
|---|---|---|
| `GET /api/watchlist` | `GET /api/me/watchlist` | none (server.js calls only) |
| `PUT /api/watchlist` | `PUT /api/me/watchlist` | none |
| `POST /api/watchlist/add` | `POST /api/me/watchlist` | none |
| `POST /api/watchlist/remove` | `DELETE /api/me/watchlist/:symbol` | none |
| `GET /api/alerts` | `GET /api/me/alerts` | `screen-alerts-builder.jsx:18` |
| `POST /api/alerts` | `POST /api/me/alerts` | `screen-alerts-builder.jsx:43` |
| `DELETE /api/alerts/:id` | `DELETE /api/me/alerts/:id` | `screen-alerts-builder.jsx:59` |
| `POST /api/alerts/:id/reset` | `POST /api/me/alerts/:id/reset` | none |
| `GET /api/alerts/stats` | (no direct successor — derive from /api/me/alerts) | none |
| `GET /api/paper/orders` | `GET /api/me/paper/orders` | `screen-paper.jsx:557` |
| `GET /api/paper/positions` | `GET /api/me/paper/positions` | `screen-paper.jsx:556` |
| `GET /api/paper/trades` | `GET /api/me/paper/trades` | none |
| `POST /api/paper/order` | `POST /api/me/paper/order` | none |
| `DELETE /api/paper/order/:id` | `DELETE /api/me/paper/order/:id` | none |
| `POST /api/paper/reset` | `POST /api/me/paper/reset` | none |
| `GET /api/paper/tiers` | `GET /api/me/paper/tiers` | none |
| `POST /api/paper/replay` | (no direct successor — keep at /api/paper for now) | `screen-paper.jsx:52` |

Note: `/api/watchlist/snapshot` (server.js:1426) is intentionally **not** in the deprecation list. It's a public market-data quotes endpoint that returns OHLC/LTP for symbols on the watchlist; it doesn't expose user-specific state. Stays unauthenticated for the live tile.

### Stable `/api/me/*` (USE THIS)

The canonical per-user surface for most resources today. All routes go through `withAuth(handler)` at server.js:3365 so anonymous requests return 401. These contracts are stable and you should bias toward them for new screens.

Routes (non-exhaustive — grep `app\\.(get|post|put|delete)\\('/api/me/` in server.js for the current list):

```
GET    /api/me/identity            (T-67)
GET    /api/me/prefs               (T-70)
GET    /api/me/ai-keys             (T-67) [delegated router]
GET    /api/me/pnl/monthly         (T-156)
GET    /api/me/sweep/monthly       (T-158)
GET    /api/me/signals/promotion-rate (T-159)
GET    /api/me/portfolio/holdings  (T-66)
GET    /api/me/portfolio/mf        (T-66)
GET    /api/me/portfolio/etf       (T-66)
GET    /api/me/watchlist           (Tier 75 successor to /api/watchlist)
POST   /api/me/watchlist
DELETE /api/me/watchlist/:symbol
GET    /api/me/alerts              (Tier 75 successor to /api/alerts)
POST   /api/me/alerts
DELETE /api/me/alerts/:id
GET    /api/me/paper               (Tier 75 successor to /api/paper/*)
GET    /api/me/autorun
POST   /api/me/autorun
GET    /api/me/modes/runtime       (T-185)
```

### Modern `/api/v1/me/*` (TARGET CONVENTION for new endpoints)

The RESTful resource-shaped surface. Plural resources, sub-action paths, consistent response wrapper (`{ok: true, ...}`). Two routers live here today:

**`/api/v1/me/{account,preferences,notifications,export}`** — `account-routes.js`
```
GET    /api/v1/me/account              (T-84)
PATCH  /api/v1/me/account
DELETE /api/v1/me/account              (delete-self)
GET    /api/v1/me/preferences          (T-84)
PUT    /api/v1/me/preferences
GET    /api/v1/me/notifications        (T-84)
PUT    /api/v1/me/notifications        (T-189 + T-192 inline Save UX)
POST   /api/v1/me/notifications/test
GET    /api/v1/me/export
```

**`/api/v1/me/brokers/*`** — `me-broker.js`
```
GET    /api/v1/me/brokers
POST   /api/v1/me/brokers
GET    /api/v1/me/brokers/:id
PATCH  /api/v1/me/brokers/:id
DELETE /api/v1/me/brokers/:id
POST   /api/v1/me/brokers/:id/actions/test
POST   /api/v1/me/brokers/:id/actions/reauth
GET    /api/v1/me/brokers/:id/actions/reauth-url
PATCH  /api/v1/me/brokers/:id/auto-reauth
```

Plus one orphan that lives directly in server.js: `GET /api/v1/me/orders/by-mode` (T-82, server.js:3784). Either move it into a router or leave it inline — operator's call.

---

## When to use which

The decision rules, in order:

1. **New endpoint for a user-scoped resource?** Always go `/api/v1/me/<plural-resource>/*`. RESTful, plural, sub-action paths. Add it as a router under `deploy/backend/<resource>-routes.js` mounted from server.js with a lazy `require()`.

2. **New endpoint that touches a singleton (kill switch, market hours, scanner runs)?** Stays at `/api/admin/*` or `/api/<feature>` if it's truly process-global (e.g. `/api/kill-switch`). Don't put singleton state under `/api/me/*` because that name implies per-user.

3. **Existing screen needs a new field on an existing per-user resource?** Prefer extending the existing `/api/v1/me/<resource>` response if it lives in v1. Otherwise extend the `/api/me/<resource>` response (don't fork into v1 just for one field).

4. **Hitting a deprecated `/api/<resource>` route from frontend?** Migrate the call site to the successor when you next touch that screen for any reason. Don't open a separate PR just to migrate. Watch the `legacy.route.hit` audit count.

---

## Deprecation timeline

| Phase | Trigger | Action |
|---|---|---|
| **Now (T-202)** | — | Legacy routes wrapped with `withDeprecation`. Auth-gated, audit-logged, `Deprecation` header set. Frontend keeps working. |
| **Phase 2** | When `screen-alerts-builder.jsx` is next refactored (or proactively, ~30 min) | Migrate 3 `/api/alerts` call sites to `/api/me/alerts`. |
| **Phase 3** | When `screen-paper.jsx` is next refactored (audit also flags 29 useStates — see §F.5 M3.4) | Migrate `/api/paper/{positions,orders,replay}` to `/api/me/paper/*` equivalents. `/api/paper/replay` may stay unscoped if it's a pure simulation runner that doesn't read user state. |
| **Phase 4** | When audit log shows zero `legacy.route.hit` for 14 consecutive days | Delete the legacy route handlers from server.js. Remove `withDeprecation()`. |

Estimated retirement date: **late June 2026** if Phases 2-3 happen by end of May; otherwise the gating step is when the operator is comfortable that no script or external automation depends on the legacy paths (per `INCIDENT-RUNBOOK.md` historical operator scripts).

---

## What we deliberately did NOT do

- **Did not migrate `/api/me/*` to `/api/v1/me/*` wholesale.** Both surfaces work, the test suite covers them, and a big-bang flip would invalidate every screen + every existing audit doc reference. The v0/v1 split persists as a transitional state — new endpoints go to v1, old ones stay at v0 until they're refactored for another reason.

- **Did not break the legacy routes' contract for existing callers.** T-202 only added an auth wrapper + deprecation header. The response shapes are unchanged; existing screens with a session continue to work.

- **Did not auto-redirect legacy → successor.** A 308 to `/api/me/...` would force frontends to retry with different paths, which is messy with the existing `fetch` pattern. The deprecation header is the right signal; let the frontend migrate at its own pace.

---

## How to verify

After T-202 deploys:

```bash
# Anon hits legacy route → 401 auth_required.
curl -sS -i https://ats.rajasekarselvam.com/api/watchlist | head -5

# Authed hits legacy route → 200 + Deprecation header.
curl -sS -i -b "ats.sid=<valid-session-cookie>" \
  https://ats.rajasekarselvam.com/api/watchlist | grep -E '^(HTTP|Deprecation|Link)'
# Expected:
#   HTTP/2 200
#   deprecation: true
#   link: </api/me/watchlist>; rel="successor-version"

# Audit log shows the hit:
ssh deployer@vm "sudo tail -n 5 /var/log/ats/audit.log | grep legacy.route.hit"
```

---

## References

- T-202 commit: backend route wrapping (`server.js withDeprecation`)
- `deploy/docs/CODE-AUDIT.md` §F.5 M3.5: original recommendation
- `deploy/backend/server.js:3365` — `withAuth` helper
- `deploy/backend/me-broker.js`, `account-routes.js` — examples of the v1 convention done right
