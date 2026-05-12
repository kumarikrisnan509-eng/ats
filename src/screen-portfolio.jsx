/* eslint-disable */
/* Portfolio screen — long-term holdings + profit sweep waterfall */

const PortfolioScreen = () => {
  const holdings = [
    { s: "RELIANCE",   qty: 80,  avg: 2650.00, ltp: 2948.50, sector: "Energy" },
    { s: "HDFCBANK",   qty: 150, avg: 1540.00, ltp: 1712.80, sector: "Banking" },
    { s: "INFY",       qty: 120, avg: 1680.00, ltp: 1876.25, sector: "IT" },
    { s: "TCS",        qty: 50,  avg: 3820.00, ltp: 4120.10, sector: "IT" },
    { s: "ICICIBANK",  qty: 180, avg: 1120.00, ltp: 1288.90, sector: "Banking" },
    { s: "ITC",        qty: 300, avg:  410.00, ltp:  446.80, sector: "FMCG" },
  ];
  const mf = [
    { n: "Parag Parikh Flexi Cap",  t: "Flexi Cap",   sip: 15000, inv: 420000, cur: 498240, xirr: 18.4 },
    { n: "Mirae Large & Midcap",    t: "L&MC",        sip: 10000, inv: 280000, cur: 318400, xirr: 14.1 },
    { n: "Nippon Small Cap",        t: "Small Cap",   sip: 8000,  inv: 224000, cur: 282720, xirr: 22.8 },
    { n: "HDFC Balanced Advantage", t: "Hybrid",      sip: 5000,  inv: 140000, cur: 151200, xirr: 9.6 },
  ];
  const etf = [
    { n: "NIFTYBEES", q: 120, avg: 228.40, ltp: 252.30 },
    { n: "GOLDBEES",  q: 400, avg: 58.20,  ltp: 64.80  },
    { n: "JUNIORBEES",q: 80,  avg: 618.00, ltp: 694.40 },
  ];

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
        </Card>
      </div>

      <Card title="ETFs" flush>
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
      </Card>
    </>
  );
};

Object.assign(window, { PortfolioScreen });
