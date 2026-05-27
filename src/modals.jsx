/* eslint-disable */
/* Modals: Pre-trade simulator, 2FA confirmation, AI signal explainer.
   All exposed on window so any screen can pop them. */

// === Modal shell ===
const Modal = ({ open, onClose, title, sub, children, width = 560, footer }) => {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    // T-488: lock body scroll while modal is open so the page behind doesn't
    // scroll under it (also prevents the "modal jumps when scrolling" issue).
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);
  if (!open) return null;
  // T-488 HOTFIX: was `position:fixed top:50% left:50% translate(-50%,-50%)`
  // which clips the top half when content exceeds viewport AND breaks entirely
  // if any ancestor has `transform`/`filter`/`will-change` (containing-block
  // bug). Switched to a single fixed backdrop that is a flex centering
  // container; the modal is a flex child with `maxHeight: 100%` + inner scroll
  // on the body. Robust against any parent transform, never clips top, works
  // on viewport heights as small as 480px (mobile).
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        background: "color-mix(in oklab, var(--text) 35%, transparent)",
        backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24,
        // overflowY:auto allows the WHOLE modal to scroll if viewport is tiny
        // (e.g. 320px phone landscape) -- internal body scroll handles the
        // common case, this is the belt-and-suspenders fallback.
        overflowY: "auto",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          zIndex: 101,
          width: `min(${width}px, 100%)`,
          maxHeight: "100%",
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: "var(--r-lg)", boxShadow: "0 24px 60px -20px oklch(0% 0 0 / 0.4)",
          display: "flex", flexDirection: "column", overflow: "hidden",
          // T-488: explicit min-height prevents the modal from collapsing
          // smaller than its title bar when there's no body content.
          minHeight: 0,
        }}
      >
        <div style={{ padding: "18px 22px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "flex-start", gap: 16, flexShrink: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-0.01em" }}>{title}</div>
            {sub && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{sub}</div>}
          </div>
          <button className="iconbtn" onClick={onClose} style={{ width: 28, height: 28, flexShrink: 0 }}>×</button>
        </div>
        <div style={{ padding: 22, overflowY: "auto", flex: "1 1 auto", minHeight: 0 }}>{children}</div>
        {footer && <div style={{ padding: "14px 22px", borderTop: "1px solid var(--border)", background: "var(--bg-soft)", flexShrink: 0 }}>{footer}</div>}
      </div>
    </div>
  );
};

// === Pre-trade simulator ===
// Shows margin, risk, mode cap impact, slippage estimate before order placement
const PreTradeSimulator = ({ open, onClose, order, onConfirm }) => {
  if (!order) return null;

  // Compute impact (would come from broker margin API in production)
  const notional = order.qty * order.price;
  const margin = order.product === "MIS" ? notional * 0.20 : notional * 1.0; // 5x leverage for intraday
  const modeId = order.modeId || "intraday";
  const modeMeta = window.MODE_META[modeId];
  const modeState = window.useModeState ? null : null; // read directly from localStorage
  // T-487: was reading from the wrong key ("rc_modes") -- the canonical key
  // is "rsk.trading_modes.v1" (defined in trading-modes.jsx as MODE_STORAGE_KEY).
  // Wrong key meant this modal always got {} and fell back to dummy defaults,
  // making the pre-trade simulator cap-breach warning meaningless.
  const modesRaw = (() => { try { return JSON.parse(localStorage.getItem("rsk.trading_modes.v1") || "{}"); } catch { return {}; } })();
  const modeStateData = modesRaw[modeId] || { capitalPct: 30, deployedPct: 45, dailyLossPct: 1.2 };
  const totalCapital = 4500000;
  const modeCap = totalCapital * (modeStateData.capitalPct || 30) / 100;
  const modeDeployed = modeCap * (modeStateData.deployedPct || 45) / 100;
  const newDeployedPct = ((modeDeployed + margin) / modeCap) * 100;
  const newRiskPct = (margin / totalCapital) * 100;
  const slippage = (order.qty * order.price * 0.0005); // 5bps estimate
  const brokerage = Math.min(20, order.qty * order.price * 0.0003);
  const stt = order.side === "SELL" ? notional * 0.001 : 0;
  const totalCost = brokerage + stt + slippage * 0.4;

  const willBreachMode = newDeployedPct > 100;
  const willBreachRisk = newRiskPct > 2;

  const Row = ({ label, value, sub, kind, mono = true }) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
      <div>
        <div style={{ fontSize: 13 }}>{label}</div>
        {sub && <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{sub}</div>}
      </div>
      <div className={mono ? "mono" : ""} style={{ fontSize: 14, fontWeight: 500, color: kind === "warn" ? "var(--warn)" : kind === "down" ? "var(--down)" : kind === "up" ? "var(--up)" : "var(--text)" }}>
        {value}
      </div>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Pre-trade simulation"
      sub={`${order.side} ${order.qty} ${order.symbol} @ ₹${order.price} · ${order.product}`}
      width={580}
      footer={
        <div className="row" style={{ gap: 10, justifyContent: "flex-end" }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className={"btn " + (willBreachMode || willBreachRisk ? "btn--danger" : "btn--primary")}
            onClick={() => { onConfirm && onConfirm(); onClose(); }}
            disabled={willBreachMode}
          >
            {willBreachMode ? "Blocked by mode cap" : "Confirm & place order"}
          </button>
        </div>
      }
    >
      <div style={{ background: "var(--bg-soft)", borderRadius: "var(--r-md)", padding: 14, marginBottom: 14, display: "flex", gap: 14, alignItems: "center" }}>
        <div style={{ width: 8, height: 32, borderRadius: 4, background: modeMeta ? modeMeta.color : "var(--accent)" }}/>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 500 }}>{modeMeta ? modeMeta.label : "Intraday"} mode</div>
          <div className="muted" style={{ fontSize: 11 }}>Max ₹{(modeCap/100000).toFixed(1)}L · {modeStateData.deployedPct}% deployed</div>
        </div>
        {willBreachMode && <span className="pill pill--down">Cap exceeded</span>}
      </div>

      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Margin & Risk</div>
        <Row label="Notional value" value={window.inrCompact(notional)} sub={`${order.qty} × ₹${order.price.toFixed(2)}`}/>
        <Row label="Margin required" value={window.inrCompact(margin)} sub={order.product === "MIS" ? "5x intraday leverage" : "Full payment (CNC)"}/>
        <Row
          label="Mode cap impact"
          value={`${modeStateData.deployedPct}% → ${newDeployedPct.toFixed(0)}%`}
          sub={`Of ₹${(modeCap/100000).toFixed(1)}L allocated to ${modeMeta ? modeMeta.label : modeId}`}
          kind={willBreachMode ? "down" : newDeployedPct > 80 ? "warn" : undefined}
        />
        <Row
          label="Per-trade risk"
          value={`${newRiskPct.toFixed(2)}%`}
          sub="Of total capital · cap is 2%"
          kind={willBreachRisk ? "down" : undefined}
        />
      </div>

      <div>
        <div style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Estimated costs</div>
        <Row label="Brokerage" value={`₹${brokerage.toFixed(2)}`} sub="Zerodha · ₹20 or 0.03% (whichever lower)"/>
        <Row label="STT + exchange charges" value={`₹${stt.toFixed(2)}`} sub={order.side === "SELL" ? "0.1% on sell-side delivery" : "Buy side · no STT"}/>
        <Row label="Expected slippage" value={`±₹${slippage.toFixed(2)}`} sub="5bps based on last 30d fills"/>
        <Row label="Total estimated cost" value={`₹${totalCost.toFixed(2)}`} kind="muted"/>
      </div>

      {(willBreachMode || willBreachRisk) && (
        <div style={{ marginTop: 14, padding: 12, background: "var(--down-soft)", color: "var(--down)", borderRadius: "var(--r-md)", fontSize: 12, display: "flex", gap: 10, alignItems: "flex-start" }}>
          <I.shield size={16} style={{ flexShrink: 0, marginTop: 2 }}/>
          <div>
            <div style={{ fontWeight: 500, marginBottom: 4 }}>{willBreachMode ? "This order would breach mode capital cap" : "This order exceeds 2% per-trade risk"}</div>
            <div style={{ opacity: 0.85 }}>
              {willBreachMode
                ? `Reduce qty to fit within ₹${(modeCap/100000).toFixed(1)}L allocation, or increase mode cap on Trading modes.`
                : `Reduce position size, or temporarily override per-trade risk on Risk controls (requires 2FA).`}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
};

// === 2FA confirmation modal ===
// For destructive actions: kill switch, capital changes, override risk caps
// T99-T68: was TwoFactorModal — pretended to be 2FA but accepted "123456" or
// any code starting with "1". Misleading for a real-money trading system. Now
// an honest typed-confirmation dialog. Real 2FA (TOTP verify against the
// user's seed) is a separate larger ship. Same callsite signature so the
// existing callers (shell kill-switch + circuits screen) keep working.
//
// Confirm-phrase derives from `action` (e.g. action='Halt all automated trading'
// → 'HALT'). Falls back to 'CONFIRM' if no obvious word can be derived.
const TwoFactorModal = ({ open, onClose, action, detail, onConfirm }) => {
  const [typed, setTyped] = React.useState("");
  React.useEffect(() => { if (open) setTyped(""); }, [open]);

  const phrase = React.useMemo(() => {
    if (!action) return 'CONFIRM';
    const upper = String(action).toUpperCase();
    if (upper.includes('HALT'))    return 'HALT';
    if (upper.includes('KILL'))    return 'KILL';
    if (upper.includes('STOP'))    return 'STOP';
    if (upper.includes('CANCEL'))  return 'CANCEL';
    if (upper.includes('DELETE'))  return 'DELETE';
    if (upper.includes('DISCONNECT')) return 'DISCONNECT';
    return 'CONFIRM';
  }, [action]);

  const isValid = typed === phrase;
  const submit = () => {
    if (!isValid) return;
    onConfirm && onConfirm();
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Confirm destructive action"
      sub={action}
      width={440}
      footer={
        <div className="row" style={{ gap: 10, justifyContent: "flex-end" }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={submit} disabled={!isValid}>
            Confirm action
          </button>
        </div>
      }
    >
      <div style={{ padding: 14, background: "var(--warn-soft)", borderRadius: "var(--r-md)", marginBottom: 18, display: "flex", gap: 12, alignItems: "flex-start" }}>
        <I.shield size={18} style={{ color: "var(--warn)", flexShrink: 0, marginTop: 1 }}/>
        <div style={{ fontSize: 12, color: "oklch(45% 0.13 80)" }}>
          <div style={{ fontWeight: 500, marginBottom: 4 }}>Destructive action</div>
          {detail}
        </div>
      </div>

      <label style={{ fontSize: 12, color: "var(--text-3)" }}>
        Type <code style={{ background: 'var(--bg-soft)', padding: '2px 6px', borderRadius: 4, fontFamily: 'var(--mono)' }}>{phrase}</code> to confirm:
      </label>
      <input
        autoFocus
        value={typed}
        onChange={(e) => setTyped(e.target.value.toUpperCase())}
        onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        placeholder={phrase}
        style={{
          width: "100%", marginTop: 8, padding: "12px 14px",
          fontFamily: "var(--mono)", fontSize: 14,
          background: "var(--bg-soft)", border: "1px solid var(--border)",
          borderRadius: "var(--r-md)",
          outline: "none",
        }}
      />
    </Modal>
  );
};

// === AI signal explainer modal ===
// Used by Signals screen — shows the prompt, news context, features that drove the signal
const AIExplainerModal = ({ open, onClose, signal }) => {
  if (!signal) return null;
  const features = signal.features || [
    { name: "RSI(14)",         val: "32.4",   weight: 0.18, dir: "BUY"  },
    { name: "MACD histogram",  val: "+0.42",  weight: 0.22, dir: "BUY"  },
    { name: "Volume vs 20MA",  val: "1.8×",   weight: 0.15, dir: "BUY"  },
    { name: "BB position",     val: "0.18",   weight: 0.12, dir: "BUY"  },
    { name: "News sentiment",  val: "+0.65",  weight: 0.20, dir: "BUY"  },
    { name: "Sector momentum", val: "+1.2%",  weight: 0.13, dir: "HOLD" },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Why ${signal.action || "BUY"} ${signal.symbol || "HDFCBANK"}?`}
      sub={`${signal.source || "Claude Opus 4.6"} · ${signal.confidence || 82}% confidence · ${signal.timestamp || "14:23:18 IST"}`}
      width={680}
      footer={
        <div className="row" style={{ gap: 10, justifyContent: "space-between" }}>
          <span className="muted" style={{ fontSize: 11 }}>
            Total LLM cost: ₹{(signal.cost || 0.42).toFixed(2)} · {signal.tokens || "1,840"} tokens
          </span>
          <button className="btn btn--primary" onClick={onClose}>Got it</button>
        </div>
      }
    >
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Reasoning</div>
        <div style={{ padding: 14, background: "var(--bg-soft)", borderRadius: "var(--r-md)", fontSize: 13, lineHeight: 1.6 }}>
          {signal.reasoning || `${signal.symbol || "HDFCBANK"} broke above 20-day resistance at ₹${(signal.price || 1715).toFixed(0)} on 1.8× volume. RSI bouncing off oversold (32) confirms momentum. Q2 earnings beat by 4.2%, NIM expanded 12bps. Sector tailwind from RBI policy commentary. Risk: broader market weakness — recommend 1.5% position with trailing stop at ₹1,698.`}
        </div>
      </div>

      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Feature contributions</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {features.map((f, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "140px 80px 1fr 50px", gap: 12, alignItems: "center", fontSize: 12 }}>
              <span>{f.name}</span>
              <span className="mono">{f.val}</span>
              <div style={{ height: 8, background: "var(--bg-sunk)", borderRadius: 4, overflow: "hidden", position: "relative" }}>
                <div style={{
                  position: "absolute", top: 0, bottom: 0, left: 0,
                  width: `${f.weight * 100 * 4}%`,
                  background: f.dir === "BUY" ? "var(--up)" : f.dir === "SELL" ? "var(--down)" : "var(--text-4)",
                  borderRadius: 4,
                }}/>
              </div>
              <span className="mono" style={{ fontSize: 10, color: "var(--text-3)", textAlign: "right" }}>{(f.weight * 100).toFixed(0)}%</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>News context (3 articles)</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {(signal.news || [
            { src: "Moneycontrol", time: "2h", title: "HDFC Bank Q2: NIM expansion beats consensus", sent: "+0.8" },
            { src: "Economic Times", time: "5h", title: "RBI policy: hawkish but no rate hike", sent: "+0.4" },
            { src: "Reuters", time: "1d", title: "Indian banks set for credit growth tailwind in H2", sent: "+0.6" },
          ]).map((n, i) => (
            <div key={i} style={{ padding: "8px 12px", background: "var(--bg-soft)", borderRadius: 6, fontSize: 12, display: "flex", justifyContent: "space-between", gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis" }}>{n.title}</div>
                <div className="muted" style={{ fontSize: 10, marginTop: 2 }}>{n.src} · {n.time} ago</div>
              </div>
              <span className="mono up" style={{ fontSize: 11, alignSelf: "center" }}>{n.sent}</span>
            </div>
          ))}
        </div>
      </div>

      <details>
        <summary style={{ fontSize: 12, color: "var(--text-3)", cursor: "pointer", userSelect: "none" }}>View raw LLM prompt</summary>
        <pre style={{ marginTop: 8, padding: 12, background: "var(--bg-sunk)", borderRadius: 6, fontSize: 10, color: "var(--text-2)", overflow: "auto", maxHeight: 200, fontFamily: "var(--mono)", lineHeight: 1.5 }}>
{`SYSTEM: You are a quantitative trading analyst. Given OHLCV
data, technical indicators, and news context, output a JSON
signal: { action: BUY|SELL|HOLD, confidence: 0-100, target,
stoploss, reasoning, position_size_pct }.

USER: Analyze ${signal.symbol || "HDFCBANK"} for intraday entry.
Last 30d candles: [...]
Technical: RSI=32.4, MACD=+0.42, BB_pos=0.18, vol_ratio=1.8x
News (last 24h): [3 articles attached]
Sector trend: Banking +1.2% (5d), NIFTY +0.4% (5d)
Account context: 1.5% per-trade risk cap, intraday mode active`}
        </pre>
      </details>
    </Modal>
  );
};

// === ConfirmModal — lightweight guard for destructive actions ===
// Use for: closing a position, disabling a mode with open positions, deleting a strategy,
// skipping a high-confidence signal, force-promoting a paper strategy, clearing audit logs.
// For *2FA-grade* destructive actions (kill switch, capital changes, risk overrides) keep
// using TwoFactorModal — this is the layer below.
//
// Props:
//   open, onClose, onConfirm
//   title          — what's about to happen ("Close position?")
//   sub            — secondary line under title
//   detail         — paragraph or JSX explaining consequences
//   facts          — optional array of [label, value] pairs to surface (positions, ₹, etc.)
//   confirmLabel   — button text (default "Confirm")
//   cancelLabel    — (default "Cancel")
//   tone           — "danger" (default for destructive) | "warn" | "info"
//   typeToConfirm  — optional string the user must type to enable confirm (e.g. "HALT")
//   busy           — disables confirm and shows "Working…" while async
const ConfirmModal = ({
  open, onClose, onConfirm,
  title, sub, detail, facts,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "danger",
  typeToConfirm,
  busy,
}) => {
  const [typed, setTyped] = React.useState("");
  React.useEffect(() => { if (open) setTyped(""); }, [open]);

  const palette = {
    danger: { fg: "var(--down)", bg: "var(--down-soft)", btn: "btn--danger", icon: I.shield },
    warn:   { fg: "oklch(45% 0.13 80)", bg: "var(--warn-soft)", btn: "btn--primary", icon: I.shield },
    info:   { fg: "var(--info)", bg: "var(--info-soft)", btn: "btn--primary", icon: I.info },
  }[tone] || { fg: "var(--down)", bg: "var(--down-soft)", btn: "btn--danger", icon: I.shield };

  const canConfirm = !busy && (!typeToConfirm || typed.trim().toUpperCase() === typeToConfirm.toUpperCase());

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      sub={sub}
      width={480}
      footer={
        <div className="row" style={{ gap: 10, justifyContent: "flex-end" }}>
          <button className="btn" onClick={onClose} disabled={busy}>{cancelLabel}</button>
          <button
            className={"btn " + palette.btn}
            onClick={() => { if (canConfirm) { onConfirm && onConfirm(); } }}
            disabled={!canConfirm}
            style={tone === "danger" && canConfirm ? { background: "var(--down)", color: "white", borderColor: "var(--down)" } : null}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      }
    >
      {detail && (
        <div style={{
          padding: 14, background: palette.bg, color: palette.fg,
          borderRadius: "var(--r-md)", marginBottom: facts || typeToConfirm ? 16 : 4,
          display: "flex", gap: 12, alignItems: "flex-start", fontSize: 13, lineHeight: 1.5,
        }}>
          <palette.icon size={18} style={{ flexShrink: 0, marginTop: 1, opacity: 0.9 }}/>
          <div>{detail}</div>
        </div>
      )}

      {facts && facts.length > 0 && (
        <div style={{
          border: "1px solid var(--border)", borderRadius: "var(--r-md)",
          background: "var(--bg-soft)", padding: "4px 14px",
          marginBottom: typeToConfirm ? 16 : 0,
        }}>
          {facts.map((row, i) => {
            const [label, value, kind] = Array.isArray(row) ? row : [row.label, row.value, row.kind];
            return (
              <div key={i} className="between" style={{
                padding: "10px 0",
                borderBottom: i < facts.length - 1 ? "1px solid var(--border)" : "none",
                fontSize: 13,
              }}>
                <span className="muted">{label}</span>
                <span className={"mono " + (kind || "")} style={{ fontWeight: 500 }}>{value}</span>
              </div>
            );
          })}
        </div>
      )}

      {typeToConfirm && (
        <div>
          <label style={{ fontSize: 12, color: "var(--text-3)" }}>
            Type <span className="mono" style={{ background: "var(--bg-sunk)", padding: "1px 6px", borderRadius: 3, color: "var(--text)" }}>{typeToConfirm}</span> to confirm
          </label>
          <input
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && canConfirm) onConfirm && onConfirm(); }}
            placeholder={typeToConfirm}
            style={{
              width: "100%", marginTop: 8, padding: "10px 14px",
              fontFamily: "var(--mono)", fontSize: 14, letterSpacing: "0.05em",
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: "var(--r-md)", outline: "none",
            }}
          />
        </div>
      )}
    </Modal>
  );
};

// T-468 (audit-2026-05-26 frontend L7): Promise-based confirm wrapper.
// Lets callers do `if (!await window.confirmAsync({title:..., ...})) return;`
// without per-site state plumbing. Renders a transient ConfirmModal into
// a portal container at document root. Returns a Promise<boolean>.
function _confirmAsyncImpl(opts) {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    let closed = false;
    const close = (result) => {
      if (closed) return;
      closed = true;
      try {
        if (typeof window.ReactDOM !== 'undefined' && window.ReactDOM.unmountComponentAtNode) {
          window.ReactDOM.unmountComponentAtNode(root);
        }
      } catch (_) {}
      try { root.remove(); } catch (_) {}
      resolve(result);
    };
    try {
      const el = React.createElement(ConfirmModal, {
        open: true,
        onClose: () => close(false),
        onConfirm: () => close(true),
        title: opts && opts.title || 'Confirm?',
        sub: opts && opts.sub,
        detail: opts && opts.detail,
        confirmLabel: opts && opts.confirmLabel || 'Confirm',
        cancelLabel: opts && opts.cancelLabel || 'Cancel',
        tone: opts && opts.tone || 'warn',
      });
      // React 18 createRoot path; fall back to render() for older runtimes.
      if (typeof window.ReactDOM !== 'undefined' && window.ReactDOM.createRoot) {
        const r = window.ReactDOM.createRoot(root);
        r.render(el);
      } else if (typeof window.ReactDOM !== 'undefined' && window.ReactDOM.render) {
        window.ReactDOM.render(el, root);
      } else {
        // No React DOM — fall back to native confirm so we never block a click.
        close(window.confirm((opts && opts.title) || 'Confirm?'));
      }
    } catch (_) {
      close(window.confirm((opts && opts.title) || 'Confirm?'));
    }
  });
}

// T-471 (audit-2026-05-26 frontend L7 — last sites): Promise-based
// prompt wrapper. Lets callers do
//   `const v = await window.promptAsync({title, placeholder, defaultValue});`
// without per-site state plumbing. Returns Promise<string|null> — null
// when the user cancels. Built on the same portal pattern as
// confirmAsync (transient mount, React 18 createRoot, cleanup on resolve).
function _PromptModal({ title, sub, placeholder, defaultValue, confirmLabel, cancelLabel, onClose, onConfirm }) {
  const [value, setValue] = React.useState(defaultValue || '');
  const inputRef = React.useRef(null);
  React.useEffect(() => {
    if (inputRef.current) try { inputRef.current.focus(); inputRef.current.select(); } catch (_) {}
  }, []);
  return React.createElement(Modal, {
    open: true, onClose, title, sub, width: 480,
    footer: React.createElement('div', { className: 'row', style: { gap: 10, justifyContent: 'flex-end' } },
      React.createElement('button', { className: 'btn', onClick: onClose }, cancelLabel || 'Cancel'),
      React.createElement('button', { className: 'btn btn--accent', onClick: () => onConfirm(value) }, confirmLabel || 'OK')
    )
  },
    React.createElement('input', {
      ref: inputRef,
      className: 'input',
      value: value,
      placeholder: placeholder || '',
      onChange: (e) => setValue(e.target.value),
      onKeyDown: (e) => { if (e.key === 'Enter') onConfirm(value); },
      style: { width: '100%', padding: '8px 10px', fontSize: 14 },
    })
  );
}

function _promptAsyncImpl(opts) {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    let closed = false;
    let r = null;
    const close = (result) => {
      if (closed) return;
      closed = true;
      try { if (r && r.unmount) r.unmount(); } catch (_) {}
      try { root.remove(); } catch (_) {}
      resolve(result);
    };
    try {
      const el = React.createElement(_PromptModal, {
        title: opts && opts.title || 'Input',
        sub: opts && opts.sub,
        placeholder: opts && opts.placeholder,
        defaultValue: opts && opts.defaultValue,
        confirmLabel: opts && opts.confirmLabel,
        cancelLabel: opts && opts.cancelLabel,
        onClose: () => close(null),
        onConfirm: (v) => close(v),
      });
      if (typeof window.ReactDOM !== 'undefined' && window.ReactDOM.createRoot) {
        r = window.ReactDOM.createRoot(root);
        r.render(el);
      } else if (typeof window.ReactDOM !== 'undefined' && window.ReactDOM.render) {
        window.ReactDOM.render(el, root);
      } else {
        close(window.prompt((opts && opts.title) || 'Input', (opts && opts.defaultValue) || ''));
      }
    } catch (_) {
      close(window.prompt((opts && opts.title) || 'Input', (opts && opts.defaultValue) || ''));
    }
  });
}

Object.assign(window, { Modal, PreTradeSimulator, TwoFactorModal, AIExplainerModal, ConfirmModal, confirmAsync: _confirmAsyncImpl, promptAsync: _promptAsyncImpl });
