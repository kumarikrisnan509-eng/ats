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
  React.useEffect(() => { try { localStorage.setItem(k, JSON.stringify(data)); } catch (e) { console.debug('[r9-additions] swallowed:', e && e.message); } }, [data]);
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

// ============ #18 Broker connection status -- Tier 14: replaces 5-broker mock ============
// We currently only support Zerodha. Showing fake 'Upstox/Dhan/Groww/Angel' brokers was a lie.
// This card now shows the SINGLE truth: Zerodha connection status, holdings P&L, deployed capital.
const MultiBrokerPnL = () => {
  const [data, setData] = React.useState(null);
  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [holdings, health, paper] = await Promise.all([
          window.fetchApi('/api/portfolio/holdings').catch(() => null),
          window.fetchApi('/api/health').catch(() => null),
          window.fetchApi('/api/paper').catch(() => null),
        ]);
        if (cancelled) return;
        const rows = (holdings && holdings.rows) || [];
        const eqValue = rows.reduce((s, h) => s + (h.quantity || 0) * (h.last_price || h.ltp || 0), 0);
        const eqPnl   = rows.reduce((s, h) => s + (h.pnl || 0), 0);
        const paperEq  = paper && paper.stats ? (paper.stats.totalEquity || 0) : 0;
        const paperPnl = paper && paper.stats ? (paper.stats.realizedPnl || 0) : 0;
        setData({
          connected: !!(health && health.broker && health.broker.connected),
          eqValue, eqPnl, paperEq, paperPnl,
          totalPnl: eqPnl + paperPnl,
          totalCap: eqValue + paperEq,
        });
      } catch (_e) {}
    };
    load();
    const t = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);
  const inr = (n) => window.inr ? window.inr(n) : '₹' + Math.round(n || 0).toLocaleString('en-IN');
  const inrC = (n) => window.inrCompact ? window.inrCompact(n) : inr(n);
  return (
    <div className="card">
      <div className="card__head">
        <div>
          <div className="card__title">Broker P&amp;L</div>
          <div className="card__sub">Zerodha · {data && data.connected ? 'connected' : 'reconnecting'}</div>
        </div>
        <a href="#brokers" className="btn btn--sm btn--ghost">Manage</a>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 14 }}>
        <div className="stat">
          <div className="stat__label">Total P&amp;L</div>
          <div className={"stat__value " + (data && data.totalPnl >= 0 ? "up" : "down")}>
            {data ? (data.totalPnl >= 0 ? '+' : '') + inr(data.totalPnl) : '—'}
          </div>
        </div>
        <div className="stat">
          <div className="stat__label">Capital deployed</div>
          <div className="stat__value">{data ? inrC(data.totalCap) : '—'}</div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderTop: '1px solid var(--border)' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--info)' }}/>
          <span style={{ fontSize: 13, flex: 1 }}>Equity (Zerodha)</span>
          <span className="mono muted" style={{ fontSize: 11 }}>{data ? inrC(data.eqValue) : '—'}</span>
          <span className={"mono " + (data && data.eqPnl >= 0 ? "up" : "down")} style={{ fontSize: 12, minWidth: 70, textAlign: 'right' }}>
            {data ? (data.eqPnl >= 0 ? '+' : '') + inr(data.eqPnl) : '—'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderTop: '1px solid var(--border)' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)' }}/>
          <span style={{ fontSize: 13, flex: 1 }}>Paper trading</span>
          <span className="mono muted" style={{ fontSize: 11 }}>{data ? inrC(data.paperEq) : '—'}</span>
          <span className={"mono " + (data && data.paperPnl >= 0 ? "up" : "down")} style={{ fontSize: 12, minWidth: 70, textAlign: 'right' }}>
            {data ? (data.paperPnl >= 0 ? '+' : '') + inr(data.paperPnl) : '—'}
          </span>
        </div>
      </div>
    </div>
  );
};

// ============ #19 Session info -- Tier 14: replaces fake 6-row login history ============
// We don't have a real auth/session backend yet. Rather than show 6 fake IP addresses,
// surface the ONE truth we know: current session uptime + Kite session validity.
const LoginHistory = () => {
  // T99-T69: switched the profile source from /api/profile (broker) to
  // /api/me/identity (user row, added in T-67). Surfaces T-34/T-55 fields
  // (stalledOnToken + tokenAge) so status string is accurate.
  const [info, setInfo] = React.useState(null);
  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [health, me] = await Promise.all([
          window.fetchApi('/api/health').catch(() => null),
          window.fetchApi('/api/me/identity').catch(() => null),
        ]);
        if (cancelled) return;
        const b = (health && health.broker) || {};
        setInfo({
          uptimeSec:      health ? (health.uptimeSec || 0) : 0,
          brokerConnected: !!b.connected,
          hasAccessToken:  !!b.hasAccessToken,
          stalledOnToken:  !!b.stalledOnToken,                // T-34
          tickStale:       !!b.tickStale,                     // T-37
          tokenAgeMin: typeof b.lastAccessTokenSetAt === 'number' && b.lastAccessTokenSetAt > 0
            ? Math.round((Date.now() - b.lastAccessTokenSetAt) / 60000)
            : null,                                            // T-55
          meOk:    !!(me && me.ok),
          userName: me && me.user && me.user.name,
          email:    me && me.user && me.user.email,
          lastLoginAt: me && me.user && me.user.last_login_at,
        });
      } catch (_e) {}
    };
    load();
    const t = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);
  const fmtUptime = (s) => {
    if (!s) return '—';
    if (s < 60) return s + 's';
    if (s < 3600) return Math.floor(s/60) + 'm';
    if (s < 86400) return Math.floor(s/3600) + 'h ' + Math.floor((s%3600)/60) + 'm';
    return Math.floor(s/86400) + 'd ' + Math.floor((s%86400)/3600) + 'h';
  };
  // T-34/T-37: accurate status string built from real broker.health fields.
  const status = !info ? 'loading'
    : info.stalledOnToken ? 'token expired (reconnect)'
    : info.tickStale ? 'frozen (no ticks)'
    : info.brokerConnected ? 'streaming'
    : info.hasAccessToken ? 'reconnecting'
    : 'no token';
  const statusTone = !info ? '' : (info.stalledOnToken ? 'down' : (info.brokerConnected && !info.tickStale ? 'up' : ''));
  return (
    <div className="card">
      <div className="card__head">
        <div>
          <div className="card__title">Session status</div>
          <div className="card__sub">Kite Connect session for this account</div>
        </div>
        <button className="btn btn--sm btn--ghost" onClick={() => location.hash = 'brokers'}>Manage</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 8 }}>
        <div className="stat">
          <div className="stat__label">Kite session</div>
          <div className={"stat__value " + statusTone} style={{ fontSize: 16 }}>{status}</div>
          <div className="stat__delta muted">
            {info && info.tokenAgeMin != null
              ? `token refreshed ${info.tokenAgeMin}m ago`
              : 'auto-relogin daily 05:45 IST'}
          </div>
        </div>
        <div className="stat">
          <div className="stat__label">Backend uptime</div>
          <div className="stat__value mono" style={{ fontSize: 16 }}>{info ? fmtUptime(info.uptimeSec) : '—'}</div>
          <div className="stat__delta muted">{info && info.email ? info.email : 'this server instance'}</div>
        </div>
      </div>
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

// ============ #24 Copy-trading leaderboard -- Tier 15: demo-gated ============
// Previously rendered hardcoded 'SEBI-verified track records' for fake traders.
// Regulatory landmine per trading_platform_plan.md §0 (no guaranteed returns,
// no impersonation). Until /api/leaderboard exists and is backed by audited
// live-account performance, this is demo-mode-only.
const Leaderboard = () => {
  const [demo] = window.useDemoMode ? window.useDemoMode() : [false];
  if (!demo) {
    return (
      <div className="card" style={{ padding: 16 }}>
        <div className="card__title">Leaderboard</div>
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          Coming soon. Verified-track-record rankings require live-broker integration
          with our empanelment partner. Enable Demo mode in your profile menu to preview the planned UI.
        </div>
      </div>
    );
  }
  const traders = [
    { rank: 1, name: "Demo User A", handle: "@demo_a", monthlyPct: 8.4 },
    { rank: 2, name: "Demo User B", handle: "@demo_b", monthlyPct: 7.1 },
    { rank: 3, name: "Demo User C", handle: "@demo_c", monthlyPct: 5.8 },
  ];
  return (
    <div className="card">
      <div className="card__head">
        <div>
          <div className="card__title">Leaderboard (demo preview)</div>
          <div className="card__sub">Not a real ranking · no SEBI verification</div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
        {traders.map(t => (
          <div key={t.handle} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderTop: '1px solid var(--border)' }}>
            <span className="mono muted" style={{ width: 24 }}>#{t.rank}</span>
            <span style={{ flex: 1, fontSize: 13 }}>{t.name} <span className="muted" style={{ fontSize: 11 }}>{t.handle}</span></span>
            <span className="mono up" style={{ fontSize: 12 }}>+{t.monthlyPct}%</span>
          </div>
        ))}
      </div>
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
// T99-T110: previously had defaults (-0.4 / -3.0 / -0.18%) that rendered as
// 'breach -3.0% drawdown in ~14 min' on every visit even with no real burn
// rate. Now hides entirely when invoked without real props; shows an honest
// placeholder when explicitly demo'd. Live burn-rate feed isn't wired yet.
const RiskPredictor = ({ current, limit, rate, demo }) => {
  // No real data: render nothing rather than fake a breach prediction.
  if (current == null || limit == null || rate == null) {
    if (!demo) return null;
    // Demo placeholder (only when caller explicitly opts in)
    return (
      <div className="muted" style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--bg-soft)', border: '1px solid var(--border)', fontSize: 12 }}>
        Drawdown burn-rate not wired — RiskPredictor will activate when per-user daily
        equity + intraday tick feeds are aggregated.
      </div>
    );
  }
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
