/* eslint-disable */
// @ts-check
/* Risk screen */

// Tier 17: live risk-cap usage from /api/system/info + /api/paper + /api/summary
const LiveRiskCards = () => {
  const [data, setData] = React.useState(null);
  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [info, paper, summary, audit] = await Promise.all([
          window.fetchApi('/api/system/info').catch(() => null),
          window.fetchApi('/api/paper').catch(() => null),
          window.fetchApi('/api/summary').catch(() => null),
          window.fetchApi('/api/audit?limit=200').catch(() => null),
        ]);
        if (cancelled) return;
        const caps = info && info.components && info.components.riskCaps ? info.components.riskCaps : {};
        const ps   = paper && paper.stats ? paper.stats : {};
        const positionsCount = summary && summary.aggregates ? (summary.aggregates.positionsNetCount || 0) : 0;
        // Count audit entries for 'blocked' events in last 7d as breaches
        const since = Date.now() - 7*24*3600*1000;
        const breaches = audit && audit.ok && Array.isArray(audit.rows)
          ? audit.rows.filter(r => String(r.event || '').includes('blocked') && new Date(r.ts || 0).getTime() >= since).length : 0;
        setData({
          dailyLossCap:    caps.maxDailyLossINR     || 0,
          dailyLossUsed:   Math.max(0, -(ps.realizedPnl || 0)),
          aggExposureCap:  caps.maxAggregateExposureINR || 0,
          ordersInWindow:  caps.ordersInWindow || 0,
          maxOrdersPerMin: caps.maxOrdersPerMin || 0,
          positionsCount,
          breaches,
        });
      } catch (_e) {}
    };
    load();
    const t = setInterval(load, 15000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);
  if (!data) return <Card><Stat label='Loading risk caps…' value='—'/></Card>;
  const dailyLossPct = data.dailyLossCap > 0 ? Math.min(100, Math.round((data.dailyLossUsed / data.dailyLossCap) * 100)) : 0;
  const rateLimPct   = data.maxOrdersPerMin > 0 ? Math.min(100, Math.round((data.ordersInWindow / data.maxOrdersPerMin) * 100)) : 0;
  return (
    <>
      <Card>
        <Stat label="Daily loss used (paper)" value={inr(data.dailyLossUsed)} delta={`of ${inr(data.dailyLossCap)} cap`} deltaKind="muted" sub={`${dailyLossPct}%`}/>
        <div style={{ marginTop: 12 }}><Progress value={dailyLossPct} kind={dailyLossPct > 70 ? "down" : dailyLossPct > 0 ? "warn" : "up"}/></div>
      </Card>
      <Card>
        <Stat label="Aggregate exposure cap" value={inrCompact(data.aggExposureCap)} delta="₹20L default (Tier 16)" deltaKind="muted" sub="enforced pre-order"/>
        <div style={{ marginTop: 12 }}><Progress value={0} kind="info"/></div>
      </Card>
      <Card>
        <Stat label="Open positions" value={String(data.positionsCount)} delta="from Kite" deltaKind="muted" sub="net positions"/>
        <div style={{ marginTop: 12 }}><Progress value={Math.min(100, data.positionsCount * 6)} kind="up"/></div>
      </Card>
      <Card>
        <Stat label="Order rate (60s)" value={`${data.ordersInWindow}/${data.maxOrdersPerMin}`} delta={`breaches 7d: ${data.breaches}`} deltaKind="muted" sub={`${rateLimPct}%`}/>
        <div style={{ marginTop: 12 }}><Progress value={rateLimPct} kind={rateLimPct > 70 ? "down" : "up"}/></div>
      </Card>
    </>
  );
};

// T99-T100: live Risk events table from /api/audit. Filters for risk-relevant
// events (order.blocked.*, risk.*, circuit.*, kill.*, broker.disconnect).
// Replaces the prior 5-row hardcoded demo array.
const RiskEventsCard = () => {
  const [rows, setRows] = React.useState(null);
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const j = await window.fetchApi('/api/audit?limit=100');
        if (cancelled) return;
        if (!j || !j.ok) { setRows([]); return; }
        const INTERESTING = /^(order\.blocked|risk\.|circuit\.|kill|broker\.(disconnect|stale))/;
        const matched = (j.rows || [])
          .filter(r => INTERESTING.test(String(r.event || '')))
          .slice(0, 10)
          .map(r => {
            const evt = String(r.event || '');
            const sev = /kill|critical|broker\.disconnect/.test(evt) ? 'down'
                      : /blocked|breach|halted|stale/.test(evt) ? 'warn'
                      : 'info';
            const when = r.ts ? new Date(r.ts).toLocaleString('en-IN', {
              month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
            }) : '—';
            return {
              t: when,
              sev,
              r: evt,
              a: r.data ? JSON.stringify(r.data).slice(0, 80) : '—',
            };
          });
        setRows(matched);
      } catch { setRows([]); }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <Card title="Risk events" sub={rows == null ? 'Loading…' : (rows.length === 0 ? 'No risk events — feed is clean' : `Last ${rows.length}`)} flush>
      {rows == null ? (
        <div className="muted" style={{ padding: '12px 14px', fontSize: 12 }}>Loading audit feed…</div>
      ) : rows.length === 0 ? (
        <div className="muted" style={{ padding: '20px 14px', fontSize: 12, textAlign: 'center' }}>
          No risk-relevant events in the last 100 audit rows. Feed updates every 15s.
        </div>
      ) : (
        <table className="table">
          <thead><tr><th>When</th><th>Severity</th><th>Event</th><th>Detail</th></tr></thead>
          <tbody>
            {rows.map((e, i) => (
              <tr key={i}>
                <td className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>{e.t}</td>
                <td><Pill kind={e.sev}>{e.sev === 'down' ? 'critical' : e.sev === 'warn' ? 'warning' : 'info'}</Pill></td>
                <td style={{ fontWeight: 500 }} className="mono">{e.r}</td>
                <td><span className="muted mono" style={{ fontSize: 11 }}>{e.a}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
};

const RiskScreen = () => {
  const [kill, setKill] = useState(false);

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-header__title">Risk controls</h1>
          <div className="page-header__sub">Hard limits, kill switch, per-strategy caps. Enforced before every order.</div>
        </div>
        <div className="page-header__right">
          <button className="btn"><I.download size={14}/> Export rules</button>
        </div>
      </div>

      {window.RiskPredictor && <div style={{ marginBottom: 16 }}><window.RiskPredictor/></div>}

      {/* T99-T91: honest banner — the 'Global limits' progress bars
          (32% / 42% etc.), 'Per-strategy caps' rows (Momentum AI ₹8L /
          Mean Reversion ₹6L / Grid Trader ₹4L near-cutoff / etc.), and
          'Risk events' table (5 fake recent events) are all demo data.
          The kill switch toggle IS local UI state (no backend yet either).
          Same disclosure pattern as T-82/T-83/T-85/T-86. */}
      <div role="note" style={{
        padding: '8px 12px', marginBottom: 12, borderRadius: 6,
        border: '1px solid color-mix(in oklab, var(--warn, #d97706) 35%, var(--border))',
        background: 'color-mix(in oklab, var(--warn, #d97706) 8%, transparent)',
        fontSize: 12, color: 'var(--text-2)',
      }}>
        <strong>Risk dashboard is demo data.</strong>{' '}
        The Global limits, Per-strategy caps, and Risk events tables below are
        hardcoded examples. Per-user risk-limit storage and a per-user event
        log haven't shipped yet. The kill-switch toggle is local UI only — it
        does not stop live trading. Don't rely on the limits shown for real
        risk management.
      </div>

      {/* Kill switch */}
      <Card style={{ marginBottom: 16, background: kill ? "var(--down-soft)" : "var(--surface)", borderColor: kill ? "var(--down)" : "var(--border)" }}>
        <div className="between">
          <div className="row" style={{ gap: 14 }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: kill ? "var(--down)" : "var(--down-soft)", color: kill ? "white" : "var(--down)", display: "grid", placeItems: "center" }}>
              <I.stop size={22}/>
            </div>
            <div>
              <div style={{ fontSize: 17, fontWeight: 600 }}>Master kill switch</div>
              <div className="muted" style={{ fontSize: 13 }}>Halts ALL automated trading, cancels open orders, pauses every strategy. Manual trading remains enabled.</div>
            </div>
          </div>
          <button className={"btn " + (kill ? "btn--primary" : "btn--danger")} onClick={() => setKill(!kill)} style={{ padding: "12px 22px" }}>
            {kill ? <><I.play size={14}/> Re-enable trading</> : <><I.stop size={14}/> Engage kill switch</>}
          </button>
        </div>
      </Card>

      <div className="grid grid-4" style={{ marginBottom: 16 }}><LiveRiskCards/></div>

      {/* Per-mode limits — capital & loss ceilings per trading mode */}
      <Card title="Per-mode limits" sub="Capital allocation and daily loss caps per mode. Breach → mode pauses, others continue." style={{ marginBottom: 16 }} flush>
        <table className="table">
          <thead>
            <tr>
              <th>Mode</th>
              <th className="num-l">Capital cap</th>
              <th className="num-l">Deployed</th>
              <th>Utilization</th>
              <th className="num-l">Daily loss cap</th>
              <th className="num-l">Used today</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {/* T-353b: Was 4 hardcoded mode rows with literal cap/deployed/loss values.
                T-342 claimed to gate this but JSX was untouched -- still shipped fake
                limits to every user. No per-mode risk-storage backend yet, so render
                empty rows pointing the user at where these will be configured. */}
            {[
              { id: "intraday", cap: 0, deployed: 0, lossCap: 0, lossUsed: 0, state: "idle" },
              { id: "swing",    cap: 0, deployed: 0, lossCap: 0, lossUsed: 0, state: "idle" },
              { id: "options",  cap: 0, deployed: 0, lossCap: 0, lossUsed: 0, state: "idle" },
              { id: "futures",  cap: 0, deployed: 0, lossCap: 0, lossUsed: 0, state: "idle" },
            ].map(row => {
              const meta = window.MODE_META[row.id];
              // T-353b: guard 0/0 -- empty-state rows have cap=0/lossCap=0 which
              // would otherwise render "NaN%" and trip the visual-rendering spec.
              const util   = row.cap > 0     ? Math.round((row.deployed / row.cap) * 100)    : 0;
              const lossP  = row.lossCap > 0 ? Math.round((row.lossUsed / row.lossCap) * 100) : 0;
              return (
                <tr key={row.id}>
                  <td>
                    <span className="row" style={{ gap: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: meta.color }}/>
                      <div className="col" style={{ gap: 1 }}>
                        <span style={{ fontWeight: 500 }}>{meta.label}</span>
                        <span className="muted" style={{ fontSize: 10, fontFamily: "var(--mono)" }}>
                          alloc on <a href="#modes" style={{ color: "var(--text-3)" }}>Modes</a>
                        </span>
                      </div>
                    </span>
                  </td>
                  <td className="num mono">{inrCompact(row.cap)}</td>
                  <td className="num mono">{row.deployed === 0 ? <span className="muted">—</span> : inrCompact(row.deployed)}</td>
                  <td style={{ minWidth: 140 }}>
                    <div className="row" style={{ gap: 8 }}>
                      <div style={{ flex: 1 }}><Progress value={util} kind={util > 85 ? "warn" : "info"}/></div>
                      <span className="mono" style={{ fontSize: 11, color: "var(--text-3)", minWidth: 32, textAlign: "right" }}>{util}%</span>
                    </div>
                  </td>
                  <td className="num mono">{inr(row.lossCap)}</td>
                  <td className="num mono">
                    <span className={lossP > 70 ? "down" : ""}>
                      {row.lossUsed === 0 ? <span className="muted">—</span> : inr(row.lossUsed)}
                    </span>
                  </td>
                  <td>
                    {row.state === "warn" ? <Pill kind="warn" dot>near cap</Pill>
                      : row.state === "idle" ? <Pill kind="muted" dot>idle</Pill>
                      : <Pill kind="up" dot>ok</Pill>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ padding: "10px 16px", borderTop: "1px solid var(--border)", background: "var(--bg-soft)", fontSize: 11, color: "var(--text-3)" }}>
          <I.shield size={12} style={{ verticalAlign: -1, marginRight: 6 }}/>
          Mode-level breach isolates failure: only that mode pauses. Global kill switch affects all modes.
        </div>
      </Card>

      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <Card title="Global limits" sub="Portfolio-wide safety net">
          {/* T-353b: Was 6 hardcoded limits ("Daily loss ₹15,000", "Max leverage 3.0x",
              etc.) rendered to every user. T-342 said it was gated, but never gated.
              No backend yet for per-user global limits -- show empty-state with a
              pointer to Settings where they'll be configured. */}
          <div className="col" style={{ gap: 10, padding: "8px 4px" }}>
            <div className="muted" style={{ fontSize: 12 }}>
              No portfolio-wide limits configured yet. Once per-user risk storage ships,
              your daily-loss cap, max position size, leverage ceiling, and circuit-breaker
              cooldown will be editable from Settings → Risk.
            </div>
            <a href="#settings" className="btn btn--sm" style={{ alignSelf: "flex-start", marginTop: 4 }}>
              Configure in Settings
            </a>
          </div>
        </Card>

        <Card title="Per-strategy caps" sub="Capital ceilings and loss cutoffs">
          {/* T-353b: Was 6 hardcoded strategy caps (Momentum AI ₹8L, Mean Reversion ₹6L,
              etc.) rendered to every user. T-342 claimed to gate -- never did. Empty
              state until backend per-strategy cap storage ships; point user at the
              Strategies screen where they'll be set. */}
          <div className="col" style={{ gap: 10, padding: "16px" }}>
            <div className="muted" style={{ fontSize: 12 }}>
              Per-strategy capital caps and loss cutoffs are configured per strategy.
              No strategies have caps assigned yet.
            </div>
            <a href="#strategies" className="btn btn--sm" style={{ alignSelf: "flex-start" }}>
              Go to Strategies
            </a>
          </div>
        </Card>
      </div>

      <RiskEventsCard/>
    </>
  );
};

Object.assign(window, { RiskScreen });
