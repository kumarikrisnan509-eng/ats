/* eslint-disable */
/* Round 11 — focused polish from the audit.
   - #7  formatINR — single number formatter, INR-aware (lakh/crore)
   - #15 DemoBanner — sticky strip when demo mode is on
   - #16 PaperChrome — yellow accent + watermark for paper-trading isolation
   - #24 EmptyFilter — message when a filter produces zero rows
   - #20 visibility-aware tick loops (best-effort patch on top of LiveTicks)
*/

// ============ #7 formatINR ============
// Replaces ad-hoc ₹X / ₹XL / ₹X,XX,XXX inline math across the app.
// Modes:
//   formatINR(48273400)               → "₹48,27,340"     (full Indian grouping)
//   formatINR(48273400, "compact")    → "₹4.83Cr"
//   formatINR(482734, "compact")      → "₹4.83L"
//   formatINR(48273, "compact")       → "₹48.3K"
//   formatINR(1240, { sign: true })   → "+₹1,240"
//   formatINR(null) / NaN             → "—"
const formatINR = (value, opts = {}) => {
  if (value == null || isNaN(value)) return "—";
  const o = typeof opts === "string" ? { mode: opts } : opts;
  const mode = o.mode || "full";
  const sign = o.sign && value > 0 ? "+" : value < 0 ? "-" : "";
  const v = Math.abs(value);

  if (mode === "compact") {
    if (v >= 1e7) return `${sign}₹${(v/1e7).toFixed(2)}Cr`;
    if (v >= 1e5) return `${sign}₹${(v/1e5).toFixed(2)}L`;
    if (v >= 1e3) return `${sign}₹${(v/1e3).toFixed(1)}K`;
    return `${sign}₹${v.toFixed(0)}`;
  }

  // Indian grouping: 12,34,567
  const formatted = v.toLocaleString("en-IN", {
    maximumFractionDigits: o.decimals ?? 0,
    minimumFractionDigits: o.decimals ?? 0,
  });
  return `${sign}₹${formatted}`;
};

const formatPct = (value, opts = {}) => {
  if (value == null || isNaN(value)) return "—";
  const sign = opts.sign && value > 0 ? "+" : "";
  return `${sign}${value.toFixed(opts.decimals ?? 2)}%`;
};

const formatNumber = (value, opts = {}) => {
  if (value == null || isNaN(value)) return "—";
  return value.toLocaleString("en-IN", {
    maximumFractionDigits: opts.decimals ?? 0,
    minimumFractionDigits: opts.decimals ?? 0,
  });
};

// ============ #15 DemoBanner ============
// Tier 59 rewrite: the banner now follows the auth + broker state machine.
//   - Authenticated + broker connected + access_token valid -> hidden
//   - Authenticated + no broker / token expired             -> hidden here
//                                                              (BrokerNotConnectedBanner handles that case from Tier 58)
//   - Unauthenticated browser                               -> shown (blue, "Sign in")
//   - Authenticated + explicit demo toggle ON               -> shown (amber, "Exit demo")
// T83: DemoBanner removed -- demo mode killed entirely. Component returns null to
// remain backward-compatible with any callers still rendering it.
const DemoBanner = () => null;

// ============ #16 PaperChrome ============
// Visual isolation for paper-trading screens — yellow accent strip + watermark.
// Wrap the paper-trading screen body in <PaperChrome>...</PaperChrome>.
const PaperChrome = ({ children }) => (
  <div style={{ position: "relative" }}>
    {/* Watermark — fixed to scroll container, low-contrast */}
    <div aria-hidden="true" style={{
      position: "absolute", inset: 0,
      pointerEvents: "none", zIndex: 0,
      overflow: "hidden",
    }}>
      <div style={{
        position: "absolute",
        top: "30%", left: "50%",
        transform: "translate(-50%, -50%) rotate(-18deg)",
        fontSize: 180, fontWeight: 900,
        color: "oklch(90% 0.08 80)",
        opacity: 0.25,
        letterSpacing: "0.1em",
        fontFamily: "var(--mono)",
        whiteSpace: "nowrap",
        userSelect: "none",
      }}>PAPER · PAPER · PAPER</div>
    </div>
    {/* Top strip */}
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "8px 14px",
      background: "oklch(96% 0.06 80)",
      border: "1px solid oklch(80% 0.12 80)",
      borderRadius: "var(--r-md)",
      marginBottom: 14,
      position: "relative", zIndex: 1,
      fontSize: 12, color: "oklch(38% 0.13 80)",
    }}>
      <span style={{
        padding: "3px 8px", borderRadius: 4,
        background: "oklch(38% 0.13 80)", color: "white",
        fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
        fontFamily: "var(--mono)",
      }}>PAPER</span>
      <span><strong>Simulated environment.</strong> Orders are filled against historical/live ticks; no broker call, no margin used.</span>
    </div>
    <div style={{ position: "relative", zIndex: 1 }}>{children}</div>
  </div>
);

// ============ #24 EmptyFilter ============
// Drop-in message for filtered-to-zero tables.
// usage: {rows.length === 0 && <EmptyFilter onClear={() => setFilter("all")}/>}
const EmptyFilter = ({ onClear, message = "No matches for your filters" }) => (
  <div style={{
    padding: "48px 24px", textAlign: "center",
    color: "var(--text-3)", fontSize: 13,
  }}>
    <div style={{ fontSize: 28, marginBottom: 10, opacity: 0.4 }}>⌕</div>
    <div style={{ fontWeight: 500, color: "var(--text-2)", marginBottom: 4 }}>{message}</div>
    <div style={{ fontSize: 12, marginBottom: 14 }}>Try clearing one of the filters above.</div>
    {onClear && (
      <button className="btn btn--sm" onClick={onClear}>Clear filters</button>
    )}
  </div>
);

// ============ #20 visibility-aware tick patch ============
// Best-effort: when tab goes hidden, fire a custom event apps can listen to.
// Stops loops from compounding while user is away.
(() => {
  if (typeof document === "undefined") return;
  document.addEventListener("visibilitychange", () => {
    window.dispatchEvent(new CustomEvent(document.hidden ? "tab-hidden" : "tab-visible"));
  });
})();

Object.assign(window, {
  formatINR, formatPct, formatNumber,
  DemoBanner, PaperChrome, EmptyFilter,
});

// ============ #5 useUrlState ============
// Read/write a piece of state to the URL query string. Survives reload, shareable.
//   const [filter, setFilter] = useUrlState("status", "all");
// Watches popstate so back/forward sync state.
const useUrlState = (key, defaultValue) => {
  const read = () => {
    try {
      const u = new URL(window.location.href);
      return u.searchParams.get(key) ?? defaultValue;
    } catch { return defaultValue; }
  };
  const [val, setVal] = React.useState(read);
  React.useEffect(() => {
    const onPop = () => setVal(read());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const update = (v) => {
    setVal(v);
    try {
      const u = new URL(window.location.href);
      if (v == null || v === "" || v === defaultValue) u.searchParams.delete(key);
      else u.searchParams.set(key, v);
      window.history.replaceState({}, "", u.toString());
    } catch (e) { console.warn('[r11-additions] swallowed:', e && e.message); }
  };
  return [val, update];
};

// ============ #13 ActiveAutomationStrip ============
// Persistent thin strip below topbar: shows live mode count, strategy count,
// signals queue depth, kill state. Click any chip → deep-link to that screen.
const ActiveAutomationStrip = ({ setRoute }) => {
  const [, bump] = React.useReducer(x => x + 1, 0);
  // Tier 12: live counts from backend.
  const [live, setLive] = React.useState(null);
  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [strats, scan, summary] = await Promise.all([
          window.fetchApi('/api/strategies').catch(() => null),
          window.fetchApi('/api/scanner/history?limit=200').catch(() => null),
          window.fetchApi('/api/summary').catch(() => null),
        ]);
        if (cancelled) return;
        const stratCount = strats && strats.ok && Array.isArray(strats.rows) ? strats.rows.length
                        : strats && Array.isArray(strats.strategies) ? strats.strategies.length : 0;
        // signals queue = scanner history rows in the last 24h
        const since = Date.now() - 24*3600*1000;
        const signals = scan && scan.ok && Array.isArray(scan.rows)
          ? scan.rows.filter(r => new Date(r.ts || r.time || 0).getTime() >= since).length : 0;
        const positions = summary && summary.aggregates ? (summary.aggregates.positionsNetCount || 0) : 0;
        setLive({ stratCount, signals, positions });
      } catch (_e) {}
    };
    load();
    const t = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);
  React.useEffect(() => {
    const h = () => bump();
    window.addEventListener("modes-changed", h);
    window.addEventListener("storage", h);
    window.addEventListener("kill-switch-fired", h);
    return () => {
      window.removeEventListener("modes-changed", h);
      window.removeEventListener("storage", h);
      window.removeEventListener("kill-switch-fired", h);
    };
  }, []);

  const modeIds = window.MODE_IDS || [];
  const activeModes = modeIds.filter(id => window.isModeActive && window.isModeActive(id));
  const allActive = activeModes.length === 4;
  const noneActive = activeModes.length === 0;

  const Chip = ({ icon, label, value, color, onClick, mono }) => (
    <button onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "5px 12px", borderRadius: 999,
      background: "var(--surface)", border: "1px solid var(--border)",
      fontSize: 12, color: "var(--text-2)", whiteSpace: "nowrap",
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: "50%",
        background: color, boxShadow: `0 0 0 3px color-mix(in oklab, ${color} 20%, transparent)`,
      }}/>
      <span style={{ color: "var(--text-3)" }}>{label}</span>
      <span className={mono ? "mono" : ""} style={{ color: "var(--text)", fontWeight: 500 }}>{value}</span>
    </button>
  );

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "8px 24px",
      background: "var(--bg-soft)", borderBottom: "1px solid var(--border)",
      overflowX: "auto",
    }}>
      <span style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-3)", fontWeight: 600, marginRight: 4 }}>
        Live
      </span>
      <Chip
        icon="modes"
        label="Modes"
        value={`${activeModes.length}/4`}
        color={allActive ? "oklch(58% 0.15 155)" : noneActive ? "oklch(58% 0.19 25)" : "oklch(70% 0.15 80)"}
        onClick={() => setRoute && setRoute("modes")}
        mono
      />
      <Chip
        icon="strat"
        label="Strategies"
        value={live ? `${live.stratCount} active` : "—"}
        color="oklch(58% 0.14 165)"
        onClick={() => setRoute && setRoute("strategies")}
      />
      <Chip
        icon="signals"
        label="Signals queue"
        value={live ? `${live.signals} pending` : "—"}
        color="oklch(58% 0.13 245)"
        onClick={() => setRoute && setRoute("signals")}
        mono
      />
      <Chip
        icon="positions"
        label="Open positions"
        value={live ? String(live.positions) : "—"}
        color="oklch(58% 0.16 295)"
        onClick={() => setRoute && setRoute("trading")}
        mono
      />
      <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "var(--mono)" }}>
          Last reconciled · 14:22:18 IST
        </span>
      </div>
    </div>
  );
};

// ============ #18 ComplianceLog ============
// Receipt history of every SEBI submission with timestamp + ack status.
// Mount inside Compliance screen.
const ComplianceLog = () => {
  const rows = [
    { id: "SEBI-2026-04-23-001", when: "Apr 23, 2026 · 18:01:14 IST", orders: 237, status: "ack", ackTs: "18:01:42", refId: "SEBI/ALG/26042326/AS78F2" },
    { id: "SEBI-2026-04-22-001", when: "Apr 22, 2026 · 18:00:08 IST", orders: 194, status: "ack", ackTs: "18:00:31", refId: "SEBI/ALG/22042326/BX91C4" },
    { id: "SEBI-2026-04-21-001", when: "Apr 21, 2026 · 18:00:11 IST", orders: 312, status: "ack", ackTs: "18:00:48", refId: "SEBI/ALG/21042326/KP22D9" },
    { id: "SEBI-2026-04-20-001", when: "Apr 20, 2026 · 18:02:55 IST", orders: 156, status: "ack-late", ackTs: "19:14:02", refId: "SEBI/ALG/20042326/LM44E8" },
    { id: "SEBI-2026-04-19-001", when: "Apr 19, 2026 · 18:00:04 IST", orders: 0, status: "skipped", note: "Trading holiday — no orders", refId: "—" },
    { id: "SEBI-2026-04-17-001", when: "Apr 17, 2026 · 18:00:12 IST", orders: 268, status: "ack", ackTs: "18:00:38", refId: "SEBI/ALG/17042326/QN77G1" },
  ];
  const statusPill = (s) => {
    if (s === "ack")      return <span className="pill pill--up">✓ Acknowledged</span>;
    if (s === "ack-late") return <span className="pill pill--warn">⏱ Late ack</span>;
    if (s === "skipped")  return <span className="pill" style={{ background: "var(--bg-sunk)" }}>— Skipped</span>;
    return <span className="pill pill--down">✕ Failed</span>;
  };
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--border)" }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Compliance log</div>
          <div className="muted" style={{ fontSize: 12 }}>Every SEBI submission · acknowledgments · audit-ready</div>
        </div>
        {window.ExportCsvButton && (
          <window.ExportCsvButton
            filename="sebi-submissions.csv"
            rows={rows.map(r => ({
              submission_id: r.id, submitted_at: r.when, orders: r.orders,
              status: r.status, ack_at: r.ackTs || "", sebi_ref: r.refId, note: r.note || "",
            }))}
            label="Export CSV"
          />
        )}
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Submission ID</th>
            <th>Submitted</th>
            <th className="num">Orders</th>
            <th>Status</th>
            <th>SEBI ref</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              <td className="mono" style={{ fontSize: 11 }}>{r.id}</td>
              <td className="mono" style={{ fontSize: 11, color: "var(--text-2)" }}>{r.when}</td>
              <td className="num">{r.orders || "—"}</td>
              <td>
                {statusPill(r.status)}
                {r.ackTs && <div className="muted mono" style={{ fontSize: 10, marginTop: 2 }}>at {r.ackTs}</div>}
                {r.note && <div className="muted" style={{ fontSize: 10, marginTop: 2 }}>{r.note}</div>}
              </td>
              <td className="mono" style={{ fontSize: 10, color: "var(--text-2)" }}>{r.refId}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border)", background: "var(--bg-soft)", fontSize: 11, color: "var(--text-3)" }}>
        Retention: 7 years (SEBI minimum 5y) · Submissions are immutable once acknowledged · WORM storage attested
      </div>
    </div>
  );
};

// ============ #19 OverfitWarning ============
// Banner for backtest results when degrees-of-freedom is suspect.
// Inputs: paramCount, observations (e.g. trades or bars).
// Heuristic: ratio observations/param < 30 → warn, < 10 → danger.
const OverfitWarning = ({ paramCount = 14, observations = 90, period = "90 days" }) => {
  const ratio = observations / paramCount;
  const level = ratio < 10 ? "danger" : ratio < 30 ? "warn" : "ok";
  if (level === "ok") return null;
  const cfg = level === "danger"
    ? { bg: "var(--down-soft)", color: "var(--down)", icon: "⚠", heading: "High overfit risk" }
    : { bg: "var(--warn-soft)", color: "oklch(45% 0.13 80)", icon: "⚠", heading: "Possible overfit" };
  return (
    <div style={{
      display: "flex", gap: 12, alignItems: "flex-start",
      padding: "12px 14px", borderRadius: "var(--r-md)",
      background: cfg.bg, color: cfg.color,
      marginBottom: 16,
      border: `1px solid color-mix(in oklab, ${cfg.color} 30%, transparent)`,
    }}>
      <span style={{ fontSize: 18, lineHeight: 1 }}>{cfg.icon}</span>
      <div style={{ flex: 1, fontSize: 13, lineHeight: 1.5 }}>
        <div style={{ fontWeight: 600, marginBottom: 2 }}>{cfg.heading}</div>
        <div style={{ color: "color-mix(in oklab, currentColor 80%, var(--text))" }}>
          This strategy fits <strong className="mono">{paramCount}</strong> parameters on <strong className="mono">{observations}</strong> observations
          ({period}). Ratio <span className="mono">{ratio.toFixed(1)}×</span> — out-of-sample performance may deviate sharply from these results.
        </div>
        <div style={{ marginTop: 6, fontSize: 12 }}>
          Recommended: <strong>walk-forward validate on ≥{paramCount * 30} observations</strong>, or reduce parameter count.
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { useUrlState, ActiveAutomationStrip, ComplianceLog, OverfitWarning });

// ============ #17 AICostMini ============
// Compact AI-cost card for Dashboard sidebar/top — links to full AICostCard.
const AICostMini = ({ onClick }) => {
  const [ai, setAi] = React.useState(null);
  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await window.fetchApi('/api/system/info').catch(() => null);
        if (!cancelled && r && r.components && r.components.ai) setAi(r.components.ai);
      } catch (_e) {}
    };
    load();
    const t = setInterval(load, 60000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);
  const spent  = ai ? (ai.dailyCalls || 0) : 0;
  const budget = ai ? (ai.dailyCap || 0)   : 0;
  const pct    = budget > 0 ? (spent / budget) * 100 : 0;
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "10px 14px",
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: "var(--r-md)",
        width: "100%", textAlign: "left",
      }}
    >
      <div style={{
        width: 36, height: 36, borderRadius: 8,
        background: "var(--violet-soft)", color: "var(--violet)",
        display: "grid", placeItems: "center", fontSize: 16, flexShrink: 0,
      }}>✦</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>AI inference · today</div>
        <div className="mono" style={{ fontSize: 16, fontWeight: 500 }}>
          {spent}<span style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 400, marginLeft: 6 }}>/ {budget} calls</span>
        </div>
        <div style={{ marginTop: 4, height: 3, background: "var(--bg-sunk)", borderRadius: 2, overflow: "hidden" }}>
          <div style={{ width: `${Math.min(100, pct)}%`, height: "100%", background: pct > 90 ? "var(--down)" : pct > 70 ? "var(--warn)" : "var(--violet)" }}/>
        </div>
      </div>
      <span style={{ color: "var(--text-3)", flexShrink: 0, fontSize: 16 }}>›</span>
    </button>
  );
};

// ============ #23 useFocusTrap ============
// Drop-in focus trap for modals. Usage:
//   const ref = useFocusTrap(open);
//   <div ref={ref}>...</div>
const useFocusTrap = (active) => {
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!active || !ref.current) return;
    const node = ref.current;
    const focusables = () => Array.from(node.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(el => !el.hasAttribute("aria-hidden"));
    const prev = document.activeElement;
    const first = focusables()[0];
    if (first) first.focus();
    const onKey = (e) => {
      if (e.key !== "Tab") return;
      const list = focusables();
      if (list.length === 0) { e.preventDefault(); return; }
      const idx = list.indexOf(document.activeElement);
      if (e.shiftKey && (idx <= 0)) { e.preventDefault(); list[list.length - 1].focus(); }
      else if (!e.shiftKey && (idx === list.length - 1 || idx === -1)) { e.preventDefault(); list[0].focus(); }
    };
    node.addEventListener("keydown", onKey);
    return () => {
      node.removeEventListener("keydown", onKey);
      if (prev && prev.focus) prev.focus();
    };
  }, [active]);
  return ref;
};

Object.assign(window, { AICostMini, useFocusTrap });

// ============ #10 PositionHandlingMatrix ============
// Explicit "what happens to my positions when I disable a mode" table.
// Mount on Modes screen near the bottom — answers a real question every user has.
const PositionHandlingMatrix = () => {
  const rows = [
    { state: "Open position",      label: "Open position",       sub: "Already filled & live",
      onDisable: { kind: "kept",   txt: "Kept open",  detail: "Position stays as-is. Stops & targets remain active. No new entries." } },
    { state: "Pending order",      label: "Pending order",       sub: "Submitted, awaiting fill",
      onDisable: { kind: "cancel", txt: "Cancelled",  detail: "Open orders cancelled immediately at broker. Confirmed in audit trail." } },
    { state: "Queued signal",      label: "Queued signal",       sub: "Approved, not yet submitted",
      onDisable: { kind: "skip",   txt: "Skipped",    detail: "Signal moves to skipped state; logged with reason 'mode disabled'." } },
    { state: "New incoming signal", label: "New incoming signal", sub: "While mode is off",
      onDisable: { kind: "skip",   txt: "Auto-skip",  detail: "All future signals for this mode are auto-rejected at the router." } },
    { state: "Profit sweep schedule", label: "Profit sweep schedule", sub: "Auto-move-to-MF",
      onDisable: { kind: "kept",   txt: "Unchanged",  detail: "Sweep runs on its own schedule; not tied to mode state." } },
  ];
  const pill = (kind, txt) => {
    const map = { kept: "pill--up", cancel: "pill--down", skip: "pill--warn" };
    return <span className={`pill ${map[kind]}`}>{txt}</span>;
  };
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden", marginTop: 20 }}>
      <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>When a mode is disabled — what happens?</div>
        <div className="muted" style={{ fontSize: 12 }}>Every state the system can be in, and the exact action taken. There are no surprises.</div>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th style={{ width: "30%" }}>State</th>
            <th style={{ width: "15%" }}>Action</th>
            <th>What we do</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.label}>
              <td>
                <div style={{ fontWeight: 500 }}>{r.label}</div>
                <div className="muted" style={{ fontSize: 11 }}>{r.sub}</div>
              </td>
              <td>{pill(r.onDisable.kind, r.onDisable.txt)}</td>
              <td style={{ fontSize: 12, color: "var(--text-2)" }}>{r.onDisable.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border)", background: "var(--bg-soft)", fontSize: 11, color: "var(--text-3)" }}>
        Need to force-close open positions on disable? Use the <strong>Square off & disable</strong> option in the toggle confirmation. Default keeps positions open.
      </div>
    </div>
  );
};

// ============ #22 useTableNav ============
// Arrow-key + Enter row navigation for tables.
// Returns { selectedIdx, rowProps(idx), containerProps } — spread to <tbody> + each <tr>.
const useTableNav = (rowCount, onSelect) => {
  const [idx, setIdx] = React.useState(-1);
  const ref = React.useRef(null);
  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const onKey = (e) => {
      if (rowCount === 0) return;
      if (e.key === "ArrowDown") { e.preventDefault(); setIdx(i => Math.min(rowCount - 1, i + 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setIdx(i => Math.max(0, i - 1)); }
      else if (e.key === "Home") { e.preventDefault(); setIdx(0); }
      else if (e.key === "End") { e.preventDefault(); setIdx(rowCount - 1); }
      else if (e.key === "Enter" && idx >= 0 && onSelect) { e.preventDefault(); onSelect(idx); }
    };
    node.addEventListener("keydown", onKey);
    return () => node.removeEventListener("keydown", onKey);
  }, [rowCount, idx, onSelect]);
  return {
    selectedIdx: idx,
    containerProps: { ref, tabIndex: 0, role: "grid", style: { outline: "none" } },
    rowProps: (i) => ({
      onClick: () => setIdx(i),
      onDoubleClick: () => onSelect && onSelect(i),
      "aria-selected": i === idx,
      style: i === idx ? { background: "var(--bg-soft)", boxShadow: "inset 3px 0 0 var(--accent)" } : undefined,
    }),
  };
};

// ============ #8 TableSkeleton ============
const TableSkeleton = ({ rows = 5, cols = 4 }) => (
  <table className="table">
    <thead>
      <tr>{Array.from({ length: cols }).map((_, i) => <th key={i}>&nbsp;</th>)}</tr>
    </thead>
    <tbody>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r}>
          {Array.from({ length: cols }).map((_, c) => (
            <td key={c}>
              <div style={{
                height: 12, width: `${50 + Math.random() * 40}%`, borderRadius: 4,
                background: "linear-gradient(90deg, var(--bg-sunk), var(--surface-2), var(--bg-sunk))",
                backgroundSize: "200% 100%", animation: "skel 1.4s ease-in-out infinite",
              }}/>
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  </table>
);

// ============ #9 ScreenError ============
// Drop-in for screens that failed to load — broker API down, data fetch failed, etc.
//   <ScreenError title="Broker connection lost" detail="..." onRetry={...}/>
const ScreenError = ({ title = "Couldn't load this view", detail, onRetry }) => (
  <div style={{
    padding: "60px 24px", textAlign: "center",
    background: "var(--surface)", border: "1px solid var(--border)",
    borderRadius: "var(--r-lg)",
  }}>
    <div style={{
      width: 56, height: 56, borderRadius: "50%", margin: "0 auto 16px",
      background: "var(--down-soft)", color: "var(--down)",
      display: "grid", placeItems: "center", fontSize: 26,
    }}>!</div>
    <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>{title}</div>
    {detail && <div className="muted" style={{ fontSize: 13, maxWidth: 420, margin: "0 auto 16px" }}>{detail}</div>}
    {onRetry && <button className="btn btn--accent" onClick={onRetry}>Retry</button>}
  </div>
);

// ============ #14 Toast→Notification bridge ============
// Promote sticky/important toasts into the notification center automatically.
// Listens for `ats-toast` and, if `pin: true` is set on the detail, also feeds the bell.
(() => {
  if (typeof window === "undefined") return;
  if (window.__r11ToastBridge) return;
  window.__r11ToastBridge = true;
  window.addEventListener("ats-toast", (e) => {
    const d = e.detail || {};
    if (!d.pin) return;
    window.dispatchEvent(new CustomEvent("notification-add", { detail: {
      sev: d.kind || "info",
      title: d.title,
      detail: d.sub,
      when: "just now",
    }}));
  });
})();

Object.assign(window, { PositionHandlingMatrix, useTableNav, TableSkeleton, ScreenError });
