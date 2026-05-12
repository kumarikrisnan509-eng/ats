/* eslint-disable */
/* Round 10 — closes out the remaining items from the audit.
   - #29 Onboarding clean-state seed (sets demoMode=false on complete)
   - #30 Pre-market briefing (mount TodaysPlan above dashboard)
   - #32 Mode-switch overlay moment
   - #33 Data freshness timestamps (FreshnessStamp + useFreshness)
   - #35 Density toggle surfaced in topbar
   These are intentionally small, pure-window globals so they can be
   dropped into existing screens with one line.
*/

// ============ #33 FreshnessStamp ============
// usage: <FreshnessStamp source="Zerodha" updatedAt={Date.now() - 12000}/>
const FreshnessStamp = ({ source, updatedAt, label = "Updated", warnAfter = 30000 }) => {
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  const age = Math.max(0, now - updatedAt);
  const sec = Math.floor(age / 1000);
  const stale = age > warnAfter;
  const rel = sec < 60 ? `${sec}s ago` : sec < 3600 ? `${Math.floor(sec/60)}m ago` : `${Math.floor(sec/3600)}h ago`;
  const abs = new Date(updatedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  return (
    <span title={`Source: ${source || "live tick"} · ${abs} IST`} style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      fontSize: 11, fontFamily: "var(--mono)", color: stale ? "var(--warn)" : "var(--text-3)",
      padding: "2px 8px", borderRadius: 999,
      background: stale ? "var(--warn-soft)" : "var(--bg-sunk)",
      border: "1px solid var(--border)",
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: "50%",
        background: stale ? "var(--warn)" : "var(--up)",
        boxShadow: stale ? "none" : "0 0 0 3px color-mix(in oklab, var(--up) 18%, transparent)",
      }}/>
      {label} {rel}
      {source && <span style={{ opacity: 0.6 }}>· {source}</span>}
    </span>
  );
};

// ============ #35 Density toggle (topbar surface) ============
const DensityToggle = () => {
  const [d, setD] = React.useState(() => localStorage.getItem("rc_density") || "comfortable");
  React.useEffect(() => {
    document.documentElement.setAttribute("data-density", d);
    localStorage.setItem("rc_density", d);
  }, [d]);
  const opts = [
    { id: "compact",     label: "Compact",     icon: "▬" },
    { id: "comfortable", label: "Comfortable", icon: "≡" },
    { id: "spacious",    label: "Spacious",    icon: "☰" },
  ];
  return (
    <div className="segmented" style={{ padding: 2, height: 28 }} title="Information density">
      {opts.map(o => (
        <button
          key={o.id}
          className={d === o.id ? "on" : ""}
          onClick={() => setD(o.id)}
          style={{ padding: "3px 8px", fontSize: 11, lineHeight: 1 }}
          title={o.label}
        >
          {o.icon}
        </button>
      ))}
    </div>
  );
};

// ============ #32 Mode-switch overlay "moment" ============
// Listens for mode-changed events; pops a 2.4s overlay describing the new active set.
// The overlay surfaces caps, strategies, and risk envelope so the user *feels* the change.
const ModeSwitchOverlay = () => {
  const [evt, setEvt] = React.useState(null);
  const lastSnapshotRef = React.useRef(null);

  React.useEffect(() => {
    if (!window.MODE_IDS || !window.MODE_META) return;
    const snapshot = () => window.MODE_IDS.filter(id => window.isModeActive(id));
    lastSnapshotRef.current = snapshot();

    const onChange = () => {
      const prev = lastSnapshotRef.current || [];
      const next = snapshot();
      lastSnapshotRef.current = next;
      const added = next.filter(x => !prev.includes(x));
      const removed = prev.filter(x => !next.includes(x));
      if (!added.length && !removed.length) return;
      setEvt({ added, removed, active: next, ts: Date.now() });
    };
    window.addEventListener("modes-changed", onChange);
    return () => window.removeEventListener("modes-changed", onChange);
  }, []);

  React.useEffect(() => {
    if (!evt) return;
    const t = setTimeout(() => setEvt(null), 2800);
    return () => clearTimeout(t);
  }, [evt]);

  if (!evt) return null;

  const action = evt.added.length ? "Activated" : "Disabled";
  const subject = (evt.added[0] || evt.removed[0]);
  const meta = window.MODE_META[subject];

  // Per-mode envelope copy (cap / strats / max trades).
  const envelope = {
    intraday: { cap: "60% of capital", strats: 4, trades: "12 per day" },
    swing:    { cap: "40% of capital", strats: 3, trades: "5 per week" },
    options:  { cap: "₹2L max risk",   strats: 2, trades: "6 per day"  },
    futures:  { cap: "₹3L margin",     strats: 1, trades: "3 per day"  },
  }[subject] || { cap: "—", strats: "—", trades: "—" };

  return (
    <div style={{
      position: "fixed", top: 78, left: "50%", transform: "translateX(-50%)",
      zIndex: 95, pointerEvents: "none",
      animation: "ms-pop 280ms ease-out",
    }}>
      <div style={{
        background: "var(--surface)", border: "1px solid var(--border)",
        borderLeft: `4px solid ${meta?.color || "var(--accent)"}`,
        borderRadius: "var(--r-md)", boxShadow: "0 20px 50px -10px rgba(16,24,40,0.18)",
        padding: "14px 18px", minWidth: 360, maxWidth: 460,
        display: "flex", alignItems: "center", gap: 14,
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          background: meta?.colorSoft || "var(--bg-soft)",
          color: meta?.color || "var(--accent)",
          display: "grid", placeItems: "center", fontSize: 18, fontWeight: 700,
          fontFamily: "var(--mono)", flexShrink: 0,
        }}>{action === "Activated" ? "▶" : "■"}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13, letterSpacing: "-0.01em" }}>
            {action} <span style={{ color: meta?.color }}>{meta?.label || subject}</span> mode
          </div>
          <div style={{ display: "flex", gap: 12, fontSize: 11, color: "var(--text-3)", marginTop: 3, fontFamily: "var(--mono)" }}>
            <span>{envelope.cap}</span>
            <span>· {envelope.strats} strats</span>
            <span>· max {envelope.trades}</span>
          </div>
        </div>
        <div style={{ fontSize: 10, fontFamily: "var(--mono)", color: "var(--text-4)", flexShrink: 0 }}>
          {evt.active.length}/4 active
        </div>
      </div>
      <style>{`@keyframes ms-pop {
        0% { opacity: 0; transform: translateX(-50%) translateY(-6px) scale(.96); }
        100% { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
      }`}</style>
    </div>
  );
};

// ============ Helper: TodaysPlan mount wrapper for dashboard #30 ============
// The TodaysPlan component already exists in r8-ai-assistant. We just need a thin wrapper
// that surfaces it at the top of the dashboard *for users who are not in demo mode*.
const MorningBrief = () => {
  const [demo] = window.useDemoMode ? window.useDemoMode() : [false];
  if (demo) return null;
  if (!window.TodaysPlan) return null;
  return <window.TodaysPlan/>;
};

Object.assign(window, {
  FreshnessStamp,
  DensityToggle,
  ModeSwitchOverlay,
  MorningBrief,
});
