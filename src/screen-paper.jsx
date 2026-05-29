/* eslint-disable */
// @ts-check
/* Paper Trading screen — Stage 2 of the pipeline */


/* ============================================================
 * Tier 33: ReplayPanel — wires the existing /api/paper/replay
 * (Tier 27 backend) into the React UI. Replaces the mock card
 * that was here before.
 * ============================================================ */
const ReplayPanel = () => {
  const today = new Date();
  const daysAgo = (n) => {
    const d = new Date(today); d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  };

  const [symbol, setSymbol]       = React.useState("RELIANCE");
  const [from, setFrom]           = React.useState(daysAgo(60));
  const [to, setTo]               = React.useState(daysAgo(1));
  const [strategy, setStrategy]   = React.useState("rsi-mean-reversion");
  const [qty, setQty]             = React.useState(1);
  const [interval, setInterval_]  = React.useState("day");

  const [strategies, setStrategies] = React.useState([]);
  const [strategiesErr, setStrategiesErr] = React.useState(null);
  const [running, setRunning] = React.useState(false);
  const [result, setResult]   = React.useState(null);
  const [error, setError]     = React.useState(null);

  React.useEffect(() => {
    (async () => {
      try {
        const d = await window.fetchApi('/api/strategies');
        const list = (d && (d.strategies || d.list || d)) || [];
        const ids = Array.isArray(list)
          ? list.map(s => (typeof s === 'string' ? s : (s.id || s.name))).filter(Boolean)
          : [];
        if (ids.length > 0) {
          setStrategies(ids);
          if (!ids.includes(strategy)) setStrategy(ids[0]);
        }
      } catch (e) {
        setStrategiesErr(String(e.message || e));
      }
    })();
  }, []);

  const run = async () => {
    setRunning(true); setResult(null); setError(null);
    try {
      const body = { symbol, from, to, strategy, qty: Number(qty) || 1, interval };
      const r = await window.fetchApi('/api/paper/replay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setResult(r);
    } catch (e) {
      setError((window.formatErr && window.formatErr(e)) || String(e.message || e));
    } finally {
      setRunning(false);
    }
  };

  const inputStyle = {
    width: "100%", padding: "6px 8px",
    background: "var(--bg-sunk)", border: "1px solid var(--border)",
    borderRadius: "var(--r-md)", fontFamily: "var(--mono)", fontSize: 12,
  };

  const stats = result && result.stats;
  return (
    <Card title="Replay mode" sub="Step-through historical bars + signals · POST /api/paper/replay">
      <div className="col" style={{ gap: 10 }}>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <label style={{ flex: "1 1 120px" }}>
            <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4 }}>Symbol</div>
            <input style={inputStyle} value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())}/>
          </label>
          <label style={{ flex: "1 1 110px" }}>
            <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4 }}>From</div>
            <input style={inputStyle} type="date" value={from} onChange={e => setFrom(e.target.value)}/>
          </label>
          <label style={{ flex: "1 1 110px" }}>
            <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4 }}>To</div>
            <input style={inputStyle} type="date" value={to} onChange={e => setTo(e.target.value)}/>
          </label>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <label style={{ flex: "2 1 200px" }}>
            <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4 }}>Strategy {strategiesErr && <span style={{ color: "var(--down)" }}>({strategiesErr})</span>}</div>
            <select style={inputStyle} value={strategy} onChange={e => setStrategy(e.target.value)}>
              {strategies.length > 0
                ? strategies.map(s => <option key={s} value={s}>{s}</option>)
                : <option value={strategy}>{strategy}</option>}
            </select>
          </label>
          <label style={{ flex: "1 1 70px" }}>
            <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4 }}>Qty</div>
            <input style={inputStyle} type="number" min="1" value={qty} onChange={e => setQty(e.target.value)}/>
          </label>
          <label style={{ flex: "1 1 100px" }}>
            <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4 }}>Interval</div>
            <select style={inputStyle} value={interval} onChange={e => setInterval_(e.target.value)}>
              <option value="day">day</option>
              <option value="60minute">60m</option>
              <option value="15minute">15m</option>
              <option value="5minute">5m</option>
            </select>
          </label>
        </div>
        <button className="btn btn--accent" disabled={running} onClick={run}>
          {running ? <><I.refresh size={12}/> Running…</> : <><I.play size={12}/> Run replay</>}
        </button>
        {error && (
          <div style={{ padding: 8, background: "var(--bg-soft)", border: "1px solid var(--down)", borderRadius: "var(--r-md)", color: "var(--down)", fontSize: 12 }}>
            {error}
          </div>
        )}
        {stats && (
          <div className="col" style={{ gap: 8 }}>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <StatPill label="Trades"     value={stats.trades}/>
              <StatPill label="Win rate"   value={(stats.winRate != null ? stats.winRate + "%" : "—")}/>
              <StatPill label="Total P&L"  value={"₹" + (stats.totalPnl != null ? Math.round(stats.totalPnl).toLocaleString('en-IN') : "—")}
                    accent={stats.totalPnl >= 0 ? "up" : "down"}/>
              {stats.wins != null  && <StatPill label="Wins"   value={stats.wins}/>}
              {stats.losses != null && <StatPill label="Losses" value={stats.losses}/>}
            </div>
            {Array.isArray(result.trades) && result.trades.length > 0 && (
              <div style={{ maxHeight: 180, overflowY: "auto", border: "1px solid var(--border)", borderRadius: "var(--r-md)" }}>
                <table className="tbl" style={{ width: "100%", fontSize: 11 }}>
                  <thead><tr><th>When</th><th>Side</th><th>Entry</th><th>Exit</th><th style={{ textAlign: "right" }}>P&L</th></tr></thead>
                  <tbody>
                    {result.trades.slice(0, 50).map((t, i) => (
                      <tr key={i}>
                        <td className="mono">{String(t.entryTime || t.t || '—').slice(0, 16)}</td>
                        <td>{t.side || '—'}</td>
                        <td className="mono">{t.entry != null ? t.entry : '—'}</td>
                        <td className="mono">{t.exit != null ? t.exit : '—'}</td>
                        <td className="mono" style={{ textAlign: "right", color: (t.pnl || 0) >= 0 ? "var(--up)" : "var(--down)" }}>
                          {t.pnl != null ? (t.pnl >= 0 ? '+' : '') + Math.round(t.pnl).toLocaleString('en-IN') : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
};

const BracketOrderPanel = () => {
  const [symbol, setSymbol]   = React.useState("RELIANCE");
  const [side, setSide]       = React.useState("BUY");
  const [qty, setQty]         = React.useState(50);
  const [entry, setEntry]     = React.useState(2950);
  const [slOffset, setSlOff]  = React.useState(15);
  const [tgtOffset, setTgtOff]= React.useState(30);

  const [submitting, setSubmitting] = React.useState(false);
  const [result, setResult]   = React.useState(null);
  const [error, setError]     = React.useState(null);

  const e = Number(entry), sl = Number(slOffset), tgt = Number(tgtOffset), q = Number(qty);
  const stopPx   = side === "BUY" ? e - sl  : e + sl;
  const targetPx = side === "BUY" ? e + tgt : e - tgt;
  const risk     = sl  * q;
  const reward   = tgt * q;
  const rr       = sl > 0 ? +(tgt / sl).toFixed(2) : null;

  const inputStyle = {
    width: "100%", padding: "6px 8px",
    background: "var(--bg-sunk)", border: "1px solid var(--border)",
    borderRadius: "var(--r-md)", fontFamily: "var(--mono)", fontSize: 12,
  };

  const dryRun = async () => {
    setSubmitting(true); setResult(null); setError(null);
    try {
      const body = {
        strategyTag: "ui.bracket-builder",
        instrument:  symbol,
        side, quantity: q, product: "BO",
        orderType: "LIMIT", price: e,
        bracket: { stopLossOffset: sl, targetOffset: tgt, stopLossPrice: stopPx, targetPrice: targetPx },
        rationale: "R:R " + (rr || '?') + " on " + symbol + " " + side + " @ " + e,
      };
      const r = await window.fetchApi('/api/orders/dry-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setResult(r);
    } catch (ex) {
      setError((window.formatErr && window.formatErr(ex)) || String(ex.message || ex));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card
      title="Bracket order builder"
      sub="Entry + stop-loss + target as a single BO product · /api/orders/dry-run"
      style={{ marginTop: 16 }}>
      <div className="col" style={{ gap: 10 }}>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <label style={{ flex: "1 1 130px" }}>
            <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4 }}>Symbol</div>
            <input style={inputStyle} value={symbol} onChange={ev => setSymbol(ev.target.value.toUpperCase())}/>
          </label>
          <label style={{ flex: "1 1 80px" }}>
            <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4 }}>Side</div>
            <select style={inputStyle} value={side} onChange={ev => setSide(ev.target.value)}>
              <option value="BUY">BUY</option>
              <option value="SELL">SELL</option>
            </select>
          </label>
          <label style={{ flex: "1 1 80px" }}>
            <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4 }}>Qty</div>
            <input style={inputStyle} type="number" min="1" value={qty} onChange={ev => setQty(ev.target.value)}/>
          </label>
          <label style={{ flex: "1 1 110px" }}>
            <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4 }}>Entry ₹</div>
            <input style={inputStyle} type="number" step="0.05" value={entry} onChange={ev => setEntry(ev.target.value)}/>
          </label>
          <label style={{ flex: "1 1 100px" }}>
            <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4 }}>SL offset (pts)</div>
            <input style={inputStyle} type="number" step="0.05" min="0" value={slOffset} onChange={ev => setSlOff(ev.target.value)}/>
          </label>
          <label style={{ flex: "1 1 100px" }}>
            <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4 }}>Target offset (pts)</div>
            <input style={inputStyle} type="number" step="0.05" min="0" value={tgtOffset} onChange={ev => setTgtOff(ev.target.value)}/>
          </label>
        </div>

        <div style={{ padding: 10, background: "var(--bg-soft)", border: "1px solid var(--border)", borderRadius: "var(--r-md)" }}>
          <div className="row" style={{ gap: 14, flexWrap: "wrap", fontSize: 12 }}>
            <div><span style={{ color: "var(--text-3)" }}>Stop @</span> <span className="mono">₹{stopPx.toFixed(2)}</span></div>
            <div><span style={{ color: "var(--text-3)" }}>Target @</span> <span className="mono">₹{targetPx.toFixed(2)}</span></div>
            <div><span style={{ color: "var(--text-3)" }}>Risk</span> <span className="mono" style={{ color: "var(--down)" }}>-₹{Math.round(risk).toLocaleString('en-IN')}</span></div>
            <div><span style={{ color: "var(--text-3)" }}>Reward</span> <span className="mono" style={{ color: "var(--up)" }}>+₹{Math.round(reward).toLocaleString('en-IN')}</span></div>
            <div><span style={{ color: "var(--text-3)" }}>R:R</span> <span className="mono" style={{ fontWeight: 600 }}>1 : {rr != null ? rr : '?'}</span></div>
          </div>
        </div>

        <button className="btn btn--accent" disabled={submitting || sl <= 0 || tgt <= 0 || q <= 0} onClick={dryRun}>
          {submitting ? <><I.refresh size={12}/> Submitting…</> : <><I.play size={12}/> Dry-run order</>}
        </button>
        <div style={{ fontSize: 10, color: "var(--text-3)" }}>
          Live placement is intentionally not exposed here — use the Brokers screen with Algo-ID + KILL_SWITCH=false.
        </div>

        {error && (
          <div style={{ padding: 8, background: "var(--bg-soft)", border: "1px solid var(--down)", borderRadius: "var(--r-md)", color: "var(--down)", fontSize: 12 }}>
            {error}
          </div>
        )}
        {result && (
          <div style={{ padding: 10, background: "var(--bg-soft)", border: "1px solid var(--border)", borderRadius: "var(--r-md)", fontFamily: "var(--mono)", fontSize: 11 }}>
            <div className="row between" style={{ marginBottom: 6, fontFamily: "var(--font)" }}>
              <span style={{ fontWeight: 500 }}>{result.ok ? '✓ accepted (dry-run)' : '✗ rejected'}</span>
              <span style={{ color: "var(--text-3)" }}>{result.mode || ''}</span>
            </div>
            {result.clientOrderId && <div>clientOrderId: {result.clientOrderId}</div>}
            {result.reason && <div style={{ color: "var(--down)" }}>reason: {result.reason}</div>}
            {result.note && <div style={{ color: "var(--text-3)", fontFamily: "var(--font)", fontSize: 11 }}>{result.note}</div>}
          </div>
        )}
      </div>
    </Card>
  );
};

const StatPill = ({ label, value, accent }) => (
  <div style={{
    padding: "6px 10px",
    background: "var(--bg-soft)",
    border: "1px solid var(--border)",
    borderRadius: "var(--r-md)",
    minWidth: 80,
  }}>
    <div style={{ fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
    <div className="mono" style={{ fontSize: 13, fontWeight: 500, color: accent === "up" ? "var(--up)" : accent === "down" ? "var(--down)" : undefined }}>
      {value}
    </div>
  </div>
);


/* ============================================================
 * Tier 36 + 40: SpanMarginPanel -- multi-leg F&O margin estimator
 * wired to POST /api/risk/span (Tier 34 backend). Add/remove legs
 * freely; backend detects bull/bear spreads, iron condor, straddles,
 * strangles and applies the standard NSE margin discounts.
 * ============================================================ */
const __spanSampleLeg = () => ({
  symbol: 'NIFTY', type: 'CALL', side: 'BUY',
  strike: 25000, expiry: __spanDefaultExpiry(),
  qty: 1, lotSize: 25, spotPrice: 25000, iv: 0.18,
});
function __spanDefaultExpiry() {
  const d = new Date(); d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10);
}

/* Common spread templates -- mapped to the leg list. Strikes are anchored
 * around spot=25000 so the user can paste them and immediately Estimate. */
const __spanTemplates = {
  'Single CALL (long)': () => [
    { ...__spanSampleLeg(), type: 'CALL', side: 'BUY',  strike: 25000 },
  ],
  'Bull call spread': () => [
    { ...__spanSampleLeg(), type: 'CALL', side: 'BUY',  strike: 25000 },
    { ...__spanSampleLeg(), type: 'CALL', side: 'SELL', strike: 25500 },
  ],
  'Bear put spread': () => [
    { ...__spanSampleLeg(), type: 'PUT',  side: 'BUY',  strike: 25000 },
    { ...__spanSampleLeg(), type: 'PUT',  side: 'SELL', strike: 24500 },
  ],
  'Long straddle': () => [
    { ...__spanSampleLeg(), type: 'CALL', side: 'BUY', strike: 25000 },
    { ...__spanSampleLeg(), type: 'PUT',  side: 'BUY', strike: 25000 },
  ],
  'Short strangle': () => [
    { ...__spanSampleLeg(), type: 'CALL', side: 'SELL', strike: 25500 },
    { ...__spanSampleLeg(), type: 'PUT',  side: 'SELL', strike: 24500 },
  ],
  'Iron condor': () => [
    { ...__spanSampleLeg(), type: 'PUT',  side: 'BUY',  strike: 24500 },
    { ...__spanSampleLeg(), type: 'PUT',  side: 'SELL', strike: 24800 },
    { ...__spanSampleLeg(), type: 'CALL', side: 'SELL', strike: 25200 },
    { ...__spanSampleLeg(), type: 'CALL', side: 'BUY',  strike: 25500 },
  ],
};

const SpanMarginPanel = () => {
  const [legs, setLegs] = React.useState([__spanSampleLeg()]);
  const [running, setRunning] = React.useState(false);
  const [result, setResult]   = React.useState(null);
  const [error, setError]     = React.useState(null);

  const inputStyle = {
    width: "100%", padding: "4px 6px",
    background: "var(--bg-sunk)", border: "1px solid var(--border)",
    borderRadius: "var(--r-md)", fontFamily: "var(--mono)", fontSize: 11,
  };

  const updateLeg = (i, key, value) => {
    setLegs(prev => prev.map((l, idx) => idx === i ? { ...l, [key]: value } : l));
  };
  const addLeg    = () => setLegs(prev => [...prev, __spanSampleLeg()]);
  const removeLeg = (i) => setLegs(prev => prev.filter((_, idx) => idx !== i));
  const applyTemplate = (name) => setLegs(__spanTemplates[name]());

  const run = async () => {
    setRunning(true); setResult(null); setError(null);
    try {
      const cleaned = legs.map(l => {
        const out = {
          symbol: String(l.symbol).toUpperCase().trim(),
          type:   l.type,
          side:   l.side,
          qty: Number(l.qty), lotSize: Number(l.lotSize),
          spotPrice: Number(l.spotPrice), iv: Number(l.iv),
          expiry: l.expiry,
        };
        if (l.type !== 'FUT') out.strike = Number(l.strike);
        return out;
      });
      const r = await window.fetchApi('/api/risk/span', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ legs: cleaned }),
      });
      setResult(r);
    } catch (e) {
      setError((window.formatErr && window.formatErr(e)) || String(e.message || e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card title="F&O margin estimator (multi-leg)" sub="SPAN + exposure with NSE spread discounts · POST /api/risk/span" style={{ marginTop: 16 }}>
      <div className="col" style={{ gap: 10 }}>
        {/* Templates */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>Templates:</span>
          {Object.keys(__spanTemplates).map(name => (
            <button key={name} onClick={() => applyTemplate(name)}
                    style={{ fontSize: 10, padding: "3px 8px", cursor: "pointer" }}>{name}</button>
          ))}
        </div>

        {/* Legs */}
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ width: "100%", fontSize: 11, minWidth: 720 }}>
            <thead>
              <tr>
                <th style={{ width: 24 }}>#</th>
                <th>Symbol</th><th>Type</th><th>Side</th><th>Strike</th>
                <th>Expiry</th><th>Lots</th><th>Lot sz</th><th>Spot ₹</th><th>IV</th>
                <th style={{ width: 24 }}></th>
              </tr>
            </thead>
            <tbody>
              {legs.map((l, i) => (
                <tr key={i}>
                  <td style={{ color: "var(--text-3)" }}>{i + 1}</td>
                  <td><input style={inputStyle} value={l.symbol} onChange={ev => updateLeg(i, 'symbol', ev.target.value.toUpperCase())}/></td>
                  <td>
                    <select style={inputStyle} value={l.type} onChange={ev => updateLeg(i, 'type', ev.target.value)}>
                      <option value="CALL">CALL</option><option value="PUT">PUT</option><option value="FUT">FUT</option>
                    </select>
                  </td>
                  <td>
                    <select style={inputStyle} value={l.side} onChange={ev => updateLeg(i, 'side', ev.target.value)}>
                      <option value="BUY">BUY</option><option value="SELL">SELL</option>
                    </select>
                  </td>
                  <td>
                    {l.type !== 'FUT' && (
                      <input style={inputStyle} type="number" value={l.strike} onChange={ev => updateLeg(i, 'strike', ev.target.value)}/>
                    )}
                  </td>
                  <td><input style={inputStyle} type="date" value={l.expiry} onChange={ev => updateLeg(i, 'expiry', ev.target.value)}/></td>
                  <td><input style={inputStyle} type="number" min="1" value={l.qty} onChange={ev => updateLeg(i, 'qty', ev.target.value)}/></td>
                  <td><input style={inputStyle} type="number" min="1" value={l.lotSize} onChange={ev => updateLeg(i, 'lotSize', ev.target.value)}/></td>
                  <td><input style={inputStyle} type="number" step="0.05" value={l.spotPrice} onChange={ev => updateLeg(i, 'spotPrice', ev.target.value)}/></td>
                  <td><input style={inputStyle} type="number" step="0.01" min="0" value={l.iv} onChange={ev => updateLeg(i, 'iv', ev.target.value)}/></td>
                  <td>
                    {legs.length > 1 && (
                      <button onClick={() => removeLeg(i)} style={{ fontSize: 10, padding: "2px 6px", cursor: "pointer" }}>×</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="row" style={{ gap: 8 }}>
          <button onClick={addLeg} style={{ fontSize: 11, padding: "4px 10px", cursor: "pointer" }}>+ add leg</button>
          <button className="btn btn--accent" disabled={running} onClick={run} style={{ flex: 1 }}>
            {running ? <><I.refresh size={12}/> Estimating…</> : <><I.play size={12}/> Estimate margin ({legs.length} leg{legs.length === 1 ? '' : 's'})</>}
          </button>
        </div>

        {error && (
          <div style={{ padding: 8, background: "var(--bg-soft)", border: "1px solid var(--down)", borderRadius: "var(--r-md)", color: "var(--down)", fontSize: 12 }}>
            {error}
          </div>
        )}
        {result && result.ok === false && (
          <div style={{ padding: 8, background: "var(--bg-soft)", border: "1px solid var(--down)", borderRadius: "var(--r-md)", color: "var(--down)", fontSize: 12 }}>
            Server: {result.reason}
          </div>
        )}
        {result && result.ok && (
          <div className="col" style={{ gap: 10 }}>
            {/* Headline numbers */}
            <div style={{ padding: 10, background: "var(--bg-soft)", border: "1px solid var(--border)", borderRadius: "var(--r-md)" }}>
              <div className="row" style={{ gap: 14, flexWrap: "wrap", fontSize: 12 }}>
                <div><span style={{ color: "var(--text-3)" }}>Total margin</span> <span className="mono" style={{ fontWeight: 600, fontSize: 14 }}>₹{Math.round(result.totalMargin).toLocaleString('en-IN')}</span></div>
                <div><span style={{ color: "var(--text-3)" }}>SPAN</span> <span className="mono">₹{Math.round(result.spanMargin).toLocaleString('en-IN')}</span></div>
                <div><span style={{ color: "var(--text-3)" }}>Exposure</span> <span className="mono">₹{Math.round(result.exposureMargin).toLocaleString('en-IN')}</span></div>
              </div>
            </div>

            {/* Detected spreads (the value-add over single-leg) */}
            {Array.isArray(result.spreads) && result.spreads.length > 0 && (
              <div style={{ padding: 10, background: "var(--bg-soft)", border: "1px solid var(--border)", borderRadius: "var(--r-md)" }}>
                <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 6 }}>Detected spreads ({result.spreads.length})</div>
                {result.spreads.map((s, i) => (
                  <div key={i} style={{ fontSize: 11, marginBottom: 4 }}>
                    <span style={{ fontWeight: 600 }}>{s.type}</span>
                    <span style={{ color: "var(--text-3)" }}> · legs [{s.legs.map(idx => idx + 1).join(', ')}]</span>
                    <span style={{ color: "var(--up)" }}> · {(s.discount * 100).toFixed(0)}% off</span>
                    {s.notes && <span style={{ color: "var(--text-3)" }}> · {s.notes}</span>}
                  </div>
                ))}
              </div>
            )}

            {/* Per-leg breakdown */}
            <div style={{ overflowX: "auto" }}>
              <table className="tbl" style={{ width: "100%", fontSize: 11, minWidth: 640 }}>
                <thead>
                  <tr>
                    <th>#</th><th>Symbol</th><th>Side</th>
                    <th style={{ textAlign: "right" }}>Notional</th>
                    <th style={{ textAlign: "right" }}>SPAN (raw)</th>
                    <th style={{ textAlign: "right" }}>Discount</th>
                    <th style={{ textAlign: "right" }}>SPAN (net)</th>
                    <th style={{ textAlign: "right" }}>Exposure</th>
                    <th style={{ textAlign: "right" }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {result.perLeg.map((pl, i) => (
                    <tr key={i}>
                      <td style={{ color: "var(--text-3)" }}>{i + 1}</td>
                      <td className="mono">{pl.symbol} {pl.type}{pl.strike ? ' ' + pl.strike : ''}</td>
                      <td>{pl.side}</td>
                      <td className="mono" style={{ textAlign: "right" }}>₹{Math.round(pl.notional).toLocaleString('en-IN')}</td>
                      <td className="mono" style={{ textAlign: "right" }}>₹{Math.round(pl.spanMargin).toLocaleString('en-IN')}</td>
                      <td className="mono" style={{ textAlign: "right", color: pl.spanDiscount > 0 ? 'var(--up)' : 'var(--text-3)' }}>
                        {pl.spanDiscount > 0 ? '-' + (pl.spanDiscount * 100).toFixed(0) + '%' : '—'}
                      </td>
                      <td className="mono" style={{ textAlign: "right" }}>₹{Math.round(pl.spanMarginAfterDiscount != null ? pl.spanMarginAfterDiscount : pl.spanMargin).toLocaleString('en-IN')}</td>
                      <td className="mono" style={{ textAlign: "right" }}>₹{Math.round(pl.exposureMargin).toLocaleString('en-IN')}</td>
                      <td className="mono" style={{ textAlign: "right", fontWeight: 600 }}>₹{Math.round(pl.totalAfterDiscount != null ? pl.totalAfterDiscount : pl.total).toLocaleString('en-IN')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {Array.isArray(result.notes) && result.notes.length > 0 && (
              <div style={{ fontSize: 10, color: "var(--text-3)" }}>
                {result.notes.map((n, i) => <div key={i}>· {n}</div>)}
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
};

const PaperScreen = () => {
  const [demo] = (window.useDemoMode ? window.useDemoMode() : [false]);
  // T-535: initialize as null so we don't flash the default tier before the
  // persisted tier arrives. The selector renders a tiny placeholder while loading.
  // setAccount wraps both the local state and the PUT /api/me/paper/capital call.
  const [account, setAccountRaw] = useState(null);
  const [accountSaving, setAccountSaving] = useState(false);
  const [accountError, setAccountError] = useState(null);
  const [, bump] = useState(0);
  React.useEffect(() => {
    const h = () => bump(n => n + 1);
    window.addEventListener("modes-changed", h);
    return () => window.removeEventListener("modes-changed", h);
  }, []);
  // T-530: setAccount wrapper — persists the tier change to backend and
  // optimistically updates local state.
  const persistAccountTier = React.useCallback(async (tierId) => {
    const sizes = { "50K": 50000, "1L": 100000, "5L": 500000, "10L": 1000000, "25L": 2500000, "50L": 5000000 };
    const cap = sizes[tierId];
    if (!cap) { console.warn("[T-530] unknown tier:", tierId); return; }
    setAccountSaving(true);
    setAccountError(null);
    try {
      const csrfResp = await window.fetchApi("/api/csrf-token");
      const csrf = csrfResp && (csrfResp.csrfToken || csrfResp.token);
      const res = await window.fetchApi("/api/me/paper/capital", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ initialCapital: cap, tier: tierId, reset: false }),
      });
      if (!res || res.ok === false) {
        setAccountError((res && (res.reason || res.detail)) || "save failed");
      }
    } catch (e) {
      setAccountError(e.message || "network error");
    } finally {
      setAccountSaving(false);
    }
  }, []);
  const setAccount = React.useCallback((tierId) => {
    setAccountRaw(tierId);
    persistAccountTier(tierId);
  }, [persistAccountTier]);
  // T-530: on mount, load the persisted tier from backend.
  React.useEffect(() => {
    if (window.MockData && window.MockData.isDemoOn && window.MockData.isDemoOn()) return;
    (async () => {
      try {
        const res = await window.fetchApi("/api/me/paper");
        if (res && res.ok && res.state) {
          const cap = Number(res.state.initial_capital || res.state.cash || 0);
          const tier = String(res.state.tier || "").trim();
          const sizes = { "50K": 50000, "1L": 100000, "5L": 500000, "10L": 1000000, "25L": 2500000, "50L": 5000000 };
          // Prefer the explicit tier label if it matches; else infer from capital.
          if (sizes[tier]) {
            setAccountRaw(tier);
          } else {
            const match = Object.entries(sizes).find(([_id, v]) => v === cap);
            if (match) setAccountRaw(match[0]);
          }
        }
      } catch (e) { /* keep default */ }
    })();
  }, []);
  // ---- T-536: SINGLE source of truth — /api/me/paper returns state + orders
  // + positions + trades + stats for the authenticated user. Previously this
  // screen made 3 calls (/api/paper, /api/paper/positions, /api/paper/orders)
  // that hit the legacy global singleton — which held DIFFERENT data than the
  // per-user db.paper that the virtual-account selector reads from. That
  // disagreement caused the user-reported flash (₹50K → ₹10L) and made the
  // "LIVE PAPER ACCOUNT" bar disagree with the selector.
  const [livePaper, setLivePaper] = React.useState(null);
  const [livePositions, setLivePositions] = React.useState(null);
  const [liveOrders, setLiveOrders] = React.useState(null);
  const [paperLoading, setPaperLoading] = React.useState(true);
  // T-525: real paper equity curve (initial capital + cumulative realized P&L
  // from closed trades). Replaces the seriesRandom() demo series. Window-aware.
  const [equityCurve, setEquityCurve] = React.useState(null);
  const [equityWindow, setEquityWindow] = React.useState('30d');
  React.useEffect(() => {
    if (window.MockData && window.MockData.isDemoOn && window.MockData.isDemoOn()) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await window.fetchApi('/api/me/paper/equity-curve?window=' + encodeURIComponent(String(equityWindow).toLowerCase()));
        if (!cancelled && r && r.ok) setEquityCurve(r);
      } catch (e) { /* keep prior series */ }
    })();
    return () => { cancelled = true; };
  }, [equityWindow]);
  React.useEffect(() => {
    if (window.MockData && window.MockData.isDemoOn && window.MockData.isDemoOn()) {
      setPaperLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await window.fetchApi('/api/me/paper');
        if (cancelled) return;
        if (r && r.ok) {
          // r.stats has the shape the UI expects: cash, totalEquity, realizedPnl, etc.
          setLivePaper(r.stats || null);
          setLivePositions(Array.isArray(r.positions) ? r.positions : []);
          setLiveOrders(Array.isArray(r.orders) ? r.orders : []);
        }
      } catch (e) { /* fall back to mock */ }
      finally { if (!cancelled) setPaperLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);
  // T-429 (audit-2026-05-26 frontend H1): gate the hardcoded virtual-account
  // KPI fixture behind demo. Live mode renders the same shape but pulls cap
  // from the account-id label (₹10L / ₹25L / ₹50L) and shows zeros for
  // P&L/trades/winR until /api/paper data fills in. The Live-paper-account
  // strip above already shows the real cash/equity/pnl from /api/paper.
  // T-529: extended virtual-capital tiers to start from INR 50K.
  // Lower tiers are useful for beginners doing small-account paper trading
  // (~1 NIFTY lot fits in INR 50K margin). Highest tier preserved for HNI testing.
  const __accountSizes = { "50K": 50000, "1L": 100000, "5L": 500000, "10L": 1000000, "25L": 2500000, "50L": 5000000 };
  const accounts = demo
    ? [
        { id: "50K", cap: 50000,   used: 18400,   pnl: 1240,   trades: 6,   winR: 50 },
        { id: "1L",  cap: 100000,  used: 42000,   pnl: 3120,   trades: 11,  winR: 55 },
        { id: "5L",  cap: 500000,  used: 188000,  pnl: 9420,   trades: 22,  winR: 59 },
        { id: "10L", cap: 1000000, used: 412000,  pnl: 18420,  trades: 34,  winR: 62 },
        { id: "25L", cap: 2500000, used: 1180000, pnl: 52840,  trades: 67,  winR: 66 },
        { id: "50L", cap: 5000000, used: 2140000, pnl: 148320, trades: 142, winR: 71 },
      ]
    : Object.keys(__accountSizes).map(id => ({ id, cap: __accountSizes[id], used: 0, pnl: 0, trades: 0, winR: 0 }));
  // T-535: when account hasn't loaded yet, fall back to the default tier shape
  const acc = accounts.find(a => a.id === account) || accounts.find(a => a.id === '10L') || accounts[0];

  // T-346: gate the 6 hardcoded paper-order fixtures behind demo so live
  // mode shows no fake history. Real fills come from /api/paper/orders
  // (already used elsewhere in this screen).
  // T-524: when live, normalize liveOrders (from /api/paper/orders) into
  // the same shape the order-book table expects.
  const paperOrders = demo ? [
    { t: "14:41:08", s: "RELIANCE",   side: "BUY",  qty: 80,  req: 2948.50, fill: 2948.85, slip: 0.35, strat: "Momentum AI",   st: "filled" },
    { t: "14:32:19", s: "HDFCBANK",   side: "BUY",  qty: 50,  req: 1582.00, fill: 1582.15, slip: 0.15, strat: "Mean Rev. v2",  st: "filled" },
    { t: "14:18:44", s: "NIFTY 22500 CE", side: "BUY",  qty: 75,  req: 142.20, fill: 143.05, slip: 0.85, strat: "Iron Condor",  st: "filled" },
    { t: "13:58:02", s: "TATASTEEL", side: "SELL", qty: 200, req: 148.40, fill: 148.28, slip: 0.12, strat: "Breakout",      st: "filled" },
    { t: "13:44:30", s: "INFY",      side: "BUY",  qty: 40,  req: 1472.00, fill: 1472.00, slip: 0.00, strat: "Momentum AI",   st: "pending" },
    { t: "13:22:15", s: "SBIN",      side: "SELL", qty: 150, req: 782.50,  fill: 782.32,  slip: 0.18, strat: "Grid Trader",   st: "filled" },
  ] : (Array.isArray(liveOrders) ? liveOrders.slice(-50).reverse().map(o => {
    // T-536: db.paper returns snake_case columns (fill_price, req_price, filled_at, created_at).
    // The old paper.js singleton returned camelCase. Support both so the
    // table renders correctly regardless of which engine produced the row.
    const filledPrice = Number(o.fill_price || o.filledPrice || o.fill || o.price || 0);
    const reqPrice    = Number(o.req_price || o.price || o.filledPrice || o.fill_price || 0);
    const slip        = reqPrice && filledPrice ? Math.abs(filledPrice - reqPrice) : Number(o.slippage || 0);
    const time        = o.filled_at || o.created_at || o.filledAt || o.createdAt || "";
    return {
      t: time ? new Date(time).toLocaleTimeString("en-IN", { hour12: false }) : "—",
      s: o.symbol || "—",
      side: o.side || "",
      qty: o.qty || 0,
      req: reqPrice || filledPrice || 0,
      fill: filledPrice || 0,
      slip: slip,
      strat: o.strategy_tag || o.strategy || "manual",
      st: (o.status || "").toLowerCase(),
      _id: o.id,
    };
  }) : []);

  // T-346: synthetic PnL series only in demo mode.
  const pnlSeries = demo ? seriesRandom(9, 40, -8000, 160000, 3500) : ((equityCurve && Array.isArray(equityCurve.series)) ? equityCurve.series : []);
  // T-525: labels come from the equity-curve endpoint in live mode.
  const pnlLabels = demo ? [window.daysAgo(55), window.daysAgo(40), window.daysAgo(24), window.daysAgo(9), window.TODAY_SHORT] : ((equityCurve && Array.isArray(equityCurve.labels)) ? equityCurve.labels : []);

  // Paper vs live calibration
  // T-346: paper-vs-live calibration is fixture data; gate behind demo.
  const paperVsLive = demo ? [
    { k: "Avg slippage",  paper: "0.08%", live: "0.14%", delta: "+0.06%", note: "Live has 1.75× more slippage" },
    { k: "Avg fill time", paper: "12ms",  live: "284ms", delta: "+272ms", note: "Broker RTT + exchange queue" },
    { k: "Rejection rate",paper: "0.2%",  live: "1.8%",  delta: "+1.6%",  note: "Margin / circuit / illiquid" },
    { k: "Partial fills",  paper: "0%",    live: "6.4%",  delta: "+6.4%",  note: "Modeled Q2 2026" },
  ] : [];

  const Wrap = window.PaperChrome || React.Fragment;
  return (
    <>
      <Wrap>
      {livePaper && (
        <div className="card" style={{ marginBottom: 16, background: "var(--info-soft, #eff6ff)", padding: 14, borderRadius: 12 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700 }}>Live paper account</div>
              {/* T-532: explicit badge so users know this row is REAL DB-backed data, not demo */}
              <span title="Real per-user state from /api/me/paper backed by SQLite paper_singleton_state" style={{ fontSize: 9, padding: "2px 5px", borderRadius: 3, background: "var(--up, #16a34a)", color: "white", fontWeight: 700, letterSpacing: 0.5 }}>REAL</span>
            </div>
            <div className="mono" style={{ fontSize: 15, fontWeight: 700 }}>cash INR {Number(livePaper.cash).toLocaleString("en-IN")}</div>
            <div className="mono" style={{ fontSize: 13 }}>equity INR {Number(livePaper.totalEquity).toLocaleString("en-IN")}</div>
            <div className="mono" style={{ fontSize: 13, color: livePaper.realizedPnl >= 0 ? "var(--up)" : "var(--down)" }}>realized INR {livePaper.realizedPnl}</div>
            <div className="mono" style={{ fontSize: 13, color: livePaper.unrealizedPnl >= 0 ? "var(--up)" : "var(--down)" }}>unrealized INR {livePaper.unrealizedPnl}</div>
            <div className="mono" style={{ fontSize: 13 }}>positions {livePaper.openPositions}</div>
            <div className="mono" style={{ fontSize: 13 }}>orders {livePaper.filledOrders}/{livePaper.totalOrders}</div>
            <div className="mono" style={{ fontSize: 13 }}>winRate {livePaper.winRate}%</div>
          </div>
          {Array.isArray(livePositions) && livePositions.length > 0 && (
            <div style={{ marginTop: 12, fontSize: 12 }}>
              {livePositions.map(p => (
                <div key={p.symbol} style={{ display: "flex", gap: 16, padding: "4px 0" }}>
                  <span className="mono" style={{ minWidth: 100, fontWeight: 600 }}>{p.symbol}</span>
                  <span className="mono">qty={p.qty}</span>
                  <span className="mono">avg=INR {p.avgPrice}</span>
                  <span className="mono">ltp=INR {p.ltp != null ? p.ltp : "-"}</span>
                  <span className="mono" style={{ color: p.unrealizedPnl >= 0 ? "var(--up)" : "var(--down)" }}>unrealized=INR {p.unrealizedPnl}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="page-header">
        <div>
          <h1 className="page-header__title">Paper trading</h1>
          <div className="page-header__sub">Virtual capital, real market fills. Stage 2 of the pipeline — build confidence before live.</div>
        </div>
        <div className="page-header__right">
          <button className="btn" onClick={async () => {
            // T-538: use styled ConfirmModal (window.confirmAsync) instead of
            // native window.confirm — matches the rest of the app's UX.
            // T-539: include CSRF token in PUT (was missing -> backend rejected
            // with 403, then the setTimeout(reload) hard-refreshed and the
            // user saw a white page while the SPA re-bootstrapped).
            // Also: no more window.location.reload — re-fetch /api/me/paper in
            // place and update React state.
            const confirmed = window.confirmAsync
              ? await window.confirmAsync({
                  title: 'Reset paper account?',
                  sub: 'This action is destructive.',
                  detail: 'This CLEARS all paper positions, all closed paper trades, and resets realized P&L to ₹0. Your selected virtual capital tier is preserved. This cannot be undone.',
                  confirmLabel: 'Reset account',
                  cancelLabel: 'Cancel',
                  tone: 'danger',
                  typeToConfirm: 'RESET',
                })
              : window.confirm('Reset paper account? This CLEARS all positions, trades, and realized P&L.');
            if (!confirmed) return;
            try {
              // Get current capital + tier (preserve them through the reset).
              const cur = await window.fetchApi('/api/me/paper/capital');
              const initialCapital = Number(
                (cur && cur.initialCapital) ||
                (cur && cur.state && cur.state.initial_capital) ||
                50000
              );
              const tier = String(
                (cur && cur.tier) ||
                (cur && cur.state && cur.state.tier) ||
                '50K'
              );
              // CSRF (PUT writes require it).
              const csrfResp = await window.fetchApi('/api/csrf-token');
              const csrf = (csrfResp && (csrfResp.csrfToken || csrfResp.token)) || '';
              const r = await window.fetchApi('/api/me/paper/capital', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
                body: JSON.stringify({ initialCapital, tier, reset: true }),
              });
              if (r && r.ok) {
                // Re-fetch the live paper snapshot so KPIs/orders/positions
                // re-render in-place. No reload, no white flash.
                try {
                  const p = await window.fetchApi('/api/me/paper');
                  if (p && p.ok) {
                    setLivePaper(p.stats || null);
                    setLivePositions(Array.isArray(p.positions) ? p.positions : []);
                    setLiveOrders(Array.isArray(p.orders) ? p.orders : []);
                  }
                } catch (_) { /* ignore — toast below still confirms success */ }
                window.toast && window.toast({
                  kind: 'up',
                  title: `Paper account reset to ₹${initialCapital.toLocaleString('en-IN')}`,
                  sub: 'Positions, closed trades, and realized P&L cleared.',
                });
              } else {
                window.toast && window.toast({
                  kind: 'down',
                  title: 'Reset failed',
                  sub: (r && (r.detail || r.reason)) || 'Backend did not confirm reset.',
                });
              }
            } catch (e) {
              // fetchApi throws on non-2xx. Show the request id when available
              // so support can grep for it.
              if (window.toastError) window.toastError('Reset failed', e);
              else window.toast && window.toast({ kind: 'down', title: 'Reset failed', sub: (e && (e.detail || e.reason || e.message)) || 'Unknown error' });
            }
          }}>
            <I.refresh size={14}/> Reset account
          </button>
          <button className="btn btn--accent" onClick={() => {
            // T-521: scroll to the existing ReplayPanel (mounted further down the page).
            const heading = Array.from(document.querySelectorAll('*')).find(el => el.textContent && el.textContent.trim().startsWith('Replay mode'));
            if (heading) { heading.scrollIntoView({ behavior: 'smooth', block: 'start' }); window.toast && window.toast({ kind: 'info', title: 'Scrolled to Replay panel', sub: 'Configure strategy + date range below to replay a historical day.' }); }
            else { window.toast && window.toast({ kind: 'warn', title: 'Replay panel not found on this view' }); }
          }}>
            <I.play size={14}/> Replay historical day
          </button>
        </div>
      </div>

      {/* Account selector + KPIs */}
      <Card style={{ marginBottom: 16 }}>
        <div className="between" style={{ marginBottom: 18 }}>
          <div className="row" style={{ gap: 12 }}>
            <div className="muted" style={{ fontSize: 12 }}>Virtual account</div>
            {account === null ? (
              <span className="muted" style={{ fontSize: 12 }}>loading…</span>
            ) : (
              <Segmented value={account} onChange={setAccount}
                options={accounts.map(a => ({ value: a.id, label: "₹" + a.id }))}/>
            )}
            <Pill kind="acc" dot>Paper · identical to live layout</Pill>
            {/* T-530: surface save status */}
            {accountSaving && <span className="muted" style={{ fontSize: 11 }}>saving…</span>}
            {accountError && <span style={{ fontSize: 11, color: "var(--down)" }}>save failed: {accountError}</span>}
          </div>
          <div className="row" style={{ gap: 8 }}>
            {/* T-429 (audit-2026-05-26 frontend H1): the "48 trading days"
                string is hardcoded; only show it in demo. */}
            {demo && (
              <span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>Since inception · 48 trading days</span>
            )}
          </div>
        </div>
        <div className="grid grid-4">
          {/* T-536: KPI cards now read from /api/me/paper (Engine B, per-user).
              T-535 flash-fix: while loading, render '…' placeholders so the
              tile doesn't show the default-tier value and then flash to the
              real one. Once loaded, EVERY number reflects the same source as
              the virtual-account selector — no more inconsistency. */}
          {(() => {
            if (paperLoading && !demo) {
              return (
                <>
                  <Stat label="Virtual capital" value="…" delta="loading" deltaKind="muted"/>
                  <Stat label="Paper P&L"       value="…" delta="loading" deltaKind="muted"/>
                  <Stat label="Trades"          value="…" delta="loading" deltaKind="muted"/>
                  <Stat label="Sharpe (ann.)"   value="—" sub="needs daily equity series"/>
                </>
              );
            }
            const lp = livePaper && !demo;
            const cap = lp ? Number(livePaper.totalEquity) : acc.cap;
            const cash = lp ? Number(livePaper.cash) : acc.cap;
            const realized = lp ? Number(livePaper.realizedPnl) : acc.pnl;
            const unrealized = lp ? Number(livePaper.unrealizedPnl) : 0;
            const pnl = realized + unrealized;
            const trades = lp ? Number(livePaper.closedTrades || 0) : acc.trades;
            const winR = lp ? Number(livePaper.winRate || 0) : acc.winR;
            const deployedPct = lp && cap ? Math.max(0, Math.min(100, ((cap - cash) / cap) * 100)) : ((acc.used/acc.cap)*100);
            return (
              <>
                <Stat label="Virtual capital" value={inrCompact(cap)} delta={`${deployedPct.toFixed(0)}% deployed`} deltaKind="muted"/>
                <Stat label="Paper P&L" value={inr(pnl)} delta={cap ? pct((pnl/cap)*100) : "—"} deltaKind={pnl > 0 ? "up" : pnl < 0 ? "down" : "muted"}/>
                <Stat label="Trades" value={trades} delta={`${winR}% win rate`} deltaKind="muted"/>
                <Stat label="Sharpe (ann.)" value="—" sub="needs daily equity series"/>
              </>
            );
          })()}
        </div>
      </Card>

      {/* Per-mode paper activity — hierarchy roll-up */}
      <Card style={{ marginBottom: 16 }} title="Paper by mode" sub="How each mode is performing in simulation — promotion gates tracked per-mode">
        <div className="grid grid-4" style={{ gap: 10 }}>
          {window.MODE_IDS.map(id => {
            const meta = window.MODE_META[id];
            // T99-T90: per-mode paper stats were hardcoded (intraday 86 trades
            // / 64% win / ₹82,340; swing 22/68%/₹34,120; options 18/72%/₹24,820).
            // Same root cause as T-82 — per-mode aggregation backend not wired.
            // Show empty values; when /api/me/paper-by-mode lands, derive here.
            const stats = { trades: 0, winR: 0, pnl: 0, ready: 0, testing: 0, nextPromo: null };
            const active = window.isModeActive(id);
            return (
              <div key={id} style={{
                padding: 12, borderRadius: "var(--r-md)",
                borderLeft: `3px solid ${meta.color}`,
                background: meta.colorSoft,
                opacity: active ? 1 : 0.5,
              }}>
                <div className="between" style={{ marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 10, fontFamily: "var(--mono)", color: meta.color, fontWeight: 500, letterSpacing: "0.03em" }}>{meta.shortLabel}</div>
                    <div style={{ fontSize: 14, fontWeight: 500, marginTop: 1 }}>{meta.label}</div>
                  </div>
                  {!active && <Pill kind="warn">OFF</Pill>}
                </div>
                <div className="mono" style={{ fontSize: 18, fontWeight: 600, color: stats.pnl > 0 ? "var(--up)" : stats.pnl < 0 ? "var(--down)" : "var(--text-3)" }}>
                  {stats.pnl > 0 ? "+" : ""}{inr(stats.pnl)}
                </div>
                <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                  {stats.trades} trades · {stats.winR}% win
                </div>
                <div className="divider" style={{ margin: "8px 0" }}/>
                <div className="row" style={{ justifyContent: "space-between", fontSize: 11 }}>
                  <span><span className="mono" style={{ color: "var(--up)" }}>{stats.ready}</span> <span className="muted">ready</span></span>
                  <span><span className="mono" style={{ color: "var(--info)" }}>{stats.testing}</span> <span className="muted">testing</span></span>
                </div>
                <div className="muted" style={{ fontSize: 10, marginTop: 6, fontStyle: "italic" }}>{stats.nextPromo}</div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* T99-T96: honest banner — the 'Paper equity curve' AreaChart below
          uses seriesRandom() (fake), the 'Fill quality' card uses a 4-row
          hardcoded paperVsLive array (slippage / fill time / rejection
          rate / partial fills), and the 'Paper order book' table reads
          paperOrders (also hardcoded). The 'Live paper account' strip at
          the top IS real (from /api/me/paper). Same pattern as T-91. */}
      <div role="note" style={{
        padding: '8px 12px', marginBottom: 12, borderRadius: 6,
        border: '1px solid color-mix(in oklab, var(--warn, #d97706) 35%, var(--border))',
        background: 'color-mix(in oklab, var(--warn, #d97706) 8%, transparent)',
        fontSize: 12, color: 'var(--text-2)',
      }}>
        {demo ? (
          <><strong>Demo mode — paper panels show illustrative sample data.</strong>{' '}
          Turn off demo mode to see your real per-user paper account.</>
        ) : (
          <><strong>Fill quality and the Promotion-to-live table are not yet wired to live data.</strong>{' '}
          The Paper equity curve, Live paper account, and Paper order book are
          real (per-user data from /api/me/paper). The remaining sample panels
          switch to live data once their endpoints land.</>
        )}
      </div>

      {/* P&L chart */}
      <div className="grid grid-2-1" style={{ marginBottom: 16 }}>
        <Card title="Paper equity curve" sub="₹ vs virtual capital baseline" right={<Segmented value={demo ? '30d' : equityWindow} onChange={demo ? (()=>{}) : ((v)=>setEquityWindow(v))} options={["7d","30d","All"]}/>}>
          <AreaChart data={pnlSeries} height={220} color="var(--accent)" formatter={v => inrCompact(v)}
            labels={pnlLabels}/>
        </Card>
        <Card title="Fill quality" sub="Paper fills are calibrated to live">
          {/* T-184 (F-3): gate the 4-row paperVsLive hardcoded table behind
              isDemoOn(). Live mode shows an empty state until /api/paper/
              fill-quality is implemented. Previously this misled users into
              reading the demo slippage / fill-time / rejection-rate numbers
              as their OWN paper-fill metrics. */}
          {(() => {
            const _isDemoFQ = !!(window.MockData && window.MockData.isDemoOn && window.MockData.isDemoOn());
            if (!_isDemoFQ) {
              return (
                <div className="muted" style={{ padding: 12, fontSize: 12, lineHeight: 1.5 }}>
                  Fill-quality metrics are not yet wired.<br/>
                  Pending a <code>/api/paper/fill-quality</code> endpoint that returns
                  per-strategy slippage, fill time, rejection rate, and partial fills
                  computed from this user's paper order log.
                </div>
              );
            }
            return (
              <div className="col" style={{ gap: 14 }}>
                {paperVsLive.map((r,i) => (
                  <div key={i}>
                    <div className="between" style={{ marginBottom: 2 }}>
                      <div style={{ fontSize: 12, fontWeight: 500 }}>{r.k}</div>
                      <span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{r.delta}</span>
                    </div>
                    <div className="row" style={{ gap: 10 }}>
                      <span className="mono" style={{ fontSize: 11 }}><span style={{ color: "var(--text-3)" }}>paper </span>{r.paper}</span>
                      <span style={{ color: "var(--border-strong)" }}>·</span>
                      <span className="mono" style={{ fontSize: 11 }}><span style={{ color: "var(--text-3)" }}>live </span>{r.live}</span>
                    </div>
                    <div className="muted" style={{ fontSize: 10, marginTop: 2 }}>{r.note}</div>
                  </div>
                ))}
              </div>
            );
          })()}
        </Card>
      </div>

      {/* Paper order book + replay mode */}
      <div className="grid grid-2-1" style={{ marginBottom: 16 }}>
        <Card title="Paper order book" sub="Real bid/ask fills · Gaussian slippage model" flush>
          <table className="table">
            <thead><tr><th>Time</th><th>Symbol</th><th>Side</th><th className="num-l">Qty</th><th className="num-l">Req</th><th className="num-l">Fill</th><th className="num-l">Slip</th><th>Strategy</th><th>Status</th></tr></thead>
            <tbody>
              {paperOrders.map((o,i) => (
                <tr key={i}>
                  <td className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{o.t}</td>
                  <td style={{ fontWeight: 500 }}>{o.s}</td>
                  <td><Pill kind={o.side === "BUY" ? "up" : "down"}>{o.side}</Pill></td>
                  <td className="num">{o.qty}</td>
                  <td className="num">{o.req.toFixed(2)}</td>
                  <td className="num">{o.fill.toFixed(2)}</td>
                  <td className="num" style={{ color: o.slip > 0.3 ? "var(--warn)" : "var(--text-3)" }}>{o.slip.toFixed(2)}</td>
                  <td><span className="muted" style={{ fontSize: 12 }}>{o.strat}</span></td>
                  <td>{o.st === "filled" ? <Pill kind="up" dot>filled</Pill> : <Pill kind="info" dot>pending</Pill>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        {/* Tier 33: Replay mode wired to /api/paper/replay (Tier 27 backend) */}
        <ReplayPanel />
      </div>

      {/* Tier 33: Bracket order builder wired to /api/orders/dry-run (Tier 26 backend) */}
      <BracketOrderPanel />
      <SpanMarginPanel />

      {/* Promotion readiness — explicit 4-gate criteria */}
      <Card
        title="Promotion to live"
        sub="A strategy auto-promotes only when ALL 4 gates pass. Any failing gate blocks promotion."
        right={
          <div className="row" style={{ gap: 10, fontSize: 11, color: "var(--text-3)" }}>
            <span>Gates:</span>
            <span className="mono">≥14 days</span>
            <span>·</span>
            <span className="mono">≥30 trades</span>
            <span>·</span>
            <span className="mono">≥60% win</span>
            <span>·</span>
            <span className="mono">≥1.2 Sharpe</span>
          </div>
        }
        flush
      >
        <table className="table">
          <thead>
            <tr>
              <th>Strategy</th>
              <th>Mode</th>
              <th className="num-l">Days</th>
              <th className="num-l">Trades</th>
              <th className="num-l">Win %</th>
              <th className="num-l">Sharpe</th>
              <th className="num-l">Max DD</th>
              <th style={{ textAlign: "center" }}>Gates (days / trades / win / sharpe)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {/* T-346: 7 hardcoded fake strategies in the promotion-gates table.
                Gated behind demo. */}
            {(demo ? [
              { n: "Momentum AI",        d: 48, t: 142, w: 71, sh: 1.84, dd: "-3.2%" },
              { n: "Mean Reversion v2",  d: 42, t:  89, w: 66, sh: 1.42, dd: "-4.8%" },
              { n: "Iron Condor Weekly", d: 45, t:  34, w: 82, sh: 2.14, dd: "-1.8%" },
              { n: "Breakout Scalper",   d: 22, t:  62, w: 58, sh: 1.10, dd: "-2.6%" },
              { n: "Covered Call",       d: 28, t:  12, w: 66, sh: 1.40, dd: "-1.2%" },
              { n: "Grid Trader",        d: 80, t: 310, w: 52, sh: 0.72, dd: "-7.2%" },
              { n: "Stock Futures Momentum", d: 22, t: 6, w: 58, sh: 1.20, dd: "-2.4%" },
            ] : []).map((s, i) => {
              const stratMeta = window.getStrategy(s.n);
              const mode = stratMeta?.mode || "intraday";
              const modeMeta = window.MODE_META[mode];
              // 4 independent gates
              const gates = [
                { id: "days",   ok: s.d >= 14,  label: `${s.d}d`,        tip: "Min 14 paper days" },
                { id: "trades", ok: s.t >= 30,  label: `${s.t}`,         tip: "Min 30 paper trades" },
                { id: "win",    ok: s.w >= 60,  label: `${s.w}%`,        tip: "Min 60% win rate" },
                { id: "sharpe", ok: s.sh >= 1.2,label: s.sh.toFixed(2),  tip: "Min 1.2 Sharpe" },
              ];
              const allPass = gates.every(g => g.ok);
              const failingGate = gates.find(g => !g.ok);
              return (
                <tr key={i}>
                  <td style={{ fontWeight: 500 }}>{s.n}</td>
                  <td>
                    <span className="row" style={{ gap: 6 }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: modeMeta.color }}/>
                      <span className="mono" style={{ fontSize: 11, color: modeMeta.color }}>{modeMeta.shortLabel}</span>
                    </span>
                  </td>
                  <td className="num">{s.d}</td>
                  <td className="num">{s.t}</td>
                  <td className="num">{s.w}%</td>
                  <td className="num" style={{ color: s.sh >= 1.2 ? "var(--up)" : "var(--warn)" }}>{s.sh.toFixed(2)}</td>
                  <td className="num">{s.dd}</td>
                  <td>
                    <div className="row" style={{ gap: 3, justifyContent: "center" }}>
                      {gates.map(g => (
                        <span key={g.id} title={g.tip + " — " + g.label}
                          style={{
                            width: 20, height: 20, borderRadius: 4,
                            display: "grid", placeItems: "center",
                            background: g.ok ? "var(--up-soft)" : "var(--down-soft)",
                            color: g.ok ? "var(--up)" : "var(--down)",
                            fontSize: 11, fontWeight: 600,
                          }}>
                          {g.ok ? "✓" : "✕"}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>
                    {allPass ? (
                      <button className="btn btn--sm btn--primary" style={{ whiteSpace: "nowrap" }} onClick={() => {
                          window.toast && window.toast({
                            kind: 'info',
                            title: 'Promote to live trading from the Strategies page',
                            sub: 'Use ⚡ Auto-runner on the strategy card (gated by per-strategy budget cap, T-509 2FA policy, T-499 promotion criteria). This Promote button intentionally does NOT fire orders directly.',
                          });
                          // T-521: deliberately no fetch here -- live order placement
                          // must go through the proper /api/orders/place pipeline
                          // with explicit 2FA + budget cap + audit. Routing the
                          // operator to the correct gated workflow.
                        }}>→ Promote to live</button>
                    ) : (
                      <button className="btn btn--sm" disabled style={{ opacity: 0.5, whiteSpace: "nowrap" }}>
                        Blocked: {failingGate.id}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ padding: "10px 16px", borderTop: "1px solid var(--border)", background: "var(--bg-soft)", fontSize: 11, color: "var(--text-3)" }}>
          <I.info size={12} style={{ verticalAlign: -1, marginRight: 6 }}/>
          Gates are enforced by <code>ai-router</code> before every <code>paper.promote_to_live()</code> call. Override requires manual confirmation + audit log entry.
        </div>
      </Card>
      </Wrap>
    </>
  );
};

Object.assign(window, { PaperScreen });
