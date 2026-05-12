/* eslint-disable */
/* Brokers screen — broker adapter pattern */

const BrokersScreen = () => {
  const brokers = [
    {
      n: "Zerodha Kite",
      st: "connected",
      since: "Jan 14, 2025",
      cap: ["Equity", "F&O", "MCX", "CDS", "MF"],
      api: "kiteconnect v3",
      orders: 2840,
      fees: 2140,
      badge: "Primary",
      logoColor: "#387ed1",
      logoLetter: "Z",
    },
    { n: "Upstox Pro",      st: "slot", note: "OAuth ready · adapter stub", logoLetter: "U", logoColor: "#a020f0" },
    { n: "ICICI Breeze",    st: "slot", note: "Adapter not implemented",    logoLetter: "I", logoColor: "#e25c2b" },
    { n: "Dhan",            st: "slot", note: "Adapter not implemented",    logoLetter: "D", logoColor: "#0dbf81" },
    { n: "Interactive Brokers", st: "slot", note: "For US equity (future)", logoLetter: "IB", logoColor: "#c8102e" },
  ];
  const adapters = [
    { m: "placeOrder",        zerodha: true, upstox: true, icici: true, dhan: true, ib: true },
    { m: "modifyOrder",       zerodha: true, upstox: true, icici: true, dhan: true, ib: true },
    { m: "cancelOrder",       zerodha: true, upstox: true, icici: true, dhan: true, ib: true },
    { m: "getPositions",      zerodha: true, upstox: true, icici: true, dhan: true, ib: true },
    { m: "getHoldings",       zerodha: true, upstox: true, icici: true, dhan: true, ib: false },
    { m: "subscribeTicks",    zerodha: true, upstox: true, icici: false, dhan: true, ib: true },
    { m: "historicalCandles", zerodha: true, upstox: true, icici: false, dhan: false, ib: true },
    { m: "placeSIP",          zerodha: true, upstox: false, icici: true, dhan: false, ib: false },
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-header__title">Brokers</h1>
          <div className="page-header__sub">Portable broker layer. Add, swap, or run multiple brokers without touching strategy code.</div>
        </div>
        <div className="page-header__right">
          <button className="btn"><I.code size={14}/> Adapter docs</button>
          <button className="btn btn--primary"><I.plus size={14}/> Connect broker</button>
        </div>
      </div>

      {/* Architecture explainer */}
      <Card className="card--soft" style={{ marginBottom: 16 }}>
        <div className="row" style={{ gap: 20, justifyContent: "space-between" }}>
          {["Strategies", "Broker Adapter API", "Broker SDK", "Exchange"].map((s, i, a) => (
            <React.Fragment key={i}>
              <div style={{ textAlign: "center", flex: 1 }}>
                <div style={{ fontFamily: "var(--display)", fontSize: 18, letterSpacing: "-0.01em" }}>{s}</div>
                <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                  {["Python modules, stateless", "uniform interface · same call shape", "Zerodha · Upstox · Dhan · …", "NSE · BSE · MCX · CDS"][i]}
                </div>
              </div>
              {i < a.length - 1 && <div style={{ color: "var(--text-4)", fontFamily: "var(--mono)" }}>→</div>}
            </React.Fragment>
          ))}
        </div>
      </Card>

      <div className="grid grid-3" style={{ marginBottom: 16 }}>
        {brokers.map((b, i) => b.st === "connected" ? (
          <Card key={i} style={{ border: "1px solid color-mix(in oklab, var(--accent) 30%, var(--border))" }}>
            <div className="between" style={{ marginBottom: 12 }}>
              <div className="row">
                <div style={{ width: 40, height: 40, borderRadius: 10, background: b.logoColor, color: "white", display: "grid", placeItems: "center", fontWeight: 700, letterSpacing: "-0.02em" }}>{b.logoLetter}</div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{b.n}</div>
                  <div className="muted" style={{ fontSize: 11, fontFamily: "var(--mono)" }}>{b.api}</div>
                </div>
              </div>
              <Pill kind="acc">{b.badge}</Pill>
            </div>
            <div className="chip-row" style={{ marginBottom: 12 }}>
              {b.cap.map(c => <span className="chip" key={c}>{c}</span>)}
            </div>
            <div className="divider"/>
            <div className="between" style={{ fontSize: 12 }}><span className="muted">Connected since</span><span className="mono">{b.since}</span></div>
            <div className="between" style={{ fontSize: 12, marginTop: 6 }}><span className="muted">Orders (30d)</span><span className="mono">{b.orders.toLocaleString()}</span></div>
            <div className="between" style={{ fontSize: 12, marginTop: 6 }}><span className="muted">Fees (30d)</span><span className="mono">{inr(b.fees)}</span></div>
            <div className="between" style={{ fontSize: 12, marginTop: 6 }}><span className="muted">Status</span><Pill kind="up" dot>connected · 14ms</Pill></div>
            <div className="row" style={{ marginTop: 14, gap: 6 }}>
              <button className="btn btn--sm" style={{ flex: 1, justifyContent: "center" }}>Test API</button>
              <button className="btn btn--sm" style={{ flex: 1, justifyContent: "center" }}>Reauth</button>
            </div>
          </Card>
        ) : (
          <div className="slot" key={i}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: "color-mix(in oklab, " + b.logoColor + " 18%, transparent)", color: b.logoColor, display: "grid", placeItems: "center", fontWeight: 700 }}>{b.logoLetter}</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{b.n}</div>
            <div style={{ fontSize: 11 }}>{b.note}</div>
            <button className="btn btn--sm" style={{ marginTop: 6 }}><I.plus size={12}/> Connect</button>
          </div>
        ))}
      </div>

      <Card title="Adapter coverage" sub="Which broker implements which capability" flush>
        <table className="table">
          <thead><tr><th>Method</th><th style={{ textAlign: "center" }}>Zerodha</th><th style={{ textAlign: "center" }}>Upstox</th><th style={{ textAlign: "center" }}>ICICI</th><th style={{ textAlign: "center" }}>Dhan</th><th style={{ textAlign: "center" }}>IBKR</th></tr></thead>
          <tbody>
            {adapters.map((a, i) => (
              <tr key={i}>
                <td className="mono" style={{ fontSize: 12 }}>{a.m}()</td>
                {["zerodha", "upstox", "icici", "dhan", "ib"].map(k => (
                  <td key={k} style={{ textAlign: "center" }}>
                    {a[k] ? <I.check size={14} className="up"/> : <span className="muted">—</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div style={{ marginTop: 16 }}>
        <Card title="Routing by mode" sub="Each mode pins to a broker + product type. Fallbacks activate on primary failure." flush>
          <table className="table">
            <thead>
              <tr>
                <th>Mode</th>
                <th>Primary broker</th>
                <th>Product</th>
                <th>Fallback</th>
                <th>Trigger</th>
                <th className="num-l">30d orders</th>
              </tr>
            </thead>
            <tbody>
              {[
                { id: "intraday", primary: "Zerodha", product: "MIS",      fallback: "Upstox (stub)", trigger: "Zerodha API > 500ms or auth expired", orders: 2140 },
                { id: "swing",    primary: "Zerodha", product: "CNC",      fallback: "—",              trigger: "Manual re-route only",                orders:  184 },
                { id: "options",  primary: "Zerodha", product: "NRML/MIS", fallback: "Dhan (slot)",    trigger: "Illiquid wing · depth < lot×5",       orders:  382 },
                { id: "futures",  primary: "Zerodha", product: "NRML",     fallback: "—",              trigger: "Manual re-route only",                orders:  134 },
              ].map(row => {
                const meta = window.MODE_META[row.id];
                return (
                  <tr key={row.id}>
                    <td>
                      <span className="row" style={{ gap: 8 }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: meta.color }}/>
                        <span style={{ fontWeight: 500 }}>{meta.label}</span>
                      </span>
                    </td>
                    <td><Pill kind="acc">{row.primary}</Pill></td>
                    <td className="mono" style={{ fontSize: 12 }}>{row.product}</td>
                    <td>
                      {row.fallback === "—"
                        ? <span className="muted">—</span>
                        : <span className="mono" style={{ fontSize: 12, color: "var(--text-3)" }}>{row.fallback}</span>}
                    </td>
                    <td className="muted" style={{ fontSize: 11 }}>{row.trigger}</td>
                    <td className="num mono">{row.orders.toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ padding: "10px 16px", borderTop: "1px solid var(--border)", background: "var(--bg-soft)", fontSize: 11, color: "var(--text-3)" }}>
            <I.info size={12} style={{ verticalAlign: -1, marginRight: 6 }}/>
            Routing is enforced at the adapter layer — strategies call <code>placeOrder()</code> without knowing which broker handles it.
          </div>
        </Card>
      </div>
    </>
  );
};

Object.assign(window, { BrokersScreen });
