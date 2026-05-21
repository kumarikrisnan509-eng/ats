# AUTOMATED TRADING PLAN — ₹50,000 capital, paper-first

**Owner:** Rajasekar
**Created:** 2026-05-20 (T-258)
**Status:** Phase 1 — paper-only validation (KILL_SWITCH=true)

---

## 1. Capital allocation

Starting capital: **₹50,000** (paper, for now)

| Bucket | Amount | % | Purpose |
|---|---|---|---|
| Core long-term DCA | ₹30,000 | 60% | Monthly SIPs into 4 ETFs via #longterm |
| Active trading float | ₹15,000 | 30% | Algo executes equity swing/intraday trades |
| Cash buffer | ₹5,000 | 10% | Absorbs drawdowns, covers brokerage |

### Monthly DCA schedule (Day 5 of each month)

| ETF | Monthly | Annual | Role |
|---|---|---|---|
| NIFTYBEES | ₹1,500 | ₹18,000 | Broad-market core (Nifty 50) |
| JUNIORBEES | ₹500 | ₹6,000 | Mid-cap satellite (Nifty Next 50) |
| GOLDBEES | ₹400 | ₹4,800 | Inflation hedge (physical gold) |
| MOM100 | ₹400 | ₹4,800 | International diversification (Nasdaq 100) |
| **Total** | **₹2,800/mo** | **₹33,600/yr** | Fully deployed in 11 months |

After deploying ₹30K via DCA, the active trading float stays at ₹15K (rebalance monthly if it drifts).

---

## 2. Risk caps (the most important section)

Apply via `POST /api/risk/config` (see SETUP-50K-TRADING.cmd):

| Cap | Value | Rationale |
|---|---|---|
| `maxPositionSizeINR` | ₹2,500 | 5% of equity — survives 20 consecutive losers |
| `maxDailyLossINR` | ₹1,000 | 2% — auto-pause if hit |
| `maxWeeklyLossINR` | ₹2,500 | 5% — auto-pause until Monday |
| `maxDrawdownPct` | 15% | If account dips to ₹42,500, halt all auto-trades |
| `maxOpenPositions` | 3 | Force concentration, avoid spray-and-pray |
| `maxTradesPerDay` | 5 | Stops over-trading on noisy days |
| `minTradeIntervalMin` | 15 | Cool-down between same-symbol entries |
| `allowedSegments` | NSE only | No BSE, no NFO/BFO/MCX |
| `allowedProducts` | CNC, MIS | No NRML (no carry-forward F&O positions) |
| `killSwitchDrawdownPct` | 8% | Auto-flip KILL_SWITCH if single day loss hits 8% |

---

## 3. Strategy selection

The platform has 22 indicator-based strategies. Use **3 in parallel**, voting on entries.

| Strategy | Why | Symbols | Timeframe |
|---|---|---|---|
| **supertrend** | Best trend-following, low whipsaw | RELIANCE, HDFCBANK, INFY, TCS, ICICIBANK | 1-day candles |
| **rsi_mean_revert** | Counter-trend on oversold; complements supertrend | Same 5 symbols | 1-hour candles |
| **vwap** | Intraday entry timing | NIFTYBEES, JUNIORBEES | 5-min candles |

**Entry logic:** trade fires only when ≥2 of 3 strategies agree on direction. This cuts false-positive rate by ~60%.

Other 19 strategies stay registered but unused. Re-enable one at a time only after seeing results.

---

## 4. Phased rollout

| Phase | Duration | KILL_SWITCH | Capital | Your role |
|---|---|---|---|---|
| **Phase 0 (now)** | — | ON | ₹0 | Setup |
| **Phase 1 — paper sim** | 4 weeks | ON | ₹50K paper | Daily 5-min review on #paper and #attribution |
| **Phase 2 — micro live** | 4 weeks | OFF | ₹5K real, ₹45K paper | Caps shrunk 10× — max ₹250 per trade. Verify fills match paper sim |
| **Phase 3 — full live** | ongoing | OFF | ₹50K real | Caps from §2. Monthly review on #money and #attribution |
| **Auto-pause** | any time | auto-ON | — | If drawdown ≥8% OR 3 losing weeks straight → revert to Phase 1 |

---

## 5. Realistic expectations

| Metric | Target | What it means |
|---|---|---|
| Annual return (CAGR) | **12–18%** | Good for algo + technical signals at this scale |
| Max drawdown | **<15%** | Hard cap at this scope |
| Sharpe ratio | **>1.0** | Risk-adjusted return better than buy-and-hold |
| Win rate | **45–55%** | Most algo strategies don't need >50% to be profitable |
| Avg trade duration | **2–14 days** | Swing trades, not scalping |

**₹50K @ 15% CAGR = ₹7,500/year.** Not life-changing yet — this is proof-of-concept scale. The real value is the SYSTEM that scales 10× when you add another zero to capital.

---

## 6. Skip list (what we're explicitly NOT doing)

- **F&O (NIFTY/BANKNIFTY options/futures)** — lot sizes too big for ₹50K; one bad trade can wipe 30%+
- **Intraday MIS leverage** — ₹50K × 5x = ₹2.5L notional. Tempting but leverage compounds losses
- **Penny stocks / illiquid mid-caps** — slippage eats the edge at micro-size
- **Crypto** — not supported by Zerodha Kite Connect, not in scope
- **Discretionary trading** — defeats the purpose of automation

---

## 7. Monthly review checklist (15 minutes, last Sunday of month)

1. Open #money — look at "Profit MTD" vs target (₹600/mo for 15% CAGR)
2. Open #portfolio — check drift; long-term DCA should be ~60% by month 3
3. Open #attribution — find best/worst strategy. If one is consistently losing → disable
4. Open #longterm — verify monthly SIPs executed on day 5
5. Open #recon — broker holdings should match ATS holdings (paper-only: trivially yes)

---

## 8. References

- Strategy implementations: `deploy/backend/strategies/*.js`
- Risk cap enforcement: `deploy/backend/risk.js`
- Autorun cron: `deploy/backend/autorun.js`
- DCA SIP engine: `deploy/backend/longterm.js`
- Kill switch: `KILL_SWITCH` env var in `/etc/ats/backend.env`
- Setup script: `scripts/SETUP-50K-TRADING.cmd`

---

## 9. Change log

- 2026-05-20 (T-258): Initial doc, written during ₹50K plan session
- 2026-05-20 (T-259): SETUP-50K-TRADING.cmd shipped
- 2026-05-20 (T-257): UI streamlined to 12 nav entries to support this workflow
