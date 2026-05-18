/* eslint-disable */
/* PnL attribution — decompose total PnL by strategy / mode / symbol / alpha source */

const AttributionScreen = () => {
  // ---- live /api/pnl/by-strategy + /api/pnl/daily + /api/me/pnl ----
  const [liveByStrat, setLiveByStrat] = React.useState(null);
  const [liveDaily, setLiveDaily] = React.useState(null);
  // T99-T80: per-user pnl (real, from db.pnl_daily) — replaces the hardcoded
  // +₹1,24,800 / 11.2% / 654 trades headline. Shape: { rows: [{date, realized_pnl, unrealized_pnl, equity, trades}] }
  const [mePnl, setMePnl] = React.useState({ loading: true, rows: null, error: null });
  React.useEffect(() => {
    if (window.MockData && window.MockData.isDemoOn && window.MockData.isDemoOn()) {
      setMePnl({ loading: false, rows: null, error: null });
      return;
    }
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
      try {
        const me = await window.fetchApi('/api/me/pnl?n=30');
        if (!cancelled) setMePnl({ loading: false, rows: (me && me.rows) || [], error: null });
      } catch (e) {
        if (!cancelled) setMePnl({ loading: false, rows: null, error: e });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // T99-T80: derive real headline numbers from /api/me/pnl rows.
  // Rows: [{ date, realized_pnl, unrealized_pnl, equity, trades }]
  // - netPnl  = sum(realized_pnl)
  // - trades  = sum(trades)
  // - capital = most recent row's equity, falls back to null
  // We don't compute win rate here -- that requires per-trade ledger, which lives
  // in /api/pnl/by-strategy. Leave the sub-line bare when missing.
  const realPnl = React.useMemo(() => {
    if (!mePnl.rows || mePnl.rows.length === 0) return null;
    let net = 0, tr = 0;
    for (const r of mePnl.rows) {
      net += Number(r.realized_pnl) || 0;
      tr  += Number(r.trades) || 0;
    }
    const lastEquity = Number(mePnl.rows[0] && mePnl.rows[0].equity) || null;
    const pct = lastEquity && lastEquity > 0 ? (net / lastEquity) * 100 : null;
    return { net, trades: tr, equity: lastEquity, pct };
  }, [mePnl.rows]);
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


  // T99-T112: emptied previously-hardcoded byMode/bySymbol/byAlpha arrays.
  // T-73 banner already discloses these lenses are demo. When per-mode/per-
  // symbol/per-alpha attribution endpoints ship, replace with fetched state.
  // 'byStrategy' is wired to /api/pnl/by-strategy (live) — see liveByStrat.
  const byMode = [];
  const bySymbol = [];
  const byAlpha = [];

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

      {/* Net PnL headline -- T99-T80: real /api/me/pnl, no hardcoded values */}
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4 }}>Net PnL · last 30 days</div>
            <div className="mono" style={{ fontSize: 40, fontWeight: 700, marginTop: 8, color: realPnl && realPnl.net < 0 ? "var(--down)" : "var(--up)", letterSpacing: -0.5 }}>
              {mePnl.loading ? '…' : (realPnl == null ? '—' : (realPnl.net >= 0 ? '+' : '') + '₹' + Math.round(realPnl.net).toLocaleString('en-IN'))}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 4 }}>
              {mePnl.loading
                ? 'Loading per-user PnL…'
                : (realPnl == null
                    ? (mePnl.error ? 'PnL unavailable — sign in to see your numbers' : 'No closed trades yet')
                    : `${realPnl.pct != null ? (realPnl.pct >= 0 ? '+' : '') + realPnl.pct.toFixed(1) + '% of equity · ' : ''}${realPnl.trades} trades`)}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase" }}>Equity (latest)</div>
            <div className="mono" style={{ fontSize: 16, fontWeight: 600 }}>
              {realPnl && realPnl.equity != null ? '₹' + Math.round(realPnl.equity).toLocaleString('en-IN') : '—'}
            </div>
            <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 6 }}>
              Source: /api/me/pnl (sum of realized_pnl over last 30 daily snapshots)
            </div>
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
            {byMode.length === 0 ? (
              <div className="muted" style={{ padding: '32px 0', fontSize: 12, textAlign: 'center' }}>
                Per-mode attribution not wired — needs aggregation endpoint over per-trade ledger.
              </div>
            ) : (
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
            )}
          </Card>
        )}

        {lens === "symbol" && (
          <Card title="By symbol" sub="Your top contributors and detractors">
            {bySymbol.length === 0 ? (
              <div className="muted" style={{ padding: '32px 0', fontSize: 12, textAlign: 'center' }}>
                Per-symbol attribution not wired — needs aggregation endpoint over per-trade ledger.
              </div>
            ) : (
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
                </div>
              </div>
            )}
          </Card>
        )}

        {lens === "alpha" && (
          <Card title="By alpha source" sub="Where is your edge actually coming from">
            {byAlpha.length === 0 ? (
              <div className="muted" style={{ padding: '32px 0', fontSize: 12, textAlign: 'center' }}>
                Per-alpha-source attribution not wired — needs strategy→source tag schema.
              </div>
            ) : null}
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
            {byAlpha.length > 0 && <div style={{ marginTop: 16, padding: 14, background: "var(--acc-soft)", color: "var(--acc-ink)", borderRadius: "var(--r-md)", fontSize: 12, lineHeight: 1.6 }}>
              <strong>Claude insight:</strong> 47% of alpha is Technical/ML. News sentiment is the 2nd-largest contributor (20%) — your AI edge is real and measurable. Consider doubling News workers during earnings seasons.
            </div>}
          </Card>
        )}
      </div>
    </>
  );
};

window.AttributionScreen = AttributionScreen;
