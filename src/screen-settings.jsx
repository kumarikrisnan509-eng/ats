/* eslint-disable */
/* Settings screen */

const SettingsScreen = () => {
  const [tab, setTab] = useState("Profile");
  // Tier 17: live profile + system info for the Profile + API Keys tabs
  const [liveProf, setLiveProf] = React.useState(null);
  const [liveInfo, setLiveInfo] = React.useState(null);
  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [p, i] = await Promise.all([
          window.fetchApi('/api/profile').catch(() => null),
          window.fetchApi('/api/system/info').catch(() => null),
        ]);
        if (cancelled) return;
        if (p && p.ok) setLiveProf(p);
        if (i) setLiveInfo(i);
      } catch (_e) {}
    };
    load();
    const t = setInterval(load, 60000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);
  const [, bump] = useState(0);
  React.useEffect(() => {
    const h = () => bump(n => n + 1);
    window.addEventListener("modes-changed", h);
    window.addEventListener("default-mode-changed", h);
    return () => {
      window.removeEventListener("modes-changed", h);
      window.removeEventListener("default-mode-changed", h);
    };
  }, []);
  const tabs = ["Profile", "API Keys", "Notifications", "AI Sources", "Backups"];

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-header__title">Settings</h1>
          <div className="page-header__sub">Account, API keys, notifications, AI and backups</div>
        </div>
      </div>

      <div className="tabs">
        {tabs.map(t => <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t}</button>)}
      </div>

      {tab === "Profile" && (
        <>
        <div className="grid grid-2">
          <Card title="Account">
            <div className="col" style={{ gap: 14 }}>
              <div className="row" style={{ gap: 14 }}>
                <div style={{ width: 64, height: 64, borderRadius: "50%", background: "linear-gradient(135deg, var(--accent), var(--violet))", color: "white", fontWeight: 600, fontSize: 22, display: "grid", placeItems: "center" }}>RS</div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>Rajasekar Selvam</div>
                  <div className="muted" style={{ fontSize: 12 }}>rajasekarselvam.com · Principal</div>
                </div>
              </div>
              <SettingsField label="Name" value="Rajasekar Selvam"/>
              <SettingsField label="Email" value="hello@rajasekarselvam.com"/>
              <SettingsField label="Trading account" value="Zerodha · XB1234 (linked)"/>
              <SettingsField label="Timezone" value="Asia/Kolkata (IST)"/>
            </div>
          </Card>

          <Card title="Display">
            <div className="col" style={{ gap: 14 }}>
              <ToggleRow label="Dark mode" on note="Use theme toggle in top bar"/>
              <ToggleRow label="Show P&L in header" on/>
              <ToggleRow label="Compact tables" off/>
              <ToggleRow label="Currency abbreviated (₹4.8L)" on/>
              <ToggleRow label="Round to whole rupees" off/>
            </div>
          </Card>
        </div>

        {/* Trading preferences — default mode + behavior */}
        <Card title="Trading preferences" sub="Default mode for new strategies and manual orders" style={{ marginTop: 16 }}>
          <div className="grid grid-2" style={{ gap: 20 }}>
            <div>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
                <div className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>Default mode</div>
                <div className="muted" style={{ fontSize: 10 }}>single-select · pre-fills new orders</div>
              </div>
              <div className="col" style={{ gap: 8 }}>
                {window.MODE_IDS.map(id => {
                  const meta = window.MODE_META[id];
                  const isActive = window.isModeActive ? window.isModeActive(id) : true;
                  const stored = (typeof localStorage !== "undefined" && localStorage.getItem("ats.defaultMode")) || "intraday";
                  const isDefault = id === stored;
                  const disabled = !isActive;
                  return (
                    <label key={id} className="row" style={{
                      gap: 10, padding: "10px 12px",
                      border: isDefault ? `1px solid ${meta.color}` : "1px solid var(--border)",
                      background: disabled ? "var(--surface-2)" : isDefault ? meta.colorSoft : "var(--surface)",
                      borderRadius: "var(--r-md)",
                      cursor: disabled ? "not-allowed" : "pointer",
                      opacity: disabled ? 0.55 : 1,
                    }}
                    onClick={(e) => {
                      if (disabled) return;
                      try { localStorage.setItem("ats.defaultMode", id); } catch(_) {}
                      window.dispatchEvent(new CustomEvent("default-mode-changed", { detail: id }));
                      e.currentTarget.querySelector("input").checked = true;
                    }}>
                      <input type="radio" name="default-mode" defaultChecked={isDefault} disabled={disabled} style={{ accentColor: meta.color }}/>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: meta.color }}/>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{meta.label}</div>
                        <div className="muted" style={{ fontSize: 11 }}>{meta.tagline}</div>
                      </div>
                      {isDefault && !disabled && <Pill kind="acc">default</Pill>}
                      {disabled && <Pill kind="warn">not active</Pill>}
                    </label>
                  );
                })}
              </div>
              <div className="muted" style={{ fontSize: 11, marginTop: 10 }}>
                Disabled modes are turned off in <a href="#modes" style={{ color: "var(--accent)" }}>Trading modes</a>. Default applies only to enabled modes.
              </div>
            </div>

            <div>
              <div className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>Mode behavior</div>
              <div className="col" style={{ gap: 10 }}>
                <ToggleRow label="Auto-pause idle modes" on note="After 30 days without orders"/>
                <ToggleRow label="Confirm mode switch on orders" on note="Manual orders that mismatch default"/>
                <ToggleRow label="Show mode badge in topbar" on note="Toggle active modes from any screen"/>
                <ToggleRow label="Daily mode P&L email" off note="Morning 08:00 IST recap"/>
              </div>
            </div>
          </div>
        </Card>
        </>
      )}

      {tab === "API Keys" && (
        <div className="grid grid-2">
          <Card title="Broker — primary data & execution" sub="Zerodha Kite Connect · all market data sourced here">
            <div className="col" style={{ gap: 12 }}>
              <SettingsField label="API key" value="••••••••••••a7d2" mono/>
              <SettingsField label="API secret" value="••••••••••••••••••••" mono/>
              <SettingsField label="Access token" value="valid · rotates 06:00 IST" mono/>
              <div className="row" style={{ gap: 8, marginTop: 4 }}>
                <button className="btn btn--sm">Rotate</button>
                <button className="btn btn--sm">Test call</button>
              </div>
            </div>
          </Card>
          <Card title="Data feeds (from broker adapter)" sub="Ticks, candles, depth — all via Zerodha today; portable to any connected broker">
            <div className="col" style={{ gap: 12 }}>
              <SettingsField label="Live ticks (WebSocket)" value="Zerodha Kite WS · 14ms avg · 3000 symbols cap" mono/>
              <SettingsField label="Historical candles" value="Zerodha /instruments · cached in Redis (VPS)" mono/>
              <SettingsField label="Market depth (L5)" value="Zerodha Kite WS · top 5 bids/asks" mono/>
              <SettingsField label="Positions + holdings" value="Zerodha REST · polled 5s" mono/>
              <div className="divider"/>
              <SettingsField label="News feed (non-broker)" value="Moneycontrol RSS + ET API (supplementary)" mono/>
              <div className="muted" style={{ fontSize: 11 }}>All feeds abstracted by the broker adapter — switching to Upstox/Dhan routes data through the new provider without strategy code changes.</div>
            </div>
          </Card>
        </div>
      )}

      {tab === "Notifications" && (
        <Card title="Channels">
          <div className="col" style={{ gap: 14 }}>
            {[
              { ch: "Telegram", d: "@rajasekar_trading_bot · chat 140299", on: true },
              { ch: "Email",    d: "hello@rajasekarselvam.com (digest at 16:00)", on: true },
              { ch: "SMS",      d: "+91 9xxxxxx321 · critical only", on: false },
              { ch: "Slack",    d: "#trading-alerts (personal workspace)", on: true },
              { ch: "Webhook",  d: "POST https://rajasekarselvam.com/api/hook", on: true },
            ].map((r, i) => (
              <div key={i} className="between" style={{ padding: 12, border: "1px solid var(--border)", borderRadius: "var(--r-md)" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{r.ch}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{r.d}</div>
                </div>
                <Toggle on={r.on}/>
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === "AI Sources" && (
        <>
          <Card className="card--soft" style={{ marginBottom: 16 }}>
            <div className="row" style={{ gap: 20, justifyContent: "space-between" }}>
              {["Strategies", "AI Router", "Provider Adapter", "LLM Provider"].map((s, i, a) => (
                <React.Fragment key={i}>
                  <div style={{ textAlign: "center", flex: 1 }}>
                    <div style={{ fontFamily: "var(--display)", fontSize: 16, letterSpacing: "-0.01em" }}>{s}</div>
                    <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                      {["emit signal request", "route · critic · consensus", "uniform interface", "Claude · GPT · Gemini · …"][i]}
                    </div>
                  </div>
                  {i < a.length - 1 && <div style={{ color: "var(--text-4)", fontFamily: "var(--mono)" }}>→</div>}
                </React.Fragment>
              ))}
            </div>
          </Card>

          <div className="grid grid-3" style={{ marginBottom: 16 }}>
            {[
              { n: "Anthropic Claude", m: "claude-opus-4.6", key: "••••a2f7", st: "connected", badge: "Primary", lc: "#d97757", ll: "C", latency: "420ms", cost: "₹8.40/1M", use: "intraday · critic",
                models: ["claude-opus-4.6", "claude-sonnet-4.6", "claude-haiku-4.6", "claude-opus-4.5", "claude-sonnet-4.5", "claude-haiku-4.5"] },
              { n: "OpenAI", m: "gpt-5", key: "••••9dd1", st: "connected", badge: "Active", lc: "#10a37f", ll: "O", latency: "380ms", cost: "₹12.20/1M", use: "macro · news scan",
                models: ["gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-4.1", "gpt-4.1-mini", "o4-mini", "o3", "o3-mini"] },
              { n: "Google Gemini", m: "gemini-2.5-pro", key: "••••e4b2", st: "connected", badge: "Active", lc: "#4285f4", ll: "G", latency: "310ms", cost: "₹6.80/1M", use: "consensus · vision",
                models: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-pro", "gemini-2.0-flash"] },
            ].map((p, i) => (
              <Card key={i} style={{ border: "1px solid color-mix(in oklab, var(--accent) 25%, var(--border))" }}>
                <div className="between" style={{ marginBottom: 12 }}>
                  <div className="row">
                    <div style={{ width: 36, height: 36, borderRadius: 9, background: p.lc, color: "white", display: "grid", placeItems: "center", fontWeight: 700 }}>{p.ll}</div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{p.n}</div>
                      <div className="muted" style={{ fontSize: 11 }}>{p.models.length} models available</div>
                    </div>
                  </div>
                  <Pill kind="acc">{p.badge}</Pill>
                </div>
                <div className="col" style={{ gap: 8, fontSize: 12 }}>
                  <div>
                    <div className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Active model</div>
                    <select defaultValue={p.m} style={{ width: "100%", padding: "7px 10px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r-md)", fontFamily: "var(--mono)", fontSize: 12 }}>
                      {p.models.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div className="between"><span className="muted">API key</span><span className="mono">{p.key}</span></div>
                  <div className="between"><span className="muted">Latency</span><span className="mono">{p.latency}</span></div>
                  <div className="between"><span className="muted">Cost</span><span className="mono">{p.cost}</span></div>
                  <div className="between"><span className="muted">Role</span><span style={{ fontSize: 11 }}>{p.use}</span></div>
                </div>
                <div className="row" style={{ marginTop: 12, gap: 6 }}>
                  <button className="btn btn--sm" style={{ flex: 1, justifyContent: "center" }}>Test</button>
                  <button className="btn btn--sm" style={{ flex: 1, justifyContent: "center" }}>Rotate</button>
                </div>
              </Card>
            ))}
          </div>

          <div className="grid grid-3" style={{ marginBottom: 16 }}>
            {[
              { n: "xAI Grok", ll: "x", lc: "#000000", note: "Adapter ready · key required" },
              { n: "Mistral", ll: "M", lc: "#fa520f", note: "Adapter stub" },
              { n: "DeepSeek", ll: "D", lc: "#4d6bfe", note: "Adapter stub" },
              { n: "Perplexity", ll: "P", lc: "#20808d", note: "For news + live-web signals" },
              { n: "Cohere", ll: "Co", lc: "#39594d", note: "Adapter stub" },
              { n: "Local (Ollama)", ll: "L", lc: "#000000", note: "llama3.1:8b on VPS · free tier" },
            ].map((p, i) => (
              <div className="slot" key={i}>
                <div style={{ width: 36, height: 36, borderRadius: 9, background: "color-mix(in oklab, " + p.lc + " 18%, transparent)", color: p.lc, display: "grid", placeItems: "center", fontWeight: 700 }}>{p.ll}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{p.n}</div>
                <div style={{ fontSize: 11 }}>{p.note}</div>
                <button className="btn btn--sm"><I.plus size={12}/> Connect</button>
              </div>
            ))}
          </div>

          <div className="grid grid-2">
            <Card title="Routing rules" sub="How signals flow across providers">
              <div className="col" style={{ gap: 10 }}>
                {[
                  { r: "Intraday momentum · primary", b: "Claude Haiku 4.5" },
                  { r: "Macro / news scan", b: "GPT-4o-mini" },
                  { r: "Consensus check (2-of-3)", b: "Claude + GPT + Gemini" },
                  { r: "Vision (chart screenshots)", b: "Gemini 2.0 Flash" },
                  { r: "Fallback when primary > 2s", b: "Gemini 2.0 Flash" },
                  { r: "Zero-cost preview / dev", b: "Local Ollama (slot)" },
                ].map((r, i) => (
                  <div key={i} className="between" style={{ padding: 10, border: "1px solid var(--border)", borderRadius: "var(--r-md)", fontSize: 12 }}>
                    <span>{r.r}</span>
                    <Pill kind="acc">{r.b}</Pill>
                  </div>
                ))}
              </div>
            </Card>
            <Card title="Behavior">
              <div className="col" style={{ gap: 14 }}>
                <ToggleRow label="Auto-route signals through LLM critic" on/>
                <ToggleRow label="Require consensus (2 of 3)" on note="Reject signal if providers disagree"/>
                <ToggleRow label="Explain trade rationale in logs" on/>
                <ToggleRow label="Cost cap — max ₹500/day on LLM calls" on/>
                <ToggleRow label="Learn from rejections" off note="Coming soon"/>
              </div>
            </Card>
          </div>
        </>
      )}

      {tab === "Backups" && (
        <Card title="Backups" sub="PostgreSQL + strategy code">
          <div className="col" style={{ gap: 12 }}>
            <div className="between" style={{ padding: 12, border: "1px solid var(--border)", borderRadius: "var(--r-md)" }}>
              <div><div style={{ fontSize: 13, fontWeight: 500 }}>Daily DB snapshot</div><div className="muted" style={{ fontSize: 12 }}>Oracle Object Storage · ap-mumbai-1 · retain 30d</div></div>
              <Pill kind="up" dot>last 03:00 IST</Pill>
            </div>
            <div className="between" style={{ padding: 12, border: "1px solid var(--border)", borderRadius: "var(--r-md)" }}>
              <div><div style={{ fontSize: 13, fontWeight: 500 }}>Git push hook</div><div className="muted" style={{ fontSize: 12 }}>strategies/ auto-push on change</div></div>
              <Pill kind="up" dot>live</Pill>
            </div>
            <div className="between" style={{ padding: 12, border: "1px solid var(--border)", borderRadius: "var(--r-md)" }}>
              <div><div style={{ fontSize: 13, fontWeight: 500 }}>Weekly full snapshot</div><div className="muted" style={{ fontSize: 12 }}>Block-volume image · retain 8 weeks</div></div>
              <Pill kind="up" dot>Sun 02:00</Pill>
            </div>
          </div>
        </Card>
      )}
    </>
  );
};

const SettingsField = ({ label, value, mono }) => (
  <div>
    <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>{label}</div>
    <div style={{ padding: "8px 10px", border: "1px solid var(--border)", borderRadius: "var(--r-md)", background: "var(--bg-soft)", fontFamily: mono ? "var(--mono)" : "inherit", fontSize: 13 }}>{value}</div>
  </div>
);

const ToggleRow = ({ label, on, note }) => {
  const [v, setV] = useState(!!on);
  return (
    <div className="between">
      <div>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{label}</div>
        {note && <div className="muted" style={{ fontSize: 11 }}>{note}</div>}
      </div>
      <Toggle on={v} onClick={() => setV(!v)}/>
    </div>
  );
};

Object.assign(window, { SettingsScreen });
