/* eslint-disable */
/* Shared UI primitives and icons */

const { useState, useEffect, useMemo, useRef, useCallback } = React;

// ============ Icons (inline SVG, Lucide-style, stroke 1.75) ============
const Icon = ({ d, size = 16, children, ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...rest}>
    {children || <path d={d} />}
  </svg>
);

const I = {
  dashboard: (p) => <Icon {...p}><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></Icon>,
  signal:    (p) => <Icon {...p}><path d="M2 12h3l3-8 4 16 3-10 3 4h4"/></Icon>,
  strategy:  (p) => <Icon {...p}><circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/><path d="M8 6h8M6 8v8M18 8v8M8 18h8"/></Icon>,
  trade:     (p) => <Icon {...p}><path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/></Icon>,
  portfolio: (p) => <Icon {...p}><path d="M3 7h18v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></Icon>,
  broker:    (p) => <Icon {...p}><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></Icon>,
  risk:      (p) => <Icon {...p}><path d="M12 3l9 5v6c0 5-4 8-9 8s-9-3-9-8V8l9-5z"/><path d="M12 9v4M12 17h.01"/></Icon>,
  infra:     (p) => <Icon {...p}><rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/><path d="M7 7h.01M7 17h.01"/></Icon>,
  settings:  (p) => <Icon {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1A2 2 0 1 1 4.3 17l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1A2 2 0 1 1 7 4.3l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1A2 2 0 1 1 19.7 7l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></Icon>,
  search:    (p) => <Icon {...p}><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></Icon>,
  bell:      (p) => <Icon {...p}><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 0 0 4 0"/></Icon>,
  sun:       (p) => <Icon {...p}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></Icon>,
  moon:      (p) => <Icon {...p}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></Icon>,
  play:      (p) => <Icon {...p}><polygon points="6,4 20,12 6,20"/></Icon>,
  pause:     (p) => <Icon {...p}><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></Icon>,
  stop:      (p) => <Icon {...p}><rect x="5" y="5" width="14" height="14" rx="2"/></Icon>,
  arrowUp:   (p) => <Icon {...p}><path d="M12 19V5M5 12l7-7 7 7"/></Icon>,
  arrowDn:   (p) => <Icon {...p}><path d="M12 5v14M5 12l7 7 7-7"/></Icon>,
  trendUp:   (p) => <Icon {...p}><path d="m3 17 6-6 4 4 8-8"/><path d="M14 7h7v7"/></Icon>,
  trendDn:   (p) => <Icon {...p}><path d="m3 7 6 6 4-4 8 8"/><path d="M14 17h7v-7"/></Icon>,
  plus:      (p) => <Icon {...p}><path d="M12 5v14M5 12h14"/></Icon>,
  check:     (p) => <Icon {...p}><path d="M20 6 9 17l-5-5"/></Icon>,
  x:         (p) => <Icon {...p}><path d="M18 6 6 18M6 6l12 12"/></Icon>,
  clock:     (p) => <Icon {...p}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></Icon>,
  bolt:      (p) => <Icon {...p}><path d="M13 2 3 14h8l-1 8 10-12h-8l1-8z"/></Icon>,
  brain:     (p) => <Icon {...p}><path d="M9.5 2A2.5 2.5 0 0 0 7 4.5v.5a2.5 2.5 0 0 0-2 4A2.5 2.5 0 0 0 5 14a2.5 2.5 0 0 0 2 4v1.5A2.5 2.5 0 0 0 9.5 22a2.5 2.5 0 0 0 2.5-2.5V4.5A2.5 2.5 0 0 0 9.5 2Z"/><path d="M14.5 2A2.5 2.5 0 0 1 17 4.5v.5a2.5 2.5 0 0 1 2 4 2.5 2.5 0 0 1 0 5 2.5 2.5 0 0 1-2 4v1.5a2.5 2.5 0 0 1-2.5 2.5 2.5 2.5 0 0 1-2.5-2.5V4.5A2.5 2.5 0 0 1 14.5 2Z"/></Icon>,
  cpu:       (p) => <Icon {...p}><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2"/></Icon>,
  server:    (p) => <Icon {...p}><rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/><path d="M7 8h.01M7 18h.01"/></Icon>,
  shield:    (p) => <Icon {...p}><path d="M12 3l9 5v6c0 5-4 8-9 8s-9-3-9-8V8l9-5z"/></Icon>,
  user:      (p) => <Icon {...p}><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/></Icon>,
  sparkle:   (p) => <Icon {...p}><path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/></Icon>,
  info:      (p) => <Icon {...p}><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/></Icon>,
  link:      (p) => <Icon {...p}><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></Icon>,
  calc:      (p) => <Icon {...p}><rect x="4" y="3" width="16" height="18" rx="2"/><rect x="7" y="6" width="10" height="3"/><path d="M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01M16 17h.01"/></Icon>,
  target:    (p) => <Icon {...p}><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/></Icon>,
  options:   (p) => <Icon {...p}><path d="M3 17l4-4 3 3 5-7 6 8"/><path d="M3 21h18"/><circle cx="7" cy="13" r="1.2"/><circle cx="10" cy="16" r="1.2"/></Icon>,
  command:   (p) => <Icon {...p}><path d="M6 9V6.5a2.5 2.5 0 1 1 2.5 2.5H6zm0 6v2.5a2.5 2.5 0 1 0 2.5-2.5H6zm9 0h2.5a2.5 2.5 0 1 1-2.5 2.5V15zm0-6V6.5a2.5 2.5 0 1 0 2.5 2.5H15zM6 9h12v6H6z"/></Icon>,
  refresh:   (p) => <Icon {...p}><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></Icon>,
  download:  (p) => <Icon {...p}><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></Icon>,
  more:      (p) => <Icon {...p}><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></Icon>,
  filter:    (p) => <Icon {...p}><path d="M3 5h18l-7 9v6l-4-2v-4L3 5z"/></Icon>,
  up:        (p) => <Icon {...p}><path d="M6 15l6-6 6 6"/></Icon>,
  dn:        (p) => <Icon {...p}><path d="M6 9l6 6 6-6"/></Icon>,
  globe:     (p) => <Icon {...p}><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></Icon>,
  code:      (p) => <Icon {...p}><path d="m8 6-6 6 6 6M16 6l6 6-6 6"/></Icon>,
  flame:     (p) => <Icon {...p}><path d="M8.5 14a3.5 3.5 0 0 0 7 0c0-1.7-1.5-3-3.5-5C9 7 8 5.5 8 4c-2 2-4 4-4 7a7 7 0 0 0 11 5.5"/></Icon>,
  pipeline:  (p) => <Icon {...p}><path d="M5 8h4M15 8h4M5 16h4M15 16h4M9 8h6M9 16h6M12 8v8"/></Icon>,
  layers:    (p) => <Icon {...p}><path d="m12 2 10 6-10 6L2 8z"/><path d="m2 17 10 6 10-6"/><path d="m2 12 10 6 10-6"/></Icon>,
  chart:     (p) => <Icon {...p}><path d="M3 3v18h18"/><path d="M7 15l3-3 4 4 6-7"/></Icon>,
  trend:     (p) => <Icon {...p}><path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/></Icon>,
  // ── distinct icons added to resolve sidebar collisions ──
  gauge:     (p) => <Icon {...p}><path d="M12 14l4-4"/><path d="M3.5 18a9 9 0 1 1 17 0"/><circle cx="12" cy="14" r="1.5"/></Icon>,
  coin:      (p) => <Icon {...p}><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></Icon>,
  leaf:      (p) => <Icon {...p}><path d="M3 21c0-9 6-15 18-18-1 9-7 15-15 17"/><path d="M3 21c4-8 9-12 14-13"/></Icon>,
  pulse:     (p) => <Icon {...p}><path d="M2 12h4l2-6 4 12 3-9 2 3h5"/></Icon>,
  compass:   (p) => <Icon {...p}><circle cx="12" cy="12" r="9"/><path d="m16 8-3 7-5 1 3-7z"/></Icon>,
  phone:     (p) => <Icon {...p}><rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 19h2"/></Icon>,
  basket:    (p) => <Icon {...p}><path d="M3 9h18l-2 11H5z"/><path d="m7 9 4-6M17 9l-4-6"/></Icon>,
  scale:     (p) => <Icon {...p}><path d="M12 4v17M5 21h14"/><path d="m5 10 3-6 3 6c0 1.7-1.3 3-3 3s-3-1.3-3-3z"/><path d="m13 10 3-6 3 6c0 1.7-1.3 3-3 3s-3-1.3-3-3z"/></Icon>,
  sync:      (p) => <Icon {...p}><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/><circle cx="12" cy="12" r="2"/></Icon>,
  report:    (p) => <Icon {...p}><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M9 14l2 2 4-4"/></Icon>,
  breakdown: (p) => <Icon {...p}><path d="M3 21V3"/><rect x="6" y="13" width="3" height="8"/><rect x="11" y="9" width="3" height="12"/><rect x="16" y="5" width="3" height="16"/></Icon>,
  shieldCheck:(p)=> <Icon {...p}><path d="M12 3l9 5v6c0 5-4 8-9 8s-9-3-9-8V8l9-5z"/><path d="m9 12 2 2 4-4"/></Icon>,
};

// ============ Number + date helpers ============
const inr = (n, d = 0) => "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });
// Smart precision: more decimals for small magnitudes, fewer for large
// Examples: ₹847 · ₹4.2k · ₹84.5k · ₹2.84 L · ₹28.4 L · ₹4.83 Cr · ₹48.3 Cr · ₹483 Cr
const inrCompact = (n) => {
  if (n == null || isNaN(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1e9) return sign + "₹" + (abs / 1e7).toFixed(0) + " Cr";       // 100 Cr+ → no decimals
  if (abs >= 1e8) return sign + "₹" + (abs / 1e7).toFixed(1) + " Cr";       // 10–100 Cr → 1 decimal
  if (abs >= 1e7) return sign + "₹" + (abs / 1e7).toFixed(2) + " Cr";       // 1–10 Cr → 2 decimals
  if (abs >= 1e6) return sign + "₹" + (abs / 1e5).toFixed(1) + " L";        // 10 L+ → 1 decimal
  if (abs >= 1e5) return sign + "₹" + (abs / 1e5).toFixed(2) + " L";        // 1–10 L → 2 decimals
  if (abs >= 1e4) return sign + "₹" + (abs / 1e3).toFixed(0) + "k";         // 10k+ → no decimals
  if (abs >= 1e3) return sign + "₹" + (abs / 1e3).toFixed(1) + "k";         // 1–10k → 1 decimal
  return sign + "₹" + abs.toFixed(0);                                        // <1k → exact
};
// Instrument price formatter — full Indian comma grouping (1,23,456.50)
const inrPrice = (n, d = 2) => "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });
const pct = (n, d = 2) => (n >= 0 ? "+" : "") + n.toFixed(d) + "%";
const clsPN = (n) => (n > 0 ? "up" : n < 0 ? "down" : "muted");

// ============ Atoms ============
const Card = ({ title, sub, right, children, flush, className = "", ...rest }) => (
  <div className={"card" + (flush ? " card--flush" : "") + " " + className} {...rest}>
    {(title || right) && (
      <div className="card__head" style={flush ? { padding: "16px 20px 0" } : null}>
        <div>
          {title && <div className="card__title">{title}</div>}
          {sub && <div className="card__sub">{sub}</div>}
        </div>
        {right && <div>{right}</div>}
      </div>
    )}
    {children}
  </div>
);

const Stat = ({ label, value, delta, deltaKind = "up", sub, mono = true }) => (
  <div className="stat">
    <div className="stat__label">{label}</div>
    <div className={"stat__value" + (mono ? "" : " stat__value--sm")}>{value}</div>
    {delta != null && (
      <div className={"stat__delta " + deltaKind}>
        {deltaKind === "up" ? <I.arrowUp size={12}/> : deltaKind === "down" ? <I.arrowDn size={12}/> : null}
        {delta}
        {sub && <span className="muted" style={{ marginLeft: 6 }}>{sub}</span>}
      </div>
    )}
  </div>
);

const Pill = ({ kind = "", children, dot }) => (
  <span className={"pill " + (kind ? "pill--" + kind : "")}>
    {dot && <span className="pill__dot" />}{children}
  </span>
);

// Chip — used across many screens; alias of Pill with `variant` prop instead of `kind`
const Chip = ({ variant = "", children, dot }) => (
  <span className={"pill " + (variant ? "pill--" + variant : "")}>
    {dot && <span className="pill__dot" />}{children}
  </span>
);

const Toggle = ({ on, onClick }) => (
  <button className={"toggle" + (on ? " toggle--on" : "")} onClick={onClick} aria-pressed={on}/>
);

const Segmented = ({ options, value, onChange }) => (
  <div className="segmented">
    {options.map(o => (
      <button key={o.value ?? o} className={value === (o.value ?? o) ? "on" : ""} onClick={() => onChange(o.value ?? o)}>
        {o.label ?? o}
      </button>
    ))}
  </div>
);

// ============ EmptyState — used wherever a list/table/chart has no data ============
// Three sizes: "sm" (inline in a card body), "md" (default, full card), "lg" (page-level).
// Always pairs an icon glyph with a title + one-line subtitle + optional CTA.
// Renders an iconographic visual (not a stock illustration) so it stays on-brand.
const EmptyState = ({
  icon,                 // I.* icon component, or "string" glyph
  title,
  sub,
  size = "md",
  action,               // { label, onClick, primary?: bool }
  secondary,            // { label, onClick }
  tone = "neutral",     // neutral | accent | info | up | down | warn | violet
}) => {
  const toneMap = {
    neutral: { bg: "var(--bg-sunk)",     fg: "var(--text-3)",     ring: "var(--border-strong)" },
    accent:  { bg: "var(--accent-soft)", fg: "var(--accent-ink)", ring: "var(--accent)" },
    info:    { bg: "var(--info-soft)",   fg: "var(--info)",       ring: "var(--info)" },
    up:      { bg: "var(--up-soft)",     fg: "var(--up)",         ring: "var(--up)" },
    down:    { bg: "var(--down-soft)",   fg: "var(--down)",       ring: "var(--down)" },
    warn:    { bg: "var(--warn-soft)",   fg: "oklch(45% 0.13 80)",ring: "var(--warn)" },
    violet:  { bg: "var(--violet-soft)", fg: "var(--violet)",     ring: "var(--violet)" },
  };
  const t = toneMap[tone] || toneMap.neutral;

  const dims = {
    sm: { pad: "22px 16px",  iconBox: 36, titleSize: 13, subSize: 11, maxW: 320, gap: 10 },
    md: { pad: "44px 24px",  iconBox: 56, titleSize: 16, subSize: 13, maxW: 420, gap: 14 },
    lg: { pad: "72px 32px",  iconBox: 72, titleSize: 20, subSize: 14, maxW: 520, gap: 16 },
  }[size] || { pad: "44px 24px",  iconBox: 56, titleSize: 16, subSize: 13, maxW: 420, gap: 14 };

  const IconNode = typeof icon === "function"
    ? React.createElement(icon, { size: Math.round(dims.iconBox * 0.45) })
    : typeof icon === "string"
      ? <span style={{ fontSize: Math.round(dims.iconBox * 0.45), lineHeight: 1 }}>{icon}</span>
      : null;

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      textAlign: "center", padding: dims.pad, gap: dims.gap,
      color: "var(--text-2)",
    }}>
      {/* Iconographic stack: soft circle + ring + inner icon. Stays on-brand without stock art. */}
      <div style={{
        width: dims.iconBox, height: dims.iconBox, borderRadius: "50%",
        background: t.bg, color: t.fg,
        display: "grid", placeItems: "center",
        boxShadow: `0 0 0 6px color-mix(in oklab, ${t.bg} 60%, transparent), 0 0 0 7px color-mix(in oklab, ${t.ring} 12%, transparent)`,
      }}>
        {IconNode}
      </div>
      <div style={{ maxWidth: dims.maxW, display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ fontSize: dims.titleSize, fontWeight: 600, letterSpacing: "-0.01em", color: "var(--text)" }}>{title}</div>
        {sub && <div style={{ fontSize: dims.subSize, color: "var(--text-3)", lineHeight: 1.5 }}>{sub}</div>}
      </div>
      {(action || secondary) && (
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          {action && (
            <button
              className={"btn " + (action.primary === false ? "" : "btn--primary")}
              onClick={action.onClick}
            >
              {action.icon && React.createElement(action.icon, { size: 12 })}
              {action.label}
            </button>
          )}
          {secondary && (
            <button className="btn btn--ghost" onClick={secondary.onClick}>{secondary.label}</button>
          )}
        </div>
      )}
    </div>
  );
};

// ============ DemoMode — clean-slate flag for screenshots / onboarding / fresh accounts ============
// When ON, screens render EmptyState instead of seeded fake data. Persisted to localStorage so
// it survives reload + propagates across screens via "demo-mode-changed" CustomEvent.
const DEMO_KEY = "ats.demoMode";
const isDemoMode = () => {
  try { return localStorage.getItem(DEMO_KEY) === "1"; } catch { return false; }
};
// T83: demo mode killed. setDemoMode and useDemoMode return stable no-ops
// so any screen that still calls them gets [false, noop] -- always live data.
// Old localStorage key cleared on load so any leftover flag is reset.
try { localStorage.removeItem(DEMO_KEY); } catch (_) {}
const setDemoMode = (_on) => { /* no-op */ };
const useDemoMode = () => [false, () => {}];

const Progress = ({ value, max = 100, kind = "" }) => (
  <div className="progress">
    <div className={"progress__fill" + (kind ? " progress__fill--" + kind : "")}
         style={{ width: Math.min(100, (value / max) * 100) + "%" }}/>
  </div>
);

// Expose
Object.assign(window, { I, Icon, Card, Stat, Pill, Chip, Toggle, Segmented, Progress,
  EmptyState, useDemoMode, isDemoMode, setDemoMode,
  inr, inrCompact, inrPrice, pct, clsPN,
  useState, useEffect, useMemo, useRef, useCallback });
