/* eslint-disable */
/* Round 8 strategic — AI Assistant drawer + Today's Plan widget + Replay mode */

// ============ AI Assistant drawer (Strategic — Claude side panel) ============
// Right-edge slide-in. User asks free-form, Claude answers with context about the current screen.
// Three suggested prompts seeded per route. Real call goes through window.claude.complete().
const AIAssistant = () => {
  const [open, setOpen] = React.useState(false);
  const [route, setRoute] = React.useState(location.hash.replace("#", "") || "dashboard");
  const [msgs, setMsgs] = React.useState([
    { role: "assistant", text: "I'm here as your trading copilot. Ask me to explain a signal, suggest a hedge, or audit your risk." },
  ]);
  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const endRef = React.useRef();

  React.useEffect(() => {
    const h = () => setRoute(location.hash.replace("#", "") || "dashboard");
    window.addEventListener("hashchange", h);
    const k = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "/") { e.preventDefault(); setOpen(o => !o); }
      if (e.key === "Escape" && open) setOpen(false);
    };
    window.addEventListener("keydown", k);
    const o = () => setOpen(true);
    window.addEventListener("open-assistant", o);
    return () => { window.removeEventListener("hashchange", h); window.removeEventListener("keydown", k); window.removeEventListener("open-assistant", o); };
  }, [open]);

  React.useEffect(() => {
    if (endRef.current) endRef.current.scrollTop = endRef.current.scrollHeight;
  }, [msgs, busy]);

  // Suggested prompts per screen
  const suggests = {
    dashboard:  ["Explain today's P&L drivers", "What's my biggest risk right now?", "Should I take profit on any position?"],
    signals:    ["Why is HDFCBANK confidence 82%?", "Which signals should I skip?", "Find signals with sector tailwind"],
    portfolio:  ["Suggest a rebalance", "Where am I overweight?", "Tax-loss harvest candidates"],
    risk:       ["Audit my mode caps", "Stress-test 5% gap-down", "Are my stops too tight?"],
    trading:    ["Analyze my open positions", "Suggest a hedge for tech exposure", "What's blocking new orders?"],
    backtest:   ["Why did this strategy underperform?", "Compare to NIFTY benchmark", "What params would improve Sharpe?"],
  };
  const seeded = suggests[route] || suggests.dashboard;

  const ask = async (text) => {
    const q = (text || input).trim();
    if (!q || busy) return;
    setMsgs(m => [...m, { role: "user", text: q }]);
    setInput("");
    setBusy(true);
    try {
      // Use the built-in claude helper. Context is short — keep token usage low.
      const ctx = `You are an AI copilot inside an Indian retail automated trading system called ATS. The user is currently on the "${route}" screen. Be concise (2-4 sentences), conversational, and concrete. Use ₹ for currency. Refer to NSE/BSE conventions. If unsure, say so.`;
      const ans = await window.claude.complete({
        messages: [{ role: "user", content: `${ctx}\n\nUser: ${q}` }],
      });
      setMsgs(m => [...m, { role: "assistant", text: ans }]);
    } catch (e) {
      setMsgs(m => [...m, { role: "assistant", text: "I couldn't reach the model just now — try again in a moment. (Demo limits apply.)" }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* Floating launcher */}
      <button onClick={() => setOpen(o => !o)} title="AI Assistant · ⌘/"
        style={{
          position: "fixed", right: 20, bottom: open ? -60 : 20, zIndex: 60,
          width: 48, height: 48, borderRadius: "50%",
          background: "linear-gradient(135deg, var(--accent), oklch(55% 0.16 280))",
          color: "white", boxShadow: "var(--shadow-lg)",
          display: "grid", placeItems: "center",
          transition: "bottom 0.2s",
        }}>
        <I.sparkle size={22}/>
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{
            position: "fixed", inset: 0, zIndex: 90, background: "color-mix(in oklab, var(--text) 25%, transparent)",
            animation: "fade-in 0.18s ease-out",
          }}/>
          <aside style={{
            position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 91,
            width: 420, maxWidth: "100vw",
            background: "var(--surface)", borderLeft: "1px solid var(--border)",
            display: "flex", flexDirection: "column",
            boxShadow: "var(--shadow-lg)",
            animation: "slide-in 0.22s ease-out",
          }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", gap: 12, alignItems: "center" }}>
              <div style={{
                width: 32, height: 32, borderRadius: 8,
                background: "linear-gradient(135deg, var(--accent), oklch(55% 0.16 280))",
                color: "white", display: "grid", placeItems: "center",
              }}><I.sparkle size={16}/></div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Copilot</div>
                <div className="muted" style={{ fontSize: 11 }}>Claude · context: {route}</div>
              </div>
              <button className="iconbtn" onClick={() => setOpen(false)} style={{ width: 28, height: 28 }}>×</button>
            </div>

            <div ref={endRef} style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
              {msgs.map((m, i) => (
                <div key={i} style={{
                  alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                  maxWidth: "85%",
                  background: m.role === "user" ? "var(--accent)" : "var(--bg-soft)",
                  color: m.role === "user" ? "white" : "var(--text)",
                  padding: "10px 14px", borderRadius: 14,
                  borderBottomRightRadius: m.role === "user" ? 4 : 14,
                  borderBottomLeftRadius: m.role === "user" ? 14 : 4,
                  fontSize: 13, lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                }}>{m.text}</div>
              ))}
              {busy && (
                <div style={{ alignSelf: "flex-start", padding: "10px 14px", background: "var(--bg-soft)", borderRadius: 14, fontSize: 13 }}>
                  <span style={{ display: "inline-flex", gap: 4 }}>
                    {[0,1,2].map(i => <span key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--text-3)", animation: `dot 1.2s infinite ${i*0.15}s` }}/>)}
                  </span>
                </div>
              )}
            </div>

            {/* Suggested prompts */}
            {msgs.length <= 1 && (
              <div style={{ padding: "0 20px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
                <div className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>Try asking</div>
                {seeded.map((q, i) => (
                  <button key={i} onClick={() => ask(q)} style={{
                    textAlign: "left", padding: "8px 12px", borderRadius: 8,
                    background: "var(--bg-soft)", border: "1px solid var(--border)",
                    fontSize: 12, color: "var(--text-2)",
                  }}>{q}</button>
                ))}
              </div>
            )}

            <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)", display: "flex", gap: 8 }}>
              <input value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") ask(); }}
                placeholder="Ask anything about your portfolio…"
                style={{
                  flex: 1, padding: "10px 14px", fontSize: 13,
                  background: "var(--bg-soft)", border: "1px solid var(--border)",
                  borderRadius: 10, outline: "none",
                }}/>
              <button className="btn btn--primary" onClick={() => ask()} disabled={!input.trim() || busy}>Send</button>
            </div>
            <style>{`
              @keyframes slide-in { from { transform: translateX(420px) } to { transform: translateX(0) } }
              @keyframes fade-in { from { opacity: 0 } to { opacity: 1 } }
              @keyframes dot { 0%,80%,100% { opacity: 0.3 } 40% { opacity: 1 } }
            `}</style>
          </aside>
        </>
      )}
    </>
  );
};

// ============ Today's Plan — morning digest (Strategic) ============
// Compact widget summarising the day ahead. Renders as a banner above the dashboard
// in the first session per day. Dismissible.
const TodaysPlan = () => {
  const [dismissed, setDismissed] = React.useState(() => {
    try { return localStorage.getItem("ats.plan.dismissed") === new Date().toDateString(); } catch { return false; }
  });
  if (dismissed) return null;
  const dismiss = () => {
    try { localStorage.setItem("ats.plan.dismissed", new Date().toDateString()); } catch {}
    setDismissed(true);
  };

  const items = [
    { icon: I.brain,   label: "12 signals queued",  sub: "3 high-confidence", color: "var(--violet)", href: "#signals" },
    { icon: I.layers,  label: "NIFTY weekly expiry", sub: "Thu · 2 IC positions at risk", color: "var(--warn)", href: "#trading" },
    { icon: I.shield,  label: "Risk: 32% used",     sub: "₹4.8k / ₹15k daily cap",       color: "var(--up)", href: "#risk" },
    { icon: I.target,  label: "1 SIP due today",    sub: "₹15k → Index 500",            color: "var(--info)", href: "#stpswp" },
  ];

  return (
    <div style={{
      display: "flex", gap: 0, marginBottom: 16,
      background: "linear-gradient(135deg, color-mix(in oklab, var(--accent) 8%, var(--surface)), var(--surface))",
      border: "1px solid var(--border)", borderRadius: "var(--r-lg)",
      overflow: "hidden",
    }}>
      <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 4, minWidth: 240, borderRight: "1px solid var(--border)" }}>
        <div className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em" }}>Today's plan</div>
        <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em", fontFamily: "var(--display)" }}>Good morning, Rajasekar</div>
        <div className="muted" style={{ fontSize: 12 }}>4 things to know before market open</div>
      </div>
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(4, 1fr)" }}>
        {items.map((it, i) => (
          <a key={i} href={it.href} style={{
            padding: "16px 18px", textDecoration: "none", color: "inherit",
            borderRight: i < items.length - 1 ? "1px solid var(--border)" : "none",
            display: "flex", flexDirection: "column", gap: 6,
            transition: "background 0.12s",
          }} onMouseEnter={e => e.currentTarget.style.background = "var(--bg-soft)"}
             onMouseLeave={e => e.currentTarget.style.background = ""}>
            <div style={{ color: it.color }}><it.icon size={16}/></div>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{it.label}</div>
            <div className="muted" style={{ fontSize: 11 }}>{it.sub}</div>
          </a>
        ))}
      </div>
      <button onClick={dismiss} style={{
        padding: "0 16px", color: "var(--text-3)", fontSize: 16, lineHeight: 1, alignSelf: "flex-start", paddingTop: 14,
      }} title="Dismiss for today">×</button>
    </div>
  );
};

// ============ Replay mode — scrub the trading day (Strategic) ============
// Floating bottom-center bar. Scrubbing emits "replay-time-changed" so live screens can rewind.
// Disabled in this demo for live screens (would need backend tape), but the control is real.
const ReplayMode = () => {
  const [open, setOpen] = React.useState(false);
  const [t, setT] = React.useState(60); // 0-100 (0 = 09:15, 100 = 15:30)
  const [playing, setPlaying] = React.useState(false);

  React.useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setT(prev => {
        const next = prev + 0.5;
        if (next >= 100) { setPlaying(false); return 100; }
        return next;
      });
    }, 100);
    return () => clearInterval(id);
  }, [playing]);

  React.useEffect(() => {
    window.dispatchEvent(new CustomEvent("replay-time-changed", { detail: t }));
  }, [t]);

  React.useEffect(() => {
    const o = () => setOpen(o => !o);
    window.addEventListener("toggle-replay", o);
    return () => window.removeEventListener("toggle-replay", o);
  }, []);

  if (!open) return null;

  // Map t (0-100) to HH:MM between 09:15 and 15:30 (375 minutes)
  const totalMin = 375;
  const minFromOpen = Math.floor((t / 100) * totalMin);
  const h = 9 + Math.floor((15 + minFromOpen) / 60);
  const m = (15 + minFromOpen) % 60;
  const timeStr = `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;

  return (
    <div style={{
      position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", zIndex: 50,
      background: "var(--text)", color: "var(--bg)",
      borderRadius: 999, padding: "8px 16px",
      display: "flex", alignItems: "center", gap: 14,
      width: 560, maxWidth: "calc(100vw - 40px)",
      boxShadow: "var(--shadow-lg)",
    }}>
      <button onClick={() => setPlaying(p => !p)} style={{ color: "var(--bg)" }}>
        {playing ? <I.pause size={16}/> : <I.play size={16}/>}
      </button>
      <span className="mono" style={{ fontSize: 12, minWidth: 50 }}>{timeStr}</span>
      <input type="range" min="0" max="100" step="0.5" value={t}
        onChange={e => { setT(+e.target.value); setPlaying(false); }}
        style={{ flex: 1, accentColor: "var(--accent)" }}/>
      <span className="mono" style={{ fontSize: 10, opacity: 0.6 }}>15:30</span>
      <button onClick={() => setOpen(false)} style={{ color: "var(--bg)", opacity: 0.7, fontSize: 16, lineHeight: 1 }}>×</button>
    </div>
  );
};

Object.assign(window, { AIAssistant, TodaysPlan, ReplayMode });
