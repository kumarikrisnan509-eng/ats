/* eslint-disable */
/* Risk screen */

const RiskScreen = () => {
  const [kill, setKill] = useState(false);

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-header__title">Risk controls</h1>
          <div className="page-header__sub">Hard limits, kill switch, per-strategy caps. Enforced before every order.</div>
        </div>
        <div className="page-header__right">
          <button className="btn"><I.download size={14}/> Export rules</button>
        </div>
      </div>

      {window.RiskPredictor && <div style={{ marginBottom: 16 }}><window.RiskPredictor/></div>}

      {/* Kill switch */}
      <Card style={{ marginBottom: 16, background: kill ? "var(--down-soft)" : "var(--surface)", borderColor: kill ? "var(--down)" : "var(--border)" }}>
        <div className="between">
          <div className="row" style={{ gap: 14 }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: kill ? "var(--down)" : "var(--down-soft)", color: kill ? "white" : "var(--down)", display: "grid", placeItems: "center" }}>
              <I.stop size={22}/>
            </div>
            <div>
              <div style={{ fontSize: 17, fontWeight: 600 }}>Master kill switch</div>
              <div className="muted" style={{ fontSize: 13 }}>Halts ALL automated trading, cancels open orders, pauses every strategy. Manual trading remains enabled.</div>
            </div>
          </div>
          <button className={"btn " + (kill ? "btn--primary" : "btn--danger")} onClick={() => setKill(!kill)} style={{ padding: "12px 22px" }}>
            {kill ? <><I.play size={14}/> Re-enable trading</> : <><I.stop size={14}/> Engage kill switch</>}
          </button>
        </div>
      </Card>

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        {(() => {
          // Live drift around base values to make gauges breathe
          useLiveTick();
          const t = Math.floor(Date.now() / 800);
          const drift = (seed) => (Math.sin(t / 30 + seed) * 0.5 + 0.5);
          const dailyLossPct = 32 + drift(1) * 6;
          const marginPct = 41 + drift(2) * 4;
          const dailyLossInr = Math.round(15000 * (dailyLossPct / 100));
          const marginInr = Math.round(2884000 * (marginPct / 100));
          return (
            <>
              <Card>
                <Stat label="Daily loss used" value={<><CountUp value={dailyLossInr} format={v => inr(Math.round(v))}/></>} delta="of ₹15,000 cap" deltaKind="muted" sub={<>{Math.round(dailyLossPct)}% <StaleIndicator/></>}/>
                <div style={{ marginTop: 12 }}><Progress value={dailyLossPct} kind={dailyLossPct > 70 ? "down" : "warn"}/></div>
              </Card>
              <Card>
                <Stat label="Margin used" value={<><CountUp value={marginInr} format={v => inrCompact(Math.round(v))}/></>} delta="of 28.4L available" deltaKind="muted" sub={`${Math.round(marginPct)}%`}/>
                <div style={{ marginTop: 12 }}><Progress value={marginPct} kind="info"/></div>
              </Card>
              <Card>
                <Stat label="Open positions" value="5" delta="of 15 cap" deltaKind="muted" sub="33%"/>
                <div style={{ marginTop: 12 }}><Progress value={33} kind="up"/></div>
              </Card>
              <Card>
                <Stat label="Breaches (7d)" value="1" delta="auto-resolved" deltaKind="muted" sub="no incident"/>
                <div style={{ marginTop: 12 }}><Progress value={8} kind="up"/></div>
              </Card>
            </>
          );
        })()}
      </div>

      {/* Per-mode limits — capital & loss ceilings per trading mode */}
      <Card title="Per-mode limits" sub="Capital allocation and daily loss caps per mode. Breach → mode pauses, others continue." style={{ marginBottom: 16 }} flush>
        <table className="table">
          <thead>
            <tr>
              <th>Mode</th>
              <th className="num-l">Capital cap</th>
              <th className="num-l">Deployed</th>
              <th>Utilization</th>
              <th className="num-l">Daily loss cap</th>
              <th className="num-l">Used today</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {[
              { id: "intraday", cap: 1200000, deployed:  840000, lossCap: 8000,  lossUsed: 2840, state: "ok"   },
              { id: "swing",    cap: 1500000, deployed: 1120000, lossCap: 5000,  lossUsed: 1180, state: "ok"   },
              { id: "options",  cap:  500000, deployed:  380000, lossCap: 4000,  lossUsed: 3120, state: "warn" },
              { id: "futures",  cap:  400000, deployed:       0, lossCap: 3000,  lossUsed:    0, state: "idle" },
            ].map(row => {
              const meta = window.MODE_META[row.id];
              const util   = Math.round((row.deployed / row.cap) * 100);
              const lossP  = Math.round((row.lossUsed / row.lossCap) * 100);
              return (
                <tr key={row.id}>
                  <td>
                    <span className="row" style={{ gap: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: meta.color }}/>
                      <div className="col" style={{ gap: 1 }}>
                        <span style={{ fontWeight: 500 }}>{meta.label}</span>
                        <span className="muted" style={{ fontSize: 10, fontFamily: "var(--mono)" }}>
                          alloc on <a href="#modes" style={{ color: "var(--text-3)" }}>Modes</a>
                        </span>
                      </div>
                    </span>
                  </td>
                  <td className="num mono">{inrCompact(row.cap)}</td>
                  <td className="num mono">{row.deployed === 0 ? <span className="muted">—</span> : inrCompact(row.deployed)}</td>
                  <td style={{ minWidth: 140 }}>
                    <div className="row" style={{ gap: 8 }}>
                      <div style={{ flex: 1 }}><Progress value={util} kind={util > 85 ? "warn" : "info"}/></div>
                      <span className="mono" style={{ fontSize: 11, color: "var(--text-3)", minWidth: 32, textAlign: "right" }}>{util}%</span>
                    </div>
                  </td>
                  <td className="num mono">{inr(row.lossCap)}</td>
                  <td className="num mono">
                    <span className={lossP > 70 ? "down" : ""}>
                      {row.lossUsed === 0 ? <span className="muted">—</span> : inr(row.lossUsed)}
                    </span>
                  </td>
                  <td>
                    {row.state === "warn" ? <Pill kind="warn" dot>near cap</Pill>
                      : row.state === "idle" ? <Pill kind="muted" dot>idle</Pill>
                      : <Pill kind="up" dot>ok</Pill>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ padding: "10px 16px", borderTop: "1px solid var(--border)", background: "var(--bg-soft)", fontSize: 11, color: "var(--text-3)" }}>
          <I.shield size={12} style={{ verticalAlign: -1, marginRight: 6 }}/>
          Mode-level breach isolates failure: only that mode pauses. Global kill switch affects all modes.
        </div>
      </Card>

      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <Card title="Global limits" sub="Portfolio-wide safety net">
          <div className="col" style={{ gap: 14 }}>
            {[
              { label: "Daily loss limit", val: "₹15,000", prog: 32, kind: "warn", note: "On breach → kill switch auto-engages" },
              { label: "Max position size", val: "₹3,00,000", prog: 0, kind: "up", note: "Per single instrument" },
              { label: "Max leverage", val: "3.0x", prog: 42, kind: "info", note: "Across MIS + F&O combined" },
              { label: "Max open positions", val: "15", prog: 33, kind: "up", note: "Includes F&O legs" },
              { label: "Circuit-breaker cooldown", val: "15 min", prog: 0, kind: "up", note: "After 3 consecutive losses" },
              { label: "Per-order max ₹", val: "₹1,00,000", prog: 0, kind: "up", note: "Rejects orders above threshold" },
            ].map((r, i) => (
              <div key={i}>
                <div className="between" style={{ marginBottom: 4 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{r.label}</div>
                  <span className="mono" style={{ fontSize: 13 }}>{r.val}</span>
                </div>
                <div style={{ marginBottom: 4 }}><Progress value={r.prog} kind={r.kind}/></div>
                <div className="muted" style={{ fontSize: 11 }}>{r.note}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Per-strategy caps" sub="Capital ceilings and loss cutoffs" flush>
          <table className="table">
            <thead><tr><th>Strategy</th><th className="num-l">Capital cap</th><th className="num-l">Loss cutoff</th><th>State</th></tr></thead>
            <tbody>
              {[
                { n: "Momentum AI",      cap: 800000, sl: 8000,  ok: true },
                { n: "Mean Reversion v2",cap: 600000, sl: 6000,  ok: true },
                { n: "Grid Trader",      cap: 400000, sl: 4000,  ok: false },
                { n: "Iron Condor Wkly", cap: 300000, sl: 5000,  ok: true },
                { n: "Breakout Scanner", cap: 250000, sl: 3000,  ok: true },
                { n: "MCX Arbitrage",    cap: 200000, sl: 2500,  ok: true },
              ].map((s, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 500 }}>{s.n}</td>
                  <td className="num">{inrCompact(s.cap)}</td>
                  <td className="num">{inr(s.sl)}</td>
                  <td>{s.ok ? <Pill kind="up" dot>ok</Pill> : <Pill kind="warn" dot>near cutoff</Pill>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <Card title="Risk events" sub="Last 10" flush>
        <table className="table">
          <thead><tr><th>When</th><th>Severity</th><th>Rule</th><th>Action taken</th></tr></thead>
          <tbody>
            {[
              { t: "Apr 23, 14:02", sev: "warn", r: "Grid Trader daily loss 70% of cap", a: "Strategy paused for 30 min" },
              { t: "Apr 22, 11:48", sev: "info", r: "Position size check on RELIANCE", a: "Passed" },
              { t: "Apr 21, 09:22", sev: "warn", r: "Consecutive losses: 3 on Mean Rev.", a: "15-min cooldown engaged" },
              { t: "Apr 18, 15:15", sev: "down", r: "Manual kill switch engaged", a: "All orders cancelled; resumed 15:45" },
              { t: "Apr 16, 10:02", sev: "info", r: "Margin call pre-check", a: "Order size reduced 20%" },
            ].map((e, i) => (
              <tr key={i}>
                <td className="mono" style={{ fontSize: 12, color: "var(--text-3)" }}>{e.t}</td>
                <td><Pill kind={e.sev}>{e.sev === "down" ? "critical" : e.sev === "warn" ? "warning" : "info"}</Pill></td>
                <td style={{ fontWeight: 500 }}>{e.r}</td>
                <td><span className="muted">{e.a}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
};

Object.assign(window, { RiskScreen });
