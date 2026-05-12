/* eslint-disable */
/* Smallcase / theme basket comparator */

const SmallcaseScreen = () => {
  const [filter, setFilter] = React.useState("all");
  const [sort, setSort] = React.useState("cagr");

  const baskets = [
    { id: 1, name: "All Weather Investing", mgr: "Windmill Capital", theme: "Diversified", subs: 184320,
      stocks: 12, cagr: 18.4, ret1y: 22.1, ret3y: 16.8, vol: 12.4, dd: -14.2, fee: "0.5%/yr",
      min: 8420, top: ["NESTLEIND", "ITC", "ASIANPAINT", "HDFCBANK"], rebal: "Quarterly",
      tier: "low_risk", recommended: true,
    },
    { id: 2, name: "Equity & Gold", mgr: "Windmill Capital", theme: "Asset allocation", subs: 92140,
      stocks: 8, cagr: 14.2, ret1y: 18.6, ret3y: 13.4, vol: 9.8, dd: -8.6, fee: "0.5%/yr",
      min: 12200, top: ["NIFTYBEES", "GOLDBEES", "BANKBEES"], rebal: "Quarterly",
      tier: "low_risk",
    },
    { id: 3, name: "Top 100 stocks", mgr: "Windmill Capital", theme: "Large-cap core", subs: 248120,
      stocks: 30, cagr: 16.8, ret1y: 19.4, ret3y: 14.2, vol: 14.6, dd: -18.4, fee: "Free",
      min: 24800, top: ["RELIANCE", "TCS", "HDFCBANK", "INFY"], rebal: "Yearly",
      tier: "core",
    },
    { id: 4, name: "Electric Mobility", mgr: "Niveshaay", theme: "Sectoral · EV", subs: 42180,
      stocks: 14, cagr: 32.4, ret1y: 48.2, ret3y: 28.6, vol: 28.4, dd: -32.4, fee: "0.5%/yr",
      min: 18400, top: ["TATAMOTORS", "M&M", "EXIDE", "HEROMOTOCO"], rebal: "Quarterly",
      tier: "thematic", recommended: true,
    },
    { id: 5, name: "Naya Bharat", mgr: "Niveshaay", theme: "India growth story", subs: 68420,
      stocks: 18, cagr: 28.6, ret1y: 38.4, ret3y: 24.8, vol: 22.4, dd: -28.2, fee: "0.5%/yr",
      min: 14600, top: ["LTIM", "BAJFINANCE", "TATAPOWER"], rebal: "Quarterly",
      tier: "thematic",
    },
    { id: 6, name: "Defense & Aerospace", mgr: "Niveshaay", theme: "Sectoral · Defense", subs: 28640,
      stocks: 11, cagr: 42.8, ret1y: 64.2, ret3y: 38.4, vol: 34.6, dd: -38.4, fee: "0.5%/yr",
      min: 16800, top: ["HAL", "BEL", "BDL", "SOLARINDS"], rebal: "Quarterly",
      tier: "thematic",
    },
    { id: 7, name: "Pharma Tracker", mgr: "Capitalmind", theme: "Sectoral · Pharma", subs: 18420,
      stocks: 16, cagr: 22.4, ret1y: 28.4, ret3y: 18.6, vol: 18.2, dd: -22.4, fee: "0.5%/yr",
      min: 11400, top: ["SUNPHARMA", "DRREDDY", "CIPLA", "DIVISLAB"], rebal: "Quarterly",
      tier: "sector",
    },
    { id: 8, name: "Dividend Aristocrats", mgr: "Windmill Capital", theme: "Income · Dividend", subs: 32140,
      stocks: 20, cagr: 14.6, ret1y: 16.8, ret3y: 12.8, vol: 11.4, dd: -12.6, fee: "Free",
      min: 18200, top: ["ITC", "HINDUNILVR", "POWERGRID", "COALINDIA"], rebal: "Half-yearly",
      tier: "income",
    },
  ];

  const filtered = baskets
    .filter(b => filter === "all" ? true : b.tier === filter)
    .sort((a, b) => sort === "cagr" ? b.cagr - a.cagr : sort === "vol" ? a.vol - b.vol : b.subs - a.subs);

  const filters = [
    { id: "all", label: "All", n: baskets.length },
    { id: "low_risk", label: "Low risk" },
    { id: "core", label: "Core" },
    { id: "thematic", label: "Thematic" },
    { id: "sector", label: "Sectoral" },
    { id: "income", label: "Income" },
  ];

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
          Long-term wealth · Smallcase comparator
        </div>
        <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 4, maxWidth: 720 }}>
          Curated baskets of stocks managed by SEBI-registered investment advisors. AI scores each basket vs your goals and existing holdings to flag overlap and risk.
        </div>
      </div>

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat label="Subscribed baskets" value="2" sub="Top 100 + All Weather"/>
        <Stat label="Invested in baskets" value="₹4.8 L" sub="3.2% of portfolio"/>
        <Stat label="Basket XIRR (1y)" value="+19.4%" sub="vs Nifty +14.2%"/>
        <Stat label="Avg overlap" value="12%" sub="with your direct stocks"/>
      </div>

      <Card title="Discover baskets" sub={`${filtered.length} of ${baskets.length} matched`}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 6 }}>
            {filters.map(f => (
              <button key={f.id} onClick={() => setFilter(f.id)} style={{
                padding: "6px 12px", borderRadius: 14, fontSize: 11, fontWeight: 600,
                border: "1px solid " + (filter === f.id ? "var(--acc)" : "var(--border)"),
                background: filter === f.id ? "var(--acc)" : "transparent",
                color: filter === f.id ? "white" : "var(--text-2)",
                cursor: "pointer",
              }}>
                {f.label}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, color: "var(--text-3)" }}>Sort by</span>
            <select className="input" style={{ width: 140, height: 30, fontSize: 11 }} value={sort} onChange={e => setSort(e.target.value)}>
              <option value="cagr">CAGR (3y)</option>
              <option value="vol">Volatility (low→high)</option>
              <option value="subs">Popularity</option>
            </select>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
          {filtered.map(b => (
            <div key={b.id} style={{
              padding: 16, border: "1px solid " + (b.recommended ? "var(--acc)" : "var(--border)"),
              borderRadius: "var(--r-md)", background: b.recommended ? "var(--bg-soft)" : "transparent",
              position: "relative",
            }}>
              {b.recommended && (
                <div style={{
                  position: "absolute", top: -8, right: 12,
                  background: "var(--acc)", color: "white", fontSize: 10, fontWeight: 700,
                  padding: "2px 8px", borderRadius: 8, letterSpacing: 0.4, textTransform: "uppercase",
                }}>AI recommended</div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{b.name}</div>
                  <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 3 }}>by {b.mgr} · {b.theme} · {b.stocks} stocks</div>
                </div>
                <Chip variant={b.tier === "low_risk" ? "up" : b.tier === "thematic" ? "warn" : "info"}>
                  {b.tier.replace("_", " ")}
                </Chip>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, padding: 12, background: "var(--bg-soft)", borderRadius: "var(--r-sm)", marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 9, color: "var(--text-3)", fontWeight: 600 }}>CAGR (3Y)</div>
                  <div className="mono" style={{ fontSize: 14, fontWeight: 700, color: "var(--up)", marginTop: 2 }}>{b.cagr}%</div>
                </div>
                <div>
                  <div style={{ fontSize: 9, color: "var(--text-3)", fontWeight: 600 }}>1Y RETURN</div>
                  <div className="mono" style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>{b.ret1y}%</div>
                </div>
                <div>
                  <div style={{ fontSize: 9, color: "var(--text-3)", fontWeight: 600 }}>VOLATILITY</div>
                  <div className="mono" style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>{b.vol}%</div>
                </div>
                <div>
                  <div style={{ fontSize: 9, color: "var(--text-3)", fontWeight: 600 }}>MAX DD</div>
                  <div className="mono" style={{ fontSize: 14, fontWeight: 600, color: "var(--down)", marginTop: 2 }}>{b.dd}%</div>
                </div>
              </div>

              <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 6 }}>Top holdings</div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 10 }}>
                {b.top.map((s, i) => (
                  <span key={i} style={{
                    padding: "2px 8px", border: "1px solid var(--border)",
                    borderRadius: 10, fontSize: 10, fontFamily: "var(--mono)", color: "var(--text-2)",
                  }}>{s}</span>
                ))}
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 10, borderTop: "1px solid var(--border)" }}>
                <div style={{ fontSize: 10, color: "var(--text-3)" }}>
                  Min ₹{b.min.toLocaleString("en-IN")} · {b.fee} · {b.rebal}
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button className="btn btn-ghost" style={{ fontSize: 11, padding: "4px 10px" }}>Compare</button>
                  <button className="btn btn-primary" style={{ fontSize: 11, padding: "4px 10px" }}>Subscribe</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
};

window.SmallcaseScreen = SmallcaseScreen;
