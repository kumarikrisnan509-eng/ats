/* eslint-disable */
/* Auto-tuner — Bayesian optimization for strategy parameters.
   Replaces grid search. Searches the param space using Gaussian process surrogate model. */

const TunerScreen = () => {
  const [job, setJob] = React.useState("momentum-rsi-tuning");
  const [showNew, setShowNew] = React.useState(false);
  // ---- live POST /api/tune (default: RELIANCE rsi_mean_revert 27-combo grid) ----
  const [liveTune, setLiveTune] = React.useState(null);
  const [liveTuneBusy, setLiveTuneBusy] = React.useState(false);
  const runLiveTune = async () => {
    setLiveTuneBusy(true);
    try {
      const to = new Date().toISOString().slice(0,10);
      const from = new Date(Date.now() - 365*86400*1000).toISOString().slice(0,10);
      const d = await window.fetchApi('/api/tuner/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: 'RELIANCE', strategy: 'rsi_mean_revert', from, to, qty: 10, interval: 'day', top: 5,
          paramGrid: { period: [10,14,20], entryRsi: [25,30,35], exitRsi: [65,70,75] },
        }),
      });
      if (d && d.ok) setLiveTune(d);
    } catch (e) { /* surface via UI later */ } finally { setLiveTuneBusy(false); }
  };

  const jobs = [
    {
      id: "momentum-rsi-tuning", name: "Momentum AI · RSI/MACD params", strategy: "Momentum AI v3",
      status: "running", iter: 47, maxIter: 100, started: "3h ago", est: "~2h remaining",
      best: { sharpe: 2.18, pnl: 12840, params: { rsi_len: 9, rsi_buy: 32, rsi_sell: 71, macd_fast: 8, macd_slow: 19, macd_sig: 7 } },
      params: [
        { name: "rsi_len",   range: "5-21",   current: 9,  type: "int" },
        { name: "rsi_buy",   range: "20-40",  current: 32, type: "int" },
        { name: "rsi_sell",  range: "60-85",  current: 71, type: "int" },
        { name: "macd_fast", range: "6-15",   current: 8,  type: "int" },
        { name: "macd_slow", range: "15-30",  current: 19, type: "int" },
        { name: "macd_sig",  range: "5-12",   current: 7,  type: "int" },
      ],
      objective: "Maximize Sharpe (1y backtest, 5m bars, 50 NIFTY stocks)",
      method: "Bayesian (Gaussian Process · Expected Improvement)",
      // Sparse iteration history — sharpe over iterations
      history: [0.42, 0.78, 0.91, 0.55, 1.12, 1.34, 0.88, 1.45, 1.62, 1.41, 1.78, 1.92, 1.71, 2.04, 1.88, 2.14, 1.97, 2.18, 2.08, 2.16, 2.18],
    },
    {
      id: "condor-strikes-tuning", name: "Iron Condor · strike & DTE", strategy: "Iron Condor Weekly",
      status: "queued", iter: 0, maxIter: 80, started: "—", est: "Starts after current job",
      best: null,
      params: [
        { name: "wing_width",    range: "200-600",  current: "—", type: "int" },
        { name: "dte_open",      range: "5-14",     current: "—", type: "int" },
        { name: "dte_close",     range: "0-3",      current: "—", type: "int" },
        { name: "vix_filter",    range: "10-25",    current: "—", type: "float" },
        { name: "delta_strike",  range: "0.10-0.35",current: "—", type: "float" },
      ],
      objective: "Maximize Sortino (6m backtest, weekly NIFTY options)",
      method: "Bayesian (GP-EI · 80 iterations)",
      history: [],
    },
    {
      id: "swing-trend-tuning", name: "Swing Pullback · trend filter", strategy: "Swing Pullback v1",
      status: "completed", iter: 60, maxIter: 60, started: "2 days ago", est: "Completed",
      best: { sharpe: 1.84, pnl: 9240, params: { ema_fast: 21, ema_slow: 89, atr_len: 14, atr_mult: 2.5, hold_days: 5 } },
      params: [
        { name: "ema_fast",   range: "10-30",  current: 21, type: "int" },
        { name: "ema_slow",   range: "50-200", current: 89, type: "int" },
        { name: "atr_len",    range: "7-21",   current: 14, type: "int" },
        { name: "atr_mult",   range: "1.5-4",  current: 2.5,type: "float" },
        { name: "hold_days",  range: "3-15",   current: 5,  type: "int" },
      ],
      objective: "Maximize Sharpe with min 1.5 trades/week",
      method: "Bayesian (GP-EI · 60 iterations)",
      history: [0.32, 0.41, 0.62, 0.55, 0.84, 1.02, 0.91, 1.18, 1.25, 1.41, 1.32, 1.55, 1.48, 1.62, 1.71, 1.58, 1.74, 1.79, 1.81, 1.84],
    },
  ];

  const j = jobs.find(x => x.id === job) || jobs[0];

  // Parallel-coordinates style: best so far chart
  const histMax = Math.max(...j.history, 1);

  return (
    <>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 12, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
            Auto-tuner · Bayesian optimization
          </div>
          <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 4, maxWidth: 720 }}>
            Find the best parameter combination for each strategy. Uses a Gaussian Process surrogate model — 50× faster than grid search, ~3× faster than random search.
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowNew(true)}>
          <I.plus size={14}/> New tuning job
        </button>
      </div>

      {liveTune && (
        <div className="card" style={{ marginBottom: 16, background: "var(--info-soft, #eff6ff)", padding: 14, borderRadius: 12 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
            <div style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700 }}>Live tune · {liveTune.symbol} {liveTune.strategy}</div>
            <div className="mono" style={{ fontSize: 13 }}>{liveTune.combinations} combos on {liveTune.candlesUsed} candles</div>
          </div>
          {Array.isArray(liveTune.top) && liveTune.top.length > 0 && (
            <div style={{ marginTop: 12, fontSize: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Top params:</div>
              {liveTune.top.slice(0, 5).map((r, i) => (
                <div key={i} className="mono" style={{ padding: "3px 0", display: "flex", gap: 12 }}>
                  <span style={{ minWidth: 200 }}>{JSON.stringify(r.params)}</span>
                  <span style={{ color: r.totalPnl >= 0 ? "var(--up)" : "var(--down)" }}>pnl INR {r.totalPnl}</span>
                  <span>winRate {r.winRate}%</span>
                  <span>trades {r.trades}</span>
                  <span>vs B&H INR {r.vsBuyAndHold}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <div style={{ marginBottom: 12 }}>
        <button onClick={runLiveTune} disabled={liveTuneBusy} className="btn btn-primary" style={{ fontSize: 12 }}>
          {liveTuneBusy ? "Running..." : "Run live tune (RELIANCE rsi_mean_revert 27-combo)"}
        </button>
      </div>
      {/* Job stats */}
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat label="Active jobs"     value="1"    sub="2 queued"/>
        <Stat label="Total jobs (90d)" value="42"   sub="38 completed"/>
        <Stat label="Avg Sharpe lift" value="+0.61" sub="vs default params"/>
        <Stat label="Compute used"    value="84 hr" sub="₹680 LLM/CPU cost"/>
      </div>

      {/* Job picker */}
      <Card title="Tuning jobs">
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {jobs.map(jb => {
            const isSel = jb.id === job;
            return (
              <div key={jb.id}
                onClick={() => setJob(jb.id)}
                style={{
                  display: "grid", gridTemplateColumns: "auto 1fr auto auto auto auto",
                  alignItems: "center", gap: 12, padding: "12px 0",
                  borderTop: "1px solid var(--border)", cursor: "pointer",
                  background: isSel ? "var(--bg-soft)" : "transparent",
                  marginInline: isSel ? -12 : 0, paddingInline: isSel ? 12 : 0,
                  borderRadius: isSel ? "var(--r-sm)" : 0,
                }}>
                <div style={{
                  width: 6, height: 36, borderRadius: 3,
                  background: jb.status === "running" ? "var(--acc)" : jb.status === "queued" ? "var(--text-3)" : "var(--up)",
                }}/>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{jb.name}</div>
                  <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
                    {jb.strategy} · {jb.params.length} params · {jb.method}
                  </div>
                </div>
                <div style={{ fontSize: 11, color: "var(--text-3)" }}>{jb.iter}/{jb.maxIter} iter</div>
                <div style={{ width: 80, height: 4, background: "var(--border)", borderRadius: 2, overflow: "hidden" }}>
                  <div style={{
                    width: `${(jb.iter / jb.maxIter) * 100}%`, height: "100%",
                    background: jb.status === "running" ? "var(--acc)" : "var(--up)",
                  }}/>
                </div>
                <div className="mono" style={{ fontSize: 12, color: "var(--text-2)" }}>
                  {jb.best ? `Sharpe ${jb.best.sharpe.toFixed(2)}` : "—"}
                </div>
                <Chip variant={jb.status === "running" ? "info" : jb.status === "queued" ? "warn" : "up"}>
                  {jb.status === "running" ? "RUNNING" : jb.status === "queued" ? "QUEUED" : "✓ DONE"}
                </Chip>
              </div>
            );
          })}
        </div>
      </Card>

      <div style={{ height: 16 }}/>

      {/* Job detail */}
      <div className="grid" style={{ gridTemplateColumns: "1.2fr 1fr", gap: 16 }}>
        {/* Best so far chart */}
        <Card title="Best Sharpe so far" sub={`${j.iter} iterations completed · ${j.method}`}>
          {j.history.length > 0 ? (
            <>
              <svg width="100%" height="220" viewBox="0 0 600 220" style={{ display: "block" }}>
                {/* gridlines */}
                {[0, 1, 2, 3].map(i => (
                  <line key={i} x1={20} x2={580} y1={20 + i * 50} y2={20 + i * 50} stroke="var(--border)" strokeWidth="0.5"/>
                ))}
                {/* y-axis labels */}
                {[2.5, 1.875, 1.25, 0.625, 0].map((v, i) => (
                  <text key={i} x={12} y={24 + i * 50} fontSize="9" fill="var(--text-3)" textAnchor="end">{v.toFixed(1)}</text>
                ))}
                {/* line — running best */}
                {(() => {
                  let best = 0;
                  const points = j.history.map((v, i) => {
                    if (v > best) best = v;
                    const x = 20 + (i / Math.max(j.history.length - 1, 1)) * 560;
                    const y = 220 - 20 - (best / 2.5) * 180;
                    return { x, y, v: best, raw: v };
                  });
                  // Raw points (lighter)
                  const rawPoints = j.history.map((v, i) => {
                    const x = 20 + (i / Math.max(j.history.length - 1, 1)) * 560;
                    const y = 220 - 20 - (v / 2.5) * 180;
                    return { x, y, v };
                  });
                  return (
                    <>
                      {/* raw exploration dots */}
                      {rawPoints.map((p, i) => (
                        <circle key={`r${i}`} cx={p.x} cy={p.y} r="2.5" fill="var(--text-3)" opacity="0.55"/>
                      ))}
                      {/* running best line */}
                      <polyline
                        points={points.map(p => `${p.x},${p.y}`).join(" ")}
                        fill="none" stroke="var(--acc)" strokeWidth="2"/>
                      {points.map((p, i) => (
                        <circle key={`b${i}`} cx={p.x} cy={p.y} r="3" fill="var(--acc)"/>
                      ))}
                    </>
                  );
                })()}
                {/* legend */}
                <g transform="translate(440, 10)">
                  <circle cx={6} cy={6} r="3" fill="var(--acc)"/>
                  <text x={14} y={9} fontSize="10" fill="var(--text-2)">running best</text>
                  <circle cx={6} cy={22} r="2.5" fill="var(--text-3)" opacity="0.55"/>
                  <text x={14} y={25} fontSize="10" fill="var(--text-2)">each trial</text>
                </g>
              </svg>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 10, color: "var(--text-3)" }}>
                <span>iter 1</span>
                <span>iter {j.history.length}</span>
              </div>
            </>
          ) : (
            <div style={{ padding: 40, textAlign: "center", color: "var(--text-3)", fontSize: 12 }}>
              Job is queued. Will start after current job completes.
            </div>
          )}
        </Card>

        {/* Best params */}
        <Card title="Best parameters" sub={j.best ? `Sharpe ${j.best.sharpe.toFixed(2)} · P&L ₹${j.best.pnl.toLocaleString("en-IN")}` : "Pending"}>
          {j.best ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {j.params.map((p, i) => (
                <div key={p.name} style={{
                  display: "grid", gridTemplateColumns: "1fr auto auto",
                  alignItems: "center", gap: 12, padding: "10px 0",
                  borderTop: i ? "1px solid var(--border)" : "none",
                }}>
                  <div>
                    <div className="mono" style={{ fontSize: 12, fontWeight: 600 }}>{p.name}</div>
                    <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>range {p.range} · {p.type}</div>
                  </div>
                  <div className="mono" style={{ fontSize: 14, fontWeight: 600, color: "var(--acc)" }}>
                    {j.best.params[p.name]}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-3)" }}>best</div>
                </div>
              ))}
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button className="btn btn-primary" style={{ flex: 1 }}>Apply to live</button>
                <button className="btn btn-ghost">Promote to A/B</button>
              </div>
            </div>
          ) : (
            <div style={{ padding: 40, textAlign: "center", color: "var(--text-3)", fontSize: 12 }}>
              No completed iterations yet.
            </div>
          )}
        </Card>
      </div>

      <div style={{ height: 16 }}/>

      {/* Search space + safety */}
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <Card title="Search space" sub={j.objective}>
          <table className="table">
            <thead>
              <tr><th>Parameter</th><th>Range</th><th>Type</th><th style={{ textAlign: "right" }}>Current best</th></tr>
            </thead>
            <tbody>
              {j.params.map(p => (
                <tr key={p.name}>
                  <td><span className="mono">{p.name}</span></td>
                  <td className="mono" style={{ color: "var(--text-3)" }}>{p.range}</td>
                  <td><Chip variant="info">{p.type}</Chip></td>
                  <td style={{ textAlign: "right" }} className="mono">{p.current}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Safety guards" sub="Auto-tuner won't run wild">
          <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 12 }}>
            {[
              { ic: "✓", t: "Walk-forward only", d: "Each candidate evaluated on held-out windows. No look-ahead bias." },
              { ic: "✓", t: "Min sample size", d: "Discards any candidate with <50 trades in the test window." },
              { ic: "✓", t: "Robustness check", d: "Top-5 candidates re-tested with ±5% param noise. Drops fragile peaks." },
              { ic: "✓", t: "Out-of-sample gate", d: "Best params from optimization window must beat baseline on the next month before promotion." },
              { ic: "✓", t: "Manual review", d: "Auto-apply disabled by default — you confirm before deployment." },
            ].map((g, i) => (
              <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <div style={{ width: 18, height: 18, borderRadius: "50%", background: "var(--up-soft)", color: "var(--up)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{g.ic}</div>
                <div>
                  <div style={{ fontWeight: 600 }}>{g.t}</div>
                  <div style={{ color: "var(--text-3)", marginTop: 2 }}>{g.d}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* New job modal */}
      {showNew && (
        <div onClick={() => setShowNew(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "var(--bg)", borderRadius: "var(--r-lg)", padding: 24, width: 520, maxWidth: "90vw", border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>New tuning job</div>
            <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 18 }}>Pick a strategy. We'll auto-detect tunable params.</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Field label="Objective"><select className="input"><option>Maximize Sharpe ratio</option><option>Maximize Sortino ratio</option><option>Maximize total P&L</option><option>Minimize max drawdown</option></select></Field>
              <Field label="Backtest window"><select className="input"><option>1 year (rolling)</option><option>6 months</option><option>2 years</option></select></Field>
              <Field label="Iteration budget"><select className="input"><option>50 iterations (~1h)</option><option>100 iterations (~2h)</option><option>200 iterations (~5h)</option></select></Field>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 18, justifyContent: "flex-end" }}>
              <button className="btn btn-ghost" onClick={() => setShowNew(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => setShowNew(false)}>Queue job</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

window.TunerScreen = TunerScreen;
