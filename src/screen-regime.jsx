/* eslint-disable */
/* Market regime detector — trending / ranging / volatile → strategy switcher */

const RegimeScreen = () => {
  // ---- live regime classification from /api/regime (NIFTY 50) ----
  const [liveRegime, setLiveRegime] = React.useState(null);
  const [liveRegimeErr, setLiveRegimeErr] = React.useState(null);
  React.useEffect(() => {
    if (window.MockData && window.MockData.isDemoOn && window.MockData.isDemoOn()) return;
    let cancelled = false;
    (async () => {
      try {
        const d = await window.fetchApi('/api/regime?symbol=NIFTY+50&lookback=365');
        if (!cancelled && d && d.ok) setLiveRegime(d);
      } catch (e) { if (!cancelled) setLiveRegimeErr(e.message); }
    })();
    return () => { cancelled = true; };
  }, []);

  const regimes = [
    { k: "trending",   label: "Strong uptrend",    prob: 58, color: "var(--up)",   bg: "var(--up-soft)", icon: "↗", desc: "Directional momentum, break-outs, momentum plays" },
    { k: "ranging",    label: "Range-bound",        prob: 22, color: "var(--info)", bg: "var(--info-soft)", icon: "↔", desc: "Mean-reversion, iron condors, range-scalp" },
    { k: "volatile",   label: "High volatility",    prob: 16, color: "oklch(65% 0.13 80)", bg: "var(--warn-soft)", icon: "↕", desc: "Straddles, gap-fade, reduced position sizing" },
    { k: "correction", label: "Correction risk",    prob: 4,  color: "var(--down)", bg: "var(--down-soft)", icon: "↘", desc: "Defensive, hedges, short-bias, cash hold" },
  ];

  const indicators = [
    { n: "VIX",               v: "14.82", d: "-4.2% · Low volatility", kind: "trending" },
    { n: "NIFTY ADX(14)",     v: "32.4",  d: ">25 · Strong trend",      kind: "trending" },
    { n: "RSI(14)",           v: "62.8",  d: "Bullish momentum",        kind: "trending" },
    { n: "Market breadth",    v: "74%",   d: "Stocks above 50 DMA",     kind: "trending" },
    { n: "FII flows (5d)",    v: "+₹4,820Cr", d: "Buying pressure",     kind: "trending" },
    { n: "Put/Call ratio",    v: "0.78",  d: "Neutral-bullish",          kind: "trending" },
    { n: "NIFTY IV percentile",v: "32",  d: "Low → IV expansion possible", kind: "ranging" },
    { n: "Correlation (Bank↔IT)", v: "0.68", d: "Elevated, reduce diversif.", kind: "volatile" },
  ];

  const regimeHistory = [
    { month: "Dec 2025", regime: "ranging",    pnl: 12400 },
    { month: "Jan 2026", regime: "trending",   pnl: 48200 },
    { month: "Feb 2026", regime: "volatile",   pnl: -8400 },
    { month: "Mar 2026", regime: "trending",   pnl: 64800 },
    { month: "Apr 2026", regime: "trending",   pnl: 24800 },
  ];

  const strategyMap = [
    { regime: "trending",  strats: [{ n: "Momentum AI", recommended: true, perf: "+18%" }, { n: "Breakout", recommended: true, perf: "+24%" }, { n: "Mean Reversion", recommended: false, perf: "-2%" }] },
    { regime: "ranging",   strats: [{ n: "Iron Condor", recommended: true, perf: "+12%" }, { n: "Mean Reversion", recommended: true, perf: "+15%" }, { n: "Momentum AI", recommended: false, perf: "+4%" }] },
    { regime: "volatile",  strats: [{ n: "Long Straddle", recommended: true, perf: "+22%" }, { n: "VIX hedge", recommended: true, perf: "+18%" }, { n: "Breakout", recommended: false, perf: "-8%" }] },
    { regime: "correction",strats: [{ n: "Protective Puts", recommended: true, perf: "+8%" }, { n: "Short-bias", recommended: true, perf: "+14%" }, { n: "Momentum AI", recommended: false, perf: "-22%" }] },
  ];

  const primary = regimes[0];

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
          Automate · Market regime detector
        </div>
        <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 4, maxWidth: 720 }}>
          AI-classified market regime updated every 15 minutes. Auto-adjusts strategy weights to favor strategies that perform in the current regime.
        </div>
      </div>

      {/* LIVE regime classification from /api/regime */}
      {liveRegime && (
        <Card style={{ marginBottom: 16, background: "var(--accent-soft, var(--info-soft))" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <div style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700 }}>
              Live · {liveRegime.symbol}
            </div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{liveRegime.regime.replace(/_/g, " ")}</div>
            <div className="mono" style={{ fontSize: 14, color: "var(--text-2)" }}>confidence: {(liveRegime.confidence * 100).toFixed(0)}%</div>
            <div style={{ flex: 1, minWidth: 240, fontSize: 13, color: "var(--text-2)" }}>{liveRegime.reason}</div>
          </div>
          <div style={{ display: "flex", gap: 18, marginTop: 12, flexWrap: "wrap", fontSize: 12, color: "var(--text-2)" }}>
            <div>ADX: <span className="mono" style={{ color: "var(--text-1)" }}>{liveRegime.indicators.adx ?? "—"}</span></div>
            <div>+DI: <span className="mono" style={{ color: "var(--text-1)" }}>{liveRegime.indicators.plusDi ?? "—"}</span></div>
            <div>-DI: <span className="mono" style={{ color: "var(--text-1)" }}>{liveRegime.indicators.minusDi ?? "—"}</span></div>
            <div>ATR%: <span className="mono" style={{ color: "var(--text-1)" }}>{liveRegime.indicators.atrPct ?? "—"}</span></div>
            <div>close: <span className="mono" style={{ color: "var(--text-1)" }}>{liveRegime.indicators.close ?? "—"}</span></div>
            <div>SMA50: <span className="mono" style={{ color: "var(--text-1)" }}>{liveRegime.indicators.sma50 ?? "—"}</span></div>
            <div>SMA200: <span className="mono" style={{ color: "var(--text-1)" }}>{liveRegime.indicators.sma200 ?? "—"}</span></div>
          </div>
        </Card>
      )}
      {liveRegimeErr && !liveRegime && (
        <Card style={{ marginBottom: 16, opacity: 0.7 }}>
          <div style={{ fontSize: 12, color: "var(--text-3)" }}>Live regime fetch failed: {liveRegimeErr}. Showing decorative defaults below.</div>
        </Card>
      )}

      {/* Current regime headline */}
      <Card>
        <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
          <div style={{
            width: 120, height: 120, borderRadius: "50%",
            background: `conic-gradient(${primary.color} 0 ${primary.prob * 3.6}deg, var(--border) ${primary.prob * 3.6}deg 360deg)`,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <div style={{ width: 100, height: 100, borderRadius: "50%", background: "var(--surface)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
              <div style={{ fontSize: 30, color: primary.color }}>{primary.icon}</div>
              <div className="mono" style={{ fontSize: 18, fontWeight: 700, color: primary.color }}>{primary.prob}%</div>
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4 }}>Current regime</div>
            <div style={{ fontSize: 28, fontWeight: 700, marginTop: 6, color: primary.color, letterSpacing: -0.3 }}>{primary.label}</div>
            <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 8 }}>{primary.desc}</div>
            <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 12 }}>Detected 2h 14m ago · next update in 6m · last change Mar 18</div>
          </div>
          <div style={{ width: 280 }}>
            <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase", marginBottom: 8 }}>Regime probabilities</div>
            {regimes.map((r, i) => (
              <div key={i} style={{ marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}>
                  <span>{r.label}</span>
                  <span className="mono" style={{ fontWeight: 600 }}>{r.prob}%</span>
                </div>
                <div style={{ height: 6, background: "var(--border)", borderRadius: 3 }}>
                  <div style={{ width: `${r.prob}%`, height: "100%", background: r.color, borderRadius: 3 }}/>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* Indicator grid */}
      <div style={{ marginTop: 16 }}>
        <Card title="Signal indicators" sub="Market-state inputs to the classifier">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            {indicators.map((ind, i) => {
              const r = regimes.find(rg => rg.k === ind.kind);
              return (
                <div key={i} style={{ padding: 14, border: "1px solid var(--border)", borderRadius: "var(--r-md)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase" }}>{ind.n}</div>
                    <Chip variant={r.k === "trending" ? "up" : r.k === "ranging" ? "info" : r.k === "volatile" ? "warn" : "down"}>{r.k}</Chip>
                  </div>
                  <div className="mono" style={{ fontSize: 18, fontWeight: 700, marginTop: 6 }}>{ind.v}</div>
                  <div style={{ fontSize: 11, color: "var(--text-2)", marginTop: 4 }}>{ind.d}</div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Strategy allocation by regime */}
      <div style={{ marginTop: 16 }}>
        <Card title="Strategy allocation by regime" sub="Historical performance when this regime was active">
          {strategyMap.map((map, i) => {
            const r = regimes.find(rg => rg.k === map.regime);
            return (
              <div key={i} style={{ padding: "14px 0", borderBottom: i < strategyMap.length - 1 ? "1px solid var(--border)" : "none" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <div style={{ width: 36, height: 36, borderRadius: 8, background: r.bg, color: r.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700 }}>{r.icon}</div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{r.label}</div>
                      <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>Probability: {r.prob}%</div>
                    </div>
                  </div>
                  {map.regime === primary.k && <Chip variant="up">● Active now</Chip>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            {indicators.map((ind, i) => {
              const r = regimes.find(rg => rg.k === ind.kind);
              return (
                <div key={i} style={{ padding: 14, border: "1px solid var(--border)", borderRadius: "var(--r-md)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase" }}>{ind.n}</div>
                    <Chip variant={r.k === "trending" ? "up" : r.k === "ranging" ? "info" : r.k === "volatile" ? "warn" : "down"}>{r.k}</Chip>
                  </div>
                  <div className="mono" style={{ fontSize: 18, fontWeight: 700, marginTop: 6 }}>{ind.v}</div>
                  <div style={{ fontSize: 11, color: "var(--text-2)", marginTop: 4 }}>{ind.d}</div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Strategy allocation by regime */}
      <div style={{ marginTop: 16 }}>
        <Card title="Strategy allocation by regime" sub="Historical performance when this regime was active">
          {strategyMap.map((map, i) => {
            const r = regimes.find(rg => rg.k === map.regime);
            return (
              <div key={i} style={{ padding: "14px 0", borderBottom: i < strategyMap.length - 1 ? "1px solid var(--border)" : "none" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <div style={{ width: 36, height: 36, borderRadius: 8, background: r.bg, color: r.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700 }}>{r.icon}</div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{r.label}</div>
                      <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>Probability: {r.prob}%</div>
                    </div>
                  </div>
                  {map.regime === primary.k && <Chip variant="up">● Active now</Chip>}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                  {map.strats.map((s, si) => (
                    <div key={si} style={{ padding: 10, background: s.recommended ? "var(--acc-soft)" : "var(--bg-soft)", borderRadius: "var(--r-sm)", border: s.recommended ? "1px solid var(--acc)" : "1px solid transparent" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ fontSize: 12, fontWeight: 600 }}>{s.n}</div>
                        {s.recommended && <span style={{ fontSize: 9, color: "var(--acc-ink)", background: "white", padding: "2px 5px", borderRadius: 3, fontWeight: 700 }}>PICK</span>}
                      </div>
                      <div className="mono" style={{ fontSize: 13, fontWeight: 700, marginTop: 4, color: s.perf.startsWith("+") ? "var(--up)" : "var(--down)" }}>{s.perf}</div>
                      <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>historical 90d in this regime</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </Card>
      </div>

      {/* Regime history timeline */}
      <div style={{ marginTop: 16 }}>
        <Card title="Regime history (5 months)" sub="Correlate your PnL with regime shifts">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10 }}>
            {regimeHistory.map((h, i) => {
              const r = regimes.find(rg => rg.k === h.regime);
              return (
                <div key={i} style={{ padding: 14, border: "1px solid var(--border)", borderRadius: "var(--r-md)", background: r.bg }}>
                  <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600 }}>{h.month}</div>
                  <div style={{ fontSize: 20, marginTop: 6, color: r.color }}>{r.icon}</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: r.color, textTransform: "capitalize" }}>{h.regime}</div>
                  <div className="mono" style={{ fontSize: 14, fontWeight: 700, marginTop: 8, color: h.pnl >= 0 ? "var(--up)" : "var(--down)" }}>
                    {h.pnl >= 0 ? "+" : ""}₹{(h.pnl / 1000).toFixed(1)}k
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 12, padding: 12, background: "var(--info-soft)", color: "var(--info)", borderRadius: "var(--r-sm)", fontSize: 11, lineHeight: 1.5 }}>
            <strong>Claude insight:</strong> Your strategies thrive in trending regimes (+₹48k–64k/mo) but struggle in volatile/ranging (-₹8k to +₹12k). Consider adding a regime-specific straddle strategy for high-vol months.
          </div>
        </Card>
      </div>
    </>
  );
};

window.RegimeScreen = RegimeScreen;
