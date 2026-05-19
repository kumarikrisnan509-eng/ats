/* eslint-disable */
/* Custom alerts builder — visual if/then rule builder */

const AlertsBuilderScreen = () => {
  const [activeTab, setActiveTab] = React.useState("active");

  // LIVE alerts from /api/alerts. Self-managing: created here -> fires to Telegram on tick.
  const [activeAlerts, setActiveAlerts] = React.useState([]);
  const [createErr, setCreateErr]       = React.useState(null);
  const [newSym, setNewSym]             = React.useState("RELIANCE");
  const [newCond, setNewCond]           = React.useState("above");
  const [newThresh, setNewThresh]       = React.useState("");
  const [newMsg, setNewMsg]             = React.useState("");
  const [newRepeat, setNewRepeat]       = React.useState(false);

  const refreshAlerts = React.useCallback(async () => {
    try {
      const r = await window.fetchApi('/api/alerts');
      const rows = (r && r.alerts) || [];
      setActiveAlerts(rows.map((a) => ({
        id: a.id,
        name: a.message || `${a.symbol} ${a.condition} ${a.threshold}`,
        enabled: !a.triggeredAt || !!a.repeat,
        when: [{ src: a.symbol, op: a.condition === 'above' ? '>=' : '<=', val: String(a.threshold) }],
        logic: "AND",
        then: ["Telegram notification" + (a.repeat ? " (repeat)" : "")],
        triggered: a.triggerCount || 0,
        lastFired: a.triggeredAt ? new Date(a.triggeredAt).toLocaleString() : "never",
        lastSeenLtp: a.lastSeenLtp,
      })));
    } catch (e) { /* keep last good state */ }
  }, []);

  React.useEffect(() => {
    refreshAlerts();
    const id = setInterval(refreshAlerts, 30000);
    return () => clearInterval(id);
  }, [refreshAlerts]);

  window.atsCreateAlert = async () => {
    setCreateErr(null);
    try {
      const res = await fetch('/api/alerts', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: newSym.trim(), condition: newCond,
          threshold: parseFloat(newThresh),
          message: newMsg.trim() || undefined, repeat: !!newRepeat,
        }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.reason || 'create failed');
      setNewThresh(''); setNewMsg('');
      await refreshAlerts();
    } catch (e) { setCreateErr(e.message); }
  };
  window.atsDeleteAlert = async (id) => {
    try { await fetch('/api/alerts/' + encodeURIComponent(id), { method: 'DELETE', credentials: 'include' }); await refreshAlerts(); } catch (e) { console.warn('[screen-alerts-builder] swallowed:', e && e.message); }
  };

  const [builderRules, setBuilderRules] = React.useState([
    { src: "NIFTY", op: ">", val: "24,300" },
    { src: "RSI(14)", op: ">", val: "70" },
  ]);

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
          Automate · Custom alerts builder
        </div>
        <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 4, maxWidth: 720 }}>
          Create IF/THEN rules across price, indicators, news, portfolio state. Trigger notifications OR automated actions like freezing trades or launching strategies.
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: "1px solid var(--border)" }}>
        {[
          { k: "active", l: `Active alerts (${activeAlerts.filter(a => a.enabled).length})` },
          { k: "builder", l: "Rule builder" },
          { k: "history", l: "History" },
        ].map(t => (
          <button key={t.k} onClick={() => setActiveTab(t.k)} style={{
            padding: "10px 14px", fontSize: 13, fontWeight: 500,
            background: "none", border: "none", cursor: "pointer",
            color: activeTab === t.k ? "var(--text)" : "var(--text-3)",
            borderBottom: activeTab === t.k ? "2px solid var(--acc)" : "2px solid transparent",
            marginBottom: -1,
          }}>{t.l}</button>
        ))}
      </div>

      {activeTab === "active" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {activeAlerts.map(a => (
            <Card key={a.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>{a.name}</div>
                    {a.enabled ? <Chip variant="up">● Active</Chip> : <Chip variant="neutral">Paused</Chip>}
                    {a.triggered > 0 && <Chip>Fired {a.triggered}×</Chip>}
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "70px 1fr", gap: 12, marginBottom: 10 }}>
                    <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase", paddingTop: 3 }}>When</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {a.when.map((w, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 0 }}>
                          {i > 0 && <div style={{ fontSize: 10, fontWeight: 700, color: "var(--acc)", padding: "3px 8px", background: "var(--acc-soft)", borderRadius: 3, marginRight: 8 }}>{a.logic}</div>}
                          <div style={{ fontSize: 12, padding: "4px 10px", background: "var(--bg-soft)", border: "1px solid var(--border)", borderRadius: "var(--r-sm)", fontFamily: "var(--mono)" }}>
                            <span style={{ color: "var(--text-2)" }}>{w.src}</span>
                            <span style={{ color: "var(--acc)", margin: "0 6px", fontWeight: 700 }}>{w.op}</span>
                            <span style={{ fontWeight: 600 }}>{w.val}</span>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase", paddingTop: 3 }}>Then</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {a.then.map((t, i) => (
                        <div key={i} style={{ fontSize: 11, padding: "4px 10px", background: "var(--acc-soft)", color: "var(--acc-ink)", borderRadius: "var(--r-sm)", fontWeight: 500 }}>
                          → {t}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div style={{ fontSize: 11, color: "var(--text-3)" }}>Last fired: {a.lastFired}</div>
                </div>

                <div style={{ display: "flex", gap: 6 }}>
                  <button className="btn btn-ghost" style={{ fontSize: 11, padding: "5px 10px" }}>Edit</button>
                  <button className="btn btn-ghost" style={{ fontSize: 11, padding: "5px 10px" }}>{a.enabled ? "Pause" : "Resume"}</button>
                </div>
              </div>
            </Card>
          ))}
          <button className="btn btn-primary" style={{ marginTop: 8, alignSelf: "flex-start" }} onClick={() => setActiveTab("builder")}>+ New alert</button>
        </div>
      )}

      {activeTab === "builder" && (
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16 }}>
          <Card title="Rule builder" sub="Describe when to trigger and what to do">
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase", marginBottom: 6 }}>Alert name</div>
              <input className="input" placeholder="e.g., NIFTY breakout watch"/>
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase", marginBottom: 8 }}>When (all conditions match)</div>
              {builderRules.map((r, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 60px 1fr 30px", gap: 6, marginBottom: 6 }}>
                  <select className="input" value={r.src} onChange={e => {
                    const copy = [...builderRules]; copy[i] = { ...r, src: e.target.value }; setBuilderRules(copy);
                  }}>
                    <optgroup label="Price & volume">
                      <option>NIFTY</option><option>BANKNIFTY</option><option>RELIANCE</option><option>Volume (1m)</option><option>Gap %</option>
                    </optgroup>
                    <optgroup label="Indicators">
                      <option>RSI(14)</option><option>MACD</option><option>ADX(14)</option><option>IV</option>
                    </optgroup>
                    <optgroup label="AI & news">
                      <option>News sentiment: stock</option><option>AI confidence score</option><option>Whale activity</option>
                    </optgroup>
                    <optgroup label="Portfolio">
                      <option>Portfolio PnL (today)</option><option>Drawdown from peak</option><option>Margin used %</option>
                    </optgroup>
                  </select>
                  <select className="input" value={r.op} onChange={e => {
                    const copy = [...builderRules]; copy[i] = { ...r, op: e.target.value }; setBuilderRules(copy);
                  }}>
                    <option>&gt;</option><option>&lt;</option><option>=</option><option>≥</option><option>≤</option>
                  </select>
                  <input className="input" value={r.val} onChange={e => {
                    const copy = [...builderRules]; copy[i] = { ...r, val: e.target.value }; setBuilderRules(copy);
                  }}/>
                  <button className="btn btn-ghost" style={{ padding: 0, fontSize: 14 }} onClick={() => setBuilderRules(builderRules.filter((_, x) => x !== i))}>×</button>
                </div>
              ))}
              <button className="btn btn-ghost" style={{ fontSize: 11, marginTop: 4 }} onClick={() => setBuilderRules([...builderRules, { src: "NIFTY", op: ">", val: "" }])}>+ Add condition</button>
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase", marginBottom: 8 }}>Then (actions)</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {[
                  { l: "Push notification (iOS/Android)", checked: true },
                  { l: "SMS alert (₹0.25 per message)", checked: false },
                  { l: "Email", checked: true },
                  { l: "Slack / Discord webhook", checked: false },
                  { l: "Run AI analysis (Claude, 500 tokens ≈ ₹0.08)", checked: true },
                  { l: "Trigger strategy: Momentum AI", checked: false },
                  { l: "Freeze new entries for 30 min", checked: false },
                ].map((a, i) => (
                  <label key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: 6, background: a.checked ? "var(--acc-soft)" : "transparent", borderRadius: "var(--r-sm)" }}>
                    <input type="checkbox" defaultChecked={a.checked}/>
                    <span>{a.l}</span>
                  </label>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase", marginBottom: 8 }}>Throttle</div>
              <select className="input">
                <option>Fire once, auto-pause after trigger</option>
                <option>Max 1 fire per hour</option>
                <option>Max 5 fires per day</option>
                <option>No limit</option>
              </select>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-primary">Save alert</button>
              <button className="btn btn-ghost">Test now</button>
              <button className="btn btn-ghost">Cancel</button>
            </div>
          </Card>

          <div>
            <Card title="Live preview" sub="Current state of your conditions">
              <div style={{ padding: 14, background: "var(--bg-soft)", borderRadius: "var(--r-md)" }}>
                {builderRules.map((r, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: i < builderRules.length - 1 ? "1px solid var(--border)" : "none" }}>
                    <div style={{ width: 20, height: 20, borderRadius: "50%", background: i === 0 ? "var(--up)" : "var(--border)", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11 }}>
                      {i === 0 ? "✓" : "○"}
                    </div>
                    <div style={{ fontSize: 12, flex: 1, fontFamily: "var(--mono)" }}>
                      <span style={{ color: "var(--text-2)" }}>{r.src}</span>
                      <span style={{ color: "var(--acc)", margin: "0 6px", fontWeight: 700 }}>{r.op}</span>
                      <span style={{ fontWeight: 600 }}>{r.val}</span>
                    </div>
                    <div className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>
                      now: {i === 0 ? "24,082" : "62.8"}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 12, padding: 12, background: "var(--warn-soft)", color: "oklch(45% 0.14 80)", borderRadius: "var(--r-sm)", fontSize: 11, lineHeight: 1.5 }}>
                1 of 2 conditions met — alert will NOT fire yet. Needs all conditions true simultaneously.
              </div>
            </Card>

            <div style={{ marginTop: 12 }}>
              <Card title="Templates" sub="One-click alert starters">
                {[
                  "📊 Daily close report",
                  "🔥 Unusual volume spike",
                  "⚠️ Drawdown protection",
                  "📰 News + price spike (combo)",
                  "💥 VIX regime shift",
                  "🎯 AI confidence > 85% signal",
                ].map((t, i) => (
                  <div key={i} style={{ padding: "10px 12px", background: "var(--bg-soft)", borderRadius: "var(--r-sm)", marginBottom: 6, fontSize: 12, cursor: "pointer" }}>
                    {t}
                  </div>
                ))}
              </Card>
            </div>
          </div>
        </div>
      )}

      {activeTab === "history" && (
        <Card title="Alert fire history (last 30 days)" sub="18 alerts fired · 4 automated actions executed">
          {[
            { t: "Apr 24 · 11:42:03", name: "NIFTY breakout watch", action: "Push + Strategy triggered", kind: "success" },
            { t: "Apr 24 · 09:18:22", name: "Portfolio drawdown guard", action: "SMS + freeze (15 min)", kind: "warn" },
            { t: "Apr 23 · 14:55:17", name: "NIFTY breakout watch", action: "Push notification", kind: "success" },
            { t: "Apr 22 · 10:02:41", name: "RELIANCE news spike", action: "AI analysis + Push", kind: "info" },
            { t: "Apr 22 · 09:15:30", name: "NIFTY breakout watch", action: "Push notification", kind: "success" },
          ].map((h, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "150px 1fr auto", padding: "12px 0", borderBottom: i < 4 ? "1px solid var(--border)" : "none", fontSize: 12, alignItems: "center" }}>
              <div className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{h.t}</div>
              <div style={{ fontWeight: 500 }}>{h.name}</div>
              <Chip variant={h.kind === "success" ? "up" : h.kind === "warn" ? "warn" : "info"}>{h.action}</Chip>
            </div>
          ))}
        </Card>
      )}
    </>
  );
};

window.AlertsBuilderScreen = AlertsBuilderScreen;
