/* eslint-disable */
/* STP/SWP — Systematic Transfer Plans (debt → equity gradually) and
   Systematic Withdrawal Plans (drawdown in retirement). Critical for
   wealth transition stages. */

const StpSwpScreen = () => {
  // Tier 17: this screen has zero backend wiring. Showing fully fabricated data in
  // production is a regulatory and trust risk. Demo-gated until a real backend
  // module lands. Enable Demo mode in your profile menu to preview the planned UI.
  const [_demo] = window.useDemoMode ? window.useDemoMode() : [false];
  if (!_demo) {
    return (
      <div style={{ padding: 24, maxWidth: 720, margin: '40px auto', textAlign: 'center' }}>
        <div style={{ fontSize: 12, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.6 }}>STP / SWP plans</div>
        <div style={{ fontSize: 22, fontWeight: 600, marginTop: 4 }}>Coming soon</div>
        <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 8, lineHeight: 1.5 }}>
          This screen does not yet have a real backend wired. Until stp / swp plans data is sourced from live broker / partner APIs, showing hardcoded sample data is misleading and unsafe.
          Enable <b>Demo mode</b> in your profile menu to preview the planned UI.
        </div>
        <div style={{ marginTop: 16, fontSize: 11, color: 'var(--text-3)' }}>
          Backend module: not yet implemented. Track progress in repo deploy/backend/.
        </div>
      </div>
    );
  }

  const [tab, setTab] = React.useState("active");
  const [showNew, setShowNew] = React.useState(false);

  const activePlans = [
    {
      id: 1, type: "STP", from: "HDFC Liquid Fund", to: "Parag Parikh Flexi Cap",
      amount: 50000, freq: "Weekly", remaining: "18 weeks", total: "32 weeks",
      done: 14, totalUnits: 32, status: "running", started: "Jan 12, 2026",
      reason: "Lump sum ₹16L received from RSU vesting · staggering into equity over 8 months",
    },
    {
      id: 2, type: "STP", from: "Axis Money Market", to: "UTI Nifty 50 Index",
      amount: 25000, freq: "Monthly", remaining: "8 months", total: "12 months",
      done: 4, totalUnits: 12, status: "running", started: "Dec 1, 2025",
      reason: "Bonus deployment · slow ladder into index fund",
    },
    {
      id: 3, type: "STP", from: "ICICI Liquid", to: "Mirae Mid Cap Fund",
      amount: 30000, freq: "Bi-weekly", remaining: "6 months", total: "9 months",
      done: 8, totalUnits: 18, status: "paused", started: "Oct 20, 2025",
      reason: "Auto-paused: Mid cap valuation overheated (PE > 90th percentile)",
    },
  ];

  const swpPlans = [
    {
      id: 4, type: "SWP", from: "Conservative Hybrid Fund", to: "Salary account (HDFC ****2401)",
      amount: 40000, freq: "Monthly", planned: "₹40k/mo for 25 yrs", started: "starts at retirement (Mar 2046)",
      status: "scheduled", purpose: "Retirement income — phase 1 (50% of monthly need)",
      coverage: "31% of estimated retirement spend", longevity: "Capital lasts 28 yrs at 8% growth",
    },
    {
      id: 5, type: "SWP", from: "Equity Savings Fund", to: "Salary account (HDFC ****2401)",
      amount: 60000, freq: "Monthly", planned: "₹60k/mo for 25 yrs", started: "starts at retirement (Mar 2046)",
      status: "scheduled", purpose: "Retirement income — phase 2 (variable, equity-leaning)",
      coverage: "47% of estimated retirement spend", longevity: "Capital lasts 24 yrs at 10% growth",
    },
  ];

  const tabs = [
    { id: "active", label: "Active STPs", n: activePlans.length },
    { id: "swp", label: "SWPs (retirement)", n: swpPlans.length },
    { id: "history", label: "Completed", n: 12 },
    { id: "calculator", label: "Calculator" },
  ];

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 12, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
            Systematic Transfer & Withdrawal
          </div>
          <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 4, maxWidth: 720 }}>
            STP staggers lump sums from debt into equity (lowers timing risk). SWP draws fixed monthly cash from accumulated funds (retirement income phase).
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowNew(true)}>
          <I.plus size={14}/> New plan
        </button>
      </div>

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat label="Active STPs"     value="3" sub="₹105k/wk transferring"/>
        <Stat label="STP capital"     value="₹38.4 L" sub="staggering to equity"/>
        <Stat label="Scheduled SWPs"  value="2" sub="active in 20 yrs"/>
        <Stat label="Avg cost benefit" value="₹4,820" sub="vs lump-sum equivalent"/>
      </div>

      <Card>
        <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--border)", marginBottom: 16 }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              background: "transparent", border: "none",
              padding: "8px 14px", cursor: "pointer", fontSize: 12, fontWeight: 600,
              color: tab === t.id ? "var(--text)" : "var(--text-3)",
              borderBottom: "2px solid " + (tab === t.id ? "var(--acc)" : "transparent"),
              marginBottom: -1,
            }}>
              {t.label}{t.n != null && <span style={{ marginLeft: 6, color: "var(--text-3)", fontWeight: 400 }}>({t.n})</span>}
            </button>
          ))}
        </div>

        {tab === "active" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {activePlans.map(p => (
              <div key={p.id} style={{ padding: 16, border: "1px solid var(--border)", borderRadius: "var(--r-md)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 2 }}>FROM</div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{p.from}</div>
                    </div>
                    <I.arrowRight size={18} color="var(--text-3)"/>
                    <div>
                      <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 2 }}>TO</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--acc)" }}>{p.to}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <Chip variant={p.status === "running" ? "up" : "warn"}>
                      {p.status === "running" ? "● Running" : "⏸ Paused"}
                    </Chip>
                    <button className="btn btn-ghost" style={{ fontSize: 11, padding: "4px 10px" }}>Edit</button>
                    <button className="btn btn-ghost" style={{ fontSize: 11, padding: "4px 10px", color: "var(--down)" }}>Stop</button>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, padding: 12, background: "var(--bg-soft)", borderRadius: "var(--r-sm)", marginBottom: 12 }}>
                  <div>
                    <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600 }}>AMOUNT / TRANSFER</div>
                    <div className="mono" style={{ fontSize: 14, fontWeight: 700, marginTop: 4 }}>₹{p.amount.toLocaleString("en-IN")}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600 }}>FREQUENCY</div>
                    <div style={{ fontSize: 14, fontWeight: 600, marginTop: 4 }}>{p.freq}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600 }}>REMAINING</div>
                    <div style={{ fontSize: 14, fontWeight: 600, marginTop: 4 }}>{p.remaining}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600 }}>STARTED</div>
                    <div style={{ fontSize: 14, fontWeight: 600, marginTop: 4 }}>{p.started}</div>
                  </div>
                </div>

                <div style={{ marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 11, color: "var(--text-3)" }}>
                    <span>Progress: {p.done}/{p.totalUnits} transfers</span>
                    <span className="mono">{((p.done / p.totalUnits) * 100).toFixed(0)}%</span>
                  </div>
                  <div style={{ height: 8, background: "var(--border)", borderRadius: 4, overflow: "hidden", display: "flex" }}>
                    {Array.from({ length: p.totalUnits }).map((_, i) => (
                      <div key={i} style={{
                        flex: 1,
                        background: i < p.done ? "var(--acc)" : "transparent",
                        borderRight: i < p.totalUnits - 1 ? "1px solid var(--bg)" : "none",
                      }}/>
                    ))}
                  </div>
                </div>

                <div style={{
                  padding: 10, borderRadius: "var(--r-sm)",
                  background: p.status === "paused" ? "var(--warn-soft)" : "var(--info-soft)",
                  color: p.status === "paused" ? "var(--warn)" : "var(--info)",
                  fontSize: 11, display: "flex", gap: 8, alignItems: "flex-start",
                }}>
                  <I.info size={12} style={{ marginTop: 2, flexShrink: 0 }}/>
                  <span>{p.reason}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === "swp" && (
          <>
            <div style={{
              padding: 12, marginBottom: 16, borderRadius: "var(--r-md)",
              background: "var(--info-soft)", color: "var(--info)",
              fontSize: 12, display: "flex", gap: 10, alignItems: "center",
            }}>
              <I.sparkle size={14}/>
              <span><strong>Retirement income plan:</strong> Two SWPs activate at 52, designed to draw ₹1L/month combined for 25 years. Tax-efficient: only the gain portion is taxable, base capital is tax-free.</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {swpPlans.map(p => (
                <div key={p.id} style={{ padding: 16, border: "1px solid var(--border)", borderRadius: "var(--r-md)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                    <div>
                      <div style={{ fontSize: 11, color: "var(--text-3)" }}>SWP from</div>
                      <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>{p.from}</div>
                      <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>→ {p.to}</div>
                    </div>
                    <Chip variant="info">⏱ {p.status}</Chip>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, padding: 12, background: "var(--bg-soft)", borderRadius: "var(--r-sm)" }}>
                    <div>
                      <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600 }}>MONTHLY DRAW</div>
                      <div className="mono" style={{ fontSize: 16, fontWeight: 700, marginTop: 4, color: "var(--acc)" }}>₹{p.amount.toLocaleString("en-IN")}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600 }}>COVERAGE</div>
                      <div style={{ fontSize: 14, fontWeight: 600, marginTop: 4 }}>{p.coverage}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600 }}>LONGEVITY</div>
                      <div style={{ fontSize: 14, fontWeight: 600, marginTop: 4 }}>{p.longevity}</div>
                    </div>
                  </div>
                  <div style={{ marginTop: 10, fontSize: 11, color: "var(--text-3)" }}>{p.purpose}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === "history" && (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-3)" }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>✓</div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>12 STPs completed since 2024</div>
            <div style={{ fontSize: 11, marginTop: 6 }}>Average savings vs lump sum: ₹4,820 per plan · Total transferred: ₹78.4 L</div>
          </div>
        )}

        {tab === "calculator" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={{ padding: 16, border: "1px solid var(--border)", borderRadius: "var(--r-md)" }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>STP — should I lump-sum or stagger?</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div><div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4, fontWeight: 600 }}>Lump sum amount (₹)</div><input className="input" defaultValue="1500000"/></div>
                <div><div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4, fontWeight: 600 }}>Stagger over (months)</div><input className="input" defaultValue="6"/></div>
                <div><div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4, fontWeight: 600 }}>Target equity fund</div><select className="input"><option>Parag Parikh Flexi Cap</option><option>UTI Nifty 50 Index</option><option>Mirae Mid Cap</option></select></div>
              </div>
              <div style={{ marginTop: 14, padding: 12, background: "var(--bg-soft)", borderRadius: "var(--r-sm)" }}>
                <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600 }}>RECOMMENDATION (Monte Carlo, 1000 sims)</div>
                <div style={{ fontSize: 13, fontWeight: 600, marginTop: 6, color: "var(--acc)" }}>STP recommended — 64% of paths show better outcome</div>
                <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>Average expected gain: ₹38,200 vs lump sum · Max regret: −₹84,000 (6th percentile)</div>
              </div>
            </div>
            <div style={{ padding: 16, border: "1px solid var(--border)", borderRadius: "var(--r-md)" }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>SWP — how much can I safely withdraw?</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div><div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4, fontWeight: 600 }}>Corpus at start (₹)</div><input className="input" defaultValue="50000000"/></div>
                <div><div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4, fontWeight: 600 }}>Years needed</div><input className="input" defaultValue="30"/></div>
                <div><div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4, fontWeight: 600 }}>Expected post-tax return %</div><input className="input" defaultValue="8"/></div>
              </div>
              <div style={{ marginTop: 14, padding: 12, background: "var(--bg-soft)", borderRadius: "var(--r-sm)" }}>
                <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600 }}>SAFE WITHDRAWAL (95% confidence)</div>
                <div className="mono" style={{ fontSize: 18, fontWeight: 700, marginTop: 6, color: "var(--up)" }}>₹3,82,000 / month</div>
                <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>≈ 4% withdrawal rate · capital lasts to year 32 · 5% chance of running out</div>
              </div>
            </div>
          </div>
        )}
      </Card>

      {showNew && (
        <div onClick={() => setShowNew(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "var(--bg)", borderRadius: "var(--r-lg)", padding: 24, width: 480, maxWidth: "90vw", border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 14 }}>New STP / SWP</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div><div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4, fontWeight: 600 }}>Type</div><select className="input"><option>STP — Debt to Equity</option><option>STP — Equity to Debt (de-risking)</option><option>SWP — Withdrawal to bank</option></select></div>
              <div><div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4, fontWeight: 600 }}>From fund</div><select className="input"><option>HDFC Liquid Fund (₹18.4 L)</option><option>Axis Money Market (₹6.2 L)</option><option>ICICI Liquid (₹12.8 L)</option></select></div>
              <div><div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4, fontWeight: 600 }}>To fund / account</div><select className="input"><option>Parag Parikh Flexi Cap</option><option>UTI Nifty 50 Index</option><option>Mirae Mid Cap</option><option>HDFC Bank ****2401</option></select></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div><div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4, fontWeight: 600 }}>Amount per transfer</div><input className="input" placeholder="50000"/></div>
                <div><div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4, fontWeight: 600 }}>Frequency</div><select className="input"><option>Weekly</option><option>Bi-weekly</option><option>Monthly</option></select></div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 18, justifyContent: "flex-end" }}>
              <button className="btn btn-ghost" onClick={() => setShowNew(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => setShowNew(false)}>Create plan</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

window.StpSwpScreen = StpSwpScreen;
