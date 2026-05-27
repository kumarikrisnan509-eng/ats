/* eslint-disable */
// @ts-check
/* Trading Modes screen — master controls for Intraday / Swing / Options / Futures */

const ModesScreen = () => {
  const ms = window.useModeState();
  const { state, toggleMode, setField, killAllModes, saveNow, activeCount, totalCapitalPct } = ms;

  // R8.P13 — mode-switch confirmation. Turning a mode OFF with open positions or live capital
  // is destructive (cancels working orders, optionally squares off). Always confirm; never silent.
  const [pendingToggle, setPendingToggle] = React.useState(null);   // mode id to disable
  const [pendingDisableAll, setPendingDisableAll] = React.useState(false);
  // T-487: surface backend save result on Save allocation click.
  const [saveStatus, setSaveStatus] = React.useState(null);

  const requestToggle = (id) => {
    // Enabling is non-destructive — fire immediately.
    if (!state[id].enabled) { toggleMode(id); return; }
    setPendingToggle(id);
  };

  // T99-T134: total capital pulled from /api/me/dashboard-summary
  // (portfolioValue from live broker holdings + cashPaper from the paper
  // wallet). Falls back to 0 when the user has no broker connected — in
  // that case the per-mode capital slider math returns 0 too, which the UI
  // renders as "—" via the existing isFiniteNumber check. We never silently
  // substitute a fake number like the previous ₹45L hardcode.
  const [liveCapital, setLiveCapital] = React.useState(null);
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/me/dashboard-summary', { credentials: 'include' });
        if (!r.ok) return;
        const j = await r.json();
        if (cancelled || !j || !j.ok) return;
        const portfolio = Number(j.portfolioValue || 0);
        const paperCash = Number(j.cashPaper || 0);
        setLiveCapital(portfolio + paperCash);
      } catch (_) { /* leave liveCapital null -> falls back below */ }
    })();
    return () => { cancelled = true; };
  }, []);
  const TOTAL_CAPITAL = (liveCapital != null && Number.isFinite(liveCapital)) ? liveCapital : 0;
  const HAS_LIVE_CAPITAL = TOTAL_CAPITAL > 0;
  const CASH_BUFFER_PCT = Math.max(0, 100 - totalCapitalPct);
  const capitalFor = (id) => HAS_LIVE_CAPITAL ? (TOTAL_CAPITAL * state[id].capitalPct) / 100 : 0;

  // T-185 (SCREENS-AUDIT F-7): per-mode runtime now reads from
  // /api/me/modes/runtime when the user is authenticated. Falls back to
  // zeros if the API errors / 401s / 503s -- the existing banner still
  // discloses any zero values as "not yet aggregated."
  //
  // Demo mode is respected: window.MockData.isDemoOn() short-circuits the
  // fetch and keeps the (also-zeroed) constants below, so demo viewers
  // don't unexpectedly see a real user's positions if they share a session.
  const ZERO_RUNTIME = {
    intraday: { openPositions: 0, utilized: 0, todayPnl: 0, strategiesRunning: 0 },
    swing:    { openPositions: 0, utilized: 0, todayPnl: 0, strategiesRunning: 0 },
    options:  { openPositions: 0, utilized: 0, todayPnl: 0, strategiesRunning: 0 },
    futures:  { openPositions: 0, utilized: 0, todayPnl: 0, strategiesRunning: 0 },
  };
  const [RUNTIME, setRuntime] = React.useState(ZERO_RUNTIME);
  React.useEffect(() => {
    const isDemo = (typeof window !== 'undefined' && window.MockData && typeof window.MockData.isDemoOn === 'function' && window.MockData.isDemoOn());
    if (isDemo) return; // keep zeros in demo mode
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/me/modes/runtime', { credentials: 'include' });
        if (!r.ok) return;
        const j = await r.json();
        if (cancelled || !j || !j.ok || !j.runtime) return;
        // Overlay the response onto ZERO_RUNTIME so missing modes still render zeros.
        const merged = { ...ZERO_RUNTIME };
        for (const k of Object.keys(ZERO_RUNTIME)) {
          if (j.runtime[k] && typeof j.runtime[k] === 'object') {
            merged[k] = {
              openPositions:     Number(j.runtime[k].openPositions     || 0),
              utilized:          Number(j.runtime[k].utilized          || 0),
              todayPnl:          Number(j.runtime[k].todayPnl          || 0),
              strategiesRunning: Number(j.runtime[k].strategiesRunning || 0),
            };
          }
        }
        setRuntime(merged);
      } catch (e) { /* leave zeros on error -- the banner already discloses */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const [detailMode, setDetailMode] = useState("intraday");

  const totalPnl = Object.values(RUNTIME).reduce((s,r) => s + r.todayPnl, 0);

  return (
    <>
      <div className="page-header">
        <div>
          <div className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
            Active modes · multi-select · capital allocation
          </div>
          <h1 className="page-header__title">Trading Modes</h1>
          <div className="page-header__sub">
            {activeCount} / 4 modes active · {totalCapitalPct}% capital allocated · {CASH_BUFFER_PCT}% reserve
          </div>
        </div>
        <div className="page-header__right">
          <button className="btn" onClick={() => setPendingDisableAll(true)}>
            <I.stop size={12}/> Disable all modes
          </button>
          <button className="btn btn--primary" onClick={async () => {
            // T-487: was a button with NO onClick handler -- visual-only fake.
            // Now PUTs activeModes to backend via saveNow().
            setSaveStatus({ status: 'saving' });
            const r = await saveNow();
            if (r.ok) {
              setSaveStatus({ status: 'ok', at: Date.now() });
              setTimeout(() => setSaveStatus(null), 3000);
            } else {
              setSaveStatus({ status: 'error', reason: r.reason });
              setTimeout(() => setSaveStatus(null), 5000);
            }
          }}>
            <I.check size={12}/> {saveStatus && saveStatus.status === 'saving' ? 'Saving...' : saveStatus && saveStatus.status === 'ok' ? 'Saved' : saveStatus && saveStatus.status === 'error' ? 'Save failed' : 'Save allocation'}
          </button>
        </div>
      </div>

      {/* Banner explaining the hierarchy */}
      <div style={{ padding: "12px 16px", background: "var(--bg-soft)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)", marginBottom: 12, display: "flex", gap: 14, alignItems: "center", fontSize: 12, color: "var(--text-2)" }}>
        <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-3)" }}>HIERARCHY</div>
        <div>Modes <span style={{ color: "var(--text-4)" }}>→</span> Strategies <span style={{ color: "var(--text-4)" }}>→</span> Signals <span style={{ color: "var(--text-4)" }}>→</span> Orders</div>
        <div style={{ flex: 1 }}/>
        <div style={{ fontSize: 11, color: "var(--text-3)" }}>Disabling a mode <strong>hard-gates</strong> both signal pipeline and broker adapter</div>
      </div>

      {/* T99-T82 / T99-T134: honest banner — Mode toggles, capital sliders,
          AND total capital (from /api/me/dashboard-summary) are now live.
          Per-mode runtime numbers (open positions, utilized, today's PnL,
          strategies running) remain demo until per-mode position aggregation
          backend ships. */}
      <div role="note" style={{
        padding: '8px 12px', marginBottom: 20, borderRadius: 6,
        border: '1px solid color-mix(in oklab, var(--warn, #d97706) 35%, var(--border))',
        background: 'color-mix(in oklab, var(--warn, #d97706) 8%, transparent)',
        fontSize: 12, color: 'var(--text-2)',
      }}>
        <strong>
          {HAS_LIVE_CAPITAL
            ? 'Mode toggles, capital sliders, and total capital are live;'
            : 'Connect a broker to enable live capital allocation;'}
        </strong>{' '}
        {HAS_LIVE_CAPITAL
          ? <>per-mode runtime numbers (open positions, utilized, today's PnL,
             strategies running) remain demo data until per-mode position
             aggregation ships.</>
          : <>total capital reads as ₹0 until a broker connection or a paper
             starting balance is set. Mode toggles still persist.</>}
      </div>

      {/* Mode cards — 4 wide */}
      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        {window.MODE_IDS.map(id => {
          const meta = window.MODE_META[id];
          const s = state[id];
          const rt = RUNTIME[id];
          const warnings = meta.warnings(s);
          const active = s.enabled;
          return (
            <div key={id}
              onClick={() => setDetailMode(id)}
              style={{
                background: "var(--surface)",
                border: "1px solid " + (detailMode === id ? meta.color : "var(--border)"),
                borderRadius: "var(--r-lg)",
                padding: 18,
                display: "flex", flexDirection: "column", gap: 12,
                opacity: active ? 1 : 0.68,
                cursor: "pointer",
                position: "relative",
                transition: "border-color .15s, opacity .15s",
              }}
            >
              {/* colored left stripe */}
              <div style={{
                position: "absolute", left: 0, top: 12, bottom: 12, width: 3,
                background: active ? meta.color : "var(--border-strong)", borderRadius: "0 3px 3px 0",
              }}/>

              {/* header row */}
              <div className="between">
                <div>
                  <div style={{ fontSize: 11, fontFamily: "var(--mono)", color: "var(--text-3)", letterSpacing: "0.05em" }}>
                    {meta.shortLabel} · {meta.product}
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em", marginTop: 2 }}>{meta.label}</div>
                </div>
                <Toggle on={active} onClick={(e) => { e.stopPropagation(); requestToggle(id); }}/>
              </div>

              <div className="muted" style={{ fontSize: 11, lineHeight: 1.4 }}>{meta.tagline}</div>

              {/* key stats */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div>
                  <div className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4 }}>Today</div>
                  <div style={{ fontSize: 14, fontWeight: 500 }} className={rt.todayPnl > 0 ? "up mono" : rt.todayPnl < 0 ? "down mono" : "mono muted"}>
                    {rt.todayPnl >= 0 ? "+" : ""}{window.inrCompact ? window.inrCompact(rt.todayPnl) : "₹" + rt.todayPnl.toLocaleString("en-IN")}
                  </div>
                </div>
                <div>
                  <div className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4 }}>Positions</div>
                  <div className="mono" style={{ fontSize: 14, fontWeight: 500 }}>{rt.openPositions}</div>
                </div>
              </div>

              {/* capital allocation slider */}
              <div>
                <div className="between" style={{ fontSize: 11, marginBottom: 4 }}>
                  <span className="muted">Allocation</span>
                  <span className="mono" style={{ fontWeight: 500 }}>{s.capitalPct}% · {inrCompact(capitalFor(id))}</span>
                </div>
                <input type="range" min="0" max="60" step="5" value={s.capitalPct}
                  onChange={(e) => setField(id, "capitalPct", +e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  disabled={!active}
                  style={{ width: "100%", accentColor: meta.color, opacity: active ? 1 : 0.4 }}/>
              </div>

              {/* utilization bar — T-429 (audit-2026-05-26 frontend H10):
                  guard divide-by-zero. capitalFor(id) is 0 when the user has
                  no broker (HAS_LIVE_CAPITAL=false); old code rendered
                  "Infinity%" and an invalid CSS width. */}
              {(() => {
                const _cap = capitalFor(id);
                const _pct = _cap > 0 ? (rt.utilized / _cap) * 100 : 0;
                return (
                  <div>
                    <div className="between" style={{ fontSize: 10, marginBottom: 3 }}>
                      <span className="muted">Utilized</span>
                      <span className="mono">{Math.round(_pct) || 0}%</span>
                    </div>
                    <div className="progress"><div className="progress__fill" style={{
                      width: Math.min(100, Math.max(0, _pct)) + "%",
                      background: meta.color,
                    }}/></div>
                  </div>
                );
              })()}

              {/* warnings */}
              {warnings.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {warnings.map((w, i) => (
                    <div key={i} className={w.kind} style={{ fontSize: 11, display: "flex", gap: 6, alignItems: "center" }}>
                      <span style={{ width: 4, height: 4, borderRadius: "50%", background: "currentColor" }}/>
                      {w.text}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Capital allocation + today P&L overview */}
      <div className="grid grid-2-1" style={{ marginBottom: 20 }}>
        <Card title="Capital allocation" sub={`₹${(TOTAL_CAPITAL/100000).toFixed(1)}L total · ${CASH_BUFFER_PCT}% reserve`}>
          <AllocationBar state={state} capitalFor={capitalFor} cashBuffer={CASH_BUFFER_PCT}/>
          <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10 }}>
            {[...window.MODE_IDS, "cash"].map(id => {
              const isCash = id === "cash";
              const meta = isCash ? { label: "Cash", color: "var(--text-4)" } : window.MODE_META[id];
              const s = isCash ? null : state[id];
              const amt = isCash ? TOTAL_CAPITAL * CASH_BUFFER_PCT / 100 : capitalFor(id);
              const p = isCash ? CASH_BUFFER_PCT : (s.enabled ? s.capitalPct : 0);
              return (
                <div key={id}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11, marginBottom: 4 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: meta.color }}/>
                    <span className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4 }}>{meta.label}</span>
                  </div>
                  <div className="mono" style={{ fontSize: 14, fontWeight: 500 }}>{p}%</div>
                  <div className="mono muted" style={{ fontSize: 10 }}>{inrCompact(amt)}</div>
                </div>
              );
            })}
          </div>
        </Card>
        <Card title="Today across modes" sub="Live P&L roll-up">
          <div style={{ padding: "6px 0 12px" }}>
            <div className={"stat__value " + (totalPnl >= 0 ? "up" : "down")} style={{ fontSize: 28 }}>
              {totalPnl >= 0 ? "+" : ""}{inrCompact(totalPnl)}
            </div>
            <div className="muted" style={{ fontSize: 11 }}>Combined P&L · all modes</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {window.MODE_IDS.map(id => {
              const meta = window.MODE_META[id];
              const rt = RUNTIME[id];
              const s = state[id];
              return (
                <div key={id} className="between" style={{ fontSize: 12, paddingBottom: 6, borderBottom: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.enabled ? meta.color : "var(--text-4)" }}/>
                    <span>{meta.label}</span>
                    {!s.enabled && <Pill kind="">Off</Pill>}
                  </div>
                  <span className={"mono " + (rt.todayPnl > 0 ? "up" : rt.todayPnl < 0 ? "down" : "muted")}>
                    {rt.todayPnl >= 0 ? "+" : ""}{inrCompact(rt.todayPnl)}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Tabs for mode detail */}
      <div className="tabs">
        {window.MODE_IDS.map(id => (
          <button key={id} className={detailMode === id ? "on" : ""} onClick={() => setDetailMode(id)}>
            {window.MODE_META[id].label}
            <span className="muted" style={{ marginLeft: 6, fontSize: 11 }}>
              {state[id].enabled ? "●" : "○"}
            </span>
          </button>
        ))}
      </div>

      <ModeDetail id={detailMode} state={state[detailMode]} setField={setField} runtime={RUNTIME[detailMode]} capitalFor={capitalFor}/>

      {/* Per-mode disable confirmation — context-aware: surfaces open positions + capital at stake */}
      {pendingToggle && (() => {
        const meta = window.MODE_META[pendingToggle];
        const rt = RUNTIME[pendingToggle];
        const hasOpen = rt.openPositions > 0;
        return (
          <window.ConfirmModal
            open
            onClose={() => setPendingToggle(null)}
            onConfirm={() => { toggleMode(pendingToggle); setPendingToggle(null); }}
            title={`Disable ${meta.label} mode?`}
            sub={hasOpen ? "This mode has live exposure — confirm before halting." : "No open positions · safe to disable."}
            tone={hasOpen ? "danger" : "warn"}
            confirmLabel={hasOpen ? `Halt ${meta.label}` : "Disable mode"}
            detail={hasOpen
              ? <>New entries will be blocked immediately. <strong>Open positions stay open</strong> — square them off manually from Trading, or use the Kill switch to flatten everything.</>
              : <>{rt.strategiesRunning} strategies in this mode will be gated. Re-enable any time without losing config.</>
            }
            facts={[
              ["Open positions", rt.openPositions],
              ["Strategies gated", `${meta.strategies.length} (${rt.strategiesRunning} running)`],
              ["Capital deployed", window.inrCompact(rt.utilized), rt.utilized > 0 ? "down" : "muted"],
              ["Today's P&L", (rt.todayPnl >= 0 ? "+" : "") + window.inrCompact(rt.todayPnl), rt.todayPnl > 0 ? "up" : rt.todayPnl < 0 ? "down" : "muted"],
            ]}
          />
        );
      })()}

      {/* Disable-all confirmation — coarse halt of automation, requires typed "HALT" */}
      {pendingDisableAll && (() => {
        const totalOpen = Object.values(RUNTIME).reduce((s, r) => s + r.openPositions, 0);
        const totalUtilized = Object.values(RUNTIME).reduce((s, r) => s + r.utilized, 0);
        return (
          <window.ConfirmModal
            open
            onClose={() => setPendingDisableAll(false)}
            onConfirm={() => { killAllModes(); setPendingDisableAll(false); }}
            title="Disable all 4 modes?"
            sub="Pauses every strategy. Open positions are NOT squared off."
            tone="danger"
            confirmLabel="Halt all automation"
            typeToConfirm="HALT"
            detail={<>All signals will be discarded and broker adapter will refuse new orders for every mode. To also flatten open positions, use the <strong>Kill switch</strong> in the top bar (requires 2FA).</>}
            facts={[
              ["Modes to disable",  `${activeCount} active`],
              ["Open positions",    totalOpen],
              ["Capital deployed",  window.inrCompact(totalUtilized), totalUtilized > 0 ? "down" : "muted"],
            ]}
          />
        );
      })()}

      {window.PositionHandlingMatrix && <window.PositionHandlingMatrix/>}
    </>
  );
};

// Horizontal stacked bar showing capital split across modes
const AllocationBar = ({ state, capitalFor, cashBuffer }) => {
  return (
    <div style={{ display: "flex", height: 44, borderRadius: "var(--r-md)", overflow: "hidden", border: "1px solid var(--border)" }}>
      {window.MODE_IDS.map(id => {
        const meta = window.MODE_META[id];
        const s = state[id];
        if (!s.enabled || s.capitalPct === 0) return null;
        return (
          <div key={id} style={{
            flex: s.capitalPct,
            background: meta.color,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "white", fontSize: 11, fontWeight: 500, fontFamily: "var(--mono)",
            borderRight: "1px solid rgba(255,255,255,0.2)",
          }} title={`${meta.label}: ${s.capitalPct}%`}>
            {s.capitalPct >= 8 && `${meta.shortLabel} ${s.capitalPct}%`}
          </div>
        );
      })}
      {cashBuffer > 0 && (
        <div style={{
          flex: cashBuffer,
          background: "repeating-linear-gradient(45deg, var(--bg-sunk) 0 8px, var(--bg-soft) 8px 16px)",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "var(--text-3)", fontSize: 11, fontWeight: 500, fontFamily: "var(--mono)",
        }} title={`Cash reserve: ${cashBuffer}%`}>
          {cashBuffer >= 8 && `Cash ${cashBuffer}%`}
        </div>
      )}
    </div>
  );
};

// Per-mode detail panel (strategies, rules, risk limits)
const ModeDetail = ({ id, state, setField, runtime, capitalFor }) => {
  const meta = window.MODE_META[id];
  const active = state.enabled;

  return (
    <div className="grid grid-3" style={{ gap: 20 }}>
      <Card title="Mode rules" sub="How this mode behaves in production">
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {[
            ["Product type",    meta.product],
            ["Leverage",        meta.leverage],
            ["Margin basis",    meta.margin],
            ["Hours",           meta.hours],
            ["Hold period",     meta.holdPeriod],
            ["Square-off",      meta.squareoffAt],
            ["Risk profile",    meta.riskProfile],
          ].map(([k, v]) => (
            <div key={k} className="between" style={{ padding: "8px 0", borderBottom: "1px solid var(--border)", fontSize: 12 }}>
              <span className="muted">{k}</span>
              <span className="mono">{v}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Risk limits" sub="Hard caps · engine will refuse orders that breach">
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <LimitSlider label="Daily loss cap" value={state.dailyLossCapPct} max={5} step={0.25} unit="%"
            onChange={v => setField(id, "dailyLossCapPct", v)}
            sub={`Pauses mode if realized loss > ₹${((capitalFor(id) * state.dailyLossCapPct / 100) | 0).toLocaleString("en-IN")}`}
            color={meta.color} disabled={!active}/>
          <LimitSlider label="Max open positions" value={state.maxPositions} max={20} step={1} unit=""
            onChange={v => setField(id, "maxPositions", v)}
            sub={`Currently ${runtime.openPositions}`}
            color={meta.color} disabled={!active}/>
          <LimitSlider label="Max per-trade exposure" value={state.maxPerTradePct} max={15} step={0.5} unit="%"
            onChange={v => setField(id, "maxPerTradePct", v)}
            sub={`Max ₹${((capitalFor(id) * state.maxPerTradePct / 100) | 0).toLocaleString("en-IN")} per order`}
            color={meta.color} disabled={!active}/>
        </div>
      </Card>

      <Card title="Strategies in this mode" sub={`${meta.strategies.length} strategies · ${runtime.strategiesRunning} running`}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {meta.strategies.map((s, i) => {
            const stageBadge = { live: { kind: "up", txt: "LIVE" }, paper: { kind: "info", txt: "PAPER" }, paused: { kind: "warn", txt: "PAUSED" }, draft: { kind: "", txt: "DRAFT" } }[s.st];
            const gated = !active;
            return (
              <div key={s.n} className="between" style={{ padding: "10px 12px", background: "var(--bg-soft)", borderRadius: "var(--r-md)", fontSize: 13, opacity: gated ? 0.6 : 1 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row" style={{ gap: 8, marginBottom: 2 }}>
                    <span style={{ fontWeight: 500 }}>{s.n}</span>
                    <Pill kind={stageBadge.kind} dot>{stageBadge.txt}</Pill>
                    {gated && <Pill kind="warn">MODE OFF</Pill>}
                  </div>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {s.k} · {s.desc}
                  </div>
                </div>
                <div className="row" style={{ gap: 16, flexShrink: 0 }}>
                  <div style={{ textAlign: "right" }}>
                    <div className={"mono " + (s.pnl30 > 0 ? "up" : s.pnl30 < 0 ? "down" : "muted")} style={{ fontSize: 12, fontWeight: 500 }}>
                      {s.pnl30 > 0 ? "+" : ""}{s.pnl30 === 0 ? "—" : inr(s.pnl30)}
                    </div>
                    <div className="muted" style={{ fontSize: 10 }}>30d P&L</div>
                  </div>
                  <div style={{ textAlign: "right", minWidth: 50 }}>
                    <div className="mono" style={{ fontSize: 12, fontWeight: 500 }}>{s.winR || "—"}{s.winR ? "%" : ""}</div>
                    <div className="muted" style={{ fontSize: 10 }}>win</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
};

const LimitSlider = ({ label, value, max, step, unit, onChange, sub, color, disabled }) => (
  <div>
    <div className="between" style={{ marginBottom: 4 }}>
      <span style={{ fontSize: 12, fontWeight: 500 }}>{label}</span>
      <span className="mono" style={{ fontSize: 13, fontWeight: 500 }}>{value}{unit}</span>
    </div>
    <input type="range" min="0" max={max} step={step} value={value}
      onChange={(e) => onChange(+e.target.value)}
      disabled={disabled}
      style={{ width: "100%", accentColor: color, opacity: disabled ? 0.4 : 1 }}/>
    {sub && <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{sub}</div>}
  </div>
);

Object.assign(window, { ModesScreen });