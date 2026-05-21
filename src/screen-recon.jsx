/* eslint-disable */
// @ts-check
/* Broker reconciliation — daily match between our books vs broker contract notes.
   Critical for tax filing and catching any order/fill/fee discrepancy. */


// T-208 (CODE-AUDIT F.5 M2.4) + T-231 (P0 FIX): visible "data unavailable" pill. Renders
// only when the primary data fetch fails. Conservative inline component
// so this commit doesn't touch shared primitives; the pattern can be
// hoisted later if it spreads to more screens.
//
// T-231: const was originally `_LoadErrPill` in all 3 files (paper/audit/recon
// were considered but only audit/recon/harvest got it). Classic <script> tags
// share top-level `const` scope -- the 2nd file to load threw SyntaxError
// "Identifier already declared", which killed the script, which left the
// screen-X global undefined, which broke app.js render with ReferenceError
// (HarvestScreen is not defined). Renamed to file-unique names. The fix
// could also use IIFE wrapping or a shared module, but renaming is the
// minimal change.
const _ReconLoadErrPill = ({ err, onRetry }) => {
  if (!err) return null;
  return (
    <div style={{
      padding: '10px 14px', marginBottom: 12, borderRadius: 6, fontSize: 12,
      background: 'color-mix(in oklab, var(--danger) 12%, transparent)',
      color: 'var(--danger)', border: '1px solid currentColor',
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <span>⚠ Could not load live data: {err}</span>
      {onRetry && (
        <button onClick={onRetry} className="btn btn--xs"
          style={{ marginLeft: 'auto', borderColor: 'currentColor', color: 'currentColor' }}>
          Retry
        </button>
      )}
    </div>
  );
};

const ReconScreen = () => {
  // ---- live /api/reconcile ----
  const [liveRecon, setLiveRecon] = React.useState(null);
  // T-208 (CODE-AUDIT F.5 M2.4): surface load failures to the user.
  const [loadErr, setLoadErr] = React.useState(null);
  React.useEffect(() => {
    if (window.MockData && window.MockData.isDemoOn && window.MockData.isDemoOn()) return;
    let cancelled = false;
    (async () => {
      try {
        const d = await window.fetchApi('/api/reconcile');
        if (!cancelled && d && d.ok) setLiveRecon(d);
      } catch (e) {
        // T-208: log AND surface to user via inline pill below header.
        console.warn('[screen-recon] error:', e && e.message);
        if (!cancelled) setLoadErr(e && e.message ? e.message : 'fetch failed');
      }
    })();
    return () => { cancelled = true; };
  }, []);
  const [date, setDate] = React.useState("2026-04-23");
  const [filter, setFilter] = React.useState("all");

  const summary = {
    ours: { trades: 42, grossPnL: 18400, fees: 624, netPnL: 17776 },
    broker: { trades: 42, grossPnL: 18400, fees: 628, netPnL: 17772 },
    matched: 40,
    mismatched: 2,
    missing: 0,
  };

  const rows = [
    { id: "OUR-8842", brokerId: "ZR-A2948372", sym: "RELIANCE",   qty: 50,  side: "BUY",  ours: 2843.50, broker: 2843.50, feeOur: 18.42, feeBk: 18.42, status: "matched" },
    { id: "OUR-8843", brokerId: "ZR-A2948373", sym: "RELIANCE",   qty: 50,  side: "SELL", ours: 2848.20, broker: 2848.20, feeOur: 18.45, feeBk: 18.45, status: "matched" },
    { id: "OUR-8844", brokerId: "ZR-A2948380", sym: "TCS",         qty: 20,  side: "BUY",  ours: 4142.80, broker: 4142.80, feeOur: 12.18, feeBk: 12.18, status: "matched" },
    { id: "OUR-8845", brokerId: "ZR-A2948381", sym: "TCS",         qty: 20,  side: "SELL", ours: 4148.60, broker: 4148.60, feeOur: 12.22, feeBk: 14.80, status: "fee-diff" },
    { id: "OUR-8846", brokerId: "ZR-A2948392", sym: "HDFCBANK",   qty: 40,  side: "BUY",  ours: 1684.20, broker: 1684.25, feeOur: 11.38, feeBk: 11.38, status: "price-diff" },
    { id: "OUR-8847", brokerId: "ZR-A2948393", sym: "HDFCBANK",   qty: 40,  side: "SELL", ours: 1686.90, broker: 1686.90, feeOur: 11.42, feeBk: 11.42, status: "matched" },
    { id: "OUR-8848", brokerId: "ZR-A2948410", sym: "NIFTY24APR24000CE", qty: 50, side: "BUY", ours: 142.80, broker: 142.80, feeOur: 8.42, feeBk: 8.42, status: "matched" },
    { id: "OUR-8849", brokerId: "ZR-A2948411", sym: "NIFTY24APR24000CE", qty: 50, side: "SELL", ours: 148.60, broker: 148.60, feeOur: 8.62, feeBk: 8.62, status: "matched" },
  ];

  const filtered = filter === "all" ? rows : rows.filter(r => filter === "mismatch" ? r.status !== "matched" : r.status === "matched");

  const diffChip = (status) => {
    if (status === "matched") return <Chip variant="up">✓ Matched</Chip>;
    if (status === "price-diff") return <Chip variant="down">Price diff</Chip>;
    if (status === "fee-diff") return <Chip variant="warn">Fee diff</Chip>;
    if (status === "missing") return <Chip variant="down">Missing</Chip>;
    return <Chip>{status}</Chip>;
  };

  return (
    <>
      <_ReconLoadErrPill err={loadErr} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 12, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
            Operations · Broker reconciliation
          </div>
          <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 4, maxWidth: 720 }}>
            Daily match between our internal trade log and Zerodha contract notes. Runs automatically at 6 PM IST after market close. Mismatches must be resolved before books are closed for the day.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input type="date" className="input" value={date} onChange={e => setDate(e.target.value)} style={{ width: 150 }}/>
          <button className="btn btn-ghost">Re-run match</button>
          <button className="btn btn-primary">Download contract note PDF</button>
        </div>
      </div>

      {/* T99-T95 banner — partially obsolete now that T-102 renders the
          live snapshot below. We keep the banner narrowed: it only fires
          when liveRecon is null (fetch failed / not loaded yet). */}
      {!liveRecon && (
        <div role="note" style={{
          padding: '8px 12px', marginBottom: 12, borderRadius: 6,
          border: '1px solid color-mix(in oklab, var(--warn, #d97706) 35%, var(--border))',
          background: 'color-mix(in oklab, var(--warn, #d97706) 8%, transparent)',
          fontSize: 12, color: 'var(--text-2)',
        }}>
          <strong>Reconciliation snapshot loading…</strong>{' '}
          The summary cards, trade rows, and mismatch banner shown below are
          demo data until /api/reconcile responds. Per-trade contract-note
          reconciliation hasn't shipped — what loads is a paper-vs-broker
          state snapshot (cash drift, holdings drift, pending orders).
        </div>
      )}

      {/* T99-T102: live /api/reconcile snapshot. Replaces the static
          demo cards as the primary view when the endpoint is reachable. */}
      {liveRecon && (
        <Card style={{ marginBottom: 16, borderColor: 'var(--accent)', borderWidth: 1 }}>
          <div className="row between" style={{ marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                Live reconciliation · {liveRecon.brokerName || 'broker'}
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                as of {liveRecon.asOf ? new Date(liveRecon.asOf).toLocaleString('en-IN') : '—'}
                {liveRecon.killSwitch ? ' · kill switch ENGAGED' : ''}
                {liveRecon.brokerStalledOnToken ? ' · broker token stale' : ''}
              </div>
            </div>
            <Pill kind={liveRecon.summary && liveRecon.summary.holdingsDrifts > 0 ? 'warn' : 'up'} dot>
              {liveRecon.summary && liveRecon.summary.holdingsDrifts > 0 ? `${liveRecon.summary.holdingsDrifts} drift` : 'aligned'}
            </Pill>
          </div>
          <div className="grid grid-4" style={{ gap: 12 }}>
            <div>
              <div className="muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4 }}>Cash · paper</div>
              <div className="mono" style={{ fontSize: 16, fontWeight: 700, marginTop: 4 }}>
                {liveRecon.cash && liveRecon.cash.paper != null ? '₹' + Math.round(liveRecon.cash.paper).toLocaleString('en-IN') : '—'}
              </div>
              <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>simulator</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4 }}>Cash · broker</div>
              <div className="mono" style={{ fontSize: 16, fontWeight: 700, marginTop: 4 }}>
                {liveRecon.cash && liveRecon.cash.brokerOk && liveRecon.cash.broker != null
                  ? '₹' + Math.round(liveRecon.cash.broker).toLocaleString('en-IN')
                  : '—'}
              </div>
              <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                {liveRecon.cash && !liveRecon.cash.brokerOk ? 'broker unreachable' : 'live'}
              </div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4 }}>Drift</div>
              <div className="mono" style={{ fontSize: 16, fontWeight: 700, marginTop: 4, color: liveRecon.summary && liveRecon.summary.cashDrift !== 0 ? 'var(--warn)' : 'var(--up)' }}>
                {liveRecon.summary && liveRecon.summary.cashDrift != null
                  ? (liveRecon.summary.cashDrift >= 0 ? '+' : '') + '₹' + Math.round(liveRecon.summary.cashDrift).toLocaleString('en-IN')
                  : '—'}
              </div>
              <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>paper − broker</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4 }}>Pending orders</div>
              <div className="mono" style={{ fontSize: 16, fontWeight: 700, marginTop: 4 }}>
                {liveRecon.summary && liveRecon.summary.paperPendingCnt != null
                  ? `${liveRecon.summary.paperPendingCnt} / ${liveRecon.summary.brokerPendingCnt || 0}`
                  : '—'}
              </div>
              <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>paper / broker</div>
            </div>
          </div>
          {Array.isArray(liveRecon.holdings) && liveRecon.holdings.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div className="muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>
                Holdings ({liveRecon.holdings.length})
              </div>
              <table className="table">
                <thead><tr><th>Symbol</th><th className="num-l">Paper qty</th><th className="num-l">Broker qty</th><th className="num-l">Avg</th><th className="num-l">LTP</th></tr></thead>
                <tbody>
                  {liveRecon.holdings.slice(0, 10).map((h, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 500 }}>{h.symbol}</td>
                      <td className="num mono">{h.paperQty || 0}</td>
                      <td className="num mono">{h.brokerQty || 0}</td>
                      <td className="num mono">{h.brokerAvg ? '₹' + h.brokerAvg.toFixed(2) : '—'}</td>
                      <td className="num mono">{h.brokerLtp ? '₹' + h.brokerLtp.toFixed(2) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* Match summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
        <Card>
          <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase" }}>Trades matched</div>
          <div className="mono" style={{ fontSize: 28, fontWeight: 700, marginTop: 6, color: "var(--up)" }}>{summary.matched}<span style={{ fontSize: 14, color: "var(--text-3)", fontWeight: 500 }}> / {summary.ours.trades}</span></div>
          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>{Math.round(summary.matched / summary.ours.trades * 100)}% match rate</div>
        </Card>
        <Card>
          <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase" }}>Mismatched</div>
          <div className="mono" style={{ fontSize: 28, fontWeight: 700, marginTop: 6, color: "oklch(65% 0.13 80)" }}>{summary.mismatched}</div>
          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>Needs review before close</div>
        </Card>
        <Card>
          <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase" }}>Net PnL (ours)</div>
          <div className="mono" style={{ fontSize: 28, fontWeight: 700, marginTop: 6 }}>+₹{summary.ours.netPnL.toLocaleString("en-IN")}</div>
          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>after ₹{summary.ours.fees} fees</div>
        </Card>
        <Card>
          <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase" }}>Net PnL (broker)</div>
          <div className="mono" style={{ fontSize: 28, fontWeight: 700, marginTop: 6, color: "var(--down)" }}>+₹{summary.broker.netPnL.toLocaleString("en-IN")}</div>
          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>Diff: ₹{summary.ours.netPnL - summary.broker.netPnL} (fee undercount)</div>
        </Card>
      </div>

      {/* Trade-level match */}
      <Card title="Trade-level match" sub={`${filtered.length} trades · ${summary.mismatched} flagged for review`}>
        <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
          {["all", "mismatch", "matched"].map(f => (
            <button key={f} className={filter === f ? "btn btn-primary" : "btn btn-ghost"} style={{ fontSize: 11, padding: "4px 10px", textTransform: "capitalize" }} onClick={() => setFilter(f)}>
              {f === "all" ? `All (${rows.length})` : f === "mismatch" ? `Mismatched (${summary.mismatched})` : `Matched (${summary.matched})`}
            </button>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "120px 140px 1fr 60px 60px 100px 100px 90px 90px 110px", padding: "8px 12px", borderBottom: "1px solid var(--border)", fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600 }}>
          <div>Our ID</div><div>Broker ID</div><div>Symbol</div><div>Side</div><div style={{ textAlign: "right" }}>Qty</div><div style={{ textAlign: "right" }}>Our price</div><div style={{ textAlign: "right" }}>Broker px</div><div style={{ textAlign: "right" }}>Our fee</div><div style={{ textAlign: "right" }}>Broker fee</div><div>Status</div>
        </div>
        {filtered.map((r, i) => {
          const priceOk = r.ours === r.broker;
          const feeOk = r.feeOur === r.feeBk;
          return (
            <div key={i} style={{
              display: "grid", gridTemplateColumns: "120px 140px 1fr 60px 60px 100px 100px 90px 90px 110px",
              padding: "10px 12px", borderBottom: i < filtered.length - 1 ? "1px solid var(--border)" : "none",
              alignItems: "center", fontSize: 11, background: r.status !== "matched" ? "var(--warn-soft)" : "transparent",
            }}>
              <div className="mono" style={{ color: "var(--text-3)" }}>{r.id}</div>
              <div className="mono" style={{ color: "var(--text-3)" }}>{r.brokerId}</div>
              <div style={{ fontWeight: 500 }}>{r.sym}</div>
              <div style={{ color: r.side === "BUY" ? "var(--up)" : "var(--down)", fontWeight: 600 }}>{r.side}</div>
              <div className="mono" style={{ textAlign: "right" }}>{r.qty}</div>
              <div className="mono" style={{ textAlign: "right", color: priceOk ? "var(--text)" : "var(--down)", fontWeight: priceOk ? 400 : 700 }}>{r.ours.toFixed(2)}</div>
              <div className="mono" style={{ textAlign: "right", color: priceOk ? "var(--text)" : "var(--down)", fontWeight: priceOk ? 400 : 700 }}>{r.broker.toFixed(2)}</div>
              <div className="mono" style={{ textAlign: "right", color: feeOk ? "var(--text)" : "oklch(65% 0.13 80)", fontWeight: feeOk ? 400 : 700 }}>{r.feeOur.toFixed(2)}</div>
              <div className="mono" style={{ textAlign: "right", color: feeOk ? "var(--text)" : "oklch(65% 0.13 80)", fontWeight: feeOk ? 400 : 700 }}>{r.feeBk.toFixed(2)}</div>
              <div>{diffChip(r.status)}</div>
            </div>
          );
        })}

        {summary.mismatched > 0 && (
          <div style={{ marginTop: 14, padding: 14, background: "var(--warn-soft)", color: "oklch(40% 0.12 80)", borderRadius: "var(--r-md)", fontSize: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Action required · 2 mismatches</div>
            <div style={{ lineHeight: 1.5 }}>
              <strong>OUR-8845:</strong> Fee differs by ₹2.58 — Zerodha applied additional STT on LTP-above-5%. Our calc used average, theirs used close. Update our fee model to match.<br/>
              <strong>OUR-8846:</strong> Price differs by ₹0.05 — likely a tick-size rounding issue on our snapshot. Broker fill is authoritative. Adjusting book.
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="btn btn-primary" style={{ fontSize: 11 }}>Accept broker values</button>
              <button className="btn btn-ghost" style={{ fontSize: 11 }}>Raise ticket with Zerodha</button>
            </div>
          </div>
        )}
      </Card>

      {/* 30-day recon history */}
      <div style={{ marginTop: 16 }}>
        <Card title="30-day reconciliation history" sub="Match rate trend">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(30, 1fr)", gap: 3, height: 60, alignItems: "flex-end", padding: "8px 0" }}>
            {Array.from({ length: 30 }, (_, i) => {
              const matchPct = 95 + Math.random() * 5;
              const hasIssue = Math.random() > 0.8;
              return (
                <div key={i} style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "center" }}>
                  <div style={{ width: "100%", height: `${matchPct - 90}%`, minHeight: 20, background: hasIssue ? "oklch(65% 0.13 80)" : "var(--up)", borderRadius: 2 }} title={`Day ${i+1}: ${matchPct.toFixed(1)}%`}/>
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 10, color: "var(--text-3)" }}>
            <div className="mono">Mar 24</div>
            <div className="mono">Apr 8</div>
            <div className="mono">Today</div>
          </div>
          <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            <div style={{ padding: 10, background: "var(--bg-soft)", borderRadius: "var(--r-sm)" }}>
              <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase" }}>30-day avg match</div>
              <div className="mono" style={{ fontSize: 18, fontWeight: 700, marginTop: 4, color: "var(--up)" }}>98.4%</div>
            </div>
            <div style={{ padding: 10, background: "var(--bg-soft)", borderRadius: "var(--r-sm)" }}>
              <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase" }}>Issues resolved</div>
              <div className="mono" style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>14 / 14</div>
            </div>
            <div style={{ padding: 10, background: "var(--bg-soft)", borderRadius: "var(--r-sm)" }}>
              <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase" }}>Avg resolution time</div>
              <div className="mono" style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>18 min</div>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
};

window.ReconScreen = ReconScreen;
