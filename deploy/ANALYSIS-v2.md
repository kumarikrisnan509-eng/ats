# ATS Design v2 — Deep Analysis + Realtime Broker Data Plan

**Date:** 12 May 2026
**Scope:** `C:\Users\localuserwin11\Documents\Claude\Projects\ATS\ATS Design\`
**Question being answered:** *Can we implement with realtime data from broker?* — **Yes. Here's how.**

---

## 1. What changed vs the prior design

The latest design adds 7 JSX files and one external CSS file. Same 38 product screens; the additions are polish, infrastructure, and an AI Assistant.

| New file | Purpose |
|---|---|
| `src/tokens.css` | Externalized design tokens (spacing 0–9, type xs–4xl, density toggle for compact/comfortable). Loaded as plain stylesheet. |
| `src/mock-data.jsx` | Single source of truth for demo data (`window.MockData.holdings()/symbols()/orders()`), gated by `window.isDemoMode()`. |
| `src/command-palette.jsx` | ⌘K palette covering every route + quick actions, grouped (Trade / Automate / Validate / Execute / Wealth / Operations / System / Account). 38 routes registered. |
| `src/r8-primitives.jsx` | Round-8 shared primitives. |
| `src/r8-ai-assistant.jsx` | Right-edge slide-in **AI Assistant drawer** (⌘/), seeded prompts per route, calls `window.claude.complete()`. |
| `src/r9-additions.jsx` | Round-9 polish — 637 lines. |
| `src/r10-additions.jsx` | Round-10 polish — 175 lines. |
| `src/r11-additions.jsx` | Round-11 polish — 609 lines. |

`app.html` also added:
- A `@media (max-width: 1100px) / 720px` block: sidebar collapses to icons at 1100px, hides at 720px, grids reflow.
- Skeleton shimmer keyframes for loading states.
- A regression I'll patch: `<meta name="viewport" content="width=1440">` is back. I fixed it on the prior design — I'll fix it here too.

### The architectural seam that matters most

`live-ticks.jsx` already exposes a clean abstraction the UI consumes:

```js
window.LiveTicks.state()              // current snapshot
window.dispatchEvent(CustomEvent('tick', { detail: state }))   // per-tick
useLiveTick(symbol)                   // React hook
useConnectionState()                  // React hook
useLivePnL(positions)                 // React hook
<LiveTicker/> <LiveCell/> <StaleIndicator/>   // components
```

Today the IIFE in that file is a random-walk simulator. **The "wire real broker data" job is to replace that simulator with a WebSocket consumer pointed at our backend.** Every screen, every hook, every component, stays unchanged.

This is the cleanest possible seam. The designer did the right thing.

---

## 2. Can we implement with realtime broker data? — Yes

### 2.1. The path, in one paragraph

We add a `BrokerGateway` interface to the Node backend with two implementations: `MockBroker` (the simulator, default) and `ZerodhaBroker` (Kite Connect). When a user connects their Zerodha account via OAuth, the backend opens a Kite Ticker WebSocket using their access token, subscribes to their watchlist instruments, and fans the ticks out on the existing `/ws` route. The frontend's `live-ticks.jsx` IIFE is patched to open a WebSocket to that backend route and dispatch `tick` CustomEvents from the messages, exactly the shape the rest of the UI already consumes.

### 2.2. Architecture

```
Browser                       Nginx (TLS)              Node backend (loopback :8080)              Zerodha
─────────                     ──────────               ───────────────────────────────            ────────
React UI                                                                                         ┌──────────────┐
  ├ useLiveTick(sym) ────┐                                                                       │ Kite Connect │
  ├ <LiveTicker/>        │                                                                       │  REST + WS   │
  └ <LiveCell/>          │                                                                       └──────┬───────┘
                         │                                                                              │
WebSocket client         │  /ws  ──upgrade──► WebSocket server                                          │
on wss://.../ws ◄────────┘                       │                                                      │
                                                 │                                                      │
                                                 ├── BrokerGateway.subscribeTicks([syms], cb)           │
                                                 │       │                                              │
                                                 │       ├── ZerodhaBroker: uses kite_ticker  ──ws──────┤
                                                 │       └── MockBroker:   random walk                  │
                                                 │                                                      │
                                                 └── per-user session                                   │
                                                       (Map<sessionId, { broker, token }>)              │
                                                                                                        │
HTTPS                                                                                                   │
GET /api/brokers/zerodha/login   ── 302 ──► Kite OAuth ───────────────────────────────────────────────► │
GET /api/brokers/zerodha/callback?request_token=...                                                     │
  ─── POST /session/token (exchanges request_token + secret for access_token) ──────────────────────────►
  ◄── access_token, public_token ─────────────────────────────────────────────────────────────────────  │
  encrypt with crypto-vault, store in /var/lib/ats/tokens/<userId>.enc
```

### 2.3. What the Kite Connect API gives us, exactly

- **REST endpoints** (paid: ₹2000/mo personal plan, or part of vendor empanelment): orders, positions, holdings, margins, instrument master dump, historical candles, quote/LTP, GTT, mutual funds.
- **WebSocket Ticker** (free with API subscription): live tick stream. Three modes per subscribed instrument — `ltp` (just LTP), `quote` (LTP + OHLC + volume + bid/ask top), `full` (everything including market depth).
- **Connection limits:** 3 WebSocket connections per access token; up to 3000 instruments subscribed per WebSocket; access tokens issued daily after user TOTP login (no refresh token).
- **Authentication:** per-user OAuth (`request_token` → `access_token` exchange using `api_key + api_secret + request_token`). The access token is a daily secret.
- **Static IP whitelisting:** required by SEBI for production algo endpoints. Oracle Cloud ARM gets a reserved public IP — declare it to Zerodha.

### 2.4. Constraints / non-negotiables

1. **Kite Connect subscription is mandatory.** ~₹2000/month / per Kite Connect "Personal" app, plus the user's own broker account. Cannot work around this for live data.
2. **Per-user access tokens expire daily at ~6 AM IST.** Backend has to detect 403 from Kite, push the user back through OAuth, no silent refresh.
3. **Tokens must be encrypted at rest.** The plan doc §5 specifies KMS envelope encryption. v1 here uses libsodium secretbox with a server-side master key stored in `/etc/ats/master.key` (chmod 400, root-only). Migrate to OCI Vault before production.
4. **Static IP first.** Reserve an OCI public IP, declare it to Zerodha in your app's developer console, before going live. Without this, requests will eventually be blocked under the post-1-Apr-2026 framework.
5. **No order execution in this scaffold.** Read-only realtime data only. The order-placement path remains `/api/orders/dry-run`. Real order placement is a separate change, made by you, deliberately, with the kill switch wired first and contract tests green.

### 2.5. Alternatives if you don't want to pay Kite Connect yet

| Approach | Latency | Cost | Caveats |
|---|---|---|---|
| **Zerodha Kite Connect WS** (this plan) | ~250 ms India | ₹2000/mo | Authoritative, BYOK-safe |
| **Upstox MarketDataFeed** | ~250 ms | ₹0 for personal | Need Upstox account, different OAuth |
| **DhanHQ Marketfeed** | ~250 ms | ₹0 free tier | Smaller broker, but generous free tier |
| **Public NSE/BSE delayed feed** | 15-min delayed | Free | Useless for live trading; OK for charts |
| **3rd-party paid (TrueData, GlobalDataFeeds)** | <100 ms | ₹3-15k/mo | No broker tie-in, pure data |

Per plan doc §3 implementation order, ZerodhaAdapter is the first. UpstoxAdapter is second. Both fit the `BrokerGateway` interface I'm scaffolding here.

---

## 3. What this delivery contains

### Code (in `deploy/backend/`):

| File | What it does |
|---|---|
| `brokers/gateway.js` | Abstract `BrokerGateway` interface — `subscribeTicks`, `unsubscribeTicks`, `getQuote`, `getOrderbook`, `placeDryRun`. No `placeOrder`. |
| `brokers/mock-broker.js` | Default implementation: random-walk ticks for ~15 instruments. Used when `BROKER=mock`. |
| `brokers/zerodha-broker.js` | Kite Connect implementation: OAuth helpers + Kite Ticker WebSocket consumer. Used when `BROKER=zerodha`. |
| `brokers/index.js` | Factory — `createBroker(env)` returns the right adapter. |
| `crypto-vault.js` | libsodium secretbox token encryption with master key. Used to store Zerodha access tokens. |
| `sessions.js` | In-memory session store (per-user broker handle). Upgrade to Postgres later. |
| `server.js` (updated) | `/api/brokers/zerodha/login`, `/api/brokers/zerodha/callback`, broker-pluggable `/ws` fan-out, `/api/quote/:symbol`. |
| `.env.example` (updated) | Documents `BROKER`, `ZERODHA_API_KEY`, `ZERODHA_API_SECRET`, `MASTER_KEY_PATH`. |
| `package.json` (updated) | Adds `kiteconnect`, `libsodium-wrappers`. |

### Frontend patch:

A small change to `src/live-ticks.jsx` so the simulator IIFE first **tries to open a WebSocket to `/ws`**, and only falls back to the random walk if the connection fails. Result: locally-served prototype keeps working without a backend, deployed prototype gets real data once you wire Zerodha.

### Ops:

| File | What it does |
|---|---|
| `nginx/rajasekarselvam.com.conf` | Same as v1, with `/api/brokers/zerodha/callback` allowed in CSP `connect-src`. |
| `systemd/ats-backend.service` | Same. |
| `scripts/setup-oracle-linux.sh` | Adds creation of `/etc/ats/master.key`, `/var/lib/ats/tokens/`. |
| `scripts/deploy.sh` | Same. |
| `README-DEPLOY-v2.md` | Full walkthrough for the realtime path — Kite Connect app setup, OAuth, first connect, troubleshooting. |

---

## 4. Verification plan once deployed

```bash
# 1) Smoke check the backend without a broker
curl https://rajasekarselvam.com/api/health
# expect: { ok:true, broker:"mock", killSwitch:true, ... }

# 2) The simulator path should fan out ticks
websocat wss://rajasekarselvam.com/ws
# expect a stream of { type:"tick", symbol:"NIFTY", ltp:..., ts:... }

# 3) Flip to Zerodha
sudo sed -i 's/^BROKER=.*/BROKER=zerodha/' /etc/ats/backend.env
sudo systemctl restart ats-backend
curl https://rajasekarselvam.com/api/health
# expect: { ok:true, broker:"zerodha", connectedUsers:0, ... }

# 4) From the browser, click "Connect Zerodha" → OAuth → redirect back → /api/health shows connectedUsers:1
# 5) The dashboard's <LiveTicker/> and <LiveCell/> now show real LTP values from Kite Ticker
```

---

## 5. Live-trading safety — restated, unchanged

1. **No real order placement in this scaffold.** Read-only realtime data only.
2. **Kill switch defaults `true`.** Even when off, the only order route is dry-run.
3. **Tokens encrypted at rest.** libsodium secretbox, master key in `/etc/ats/master.key` (root-only). Migrate to OCI Vault for prod.
4. **Audit log unchanged.** Every WS connect, broker login, dry-run goes to `/var/log/ats/audit.log`.
5. **BYOK.** Each user provides their own Zerodha credentials via OAuth. The platform never sees their broker password.

When you (Rajasekar) eventually wire real order placement, do it in a separate PR, with:
- Contract test suite green against Paper adapter
- Explicit `LIVE_ORDERS_ENABLED=true` env flag, default false
- Confirmation modal on every order, no auto-fire in v1
- Max-loss-per-day kill switch wired before the first real order

This scaffold leaves all of that to be done deliberately, by you, not by me.

---

## 6. Mapping back to plan doc

| Plan doc section | This deliverable |
|---|---|
| §0 Regulatory reality (BYOK pattern) | OAuth flow per user, no platform-wide token |
| §2 Stage 1 Signals — tick pipeline via Kite Ticker | `brokers/zerodha-broker.js` |
| §3 Broker-portable architecture | `brokers/gateway.js` interface; mock + zerodha adapters |
| §5 Tech Stack — Node + ws for fan-out | `server.js`, `/ws` route |
| §5 Tech Stack — KMS envelope encryption | `crypto-vault.js` (libsodium first, OCI Vault next) |
| §5 Tech Stack — Static IP whitelisting | OCI reserved public IP step in README-DEPLOY-v2.md |
| §6 Claude Code workflow | `BrokerGateway` interface + contract tests is exactly the §6 pattern |
| §8 Phase 2 Data & Signals | This is the start of Phase 2 |
| §9 Risk register — Broker API outage | Heartbeat + reconnect in `zerodha-broker.js` |

Phase 1 (foundation, weeks 1–4) and Phase 4 (live trading) are NOT done here. Phase 2's first slice (data pipeline) is.
