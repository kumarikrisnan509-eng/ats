/* eslint-disable */
/* Paper Trading screen — Stage 2 of the pipeline */

/* ============================================================
 * Tier 33: ReplayPanel — wires the existing /api/paper/replay
 * (Tier 27 backend) into the React UI. Replaces the mock card
 * that was here before.
 *
 * Inputs:
 *   - symbol      (text, default RELIANCE)
 *   - from / to   (YYYY-MM-DD, default last 60d -> yesterday)
 *   - strategy    (dropdown, loaded from /api/strategies)
 *   - qty         (number, default 1)
 *   - interval    (day | 60minute | 15minute | 5minute)
 * Behaviour:
 *   POST { symbol, from, to, strategy, qty, interval } to
 *   /api/paper/replay. Render result.stats and result.trades.
 * Failure modes handled:
 *   - 400 (broker offline, no candles): user can paste candles JSON manually
 *   - strategies load fail: dropdown shows '(could not load strategies)'
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
        // Backend returns either an array of {id,name} or {strategies:[...]}.
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
  }, []); // eslint-disable-line

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
      setError(String(e.message || e));
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
              <Pill label="Trades"     value={stats.trades}/>
              <Pill label="Win rate"   value={(stats.winRate != null ? stats.winRate + "%" : "—")}/>
              <Pill label="Total P&L"  value={"₹" + (stats.totalPnl != null ? Math.round(stats.totalPnl).toLocaleString('en-IN') : "—")}
                    accent={stats.totalPnl >= 0 ? "up" : "down"}/>
              {stats.wins != null  && <Pill label="Wins"   value={stats.wins}/>}
              {stats.losses != null && <Pill label="Losses" value={stats.losses}/>}
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

/* ============================================================
 * Tier 33: BracketOrderPanel — wires /api/orders/dry-run with
 * Zerodha BRACKET (BO) product (Tier 26). Computes risk:reward,
 * does a dry-run by default (KILL_SWITCH-aware), and shows the
 * server's normalized payload + clientOrderId.
 *
 * The "Place real order" button is intentionally NOT exposed in
 * this panel -- live trading requires KILL_SWITCH=false AND
 * LIVE_TRADING=true (Tier 11), and the canonical place flow lives
 * on the Brokers screen with the algo-id + strategy-tag gate.
 * ============================================================ */
const BracketOrderPanel = () => {
  const [symbol, setSymbol]   = React.useState("RELIANCE");
  const [side, setSide]       = React.useState("BUY");
  const [qty, setQty]         = React.useState(50);
  const [entry, setEntry]     = React.useState(2950);
  const [slOffset, setSlOff]  = React.useState(15);   // points away from entry
  const [tgtOffset, setTgtOff]= React.useState(30);

  const [submitting, setSubmitting] = React.useState(false);
  const [result, setResult]   = React.useState(null);
  const [error, setError]     = React.useState(null);

  // Bracket maths
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
        rationale: `R:R ${rr || '?'} on ${symbol} ${side} @ ${e}`,
      };
      const r = await window.fetchApi('/api/orders/dry-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setResult(r);
    } catch (ex) {
      setError(String(ex.message || ex));
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
            <input style={inputStyle} value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())}/>
          </label>
          <label style={{ flex: "1 1 80px" }}>
            <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4 }}>Side</div>
            <select style={inputStyle} value={side} onChange={e => setSide(e.target.value)}>
              <option value="BUY">BUY</option>
              <option value="SELL">SELL</option>
            </select>
          </label>
          <label style={{ flex: "1 1 80px" }}>
            <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4 }}>Qty</div>
            <input style={inputStyle} type="number" min="1" value={qty} onChange={e => setQty(e.target.value)}/>
          </label>
          <label style={{ flex: "1 1 110px" }}>
            <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4 }}>Entry ₹</div>
            <input style={inputStyle} type="number" step="0.05" value={entry} onChange={e => setEntry(e.target.value)}/>
          </label>
          <label style={{ flex: "1 1 100px" }}>
            <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4 }}>SL offset (pts)</div>
            <input style={inputStyle} type="number" step="0.05" min="0" value={slOffset} onChange={e => setSlOff(e.target.value)}/>
          </label>
          <label style={{ flex: "1 1 100px" }}>
            <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4 }}>Target offset (pts)</div>
            <input style={inputStyle} type="number" step="0.05" min="0" value={tgtOffset} onChange={e => setTgtOff(e.target.value)}/>
          </label>
        </div>

        {/* live R:R card */}
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

/* ============================================================
 * Tiny stat pill used by ReplayPanel for the result row.
 * ============================================================ */
const Pill = ({ label, value, accent }) => (
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

const PaperScreen = () => {
  const [account, setAccount] = useState("50L");
  const [, bump] = useState(0);
  React.useEffect(() => {
    const h = () => bump(n => n + 1);
    window.addEventListener("modes-changed", h);
    return () => window.removeEventListener("modes-changed", h);
  }, []);
  // ---- live paper trading state from /api/paper, /paper/positions, /paper/orders ----
  const [livePaper, setLivePaper] = React.useState(null);
  const [livePositions, setLivePositions] = React.useState(null);
  const [liveOrders, setLiveOrders] = React.useState(null);
  React.useEffect(() => {
    if (window.MockData && window.MockData.isDemoOn && window.MockData.isDemoOn()) return;
    let cancelled = false;
    (async () => {
      try {
        const [s, p, o] = await Promise.all([
          window.fetchApi('/api/paper'),
          window.fetchApi('/api/paper/positions'),
          window.fetchApi('/api/paper/orders'),
        ]);
        if (cancelled) return;
        if (s && s.ok) setLivePaper(s.stats);
        if (p && p.ok) setLivePositions(p.positions || []);
        if (o && o.ok) setLiveOrders(o.orders || o.list || []);
      } catch (e) { /* fall back to mock */ }
    })();
    return () => { cancelled = true; };
  }, []);
  const accounts = [
    { id: "10L", cap: 1000000, used: 412000, pnl: 18420,   trades: 34,  winR: 62 },
    { id: "25L", cap: 2500000, used: 1180000, pnl: 52840,  trades: 67,  winR: 66 },
    { id: "50L", cap: 5000000, used: 2140000, pnl: 148320, trades: 142, winR: 71 },
  ];
  const acc = accounts.find(a => a.id === account);

  const paperOrders = [
    { t: "14:41:08", s: "RELIANCE",   side: "BUY",  qty: 80,  req: 2948.50, fill: 2948.85, slip: 0.35, strat: "Momentum AI",   st: "filled" },
    { t: "14:32:19", s: "HDFCBANK",   side: "BUY",  qty: 50,  req: 1582.00, fill: 1582.15, slip: 0.15, strat: "Mean Rev. v2",  st: "filled" },
    { t: "14:18:44", s: "NIFTY 22500 CE", side: "BUY",  qty: 75,  req: 142.20, fill: 143.05, slip: 0.85, strat: "Iron Condor",  st: "filled" },
    { t: "13:58:02", s: "TATASTEEL", side: "SELL", qty: 200, req: 148.40, fill: 148.28, slip: 0.12, strat: "Breakout",      st: "filled" },
    { t: "13:44:30", s: "INFY",      side: "BUY",  qty: 40,  req: 1472.00, fill: 1472.00, slip: 0.00, strat: "Momentum AI",   st: "pending" },
    { t: "13:22:15", s: "SBIN",      side: "SELL", qty: 150, req: 782.50,  fill: 782.32,  slip: 0.18, strat: "Grid Trader",   st: "filled" },
  ];

  const pnlSeries = seriesRandom(9, 40, -8000, 160000, 3500);

  // Paper vs live calibration
  const paperVsLive = [
    { k: "Avg slippage",  paper: "0.08%", live: "0.14%", delta: "+0.06%", note: "Live has 1.75× more slippage" },
    { k: "Avg fill time", paper: "12ms",  live: "284ms", delta: "+272ms", note: "Broker RTT + exchange queue" },
    { k: "Rejection rate",paper: "0.2%",  live: "1.8%",  delta: "+1.6%",  note: "Margin / circuit / illiquid" },
    { k: "Partial fills",  paper: "0%",    live: "6.4%",  delta: "+6.4%",  note: "Modeled Q2 2026" },
  ];

  const Wrap = window.PaperChrome || React.Fragment;
  return (
    <>
      <Wrap>
      {livePaper && (
        <div className="card" style={{ marginBottom: 16, background: "var(--info-soft, #eff6ff)", padding: 14, borderRadius: 12 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
            <div style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700 }}>Live paper account</div>
            <div className="mono" style={{ fontSize: 15, fontWeight: 700 }}>cash INR {Number(livePaper.cash).toLocaleString("en-IN")}</div>
            <div className="mono" style={{ fontSize: 13 }}>equity INR {Number(livePaper.totalEquity).toLocaleString("en-IN")}</div>
            <div className="mono" style={{ fontSize: 13, color: livePaper.realizedPnl >= 0 ? "var(--up)" : "var(--down)" }}>realized INR {livePaper.realizedPnl}</div>
            <div className="mono" style={{ fontSize: 13, color: livePaper.unrealizedPnl >= 0 ? "var(--up)" : "var(--down)" }}>unrealized INR {livePaper.unrealizedPnl}</div>
            <div className="mono" style={{ fontSize: 13 }}>positions {livePaper.openPositions}</div>
            <div className="mono" style={{ fontSize: 13 }}>orders {liv