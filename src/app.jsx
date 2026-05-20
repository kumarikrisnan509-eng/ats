/* eslint-disable */
/* App root — routes between screens, handles pre-auth flow */

const TITLES = {
  // T100 (v9 reduction): removed abtest/news/regime/benchmark/copy/infra/mobile.
  // Kept review + tuner for hash-direct access while hidden from nav.
  dashboard:  ["Overview",     "Dashboard"],
  modes:      ["Automate",     "Trading modes"],
  strategies: ["Automate",     "Strategies"],
  signals:    ["Automate",     "AI Signals"],
  tuner:      ["Automate",     "Auto-tuner"],
  trading:    ["Execute",      "Live trading"],
  audit:      ["Execute",      "Order audit trail"],
  paper:      ["Validate",     "Paper trading"],
  backtest:   ["Validate",     "Backtest lab"],
  circuits:   ["Validate",     "Circuit breakers"],
  portfolio:  ["Wealth",       "Portfolio"],
  stpswp:     ["Wealth",       "STP / SWP plans"],
  smallcase:  ["Wealth",       "Smallcases"],
  fixed:      ["Wealth",       "Fixed income & REITs"],
  harvest:    ["Wealth",       "Tax-loss harvest"],
  brokers:    ["Wealth",       "Brokers"],
  risk:       ["System",       "Risk controls"],
  compliance: ["System",       "Compliance"],
  settings:   ["System",       "Settings"],
  review:     ["Operations",  "AI monthly review"],
  recon:      ["Operations",  "Broker reconciliation"],
  attribution:["Operations",  "PnL attribution"],
  margin:     ["Execute",     "Margin calculator"],
  profile:    ["Account",      "Profile"],
  money:      ["Wealth",       "Money (profits → long-term)"],
  lab:        ["Validate",     "Strategy Lab"],
  insights:   ["Wealth",       "AI insights"],
  // T-248: mf -> longterm (ETF baskets; Kite MF API is read-only by SEBI)
  longterm:   ["Long-term",   "Long-term basket"],
  'ai-keys':  ["System",       "AI providers"],
};

// Pre-auth hash routes — bypass the whole shell
// Tier 67: signup is the new register; verify+reset added in Tier 51/52.
const AUTH_ROUTES = new Set(["login", "signup", "register", "forgot", "reset", "verify"]);

function App() {
  // Auth state — fetched from /api/auth/me on boot (Tier 50). Until that lands,
  // assume not-authed. localStorage cache speeds up first paint but is overridden
  // by the server's view once /me returns.
  const [session, setSession] = useState(() => {
    try {
      const cached = JSON.parse(localStorage.getItem("rc_session") || "null");
      return cached && cached.authed ? cached : { authed: false, onboarded: false };
    } catch { return { authed: false, onboarded: false }; }
  });
  const persist = (s) => { try { localStorage.setItem("rc_session", JSON.stringify(s)); } catch (e) { console.debug('[app] swallowed:', e && e.message); } setSession(s); };

  // Boot probe: ask the server who we are. If 401, drop to login screen.
  // Tier 59: also expose user globally + broker connection status so screens
  // can read the logged-in user's name (NOT the broker's account holder) and
  // demo banners can gate on auth state.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/auth/me', { credentials: 'include' });
        if (cancelled) return;
        if (r.status === 200) {
          const j = await r.json();
          persist({ authed: true, onboarded: true, user: j.user });
          window.atsCurrentUser = j.user;
          fetch('/api/me/broker', { credentials: 'include' })
            .then(rr => rr.ok ? rr.json() : null)
            .then(b => {
              window.atsBrokerStatus = b && b.brokers && b.brokers.length > 0
                ? { connected: true, hasAccessToken: !!b.brokers[0].has_access_token, broker: b.brokers[0] }
                : { connected: false };
              window.dispatchEvent(new CustomEvent('ats-auth-changed', { detail: { user: j.user, broker: window.atsBrokerStatus } }));
            }).catch(e => console.warn('[app] promise rejected:', e && e.message));
        } else {
          persist({ authed: false, onboarded: false });
          window.atsCurrentUser = null;
          window.atsBrokerStatus = { connected: false };
          window.dispatchEvent(new CustomEvent('ats-auth-changed', { detail: { user: null } }));
        }
      } catch (_) { /* network blip; keep cached state */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const [route, setRoute] = useState(() => location.hash.replace("#", "") || "dashboard");
  // T87: bump tick when late-loading screen scripts register themselves so screens map re-evaluates
  const [_screenTick, _setScreenTick] = useState(0);
  useEffect(() => {
    const h = () => _setScreenTick(t => t + 1);
    window.addEventListener('screens-changed', h);
    // Re-poll once 500ms after mount to catch any scripts that loaded after first render
    const t = setTimeout(h, 500);
    return () => { window.removeEventListener('screens-changed', h); clearTimeout(t); };
  }, []);
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute("data-theme") || "light");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    const onHash = () => setRoute(location.hash.replace("#", "") || "dashboard");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Listen for logout from ProfileMenu
  useEffect(() => {
    const onLogout = () => {
      persist({ authed: false, onboarded: false });
      location.hash = "login";
    };
    window.addEventListener("logout", onLogout);
    return () => window.removeEventListener("logout", onLogout);
  }, []);

  const go = (r) => { location.hash = r; setRoute(r); window.scrollTo(0, 0); };

  // === Command palette (⌘K / Ctrl+K) + go-to shortcuts (G+letter) + ? overlay ===
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [density, setDensity] = useState(() => localStorage.getItem("rc_density") || "comfortable");
  useEffect(() => { document.documentElement.setAttribute("data-density", density); localStorage.setItem("rc_density", density); }, [density]);
  const goRef = useRef({ armed: false, t: 0 });
  useEffect(() => {
    const SHORT = { d: "dashboard", t: "trading", s: "strategies", p: "portfolio", r: "risk", a: "audit", b: "backtest", m: "modes", g: "goals" };
    const onKey = (e) => {
      const tag = (e.target.tagName || "").toLowerCase();
      const typing = tag === "input" || tag === "textarea" || e.target.isContentEditable;
      const meta = e.metaKey || e.ctrlKey;
      if (meta && (e.key === "k" || e.key === "K")) { e.preventDefault(); setPaletteOpen(o => !o); return; }
      if (meta && e.shiftKey && (e.key === "l" || e.key === "L")) { e.preventDefault(); setTheme(t => t === "dark" ? "light" : "dark"); return; }
      if (!typing && e.key === "?" ) { e.preventDefault(); setShortcutsOpen(o => !o); return; }
      if (!typing && !meta && (e.key === "g" || e.key === "G")) { goRef.current = { armed: true, t: Date.now() }; return; }
      if (!typing && !meta && goRef.current.armed && Date.now() - goRef.current.t < 1500) {
        const r = SHORT[e.key.toLowerCase()];
        if (r) { e.preventDefault(); location.hash = r; setRoute(r); }
        goRef.current.armed = false;
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("open-palette", () => setPaletteOpen(true));
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const handleAction = (actId) => {
    if (actId === "act:kill")    window.dispatchEvent(new CustomEvent("kill-switch"));
    if (actId === "act:pause") {
      // T-178 (F-6 fix): removed placeholder alert(). Real bulk-pause needs a
      // POST /api/risk/pause-all endpoint that isn't yet implemented. Route
      // the user to the Modes screen where they can toggle modes individually.
      window.location.hash = "#modes";
    }
    if (actId === "act:theme")   setTheme(t => t === "dark" ? "light" : "dark");
    if (actId === "act:logout")  window.dispatchEvent(new CustomEvent("logout"));
  };

  // === Pre-auth view ===
  // Tier 61: anonymous visitors landing on '/' (or 'dashboard' / no-hash) get the
  // marketing landing page. They only get the auth form if they explicitly route
  // to /#login, /#signup, /#forgot, /#reset, /#verify.
  if (!session.authed) {
    const handleAuth = () => {
      const isNewAccount = (route === "signup" || route === "register");
      persist({ authed: true, onboarded: !isNewAccount });
      location.hash = isNewAccount ? "" : "dashboard";
      setRoute("dashboard");
    };
    if (AUTH_ROUTES.has(route)) {
      return <LoginScreen onAuth={handleAuth} go={go}/>;
    }
    // Anonymous on dashboard / any non-auth route -> landing page.
    if (window.LandingScreen) return <window.LandingScreen/>;
    // Fallback if landing module hasn't loaded yet
    return <LoginScreen onAuth={handleAuth} go={go}/>;
  }
  // Tier 61: an authenticated user who navigates to /#login / /#signup /etc
  // probably wanted to switch accounts -- show the auth form.
  if (AUTH_ROUTES.has(route)) {
    const handleAuth = () => {
      persist({ authed: true, onboarded: true });
      location.hash = "dashboard";
      setRoute("dashboard");
    };
    return <LoginScreen onAuth={handleAuth} go={go}/>;
  }

  // === Onboarding wizard — first-run, full-screen overlay ===
  if (!session.onboarded) {
    return (
      <OnboardingWizard onComplete={() => {
        persist({ ...session, onboarded: true });
        location.hash = "dashboard";
        setRoute("dashboard");
      }}/>
    );
  }

  // === Main app shell ===
  const screens = {
    // T100 (v9 reduction): removed abtest/news/regime/benchmark/copy/infra/mobile
    // (broken/fake/legally-blocked). tuner and review still routable via hash
    // for direct-link access but hidden from the sidebar.
    dashboard:  <DashboardScreen/>,
    signals:    <SignalsScreen/>,
    tuner:      <TunerScreen/>,
    modes:      <ModesScreen/>,
    strategies: <StrategiesScreen/>,
    paper:      <PaperScreen/>,
    backtest:   <BacktestScreen/>,
    trading:    <TradingScreen/>,
    audit:      <AuditScreen/>,
    circuits:   <CircuitsScreen/>,
    portfolio:  <PortfolioScreen/>,
    stpswp:     <StpSwpScreen/>,
    smallcase:  <SmallcaseScreen/>,
    fixed:      <FixedIncomeScreen/>,
    harvest:    <HarvestScreen/>,
    brokers:    <BrokersScreen/>,
    risk:       <RiskScreen/>,
    compliance: <ComplianceScreen/>,
    settings:   <SettingsScreen/>,
    review:     <AIReviewScreen/>,
    recon:      <ReconScreen/>,
    attribution:<AttributionScreen/>,
    margin:     <MarginScreen/>,
    profile:    <ProfileScreen/>,
    money:      window.MoneyScreen ? <window.MoneyScreen/> : null,
    lab:        window.StrategyLabScreen ? <window.StrategyLabScreen/> : null,
    'ai-keys':  window.AiKeysScreen ? <window.AiKeysScreen/> : null,
    // T-248: mf route retired; replaced by longterm ETF basket screen.
    longterm:   window.LongTermScreen ? <window.LongTermScreen/> : null,
  };

  const [crumb, title] = TITLES[route] || TITLES.dashboard;

  return (
    <div className="app">
      {window.DemoBanner && <window.DemoBanner/>}
      <Sidebar route={route} setRoute={go}/>
      <div className="main">
        <TopBar title={title} crumb={crumb} theme={theme} setTheme={setTheme} setRoute={go}/>
        {window.NetworkStatus && <window.NetworkStatus/>}
        {window.BrokerNotConnectedBanner && <window.BrokerNotConnectedBanner setRoute={go}/>}
        {window.TickerStallBanner && <window.TickerStallBanner setRoute={go}/>}
        {window.ActiveAutomationStrip && <window.ActiveAutomationStrip setRoute={go}/>}
        <LiveTicker/>
        <div className="content" data-screen-label={title}>
          <window.ErrorBoundary>
            {screens[route] || screens.dashboard}
          </window.ErrorBoundary>
        </div>
      </div>
      {window.ToastHost && <window.ToastHost/>}
      {window.OrderToastBridge && <window.OrderToastBridge/>}
      {window.AIAssistant && <window.AIAssistant/>}
      {window.ReplayMode && <window.ReplayMode/>}
      {window.ModeSwitchOverlay && <window.ModeSwitchOverlay/>}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onNavigate={go}
        onAction={handleAction}
      />
      {shortcutsOpen && (
        <div onClick={() => setShortcutsOpen(false)} style={{ position: "fixed", inset: 0, background: "oklch(0% 0 0 / 0.5)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={e => e.stopPropagation()} style={{ width: 520, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 24, fontSize: 13 }}>
            <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 16 }}>Keyboard shortcuts</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 24px" }}>
              {[
                ["⌘K", "Command palette"], ["⌘⇧L", "Toggle theme"], ["?", "This panel"],
                ["G D", "Dashboard"], ["G T", "Trading"], ["G S", "Strategies"],
                ["G P", "Portfolio"], ["G R", "Risk"], ["G A", "Audit trail"],
                ["G B", "Backtest"], ["G N", "News"], ["G M", "Modes"], ["G G", "Goals"],
              ].map(([k, l]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                  <span style={{ color: "var(--text-2)" }}>{l}</span>
                  <span style={{ fontFamily: "var(--mono)", background: "var(--bg-soft)", padding: "2px 8px", borderRadius: 4, fontSize: 11 }}>{k}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", gap: 6 }}>
                <span style={{ fontSize: 12, color: "var(--text-3)" }}>Density:</span>
                {["compact","comfortable","spacious"].map(d => (
                  <button key={d} onClick={() => setDensity(d)} style={{
                    fontSize: 11, padding: "3px 8px", borderRadius: 4,
                    background: density === d ? "var(--accent)" : "var(--bg-soft)",
                    color: density === d ? "white" : "var(--text-2)",
                    border: "1px solid var(--border)",
                  }}>{d}</button>
                ))}
              </div>
              <button onClick={() => setShortcutsOpen(false)} style={{ fontSize: 11, color: "var(--text-3)" }}>Close (Esc)</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App/>);
