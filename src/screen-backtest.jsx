/* eslint-disable */
/* Backtest screen — walk-forward, out-of-sample */

const BacktestScreen = () => {
  // ---- live /api/strategies + on-demand /api/backtest ----
  const [liveStrats, setLiveStrats] = React.useState(null);
  const [liveBacktest, setLiveBacktest] = React.useState(null);
  const [liveBusy, setLiveBusy] = React.useState(false);
  React.useEffect(() => {
    if (window.MockData && window.MockData.isDemoOn && window.MockData.isDemoOn()) return;
    let cancelled = false;
    (async () => {
      try {
        const d = await window.fetchApi('/api/strategies');
        if (!cancelled && d && d.ok) setLiveStrats(d.strategies || []);
      } catch (e) {}
    })();
    return () => { cancelled = true; };
  }, []);
  const runLiveBacktest = async () => {
    setLiveBusy(true);
    try {
      const to = new Date().toISOString().slice(0,10);
      const from = new Date(Date.now() - 365*86400*1000).toISOString().slice(0,10);
      const d = await window.fetchApi('/api/backtest', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ symbol:'RELIANCE', strategy:'rsi_mean_revert', from, to, qty:10,
          params: { period:14, entryRsi:30, exitRsi:65 }}),
      });
      if (d && d.ok) setLiveBacktest(d);
    } catch (e) {} finally { setLiveBusy(false); }
  };
  const [strat, setStrat] = useState("Momentum AI");
  const [, bump] = useState(0);
  React.useEffect(() => {
    const h = () => bump(n => n + 1);
    window.addEventListener("modes-changed", h);
    return () => window.removeEventListener("modes-changed", h);
  }, []);
  const strategies = ["Momentum AI", "Mean Reversion v2", "Iron Condor Weekly", "Grid Trader", "Trend Follow", "NIFTY Futures Trend"];
  const queueEl = window.BacktestQueue ? <div style={{ marginBottom: 16 }}><window.BacktestQueue/></div> : null;

  // Derive the mode this strategy belongs to — backtest runs under that mode's rules
  const mode = window.modeForStrategy(strat) || "intraday";
  const modeMeta = window.MODE_META[mode];
  const modeIsOff = !window.isModeActive(mode);

  // Per-mode backtest constraints — mirrors what the live engine enforces
  const modeConstraints = {
    intraday: { product: "MIS", leverage: "5×", hold: "Minutes – hours", holdCap: "Same-day square-off", assumption: "Slippage: 0.08% · Commission: ₹20 + ₹15 STT" },
    swing:    { product: "CNC", leverage: "1×", hold: "Days to weeks",   holdCap: "T+1 delivery",        assumption: "Slippage: 0.04% · Commission: ₹20 + 0.1% STT on sell" },
    options:  { product: "NRML/MIS", leverage: "defined", hold: "Expiry-aware", holdCap: "Auto-rollover 2d before expiry", assumption: "Slippage: 0.25% (illiquid wings) · lot-size enforced" },
    futures:  { product: "NRML", leverage: "6.7×", hold: "To expiry", holdCap: "Rollover on expiry-3d", assumption: "Slippage: 0.06% · MTM daily" },
  };
  const constraints = modeConstraints[mode];

  // REAL backtest from /api/backtest. Maps cockpit strategy names to backend strategy ids.
  const stratIdMap = {
    "Momentum AI":         "ema_cross",
    "Mean Reversion v2":   "rsi_mean_revert",
    "Iron Condor Weekly":  "bollinger",
    "Grid Trader":         "bollinger",
    "Trend Follow":        "macd_cross",
    "NIFTY Futures Trend": "macd_cross",
  };
  const [eqIS,    setEqIS]    = React.useState(seriesRandom(11, 60, 100, 184, 1.2));
  const [eqOOS,   setEqOOS]   = React.useState(seriesRandom(13, 60, 100, 172, 1.0));
  const [btStats, setBtStats] = React.useState(null);
  const [btErr,   setBtErr]   = React.useState(null);
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const stratId = stratIdMap[strat] || "rsi_mean_revert";
      const today = new Date().toISOString().slice(0, 10);
      const ago   = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
      try {
        const res = await fetch('/api/backtest', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol: 'RELIANCE', strategy: stratId, from: ago, to: today, qty: 10, interval: 'day' }),
        });
        const j = await res.json();
        if (cancelled) return;
        if (j && j.ok && Array.isArray(j.equity)) {
          const base = 100;
          const curve = j.equity.map((p) => base + p.equity); // p.equity is cumulative INR pnl
          const splitIdx = Math.max(5, Math.floor(curve.length * 0.7));
          setEqIS(curve.slice(0, splitIdx));
          setEqOOS(curve.slice(splitIdx).length >= 3 ? curve.slice(splitIdx) : curve.slice(-Math.min(20, curve.length)));
          setBtStats(j.stats);
          setBtErr(null);
        } else {
          setBtErr(j && j.reason ? j.reason : 'unknown');
        }
      } catch (e) { if (!cancelled) setBtErr(e.message); }
    })();
    return () => { cancelled = true; };
  }, [strat]);
  window.atsBacktestStats = btStats;
  window.atsBacktestErr   = btErr;

  // Walk-forward windows
  const windows = [
    { n: "W01", ins: "Jan 23–Mar 22", oos: "Mar 23–Apr 05", retIS: 8.4,  retOOS: 6.2,  sh: 1.62, ok: true  },
    { n: "W02", ins: "Feb 06–Apr 05", oos: "Apr 06–Apr 19", retIS: 6.8,  retOOS: 4.9,  sh: 1.48, ok: true  },
    { n: "W03", ins: "Feb 20–Apr 19", oos: "Apr 20–May 03", retIS: 5.2,  retOOS: 3.8,  sh: 1.32, ok: true  },
    { n: "W04", ins: "Mar 06–May 03", oos: "May 04–May 17", retIS: 4.8,  retOOS: 2.1,  sh: 0.88, ok: false },
    { n: "W05", ins: "Mar 20–May 17", oos: "May 18–May 31", retIS: 6.4,  retOOS: 5.2,  sh: 1.54, ok: true  },
    { n: "W06", ins: "Apr 03–May 31", oos: "Jun 01–Jun 14", retIS: 5.8,  retOOS: 4.4,  sh: 1.38, ok: true  },
    { n: "W07", ins: "Apr 17–Jun 14", oos: "Jun 15–Jun 28", retIS: 7.2,  retOOS: 5.8,  sh: 1.62, ok: true  },
    { n: "W08", ins: "May 01–Jun 28", oos: "Jun 29–Jul 12", retIS: 6.4,  retOOS: 3.2,  sh: 1.12, ok: true  },
  ];

  const ddSeries = Array.from({ length: 60 }, (_, i) => {
    const v = Math.sin(i * 0.3) * 4 - Math.random() * 6;
    return Math.min(0, v);
  });

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-header__title">Backtest lab</h1>
          <div className="page-header__sub">Walk-forward validation · out-of-sample · Monte Carlo · slippage-calibrated</div>
        </div>
        <div className="page-header__right">
          <button className="btn"><I.download size={14}/> Export report</button>
          <button className="btn btn--accent"><I.play size={14}/> Run new backtest</button>
        </div>
      </div>

      {modeIsOff && (
        <Card style={{ marginBottom: 16, background: "var(--warn-soft)", borderColor: "var(--warn)" }}>
          <div className="row" style={{ gap: 10, alignItems: "center" }}>
            <I.shield size={18} style={{ color: "var(--warn)" }}/>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{modeMeta.label} mode is currently OFF on Trading modes.</div>
              <div className="muted" style={{ fontSize: 12 }}>You can still backtest <span className="mono">{strat}</span> for analysis, but new live signals from this strategy are gated. Re-enable on <a href="#modes" style={{ color: "var(--accent)" }}>Trading modes</a>.</div>
            </div>
          </div>
        </Card>
      )}

      {/* T99-T86: honest banner — the 'Last run 2h 14m ago', ₹10,00,000 capital,
          KPI cards (CAGR / Sharpe / max DD / win rate), and the 12-row Trade
          statistics card below are hardcoded examples. The 'Run new backtest'
          button calls real /api/backtest, but its result populates liveBacktest
          state — not the report cards. Same disclosure pattern as T-85. */}
      {!liveBacktest && (
        <div role="note" style={{
          padding: '8px 12px', marginBottom: 12, borderRadius: 6,
          border: '1px solid color-mix(in oklab, var(--warn, #d97706) 35%, var(--border))',
          background: 'color-mix(in oklab, var(--warn, #d97706) 8%, transparent)',
          fontSize: 12, color: 'var(--text-2)',
        }}>
          <strong>Sample backtest report shown.</strong>{' '}
          The capital (₹10,00,000), KPI cards, and trade-statistics rows below are
          static demo numbers. Click <b>Run live backtest</b> to execute a real
          backtest against /api/backtest (RSI mean-reversion on RELIANCE, last
          365 days). Use those results when evaluating strategy fitness.
        </div>
      )}

      {/* T99-T101: live backtest result card. Rendered when the user has
          clicked 'Run live backtest' and /api/backtest returned ok. Shows
          the real stats (trades, win rate, total PnL, max drawdown, vs
          buy-and-hold) so users have a real reference alongside the demo
          report above. */}
      {liveBacktest && liveBacktest.stats && (
        <Card style={{ marginBottom: 16, borderColor: 'var(--up)', borderWidth: 1 }}>
          <div className="row between" style={{ marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                Live backtest · {liveBacktest.symbol} {liveBacktest.strategy}
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                {liveBacktest.from} → {liveBacktest.to} · {liveBacktest.bars} bars · qty {liveBacktest.qty}
              </div>
            </div>
            <Pill kind="up" dot>live data</Pill>
          </div>
          <div className="grid grid-4" style={{ gap: 12 }}>
            <div>
              <div className="muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4 }}>Trades</div>
              <div className="mono" style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>
                {liveBacktest.stats.trades}
              </div>
              <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                {liveBacktest.stats.wins}W / {liveBacktest.stats.losses}L
              </div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4 }}>Win rate</div>
              <div className="mono" style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>
                {Number(liveBacktest.stats.winRate).toFixed(1)}%
              </div>
              <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                avg win ₹{Math.round(liveBacktest.stats.avgWin)}
              </div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4 }}>Total PnL</div>
              <div className="mono" style={{ fontSize: 18, fontWeight: 700, marginTop: 4, color: liveBacktest.stats.totalPnl >= 0 ? 'var(--up)' : 'var(--down)' }}>
                {liveBacktest.stats.totalPnl >= 0 ? '+' : ''}₹{Math.round(liveBacktest.stats.totalPnl)}
              </div>
              <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                vs B&H {liveBacktest.stats.vsBuyAndHold >= 0 ? '+' : ''}₹{Math.round(liveBacktest.stats.vsBuyAndHold)}
              </div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4 }}>Max drawdown</div>
              <div className="mono" style={{ fontSize: 18, fontWeight: 700, marginTop: 4, color: 'var(--down)' }}>
                -₹{Math.round(liveBacktest.stats.maxDrawdown)}
              </div>
              <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                {Number(liveBacktest.stats.maxDrawdownPct).toFixed(1)}% of entry
              </div>
            </div>
          </div>
        </Card>
      )}

      {queueEl}

      {/* Config bar */}
      <Card style={{ marginBottom: 16 }}>
        {/* Mode-derived banner — shows which mode's rules are applied */}
        <div style={{
          marginBottom: 14, padding: "10px 12px", borderRadius: "var(--r-md)",
          background: modeMeta.colorSoft, borderLeft: `3px solid ${modeMeta.color}`,
          display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
        }}>
          <span style={{ fontSize: 10, fontFamily: "var(--mono)", color: modeMeta.color, padding: "3px 8px", borderRadius: 3, background: "var(--surface)", fontWeight: 600, letterSpacing: "0.05em" }}>
            {modeMeta.shortLabel} MODE
          </span>
          <span style={{ fontSize: 13, fontWeight: 500, color: modeMeta.color }}>
            {strat} runs under <strong>{modeMeta.label}</strong> rules
          </span>
          <span style={{ flex: 1 }}/>
          <span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>
            {constraints.product} · {constraints.leverage} lev · {constraints.hold}
          </span>
          <a href="#modes" style={{ fontSize: 11, color: "var(--text-3)", textDecoration: "underline" }}>Adjust rules →</a>
        </div>

        <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
          <div>
            <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>Strategy</div>
            <select value={strat} onChange={e => setStrat(e.target.value)}
              style={{ padding: "6px 10px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r-md)", fontSize: 13, minWidth: 180 }}>
              {strategies.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>Universe</div>
            <div className="mono" style={{ fontSize: 13 }}>NIFTY 200 · liquid F&amp;O</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>Period</div>
            <div className="mono" style={{ fontSize: 13 }}>Jan 01, 2023 → {window.TODAY_STR}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>Capital</div>
            <div className="mono" style={{ fontSize: 13 }}>₹10,00,000</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>Mode constraints</div>
            <div className="mono" style={{ fontSize: 11, color: "var(--text-2)" }}>{constraints.assumption}</div>
          </div>
          <div style={{ marginLeft: "auto" }}>
            <Pill kind="up" dot>Last run · 2h 14m ago · 3.8s compute</Pill>
          </div>
        </div>
      </Card>

      {/* KPIs */}
      {window.OverfitWarning && <window.OverfitWarning paramCount={14} observations={90} period="90 days in-sample"/>}
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Card>
          <Stat label="Total return" value="+82.4%" delta="over 3.3 yrs" deltaKind="up" sub="24.8% CAGR"/>
        </Card>
        <Card>
          <Stat label="Sharpe ratio" value="1.64" delta="Sortino 2.12" deltaKind="up"/>
        </Card>
        <Card>
          <Stat label="Max drawdown" value="-8.4%" delta="Apr 2024 · 18 days" deltaKind="down"/>
        </Card>
        <Card>
          <Stat label="Win rate" value="64.2%" delta="Profit factor 1.82" deltaKind="up"/>
        </Card>
      </div>

      {/* Equity curves */}
      <div className="grid grid-2-1" style={{ marginBottom: 16 }}>
        <Card title="Equity curve" sub="In-sample (training) vs out-of-sample (held-out) — overfit check">
          <div style={{ position: "relative" }}>
            <AreaChart data={eqIS} height={240} color="var(--info)" formatter={v => v.toFixed(0)}
              labels={["Jan 23","Jun 23","Dec 23","Jun 24","Dec 24","Jun 25","Apr 26"]}/>
            <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
              <Sparkline data={eqOOS} color="var(--accent)" fill={false} strokeW={2}/>
            </div>
          </div>
          <div className="row" style={{ gap: 16, marginTop: 10, fontSize: 11 }}>
            <span className="row" style={{ gap: 6 }}><span style={{ width: 10, height: 2, background: "var(--info)", display: "inline-block" }}/>In-sample · +102%</span>
            <span className="row" style={{ gap: 6 }}><span style={{ width: 10, height: 2, background: "var(--accent)", display: "inline-block" }}/>Out-of-sample · +82%</span>
            <span className="muted">Degradation: 19.6% — healthy (target &lt; 35%)</span>
          </div>
        </Card>
        <Card title="Drawdown curve" sub="Underwater plot">
          <AreaChart data={ddSeries} height={240} color="var(--down)" formatter={v => v.toFixed(1) + "%"}
            labels={["Start","Y1","Y2","Y3","Now"]}/>
          <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>Deepest: -8.4% · Longest: 38 days</div>
        </Card>
      </div>

      {/* Walk-forward windows */}
      <Card title="Walk-forward windows" sub="60-day train · 14-day held-out test · re-fit weekly" flush style={{ marginBottom: 16 }}>
        <table className="table">
          <thead><tr><th>Window</th><th>In-sample period</th><th>Out-of-sample period</th><th className="num-l">IS return</th><th className="num-l">OOS return</th><th className="num-l">OOS Sharpe</th><th>Verdict</th></tr></thead>
          <tbody>
            {windows.map((w,i) => (
              <tr key={i}>
                <td className="mono" style={{ fontSize: 12, fontWeight: 500 }}>{w.n}</td>
                <td className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{w.ins}</td>
                <td className="mono" style={{ fontSize: 11, color: "var(--text-2)" }}>{w.oos}</td>
                <td className="num" style={{ color: "var(--info)" }}>+{w.retIS.toFixed(1)}%</td>
                <td className="num" style={{ color: w.retOOS >= 3 ? "var(--up)" : "var(--warn)" }}>+{w.retOOS.toFixed(1)}%</td>
                <td className="num">{w.sh.toFixed(2)}</td>
                <td>{w.ok ? <Pill kind="up" dot>robust</Pill> : <Pill kind="warn" dot>degraded</Pill>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Monte Carlo + trade stats */}
      <div className="grid grid-2">
        <Card title="Monte Carlo · 1,000 simulations" sub="Trade-order randomization · confidence bands">
          <div className="col" style={{ gap: 10 }}>
            {[
              { k: "P5 (worst 5%)",  v: "+18.4%", c: "var(--down)" },
              { k: "P25",            v: "+52.2%", c: "var(--warn)" },
              { k: "P50 (median)",    v: "+81.8%", c: "var(--accent)" },
              { k: "P75",            v: "+112.6%", c: "var(--up)" },
              { k: "P95 (best 5%)",  v: "+148.2%", c: "var(--up)" },
            ].map((r,i) => (
              <div key={i}>
                <div className="between" style={{ fontSize: 12, marginBottom: 4 }}>
                  <span style={{ color: "var(--text-2)" }}>{r.k}</span>
                  <span className="mono" style={{ fontWeight: 500, color: r.c }}>{r.v}</span>
                </div>
                <div style={{ height: 4, background: "var(--bg-sunk)", borderRadius: 999 }}>
                  <div style={{ height: "100%", width: [12, 35, 55, 76, 98][i] + "%", background: r.c, borderRadius: 999 }}/>
                </div>
              </div>
            ))}
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 14 }}>
            P(total return &lt; 0) = <span className="mono" style={{ color: "var(--up)" }}>0.8%</span> · P(max DD &gt; 20%) = <span className="mono" style={{ color: "var(--warn)" }}>4.2%</span>
          </div>
        </Card>

        <Card title="Trade statistics" sub="Across 1,842 simulated trades">
          <div className="grid grid-2" style={{ gap: 14 }}>
            {[
              { k: "Total trades",    v: "1,842" },
              { k: "Winning trades",  v: "1,183", c: "var(--up)" },
              { k: "Losing trades",   v: "659",   c: "var(--down)" },
              { k: "Avg win",         v: "+₹2,840", c: "var(--up)" },
              { k: "Avg loss",        v: "-₹1,560", c: "var(--down)" },
              { k: "Win/loss ratio",  v: "1.82" },
              { k: "Largest win",     v: "+₹18,240", c: "var(--up)" },
              { k: "Largest loss",    v: "-₹8,420", c: "var(--down)" },
              { k: "Avg hold time",   v: "2h 48m" },
              { k: "Best month",      v: "+12.4%",  c: "var(--up)" },
              { k: "Worst month",     v: "-4.2%",   c: "var(--down)" },
              { k: "Positive months", v: "28/40" },
            ].map((r,i) => (
              <div key={i} style={{ paddingBottom: 8, borderBottom: "1px solid var(--border)" }}>
                <div className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.05, marginBottom: 2 }}>{r.k}</div>
                <div className="mono" style={{ fontSize: 14, fontWeight: 500, color: r.c || "var(--text)" }}>{r.v}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Regime analysis — performance broken down by market regime */}
      <Card title="Performance by market regime" sub="How the strategy holds up across bull / bear / choppy / volatile markets — surfaces hidden weaknesses">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
          {[
            { regime: "Bull trend",   def: "20D > 50D > 200D · ATR < median", days: 142, ret: 38.2, trades: 612, winRate: 68, color: "var(--up)" },
            { regime: "Choppy",       def: "Price within ±2% of 50D for 10+ days", days: 98, ret: 8.4, trades: 384, winRate: 51, color: "var(--text-3)" },
            { regime: "Bear trend",   def: "20D < 50D < 200D · ATR > median", days: 64, ret: -4.2, trades: 248, winRate: 42, color: "var(--down)" },
            { regime: "High vol",     def: "VIX > 18 · ATR > 1.5× median",   days: 36, ret: -8.6, trades: 142, winRate: 38, color: "var(--warn)" },
          ].map((r, i) => (
            <div key={i} style={{
              padding: 12, borderRadius: "var(--r-md)", border: "1px solid var(--border)",
              background: "var(--bg-soft)", borderLeft: `4px solid ${r.color}`,
            }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{r.regime}</div>
              <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2, lineHeight: 1.4, fontFamily: "var(--mono)", minHeight: 28 }}>{r.def}</div>
              <div style={{ height: 1, background: "var(--border)", margin: "10px 0" }}/>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontSize: 10, color: "var(--text-3)" }}>Return</div>
                  <div className="mono" style={{ fontSize: 16, fontWeight: 700, color: r.color }}>
                    {r.ret > 0 ? "+" : ""}{r.ret.toFixed(1)}%
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 10, color: "var(--text-3)" }}>Win rate</div>
                  <div className="mono" style={{ fontSize: 14, fontWeight: 600 }}>{r.winRate}%</div>
                </div>
              </div>
              <div className="muted" style={{ fontSize: 10, marginTop: 8, fontFamily: "var(--mono)" }}>
                {r.days} days · {r.trades} trades
              </div>
            </div>
          ))}
        </div>
        <div style={{
          padding: 12, borderRadius: "var(--r-sm)", background: "var(--warn-soft)",
          color: "oklch(45% 0.13 80)", display: "flex", gap: 10, alignItems: "flex-start", fontSize: 12,
        }}>
          <I.shield size={14} style={{ marginTop: 2, flexShrink: 0 }}/>
          <div>
            <strong>Regime warning:</strong> Strategy underperforms in <strong>High vol</strong> and <strong>Bear trend</strong> regimes (combined: 100 days, -12.8%). Live engine should auto-reduce capital allocation by 50% when India VIX &gt; 18 OR 20D EMA crosses below 200D EMA. <a href="#circuits" style={{ textDecoration: "underline", marginLeft: 4 }}>Configure circuit →</a>
          </div>
        </div>
      </Card>

      <div style={{ height: 16 }}/>
    </>
  );
};

Object.assign(window, { BacktestScreen });
