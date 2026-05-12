/* eslint-disable */
/* Tax & Goals screen — Stage 5: long-term investment planning + tax harvesting */

const TaxScreen = () => {
  const [tab, setTab] = useState("Tax");
  const tabs = ["Tax", "Goals", "Rebalance", "AI review"];

  const taxBuckets = [
    { k: "STCG (equity)",       gain: 48240,  tax: 15,   tax_amt: 7236,  color: "var(--info)" },
    { k: "LTCG (equity)",       gain: 182400, tax: 10,   tax_amt: 12240, color: "var(--accent)", note: "₹1L exempt" },
    { k: "Intraday (speculative)", gain: 24800, tax: "slab",tax_amt: 7440,color: "var(--warn)", note: "added to income" },
    { k: "F&O (business income)",  gain: 84600, tax: "slab",tax_amt: 25380,color: "var(--violet)",note: "+ 44AD option" },
    { k: "MF — LTCG",           gain: 42800,  tax: 10,   tax_amt: 4280,  color: "var(--accent)" },
    { k: "MF — STCG",           gain: 8400,   tax: 15,   tax_amt: 1260,  color: "var(--info)" },
  ];
  const totalGain = taxBuckets.reduce((s,b) => s + b.gain, 0);
  const totalTax  = taxBuckets.reduce((s,b) => s + b.tax_amt, 0);

  const harvestCandidates = [
    { s: "VEDL",       qty: 100, avg: 412, ltp: 368, loss: -4400,  type: "STCL", age: "4 mo", ok: true },
    { s: "IDEA",       qty: 500, avg: 14.2, ltp: 10.8, loss: -1700, type: "STCL", age: "8 mo", ok: true },
    { s: "YESBANK",    qty: 300, avg: 22,  ltp: 18.5, loss: -1050, type: "STCL", age: "6 mo", ok: true },
    { s: "PAYTM",      qty: 40,  avg: 820, ltp: 680,  loss: -5600, type: "LTCL", age: "14 mo", ok: true },
  ];

  const goals = [
    { n: "Retirement",          target: 50000000, current: 8420000, by: "2046",      monthly: 45000, on_track: true,  color: "var(--accent)" },
    { n: "Child's education",   target: 12000000, current: 2140000, by: "2038",      monthly: 25000, on_track: true,  color: "var(--info)" },
    { n: "Home down payment",   target:  5000000, current: 1820000, by: "2029",      monthly: 60000, on_track: false, color: "var(--warn)" },
    { n: "Emergency fund",      target:  1800000, current: 1650000, by: "2026",      monthly: 10000, on_track: true,  color: "var(--up)" },
  ];

  const rebalance = [
    { asset: "Equity — large cap",   target: 35, actual: 42, diff: +7, action: "Sell ₹3.4L",  color: "var(--down)" },
    { asset: "Equity — mid cap",      target: 15, actual: 12, diff: -3, action: "Buy ₹1.5L",   color: "var(--up)" },
    { asset: "Equity — small cap",    target: 8,  actual: 6,  diff: -2, action: "Buy ₹1.0L",   color: "var(--up)" },
    { asset: "Debt — bonds",          target: 20, actual: 18, diff: -2, action: "Buy ₹1.0L",   color: "var(--up)" },
    { asset: "Gold (ETF)",            target: 10, actual: 8,  diff: -2, action: "Buy ₹1.0L",   color: "var(--up)" },
    { asset: "International equity",  target: 10, actual: 12, diff: +2, action: "Sell ₹1.0L",  color: "var(--down)" },
    { asset: "Cash",                 target: 2,  actual: 2,  diff:  0, action: "Hold",        color: "var(--text-3)" },
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-header__title">Tax &amp; ITR</h1>
          <div className="page-header__sub">Stage 5: long-term wealth · Indian tax bucketing · goal tracking · tax-loss harvest · AI review</div>
        </div>
        <div className="page-header__right">
          <button className="btn"><I.download size={14}/> Export for CA</button>
          <button className="btn btn--accent"><I.brain size={14}/> Generate AI review</button>
        </div>
      </div>

      <div className="tabs">
        {tabs.map(t => <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t}</button>)}
      </div>

      {tab === "Tax" && (
        <>
          {/* Tax KPIs */}
          <div className="grid grid-4" style={{ marginBottom: 16 }}>
            <Card>
              <Stat label="Realized gains FY26" value={inr(totalGain)} delta="5 tax buckets" deltaKind="up"/>
            </Card>
            <Card>
              <Stat label="Estimated tax" value={inr(totalTax)} delta={pct((totalTax/totalGain)*100,1) + " effective"} deltaKind="muted"/>
            </Card>
            <Card>
              <Stat label="After-tax P&L" value={inr(totalGain - totalTax)} delta="net of estimated tax" deltaKind="up"/>
            </Card>
            <Card>
              <Stat label="Harvest available" value={inr(12750)} delta="4 lots with losses" deltaKind="warn"/>
            </Card>
          </div>

          {/* Tax buckets */}
          <div className="grid grid-2-1" style={{ marginBottom: 16 }}>
            <Card title="Tax buckets — FY 2025-26" sub="Mapped to Indian tax categories · CA-ready export" flush>
              <table className="table">
                <thead><tr><th>Category</th><th className="num-l">Realized gain</th><th className="num-l">Tax rate</th><th className="num-l">Est. tax</th><th>Notes</th></tr></thead>
                <tbody>
                  {taxBuckets.map((b,i) => (
                    <tr key={i}>
                      <td>
                        <div className="row" style={{ gap: 8 }}>
                          <span style={{ width: 3, height: 20, background: b.color, borderRadius: 2, flexShrink: 0 }}/>
                          <span style={{ fontWeight: 500 }}>{b.k}</span>
                        </div>
                      </td>
                      <td className="num">{inr(b.gain)}</td>
                      <td className="num">{typeof b.tax === "number" ? b.tax + "%" : b.tax}</td>
                      <td className="num">{inr(b.tax_amt)}</td>
                      <td><span className="muted" style={{ fontSize: 11 }}>{b.note || "—"}</span></td>
                    </tr>
                  ))}
                  <tr style={{ background: "var(--bg-sunk)" }}>
                    <td style={{ fontWeight: 600 }}>Total</td>
                    <td className="num" style={{ fontWeight: 600 }}>{inr(totalGain)}</td>
                    <td></td>
                    <td className="num" style={{ fontWeight: 600, color: "var(--down)" }}>{inr(totalTax)}</td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </Card>

            <Card title="Tax-loss harvest candidates" sub="Positions with unrealized losses · offset gains" flush>
              <table className="table">
                <thead><tr><th>Symbol</th><th>Type</th><th className="num-l">Loss</th><th></th></tr></thead>
                <tbody>
                  {harvestCandidates.map((h,i) => (
                    <tr key={i}>
                      <td>
                        <div style={{ fontWeight: 500 }}>{h.s}</div>
                        <div className="muted" style={{ fontSize: 11 }}>{h.qty} @ ₹{h.avg} · {h.age}</div>
                      </td>
                      <td><Pill kind={h.type === "LTCL" ? "vio" : "info"}>{h.type}</Pill></td>
                      <td className="num down">{inr(h.loss)}</td>
                      <td><button className="btn btn--sm">Sell</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>

          <div className="banner banner--warn">
            <I.bolt size={18}/>
            <div style={{ flex: 1 }}>
              <strong>Harvest opportunity:</strong> realizing all 4 loss lots (₹12,750) would reduce FY26 tax by ~<span className="mono">₹2,550</span>. Remember the 30-day wash-sale rule — you cannot repurchase same ISIN within 30 days.
            </div>
          </div>
        </>
      )}

      {tab === "Goals" && (
        <>
          <div className="grid grid-2" style={{ marginBottom: 16 }}>
            {goals.map((g,i) => {
              const prog = (g.current / g.target) * 100;
              return (
                <Card key={i}>
                  <div className="between" style={{ marginBottom: 14 }}>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 600 }}>{g.n}</div>
                      <div className="muted" style={{ fontSize: 12 }}>Target by {g.by} · ₹{(g.monthly/1000).toFixed(0)}k/month SIP</div>
                    </div>
                    {g.on_track ? <Pill kind="up" dot>on track</Pill> : <Pill kind="warn" dot>behind</Pill>}
                  </div>
                  <div className="between" style={{ marginBottom: 6, fontSize: 12 }}>
                    <span className="mono">{inrCompact(g.current)}</span>
                    <span className="muted">of {inrCompact(g.target)}</span>
                  </div>
                  <div style={{ height: 10, background: "var(--bg-sunk)", borderRadius: 999, marginBottom: 10 }}>
                    <div style={{ width: Math.min(100, prog) + "%", height: "100%", background: g.color, borderRadius: 999 }}/>
                  </div>
                  <div className="between" style={{ fontSize: 11, color: "var(--text-3)" }}>
                    <span className="mono">{prog.toFixed(1)}% complete</span>
                    <span className="mono">inflation-adj · 6%</span>
                  </div>
                </Card>
              );
            })}
          </div>

          <Card title="SIP manager" sub="Scheduled auto-invest via Zerodha Coin + direct MF" flush>
            <table className="table">
              <thead><tr><th>Fund / instrument</th><th>Goal</th><th className="num-l">Amount</th><th>Frequency</th><th>Next date</th><th>Status</th></tr></thead>
              <tbody>
                {[
                  { n: "Nippon India Small Cap · Direct Growth",    goal: "Retirement",       amt: 15000, freq: "Monthly · 5th",  next: "May 5",  ok: true },
                  { n: "Parag Parikh Flexi Cap · Direct Growth",     goal: "Retirement",       amt: 20000, freq: "Monthly · 5th",  next: "May 5",  ok: true },
                  { n: "UTI Nifty 50 Index · Direct Growth",         goal: "Retirement",       amt: 10000, freq: "Monthly · 5th",  next: "May 5",  ok: true },
                  { n: "Mirae Asset ELSS Tax Saver · Direct",        goal: "Child's education",amt: 12500, freq: "Monthly · 10th", next: "May 10", ok: true },
                  { n: "ICICI Pru Nifty Next 50 Index · Direct",     goal: "Child's education",amt: 12500, freq: "Monthly · 10th", next: "May 10", ok: true },
                  { n: "HDFC Short Term Debt · Direct Growth",        goal: "Home down payment", amt: 60000, freq: "Monthly · 15th", next: "May 15", ok: false },
                ].map((s,i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 500 }}>{s.n}</td>
                    <td><span className="muted" style={{ fontSize: 12 }}>{s.goal}</span></td>
                    <td className="num">{inr(s.amt)}</td>
                    <td><span className="mono" style={{ fontSize: 12 }}>{s.freq}</span></td>
                    <td className="mono" style={{ fontSize: 12 }}>{s.next}</td>
                    <td>{s.ok ? <Pill kind="up" dot>active</Pill> : <Pill kind="warn" dot>low bal · ₹42k needed</Pill>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}

      {tab === "Rebalance" && (
        <>
          <div className="grid grid-2-1" style={{ marginBottom: 16 }}>
            <Card title="Target vs actual allocation" sub="Threshold-based · rebalance trigger at ±5% drift" flush>
              <table className="table">
                <thead><tr><th>Asset class</th><th className="num-l">Target</th><th className="num-l">Actual</th><th className="num-l">Drift</th><th>Action</th></tr></thead>
                <tbody>
                  {rebalance.map((r,i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 500 }}>{r.asset}</td>
                      <td className="num">{r.target}%</td>
                      <td className="num">{r.actual}%</td>
                      <td className="num" style={{ color: Math.abs(r.diff) > 5 ? "var(--warn)" : Math.abs(r.diff) > 0 ? "var(--text-2)" : "var(--text-3)" }}>
                        {r.diff > 0 ? "+" : ""}{r.diff}%
                      </td>
                      <td style={{ color: r.color, fontWeight: 500, fontSize: 13 }}>{r.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card title="Donut · current vs target">
              <div className="col" style={{ gap: 10, alignItems: "center" }}>
                <Donut size={180} thickness={24}
                  data={rebalance.filter(r => r.actual > 0).map((r,i) => ({
                    value: r.actual,
                    color: ["var(--accent)","var(--info)","var(--violet)","var(--warn)","var(--up)","oklch(70% 0.12 300)","var(--text-4)"][i]
                  }))}>
                  <div className="mono" style={{ fontSize: 22, fontWeight: 500 }}>100%</div>
                  <div className="muted" style={{ fontSize: 11 }}>actual mix</div>
                </Donut>
                <div className="col" style={{ gap: 4, width: "100%" }}>
                  {rebalance.slice(0, 4).map((r,i) => (
                    <div key={i} className="between" style={{ fontSize: 11 }}>
                      <div className="row" style={{ gap: 6 }}>
                        <span style={{ width: 8, height: 8, background: ["var(--accent)","var(--info)","var(--violet)","var(--warn)"][i], borderRadius: 2 }}/>
                        <span>{r.asset}</span>
                      </div>
                      <span className="mono">{r.actual}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          </div>

          <Card title="Tax-aware rebalance plan" sub="Orders sequenced to minimize STCG and maximize LTCL offset">
            <div className="col" style={{ gap: 8 }}>
              {[
                { step: 1, action: "Sell VEDL 100 @ ₹368 (STCL -₹4,400)",           why: "Harvest loss to offset STCG",       tax: "-₹660" },
                { step: 2, action: "Sell Nifty Next 50 ETF 80 units @ ₹628 (LTCG +₹4,840)",  why: "LTCG exempt under ₹1L",              tax: "₹0" },
                { step: 3, action: "Buy HDFC Mid Cap ETF 200 units @ ₹248",        why: "Rebalance underweight mid-cap",     tax: "—" },
                { step: 4, action: "Buy HDFC Short Term Debt 200 units @ ₹32.4",   why: "Rebalance debt allocation",         tax: "—" },
                { step: 5, action: "Buy Gold BeES 140 units @ ₹71.2",              why: "Rebalance underweight gold",        tax: "—" },
              ].map((s,i) => (
                <div key={i} className="between" style={{ padding: 12, background: "var(--bg-soft)", border: "1px solid var(--border)", borderRadius: "var(--r-md)" }}>
                  <div className="row" style={{ gap: 12 }}>
                    <div style={{ width: 24, height: 24, borderRadius: 6, background: "var(--accent-soft)", color: "var(--accent-ink)", display: "grid", placeItems: "center", fontFamily: "var(--mono)", fontSize: 11, fontWeight: 600 }}>{s.step}</div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{s.action}</div>
                      <div className="muted" style={{ fontSize: 11 }}>{s.why}</div>
                    </div>
                  </div>
                  <span className="mono" style={{ fontSize: 12, color: s.tax.startsWith("-") ? "var(--up)" : "var(--text-3)" }}>{s.tax}</span>
                </div>
              ))}
            </div>
            <div className="between" style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
              <span className="muted" style={{ fontSize: 12 }}>Total tax impact if executed today</span>
              <span className="mono" style={{ fontSize: 16, fontWeight: 500, color: "var(--up)" }}>-₹660 (net benefit)</span>
            </div>
          </Card>
        </>
      )}

      {tab === "AI review" && (
        <>
          <Card style={{ marginBottom: 16, background: "linear-gradient(135deg, var(--accent-soft), var(--bg-soft))", borderColor: "var(--accent)" }}>
            <div className="row" style={{ gap: 14, alignItems: "flex-start" }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: "var(--accent)", color: "white", display: "grid", placeItems: "center", flexShrink: 0 }}>
                <I.brain size={20}/>
              </div>
              <div style={{ flex: 1 }}>
                <div className="row" style={{ gap: 8, marginBottom: 4 }}>
                  <strong style={{ fontSize: 14 }}>Monthly review — {window.TODAY.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</strong>
                  <Pill kind="acc" dot>Claude Opus 4.6</Pill>
                </div>
                <div className="muted" style={{ fontSize: 12 }}>Generated {window.TODAY_SHORT}, 06:00 IST · 3 behavioral insights · 4 actionable changes</div>
              </div>
              <button className="btn btn--sm"><I.download size={12}/> Email to me</button>
            </div>
          </Card>

          <div className="grid grid-2-1" style={{ marginBottom: 16 }}>
            <Card title="What worked">
              <div className="col" style={{ gap: 12 }}>
                {[
                  { t: "Momentum AI outperformed its backtest", d: "Live paper Sharpe 1.84 vs backtest 1.64. The tighter stop at 1.2× ATR is paying off — you didn't degrade during the mid-April regime shift." },
                  { t: "Iron Condor weekly is your most consistent", d: "82% win rate over 34 trades. The Thursday roll discipline kept theta decay compounding." },
                  { t: "You held RELIANCE through the 4% Apr 17 drawdown", d: "Good. Your historical tendency was to cut winners early on a -3% intraday move. That was a 2.3% improvement this month." },
                ].map((r,i) => (
                  <div key={i} style={{ padding: 12, background: "var(--up-soft)", borderLeft: "3px solid var(--up)", borderRadius: 4 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{r.t}</div>
                    <div className="muted" style={{ fontSize: 12, lineHeight: 1.55 }}>{r.d}</div>
                  </div>
                ))}
              </div>
            </Card>

            <Card title="Behavioral patterns">
              <div className="col" style={{ gap: 12 }}>
                {[
                  { t: "Tuesday losses", v: "-1.8%", d: "You override the kill switch on Tuesdays 2× more often. Consider a Tuesday-specific position size cap." },
                  { t: "Late-day impulse trades", v: "5 trades", d: "5 manual trades after 14:30 · 1 profitable. Your post-2:30pm win rate is 20% vs 68% rest of day." },
                  { t: "News-reaction entries", v: "-₹8,400", d: "3 entries within 15 minutes of earnings news. All 3 lost. Your signal engine already has a 60-min news-cooldown — let it work." },
                ].map((r,i) => (
                  <div key={i} style={{ padding: 12, background: "var(--warn-soft)", borderLeft: "3px solid var(--warn)", borderRadius: 4 }}>
                    <div className="between" style={{ marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 500 }}>{r.t}</span>
                      <span className="mono" style={{ fontSize: 12, color: "var(--warn)" }}>{r.v}</span>
                    </div>
                    <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>{r.d}</div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <Card title="Suggested changes for May" sub="Claude-proposed · accept individually">
            <div className="col" style={{ gap: 10 }}>
              {[
                { change: "Cap Tuesday position size to 60% of normal",                 impact: "Backtest: +₹4,200/month avg",   strat: "Global risk rule" },
                { change: "Disable manual entries between 14:30 – 15:15",              impact: "Historical: +₹12,800 over 12 mo", strat: "Behavioral lock" },
                { change: "Raise Iron Condor capital allocation 250k → 400k",          impact: "Projected: +₹8,400/month",       strat: "Capital reallocation" },
                { change: "Retire Grid Trader strategy (OOS Sharpe below 1.0)",       impact: "Frees ₹400k · reduces noise",     strat: "Strategy lifecycle" },
              ].map((c,i) => (
                <div key={i} className="between" style={{ padding: 12, border: "1px solid var(--border)", borderRadius: "var(--r-md)" }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 2 }}>{c.change}</div>
                    <div className="muted" style={{ fontSize: 11 }}>{c.strat} · {c.impact}</div>
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    <button className="btn btn--sm">Dismiss</button>
                    <button className="btn btn--sm btn--primary">Accept</button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </>
  );
};

Object.assign(window, { TaxScreen });
