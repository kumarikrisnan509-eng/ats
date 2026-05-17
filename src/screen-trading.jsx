/* eslint-disable */
/* Trading screen */

const TradingScreen = () => {
  const [sym, setSym] = useState("RELIANCE");
  const [side, setSide] = useState("BUY");
  const [orderType, setOrderType] = useState("LIMIT");
  const [segment, setSegment] = useState("NSE");

  // Default mode → Product mapping (intraday=MIS, swing=CNC, options/futures=NRML)
  const MODE_TO_PRODUCT = { intraday: "MIS", swing: "CNC", options: "NRML", futures: "NRML" };
  const getDefaultMode = () => {
    return window.getEffectiveDefaultMode ? window.getEffectiveDefaultMode() : "intraday";
  };
  const [defaultMode, setDefaultMode] = useState(getDefaultMode);
  const [product, setProduct] = useState(MODE_TO_PRODUCT[getDefaultMode()] || "CNC");
  React.useEffect(() => {
    const sync = () => {
      const m = getDefaultMode();
      setDefaultMode(m);
      setProduct(MODE_TO_PRODUCT[m] || "CNC");
    };
    window.addEventListener("default-mode-changed", sync);
    window.addEventListener("modes-changed", sync);
    return () => {
      window.removeEventListener("default-mode-changed", sync);
      window.removeEventListener("modes-changed", sync);
    };
  }, []);

  const candles = useMemo(() => {
    const arr = []; let v = 2920;
    for (let i = 0; i < 40; i++) {
      const o = v;
      const h = o + Math.random() * 14;
      const l = o - Math.random() * 14;
      const c = l + Math.random() * (h - l);
      v = c;
      arr.push({ o, h, l, c });
    }
    return arr;
  }, [sym]);

  // Live order book derived from LTP — regenerates each tick
  const liveTick = useLiveTick(sym);
  const mid = liveTick?.ltp || 2948.50;
  const tickSize = sym.includes("NIFTY") || mid > 5000 ? 0.05 : 0.05;
  const seed = Math.floor(mid * 100) % 997;
  const rng = (i) => ((seed * (i + 7) * 9301 + 49297) % 233280) / 233280;
  const bids = [0, 1, 2, 3, 4].map(i => ({
    p: +(mid - (i + 1) * tickSize).toFixed(2),
    q: Math.floor(400 + rng(i) * 1800),
    o: Math.floor(4 + rng(i + 10) * 18),
  }));
  const asks = [0, 1, 2, 3, 4].map(i => ({
    p: +(mid + (i + 1) * tickSize).toFixed(2),
    q: Math.floor(400 + rng(i + 5) * 1800),
    o: Math.floor(4 + rng(i + 15) * 18),
  }));
  const maxQ = Math.max(...bids.map(b => b.q), ...asks.map(a => a.q));
  const bidTotal = bids.reduce((s, b) => s + b.q, 0);
  const askTotal = asks.reduce((s, a) => s + a.q, 0);
  const spread = (asks[0].p - bids[0].p).toFixed(2);

  // Mock orders feed used in demo mode. In production, screens fetch from /api/orders.
  const __mockOrders = [
    { t: "13:42:08", s: "INFY",     side: "BUY",  qty: 60,  px: "1876.25", t2: "LIMIT",  st: "executed",  mode: "intraday", strat: "Momentum AI" },
    { t: "13:48:31", s: "RELIANCE", side: "BUY",  qty: 40,  px: "MKT",     t2: "MARKET", st: "executed",  mode: "intraday", strat: "Mean Reversion v2" },
    { t: "14:02:11", s: "TCS",      side: "SELL", qty: 25,  px: "4140.50", t2: "LIMIT",  st: "executed",  mode: "swing",    strat: "Trend Follow" },
    { t: "14:18:22", s: "HDFCBANK", side: "BUY",  qty: 80,  px: "1712.00", t2: "SL",     st: "pending",   mode: "swing",    strat: "Trend Follow" },
    { t: "14:30:00", s: "NIFTY CE", side: "BUY",  qty: 150, px: "82.40",   t2: "LIMIT",  st: "executed",  mode: "options",  strat: "Iron Condor Weekly" },
    { t: "14:41:08", s: "BANKNIFTY FUT", side: "SELL", qty: 15,  px: "48160.00",t2: "LIMIT",  st: "cancelled", mode: "futures",  strat: "NIFTY Futures Trend" },
    { t: "14:52:44", s: "NIFTY PE",  side: "BUY",  qty: 75,  px: "112.00",  t2: "LIMIT",  st: "executed",  mode: "options",  strat: "PE Hedge" },
    { t: "15:01:20", s: "SBIN",      side: "BUY",  qty: 100, px: "884.00",  t2: "LIMIT",  st: "pending",   mode: "intraday", strat: "Grid Trader" },
  ];

  const _isDemo = (window.MockData && window.MockData.isDemoOn && window.MockData.isDemoOn());
  const [orders, setOrders] = React.useState(_isDemo ? __mockOrders : []);
  React.useEffect(() => {
    if (_isDemo) { setOrders(__mockOrders); return; }
    let cancelled = false;
    (async () => {
      try {
        const data = await window.fetchApi('/api/orders');
        if (cancelled) return;
        const rows = (data && data.rows || []).map(o => {
          // Normalize Kite shape to the screen's row shape.
          const t = o.placedAt ? new Date(o.placedAt).toLocaleTimeString('en-IN', { hour12: false }) : '—';
          return {
            t,
            s: o.symbol,
            side: (o.transactionType || '').toUpperCase(),
            qty: o.quantity,
            px: o.orderType === 'MARKET' ? 'MKT' : String(o.price),
            t2: o.orderType,
            st: (o.status || '').toLowerCase(),
            mode: (o.product || '').toLowerCase(),
            strat: '—',
          };
        });
        setOrders(rows);
      } catch (err) {
        console.warn('[trading] /api/orders failed:', err.message);
        if (!cancelled) setOrders([]);
      }
    })();
    return () => { cancelled = true; };
  }, [_isDemo]);

  const [modeFilter, setModeFilter] = useState("All");
  const visibleOrders = orders.filter(o => modeFilter === "All" || o.mode === modeFilter);

  // Pre-trade simulator + 2FA
  const [simOrder, setSimOrder] = useState(null);
  const [qty, setQty] = useState(40);
  const [price, setPrice] = useState(2948.50);
  const openSim = () => setSimOrder({
    symbol: sym, side, qty: parseInt(qty) || 0, price: parseFloat(price) || 0,
    product, modeId: defaultMode,
  });

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-header__title">Trading</h1>
          <div className="page-header__sub">Manual + automated orders. Route to Zerodha Kite.</div>
        </div>
        <div className="page-header__right">
          <Segmented value={segment} onChange={setSegment} options={["NSE", "BSE", "NFO", "MCX", "CDS"]}/>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1fr 340px", marginBottom: 16, gap: 16 }}>
        {/* Chart */}
        <Card
          title={sym}
          sub={segment + " · Equity · ₹2,948.50 +1.24%"}
          right={<Segmented value="5m" onChange={() => {}} options={["1m", "5m", "15m", "1h", "1D"]}/>}
        >
          <Candles data={candles} height={280}/>
          <div className="divider"/>
          <div className="row" style={{ gap: 18, fontSize: 12 }}>
            <div><span className="muted">Open </span><span className="mono">2,935.20</span></div>
            <div><span className="muted">High </span><span className="mono up">2,958.10</span></div>
            <div><span className="muted">Low </span><span className="mono down">2,928.00</span></div>
            <div><span className="muted">Vol </span><span className="mono">12.4M</span></div>
            <div><span className="muted">VWAP </span><span className="mono">2,944.80</span></div>
          </div>
        </Card>

        {/* Order ticket */}
        <Card title="Order ticket" sub="Routes to Zerodha Kite">
          <Segmented value={side} onChange={setSide} options={[{ value: "BUY", label: "Buy" }, { value: "SELL", label: "Sell" }]}/>

          <div style={{ marginTop: 14 }}>
            <label className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>Symbol</label>
            <input value={sym} onChange={e => setSym(e.target.value.toUpperCase())}
              style={{ width: "100%", marginTop: 4, padding: "8px 10px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r-md)", fontFamily: "var(--mono)" }}/>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
            <div>
              <label className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>Qty</label>
              <input value={qty} onChange={e => setQty(e.target.value)} style={{ width: "100%", marginTop: 4, padding: "8px 10px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r-md)", fontFamily: "var(--mono)" }}/>
            </div>
            <div>
              <label className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>Price</label>
              <input value={price} onChange={e => setPrice(e.target.value)} style={{ width: "100%", marginTop: 4, padding: "8px 10px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r-md)", fontFamily: "var(--mono)" }}/>
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <label className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>Order type</label>
            <div style={{ marginTop: 4 }}>
              <Segmented value={orderType} onChange={setOrderType} options={["MARKET", "LIMIT", "SL", "SL-M"]}/>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
            <div>
              <label className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Product · <span style={{ color: window.MODE_META[defaultMode]?.color }}>{window.MODE_META[defaultMode]?.label} default</span>
              </label>
              <div style={{ marginTop: 4 }}>
                <Segmented value={product} onChange={setProduct} options={["CNC", "MIS", "NRML"]}/>
              </div>
            </div>
            <div>
              <label className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>Validity</label>
              <div style={{ marginTop: 4 }}>
                <Segmented value="DAY" onChange={() => {}} options={["DAY", "IOC"]}/>
              </div>
            </div>
          </div>

          <div className="divider" style={{ margin: "14px 0" }}/>
          {/* T99-T87: dropped hardcoded margin ₹1,17,940 + brokerage ₹20.
              These values must come from Kite's order-margin calc + a brokerage
              estimator that knows the user's broker plan. Until those are
              wired we show '—' and an explanatory sub-line. Same pattern as
              T-77 (margin screen) and T-80 (attribution headline). */}
          <div className="between" style={{ fontSize: 12 }}><span className="muted">Approx margin</span><span className="mono">—</span></div>
          <div className="between" style={{ fontSize: 12, marginTop: 4 }}><span className="muted">Brokerage (est.)</span><span className="mono">—</span></div>
          <div className="muted" style={{ fontSize: 10, marginTop: 4 }}>
            Margin + brokerage estimate not wired yet — confirm with broker before placing.
          </div>

          {(() => {
            const conn = useConnectionState();
            const disabled = conn !== "connected";
            return (
              <button
                className={"btn btn--accent"}
                onClick={disabled ? null : openSim}
                disabled={disabled}
                style={{
                  width: "100%", marginTop: 14, justifyContent: "center",
                  background: disabled ? "var(--bg-soft)" : (side === "BUY" ? "var(--up)" : "var(--down)"),
                  color: disabled ? "var(--text-3)" : "#fff",
                  borderColor: disabled ? "var(--border)" : "transparent",
                  cursor: disabled ? "not-allowed" : "pointer",
                }}
              >
                {disabled ? `Feed ${conn} — orders paused` : `${side} ${sym} @ ₹${parseFloat(price).toFixed(2)}`}
              </button>
            );
          })()}
          <button className="btn btn--ghost" style={{ width: "100%", marginTop: 8, justifyContent: "center" }}>Send to strategy…</button>
        </Card>
      </div>

      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        {/* Order book */}
        <Card title="Market depth" sub={sym + " · Top 5 bids & asks"}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div className="ob" style={{ color: "var(--text-3)", marginBottom: 4, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", padding: "0 10px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                <span>Bid</span><span>Qty</span><span>Orders</span>
              </div>
              {bids.map((b, i) => (
                <div key={i} className="ob__row">
                  <div className="bar" style={{ width: `${(b.q / maxQ) * 100}%` }}/>
                  <span className="p">{b.p.toFixed(2)}</span><span>{b.q}</span><span>{b.o}</span>
                </div>
              ))}
            </div>
            <div>
              <div className="ob" style={{ color: "var(--text-3)", marginBottom: 4, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", padding: "0 10px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                <span>Ask</span><span>Qty</span><span>Orders</span>
              </div>
              {asks.map((a, i) => (
                <div key={i} className="ob__row ask">
                  <div className="bar" style={{ width: `${(a.q / maxQ) * 100}%` }}/>
                  <span className="p">{a.p.toFixed(2)}</span><span>{a.q}</span><span>{a.o}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="divider" style={{ margin: "14px 0" }}/>
          <div className="between" style={{ fontSize: 12 }}>
            <span className="muted">Spread</span><span className="mono">{spread}</span>
          </div>
          <div className="between" style={{ fontSize: 12, marginTop: 4 }}>
            <span className="muted">Bid total</span><span className="mono up">{bidTotal.toLocaleString("en-IN")}</span>
          </div>
          <div className="between" style={{ fontSize: 12, marginTop: 4 }}>
            <span className="muted">Ask total</span><span className="mono down">{askTotal.toLocaleString("en-IN")}</span>
          </div>
        </Card>

        {/* Market watch */}
        <Card title="Market watch" sub={segment} flush>
          <table className="table">
            <thead><tr><th>Symbol</th><th className="num-l">LTP</th><th className="num-l">Chg%</th><th className="num-l">Vol</th></tr></thead>
            <tbody>
              {[
                { s: "NIFTY 50", v: "—" },
                { s: "BANKNIFTY", v: "—" },
                { s: "RELIANCE", v: "12.4M" },
                { s: "TCS", v: "3.2M" },
                { s: "HDFCBANK", v: "8.9M" },
                { s: "INFY", v: "6.1M" },
                { s: "ICICIBANK", v: "5.7M" },
              ].map((r, i) => {
                const live = window.LiveTicks.state().symbols[r.s];
                const chg = live ? ((live.ltp - live.prev) / live.prev) * 100 : 0;
                return (
                  <tr key={i} onClick={() => setSym(r.s)} style={{ cursor: "pointer" }}>
                    <td style={{ fontWeight: 500 }}>{r.s}</td>
                    <td className="num"><LiveCell symbol={r.s} decimals={2}/></td>
                    <td className={"num " + clsPN(chg)}>{pct(chg)}</td>
                    <td className="num muted">{r.v}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </div>

      <Card
        title="Today's orders"
        sub={`${visibleOrders.length} of ${orders.length} · auto + manual · filtered by mode`}
        right={
          <div className="row" style={{ gap: 4 }}>
            {["All", ...window.MODE_IDS].map(id => {
              const label = id === "All" ? "All" : window.MODE_META[id].shortLabel;
              const color = id === "All" ? null : window.MODE_META[id].color;
              const active = modeFilter === id;
              return (
                <button
                  key={id}
                  onClick={() => setModeFilter(id)}
                  className="btn btn--sm"
                  style={{
                    background: active ? (color || "var(--text-1)") : "var(--bg-soft)",
                    color: active ? "#fff" : "var(--text-2)",
                    borderColor: active ? (color || "var(--text-1)") : "var(--border)",
                    padding: "4px 10px", fontSize: 11,
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        }
        flush
      >
        <table className="table">
          <thead><tr><th>Time</th><th>Symbol</th><th>Side</th><th className="num-l">Qty</th><th className="num-l">Price</th><th>Type</th><th>Mode · Strategy</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {visibleOrders.map((o, i) => {
              const meta = window.MODE_META[o.mode];
              return (
                <tr key={i}>
                  <td className="mono" style={{ fontSize: 12, color: "var(--text-3)" }}>{o.t}</td>
                  <td style={{ fontWeight: 500 }}>{o.s}</td>
                  <td><Pill kind={o.side === "BUY" ? "up" : "down"}>{o.side}</Pill></td>
                  <td className="num">{o.qty}</td>
                  <td className="num">{o.px}</td>
                  <td><span className="muted" style={{ fontSize: 12 }}>{o.t2}</span></td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <span style={{ fontSize: 10, fontFamily: "var(--mono)", color: meta.color, padding: "2px 6px", borderRadius: 3, background: meta.colorSoft, fontWeight: 500 }}>
                        {meta.shortLabel}
                      </span>
                      <span style={{ fontSize: 12, color: "var(--text-2)" }}>{o.strat}</span>
                    </div>
                  </td>
                  <td>{o.st === "executed" ? <Pill kind="up" dot>executed</Pill> : o.st === "pending" ? <Pill kind="info" dot>pending</Pill> : <Pill dot>cancelled</Pill>}</td>
                  <td><button className="btn btn--sm">Details</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <window.PreTradeSimulator
        open={!!simOrder}
        onClose={() => setSimOrder(null)}
        order={simOrder}
        onConfirm={() => { /* would dispatch order to broker */ }}
      />
    </>
  );
};

Object.assign(window, { TradingScreen });
