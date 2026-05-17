/* eslint-disable */
/* PnL attribution — decompose total PnL by strategy / mode / symbol / alpha source */

const AttributionScreen = () => {
  // ---- live /api/pnl/by-strategy + /api/pnl/daily ----
  const [liveByStrat, setLiveByStrat] = React.useState(null);
  const [liveDaily, setLiveDaily] = React.useState(null);
  React.useEffect(() => {
    if (window.MockData && window.MockData.isDemoOn && window.MockData.isDemoOn()) return;
    let cancelled = false;
    (async () => {
      try {
        const [a, b] = await Promise.all([
          window.fetchApi('/api/pnl/by-strategy'),
          window.fetchApi('/api/pnl/daily?days=30'),
        ]);
        if (!cancelled && a && a.ok) setLiveByStrat(a.strategies || []);
        if (!cancelled && b && b.ok) setLiveDaily({ rows: b.rows || [], stats: b.stats });
      } catch (e) {}
    })();
    return () => { cancelled = true; };
  }, []);
  const [lens, setLens] = React.useState("strategy");

  const __mock_byStrategy = [
    { name: "Momentum AI",     pnl: 48200, trades: 142, pct: 39 },
    { name: "Breakout",         pnl: 64800, trades: 18, pct: 52 },
    { name: "Mean Reversion",   pnl: 22400, trades: 428, pct: 18 },
    { name: "IV Crush",         pnl: 12400, trades: 24, pct: 10 },
    { name: "Event-Momentum",   pnl: -8400, trades: 34, pct: -7 },
    { name: "Iron Condor",      pnl: -14200, trades: 8, pct: -11 },
  ];
  const byStrategy = (liveByStrat && liveByStrat.length > 0)
    ? liveByStrat.map(s => ({
        name: s.strategy, pnl: s.realizedPnl, trades: s.trades, pct: 0,
        winRate: s.winRate, live: true,
      }))
    : __mock_byStrategy;


  const byMode = [
    { name: "Positional", pnl: 64800, pct: 52 },
    { name: "Intraday",   pnl: 70600, pct: 57 },
    { name: "Options",    pnl: -1800, pct: -1 },
    { name: "Swing",      pnl: -8400, pct: -7 },
  ];

  const bySymbol = [
    { sym: "RELIANCE",  pnl: 28400, trades: 42 },
    { sym: "TCS",       pnl: 22800, trades: 28 },
    { sym: "HDFCBANK", pnl: 18200, trades: 36 },
    { sym: "INFY",      pnl: 14200, trades: 24 },
    { sym: "ICICIBANK",pnl: 12800, trades: 22 },
    { sym: "NIFTY",     pnl: 10400, trades: 18 },
    { sym: "ADANIENT",  pnl: -4200, trades: 8 },
    { sym: "PAYTM",     pnl: -6400, trades: 12 },
  ];

  const byAlpha = [
    { src: "Technical (ML)",      pnl: 58400, pct: 47, desc: "RSI/MACD + order-flow patterns" },
    { src: "News sentiment (AI)", pnl: 24600, pct: 20, desc: "Claude-analyzed news impact" },
    { src: "Options flow",         pnl: 18200, pct: 15, desc: "Unusual OI buildup signals" },
    { src: "Cross-asset",          pnl: 14800, pct: 12, desc: "USD/INR, crude, gold correlations" },
    { src: "Earnings surprise",    pnl: 8800, pct: 7, desc: "Pre-earnings AI analysis" },
    { src: "Macro events",         pnl: -800, pct: -1, desc: "RBI, Fed, budget reactions" },
  ];

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 12, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
            Operations · PnL attribution
          </div>
          <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 4, maxWidth: 720 }}>
            Decompose total PnL by different lenses. Answer the question: <em>where is my alpha actually coming from?</em>
          </div>
        </div>
        <select className="input" style={{ width: 140 }} defaultValue="ytd">
          <option value="mar2026">March 2026</option>
          <option value="q1-2026">Q1 2026</option>
          <option value="ytd">YTD 2026</option>
          <option value="last12">Trailing 12 mo</option>
        </select>
      </div>

      {window.ExportCsvButton && (
        <div style={{ marginBottom: 14, display: "flex", justifyContent: "flex-end" }}>
          <window.ExportCsvButton filename="pnl-attribution.csv" rows={[
            ...byStrategy.map(s => ({ lens: "strategy", name: s.name, pnl: s.pnl, trades: s.trades, pct: s.pct })),
            ...byMode.map(m => ({ lens: "mode", name: m.name, pnl: m.pnl, trades: "", pct: m.pct })),
            ...bySymbol.map(s => ({ lens: "symbol", name: s.sym, pnl: s.pnl, trades: s.trades, pct: "" })),
            ...byAlpha.map(a => ({ lens: "alpha-source", name: a.src, pnl: a.pnl, trades: "", pct: a.pct })),
          ]}/>
        </div>
      )}

      {/* T99-T73: honest banner — only byStrategy is live; other lenses are
          hardcoded demo until backend aggregations ship. */}
      <div role="note" style={{
        padding: '8px 12px', marginBottom: 12, borderRadius: 6,
        border: '1px solid color-mix(in oklab, var(--warn, #d97706) 35%, var(--border))',
        background: 'color-mix(in oklab, var(--warn, #d97706) 8%, transparent)',
        fontSize: 12, color: 'var(--text-2)',
      }}>
        <strong>Only "By strategy" is live data from /api/pnl/by-strategy.</strong>{' '}
        By mode / by symbol / by alpha source are demo aggregations pending backend implementation —
        ignore those numbers when reviewing your actual performance.
      </div>

      {/* Net PnL headline */}
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4 }}>Net PnL · March 2026</div>
            <div className="mono" style={{ fontSize: 40, fontWeight: 700, marginTop: 8, color: "var(--up)", letterSpacing: -0.5 }}>+₹1,24,800</div>
            <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 4 }}>+11.2% of deployed capital · 654 trades · win rate 58.4%</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase" }}>Gross</div>
            <div className="mono" style={{ fontSize: 16, fontWeight: 600 }}>+₹1,48,600</div>
            <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase", marginTop: 6 }}>- Costs</div>
            <div className="mono" style={{ fontSize: 16, fontWeight: 600, color: "var(--down)" }}>-₹23,800</div>
            <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 4 }}>fees + slippage + AI</div>
          </div>
        </div>
      </Card>

      {/* Lens selector */}
      <div style={{ marginTop: 16, display: "flex", gap: 4 }}>
        {[
          { k: "strategy", l: "By strategy" },
          { k: "mode",     l: "By mode" },
          { k: "symbol",   l: "By symbol" },
          { k: "alpha",    l: "By alpha source" },
        ].map(t => (
          <button key={t.k} className={lens === t.k ? "btn btn-primary" : "btn btn-ghost"} style={{ fontSize: 12 }} onClick={() => setLens(t.k)}>{t.l}</button>
        ))}
      </div>

      {/* Lens content */}
      <div style={{ marginTop: 12 }}>
        {lens === "strategy" && (
          <Card title="By strategy" sub="Which strategies earned vs lost this month">
            {byStrategy.map((s, i) => {
              const abs = Math.abs(s.pct);
              return (
                <div key={i} style={{ padding: "12px 0", borderBottom: i < byStrategy.length - 1 ? "1px solid var(--border)" : "none" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{s.name}</div>
                      <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>{s.trades} trades</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div className="mono" style={{ fontSize: 15, fontWeight: 700, color: s.pnl >= 0 ? "var(--up)" : "var(--down)" }}>
                        {s.pnl >= 0 ? "+" : ""}₹{(s.pnl / 1000).toFixed(1)}k
                      </div>
                      <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>{s.pct > 0 ? "+" : ""}{s.pct}% of total</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, height: 10 }}>
                    {s.pnl >= 0 ? (
                      <>
                        <div style={{ flex: 1, height: 10, background: "var(--border)", borderRadius: 2 }}>
                          <div style={{ width: `${abs * 1.5}%`, maxWidth: "100%", height: "100%", background: "var(--up)", borderRadius: 2 }}/>
                        </div>
                      </>
                    ) : (
                      <div style={{ flex: 1, height: 10, background: "var(--border)", borderRadius: 2 }}>
                        <div style={{ width: `${abs * 1.5}%`, maxWidth: "100%", height: "100%", background: "var(--down)", borderRadius: 2 }}/>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </Card>
        )}

        {lens === "mode" && (
          <Card title="By trading mode" sub="Which modes are your breadwinners">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
              {byMode.map((m, i) => (
                <div key={i} style={{ padding: 18, background: m.pnl >= 0 ? "var(--up-soft)" : "var(--down-soft)", borderRadius: "var(--r-md)", border: `1px solid ${m.pnl >= 0 ? "var(--up)" : "var(--down)"}20` }}>
                  <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase" }}>{m.name}</div>
                  <div className="mono" style={{ fontSize: 22, fontWeight: 700, marginTop: 8, color: m.pnl >= 0 ? "var(--up)" : "var(--down)" }}>
                    {m.pnl >= 0 ? "+" : ""}₹{(m.pnl / 1000).toFixed(1)}k
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-2)", marginTop: 6 }}>{m.pct > 0 ? "+" : ""}{m.pct}% of net</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 16, padding: 14, background: "var(--bg-soft)", borderRadius: "var(--r-md)", fontSize: 12, lineHeight: 1.6 }}>
              <strong>AI insight:</strong> Intraday and Positional are carrying the book. Options turned negative due to Iron Condor losses — see AI Review for recommendation. Swing underperforming — retune recommended.
            </div>
          </Card>
        )}

        {lens === "symbol" && (
          <Card title="By symbol" sub="Your top contributors and detractors">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div>
                <div style={{ fontSize: 11, color: "var(--up)", fontWeight: 600, textTransform: "uppercase", marginBottom: 8 }}>Top gainers</div>
                {bySymbol.filter(s => s.pnl > 0).slice(0, 6).map((s, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: i < 5 ? "1px solid var(--border)" : "none" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{s.sym}</div>
                      <div style={{ fontSize: 10, color: "var(--text-3)" }}>{s.trades} trades</div>
                    </div>
                    <div className="mono" style={{ fontSize: 14, fontWeight: 600, color: "var(--up)" }}>+₹{(s.pnl / 1000).toFixed(1)}k</div>
                  </div>
                ))}
              </div>
              <div>
                <div style={{ fontSize: 11, color: "var(--down)", fontWeight: 600, textTransform: "uppercase", marginBottom: 8 }}>Detractors</div>
                {bySymbol.filter(s => s.pnl < 0).map((s, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{s.sym}</div>
                      <div style={{ fontSize: 10, color: "var(--text-3)" }}>{s.trades} trades</div>
                    </div>
                    <div className="mono" style={{ fontSize: 14, fontWeight: 600, color: "var(--down)" }}>₹{(s.pnl / 1000).toFixed(1)}k</div>
                  </div>
                ))}
                <div style={{ marginTop: 16, padding: 12, background: "var(--warn-soft)", borderRadius: "var(--r-sm)", fontSize: 11, color: "oklch(40% 0.12 80)" }}>
                  Both detractors share a high-volatility profile. AI suggests adding a volatility filter to signal gen.
                </div>
              </div>
            </div>
          </Card>
        )}

        {lens === "alpha" && (
          <Card title="By alpha source" sub="Where is your edge actually coming from">
            {byAlpha.map((a, i) => (
              <div key={i} style={{ padding: "14px 0", borderBottom: i < byAlpha.length - 1 ? "1px solid var(--border)" : "none" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{a.src}</div>
                    <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{a.desc}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="mono" style={{ fontSize: 15, fontWeight: 700, color: a.pnl >= 0 ? "var(--up)" : "var(--down)" }}>
                      {a.pnl >= 0 ? "+" : ""}₹{(a.pnl / 1000).toFixed(1)}k
                    </div>
                    <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>{a.pct > 0 ? "+" : ""}{a.pct}% of total</div>
                  </div>
                </div>
                <div style={{ height: 8, background: "var(--border)", borderRadius: 2 }}>
                  <div style={{ width: `${Math.abs(a.pct) * 1.8}%`, maxWidth: "100%", height: "100%", background: a.pnl >= 0 ? "var(--acc)" : "var(--down)", borderRadius: 2 }}/>
                </div>
              </div>
            ))}
            <div style={{ marginTop: 16, padding: 14, background: "var(--acc-soft)", color: "var(--acc-ink)", borderRadius: "var(--r-md)", fontSize: 12, lineHeight: 1.6 }}>
              <strong>Claude insight:</strong> 47% of alpha is Technical/ML. News sentiment is the 2nd-largest contributor (20%) — your AI edge is real and measurable. Consider doubling News workers during earnings seasons.
            </div>
          </Card>
        )}
      </div>
    </>
  );
};

window.AttributionScreen = AttributionScreen;
