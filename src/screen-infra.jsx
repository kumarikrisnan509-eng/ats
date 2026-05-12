/* eslint-disable */
/* Infrastructure screen — Oracle Cloud Ubuntu Ampere */

const InfraScreen = () => {
  const processes = [
    { n: "trading-engine",   pid: 14221, cpu: 12.4, mem: 1840, up: "5d 14h", st: "running", modes: ["intraday","swing","options","futures"] },
    { n: "signal-worker",    pid: 14289, cpu: 8.1,  mem: 920,  up: "5d 14h", st: "running", modes: ["intraday","swing","options","futures"] },
    { n: "ai-router",        pid: 14301, cpu: 4.2,  mem: 640,  up: "5d 14h", st: "running", modes: ["intraday","swing","options","futures"] },
    { n: "broker-zerodha",   pid: 14312, cpu: 2.1,  mem: 320,  up: "5d 14h", st: "running", modes: ["intraday","swing","options","futures"] },
    { n: "risk-monitor",     pid: 14340, cpu: 1.4,  mem: 220,  up: "5d 14h", st: "running", modes: ["intraday","swing","options","futures"] },
    { n: "options-engine",   pid: 14355, cpu: 3.6,  mem: 480,  up: "5d 14h", st: "running", modes: ["options"] },
    { n: "futures-rollover", pid: 14360, cpu: 0.2,  mem:  80,  up: "5d 14h", st: "running", modes: ["futures"] },
    { n: "swing-scanner",    pid: 14362, cpu: 1.1,  mem: 240,  up: "5d 14h", st: "running", modes: ["swing"] },
    { n: "webhooks",         pid: 14402, cpu: 0.8,  mem: 180,  up: "5d 14h", st: "running", modes: [] },
    { n: "postgres",         pid: 1221,  cpu: 3.2,  mem: 2840, up: "42d",    st: "running", modes: [] },
    { n: "redis",            pid: 1482,  cpu: 0.4,  mem: 140,  up: "42d",    st: "running", modes: [] },
    { n: "nginx",            pid: 1120,  cpu: 0.2,  mem: 48,   up: "42d",    st: "running", modes: [] },
    { n: "backtest-runner",  pid: 18922, cpu: 0,    mem: 0,    up: "—",      st: "stopped", modes: [] },
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
