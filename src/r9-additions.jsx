/* eslint-disable */
/* Round 9 — Remaining 13 audit items as a single consolidated file.
   Utilities: csvDownload, useSavedViews
   Widgets:   AICostCard, MultiBrokerPnL, LoginHistory, BacktestQueue, Leaderboard,
              SignalWhy, RiskPredictor, StrategyCompare
   Plus a new ApiDocsScreen route.
*/

// ============ #11 CSV export utility ============
const csvDownload = (filename, rows) => {
  if (!rows || !rows.length) return;
  const cols = Object.keys(rows[0]);
  const esc = (v) => {
    if (v == null) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols.join(","), ...rows.map(r => cols.map(c => esc(r[c])).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
  if (window.toast) window.toast({ kind: "up", title: "CSV downloaded", sub: `${filename} · ${rows.length} rows` });
};

// Button wrapper: <ExportCsvButton rows={[...]} filename="audit.csv"/>
const ExportCsvButton = ({ rows, filename = "export.csv", label = "Export CSV" }) => (
  <button className="btn btn--sm" onClick={() => csvDownload(filename, rows)} title="Download as CSV">
    <I.download size={12}/> {label}
  </button>
);

// ============ #12 Saved views / pinned filters ============
// usage:
//   const [views, current, setCurrent, saveView, deleteView] = useSavedViews("audit", defaultFilters);
//   current.filters // -> read filters object
const useSavedViews = (key, initial) => {
  const k = `ats.views.${key}`;
  const [data, setData] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem(k)) || { current: "default", views: { default: { name: "Default", filters: initial } } }; }
    catch { return { current: "default", views: { default: { name: "Default", filters: initial } } }; }
  });
  React.useEffect(() => { try { localStorage.setItem(k, JSON.stringify(data)); } catch {} }, [data]);
  const setCurrent = (id) => setData(d => ({ ...d, current: id }));
  const saveView = (name, filters) => {
    const id = "v" + Date.now();
    setData(d => ({ ...d, current: id, views: { ...d.views, [id]: { name, filters } } }));
    if (window.toast) window.toast({ kind: "up", title: "View saved", sub: name });
  };
  const deleteView = (id) => {
    if (id === "default") return;
    setData(d => {
      const v = { ...d.views }; delete v[id];
      return { ...d, current: d.current === id ? "default" : d.current, views: v };
    });
  };
  const updateCurrent = (filters) => {
    setData(d => ({ ...d, views: { ...d.views, [d.current]: { ...d.views[d.current], filters } } }));
  };
  const current = data.views[data.current] || data.views.default;
  return { views: data.views, currentId: data.current, current, setCurrent, saveView, deleteView, updateCurrent };
};

// Pill picker UI for views
const SavedViewsBar = ({ hook, onPickFilters }) => {
  const { views, currentId, setCurrent, saveView, deleteView } = hook;
  const [name, setName] = React.useState("");
  const [open, setOpen] = React.useState(false);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}>Views</span>
      {Object.entries(views).map(([id, v]) => (
        <button key={id} onClick={() => { setCurrent(id); onPickFilters && onPickFilters(v.filters); }}
          className={"pill" + (currentId === id ? " pill--acc" : "")}
          style={{ cursor: "pointer", paddingRight: id === "default" ? 8 : 4 }}>
          {v.name}
          {id !== "default" && currentId === id && (
            <span onClick={(e) => { e.stopPropagation(); deleteView(id); }} style={{ marginLeft: 4, color: "currentColor", opacity: 0.6 }}>×</span>
          )}
        </button>
      ))}
      <button className="btn btn--sm btn--ghost" onClick={() => setOpen(o => !o)}>+ Save</button>
      {open && (
        <div style={{ display: "flex", gap: 6 }}>
          <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="View name"
            style={{ padding: "5px 10px", fontSize: 12, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6 }}/>
          <button className="btn btn--sm btn--primary" disabled={!name.trim()}
            onClick={() => { saveView(name.trim(), hook.current.filters); setName(""); setOpen(false); }}>Save</button>
        </div>
      )}
    </div>
  );
};

// ============ #22 AI Cost card -- Tier 13: live from /api/system/info.components.ai ============
// Today's calls used / dailyCap from the AI controller. We no longer have INR cost data
// in backend (this would need per-call token logging), so we surface CALL COUNTS instead
// of fake INR -- accurate beats pretty.
const AICostCard = () => {
  const [ai, setAi] = React.useState(null);
  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await window.fetchApi('/api/system/info').catch(() => null);
        if (cancelled) return;
        const a = r && r.components && r.components.ai;
        if (a) setAi(a);
      } catch (_e) {}
    };
    load();
    const t = setInterval(load, 60000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);
  const enabled  = ai && ai.enabled;
  const calls    = ai ? (ai.dailyCalls || 0) : 0;
  const cap      = ai ? (ai.dailyCap || 0)   : 0;
  const remaining = Math.max(0, cap - calls);
  const pct      = cap > 0 ? Math.round((calls / cap) * 100) : 0;
  const model    = (ai && ai.model) || '—';
  const resetAt  = ai && ai.dailyResetAt ? new Date(ai.dailyResetAt) : null;
  return (
    <div className="card">
      <div className="card__head">
        <div>
          <div className="card__title">AI inference · today</div>
          <div className="card__sub">{enabled ? `${model} · resets ${resetAt ? resetAt.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}) : '—'}` : 'AI subsystem disabled'}</div>
        </div>
        <span className="pill pill--vio"><I.sparkle size={10}/> {enabled ? 'live' : 'off'}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
        <div className="stat">
          <div className="stat__label">Calls used</div>
          <div className="stat__value mono">{calls}</div>
          <div className="stat__delta muted">of {cap} daily cap</div>
        </div>
        <div className="stat">
          <div className="stat__label">Remaining</div>
          <div className="stat__value mono">{remaining}</div>
          <div className="stat__delta muted">resets at midnight UTC</div>
        </div>
        <div className="stat">
          <div className="stat__label">Usage</div>
          <div className="stat__value mono">{pct}%</div>
          <div className="stat__delta muted">{enabled ? 'auto-throttle on cap' : 'set ANTHROPIC_API_KEY'}</div>
        </div>
      </div>
      <div className="progress" style={{ marginTop: 14 }}>
        <div className="progress__fill" style={{ width: `${pct}%` }}/>
      </div>
    </div>
  );
};

// ============ #18 Multi-broker aggregated P&L card ============
const MultiBrokerPnL = () => {
  const brokers = [
    { name: "Zerodha",  status: "live",  pnl: 8420,  capital: 1850000, color: "var(--info)" },
    { name: "Upstox",   status: "live",  pnl: 1250,  capital:  720000, color: "var(--violet)" },
    { name: "Dhan",     status: "live",  pnl: -380,  capital:  420000, color: "var(--accent)" },
    { name: "Groww",    status: "ready", pnl: 0,     capital:       0, color: "var(--text-4)" },
    { name: "Angel",    status: "ready", pnl: 0,     capital:       0, color: "var(--text-4)" },
  ];
  const tot = brokers.reduce((a, b) => a + b.pnl, 0);
  const cap = brokers.reduce((a, b) => a + b.capital, 0);
  return (
    <div className="card">
      <div className="card__head">
        <div>
          <div className="card__title">All-broker aggregated P&amp;L</div>
          <div className="card__sub">3 of 5 connected · live unified view</div>
        </div>
        <a href="#brokers" className="btn btn--sm btn--ghost">Manage</a>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 14 }}>
        <div className="stat">
          <div className="stat__label">Today's P&amp;L</div>
          <div className={"stat__value " + (tot >= 0 ? "up" : "down")}>
            {tot >= 0 ? "+" : ""}{window.inr ? window.inr(tot) : tot}
          </div>
        </div>
        <div className="stat">
          <div className="stat__label">Deployed capital</div>
          <div className="stat__value">{window.inrCompact ? window.inrCompact(cap) : `₹${cap}`}</div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {brokers.map(b => (
          <div key={b.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderTop: "1px solid var(--border)" }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: b.color }}/>
            <span style={{ fontSize: 13, flex: 1 }}>{b.name}</span>
            {b.status === "live" ? (
              <>
                <span className="mono muted" style={{ fontSize: 11 }}>{window.inrCompact ? window.inrCompact(b.capital) : b.capital}</span>
                <span className={"mono " + (b.pnl >= 0 ? "up" : "down")} style={{ fontSize: 12, minWidth: 70, textAlign: "right" }}>
                  {b.pnl >= 0 ? "+" : ""}{window.inr ? window.inr(b.pnl) : b.pnl}
                </span>
              </>
            ) : (
              <span className="pill" style={{ fontSize: 10 }}>not connected</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

// ============ #19 Login / session history ============
const LoginHistory = () => {
  const rows = [
    { when: "Today · 09:14", ip: "203.115.32.18", loc: "Mumbai, IN", device: "Chrome · macOS", current: true },
    { when: "Yesterday · 18:42", ip: "203.115.32.18", loc: "Mumbai, IN", device: "Chrome · macOS" },
    { when: "Yesterday · 08:55", ip: "203.115.32.18", loc: "Mumbai, IN", device: "iOS · Safari" },
    { when: "Mar 24 · 21:08", ip: "157.49.144.7",  loc: "Pune, IN",  device: "Chrome · Windows", suspicious: true },
    { when: "Mar 23 · 14:22", ip: "203.115.32.18", loc: "Mumbai, IN", device: "Chrome · macOS" },
    { when: "Mar 22 · 09:11", ip: "203.115.32.18", loc: "Mumbai, IN", device: "Chrome · macOS" },
  ];
  return (
    <div className="card card--flush">
      <div className="card__head" style={{ padding: "16px 20px 0" }}>
        <div>
          <div className="card__title">Recent sign-ins</div>
          <div className="card__sub">Last 30 days · highlighted entries are flagged for review</div>
        </div>
        <button className="btn btn--sm btn--danger" title="Force sign-out of all sessions except this one">Sign out all other sessions</button>
      </div>
      <table className="table" style={{ marginTop: 14 }}>
        <thead>
          <tr><th>When</th><th>Location</th><th>IP</th><th>Device</th><th></th></tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ background: r.suspicious ? "var(--warn-soft)" : "" }}>
              <td>{r.when}</td>
              <td>{r.loc}</td>
              <td className="mono" style={{ fontSize: 12 }}>{r.ip}</td>
              <td>{r.device}</td>
              <td style={{ textAlign: "right" }}>
                {r.current && <span className="pill pill--up">this session</span>}
                {r.suspicious && <span className="pill pill--warn">review</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ============ #23 Backtest queue ============
const BacktestQueue = () => {
  const [items, setItems] = React.useState([
    { id: 1, name: "Walk-forward · Momentum AI · 2y", status: "running", progress: 64, eta: "12m" },
    { id: 2, name: "Mean Reversion · 5y · Daily",      status: "queued",  progress: 0,  eta: "queued" },
    { id: 3, name: "Options IC · NIFTY weekly · 1y",   status: "queued",  progress: 0,  eta: "queued" },
    { id: 4, name: "Pairs · TCS/INFY · 3y",            status: "done",    progress: 100, eta: "Sharpe 1.84" },
    { id: 5, name: "Regime-switching · 18m",           status: "failed",  progress: 22,  eta: "data gap on 2024-08-14" },
  ]);
  const cancel = (id) => setItems(it => it.filter(x => x.id !== id));
  const color = { running: "var(--info)", queued: "var(--text-4)", done: "var(--up)", failed: "var(--down)" };
  return (
    <div className="card">
      <div className="card__head">
        <div>
          <div className="card__title">Overnight backtest queue</div>
          <div className="card__sub">We'll email you when each completes · max 5 concurrent</div>
        </div>
        <button className="btn btn--primary btn--sm">+ New run</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {items.map(it => (
          <div key={it.id} style={{ padding: 12, border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg-soft)" }}>
            <div className="between" style={{ marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: color[it.status] }}/>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{it.name}</span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span className="muted mono" style={{ fontSize: 11 }}>{it.eta}</span>
                <button onClick={() => cancel(it.id)} style={{ color: "var(--text-4)" }}>×</button>
              </div>
            </div>
            {(it.status === "running" || it.status === "failed") && (
              <div className="progress"><div className={"progress__fill" + (it.status === "failed" ? " progress__fill--down" : " progress__fill--info")} style={{ width: it.progress + "%" }}/></div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

// ============ #24 Copy-trading leaderboard ============
const Leaderboard = () => {
  const traders = [
    { rank: 1,  name: "Arjun Mehta",     handle: "@quant_arjun", cagr: 42.4, sharpe: 2.1, copiers: 1820, you: false },
    { rank: 2,  name: "Sneha Reddy",     handle: "@sneha_alpha", cagr: 38.7, sharpe: 1.94, copiers: 1240, you: false },
    { rank: 18, name: "You",             handle: "@rajasekar",   cagr: 24.1, sharpe: 1.42, copiers: 12,   you: true  },
    { rank: 3,  name: "Vikram Iyer",     handle: "@v_iyer",      cagr: 36.2, sharpe: 1.78, copiers:  980, you: false },
    { rank: 4,  name: "Priya Kapoor",    handle: "@priya_kap",   cagr: 33.5, sharpe: 1.61, copiers:  720, you: false },
    { rank: 5,  name: "Karthik Nair",    handle: "@k_nair",      cagr: 29.8, sharpe: 1.55, copiers:  640, you: false },
  ].sort((a, b) => a.rank - b.rank);
  return (
    <div className="card card--flush">
      <div className="card__head" style={{ padding: "16px 20px 0" }}>
        <div>
          <div className="card__title">Public leaderboard · 12-month</div>
          <div className="card__sub">SEBI-verified track records · risk-adjusted ranking</div>
        </div>
        <div className="segmented">
          <button className="on">12m</button><button>3m</button><button>YTD</button>
        </div>
      </div>
      <table className="table" style={{ marginTop: 12 }}>
        <thead>
          <tr><th style={{ width: 60 }}>Rank</th><th>Trader</th><th className="num">CAGR</th><th className="num">Sharpe</th><th className="num">Copiers</th><th></th></tr>
        </thead>
        <tbody>
          {traders.map(t => (
            <tr key={t.rank} style={{ background: t.you ? "var(--accent-soft)" : "" }}>
              <td className="mono" style={{ fontWeight: 600 }}>#{t.rank}</td>
              <td>
                <div style={{ fontWeight: t.you ? 600 : 500 }}>{t.name} {t.you && <span className="pill pill--acc" style={{ marginLeft: 6, fontSize: 9 }}>YOU</span>}</div>
                <div className="muted mono" style={{ fontSize: 11 }}>{t.handle}</div>
              </td>
              <td className="num up">{t.cagr.toFixed(1)}%</td>
              <td className="num">{t.sharpe.toFixed(2)}</td>
              <td className="num">{t.copiers.toLocaleString("en-IN")}</td>
              <td style={{ textAlign: "right" }}>
                {!t.you && <button className="btn btn--sm">Copy</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ============ #10 Signal explainability popover ============
const SignalWhy = ({ confidence = 82, factors }) => {
  const [open, setOpen] = React.useState(false);
  const def = factors || [
    { label: "News sentiment",  weight: 0.6,  contrib: +18, color: "var(--info)" },
    { label: "Price momentum",  weight: 0.4,  contrib: +14, color: "var(--up)" },
    { label: "Regime: trending",weight: 0.3,  contrib: +12, color: "var(--violet)" },
    { label: "Sector tailwind", weight: 0.25, contrib: +9,  color: "var(--accent)" },
    { label: "RSI overbought",  weight: 0.2,  contrib: -7,  color: "var(--down)" },
  ];
  return (
    <span style={{ position: "relative" }}>
      <button onClick={() => setOpen(o => !o)} className="pill" style={{ cursor: "pointer", borderColor: "var(--accent)" }}>
        <I.sparkle size={10}/> Why {confidence}%?
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 50 }}/>
          <div style={{
            position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 51,
            width: 320, background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: 10, padding: 14, boxShadow: "var(--shadow-lg)",
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Contributing factors</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {def.map((f, i) => (
                <div key={i}>
                  <div className="between" style={{ fontSize: 11 }}>
                    <span style={{ color: "var(--text-2)" }}>{f.label}</span>
                    <span className={"mono " + (f.contrib >= 0 ? "up" : "down")}>{f.contrib >= 0 ? "+" : ""}{f.contrib}</span>
                  </div>
                  <div style={{ height: 4, background: "var(--bg-sunk)", borderRadius: 2, marginTop: 3, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: Math.abs(f.contrib) * 4 + "%", background: f.color, marginLeft: f.contrib < 0 ? "auto" : 0 }}/>
                  </div>
                </div>
              ))}
            </div>
            <div className="muted" style={{ fontSize: 10, marginTop: 10, lineHeight: 1.5, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
              Sum of weighted factors → softmax → {confidence}% confidence. Model: Claude Opus 4.6.
            </div>
          </div>
        </>
      )}
    </span>
  );
};

// ============ #8 Risk predictor — extrapolation chip ============
// Drop into Risk screen near the daily drawdown gauge.
const RiskPredictor = ({ current = -0.4, limit = -3.0, rate = -0.18 }) => {
  // rate is %/hour (negative); compute minutes until breach at current rate.
  const remaining = limit - current; // negative
  const hours = remaining / rate;
  const min = Math.max(0, Math.round(hours * 60));
  const danger = min < 60;
  return (
    <div style={{
      padding: "10px 14px", borderRadius: 10,
      background: danger ? "var(--down-soft)" : "var(--warn-soft)",
      color: danger ? "var(--down)" : "oklch(45% 0.13 80)",
      display: "flex", alignItems: "center", gap: 12,
      border: "1px solid " + (danger ? "color-mix(in oklab, var(--down) 22%, transparent)" : "color-mix(in oklab, var(--warn) 22%, transparent)"),
    }}>
      <I.pulse size={16}/>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>
          At current burn-rate, you'll breach the {limit.toFixed(1)}% daily drawdown in ~{min} min
        </div>
        <div style={{ fontSize: 11, opacity: 0.8 }}>
          Now: {current.toFixed(2)}% · rate: {rate.toFixed(2)}%/hr · {danger ? "Consider squaring off losers or pausing modes." : "Watching."}
        </div>
      </div>
      <button className="btn btn--sm" onClick={() => { location.hash = "modes"; }}>Pause modes</button>
    </div>
  );
};

// ============ #7 Strategy compare ============
const StrategyCompare = () => {
  const [a, setA] = React.useState("Momentum AI");
  const [b, setB] = React.useState("Mean Reversion");
  const strategies = ["Momentum AI", "Mean Reversion", "Pairs · TCS/INFY", "Options IC", "Trend Following", "Breakout", "Gap Fill", "Volatility Crush"];
  const stats = {
    "Momentum AI":      { cagr: 32.4, sharpe: 1.84, dd: -8.2,  win: 64, trades: 142, exp: "Trending stocks with positive news catalysts" },
    "Mean Reversion":   { cagr: 18.7, sharpe: 1.42, dd: -5.1,  win: 71, trades: 86,  exp: "Overextended moves back to 20EMA" },
    "Pairs · TCS/INFY": { cagr: 22.1, sharpe: 1.61, dd: -4.3,  win: 58, trades: 64,  exp: "Z-score divergence between correlated pair" },
    "Options IC":       { cagr: 14.2, sharpe: 1.11, dd: -12.0, win: 82, trades: 48,  exp: "Iron condors on weekly NIFTY expiry" },
    "Trend Following":  { cagr: 27.8, sharpe: 1.55, dd: -10.4, win: 52, trades: 38,  exp: "Donchian breakouts on daily charts" },
    "Breakout":         { cagr: 24.5, sharpe: 1.32, dd: -9.8,  win: 49, trades: 92,  exp: "Range breakouts with volume confirmation" },
    "Gap Fill":         { cagr: 16.4, sharpe: 1.28, dd: -6.1,  win: 68, trades: 58,  exp: "Trade against opening gaps to prev close" },
    "Volatility Crush": { cagr: 19.8, sharpe: 1.48, dd: -7.4,  win: 74, trades: 32,  exp: "Short straddles after earnings IV spike" },
  };
  const sa = stats[a], sb = stats[b];
  const winner = (k, higher = true) => {
    const va = sa[k], vb = sb[k];
    if (va === vb) return null;
    return (higher ? va > vb : va < vb) ? "a" : "b";
  };
  const Row = ({ label, k, higher = true, fmt = (v) => v, suffix = "" }) => {
    const w = winner(k, higher);
    return (
      <tr>
        <td style={{ color: "var(--text-3)", fontSize: 12 }}>{label}</td>
        <td className="num" style={{ fontWeight: w === "a" ? 600 : 400, color: w === "a" ? "var(--up)" : "" }}>{fmt(sa[k])}{suffix}</td>
        <td className="num" style={{ fontWeight: w === "b" ? 600 : 400, color: w === "b" ? "var(--up)" : "" }}>{fmt(sb[k])}{suffix}</td>
      </tr>
    );
  };
  return (
    <div className="card">
      <div className="card__head">
        <div>
          <div className="card__title">Compare strategies</div>
          <div className="card__sub">Last 30 days · live + paper combined</div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        {[[a, setA, "A"], [b, setB, "B"]].map(([val, set, lab]) => (
          <div key={lab}>
            <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>Strategy {lab}</div>
            <select value={val} onChange={e => set(e.target.value)} style={{
              width: "100%", padding: "8px 12px", fontSize: 13,
              background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8,
            }}>
              {strategies.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
        ))}
      </div>
      <table className="table">
        <thead>
          <tr><th>Metric</th><th className="num">{a}</th><th className="num">{b}</th></tr>
        </thead>
        <tbody>
          <Row label="CAGR"           k="cagr"   higher={true}  suffix="%"/>
          <Row label="Sharpe ratio"   k="sharpe" higher={true}  fmt={v => v.toFixed(2)}/>
          <Row label="Max drawdown"   k="dd"     higher={false} suffix="%"/>
          <Row label="Win rate"       k="win"    higher={true}  suffix="%"/>
          <Row label="Trades (30d)"   k="trades" higher={true}/>
        </tbody>
      </table>
      <div style={{ padding: 12, background: "var(--bg-soft)", borderRadius: 8, marginTop: 12, fontSize: 12, lineHeight: 1.6 }}>
        <div style={{ marginBottom: 6 }}><b>{a}:</b> <span className="muted">{sa.exp}</span></div>
        <div><b>{b}:</b> <span className="muted">{sb.exp}</span></div>
      </div>
    </div>
  );
};

// ============ #25 API / webhook docs screen ============
const ApiDocsScreen = () => {
  const [tab, setTab] = React.useState("rest");
  const [keyShown, setKeyShown] = React.useState(false);
  const sample = {
    rest: `curl https://api.ats.app/v1/positions \\
  -H "Authorization: Bearer ats_live_••••••••••••8f42"`,
    webhook: `POST https://your-server.com/ats-hook
Content-Type: application/json

{
  "event": "order.filled",
  "order_id": "ord_8f42a1",
  "symbol": "HDFCBANK",
  "qty": 60,
  "price": 1487.30,
  "side": "buy",
  "strategy": "momentum-ai",
  "ts": "2025-03-26T09:42:18.412Z"
}`,
    websocket: `const ws = new WebSocket("wss://stream.ats.app/v1?token=••••8f42");
ws.onmessage = ({ data }) => {
  const tick = JSON.parse(data);
  // { type: "tick", symbol: "NIFTY", ltp: 22418.5, ts: ... }
};`,
  };
  const endpoints = [
    { m: "GET",    p: "/v1/positions",     d: "Open positions across all connected brokers" },
    { m: "GET",    p: "/v1/orders",        d: "Order history with filters" },
    { m: "POST",   p: "/v1/orders",        d: "Place an order (requires placement scope)" },
    { m: "DELETE", p: "/v1/orders/:id",    d: "Cancel a working order" },
    { m: "GET",    p: "/v1/strategies",    d: "List strategies and their states" },
    { m: "POST",   p: "/v1/strategies/:id/pause", d: "Pause a strategy" },
    { m: "GET",    p: "/v1/pnl/today",     d: "Today's P&L aggregated" },
    { m: "GET",    p: "/v1/signals",       d: "AI signal queue (read-only)" },
  ];
  const methodColor = { GET: "var(--info)", POST: "var(--up)", DELETE: "var(--down)", PUT: "var(--warn)" };
  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-header__title">API &amp; Webhooks</h1>
          <div className="page-header__sub">Programmatic access for power users · OAuth + bearer tokens · rate limit 10 req/s</div>
        </div>
        <div className="page-header__right">
          <button className="btn"><I.download size={12}/> OpenAPI 3.1 spec</button>
          <button className="btn btn--primary">+ New API key</button>
        </div>
      </div>

      <div className="grid grid-2-1" style={{ gap: 20 }}>
        <div className="col" style={{ gap: 20 }}>
          <div className="card">
            <div className="card__head"><div className="card__title">Your API keys</div><span className="pill pill--acc">2 active</span></div>
            <table className="table">
              <thead><tr><th>Label</th><th>Key</th><th>Scope</th><th>Last used</th><th></th></tr></thead>
              <tbody>
                <tr>
                  <td>Production bot</td>
                  <td className="mono" style={{ fontSize: 12 }}>
                    ats_live_{keyShown ? "Z3xK9pQv8mWtY7L2nB4f8f42" : "••••••••••••8f42"}
                    <button onClick={() => setKeyShown(s => !s)} className="btn btn--ghost btn--sm" style={{ marginLeft: 4, padding: "2px 6px" }}>
                      {keyShown ? "Hide" : "Show"}
                    </button>
                  </td>
                  <td><span className="pill pill--up">read+place</span></td>
                  <td className="muted mono" style={{ fontSize: 11 }}>2m ago</td>
                  <td><button className="btn btn--sm btn--danger">Revoke</button></td>
                </tr>
                <tr>
                  <td>Read-only dashboard</td>
                  <td className="mono" style={{ fontSize: 12 }}>ats_live_••••••••••••a1c7</td>
                  <td><span className="pill">read</span></td>
                  <td className="muted mono" style={{ fontSize: 11 }}>4h ago</td>
                  <td><button className="btn btn--sm btn--danger">Revoke</button></td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="card card--flush">
            <div style={{ display: "flex", borderBottom: "1px solid var(--border)" }}>
              {[["rest","REST"],["webhook","Webhooks"],["websocket","WebSocket"]].map(([id, lab]) => (
                <button key={id} onClick={() => setTab(id)} style={{
                  padding: "12px 18px", fontSize: 13, fontWeight: 500,
                  color: tab === id ? "var(--text)" : "var(--text-3)",
                  borderBottom: tab === id ? "2px solid var(--accent)" : "2px solid transparent",
                  marginBottom: -1,
                }}>{lab}</button>
              ))}
            </div>
            <pre style={{
              padding: 16, fontSize: 12, fontFamily: "var(--mono)",
              background: "var(--bg-sunk)", margin: 0, overflowX: "auto",
              color: "var(--text-2)", lineHeight: 1.6,
            }}>{sample[tab]}</pre>
          </div>

          <div className="card">
            <div className="card__head"><div className="card__title">Endpoints</div><span className="muted" style={{ fontSize: 11 }}>v1 · stable</span></div>
            <table className="table">
              <tbody>
                {endpoints.map(e => (
                  <tr key={e.p}>
                    <td style={{ width: 80 }}>
                      <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: methodColor[e.m] }}>{e.m}</span>
                    </td>
                    <td className="mono" style={{ fontSize: 12 }}>{e.p}</td>
                    <td className="muted" style={{ fontSize: 12 }}>{e.d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="col" style={{ gap: 20 }}>
          <div className="card">
            <div className="card__title" style={{ marginBottom: 10 }}>Webhook events</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {[
                "order.placed", "order.filled", "order.cancelled", "order.rejected",
                "position.opened", "position.closed",
                "signal.generated", "signal.promoted",
                "risk.breach", "mode.switched", "kill_switch.fired",
              ].map(e => <code key={e} className="chip" style={{ alignSelf: "flex-start" }}>{e}</code>)}
            </div>
          </div>
          <div className="card">
            <div className="card__title" style={{ marginBottom: 10 }}>Rate limits</div>
            <div style={{ fontSize: 12, lineHeight: 1.8, color: "var(--text-2)" }}>
              <div>Bearer auth · 10 req/sec, 600/min</div>
              <div>WebSocket · 1 connection per key</div>
              <div>Order placement · 5/sec</div>
              <div>Bursts · token bucket, 30 tokens</div>
            </div>
          </div>
          <div className="card" style={{ background: "var(--warn-soft)", borderColor: "color-mix(in oklab, var(--warn) 20%, transparent)" }}>
            <div className="card__title" style={{ color: "oklch(45% 0.13 80)" }}>Sandbox first</div>
            <p style={{ fontSize: 12, color: "oklch(45% 0.13 80)", margin: "8px 0 0", lineHeight: 1.5 }}>
              Place orders against <code>sandbox.ats.app</code> first — it mirrors NSE but trades are simulated. Promote to live only after end-to-end testing.
            </p>
          </div>
        </div>
      </div>
    </>
  );
};

Object.assign(window, {
  csvDownload, ExportCsvButton, useSavedViews, SavedViewsBar,
  AICostCard, MultiBrokerPnL, LoginHistory, BacktestQueue, Leaderboard,
  SignalWhy, RiskPredictor, StrategyCompare,
  ApiDocsScreen,
});
