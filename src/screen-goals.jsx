/* eslint-disable */
/* Goals — life-goal based investing. Each goal has target amount, deadline,
   monthly contribution, and an asset allocation strategy. System auto-routes
   sweep proceeds to highest-priority under-funded goal. */

const GoalsScreen = () => {
  const [selected, setSelected] = React.useState("retirement");
  const [showNew, setShowNew] = React.useState(false);

  const goals = [
    {
      id: "retirement", icon: "🌅", name: "Retirement (FIRE)", priority: 1,
      target: 50000000, current: 8420000, by: "Mar 2046", years: 20, ageNow: 32, ageEnd: 52,
      monthly: 45000, suggested: 38000, expectedRet: 12, inflation: 6,
      onTrack: true, gap: 0, sip: ["Parag Parikh Flexi", "UTI Nifty 50 Index", "Mirae Mid Cap"],
      sweep: 40, lastSweep: "₹15,200 → 8 days ago", color: "var(--acc)",
    },
    {
      id: "education", icon: "🎓", name: "Daughter's education", priority: 2,
      target: 12000000, current: 2140000, by: "Jun 2038", years: 12, ageNow: 6, ageEnd: 18,
      monthly: 25000, suggested: 22000, expectedRet: 11, inflation: 8,
      onTrack: true, gap: 0, sip: ["UTI Nifty 50 Index", "Axis Bluechip", "Bandhan ELSS Tax Saver"],
      sweep: 30, lastSweep: "₹11,400 → 8 days ago", color: "var(--info)",
    },
    {
      id: "home", icon: "🏡", name: "Home down payment", priority: 3,
      target: 5000000, current: 1820000, by: "Aug 2029", years: 4, ageNow: 32, ageEnd: 36,
      monthly: 60000, suggested: 78000, expectedRet: 8, inflation: 5,
      onTrack: false, gap: -18000,
      sip: ["HDFC Short Term Debt", "ICICI Pru Corp Bond", "Axis Banking PSU Debt"],
      sweep: 20, lastSweep: "₹7,600 → 8 days ago", color: "var(--warn)",
    },
    {
      id: "emergency", icon: "🛟", name: "Emergency fund", priority: 0,
      target: 1800000, current: 1650000, by: "Dec 2026", years: 0.5, ageNow: 32, ageEnd: 33,
      monthly: 10000, suggested: 8500, expectedRet: 6, inflation: 6,
      onTrack: true, gap: 0,
      sip: ["Liquid Fund — HDFC", "Liquid Fund — Axis", "Money market — Nippon"],
      sweep: 10, lastSweep: "₹3,800 → 8 days ago", color: "var(--up)",
    },
    {
      id: "vacation", icon: "🌴", name: "Europe trip 2027", priority: 4,
      target: 600000, current: 240000, by: "May 2027", years: 1, ageNow: 32, ageEnd: 33,
      monthly: 25000, suggested: 30000, expectedRet: 7, inflation: 4,
      onTrack: false, gap: -5000,
      sip: ["Conservative Hybrid — ICICI", "Arbitrage Fund — Kotak"],
      sweep: 0, lastSweep: "manual contributions", color: "var(--vio)",
    },
  ];

  const totalTarget = goals.reduce((s, g) => s + g.target, 0);
  const totalCurrent = goals.reduce((s, g) => s + g.current, 0);
  const totalMonthly = goals.reduce((s, g) => s + g.monthly, 0);

  const g = goals.find(x => x.id === selected) || goals[0];
  const pct = (g.current / g.target) * 100;
  const fv = g.current * Math.pow(1 + g.expectedRet / 100, g.years) +
             g.monthly * 12 * (Math.pow(1 + g.expectedRet / 100, g.years) - 1) / (g.expectedRet / 100);
  const inflTarget = g.target * Math.pow(1 + g.inflation / 100, g.years);
  const fvVsTarget = (fv / inflTarget) * 100;

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 12, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
            Long-term wealth · Goal-based investing
          </div>
          <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 4, maxWidth: 720 }}>
            Each goal has its own SIP plan, asset allocation, and a slice of monthly profit sweep. System auto-routes excess profits to whichever goal is most behind schedule.
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowNew(true)}>
          <I.plus size={14}/> New goal
        </button>
      </div>

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat label="Total goal value" value={`₹${(totalTarget/10000000).toFixed(1)} Cr`} sub="across 5 goals"/>
        <Stat label="Saved so far"     value={`₹${(totalCurrent/100000).toFixed(1)} L`} sub={`${((totalCurrent/totalTarget)*100).toFixed(1)}% funded`}/>
        <Stat label="Monthly SIP"      value={`₹${(totalMonthly/1000).toFixed(0)}k`} sub="auto-debit + sweep"/>
        <Stat label="Goals on track"   value="3 of 5" sub="2 need attention"/>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1fr 2fr", gap: 16 }}>
        {/* Goal list */}
        <Card title="Your goals" sub="Sorted by priority">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {goals.map(goal => {
              const isSel = goal.id === selected;
              const p = (goal.current / goal.target) * 100;
              return (
                <div key={goal.id}
                  onClick={() => setSelected(goal.id)}
                  style={{
                    padding: 12, borderRadius: "var(--r-md)", cursor: "pointer",
                    border: "1px solid " + (isSel ? goal.color : "var(--border)"),
                    background: isSel ? "var(--bg-soft)" : "transparent",
                    transition: "all .15s",
                  }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <div style={{ fontSize: 18 }}>{goal.icon}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{goal.name}</div>
                      <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 1 }}>
                        ₹{(goal.target/100000).toFixed(0)} L by {goal.by}
                      </div>
                    </div>
                    <Chip variant={goal.onTrack ? "up" : "warn"}>
                      {goal.onTrack ? "✓" : "!"}
                    </Chip>
                  </div>
                  <div style={{ height: 6, background: "var(--border)", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ width: `${Math.min(100, p)}%`, height: "100%", background: goal.color }}/>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 10, color: "var(--text-3)" }}>
                    <span className="mono">₹{(goal.current/100000).toFixed(1)} L</span>
                    <span className="mono">{p.toFixed(1)}%</span>
                    <span className="mono">₹{(goal.target/100000).toFixed(0)} L</span>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Goal detail */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card title={`${g.icon}  ${g.name}`} sub={`Target: ₹${(g.target/100000).toFixed(0)} L by ${g.by}  ·  Time horizon: ${g.years} yrs`}>
            {/* Progress hero */}
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr",
              gap: 16, padding: 16, background: "var(--bg-soft)",
              borderRadius: "var(--r-md)", marginBottom: 16,
            }}>
              <div>
                <div style={{ fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>Current value</div>
                <div className="mono" style={{ fontSize: 22, fontWeight: 700, marginTop: 4, color: g.color }}>
                  ₹{(g.current/100000).toFixed(1)} L
                </div>
                <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>{pct.toFixed(1)}% of target</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>Monthly SIP</div>
                <div className="mono" style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>
                  ₹{(g.monthly/1000).toFixed(0)}k
                </div>
                <div style={{ fontSize: 10, color: g.suggested > g.monthly ? "var(--warn)" : "var(--up)", marginTop: 2 }}>
                  {g.suggested > g.monthly ? `↑ Increase to ₹${(g.suggested/1000).toFixed(0)}k recommended` : `✓ Current rate is sufficient`}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>Projected (FV)</div>
                <div className="mono" style={{ fontSize: 22, fontWeight: 700, marginTop: 4, color: fvVsTarget >= 100 ? "var(--up)" : "var(--warn)" }}>
                  ₹{(fv/10000000).toFixed(2)} Cr
                </div>
                <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>
                  vs inflation-adj target ₹{(inflTarget/10000000).toFixed(2)} Cr ({fvVsTarget.toFixed(0)}%)
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>Sweep allocation</div>
                <div className="mono" style={{ fontSize: 22, fontWeight: 700, marginTop: 4, color: "var(--acc)" }}>
                  {g.sweep}%
                </div>
                <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>{g.lastSweep}</div>
              </div>
            </div>

            {/* Trajectory chart */}
            <div style={{ marginBottom: 8, fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600 }}>
              Projected trajectory ({g.years} years)
            </div>
            <svg width="100%" height="180" viewBox="0 0 700 180" style={{ display: "block" }}>
              {/* Target line */}
              <line x1={20} x2={680} y1={30} y2={30} stroke="var(--up)" strokeWidth="1.5" strokeDasharray="4,4"/>
              <text x={680} y={26} fontSize="10" fill="var(--up)" textAnchor="end">target ₹{(inflTarget/10000000).toFixed(2)} Cr (infl-adj)</text>
              {/* Months */}
              {(() => {
                const N = Math.max(g.years * 12, 12);
                const points = Array.from({ length: N + 1 }, (_, i) => {
                  const months = i;
                  const r = g.expectedRet / 100 / 12;
                  const v = g.current * Math.pow(1 + r, months) + g.monthly * (Math.pow(1 + r, months) - 1) / r;
                  const x = 20 + (i / N) * 660;
                  const y = 160 - Math.min(140, (v / inflTarget) * 130);
                  return { x, y, v };
                });
                return (
                  <>
                    <polygon
                      points={points.map(p => `${p.x},${p.y}`).join(" ") + ` ${points[points.length-1].x},160 ${points[0].x},160`}
                      fill={g.color} opacity="0.15"/>
                    <polyline
                      points={points.map(p => `${p.x},${p.y}`).join(" ")}
                      fill="none" stroke={g.color} strokeWidth="2"/>
                    <circle cx={points[points.length-1].x} cy={points[points.length-1].y} r="4" fill={g.color}/>
                  </>
                );
              })()}
              {/* X-axis */}
              <line x1={20} x2={680} y1={160} y2={160} stroke="var(--border)"/>
              <text x={20} y={175} fontSize="10" fill="var(--text-3)">today</text>
              <text x={680} y={175} fontSize="10" fill="var(--text-3)" textAnchor="end">{g.by}</text>
            </svg>
          </Card>

          {/* SIP breakdown */}
          <Card title="SIP plan for this goal" sub="Auto-debited monthly + monthly sweep top-up">
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {g.sip.map((fund, i) => (
                <div key={i} style={{
                  display: "grid", gridTemplateColumns: "1fr auto auto auto",
                  alignItems: "center", gap: 12, padding: "12px 0",
                  borderTop: i ? "1px solid var(--border)" : "none",
                }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{fund}</div>
                    <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>1st of month · auto-debit · KFinTech</div>
                  </div>
                  <Chip variant="info">{i === 0 ? "60%" : i === 1 ? "30%" : "10%"}</Chip>
                  <div className="mono" style={{ fontSize: 12, fontWeight: 600, minWidth: 70, textAlign: "right" }}>
                    ₹{(g.monthly * (i === 0 ? 0.6 : i === 1 ? 0.3 : 0.1) / 1000).toFixed(1)}k
                  </div>
                  <button className="btn btn-ghost" style={{ fontSize: 10, padding: "4px 8px" }}>Edit</button>
                </div>
              ))}
            </div>
            <div style={{
              marginTop: 12, padding: 10, borderRadius: "var(--r-sm)",
              background: "var(--info-soft)", color: "var(--info)",
              display: "flex", gap: 8, alignItems: "center", fontSize: 11,
            }}>
              <I.sparkle size={12}/>
              <span><strong>Auto-rebalance:</strong> Quarterly review checks each fund's drift &gt;5% from target weight, switches via STP to maintain allocation.</span>
            </div>
          </Card>

          {/* Off-track recovery */}
          {!g.onTrack && (
            <Card title="Get back on track" sub={`Currently behind by ₹${Math.abs(g.gap).toLocaleString("en-IN")}/month equivalent`}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                <div style={{ padding: 12, borderRadius: "var(--r-md)", background: "var(--bg-soft)", border: "1px solid var(--border)" }}>
                  <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600 }}>Option A</div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>Increase monthly SIP</div>
                  <div className="mono" style={{ fontSize: 16, fontWeight: 700, color: "var(--acc)", marginTop: 6 }}>+₹{(g.suggested - g.monthly).toLocaleString("en-IN")}/mo</div>
                  <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 4 }}>From ₹{g.monthly.toLocaleString("en-IN")} → ₹{g.suggested.toLocaleString("en-IN")}</div>
                </div>
                <div style={{ padding: 12, borderRadius: "var(--r-md)", background: "var(--bg-soft)", border: "1px solid var(--border)" }}>
                  <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600 }}>Option B</div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>Extend deadline by 18 months</div>
                  <div className="mono" style={{ fontSize: 16, fontWeight: 700, color: "var(--acc)", marginTop: 6 }}>Mar 2031</div>
                  <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 4 }}>Keep current SIP rate</div>
                </div>
                <div style={{ padding: 12, borderRadius: "var(--r-md)", background: "var(--bg-soft)", border: "1px solid var(--border)" }}>
                  <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600 }}>Option C</div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>Increase sweep share</div>
                  <div className="mono" style={{ fontSize: 16, fontWeight: 700, color: "var(--acc)", marginTop: 6 }}>{g.sweep}% → 35%</div>
                  <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 4 }}>Reroute from on-track goals</div>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* New goal modal */}
      {showNew && (
        <div onClick={() => setShowNew(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "var(--bg)", borderRadius: "var(--r-lg)", padding: 24, width: 480, maxWidth: "90vw", border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>New goal</div>
            <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 18 }}>System will calculate required monthly SIP and suggest fund allocation.</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div><div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600 }}>Goal name</div><input className="input" placeholder="e.g. Daughter's wedding"/></div>
              <div><div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600 }}>Target amount (₹)</div><input className="input" placeholder="2000000"/></div>
              <div><div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600 }}>Target date</div><input className="input" placeholder="Dec 2032"/></div>
              <div><div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600 }}>Risk profile</div><select className="input"><option>Aggressive (12-15% expected)</option><option>Balanced (9-12% expected)</option><option>Conservative (6-9% expected)</option><option>Capital protection (4-6% expected)</option></select></div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 18, justifyContent: "flex-end" }}>
              <button className="btn btn-ghost" onClick={() => setShowNew(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => setShowNew(false)}>Create goal</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

window.GoalsScreen = GoalsScreen;
