/* eslint-disable */
// @ts-check

// Phase 2 / E6: Live Scanner row with on-demand /critique-rich call.
function SignalRow({ sig, isFirst }) {
  const [busy, setBusy] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [crit, setCrit] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [consensusBusy, setConsensusBusy] = React.useState(false);
  const [consensus, setConsensus] = React.useState(null);
  const [consensusError, setConsensusError] = React.useState(null);

  const sigColor = (sig.signal && (sig.signal.indexOf('OVERSOLD') >= 0 || sig.signal.indexOf('CROSS_UP') >= 0))
    ? 'var(--up)'
    : (sig.signal && (sig.signal.indexOf('OVERBOUGHT') >= 0 || sig.signal.indexOf('CROSS_DOWN') >= 0))
    ? 'var(--down)' : 'var(--text-2)';

  const run = async () => {
    if (crit) { setOpen(o => !o); return; }
    setBusy(true); setError(null);
    try {
      const r = await fetch('/api/me/ai-workflows/critique-rich', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: sig.symbol, signal: sig.signal, value: sig.value, message: sig.message }),
      }).then(r => r.json());
      if (r.ok) { setCrit(r); setOpen(true); }
      else setError(r.detail || r.reason || 'failed');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const askConsensus = async () => {
    if (consensus) { /* toggle expand */ return; }
    setConsensusBusy(true); setConsensusError(null);
    try {
      const r = await fetch('/api/me/ai-workflows/consensus', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: sig.symbol, signal: sig.signal, value: sig.value, message: sig.message }),
      }).then(r => r.json());
      if (r.ok) setConsensus(r);
      else setConsensusError(r.detail || r.reason || 'failed');
    } catch (e) { setConsensusError(e.message); }
    finally { setConsensusBusy(false); }
  };

  const verdictColor = crit && crit.verdict === 'agree' ? 'var(--up)' :
                       crit && crit.verdict === 'reject' ? 'var(--down)' :
                       crit && crit.verdict === 'caution' ? 'var(--warn, #d97706)' : 'var(--text-3)';

  return (
    <div style={{ borderTop: isFirst ? 'none' : '1px solid var(--border)' }}>
      <div style={{ display: 'flex', gap: 12, padding: '6px 0', alignItems: 'center' }}>
        <span className="mono" style={{ minWidth: 120, fontWeight: 600 }}>{sig.symbol}</span>
        <span className="mono" style={{ minWidth: 180, color: sigColor }}>{sig.signal}</span>
        <span className="mono" style={{ minWidth: 80 }}>{typeof sig.value === 'number' ? sig.value.toFixed(2) : (sig.value || '-')}</span>
        <span style={{ flex: 1, fontSize: 11, color: 'var(--text-2)' }}>{sig.message || ''}</span>
        <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>{sig.ts ? new Date(sig.ts).toLocaleTimeString('en-IN') : ''}</span>
        <button
          onClick={run}
          disabled={busy}
          style={{
            padding: '3px 10px', fontSize: 11, borderRadius: 6,
            border: '1px solid ' + (crit ? verdictColor : 'var(--border)'),
            background: crit ? verdictColor : 'var(--surface, transparent)',
            color: crit ? 'white' : 'var(--text-2)',
            cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1,
            textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.4,
          }}
          title={crit ? (open ? 'Hide critique' : 'Show critique') : 'Ask AI to critique this signal'}
        >{busy ? '...' : (crit ? crit.verdict : 'critique')}</button>
        <button
          onClick={askConsensus}
          disabled={consensusBusy}
          style={{
            padding: '3px 10px', fontSize: 11, borderRadius: 6,
            border: '1px solid var(--border)',
            background: consensus ? 'var(--surface-2)' : 'var(--surface, transparent)',
            color: 'var(--text-2)',
            cursor: consensusBusy ? 'wait' : 'pointer', opacity: consensusBusy ? 0.6 : 1,
            textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.4,
          }}
          title="Get a 2nd opinion across all configured providers"
        >{consensusBusy ? '...' : (consensus ? consensus.majority : '2nd op')}</button>
      </div>

      {error && (
        <div style={{ fontSize: 11, color: 'var(--danger, #c53030)', padding: '4px 0' }}>
          critique error: {error}
        </div>
      )}

      {consensusError && (
        <div style={{ fontSize: 11, color: 'var(--danger, #c53030)', padding: '4px 0' }}>consensus: {consensusError}</div>
      )}
      {consensus && (
        <div style={{
          padding: 10, marginBottom: 8, borderRadius: 8,
          border: '1px solid var(--border)',
          background: 'var(--surface-2, rgba(0,0,0,0.02))',
          fontSize: 12,
        }}>
          <div style={{ marginBottom: 6 }}>
            <strong>2nd opinion · {consensus.providers_succeeded}/{consensus.providers_consulted} providers</strong>{' '}
            · majority: <span style={{ fontWeight: 600 }}>{consensus.majority}</span>{' '}
            · {consensus.verdict_note}{' '}
            · ₹{Number(consensus.total_cost_inr || 0).toFixed(4)}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {(consensus.per_provider || []).map((p, i) => (
              <div key={i} style={{
                padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)',
                fontSize: 11, background: 'var(--surface)',
              }}>
                <div style={{ fontWeight: 600 }}>{p.provider}</div>
                {p.error ? (
                  <div style={{ color: 'var(--danger)' }}>{p.error}</div>
                ) : (
                  <div>
                    <span style={{ padding: '1px 6px', borderRadius: 4, background: p.verdict === 'agree' ? 'var(--up)' : p.verdict === 'reject' ? 'var(--danger)' : 'var(--warn, #d97706)', color: 'white', fontWeight: 600, textTransform: 'uppercase' }}>{p.verdict}</span>{' '}
                    <span style={{ color: 'var(--text-3)' }}>{p.confidence}/100</span>
                    <div style={{ marginTop: 2, color: 'var(--text-2)', fontSize: 11 }}>{p.summary}</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {open && crit && (
        <div style={{
          padding: 10, marginBottom: 8, borderRadius: 8,
          border: '1px solid var(--border)',
          background: 'var(--surface-2, rgba(0,0,0,0.02))',
          fontSize: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ padding: '2px 8px', borderRadius: 4, background: verdictColor, color: 'white', fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>{crit.verdict}</span>
            <span style={{ color: 'var(--text-3)' }}>confidence {crit.confidence}/100 · {crit.provider}/{crit.model} · {crit.cached ? 'cached' : '₹' + Number(crit.cost_inr || 0).toFixed(4)}</span>
          </div>
          <div style={{ marginBottom: 6 }}><strong>{crit.summary}</strong></div>
          {crit.context && (
            <div style={{ marginBottom: 6, fontSize: 11, color: 'var(--text-3)', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {crit.context.regime && <span>regime: <span style={{ color: 'var(--text-2)' }}>{crit.context.regime.regime}</span></span>}
              {crit.context.rsi_now != null && <span>· RSI: <span className="mono">{crit.context.rsi_now}</span></span>}
              {crit.context.pct_move_5d != null && <span>· 5d: <span className="mono">{crit.context.pct_move_5d}%</span></span>}
              {crit.context.bench_pct_move != null && <span>· NIFTY 5d: <span className="mono">{crit.context.bench_pct_move}%</span></span>}
              {crit.context.surveillance && <span style={{ color: 'var(--danger)' }}>· SURVEILLANCE: {crit.context.surveillance.list}</span>}
            </div>
          )}
          {crit.key_risks && crit.key_risks.length > 0 && (
            <div style={{ marginBottom: 4 }}>
              <strong>Key risks:</strong>
              <ul style={{ margin: '2px 0 0 18px', padding: 0 }}>
                {crit.key_risks.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
          )}
          {crit.next_step && (
            <div style={{ marginBottom: 6 }}><strong>Next step:</strong> {crit.next_step}</div>
          )}
          {crit.call_id && window.AiFeedback && (
            <div style={{ marginTop: 6 }}>
              <window.AiFeedback callId={crit.call_id} workflow="intraday_critic" compact={true}/>
            </div>
          )}
          {window.SebiDisclaimer && <window.SebiDisclaimer compact={true}/>}
        </div>
      )}
    </div>
  );
}

/* AI Signals pipeline: Signal → Paper → Live → Profit → Long-term */

const ModeGateBanner = () => {
  // Re-render on mode changes
  const [, bump] = React.useReducer(x => x + 1, 0);
  React.useEffect(() => {
    const h = () => bump();
    window.addEventListener("modes-changed", h);
    window.addEventListener("storage", h);
    return () => {
      window.removeEventListener("modes-changed", h);
      window.removeEventListener("storage", h);
    };
  }, []);

  const disabled = window.MODE_IDS.filter(id => !window.isModeActive(id));
  if (disabled.length === 0) return null;

  return (
    <div style={{
      padding: "10px 14px", marginBottom: 16, borderRadius: "var(--r-md)",
      background: "var(--warn-soft)", color: "oklch(45% 0.13 80)",
      display: "flex", alignItems: "center", gap: 10, fontSize: 12,
      border: "1px solid color-mix(in oklab, var(--warn) 25%, transparent)",
    }}>
      <I.shield size={14}/>
      <span>
        <strong>{disabled.length} mode{disabled.length > 1 ? "s" : ""} disabled</strong>
        {" · "}
        Signals for {disabled.map(id => window.MODE_META[id].label).join(", ")} are gated and won't reach the broker.
      </span>
      <span style={{ flex: 1 }}/>
      <a href="#modes" style={{ fontWeight: 500, textDecoration: "underline" }}>Open Trading Modes →</a>
    </div>
  );
};

const SignalsScreen = () => {
  // Re-render when mode gates flip
  const [, bump] = React.useReducer(x => x + 1, 0);
  const [explainSig, setExplainSig] = React.useState(null);
  React.useEffect(() => {
    const h = () => bump();
    window.addEventListener("modes-changed", h);
    return () => window.removeEventListener("modes-changed", h);
  }, []);

  // Real signals from /api/scanner/history. Polled every 30s.
  const [realSignals, setRealSignals] = React.useState([]);
  const [scannerStats, setScannerStats] = React.useState(null);
  React.useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const [hist, stats] = await Promise.all([
          window.fetchApi('/api/scanner/history?limit=20'),
          window.fetchApi('/api/scanner'),
        ]);
        if (cancelled) return;
        setRealSignals((hist && hist.history) || []);
        setScannerStats(stats || null);
      } catch (e) { /* keep last state */ }
    };
    refresh();
    const id = setInterval(refresh, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // T-159: live promotion-readiness rate from /api/me/signals/promotion-rate.
  const [promo, setPromo] = React.useState(null);
  // T-160: live sweep MTD from /api/me/sweep/monthly (same endpoint as T-158
  // Portfolio screen). Drives the "Swept to long-term" tile below.
  const [sweepMtd, setSweepMtd] = React.useState(null);
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/me/signals/promotion-rate', { credentials: 'include' });
        if (!r.ok) return;
        const j = await r.json();
        if (cancelled || !j || !j.ok) return;
        setPromo(j);
      } catch (_) { /* leave null — UI shows "—" */ }
    })();
    (async () => {
      try {
        const r = await fetch('/api/me/sweep/monthly', { credentials: 'include' });
        if (!r.ok) return;
        const j = await r.json();
        if (cancelled || !j || !j.ok) return;
        setSweepMtd({
          mtd: Number(j.mtd) || 0,
          mtd_count: Number(j.mtd_count) || 0,
          total_months: Array.isArray(j.months) ? j.months.length : 0,
          total_swept: (j.months || []).reduce((s, m) => s + (Number(m.total_inr) || 0), 0),
        });
      } catch (e) { console.warn('[screen-signals] swallowed:', e && e.message); }
    })();
    return () => { cancelled = true; };
  }, []);
  // Compact ₹ formatter shared with the Swept tile.
  function _inrCompact(n) {
    if (!Number.isFinite(n)) return '—';
    const abs = Math.abs(n);
    const s = abs >= 10000000 ? `₹${(abs/10000000).toFixed(2)}Cr`
            : abs >= 100000   ? `₹${(abs/100000).toFixed(2)}L`
            : abs >= 1000     ? `₹${(abs/1000).toFixed(1)}K`
            : `₹${Math.round(abs).toLocaleString('en-IN')}`;
    return (n < 0 ? '-' : '') + s;
  }

  const triggerScan = async () => {
    try { await fetch('/api/scanner/run', { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body:'{}' }); } catch (e) { console.warn('[screen-signals] swallowed:', e && e.message); }
  };
  window.atsTriggerScan = triggerScan;
  window.atsScannerStats = scannerStats;
  window.atsRealSignals = realSignals;
  // T-353c: Was 5-stage pipeline with 15 hardcoded cards (HDFCBANK conf 82% tgt 1745,
  // TCS pnl -₹340, INFY pnl +₹1,995, NIFTYBEES ₹6,000/Mon, etc.). T-344 claimed to
  // gate this but never did. Production pipeline must populate from realSignals fetch
  // (window.atsRealSignals). Until that wiring ships, render empty stages.
  const cols = [
    { title: "1 · Signal",    meta: "Emitted by strategies",       accent: "info", cards: [] },
    { title: "2 · Paper",     meta: "Simulated fills · gated",     accent: "acc",  cards: [] },
    { title: "3 · Live",      meta: "Real capital deployed",       accent: "vio",  cards: [] },
    { title: "4 · Profit",    meta: "Realized · awaiting sweep",   accent: "up",   cards: [] },
    { title: "5 · Long-term", meta: "Auto-invested via SIP / lump",accent: "warn", cards: [] },
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-header__title">AI Signal Pipeline</h1>
          <div className="page-header__sub">Signals flow left→right. Promote or reject at each stage. Profits sweep into long-term.</div>
        </div>
        <div className="page-header__right">
          <button className="btn"><I.refresh size={14}/> Rescan</button>
          <button className="btn btn--primary"><I.plus size={14}/> Add source</button>
        </div>
      </div>

      <ModeGateBanner/>

      {/* Tier 7: Live Scanner from /api/scanner -- real RSI/EMA20 hits on watchlist */}
      {Array.isArray(realSignals) && realSignals.length > 0 ? (
        <div className="card" style={{ marginBottom: 16, padding: 14, background: "var(--info-soft, #eff6ff)", borderRadius: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700 }}>
              Live Scanner ({realSignals.length} signal{realSignals.length === 1 ? '' : 's'} from /api/scanner/history)
            </div>
            <button onClick={() => window.atsTriggerScan && window.atsTriggerScan()} className="btn btn-ghost" style={{ fontSize: 11 }}>Trigger scan</button>
            {scannerStats && scannerStats.lastRun ? (
              <span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>last run: {new Date(scannerStats.lastRun.at).toLocaleString('en-IN')} ({scannerStats.lastRun.scanned} scanned, {scannerStats.lastRun.fired} fired)</span>
            ) : null}
          </div>
          <div style={{ marginTop: 10, fontSize: 12 }}>
            {realSignals.slice(0, 10).map((s, i) => (
              <SignalRow key={i} sig={s} isFirst={i === 0}/>
            ))}
          </div>
        </div>
      ) : (
        <div className="card" style={{ marginBottom: 16, padding: 12, background: "var(--bg-soft)", borderRadius: 12, fontSize: 11, color: "var(--text-3)" }}>
          Live Scanner has no signals yet -- the daily watchlist scan runs at 15:35 IST (Mon-Fri). Trigger a manual scan: <button onClick={() => window.atsTriggerScan && window.atsTriggerScan()} className="btn btn-ghost" style={{ fontSize: 11 }}>Run now</button>
        </div>
      )}

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        {/* T99-T81: replaced hardcoded 47/28%/71%/₹1,82,500 with real scanner data.
            We display real counts from scannerStats + realSignals; the two
            ratios (paper→live rate, live accuracy) need a per-trade promotion
            ledger that hasn't shipped yet, so they read '—' with honest subs.  */}
        <Card><Stat
          label="Signals today"
          value={(() => {
            if (!Array.isArray(realSignals)) return '—';
            const today = new Date().toISOString().slice(0, 10);
            const n = realSignals.filter(s => {
              const t = s.at || s.ts || s.time;
              return t && String(t).slice(0, 10) === today;
            }).length;
            return String(n);
          })()}
          sub={scannerStats && scannerStats.lastRun
            ? `last scan ${new Date(scannerStats.lastRun.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`
            : 'no scan run yet'}
        /></Card>
        <Card><Stat
          label="Last scan"
          value={scannerStats && scannerStats.lastRun ? String(scannerStats.lastRun.fired) : '—'}
          sub={scannerStats && scannerStats.lastRun
            ? `${scannerStats.lastRun.scanned} symbols scanned`
            : 'awaiting first scan'}
        /></Card>
        <Card><Stat
          label="Paper → Live rate"
          value={promo && promo.total_groups > 0
            ? `${(promo.rate * 100).toFixed(0)}%`
            : "—"}
          sub={promo && promo.total_groups > 0
            ? `${promo.ready_groups}/${promo.total_groups} groups ready · ${promo.window_days}d`
            : (promo ? "no paper trades yet" : "loading…")}
        /></Card>
        <Card><Stat
          label="Swept to long-term"
          value={sweepMtd && sweepMtd.total_swept > 0
            ? _inrCompact(sweepMtd.total_swept)
            : "—"}
          sub={sweepMtd && sweepMtd.total_swept > 0
            ? `MTD: ${_inrCompact(sweepMtd.mtd)} · ${sweepMtd.total_months} month${sweepMtd.total_months === 1 ? '' : 's'}`
            : (sweepMtd ? "no sweep history yet" : "loading…")}
        /></Card>
      </div>

      <div className="pipe-scroll" style={{ marginBottom: 16 }}>
        <div className="pipe">
          {cols.map((col, ci) => (
            <div className="pipe__col" key={ci}>
              <div className="pipe__col-head">
                <div>
                  <div className="pipe__col-title">{col.title}</div>
                  <div className="muted" style={{ fontSize: 10, marginTop: 2 }}>{col.meta}</div>
                </div>
                <Pill kind={col.accent}>{col.cards.length}</Pill>
              </div>
              {col.cards.map((c, i) => {
                // Mode comes from the strategy that emitted the signal — NOT the symbol
                const strategyMeta = c.strategy ? window.getStrategy(c.strategy) : null;
                const cardMode = strategyMeta?.mode || window.inferMode(c.sym);
                const gated = !window.isModeActive(cardMode);
                const meta = window.MODE_META[cardMode];
                return (
                <div className="pipe__card" key={i} style={gated ? { opacity: 0.5, background: "repeating-linear-gradient(135deg, var(--bg-soft) 0 8px, var(--bg-sunk) 8px 9px)" } : null}>
                  <div className="between" style={{ flexWrap: "wrap", gap: 6 }}>
                    <strong>{c.sym}</strong>
                    <div className="row" style={{ gap: 4 }}>
                      {c.act && <Pill kind={c.act === "BUY" ? "up" : "down"}>{c.act}</Pill>}
                      {c.live && <Pill kind="vio" dot>LIVE</Pill>}
                      <span style={{ fontSize: 9, fontFamily: "var(--mono)", color: gated ? "var(--down)" : meta.color, padding: "1px 5px", borderRadius: 3, background: gated ? "var(--down-soft)" : meta.colorSoft, fontWeight: 500 }}>
                        {gated ? meta.shortLabel + " OFF" : meta.shortLabel}
                      </span>
                    </div>
                  </div>
                  {/* Strategy link — shows which algo emitted this signal */}
                  {c.strategy && (
                    <div style={{ fontSize: 11, marginTop: 2 }}>
                      <span className="muted">via </span>
                      <span style={{ color: meta.color, fontWeight: 500 }}>{c.strategy}</span>
                    </div>
                  )}
                  <div className="muted" style={{ fontSize: 11, fontFamily: "var(--mono)" }}>{c.src}</div>

                  {/* Sentiment overlay — news-driven confidence adjustment */}
                  {c.senti != null && (() => {
                    const up = c.senti > 0;
                    const aligned = (up && c.act === "BUY") || (!up && c.act === "SELL");
                    return (
                      <div style={{
                        marginTop: 6, padding: "5px 8px", borderRadius: 4,
                        background: aligned ? "var(--up-soft)" : "var(--down-soft)",
                        display: "flex", alignItems: "center", gap: 6, fontSize: 10,
                      }}>
                        <span style={{ fontWeight: 700, color: up ? "var(--up)" : "var(--down)", fontFamily: "var(--mono)" }}>
                          {up ? "▲" : "▼"} {up ? "+" : ""}{c.senti.toFixed(2)}
                        </span>
                        <span style={{ color: "var(--text-2)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {c.sentiNote}
                        </span>
                        <span style={{ fontSize: 9, color: aligned ? "var(--up)" : "var(--down)", fontWeight: 600 }}>
                          {aligned ? "+conf" : "−conf"}
                        </span>
                      </div>
                    );
                  })()}

                  {/* Primary stats row: conf + P&L prominent */}
                  <div className="row" style={{ gap: 12, alignItems: "baseline", marginTop: 4 }}>
                    {c.conf != null && (
                      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                        <span className="mono" style={{ fontSize: 15, fontWeight: 600, color: c.conf >= 75 ? "var(--up)" : c.conf >= 60 ? "var(--info)" : "var(--text-2)" }}>{c.conf}%</span>
                        <span className="muted" style={{ fontSize: 10 }}>conf</span>
                      </div>
                    )}
                    {c.pnl && (
                      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                        <span className={"mono " + (c.pnl.startsWith("+") ? "up" : "down")} style={{ fontSize: 14, fontWeight: 600 }}>{c.pnl}</span>
                        <span className="muted" style={{ fontSize: 10 }}>p&l</span>
                      </div>
                    )}
                    {c.realized != null && (
                      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                        <span className="mono up" style={{ fontSize: 14, fontWeight: 600 }}>+{inr(c.realized)}</span>
                        <span className="muted" style={{ fontSize: 10 }}>realized</span>
                      </div>
                    )}
                    {c.amount != null && <span className="mono" style={{ fontSize: 14, fontWeight: 600 }}>{inr(c.amount)}</span>}
                  </div>

                  {/* Secondary meta line: time/bars */}
                  <div className="muted" style={{ fontSize: 11, display: "flex", gap: 8 }}>
                    {c.age && <span>{c.age}</span>}
                    {c.bars != null && <span>· {c.bars} bars</span>}
                    {c.closed && <span>· {c.closed}</span>}
                    {c.when && <span>· {c.when}</span>}
                    {(c.tgt || c.sl) && (
                      <span style={{ marginLeft: "auto", fontFamily: "var(--mono)", fontSize: 10 }}>
                        {c.tgt && <span>T {c.tgt}</span>}
                        {c.tgt && c.sl && <span> · </span>}
                        {c.sl && <span>SL {c.sl}</span>}
                      </span>
                    )}
                  </div>

                  {ci < 3 && (
                    <div className="pipe__actions">
                      {gated ? (
                        <button className="btn btn--sm" disabled style={{ opacity: 0.6, cursor: "not-allowed", flex: 1, justifyContent: "center" }}>
                          Mode disabled
                        </button>
                      ) : (
                        <>
                          <button className="btn btn--sm" onClick={() => setExplainSig({ symbol: c.sym, action: c.act, source: c.src, confidence: c.conf, price: parseFloat(c.tgt) || 1715 })}>Why?</button>
                          <button className="btn btn--sm">→ Promote</button>
                          <button className="btn btn--sm btn--ghost">Skip</button>
                        </>
                      )}
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Sources & rules */}
      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <Card title="Signal sources" sub="AI models and indicator engines feeding the pipeline" flush>
          {/* T-361: this Signal-sources table was a second hardcoded fixture
              that T-353c (which emptied the 5-stage cols array) missed.
              T-349's prod-readiness spec flagged the fake AI source names leaking
              into the live render. Until a backend endpoint exposes the real
              AI/indicator engine catalog (none exists yet), show empty-state. */}
          <div style={{ padding: 24, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
            Source registry will populate once /api/me/signal-sources ships.
            Until then no AI / indicator metadata is reported here.
          </div>
        </Card>

        <Card title="Promotion rules" sub="When a signal auto-advances to the next stage">
          <div className="col" style={{ gap: 14 }}>
            {[
              { from: "Signal → Paper", rule: "confidence ≥ 70% AND source_accuracy_30d ≥ 60%", on: true },
              { from: "Paper → Live",   rule: "paper_win_rate ≥ 65% after 20 trades AND no open risk breach", on: true },
              { from: "Live → Profit",  rule: "position closed with realized_pnl > 0", on: true },
              { from: "Profit → Sweep", rule: "monthly_profit ≥ ₹25,000 → sweep 60% into long-term", on: true },
              { from: "Manual override", rule: "halt all promotions if daily_loss > ₹15,000", on: false },
            ].map((r, i) => (
              <div key={i} style={{ padding: 12, border: "1px solid var(--border)", borderRadius: "var(--r-md)" }}>
                <div className="between" style={{ marginBottom: 4 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{r.from}</div>
                  <Toggle on={r.on}/>
                </div>
                <code style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-3)" }}>{r.rule}</code>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <window.AIExplainerModal
        open={!!explainSig}
        onClose={() => setExplainSig(null)}
        signal={explainSig}
      />
    </>
  );
};
Object.assign(window, { SignalsScreen });
