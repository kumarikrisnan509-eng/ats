/* eslint-disable */
/* Portfolio screen — long-term holdings + profit sweep waterfall.
   2026-05-13: equity `holdings` loads from /api/portfolio/holdings (per-user).
   2026-05-17 T-66: MF + ETF loaded from /api/me/portfolio/mf|etf (per-user).
                    Empty until CAS upload persists data to mf_holdings table.
                    Shows clean empty-state UI rather than misleading samples. */



/* ============================================================
 * Tier 39: FactorTiltPanel -- wires POST /api/portfolio/factor-tilt
 * (Tier 31 backend) into the React UI. Power-user tool: paste a
 * universe with per-stock factor scores, tweak 5 factor weights,
 * pick mode + top quintile, build the portfolio.
 *
 * Demo universe is 10 large-cap NSE names with public-domain factor
 * scores so users have something to play with on first load.
 * ============================================================ */
const __factorTiltDemoUniverse = [
  { symbol: 'RELIANCE',  momentum: 0.18, value: 0.04, quality: 0.15, lowVol: 12, size: 0.04, marketCap: 1.8e13 },
  { symbol: 'HDFCBANK',  momentum: 0.08, value: 0.06, quality: 0.18, lowVol: 15, size: 0.04, marketCap: 1.3e13 },
  { symbol: 'INFY',      momentum: 0.22, value: 0.05, quality: 0.25, lowVol: 13, size: 0.05, marketCap: 7.5e12 },
  { symbol: 'TCS',       momentum: 0.15, value: 0.04, quality: 0.32, lowVol: 16, size: 0.05, marketCap: 1.5e13 },
  { symbol: 'ICICIBANK', momentum: 0.12, value: 0.06, quality: 0.19, lowVol: 14, size: 0.05, marketCap: 8.5e12 },
  { symbol: 'ITC',       momentum: 0.05, value: 0.05, quality: 0.20, lowVol: 18, size: 0.06, marketCap: 5.4e12 },
  { symbol: 'KOTAKBANK', momentum: 0.07, value: 0.04, quality: 0.14, lowVol: 14, size: 0.05, marketCap: 3.5e12 },
  { symbol: 'LT',        momentum: 0.20, value: 0.04, quality: 0.16, lowVol: 12, size: 0.05, marketCap: 4.5e12 },
  { symbol: 'BAJFINANCE',momentum: 0.10, value: 0.03, quality: 0.22, lowVol: 11, size: 0.05, marketCap: 4.8e12 },
  { symbol: 'AXISBANK',  momentum: 0.14, value: 0.05, quality: 0.13, lowVol: 13, size: 0.05, marketCap: 3.2e12 },
];

const __factorTiltPresets = {
  'Equal weights':     { momentum: 0.20, value: 0.20, quality: 0.20, lowVol: 0.20, size: 0.20 },
  'Momentum tilted':   { momentum: 0.50, value: 0.10, quality: 0.20, lowVol: 0.10, size: 0.10 },
  'Value tilted':      { momentum: 0.10, value: 0.50, quality: 0.20, lowVol: 0.10, size: 0.10 },
  'Quality tilted':    { momentum: 0.10, value: 0.10, quality: 0.50, lowVol: 0.20, size: 0.10 },
  'Defensive (low-vol)':{ momentum: 0.10, value: 0.15, quality: 0.25, lowVol: 0.40, size: 0.10 },
};

const FactorTiltPanel = () => {
  const [universeText, setUniverseText] = React.useState(JSON.stringify(__factorTiltDemoUniverse, null, 2));
  const [weights, setWeights] = React.useState(__factorTiltPresets['Momentum tilted']);
  const [mode, setMode]       = React.useState('long-only');
  const [topPct, setTopPct]   = React.useState(0.3);

  const [running, setRunning] = React.useState(false);
  const [result, setResult]   = React.useState(null);
  const [error, setError]     = React.useState(null);

  const wSum = Object.values(weights).reduce((a, b) => a + Number(b || 0), 0);
  const wOk  = Math.abs(wSum - 1) < 0.001;

  const updateWeight = (k, v) => setWeights({ ...weights, [k]: Number(v) });
  const applyPreset = (name) => setWeights(__factorTiltPresets[name]);

  const normalize = () => {
    const total = Object.values(weights).reduce((a, b) => a + Number(b || 0), 0);
    if (total === 0) return;
    const next = {};
    for (const k of Object.keys(weights)) next[k] = Number((weights[k] / total).toFixed(4));
    setWeights(next);
  };

  const run = async () => {
    setRunning(true); setResult(null); setError(null);
    let universe;
    try { universe = JSON.parse(universeText); }
    catch (e) { setError('Invalid universe JSON: ' + e.message); setRunning(false); return; }
    try {
      const r = await window.fetchApi('/api/portfolio/factor-tilt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ universe, factorWeights: weights, mode, topPct: Number(topPct) }),
      });
      setResult(r);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setRunning(false);
    }
  };

  const inputStyle = {
    padding: '6px 8px', background: 'var(--bg-sunk)', border: '1px solid var(--border)',
    borderRadius: 'var(--r-md)', fontFamily: 'var(--mono)', fontSize: 12,
  };
  const cardStyle = { padding: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 };

  return (
    <div style={{ ...cardStyle, marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>Factor-tilt portfolio builder</div>
        <div style={{ fontSize: 11, color: 'var(--text-3)' }}>POST /api/portfolio/factor-tilt · 5 factors</div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        {/* Universe textarea */}
        <div style={{ flex: '1 1 320px' }}>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>
            Universe (JSON array of {'{ symbol, momentum, value, quality, lowVol, size, marketCap }'})
          </div>
          <textarea
            value={universeText}
            onChange={ev => setUniverseText(ev.target.value)}
            spellCheck={false}
            style={{ ...inputStyle, width: '100%', minHeight: 180, fontSize: 10 }}
          />
        </div>

        {/* Weights + mode */}
        <div style={{ flex: '1 1 280px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Factor weights (must sum to 1.0)</div>
          {['momentum', 'value', 'quality', 'lowVol', 'size'].map(k => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 80, fontSize: 12, color: 'var(--text-2)' }}>{k}</div>
              <input type="range" min="-1" max="1" step="0.05" value={weights[k]}
                     onChange={ev => updateWeight(k, ev.target.value)} style={{ flex: 1 }}/>
              <div className="mono" style={{ width: 50, fontSize: 11, textAlign: 'right' }}>{Number(weights[k]).toFixed(2)}</div>
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
            <span style={{ color: wOk ? 'var(--up)' : 'var(--down)' }}>
              Σ = {wSum.toFixed(3)} {wOk ? '✓' : '!'}
            </span>
            <button onClick={normalize} style={{ fontSize: 10, padding: '2px 8px', cursor: 'pointer' }}>normalize</button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>Presets:</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {Object.keys(__factorTiltPresets).map(n => (
              <button key={n} onClick={() => applyPreset(n)}
                      style={{ fontSize: 10, padding: '2px 8px', cursor: 'pointer' }}>{n}</button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <label style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>Mode</div>
              <select value={mode} onChange={ev => setMode(ev.target.value)} style={{ ...inputStyle, width: '100%' }}>
                <option value="long-only">long-only</option>
                <option value="long-short">long-short</option>
              </select>
            </label>
            <label style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>Top fraction</div>
              <input type="number" step="0.05" min="0.05" max="0.5" value={topPct}
                     onChange={ev => setTopPct(ev.target.value)} style={{ ...inputStyle, width: '100%' }}/>
            </label>
          </div>
        </div>
      </div>

      <button className="btn btn--accent" disabled={running || !wOk} onClick={run}
              style={{ marginTop: 12 }}>
        {running ? 'Building…' : 'Build portfolio'}
      </button>

      {error && (
        <div style={{ marginTop: 8, padding: 8, background: 'var(--bg-soft)', border: '1px solid var(--down)', borderRadius: 'var(--r-md)', color: 'var(--down)', fontSize: 12 }}>
          {error}
        </div>
      )}

      {result && result.ok && (
        <div style={{ marginTop: 12 }}>
          {/* Stats */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 12 }}>
            <div><span style={{ color: 'var(--text-3)' }}>Universe</span> <span className="mono">{result.stats && result.stats.universeSize}</span></div>
            <div><span style={{ color: 'var(--text-3)' }}>Longs</span> <span className="mono">{result.stats && result.stats.longCount}</span></div>
            {result.mode === 'long-short' && <div><span style={{ color: 'var(--text-3)' }}>Shorts</span> <span className="mono">{result.stats.shortCount}</span></div>}
            {result.mode === 'long-only'  && <div><span style={{ color: 'var(--text-3)' }}>Σ weights</span> <span className="mono">{result.stats.sumWeights}</span></div>}
          </div>
          {/* Portfolio factor exposure */}
          <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 12 }}>
            <div style={{ color: 'var(--text-3)' }}>Portfolio factor exposure (z-units):</div>
            {result.portfolioExposure && Object.entries(result.portfolioExposure).map(([k, v]) => (
              <div key={k}><span style={{ color: 'var(--text-3)' }}>{k}</span> <span className="mono" style={{ color: v >= 0 ? 'var(--up)' : 'var(--down)' }}>{Number(v).toFixed(2)}</span></div>
            ))}
          </div>
          {/* Longs + shorts tables */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
            <PositionsTable title="Longs" rows={result.longs}/>
            {result.shorts && result.shorts.length > 0 && <PositionsTable title="Shorts" rows={result.shorts}/>}
          </div>
        </div>
      )}
      {result && result.ok === false && (
        <div style={{ marginTop: 8, color: 'var(--down)', fontSize: 12 }}>Server: {result.reason}</div>
      )}
    </div>
  );
};

const PositionsTable = ({ title, rows }) => (
  <div style={{ flex: '1 1 280px', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
    <div style={{ padding: '6px 10px', fontSize: 11, fontWeight: 600, background: 'var(--bg-soft)' }}>{title} ({rows.length})</div>
    <table className="tbl" style={{ width: '100%', fontSize: 11 }}>
      <thead><tr><th>Symbol</th><th style={{ textAlign: 'right' }}>Weight</th><th style={{ textAlign: 'right' }}>Composite z</th></tr></thead>
      <tbody>
        {rows.slice(0, 50).map((r, i) => (
          <tr key={i}>
            <td className="mono">{r.symbol}</td>
            <td className="mono" style={{ textAlign: 'right' }}>{(r.weight * 100).toFixed(2)}%</td>
            <td className="mono" style={{ textAlign: 'right', color: r.compositeZ >= 0 ? 'var(--up)' : 'var(--down)' }}>{Number(r.compositeZ).toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const PortfolioScreen = () => {
  const [holdings, setHoldings] = React.useState([]);

  React.useEffect(() => {
    let cancelled = false;
    // If demo is ON, keep the sample; otherwise fetch real holdings.
    if (window.MockData && window.MockData.isDemoOn && window.MockData.isDemoOn()) {
      setHoldings([]);
      return;
    }
    (async () => {
      try {
        const data = await window.fetchApi('/api/portfolio/holdings');
        if (cancelled) return;
        // Normalize to screen's shape.
        const rows = (data && data.rows || []).map(r => ({
          s: r.symbol, qty: r.quantity, avg: r.avgPrice, ltp: r.ltp,
          sector: r.sector || '—',
        }));
        setHoldings(rows);
      } catch (err) {
        console.warn('[portfolio] /api/portfolio/holdings failed:', err.message);
        if (!cancelled) setHoldings([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // T99-T66: real per-user MF + ETF holdings from backend (no more sample data).
  // Backend endpoints currently return empty until CAS-upload persistence lands;
  // the empty-state UI guides the user to upload their CAS PDF.
  const [mf, setMf] = React.useState([]);
  const [etf, setEtf] = React.useState([]);
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const j = await window.fetchApi('/api/me/portfolio/mf');
        if (!cancelled && j && j.ok) setMf(j.holdings || []);
      } catch (_) {}
      try {
        const j2 = await window.fetchApi('/api/me/portfolio/etf');
        if (!cancelled && j2 && j2.ok) setEtf(j2.holdings || []);
      } catch (_) {}
    })();
    return () => { cancelled = true; };
  }, []);

  const totalEquity = holdings.reduce((s, h) => s + h.qty * h.ltp, 0);
  const totalMF = mf.reduce((s, m) => s + m.cur, 0);
  const totalETF = etf.reduce((s, e) => s + e.q * e.ltp, 0);

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-header__title">Portfolio</h1>
          <div className="page-header__sub">Long-term wealth — equity, mutual funds, ETFs. Fed by trading profit sweep.</div>
        </div>
        <div className="page-header__right">
          <button className="btn"><I.download size={14}/> Statement</button>
          <button className="btn btn--primary"><I.plus size={14}/> Add holding</button>
        </div>
      </div>

      {window.MultiBrokerPnL && <div style={{ marginBottom: 16 }}><window.MultiBrokerPnL/></div>}

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Card><Stat label="Long-term value" value={inrCompact(totalEquity + totalMF + totalETF)} delta={pct(1.12)} deltaKind="up" sub="today"/></Card>
        <Card><Stat label="Invested" value={inrCompact(24_80_000)} delta="cost basis" deltaKind="muted"/></Card>
        <Card><Stat label="Unrealized gain" value={inrCompact((totalEquity + totalMF + totalETF) - 2480000)} delta={pct(38.4)} deltaKind="up" sub="absolute"/></Card>
        <Card><Stat label="XIRR" value="16.8%" delta="+0.6pp MoM" deltaKind="up" sub="weighted"/></Card>
      </div>

      {/* Profit sweep waterfall */}
      <Card title="Profit → Long-term sweep" sub="Automatic flow from trading engine into long-term investments" style={{ marginBottom: 16 }}>
        <div className="waterfall">
          <div className="waterfall__step">
            <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>1 · Trading pot</div>
            <div className="mono" style={{ fontSize: 22, fontWeight: 500, margin: "6px 0" }}>{inr(284000)}</div>
            <div style={{ fontSize: 12 }} className="up">+{inr(42340)} <span className="muted">this month</span></div>
            {/* Mode attribution — shows which modes fed the pot */}
            <div style={{ marginTop: 10, padding: "8px 10px", background: "var(--bg-soft)", borderRadius: "var(--r-sm)" }}>
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-3)", marginBottom: 6 }}>By mode (MTD)</div>
              {[
                { id: "intraday", amt: 24820 },
                { id: "swing",    amt: 12640 },
                { id: "options",  amt:  4880 },
                { id: "futures",  amt:     0 },
              ].map(row => {
                const meta = window.MODE_META[row.id];
                const pctRow = (row.amt / 42340) * 100;
                return (
                  <div key={row.id} className="row" style={{ justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}>
                    <span className="row" style={{ gap: 5 }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: meta.color }}/>
                      <span style={{ color: "var(--text-2)" }}>{meta.label}</span>
                    </span>
                    <span className={"mono " + (row.amt > 0 ? "up" : "muted")}>
                      {row.amt > 0 ? "+" : ""}{row.amt === 0 ? "—" : inrCompact(row.amt)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="waterfall__step">
            <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>2 · Harvest rule</div>
            <div style={{ fontSize: 13, fontWeight: 500, margin: "6px 0" }}>On monthly profit ≥ ₹25k sweep 60%</div>
            <div className="muted" style={{ fontSize: 11 }}>Retain 40% as trading float</div>
            <div style={{ marginTop: 8 }}>
              <Pill kind="up" dot>triggered Apr 1</Pill>
            </div>
          </div>
          <div className="waterfall__step">
            <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>3 · Split</div>
            <div className="col" style={{ gap: 4, marginTop: 6, fontSize: 12 }}>
              <div className="between"><span>SIP booster</span><span className="mono">40%</span></div>
              <div className="between"><span>ETF lump</span><span className="mono">35%</span></div>
              <div className="between"><span>Direct equity</span><span className="mono">25%</span></div>
            </div>
          </div>
          <div className="waterfall__step">
            <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>4 · Deployed (MTD)</div>
            <div className="mono up" style={{ fontSize: 22, fontWeight: 500, margin: "6px 0" }}>{inr(182500)}</div>
            <div className="muted" style={{ fontSize: 11 }}>Next sweep: May 1, 10:00 IST</div>
            <div style={{ marginTop: 8 }}>
              <Pill kind="acc" dot>auto</Pill>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <Card title="Direct equity" sub={`${holdings.length} holdings`} flush>
          <table className="table">
            <thead><tr><th>Symbol</th><th>Sector</th><th className="num-l">Qty</th><th className="num-l">Avg</th><th className="num-l">LTP</th><th className="num-l">P&L</th></tr></thead>
            <tbody>
              {holdings.map((h, i) => {
                const pnl = (h.ltp - h.avg) * h.qty;
                const pct_ = ((h.ltp - h.avg) / h.avg) * 100;
                return (
                  <tr key={i}>
                    <td style={{ fontWeight: 500 }}>{h.s}</td>
                    <td><span className="muted" style={{ fontSize: 12 }}>{h.sector}</span></td>
                    <td className="num">{h.qty}</td>
                    <td className="num">{h.avg.toLocaleString("en-IN")}</td>
                    <td className="num">{h.ltp.toLocaleString("en-IN")}</td>
                    <td className={"num " + clsPN(pnl)}>
                      {pnl >= 0 ? "+" : ""}{inrCompact(pnl)}
                      <div className={"mono " + clsPN(pct_)} style={{ fontSize: 10 }}>{pct(pct_, 1)}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>

        <Card title="Mutual funds" sub="Active SIPs" flush>
          {mf.length === 0 ? (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>📈</div>
              <div style={{ fontWeight: 500, marginBottom: 4, color: 'var(--text-2)' }}>No mutual fund holdings yet</div>
              <div style={{ fontSize: 12 }}>Upload your CAS (Consolidated Account Statement) PDF on the Mutual Funds screen to populate.</div>
            </div>
          ) : (
            <table className="table">
              <thead><tr><th>Fund</th><th className="num-l">SIP</th><th className="num-l">Invested</th><th className="num-l">Current</th><th className="num-l">XIRR</th></tr></thead>
              <tbody>
                {mf.map((m, i) => (
                  <tr key={i}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{m.n}</div>
                      <div className="muted" style={{ fontSize: 11 }}>{m.t}</div>
                    </td>
                    <td className="num">{inr(m.sip)}/mo</td>
                    <td className="num">{inrCompact(m.inv)}</td>
                    <td className="num">{inrCompact(m.cur)}</td>
                    <td className="num up">{pct(m.xirr, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <Card title="ETFs" flush>
        {etf.length === 0 ? (
          <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>🪙</div>
            <div style={{ fontWeight: 500, marginBottom: 4, color: 'var(--text-2)' }}>No ETF holdings yet</div>
            <div style={{ fontSize: 12 }}>ETFs purchased on NSE/BSE will appear under <b>Equity holdings</b> above when your broker is connected.</div>
          </div>
        ) : (
        <table className="table">
          <thead><tr><th>ETF</th><th className="num-l">Qty</th><th className="num-l">Avg</th><th className="num-l">LTP</th><th className="num-l">Value</th><th className="num-l">P&L %</th></tr></thead>
          <tbody>
            {etf.map((e, i) => {
              const p = ((e.ltp - e.avg) / e.avg) * 100;
              return (
                <tr key={i}>
                  <td style={{ fontWeight: 500 }}>{e.n}</td>
                  <td className="num">{e.q}</td>
                  <td className="num">{e.avg.toFixed(2)}</td>
                  <td className="num">{e.ltp.toFixed(2)}</td>
                  <td className="num">{inrCompact(e.q * e.ltp)}</td>
                  <td className={"num " + clsPN(p)}>{pct(p, 1)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        )}
      </Card>
      <FactorTiltPanel />
    </>
  );
};

Object.assign(window, { PortfolioScreen });
