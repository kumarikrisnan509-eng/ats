/* eslint-disable */
/* Strategies screen — mode is the primary grouping dimension */

const StrategiesScreen = () => {
  // Real backend strategy registry + watchlist backtest trigger, exposed via window helpers.
  const [backendStrats, setBackendStrats] = React.useState([]);
  const [runStatus, setRunStatus]         = React.useState(null);
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const j = await window.fetchApi('/api/strategies');
        if (!cancelled) setBackendStrats((j && j.strategies) || []);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);
  window.atsBacktestWatchlist = async (stratId) => {
    setRunStatus({ running: true, stratId });
    const today = new Date().toISOString().slice(0, 10);
    const ago   = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
    try {
      const res = await fetch('/api/backtest/watchlist', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategy: stratId, from: ago, to: today, qty: 10, interval: 'day' }),
      });
      const j = await res.json();
      setRunStatus({ running: false, stratId, result: j });
      return j;
    } catch (e) {
      setRunStatus({ running: false, stratId, error: e.message });
      return null;
    }
  };
  window.atsBackendStrats = backendStrats;
  window.atsRunStatus     = runStatus;

  // Read from the canonical catalog (MODE_META → STRATEGY_CATALOG)
  // This is the same data the Trading Modes screen shows — single source of truth.
  const strats = window.STRATEGY_CATALOG;
  const stBadge = {
    live:   { kind: "up",   txt: "LIVE" },
    paper:  { kind: "info", txt: "PAPER" },
    paused: { kind: "warn", txt: "PAUSED" },
    draft:  { kind: "",     txt: "DRAFT" },
  };

  const [filter, setFilter] = useState("All");      // mode filter — stores mode id or "All"
  const [stFilter, setStFilter] = useState("All");  // stage filter
  const [view, setView] = useState("grouped");      // "grouped" | "flat"

  // Re-render on mode toggle changes (gated pills update live)
  const [, bump] = React.useReducer(x => x + 1, 0);
  React.useEffect(() => {
    const h = () => bump();
    window.addEventListener("modes-changed", h);
    return () => window.removeEventListener("modes-changed", h);
  }, []);

  const modeFiltered = strats.filter(s => filter === "All" || s.mode === filter);
  const visible = modeFiltered.filter(s => stFilter === "All" || (stFilter === "Live" && s.st === "live") || (stFilter === "Paper" && s.st === "paper") || (stFilter === "Other" && !["live", "paper"].includes(s.st)));

  // Group visible strategies by mode for grouped view
  const byMode = window.MODE_IDS.map(id => ({
    id,
    meta: window.MODE_META[id],
    items: visible.filter(s => s.mode === id),
    active: window.isModeActive(id),
  })).filter(g => g.items.length > 0);

  // Top stats — combined P&L across visible strategies
  const combinedPnl = visible.reduce((a, s) => a + s.pnl30, 0);
  const liveCount = strats.filter(s => s.st === "live").length;
  const paperCount = strats.filter(s => s.st === "paper").length;
  const deployed = strats.filter(s => s.st === "live").reduce((a, s) => a + s.cap, 0);

  const renderCard = (s, i) => {
    const meta = window.MODE_META[s.mode];
    const gated = !window.isModeActive(s.mode);
    return (
      <Card key={`${s.mode}-${i}`} style={gated ? { opacity: 0.55, background: "repeating-linear-gradient(135deg, var(--bg-soft) 0 10px, var(--bg-sunk) 10px 11px)" } : null}>
        <div className="between" style={{ marginBottom: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div className="row" style={{ marginBottom: 4, flexWrap: "wrap", gap: 6 }}>
              <strong style={{ fontSize: 15, letterSpacing: "-0.01em" }}>{s.n}</strong>
              <Pill kind={stBadge[s.st].kind} dot>{stBadge[s.st].txt}</Pill>
              <span style={{ fontSize: 10, fontFamily: "var(--mono)", color: meta.color, padding: "2px 6px", borderRadius: 3, background: meta.colorSoft, fontWeight: 500 }}>
                {meta.shortLabel}
              </span>
              {gated && <Pill kind="warn">MODE OFF</Pill>}
            </div>
            <div className="muted" style={{ fontSize: 12 }}>{s.k} · {s.mkt}</div>
          </div>
          <div className="row" style={{ gap: 6, flexShrink: 0 }}>
            <button className="btn btn--sm" disabled={gated} style={gated ? { opacity: 0.5 } : null}>
              {s.st === "paused" || s.st === "draft" ? <><I.play size={12}/> Start</> : <><I.pause size={12}/> Pause</>}
            </button>
            <button className="iconbtn" style={{ width: 32, height: 32 }}><I.more size={14}/></button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 12 }}>
          <div><div className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>Capital</div><div className="mono" style={{ fontSize: 14 }}>{inrCompact(s.cap)}</div></div>
          <div><div className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>30d P&L</div><div className={"mono " + clsPN(s.pnl30)} style={{ fontSize: 14 }}>{s.pnl30 >= 0 ? "+" : ""}{inr(s.pnl30)}</div></div>
          <div><div className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>Win</div><div className="mono" style={{ fontSize: 14 }}>{s.winR || "—"}{s.winR ? "%" : ""}</div></div>
          <div><div className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>Trades</div><div className="mono" style={{ fontSize: 14 }}>{s.trades}</div></div>
        </div>

        <Sparkline data={seriesRandom(i + 5, 40, 80, 120, s.pnl30 > 0 ? 0.3 : s.pnl30 < 0 ? -0.25 : 0)} height={44} color={s.pnl30 > 0 ? "var(--up)" : s.pnl30 < 0 ? "var(--down)" : "var(--text-4)"}/>

        <div className="divider"/>
        <div className="between" style={{ fontSize: 12 }}>
          <span className="muted">Allocation of mode capital</span>
          <span className="mono">{s.alloc}%</span>
        </div>
        <div style={{ marginTop: 6 }}><Progress value={s.alloc} max={40} kind={s.st === "live" ? "up" : "info"}/></div>
      </Card>
    );
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-header__title">Strategies</h1>
          <div className="page-header__sub">{strats.length} strategies · {liveCount} live · {paperCount} in paper · {inrCompact(deployed)} deployed · grouped by mode</div>
        </div>
        <div className="page-header__right">
          <button className="btn"><I.code size={14}/> Import Python</button>
          <button className="btn btn--primary" onClick={() => {
            const m = window.getEffectiveDefaultMode ? window.getEffectiveDefaultMode() : "intraday";
            const meta = window.MODE_META[m];
            alert(`New strategy will start in ${meta.label} mode (default).\nChange the default in Settings → Profile → Trading preferences.`);
          }}><I.plus size={14}/> New strategy</button>
        </div>
      </div>

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Card><Stat label="Combined 30d P&L" value={(combinedPnl >= 0 ? "+" : "") + inr(combinedPnl)} delta={pct(2.84)} deltaKind="up" sub="after fees · visible"/></Card>
        <Card><Stat label="Avg win rate" value="62.1%" delta="+1.4pp" deltaKind="up" sub="30d"/></Card>
        <Card><Stat label="Sharpe (30d)" value="1.82" delta="+0.12" deltaKind="up" sub="combined"/></Card>
        <Card><Stat label="Max drawdown" value={pct(-3.8, 1)} delta="peak Mar 12" deltaKind="muted" sub="within limits"/></Card>
      </div>

      {/* Filter bar — mode filter is primary */}
      <div className="row" style={{ marginBottom: 14, justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 500 }}>Mode</span>
          <div className="row" style={{ gap: 4 }}>
            {["All", ...window.MODE_IDS].map(id => {
              const label = id === "All" ? "All" : window.MODE_META[id].label;
              const color = id === "All" ? null : window.MODE_META[id].color;
              const active = filter === id;
              return (
                <button
                  key={id}
                  onClick={() => setFilter(id)}
                  className="btn btn--sm"
                  style={{
                    background: active ? (color || "var(--text-1)") : "var(--bg-soft)",
                    color: active ? "#fff" : "var(--text-2)",
                    borderColor: active ? (color || "var(--text-1)") : "var(--border)",
                    fontWeight: active ? 500 : 400,
                  }}
                >
                  {id !== "All" && <span style={{ width: 6, height: 6, borderRadius: "50%", background: active ? "#fff" : color, display: "inline-block", marginRight: 6 }}/>}
                  {label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <Segmented value={stFilter} onChange={setStFilter} options={["All", "Live", "Paper", "Other"]}/>
          <button className={"btn btn--sm" + (view === "grouped" ? " btn--primary" : "")} onClick={() => setView(view === "grouped" ? "flat" : "grouped")}>
            <I.layers size={12}/> {view === "grouped" ? "Grouped" : "Flat"}
          </button>
        </div>
      </div>

      {/* removed: old labelToId dead code */}

      {view === "grouped" ? (
        byMode.length === 0 ? (
          <Card>
            <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--text-3)" }}>
              No strategies match the current filter.
            </div>
          </Card>
        ) : (
          byMode.map(group => (
            <div key={group.id} style={{ marginBottom: 24 }}>
              {/* Mode group header */}
              <div className="between" style={{ marginBottom: 10, paddingBottom: 8, borderBottom: `2px solid ${group.meta.color}` }}>
                <div className="row" style={{ gap: 10 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: group.meta.color }}/>
                  <strong style={{ fontSize: 14, letterSpacing: "-0.01em" }}>{group.meta.label}</strong>
                  <Pill>{group.items.length}</Pill>
                  {!group.active && <Pill kind="warn">MODE DISABLED</Pill>}
                  <span className="muted" style={{ fontSize: 12 }}>{group.meta.tagline}</span>
                </div>
                <a href="#modes" style={{ fontSize: 12, color: "var(--text-3)", textDecoration: "underline" }}>Open mode →</a>
              </div>
              <div className="grid grid-2">
                {group.items.map((s, i) => renderCard(s, i))}
              </div>
            </div>
          ))
        )
      ) : (
        <div className="grid grid-2" style={{ marginBottom: 16 }}>
          {visible.length === 0 ? (
            <Card><div style={{ padding: "32px 16px", textAlign: "center", color: "var(--text-3)" }}>No strategies match.</div></Card>
          ) : visible.map((s, i) => renderCard(s, i))}
        </div>
      )}

      <Card title="Strategy returns — monthly" sub="Heatmap of % returns per strategy / month" style={{ marginTop: 16 }}>
        <Heatmap
          rows={["Momentum AI", "Mean Rev. v2", "Grid Trader", "Trend Follow", "Iron Condor", "Short Straddle", "NIFTY Fut"]}
          cols={["Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr"]}
          values={[
            [2.1, 3.4, -1.2, 4.8, 2.6, 3.1, 5.2, 4.1, 3.8],
            [1.6, 2.8, 2.1, -0.8, 3.4, 2.2, 2.9, 3.6, 2.4],
            [-0.4, 1.2, -2.1, 0.8, 1.4, -1.8, 0.6, -1.2, -0.8],
            [1.2, 1.8, 0.9, 2.1, 2.6, 1.9, 2.4, 2.8, 2.2],
            [null, null, 1.8, 2.4, 2.1, 1.9, 3.2, 2.8, 2.1],
            [null, null, null, 1.4, 1.8, 2.1, 2.4, 1.9, 1.6],
            [null, null, null, null, null, 0.8, 1.2, 0.9, 0.6],
          ]}
          min={-3} max={6}
        />
      </Card>
    </>
  );
};

Object.assign(window, { StrategiesScreen });
