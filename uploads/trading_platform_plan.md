# AI-Assisted Trading & Investment Platform — India
## End-to-End Plan (Signals → Paper → Live → Profits → Long-Term Investment)
### Primary broker: Zerodha • Broker-portable architecture • AI layer: Claude + Gemini + OpenAI
### Build companion: Claude (Artifacts + Claude Code)

---

## 0. Regulatory Reality (read this before architecture)

SEBI's retail algo trading framework became **fully mandatory on 1 April 2026**. This is the single biggest design constraint, and it invalidates most of the "algo-as-a-service" patterns that existed pre-2026.

**What the framework actually mandates:**

| Rule | Implication for your platform |
|---|---|
| Every algo order must carry an exchange-issued **Algo-ID** | You cannot invent your own IDs; they come from NSE/BSE via the broker |
| Brokers own responsibility for every algo on their rails | You either partner with a broker (empanelment) or the user's own Kite account is the responsible entity |
| Algo providers must be empanelled with exchanges via a broker | No direct-to-exchange connectivity for a SaaS |
| Static IP whitelisting for production algo endpoints | Your execution VMs need fixed IPs — Oracle Cloud ARM works, but you must declare them to the broker |
| "White-box" vs "Black-box" distinction | Retail-facing strategies you publish fall under stricter vendor-empanelment rules than user-built strategies |
| No "guaranteed returns" marketing | Hard compliance boundary — affects every landing page and email |

**The three legal product shapes you can build:**

1. **BYOK (Bring Your Own Kite)** — User connects their own Kite/Upstox/Dhan API key. Your platform generates signals, backtests, paper-trades, and can push orders *to their own account*. The user is the responsible party. **Lowest regulatory burden. Start here.**
2. **Empanelled Algo Vendor** — You register each strategy as a product through a broker partner, get Algo-IDs, and let subscribers subscribe to signed strategies. **Higher burden, real moat, 6–12 month process.**
3. **Research + Analytics (no execution)** — Pure signals, charts, portfolio analytics, no order placement. **No algo-framework exposure at all.** Good as a public/free tier.

**Recommendation:** Launch as a **BYOK platform with a Research tier layered on top**. Keep the architecture ready for Empanelled Vendor mode in year two once you have traction and can afford the compliance overhead.

---

## 1. Product Positioning

### What the platform is
A personal trading and long-term investing cockpit for the Indian retail trader, where AI handles the heavy analytical lifting (news digestion, earnings parsing, regime detection, strategy suggestion) and the human stays in the execution loop — at first manually, then via their own broker API with full audit trails.

### Who it's for (in priority order)
1. **Serious retail traders** already on Kite, doing F&O or swing trades, who want a better research + backtest + paper-trade cockpit than Streak/Sensibull
2. **Long-term investors** who want AI-driven fundamental screens, rebalancing nudges, and tax-loss harvesting
3. **Aspiring algo traders** who want to build and validate strategies without writing full Python themselves

### What the platform is *not*
- Not a broker
- Not a SEBI-registered advisor (avoid personalised "buy X" recommendations until you have RA/RIA registration)
- Not a "guaranteed returns" product
- Not a copy-trading platform in v1 (that's a separate compliance track)

### Moat
Three things that nobody in the Indian retail space does well today:
- **LLM-grade reasoning on Indian market context** — earnings calls in English + Hindi, management commentary, sector rotation stories, not just price/volume indicators
- **Explainable signals** — every signal comes with a natural-language rationale the user can challenge
- **Seamless bridge from intraday trading into long-term investment** — most platforms are one or the other

---

## 2. Feature Flow: Signals → Paper → Live → Profits → Long-Term

### Stage 1 — Signals (the AI + TA engine)

**Inputs**
- Tick/minute/daily OHLCV for NSE equities + F&O (from broker WebSocket or a separate data vendor)
- NSE option chain snapshots (you already have this pipeline)
- News feeds (Moneycontrol, ET Markets, Bloomberg Quint, RSS + scrapes)
- Corporate filings (BSE/NSE corporate announcements)
- Global macro (US close, USD/INR, crude, VIX)

**Processing layers**
1. **Technical** — your existing 22-layer TA stack (Supertrend, RSI divergence, ADX regime, VWAP bands, OI shifts, Max Pain, etc.)
2. **Fundamental screens** — P/E vs sector median, ROE trend, debt/equity, promoter holding delta, FII/DII flow
3. **Event layer** — earnings date proximity, dividend/ex-date, board meetings, block deals
4. **AI layer** — LLM reads the day's news for each watchlist stock and produces: sentiment score, event catalyst summary, management commentary highlights
5. **Regime detector** — is Nifty in trend / range / volatility-expansion regime? Different strategies weight differently

**Outputs**
- Ranked signal cards (BUY / SELL / HOLD / AVOID) with confidence, reasoning, entry/SL/target, timeframe
- Per-signal "explain this to me" dropdown powered by Claude
- Alerts via Telegram, email, in-app, WhatsApp (you have the V3.2 bot already)

### Stage 2 — Paper Trading

**Why this matters more than people think:** Under the new SEBI framework, testing strategies against live market behaviour without capital risk is how you build the confidence to eventually register a strategy for Algo-ID.

**Features**
- Virtual ₹10L / ₹25L / ₹50L accounts per user
- Real-time fill simulation using actual bid/ask (not just LTP)
- Slippage model calibrated from your own live-trade history once you have it
- Full order types: MARKET, LIMIT, SL, SL-M, bracket, cover, iceberg
- F&O margin simulation matching NSE SPAN + exposure margin
- Paper P&L report identical in layout to the live P&L report (same columns, same charts) — this is important for trust transfer
- **"Would I have been in this trade?"** replay mode: pick a historical day, step through candles, see signals as they would have fired

### Stage 3 — Live Trading

**BYOK flow**
1. User goes to Settings → Brokers → Connect Zerodha
2. OAuth redirect to Kite login → user authenticates → TOTP → redirect back with request_token
3. Your server exchanges for access_token, stores encrypted (per-user KMS envelope encryption)
4. User is now "live-ready"
5. Every order the platform generates shows a **confirmation modal** before firing (v1: manual confirm always; v2: configurable auto-fire with circuit breakers)

**Execution safeguards (non-negotiable)**
- Max daily loss kill switch (% of capital, user-defined)
- Max orders per minute circuit breaker
- Max position size per symbol
- Max aggregate exposure
- Pre-market readiness check: access token valid, margin available, no scheduled holiday
- Heartbeat monitor: if price feed gaps >30s, pause auto-execution

**Audit trail (SEBI-aligned)**
- Every order logged with: Algo-ID (from broker), strategy ID, timestamp, user ID, input signal, decision rationale, request/response payloads
- Immutable append-only log (S3 with object lock, or equivalent on your Oracle Cloud setup)
- Exportable as CSV/PDF for user's own records and any regulatory query

### Stage 4 — Profits (analytics & reporting)

This is where most Indian retail platforms are weak, and where Claude as a reasoning layer shines.

**Dashboards**
- P&L: realised, unrealised, day / week / month / FY / since inception
- Per-strategy attribution (which of your strategies is actually making money, which is hiding losses)
- Risk-adjusted metrics: Sharpe, Sortino, max drawdown, win rate, avg win/avg loss, profit factor
- Exposure heatmap: by sector, by Greek (for F&O), by expiry
- Tax view: STCG, LTCG, speculative (intraday equity), F&O business income — mapped to the Indian tax categories, ready-to-hand-to-CA export

**AI-generated monthly review**
A Claude-written narrative at month-end: "Here's what worked, here's what didn't, here's what your behaviour shows about your biases (e.g., you cut winners too early on Tuesdays)." This is the killer feature.

### Stage 5 — Long-Term Investment

The bridge from trading into investing is underserved.

**Features**
- **Goals engine** — retirement, child education, home down payment, with inflation-adjusted targets
- **SIP manager** — scheduled mutual fund / direct equity / ETF investments via Zerodha Coin or direct broker API
- **Portfolio construction** — Modern Portfolio Theory optimiser over user-selected universe, rebalance suggestions
- **Factor tilts** — value, quality, momentum, low-vol overlays
- **Rebalancing** — calendar-based or threshold-based, with tax-aware trade lists (LTCG harvesting)
- **Bucket strategy** — emergency / short-term / long-term buckets with different allocations
- **Retirement withdrawal simulator** — SWP modelling, safe withdrawal rate under Indian tax regime

---

## 3. Broker-Portable Architecture (the most important engineering decision)

You explicitly asked for Zerodha first, everything else pluggable. This is the pattern.

### The abstraction

```
┌─────────────────────────────────────────────────────┐
│               Application Layer                      │
│  (Strategy engine, UI, signals, reports)             │
└───────────────────┬─────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────┐
│          BrokerGateway (abstract interface)          │
│                                                      │
│  place_order() cancel_order() modify_order()         │
│  get_positions() get_holdings() get_margins()        │
│  get_orderbook() get_tradebook() get_ltp()           │
│  subscribe_ticks() subscribe_orderupdates()          │
│  get_instruments() get_historical()                  │
└───────┬─────────┬─────────┬─────────┬───────┬───────┘
        │         │         │         │       │
        ▼         ▼         ▼         ▼       ▼
   ZerodhaAdapt  Upstox  DhanHQ   AngelOne  Fyers
   (primary)    Adapter  Adapter  SmartAPI  Adapter
```

### What each adapter implements

A single `BrokerGateway` interface with these method groups:

**Auth**
- `build_login_url() -> str`
- `exchange_request_token(token: str) -> Session`
- `refresh_if_needed(session: Session) -> Session`

**Orders**
- `place_order(order: NormalisedOrder) -> BrokerOrderId`
- `modify_order(order_id, changes) -> None`
- `cancel_order(order_id) -> None`
- `get_order(order_id) -> NormalisedOrderStatus`

**Portfolio**
- `get_positions() -> List[Position]`
- `get_holdings() -> List[Holding]`
- `get_margins() -> Margins`

**Market data**
- `get_quote(instrument_ids) -> Dict[InstrumentId, Quote]`
- `get_historical(instrument_id, interval, from_, to_) -> List[Candle]`
- `subscribe_ticks(instrument_ids, callback) -> Subscription`

### Normalised domain models (your canonical types)

```python
# These are YOUR types, not any broker's types
class Instrument:
    symbol: str          # "RELIANCE"
    exchange: Exchange   # NSE, BSE, NFO, BFO, MCX
    instrument_type: InstrumentType  # EQ, FUT, CE, PE
    expiry: date | None
    strike: Decimal | None
    lot_size: int
    tick_size: Decimal
    # Per-broker token mapping lives in a separate lookup table

class NormalisedOrder:
    instrument: Instrument
    side: Side           # BUY, SELL
    quantity: int
    order_type: OrderType  # MARKET, LIMIT, SL, SL_M
    product: Product     # CNC, MIS, NRML
    validity: Validity   # DAY, IOC, TTL
    price: Decimal | None
    trigger_price: Decimal | None
    disclosed_qty: int | None
    tag: str             # your strategy ID — becomes part of Algo-ID mapping

class Position:
    instrument: Instrument
    quantity: int
    average_price: Decimal
    last_price: Decimal
    pnl: Decimal
    product: Product
```

### Why this works across brokers

Every Indian broker API (Kite, Upstox, SmartAPI, DhanHQ, Fyers) has slightly different field names and token systems, but the *concepts* are identical. The adapter's job is translation. When a user switches from Zerodha to Dhan:

1. They disconnect Zerodha in Settings
2. They connect Dhan
3. Every positions/holdings screen keeps working because the app only ever sees `Position`, never `DhanPosition` or `KitePosition`
4. Open strategies keep running — each new order goes through the Dhan adapter instead of Zerodha

### Instrument token mapping

Each broker uses different integer tokens for the same instrument. Maintain a `instrument_token_map` table: `(canonical_instrument_id, broker, broker_token)`. Refresh daily from each broker's instrument dump at 6am IST.

### Implementation order
1. **ZerodhaAdapter** — full, production (you already have most of this)
2. **Mock/PaperAdapter** — critical for paper trading, same interface
3. **UpstoxAdapter** — second priority, ₹10/order pricing is attractive Upstox's developer community extends ₹10 per executed order via API until 31 March 2026
4. **DhanHQAdapter** — third, automation-friendly, good developer experience
5. **AngelOneAdapter** (SmartAPI) — large user base
6. **FyersAdapter** — fourth, TradingView-friendly

Write a **contract test suite** that every adapter must pass. Same test, six implementations. This is how you stay honest about portability.

---

## 4. AI Layer: Claude vs Gemini vs OpenAI — where each wins

You mentioned all three. They're not interchangeable for this domain. Route by task.

| Task | Best model | Why |
|---|---|---|
| Signal rationale / explainability in natural language | **Claude (Sonnet/Opus)** | Best at nuanced reasoning, least hallucination on numbers when given the data, great at "explain this to me like I'm a beginner / pro" modes |
| Monthly review narrative & behavioural feedback | **Claude** | Tone, honesty, and ability to push back gently |
| News ingestion at scale (thousands of articles/day) | **Gemini Flash 2.5** | Cheapest per token at acceptable quality, huge context window, fast. You already use it in the PDF platform. |
| Structured extraction from earnings PDFs / concalls | **Gemini Pro** | PDF and multimodal handling is strongest here |
| Code generation for strategy scaffolding | **Claude (via Claude Code)** | Strongest at writing correct, tested Python/TypeScript |
| Embeddings for semantic search over historical research | **OpenAI text-embedding-3-large** or **Voyage** | Best embedding quality per cost in this class |
| Chart pattern recognition from images | **Gemini Pro** or **GPT-4o** | Vision quality |
| Whisper-equivalent for management commentary audio | **OpenAI Whisper** | De facto standard |
| Fallback / redundancy when primary provider is down | Whichever is secondary | Every call must have a failover |

### Architectural pattern: `LLMGateway`

Same idea as `BrokerGateway`. One interface, multiple implementations. Route at the call site by task type, not hardcoded per provider. This lets you A/B test, fall back on rate limits, and swap models as they get cheaper/better every quarter.

```python
class LLMGateway:
    async def complete(
        self,
        task: TaskType,      # determines routing
        messages: list[Message],
        tools: list[Tool] | None = None,
        response_format: Schema | None = None,
    ) -> Response
```

Behind the scenes: a routing table (config-driven, hot-reloadable) picks Claude / Gemini / OpenAI per task, with automatic fallback.

### Cost discipline

LLM costs are the #1 way an AI-heavy product bleeds money. Three disciplines from day one:
- **Cache aggressively** — news summaries, earnings digests, per-stock research snapshots get cached daily, not regenerated on every user request
- **Tiered routing** — free-tier users see Gemini Flash outputs; paid users get Claude Sonnet outputs; pro users can opt into Claude Opus
- **Budget alarms** — per-user daily cap and platform-wide daily cap; alerts wired to your phone

---

## 5. Tech Stack

### Frontend
- **Next.js 15 + React 19 + TypeScript** — server components for SEO on marketing/research pages, client components for the cockpit
- **TailwindCSS + shadcn/ui + Radix** — you can prototype the entire component library in Claude Artifacts
- **TanStack Query** — server state
- **Zustand** — client state (auth, UI preferences)
- **Lightweight Charts (TradingView)** or **ApexCharts** — charting (TradingView's free library is still the gold standard for candlesticks)
- **WebSocket client** — for live prices and order updates, with auto-reconnect

### Backend
- **Python (FastAPI)** for anything that touches strategies, ML, or LLMs — you're already deep in Python
- **Go or Node (NestJS)** for the low-latency order gateway and WebSocket fan-out — optional, Python is fine to start
- **PostgreSQL 16** — primary store. Time-series extension `pg_timescaledb` for tick/candle data if you don't want a separate store
- **Redis** — cache, rate-limit, pub/sub between services
- **ClickHouse** (optional, later) — if tick data volume outgrows Postgres+Timescale
- **Celery + Redis** or **Temporal.io** — job orchestration (EOD data pull, daily rebalance, monthly reports)

### Data layer
- **Broker WebSocket** — primary live feed (Kite Ticker, Upstox MarketDataFeed)
- **Yahoo Finance / NSE bhavcopy** — EOD fallback
- **NewsAPI / RSS / scrapes** — news feed (respect robots.txt)
- **NSE option chain** — your existing pipeline, runs every 3 min during market hours

### Infrastructure
- **Oracle Cloud ARM** — you already have this running well for ORACLE v9.0; keep it
- **Cloudflare R2** — object storage (you're already using it for the PDF product), good for backups and report PDFs
- **Cloudflare (CDN + WAF)** — DDoS, rate-limiting, bot protection on public endpoints
- **Static IP** — assign to the execution VM, declare to broker for whitelisting (SEBI requirement)

### Observability
- **OpenTelemetry** traces across services
- **Grafana + Loki + Prometheus** on the Oracle VM
- **Sentry** for error tracking
- **Uptime Kuma** for public endpoint monitoring
- **Business dashboards** — daily active users, signals generated, paper-trade P&L, live-trade P&L (aggregate, anonymised), LLM cost burn

### Security
- **KMS envelope encryption** for broker access tokens (Oracle Vault or age-based libsodium if self-hosted)
- **2FA mandatory for live trading** (TOTP)
- **Per-user signing key** for every API request from frontend to backend
- **Rate limits** per endpoint, per user
- **Penetration test** before public beta (get a third-party firm, not your own tooling)
- **SOC 2 type I** track from day one (don't retrofit later)

---

## 6. Using Claude to Build This — a Practical Workflow

You're already comfortable with Claude. Here's where it's highest-leverage for this project specifically.

### Claude Artifacts — for the UI
The entire cockpit UI can be prototyped in React/HTML Artifacts before you write a single line of production code.

Suggested Artifact prompt pattern:
> "Build a React component for the signals dashboard: ranked list of 20 signals, each with symbol, side, confidence score, entry/SL/target, rationale preview, 1-click expand. Use shadcn/ui primitives. Dark mode. Mobile responsive. Use realistic Indian stock symbols and NSE prices for the mock data."

Iterate in Artifacts until the UX is right. Then pull that JSX into Next.js and wire to real data.

### Claude Code — for the backend
Claude Code is built for exactly this kind of multi-file codebase work. Typical tasks:
- "Generate the ZerodhaAdapter implementation of BrokerGateway, with all 12 methods, passing the contract test suite at tests/adapters/contract_test.py"
- "Wire up the WebSocket fan-out — one process consumes Kite Ticker, fans out to N user-scoped Redis pub/sub channels, with auth check per subscription"
- "Implement the Paper broker with realistic slippage based on a Gaussian model around best bid/ask"

### Claude as the in-app AI
Claude Sonnet or Opus served through your LLMGateway becomes the user-facing explanation engine. Guardrails:
- System prompt forbids specific buy/sell recommendations without registration
- Tool use to fetch live context (positions, recent signals) rather than hallucinating
- Every response cached by (user_id, query_hash) for 15 minutes

### Design system (what "using Claude Design" should actually mean)

Define once, use everywhere:
- **Colour**: dark-first, muted teal or muted indigo primary (not trading-red by default; red/green only for P&L)
- **Typography**: Inter for UI, JetBrains Mono for numbers/tables
- **Spacing**: 4px base grid
- **Component library**: shadcn/ui — every component skinned once, then locked
- **Icons**: Lucide (ships with shadcn)
- **Motion**: Framer Motion, restrained — market data moves fast enough, the UI shouldn't

Prototype each screen in an Artifact first, get it right visually, then port to the app. This is 3× faster than designing in code.

---

## 7. Monetization (SEBI-compliant)

### What you can charge for
- Subscription for platform access (like Sensibull, Streak) ✓
- Subscription for premium research/analytics ✓
- Subscription for advanced AI features ✓
- Subscription for advanced backtesting / paper capital ✓

### What you cannot do without registration
- Charge for "buy X stock" recommendations (needs Research Analyst or Investment Advisor registration)
- Charge a performance-linked fee on user's P&L (regulated portfolio management activity)
- Advertise returns, win rates, "crore in 6 months" ANYWHERE — this is an instant red flag

### Suggested tiers (₹ INR, monthly)

| Tier | Price | Limits |
|---|---|---|
| Free | ₹0 | Top 10 signals/day (Gemini Flash), paper ₹10L, read-only research |
| Trader | ₹999 | All signals (Claude Sonnet), paper ₹50L, live trading via BYOK, monthly AI review |
| Pro | ₹2,499 | Claude Opus explanations, custom strategies, unlimited backtests, priority support |
| Quant | ₹4,999 | API access, custom indicator builder, strategy marketplace (publish your own) |

Annual plans at ~20% discount. Add-ons: extra paper capital, advanced data feeds, SMS alerts.

### Payment rails
- Razorpay (primary) — best Indian developer experience
- UPI autopay for subscription renewals
- GST-compliant invoicing from day one (18% GST on SaaS)

---

## 8. Phased Roadmap (24 weeks to public beta)

### Phase 1: Foundation (Weeks 1–4)
- Repo + CI + infra on Oracle Cloud
- Auth (email + OTP), user model, basic settings
- `BrokerGateway` interface + `PaperAdapter` + `ZerodhaAdapter` (auth, basic orders, positions)
- `LLMGateway` interface + Claude + Gemini implementations
- Contract test suite for both gateways

### Phase 2: Data & Signals (Weeks 5–8)
- Instrument master sync (daily Zerodha dump)
- Tick pipeline via Kite Ticker → Redis → DB
- Historical candle store (1m, 5m, 15m, 1h, 1d)
- Port your 22-layer TA engine into the signals service
- News ingestion (RSS + scrape)
- Signal generation pipeline + cache
- Basic signals dashboard UI (via Artifacts → port)

### Phase 3: Paper Trading (Weeks 9–12)
- Paper account creation, virtual capital
- Order lifecycle: place, modify, cancel, fill simulation
- Paper P&L, positions, holdings
- Charts on each symbol with signal overlays
- Strategy backtester (walk-forward, out-of-sample)

### Phase 4: Live Trading (Weeks 13–16)
- Zerodha OAuth, token vault, auto-refresh
- Live order placement with confirmation modal
- Circuit breakers + kill switches
- Real positions/holdings/margins sync
- Audit log with Algo-ID capture
- **Private beta** with 20 hand-picked users

### Phase 5: Analytics & Reporting (Weeks 17–20)
- Full P&L analytics dashboard
- Risk-adjusted metrics
- Tax view with FY export
- Monthly Claude review email
- Behavioural insights

### Phase 6: Long-Term Investment + Public Beta (Weeks 21–24)
- Goals engine
- SIP manager via Coin/direct
- Portfolio optimiser
- Rebalancing with tax-loss harvesting
- Second broker adapter (Upstox)
- **Public beta launch**

### Post-beta: Year 2
- Additional broker adapters (Dhan, Angel, Fyers)
- Empanelled vendor track — register 2–3 flagship strategies through Zerodha
- Strategy marketplace
- Mobile apps (React Native, share business logic with web)

---

## 9. Risk Register

| Risk | Severity | Mitigation |
|---|---|---|
| SEBI changes the framework again | High | Abstract execution behind `BrokerGateway`; compliance changes become adapter-layer changes |
| LLM costs spiral | High | Tiered routing, aggressive caching, per-user budgets |
| Broker API outage during market hours | High | Heartbeat monitor, auto-pause, user notification, manual fallback link to Kite web |
| Credential leak (access tokens) | Critical | KMS envelope, no plaintext at rest, revocation on suspicious IP, 2FA on live |
| User blames platform for their losses | Medium | Every live order user-confirmed in v1; clear disclaimers; audit log is defensible |
| Regulatory warning / cease-and-desist | Critical | No "recommendations" or "returns" language; legal review before every marketing push |
| Churn after paper-trade disillusionment | Medium | Set expectations: paper ≠ live because of emotions and slippage; calibrate paper fills to live |
| You burn out maintaining it solo | Medium | Ruthlessly scope v1; keep the contract tests green; document every decision in `/docs/adr` |

---

## 10. First Week Action List

If you want to start tomorrow, this is the order:

1. Write a one-page vision doc. Share with Padhmavathi. Make sure the time-commitment expectations are explicit.
2. Register the domain (suggestions: `noctua.trade`, `ticker.in`, `parity.trade`, `moksh.ai`) — needs to be brandable, no "algo" / "profit" / "guaranteed" in the name
3. Stand up the repo: Next.js app + Python FastAPI service + shared TypeScript types package (via `pnpm` workspaces or Turborepo)
4. Stub `BrokerGateway`, `LLMGateway`, write the contract test suite skeleton
5. Reuse your existing ORACLE v9.0 Zerodha auth code, wrap it in `ZerodhaAdapter`
6. Build the signals dashboard in a Claude Artifact, iterate until it's beautiful, port to Next.js
7. Deploy the marketing landing page before any product — start an email waitlist today

---

## 11. What to not do

- Don't promise returns
- Don't build your own broker
- Don't skip the audit log (you will need it)
- Don't optimise for low latency in v1 — you're not HFT, you're a cockpit
- Don't use localStorage for access tokens (ever)
- Don't couple your app code to Kite types — every `KiteOrder` in the app layer is a bug
- Don't launch live trading without a kill switch you can hit from your phone
- Don't copy Streak/Sensibull — be the one with real AI reasoning, not yet-another-strategy-builder

---

*Document version: v1.0 · 24 April 2026 · Author: Claude, for Rajasekar*
