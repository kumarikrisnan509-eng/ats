/* eslint-disable */
/* Benchmarking — your PnL vs NIFTY, BANK NIFTY, peer cohort */

const BenchmarkScreen = () => {
  const [period, setPeriod] = React.useState("ytd");
  // ---- live /api/benchmark for RELIANCE rsi_mean_revert vs NIFTY 50 (1y) ----
  const [liveBench, setLiveBench] = React.useState(null);
  React.useEffect(() => {
    if (window.MockData && window.MockData.isDemoOn && window.MockData.isDemoOn()) return;
    let cancelled = false;
    const to = new Date().toISOString().slice(0,10);
    const from = new Date(Date.now() - 365*86400*1000).toISOString().slice(0,10);
    (async () => {
      try {
        const d = await window.fetchApi('/api/benchmark?symbol=RELIANCE&strategy=rsi_mean_revert&from=' + from + '&to=' + to + '&qty=10&period=14&entryRsi=30&exitRsi=65');
        if (!cancelled && d && d.ok) setLiveBench(d);
      } catch (e) { /* fall back to mock */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const periods = [
    { k: "1m", l: "1M" }, { k: "3m", l: "3M" }, { k: "ytd", l: "YTD" }, { k: "1y", l: "1Y" }, { k: "all", l: "All" },
  ];

  // Sample time-series: days 0..119 (4 months)
  const series = React.useMemo(() => {
    const n = 120;
    const portfolio = [], nifty = [], bank = [], peers = [];
    let p = 100, ni = 100, bn = 100, pr = 100;
    for (let i = 0; i < n; i++) {
      p  += (Math.sin(i * 0.1) + 0.5 + Math.random() * 0.6 - 0.3) * 0.5;
      ni += (Math.sin(i * 0.08) * 0.3 + 0.2 + Math.random() * 0.4 - 0.2) * 0.4;
      bn += (Math.sin(i * 0.12) * 0.3 + 0.15 + Math.random() * 0.5 - 0.25) * 0.4;
      pr += (Math.sin(i * 0.09) * 0.25 + 0.28 + Math.random() * 0.5 - 0.25) * 0.4;
      portfolio.push(p); nifty.push(ni); bank.push(bn); peers.push(pr);
    }
    return { portfolio, nifty, bank, peers };
  }, []);

  const final = {
    portfolio: series.portfolio[series.portfolio.length - 1] - 100,
    nifty: series.nifty[series.nifty.length - 1] - 100,
    bank: series.bank[series.bank.length - 1] - 100,
    peers: series.peers[series.peers.length - 1] - 100,
  };

  // Chart
  const W = 820, H = 280, pad = 40;
  const all = [...series.portfolio, ...series.nifty, ...series.bank, ...series.peers];
  const yMin = Math.min(...all) - 1;
  const yMax = Math.max(...all) + 1;
  const n = series.portfolio.length;
  const xp = (i) => pad + i / (n - 1) * (W - 2 * pad);
  const yp = (v) => H - pad - (v - yMin) / (yMax - yMin) * (H - 2 * pad);
  const pathFor = (arr) => arr.map((v, i) => `${i === 0 ? "M" : "L"}${xp(i)},${yp(v)}`).join(" ");

  const cohort = [
    { pct: 10, label: "Top 10%", value: "+24.8%", color: "var(--up)" },
    { pct: 25, label: "Top 25%", value: "+18.4%", color: "var(--up)" },
    { pct: 50, label: "Median",  value: "+12.2%", color: "var(--info)" },
    { pct: 75, label: "Bottom 25%", value: "+4.8%", color: "var(--down)" },
  ];
  const yourPercentile = 18;

  const attrStats = [
    { n: "Your portfolio",     ret: final.portfolio,  sharpe: 2.14, mdd: 8.4,  color: "var(--acc)" },
    { n: "NIFTY 50",           ret: final.nifty,      sharpe: 1.12, mdd: 12.8, color: "oklch(55% 0.15 280)" },
    { n: "BANK NIFTY",         ret: final.bank,       sharpe: 0.98, mdd: 14.2, color: "oklch(65% 0.13 80)" },
    { n: "Peer median",        ret: final.peers,      sharpe: 1.48, mdd: 10.6, color: "oklch(55% 0.12 180)" },
  ];

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
          Wealth · Benchmarking
        </div>
        <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 4, maxWidth: 720 }}>
          How your portfolio stacks up against major indices and a 2,400-trader anonymized peer cohort (similar capital + modes).
        </div>
      </div>

      {liveBench && (
        <div className="card" style={{ marginBottom: 16, background: "var(--info-soft, #eff6ff)", padding: 14, borderRadius: 12 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
            <div style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700 }}>Live · {liveBench.symbol} {liveBench.strategy} vs {liveBench.benchmark} (1y)</div>
            <div className="mono" style={{ fontSize: 14, fontWeight: 700, color: liveBench.vs.alpha >= 0 ? "var(--up)" : "var(--down)" }}>alpha {liveBench.vs.alpha}%</div>
            <div className="mono" style={{ fontSize: 13 }}>beta {liveBench.vs.beta}</div>
            <div className="mono" style={{ fontSize: 13 }}>excess return {liveBench.vs.excessReturn}%</div>
            <div className="mono" style={{ fontSize: 13 }}>excess sharpe {liveBench.vs.excessSharpe}</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10, fontSize: 12 }}>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Strategy</div>
              <div className="mono">trades {liveBench.strategy_.trades} · winRate {liveBench.strategy_.winRate}%</div>
              <div className="mono">annual {liveBench.strategy_.annualReturn}% · sharpe {liveBench.strategy_.sharpe}</div>
            </div>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Benchmark ({liveBench.benchmark})</div>
              <div className="mono">annual {liveBench.benchmark_.annualReturn}% · sharpe {liveBench.benchmark_.sharpe}</div>
              <div className="mono">maxDD {liveBench.benchmark_.maxDrawdownPct}%</div>
            </div>
          </div>
        </div>
      )}
      {/* Period tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
        {periods.map(p => (
          <button key={p.k} onClick={() => setPeriod(p.k)} style={{
            padding: "6px 14px", fontSize: 12, fontWeight: 500, borderRadius: "var(--r-sm)",
            border: "1px solid var(--border)",
            background: period === p.k ? "var(--acc)" : "var(--surface)",
            color: period === p.k ? "white" : "var(--text-2)",
            cursor: "pointer",
          }}>{p.l}</button>
        ))}
      </div>

      {/* Headline comparison */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
        {attrStats.map((s, i) => (
          <Card key={i}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: s.color }}/>
              <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600 }}>{s.n}</div>
            </div>
            <div className="mono" style={{ fontSize: 24, fontWeight: 700, marginTop: 6, color: s.ret >= 0 ? "var(--up)" : "var(--down)" }}>
              {s.ret >= 0 ? "+" : ""}{s.ret.toFixed(1)}%
            </div>
            <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>
              Sharpe {s.sharpe} · MDD {s.mdd}%
            </div>
          </Card>
        ))}
      </div>

      {/* Chart */}
      <Card title="Equity curves" sub="Normalized to 100 at period start">
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 280 }}>
          {/* grid */}
          {[0, 1, 2, 3, 4].map(g => {
            const y = pad + g * (H - 2 * pad) / 4;
            const v = yMax - g * (yMax - yMin) / 4;
            return (
              <g key={g}>
                <line x1={pad} y1={y} x2={W - pad} y2={y} stroke="var(--border)" strokeDasharray="2 4"/>
                <text x={8} y={y + 3} fill="var(--text-3)" fontSize={10} fontFamily="var(--mono)">{v.toFixed(0)}</text>
              </g>
            );
          })}
          {/* lines (least-to-most prominent) */}
          <path d={pathFor(series.bank)}   fill="none" stroke={attrStats[2].color} strokeWidth={1.5} opacity={0.7}/>
          <path d={pathFor(series.nifty)}  fill="none" stroke={attrStats[1].color} strokeWidth={1.5} opacity={0.7}/>
          <path d={pathFor(series.peers)}  fill="none" stroke={attrStats[3].color} strokeWidth={1.5} strokeDasharray="4 3"/>
          <path d={pathFor(series.portfolio)} fill="none" stroke={attrStats[0].color} strokeWidth={2.5}/>
          {/* x axis labels */}
          <text x={pad} y={H - 12} fill="var(--text-3)" fontSize={10} fontFamily="var(--mono)">Jan</text>
          <text x={W / 4} y={H - 12} fill="var(--text-3)" fontSize={10} fontFamily="var(--mono)">Feb</text>
          <text x={W / 2} y={H - 12} fill="var(--text-3)" fontSize={10} fontFamily="var(--mono)">Mar</text>
          <text x={W * 3 / 4} y={H - 12} fill="var(--text-3)" fontSize={10} fontFamily="var(--mono)">Apr</text>
          <text x={W - pad} y={H - 12} fill="var(--text-3)" fontSize={10} fontFamily="var(--mono)" textAnchor="end">Today</text>
        </svg>
        <div style={{ display: "flex", gap: 20, marginTop: 12, fontSize: 11 }}>
          {attrStats.map((s, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 14, height: 2, background: s.color, borderStyle: i === 3 ? "dashed" : "solid" }}/>
              <span>{s.n}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Peer cohort & alpha */}
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16, marginTop: 16 }}>
        <Card title="Peer cohort ranking" sub="Similar capital (₹5–15L), modes (Intraday + Swing), last 90d">
          <div style={{ position: "relative", padding: "20px 0" }}>
            <div style={{ position: "relative", height: 40, background: "linear-gradient(90deg, var(--down) 0%, oklch(65% 0.13 80) 25%, var(--info) 50%, var(--up) 100%)", borderRadius: 8, opacity: 0.25 }}/>

            {/* Markers */}
            {cohort.map((c, i) => {
              const left = 100 - c.pct;
              return (
                <div key={i} style={{ position: "absolute", left: `${left}%`, top: 0, transform: "translateX(-50%)", textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: "var(--text-3)", marginBottom: 4 }}>{c.label}</div>
                  <div style={{ width: 1, height: 40, background: "var(--border)" }}/>
                  <div className="mono" style={{ fontSize: 10, fontWeight: 600, marginTop: 4 }}>{c.value}</div>
                </div>
              );
            })}

            {/* You marker */}
            <div style={{ position: "absolute", left: `${100 - yourPercentile}%`, top: 0, transform: "translateX(-50%)" }}>
              <div style={{ width: 28, height: 28, background: "var(--acc)", color: "white", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, marginTop: 6, border: "3px solid var(--surface)", boxShadow: "0 2px 8px rgba(0,0,0,0.15)" }}>
                YOU
              </div>
              <div style={{ width: 2, height: 28, background: "var(--acc)", margin: "0 auto" }}/>
              <div className="mono" style={{ fontSize: 11, fontWeight: 700, color: "var(--acc)", marginTop: 4, textAlign: "center", whiteSpace: "nowrap" }}>+{final.portfolio.toFixed(1)}%</div>
            </div>
          </div>
          <div style={{ marginTop: 60, padding: 12, background: "var(--up-soft)", color: "var(--up)", borderRadius: "var(--r-sm)", fontSize: 12, lineHeight: 1.5 }}>
            <strong>Top {yourPercentile}%</strong> of 2,412 traders in your cohort. You're outperforming the median by <strong>+{(final.portfolio - final.peers).toFixed(1)}pp</strong>.
          </div>
        </Card>

        <Card title="Alpha decomposition" sub="Where your edge comes from">
          {[
            { n: "vs NIFTY 50",    alpha: final.portfolio - final.nifty, desc: "Benchmark outperformance" },
            { n: "vs BANK NIFTY",  alpha: final.portfolio - final.bank,  desc: "Sector comparison" },
            { n: "vs Peer median", alpha: final.portfolio - final.peers, desc: "Skill vs luck indicator" },
            { n: "Risk-adjusted",  alpha: 8.4, desc: "Sharpe edge over peers" },
          ].map((a, i) => (
            <div key={i} style={{ padding: "10px 0", borderBottom: i < 3 ? "1px solid var(--border)" : "none" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{a.n}</div>
                  <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{a.desc}</div>
                </div>
                <div className="mono" style={{ fontSize: 16, fontWeight: 700, color: a.alpha >= 0 ? "var(--up)" : "var(--down)" }}>
                  {a.alpha >= 0 ? "+" : ""}{a.alpha.toFixed(1)}pp
                </div>
              </div>
            </div>
          ))}
        </Card>
      </div>

      {/* Monthly win/loss vs benchmark */}
      <div style={{ marginTop: 16 }}>
        <Card title="Monthly win rate vs benchmarks" sub="Green = your portfolio beat the benchmark that month">
          <div style={{ display: "grid", gridTemplateColumns: "1fr repeat(4, 80px)", gap: 8 }}>
            <div/><div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600, textAlign: "center" }}>Jan</div>
            <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600, textAlign: "center" }}>Feb</div>
            <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600, textAlign: "center" }}>Mar</div>
            <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600, textAlign: "center" }}>Apr (MTD)</div>
            {[
              { n: "vs NIFTY", results: [1, 0, 1, 1] },
              { n: "vs BANK NIFTY", results: [1, 1, 0, 1] },
              { n: "vs Peer median", results: [0, 1, 1, 1] },
            ].map((row, i) => (
              <React.Fragment key={i}>
                <div style={{ fontSize: 12, fontWeight: 500, padding: "8px 0" }}>{row.n}</div>
                  <div key={j} style={{ padding: 10, background: r ? "var(--up-soft)" : "var(--down-soft)", color: r ? "var(--up)" : "var(--down)", borderRadius: "var(--r-sm)", textAlign: "center", fontSize: 14, fontWeight: 700 }}>
                    {r ? "✓" : "×"}
                  </div>
                ))}
              </React.Fragment>
            ))}
          </div>
          <div style={{ marginTop: 12, padding: 12, background: "var(--info-soft)", color: "var(--info)", borderRadius: "var(--r-sm)", fontSize: 11, lineHeight: 1.5 }}>
            <strong>Win rate:</strong> 10 out of 12 monthly comparisons won (83%). Your worst relative month was Feb (volatile regime) — matches the regime detector's historical data.
          </div>
        </Card>
      </div>
    </>
  );
};

window.BenchmarkScreen = BenchmarkScreen;
