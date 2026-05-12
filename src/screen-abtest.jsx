/* eslint-disable */
/* A/B Testing — split capital across strategy variants, compare live PnL.
   Real-world use: variant A is current production, B is candidate, C is wildcard. */

const ABTestScreen = () => {
  const [selected, setSelected] = React.useState("momentum-v2-vs-v3");
  const [showNew, setShowNew] = React.useState(false);

  const tests = [
    {
      id: "momentum-v2-vs-v3", name: "Momentum AI · v2 vs v3", mode: "intraday", status: "running",
      started: "12 days ago", elapsed: "12d 4h", trades: 184, capital: "₹4.5 L (3-way split)",
      variants: [
        { id: "A", label: "v2 (control)", desc: "Current production · RSI + MACD + volume", weight: 50, trades: 92, winRate: 58.7, pnl: 8240, sharpe: 1.42, dd: -3.2, color: "var(--text-2)" },
        { id: "B", label: "v3 (candidate)", desc: "Adds order-flow imbalance + Claude reasoning step", weight: 30, trades: 56, winRate: 64.3, pnl: 11820, sharpe: 1.81, dd: -2.4, color: "var(--acc)" },
        { id: "C", label: "v3-fast (wildcard)", desc: "v3 with 3m bars instead of 5m", weight: 20, trades: 36, winRate: 52.8, pnl: -1420, sharpe: -0.32, dd: -4.8, color: "var(--warn)" },
      ],
      verdict: "B leading by ₹3,580 with higher win rate. Statistical significance: 87% (need 95% to auto-promote)",
      decision: "running",
    },
    {
      id: "iron-condor-strikes", name: "Iron Condor · strike width", mode: "options", status: "running",
      started: "6 days ago", elapsed: "6d", trades: 24, capital: "₹2.4 L (2-way split)",
      variants: [
        { id: "A", label: "300-pt wings (control)", desc: "Sell ATM±150, buy ATM±300", weight: 50, trades: 12, winRate: 75, pnl: 4820, sharpe: 1.92, dd: -1.8, color: "var(--text-2)" },
        { id: "B", label: "500-pt wings", desc: "Wider for tail protection", weight: 50, trades: 12, winRate: 83.3, pnl: 5240, sharpe: 2.14, dd: -1.2, color: "var(--acc)" },
      ],
      verdict: "B narrowly ahead. Need 8 more weekly cycles for confidence.",
      decision: "running",
    },
    {
      id: "swing-llm-vs-rules", name: "Swing · LLM-only vs hybrid", mode: "swing", status: "concluded",
      started: "30 days ago", elapsed: "30d", trades: 42, capital: "₹6 L (2-way split)",
      variants: [
        { id: "A", label: "Rule-based (control)", desc: "Pure technical: BB + ATR + trend", weight: 50, trades: 22, winRate: 50, pnl: 3240, sharpe: 0.82, dd: -4.1, color: "var(--text-2)" },
        { id: "B", label: "LLM-augmented", desc: "Claude rates each candidate setup 1-10", weight: 50, trades: 20, winRate: 70, pnl: 9180, sharpe: 1.94, dd: -2.3, color: "var(--up)" },
      ],
      verdict: "✓ B promoted to 100% on Apr 18. LLM contribution +₹5,940 over 30d.",
      decision: "promoted-B",
    },
  ];

  const t = tests.find(x => x.id === selected) || tests[0];

  return (
    <>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, gap: 16 }}>
        <div>
          <div style={{ fontSize: 12, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
            A/B Testing · Strategy variants
          </div>
          <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 4, maxWidth: 720 }}>
            Run 2-4 versions of the same strategy in parallel with split capital. Auto-promote winner when statistical significance hits 95%.
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowNew(true)}>
          <I.plus size={14}/> New A/B test
        </button>
      </div>

      {/* Stats strip */}
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat label="Active tests"        value="2"        sub="across 2 modes"/>
        <Stat label="Capital under test"  value="₹6.9 L"   sub="14% of portfolio"/>
        <Stat label="Tests concluded"     value="14"       sub="last 90 days"/>
        <Stat label="Auto-promotion rate" value="64%"      sub="9 of 14 winners promoted"/>
      </div>

      {/* Test selector tabs */}
      <Card title="Tests" sub="Click a test to drill in">
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {tests.map(test => {
            const isSel = test.id === selected;
            const lead = [...test.variants].sort((a,b) => b.pnl - a.pnl)[0];
            return (
              <div key={test.id}
                onClick={() => setSelected(test.id)}
                style={{
                  display: "grid", gridTemplateColumns: "auto 1fr auto auto auto auto",
                  alignItems: "center", gap: 12, padding: "12px 0",
                  borderTop: "1px solid var(--border)", cursor: "pointer",
                  background: isSel ? "var(--bg-soft)" : "transparent",
                  marginInline: isSel ? -12 : 0, paddingInline: isSel ? 12 : 0,
                  borderRadius: isSel ? "var(--r-sm)" : 0,
                }}>
                <div style={{ width: 6, height: 36, borderRadius: 3, background: test.status === "running" ? "var(--acc)" : "var(--up)" }}/>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{test.name}</div>
                  <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
                    {test.elapsed} · {test.trades} trades · {test.capital}
                  </div>
                </div>
                <Chip variant={test.mode === "options" ? "vio" : test.mode === "swing" ? "warn" : "info"}>{test.mode}</Chip>
                <div style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.4 }}>
                  Leader: <strong style={{ color: "var(--text)" }}>{lead.label}</strong>
                </div>
                <div className="mono" style={{ fontSize: 13, color: lead.pnl >= 0 ? "var(--up)" : "var(--down)", fontWeight: 600 }}>
                  {lead.pnl >= 0 ? "+" : ""}₹{lead.pnl.toLocaleString("en-IN")}
                </div>
                <Chip variant={test.status === "running" ? "info" : "up"}>
                  {test.status === "running" ? "RUNNING" : "✓ CONCLUDED"}
                </Chip>
              </div>
            );
          })}
        </div>
      </Card>

      <div style={{ height: 16 }}/>

      {/* Variant comparison */}
      <Card title={`${t.name} — variant comparison`} sub={`Started ${t.started} · ${t.capital}`}>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${t.variants.length}, 1fr)`, gap: 12, marginBottom: 16 }}>
          {t.variants.map(v => (
            <div key={v.id} style={{
              padding: 14, borderRadius: "var(--r-md)", border: "1px solid var(--border)",
              background: "var(--bg-soft)", borderLeft: `4px solid ${v.color}`,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", letterSpacing: 0.6 }}>
                  VARIANT {v.id}
                </div>
                <Chip variant="info">{v.weight}% capital</Chip>
              </div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{v.label}</div>
              <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4, lineHeight: 1.5, minHeight: 32 }}>{v.desc}</div>
              <div style={{ height: 1, background: "var(--border)", margin: "12px 0" }}/>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 11 }}>
                <div>
                  <div style={{ color: "var(--text-3)" }}>P&amp;L</div>
                  <div className="mono" style={{ fontSize: 16, fontWeight: 600, color: v.pnl >= 0 ? "var(--up)" : "var(--down)" }}>
                    {v.pnl >= 0 ? "+" : ""}₹{v.pnl.toLocaleString("en-IN")}
                  </div>
                </div>
                <div>
                  <div style={{ color: "var(--text-3)" }}>Win rate</div>
                  <div className="mono" style={{ fontSize: 16, fontWeight: 600 }}>{v.winRate}%</div>
                </div>
                <div>
                  <div style={{ color: "var(--text-3)" }}>Trades</div>
                  <div className="mono" style={{ fontSize: 13, fontWeight: 500 }}>{v.trades}</div>
                </div>
                <div>
                  <div style={{ color: "var(--text-3)" }}>Sharpe</div>
                  <div className="mono" style={{ fontSize: 13, fontWeight: 500 }}>{v.sharpe.toFixed(2)}</div>
                </div>
                <div>
                  <div style={{ color: "var(--text-3)" }}>Max DD</div>
                  <div className="mono" style={{ fontSize: 13, fontWeight: 500, color: "var(--down)" }}>{v.dd}%</div>
                </div>
                <div>
                  <div style={{ color: "var(--text-3)" }}>Weight</div>
                  <div className="mono" style={{ fontSize: 13, fontWeight: 500 }}>{v.weight}%</div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Verdict bar */}
        <div style={{
          padding: 14, borderRadius: "var(--r-md)",
          background: t.decision === "promoted-B" ? "var(--up-soft)" : "var(--info-soft)",
          color: t.decision === "promoted-B" ? "var(--up)" : "var(--info)",
          display: "flex", alignItems: "center", gap: 12, fontSize: 12,
        }}>
          <I.shield size={16}/>
          <div style={{ flex: 1 }}>
            <strong style={{ fontSize: 13 }}>{t.decision === "promoted-B" ? "Concluded" : "Verdict so far"}: </strong>
            {t.verdict}
          </div>
          {t.status === "running" && (
            <button className="btn btn-ghost" style={{ fontSize: 11, padding: "4px 10px" }}>Stop early</button>
          )}
        </div>
      </Card>

      <div style={{ height: 16 }}/>

      {/* Methodology */}
      <Card title="Methodology" sub="How we run A/B tests safely">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, fontSize: 12, color: "var(--text-2)", lineHeight: 1.7 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>Capital split</div>
            Each variant gets a slice of the strategy's allocated capital. Default 50/50; you can weight toward control during early phase to limit downside (e.g. 70/30 first 100 trades, then 50/50).
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>Significance test</div>
            We use Welch's t-test on per-trade PnL (or rank-sum if non-normal). Auto-promote at p&lt;0.05 AND minimum 100 trades AND positive Sharpe lift.
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>Stop-loss for variants</div>
            Any variant down ≥₹10,000 OR ≥30 trades with win-rate &lt;40% is auto-paused. The other variants get its capital reallocated.
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>Manual override</div>
            You can promote/kill any variant manually at any time. All decisions logged to audit trail with reason field.
          </div>
        </div>
      </Card>

      {/* New test modal placeholder */}
      {showNew && (
        <div onClick={() => setShowNew(false)} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex",
          alignItems: "center", justifyContent: "center", zIndex: 100,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: "var(--bg)", borderRadius: "var(--r-lg)", padding: 24,
            width: 480, maxWidth: "90vw", border: "1px solid var(--border)",
          }}>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>New A/B test</div>
            <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 18 }}>Pick a strategy, define 2-4 variants, allocate capital.</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Field label="Strategy"><select className="input"><option>Momentum AI v3</option><option>Iron Condor Weekly</option><option>Swing Pullback v1</option></select></Field>
              <Field label="Number of variants"><select className="input"><option>2</option><option>3</option><option>4</option></select></Field>
              <Field label="Capital under test (₹)"><input className="input" defaultValue="500000"/></Field>
              <Field label="Min trades before significance check"><input className="input" defaultValue="100"/></Field>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 18, justifyContent: "flex-end" }}>
              <button className="btn btn-ghost" onClick={() => setShowNew(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => setShowNew(false)}>Create test</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

const Field = ({ label, children }) => (
  <div>
    <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600 }}>{label}</div>
    {children}
  </div>
);

window.ABTestScreen = ABTestScreen;
