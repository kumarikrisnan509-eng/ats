/* eslint-disable */
/* Paper Trading screen — Stage 2 of the pipeline */

const PaperScreen = () => {
  const [account, setAccount] = useState("50L");
  const [, bump] = useState(0);
  React.useEffect(() => {
    const h = () => bump(n => n + 1);
    window.addEventListener("modes-changed", h);
    return () => window.removeEventListener("modes-changed", h);
  }, []);
  // ---- live paper trading state from /api/paper, /paper/positions, /paper/orders ----
  const [livePaper, setLivePaper] = React.useState(null);
  const [livePositions, setLivePositions] = React.useState(null);
  const [liveOrders, setLiveOrders] = React.useState(null);
  React.useEffect(() => {
    if (window.MockData && window.MockData.isDemoOn && window.MockData.isDemoOn()) return;
    let cancelled = false;
    (async () => {
      try {
        const [s, p, o] = await Promise.all([
          window.fetchApi('/api/paper'),
          window.fetchApi('/api/paper/positions'),
          window.fetchApi('/api/paper/orders'),
        ]);
        if (cancelled) return;
        if (s && s.ok) setLivePaper(s.stats);
        if (p && p.ok) setLivePositions(p.positions || []);
        if (o && o.ok) setLiveOrders(o.orders || o.list || []);
      } catch (e) { /* fall back to mock */ }
    })();
    return () => { cancelled = true; };
  }, []);
  const accounts = [
    { id: "10L", cap: 1000000, used: 412000, pnl: 18420,   trades: 34,  winR: 62 },
    { id: "25L", cap: 2500000, used: 1180000, pnl: 52840,  trades: 67,  winR: 66 },
    { id: "50L", cap: 5000000, used: 2140000, pnl: 148320, trades: 142, winR: 71 },
  ];
  const acc = accounts.find(a => a.id === account);

  const paperOrders = [
    { t: "14:41:08", s: "RELIANCE",   side: "BUY",  qty: 80,  req: 2948.50, fill: 2948.85, slip: 0.35, strat: "Momentum AI",   st: "filled" },
    { t: "14:32:19", s: "HDFCBANK",   side: "BUY",  qty: 50,  req: 1582.00, fill: 1582.15, slip: 0.15, strat: "Mean Rev. v2",  st: "filled" },
    { t: "14:18:44", s: "NIFTY 22500 CE", side: "BUY",  qty: 75,  req: 142.20, fill: 143.05, slip: 0.85, strat: "Iron Condor",  st: "filled" },
    { t: "13:58:02", s: "TATASTEEL", side: "SELL", qty: 200, req: 148.40, fill: 148.28, slip: 0.12, strat: "Breakout",      st: "filled" },
    { t: "13:44:30", s: "INFY",      side: "BUY",  qty: 40,  req: 1472.00, fill: 1472.00, slip: 0.00, strat: "Momentum AI",   st: "pending" },
    { t: "13:22:15", s: "SBIN",      side: "SELL", qty: 150, req: 782.50,  fill: 782.32,  slip: 0.18, strat: "Grid Trader",   st: "filled" },
  ];

  const pnlSeries = seriesRandom(9, 40, -8000, 160000, 3500);

  // Paper vs live calibration
  const paperVsLive = [
    { k: "Avg slippage",  paper: "0.08%", live: "0.14%", delta: "+0.06%", note: "Live has 1.75× more slippage" },
    { k: "Avg fill time", paper: "12ms",  live: "284ms", delta: "+272ms", note: "Broker RTT + exchange queue" },
    { k: "Rejection rate",paper: "0.2%",  live: "1.8%",  delta: "+1.6%",  note: "Margin / circuit / illiquid" },
    { k: "Partial fills",  paper: "0%",    live: "6.4%",  delta: "+6.4%",  note: "Modeled Q2 2026" },
  ];

  const Wrap = window.PaperChrome || React.Fragment;
  return (
    <>
      <Wrap>
      <div className="page-header">
        <div>
          <h1 className="page-header__title">Paper trading</h1>
          <div className="page-header__sub">Virtual capital, real market fills. Stage 2 of the pipeline — build confidence before live.</div>
        </div>
        <div className="page-header__right">
          <button className="btn"><I.refresh size={14}/> Reset account</button>
          <button className="btn btn--accent"><I.play size={14}/> Replay historical day</button>
        </div>
      </div>

      {/* Account selector + KPIs */}
      <Card style={{ marginBottom: 16 }}>
        <div className="between" style={{ marginBottom: 18 }}>
          <div className="row" style={{ gap: 12 }}>
            <div className="muted" style={{ fontSize: 12 }}>Virtual account</div>
            <Segmented value={account} onChange={setAccount}
              options={accounts.map(a => ({ value: a.id, label: "₹" + a.id }))}/>
            <Pill kind="acc" dot>Paper · identical to live layout</Pill>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>Since inception · 48 trading days</span>
          </div>
        </div>
        <div className="grid grid-4">
          <Stat label="Virtual capital" value={inrCompact(acc.cap)} delta={`${((acc.used/acc.cap)*100).toFixed(0)}% deployed`} deltaKind="muted"/>
          <Stat label="Paper P&L" value={inr(acc.pnl)} delta={pct((acc.pnl/acc.cap)*100)} deltaKind={acc.pnl >= 0 ? "up" : "down"}/>
          <Stat label="Trades" value={acc.trades} delta={`${acc.winR}% win rate`} deltaKind="muted"/>
          <Stat label="Sharpe (ann.)" value="1.84" delta="target ≥ 1.5" deltaKind="up"/>
        </div>
      </Card>

      {/* Per-mode paper activity — hierarchy roll-up */}
      <Card style={{ marginBottom: 16 }} title="Paper by mode" sub="How each mode is performing in simulation — promotion gates tracked per-mode">
        <div className="grid grid-4" style={{ gap: 10 }}>
          {window.MODE_IDS.map(id => {
            const meta = window.MODE_META[id];
            const stats = {
              intraday: { trades: 86, winR: 64, pnl: 82340,  ready: 2, testing: 1, nextPromo: "Momentum AI in 3d" },
              swing:    { trades: 22, winR: 68, pnl: 34120,  ready: 1, testing: 2, nextPromo: "Trend Follow ready" },
              options:  { trades: 18, winR: 72, pnl: 24820,  ready: 1, testing: 1, nextPromo: "Iron Condor in 5d" },
              futures:  { trades: 0,  winR: 0,  pnl: 0,      ready: 0, testing: 1, nextPromo: "NIFTY Fut started" },
            }[id];
            const active = window.isModeActive(id);
            return (
              <div key={id} style={{
                padding: 12, borderRadius: "var(--r-md)",
                borderLeft: `3px solid ${meta.color}`,
                background: meta.colorSoft,
                opacity: active ? 1 : 0.5,
              }}>
                <div className="between" style={{ marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 10, fontFamily: "var(--mono)", color: meta.color, fontWeight: 500, letterSpacing: "0.03em" }}>{meta.shortLabel}</div>
                    <div style={{ fontSize: 14, fontWeight: 500, marginTop: 1 }}>{meta.label}</div>
                  </div>
                  {!active && <Pill kind="warn">OFF</Pill>}
                </div>
                <div className="mono" style={{ fontSize: 18, fontWeight: 600, color: stats.pnl > 0 ? "var(--up)" : stats.pnl < 0 ? "var(--down)" : "var(--text-3)" }}>
                  {stats.pnl > 0 ? "+" : ""}{inr(stats.pnl)}
                </div>
                <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                  {stats.trades} trades · {stats.winR}% win
                </div>
                <div className="divider" style={{ margin: "8px 0" }}/>
                <div className="row" style={{ justifyContent: "space-between", fontSize: 11 }}>
                  <span><span className="mono" style={{ color: "var(--up)" }}>{stats.ready}</span> <span className="muted">ready</span></span>
                  <span><span className="mono" style={{ color: "var(--info)" }}>{stats.testing}</span> <span className="muted">testing</span></span>
                </div>
                <div className="muted" style={{ fontSize: 10, marginTop: 6, fontStyle: "italic" }}>{stats.nextPromo}</div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* P&L chart */}
      <div className="grid grid-2-1" style={{ marginBottom: 16 }}>
        <Card title="Paper equity curve" sub="₹ vs virtual capital baseline" right={<Segmented value="30d" onChange={()=>{}} options={["7d","30d","All"]}/>}>
          <AreaChart data={pnlSeries} height={220} color="var(--accent)" formatter={v => inrCompact(v)}
            labels={[window.daysAgo(55), window.daysAgo(40), window.daysAgo(24), window.daysAgo(9), window.TODAY_SHORT]}/>
        </Card>
        <Card title="Fill quality" sub="Paper fills are calibrated to live">
          <div className="col" style={{ gap: 14 }}>
            {paperVsLive.map((r,i) => (
              <div key={i}>
                <div className="between" style={{ marginBottom: 2 }}>
                  <div style={{ fontSize: 12, fontWeight: 500 }}>{r.k}</div>
                  <span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{r.delta}</span>
                </div>
                <div className="row" style={{ gap: 10 }}>
                  <span className="mono" style={{ fontSize: 11 }}><span style={{ color: "var(--text-3)" }}>paper </span>{r.paper}</span>
                  <span style={{ color: "var(--border-strong)" }}>·</span>
                  <span className="mono" style={{ fontSize: 11 }}><span style={{ color: "var(--text-3)" }}>live </span>{r.live}</span>
                </div>
                <div className="muted" style={{ fontSize: 10, marginTop: 2 }}>{r.note}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Paper order book + replay mode */}
      <div className="grid grid-2-1" style={{ marginBottom: 16 }}>
        <Card title="Paper order book" sub="Real bid/ask fills · Gaussian slippage model" flush>
          <table className="table">
            <thead><tr><th>Time</th><th>Symbol</th><th>Side</th><th className="num-l">Qty</th><th className="num-l">Req</th><th className="num-l">Fill</th><th className="num-l">Slip</th><th>Strategy</th><th>Status</th></tr></thead>
            <tbody>
              {paperOrders.map((o,i) => (
                <tr key={i}>
                  <td className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{o.t}</td>
                  <td style={{ fontWeight: 500 }}>{o.s}</td>
                  <td><Pill kind={o.side === "BUY" ? "up" : "down"}>{o.side}</Pill></td>
                  <td className="num">{o.qty}</td>
                  <td className="num">{o.req.toFixed(2)}</td>
                  <td className="num">{o.fill.toFixed(2)}</td>
                  <td className="num" style={{ color: o.slip > 0.3 ? "var(--warn)" : "var(--text-3)" }}>{o.slip.toFixed(2)}</td>
                  <td><span className="muted" style={{ fontSize: 12 }}>{o.strat}</span></td>
                  <td>{o.st === "filled" ? <Pill kind="up" dot>filled</Pill> : <Pill kind="info" dot>pending</Pill>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Replay mode" sub={<span>&quot;Would I have been in this trade?&quot;</span>}>
          <div className="col" style={{ gap: 14 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>Historical date</div>
              <input type="text" value={window.daysAgo(7)} readOnly style={{ width: "100%", padding: "8px 10px", background: "var(--bg-sunk)", border: "1px solid var(--border)", borderRadius: "var(--r-md)", fontFamily: "var(--mono)", fontSize: 12 }}/>
            </div>
            <div>
              <div className="between" style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4 }}>
                <span>09:15</span><span>12:30</span><span>15:30</span>
              </div>
              <div style={{ position: "relative", height: 6, background: "var(--bg-sunk)", borderRadius: 999 }}>
                <div style={{ width: "62%", height: "100%", background: "var(--accent)", borderRadius: 999 }}/>
                <div style={{ position: "absolute", left: "62%", top: -4, width: 14, height: 14, borderRadius: "50%", background: "var(--accent)", border: "2px solid var(--surface)" }}/>
              </div>
              <div className="mono" style={{ fontSize: 11, color: "var(--text-3)", marginTop: 6, textAlign: "center" }}>
                Playing · 13:22 IST · 4× speed
              </div>
            </div>
            <div style={{ padding: 10, background: "var(--bg-soft)", border: "1px solid var(--border)", borderRadius: "var(--r-md)" }}>
              <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4 }}>Signal that would have fired</div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>BUY RELIANCE @ 2946.20</div>
              <div className="mono" style={{ fontSize: 11, color: "var(--up)" }}>Outcome: +₹2,180 in 42min</div>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn--sm" style={{ flex: 1 }}><I.pause size={12}/> Pause</button>
              <button className="btn btn--sm" style={{ flex: 1 }}><I.refresh size={12}/> Restart</button>
            </div>
          </div>
        </Card>
      </div>

      {/* Promotion readiness — explicit 4-gate criteria */}
      <Card
        title="Promotion to live"
        sub="A strategy auto-promotes only when ALL 4 gates pass. Any failing gate blocks promotion."
        right={
          <div className="row" style={{ gap: 10, fontSize: 11, color: "var(--text-3)" }}>
            <span>Gates:</span>
            <span className="mono">≥14 days</span>
            <span>·</span>
            <span className="mono">≥30 trades</span>
            <span>·</span>
            <span className="mono">≥60% win</span>
            <span>·</span>
            <span className="mono">≥1.2 Sharpe</span>
          </div>
        }
        flush
      >
        <table className="table">
          <thead>
            <tr>
              <th>Strategy</th>
              <th>Mode</th>
              <th className="num-l">Days</th>
              <th className="num-l">Trades</th>
              <th className="num-l">Win %</th>
              <th className="num-l">Sharpe</th>
              <th className="num-l">Max DD</th>
              <th style={{ textAlign: "center" }}>Gates (days / trades / win / sharpe)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {[
              { n: "Momentum AI",        d: 48, t: 142, w: 71, sh: 1.84, dd: "-3.2%" },
              { n: "Mean Reversion v2",  d: 42, t:  89, w: 66, sh: 1.42, dd: "-4.8%" },
              { n: "Iron Condor Weekly", d: 45, t:  34, w: 82, sh: 2.14, dd: "-1.8%" },
              { n: "Breakout Scalper",   d: 22, t:  62, w: 58, sh: 1.10, dd: "-2.6%" },
              { n: "Covered Call",       d: 28, t:  12, w: 66, sh: 1.40, dd: "-1.2%" },
              { n: "Grid Trader",        d: 80, t: 310, w: 52, sh: 0.72, dd: "-7.2%" },
              { n: "Stock Futures Momentum", d: 22, t: 6, w: 58, sh: 1.20, dd: "-2.4%" },
            ].map((s, i) => {
              const stratMeta = window.getStrategy(s.n);
              const mode = stratMeta?.mode || "intraday";
              const modeMeta = window.MODE_META[mode];
              // 4 independent gates
              const gates = [
                { id: "days",   ok: s.d >= 14,  label: `${s.d}d`,        tip: "Min 14 paper days" },
                { id: "trades", ok: s.t >= 30,  label: `${s.t}`,         tip: "Min 30 paper trades" },
                { id: "win",    ok: s.w >= 60,  label: `${s.w}%`,        tip: "Min 60% win rate" },
                { id: "sharpe", ok: s.sh >= 1.2,label: s.sh.toFixed(2),  tip: "Min 1.2 Sharpe" },
              ];
              const allPass = gates.every(g => g.ok);
              const failingGate = gates.find(g => !g.ok);
              return (
                <tr key={i}>
                  <td style={{ fontWeight: 500 }}>{s.n}</td>
                  <td>
                    <span className="row" style={{ gap: 6 }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: modeMeta.color }}/>
                      <span className="mono" style={{ fontSize: 11, color: modeMeta.color }}>{modeMeta.shortLabel}</span>
                    </span>
                  </td>
                  <td className="num">{s.d}</td>
                  <td className="num">{s.t}</td>
                  <td className="num">{s.w}%</td>
                  <td className="num" style={{ color: s.sh >= 1.2 ? "var(--up)" : "var(--warn)" }}>{s.sh.toFixed(2)}</td>
                  <td className="num">{s.dd}</td>
                  <td>
                    <div className="row" style={{ gap: 3, justifyContent: "center" }}>
                      {gates.map(g => (
                        <span key={g.id} title={g.tip + " — " + g.label}
                          style={{
                            width: 20, height: 20, borderRadius: 4,
                            display: "grid", placeItems: "center",
                            background: g.ok ? "var(--up-soft)" : "var(--down-soft)",
                            color: g.ok ? "var(--up)" : "var(--down)",
                            fontSize: 11, fontWeight: 600,
                          }}>
                          {g.ok ? "✓" : "✕"}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>
                    {allPass ? (
                      <button className="btn btn--sm btn--primary" style={{ whiteSpace: "nowrap" }}>→ Promote to live</button>
                    ) : (
                      <button className="btn btn--sm" disabled style={{ opacity: 0.5, whiteSpace: "nowrap" }}>
                        Blocked: {failingGate.id}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ padding: "10px 16px", borderTop: "1px solid var(--border)", background: "var(--bg-soft)", fontSize: 11, color: "var(--text-3)" }}>
          <I.info size={12} style={{ verticalAlign: -1, marginRight: 6 }}/>
          Gates are enforced by <code>ai-router</code> before every <code>paper.promote_to_live()</code> call. Override requires manual confirmation + audit log entry.
        </div>
      </Card>
      </Wrap>
    </>
  );
};

Object.assign(window, { PaperScreen });
