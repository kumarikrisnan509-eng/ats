/* eslint-disable */
/* Infrastructure screen — Oracle Cloud Ubuntu Ampere */

const InfraScreen = () => {
  // Live system info from /api/system/info.
  const [sysInfo, setSysInfo] = React.useState(null);
  React.useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const j = await window.fetchApi('/api/system/info');
        if (!cancelled) setSysInfo(j);
      } catch (e) { /* keep previous state */ }
    };
    refresh();
    const id = setInterval(refresh, 10000); // poll every 10s
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const fmtUp = (sec) => {
    if (!sec || sec < 0) return "--";
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  // Synthesize a "processes" list from the real running components in the backend.
  // The Node container is one process; the components inside it (broker/alerts/scanner/watchlist)
  // are logical subsystems we surface as rows so the UI feels alive.
  const uptime = sysInfo && sysInfo.process ? sysInfo.process.uptimeSec : 0;
  const broker = sysInfo && sysInfo.broker;
  const cmp = (sysInfo && sysInfo.components) || {};
  const memMB = sysInfo && sysInfo.process ? sysInfo.process.memMB : 0;
  const processes = [
    { n: "ats-backend (node)", pid: sysInfo && sysInfo.process ? sysInfo.process.pid : "--", cpu: "n/a", mem: memMB,
      up: fmtUp(uptime), st: "running", modes: ["intraday","swing","options","futures"] },
    { n: "broker (" + (broker ? broker.name : "unknown") + ")", pid: "--", cpu: broker && broker.connected ? "live" : "stale",
      mem: broker && broker.instruments ? Math.round(broker.instruments.size / 1000) + "k instr" : "--",
      up: fmtUp(uptime), st: broker && broker.connected ? "running" : "disconnected", modes: ["intraday","swing","options","futures"] },
    { n: "alerts evaluator", pid: "--", cpu: cmp.alerts ? (cmp.alerts.evals || 0) + " evals" : "--",
      mem: cmp.alerts ? cmp.alerts.total + " active" : "--",
      up: fmtUp(uptime), st: cmp.alerts ? "running" : "stopped", modes: [] },
    { n: "scanner", pid: "--", cpu: cmp.scanner && cmp.scanner.lastRun ? "scanned " + cmp.scanner.lastRun.scanned : "--",
      mem: cmp.scanner ? cmp.scanner.historyCount + " signals" : "--",
      up: fmtUp(uptime), st: cmp.scanner ? "running" : "stopped", modes: [] },
    { n: "watchlist", pid: "--", cpu: "--",
      mem: cmp.watchlist ? cmp.watchlist.count + " symbols" : "--",
      up: fmtUp(uptime), st: cmp.watchlist ? "running" : "stopped", modes: [] },
    { n: "nginx (host)", pid: "--", cpu: "n/a", mem: "n/a", up: "host", st: "running", modes: [] },
    { n: "audit log", pid: "--", cpu: sysInfo && sysInfo.auditLog ? "seq " + sysInfo.auditLog.seq : "--",
      mem: sysInfo && sysInfo.auditLog ? Math.round((sysInfo.auditLog.sizeBytes || 0) / 1024) + " KB" : "--",
      up: "host", st: "running", modes: [] },
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-header__title">Infrastructure</h1>
          <div className="page-header__sub">Oracle Cloud Ampere A1.Flex · Mumbai · deployed via GitHub Actions</div>
        </div>
        <div className="page-header__right">
          <button className="btn"><I.refresh size={14}/> Redeploy</button>
          <button className="btn btn--primary">SSH console</button>
        </div>
      </div>

      <Card style={{ marginBottom: 16 }}>
        <div className="row" style={{ gap: 20, alignItems: "stretch" }}>
          <div style={{ width: 58, height: 58, borderRadius: 14, background: "linear-gradient(135deg, var(--accent), var(--violet))", color: "white", display: "grid", placeItems: "center" }}>
            <I.server size={26}/>
          </div>
          <div style={{ flex: 1 }}>
            <div className="row" style={{ marginBottom: 4 }}>
              <div style={{ fontSize: 17, fontWeight: 600 }}>Ubuntu Ampere</div>
              <Pill kind="up" dot>running</Pill>
              <Pill>Always Free Tier</Pill>
            </div>
            <div className="muted" style={{ fontSize: 13 }}>VM.Standard.A1.Flex · AD-1 · FD-2 · Mumbai (ap-mumbai-1)</div>
            <div className="chip-row" style={{ marginTop: 10 }}>
              <span className="chip">Public 141.148.192.4</span>
              <span className="chip">Private 10.0.0.95</span>
              <span className="chip">4 OCPU</span>
              <span className="chip">24 GB RAM</span>
              <span className="chip">200 GB SSD</span>
              <span className="chip">Ubuntu 22.04 LTS</span>
              <span className="chip">Python 3.12</span>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Card title="CPU">
          <div style={{ display: "flex", justifyContent: "center", margin: "8px 0" }}>
            <Donut size={130} thickness={14} data={[{ value: 34, color: "var(--accent)" }, { value: 66, color: "var(--bg-sunk)" }]}>
              <div><div className="mono" style={{ fontSize: 22, fontWeight: 600 }}>34%</div><div className="muted" style={{ fontSize: 10 }}>4 cores</div></div>
            </Donut>
          </div>
          <Sparkline data={seriesRandom(1, 30, 10, 60, 0)} color="var(--accent)"/>
        </Card>
        <Card title="Memory">
          <div style={{ display: "flex", justifyContent: "center", margin: "8px 0" }}>
            <Donut size={130} thickness={14} data={[{ value: 58, color: "var(--info)" }, { value: 42, color: "var(--bg-sunk)" }]}>
              <div><div className="mono" style={{ fontSize: 22, fontWeight: 600 }}>58%</div><div className="muted" style={{ fontSize: 10 }}>13.9 / 24 GB</div></div>
            </Donut>
          </div>
          <Sparkline data={seriesRandom(2, 30, 40, 70, 0)} color="var(--info)"/>
        </Card>
        <Card title="Disk">
          <div style={{ display: "flex", justifyContent: "center", margin: "8px 0" }}>
            <Donut size={130} thickness={14} data={[{ value: 28, color: "var(--violet)" }, { value: 72, color: "var(--bg-sunk)" }]}>
              <div><div className="mono" style={{ fontSize: 22, fontWeight: 600 }}>28%</div><div className="muted" style={{ fontSize: 10 }}>56 / 200 GB</div></div>
            </Donut>
          </div>
          <Sparkline data={seriesRandom(3, 30, 20, 30, 0.05)} color="var(--violet)"/>
        </Card>
        <Card title="Network">
          <div style={{ display: "flex", justifyContent: "center", margin: "8px 0" }}>
            <Donut size={130} thickness={14} data={[{ value: 18, color: "var(--up)" }, { value: 82, color: "var(--bg-sunk)" }]}>
              <div><div className="mono" style={{ fontSize: 22, fontWeight: 600 }}>4.2</div><div className="muted" style={{ fontSize: 10 }}>Mbps · Zerodha WS</div></div>
            </Donut>
          </div>
          <Sparkline data={seriesRandom(4, 30, 20, 80, 0)} color="var(--up)"/>
        </Card>
      </div>

      <div className="grid grid-2-1" style={{ marginBottom: 16 }}>
        <Card title="Processes" sub="systemd + supervisord · mode tag shows which trading modes depend on this service" flush>
          <table className="table">
            <thead><tr><th>Service</th><th className="num-l">PID</th><th className="num-l">CPU %</th><th className="num-l">Mem MB</th><th className="num-l">Uptime</th><th>Modes</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {processes.map((p, i) => (
                <tr key={i}>
                  <td><span className="mono" style={{ fontSize: 12 }}>{p.n}</span></td>
                  <td className="num">{p.pid || "—"}</td>
                  <td className="num">{p.cpu.toFixed(1)}</td>
                  <td className="num">{p.mem}</td>
                  <td className="num">{p.up}</td>
                  <td>
                    {p.modes.length === 0 ? (
                      <span className="muted" style={{ fontSize: 11 }}>shared</span>
                    ) : p.modes.length === 4 ? (
                      <span className="muted" style={{ fontSize: 11 }}>all modes</span>
                    ) : (
                      <span className="row" style={{ gap: 4, flexWrap: "wrap" }}>
                        {p.modes.map(m => {
                          const meta = window.MODE_META[m];
                          return (
                            <span key={m} className="row" style={{ gap: 3, padding: "1px 6px", borderRadius: 4, background: meta.colorSoft, fontSize: 10, fontFamily: "var(--mono)", color: meta.color, fontWeight: 500 }}>
                              <span style={{ width: 4, height: 4, borderRadius: "50%", background: meta.color }}/>
                              {meta.shortLabel}
                            </span>
                          );
                        })}
                      </span>
                    )}
                  </td>
                  <td>{p.st === "running" ? <Pill kind="up" dot>running</Pill> : <Pill>stopped</Pill>}</td>
                  <td><button className="btn btn--sm">{p.st === "running" ? "Restart" : "Start"}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Deployments" sub="GitHub → main branch">
          <div className="col" style={{ gap: 12 }}>
            {[
              { c: "8f3c1a2", m: "feat: gold-USDINR pair strategy", at: "2h 14m ago", st: "up", who: "rajasekar" },
              { c: "2d7a91c", m: "fix: zerodha reconnect jitter",   at: "Yesterday", st: "up", who: "rajasekar" },
              { c: "4e88b10", m: "chore: bump python to 3.12",      at: "3d ago",    st: "up", who: "rajasekar" },
              { c: "7f211ae", m: "feat: iron condor paper mode",    at: "6d ago",    st: "up", who: "rajasekar" },
            ].map((d, i) => (
              <div key={i} style={{ padding: 12, border: "1px solid var(--border)", borderRadius: "var(--r-md)" }}>
                <div className="between">
                  <span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>main@{d.c}</span>
                  <Pill kind={d.st === "up" ? "up" : "down"} dot>{d.st === "up" ? "success" : "failed"}</Pill>
                </div>
                <div style={{ fontSize: 13, fontWeight: 500, marginTop: 6 }}>{d.m}</div>
                <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{d.who} · {d.at}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card title="Broker data lineage" sub="Every field the UI shows, and where it comes from in production" flush>
        <table className="table">
          <thead>
            <tr>
              <th>Field</th>
              <th>Broker endpoint</th>
              <th>Refresh</th>
              <th>Cache layer</th>
            </tr>
          </thead>
          <tbody>
            {window.BROKER_SOURCES.map((s, i) => (
              <tr key={i}>
                <td style={{ fontWeight: 500 }}>{s.field}</td>
                <td className="mono" style={{ fontSize: 12, color: "var(--text-2)" }}>{s.endpoint}</td>
                <td className="mono" style={{ fontSize: 12 }}>{s.freq}</td>
                <td className="mono" style={{ fontSize: 12, color: "var(--text-3)" }}>{s.cache}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Logs (tail)" sub="journalctl -fu trading-engine" flush>
        <pre style={{ margin: 0, padding: 16, fontFamily: "var(--mono)", fontSize: 11, lineHeight: 1.6, color: "var(--text-2)", background: "var(--bg-sunk)", overflowX: "auto" }}>{
`[${window.TODAY_ISO} 14:41:08]  INFO  trading-engine  order.placed  RELIANCE BUY 40 @ 2948.50  strat=mean-reversion  broker=zerodha  ms=42
[${window.TODAY_ISO} 14:41:09]  INFO  broker-zerodha  kite.order_id  240424000012472
[${window.TODAY_ISO} 14:41:10]  INFO  trading-engine  order.filled  id=240424000012472  avg=2948.55
[${window.TODAY_ISO} 14:41:42]  INFO  signal-worker   signal.emit   HDFCBANK  conf=0.82  src=claude-haiku-4.5
[${window.TODAY_ISO} 14:41:43]  INFO  ai-router       signal.route  → paper  (auto-promote below conf 0.70 disabled)
[${window.TODAY_ISO} 14:42:02]  WARN  risk-monitor    check.near_cap  grid-trader daily_loss=70%  pause_30m
[${window.TODAY_ISO} 14:42:02]  INFO  trading-engine  strategy.pause  grid-trader
[${window.TODAY_ISO} 14:42:11]  INFO  signal-worker   tick.lag_ok   avg=14ms  p99=38ms  (NSE ws)
[${window.TODAY_ISO} 14:43:00]  INFO  trading-engine  heartbeat     active=3  paused=1  orders_open=1`
        }</pre>
      </Card>
    </>
  );
};

Object.assign(window, { InfraScreen });
