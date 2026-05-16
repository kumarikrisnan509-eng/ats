/* eslint-disable */
/* Command palette — ⌘K (or Ctrl+K) global navigator + action launcher.
   Lists every route + quick actions. Keyboard-first. */

const ROUTES = [
  // Top-level
  { group: "Trade",   id: "dashboard",  label: "Dashboard",            kw: "home overview" },
  // Automate
  { group: "Automate",id: "modes",      label: "Trading modes",        kw: "mis cnc nrml capital allocator" },
  { group: "Automate",id: "strategies", label: "Strategies",           kw: "momentum mean reversion vwap" },
  { group: "Automate",id: "signals",    label: "AI Signals",           kw: "claude gpt promote" },
  { group: "Automate",id: "tuner",      label: "Auto-tuner",           kw: "parameter optimisation grid search" },
  { group: "Automate",id: "alerts",     label: "Alerts builder",       kw: "watch trigger notification" },
  { group: "Automate",id: "options",    label: "Options builder",      kw: "iron condor straddle leg" },
  // Validate
  { group: "Validate",id: "backtest",   label: "Backtest lab",         kw: "walk-forward out-of-sample" },
  { group: "Validate",id: "paper",      label: "Paper trading",        kw: "simulator practice" },
  { group: "Validate",id: "circuits",   label: "Circuit breakers",     kw: "kill rule trip safeguard" },
  // Execute
  { group: "Execute", id: "trading",    label: "Live trading",         kw: "orders positions place" },
  { group: "Execute", id: "audit",      label: "Audit trail",          kw: "log history compliance" },
  { group: "Execute", id: "margin",     label: "Margin calculator",    kw: "span exposure leverage" },
  // Wealth
  { group: "Wealth",  id: "portfolio",  label: "Portfolio",            kw: "holdings positions value" },
  { group: "Wealth",  id: "goals",      label: "Life goals",           kw: "retirement house education" },
  { group: "Wealth",  id: "stpswp",     label: "STP / SWP plans",      kw: "systematic transfer withdrawal" },
  { group: "Wealth",  id: "smallcase",  label: "Smallcases",           kw: "basket curated themed" },
  { group: "Wealth",  id: "fixed",      label: "Fixed income & REITs", kw: "bond debt reit yield" },
  { group: "Wealth",  id: "harvest",    label: "Tax-loss harvest",     kw: "ltcg stcg offset wash sale" },
  { group: "Wealth",  id: "tax",        label: "Tax & ITR",            kw: "itr-3 80c capital gains filing" },
  { group: "Wealth",  id: "brokers",    label: "Brokers",              kw: "zerodha upstox icici routing" },
  // Operations
  { group: "Operations", id: "review",      label: "AI monthly review", kw: "summary insight" },
  { group: "Operations", id: "recon",       label: "Reconciliation",    kw: "match break" },
  { group: "Operations", id: "attribution", label: "PnL attribution",   kw: "breakdown source mode" },
  // System
  { group: "System",  id: "risk",       label: "Risk controls",        kw: "limit drawdown var" },
  { group: "System",  id: "compliance", label: "Compliance",           kw: "sebi algo-id regulator" },
  { group: "System",  id: "settings",   label: "Settings",             kw: "preferences theme account" },
  // Account
  { group: "Account", id: "profile",    label: "Profile",              kw: "user kyc api token plan" },
];

const ACTIONS = [
  { id: "act:kill",    group: "Action", label: "Kill switch — halt all trading",  hint: "Hold to confirm",  kw: "stop emergency panic" },
  { id: "act:pause",   group: "Action", label: "Pause all modes",                  hint: "Stops new orders", kw: "freeze halt" },
  { id: "act:theme",   group: "Action", label: "Toggle theme (light / dark)",      hint: "⌘⇧L",              kw: "dark light" },
  { id: "act:logout",  group: "Action", label: "Sign out",                         hint: "",                 kw: "logout sign out exit" },
];

const CommandPalette = ({ open, onClose, onNavigate, onAction }) => {
  const [q, setQ] = React.useState("");
  const [idx, setIdx] = React.useState(0);
  const inputRef = React.useRef(null);
  const listRef = React.useRef(null);

  React.useEffect(() => {
    if (open) {
      setQ("");
      setIdx(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const items = React.useMemo(() => {
    const all = [...ROUTES, ...ACTIONS];
    if (!q.trim()) return all;
    const term = q.toLowerCase();
    return all.filter(x =>
      x.label.toLowerCase().includes(term) ||
      x.group.toLowerCase().includes(term) ||
      (x.kw && x.kw.toLowerCase().includes(term))
    );
  }, [q]);

  React.useEffect(() => { setIdx(0); }, [q]);

  // Scroll selected item into view
  React.useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector(`[data-cmd-idx="${idx}"]`);
    if (el && el.scrollIntoViewIfNeeded) el.scrollIntoViewIfNeeded();
    else if (el) {
      const r = el.getBoundingClientRect();
      const pr = listRef.current.getBoundingClientRect();
      if (r.bottom > pr.bottom) listRef.current.scrollTop += r.bottom - pr.bottom + 4;
      if (r.top < pr.top) listRef.current.scrollTop -= pr.top - r.top + 4;
    }
  }, [idx]);

  const onKeyDown = (e) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setIdx(i => Math.min(items.length - 1, i + 1)); return; }
    if (e.key === "ArrowUp")   { e.preventDefault(); setIdx(i => Math.max(0, i - 1)); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      const it = items[idx];
      if (!it) return;
      if (it.id.startsWith("act:")) onAction(it.id);
      else onNavigate(it.id);
      onClose();
    }
  };

  if (!open) return null;

  // Group items for display
  const groups = {};
  items.forEach((it, i) => {
    if (!groups[it.group]) groups[it.group] = [];
    groups[it.group].push({ ...it, _idx: i });
  });

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(15,17,21,0.55)",
        zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center",
        paddingTop: "12vh", backdropFilter: "blur(2px)",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: "min(640px, 92vw)", maxHeight: "70vh", display: "flex", flexDirection: "column",
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: 12, overflow: "hidden",
          boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
          <I.search size={16} style={{ color: "var(--text-3)" }}/>
          <input
            ref={inputRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search pages, actions, symbols…"
            style={{ flex: 1, background: "transparent", border: 0, outline: 0, fontSize: 15, color: "var(--text-1)" }}
          />
          <span className="mono" style={{ fontSize: 10, color: "var(--text-3)", padding: "2px 6px", border: "1px solid var(--border)", borderRadius: 4 }}>ESC</span>
        </div>

        <div ref={listRef} style={{ overflowY: "auto", padding: "6px 0" }}>
          {items.length === 0 && (
            <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
              No matches for "{q}"
            </div>
          )}
          {Object.entries(groups).map(([gname, gitems]) => (
            <div key={gname}>
              <div style={{
                fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em",
                color: "var(--text-3)", padding: "8px 16px 4px",
              }}>{gname}</div>
              {gitems.map(it => {
                const active = it._idx === idx;
                return (
                  <div
                    key={it.id}
                    data-cmd-idx={it._idx}
                    onMouseMove={() => setIdx(it._idx)}
                    onClick={() => {
                      if (it.id.startsWith("act:")) onAction(it.id);
                      else onNavigate(it.id);
                      onClose();
                    }}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "8px 16px", cursor: "pointer",
                      background: active ? "var(--surface-2)" : "transparent",
                      borderLeft: "2px solid " + (active ? "var(--accent)" : "transparent"),
                    }}
                  >
                    <span style={{ fontSize: 13, color: "var(--text-1)", flex: 1 }}>{it.label}</span>
                    {it.hint && <span className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>{it.hint}</span>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 16px", borderTop: "1px solid var(--border)", fontSize: 11, color: "var(--text-3)" }}>
          <div style={{ display: "flex", gap: 12 }}>
            <span><span className="mono" style={{ padding: "1px 5px", border: "1px solid var(--border)", borderRadius: 3 }}>↑↓</span> navigate</span>
            <span><span className="mono" style={{ padding: "1px 5px", border: "1px solid var(--border)", borderRadius: 3 }}>↵</span> open</span>
          </div>
          <span>{items.length} results</span>
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { CommandPalette });
