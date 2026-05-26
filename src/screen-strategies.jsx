/* eslint-disable */
// @ts-check
/* Strategies screen — mode is the primary grouping dimension */


/* ============================================================
 * Tier 43: AutorunPanel -- frontend for the Tier 3 auto-runner.
 * Wires GET/PUT/POST/DELETE /api/autorun:
 *   GET    -> current config + last 25 runs + stats
 *   PUT    -> save config (strategy, symbol, qty, interval, etc.)
 *   POST   /api/autorun/run -- one-shot evaluation
 *   DELETE -> clear config + stop timer
 * ============================================================ */
const AutorunPanel = () => {
  const [data, setData] = React.useState(null);
  const [strategies, setStrategies] = React.useState([]);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState(null);

  // Form state -- seeded from server config when it arrives.
  const [form, setForm] = React.useState({
    enabled: false,
    strategy: 'rsi-mean-reversion',
    symbol: 'RELIANCE',
    qty: 1,
    interval: 'day',
    intervalMinutes: 60,
    candleLookbackDays: 60,
  });

  const load = React.useCallback(async () => {
    try {
      const [a, s] = await Promise.all([
        window.fetchApi('/api/autorun').catch(() => null),
        window.fetchApi('/api/strategies').catch(() => null),
      ]);
      if (a) {
        setData(a);
        if (a.config) setForm(prev => ({ ...prev, ...a.config }));
      }
      const sList = s && (s.strategies || s.list || s);
      if (Array.isArray(sList)) {
        setStrategies(sList.map(x => (typeof x === 'string' ? x : (x.id || x.name))).filter(Boolean));
      }
    } catch (e) { console.warn('[screen-strategies] swallowed:', e && e.message); }
  }, []);
  React.useEffect(() => { load(); }, [load]);

  const save = async (overrides) => {
    setBusy(true); setMsg(null);
    const body = { ...form, ...(overrides || {}) };
    try {
      const r = await window.fetchApi('/api/autorun', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setMsg(r && r.ok ? '✓ saved' : '✗ ' + (r && r.reason));
      await load();
    } catch (e) { setMsg('✗ ' + e.message); }
    finally { setBusy(false); }
  };

  const runNow = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await window.fetchApi('/api/autorun/run', { method: 'POST' });
      setMsg(r && r.ok ? '✓ evaluation triggered' : '✗ ' + (r && r.reason));
      await load();
    } catch (e) { setMsg('✗ ' + e.message); }
    finally { setBusy(false); }
  };

  const clearCfg = async () => {
    if (!window.confirm('Clear auto-runner config and stop the timer?')) return;
    setBusy(true); setMsg(null);
    try {
      const r = await window.fetchApi('/api/autorun', { method: 'DELETE' });
      setMsg(r && r.ok ? '✓ cleared' : '✗ ' + (r && r.reason));
      await load();
    } catch (e) { setMsg('✗ ' + e.message); }
    finally { setBusy(false); }
  };

  const inputStyle = {
    width: '100%', padding: '6px 8px',
    background: 'var(--bg-sunk)', border: '1px solid var(--border)',
    borderRadius: 'var(--r-md)', fontFamily: 'var(--mono)', fontSize: 12,
  };
  const cardStyle = { padding: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 16 };

  const history = data && (data.history || data.runs) || [];

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>Strategy auto-runner</div>
        <span style={{
          fontSize: 11, padding: '2px 8px', borderRadius: 999,
          background: form.enabled ? 'var(--up-soft, #dcfce7)' : 'var(--bg-soft)',
          color: form.enabled ? 'var(--up)' : 'var(--text-3)',
          fontWeight: 600,
        }}>{form.enabled ? 'ENABLED' : 'DISABLED'}</span>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        <label style={{ flex: '2 1 180px' }}>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>Strategy</div>
          <select style={inputStyle} value={form.strategy} onChange={ev => setForm({ ...form, strategy: ev.target.value })}>
            {strategies.length > 0
              ? strategies.map(s => <option key={s} value={s}>{s}</option>)
              : <option value={form.strategy}>{form.strategy}</option>}
          </select>
        </label>
        <label style={{ flex: '1 1 110px' }}>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>Symbol</div>
          <input style={inputStyle} value={form.symbol} onChange={ev => setForm({ ...form, symbol: ev.target.value.toUpperCase() })}/>
        </label>
        <label style={{ flex: '1 1 70px' }}>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>Qty</div>
          <input style={inputStyle} type="number" min="1" value={form.qty} onChange={ev => setForm({ ...form, qty: Number(ev.target.value) })}/>
        </label>
        <label style={{ flex: '1 1 90px' }}>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>Bar interval</div>
          <select style={inputStyle} value={form.interval} onChange={ev => setForm({ ...form, interval: ev.target.value })}>
            <option value="day">day</option><option value="60minute">60m</option>
            <option value="15minute">15m</option><option value="5minute">5m</option>
          </select>
        </label>
        <label style={{ flex: '1 1 100px' }}>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>Schedule (min)</div>
          <input style={inputStyle} type="number" min="1" value={form.intervalMinutes} onChange={ev => setForm({ ...form, intervalMinutes: Number(ev.target.value) })}/>
        </label>
        <label style={{ flex: '1 1 100px' }}>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>Lookback days</div>
          <input style={inputStyle} type="number" min="30" value={form.candleLookbackDays} onChange={ev => setForm({ ...form, candleLookbackDays: Number(ev.target.value) })}/>
        </label>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button disabled={busy} className={form.enabled ? 'btn' : 'btn btn--accent'}
                onClick={() => save({ enabled: !form.enabled })}>
          {form.enabled ? 'Disable' : 'Enable + save'}
        </button>
        <button disabled={busy} onClick={() => save({})}>Save config</button>
        <button disabled={busy} onClick={runNow}>Run once</button>
        <button disabled={busy} onClick={clearCfg}>Clear</button>
        {msg && <span style={{ fontSize: 11, color: msg.startsWith('✓') ? 'var(--up)' : 'var(--down)' }}>{msg}</span>}
      </div>

      {/* Recent run history */}
      {Array.isArray(history) && history.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>Last {history.length} runs</div>
          <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--r-md)' }}>
            <table className="tbl" style={{ width: '100%', fontSize: 10 }}>
              <thead><tr><th>ts</th><th>strategy</th><th>symbol</th><th>signal</th><th>action</th><th>note</th></tr></thead>
              <tbody>
                {history.slice(-25).reverse().map((h, i) => (
                  <tr key={i}>
                    <td className="mono">{String(h.ts || h.t || '').slice(0, 19).replace('T', ' ')}</td>
                    <td className="mono">{h.strategy || form.strategy}</td>
                    <td className="mono">{h.symbol || form.symbol}</td>
                    <td className="mono">{h.signal || '—'}</td>
                    <td>{h.action || h.status || '—'}</td>
                    <td style={{ fontSize: 10, color: 'var(--text-3)' }}>{h.note || h.reason || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

const StrategiesScreen = () => {
  // Real backend strategy registry + watchlist backtest trigger, exposed via window helpers.
  const [backendStrats, setBackendStrats] = React.useState([]);
  const [stratsLoaded, setStratsLoaded] = React.useState(false);  // T-350: separate "not yet" from "empty"
  const [runStatus, setRunStatus]         = React.useState(null);
  // T99-T99: per-user risk metrics (Sharpe / max DD) from /api/me/risk-metrics.
  const [riskMetrics, setRiskMetrics] = React.useState(null);
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const j = await window.fetchApi('/api/strategies');
        if (!cancelled) {
          setBackendStrats((j && j.strategies) || []);
          setStratsLoaded(true);  // T-350: mark loaded -- header stops showing "Loading"
        }
      } catch (e) {
        console.warn('[screen-strategies] swallowed:', e && e.message);
        if (!cancelled) setStratsLoaded(true);  // T-350: still mark loaded so we show empty-state, not eternal spinner
      }
      try {
        const r = await window.fetchApi('/api/me/risk-metrics?days=30');
        if (!cancelled && r && r.ok) setRiskMetrics(r);
      } catch (e) { console.warn('[screen-strategies] swallowed:', e && e.message); }
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

  // T-350: NEVER fall through to window.STRATEGY_CATALOG -- that's the local mock catalog
  // with 18 fake strategies ("18 strategies · ₹24L · +₹1,10,830") and it was flashing
  // on every initial render before /api/strategies resolved. Production must show empty
  // state instead. The catalog is still used by the Trading Modes screen as a static
  // mode reference, but the Strategies screen renders ONLY what the backend returns.
  const strats = (Array.isArray(backendStrats) && backendStrats.length > 0)
    ? backendStrats.map(s => ({
        id: s.id || s.name,
        n:  s.name || s.id,                    // renderCard reads s.n
        name: s.name || s.id,
        mode: 'live',
        stage: 'live',
        st: 'live',                            // filters + renderCard read s.st
        k:  s.description || s.name || '',     // renderCard reads s.k (kind/subtitle)
        mkt: 'NSE',                            // renderCard reads s.mkt (market) -- backend doesn't expose, default
        cap: 0,                                // renderCard reads s.cap -- 0 until deployed
        sharpe: null, winR: null, pnl30: 0,    // T-234: was pnl30d -- field mismatch with consumers (L265/298/303) caused ₹NaN
        signals24h: 0, status: 'live',
        params: s.params || {}, defaults: s.defaults || {},
        description: s.description || s.name,
        live: true,
      }))
    : [];  // T-350: empty until /api/strategies resolves -- header shows "Loading…" instead of fake numbers
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
      <AutorunPanel />
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

        {/* T-429 (audit-2026-05-26 frontend H3): mapped backend strats don't
            populate `trades` or `alloc`; render "—" instead of "undefined". */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 12 }}>
          <div><div className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>Capital</div><div className="mono" style={{ fontSize: 14 }}>{inrCompact(s.cap)}</div></div>
          <div><div className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>30d P&L</div><div className={"mono " + clsPN(s.pnl30)} style={{ fontSize: 14 }}>{s.pnl30 >= 0 ? "+" : ""}{inr(s.pnl30)}</div></div>
          <div><div className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>Win</div><div className="mono" style={{ fontSize: 14 }}>{s.winR || "—"}{s.winR ? "%" : ""}</div></div>
          <div><div className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>Trades</div><div className="mono" style={{ fontSize: 14 }}>{Number.isFinite(s.trades) ? s.trades : "—"}</div></div>
        </div>

        {/* T-429 (audit-2026-05-26 frontend H2): only render the seriesRandom
            sparkline in demo. In live mode it's an invented curve over a
            real strategy's name. */}
        {(window.MockData && window.MockData.isDemoOn && window.MockData.isDemoOn()) && (
          <Sparkline data={seriesRandom(i + 5, 40, 80, 120, s.pnl30 > 0 ? 0.3 : s.pnl30 < 0 ? -0.25 : 0)} height={44} color={s.pnl30 > 0 ? "var(--up)" : s.pnl30 < 0 ? "var(--down)" : "var(--text-4)"}/>
        )}

        <div className="divider"/>
        <div className="between" style={{ fontSize: 12 }}>
          <span className="muted">Allocation of mode capital</span>
          <span className="mono">{Number.isFinite(s.alloc) ? (s.alloc + "%") : "—"}</span>
        </div>
        <div style={{ marginTop: 6 }}><Progress value={Number.isFinite(s.alloc) ? s.alloc : 0} max={40} kind={s.st === "live" ? "up" : "info"}/></div>
      </Card>
    );
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-header__title">Strategies</h1>
          <div className="page-header__sub">{stratsLoaded
            ? `${strats.length} strategies · ${liveCount} live · ${paperCount} in paper · ${inrCompact(deployed)} deployed · grouped by mode`
            : "Loading strategies…"}</div>
        </div>
        <div className="page-header__right">
          <button className="btn"><I.code size={14}/> Import Python</button>
          <button className="btn btn--primary" onClick={() => {
            // T-180 (SCREENS-AUDIT F-15): replace native alert() with the
            // global toast system (window.toast from r8-primitives.jsx).
            // Same information, non-blocking, matches the rest of the UI.
            const m = window.getEffectiveDefaultMode ? window.getEffectiveDefaultMode() : "intraday";
            const meta = (window.MODE_META && window.MODE_META[m]) || { label: m };
            if (window.toast) {
              window.toast({
                kind: 'info',
                title: `New strategy will start in ${meta.label} mode (default)`,
                sub: 'Change the default in Settings → Profile → Trading preferences.',
              });
            } else {
              // Fallback if toast host isn't mounted (e.g. early boot).
              alert(`New strategy will start in ${meta.label} mode (default).\nChange the default in Settings → Profile → Trading preferences.`);
            }
          }}><I.plus size={14}/> New strategy</button>
        </div>
      </div>

      {/* T99-T99: Sharpe + Max DD now wired to /api/me/risk-metrics (Tier 69a).
          Win rate still needs a per-trade ledger. Combined 30d P&L is derived
          from the strats array. */}
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Card><Stat label="Combined 30d P&L" value={(combinedPnl >= 0 ? "+" : "") + inr(combinedPnl)} sub="sum of visible strategies"/></Card>
        <Card><Stat label="Avg win rate" value="—" sub="needs per-trade ledger"/></Card>
        <Card><Stat
          label="Sharpe (30d)"
          value={riskMetrics && Number.isFinite(riskMetrics.sharpeRatio) ? riskMetrics.sharpeRatio.toFixed(2) : "—"}
          sub={riskMetrics && riskMetrics.pointCount ? `${riskMetrics.pointCount} daily snapshots` : "needs daily-equity series"}
        /></Card>
        <Card><Stat
          label="Max drawdown"
          value={riskMetrics && Number.isFinite(riskMetrics.maxDrawdown) ? (riskMetrics.maxDrawdown * 100).toFixed(1) + "%" : "—"}
          sub={riskMetrics && Number.isFinite(riskMetrics.maxDrawdownDays) ? `${riskMetrics.maxDrawdownDays} day drawdown` : "needs equity peak/trough"}
        /></Card>
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
        {/* T-350d: gated -- was hardcoded 7-row x 9-month fake (Momentum AI +2.1 Aug, etc.).
            T-346 listed this as fixed but never actually replaced the JSX. Live mode has no
            monthly-returns backend yet, so render an empty-state until one exists. */}
        <div style={{ padding: "24px", textAlign: "center", color: "var(--text-3)" }}>
          No monthly return data yet. Populates once strategies accumulate per-month closed trades.
        </div>
      </Card>
    </>
  );
};

Object.assign(window, { StrategiesScreen });
