/* eslint-disable */
/* Compliance screen — SEBI algo framework readiness */

const ComplianceScreen = () => {
  // Tier 17: this screen has zero backend wiring. Showing fully fabricated data in
  // production is a regulatory and trust risk. Demo-gated until a real backend
  // module lands. Enable Demo mode in your profile menu to preview the planned UI.
  const [_demo] = window.useDemoMode ? window.useDemoMode() : [false];
  if (!_demo) {
    return (
      <div style={{ padding: 24, maxWidth: 720, margin: '40px auto', textAlign: 'center' }}>
        <div style={{ fontSize: 12, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.6 }}>Compliance & SEBI readiness</div>
        <div style={{ fontSize: 22, fontWeight: 600, marginTop: 4 }}>Coming soon</div>
        <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 8, lineHeight: 1.5 }}>
          This screen does not yet have a real backend wired. Until compliance & sebi readiness data is sourced from live broker / partner APIs, showing hardcoded sample data is misleading and unsafe.
          Enable <b>Demo mode</b> in your profile menu to preview the planned UI.
        </div>
        <div style={{ marginTop: 16, fontSize: 11, color: 'var(--text-3)' }}>
          Backend module: not yet implemented. Track progress in repo deploy/backend/.
        </div>
      </div>
    );
  }

  const [shape, setShape] = useState("byok");

  const checklist = [
    { area: "Product shape", ok: true,  t: "BYOK (Bring Your Own Kite)", sub: "User is the responsible party · lowest regulatory burden" },
    { area: "Algo-ID capture", ok: true, t: "All live orders tagged", sub: "Exchange-issued Algo-ID stored on every order record" },
    { area: "Static IP whitelisting", ok: true, t: "129.213.84.17 declared to Zerodha", sub: "Oracle Cloud ARM · production execution VM" },
    { area: "Audit log immutability", ok: true, t: "S3 Object Lock · governance mode", sub: "Append-only · 7-year retention · WORM-compliant" },
    { area: "User 2FA on live trading", ok: true, t: "TOTP mandatory", sub: "Google Authenticator / Authy · 30s window" },
    { area: "Marketing language review", ok: false, t: "Waitlist page — 1 flagged phrase", sub: "'Consistent returns' — remove or replace before launch" },
    { area: "SOC 2 Type I", ok: false, t: "Audit scheduled", sub: "Target: Q3 2026 · vendor shortlisted" },
    { area: "Penetration test", ok: false, t: "Not yet", sub: "Required before public beta · not started" },
  ];

  const algoOrders = [
    { t: "14:41:08", algoId: "ALGO-NSE-2026-047832", s: "RELIANCE", side: "BUY", qty: 80, strat: "momentum-ai", mode: "intraday", user: "rajasekar@…", broker: "zerodha" },
    { t: "14:32:19", algoId: "ALGO-NSE-2026-047831", s: "HDFCBANK", side: "BUY", qty: 50, strat: "mean-rev-v2",  mode: "intraday", user: "rajasekar@…", broker: "zerodha" },
    { t: "14:18:44", algoId: "ALGO-NFO-2026-012904", s: "NIFTY 22500 CE", side: "BUY", qty: 75, strat: "iron-condor", mode: "options", user: "rajasekar@…", broker: "zerodha" },
    { t: "13:58:02", algoId: "ALGO-NSE-2026-047830", s: "TATASTEEL", side: "SELL", qty: 200, strat: "breakout", mode: "intraday", user: "rajasekar@…", broker: "zerodha" },
    { t: "13:22:15", algoId: "ALGO-NSE-2026-047829", s: "SBIN", side: "SELL", qty: 150, strat: "grid-trader", mode: "swing", user: "rajasekar@…", broker: "zerodha" },
    { t: "12:04:52", algoId: "ALGO-NFO-2026-012903", s: "NIFTY 22600 PE", side: "SELL", qty: 75, strat: "iron-condor", mode: "options", user: "rajasekar@…", broker: "zerodha" },
    { t: "11:18:30", algoId: "ALGO-NSE-2026-047828", s: "INFY", side: "BUY", qty: 60, strat: "trend-follow", mode: "swing", user: "rajasekar@…", broker: "zerodha" },
  ];

  const [modeFilter, setModeFilter] = useState("all");
  const filteredOrders = modeFilter === "all" ? algoOrders : algoOrders.filter(o => o.mode === modeFilter);

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-header__title">Compliance</h1>
          <div className="page-header__sub">SEBI retail algo framework · mandatory since 01 Apr 2026 · audit-ready</div>
        </div>
        <div className="page-header__right">
          <button className="btn"><I.download size={14}/> Export audit pack</button>
          <button className="btn"><I.download size={14}/> Export log (FY26)</button>
        </div>
      </div>

      {window.ComplianceLog && (
        <div style={{ marginBottom: 16 }}>
          <window.ComplianceLog/>
        </div>
      )}

      {/* Banner */}
      <div className="banner" style={{ marginBottom: 16 }}>
        <I.shield size={18}/>
        <div style={{ flex: 1 }}>
          <strong>SEBI framework:</strong> every algo order carries an exchange-issued Algo-ID. You are operating in <strong>BYOK mode</strong> — the user's own Kite account is the responsible entity. Empanelled-vendor mode requires 6–12 month onboarding through the broker.
        </div>
      </div>

      {/* Product shape */}
      <Card title="Product shape" sub="Determines your regulatory burden — can be changed only on legal review" style={{ marginBottom: 16 }}>
        <div className="grid grid-3" style={{ gap: 12 }}>
          {[
            { id: "research", n: "Research & Analytics", desc: "Signals + charts + portfolio. No execution.", burden: "None", color: "var(--info)" },
            { id: "byok",     n: "BYOK (current)",         desc: "User connects own Kite · platform generates + fires orders to their account.", burden: "Low", color: "var(--accent)" },
            { id: "vendor",   n: "Empanelled Vendor",      desc: "Platform registers each strategy with broker · get Algo-IDs · subscribers.", burden: "High", color: "var(--violet)" },
          ].map(s => (
            <div key={s.id} onClick={() => setShape(s.id)}
              style={{
                padding: 16,
                borderRadius: "var(--r-md)",
                border: "1px solid " + (shape === s.id ? s.color : "var(--border)"),
                background: shape === s.id ? "color-mix(in oklab, " + s.color + " 6%, var(--surface))" : "var(--surface)",
                cursor: "pointer",
              }}>
              <div className="between" style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{s.n}</div>
                {shape === s.id && <Pill kind="acc" dot>active</Pill>}
              </div>
              <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>{s.desc}</div>
              <div className="row" style={{ gap: 6, fontSize: 11 }}>
                <span className="muted">Reg. burden:</span>
                <span className="mono" style={{ color: s.color, fontWeight: 500 }}>{s.burden}</span>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Checklist + log stats */}
      <div className="grid grid-2-1" style={{ marginBottom: 16 }}>
        <Card title="Readiness checklist" sub="5 of 8 complete · 3 open for public beta" flush>
          <div>
            {checklist.map((c,i) => (
              <div key={i} className="between" style={{ padding: "14px 20px", borderBottom: i === checklist.length - 1 ? "none" : "1px solid var(--border)" }}>
                <div className="row" style={{ gap: 12 }}>
                  <div style={{ width: 24, height: 24, borderRadius: 6, background: c.ok ? "var(--up-soft)" : "var(--warn-soft)", color: c.ok ? "var(--up)" : "var(--warn)", display: "grid", placeItems: "center" }}>
                    {c.ok ? <I.check size={14}/> : <I.clock size={14}/>}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{c.area}</div>
                    <div className="muted" style={{ fontSize: 11 }}>{c.sub}</div>
                  </div>
                </div>
                <div className="row" style={{ gap: 10 }}>
                  <span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{c.t}</span>
                  {c.ok ? <Pill kind="up" dot>passed</Pill> : <Pill kind="warn" dot>open</Pill>}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Audit log stats" sub="S3 Object Lock · governance">
          <div className="col" style={{ gap: 14 }}>
            <div>
              <div className="muted" style={{ fontSize: 11 }}>Records on file</div>
              <div className="mono" style={{ fontSize: 22, fontWeight: 500 }}>1,482,391</div>
              <div className="muted" style={{ fontSize: 11 }}>Since 01 Apr 2026</div>
            </div>
            <div className="divider"/>
            <div>
              <div className="muted" style={{ fontSize: 11 }}>Retention policy</div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>7 years (SEBI minimum 5y)</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 11 }}>Integrity</div>
              <div className="row" style={{ gap: 8 }}>
                <Pill kind="up" dot>SHA-256 chained</Pill>
              </div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 11 }}>Last hash verify</div>
              <div className="mono" style={{ fontSize: 12 }}>03:14 IST · pass · 0 tampered</div>
            </div>
            <button className="btn btn--sm" style={{ marginTop: 4 }}><I.refresh size={12}/> Run integrity check</button>
          </div>
        </Card>
      </div>

      {/* Algo-ID registry */}
      <Card
        title="Algo-ID registry"
        sub="Every live order · exchange-issued ID captured at placement"
        right={
          <Segmented
            value={modeFilter}
            onChange={setModeFilter}
            options={[
              { value: "all",      label: "All modes" },
              { value: "intraday", label: "Intraday" },
              { value: "swing",    label: "Swing" },
              { value: "options",  label: "Options" },
              { value: "futures",  label: "Futures" },
            ]}
          />
        }
        flush
        style={{ marginBottom: 16 }}
      >
        <table className="table">
          <thead><tr><th>Time</th><th>Algo-ID (exchange)</th><th>Symbol</th><th>Side</th><th className="num-l">Qty</th><th>Mode</th><th>Strategy</th><th>User</th><th>Broker</th></tr></thead>
          <tbody>
            {filteredOrders.length === 0 ? (
              <tr><td colSpan={9} style={{ textAlign: "center", padding: 28, color: "var(--text-3)", fontStyle: "italic" }}>No orders for this mode</td></tr>
            ) : filteredOrders.map((o,i) => {
              const meta = window.MODE_META[o.mode];
              return (
              <tr key={i}>
                <td className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{o.t}</td>
                <td className="mono" style={{ fontSize: 11, fontWeight: 500 }}>{o.algoId}</td>
                <td style={{ fontWeight: 500 }}>{o.s}</td>
                <td><Pill kind={o.side === "BUY" ? "up" : "down"}>{o.side}</Pill></td>
                <td className="num">{o.qty}</td>
                <td>
                  <span className="row" style={{ gap: 6 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: meta.color }}/>
                    <span className="mono" style={{ fontSize: 11, color: meta.color, fontWeight: 500 }}>{meta.shortLabel}</span>
                  </span>
                </td>
                <td className="mono" style={{ fontSize: 12 }}>{o.strat}</td>
                <td className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{o.user}</td>
                <td><Pill>{o.broker}</Pill></td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {/* Marketing review + disclaimers */}
      <div className="grid grid-2">
        <Card title="Marketing language review" sub="Compliance-flagged phrases · automated scan of landing pages + emails">
          <div className="col" style={{ gap: 10 }}>
            {[
              { phrase: "'Consistent returns'", where: "waitlist.html · H2", sev: "warn", fix: "Replace with 'Consistent process'" },
              { phrase: "'Proven strategies'", where: "pricing.html · feature bullet", sev: "info", fix: "Soften to 'Validated via 1000+ backtests'" },
              { phrase: "'Beat the market'",  where: "twitter bio", sev: "warn", fix: "Remove · implies performance promise" },
              { phrase: "'Guaranteed alpha'", where: "— none found", sev: "up", fix: "No occurrences · ✓" },
            ].map((p,i) => (
              <div key={i} className="between" style={{ padding: 10, border: "1px solid var(--border)", borderRadius: "var(--r-md)" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{p.phrase}</div>
                  <div className="muted" style={{ fontSize: 11 }}>{p.where}</div>
                  <div className="mono" style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{p.fix}</div>
                </div>
                <Pill kind={p.sev}>{p.sev === "warn" ? "flagged" : p.sev === "info" ? "review" : "ok"}</Pill>
              </div>
            ))}
          </div>
        </Card>

        <Card title="User disclaimers" sub="Acknowledged by every user at onboarding">
          <div className="col" style={{ gap: 10 }}>
            {[
              { t: "No guaranteed returns",        sub: "Past performance is not indicative of future results", ok: true },
              { t: "User is responsible party",    sub: "All orders placed via user's own Kite account", ok: true },
              { t: "Kill switch responsibility",   sub: "User may halt automation at any time", ok: true },
              { t: "Data feed disclaimer",          sub: "Market data via Zerodha WS · not for rebroadcast", ok: true },
              { t: "No advisory relationship",     sub: "Not a SEBI RA/RIA · signals are not recommendations", ok: true },
              { t: "Tax handling",                  sub: "Users responsible for own tax reporting", ok: true },
            ].map((d,i) => (
              <div key={i} className="row" style={{ gap: 10, padding: "6px 0" }}>
                <div style={{ width: 18, height: 18, borderRadius: 5, background: "var(--up-soft)", color: "var(--up)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                  <I.check size={12}/>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 500 }}>{d.t}</div>
                  <div className="muted" style={{ fontSize: 11 }}>{d.sub}</div>
                </div>
                <span className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>v2.1</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
};

Object.assign(window, { ComplianceScreen });
