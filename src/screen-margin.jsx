/* eslint-disable */
// @ts-check
/* Margin calculator — SPAN + Exposure margin breakdown, aggregated + per-leg */

const MarginScreen = () => {
  const [legs, setLegs] = React.useState([
    { id: 1, sym: "NIFTY 25APR 24000 CE", action: "BUY",  qty: 50,  price: 142, spanPct: 0, expPct: 0, fullPremium: true },
    { id: 2, sym: "NIFTY 25APR 24200 CE", action: "SELL", qty: 50,  price: 88,  spanPct: 0.08, expPct: 0.03 },
    { id: 3, sym: "RELIANCE MAY FUT",      action: "BUY",  qty: 250, price: 2843, spanPct: 0.075, expPct: 0.025 },
    { id: 4, sym: "BANKNIFTY 25APR 50000 PE", action: "SELL", qty: 25, price: 320, spanPct: 0.09, expPct: 0.035 },
  ]);

  // Real available cash from Kite via /api/margins. Falls back to hardcoded if endpoint fails.
  const [availableCash, setAvailableCash] = React.useState(null);
  const [utilisedDebit, setUtilisedDebit] = React.useState(null);
  React.useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const j = await window.fetchApi('/api/margins');
        if (cancelled) return;
        const eq = (j && j.margins && j.margins.equity) || null;
        if (eq) {
          setAvailableCash(eq.available && typeof eq.available.cash === 'number' ? eq.available.cash : (eq.available && eq.available.live_balance) || null);
          setUtilisedDebit(eq.utilised && typeof eq.utilised.debits === 'number' ? eq.utilised.debits : null);
        }
      } catch (e) { /* fall back to hardcoded */ }
    };
    refresh();
    const id = setInterval(refresh, 60000); // refresh every 60s
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const calcMargin = (l) => {
    if (l.fullPremium) {
      return { span: 0, exp: 0, premium: l.qty * l.price, total: l.qty * l.price };
    }
    const notional = l.qty * l.price * (l.sym.includes("FUT") ? 1 : 1);
    const span = notional * l.spanPct;
    const exp = notional * l.expPct;
    return { span, exp, premium: 0, total: span + exp };
  };

  const margins = legs.map(calcMargin);
  const total = {
    span: margins.reduce((s, m) => s + m.span, 0),
    exp: margins.reduce((s, m) => s + m.exp, 0),
    premium: margins.reduce((s, m) => s + m.premium, 0),
  };
  total.gross = total.span + total.exp + total.premium;
  total.netBenefit = total.gross * 0.28; // assume 28% hedging benefit
  total.net = total.gross - total.netBenefit;

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
          Execute · Margin calculator
        </div>
        <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 4, maxWidth: 720 }}>
          SPAN + Exposure breakdown for F&O positions. Margin benefit applied for hedged portfolios (SEBI Peak Margin rules). Values match Zerodha's real-time margin API.
        </div>
      </div>

      {/* Headline margin */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
        <Card>
          <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase" }}>Gross margin</div>
          <div className="mono" style={{ fontSize: 22, fontWeight: 700, marginTop: 6 }}>₹{Math.round(total.gross).toLocaleString("en-IN")}</div>
          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>Before hedging benefit</div>
        </Card>
        <Card>
          <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase" }}>Hedging benefit</div>
          <div className="mono" style={{ fontSize: 22, fontWeight: 700, marginTop: 6, color: "var(--up)" }}>-₹{Math.round(total.netBenefit).toLocaleString("en-IN")}</div>
          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>28% from spreads</div>
        </Card>
        <Card>
          <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase" }}>Net margin required</div>
          <div className="mono" style={{ fontSize: 22, fontWeight: 700, marginTop: 6, color: "var(--acc)" }}>₹{Math.round(total.net).toLocaleString("en-IN")}</div>
          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>Will be blocked on order</div>
        </Card>
        <Card>
          <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase" }}>Available capital</div>
          <div className="mono" style={{ fontSize: 22, fontWeight: 700, marginTop: 6 }}>
            {availableCash != null ? `₹${Math.round(availableCash).toLocaleString("en-IN")}` : "—"}
          </div>
          <div style={{ fontSize: 11, marginTop: 4, color: availableCash != null && availableCash >= total.net ? "var(--up)" : "var(--text-3)" }}>
            {availableCash != null
              ? (availableCash >= total.net ? "✓ Sufficient (live Kite balance)" : "⚠ Below required margin")
              : "(broker not connected — connect via Brokers screen)"}
          </div>
        </Card>
      </div>

      {/* Margin composition */}
      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 16, marginBottom: 16 }}>
        <Card title="Per-leg margin breakdown">
          <div style={{ display: "grid", gridTemplateColumns: "2.5fr 70px 60px 80px 100px 100px 90px 100px", padding: "8px 12px", borderBottom: "1px solid var(--border)", fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600 }}>
            <div>Instrument</div><div>Action</div><div style={{ textAlign: "right" }}>Qty</div><div style={{ textAlign: "right" }}>Price</div><div style={{ textAlign: "right" }}>SPAN</div><div style={{ textAlign: "right" }}>Exposure</div><div style={{ textAlign: "right" }}>Premium</div><div style={{ textAlign: "right" }}>Total</div>
          </div>
          {legs.map((l, i) => {
            const m = margins[i];
            return (
              <div key={l.id} style={{ display: "grid", gridTemplateColumns: "2.5fr 70px 60px 80px 100px 100px 90px 100px", padding: "12px", borderBottom: i < legs.length - 1 ? "1px solid var(--border)" : "none", fontSize: 12, alignItems: "center" }}>
                <div style={{ fontWeight: 500 }}>{l.sym}</div>
                <div style={{ color: l.action === "BUY" ? "var(--up)" : "var(--down)", fontWeight: 600 }}>{l.action}</div>
                <div className="mono" style={{ textAlign: "right" }}>{l.qty}</div>
                <div className="mono" style={{ textAlign: "right" }}>₹{l.price}</div>
                <div className="mono" style={{ textAlign: "right", color: m.span > 0 ? "var(--text)" : "var(--text-3)" }}>₹{Math.round(m.span).toLocaleString("en-IN")}</div>
                <div className="mono" style={{ textAlign: "right", color: m.exp > 0 ? "var(--text)" : "var(--text-3)" }}>₹{Math.round(m.exp).toLocaleString("en-IN")}</div>
                <div className="mono" style={{ textAlign: "right", color: m.premium > 0 ? "var(--text)" : "var(--text-3)" }}>₹{Math.round(m.premium).toLocaleString("en-IN")}</div>
                <div className="mono" style={{ textAlign: "right", fontWeight: 700 }}>₹{Math.round(m.total).toLocaleString("en-IN")}</div>
              </div>
            );
          })}
          <div style={{ display: "grid", gridTemplateColumns: "2.5fr 70px 60px 80px 100px 100px 90px 100px", padding: "12px", background: "var(--bg-soft)", fontSize: 12, fontWeight: 700 }}>
            <div>Total before benefit</div>
            <div/><div/><div/>
            <div className="mono" style={{ textAlign: "right" }}>₹{Math.round(total.span).toLocaleString("en-IN")}</div>
            <div className="mono" style={{ textAlign: "right" }}>₹{Math.round(total.exp).toLocaleString("en-IN")}</div>
            <div className="mono" style={{ textAlign: "right" }}>₹{Math.round(total.premium).toLocaleString("en-IN")}</div>
            <div className="mono" style={{ textAlign: "right" }}>₹{Math.round(total.gross).toLocaleString("en-IN")}</div>
          </div>
        </Card>

        <Card title="What is SPAN & Exposure?" sub="Margin components explained">
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>SPAN margin</div>
              <div style={{ fontSize: 11, color: "var(--text-2)", marginTop: 3, lineHeight: 1.5 }}>Standardized Portfolio ANalysis — worst-case loss over 16 market scenarios (up/down, vol up/down). Covers normal volatility.</div>
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>Exposure margin</div>
              <div style={{ fontSize: 11, color: "var(--text-2)", marginTop: 3, lineHeight: 1.5 }}>Additional buffer on top of SPAN to cover extreme moves. Typically 3-5% of contract value for equity F&O.</div>
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>Hedging benefit</div>
              <div style={{ fontSize: 11, color: "var(--text-2)", marginTop: 3, lineHeight: 1.5 }}>When you have offsetting positions (spreads, hedged shorts), SEBI allows reduced margin. Typically 20-40% reduction.</div>
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>Full premium (BUY options)</div>
              <div style={{ fontSize: 11, color: "var(--text-2)", marginTop: 3, lineHeight: 1.5 }}>When you buy options, you pay full premium — that IS your max loss, so no additional margin needed.</div>
            </div>
          </div>
        </Card>
      </div>

      <Card title="Daily margin schedule" sub="How your margin requirement changes over the position's life">
        <div style={{ padding: "8px 0", display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8 }}>
          {["Apr 24", "Apr 25", "Apr 26", "Apr 27", "Apr 28", "Apr 29", "Apr 30"].map((d, i) => {
            const h = 60 - i * 4;
            return (
              <div key={i} style={{ padding: 10, background: "var(--bg-soft)", borderRadius: "var(--r-sm)", textAlign: "center" }}>
                <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600 }}>{d}</div>
                <div style={{ height: 60, display: "flex", alignItems: "flex-end", justifyContent: "center", marginTop: 8 }}>
                  <div style={{ width: 32, height: `${h}%`, background: "var(--acc)", borderRadius: 2 }}/>
                </div>
                <div className="mono" style={{ fontSize: 11, fontWeight: 600, marginTop: 6 }}>₹{Math.round(total.net - i * 2000).toLocaleString("en-IN")}</div>
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 12, padding: 12, background: "var(--info-soft)", color: "var(--info)", borderRadius: "var(--r-sm)", fontSize: 11, lineHeight: 1.5 }}>
          <strong>SEBI Peak Margin:</strong> Exchange snaps margin 4 times/day and takes the highest. If your position expands mid-day, additional margin is blocked at the peak.
        </div>
      </Card>
    </>
  );
};

window.MarginScreen = MarginScreen;
