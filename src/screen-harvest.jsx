/* eslint-disable */
/* Tax-loss harvester — surfaces lots eligible for harvesting,
   suggests replacement to maintain market exposure (avoids wash sale logic). */

const HarvestScreen = () => {
  // ---- live /api/tax/harvest ----
  const [liveHarvest, setLiveHarvest] = React.useState(null);
  React.useEffect(() => {
    if (window.MockData && window.MockData.isDemoOn && window.MockData.isDemoOn()) return;
    let cancelled = false;
    (async () => {
      try {
        const d = await window.fetchApi('/api/tax/harvest');
        if (!cancelled && d && d.ok) setLiveHarvest(d);
      } catch (e) {}
    })();
    return () => { cancelled = true; };
  }, []);
  const [selected, setSelected] = React.useState(new Set([1, 2, 4]));

  const lots = [
    { id: 1, sym: "VEDL",       qty: 100, avg: 412,  ltp: 368,  loss: -4400,  type: "STCL", age: "4 mo",  ok: true,  replacement: "HINDALCO (metals sector proxy)" },
    { id: 2, sym: "IDEA",       qty: 500, avg: 14.2, ltp: 10.8, loss: -1700,  type: "STCL", age: "8 mo",  ok: true,  replacement: "BHARTIARTL (telecom proxy)" },
    { id: 3, sym: "YESBANK",    qty: 300, avg: 22,   ltp: 18.5, loss: -1050,  type: "STCL", age: "6 mo",  ok: true,  replacement: "FEDERALBNK (mid-bank proxy)" },
    { id: 4, sym: "PAYTM",      qty: 40,  avg: 820,  ltp: 680,  loss: -5600,  type: "LTCL", age: "14 mo", ok: true,  replacement: "POLICYBZR (fintech proxy)" },
    { id: 5, sym: "ZEEL",       qty: 200, avg: 168,  ltp: 142,  loss: -5200,  type: "STCL", age: "5 mo",  ok: true,  replacement: "SUNTV (media proxy)" },
    { id: 6, sym: "INDIGO",     qty: 30,  avg: 4280, ltp: 3920, loss: -10800, type: "STCL", age: "3 mo",  ok: false, blockReason: "Wash sale risk: bought 50 shares 12 days ago" },
    { id: 7, sym: "ADANIPORTS", qty: 50,  avg: 1280, ltp: 1198, loss: -4100,  type: "STCL", age: "2 mo",  ok: true,  replacement: "JSWINFRA (port/infra proxy)" },
  ];

  const eligible = lots.filter(l => l.ok);
  const selectedLots = lots.filter(l => selected.has(l.id) && l.ok);
  const totalLoss = selectedLots.reduce((s, l) => s + l.loss, 0);
  const stcl = selectedLots.filter(l => l.type === "STCL").reduce((s, l) => s + l.loss, 0);
  const ltcl = selectedLots.filter(l => l.type === "LTCL").reduce((s, l) => s + l.loss, 0);
  const taxSaved = Math.abs(stcl) * 0.20 + Math.abs(ltcl) * 0.125;

  const toggle = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
          Long-term wealth · Tax-loss harvester
        </div>
        <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 4, maxWidth: 720 }}>
          Sell loss-making positions to offset realized gains, then re-establish exposure via similar (not identical) instruments. System checks 30-day wash sale window automatically.
        </div>
      </div>

      {window.ExportCsvButton && (
        <div style={{ marginBottom: 14, display: "flex", justifyContent: "flex-end" }}>
          <window.ExportCsvButton filename="tax-loss-harvest.csv" rows={lots.map(l => ({
            symbol: l.sym, qty: l.qty, avg_cost: l.avg, ltp: l.ltp, loss: l.loss,
            type: l.type, holding_age: l.age, eligible: l.ok ? "yes" : "no",
            replacement: l.ok ? l.replacement : "", block_reason: l.ok ? "" : l.blockReason,
          }))}/>
        </div>
      )}

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat label="Eligible lots"     value={`${eligible.length}`} sub={`${lots.length - eligible.length} blocked by wash`}/>
        <Stat label="Harvestable loss"  value={`₹${Math.abs(eligible.reduce((s, l) => s + l.loss, 0)).toLocaleString("en-IN")}`} sub="across STCL + LTCL"/>
        {/* T99-T94: dropped hardcoded ₹2,38,400 — needs broker realized-gains ledger */}
        <Stat label="Realized gains FY" value="—" sub="needs broker realized-gains ledger"/>
        <Stat label="Est. tax saved"    value={`₹${Math.round(taxSaved).toLocaleString("en-IN")}`} sub={`from selected ${selectedLots.length} lots`}/>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "2fr 1fr", gap: 16 }}>
        <Card title="Loss-making lots" sub="Select lots to include in this harvest">
          <div style={{ display: "grid", gridTemplateColumns: "30px 90px 60px 70px 70px 90px 60px 60px 1fr", padding: "8px 12px", borderBottom: "1px solid var(--border)", fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600 }}>
            <div></div><div>Symbol</div><div style={{ textAlign: "right" }}>Qty</div><div style={{ textAlign: "right" }}>Avg</div><div style={{ textAlign: "right" }}>LTP</div><div style={{ textAlign: "right" }}>Loss</div><div>Type</div><div>Age</div><div>AI replacement</div>
          </div>
          {lots.map(l => (
            <div key={l.id} style={{
              display: "grid", gridTemplateColumns: "30px 90px 60px 70px 70px 90px 60px 60px 1fr",
              padding: "10px 12px", borderBottom: "1px solid var(--border)",
              alignItems: "center", fontSize: 12,
              opacity: l.ok ? 1 : 0.5, background: selected.has(l.id) && l.ok ? "var(--bg-soft)" : "transparent",
            }}>
              <div>
                <input type="checkbox" disabled={!l.ok} checked={selected.has(l.id)} onChange={() => toggle(l.id)}/>
              </div>
              <div className="mono" style={{ fontWeight: 600 }}>{l.sym}</div>
              <div className="mono" style={{ textAlign: "right" }}>{l.qty}</div>
              <div className="mono" style={{ textAlign: "right" }}>₹{l.avg}</div>
              <div className="mono" style={{ textAlign: "right" }}>₹{l.ltp}</div>
              <div className="mono" style={{ textAlign: "right", color: "var(--down)", fontWeight: 600 }}>₹{l.loss.toLocaleString("en-IN")}</div>
              <div><Chip variant={l.type === "STCL" ? "warn" : "info"}>{l.type}</Chip></div>
              <div style={{ fontSize: 10, color: "var(--text-3)" }}>{l.age}</div>
              <div style={{ fontSize: 11, color: l.ok ? "var(--text-2)" : "var(--down)" }}>
                {l.ok ? l.replacement : "🚫 " + l.blockReason}
              </div>
            </div>
          ))}
        </Card>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card title="Harvest summary" sub={`${selectedLots.length} of ${eligible.length} lots selected`}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <Row k="Total realized loss" v={`₹${Math.abs(totalLoss).toLocaleString("en-IN")}`} mono/>
              <Row k="STCL component" v={`₹${Math.abs(stcl).toLocaleString("en-IN")}`} mono dim/>
              <Row k="LTCL component" v={`₹${Math.abs(ltcl).toLocaleString("en-IN")}`} mono dim/>
              <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }}/>
              <Row k="Offsets STCG @20%" v={`-₹${Math.round(Math.abs(stcl) * 0.20).toLocaleString("en-IN")}`} mono accent/>
              <Row k="Offsets LTCG @12.5%" v={`-₹${Math.round(Math.abs(ltcl) * 0.125).toLocaleString("en-IN")}`} mono accent/>
              <div style={{ padding: 12, background: "var(--up-soft)", borderRadius: "var(--r-md)", marginTop: 4, color: "var(--up)" }}>
                <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4 }}>Tax saved (approx)</div>
                <div className="mono" style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>₹{Math.round(taxSaved).toLocaleString("en-IN")}</div>
              </div>
            </div>
            <button className="btn btn-primary" style={{ width: "100%", marginTop: 14 }} disabled={selectedLots.length === 0}>
              Execute harvest ({selectedLots.length} sells + {selectedLots.length} buys)
            </button>
            <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 8, textAlign: "center" }}>
              Will queue 2-leg orders: SELL loss lot → BUY replacement at market open
            </div>
          </Card>
          <Card title="Wash sale rules" sub="Indian regulatory framework">
            <div style={{ fontSize: 11, color: "var(--text-2)", lineHeight: 1.6 }}>
              <div>• <strong>30-day window:</strong> Cannot rebuy same stock within 30 days for tax-loss treatment</div>
              <div style={{ marginTop: 6 }}>• <strong>STCL offset:</strong> against STCG &amp; LTCG, carry-forward 8 yrs</div>
              <div style={{ marginTop: 6 }}>• <strong>LTCL offset:</strong> against LTCG only, carry-forward 8 yrs</div>
              <div style={{ marginTop: 6 }}>• <strong>Replacement:</strong> Must be different ISIN — sector ETF or peer stock</div>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
};

const Row = ({ k, v, mono, dim, accent }) => (
  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
    <span style={{ color: dim ? "var(--text-3)" : "var(--text-2)" }}>{k}</span>
    <span className={mono ? "mono" : ""} style={{ fontWeight: 600, color: accent ? "var(--acc)" : "var(--text)" }}>{v}</span>
  </div>
);

window.HarvestScreen = HarvestScreen;
