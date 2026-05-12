/* eslint-disable */
/* Onboarding wizard — first-run experience
   Shown after register, before landing on Dashboard.
   Walks through: broker connect → mode selection → risk budget → paper trading intro */

const OnboardingWizard = ({ onComplete }) => {
  const [step, setStep] = React.useState(0);
  const [config, setConfig] = React.useState({
    brokers: { zerodha: true, upstox: false },
    modes: { intraday: true, swing: true, options: false, futures: false },
    capital: 500000,
    riskPct: 1,
    paperDays: 14,
    autoSweep: true,
    aiModel: "claude-opus-4.6",
  });

  const steps = [
    { id: "welcome",  title: "Welcome to ATS" },
    { id: "broker",   title: "Connect your broker" },
    { id: "modes",    title: "Pick your trading modes" },
    { id: "risk",     title: "Set your risk budget" },
    { id: "ai",       title: "Choose your AI source" },
    { id: "review",   title: "Ready to start" },
  ];

  // R10 #29 — onboarding leaves users on a clean (non-demo) state.
  // The demoMode hook reads localStorage on every render; we just flip it here.
  const finish = () => {
    try { window.setDemoMode && window.setDemoMode(false); } catch {}
    onComplete(config);
  };
  const next = () => step < steps.length - 1 ? setStep(step + 1) : finish();
  const prev = () => setStep(Math.max(0, step - 1));

  const update = (patch) => setConfig({ ...config, ...patch });

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "var(--bg)",
      display: "flex", flexDirection: "column",
    }}>
      {/* Header */}
      <div style={{
        padding: "16px 32px",
        borderBottom: "1px solid var(--border)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "var(--surface)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 6, background: "var(--accent)", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 12 }}>RC</div>
          <strong style={{ fontSize: 14 }}>Setup · Step {step + 1} of {steps.length}</strong>
        </div>
        <button className="btn btn--ghost" style={{ fontSize: 12 }} onClick={finish}>Skip for now</button>
      </div>

      {/* Progress */}
      <div style={{ padding: "0 32px", paddingTop: 16, background: "var(--surface)" }}>
        <div style={{ display: "flex", gap: 4 }}>
          {steps.map((s, i) => (
            <div key={s.id} style={{
              flex: 1, height: 3, borderRadius: 2,
              background: i <= step ? "var(--accent)" : "var(--border)",
              transition: "background 0.2s",
            }}/>
          ))}
        </div>
        <div style={{ display: "flex", gap: 4, marginTop: 6, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)" }}>
          {steps.map((s, i) => (
            <div key={s.id} style={{ flex: 1, textAlign: i === 0 ? "left" : i === steps.length - 1 ? "right" : "center", opacity: i === step ? 1 : 0.5 }}>
              {s.id}
            </div>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "40px 32px" }}>
        <div style={{ maxWidth: 640, margin: "0 auto" }}>
          <h1 style={{ fontSize: 28, letterSpacing: "-0.02em", marginBottom: 10, fontWeight: 600 }}>{steps[step].title}</h1>

          {step === 0 && <Welcome/>}
          {step === 1 && <BrokerStep config={config} update={update}/>}
          {step === 2 && <ModeStep config={config} update={update}/>}
          {step === 3 && <RiskStep config={config} update={update}/>}
          {step === 4 && <AIStep config={config} update={update}/>}
          {step === 5 && <ReviewStep config={config}/>}
        </div>
      </div>

      {/* Footer */}
      <div style={{
        padding: "16px 32px",
        borderTop: "1px solid var(--border)",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        background: "var(--surface)",
      }}>
        <button className="btn" onClick={prev} disabled={step === 0} style={{ visibility: step === 0 ? "hidden" : "visible" }}>← Back</button>
        <div className="muted" style={{ fontSize: 11 }}>Press Enter to continue</div>
        <button className="btn btn--primary" onClick={next}>
          {step === steps.length - 1 ? "Start trading →" : "Continue →"}
        </button>
      </div>
    </div>
  );
};

const Welcome = () => (
  <>
    <p className="muted" style={{ fontSize: 15, lineHeight: 1.6, marginBottom: 32 }}>
      We'll set you up in 5 short steps. Every signal starts in paper trading for 14 days before touching live capital — this is non-negotiable.
    </p>
    <div style={{ display: "grid", gap: 12 }}>
      {[
        { n: "1", t: "Connect Zerodha", d: "Kite API for data + execution" },
        { n: "2", t: "Pick your trading modes", d: "Intraday, Swing, Options, Futures" },
        { n: "3", t: "Set your risk budget", d: "Max drawdown per day, per trade" },
        { n: "4", t: "Choose your AI source", d: "Claude, OpenAI, Gemini, or ensemble" },
        { n: "5", t: "Review & start in paper mode", d: "Live capital unlocks after 14d" },
      ].map(s => (
        <div key={s.n} style={{
          display: "flex", gap: 16, alignItems: "center",
          padding: "14px 16px",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--r-md)",
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: "50%",
            background: "var(--bg-soft)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 600, fontSize: 13,
            border: "1px solid var(--border)",
          }}>{s.n}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 500, fontSize: 14 }}>{s.t}</div>
            <div className="muted" style={{ fontSize: 12 }}>{s.d}</div>
          </div>
        </div>
      ))}
    </div>
  </>
);

const BrokerStep = ({ config, update }) => {
  const toggle = (k) => update({ brokers: { ...config.brokers, [k]: !config.brokers[k] } });
  const brokers = [
    { id: "zerodha",  name: "Zerodha Kite",    desc: "Primary · Connect API Key + Secret", recommended: true },
    { id: "upstox",   name: "Upstox Pro",      desc: "Fallback · OAuth 2.0 flow" },
    { id: "dhan",     name: "Dhan",            desc: "Options-focused alternative" },
    { id: "groww",    name: "Groww",           desc: "Mutual funds only" },
  ];
  return (
    <>
      <p className="muted" style={{ fontSize: 14, marginBottom: 24 }}>
        Market data and order execution flow through your broker. We recommend Zerodha as primary — it has the most stable WebSocket API.
      </p>
      <div style={{ display: "grid", gap: 10 }}>
        {brokers.map(b => {
          const on = config.brokers[b.id];
          return (
            <button
              key={b.id}
              onClick={() => toggle(b.id)}
              style={{
                display: "flex", alignItems: "center", gap: 14,
                padding: "16px 18px",
                background: on ? "var(--accent-soft)" : "var(--surface)",
                border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
                borderRadius: "var(--r-md)",
                cursor: "pointer", textAlign: "left",
                transition: "all 0.12s",
              }}
            >
              <div style={{
                width: 20, height: 20, borderRadius: 4,
                background: on ? "var(--accent)" : "transparent",
                border: `2px solid ${on ? "var(--accent)" : "var(--border-strong, var(--border))"}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "white", fontSize: 12, fontWeight: 700,
                flexShrink: 0,
              }}>{on && "✓"}</div>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontWeight: 500, fontSize: 14 }}>{b.name}</span>
                  {b.recommended && <span style={{ fontSize: 10, padding: "2px 6px", background: "var(--up-soft)", color: "var(--up)", borderRadius: 3, fontWeight: 500 }}>RECOMMENDED</span>}
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{b.desc}</div>
              </div>
            </button>
          );
        })}
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 20, padding: "10px 12px", background: "var(--bg-soft)", borderRadius: 6, lineHeight: 1.6 }}>
        You'll enter API credentials in Settings after this wizard. We never store raw broker passwords — only token-based access.
      </div>
    </>
  );
};

const ModeStep = ({ config, update }) => {
  const toggle = (k) => update({ modes: { ...config.modes, [k]: !config.modes[k] } });
  const modes = [
    { id: "intraday", name: "Intraday", icon: "⚡", desc: "Enter + exit same day · scalping, MIS orders", risk: "high", time: "09:15–15:20" },
    { id: "swing",    name: "Swing",    icon: "↗", desc: "Hold 2–10 days · momentum, breakout", risk: "medium", time: "CNC hold" },
    { id: "options",  name: "Options",  icon: "◇", desc: "Weekly expiry, Iron Condor, directional", risk: "high", time: "Thu expiry" },
    { id: "futures",  name: "Futures",  icon: "▲", desc: "Index & stock futures · leveraged", risk: "high", time: "Monthly rollover" },
  ];
  const riskColor = { high: "var(--down)", medium: "oklch(65% 0.13 80)" };
  return (
    <>
      <p className="muted" style={{ fontSize: 14, marginBottom: 24 }}>
        Each mode has its own strategies, capital allocation, and risk limits. Start with 1–2 modes — you can add more later.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {modes.map(m => {
          const on = config.modes[m.id];
          return (
            <button
              key={m.id}
              onClick={() => toggle(m.id)}
              style={{
                display: "flex", flexDirection: "column", gap: 6,
                padding: "16px 18px",
                background: on ? "var(--accent-soft)" : "var(--surface)",
                border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
                borderRadius: "var(--r-md)",
                cursor: "pointer", textAlign: "left",
              }}
            >
              <div className="between">
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <span style={{ fontSize: 18 }}>{m.icon}</span>
                  <span style={{ fontWeight: 500, fontSize: 14 }}>{m.name}</span>
                </div>
                <span style={{ fontSize: 10, color: riskColor[m.risk], fontWeight: 500, textTransform: "uppercase" }}>{m.risk}</span>
              </div>
              <div className="muted" style={{ fontSize: 12, lineHeight: 1.4 }}>{m.desc}</div>
              <div className="mono" style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>{m.time}</div>
            </button>
          );
        })}
      </div>
      <div style={{ marginTop: 20, fontSize: 12, color: "var(--text-3)" }}>
        Selected: <strong style={{ color: "var(--text-2)" }}>{Object.values(config.modes).filter(Boolean).length}</strong> / 4 modes
      </div>
    </>
  );
};

const RiskStep = ({ config, update }) => (
  <>
    <p className="muted" style={{ fontSize: 14, marginBottom: 24 }}>
      These are hard limits. The system halts automatically when breached — you cannot override them manually mid-day.
    </p>
    <div style={{ display: "grid", gap: 20 }}>
      <div>
        <div className="between" style={{ marginBottom: 8 }}>
          <label style={{ fontSize: 13, fontWeight: 500 }}>Starting capital</label>
          <span className="mono" style={{ fontSize: 14, fontWeight: 600 }}>₹{(config.capital / 100000).toFixed(1)}L</span>
        </div>
        <input
          type="range"
          min={100000} max={5000000} step={50000}
          value={config.capital}
          onChange={e => update({ capital: +e.target.value })}
          style={{ width: "100%" }}
        />
        <div className="muted" style={{ fontSize: 11, display: "flex", justifyContent: "space-between", marginTop: 2 }}>
          <span>₹1L</span><span>₹50L</span>
        </div>
      </div>

      <div>
        <div className="between" style={{ marginBottom: 8 }}>
          <label style={{ fontSize: 13, fontWeight: 500 }}>Max risk per trade</label>
          <span className="mono" style={{ fontSize: 14, fontWeight: 600, color: "var(--down)" }}>
            {config.riskPct}% · ₹{((config.capital * config.riskPct) / 100).toLocaleString("en-IN")}
          </span>
        </div>
        <input
          type="range"
          min={0.25} max={3} step={0.25}
          value={config.riskPct}
          onChange={e => update({ riskPct: +e.target.value })}
          style={{ width: "100%" }}
        />
        <div className="muted" style={{ fontSize: 11, display: "flex", justifyContent: "space-between", marginTop: 2 }}>
          <span>0.25%</span><span>3% (aggressive)</span>
        </div>
      </div>

      <div>
        <div className="between" style={{ marginBottom: 8 }}>
          <label style={{ fontSize: 13, fontWeight: 500 }}>Paper trading observation</label>
          <span className="mono" style={{ fontSize: 14, fontWeight: 600 }}>{config.paperDays} days</span>
        </div>
        <input
          type="range"
          min={7} max={30} step={1}
          value={config.paperDays}
          onChange={e => update({ paperDays: +e.target.value })}
          style={{ width: "100%" }}
        />
        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
          Every strategy must run in paper mode for this long before touching live capital. 14 days is recommended.
        </div>
      </div>

      <label style={{ display: "flex", gap: 10, padding: "12px 14px", background: "var(--bg-soft)", borderRadius: "var(--r-md)", cursor: "pointer" }}>
        <input type="checkbox" checked={config.autoSweep} onChange={e => update({ autoSweep: e.target.checked })} style={{ marginTop: 2 }}/>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500 }}>Auto-sweep profits to long-term investments</div>
          <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>Profits above your retention band (30%) move to index funds + ETFs monthly.</div>
        </div>
      </label>
    </div>
  </>
);

const AIStep = ({ config, update }) => {
  const models = [
    { id: "claude-opus-4.6",  provider: "Anthropic",  desc: "Best reasoning · intraday + macro",      cost: "$15/M" },
    { id: "claude-haiku-4.6", provider: "Anthropic",  desc: "Fast + cheap · signal generation",      cost: "$0.80/M" },
    { id: "gpt-5",            provider: "OpenAI",     desc: "News scan + sentiment",                 cost: "$12/M" },
    { id: "gemini-2.5-pro",   provider: "Google",     desc: "Long-context research",                 cost: "$2.50/M" },
    { id: "ensemble",         provider: "Router",     desc: "Best-of-3 voting · highest cost",       cost: "~$25/M" },
  ];
  return (
    <>
      <p className="muted" style={{ fontSize: 14, marginBottom: 24 }}>
        Which AI generates signals? You can change this anytime in Settings → AI Sources. We recommend Claude Opus to start.
      </p>
      <div style={{ display: "grid", gap: 8 }}>
        {models.map(m => {
          const on = config.aiModel === m.id;
          return (
            <button
              key={m.id}
              onClick={() => update({ aiModel: m.id })}
              style={{
                display: "flex", alignItems: "center", gap: 14,
                padding: "14px 16px",
                background: on ? "var(--accent-soft)" : "var(--surface)",
                border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
                borderRadius: "var(--r-md)",
                cursor: "pointer", textAlign: "left",
              }}
            >
              <div style={{
                width: 16, height: 16, borderRadius: "50%",
                border: `2px solid ${on ? "var(--accent)" : "var(--border-strong, var(--border))"}`,
                background: on ? "var(--accent)" : "transparent",
                flexShrink: 0,
                boxShadow: on ? "inset 0 0 0 2px var(--surface)" : "none",
              }}/>
              <div style={{ flex: 1 }}>
                <div className="mono" style={{ fontSize: 13, fontWeight: 500 }}>{m.id}</div>
                <div className="muted" style={{ fontSize: 11 }}>{m.provider} · {m.desc}</div>
              </div>
              <span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{m.cost}</span>
            </button>
          );
        })}
      </div>
    </>
  );
};

const ReviewStep = ({ config }) => {
  const modeList = Object.entries(config.modes).filter(([, v]) => v).map(([k]) => k).join(", ") || "none";
  const brokerList = Object.entries(config.brokers).filter(([, v]) => v).map(([k]) => k).join(", ") || "none";
  return (
    <>
      <p className="muted" style={{ fontSize: 14, marginBottom: 24 }}>
        Here's what we'll set up. You can change any of this later.
      </p>
      <div style={{ display: "grid", gap: 12 }}>
        {[
          { l: "Brokers",    v: brokerList, sub: "You'll enter credentials in Settings" },
          { l: "Modes",      v: modeList,   sub: "Each gets its own strategies + capital" },
          { l: "Capital",    v: `₹${(config.capital / 100000).toFixed(1)}L`, sub: "Divided across active modes" },
          { l: "Max risk per trade", v: `${config.riskPct}%`, sub: `≈ ₹${((config.capital * config.riskPct) / 100).toLocaleString("en-IN")}` },
          { l: "Paper period", v: `${config.paperDays} days`, sub: "Before any strategy goes live" },
          { l: "AI source",    v: config.aiModel,             sub: "Swap models in Settings anytime" },
          { l: "Auto-sweep",   v: config.autoSweep ? "Enabled" : "Off", sub: "Sweep profits > 30% retention" },
        ].map(row => (
          <div key={row.l} className="between" style={{ padding: "14px 16px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r-md)" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{row.l}</div>
              <div className="muted" style={{ fontSize: 11 }}>{row.sub}</div>
            </div>
            <div className="mono" style={{ fontSize: 13, textAlign: "right", textTransform: row.l === "Brokers" || row.l === "Modes" ? "capitalize" : "none" }}>{row.v}</div>
          </div>
        ))}
      </div>

      <div style={{
        marginTop: 24,
        padding: "14px 16px",
        background: "var(--info-soft)",
        border: "1px solid var(--info)",
        borderRadius: "var(--r-md)",
        fontSize: 13, lineHeight: 1.6,
      }}>
        <strong>What happens next:</strong> You'll land on the Dashboard. All strategies start in <strong>paper mode</strong> — no live orders for {config.paperDays} days. You'll see simulated P&L build up. On day {config.paperDays}+1, you can promote strategies that meet your win-rate threshold.
      </div>
    </>
  );
};

window.OnboardingWizard = OnboardingWizard;
