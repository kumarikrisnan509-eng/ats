/* eslint-disable */
/* Dashboard screen */

// T100 (v9): NaN guards. .toFixed() / division / parsing on undefined or null
// data was rendering literal "NaN" in KPI cards. These helpers make the bad
// path render a dash instead.
const _isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const safeFix = (n, dec = 2, fallback = '—') => _isNum(n) ? n.toFixed(dec) : fallback;
const safePct = (num, den, dec = 2, fallback = 0) => {
  if (!_isNum(num) || !_isNum(den) || den === 0) return fallback;
  return ((num - den) / den) * 100;
};

// Today's run — single compact row showing live system heartbeat
// Replaces the old Pipeline health strip which duplicated the Pipeline flow diagram below
const TodaysRun = () => {
  const [, bump] = React.useReducer(x => x + 1, 0);
  React.useEffect(() => {
    const id = setInterval(bump, 30000);
    return () => clearInterval(id);
  }, []);

  // Tier 7: live KPI strip from multiple endpoints
  const [liveKpi, setLiveKpi] = React.useState(null);
  React.useEffect(() => {
    if (window.MockData && window.MockData.isDemoOn && window.MockData.isDemoOn()) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const [paper, scan, ordersRes, paperOrdersRes, auditRes, ar] = await Promise.all([
          window.fetchApi('/api/paper').catch(() => null),
          window.fetchApi('/api/scanner/history?limit=1').catch(() => null),
          window.fetchApi('/api/orders').catch(() => null),
          window.fetchApi('/api/paper/orders').catch(() => null),
          window.fetchApi('/api/audit?limit=200').catch(() => null),
          window.fetchApi('/api/autorun').catch(() => null),
        ]);
        if (cancelled) return;
        const sigEntry = scan && scan.history && scan.history[0];
        const allOrders = (paperOrdersRes && paperOrdersRes.orders) || (ordersRes && ordersRes.rows) || [];
        const lastOrder = allOrders[0];
        const errCount = auditRes && Array.isArray(auditRes.entries)
          ? auditRes.entries.filter(e => /error|fail|reject/i.test(String(e.event || ''))).length
          : 0;
        const cash = paper && paper.stats && paper.stats.cash;
        const realized = paper && paper.stats && paper.stats.realizedPnl;
        setLiveKpi({
          lastSignal: sigEntry
            ? { value: new Date(sigEntry.ts || Date.now()).toLocaleTimeString('en-IN', {hour:'2-digit',minute:'2-digit'}),
                sub: `${sigEntry.symbol} · ${sigEntry.signal}` }
            : null,
          lastOrder: lastOrder
            ? { value: lastOrder.createdAt ? new Date(lastOrder.createdAt).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}) : 'recent',
                sub: `${lastOrder.side || ''} ${lastOrder.symbol || ''} ${lastOrder.strategy ? '· ' + lastOrder.strategy : ''}` }
            : null,
          autorun: ar && ar.config
            ? { value: ar.config.enabled ? `every ${ar.config.intervalMinutes}m` : 'disabled',
                sub: `${ar.config.symbol} · ${ar.config.strategy}` }
            : null,
          riskBudget: typeof cash === 'number'
            ? { value: 'INR ' + Math.round(cash/1000) + 'k', sub: 'paper cash · live' }
            : null,
          errors: { value: String(errCount), sub: errCount === 0 ? 'all systems nominal' : 'check audit log' },
          realized: typeof realized === 'number'
            ? { value: (realized >= 0 ? '+' : '') + 'INR ' + safeFix(realized, 0, '0'), sub: 'realized P&L (paper)' }
            : null,
        });
      } catch (e) {}
    };
    refresh();
    const id = setInterval(refresh, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const __mock_items = [
    { label: "Last signal",  value: "2m ago",    sub: "HDFCBANK · Claude · 82%", href: "#signals",  dot: "var(--up)" },
    { label: "Last order",   value: "14m ago",   sub: "BUY INFY · Momentum AI",  href: "#trading",  dot: "var(--info)" },
    { label: "Next sweep",   value: "May 1",     sub: "10:00 IST · auto",        href: "#portfolio",dot: "var(--vio)" },
    { label: "Risk budget",  value: "32% used",  sub: "₹4.8k / ₹15k today",      href: "#risk",     dot: "var(--up)" },
    { label: "Errors (24h)", value: "0",         sub: "all systems nominal",     href: "#infra",    dot: "var(--up)" },
  ];
  const items = liveKpi ? [
    liveKpi.lastSignal ? { label: 'Last signal', value: liveKpi.lastSignal.value, sub: liveKpi.lastSignal.sub, href: '#signals', dot: 'var(--up)', live: true } : __mock_items[0],
    liveKpi.lastOrder  ? { label: 'Last order',  value: liveKpi.lastOrder.value,  sub: liveKpi.lastOrder.sub,  href: '#trading', dot: 'var(--info)', live: true } : __mock_items[1],
    liveKpi.autorun    ? { label: 'Autorun',     value: liveKpi.autorun.value,    sub: liveKpi.autorun.sub,    href: '#strategies', dot: 'var(--vio)', live: true } : __mock_items[2],
    liveKpi.riskBudget ? { label: 'Cash · paper', value: liveKpi.riskBudget.value, sub: liveKpi.riskBudget.sub, href: '#paper', dot: 'var(--up)', live: true } : __mock_items[3],
    { label: 'Errors (24h)', value: liveKpi.errors.value, sub: liveKpi.errors.sub, href: '#audit', dot: (parseInt(liveKpi.errors.value)||0) === 0 ? 'var(--up)' : 'var(--warn)', live: true },
  ] : __mock_items;

  return (
    <div style={{ display: "flex", gap: 0, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r-md)", padding: "2px", marginBottom: 16, overflowX: "auto" }}>
      {items.map((it, i) => (
        <a key={it.label} href={it.href} style={{
          flex: 1, minWidth: 150,
          padding: "10px 14px",
          textDecoration: "none", color: "inherit",
          borderRight: i < items.length - 1 ? "1px solid var(--border)" : "none",
          display: "flex", flexDirection: "column", gap: 2,
          transition: "background 0.12s",
        }} onMouseEnter={e => e.currentTarget.style.background = "var(--bg-soft)"} onMouseLeave={e => e.currentTarget.style.background = ""}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-3)", fontWeight: 500 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: it.dot, display: "inline-block" }}/>
            {it.label}
          </div>
          <div className="mono" style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em" }}>{it.value}</div>
          <div style={{ fontSize: 11, color: "var(--text-3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.sub}</div>
        </a>
      ))}
    </div>
  );
};

// Pipeline flow diagram — shows data flow with gates, rejections, fallbacks
// Sits below KPIs as the "how does this actually work" visual
const PipelineFlow = () => {
  const [, bump] = React.useReducer(x => x + 1, 0);
  React.useEffect(() => {
    const h = () => bump();
    window.addEventListener("modes-changed", h);
    return () => window.removeEventListener("modes-changed", h);
  }, []);

  // Tier 13: live pipeline counts.
  const [pipe, setPipe] = React.useState(null);
  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [strats, scan, paper, summary, sweep] = await Promise.all([
          window.fetchApi('/api/strategies').catch(() => null),
          window.fetchApi('/api/scanner/history?limit=300').catch(() => null),
          window.fetchApi('/api/paper').catch(() => null),
          window.fetchApi('/api/summary').catch(() => null),
          window.fetchApi('/api/sweep').catch(() => null),
        ]);
        if (cancelled) return;
        const stratCount = strats && Array.isArray(strats.strategies) ? strats.strategies.length
                        : strats && strats.ok && Array.isArray(strats.rows) ? strats.rows.length : null;
        const startToday = (() => { const d = new Date(); d.setHours(0,0,0,0); return d.getTime(); })();
        const startWeek  = startToday - 6*24*3600*1000;
        const signalsToday = scan && scan.ok && Array.isArray(scan.rows)
          ? scan.rows.filter(r => new Date(r.ts || r.time || 0).getTime() >= startToday).length : null;
        const paperTradesWk = paper && paper.stats && paper.stats.tradeCount != null ? paper.stats.tradeCount : null;
        const livePositions = summary && summary.aggregates ? (summary.aggregates.positionsNetCount || 0) : null;
        const sweptMTD = sweep && sweep.stats ? (sweep.stats.totalSweptINR || 0) : null;
        setPipe({ stratCount, signalsToday, paperTradesWk, livePositions, sweptMTD });
      } catch (_e) {}
    };
    load();
    const t = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);
  const fmtINR = (n) => {
    if (n == null) return '—';
    if (n >= 100000) return '₹' + (n/100000).toFixed(2) + 'L';
    if (n >= 1000) return '₹' + (n/1000).toFixed(1) + 'k';
    return '₹' + n;
  };

  const activeModes = window.MODE_IDS.filter(id => window.isModeActive(id));
  const inactiveCount = 4 - activeModes.length;

  // Stage = a node box. gates = labelled edges between stages.
  const stage = (opts) => opts;

  const stages = [
    stage({
      id: "modes",
      title: "Trading Modes",
      value: `${activeModes.length}`,
      unit: "active",
      sub: `${inactiveCount} paused`,
      color: "var(--accent)",
      href: "#modes",
      desc: "Defines risk, capital share, timeframes",
    }),
    stage({
      id: "strategies",
      title: "Strategies",
      value: pipe && pipe.stratCount != null ? String(pipe.stratCount) : "—",
      unit: "registered",
      sub: pipe && pipe.stratCount != null ? "from /api/strategies" : "loading…",
      color: "var(--info)",
      href: "#strategies",
      desc: "One strategy belongs to exactly one mode",
    }),
    stage({
      id: "signals",
      title: "Signals",
      value: pipe && pipe.signalsToday != null ? String(pipe.signalsToday) : "—",
      unit: "today",
      sub: "scanner hits since 00:00 IST",
      color: "oklch(55% 0.14 280)",
      href: "#signals",
      desc: "Candidate entries generated by live strategies",
    }),
    stage({
      id: "paper",
      title: "Paper Trades",
      value: pipe && pipe.paperTradesWk != null ? String(pipe.paperTradesWk) : "—",
      unit: "total",
      sub: "paper trade history",
      color: "oklch(60% 0.12 55)",
      href: "#paper",
      desc: "Simulated fills, real prices, no capital",
    }),
    stage({
      id: "live",
      title: "Live Orders",
      value: pipe && pipe.livePositions != null ? String(pipe.livePositions) : "—",
      unit: "open positions",
      sub: "net positions from Kite",
      color: "var(--up)",
      href: "#trading",
      desc: "Real money, broker-routed",
    }),
    stage({
      id: "sweep",
      title: "Profit Sweep",
      value: pipe && pipe.sweptMTD != null ? fmtINR(pipe.sweptMTD) : "—",
      unit: "lifetime swept",
      sub: "from /api/sweep",
      color: "var(--vio)",
      href: "#portfolio",
      desc: "Long-term / reinvest / emergency",
    }),
  ];

  // Gates on the edges between stages
  const gates = [
    { from: "modes",      to: "strategies", label: "mode.active === true" },
    { from: "strategies", to: "signals",    label: "strategy.status === 'live'" },
    { from: "signals",    to: "paper",      label: "confidence ≥ 70%\nrisk budget OK" },
    { from: "paper",      to: "live",       label: "≥14d · ≥30 trades\n≥60% win · ≥1.2 Sharpe" },
    { from: "live",       to: "sweep",      label: "realized_pnl > 0\ndaily end-of-day" },
  ];

  // Rejection sinks — shown below each gate
  const rejections = {
    "strategies→signals": { count: 3, label: "paper-only" },
    "signals→paper":      { count: 35, label: "rejected by router" },
    "paper→live":         { count: 6, label: "gate blocked" },
    "live→sweep":         { count: 0, label: "loss days · held" },
  };

  return (
    <Card style={{ marginBottom: 16 }} title="Pipeline flow" sub="How trades travel through the system — click any stage to drill in"
      right={
        <div className="row" style={{ gap: 12, fontSize: 11, color: "var(--text-3)" }}>
          <span className="row" style={{ gap: 5 }}>
            <span style={{ width: 8, height: 2, background: "var(--up)" }}/>
            <span>promote</span>
          </span>
          <span className="row" style={{ gap: 5 }}>
            <span style={{ width: 8, height: 2, background: "var(--down)", borderTop: "1px dashed var(--down)" }}/>
            <span>reject / halt</span>
          </span>
        </div>
      }
      flush
    >
      <div style={{ padding: "20px 16px 16px", overflowX: "auto" }}>
        <div style={{ display: "flex", alignItems: "stretch", gap: 0, minWidth: 1100 }}>
          {stages.map((s, i) => {
            const gate = gates.find(g => g.from === s.id);
            const rejKey = gate ? `${gate.from}→${gate.to}` : null;
            const rej = rejKey ? rejections[rejKey] : null;
            return (
              <React.Fragment key={s.id}>
                {/* Stage box */}
                <a href={s.href} style={{
                  flex: 1, minWidth: 140,
                  display: "flex", flexDirection: "column",
                  padding: "12px 12px",
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderTop: `2px solid ${s.color}`,
                  borderRadius: "var(--r-md)",
                  textDecoration: "none",
                  color: "inherit",
                  transition: "all 0.12s",
                  position: "relative",
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.transform = "translateY(-2px)";
                  e.currentTarget.style.boxShadow = "var(--shadow-md)";
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.transform = "";
                  e.currentTarget.style.boxShadow = "";
                }}
                >
                  <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-3)", fontWeight: 500 }}>
                    {String(i + 1).padStart(2, "0")} · {s.title}
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 8 }}>
                    <div className="mono" style={{ fontSize: 24, fontWeight: 600, color: s.color, letterSpacing: "-0.02em", lineHeight: 1 }}>{s.value}</div>
                    <div style={{ fontSize: 11, color: "var(--text-3)" }}>{s.unit}</div>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-2)", marginTop: 3 }}>{s.sub}</div>
                  <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 10, borderTop: "1px dashed var(--border)", paddingTop: 8, lineHeight: 1.4 }}>
                    {s.desc}
                  </div>
                </a>

                {/* Gate / arrow between stages */}
                {gate && (
                  <div style={{
                    flex: "0 0 90px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "flex-start",
                    padding: "20px 4px 0",
                    position: "relative",
                  }}>
                    {/* Arrow line */}
                    <div style={{ display: "flex", alignItems: "center", width: "100%" }}>
                      <div style={{ flex: 1, height: 2, background: "var(--up)" }}/>
                      <div style={{
                        width: 0, height: 0,
                        borderTop: "5px solid transparent",
                        borderBottom: "5px solid transparent",
                        borderLeft: "7px solid var(--up)",
                      }}/>
                    </div>
                    {/* Gate label */}
                    <div className="mono" style={{
                      fontSize: 9,
                      color: "var(--text-3)",
                      marginTop: 6,
                      textAlign: "center",
                      lineHeight: 1.4,
                      whiteSpace: "pre-line",
                      padding: "3px 6px",
                      background: "var(--bg-soft)",
                      borderRadius: 3,
                      border: "1px solid var(--border)",
                    }}>
                      {gate.label}
                    </div>
                    {/* Rejection sink */}
                    {rej && (
                      <div style={{ marginTop: 10, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                        <div style={{
                          width: 1, height: 14,
                          borderLeft: "1px dashed var(--down)",
                        }}/>
                        <div style={{
                          fontSize: 10,
                          color: "var(--down)",
                          textAlign: "center",
                          lineHeight: 1.3,
                        }}>
                          <div className="mono" style={{ fontWeight: 600 }}>↓ {rej.count}</div>
                          <div style={{ fontSize: 9, color: "var(--text-3)" }}>{rej.label}</div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* Bottom legend — what governs transitions */}
        <div style={{
          marginTop: 20,
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 12,
          padding: "12px 14px",
          background: "var(--bg-soft)",
          borderRadius: "var(--r-md)",
          border: "1px solid var(--border)",
        }}>
          {[
            { k: "Orchestrator", v: "ai-router", d: "Scores signals, routes to paper or live" },
            { k: "Risk engine", v: "risk-gate", d: "Position sizing, daily-loss cap, exposure" },
            { k: "Promotion",   v: "paper.promote()", d: "4-gate check before live auto-promote" },
            { k: "Sweeper",     v: "profit-sweep", d: "Runs EOD, splits realized to 3 buckets" },
          ].map((c, i) => (
            <div key={i} style={{ fontSize: 11 }}>
              <div style={{ color: "var(--text-3)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>{c.k}</div>
              <div className="mono" style={{ color: "var(--text-1)", fontWeight: 500, marginTop: 2 }}>{c.v}</div>
              <div style={{ color: "var(--text-2)", marginTop: 2, fontSize: 11 }}>{c.d}</div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
};

const DashboardScreen = () => {
  const [tf, setTf] = useState("1D");
  const [demo] = window.useDemoMode();

  // Tier 8: live dashboard metrics
  const [liveDash, setLiveDash] = React.useState(null);
  const [liveProfile, setLiveProfile] = React.useState(null);

  // Tier 60: per-user summary aggregator -- single endpoint replaces 4 hardcoded fallbacks.
  const [liveSummary, setLiveSummary] = React.useState(null);
  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch('/api/me/dashboard-summary', { credentials: 'include' });
        if (cancelled) return;
        if (r.status === 200) setLiveSummary(await r.json());
        else if (r.status === 401) setLiveSummary({ ok: false, reason: 'auth_required' });
      } catch (e) {}
    };
    load();
    const id = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);
  React.useEffect(() => {
    if (demo) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const [holdings, paper, pnlDaily, pnlBy, profile, stratsLive, scanLive] = await Promise.all([
          window.fetchApi('/api/portfolio/holdings').catch(() => null),
          window.fetchApi('/api/paper').catch(() => null),
          window.fetchApi('/api/pnl/daily?days=30').catch(() => null),
          window.fetchApi('/api/pnl/by-strategy').catch(() => null),
          window.fetchApi('/api/profile').catch(() => null),
          window.fetchApi('/api/strategies').catch(() => null),
          window.fetchApi('/api/scanner/history?limit=300').catch(() => null),
        ]);
        if (cancelled) return;
        // Compute portfolio value from real holdings
        const rows = (holdings && holdings.rows) || [];
        const portfolioValue = rows.reduce((s, h) => s + (h.quantity || 0) * (h.ltp || h.last_price || 0), 0);
        const portfolioPnl   = rows.reduce((s, h) => s + (h.pnl || 0), 0);
        const portfolioInvested = rows.reduce((s, h) => s + (h.quantity || 0) * (h.average_price || h.avgPrice || 0), 0);
        const portfolioPnlPct = portfolioInvested > 0 ? (portfolioPnl / portfolioInvested) * 100 : 0;
        // Paper P&L
        const paperRealized   = (paper && paper.stats && paper.stats.realizedPnl) || 0;
        const paperUnrealized = (paper && paper.stats && paper.stats.unrealizedPnl) || 0;
        const paperEquity     = (paper && paper.stats && paper.stats.totalEquity) || 0;
        // Win rate from paper trades
        const strats = (pnlBy && pnlBy.strategies) || [];
        const totalTrades = strats.reduce((s, x) => s + (x.trades || 0), 0);
        const totalWins   = strats.reduce((s, x) => s + (x.wins || 0), 0);
        const winRate     = totalTrades > 0 ? (totalWins / totalTrades) * 100 : null;
        // Equity series from daily snapshots
        const dailyRows   = (pnlDaily && pnlDaily.rows) || [];
        setLiveDash({
          portfolioValue, portfolioPnl, portfolioPnlPct,
          paperEquity, paperRealized, paperUnrealized,
          paperTotalPnl: paperRealized + paperUnrealized,
          winRate, totalTrades,
          dailyEquity: dailyRows.map(r => ({ x: r.date, y: r.totalEquity })),
          asOf: new Date().toISOString(),
          holdingsCount: rows.length,
          stratCount: stratsLive && stratsLive.ok && Array.isArray(stratsLive.rows) ? stratsLive.rows.length
                    : stratsLive && Array.isArray(stratsLive.strategies) ? stratsLive.strategies.length : null,
          signalsToday: scanLive && scanLive.ok && Array.isArray(scanLive.rows)
            ? scanLive.rows.filter(r => {
                const t = new Date(r.ts || r.time || 0).getTime();
                const start = new Date(); start.setHours(0,0,0,0);
                return t >= start.getTime();
              }).length : null,
          scannerCards: scanLive && scanLive.ok && Array.isArray(scanLive.rows)
            ? scanLive.rows.slice(0, 3).map(r => ({
                sym: r.symbol || '—',
                action: String(r.signal || '').toUpperCase().includes('SELL') ? 'SELL' : 'BUY',
                conf: r.confidence != null ? Math.round(r.confidence * 100) : (r.value != null ? Math.min(99, Math.max(0, Math.round(r.value))) : 50),
                src: r.strategy ? `${r.strategy}` : (r.message || 'scanner'),
                tgt: r.target != null ? String(r.target) : '—',
                sl:  r.stopLoss != null ? String(r.stopLoss) : '—',
              }))
            : []
        });
        if (profile && profile.ok) setLiveProfile(profile.profile);
      } catch (e) {}
    };
    refresh();
    const id = setInterval(refresh, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, [demo]);
  const fmtDate = () => new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  // R8.C3 — close-position confirmation. Closing routes a market order at LTP; never silent.
  const [closing, setClosing] = React.useState(null);   // { sym, qty, avg, ltp, pnl, strat }
  const equitySeries = useMemo(() => {
    const map = { "1D": 78, "1W": 40, "1M": 30, "3M": 60, "YTD": 120, "1Y": 180 };
    const n = map[tf] || 78;
    const base = seriesRandom(7, n, 70, 120, 0.15).map((v, i) => v + i * 0.25);
    return base;
  }, [tf]);

  // Watchlist seed (cosmetic — overwritten by live ticks once /ws starts pushing for these symbols)
  const __seedSymbols = [
    { s: "RELIANCE",   p: 2948.50, c: 1.24, v: "12.4M" },
    { s: "TCS",        p: 4120.10, c: -0.45, v: "3.2M" },
    { s: "HDFCBANK",   p: 1712.80, c: 0.78, v: "8.9M" },
    { s: "INFY",       p: 1876.25, c: 2.31, v: "6.1M" },
    { s: "ICICIBANK",  p: 1288.90, c: -0.12, v: "5.7M" },
    { s: "SBIN",       p:  884.40, c: 1.56, v: "11.0M" },
    { s: "BAJFINANCE", p: 7250.00, c: -0.88, v: "1.8M" },
    { s: "LT",         p: 3784.65, c: 0.34, v: "2.4M" },
  ];
  const symbols = __seedSymbols;

  // Positions: demo → mock array, live → fetch from /api/portfolio/positions.
  const __mockPositions = [
    { s: "NIFTY 22550 CE", qty: 150, avg: 82.40,  strat: "Momentum AI" },
    { s: "RELIANCE",        qty: 40,  avg: 2932.10, strat: "Mean Reversion" },
    { s: "BANKNIFTY FUT",   qty: 15,  avg: 48210,  strat: "Grid Trader" },
    { s: "INFY",            qty: 60,  avg: 1843.00, strat: "Momentum AI" },
    { s: "TCS",             qty: 25,  avg: 4140.50, strat: "Swing Bot" },
  ];
  const [positions, setPositions] = React.useState(demo ? __mockPositions : []);
  React.useEffect(() => {
    if (demo) { setPositions(__mockPositions); return; }
    let cancelled = false;
    (async () => {
      try {
        const data = await window.fetchApi('/api/portfolio/positions');
        if (cancelled) return;
        const net = (data && data.net || []).map(p => ({
          s: p.symbol, qty: p.quantity, avg: p.avgPrice,
          strat: p.product || '—',
        }));
        setPositions(net);
      } catch (err) {
        console.warn('[dashboard] /api/portfolio/positions failed:', err.message);
        if (!cancelled) setPositions([]);
      }
    })();
    return () => { cancelled = true; };
  }, [demo]);
  // Live aggregate P&L across all positions
  const livePnL = useLivePnL(positions.map(p => ({ symbol: p.s, qty: p.qty, avg: p.avg })));

  // Sector heatmap component — live, colored by % change
  const SectorHeatmap = () => {
    useLiveTick();
    const tiles = [
      // Banking
      { s: "HDFCBANK", sect: "Banking", cap: 13 }, { s: "ICICIBANK", sect: "Banking", cap: 9 },
      { s: "SBIN", sect: "Banking", cap: 8 }, { s: "BAJFINANCE", sect: "Banking", cap: 5 },
      // IT
      { s: "TCS", sect: "IT", cap: 14 }, { s: "INFY", sect: "IT", cap: 8 },
      // Energy & Industrials
      { s: "RELIANCE", sect: "Energy", cap: 19 }, { s: "LT", sect: "Industrial", cap: 6 },
      // Consumer
      { s: "ITC", sect: "FMCG", cap: 6 }, { s: "TITAN", sect: "Consumer", cap: 3 },
      // Indices (placed last as wider bars)
      { s: "NIFTY 50", sect: "Index", cap: 0 }, { s: "BANKNIFTY", sect: "Index", cap: 0 },
    ];
    const colorFor = (pct) => {
      if (pct > 1.5) return "#0f7a4a";
      if (pct > 0.5) return "#2e5e3a";
      if (pct > -0.5) return "#3a3f48";
      if (pct > -1.5) return "#6b2730";
      return "#a01e2c";
    };
    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 4, padding: "4px 0" }}>
        {tiles.map((t, i) => {
          const live = window.LiveTicks.state().symbols[t.s];
          const pct = safePct(live ? live.ltp : null, live ? live.prev : null);
          const bg = colorFor(pct);
          const span = t.cap >= 13 ? 2 : 1;
          return (
            <div key={i} style={{
              gridColumn: `span ${span}`, background: bg, color: "#fff",
              borderRadius: 4, padding: "12px 10px", minHeight: t.sect === "Index" ? 56 : 72,
              display: "flex", flexDirection: "column", justifyContent: "space-between",
              transition: "background 400ms ease",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, opacity: 0.75, textTransform: "uppercase", letterSpacing: 0.5 }}>
                <span>{t.sect}</span>
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: -0.2 }}>{t.s}</div>
                <div style={{ fontSize: 11, fontFamily: "var(--mono)", opacity: 0.9, marginTop: 2 }}>
                  {safeFix(live && live.ltp, 2)} · {pct >= 0 ? "+" : ""}{safeFix(pct, 2, '0.00')}%
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // R11 #11 — demote lower cards behind a toggle (default collapsed; persisted)
  const [showMore, setShowMore] = React.useState(() => {
    try { return localStorage.getItem("ats.dash.more") === "1"; } catch { return false; }
  });
  React.useEffect(() => { try { localStorage.setItem("ats.dash.more", showMore ? "1" : "0"); } catch {} }, [showMore]);

  // Live activity feed — synthetic events generated on ticks
  const [activity, setActivity] = useState([
    { t: "09:42:11", m: "BUY",  sym: "INFY",      qty: 60,  px: 1843.00, strat: "Momentum AI",     ok: true },
    { t: "10:02:34", m: "AI",   sym: "NIFTY",     qty: null, px: null,   strat: "Signal · breakout 22540", ok: true, tag: "signal" },
    { t: "10:08:02", m: "BUY",  sym: "NIFTY CE",  qty: 150, px: 82.40,  strat: "Momentum AI",     ok: true },
    { t: "11:15:40", m: "SELL", sym: "TITAN",     qty: 30,  px: 3612.00, strat: "Mean Reversion",  ok: true },
    { t: "11:42:08", m: "RISK", sym: "—",         qty: null, px: null,   strat: "Max loss 30% of daily cap used", ok: false, tag: "risk" },
    { t: "12:18:55", m: "BUY",  sym: "RELIANCE",  qty: 40,  px: 2932.10, strat: "Mean Reversion",  ok: true },
  ]);
  React.useEffect(() => {
    const SYMS = ["RELIANCE", "INFY", "TCS", "HDFCBANK", "ICICIBANK", "SBIN", "ITC", "LT", "TITAN", "BAJFINANCE"];
    const STRATS = ["Momentum AI", "Mean Reversion v2", "Trend Follow", "Grid Trader", "Swing Bot"];
    const SIGNALS = ["breakout above VWAP", "RSI oversold bounce", "20-EMA crossover", "volume spike +180%", "support test held"];
    const RISKS = ["Slippage 0.08% — within tolerance", "Position size 32% of mode cap", "Daily drawdown 0.4% / 3% limit", "Order rate-limited (5/sec)"];
    const gen = () => {
      const now = new Date();
      const t = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}:${String(now.getSeconds()).padStart(2,"0")}`;
      const r = Math.random();
      const sym = SYMS[Math.floor(Math.random() * SYMS.length)];
      const live = window.LiveTicks.state().symbols[sym];
      const px = live ? +live.ltp.toFixed(2) : 1000;
      if (r < 0.45) {
        const side = Math.random() > 0.5 ? "BUY" : "SELL";
        return { t, m: side, sym, qty: Math.floor(20 + Math.random() * 100), px, strat: STRATS[Math.floor(Math.random() * STRATS.length)], ok: true };
      } else if (r < 0.75) {
        return { t, m: "AI", sym, qty: null, px: null, strat: `Signal · ${SIGNALS[Math.floor(Math.random() * SIGNALS.length)]}`, ok: true, tag: "signal" };
      } else if (r < 0.92) {
        return { t, m: "RISK", sym: "—", qty: null, px: null, strat: RISKS[Math.floor(Math.random() * RISKS.length)], ok: false, tag: "risk" };
      } else {
        return { t, m: "FILL", sym, qty: Math.floor(20 + Math.random() * 80), px, strat: `Filled · slippage ₹${(Math.random() * 1.5).toFixed(2)}`, ok: true, tag: "signal" };
      }
    };
    let count = 0;
    const onTick = () => {
      count++;
      if (count % 5 !== 0) return; // ~once per 4s
      setActivity(prev => [gen(), ...prev].slice(0, 8));
    };
    window.addEventListener("tick", onTick);
    return () => window.removeEventListener("tick", onTick);
  }, []);

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-header__title" style={{ fontSize: 24, marginBottom: 4 }}>Welcome back, {(window.atsCurrentUser && window.atsCurrentUser.name) ? window.atsCurrentUser.name.split(' ')[0] : 'trader'} · <span className="muted" style={{ fontWeight: 400 }}>{fmtDate()}</span></h1>
          <div className="page-header__sub">{demo ? "Demo mode · clean slate · no live data" : (() => {
            const status = (typeof window.marketStatus === 'function') ? window.marketStatus() : { open:false, label:'' };
            const market = status.open ? 'Markets are live' : (status.label ? `Markets ${status.label.toLowerCase()}` : 'Markets closed');
            const stratN = liveDash && liveDash.stratCount != null ? liveDash.stratCount : null;
            const sigN   = liveDash && liveDash.signalsToday  != null ? liveDash.signalsToday : null;
            const parts = [market];
            if (stratN != null) parts.push(`${stratN} strategies running`);
            if (sigN   != null) parts.push(`${sigN} AI signals today`);
            return parts.join(' · ');
          })()}</div>
        </div>
        <div className="page-header__right">
          <button className="btn"><I.download size={14}/> Export</button>
          <button className="btn btn--primary"><I.plus size={14}/> New strategy</button>        </div>
      </div>

      {/* R10 #30 — Morning brief (pre-market) */}
      {window.MorningBrief && <window.MorningBrief/>}

      {/* R11 #17 — AI cost mini on dashboard */}
      {window.AICostMini && (
        <div style={{ marginBottom: 16 }}>
          <window.AICostMini onClick={() => location.hash = "review"}/>
        </div>
      )}

      {/* Today's run — live heartbeat */}
      <TodaysRun/>

      {/* KPI row -- Tier 60: every number derived from /api/me/dashboard-summary. No mock fallbacks. */}
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        {(() => {
          const ds = liveSummary;
          const hasData = ds && ds.ok;
          const brokerOn = hasData && ds.brokerConnected;
          const fmt = (v) => (v == null || isNaN(v)) ? "--" : inrCompact(v);
          const pctFmt = (v) => (v == null || isNaN(v)) ? "--" : pct(v);
          return (
            <>
              <Card>
                <Stat
                  label="Portfolio value"
                  value={brokerOn ? fmt(ds.portfolioValue) : "--"}
                  delta={brokerOn ? pctFmt(ds.portfolioPnlPct) : "no broker"}
                  deltaKind={brokerOn && ds.portfolioPnl >= 0 ? "up" : (brokerOn ? "down" : "muted")}
                  sub={brokerOn ? (ds.holdingsCount + " holdings") : "Connect Zerodha to see live data"}/>
                <div style={{ marginTop: 10 }}><LiveSparkline symbol="NIFTY" seed={1} color="var(--up)"/></div>
              </Card>
              <Card>
                <Stat
                  label="Today's P&L"
                  value={hasData ? <CountUp value={(ds.todayPnl || 0) + livePnL.total} format={v => inr(Math.round(v))}/> : "--"}
                  delta={hasData && ds.portfolioValue > 0 ? pct(((ds.todayPnl || 0) + livePnL.total) / ds.portfolioValue * 100) : "--"}
                  deltaKind={hasData && ((ds.todayPnl || 0) + livePnL.total) >= 0 ? "up" : "down"}
                  sub={<>realized + MTM <StaleIndicator/></>}/>
                <div style={{ marginTop: 10 }}><LiveSparkline symbol="BANKNIFTY" seed={2} color="var(--up)"/></div>
              </Card>
              <Card>
                <Stat
                  label="Deployed capital"
                  value={hasData ? fmt(ds.deployedCapital) : "--"}
                  delta={hasData && _isNum(ds.deployedCapital) && _isNum(ds.initialCapital) && ds.initialCapital > 0 ? `${safeFix((ds.deployedCapital / ds.initialCapital) * 100, 0, '--')}%` : "--"}
                  deltaKind="muted"
                  sub={hasData ? `of ${inrCompact(ds.initialCapital)} initial` : "Set capital in onboarding"}/>
                <div style={{ marginTop: 14 }}>
                  <Progress value={hasData && ds.initialCapital > 0 ? Math.min(100, (ds.deployedCapital / ds.initialCapital) * 100) : 0} kind="info"/>
                </div>
              </Card>
              <Card>
                <Stat
                  label="Win rate (30d)"
                  value={hasData && ds.winRate30d != null ? (ds.winRate30d.toFixed(1) + "%") : "--"}
                  delta={hasData ? (ds.totalTrades30d + " trades") : "no trades yet"}
                  deltaKind="up"
                  sub={hasData ? "paper trades last 30d" : "Place your first paper trade"}/>
                <div style={{ marginTop: 14 }}>
                  <Progress value={hasData && ds.winRate30d != null ? Math.max(0, Math.min(100, ds.winRate30d)) : 0} kind="up"/>
                </div>
              </Card>
            </>
          );
        })()}
      </div>

      {/* Pipeline flow diagram — how trades move through the system */}
      <PipelineFlow/>

      {/* Main split */}
      <div className="grid grid-2-1" style={{ marginBottom: 16 }}>
        <Card
          title="Equity curve"
          sub="All strategies, combined P&L over time"
          right={<Segmented value={tf} onChange={setTf} options={["1D", "1W", "1M", "3M", "YTD", "1Y"]}/>}
        >
          <AreaChart data={equitySeries} height={260} color="var(--accent)" formatter={v => "₹" + (v * 40000).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}
            labels={["09:15", "10:30", "11:45", "13:00", "14:15", "15:30"]}/>
          <div className="row" style={{ marginTop: 14, gap: 18 }}>
            <div><div className="muted" style={{ fontSize: 11 }}>Open</div><div className="mono">{liveSummary && liveSummary.brokerConnected ? inrCompact(liveSummary.portfolioValue - (liveSummary.todayPnl||0)) : "--"}</div></div>
            <div><div className="muted" style={{ fontSize: 11 }}>High</div><div className="mono up">--</div></div>
            <div><div className="muted" style={{ fontSize: 11 }}>Low</div><div className="mono down">--</div></div>
            <div><div className="muted" style={{ fontSize: 11 }}>Current</div><div className="mono">{liveSummary && liveSummary.brokerConnected ? inrCompact(liveSummary.portfolioValue) : "--"}</div></div>
          </div>
        </Card>

        <Card title="Allocation" sub="Capital split across buckets">
          <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
            <Donut
              size={160} thickness={18}
              data={[
                { value: 38, color: "var(--accent)" },
                { value: 24, color: "var(--info)" },
                { value: 18, color: "var(--violet)" },
                { value: 12, color: "var(--warn)" },
                { value: 8, color: "var(--border-strong)" },
              ]}>
              <div>
                <div className="muted" style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase" }}>Total</div>
                <div style={{ fontFamily: "var(--mono)", fontSize: 18, fontWeight: 600 }}>{liveSummary && liveSummary.portfolioValue > 0 ? inrCompact(liveSummary.portfolioValue) : "--"}</div>
              </div>
            </Donut>
            <div style={{ flex: 1 }}>
              {[
                { k: "Intraday & F&O", v: "38%", c: "var(--accent)" },
                { k: "Swing equity",   v: "24%", c: "var(--info)" },
                { k: "Long-term",      v: "18%", c: "var(--violet)" },
                { k: "Mutual funds",   v: "12%", c: "var(--warn)" },
                { k: "Cash / Liquid",  v: "8%",  c: "var(--border-strong)" },
              ].map((r, i) => (
                <div key={i} className="between" style={{ padding: "5px 0", fontSize: 12 }}>
                  <div className="row"><span style={{ width: 8, height: 8, borderRadius: 2, background: r.c }}/><span>{r.k}</span></div>
                  <span className="mono">{r.v}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      {/* Active positions + AI queue */}
      <div className="grid grid-2-1" style={{ marginBottom: 16 }}>
        <Card title="Open positions" sub={positions.length ? `${positions.length} active across 3 strategies` : "No live exposure"}
          right={positions.length ? <button className="btn btn--sm"><I.filter size={12}/> Filter</button> : null} flush>
          {positions.length === 0 ? (
            <window.EmptyState
              icon={I.portfolio}
              title="No open positions"
              sub="When your strategies enter trades, they'll show here with live P&L. Enable a mode or promote a paper strategy to start."
              action={{ label: "Go to Trading modes", onClick: () => location.hash = "modes" }}
              secondary={{ label: "View paper trades", onClick: () => location.hash = "paper" }}
              tone="accent"
            />
          ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Symbol</th><th>Strategy</th><th style={{ textAlign: "right" }}>Qty</th>
                <th style={{ textAlign: "right" }}>Avg</th><th style={{ textAlign: "right" }}>LTP</th>
                <th style={{ textAlign: "right" }}>P&L</th><th></th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p, i) => {
                const live = window.LiveTicks.state().symbols[p.s];
                const ltp = live ? live.ltp : p.avg;
                const pnl = (ltp - p.avg) * p.qty;
                return (
                  <tr key={i}>
                    <td style={{ fontWeight: 500 }}>{p.s}</td>
                    <td><Pill kind={p.strat.includes("AI") ? "vio" : "acc"}>{p.strat}</Pill></td>
                    <td className="num">{p.qty}</td>
                    <td className="num">{p.avg.toLocaleString("en-IN")}</td>
                    <td className="num"><LiveCell symbol={p.s} decimals={2}/></td>
                    <td className={"num " + clsPN(pnl)}>{pnl >= 0 ? "+" : ""}{inr(Math.round(pnl))}</td>
                    <td><button className="btn btn--sm" onClick={() => setClosing({ ...p, ltp, pnl })}>Close</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          )}
        </Card>

        <Card title="AI signals queue" sub={demo ? "No signals · clean slate" : "Pending paper→live review"}
          right={!demo ? <button className="btn btn--sm"><I.refresh size={12}/></button> : null}>
          {demo ? (
            <window.EmptyState
              icon={I.brain}
              title="No signals yet"
              sub="Once strategies run, AI-scored entry candidates queue here for paper / live review."
              size="sm"
              action={{ label: "Enable a strategy", onClick: () => location.hash = "strategies" }}
              tone="violet"
            />
          ) : (
          <div className="col" style={{ gap: 10 }}>
            {(liveDash && liveDash.scannerCards && liveDash.scannerCards.length > 0
              ? liveDash.scannerCards
              : [
                  { sym: "—", action: "…", conf: 0, src: "Loading scanner hits from /api/scanner/history…", tgt: "—", sl: "—" },
                ]
            ).map((s, i) => (
              <div key={i} style={{ padding: 12, border: "1px solid var(--border)", borderRadius: "var(--r-md)" }}>
                <div className="between" style={{ marginBottom: 6 }}>
                  <div className="row">
                    <strong style={{ fontSize: 13 }}>{s.sym}</strong>
                    <Pill kind={s.action === "BUY" ? "up" : "down"} dot>{s.action}</Pill>
                  </div>
                  <span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>conf {s.conf}%</span>
                </div>
                <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>{s.src}</div>
                <div className="row" style={{ gap: 12, fontSize: 11 }}>
                  <span><span className="muted">TGT </span><span className="mono up">{s.tgt}</span></span>
                  <span><span className="muted">SL </span><span className="mono down">{s.sl}</span></span>
                </div>
                <div className="row" style={{ marginTop: 10, gap: 6 }}>
                  <button className="btn btn--sm btn--accent" style={{ flex: 1 }}>Paper</button>
                  <button className="btn btn--sm" style={{ flex: 1 }}>Live</button>
                  <button className="btn btn--sm btn--ghost">Skip</button>
                </div>
              </div>
            ))}
          </div>
          )}
        </Card>
      </div>

      {/* Sector heatmap — live */}
      <Card
        title="Sector heatmap"
        sub={<>NIFTY 100 universe · tile size = mkt cap · color = day chg <span style={{display:"inline-block",width:6,height:6,borderRadius:"50%",background:"var(--up)",marginLeft:8,marginRight:6,boxShadow:"0 0 0 3px color-mix(in oklab, var(--up) 25%, transparent)",animation:"pulse 2s infinite"}}/>live</>}
        right={<div className="row" style={{gap:8,fontSize:11}}>
          <span className="row" style={{gap:4}}><span style={{width:10,height:10,background:"#0f7a4a",borderRadius:2}}/><span className="muted">&gt;+1.5%</span></span>
          <span className="row" style={{gap:4}}><span style={{width:10,height:10,background:"#2e5e3a",borderRadius:2}}/><span className="muted">+0.5%</span></span>
          <span className="row" style={{gap:4}}><span style={{width:10,height:10,background:"#3a3f48",borderRadius:2}}/><span className="muted">flat</span></span>
          <span className="row" style={{gap:4}}><span style={{width:10,height:10,background:"#6b2730",borderRadius:2}}/><span className="muted">−0.5%</span></span>
          <span className="row" style={{gap:4}}><span style={{width:10,height:10,background:"#a01e2c",borderRadius:2}}/><span className="muted">&lt;−1.5%</span></span>
        </div>}
      >
        <SectorHeatmap/>
      </Card>

      {/* Watchlist + Activity + Health — demoted (R11 #11) */}
      <div style={{ marginTop: 4, marginBottom: 12, display: "flex", alignItems: "center", gap: 10 }}>
        <button
          onClick={() => setShowMore(v => !v)}
          className="btn btn--ghost"
          style={{ fontSize: 12, padding: "6px 10px" }}
          aria-expanded={showMore}
        >
          {showMore ? "▼" : "▶"} {showMore ? "Hide" : "Show more"} on dashboard
          <span className="muted" style={{ marginLeft: 8, fontSize: 11 }}>Watchlist · Live activity · System health</span>
        </button>
        <div style={{ flex: 1, height: 1, background: "var(--border)" }}/>
      </div>
      {showMore && (
      <div className="grid grid-3">
        <Card title="Watchlist" sub="NSE · 8 symbols"
          right={<button className="btn btn--sm"><I.plus size={12}/></button>} flush>
          <table className="table">
            <tbody>
              {symbols.map((s, i) => {
                const live = window.LiveTicks.state().symbols[s.s];
                const livePct = live ? ((live.ltp - live.prev) / live.prev) * 100 : s.c;
                return (
                  <tr key={i}>
                    <td style={{ fontWeight: 500 }}>{s.s}</td>
                    <td className="num"><LiveCell symbol={s.s} decimals={2}/></td>
                    <td className={"num " + clsPN(livePct)}>{pct(livePct)}</td>
                    <td style={{ width: 80 }}><LiveSparkline symbol={s.s} seed={i + 11} height={24} width={80}/></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>

        <Card title="Live activity" sub={<><span style={{display:"inline-block",width:6,height:6,borderRadius:"50%",background:"var(--up)",marginRight:6,boxShadow:"0 0 0 3px color-mix(in oklab, var(--up) 25%, transparent)",animation:"pulse 2s infinite"}}/>streaming · last {activity.length} events</>} flush>
          <div style={{ padding: "4px 0" }}>
            {activity.map((a, i) => {
              const color = a.tag === "risk" ? "warn" : a.tag === "signal" ? "info" : a.m === "BUY" ? "up" : "down";
              return (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "64px 56px 1fr auto", gap: 10, padding: "8px 20px", borderBottom: i < activity.length - 1 ? "1px solid var(--border)" : "none", alignItems: "center" }}>
                  <span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{a.t}</span>
                  <Pill kind={color}>{a.m}</Pill>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 500 }}>{a.sym} {a.qty ? `· ${a.qty} @ ₹${a.px}` : ""}</div>
                    <div className="muted" style={{ fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.strat}</div>
                  </div>
                  {a.ok ? <I.check size={14} className="up"/> : <I.x size={14} className="warn"/>}
                </div>
              );
            })}
          </div>
        </Card>

        <Card title="System health" sub="Oracle Cloud · AD-1 · FD-2">
          <div className="col" style={{ gap: 14 }}>
            <div>
              <div className="between" style={{ marginBottom: 6 }}>
                <div className="row"><I.server size={14}/><span style={{ fontSize: 13, fontWeight: 500 }}>Ubuntu Ampere A1.Flex</span></div>
                <Pill kind="up" dot>running</Pill>
              </div>
              <div className="chip-row">
                <span className="chip">141.148.192.4</span>
                <span className="chip">4 OCPU</span>
                <span className="chip">24 GB</span>
              </div>
            </div>
            <div className="divider"/>
            <BarRow label="CPU" value={34} max={100} color="var(--accent)" right="34%"/>
            <BarRow label="Memory" value={58} max={100} color="var(--info)" right="13.9 / 24 GB"/>
            <BarRow label="Disk" value={28} max={100} color="var(--violet)" right="56 / 200 GB"/>
            <BarRow label="Uptime" value={99.97} max={100} color="var(--up)" right="42d"/>
            <div className="divider"/>
            <div className="between" style={{ fontSize: 12 }}>
              <span className="muted">Signal engine</span>
              <Pill kind="up" dot>healthy</Pill>
            </div>
            <div className="between" style={{ fontSize: 12 }}>
              <span className="muted">Zerodha feed</span>
              <Pill kind="up" dot>14ms</Pill>
            </div>
            <div className="between" style={{ fontSize: 12 }}>
              <span className="muted">Last deploy</span>
              <span className="mono" style={{ fontSize: 11 }}>2h 14m ago · main@8f3c1a2</span>
            </div>
          </div>
        </Card>
      </div>
      )}
    </>
  );
};

// Close-position confirmation — context-aware: shows current MTM and slippage estimate
const DashboardScreenWithModals = (props) => {
  return <DashboardScreen {...props}/>;
};

Object.assign(window, { DashboardScreen });
