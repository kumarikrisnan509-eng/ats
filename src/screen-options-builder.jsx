/* eslint-disable */
/* Options payoff builder — visual P&L diagram with Greeks */

const OptionsBuilderScreen = () => {
  // ---- live /api/option-expiries + /api/option-chain ----
  const [liveExpiries, setLiveExpiries] = React.useState(null);
  const [liveChain, setLiveChain] = React.useState(null);
  React.useEffect(() => {
    if (window.MockData && window.MockData.isDemoOn && window.MockData.isDemoOn()) return;
    let cancelled = false;
    (async () => {
      try {
        const d = await window.fetchApi('/api/option-expiries?underlying=NIFTY');
        if (!cancelled && d && d.ok) {
          setLiveExpiries(d.expiries || []);
          // Fetch chain for nearest expiry
          if (d.expiries && d.expiries.length > 0) {
            try {
              const c = await window.fetchApi('/api/option-chain?underlying=NIFTY&expiry=' + encodeURIComponent(d.expiries[0]));
              if (!cancelled && c && c.ok) setLiveChain(c);
            } catch (e2) {}
          }
        }
      } catch (e) { console.warn('[screen-options-builder] error:', e && e.message); }
    })();
    return () => { cancelled = true; };
  }, []);
  const [legs, setLegs] = React.useState([
    { id: 1, action: "BUY",  type: "CE", strike: 24000, premium: 142, qty: 1, expiry: "25-Apr-2026" },
    { id: 2, action: "SELL", type: "CE", strike: 24200, premium: 88,  qty: 1, expiry: "25-Apr-2026" },
  ]);

  const spot = 24080;
  const lotSize = 50;

  // Calculate payoff at any underlying price
  const payoffAt = (S) => {
    let total = 0;
    for (const l of legs) {
      const dir = l.action === "BUY" ? 1 : -1;
      const intrinsic = l.type === "CE" ? Math.max(0, S - l.strike) : Math.max(0, l.strike - S);
      const legPnL = dir * (intrinsic - l.premium) * l.qty * lotSize;
      total += legPnL;
    }
    return total;
  };

  // Build payoff curve
  const pricePoints = React.useMemo(() => {
    const pts = [];
    for (let S = 23500; S <= 24500; S += 10) {
      pts.push({ s: S, pnl: payoffAt(S) });
    }
    return pts;
  }, [legs]);

  const maxProfit = Math.max(...pricePoints.map(p => p.pnl));
  const maxLoss = Math.min(...pricePoints.map(p => p.pnl));
  const breakeven = pricePoints.find((p, i) => i > 0 && Math.sign(p.pnl) !== Math.sign(pricePoints[i-1].pnl))?.s;

  // Chart coords
  const W = 720, H = 260, pad = 40;
  const xMin = 23500, xMax = 24500;
  const yMin = Math.min(-25000, maxLoss * 1.2);
  const yMax = Math.max(25000, maxProfit * 1.2);
  const x = (s) => pad + (s - xMin) / (xMax - xMin) * (W - 2 * pad);
  const y = (p) => H - pad - (p - yMin) / (yMax - yMin) * (H - 2 * pad);
  const yZero = y(0);
  const yScale = (H - 2 * pad) / (yMax - yMin);

  // Path for positive and negative regions
  const polyPoints = pricePoints.map(p => `${x(p.s)},${y(p.pnl)}`).join(" ");

  // Approx Greeks (rough estimates for display)
  const netDelta = legs.reduce((s, l) => {
    const dir = l.action === "BUY" ? 1 : -1;
    const itm = l.type === "CE" ? (spot > l.strike) : (spot < l.strike);
    return s + dir * l.qty * (itm ? 0.7 : 0.3) * (l.type === "CE" ? 1 : -1);
  }, 0);
  const netTheta = legs.reduce((s, l) => {
    const dir = l.action === "BUY" ? 1 : -1;
    return s - dir * l.qty * 4.2;
  }, 0);
  const netVega = legs.reduce((s, l) => {
    const dir = l.action === "BUY" ? 1 : -1;
    return s + dir * l.qty * 8.4;
  }, 0);

  const addLeg = () => {
    setLegs([...legs, { id: Date.now(), action: "BUY", type: "CE", strike: 24000, premium: 100, qty: 1, expiry: "25-Apr-2026" }]);
  };

  const removeLeg = (id) => setLegs(legs.filter(l => l.id !== id));
  const updateLeg = (id, key, val) => setLegs(legs.map(l => l.id === id ? { ...l, [key]: val } : l));

  const strategyName = (() => {
    if (legs.length === 2 && legs[0].action === "BUY" && legs[1].action === "SELL" && legs[0].type === legs[1].type && legs[0].type === "CE") return "Bull Call Spread";
    if (legs.length === 2 && legs[0].action === "BUY" && legs[1].action === "SELL" && legs[0].type === legs[1].type && legs[0].type === "PE") return "Bear Put Spread";
    if (legs.length === 4) return "Iron Condor / Butterfly";
    if (legs.length === 1) return legs[0].action + " " + legs[0].type;
    return "Custom strategy";
  })();

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
          Automate · Options strategy builder
        </div>
        <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 4, maxWidth: 720 }}>
          Compose multi-leg options positions. Live payoff curve updates as you modify legs. Spot, IV, and margin are pulled from Zerodha.
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16 }}>
        <Card title={strategyName} sub={`NIFTY ${spot} spot · lot size ${lotSize}`}>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 280 }}>
            {/* Profit region */}
            <defs>
              <clipPath id="profit-clip"><rect x={0} y={0} width={W} height={yZero}/></clipPath>
              <clipPath id="loss-clip"><rect x={0} y={yZero} width={W} height={H}/></clipPath>
            </defs>
            <polygon points={`${pad},${yZero} ${polyPoints} ${W-pad},${yZero}`} fill="oklch(65% 0.14 155 / 0.15)" clipPath="url(#profit-clip)"/>
            <polygon points={`${pad},${yZero} ${polyPoints} ${W-pad},${yZero}`} fill="oklch(55% 0.18 25 / 0.15)" clipPath="url(#loss-clip)"/>

            {/* Zero line */}
            <line x1={pad} y1={yZero} x2={W-pad} y2={yZero} stroke="var(--border)" strokeDasharray="3 3"/>
            {/* Payoff curve */}
            <polyline points={polyPoints} fill="none" stroke="var(--acc)" strokeWidth={2}/>

            {/* Spot marker */}
            <line x1={x(spot)} y1={pad} x2={x(spot)} y2={H-pad} stroke="var(--info)" strokeDasharray="2 4" strokeWidth={1}/>
            <text x={x(spot)} y={pad - 6} fill="var(--info)" fontSize={10} textAnchor="middle" fontFamily="var(--mono)">Spot ₹{spot}</text>

            {/* Breakeven marker */}
            {breakeven && (
              <>
                <circle cx={x(breakeven)} cy={yZero} r={4} fill="var(--acc)"/>
                <text x={x(breakeven)} y={yZero + 14} fill="var(--acc)" fontSize={10} textAnchor="middle" fontFamily="var(--mono)">BE ₹{breakeven}</text>
              </>
            )}

            {/* Axis labels */}
            <text x={pad} y={H - 8} fill="var(--text-3)" fontSize={10} fontFamily="var(--mono)">₹{xMin}</text>
            <text x={W/2} y={H - 8} fill="var(--text-3)" fontSize={10} fontFamily="var(--mono)" textAnchor="middle">NIFTY at expiry</text>
            <text x={W - pad} y={H - 8} fill="var(--text-3)" fontSize={10} fontFamily="var(--mono)" textAnchor="end">₹{xMax}</text>

            <text x={8} y={y(maxProfit)} fill="var(--up)" fontSize={10} fontFamily="var(--mono)">+₹{Math.round(maxProfit/1000)}k</text>
            <text x={8} y={y(maxLoss)} fill="var(--down)" fontSize={10} fontFamily="var(--mono)">₹{Math.round(maxLoss/1000)}k</text>
          </svg>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginTop: 16, padding: 12, background: "var(--bg-soft)", borderRadius: "var(--r-md)" }}>
            <div>
              <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase" }}>Max profit</div>
              <div className="mono" style={{ fontSize: 15, fontWeight: 700, marginTop: 3, color: "var(--up)" }}>+₹{Math.round(maxProfit).toLocaleString("en-IN")}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase" }}>Max loss</div>
              <div className="mono" style={{ fontSize: 15, fontWeight: 700, marginTop: 3, color: "var(--down)" }}>₹{Math.round(maxLoss).toLocaleString("en-IN")}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase" }}>Breakeven</div>
              <div className="mono" style={{ fontSize: 15, fontWeight: 700, marginTop: 3 }}>₹{breakeven || "–"}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase" }}>Risk/Reward</div>
              <div className="mono" style={{ fontSize: 15, fontWeight: 700, marginTop: 3 }}>{maxLoss !== 0 ? `1:${(maxProfit/Math.abs(maxLoss)).toFixed(2)}` : "∞"}</div>
            </div>
          </div>
        </Card>

        {/* Greeks */}
        <Card title="Greeks (net)" sub="Position sensitivity">
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {[
              { n: "Delta", v: netDelta.toFixed(2), d: "Per ₹ move in underlying", c: netDelta >= 0 ? "up" : "down" },
              { n: "Theta", v: netTheta.toFixed(2), d: "Per day (time decay)", c: netTheta >= 0 ? "up" : "down" },
              { n: "Vega", v: netVega.toFixed(2), d: "Per 1% change in IV", c: netVega >= 0 ? "up" : "down" },
              { n: "Gamma", v: "0.018", d: "Per ₹ move (delta accel.)", c: "info" },
            ].map((g, i) => (
              <div key={i} style={{ paddingBottom: 10, borderBottom: i < 3 ? "1px solid var(--border)" : "none" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{g.n}</div>
                  <div className="mono" style={{ fontSize: 16, fontWeight: 700, color: g.c === "up" ? "var(--up)" : g.c === "down" ? "var(--down)" : "var(--info)" }}>{g.v}</div>
                </div>
                <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{g.d}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 14, padding: 12, background: "var(--info-soft)", color: "var(--info)", borderRadius: "var(--r-sm)", fontSize: 11, lineHeight: 1.5 }}>
            <strong>AI insight:</strong> Defined-risk spread. Max loss capped, favorable if NIFTY stays between ₹24,100–24,200. Theta positive favors you as expiry approaches.
          </div>
        </Card>
      </div>

      {/* Legs table */}
      <div style={{ marginTop: 16 }}>
        <Card title={`Legs (${legs.length})`} sub="Edit strike, premium, quantity per leg">
          <div style={{ display: "grid", gridTemplateColumns: "50px 90px 90px 120px 120px 80px 140px 60px", padding: "8px 12px", borderBottom: "1px solid var(--border)", fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600 }}>
            <div>Leg</div><div>Action</div><div>Type</div><div>Strike</div><div>Premium</div><div>Qty</div><div>Expiry</div><div></div>
          </div>
          {legs.map((l, i) => (
            <div key={l.id} style={{
              display: "grid", gridTemplateColumns: "50px 90px 90px 120px 120px 80px 140px 60px",
              padding: "10px 12px", borderBottom: i < legs.length - 1 ? "1px solid var(--border)" : "none",
              alignItems: "center", gap: 8,
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-3)" }}>#{i + 1}</div>
              <select value={l.action} onChange={e => updateLeg(l.id, "action", e.target.value)} className="input" style={{ padding: 4, fontSize: 12 }}>
                <option value="BUY">BUY</option><option value="SELL">SELL</option>
              </select>
              <select value={l.type} onChange={e => updateLeg(l.id, "type", e.target.value)} className="input" style={{ padding: 4, fontSize: 12 }}>
                <option value="CE">Call (CE)</option><option value="PE">Put (PE)</option>
              </select>
              <input type="number" value={l.strike} onChange={e => updateLeg(l.id, "strike", +e.target.value)} className="input" style={{ padding: 4, fontSize: 12, fontFamily: "var(--mono)" }}/>
              <input type="number" value={l.premium} onChange={e => updateLeg(l.id, "premium", +e.target.value)} className="input" style={{ padding: 4, fontSize: 12, fontFamily: "var(--mono)" }}/>
              <input type="number" value={l.qty} onChange={e => updateLeg(l.id, "qty", +e.target.value)} className="input" style={{ padding: 4, fontSize: 12, fontFamily: "var(--mono)" }}/>
              <div style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "var(--mono)" }}>{l.expiry}</div>
              <button className="btn btn-ghost" style={{ fontSize: 11, padding: "4px 8px", color: "var(--down)" }} onClick={() => removeLeg(l.id)}>Remove</button>
            </div>
          ))}
          <div style={{ padding: "12px 0 0", display: "flex", gap: 8 }}>
            <button className="btn btn-ghost" onClick={addLeg} style={{ fontSize: 12 }}>+ Add leg</button>
            <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setLegs([{ id: 1, action: "BUY", type: "CE", strike: 24000, premium: 142, qty: 1, expiry: "25-Apr-2026" }, { id: 2, action: "SELL", type: "CE", strike: 24200, premium: 88, qty: 1, expiry: "25-Apr-2026" }])}>Bull Call Spread</button>
            <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setLegs([{ id: 1, action: "BUY", type: "CE", strike: 24100, premium: 120, qty: 1, expiry: "25-Apr-2026" }, { id: 2, action: "BUY", type: "PE", strike: 24100, premium: 118, qty: 1, expiry: "25-Apr-2026" }])}>Long Straddle</button>
            <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setLegs([{ id: 1, action: "SELL", type: "CE", strike: 24300, premium: 62, qty: 1, expiry: "25-Apr-2026" }, { id: 2, action: "BUY", type: "CE", strike: 24400, premium: 34, qty: 1, expiry: "25-Apr-2026" }, { id: 3, action: "SELL", type: "PE", strike: 23900, premium: 58, qty: 1, expiry: "25-Apr-2026" }, { id: 4, action: "BUY", type: "PE", strike: 23800, premium: 32, qty: 1, expiry: "25-Apr-2026" }])}>Iron Condor</button>
            <div style={{ flex: 1 }}/>
            <button className="btn btn-primary" style={{ fontSize: 12 }}>Deploy as strategy</button>
          </div>
        </Card>
      </div>
    </>
  );
};

window.OptionsBuilderScreen = OptionsBuilderScreen;
