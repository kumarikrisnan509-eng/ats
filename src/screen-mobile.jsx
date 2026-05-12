/* eslint-disable */
/* Mobile companion — iOS frame showing dashboard, kill switch, approve signals on-the-go */

const MobileScreen = () => {
  const [view, setView] = React.useState("dashboard");

  const Screen = ({ children }) => (
    <div style={{
      width: 320, height: 640, background: "var(--bg)", border: "1px solid var(--border)",
      borderRadius: 36, overflow: "hidden", position: "relative",
      boxShadow: "0 20px 60px rgba(0,0,0,0.15), 0 0 0 8px #1a1a1a, 0 0 0 10px #333",
    }}>
      {/* Notch */}
      <div style={{ position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)", width: 120, height: 28, background: "#1a1a1a", borderRadius: "0 0 18px 18px", zIndex: 10 }}/>
      {/* Status bar */}
      <div style={{ padding: "14px 22px 6px", display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 600 }}>
        <div>9:41</div>
        <div style={{ display: "flex", gap: 4 }}><span>●●●●</span><span>📶</span><span>🔋</span></div>
      </div>
      {children}
    </div>
  );

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
          System · Mobile companion (iOS preview)
        </div>
        <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 4, maxWidth: 720 }}>
          The mobile app is a companion to the web platform — not a replacement. Core operations (dashboard glance, approve/reject signals, emergency kill switch) are one tap away. All heavy work (backtests, strategy config) stays on web.
        </div>
      </div>

      <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
        {[{k:"dashboard",l:"Home"},{k:"signals",l:"Approve signals"},{k:"kill",l:"Emergency"},{k:"notif",l:"Alerts"}].map(t => (
          <button key={t.k} className={view === t.k ? "btn btn-primary" : "btn btn-ghost"} style={{ fontSize: 12 }} onClick={() => setView(t.k)}>{t.l}</button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 28, alignItems: "flex-start" }}>
        <Screen>
          {view === "dashboard" && (
            <div style={{ padding: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                <div>
                  <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase" }}>Good morning, Raja</div>
                  <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }}>Market opens in 22m</div>
                </div>
                <div style={{ width: 36, height: 36, borderRadius: 18, background: "var(--acc-soft)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700 }}>R</div>
              </div>

              <div style={{ padding: 18, background: "linear-gradient(135deg, var(--acc) 0%, oklch(50% 0.14 195) 100%)", color: "white", borderRadius: 16, marginBottom: 14 }}>
                <div style={{ fontSize: 10, opacity: 0.8, fontWeight: 600, textTransform: "uppercase" }}>Portfolio</div>
                <div className="mono" style={{ fontSize: 28, fontWeight: 700, marginTop: 6 }}>₹12,48,200</div>
                <div style={{ fontSize: 12, opacity: 0.9, marginTop: 4 }}>+₹24,800 today (+2.02%)</div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
                <div style={{ padding: 12, background: "var(--bg-soft)", borderRadius: 12 }}>
                  <div style={{ fontSize: 9, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase" }}>Open positions</div>
                  <div className="mono" style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>8</div>
                </div>
                <div style={{ padding: 12, background: "var(--bg-soft)", borderRadius: 12 }}>
                  <div style={{ fontSize: 9, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase" }}>Pending</div>
                  <div className="mono" style={{ fontSize: 18, fontWeight: 700, marginTop: 4, color: "var(--acc)" }}>3</div>
                </div>
              </div>

              <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase", marginBottom: 8 }}>Pipeline health</div>
              <div style={{ padding: 12, background: "var(--bg-soft)", borderRadius: 12 }}>
                {[["AI signals","●","up"],["Zerodha","●","up"],["Risk engine","●","up"]].map(([n,d,c], i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 12 }}>
                    <span>{n}</span>
                    <span style={{ color: `var(--${c})` }}>{d} Live</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {view === "signals" && (
            <div style={{ padding: 18 }}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Awaiting approval</div>
              <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 16 }}>3 signals need your sign-off</div>

              {[
                { sym: "RELIANCE", side: "BUY", px: 2843, conf: 82, pnl: "+₹4,200", reason: "Gap-up with high volume" },
                { sym: "TCS",      side: "SELL", px: 4148, conf: 68, pnl: "+₹2,400", reason: "RSI overbought, mean reversion" },
              ].map((s, i) => (
                <div key={i} style={{ padding: 14, background: "var(--bg-soft)", borderRadius: 14, marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{s.sym}</div>
                    <Chip variant={s.side === "BUY" ? "up" : "down"}>{s.side}</Chip>
                  </div>
                  <div style={{ display: "flex", gap: 12, marginBottom: 8, fontSize: 11 }}>
                    <div><span style={{ color: "var(--text-3)" }}>Entry:</span> <span className="mono">₹{s.px}</span></div>
                    <div><span style={{ color: "var(--text-3)" }}>Conf:</span> <span className="mono">{s.conf}%</span></div>
                    <div><span style={{ color: "var(--text-3)" }}>Exp:</span> <span className="mono" style={{ color: "var(--up)" }}>{s.pnl}</span></div>
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-2)", marginBottom: 10, fontStyle: "italic" }}>{s.reason}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                    <button style={{ padding: "8px", background: "var(--down-soft)", color: "var(--down)", borderRadius: 8, fontSize: 12, fontWeight: 600, border: "none" }}>Reject</button>
                    <button style={{ padding: "8px", background: "var(--up)", color: "white", borderRadius: 8, fontSize: 12, fontWeight: 600, border: "none" }}>Approve ✓</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {view === "kill" && (
            <div style={{ padding: 18, height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", textAlign: "center" }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>🛑</div>
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Emergency kill switch</div>
              <div style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 24, lineHeight: 1.5 }}>Cancel all open orders and flatten positions across all brokers. Irreversible.</div>

              <div style={{ padding: 14, background: "var(--bg-soft)", borderRadius: 12, width: "100%", marginBottom: 20, fontSize: 11, color: "var(--text-2)" }}>
                <div style={{ marginBottom: 6 }}><strong>8 open positions</strong> · ₹4,82,400 exposure</div>
                <div><strong>3 pending orders</strong> · will cancel immediately</div>
              </div>

              <div style={{
                width: "100%", padding: 18, background: "var(--down)", color: "white",
                borderRadius: 14, fontSize: 15, fontWeight: 700, textAlign: "center",
                boxShadow: "0 4px 20px oklch(55% 0.18 25 / 0.4)"
              }}>
                HOLD TO CONFIRM KILL
              </div>
              <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 12 }}>Will require Face ID + 2FA</div>
            </div>
          )}

          {view === "notif" && (
            <div style={{ padding: 18 }}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Alerts</div>
              {[
                { icon: "⚡", t: "Circuit breaker triggered", d: "PAYTM hit 10% lower, positions auto-exited", time: "2m ago", kind: "down" },
                { icon: "✓", t: "Target hit: RELIANCE", d: "+₹4,200 booked · position closed", time: "8m ago", kind: "up" },
                { icon: "📊", t: "Monthly AI review ready", d: "March 2026 · Net +11.2%", time: "1h ago", kind: "info" },
                { icon: "⚠", t: "Iron Condor recommendation", d: "AI suggests deactivating (3 AIs agree)", time: "2h ago", kind: "warn" },
                { icon: "🎯", t: "Goal progress: Retirement", d: "₹48L reached, 8% ahead of plan", time: "1d ago", kind: "up" },
              ].map((n, i) => {
                const colors = { up:"var(--up)", down:"var(--down)", warn:"oklch(65% 0.13 80)", info:"var(--info)" };
                return (
                  <div key={i} style={{ padding: "12px 0", borderBottom: "1px solid var(--border)", display: "flex", gap: 12 }}>
                    <div style={{ width: 34, height: 34, borderRadius: 10, background: "var(--bg-soft)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>{n.icon}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: colors[n.kind] }}>{n.t}</div>
                      <div style={{ fontSize: 11, color: "var(--text-2)", marginTop: 2 }}>{n.d}</div>
                      <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 4 }}>{n.time}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Screen>

        <div>
          <Card title="Mobile companion · key principles">
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {[
                { t: "Glance, not work", d: "Phone is for checking status, approving one-off signals, and emergency stops. Deep work happens on web." },
                { t: "Same kill switch", d: "The mobile kill switch uses the same backend as web. Triggered from either, both execute instantly." },
                { t: "Biometric gating", d: "Face ID / fingerprint required for any position-affecting action. Never auto-approve." },
                { t: "Offline-aware", d: "Shows last-known state with 'stale' badge if backend unreachable. Prevents accidental decisions on stale data." },
                { t: "Push notifications", d: "Circuit breakers, targets hit, AI monthly review, goal milestones. Configurable per category." },
                { t: "Broker-agnostic", d: "Works across Zerodha, Upstox, Dhan adapters — you see unified portfolio across all brokers in one view." },
              ].map((p, i) => (
                <div key={i} style={{ paddingBottom: 12, borderBottom: i < 5 ? "1px solid var(--border)" : "none" }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{p.t}</div>
                  <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 3, lineHeight: 1.5 }}>{p.d}</div>
                </div>
              ))}
            </div>
          </Card>

          <div style={{ marginTop: 14, padding: 14, background: "var(--acc-soft)", color: "var(--acc-ink)", borderRadius: "var(--r-md)", fontSize: 12, lineHeight: 1.6 }}>
            <strong>Build status:</strong> React Native bootstrap ready. Shared business logic via TS monorepo with web platform. Target MVP: Q3 2026 (Android first, iOS 2 weeks later). TestFlight invites for early users.
          </div>
        </div>
      </div>
    </>
  );
};

window.MobileScreen = MobileScreen;
