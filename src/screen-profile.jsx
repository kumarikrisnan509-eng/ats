/* eslint-disable */
/* Profile screen — expanded user profile, KYC, plan, API tokens, security */

const ProfileScreen = () => {
  // ---- live broker profile + user identity ----
  const [liveProfile, setLiveProfile] = React.useState(null);
  const [me, setMe] = React.useState(null);  // T99-T67: per-user identity row
  React.useEffect(() => {
    if (window.MockData && window.MockData.isDemoOn && window.MockData.isDemoOn()) return;
    let cancelled = false;
    (async () => {
      try {
        const d = await window.fetchApi('/api/profile');
        if (!cancelled && d && d.ok) setLiveProfile(d.profile || null);
      } catch (e) {}
      try {
        const d2 = await window.fetchApi('/api/me/identity');
        if (!cancelled && d2 && d2.ok) setMe(d2.user || null);
      } catch (e) {}
    })();
    return () => { cancelled = true; };
  }, []);
  const [tab, setTab] = React.useState("overview");

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-header__title">Your profile</h1>
          <div className="page-header__sub">KYC · account limits · security · API tokens · activity</div>
        </div>
        <div className="page-header__right">
          <button className="btn"><I.download size={14}/> Export data</button>
          <button className="btn btn--primary">Save changes</button>
        </div>
      </div>

      {window.LoginHistory && <div style={{ marginBottom: 16 }}><window.LoginHistory/></div>}
      {/* T99-T67: helpers for date formatting (close over `me` via parent) */}

      {/* Identity summary card */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
          <div style={{
            width: 72, height: 72, borderRadius: "50%",
            background: "linear-gradient(135deg, var(--accent), oklch(50% 0.12 280))",
            color: "white", fontWeight: 600, fontSize: 26,
            display: "flex", alignItems: "center", justifyContent: "center",
            border: "3px solid var(--surface)", boxShadow: "0 0 0 1px var(--border)",
            flexShrink: 0,
          }}>RS</div>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 4 }}>
              <h2 style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.01em" }}>{(me && me.name) || (me && me.email) || "Your profile"}</h2>
              {me && me.is_verified && <Pill kind="up" dot>Email verified</Pill>}
              {me && me.is_admin && <Pill kind="info">Admin</Pill>}
            </div>
            <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>{(me && me.email) || "—"}</div>
            <div style={{ display: "flex", gap: 16, fontSize: 12 }}>
              <span><span className="muted">Member since</span> <span className="mono">{me && me.created_at ? new Date(me.created_at).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : "—"}</span></span>
              <span><span className="muted">Last login</span> <span className="mono">{me && me.last_login_at ? new Date(me.last_login_at).toLocaleString('en-IN', { hour:'2-digit', minute:'2-digit', day:'2-digit', month:'short' }) : "never"}</span></span>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}>Algo-ID</div>
            <div className="mono" style={{ fontSize: 14, fontWeight: 500 }}>RAJA-ALGO-0041</div>
            <div className="muted" style={{ fontSize: 10, marginTop: 2 }}>SEBI-registered · tagged on all orders</div>
          </div>
        </div>
      </Card>

      {/* Tabs */}
      <div className="tabs" style={{ marginBottom: 16 }}>
        {[
          { id: "overview", label: "Overview" },
          { id: "kyc",      label: "KYC & documents" },
          { id: "security", label: "Security" },
          { id: "api",      label: "API tokens" },
          { id: "plan",     label: "Plan & billing" },
          { id: "activity", label: "Activity log" },
        ].map(t => (
          <button key={t.id} className={"tab" + (tab === t.id ? " tab--active" : "")} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (() => { window._me = me; return <OverviewTab/>; })()}
      {tab === "kyc"       && <KYCTab/>}
      {tab === "security"  && <SecurityTab/>}
      {tab === "api"       && <ApiTab/>}
      {tab === "plan"      && <PlanTab/>}
      {tab === "activity"  && <ActivityTab/>}
    </>
  );
};

const OverviewTab = () => (
  <div className="grid grid-2">
    <Card title="Personal">
      <KV label="Full name"      value={(window._me && window._me.name) || "Not set"}/>
      <KV label="Email"          value={(window._me && window._me.email) || "—"} verified={!!(window._me && window._me.is_verified)}/>
      <KV label="Phone"          value="Not set"/>
      <KV label="Date of birth"  value="Not set"/>
      <KV label="Address"        value="Not set"/>
    </Card>
    <Card title="Account limits">
      <KV label="Starting capital"   value="₹45,00,000"/>
      <KV label="Max daily drawdown" value="-₹15,000" tone="down"/>
      <KV label="Max risk/trade"     value="1.0%"/>
      <KV label="Paper observation"  value="14 days"/>
      <KV label="Auto-sweep"         value="Enabled · 30% retention"/>
    </Card>
    <Card title="Preferences">
      <KV label="Primary timezone"  value="Asia/Kolkata (IST)"/>
      <KV label="Currency display"  value="₹ (INR)"/>
      <KV label="Date format"       value="DD Mon YYYY"/>
      <KV label="Default route"     value="Dashboard"/>
      <KV label="Theme"             value="Auto (system)"/>
    </Card>
    <Card title="Tax identifiers">
      <KV label="PAN"               value="Not set" mono/>
      <KV label="Aadhaar"           value="Not set" mono/>
      <KV label="GSTIN"             value="Not applicable"/>
      <KV label="Demat (NSDL)"      value="Not set" mono/>
      <KV label="Jurisdiction"      value="India · resident"/>
    </Card>
  </div>
);

const KYCTab = () => (
  <div className="grid grid-2">
    <Card title="Documents" sub="On file · encrypted at rest · never shared">
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {[
          { name: "PAN card",                 status: "verified", on: "12 Mar 2025" },
          { name: "Aadhaar (linked to phone)", status: "verified", on: "12 Mar 2025" },
          { name: "Bank statement (HDFC)",    status: "verified", on: "14 Mar 2025" },
          { name: "Passport-size photo",      status: "verified", on: "12 Mar 2025" },
          { name: "Signature (digital)",      status: "verified", on: "12 Mar 2025" },
          { name: "Income proof (FY24-25 ITR)", status: "pending",  on: "awaiting" },
        ].map(d => (
          <div key={d.name} className="between" style={{ padding: "10px 12px", background: "var(--bg-soft)", borderRadius: "var(--r-sm)" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{d.name}</div>
              <div className="muted" style={{ fontSize: 11 }}>{d.on}</div>
            </div>
            <Pill kind={d.status === "verified" ? "up" : "warn"} dot>{d.status}</Pill>
          </div>
        ))}
      </div>
    </Card>
    <Card title="KYC timeline">
      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        {[
          { when: "12 Mar 2025", what: "Account created via email/password", by: "User" },
          { when: "12 Mar 2025", what: "PAN verified via NSDL API",           by: "Auto" },
          { when: "12 Mar 2025", what: "Aadhaar linked via OTP",              by: "Auto" },
          { when: "14 Mar 2025", what: "Bank account verified via penny drop", by: "Auto" },
          { when: "15 Mar 2025", what: "Zerodha API keys issued",              by: "User" },
          { when: "18 Mar 2025", what: "Algo-ID RAJA-ALGO-0041 assigned",      by: "Exchange" },
          { when: "27 Mar 2025", what: "Live trading unlocked after paper 14d", by: "System" },
        ].map((e, i) => (
          <div key={i} style={{ display: "flex", gap: 14, padding: "10px 0", borderBottom: i < 6 ? "1px solid var(--border)" : "none" }}>
            <div className="mono muted" style={{ fontSize: 11, width: 90, flexShrink: 0 }}>{e.when}</div>
            <div style={{ flex: 1, fontSize: 12 }}>{e.what}</div>
            <Pill kind={e.by === "User" ? "info" : e.by === "Auto" ? "up" : "vio"}>{e.by}</Pill>
          </div>
        ))}
      </div>
    </Card>
  </div>
);

const SecurityTab = () => (
  <div className="grid grid-2">
    <Card title="Login & password">
      <KV label="Current password"    value="Last changed 42 days ago"/>
      <KV label="2FA"                 value="Authenticator app" tone="up"/>
      <KV label="Backup codes"        value="8 of 10 remaining" mono/>
      <KV label="Passkey"             value="Not configured" tone="warn"/>
      <KV label="Session timeout"     value="30 minutes idle"/>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button className="btn btn--sm">Change password</button>
        <button className="btn btn--sm">Regenerate backup codes</button>
      </div>
    </Card>
    <Card title="Active sessions">
      {[
        { dev: "MacBook Pro · Chrome 131", loc: "Chennai, IN",  ip: "103.87.xx.xx",  last: "now", current: true },
        { dev: "iPhone 15 · Safari",       loc: "Chennai, IN",  ip: "49.207.xx.xx",  last: "2h ago" },
        { dev: "Oracle Cloud VPS",          loc: "Mumbai, IN",   ip: "10.0.1.22 (internal)",    last: "live", system: true },
      ].map((s, i) => (
        <div key={i} style={{ padding: "12px 0", borderBottom: i < 2 ? "1px solid var(--border)" : "none" }}>
          <div className="between">
            <div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{s.dev}</span>
                {s.current && <Pill kind="up" dot>this session</Pill>}
                {s.system && <Pill kind="vio">system</Pill>}
              </div>
              <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{s.loc} · <span className="mono">{s.ip}</span></div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="mono" style={{ fontSize: 11 }}>{s.last}</div>
              {!s.current && !s.system && <button className="btn btn--sm btn--ghost" style={{ marginTop: 4, fontSize: 10 }}>Revoke</button>}
            </div>
          </div>
        </div>
      ))}
      <button className="btn btn--sm" style={{ marginTop: 12, color: "var(--down)" }}>
        Sign out of all other sessions
      </button>
    </Card>
    <Card title="Withdrawal protection" sub="Limits beyond which a trade requires manual confirmation — even in auto mode">
      <KV label="Single-order value cap"   value="₹2,00,000"/>
      <KV label="Daily order-count cap"    value="500 orders"/>
      <KV label="Options notional cap"     value="₹10,00,000"/>
      <KV label="Unusual-volume halt"      value="Enabled · 5×"/>
      <KV label="Confirm SMS OTP > cap"    value="Enabled"/>
    </Card>
    <Card title="Audit trail" sub="Security events — last 30 days">
      <div style={{ fontSize: 12, fontFamily: "var(--mono)", color: "var(--text-3)", lineHeight: 1.9 }}>
        <div>✓ password changed · 12 Mar 2025 · 14:22 IST · self-initiated</div>
        <div>✓ 2FA enabled · 12 Mar 2025 · 14:24 IST · Google Authenticator</div>
        <div>✓ backup codes viewed · 28 Mar 2025 · 11:40 IST</div>
        <div>✓ api token rotated · 14 Apr 2026 · 09:00 IST · auto-30d</div>
        <div>✓ new device logged in · 22 Apr 2026 · 07:18 IST · iPhone 15</div>
        <div>✗ failed login · 23 Apr 2026 · 03:12 IST · IP 51.xx.xx.xx (blocked)</div>
      </div>
    </Card>
  </div>
);

const ApiTab = () => (
  <div className="grid grid-2">
    <Card title="Broker API tokens" sub="For market data + order execution">
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {[
          { name: "Zerodha Kite",  role: "Primary · execution + ticks", status: "active", rotates: "daily at 06:00 IST" },
          { name: "Upstox",        role: "Fallback · ticks only",       status: "active", rotates: "monthly" },
          { name: "Dhan",          role: "Unused",                      status: "inactive" },
        ].map(b => (
          <div key={b.name} className="between" style={{ padding: "10px 12px", background: "var(--bg-soft)", borderRadius: "var(--r-sm)" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{b.name}</div>
              <div className="muted" style={{ fontSize: 11 }}>{b.role}{b.rotates && ` · rotates ${b.rotates}`}</div>
            </div>
            <Pill kind={b.status === "active" ? "up" : "mute"} dot>{b.status}</Pill>
          </div>
        ))}
      </div>
    </Card>
    <Card title="AI provider keys" sub="OpenAI / Anthropic / Google — encrypted at rest">
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {[
          { name: "Anthropic (Claude)", last: "••••••8f2a", usage: "12.4M tok this month",  rotate: "90d" },
          { name: "OpenAI (GPT-5)",     last: "••••••a1b9", usage: "8.2M tok this month",   rotate: "90d" },
          { name: "Google (Gemini)",    last: "••••••c77e", usage: "3.1M tok this month",   rotate: "90d" },
        ].map(k => (
          <div key={k.name} className="between" style={{ padding: "10px 12px", background: "var(--bg-soft)", borderRadius: "var(--r-sm)" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{k.name}</div>
              <div className="muted" style={{ fontSize: 11 }}><span className="mono">{k.last}</span> · {k.usage}</div>
            </div>
            <button className="btn btn--sm btn--ghost" style={{ fontSize: 11 }}>Rotate</button>
          </div>
        ))}
      </div>
    </Card>
    <Card title="Personal access tokens (PAT)" sub="For scripting + programmatic access to your own account">
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {[
          { name: "CLI · local laptop",       scope: "read:all, write:orders", created: "12 Mar 2025", lastUsed: "2d ago" },
          { name: "Jupyter notebooks",         scope: "read:signals, read:portfolio", created: "2 Apr 2026", lastUsed: "today" },
          { name: "Telegram bot",              scope: "read:notifications",     created: "15 Apr 2026", lastUsed: "1h ago" },
        ].map(p => (
          <div key={p.name} className="between" style={{ padding: "10px 12px", background: "var(--bg-soft)", borderRadius: "var(--r-sm)" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{p.name}</div>
              <div className="muted" style={{ fontSize: 11 }}><span className="mono">{p.scope}</span></div>
              <div className="muted" style={{ fontSize: 10, marginTop: 2 }}>created {p.created} · last used {p.lastUsed}</div>
            </div>
            <button className="btn btn--sm btn--ghost" style={{ color: "var(--down)" }}>Revoke</button>
          </div>
        ))}
        <button className="btn btn--sm" style={{ marginTop: 6 }}>+ Generate new token</button>
      </div>
    </Card>
    <Card title="Webhooks" sub="Get notified when signals fire or orders execute">
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {[
          { url: "https://n8n.example.in/webhook/trades", events: "order.filled, order.rejected" },
          { url: "https://hooks.slack.com/services/T••••", events: "signal.promoted, risk.halt" },
        ].map(w => (
          <div key={w.url} style={{ padding: "10px 12px", background: "var(--bg-soft)", borderRadius: "var(--r-sm)" }}>
            <div className="mono" style={{ fontSize: 11, wordBreak: "break-all" }}>{w.url}</div>
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{w.events}</div>
          </div>
        ))}
        <button className="btn btn--sm">+ Add webhook</button>
      </div>
    </Card>
  </div>
);

const PlanTab = () => (
  <>
    <Card title="Current plan" style={{ marginBottom: 16 }}>
      <div className="between">
        <div>
          <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
            <h3 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em" }}>Pro</h3>
            <Pill kind="info">Active</Pill>
          </div>
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>₹2,499 / month · renews 12 May 2026</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn">Change plan</button>
          <button className="btn btn--ghost" style={{ color: "var(--down)" }}>Cancel</button>
        </div>
      </div>
      <div style={{ marginTop: 20, padding: "14px 16px", background: "var(--bg-soft)", borderRadius: "var(--r-md)" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
          <div><div className="muted" style={{ fontSize: 11 }}>AI tokens</div><div className="mono" style={{ fontWeight: 600 }}>23.7M / 50M</div></div>
          <div><div className="muted" style={{ fontSize: 11 }}>Strategies</div><div className="mono" style={{ fontWeight: 600 }}>5 / unlimited</div></div>
          <div><div className="muted" style={{ fontSize: 11 }}>Backtests</div><div className="mono" style={{ fontWeight: 600 }}>42 this month</div></div>
          <div><div className="muted" style={{ fontSize: 11 }}>Brokers</div><div className="mono" style={{ fontWeight: 600 }}>2 / 4</div></div>
        </div>
      </div>
    </Card>
    <Card title="Billing history">
      <table className="tbl">
        <thead><tr><th>Date</th><th>Description</th><th style={{ textAlign: "right" }}>Amount</th><th>Invoice</th></tr></thead>
        <tbody>
          {[
            ["12 Apr 2026", "Pro · monthly", "₹2,499", "INV-2026-041"],
            ["12 Mar 2026", "Pro · monthly", "₹2,499", "INV-2026-032"],
            ["12 Feb 2026", "Pro · monthly", "₹2,499", "INV-2026-022"],
            ["12 Jan 2026", "Pro · monthly", "₹2,499", "INV-2026-012"],
            ["12 Dec 2025", "Plus → Pro upgrade", "₹1,499", "INV-2025-128"],
          ].map((r, i) => (
            <tr key={i}>
              <td className="mono" style={{ fontSize: 12 }}>{r[0]}</td>
              <td>{r[1]}</td>
              <td className="mono" style={{ textAlign: "right", fontWeight: 500 }}>{r[2]}</td>
              <td><a href="#" style={{ color: "var(--accent)", fontSize: 12 }}>{r[3]}</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  </>
);

const ActivityTab = () => (
  <Card title="Recent activity" sub="Your own actions — not system events">
    <div style={{ fontSize: 12, fontFamily: "var(--mono)", color: "var(--text-2)", lineHeight: 1.9 }}>
      <div><span className="muted">14:22</span>  you viewed Dashboard</div>
      <div><span className="muted">14:18</span>  you promoted HDFCBANK signal to live  <Pill kind="up" dot>success</Pill></div>
      <div><span className="muted">14:15</span>  you toggled Options mode OFF</div>
      <div><span className="muted">13:48</span>  you changed AI source to claude-opus-4.6</div>
      <div><span className="muted">11:12</span>  you edited Momentum AI · risk-per-trade from 1.0% to 1.2%</div>
      <div><span className="muted">10:47</span>  you approved daily compliance report</div>
      <div><span className="muted">09:02</span>  you logged in from Chennai · IP 103.87.xx.xx</div>
      <div><span className="muted">yesterday · 18:40</span>  you exported portfolio CSV</div>
      <div><span className="muted">yesterday · 16:22</span>  you rolled over NIFTY MAY-26 futures</div>
      <div><span className="muted">yesterday · 14:05</span>  you paused Iron Condor Weekly strategy</div>
    </div>
  </Card>
);

// Small KV row
const KV = ({ label, value, tone, mono, verified }) => {
  const color = tone === "up" ? "var(--up)" : tone === "down" ? "var(--down)" : tone === "warn" ? "oklch(55% 0.13 80)" : "var(--text-1)";
  return (
    <div className="between" style={{ padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 13, color, fontFamily: mono ? "var(--mono)" : "inherit", display: "flex", gap: 6, alignItems: "center" }}>
        {value}
        {verified && <span style={{ fontSize: 10, color: "var(--up)", fontWeight: 600 }}>✓</span>}
      </div>
    </div>
  );
};

window.ProfileScreen = ProfileScreen;
