/* eslint-disable */
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
    } catch (_) {}
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
  // Tier 6: prefer live /api/strategies (in backendStrats state) over local catalog
  const strats = (Array.isArray(backendStrats) && backendStrats.length > 0)
    ? backendStrats.map(s => ({
        id: s.id || s.name,
        name: s.name || s.id,
        mode: 'live',
        stage: 'live',
        sharpe: null, winR: null, pnl30d: 0,
        signals24h: 0, status: 'live',
        params: s.params || {}, defaults: s.defaults || {},
        description: s.description || s.name,
        live: true,
      }))
    : (window.STRATEGY_CATALOG || []);
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

      {/* T99-T88: replaced hardcoded 62.1% / 1.82 / -3.8% with '—'.
          Combined 30d P&L IS derived from the strats array (sums pnl30 across
          visible rows), so it stays live. The other three need a per-trade
          performance ledger which isn't aggregated per-user yet. Same pattern
          as T-81 (Signals KPIs). */}
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Card><Stat label="Combined 30d P&L" value={(combinedPnl >= 0 ? "+" : "") + inr(combinedPnl)} sub="sum of visible strategies"/></Card>
        <Card><Stat label="Avg win rate" value="—" sub="needs per-trade ledger"/></Card>
        <Card><Stat label="Sharpe (30d)" value="—" sub="needs daily-equity series"/></Card>
        <Card><Stat label="Max drawdown" value="—" sub="needs equity peak/trough"/></Card>
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
