/* eslint-disable */
/* Copy-trading — follow verified traders, auto-mirror trades with YOUR risk limits */

const CopyScreen = () => {
  // Tier 17: this screen has zero backend wiring. Showing fully fabricated data in
  // production is a regulatory and trust risk. Demo-gated until a real backend
  // module lands. Enable Demo mode in your profile menu to preview the planned UI.
  const [_demo] = window.useDemoMode ? window.useDemoMode() : [false];
  if (!_demo) {
    return (
      <div style={{ padding: 24, maxWidth: 720, margin: '40px auto', textAlign: 'center' }}>
        <div style={{ fontSize: 12, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.6 }}>Copy trading</div>
        <div style={{ fontSize: 22, fontWeight: 600, marginTop: 4 }}>Coming soon</div>
        <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 8, lineHeight: 1.5 }}>
          This screen does not yet have a real backend wired. Until copy trading data is sourced from live broker / partner APIs, showing hardcoded sample data is misleading and unsafe.
          Enable <b>Demo mode</b> in your profile menu to preview the planned UI.
        </div>
        <div style={{ marginTop: 16, fontSize: 11, color: 'var(--text-3)' }}>
          Backend module: not yet implemented. Track progress in repo deploy/backend/.
        </div>
      </div>
    );
  }

  const [tab, setTab] = React.useState("discover");

  const following = [
    { name: "Rohan Mehta", handle: "@alpha_rohan", verified: true, style: "Intraday momentum", aum: "₹42 Cr", followers: 8420, youAllocated: 50000, pnl30d: 18.4, winRate: 62, maxDD: -8.2, copying: true, trades30d: 142 },
    { name: "Priya Shah",  handle: "@optionsqueen", verified: true, style: "Options writing",   aum: "₹18 Cr", followers: 4820, youAllocated: 25000, pnl30d: 12.8, winRate: 74, maxDD: -4.8, copying: true, trades30d: 38 },
  ];

  const discover = [
    { name: "Arjun Kapoor",   handle: "@swingmaster", verified: true, style: "Swing positional", aum: "₹28 Cr", followers: 6240, pnl30d: 14.2, winRate: 58, maxDD: -6.4, sharpe: 1.82, trades30d: 18, fee: "2% of profits" },
    { name: "Neha Iyer",      handle: "@iv_hunter",   verified: true, style: "IV-crush options", aum: "₹12 Cr", followers: 3420, pnl30d: 22.8, winRate: 68, maxDD: -12.4, sharpe: 1.48, trades30d: 42, fee: "20% of profits" },
    { name: "Vikram Singh",  handle: "@quantvik",    verified: true, style: "Stat arb pairs",  aum: "₹84 Cr", followers: 12800, pnl30d: 8.4, winRate: 54, maxDD: -3.2, sharpe: 2.14, trades30d: 248, fee: "1% mgmt + 15%" },
    { name: "Ananya Rao",    handle: "@defensive_ar",verified: true, style: "Low-vol equity", aum: "₹64 Cr", followers: 5620, pnl30d: 6.2, winRate: 72, maxDD: -2.4, sharpe: 1.94, trades30d: 12, fee: "1.5% mgmt" },
  ];

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
          Wealth · Copy trading
        </div>
        <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 4, maxWidth: 720 }}>
          Follow SEBI-verified RAs. Their signals get auto-translated to your book with YOUR risk limits, position sizing, and kill switch. You always stay in control — the platform won't exceed the caps you set.
        </div>
      </div>

      {window.Leaderboard && <div style={{ marginBottom: 16 }}><window.Leaderboard/></div>}

      {/* Your copy portfolio */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
        <Card>
          <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase" }}>Following</div>
          <div className="mono" style={{ fontSize: 28, fontWeight: 700, marginTop: 6 }}>2</div>
          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>traders actively copied</div>
        </Card>
        <Card>
          <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase" }}>Allocated</div>
          <div className="mono" style={{ fontSize: 28, fontWeight: 700, marginTop: 6 }}>₹75k</div>
          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>of ₹1.2L copy budget</div>
        </Card>
        <Card>
          <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase" }}>30d PnL from copy</div>
          <div className="mono" style={{ fontSize: 28, fontWeight: 700, marginTop: 6, color: "var(--up)" }}>+₹12,400</div>
          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>+16.5% on copy capital</div>
        </Card>
        <Card>
          <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase" }}>Fees paid</div>
          <div className="mono" style={{ fontSize: 28, fontWeight: 700, marginTop: 6 }}>₹1,240</div>
          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>Performance fees · 30d</div>
        </Card>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
        {[{k:"discover",l:"Discover"},{k:"following",l:"Following (2)"}].map(t => (
          <button key={t.k} className={tab === t.k ? "btn btn-primary" : "btn btn-ghost"} style={{ fontSize: 12 }} onClick={() => setTab(t.k)}>{t.l}</button>
        ))}
      </div>

      {tab === "discover" && (
        <Card title="Verified traders" sub="SEBI-registered RAs with audited performance">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
            {discover.map((t, i) => (
              <div key={i} style={{ padding: 16, border: "1px solid var(--border)", borderRadius: "var(--r-md)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{t.name}</div>
                      {t.verified && <div style={{ fontSize: 10, color: "var(--acc-ink)", background: "var(--acc-soft)", padding: "2px 6px", borderRadius: 4, fontWeight: 600 }}>SEBI-verified</div>}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "var(--mono)", marginTop: 2 }}>{t.handle}</div>
                    <div style={{ fontSize: 11, color: "var(--text-2)", marginTop: 6 }}>{t.style}</div>
                  </div>
                  <button className="btn btn-primary" style={{ fontSize: 11 }}>Copy</button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, padding: 10, background: "var(--bg-soft)", borderRadius: "var(--r-sm)" }}>
                  <div>
                    <div style={{ fontSize: 9, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase" }}>30d</div>
                    <div className="mono" style={{ fontSize: 13, fontWeight: 700, color: "var(--up)", marginTop: 2 }}>+{t.pnl30d}%</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase" }}>Win %</div>
                    <div className="mono" style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>{t.winRate}%</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase" }}>Max DD</div>
                    <div className="mono" style={{ fontSize: 13, fontWeight: 700, color: "var(--down)", marginTop: 2 }}>{t.maxDD}%</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase" }}>Sharpe</div>
                    <div className="mono" style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>{t.sharpe}</div>
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 10, color: "var(--text-3)" }}>
                  <span>{t.followers.toLocaleString("en-IN")} followers</span>
                  <span>{t.aum} AUM</span>
                  <span>{t.trades30d} trades/mo</span>
                  <span>Fee: {t.fee}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === "following" && (
        <Card title="Traders you copy" sub="Live positions mirrored into your book">
          {following.map((t, i) => (
            <div key={i} style={{ padding: "16px 0", borderBottom: i < following.length - 1 ? "1px solid var(--border)" : "none" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>{t.name}</div>
                    <div style={{ fontSize: 10, color: "var(--acc-ink)", background: "var(--acc-soft)", padding: "2px 6px", borderRadius: 4, fontWeight: 600 }}>SEBI</div>
                    <Chip variant="up">● Copying</Chip>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>{t.handle} · {t.style}</div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button className="btn btn-ghost" style={{ fontSize: 11 }}>Adjust limits</button>
                  <button className="btn btn-ghost" style={{ fontSize: 11, color: "var(--down)" }}>Stop copying</button>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10 }}>
                <div style={{ padding: 10, background: "var(--bg-soft)", borderRadius: "var(--r-sm)" }}>
                  <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase" }}>Allocated</div>
                  <div className="mono" style={{ fontSize: 15, fontWeight: 700, marginTop: 4 }}>₹{(t.youAllocated/1000).toFixed(0)}k</div>
                </div>
                <div style={{ padding: 10, background: "var(--bg-soft)", borderRadius: "var(--r-sm)" }}>
                  <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase" }}>30d return</div>
                  <div className="mono" style={{ fontSize: 15, fontWeight: 700, color: "var(--up)", marginTop: 4 }}>+{t.pnl30d}%</div>
                </div>
                <div style={{ padding: 10, background: "var(--bg-soft)", borderRadius: "var(--r-sm)" }}>
                  <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase" }}>Win %</div>
                  <div className="mono" style={{ fontSize: 15, fontWeight: 700, marginTop: 4 }}>{t.winRate}%</div>
                </div>
                <div style={{ padding: 10, background: "var(--bg-soft)", borderRadius: "var(--r-sm)" }}>
                  <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase" }}>Max DD</div>
                  <div className="mono" style={{ fontSize: 15, fontWeight: 700, color: "var(--down)", marginTop: 4 }}>{t.maxDD}%</div>
                </div>
                <div style={{ padding: 10, background: "var(--bg-soft)", borderRadius: "var(--r-sm)" }}>
                  <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase" }}>Trades/mo</div>
                  <div className="mono" style={{ fontSize: 15, fontWeight: 700, marginTop: 4 }}>{t.trades30d}</div>
                </div>
              </div>
              <div style={{ marginTop: 10, padding: 10, background: "var(--info-soft)", color: "var(--info)", borderRadius: "var(--r-sm)", fontSize: 11 }}>
                <strong>Your guardrails:</strong> Max 5% per position · Max ₹50k total · No options above 1.5 lots · Kill switch shared with main account
              </div>
            </div>
          ))}
        </Card>
      )}

      <div style={{ marginTop: 16, padding: 14, background: "var(--warn-soft)", color: "oklch(40% 0.12 80)", borderRadius: "var(--r-md)", fontSize: 12, lineHeight: 1.6 }}>
        <strong>Disclaimer:</strong> Past performance is not indicative of future results. Copy trading involves risk. All traders shown are SEBI-registered Research Analysts. Your capital is in your Zerodha account — we never hold funds. Fees shown are what traders charge; platform charges 0.25% on performance.
      </div>
    </>
  );
};

window.CopyScreen = CopyScreen;
