/* eslint-disable */
/* Monthly AI performance review — auto-generated report every 1st of month.
   Claude Opus 4.6 drafts narrative; Gemini validates; GPT-5 generates recommendations. */

const AIReviewScreen = () => {
  const [month, setMonth] = React.useState(null);  // T-157: defaults to latest live month
  // T-157: live per-month PnL from /api/me/pnl/monthly (T-156)
  const [liveMonthly, setLiveMonthly] = React.useState(null);  // { summary, months[] } | null
  const [liveErr, setLiveErr] = React.useState(null);
  // T-160: live risk metrics (Sharpe ratio) from /api/me/risk-metrics
  const [liveRisk, setLiveRisk] = React.useState(null);
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/me/pnl/monthly', { credentials: 'include' });
        if (!r.ok) { if (!cancelled) setLiveErr(`http_${r.status}`); return; }
        const j = await r.json();
        if (cancelled || !j || !j.ok) return;
        setLiveMonthly(j);
        // Default selected month to most-recent live month if present.
        if (Array.isArray(j.months) && j.months.length > 0 && !month) {
          setMonth(j.months[j.months.length - 1].month);
        }
      } catch (e) { if (!cancelled) setLiveErr(String(e.message || e)); }
    })();
    (async () => {
      try {
        const r = await fetch('/api/me/risk-metrics', { credentials: 'include' });
        if (!r.ok) return;
        const j = await r.json();
        if (cancelled || !j || !j.ok) return;
        setLiveRisk(j);
      } catch (e) { console.warn('[screen-ai-review] swallowed:', e && e.message); }
    })();
    return () => { cancelled = true; };
  }, []);
  // Tier 6: live Claude integration helpers
  const [aiBusy, setAiBusy] = React.useState(false);
  const [aiOutput, setAiOutput] = React.useState(null);
  const [aiError, setAiError] = React.useState(null);
  const [aiStats, setAiStats] = React.useState(null);
  // Tier 20: live monthly review state
  const [mrBusy, setMrBusy] = React.useState(false);
  const [mrText, setMrText] = React.useState(null);
  const [mrErr, setMrErr] = React.useState(null);
  const runMonthlyReview = async () => {
    setMrBusy(true); setMrErr(null); setMrText(null);
    try {
      const r = await window.fetchApi('/api/ai/monthly-review', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),  // auto-derives from /api/paper
      });
      if (r && r.ok) setMrText(r.narrative || '');
      else setMrErr((r && r.reason) || 'AI call failed');
    } catch (e) { setMrErr(String(e.message || e)); }
    finally { setMrBusy(false); }
  };
  const askLiveAI = async () => {
    setAiBusy(true); setAiError(null);
    try {
      const r = await window.fetchApi('/api/ai/strategy-explain', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategy: 'rsi_mean_revert', symbol: 'RELIANCE',
          params: { period: 14, entryRsi: 30, exitRsi: 65 },
          stats: { totalPnl: 1246, winRate: 100, maxDrawdownPct: 12 },
        }),
      });
      if (r && r.ok) { setAiOutput(r.summary); setAiStats(r.stats); }
      else { setAiError((r && r.reason) || 'AI call failed'); }
    } catch (e) { setAiError(String(e.message || e)); }
    finally { setAiBusy(false); }
  };
  // Also expose globally so anyone can trigger from devtools
  window.atsAskLiveAI = askLiveAI;

  // T-157: build months dropdown from live data when available; fall back
  // to the demo list so the screen renders for users with no trades yet.
  const liveMonthRows = (liveMonthly && Array.isArray(liveMonthly.months)) ? liveMonthly.months : [];
  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const months = liveMonthRows.length > 0
    ? liveMonthRows.map(r => {
        const [y, m] = r.month.split('-');
        return { v: r.month, label: `${MONTH_NAMES[parseInt(m,10)-1] || m} ${y}` };
      }).reverse()  // most-recent first
    : [
        { v: "2026-03", label: "March 2026" },
        { v: "2026-02", label: "February 2026" },
        { v: "2026-01", label: "January 2026" },
        { v: "2025-12", label: "December 2025" },
      ];
  // Find the live row for the selected month (or null if user has none)
  const liveRow = liveMonthRows.find(r => r.month === month) || null;
  // Helper: format ₹ value with +/- sign
  function _fmtINR(n) {
    if (n == null || !Number.isFinite(n)) return '—';
    const abs = Math.abs(n);
    const s = abs >= 100000 ? `₹${(abs/100000).toFixed(2)}L` : `₹${abs.toLocaleString('en-IN')}`;
    return (n >= 0 ? '+' : '-') + s;
  }

  const strategies = [
    { name: "Momentum AI (Intraday)", mode: "Intraday", trades: 142, win: 58, pnl: 48200, sharpe: 1.84, drift: "stable", verdict: "keep", reason: "Consistent with last 3mo baseline. Confidence calibration within 4% of expected." },
    { name: "Mean Reversion (Scalp)",  mode: "Intraday", trades: 428, win: 62, pnl: 22400, sharpe: 1.42, drift: "stable", verdict: "keep", reason: "Strong in choppy regime (18 sessions). Slight slippage increase — consider TWAP execution." },
    { name: "Event-Momentum (Swing)",  mode: "Swing",    trades: 34,  win: 44, pnl: -8400,  sharpe: -0.48, drift: "degrading", verdict: "tune", reason: "3-month Sharpe trending down. News-trigger signals underperforming vs Q4 2025. Re-tune on recent regime." },
    { name: "Breakout (Positional)",    mode: "Positional", trades: 18,  win: 72, pnl: 64800, sharpe: 2.14, drift: "stable", verdict: "keep", reason: "Benefiting from trending market. Position sizing rules working — low drawdown relative to gain." },
    { name: "IV Crush (Options)",      mode: "Options",  trades: 24, win: 58, pnl: 12400, sharpe: 1.12, drift: "volatile", verdict: "watch", reason: "Realized vol vs implied has compressed. Edge narrowed 18% from baseline. Monitor 2 more weeks." },
    { name: "Iron Condor (Options)",    mode: "Options",  trades: 8,  win: 38, pnl: -14200, sharpe: -0.84, drift: "broken", verdict: "kill", reason: "Hit max loss on 3 of 8. Regime no longer range-bound (VIX +42%). Recommend deactivate until regime shifts." },
  ];

  const aiCost = [
    { p: "Claude Opus 4.6",  calls: 28420, tokens: "12.4M", cost: 4820, share: 54 },
    { p: "Gemini 2.5 Pro",   calls: 18240, tokens: "8.2M",  cost: 2140, share: 24 },
    { p: "GPT-5",            calls: 12480, tokens: "5.8M",  cost: 1940, share: 22 },
  ];

  // T99-T136: gate visible hardcoded KPIs behind MockData.isDemoOn() so
  // production users see honest empty states instead of large prominent
  // fake numbers (+₹1,24,800 / -₹18,400 / ₹8,900). The T-85 banner already
  // discloses the screen is demo until per-month aggregation ships; this
  // change brings the visible RENDER in line with the disclosure for the
  // most prominent values.
  const _isDemo = !!(window.MockData && window.MockData.isDemoOn && window.MockData.isDemoOn());
  const __dash = '—';
  const highlights = [
    { icon: "✓", kind: "up",   t: "Net PnL ₹1,24,800", d: "+11.2% of deployed capital, best month since Dec 2025." },
    { icon: "⚠", kind: "warn", t: "Iron Condor underwater", d: "3 max-loss events. AI recommends deactivation until VIX drops below 18." },
    { icon: "★", kind: "acc",  t: "AI cost efficiency +14%", d: "Migrated 40% of non-critical calls to Haiku. Quality unchanged per A/B." },
    { icon: "!", kind: "down", t: "2 circuit-breaker events", d: "Both triggered by overnight gap. No manual intervention required." },
  ];

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 12, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
            Operations · AI performance review
          </div>
          <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 4, maxWidth: 720 }}>
            Auto-generated on the 1st of every month. Claude Opus 4.6 drafts the narrative, Gemini 2.5 Pro cross-validates, GPT-5 suggests actions. All three must agree before an action is surfaced.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <select className="input" value={month} onChange={e => setMonth(e.target.value)} style={{ width: 160 }}>
            {months.map(m => <option key={m.v} value={m.v}>{m.label}</option>)}
          </select>
          <button className="btn btn-ghost">Export PDF</button>
        </div>
      </div>

      {window.AICostCard && <div style={{ marginBottom: 16 }}><window.AICostCard/></div>}

      {/* T99-T85: honest banner — the KPI band (Net PnL ₹1,24,800, 654 trades,
          58.4% win, 1.72 Sharpe, -₹18,400 max DD), 6-strategy verdict table,
          AI cost-by-provider breakdown, and 'highlights' bullets below are
          all static demo data. The 'Generate review' button further down
          DOES make a real Claude call against /api/ai/monthly-review. Same
          disclosure pattern as T-73/T-82/T-83/T-84. */}
      <div role="note" style={{
        padding: '8px 12px', marginBottom: 12, borderRadius: 6,
        border: '1px solid color-mix(in oklab, var(--warn, #d97706) 35%, var(--border))',
        background: 'color-mix(in oklab, var(--warn, #d97706) 8%, transparent)',
        fontSize: 12, color: 'var(--text-2)',
      }}>
        <strong>Static report below is demo data.</strong>{' '}
        The KPI band, per-strategy verdicts, AI cost breakdown, and highlights
        bullets are hardcoded examples until the monthly-review aggregation
        backend ships. Use the <b>Generate review</b> button further down to
        run a real Claude narrative against your actual paper-trading history.
      </div>

      {/* Report header */}
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
              Monthly report · {months.find(m => m.v === month)?.label}
            </div>
            <div style={{ fontSize: 22, fontWeight: 600, marginTop: 6, letterSpacing: -0.3 }}>
              A strong month overall, with one strategy requiring action.
            </div>
            <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 6 }}>
              Generated Apr 1, 2026 · 03:42 AM IST · 3-AI consensus · PDF ref: AR-202603-7842
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <Chip variant="up">✓ Consensus reached</Chip>
            <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 6 }}>3 of 3 AI agreed</div>
          </div>
        </div>

        {/* KPI band */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, padding: 16, background: "var(--bg-soft)", borderRadius: "var(--r-md)" }}>
          <div>
            <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase" }}>Net PnL</div>
            <div className="mono" style={{ fontSize: 18, fontWeight: 700, marginTop: 4, color: liveRow ? (liveRow.net_pnl >= 0 ? "var(--up)" : "var(--down)") : (_isDemo ? "var(--up)" : "var(--text-3)") }}>{liveRow ? _fmtINR(liveRow.net_pnl) : (_isDemo ? "+₹1,24,800" : __dash)}</div>
            <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>+11.2% of capital</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase" }}>Trades</div>
            <div className="mono" style={{ fontSize: 18, fontWeight: 700, marginTop: 4, color: liveRow ? undefined : (_isDemo ? undefined : "var(--text-3)") }}>{liveRow ? String(liveRow.trades) : (_isDemo ? "654" : __dash)}</div>
            <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>across 6 strategies</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase" }}>Win rate</div>
            <div className="mono" style={{ fontSize: 18, fontWeight: 700, marginTop: 4, color: liveRow ? undefined : (_isDemo ? undefined : "var(--text-3)") }}>{liveRow ? `${(liveRow.win_rate * 100).toFixed(1)}%` : (_isDemo ? "58.4%" : __dash)}</div>
            <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>vs 3mo avg 56.2%</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase" }}>Sharpe</div>
            <div className="mono" style={{ fontSize: 18, fontWeight: 700, marginTop: 4, color: (liveRisk && Number.isFinite(liveRisk.sharpeRatio)) ? undefined : (_isDemo ? undefined : "var(--text-3)") }}>{(liveRisk && Number.isFinite(liveRisk.sharpeRatio)) ? liveRisk.sharpeRatio.toFixed(2) : (_isDemo ? "1.72" : __dash)}</div>
            <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>vs 3mo 1.64</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase" }}>Max DD</div>
            <div className="mono" style={{ fontSize: 18, fontWeight: 700, marginTop: 4, color: liveRow ? "var(--down)" : (_isDemo ? "var(--down)" : "var(--text-3)") }}>{liveRow ? _fmtINR(liveRow.max_drawdown_inr) : (_isDemo ? "-₹18,400" : __dash)}</div>
            <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>Mar 14, recovered 2d</div>
          </div>
        </div>
      </Card>

      {/* Tier 20: Live AI monthly review */}
      <div style={{ marginTop: 16 }}>
        <Card title="AI monthly narrative" sub="Claude-generated review of your paper-trading month. Counts against the daily AI cap."
          right={
            <button className="btn btn--sm btn--accent" onClick={runMonthlyReview} disabled={mrBusy}>
              {mrBusy ? 'Generating…' : 'Generate review'}
            </button>
          }>
          {mrErr && <div style={{ padding: 12, background: 'var(--down-soft)', color: 'var(--down)', borderRadius: 6, fontSize: 12 }}>Error: {mrErr}</div>}
          {!mrText && !mrErr && !mrBusy && (
            <div style={{ padding: 16, background: 'var(--bg-soft)', borderRadius: 6, fontSize: 12, color: 'var(--text-3)' }}>
              Click <b>Generate review</b> to have Claude analyse your paper-trading month and surface verdict / what worked / what didn't / one behavioral pattern / one actionable change.
            </div>
          )}
          {mrText && (
            <div style={{
              padding: 16, background: 'var(--bg-soft)', borderRadius: 6,
              fontSize: 13, lineHeight: 1.6, color: 'var(--text-1)',
              whiteSpace: 'pre-wrap',
            }}>{mrText}</div>
          )}
        </Card>
      </div>

      {/* Highlights — T99-T139: gated behind _isDemo (T-136 set _isDemo). */}
      {_isDemo && (
      <div style={{ marginTop: 16 }}>
        <Card title="Key highlights" sub="Most important findings">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
            {highlights.map((h, i) => {
              const colors = { up: "var(--up)", down: "var(--down)", warn: "oklch(65% 0.13 80)", acc: "var(--acc)" };
              const bgs = { up: "var(--up-soft)", down: "var(--down-soft)", warn: "var(--warn-soft)", acc: "var(--bg-soft)" };
              return (
                <div key={i} style={{ padding: 14, borderRadius: "var(--r-md)", background: bgs[h.kind], border: `1px solid ${colors[h.kind]}20` }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <div style={{ width: 24, height: 24, borderRadius: 6, background: colors[h.kind], color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, flexShrink: 0 }}>{h.icon}</div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: colors[h.kind] }}>{h.t}</div>
                      <div style={{ fontSize: 11, color: "var(--text-2)", marginTop: 4, lineHeight: 1.5 }}>{h.d}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
      )}

      {/* Strategy review — T99-T139: gated behind _isDemo. */}
      {_isDemo && (
      <div style={{ marginTop: 16 }}>
        <Card title="Strategy-by-strategy review" sub="AI verdict for each active strategy">
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 80px 70px 90px 70px 80px 80px 2fr", padding: "8px 12px", borderBottom: "1px solid var(--border)", fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600 }}>
            <div>Strategy</div><div>Mode</div><div style={{ textAlign: "right" }}>Trades</div><div style={{ textAlign: "right" }}>Win %</div><div style={{ textAlign: "right" }}>PnL</div><div style={{ textAlign: "right" }}>Sharpe</div><div>Verdict</div><div>AI reasoning</div>
          </div>
          {strategies.map((s, i) => {
            const vColor = s.verdict === "keep" ? "up" : s.verdict === "watch" ? "info" : s.verdict === "tune" ? "warn" : "down";
            return (
              <div key={i} style={{
                display: "grid", gridTemplateColumns: "1.4fr 80px 70px 90px 70px 80px 80px 2fr",
                padding: "12px", borderBottom: i < strategies.length - 1 ? "1px solid var(--border)" : "none",
                alignItems: "center", fontSize: 12,
              }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{s.name}</div>
                  <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>drift: {s.drift}</div>
                </div>
                <div><Chip variant="info">{s.mode}</Chip></div>
                <div className="mono" style={{ textAlign: "right" }}>{s.trades}</div>
                <div className="mono" style={{ textAlign: "right" }}>{s.win}%</div>
                <div className="mono" style={{ textAlign: "right", fontWeight: 600, color: s.pnl >= 0 ? "var(--up)" : "var(--down)" }}>
                  {s.pnl >= 0 ? "+" : ""}₹{(s.pnl / 1000).toFixed(1)}k
                </div>
                <div className="mono" style={{ textAlign: "right", color: s.sharpe >= 0 ? "var(--text)" : "var(--down)" }}>{s.sharpe.toFixed(2)}</div>
                <div><Chip variant={vColor}>{s.verdict.toUpperCase()}</Chip></div>
                <div style={{ fontSize: 11, color: "var(--text-2)", lineHeight: 1.45 }}>{s.reason}</div>
              </div>
            );
          })}
        </Card>
      </div>
      )}

      {/* AI cost breakdown — T99-T139: gated behind _isDemo. The real
          AI cost panel lives on the AI Providers screen (T-123) which is
          wired to /api/me/ai-keys budget telemetry. */}
      {_isDemo && (
      <div style={{ marginTop: 16 }}>
        <Card title="AI cost breakdown" sub="Where LLM budget was spent this month">
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20 }}>
            <div>
              {aiCost.map((p, i) => (
                <div key={i} style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{p.p}</div>
                    <div className="mono" style={{ fontSize: 12, fontWeight: 600 }}>₹{p.cost.toLocaleString("en-IN")}</div>
                  </div>
                  <div style={{ height: 6, background: "var(--border)", borderRadius: 3 }}>
                    <div style={{ width: `${p.share}%`, height: "100%", background: i === 0 ? "var(--acc)" : i === 1 ? "var(--info)" : "var(--vio)", borderRadius: 3 }}/>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 10, color: "var(--text-3)" }}>
                    <span className="mono">{p.calls.toLocaleString("en-IN")} calls</span>
                    <span className="mono">{p.tokens} tokens</span>
                    <span className="mono">{p.share}% share</span>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ padding: 16, background: "var(--bg-soft)", borderRadius: "var(--r-md)" }}>
              <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4 }}>TOTAL AI SPEND</div>
              <div className="mono" style={{ fontSize: 28, fontWeight: 700, marginTop: 4, color: _isDemo ? undefined : "var(--text-3)" }}>{_isDemo ? "₹8,900" : __dash}</div>
              <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>of ₹15,000 budget · 59% used</div>
              <div style={{ marginTop: 16, padding: 10, background: "var(--up-soft)", color: "var(--up)", borderRadius: "var(--r-sm)", fontSize: 11 }}>
                <strong>Cost per ₹ PnL:</strong> ₹0.0713 (vs ₹0.0831 last mo) — 14% more efficient
              </div>
            </div>
          </div>
        </Card>
      </div>
      )}

      {/* Recommended actions — T99-T139: gated behind _isDemo. When live,
          recommended actions come from the Generate review button above
          which calls /api/me/ai-workflows/monthly-review. */}
      {_isDemo && (
      <div style={{ marginTop: 16 }}>
        <Card title="Recommended actions" sub="All 3 AIs must agree before an action is surfaced here">
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[
              { p: 1, t: "Deactivate Iron Condor (Options)", d: "VIX has broken above 22, range-bound assumption no longer valid. Claude + Gemini + GPT-5 all flagged as high-conviction action.", action: "Deactivate" },
              { p: 2, t: "Retune Event-Momentum (Swing) params", d: "Sharpe trending below 0 for 3 consecutive weeks. Auto-tuner ready to run 48hr Bayesian search on recent 90-day window.", action: "Start tuner" },
              { p: 3, t: "Increase allocation to Breakout (Positional)", d: "Sharpe 2.14, DD profile excellent. Suggest moving capital from under-performing Swing bucket. Claude flagged, Gemini concurred, GPT-5 concurred.", action: "Review allocation" },
              { p: 4, t: "Switch 40% of Gemini calls to Gemini Flash", d: "Non-critical news summarization doesn't need Pro-tier. Estimated savings: ₹620/mo. Quality delta: 0.2% (within A/B noise).", action: "Apply switch" },
            ].map((a, i) => (
              <div key={i} style={{ padding: 14, border: "1px solid var(--border)", borderRadius: "var(--r-md)", display: "flex", gap: 14, alignItems: "flex-start" }}>
                <div style={{ width: 28, height: 28, borderRadius: 14, background: "var(--acc)", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, flexShrink: 0 }}>{a.p}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{a.t}</div>
                  <div style={{ fontSize: 11, color: "var(--text-2)", marginTop: 4, lineHeight: 1.5 }}>{a.d}</div>
                </div>
                <button className="btn btn-primary" style={{ fontSize: 11, padding: "6px 12px" }}>{a.action}</button>
              </div>
            ))}
          </div>
        </Card>
      </div>
      )}

      {/* T99-T139: single empty-state for non-demo users; replaces the four
          demo card blocks above. The Generate review button (above this
          section) hits a real /api/me/ai-workflows/monthly-review endpoint
          so users CAN populate this screen — they just have to click. */}
      {!_isDemo && (
        <div style={{ marginTop: 16 }}>
          <Card title="Monthly review" sub="Static demo report is hidden in production">
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-3)', fontSize: 12 }}>
              Click <strong>Generate review</strong> above to have the AI consensus
              produce a real monthly narrative for {months.find(m => m.v === month)?.label} based on your paper-trading history.
            </div>
          </Card>
        </div>
      )}
    </>
  );
};

window.AIReviewScreen = AIReviewScreen;
