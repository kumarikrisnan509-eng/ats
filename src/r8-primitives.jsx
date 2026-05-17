/* eslint-disable */
/* Round 8 — shared primitives: Toasts, ErrorBoundary, Skeleton, Tooltip, NetStatus, BulkActionsBar, AbsTime */

// ============ Toast system ============
// Global event-driven toasts with optional undo. Fire from anywhere:
//   window.toast({ kind:"up", title:"Position closed", sub:"INFY · 60 qty", undo: () => {...} })
// Renders in a fixed bottom-right stack. Toasts auto-dismiss after 5s (or 8s with undo).
const ToastHost = () => {
  const [items, setItems] = React.useState([]);
  React.useEffect(() => {
    let id = 1;
    const on = (e) => {
      const t = e.detail || {};
      const ttl = t.ttl || (t.undo ? 8000 : 5000);
      const item = { id: id++, ...t };
      setItems(prev => [...prev, item]);
      setTimeout(() => setItems(prev => prev.filter(x => x.id !== item.id)), ttl);
    };
    window.addEventListener("ats-toast", on);
    return () => window.removeEventListener("ats-toast", on);
  }, []);
  const dismiss = (id) => setItems(prev => prev.filter(x => x.id !== id));

  const kindStyle = (k) => ({
    up:   { bg: "var(--up-soft)",   fg: "var(--up)",   icon: "✓" },
    down: { bg: "var(--down-soft)", fg: "var(--down)", icon: "✕" },
    warn: { bg: "var(--warn-soft)", fg: "oklch(45% 0.13 80)", icon: "!" },
    info: { bg: "var(--info-soft)", fg: "var(--info)", icon: "i" },
  })[k || "info"];

  return (
    <div style={{
      position: "fixed", right: 20, bottom: 20, zIndex: 200,
      display: "flex", flexDirection: "column", gap: 10, width: 360, pointerEvents: "none",
    }}>
      {items.map(t => {
        const s = kindStyle(t.kind);
        return (
          <div key={t.id} style={{
            background: "var(--surface)", border: "1px solid var(--border)",
            borderLeft: `3px solid ${s.fg}`, borderRadius: "var(--r-md)",
            padding: "12px 14px", boxShadow: "var(--shadow-lg)",
            display: "flex", gap: 12, alignItems: "flex-start",
            pointerEvents: "auto", animation: "toast-in 0.2s ease-out",
          }}>
            <div style={{
              width: 22, height: 22, borderRadius: "50%",
              background: s.bg, color: s.fg, fontWeight: 700, fontSize: 12,
              display: "grid", placeItems: "center", flexShrink: 0, fontFamily: "var(--mono)",
            }}>{s.icon}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{t.title}</div>
              {t.sub && <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{t.sub}</div>}
            </div>
            {t.undo && (
              <button className="btn btn--sm" onClick={() => { t.undo(); dismiss(t.id); }}
                style={{ fontSize: 11, padding: "4px 10px" }}>Undo</button>
            )}
            <button onClick={() => dismiss(t.id)} style={{
              color: "var(--text-4)", fontSize: 16, lineHeight: 1, padding: 0, marginLeft: -4,
            }}>×</button>
          </div>
        );
      })}
      <style>{`@keyframes toast-in { from { transform: translateX(20px); opacity: 0 } to { transform: translateX(0); opacity: 1 } }`}</style>
    </div>
  );
};
const toast = (opts) => window.dispatchEvent(new CustomEvent("ats-toast", { detail: opts || {} }));

// ============ ErrorBoundary ============
class ErrorBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { console.error("ErrorBoundary:", err, info); }
  reset = () => { this.setState({ err: null }); location.hash = "dashboard"; };
  render() {
    if (this.state.err) {
      return (
        <div style={{ padding: 40, maxWidth: 560, margin: "60px auto", textAlign: "center" }}>
          <div style={{
            width: 64, height: 64, margin: "0 auto 18px", borderRadius: "50%",
            background: "var(--down-soft)", color: "var(--down)",
            display: "grid", placeItems: "center", fontSize: 28, fontFamily: "var(--mono)", fontWeight: 700,
          }}>!</div>
          <h2 style={{ fontSize: 20, margin: "0 0 8px", letterSpacing: "-0.01em" }}>Something broke on this screen</h2>
          <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
            The error has been logged. Your positions and orders are unaffected — they live in the backend, not the UI.
          </p>
          <pre style={{
            fontSize: 11, padding: 12, background: "var(--bg-sunk)", borderRadius: 8,
            color: "var(--text-3)", overflow: "auto", textAlign: "left", maxHeight: 160,
            fontFamily: "var(--mono)",
          }}>{String(this.state.err && this.state.err.message || this.state.err)}</pre>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 16 }}>
            <button className="btn" onClick={() => location.reload()}>Reload app</button>
            <button className="btn btn--primary" onClick={this.reset}>Back to dashboard</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ============ Skeleton ============
// Shimmer placeholder. Use as <Skeleton w={120} h={14}/> or <Skeleton.Row cols={5}/>
const Skeleton = ({ w = "100%", h = 12, r = 4, style }) => (
  <div style={{
    width: w, height: h, borderRadius: r,
    background: "linear-gradient(90deg, var(--bg-sunk) 25%, var(--bg-soft) 50%, var(--bg-sunk) 75%)",
    backgroundSize: "200% 100%",
    animation: "sk-shimmer 1.4s ease-in-out infinite",
    ...style,
  }}/>
);
Skeleton.Row = ({ cols = 4 }) => (
  <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 12, padding: "10px 0" }}>
    {Array.from({ length: cols }).map((_, i) => <Skeleton key={i} h={14}/>)}
  </div>
);
Skeleton.Card = ({ lines = 3 }) => (
  <div className="card">
    <Skeleton w={140} h={12} style={{ marginBottom: 14 }}/>
    {Array.from({ length: lines }).map((_, i) => (
      <Skeleton key={i} h={10} w={`${90 - i * 12}%`} style={{ marginBottom: 8 }}/>
    ))}
  </div>
);

// ============ Tooltip ============
// Hover/focus tooltip. Usage: <Tooltip content="explainer">child</Tooltip>
const Tooltip = ({ content, children, side = "top", maxW = 240 }) => {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef();
  const offsets = { top: { bottom: "100%", marginBottom: 6 }, bottom: { top: "100%", marginTop: 6 }, left: { right: "100%", marginRight: 6 }, right: { left: "100%", marginLeft: 6 } }[side];
  return (
    <span ref={ref} style={{ position: "relative", display: "inline-flex" }}
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}>
      {children}
      {open && content && (
        <span style={{
          position: "absolute", ...offsets, left: side === "top" || side === "bottom" ? "50%" : undefined,
          transform: side === "top" || side === "bottom" ? "translateX(-50%)" : undefined,
          background: "var(--text)", color: "var(--bg)",
          fontSize: 11, lineHeight: 1.45, padding: "6px 10px", borderRadius: 6,
          maxWidth: maxW, width: "max-content", whiteSpace: "normal",
          boxShadow: "var(--shadow-lg)", zIndex: 1000, pointerEvents: "none",
          fontWeight: 400,
        }}>{content}</span>
      )}
    </span>
  );
};

// ============ NetworkStatus banner ============
// Renders a sticky top banner ONLY when the browser is offline. T99-T52
// removed the simulated broker-lag panel (Math.random()*30, threshold 80 -
// never triggered, just decorative code). Real broker stall states (token
// expired / ticks frozen) are handled by TickerStallBanner from T-45 which
// reads window.LiveTicks.state().upstream pushed by the backend over /ws.
// Two banners showing different views of broker health would just confuse
// the user. NetworkStatus stays scoped to BROWSER connectivity.
const NetworkStatus = () => {
  const [online, setOnline] = React.useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  React.useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  if (online) return null;
  return (
    <div role="status" aria-live="polite" style={{
      position: "sticky", top: "var(--top-h)", zIndex: 19,
      background: "var(--down)",
      color: "white", padding: "8px 24px",
      display: "flex", alignItems: "center", gap: 12, fontSize: 12, fontWeight: 500,
    }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: "white", animation: "pulse 1.4s infinite" }}/>
      <span>Your browser is offline — data is frozen. New orders disabled until connection restores.</span>
      <button className="btn btn--sm" style={{ marginLeft: "auto", background: "rgba(255,255,255,0.2)", color: "white", border: "1px solid rgba(255,255,255,0.3)" }}
        onClick={() => location.reload()}>Retry</button>
    </div>
  );
};

// ============ BulkActionsBar ============
// Floats above tables when multi-select is active. selection: Set of ids, totalCount: int.
const BulkActionsBar = ({ selection, totalCount, onClear, actions = [] }) => {
  const n = selection.size || selection.length || 0;
  if (!n) return null;
  return (
    <div style={{
      position: "sticky", bottom: 20, zIndex: 30,
      margin: "16px auto 0", maxWidth: 720,
      background: "var(--text)", color: "var(--bg)",
      borderRadius: 999, padding: "10px 14px 10px 18px",
      display: "flex", alignItems: "center", gap: 12,
      boxShadow: "var(--shadow-lg)",
      animation: "bulk-in 0.18s ease-out",
    }}>
      <span style={{ fontSize: 13, fontWeight: 500 }}>{n} selected</span>
      <span style={{ opacity: 0.5, fontSize: 11 }}>of {totalCount}</span>
      <div style={{ flex: 1 }}/>
      {actions.map((a, i) => (
        <button key={i} onClick={a.onClick} style={{
          fontSize: 12, padding: "6px 12px", borderRadius: 999,
          background: a.danger ? "var(--down)" : "rgba(255,255,255,0.12)",
          color: "white", border: "1px solid rgba(255,255,255,0.18)",
        }}>{a.label}</button>
      ))}
      <button onClick={onClear} style={{
        width: 24, height: 24, borderRadius: "50%", color: "var(--bg)",
        background: "rgba(255,255,255,0.1)", fontSize: 14, lineHeight: 1,
      }}>×</button>
      <style>{`@keyframes bulk-in { from { transform: translateY(20px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }`}</style>
    </div>
  );
};

// ============ AbsTime ============
// Shows relative time inline ("2m ago") with absolute on hover via title attr.
// Drop-in for any timestamp.
const AbsTime = ({ value, rel, format = "short" }) => {
  const date = value instanceof Date ? value : (typeof value === "string" ? new Date(value) : null);
  const abs = date ? date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "medium" }) : rel;
  return <span title={abs} style={{ cursor: "help", textDecoration: "underline dotted", textDecorationColor: "var(--text-4)", textUnderlineOffset: 3 }}>{rel}</span>;
};

// Inject shimmer keyframes once
if (typeof document !== "undefined" && !document.getElementById("__r8_anim")) {
  const s = document.createElement("style");
  s.id = "__r8_anim";
  s.textContent = `
    @keyframes sk-shimmer { 0% { background-position: 200% 0 } 100% { background-position: -200% 0 } }
    @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.4 } }
    /* Focus ring polish */
    button:focus-visible, a:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible {
      outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 6px;
    }
    /* Disabled polish */
    button:disabled, .btn:disabled { opacity: 0.55; cursor: not-allowed; }
  `;
  document.head.appendChild(s);
}

Object.assign(window, { ToastHost, toast, ErrorBoundary, Skeleton, Tooltip, NetworkStatus, BulkActionsBar, AbsTime });
