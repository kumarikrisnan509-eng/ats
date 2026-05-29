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
// T-451 (audit-2026-05-26 frontend M8): alias for window.LoadError.
// See screen-audit.jsx for full rationale. Local name kept for call-site
// stability; behaviour now comes from the shared primitive.
const _ReconLoadErrPill = (props) => (window.LoadError ? window.LoadError(props) : null);

// Original implementation kept below as a fallback in case primitives.jsx
// hasn't loaded yet (script ordering). Will be removed in a future cleanup.
const _ReconLoadErrPill_legacy = ({ err, onRetry }) => {
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
  const _isDemo = !!(window.MockData && window.MockData.isDemoOn && window.MockData.isDemoOn());

  // Live paper-vs-broker STATE snapshot (cash / holdings / pending-order drift).
  const [liveRecon, setLiveRecon] = React.useState(/** @type {any} */ (null));
  const [loadErr, setLoadErr] = React.useState(/** @type {any} */ (null));

  // T-554: real TRADE-LEVEL reconciliation (per-user) + 30-day trade history.
  const _todayIST = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const [date, setDate] = React.useState(_todayIST);
  const [tradeRecon, setTradeRecon] = React.useState(/** @type {any} */ (null));
  const [hist, setHist] = React.useState(/** @type {any} */ (null));
  const [filter, setFilter] = React.useState("all");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (_isDemo) return;
    let cancelled = false;
    (async () => {
      try {
        const d = await window.fetchApi("/api/reconcile");
        if (!cancelled && d && d.ok) setLiveRecon(d);
      } catch (e) {
        console.warn("[screen-recon] error:", e && e.message);
        if (!cancelled) setLoadErr(e && e.message ? e.message : "fetch failed");
      }
    })();
    return () => { cancelled = true; };
  }, [_isDemo]);

  const loadTrades = React.useCallback(async (forDate) => {
    if (_isDemo) return;
    setBusy(true);
    try {
      const d = await window.fetchApi("/api/me/reconcile/trades?date=" + encodeURIComponent(forDate));
      if (d && d.ok) setTradeRecon(d);
    } catch (e) {
      setLoadErr(e && e.message ? e.message : "fetch failed");
    } finally { setBusy(false); }
  }, [_isDemo]);

  React.useEffect(() => { loadTrades(date); }, [date, loadTrades]);

  React.useEffect(() => {
    if (_isDemo) return;
    let cancelled = false;
    (async () => {
      try {
        const d = await window.fetchApi("/api/me/reconcile/history?days=30");
        if (!cancelled && d && d.ok) setHist(d);
      } catch (_e) { /* history is non-critical */ }
    })();
    return () => { cancelled = true; };
  }, [_isDemo]);

  // Demo fixtures render only in demo mode; live mode uses real per-user data.
  const _demoRows = [
    { id: "OUR-8844", brokerId: "ZR-A2948380", sym: "TCS", side: "BUY", qty: 20, ours: 4142.80, broker: 4142.80, feeOur: 12.18, feeBk: 12.18, status: "matched" },
    { id: "OUR-8845", brokerId: "ZR-A2948381", sym: "TCS", side: "SELL", qty: 20, ours: 4148.60, broker: 4148.60, feeOur: 12.22, feeBk: 14.80, status: "fee-diff" },
    { id: "OUR-8846", brokerId: "ZR-A2948392", sym: "HDFCBANK", side: "BUY", qty: 40, ours: 1684.20, broker: 1684.25, feeOur: 11.38, feeBk: 11.38, status: "price-diff" },
  ];
  const rows = _isDemo ? _demoRows : ((tradeRecon && Array.isArray(tradeRecon.rows)) ? tradeRecon.rows : []);
  const reconcilable = _isDemo ? true : !!(tradeRecon && tradeRecon.reconcilable);
  const sum = _isDemo
    ? { ourTrades: 3, brokerTrades: 3, matched: 1, mismatched: 2 }
    : ((tradeRecon && tradeRecon.summary) ? tradeRecon.summary : { ourTrades: 0, brokerTrades: 0, matched: 0, mismatched: 0 });

  const MISMATCH = ["price-diff", "qty-diff", "fee-diff", "missing-broker", "missing-ours"];
  const filtered = filter === "all" ? rows
    : filter === "mismatch" ? rows.filter((r) => MISMATCH.indexOf(r.status) >= 0)
    : rows.filter((r) => r.status === "matched");

  const px = (v) => (v == null ? "—" : Number(v).toFixed(2));
  const diffChip = (status) => {
    if (status === "matched") return <Chip variant="up">✓ Matched</Chip>;
    if (status === "price-diff") return <Chip variant="down">Price diff</Chip>;
    if (status === "qty-diff") return <Chip variant="down">Qty diff</Chip>;
    if (status === "fee-diff") return <Chip variant="warn">Fee diff</Chip>;
    if (status === "missing-broker") return <Chip variant="down">Missing @ broker</Chip>;
    if (status === "missing-ours") return <Chip variant="down">Broker only</Chip>;
    if (status === "unreconciled") return <Chip>Unreconciled</Chip>;
    return <Chip>{status}</Chip>;
  };

  const exportCsv = () => {
    const hdr = ["Our ID", "Broker ID", "Symbol", "Side", "Qty", "Our price", "Broker price", "Our fee", "Broker fee", "Status"];
    const esc = (x) => {
      const v = (x == null ? "" : String(x));
      return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    const lines = [hdr.join(",")];
    for (const r of rows) lines.push([r.id, r.brokerId, r.sym, r.side, r.qty, r.ours, r.broker, r.feeOur, r.feeBk, r.status].map(esc).join(","));
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "reconciliation-" + date + ".csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    if (window.toast) window.toast("Reconciliation exported (" + rows.length + " rows)", "info");
  };

  const histRows = (hist && Array.isArray(hist.rows)) ? hist.rows : [];
  const histMax = histRows.reduce((mx, r) => Math.max(mx, r.trades || 0), 0);
  const histSum = (hist && hist.summary) ? hist.summary : null;

  return (
    <>
      <_ReconLoadErrPill err={loadErr} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 12, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600, margin: 0 }}>
            Operations · Broker reconciliation
          </h2>
          <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 4, maxWidth: 720 }}>
            Daily match between your executed trades and the broker contract note. With a live broker connected each trade is matched on symbol/side/qty/price; in paper mode your simulated fills are listed for review (no broker note to match against).
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input type="date" value={date} max={_todayIST} onChange={(e) => setDate(e.target.value)} style={{ width: 150, padding: "4px 8px", fontSize: 13, background: "var(--bg)", color: "var(--text-1)", border: "1px solid var(--border)", borderRadius: 4 }} />
          <button className="btn btn-ghost" disabled={busy} onClick={() => loadTrades(date)}>{busy ? "Matching…" : "Re-run match"}</button>
          <button className="btn btn-primary" disabled={!rows.length} title={rows.length ? "Export the reconciliation table as CSV" : "No trades to export"} onClick={exportCsv}>Export CSV</button>
        </div>
      </div>

      {liveRecon && (
        <Card style={{ marginBottom: 16, borderColor: 'var(--accent)', borderWidth: 1 }}>
          <div className="row between" style={{ marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                Live state · {liveRecon.brokerName || 'broker'}
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
        </Card>
      )}

      {!_isDemo && tradeRecon && !reconcilable && tradeRecon.note && (
        <div role="note" style={{
          padding: '8px 12px', marginBottom: 12, borderRadius: 6,
          border: '1px solid color-mix(in oklab, var(--warn, #d97706) 35%, var(--border))',
          background: 'color-mix(in oklab, var(--warn, #d97706) 8%, transparent)',
          fontSize: 12, color: 'var(--text-2)',
        }}>
          {tradeRecon.note}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
        <Card>
          <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase" }}>Your trades</div>
          <div className="mono" style={{ fontSize: 28, fontWeight: 700, marginTop: 6 }}>{sum.ourTrades}</div>
          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>executed on {date}</div>
        </Card>
        <Card>
          <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase" }}>Broker trades</div>
          <div className="mono" style={{ fontSize: 28, fontWeight: 700, marginTop: 6 }}>{reconcilable ? sum.brokerTrades : "—"}</div>
          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>{reconcilable ? "from contract note" : "paper — none"}</div>
        </Card>
        <Card>
          <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase" }}>Matched</div>
          <div className="mono" style={{ fontSize: 28, fontWeight: 700, marginTop: 6, color: "var(--up)" }}>{reconcilable ? sum.matched : "—"}</div>
          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>{reconcilable && sum.ourTrades > 0 ? Math.round(sum.matched / sum.ourTrades * 100) + "% of yours" : "needs live broker"}</div>
        </Card>
        <Card>
          <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase" }}>Mismatched</div>
          <div className="mono" style={{ fontSize: 28, fontWeight: 700, marginTop: 6, color: sum.mismatched > 0 ? "var(--down)" : "var(--text-3)" }}>{reconcilable ? sum.mismatched : "—"}</div>
          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>needs review before close</div>
        </Card>
      </div>

      <Card title="Trade-level match" sub={`${filtered.length} shown · ${reconcilable ? sum.mismatched + " flagged" : "paper — not reconciled"}`}>
        <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
          {["all", "mismatch", "matched"].map((f) => (
            <button key={f} className={filter === f ? "btn btn-primary" : "btn btn-ghost"} style={{ fontSize: 11, padding: "4px 10px", textTransform: "capitalize" }} onClick={() => setFilter(f)}>
              {f === "all" ? `All (${rows.length})` : f === "mismatch" ? `Mismatched (${rows.filter((r) => MISMATCH.indexOf(r.status) >= 0).length})` : `Matched (${rows.filter((r) => r.status === "matched").length})`}
            </button>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "120px 140px 1fr 60px 60px 100px 100px 90px 90px 130px", padding: "8px 12px", borderBottom: "1px solid var(--border)", fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600 }}>
          <div>Our ID</div><div>Broker ID</div><div>Symbol</div><div>Side</div><div style={{ textAlign: "right" }}>Qty</div><div style={{ textAlign: "right" }}>Our price</div><div style={{ textAlign: "right" }}>Broker px</div><div style={{ textAlign: "right" }}>Our fee</div><div style={{ textAlign: "right" }}>Broker fee</div><div>Status</div>
        </div>
        {filtered.length === 0 ? (
          <div className="muted" style={{ padding: "20px 12px", fontSize: 12, textAlign: "center" }}>
            {busy ? "Loading…" : "No trades for " + date + "."}
          </div>
        ) : filtered.map((r, idx) => {
          const priceOk = r.ours != null && r.broker != null && Math.abs(Number(r.ours) - Number(r.broker)) < 0.011;
          const feeOk = r.feeOur != null && r.feeBk != null && Math.abs(Number(r.feeOur) - Number(r.feeBk)) < 0.011;
          return (
            <div key={idx} style={{
              display: "grid", gridTemplateColumns: "120px 140px 1fr 60px 60px 100px 100px 90px 90px 130px",
              padding: "10px 12px", borderBottom: idx < filtered.length - 1 ? "1px solid var(--border)" : "none",
              alignItems: "center", fontSize: 11, background: (r.status !== "matched" && r.status !== "unreconciled") ? "var(--warn-soft)" : "transparent",
            }}>
              <div className="mono" style={{ color: "var(--text-3)" }}>{r.id || "—"}</div>
              <div className="mono" style={{ color: "var(--text-3)" }}>{r.brokerId || "—"}</div>
              <div style={{ fontWeight: 500 }}>{r.sym}</div>
              <div style={{ color: r.side === "BUY" ? "var(--up)" : "var(--down)", fontWeight: 600 }}>{r.side}</div>
              <div className="mono" style={{ textAlign: "right" }}>{r.qty}</div>
              <div className="mono" style={{ textAlign: "right", color: r.broker != null && !priceOk ? "var(--down)" : "var(--text)", fontWeight: r.broker != null && !priceOk ? 700 : 400 }}>{px(r.ours)}</div>
              <div className="mono" style={{ textAlign: "right", color: r.broker != null && !priceOk ? "var(--down)" : "var(--text)", fontWeight: r.broker != null && !priceOk ? 700 : 400 }}>{px(r.broker)}</div>
              <div className="mono" style={{ textAlign: "right", color: r.feeBk != null && !feeOk ? "oklch(65% 0.13 80)" : "var(--text)" }}>{px(r.feeOur)}</div>
              <div className="mono" style={{ textAlign: "right", color: r.feeBk != null && !feeOk ? "oklch(65% 0.13 80)" : "var(--text)" }}>{px(r.feeBk)}</div>
              <div>{diffChip(r.status)}</div>
            </div>
          );
        })}
      </Card>

      <div style={{ marginTop: 16 }}>
        <Card title="30-day trade history" sub="Executed trades per day (IST)">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(30, 1fr)", gap: 3, height: 60, alignItems: "flex-end", padding: "8px 0" }}>
            {(histRows.length ? histRows : Array.from({ length: 30 }, () => ({ date: "", trades: 0 }))).slice(-30).map((r, i) => {
              const h = histMax > 0 ? Math.round((r.trades / histMax) * 100) : 0;
              return (
                <div key={i} style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "center" }}>
                  <div title={r.date ? `${r.date}: ${r.trades} trade${r.trades === 1 ? "" : "s"}` : "no data"} style={{ width: "100%", height: r.trades > 0 ? `${Math.max(12, h)}%` : "4px", minHeight: r.trades > 0 ? 12 : 2, background: r.trades > 0 ? "var(--up)" : "var(--border)", borderRadius: 2 }} />
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 10, color: "var(--text-3)" }}>
            <div className="mono">{histRows.length ? histRows[0].date : "—"}</div>
            <div className="mono">{histRows.length ? histRows[Math.floor(histRows.length / 2)].date : ""}</div>
            <div className="mono">Today</div>
          </div>
          <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            <div style={{ padding: 10, background: "var(--bg-soft)", borderRadius: "var(--r-sm)" }}>
              <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase" }}>Trades (30d)</div>
              <div className="mono" style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>{histSum ? histSum.totalTrades : "—"}</div>
            </div>
            <div style={{ padding: 10, background: "var(--bg-soft)", borderRadius: "var(--r-sm)" }}>
              <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase" }}>Active days</div>
              <div className="mono" style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>{histSum ? histSum.activeDays : "—"}</div>
            </div>
            <div style={{ padding: 10, background: "var(--bg-soft)", borderRadius: "var(--r-sm)" }}>
              <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase" }}>Mismatches (30d)</div>
              <div className="mono" style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>{histSum ? histSum.totalMismatched : "—"}</div>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
};

window.ReconScreen = ReconScreen;
