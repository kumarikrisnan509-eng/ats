/* eslint-disable */
/* Shell: sidebar nav, top bar */

// Hold-to-confirm kill switch — 1.2s press + 2FA code before firing
// Prevents accidental clicks AND requires authentication for destructive halt
const KillSwitchButton = () => {
  const [holding, setHolding] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [needs2FA, setNeeds2FA] = React.useState(false);
  const [fired, setFired] = React.useState(false);
  const timerRef = React.useRef(null);
  const rafRef = React.useRef(null);
  const startRef = React.useRef(0);

  const HOLD_MS = 1200;

  const begin = () => {
    if (fired || needs2FA) return;
    setHolding(true);
    startRef.current = Date.now();
    const tick = () => {
      const elapsed = Date.now() - startRef.current;
      const p = Math.min(100, (elapsed / HOLD_MS) * 100);
      setProgress(p);
      if (p < 100) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    timerRef.current = setTimeout(() => {
      setHolding(false);
      setProgress(0);
      setNeeds2FA(true); // Hold complete → trigger 2FA modal
    }, HOLD_MS);
  };

  const end = () => {
    if (fired || needs2FA) return;
    cancelAnimationFrame(rafRef.current);
    clearTimeout(timerRef.current);
    setHolding(false);
    setProgress(0);
  };

  const onConfirm2FA = () => {
    setFired(true);
    setNeeds2FA(false);
    window.dispatchEvent(new CustomEvent("kill-switch-fired"));
  };

  if (fired) {
    return (
      <button
        className="top__killswitch"
        style={{ background: "var(--down)", color: "white", opacity: 0.9 }}
        onClick={() => { setFired(false); setProgress(0); }}
        title="All automated trading halted — click to reset"
      >
        <I.stop size={14}/> Halted
      </button>
    );
  }

  return (
    <>
      <button
        className="top__killswitch"
        onMouseDown={begin}
        onMouseUp={end}
        onMouseLeave={end}
        onTouchStart={begin}
        onTouchEnd={end}
        style={{
          position: "relative",
          background: holding ? `linear-gradient(to right, var(--down) ${progress}%, var(--down-soft) ${progress}%)` : undefined,
          color: holding ? "white" : undefined,
          overflow: "hidden",
          userSelect: "none",
        }}
        title="Press and hold 1.2s, then confirm with 2FA"
      >
        <I.stop size={14}/> {holding ? "Hold…" : "Kill"}
      </button>
      {window.TwoFactorModal && (
        <window.TwoFactorModal
          open={needs2FA}
          onClose={() => setNeeds2FA(false)}
          action="Halt all automated trading"
          detail="This will cancel all working orders, square off all open positions, and prevent new trades until manually re-enabled. All 4 trading modes will be paused."
          onConfirm={onConfirm2FA}
        />
      )}
    </>
  );
};

const NAV_GROUPS = [
  {
    // Tier 9 IA streamline: 4-step wealth loop is the spine
    //   AI Signal -> Paper trade -> Live trade -> Money (profits -> reinvest)
    // Dashboard is the home. Everything else moves to overflow or sub-groups.
    label: null,
    items: [
      { id: "dashboard",  label: "Dashboard",      icon: I.dashboard, badge: { text: "LIVE", kind: "live" } },
    ],
  },
  {
    label: "Wealth loop",
    items: [
      { id: "signals",    label: "AI Signals",     icon: I.brain,    badge: { text: "LIVE", kind: "live" } },
      { id: "lab",        label: "Strategy Lab",   icon: I.code,     badge: { text: "NEW" } },
      { id: "paper",      label: "Paper trading",  icon: I.flame },
      { id: "trading",    label: "Live trading",   icon: I.trade },
      { id: "money",      label: "Money",          icon: I.coin,     badge: { text: "NEW", kind: "live" } },
    ],
  },
  {
    label: "Automate",
    items: [
      { id: "modes",      label: "Trading modes",  icon: I.layers },
      { id: "strategies", label: "Strategies",     icon: I.strategy,  badge: { text: "8" } },
      // moved to overflow -- still reachable, just not in the primary scan path
      { id: "abtest",     label: "A/B testing",       icon: I.code,    overflow: true },
      { id: "compare",    label: "Compare",           icon: I.scale,   overflow: true },
      { id: "tuner",      label: "Auto-tuner",        icon: I.sparkle, overflow: true },
      { id: "news",       label: "News & sentiment",  icon: I.globe,   overflow: true },
      { id: "regime",     label: "Market regime",     icon: I.compass, overflow: true },
      { id: "alerts",     label: "Alerts builder",    icon: I.pulse,   overflow: true },
      { id: "options",    label: "Options builder",   icon: I.options, overflow: true },
      { id: "backtest",   label: "Backtest lab",      icon: I.code,    overflow: true },
      { id: "circuits",   label: "Circuit breakers",  icon: I.gauge,   overflow: true },
      { id: "audit",      label: "Audit trail",       icon: I.check,   overflow: true },
      { id: "margin",     label: "Margin calc",       icon: I.scale,   overflow: true },
    ],
  },
  {
    // Wealth & long-term — Money screen is the primary hub. Portfolio is here
    // for the read-only holdings view. The rest moved to overflow as mock-heavy.
    label: "Long-term",
    items: [
      { id: "portfolio",  label: "Portfolio",            icon: I.portfolio },
      // overflow: still works, just less screen real estate by default
      { id: "goals",      label: "Life goals",           icon: I.target,    overflow: true },
      { id: "stpswp",     label: "STP / SWP plans",      icon: I.refresh,   overflow: true },
      { id: "smallcase",  label: "Smallcases",           icon: I.basket,    overflow: true },
      { id: "fixed",      label: "Fixed income & REITs", icon: I.coin,      overflow: true },
      { id: "benchmark",  label: "Benchmarking",         icon: I.trendUp,   overflow: true },
      { id: "copy",       label: "Copy trading",         icon: I.user,      overflow: true },
      { id: "harvest",    label: "Tax-loss harvest",     icon: I.leaf,      overflow: true },
      { id: "tax",        label: "Tax & ITR",            icon: I.calc,      overflow: true },
    ],
  },
  {
    label: "Operations",
    items: [
      { id: "brokers",    label: "Brokers",           icon: I.broker, badge: { text: "3/5" } },
      // overflow
      { id: "review",      label: "AI monthly review", icon: I.report,    overflow: true },
      { id: "recon",       label: "Reconciliation",    icon: I.sync,      overflow: true },
      { id: "attribution", label: "PnL attribution",   icon: I.breakdown, overflow: true },
    ],
  },
  {
    label: "System",
    items: [
      { id: "settings",   label: "Settings",       icon: I.settings },
      // overflow
      { id: "risk",       label: "Risk",           icon: I.shield,      overflow: true },
      { id: "compliance", label: "Compliance",     icon: I.shieldCheck, overflow: true },
      { id: "infra",      label: "Infrastructure", icon: I.server,      overflow: true },
      { id: "mobile",     label: "Mobile app",     icon: I.phone,       overflow: true },
      { id: "apidocs",    label: "API & Webhooks", icon: I.code,        overflow: true },
    ],
  },
];

const NavOverflow = ({ items, route, setRoute, groupKey }) => {
  const storageKey = `ats.nav.overflow.${groupKey}`;
  const [open, setOpen] = React.useState(() => {
    try { return localStorage.getItem(storageKey) === "1"; } catch { return false; }
  });
  // If a route inside the overflow is active, force-open
  const hasActive = items.some(it => it.id === route);
  const expanded = open || hasActive;
  const toggle = () => {
    const next = !expanded;
    setOpen(next);
    try { localStorage.setItem(storageKey, next ? "1" : "0"); } catch {}
  };
  return (
    <>
      <button onClick={toggle} className="nav__item" style={{ opacity: 0.7, fontSize: 12 }} aria-expanded={expanded}>
        <span style={{ width: 16, display: "inline-block", textAlign: "center" }}>{expanded ? "−" : "+"}</span>
        <span>{expanded ? "Fewer" : "More"} tools</span>
        <span className="nav__badge">{items.length}</span>
      </button>
      {expanded && items.map(it => (
        <button
          key={it.id}
          onClick={() => setRoute(it.id)}
          className={"nav__item" + (route === it.id ? " nav__item--active" : "")}
          style={{ paddingLeft: 26 }}
        >
          <it.icon size={16}/>
          <span>{it.label}</span>
          {it.badge && <span className="nav__badge">{it.badge.text}</span>}
        </button>
      ))}
    </>
  );
};

// Tier 13: live counts feeding the sidebar badges (Strategies, Brokers).
const useLiveCounts = () => {
  const [counts, setCounts] = React.useState({ strategies: null, brokersUp: null, brokersTotal: null });
  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [s, h] = await Promise.all([
          window.fetchApi('/api/strategies').catch(() => null),
          window.fetchApi('/api/health').catch(() => null),
        ]);
        if (cancelled) return;
        const sCount = s && Array.isArray(s.strategies) ? s.strategies.length
                     : s && s.ok && Array.isArray(s.rows) ? s.rows.length : null;
        // brokers: only Zerodha is wired today; brokersUp = 1 if broker.connected, 0 otherwise.
        // brokersTotal = 1 (we only support Zerodha currently).
        const brokersUp    = h && h.broker ? (h.broker.connected ? 1 : 0) : null;
        const brokersTotal = h && h.broker ? 1 : null;
        setCounts({ strategies: sCount, brokersUp, brokersTotal });
      } catch (_e) {}
    };
    load();
    const t = setInterval(load, 45000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);
  return counts;
};

const Sidebar = ({ route, setRoute }) => {
  const [q, setQ] = React.useState("");
  const liveCounts = useLiveCounts();
  // Tier 13: replace hardcoded badge text for `strategies` and `brokers` with live values
  const liveBadgeFor = (id, current) => {
    if (id === 'strategies' && liveCounts.strategies != null) return { text: String(liveCounts.strategies) };
    if (id === 'brokers' && liveCounts.brokersUp != null && liveCounts.brokersTotal != null) return { text: `${liveCounts.brokersUp}/${liveCounts.brokersTotal}` };
    return current;
  };
  const ql = q.trim().toLowerCase();
  const filt = (it) => !ql || it.label.toLowerCase().includes(ql);
  return (
  <aside className="nav">
    <div className="nav__brand">
      <div className="nav__logo">ATS</div>
      <div>
        <div className="nav__name">ATS</div>
        <div className="nav__sub">Automated Trading System</div>
      </div>
    </div>

    <div style={{ padding: "4px 14px 8px" }}>
      <div style={{ position: "relative" }}>
        <I.search size={12}/>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter nav…" style={{
          width: "100%", padding: "6px 8px 6px 26px", fontSize: 12,
          background: "var(--bg-soft)", border: "1px solid var(--border)", borderRadius: 6,
          color: "var(--text-1)",
        }}/>
        <span style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "var(--text-3)", pointerEvents: "none" }}><I.search size={12}/></span>
      </div>
    </div>

    {NAV_GROUPS.map((g, gi) => {
      const allItems = g.items.filter(filt);
      const items = allItems.filter(it => !it.overflow);
      const overflow = allItems.filter(it => it.overflow);
      if (!items.length && !overflow.length) return null;
      return (
      <React.Fragment key={g.label || `grp-${gi}`}>
        {g.label && <div className="nav__group-label">{g.label}</div>}
        {items.map(it => (
          <button
            key={it.id}
            onClick={() => setRoute(it.id)}
            className={"nav__item" + (route === it.id ? " nav__item--active" : "")}
          >
            <it.icon size={16}/>
            <span>{it.label}</span>
            {(() => { const b = liveBadgeFor(it.id, it.badge); return b && (
              <span className={"nav__badge" + (b.kind === "live" ? " nav__badge--live" : "")}>
                {b.kind === "live" && <span style={{ display: "inline-block", width: 6, height: 6, background: "currentColor", borderRadius: "50%", marginRight: 4, verticalAlign: "middle" }}/>}
                {b.text}
              </span>
            ); })()}
          </button>
        ))}
        {overflow.length > 0 && <NavOverflow items={overflow} route={route} setRoute={setRoute} groupKey={g.label || `grp-${gi}`}/>}
      </React.Fragment>
      );
    })}

    <div className="nav__footer">
      <div style={{ fontSize: 11, color: "var(--text-3)", textAlign: "center", lineHeight: 1.5 }}>
        ATS · v2.4.1<br/>
        <span style={{ color: "var(--success)" }}>●</span> All systems operational
      </div>
    </div>
  </aside>
  );
};

const TopBar = ({ title, crumb, theme, setTheme, setRoute }) => {
  // Sourced from Kite /market/holidays (refreshed 06:00 IST daily) + clock.
  const status = window.marketStatus();
  const open = status.open;
  const nextHol = window.nextHoliday();

  // Mode chip — counts active modes, refreshes on storage events
  const [, bump] = React.useReducer(x => x + 1, 0);
  React.useEffect(() => {
    const h = () => bump();
    window.addEventListener("storage", h);
    window.addEventListener("modes-changed", h);
    return () => {
      window.removeEventListener("storage", h);
      window.removeEventListener("modes-changed", h);
    };
  }, []);
  const activeModes = window.MODE_IDS.filter(id => window.isModeActive(id));
  const allActive = activeModes.length === 4;

  return (
    <header className="top">
      <div className="top__heading">
        <div className="top__crumb">{crumb}</div>
        <div className="top__title">{title}</div>
      </div>

      <button
        type="button"
        className="top__search"
        onClick={() => window.dispatchEvent(new CustomEvent("open-palette"))}
        title="Open command palette"
        style={{ cursor: "pointer", textAlign: "left" }}
      >
        <I.search size={14}/>
        <span style={{ flex: 1, color: "var(--text-3)", fontSize: 13 }}>Search pages, actions, symbols…</span>
        <span className="top__kbd">⌘K</span>
      </button>

      <div className="top__actions">
        <button
          onClick={() => setRoute && setRoute("modes")}
          title={`Active modes: ${activeModes.map(id => window.MODE_META[id].label).join(", ") || "none"}`}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "6px 10px", borderRadius: 999,
            background: allActive ? "var(--up-soft)" : activeModes.length === 0 ? "var(--down-soft)" : "var(--warn-soft)",
            color: allActive ? "var(--up)" : activeModes.length === 0 ? "var(--down)" : "oklch(45% 0.13 80)",
            fontSize: 12, fontWeight: 500, border: "1px solid transparent", whiteSpace: "nowrap",
          }}
        >
          <span style={{ display: "inline-flex", gap: 2 }}>
            {window.MODE_IDS.map(id => (
              <span key={id} style={{
                width: 6, height: 6, borderRadius: "50%",
                background: window.isModeActive(id) ? window.MODE_META[id].color : "currentColor",
                opacity: window.isModeActive(id) ? 1 : 0.25,
              }}/>
            ))}
          </span>
          {activeModes.length}/4 modes
        </button>

        <div className={"top__market" + (open ? "" : " top__market--closed")}>
          <span className="top__market-dot"/>
          <span className="mono" style={{ fontSize: 12 }}>NSE</span>
          <span style={{ color: "var(--text-3)" }} title={nextHol ? `Next holiday: ${nextHol.name} · ${nextHol.date}` : ""}>{status.label}</span>
        </div>

        <button className="iconbtn" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} title="Toggle theme">
          {theme === "dark" ? <I.sun size={16}/> : <I.moon size={16}/>}
        </button>
        {window.DensityToggle && <window.DensityToggle/>}
        <NotificationsBell setRoute={setRoute}/>
        <KillSwitchButton/>
        <div style={{ width: 1, height: 24, background: "var(--border)", margin: "0 4px" }}/>
        <ProfileMenu setRoute={setRoute}/>
      </div>
    </header>
  );
};

const NOTIF_ROUTE = { 1: "signals", 2: "modes", 3: "portfolio", 4: "compliance", 5: "infra", 6: "settings" };

// Tier 16: Notifications dropdown -- now feeds from /api/scanner/history (last 24h)
// + /api/sweep (recent executes) + /api/audit (broker events). Replaces 6 hardcoded
// notifications. Severity inferred from event type.
const NotificationsBell = ({ setRoute }) => {
  const [open, setOpen] = React.useState(false);
  const [items, setItems] = React.useState([]);
  const [readIds, setReadIds] = React.useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('ats.notify.read') || '[]')); } catch { return new Set(); }
  });
  React.useEffect(() => {
    let cancelled = false;
    const fmtAgo = (ts) => {
      const ms = Date.now() - new Date(ts).getTime();
      if (ms < 60_000)    return Math.max(1, Math.floor(ms/1000)) + 's ago';
      if (ms < 3600_000)  return Math.floor(ms/60_000) + 'm ago';
      if (ms < 86400_000) return Math.floor(ms/3600_000) + 'h ago';
      return Math.floor(ms/86400_000) + 'd ago';
    };
    const load = async () => {
      try {
        const [scan, sweep, audit] = await Promise.all([
          window.fetchApi('/api/scanner/history?limit=10').catch(() => null),
          window.fetchApi('/api/sweep').catch(() => null),
          window.fetchApi('/api/audit?limit=10').catch(() => null),
        ]);
        if (cancelled) return;
        const out = [];
        if (scan && scan.ok && Array.isArray(scan.rows)) {
          for (const r of scan.rows.slice(0, 5)) {
            const id = 'scan:' + (r.ts || r.time || r.symbol);
            out.push({ id, sev: 'info', icon: '◆',
              title: `${r.symbol || 'Signal'} · ${r.signal || r.strategy || 'scanner hit'}`,
              detail: r.message || (r.value != null ? `value ${r.value}` : ''),
              when: fmtAgo(r.ts || r.time || Date.now()),
              unread: !readIds.has(id) });
          }
        }
        if (sweep && sweep.ok && Array.isArray(sweep.history)) {
          for (const h of sweep.history.slice(0, 3)) {
            const id = 'sweep:' + h.id;
            out.push({ id, sev: 'up', icon: '↑',
              title: `Sweep ${h.status || 'logged'} · ₹${(h.sweepINR || 0).toLocaleString('en-IN')}`,
              detail: `Target: ${h.target || '—'}`,
              when: fmtAgo(h.ts || Date.now()),
              unread: !readIds.has(id) });
          }
        }
        if (audit && audit.ok && Array.isArray(audit.rows)) {
          for (const a of audit.rows.slice(0, 4)) {
            const id = 'audit:' + (a.ts || a.id);
            const isErr = String(a.event || '').includes('error') || String(a.event || '').includes('blocked');
            out.push({ id, sev: isErr ? 'warn' : 'info', icon: isErr ? '!' : '◆',
              title: a.event || 'event',
              detail: a.data ? JSON.stringify(a.data).slice(0, 80) : '',
              when: fmtAgo(a.ts || Date.now()),
              unread: !readIds.has(id) });
          }
        }
        // Sort by 'when' proxy (we already pulled most-recent N from each)
        setItems(out.slice(0, 10));
      } catch (_e) {}
    };
    load();
    const t = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(t); };
  }, [readIds]);
  const unreadCount = items.filter(i => i.unread).length;
  const markAll = () => {
    const all = new Set(items.map(i => i.id));
    const merged = new Set([...readIds, ...all]);
    setReadIds(merged);
    try { localStorage.setItem('ats.notify.read', JSON.stringify([...merged].slice(-200))); } catch {}
  };

  const sevColor = {
    info: "var(--info)", warn: "oklch(65% 0.13 80)", up: "var(--up)", down: "var(--down)",
  };
  const sevBg = {
    info: "var(--info-soft)", warn: "var(--warn-soft)", up: "var(--up-soft)", down: "var(--down-soft)",
  };

  return (
    <div style={{ position: "relative" }}>
      <button className="iconbtn iconbtn--notify" title="Notifications" onClick={() => setOpen(!open)} style={{ position: "relative" }}>
        <I.bell size={16}/>
        {unreadCount > 0 && (
          <span style={{
            position: "absolute", top: 4, right: 4,
            minWidth: 14, height: 14, borderRadius: 7,
            background: "var(--down)", color: "white",
            fontSize: 9, fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: "0 4px",
          }}>{unreadCount}</span>
        )}
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 50 }}/>
          <div style={{
            position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 51,
            width: 400,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--r-md)",
            boxShadow: "0 12px 32px oklch(0% 0 0 / 0.18)",
            overflow: "hidden",
          }}>
            <div className="between" style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
              <div>
                <div style={{ fontWeight: 500, fontSize: 14 }}>Notifications</div>
                <div className="muted" style={{ fontSize: 11 }}>{unreadCount} unread · last 24h</div>
              </div>
              <button className="btn btn--ghost" style={{ fontSize: 11, padding: "4px 8px" }} onClick={markAll} disabled={unreadCount === 0}>
                Mark all read
              </button>
            </div>
            <div style={{ maxHeight: 420, overflowY: "auto" }}>
              {items.map(it => (
                <div key={it.id} onClick={() => { setItems(items.map(x => x.id === it.id ? {...x, unread: false} : x)); setOpen(false); setRoute && setRoute(NOTIF_ROUTE[it.id] || "dashboard"); }} style={{
                  display: "flex", gap: 12,
                  padding: "12px 16px",
                  borderBottom: "1px solid var(--border)",
                  background: it.unread ? "var(--bg-soft)" : "transparent",
                  cursor: "pointer",
                }}>
                  <div style={{
                    width: 26, height: 26, borderRadius: 6, flexShrink: 0,
                    background: sevBg[it.sev], color: sevColor[it.sev],
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontWeight: 700, fontSize: 13, fontFamily: "var(--mono)",
                  }}>{it.icon}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                      <div style={{ fontSize: 13, fontWeight: it.unread ? 500 : 400, flex: 1 }}>{it.title}</div>
                      {it.unread && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", flexShrink: 0 }}/>}
                    </div>
                    <div className="muted" style={{ fontSize: 11, marginTop: 2, lineHeight: 1.45 }}>{it.detail}</div>
                    <div className="muted" style={{ fontSize: 10, marginTop: 4, fontFamily: "var(--mono)" }}>{it.when}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ padding: "10px 16px", borderTop: "1px solid var(--border)", textAlign: "center" }}>
              <a href="#settings" onClick={() => setOpen(false)} style={{ fontSize: 12, color: "var(--text-3)", textDecoration: "underline" }}>Notification preferences</a>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

// Profile menu — avatar + dropdown with quick links
// Tier 12: name + email now pulled from /api/profile (live Kite session).
// Falls back to "—" with a "Kite reconnect needed" badge when token expired.
const ProfileMenu = ({ setRoute }) => {
  const [open, setOpen] = React.useState(false);
  // T83: source identity from the authenticated USER (not global Kite profile),
  // and broker status from the user's own brokers (not /api/health).
  const [meBroker, setMeBroker] = React.useState(null);
  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await window.fetchApi('/api/v1/me/brokers');
        if (cancelled) return;
        if (r && r.ok && Array.isArray(r.brokers) && r.brokers.length > 0) {
          // Pick the default broker, else first.
          const def = r.brokers.find(b => b.is_default) || r.brokers[0];
          setMeBroker(def);
        } else {
          setMeBroker(null);
        }
      } catch (_e) { setMeBroker(null); }
    };
    load();
    const t = setInterval(load, 60000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);
  const user = window.atsCurrentUser || {};
  const fullName = user.name || (user.email ? user.email.split('@')[0] : '');
  const initials = (() => {
    if (!fullName) return 'RS';
    const parts = fullName.trim().split(/\s+/);
    return ((parts[0] || '')[0] || '') + ((parts[parts.length-1] || '')[0] || '') || 'RS';
  })().toUpperCase();
  const displayName  = fullName || user.email || 'You';
  // T83 broker badge: derive subtitle from per-user broker status.
  let displayEmail = user.email || '';
  if (meBroker) {
    if (meBroker.token_status === 'valid') displayEmail = `Kite · connected · ${meBroker.broker_user_id}`;
    else if (meBroker.token_status === 'expiring_soon') displayEmail = `Kite · expiring soon · click Brokers`;
    else if (meBroker.token_status === 'expired') displayEmail = `Kite · token expired · click Brokers`;
    else displayEmail = `Kite · needs OAuth`;
  } else if (!meBroker && user.id) {
    displayEmail = 'No broker connected · click Brokers to add one';
  }
  const nav = (r) => { setOpen(false); setRoute && setRoute(r); };
  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: 30, height: 30, borderRadius: "50%",
          background: "linear-gradient(135deg, var(--accent), oklch(50% 0.12 280))",
          color: "white", fontWeight: 600, fontSize: 12,
          border: "2px solid var(--border)",
          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >{initials}</button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 50 }}/>
          <div style={{
            position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 51,
            width: 240,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--r-md)",
            boxShadow: "0 12px 32px oklch(0% 0 0 / 0.18)",
            overflow: "hidden",
          }}>
            <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", display: "flex", gap: 12, alignItems: "center" }}>
              <div style={{
                width: 36, height: 36, borderRadius: "50%",
                background: "linear-gradient(135deg, var(--accent), oklch(50% 0.12 280))",
                color: "white", fontWeight: 600, fontSize: 14,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>{initials}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, fontSize: 13 }} title={displayName}>{displayName}</div>
                <div className="muted" style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={displayEmail}>{displayEmail}</div>
              </div>
            </div>
            <div style={{ padding: "6px 0" }}>
              {[
                { label: "Profile",        route: "profile",  icon: I.user },
                { label: "Brokers",        route: "brokers",  icon: I.link },
                { label: "AI sources",     route: "settings", icon: I.sparkle },
                { label: "Compliance",     route: "compliance", icon: I.shieldCheck },
              ].map(it => (
                <button key={it.route} className="btn btn--ghost" onClick={() => nav(it.route)} style={{ width: "100%", justifyContent: "flex-start", padding: "8px 16px", borderRadius: 0, fontSize: 13 }}>
                  <it.icon size={14}/> {it.label}
                </button>
              ))}
            </div>

            <div style={{ borderTop: "1px solid var(--border)", padding: "6px 0" }}>
              <button
                className="btn btn--ghost"
                onClick={() => { window.dispatchEvent(new CustomEvent("logout")); setOpen(false); }}
                style={{ width: "100%", justifyContent: "flex-start", padding: "8px 16px", borderRadius: 0, fontSize: 13, color: "var(--down)" }}
              >
                <I.stop size={14}/> Sign out
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

Object.assign(window, { Sidebar, TopBar }); 