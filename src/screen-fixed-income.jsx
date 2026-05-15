/* eslint-disable */
/* REIT & Bond ladder builder — fixed-income / stability sleeve */

const FixedIncomeScreen = () => {
  // Tier 17: this screen has zero backend wiring. Showing fully fabricated data in
  // production is a regulatory and trust risk. Demo-gated until a real backend
  // module lands. Enable Demo mode in your profile menu to preview the planned UI.
  const [_demo] = window.useDemoMode ? window.useDemoMode() : [false];
  if (!_demo) {
    return (
      <div style={{ padding: 24, maxWidth: 720, margin: '40px auto', textAlign: 'center' }}>
        <div style={{ fontSize: 12, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.6 }}>Fixed income & REITs</div>
        <div style={{ fontSize: 22, fontWeight: 600, marginTop: 4 }}>Coming soon</div>
        <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 8, lineHeight: 1.5 }}>
          This screen does not yet have a real backend wired. Until fixed income & reits data is sourced from live broker / partner APIs, showing hardcoded sample data is misleading and unsafe.
          Enable <b>Demo mode</b> in your profile menu to preview the planned UI.
        </div>
        <div style={{ marginTop: 16, fontSize: 11, color: 'var(--text-3)' }}>
          Backend module: not yet implemented. Track progress in repo deploy/backend/.
        </div>
      </div>
    );
  }

  const [tab, setTab] = React.useState("reits");

  const reits = [
    { sym: "EMBASSY",   name: "Embassy Office Parks REIT",   nav: 392.4, yield: 6.8, occupancy: 89,
      div_freq: "Quarterly", aum: 41200, my_units: 0,    type: "Office", color: "var(--info)" },
    { sym: "MINDSPACE", name: "Mindspace Business Parks",     nav: 358.2, yield: 6.6, occupancy: 86,
      div_freq: "Quarterly", aum: 32800, my_units: 1200, type: "Office", color: "var(--info)" },
    { sym: "BIRET",     name: "Brookfield India REIT",        nav: 286.4, yield: 7.2, occupancy: 82,
      div_freq: "Quarterly", aum: 28400, my_units: 800,  type: "Office", color: "var(--info)" },
    { sym: "NXST",      name: "Nexus Select Trust (Retail)",  nav: 142.6, yield: 7.4, occupancy: 96,
      div_freq: "Quarterly", aum: 18600, my_units: 0,    type: "Retail", color: "var(--vio)" },
  ];

  const bondLadder = [
    { yr: 2026, type: "G-Sec",      isin: "IN0020220026", name: "7.26% GS 2032 (partial)", amount: 200000, yield: 7.18, dur: "0.5y", status: "matures" },
    { yr: 2027, type: "G-Sec",      isin: "IN0020210020", name: "7.06% GS 2027",            amount: 200000, yield: 7.10, dur: "1.5y", status: "active" },
    { yr: 2028, type: "T-Bill seq", isin: "rolling",      name: "Rolling 364-day T-bill",   amount: 200000, yield: 6.92, dur: "2.5y", status: "rolling" },
    { yr: 2029, type: "G-Sec",      isin: "IN0020230011", name: "7.18% GS 2029",            amount: 200000, yield: 7.18, dur: "3.5y", status: "active" },
    { yr: 2030, type: "AAA Corp",   isin: "INE040A08493", name: "HDFC Bank 7.85% 2030",     amount: 200000, yield: 7.85, dur: "4.5y", status: "active" },
    { yr: 2031, type: "G-Sec",      isin: "IN0020210135", name: "6.10% GS 2031",            amount: 200000, yield: 7.21, dur: "5.5y", status: "active" },
    { yr: 2032, type: "AAA Corp",   isin: "INE062A08272", name: "SBI 8.10% 2032",            amount: 200000, yield: 8.10, dur: "6.5y", status: "active" },
    { yr: 2033, type: "G-Sec",      isin: "IN0020230036", name: "7.30% GS 2053 (partial)",   amount: 200000, yield: 7.30, dur: "7.5y", status: "active" },
  ];
  const totalLadder = bondLadder.reduce((s, b) => s + b.amount, 0);
  const avgYield = bondLadder.reduce((s, b) => s + b.yield * b.amount, 0) / totalLadder;

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
          Long-term wealth · Fixed income & REITs
        </div>
        <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 4, maxWidth: 720 }}>
          The stability sleeve: bond ladders provide predictable cashflow while REITs deliver real-estate yield without illiquidity. Both moderate the equity-heavy core portfolio.
        </div>
      </div>

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat label="Bond ladder value"  value={`₹${(totalLadder/100000).toFixed(1)} L`} sub="across 8 maturities"/>
        <Stat label="Avg ladder yield"   value={`${avgYield.toFixed(2)}%`} sub="post-tax ≈ 5.04%"/>
        <Stat label="REIT holdings"      value="₹6.2 L" sub="2 REITs · 6.7% yield"/>
        <Stat label="Annual income"      value="₹1.42 L" sub="bonds + REIT distributions"/>
      </div>

      <Card>
        <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--border)", marginBottom: 16 }}>
          {[
            { id: "reits", label: "REITs" },
            { id: "ladder", label: "Bond ladder" },
            { id: "builder", label: "Build new ladder" },
            { id: "income", label: "Income forecast" },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              background: "transparent", border: "none",
              padding: "8px 14px", cursor: "pointer", fontSize: 12, fontWeight: 600,
              color: tab === t.id ? "var(--text)" : "var(--text-3)",
              borderBottom: "2px solid " + (tab === t.id ? "var(--acc)" : "transparent"),
              marginBottom: -1,
            }}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === "reits" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 1fr 80px 80px 90px 90px 80px",
              padding: "8px 12px", borderBottom: "1px solid var(--border)",
              fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600,
            }}>
              <div>REIT</div><div>Type</div><div style={{ textAlign: "right" }}>NAV</div><div style={{ textAlign: "right" }}>Yield</div><div style={{ textAlign: "right" }}>Occupancy</div><div style={{ textAlign: "right" }}>My units</div><div style={{ textAlign: "right" }}>Action</div>
            </div>
            {reits.map((r, i) => (
              <div key={i} style={{
                display: "grid", gridTemplateColumns: "1fr 1fr 80px 80px 90px 90px 80px",
                padding: "12px", borderBottom: i < reits.length - 1 ? "1px solid var(--border)" : "none",
                alignItems: "center", fontSize: 12,
              }}>
                <div>
                  <div style={{ fontWeight: 600 }} className="mono">{r.sym}</div>
                  <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>{r.name}</div>
                </div>
                <div><Chip variant="info">{r.type}</Chip></div>
                <div className="mono" style={{ textAlign: "right" }}>₹{r.nav}</div>
                <div className="mono" style={{ textAlign: "right", color: "var(--up)", fontWeight: 600 }}>{r.yield}%</div>
                <div className="mono" style={{ textAlign: "right" }}>{r.occupancy}%</div>
                <div className="mono" style={{ textAlign: "right" }}>{r.my_units > 0 ? r.my_units.toLocaleString("en-IN") : "—"}</div>
                <div style={{ textAlign: "right" }}>
                  <button className="btn btn-ghost" style={{ fontSize: 10, padding: "3px 8px" }}>{r.my_units > 0 ? "Manage" : "Buy"}</button>
                </div>
              </div>
            ))}
            <div style={{ marginTop: 12, padding: 10, borderRadius: "var(--r-sm)", background: "var(--info-soft)", color: "var(--info)", fontSize: 11, display: "flex", gap: 8 }}>
              <I.info size={12}/>
              <span><strong>Tax note:</strong> 100% of REIT distributions categorized as "interest" are taxed at slab. SPV dividend portion is exempt. Capital gains: STCG 20% (&lt;1y), LTCG 12.5% above ₹1.25L.</span>
            </div>
          </div>
        )}

        {tab === "ladder" && (
          <>
            <div style={{ marginBottom: 16, padding: 12, background: "var(--bg-soft)", borderRadius: "var(--r-md)", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
              <div>
                <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600 }}>LADDER STRATEGY</div>
                <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>Equal-weight 8-rung</div>
                <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>₹2L matures each year</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600 }}>WEIGHTED YTM</div>
                <div className="mono" style={{ fontSize: 13, fontWeight: 600, marginTop: 4, color: "var(--up)" }}>{avgYield.toFixed(2)}%</div>
                <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>vs FD 7.0% · vs liquid 5.8%</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600 }}>DURATION</div>
                <div className="mono" style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>4.0 yrs</div>
                <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>Modified duration</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600 }}>NEXT MATURITY</div>
                <div className="mono" style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>Sep 2026</div>
                <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>₹2L → reinvest at 8y rung</div>
              </div>
            </div>

            {/* Visual ladder */}
            <div style={{ marginBottom: 16, padding: "16px 8px" }}>
              <svg width="100%" height="160" viewBox="0 0 800 160">
                {bondLadder.map((b, i) => {
                  const x = 40 + i * 92;
                  const w = 72;
                  const h = 30 + b.yield * 6;
                  const y = 130 - h;
                  const color = b.type === "G-Sec" ? "var(--info)" : b.type === "AAA Corp" ? "var(--acc)" : "var(--vio)";
                  return (
                    <g key={i}>
                      <rect x={x} y={y} width={w} height={h} fill={color} opacity="0.85" rx="3"/>
                      <text x={x + w/2} y={y - 5} textAnchor="middle" fontSize="10" fill="var(--text-2)" fontFamily="var(--mono)">{b.yield}%</text>
                      <text x={x + w/2} y={148} textAnchor="middle" fontSize="11" fill="var(--text)" fontWeight="600">{b.yr}</text>
                      <text x={x + w/2} y={y + h/2 + 3} textAnchor="middle" fontSize="9" fill="white" fontWeight="600">{b.type === "G-Sec" ? "GS" : b.type === "AAA Corp" ? "Corp" : "TB"}</text>
                    </g>
                  );
                })}
                <line x1={20} x2={780} y1={130} y2={130} stroke="var(--border)"/>
              </svg>
              <div style={{ display: "flex", justifyContent: "center", gap: 16, marginTop: 6, fontSize: 10, color: "var(--text-3)" }}>
                <div><span style={{ display: "inline-block", width: 10, height: 10, background: "var(--info)", borderRadius: 2, marginRight: 4, verticalAlign: "middle" }}/>G-Sec</div>
                <div><span style={{ display: "inline-block", width: 10, height: 10, background: "var(--acc)", borderRadius: 2, marginRight: 4, verticalAlign: "middle" }}/>AAA Corp Bond</div>
                <div><span style={{ display: "inline-block", width: 10, height: 10, background: "var(--vio)", borderRadius: 2, marginRight: 4, verticalAlign: "middle" }}/>T-Bill (rolling)</div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "60px 100px 1fr 100px 90px 90px 100px", padding: "8px 12px", borderBottom: "1px solid var(--border)", fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600 }}>
              <div>Year</div><div>Type</div><div>Instrument</div><div style={{ textAlign: "right" }}>Amount</div><div style={{ textAlign: "right" }}>YTM</div><div style={{ textAlign: "right" }}>Duration</div><div style={{ textAlign: "right" }}>Status</div>
            </div>
            {bondLadder.map((b, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "60px 100px 1fr 100px 90px 90px 100px", padding: "10px 12px", borderBottom: i < bondLadder.length - 1 ? "1px solid var(--border)" : "none", alignItems: "center", fontSize: 12 }}>
                <div className="mono" style={{ fontWeight: 600 }}>{b.yr}</div>
                <div style={{ fontSize: 11 }}>{b.type}</div>
                <div>
                  <div>{b.name}</div>
                  <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }} className="mono">{b.isin}</div>
                </div>
                <div className="mono" style={{ textAlign: "right" }}>₹{(b.amount/1000).toFixed(0)}k</div>
                <div className="mono" style={{ textAlign: "right", color: "var(--up)", fontWeight: 600 }}>{b.yield}%</div>
                <div className="mono" style={{ textAlign: "right" }}>{b.dur}</div>
                <div style={{ textAlign: "right" }}>
                  <Chip variant={b.status === "matures" ? "warn" : b.status === "rolling" ? "info" : "up"}>
                    {b.status}
                  </Chip>
                </div>
              </div>
            ))}
          </>
        )}

        {tab === "builder" && (
          <div>
            <div style={{ marginBottom: 16, padding: 14, background: "var(--info-soft)", color: "var(--info)", borderRadius: "var(--r-md)", fontSize: 12 }}>
              <strong>Why a ladder?</strong> Spreads reinvestment risk: if rates rise, you reinvest maturing rungs at higher yields. If rates fall, locked-in rungs continue paying old yield. Smooths income across years.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div><div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4, fontWeight: 600 }}>Total to deploy (₹)</div><input className="input" defaultValue="2000000"/></div>
                <div><div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4, fontWeight: 600 }}>Number of rungs</div><input className="input" defaultValue="10"/></div>
                <div><div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4, fontWeight: 600 }}>Min maturity (years)</div><input className="input" defaultValue="1"/></div>
                <div><div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4, fontWeight: 600 }}>Max maturity (years)</div><input className="input" defaultValue="10"/></div>
                <div><div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4, fontWeight: 600 }}>Instrument mix</div><select className="input"><option>G-Sec only (safest)</option><option>G-Sec + AAA corporate (balanced)</option><option>AAA + AA corporate (aggressive)</option><option>SDL + G-Sec (state risk)</option></select></div>
                <button className="btn btn-primary" style={{ marginTop: 8 }}>Generate ladder</button>
              </div>
              <div style={{ padding: 14, background: "var(--bg-soft)", borderRadius: "var(--r-md)" }}>
                <div style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600, marginBottom: 10 }}>Preview</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}><span style={{ color: "var(--text-3)" }}>Avg yield (YTM)</span><span className="mono" style={{ fontWeight: 600, color: "var(--up)" }}>7.42%</span></div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}><span style={{ color: "var(--text-3)" }}>Post-tax (slab 30%)</span><span className="mono" style={{ fontWeight: 600 }}>5.19%</span></div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}><span style={{ color: "var(--text-3)" }}>Modified duration</span><span className="mono" style={{ fontWeight: 600 }}>4.8 yrs</span></div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}><span style={{ color: "var(--text-3)" }}>Annual income</span><span className="mono" style={{ fontWeight: 600 }}>₹1,48,400</span></div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}><span style={{ color: "var(--text-3)" }}>Per rung</span><span className="mono" style={{ fontWeight: 600 }}>₹2,00,000 × 10</span></div>
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === "income" && (
          <div>
            <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4 }}>Projected annual income from fixed income sleeve</div>
            <svg width="100%" height="200" viewBox="0 0 700 200">
              {Array.from({ length: 8 }).map((_, i) => {
                const yr = 2026 + i;
                const reit = 42000 + i * 2400;
                const bond = 14400 + i * 800 - (i === 0 ? 0 : 1200);
                const total = reit + bond;
                const x = 40 + i * 80;
                const max = 180;
                const reitH = (reit / 100000) * 100;
                const bondH = (bond / 100000) * 100;
                return (
                  <g key={i}>
                    <rect x={x} y={max - bondH} width={50} height={bondH} fill="var(--info)" rx="2"/>
                    <rect x={x} y={max - bondH - reitH} width={50} height={reitH} fill="var(--vio)" rx="2"/>
                    <text x={x + 25} y={max - bondH - reitH - 6} textAnchor="middle" fontSize="10" fill="var(--text-2)" fontFamily="var(--mono)">₹{(total/1000).toFixed(0)}k</text>
                    <text x={x + 25} y={195} textAnchor="middle" fontSize="11" fill="var(--text-3)">{yr}</text>
                  </g>
                );
              })}
            </svg>
            <div style={{ display: "flex", justifyContent: "center", gap: 16, marginTop: 6, fontSize: 11 }}>
              <div><span style={{ display: "inline-block", width: 10, height: 10, background: "var(--info)", borderRadius: 2, marginRight: 4, verticalAlign: "middle" }}/>Bond coupons</div>
              <div><span style={{ display: "inline-block", width: 10, height: 10, background: "var(--vio)", borderRadius: 2, marginRight: 4, verticalAlign: "middle" }}/>REIT distributions</div>
            </div>
          </div>
        )}
      </Card>
    </>
  );
};

window.FixedIncomeScreen = FixedIncomeScreen;
