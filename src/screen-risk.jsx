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
  // T-425 (audit-2026-05-26 frontend C2): kill-switch is now READ-ONLY
  // status from /api/kill-switch (the canonical server-side flag).
  // Was: useState(false) -- a button that did nothing but flip colour.
  // Operators clicking thought they killed trading; they hadn't.
  // No POST endpoint exists; KILL_SWITCH is /etc/ats/backend.env. The
  // honest display below shows current server state; toggling requires
  // editing backend.env and restarting the container (operator-only).
  const [killActive, setKillActive] = React.useState(null); // null = loading
  React.useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const r = await fetch('/api/kill-switch', { credentials: 'include' });
        if (!r.ok) return;
        const j = await r.json();
        if (!cancelled) setKillActive(!!j.killSwitch);
      } catch (e) { /* network blip, leave previous value */ }
    };
    poll();
    const t = setInterval(poll, 10000); // every 10s
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  // T-353b follow-up: REAL per-mode limits. Mirrors the Modes screen — caps from
  // /api/me/risk-config (config.activeModes[id].capitalPct / dailyLossCapPct,
  // MODE_META.defaults fallback), total capital = portfolioValue + cashPaper from
  // /api/me/dashboard-summary, deployed + today's P&L from /api/me/modes/runtime.
  const [perMode, setPerMode] = React.useState(/** @type {any} */ (null));
  const [riskCfg, setRiskCfg] = React.useState(/** @type {any} */ (null));
  React.useEffect(() => {
    if (window.MockData && window.MockData.isDemoOn && window.MockData.isDemoOn()) return;
    let cancelled = false;
    (async () => {
      try {
        const [rc, ds, rt] = await Promise.all([
          window.fetchApi('/api/me/risk-config').catch(() => null),
          window.fetchApi('/api/me/dashboard-summary').catch(() => null),
          window.fetchApi('/api/me/modes/runtime').catch(() => null),
        ]);
        if (cancelled) return;
        const am = (rc && rc.config && rc.config.activeModes && typeof rc.config.activeModes === 'object') ? rc.config.activeModes : {};
        const totalCapital = Number((ds && ds.portfolioValue) || 0) + Number((ds && ds.cashPaper) || 0);
        const runtime = (rt && rt.runtime && typeof rt.runtime === 'object') ? rt.runtime : {};
        const ids = (window.MODE_IDS && window.MODE_IDS.length) ? window.MODE_IDS : ['intraday', 'swing', 'options', 'futures'];
        const rows = ids.map((id) => {
          const defs = (window.MODE_META && window.MODE_META[id] && window.MODE_META[id].defaults) || {};
          const m = am[id] || {};
          const capPct = Number(m.capitalPct != null ? m.capitalPct : (defs.capitalPct || 0));
          const lossPct = Number(m.dailyLossCapPct != null ? m.dailyLossCapPct : (defs.dailyLossCapPct || 0));
          const enabled = (m.enabled != null) ? (m.enabled !== false) : (defs.enabled !== false);
          const cap = totalCapital > 0 ? Math.round((totalCapital * capPct) / 100) : 0;
          const lossCap = cap > 0 ? Math.round((cap * lossPct) / 100) : 0;
          const r = runtime[id] || {};
          const deployed = Number(r.utilized || 0);
          const todayPnl = Number(r.todayPnl || 0);
          const lossUsed = todayPnl < 0 ? Math.round(-todayPnl) : 0;
          const util = cap > 0 ? (deployed / cap) * 100 : 0;
          const lossP = lossCap > 0 ? (lossUsed / lossCap) * 100 : 0;
          const state = !enabled ? 'idle' : (deployed <= 0 ? 'idle' : ((util > 85 || lossP > 70) ? 'warn' : 'ok'));
          return { id, cap, deployed, lossCap, lossUsed, state };
        });
        setPerMode(rows);
        setRiskCfg((rc && rc.config) ? rc.config : null);
      } catch (e) { /* keep null -> empty fallback rows */ }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-header__title">Risk controls</h1>
          <div className="page-header__sub">Hard limits, kill switch, per-strategy caps. Enforced before every order.</div>
        </div>
        <div className="page-header__right">
          <button className="btn" disabled title="Export rules is not available yet"><I.download size={14}/> Export rules</button>
        </div>
      </div>

      {window.RiskPredictor && <div style={{ marginBottom: 16 }}><window.RiskPredictor/></div>}

      {/* T99-T91 + T-425: honest banner — the 'Global limits' progress bars,
          'Per-strategy caps' rows, and 'Risk events' table are all demo data.
          The kill-switch panel below now reflects REAL server state. */}
      <div role="note" style={{
        padding: '8px 12px', marginBottom: 12, borderRadius: 6,
        border: '1px solid color-mix(in oklab, var(--warn, #d97706) 35%, var(--border))',
        background: 'color-mix(in oklab, var(--warn, #d97706) 8%, transparent)',
        fontSize: 12, color: 'var(--text-2)',
      }}>
        <strong>Per-strategy caps are not yet wired.</strong>{' '}
        Per-strategy capital ceilings / loss cutoffs have no per-user storage yet.
        Everything else on this screen reads your real data in live mode: the
        kill-switch state, per-mode limits, global limits (from your risk config),
        and the risk-events feed.
      </div>

      {/* T-425 (audit-2026-05-26 C2): READ-ONLY kill-switch status panel.
          Polls /api/kill-switch every 10s. To engage/disengage, operator
          must edit /etc/ats/backend.env (KILL_SWITCH=true|false) and
          restart the container. No POST endpoint exists yet (deferred
          to a separate task with 2FA gating). */}
      <Card style={{ marginBottom: 16,
        background: killActive ? "var(--down-soft)" : (killActive === false ? "var(--up-soft)" : "var(--surface)"),
        borderColor: killActive ? "var(--down)" : (killActive === false ? "var(--up)" : "var(--border)") }}>
        <div className="between">
          <div className="row" style={{ gap: 14 }}>
            <div style={{ width: 48, height: 48, borderRadius: 12,
              background: killActive ? "var(--down)" : (killActive === false ? "var(--up)" : "var(--bg-soft)"),
              color: killActive ? "white" : (killActive === false ? "white" : "var(--text-3)"),
              display: "grid", placeItems: "center" }}>
              <I.stop size={22}/>
            </div>
            <div>
              <div style={{ fontSize: 17, fontWeight: 600 }}>Master kill switch · server-side</div>
              <div className="muted" style={{ fontSize: 13 }}>
                {killActive === true && "ENGAGED. All automated trading halted server-side (KILL_SWITCH=true in backend.env). New orders blocked at the API gate."}
                {killActive === false && "Disengaged. Automated trading is allowed server-side (KILL_SWITCH=false)."}
                {killActive === null && "Loading current server state from /api/kill-switch..."}
              </div>
            </div>
          </div>
          <div style={{
            padding: "12px 22px", borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--bg-soft)", fontSize: 12, color: "var(--text-2)", maxWidth: 320, textAlign: "right",
          }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>To toggle (operator only)</div>
            <div className="mono" style={{ fontSize: 10 }}>
              ssh root@vm → edit /etc/ats/backend.env<br/>
              KILL_SWITCH=true|false → restart container
            </div>
          </div>
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
            {(perMode || [
              { id: "intraday", cap: 0, deployed: 0, lossCap: 0, lossUsed: 0, state: "idle" },
              { id: "swing",    cap: 0, deployed: 0, lossCap: 0, lossUsed: 0, state: "idle" },
              { id: "options",  cap: 0, deployed: 0, lossCap: 0, lossUsed: 0, state: "idle" },
              { id: "futures",  cap: 0, deployed: 0, lossCap: 0, lossUsed: 0, state: "idle" },
            ]).map(row => {
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
          {riskCfg ? (
          <div className="col" style={{ gap: 6, padding: "8px 4px" }}>
            {[
              { k: "Max position size",  v: riskCfg.maxPositionPct  != null ? (Number(riskCfg.maxPositionPct)  * 100).toFixed(1) + "% of capital" : "\u2014" },
              { k: "Daily loss cap",     v: riskCfg.maxDailyLossPct != null ? (Number(riskCfg.maxDailyLossPct) * 100).toFixed(1) + "% of capital" : "\u2014" },
              { k: "Max open positions", v: riskCfg.maxOpenPositions != null ? String(riskCfg.maxOpenPositions) : "\u2014" },
              { k: "Max trades / day",   v: riskCfg.maxDailyTrades  != null ? String(riskCfg.maxDailyTrades)  : "\u2014" },
              { k: "Max leverage",       v: riskCfg.maxLeverage     != null ? Number(riskCfg.maxLeverage).toFixed(1) + "\u00d7" : "\u2014" },
              { k: "Max sector weight",  v: riskCfg.maxSectorWeight != null ? Math.round(Number(riskCfg.maxSectorWeight) * 100) + "%" : "\u2014" },
              { k: "Trading window (IST)", v: (riskCfg.goldenStartHHMM && riskCfg.goldenEndHHMM) ? (riskCfg.goldenStartHHMM + "\u2013" + riskCfg.goldenEndHHMM) : "\u2014" },
              { k: "Trading mode",       v: String(riskCfg.tradingMode || "paper") },
            ].map((r, i) => (
              <div key={i} className="between" style={{ fontSize: 12, padding: "5px 0", borderBottom: "1px solid var(--border)" }}>
                <span className="muted">{r.k}</span>
                <span className="mono" style={{ fontWeight: 500 }}>{r.v}</span>
              </div>
            ))}
            <a href="#riskconfig" className="btn btn--sm" style={{ alignSelf: "flex-start", marginTop: 6 }}>Edit limits</a>
          </div>
          ) : (
          <div className="col" style={{ gap: 10, padding: "8px 4px" }}>
            <div className="muted" style={{ fontSize: 12 }}>
              Portfolio-wide limits load from your risk config (daily-loss cap, max position size,
              leverage ceiling, trading window). Configure them under Risk management.
            </div>
            <a href="#riskconfig" className="btn btn--sm" style={{ alignSelf: "flex-start", marginTop: 4 }}>
              Configure risk
            </a>
          </div>
          )}
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
