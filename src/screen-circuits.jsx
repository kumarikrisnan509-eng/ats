/* eslint-disable */
/* Circuit Breakers — automated halt rules. Visualizes thresholds, current state,
   and history of halts. Per-mode + per-account + global. */

const CircuitsScreen = () => {
  const [confirm, setConfirm] = React.useState(null); // {action, detail, onYes}

  // Each circuit has: id, scope, metric, threshold, current, action, lastTriggered, armed
  const circuits = [
    // === Account-level ===
    { id: "acct-daily-loss",     scope: "Account", metric: "Daily realized loss",    threshold: -22500, current: -8240, unit: "₹", action: "Halt all trading until next session", armed: true,  lastTrig: "12 days ago", level: "critical" },
    { id: "acct-drawdown",       scope: "Account", metric: "30-day drawdown",        threshold: -8,     current: -2.4,  unit: "%", action: "Reduce all mode caps by 50%", armed: true, lastTrig: "Never", level: "critical" },
    { id: "acct-margin",         scope: "Account", metric: "Margin utilization",     threshold: 85,     current: 42,    unit: "%", action: "Block new positions until <70%", armed: true, lastTrig: "3 days ago", level: "warn" },
    // === Per-mode ===
    { id: "intraday-loss",       scope: "Intraday", metric: "Mode daily loss",       threshold: -7500, current: -3200, unit: "₹", action: "Halt intraday only · swing/options unaffected", armed: true, lastTrig: "Yesterday", level: "warn" },
    { id: "options-loss",        scope: "Options",  metric: "Mode daily loss",       threshold: -5000, current: -4820, unit: "₹", action: "Halt options · auto-square premium-shorts", armed: true, lastTrig: "Active warning", level: "critical" },
    { id: "options-vega",        scope: "Options",  metric: "Net vega exposure",     threshold: 2500,   current: 1840,  unit: "₹/vol", action: "Block new vega-positive entries", armed: true, lastTrig: "Never", level: "warn" },
    { id: "swing-overnight",     scope: "Swing",    metric: "Overnight position count", threshold: 8, current: 5,    unit: "", action: "Block new swing entries", armed: true, lastTrig: "Never", level: "info" },
    // === Per-symbol ===
    { id: "concentration",       scope: "Per-symbol", metric: "Single-symbol exposure", threshold: 10, current: 6.4, unit: "%", action: "Block adding to that position", armed: true, lastTrig: "8 days ago", level: "warn" },
    // === Market ===
    { id: "vix-spike",           scope: "Market",  metric: "India VIX",                threshold: 20, current: 14.2, unit: "", action: "Reduce intraday cap 50% · widen stops", armed: true, lastTrig: "Apr 4 (geopolitical)", level: "warn" },
    { id: "circuit-breaker-mkt", scope: "Market",  metric: "NIFTY moves >5% intraday", threshold: 5,  current: 0.4,  unit: "%", action: "Auto-halt all intraday + sell GTT triggers", armed: true, lastTrig: "Never (since Mar 2020)", level: "critical" },
    // === Operational ===
    { id: "broker-disconnect",   scope: "Operational", metric: "Broker WebSocket downtime", threshold: 30, current: 0, unit: "s", action: "Halt new orders · keep position monitor", armed: true, lastTrig: "Apr 22 (8s)", level: "critical" },
    { id: "ai-error-rate",       scope: "Operational", metric: "LLM error rate (5min)",     threshold: 20, current: 2.1, unit: "%", action: "Failover Claude → GPT-5 → Gemini", armed: true, lastTrig: "Mar 18 (Anthropic outage)", level: "warn" },
    { id: "tick-lag",            scope: "Operational", metric: "Tick feed lag p99",          threshold: 200, current: 38, unit: "ms", action: "Pause signal generation until <100ms", armed: true, lastTrig: "Yesterday", level: "warn" },
  ];

  const grouped = circuits.reduce((acc, c) => {
    (acc[c.scope] = acc[c.scope] || []).push(c);
    return acc;
  }, {});

  const armedCount = circuits.filter(c => c.armed).length;
  const triggeredCount = circuits.filter(c => {
    if (c.unit === "%") return c.threshold > 0 ? c.current >= c.threshold : c.current <= c.threshold;
    if (c.unit === "₹") return c.current <= c.threshold;
    return false;
  }).length;
  const nearTriggered = circuits.filter(c => {
    const ratio = Math.abs(c.current / c.threshold);
    return ratio > 0.8 && ratio < 1;
  }).length;

  const recentHalts = [
    { when: "Yesterday 14:42", who: "intraday-loss", what: "Intraday halted at -₹7,840 (limit -₹7,500)", action: "Auto-resumed today 09:15", color: "var(--warn)" },
    { when: "Apr 22 11:42",    who: "broker-disconnect", what: "Zerodha WS down 8s", action: "No orders missed · resumed in 8.3s", color: "var(--info)" },
    { when: "Apr 18 13:20",    who: "concentration", what: "HDFCBANK exposure hit 10.2%", action: "Blocked add-to · existing position kept", color: "var(--warn)" },
    { when: "Apr 4 09:18",     who: "vix-spike", what: "India VIX > 20 (geopolitical news)", action: "Intraday cap halved for the session", color: "var(--warn)" },
  ];

  const overrideCircuit = (c) => {
    setConfirm({
      action: `Disarm circuit: ${c.metric}`,
      detail: `You are disabling ${c.scope.toLowerCase()} protection "${c.metric}". Without this safeguard, your account is exposed to losses beyond the configured threshold (${c.threshold}${c.unit}). Override expires in 4 hours.`,
      onYes: () => { /* would dispatch to backend */ },
    });
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-header__title">Circuit breakers</h1>
          <div className="page-header__sub">Automated halt rules · {armedCount}/{circuits.length} armed · {triggeredCount} triggered today · {nearTriggered} approaching limit</div>
        </div>
        <div className="page-header__right">
          <button className="btn"><I.shield size={14}/> Export config</button>
          <button className="btn btn--primary"><I.code size={14}/> Run halt drill</button>
        </div>
      </div>

      {/* Status overview */}
      <div className="grid grid-4" style={{ marginBottom: 18 }}>
        <div className="card" style={{ background: "var(--up-soft)", borderColor: "transparent" }}>
          <div className="row" style={{ gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--up)", color: "white", display: "grid", placeItems: "center" }}>✓</div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 600, color: "var(--up)" }}>Armed</div>
              <div className="muted" style={{ fontSize: 11 }}>{armedCount} of {circuits.length} circuits active</div>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="stat">
            <div className="stat__label">Approaching limit</div>
            <div className="stat__value stat__value--sm warn">{nearTriggered}</div>
            <div className="muted" style={{ fontSize: 11 }}>{">"}80% of threshold</div>
          </div>
        </div>
        <div className="card">
          <div className="stat">
            <div className="stat__label">Triggered today</div>
            <div className="stat__value stat__value--sm down">{triggeredCount}</div>
            <div className="muted" style={{ fontSize: 11 }}>Auto-action taken</div>
          </div>
        </div>
        <div className="card">
          <div className="stat">
            <div className="stat__label">Last drill</div>
            <div className="stat__value stat__value--sm">3 days ago</div>
            <div className="muted" style={{ fontSize: 11 }}>All circuits passed · 142ms avg response</div>
          </div>
        </div>
      </div>

      <div className="grid grid-2-1">
        {/* Circuits by scope */}
        <div className="col" style={{ gap: 18 }}>
          {Object.entries(grouped).map(([scope, items]) => (
            <div key={scope} className="card card--flush">
              <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{scope}</div>
                <div className="muted" style={{ fontSize: 11 }}>{items.length} circuit{items.length > 1 ? "s" : ""}</div>
              </div>
              <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                {items.map(c => {
                  // distance to threshold (signed)
                  const isNeg = c.threshold < 0;
                  const ratio = isNeg ? c.current / c.threshold : c.current / c.threshold;
                  const pct = Math.min(100, Math.max(0, ratio * 100));
                  const breached = pct >= 100;
                  const near = pct >= 80;
                  const barColor = breached ? "var(--down)" : near ? "var(--warn)" : c.level === "critical" ? "var(--info)" : "var(--accent)";
                  return (
                    <div key={c.id} style={{ padding: 12, background: "var(--bg-soft)", borderRadius: "var(--r-md)", border: "1px solid var(--border)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <span style={{ fontSize: 13, fontWeight: 500 }}>{c.metric}</span>
                            {c.level === "critical" && <span className="pill pill--down" style={{ fontSize: 9 }}>CRITICAL</span>}
                            {c.level === "warn" && <span className="pill pill--warn" style={{ fontSize: 9 }}>WARN</span>}
                            {breached && <span className="pill pill--down" style={{ fontSize: 9 }}>● TRIGGERED</span>}
                          </div>
                          <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>{c.action}</div>
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <div className="mono" style={{ fontSize: 13, fontWeight: 500 }}>
                            {c.unit === "₹" ? "₹" : ""}{Math.abs(c.current).toLocaleString("en-IN")}{c.unit !== "₹" ? c.unit : ""}
                          </div>
                          <div className="mono muted" style={{ fontSize: 10 }}>
                            limit {c.unit === "₹" ? "₹" : ""}{Math.abs(c.threshold).toLocaleString("en-IN")}{c.unit !== "₹" ? c.unit : ""}
                          </div>
                        </div>
                      </div>
                      <div style={{ height: 6, background: "var(--bg-sunk)", borderRadius: 3, overflow: "hidden", position: "relative" }}>
                        <div style={{
                          height: "100%", width: `${pct}%`,
                          background: barColor, borderRadius: 3,
                          transition: "width .3s",
                        }}/>
                        <div style={{ position: "absolute", left: "80%", top: -2, bottom: -2, width: 1, background: "var(--text-4)", opacity: 0.5 }}/>
                      </div>
                      <div className="row" style={{ marginTop: 8, justifyContent: "space-between", fontSize: 10, color: "var(--text-3)" }}>
                        <span>Last triggered: {c.lastTrig}</span>
                        <button className="btn btn--ghost btn--sm" style={{ fontSize: 10, padding: "2px 8px" }} onClick={() => overrideCircuit(c)}>
                          Override (2FA)
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Recent halts + drill history */}
        <div className="col" style={{ gap: 18 }}>
          <div className="card">
            <div className="card__head">
              <div>
                <div className="card__title">Recent halts</div>
                <div className="card__sub">Last 30 days</div>
              </div>
            </div>
            <div className="col" style={{ gap: 12 }}>
              {recentHalts.map((h, i) => (
                <div key={i} style={{ display: "flex", gap: 12, paddingBottom: 12, borderBottom: i < recentHalts.length - 1 ? "1px solid var(--border)" : "none" }}>
                  <div style={{ width: 4, borderRadius: 2, background: h.color, flexShrink: 0 }}/>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>{h.when}</div>
                    <div style={{ fontSize: 12, fontWeight: 500, marginTop: 2 }}>{h.what}</div>
                    <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>{h.action}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card__head">
              <div>
                <div className="card__title">Halt drill schedule</div>
                <div className="card__sub">Verify circuits actually fire</div>
              </div>
            </div>
            <div className="col" style={{ gap: 10 }}>
              {[
                { d: "Daily",   k: "Broker disconnect (10s)", n: "Tomorrow 03:00", st: "scheduled" },
                { d: "Weekly",  k: "Loss limit fire test",      n: "Sat 03:00",     st: "scheduled" },
                { d: "Monthly", k: "Full system halt",          n: "May 1, 03:00",   st: "scheduled" },
                { d: "Quarterly", k: "VIX spike simulation",     n: "Jun 15",        st: "scheduled" },
              ].map((d, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 10px", background: "var(--bg-soft)", borderRadius: 6, alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 500 }}>{d.k}</div>
                    <div className="muted" style={{ fontSize: 10, marginTop: 2 }}>{d.d}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="mono" style={{ fontSize: 11 }}>{d.n}</div>
                    <span className="pill pill--info" style={{ fontSize: 9, marginTop: 2 }}>{d.st}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={{ background: "var(--info-soft)", borderColor: "transparent" }}>
            <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
              <I.shield size={20} style={{ color: "var(--info)", flexShrink: 0, marginTop: 2 }}/>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--info)", marginBottom: 4 }}>Defence in depth</div>
                <div className="muted" style={{ fontSize: 11, lineHeight: 1.55 }}>
                  Circuits run independently of strategies. Even if a strategy bug causes runaway orders, account-level
                  circuits halt at <span className="mono">-₹22,500/day</span> max. Broker-side limits provide the final backstop.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <window.TwoFactorModal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        action={confirm && confirm.action}
        detail={confirm && confirm.detail}
        onConfirm={confirm && confirm.onYes}
      />
    </>
  );
};

window.CircuitsScreen = CircuitsScreen;
