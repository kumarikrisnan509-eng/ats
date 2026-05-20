/* eslint-disable */
/* Order Audit Trail — every order's full lifecycle: signal → decision → submit → fills → settlement.
   Filterable, exportable, immutable. Required for SEBI compliance + post-mortem. */


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
const _AuditLoadErrPill = ({ err, onRetry }) => {
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

const AuditScreen = () => {
  // ---- live /api/audit ----
  const [liveAudit, setLiveAudit] = React.useState(null);
  // T-208 (CODE-AUDIT F.5 M2.4): surface load failures to the user.
  const [loadErr, setLoadErr] = React.useState(null);
  React.useEffect(() => {
    if (window.MockData && window.MockData.isDemoOn && window.MockData.isDemoOn()) return;
    let cancelled = false;
    (async () => {
      try {
        const d = await window.fetchApi('/api/audit?limit=50');
        if (!cancelled && d && d.ok) setLiveAudit(d);
      } catch (e) {
        // T-208: log AND surface to user via inline pill below header.
        console.warn('[screen-audit] error:', e && e.message);
        if (!cancelled) setLoadErr(e && e.message ? e.message : 'fetch failed');
      }
    })();
    return () => { cancelled = true; };
  }, []);
  const [filter, setFilter] = window.useUrlState ? window.useUrlState("status", "all") : React.useState("all");
  const [search, setSearch] = window.useUrlState ? window.useUrlState("q", "") : React.useState("");
  const [selected, setSelected] = React.useState(null);
  const [dateRange, setDateRange] = window.useUrlState ? window.useUrlState("range", "today") : React.useState("today");

  // Sample audit records — in production, immutable append-only log from order-engine
  const __mock_records = React.useMemo(() => [
    {
      id: "ORD-2026-04-24-001847", symbol: "HDFCBANK", side: "BUY", qty: 50, price: 1718.40,
      product: "MIS", mode: "intraday", strategy: "Momentum AI v3", status: "FILLED",
      pnl: +1240, fillTime: "10:42:18", broker: "Zerodha",
      events: [
        { t: "10:41:52.341", ev: "SIGNAL_RECEIVED",  detail: "Claude Opus 4.6 → BUY HDFCBANK conf=82%, target=1735, sl=1708" },
        { t: "10:41:52.412", ev: "RISK_CHECK",       detail: "Per-trade=1.2% ✓  Mode-cap=45%→48% ✓  Daily-loss=-0.4% ✓" },
        { t: "10:41:52.489", ev: "PRE_TRADE_SIM",    detail: "Margin=₹17,184 · Slip est=₹0.85 · Cost est=₹22.40" },
        { t: "10:41:52.501", ev: "ORDER_SUBMITTED",  detail: "Zerodha API · order_id=240424001847 · LIMIT 1718.40 × 50" },
        { t: "10:41:52.890", ev: "ORDER_ACK",        detail: "Exchange ack · NSE eq · queue position 4" },
        { t: "10:42:18.124", ev: "FILL_PARTIAL",     detail: "30 @ 1718.40 · ₹51,552" },
        { t: "10:42:18.456", ev: "FILL_COMPLETE",    detail: "20 @ 1718.45 · ₹34,369 · total avg=1718.42" },
        { t: "10:42:18.512", ev: "POSITION_OPENED",  detail: "Long 50 HDFCBANK · trail SL armed at 1708.00" },
        { t: "11:18:34.221", ev: "EXIT_TRIGGERED",   detail: "Target hit 1735.20 · auto-exit by Momentum AI v3" },
        { t: "11:18:34.890", ev: "POSITION_CLOSED",  detail: "Realized P&L: +₹1,240 (+1.44%)" },
      ],
    },
    {
      id: "ORD-2026-04-24-001852", symbol: "RELIANCE", side: "BUY", qty: 25, price: 2887.40,
      product: "MIS", mode: "intraday", strategy: "Mean Reversion ML", status: "REJECTED",
      pnl: 0, fillTime: "10:48:02", broker: "Zerodha",
      events: [
        { t: "10:47:58.102", ev: "SIGNAL_RECEIVED",  detail: "GPT-5 → BUY RELIANCE conf=68%" },
        { t: "10:47:58.198", ev: "RISK_CHECK",       detail: "BLOCKED: Mode-cap would breach (95%→103%)" },
        { t: "10:47:58.201", ev: "ORDER_REJECTED",   detail: "rejection_reason=mode_cap_exceeded · no broker call made" },
      ],
    },
    {
      id: "ORD-2026-04-24-001856", symbol: "BANKNIFTY 24APR 53000 CE", side: "SELL", qty: 30, price: 412.50,
      product: "NRML", mode: "options", strategy: "Iron Condor weekly", status: "FILLED",
      pnl: +2850, fillTime: "11:02:14", broker: "Zerodha",
      events: [
        { t: "11:02:11.234", ev: "SIGNAL_RECEIVED",  detail: "Strategy logic → leg 1/4 of iron condor" },
        { t: "11:02:11.298", ev: "RISK_CHECK",       detail: "Margin block ₹98,400 within ₹4.5L options cap ✓" },
        { t: "11:02:11.412", ev: "ORDER_SUBMITTED",  detail: "Zerodha · LIMIT 412.50 × 30 · IOC" },
        { t: "11:02:14.221", ev: "FILL_COMPLETE",    detail: "30 @ 412.50 · premium received ₹12,375" },
        { t: "11:02:14.290", ev: "POSITION_OPENED",  detail: "Short 30 lot · combined with 3 other legs" },
      ],
    },
    {
      id: "ORD-2026-04-24-001861", symbol: "INFY", side: "SELL", qty: 40, price: 1876.25,
      product: "MIS", mode: "swing", strategy: "Trend follow weekly", status: "FILLED",
      pnl: -680, fillTime: "11:34:55", broker: "Zerodha",
      events: [
        { t: "11:34:52.001", ev: "SIGNAL_RECEIVED",  detail: "Gemini 2.5 → SELL signal weekly trend reversal" },
        { t: "11:34:52.089", ev: "RISK_CHECK",       detail: "All caps within limits ✓" },
        { t: "11:34:52.234", ev: "ORDER_SUBMITTED",  detail: "Zerodha · MARKET 40" },
        { t: "11:34:55.001", ev: "FILL_COMPLETE",    detail: "40 @ 1876.10 · slippage -₹6 vs estimate" },
        { t: "11:34:55.089", ev: "POSITION_CLOSED",  detail: "Realized P&L: -₹680 (existing long, swing exit)" },
      ],
    },
    {
      id: "ORD-2026-04-24-001875", symbol: "NIFTY 25APR 24800 PE", side: "BUY", qty: 50, price: 78.40,
      product: "NRML", mode: "options", strategy: "Long Put protection", status: "PENDING",
      pnl: 0, fillTime: "—", broker: "Zerodha",
      events: [
        { t: "12:18:42.001", ev: "SIGNAL_RECEIVED",  detail: "Claude Sonnet 4.6 → hedge VIX-driven entry" },
        { t: "12:18:42.089", ev: "RISK_CHECK",       detail: "Margin=₹3,920 ✓" },
        { t: "12:18:42.198", ev: "ORDER_SUBMITTED",  detail: "Zerodha · LIMIT 78.40 × 50 · GTT" },
        { t: "12:18:42.412", ev: "ORDER_ACK",        detail: "Working in market · queue position 12" },
      ],
    },
  ], []);
  const records = React.useMemo(() => {
    if (liveAudit && Array.isArray(liveAudit.entries) && liveAudit.entries.length > 0) {
      return liveAudit.entries.slice(0, 100).map((e, i) => ({
        id: 'A-' + (e.seq || i),
        time: e.ts ? new Date(e.ts).toLocaleString('en-IN') : '',
        kind: e.event || 'event',
        symbol: (e.data && (e.data.symbol || e.data.sym)) || '-',
        side: (e.data && e.data.side) || '',
        status: 'live',
        details: JSON.stringify(e.data || {}).slice(0, 200),
        live: true,
      }));
    }
    // T99-T75: production users with no audit data see an empty list (and
    // empty-state UI below), not 5 fake orders with fake P&L that would
    // look like their own trade history. Demo mode keeps the rich mocks.
    const _isDemo = window.MockData && window.MockData.isDemoOn && window.MockData.isDemoOn();
    return _isDemo ? __mock_records : [];
  }, [liveAudit]);


  // R9 — Saved views: persists filter + search + dateRange between visits
  const savedViews = window.useSavedViews ? window.useSavedViews("audit", { filter: "all", search: "", dateRange: "today" }) : null;
  const applyView = (f) => { if (!f) return; setFilter(f.filter); setSearch(f.search); setDateRange(f.dateRange); };
  React.useEffect(() => {
    if (savedViews) savedViews.updateCurrent({ filter, search, dateRange });
  }, [filter, search, dateRange]);

  const filtered = records.filter(r => {
    if (filter !== "all" && r.status.toLowerCase() !== filter) return false;
    if (search && !r.symbol.toLowerCase().includes(search.toLowerCase()) && !r.id.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const counts = {
    all: records.length,
    filled: records.filter(r => r.status === "FILLED").length,
    pending: records.filter(r => r.status === "PENDING").length,
    rejected: records.filter(r => r.status === "REJECTED").length,
  };

  return (
    <>
      <_AuditLoadErrPill err={loadErr} />
      <div className="page-header">
        <div>
          <h1 className="page-header__title">Order audit trail</h1>
          <div className="page-header__sub">Immutable order lifecycle log · SEBI requirement for algo trading · {window.istNow().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })}</div>
        </div>
        <div className="page-header__right">
          <button className="btn" onClick={() => window.csvDownload && window.csvDownload("audit-trail.csv", filtered.map(r => ({
            order_id: r.id, symbol: r.symbol, side: r.side, qty: r.qty, price: r.price,
            product: r.product, mode: r.mode, strategy: r.strategy, status: r.status,
            pnl: r.pnl, fill_time: r.fillTime, broker: r.broker,
          })))}><I.code size={14}/> Export CSV</button>
          <button className="btn btn--primary"><I.shield size={14}/> Send to SEBI inbox</button>
        </div>
      </div>

      {window.SavedViewsBar && savedViews && (
        <div style={{ marginBottom: 14 }}>
          <window.SavedViewsBar hook={savedViews} onPickFilters={applyView}/>
        </div>
      )}

      <div className="grid grid-4" style={{ marginBottom: 18 }}>
        {[
          { l: "Today's orders",  v: records.length, sub: records.length ? "across all modes" : "no orders yet" },
          { l: "Fill rate",       v: records.length ? Math.round((counts.filled / records.length) * 100) + "%" : "—",  sub: records.length ? `${counts.filled} of ${records.length} filled` : "—", kind: "up" },
          // T99-T103: dropped hardcoded '0.4 bps' — needs per-order slippage from audit events
          { l: "Avg slippage",    v: "—", sub: "needs per-order slippage calc" },
          { l: "Risk blocks",     v: counts.rejected, sub: "auto-rejected before broker call", kind: counts.rejected > 0 ? "warn" : undefined },
        ].map((s, i) => (
          <div key={i} className="card">
            <div className="stat">
              <div className="stat__label">{s.l}</div>
              <div className={"stat__value stat__value--sm " + (s.kind || "")}>{s.v}</div>
              <div className="muted" style={{ fontSize: 11 }}>{s.sub}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="card card--flush">
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div className="segmented">
            {[
              { id: "all",      l: `All · ${counts.all}` },
              { id: "filled",   l: `Filled · ${counts.filled}` },
              { id: "pending",  l: `Pending · ${counts.pending}` },
              { id: "rejected", l: `Rejected · ${counts.rejected}` },
            ].map(t => (
              <button key={t.id} className={filter === t.id ? "on" : ""} onClick={() => setFilter(t.id)}>{t.l}</button>
            ))}
          </div>
          <div className="segmented">
            {["today", "7d", "30d", "all"].map(d => (
              <button key={d} className={dateRange === d ? "on" : ""} onClick={() => setDateRange(d)}>{d}</button>
            ))}
          </div>
          <input
            placeholder="Search by symbol or order ID…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 200, padding: "7px 12px", border: "1px solid var(--border)", borderRadius: "var(--r-md)", fontSize: 12, background: "var(--bg-soft)", outline: "none" }}
          />
        </div>

        <table className="table">
          <thead>
            <tr>
              <th>Order ID</th>
              <th>Symbol</th>
              <th>Mode</th>
              <th>Strategy</th>
              <th className="num">Qty</th>
              <th className="num">Price</th>
              <th className="num">P&L</th>
              <th>Status</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
                  <div style={{ fontSize: 24, marginBottom: 8 }}>📋</div>
                  <div style={{ fontWeight: 500, marginBottom: 4, color: 'var(--text-2)' }}>No audit records yet</div>
                  <div style={{ fontSize: 12 }}>
                    Trades, fills, rejections, and signals will appear here as they happen.
                    Audit data comes from /api/audit (append-only signed log).
                  </div>
                </td>
              </tr>
            )}
            {filtered.map(r => {
              const mode = window.MODE_META[r.mode];
              return (
                <tr key={r.id} onClick={() => setSelected(r)} style={{ cursor: "pointer" }}>
                  <td className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{r.id.slice(-10)}</td>
                  <td><strong>{r.symbol}</strong> <span className="pill" style={{ fontSize: 10, marginLeft: 4 }}>{r.side}</span></td>
                  <td>
                    {mode && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12 }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: mode.color }}/>
                        {mode.label}
                      </span>
                    )}
                  </td>
                  <td style={{ fontSize: 12 }}>{r.strategy}</td>
                  <td className="num">{r.qty}</td>
                  <td className="num">₹{r.price.toFixed(2)}</td>
                  <td className={"num " + (r.pnl > 0 ? "up" : r.pnl < 0 ? "down" : "muted")}>
                    {r.pnl === 0 ? "—" : (r.pnl > 0 ? "+" : "") + "₹" + Math.abs(r.pnl).toLocaleString("en-IN")}
                  </td>
                  <td>
                    <span className={"pill " + (
                      r.status === "FILLED" ? "pill--up" :
                      r.status === "PENDING" ? "pill--info" :
                      "pill--down"
                    )} style={{ fontSize: 10 }}>
                      <span className="pill__dot"/> {r.status}
                    </span>
                  </td>
                  <td className="mono" style={{ fontSize: 11 }}>{r.fillTime}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && window.EmptyFilter && (
          <window.EmptyFilter onClear={() => { setFilter("all"); setSearch(""); setDateRange("today"); }}/>
        )}
      </div>

      {/* Detail drawer */}
      {selected && (
        <>
          <div onClick={() => setSelected(null)} style={{
            position: "fixed", inset: 0, zIndex: 100,
            background: "color-mix(in oklab, var(--text) 30%, transparent)",
          }}/>
          <div style={{
            position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 101,
            width: "min(560px, 100vw)", background: "var(--surface)",
            borderLeft: "1px solid var(--border)",
            boxShadow: "-12px 0 32px -8px oklch(0% 0 0 / 0.2)",
            display: "flex", flexDirection: "column",
          }}>
            <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
              <div>
                <div style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{selected.id}</div>
                <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>{selected.side} {selected.qty} {selected.symbol}</div>
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  {selected.strategy} · {selected.broker} · {selected.product}
                </div>
              </div>
              <button className="iconbtn" onClick={() => setSelected(null)}>×</button>
            </div>
            <div style={{ padding: 24, overflowY: "auto", flex: 1 }}>
              <div style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 }}>Lifecycle events</div>
              <div style={{ position: "relative", paddingLeft: 24 }}>
                <div style={{ position: "absolute", left: 7, top: 8, bottom: 8, width: 2, background: "var(--border)" }}/>
                {selected.events.map((e, i) => {
                  const evColor =
                    e.ev === "SIGNAL_RECEIVED"   ? "var(--info)" :
                    e.ev === "RISK_CHECK"        ? "var(--warn)" :
                    e.ev === "PRE_TRADE_SIM"     ? "var(--accent)" :
                    e.ev.startsWith("ORDER_REJ") ? "var(--down)" :
                    e.ev.startsWith("FILL")      ? "var(--up)" :
                    e.ev.startsWith("POSITION_C")? "var(--up)" :
                    "var(--text-3)";
                  return (
                    <div key={i} style={{ marginBottom: 14, position: "relative" }}>
                      <div style={{
                        position: "absolute", left: -24, top: 4,
                        width: 16, height: 16, borderRadius: "50%",
                        background: evColor,
                        border: "3px solid var(--surface)",
                      }}/>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                        <span style={{ fontSize: 12, fontWeight: 600 }}>{e.ev}</span>
                        <span className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>{e.t}</span>
                      </div>
                      <div className="mono" style={{ fontSize: 11, color: "var(--text-2)", marginTop: 3, lineHeight: 1.5 }}>{e.detail}</div>
                    </div>
                  );
                })}
              </div>

              <div style={{ marginTop: 24, padding: 14, background: "var(--bg-soft)", borderRadius: "var(--r-md)" }}>
                <div className="between" style={{ marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: "var(--text-3)" }}>SHA-256 audit hash</span>
                  <span className="pill pill--up" style={{ fontSize: 10 }}>VERIFIED</span>
                </div>
                <div className="mono" style={{ fontSize: 10, wordBreak: "break-all", color: "var(--text-2)" }}>
                  a3f9c2e8d4b71625a8f0e3d9c1b27485e6a9f2c4d1e7b58a3f6c9e2d5b8a14c
                </div>
              </div>
            </div>
            <div style={{ padding: 16, borderTop: "1px solid var(--border)", display: "flex", gap: 8 }}>
              <button className="btn" style={{ flex: 1 }}>Re-run risk check</button>
              <button className="btn" style={{ flex: 1 }}>Replay in paper</button>
              <button className="btn btn--primary" style={{ flex: 1 }}>Download JSON</button>
            </div>
          </div>
        </>
      )}
    </>
  );
};

window.AuditScreen = AuditScreen;
