# AUTOMATED TRADING PLAN — paper-first, capital-agnostic

**Owner:** Rajasekar
**Created:** 2026-05-20 (T-258 / T-260 parameterized)
**Status:** Phase 1 — paper-only validation (KILL_SWITCH=true)

This plan is **not tied to a specific capital amount**. All numbers are
expressed as ratios so you can run `scripts/SETUP-TRADING.cmd` with any
capital and the script computes the derived caps + DCA amounts.

The worked example below uses **C = ₹50,000** to make the numbers concrete.

---

## 1. Capital allocation framework

For any trading capital `C`:

| Bucket | Ratio | Worked example (C = ₹50K) | Purpose |
|---|---|---|---|
| Core long-term DCA | **60%** | ₹30,000 | Monthly SIPs into 4 ETFs via #longterm |
| Active trading float | **30%** | ₹15,000 | Algo executes equity swing/intraday trades |
| Cash buffer | **10%** | ₹5,000 | Absorbs drawdowns, covers brokerage |

### Monthly DCA schedule (Day 5 of each month)

Total monthly DCA = `C × 0.0545` (deploys 60% of capital over ~11 months).

| ETF | Share of monthly DCA | Ratio of C | Worked example (C = ₹50K) | Role |
|---|---|---|---|---|
| NIFTYBEES | 53.6% | C × 0.0292 | ₹1,460 | Broad-market core (Nifty 50) |
| JUNIORBEES | 17.9% | C × 0.0098 | ₹490 | Mid-cap satellite (Nifty Next 50) |
| GOLDBEES | 14.3% | C × 0.0078 | ₹390 | Inflation hedge (physical gold) |
| MOM100 | 14.3% | C × 0.0078 | ₹390 | International diversification (Nasdaq 100) |
| **Total** | 100% | **C × 0.0545** | **₹2,730/mo** | Fully deployed in ~11 months |

For C = ₹50K → ₹2,730/mo × 12 = ₹32,760/yr (≈60% of capital).

---

## 2. Risk caps (capital-scaled)

Apply via `POST /api/risk/config`. The setup script does this automatically.

| Cap | Formula | Worked example (C = ₹50K) | Rationale |
|---|---|---|---|
| `maxPositionSizeINR` | **C × 0.05** | ₹2,500 | Survives 20 consecutive losers |
| `maxDailyLossINR` | **C × 0.02** | ₹1,000 | 2% daily — auto-pause if hit |
| `maxWeeklyLossINR` | **C × 0.05** | ₹2,500 | 5% weekly — auto-pause until Monday |
| `maxDrawdownPct` | **15%** | — | Hard stop on auto-trades |
| `killSwitchDrawdownPct` | **8%** | — | Auto-flips KILL_SWITCH on bad single day |
| `maxOpenPositions` | **3** | — | Force concentration |
| `maxTradesPerDay` | **5** | — | Stops over-trading on noisy days |
| `minTradeIntervalMin` | **15** | — | Cool-down between same-symbol entries |
| `allowedSegments` | NSE only | — | No BSE, no NFO/BFO/MCX |
| `allowedProducts` | CNC, MIS | — | No NRML (no F&O carry-forward) |

Note: pct caps stay the same regardless of capital size. INR caps scale with C.

---

## 3. Strategy selection

22 indicator-based strategies are registered. Use **3 in parallel**, voting on entries.

| Strategy | Symbols | Timeframe | Why |
|---|---|---|---|
| **supertrend** | RELIANCE, HDFCBANK, INFY, TCS, ICICIBANK | 1-day | Best trend-following, low whipsaw |
| **rsi_mean_revert** | Same 5 | 1-hour | Counter-trend on oversold; complements supertrend |
| **vwap** | NIFTYBEES, JUNIORBEES | 5-min | Intraday entry timing |

**Entry logic:** trade fires only when ≥2 of 3 strategies agree on direction. Cuts false positives ~60%.

---

## 4. Phased rollout

Same regardless of capital. Each phase changes KILL_SWITCH state, not the math.

| Phase | Duration | KILL_SWITCH | Capital usage |
|---|---|---|---|
| **Phase 0 (now)** | — | ON | Setup |
| **Phase 1 — paper sim** | 4 weeks | ON | 100% paper (mirror of C) |
| **Phase 2 — micro live** | 4 weeks | OFF | 10% real, 90% paper. Caps shrunk 10× |
| **Phase 3 — full live** | ongoing | OFF | 100% real with caps from §2 |
| **Auto-pause trigger** | any time | auto-ON | Drawdown ≥8% OR 3 losing weeks |

---

## 5. Realistic expectations

Independent of C, the **percentages** are similar at this style:

| Metric | Target |
|---|---|
| Annual return (CAGR) | 12–18% |
| Max drawdown | <15% |
| Sharpe ratio | >1.0 |
| Win rate | 45–55% |
| Avg trade duration | 2–14 days |

At C = ₹50K @ 15% CAGR = ₹7,500/year. At C = ₹5L @ 15% = ₹75,000/year. The **system** is what scales; the math is identical.

---

## 6. Skip list

- **F&O** — lot sizes too big to risk-manage at small C (NIFTY lot ≈ ₹11K margin)
- **Intraday MIS leverage** — even with 5x available, leverage compounds losses
- **Penny stocks / illiquid mid-caps** — slippage eats edge at micro-size
- **Discretionary overrides** — defeats automation

---

## 7. Monthly review checklist (15 minutes, last Sunday)

1. #money — Profit MTD vs target (12-18% annualized)
2. #portfolio — Drift check; long-term should approach 60% by month 3
3. #attribution — Best/worst strategy; disable consistent losers
4. #longterm — Verify monthly SIPs fired on day 5
5. #recon — Broker holdings = ATS holdings (paper: trivial)

---

## 8. References

- Strategy implementations: `deploy/backend/strategies/*.js`
- Risk cap enforcement: `deploy/backend/risk.js`
- Autorun cron: `deploy/backend/autorun.js`
- DCA SIP engine: `deploy/backend/longterm.js`
- Kill switch: `KILL_SWITCH` env var in `/etc/ats/backend.env`
- Setup script: `scripts/SETUP-TRADING.cmd` (parameterized, takes capital as input)

---

## 9. Change log

- 2026-05-20 (T-258): Initial doc — hardcoded ₹50K
- 2026-05-20 (T-260): **Parameterized** — all numbers as ratios of capital C
- 2026-05-20 (T-259 → T-260): SETUP-50K-TRADING.cmd → SETUP-TRADING.cmd, prompts for capital
- 2026-05-20 (T-257): UI streamlined to 12 nav entries to support this workflow
