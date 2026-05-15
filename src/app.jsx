/* eslint-disable */
/* App root — routes between screens, handles pre-auth flow */

const TITLES = {
  dashboard:  ["Overview",     "Dashboard"],
  modes:      ["Automate",     "Trading modes"],
  strategies: ["Automate",     "Strategies"],
  signals:    ["Automate",     "AI Signals"],
  abtest:     ["Automate",     "A/B testing"],
  tuner:      ["Automate",     "Auto-tuner"],
  news:       ["Automate",     "News & sentiment"],
  trading:    ["Execute",      "Live trading"],
  audit:      ["Execute",      "Order audit trail"],
  paper:      ["Validate",     "Paper trading"],
  backtest:   ["Validate",     "Backtest lab"],
  circuits:   ["Validate",     "Circuit breakers"],
  portfolio:  ["Wealth",       "Portfolio"],
  goals:      ["Wealth",       "Life goals"],
  stpswp:     ["Wealth",       "STP / SWP plans"],
  smallcase:  ["Wealth",       "Smallcases"],
  fixed:      ["Wealth",       "Fixed income & REITs"],
  harvest:    ["Wealth",       "Tax-loss harvest"],
  tax:        ["Wealth",       "Tax & ITR"],
  brokers:    ["Wealth",       "Brokers"],
  risk:       ["System",       "Risk controls"],
  compliance: ["System",       "Compliance"],
  infra:      ["System",       "Infrastructure"],
  settings:   ["System",       "Settings"],
  review:     ["Operations",  "AI monthly review"],
  recon:      ["Operations",  "Broker reconciliation"],
  attribution:["Operations",  "PnL attribution"],
  copy:       ["Wealth",      "Copy trading"],
  mobile:     ["System",      "Mobile companion"],
  options:    ["Automate",    "Options strategy builder"],
  margin:     ["Execute",     "Margin calculator"],
  regime:     ["Automate",    "Market regime"],
  alerts:     ["Automate",    "Alerts builder"],
  benchmark:  ["Wealth",      "Benchmarking"],
  profile:    ["Account",      "Profile"],
  apidocs:    ["System",       "API & Webhooks"],
  compare:    ["Automate",     "Compare strategies"],
  money:      ["Wealth",       "Money (profits → long-term)"],
  lab:        ["Validate",     "Strategy Lab"],
};

// Pre-auth hash routes — bypass the whole shell
const AUTH_ROUTES = new Set(["login", "register", "forgot"]);

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
  const persist = (s) => { try { localStorage.setItem("rc_session", JSON.stringify(s)); } catch (_) {} setSession(s); };

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
          // Also probe broker connection so banners can decide demo vs live
          fetch('/api/me/broker', { credentials: 'include' })
            .then(rr => rr.ok ? rr.json() : null)
            .then(b => {
              window.atsBrokerStatus = b && b.brokers && b.brokers.length > 0
                ? { connected: true, hasAccessToken: !!b.brokers[0].has_access_token, broker: b.brokers[0] }
                : { connected: false };
              window.dispatchEvent(new CustomEvent('ats-auth-changed', { detail: { user: j.user, broker: window.atsBrokerStatus } }));
            }).catch(() => {});
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
    const SHORT = { d: "dashboard", t: "trading", s: "strategies", p: "portfolio", r: "risk", a: "audit", b: "backtest", n: "news", m: "modes", g: "goals" };
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
    if (actId === "act:pause")   alert("Paused all modes — placeholder");
    if (actId === "act:theme")   setTheme(t => t === "dark" ? "light" : "dark");
    if (actId === "act:logout")  window.dispatchEvent(new CustomEvent("logout"));
  };

  // === Pre-auth view: Login / Register / Forgot ===
  if (!session.authed || AUTH_ROUTES.has(route)) {
    const handleAuth = () => {
      const isNewAccount = route === "register";
      persist({ authed: true, onboarded: !isNewAccount });
      location.hash = isNewAccount ? "" : "dashboard";
      setRoute("dashboard");
    };
    if (route === "register") return <RegisterScreen onAuth={handleAuth}/>;
    if (route === "forgot")   return <ForgotScreen/>;
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
    dashboard:  <DashboardScreen/>,
    signals:    <SignalsScreen/>,
    abtest:     <ABTestScreen/>,
    tuner:      <TunerScreen/>,
    news:       <NewsScreen/>,
    modes:      <ModesScreen/>,
    strategies: <StrategiesScreen/>,
    paper:      <PaperScreen/>,
    backtest:   <BacktestScreen/>,
    trading:    <TradingScreen/>,
    audit:      <AuditScreen/>,
    circuits:   <CircuitsScreen/>,
    portfolio:  <PortfolioScreen/>,
    goals:      <GoalsScreen/>,
    stpswp:     <StpSwpScreen/>,
    smallcase:  <SmallcaseScreen/>,
    fixed:      <FixedIncomeScreen/>,
    harvest:    <HarvestScreen/>,
    tax:        <TaxScreen/>,
    brokers:    <BrokersScreen/>,
    risk:       <RiskScreen/>,
    compliance: <ComplianceScreen/>,
    infra:      <InfraScreen/>,
    settings:   <SettingsScreen/>,
    review:     <AIReviewScreen/>,
    recon:      <ReconScreen/>,
    attribution:<AttributionScreen/>,
    copy:       <CopyScreen/>,
    mobile:     <MobileScreen/>,
    options:    <OptionsBuilderScreen/>,
    margin:     <MarginScreen/>,
    regime:     <RegimeScreen/>,
    alerts:     <AlertsBuilderScreen/>,
    benchmark:  <BenchmarkScreen/>,
    profile:    <ProfileScreen/>,
    apidocs:    window.ApiDocsScreen ? <window.ApiDocsScreen/> : null,
    compare:    window.StrategyCompare ? <window.StrategyCompare/> : null,
    money:      window.MoneyScreen ? <window.MoneyScreen/> : null,
    lab:        window.StrategyLabScreen ? <window.StrategyLabScreen/> : null,
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
        {window.ActiveAutomationStrip && <window.ActiveAutomationStrip setRoute={go}/>}
        <LiveTicker/>
        <div className="content" data-screen-label={title}>
          <window.ErrorBoundary>
            {screens[route] || screens.dashboard}
          </window.ErrorBoundary>
        </div>
      </div>
      {window.ToastHost && <window.ToastHost/>}
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
                <div key={k} style={{ display: "flex", justifyContent: "space-between