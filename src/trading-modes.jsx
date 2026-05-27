/* eslint-disable */
/* Trading Modes — capital allocator + mode controller.
   The layer ABOVE strategies. Gates signals + orders by mode.

   Architecture:
     useModeState()     — hook returning modes + toggle + allocation
     MODE_META          — static descriptors (rules, hours, products)
     STRATEGY_MODE_MAP  — which strategies belong to which mode
     isModeActive(id)   — gate fn used by Signals/Strategies screens
*/

// Static mode definitions — would live in backend config in production
// T-351: All numeric fields in MODE_META[*].strategies[*] are zeroed (cap,
// alloc, pnl30, winR, trades, sharpe, paperDays) and st='draft'. The hardcoded
// values that used to live here (Momentum AI ₹42,340 30d PnL, Mean Reversion ₹31,200,
// etc.) showed on #modes as if they were real strategy performance. Per-strategy
// performance must come from the backend (/api/me/strategy-attribution or similar).
// The strategy NAMES, CATEGORIES (k), DESCRIPTIONS, and MARKET tags (mkt) remain --
// they form a legitimate static "available-strategies" catalog. They are NOT real
// allocations or P&L.
const MODE_META = {
  intraday: {
    id: "intraday", label: "Intraday", shortLabel: "MIS",
    icon: "flame", color: "var(--warn)", colorSoft: "var(--warn-soft)",
    tagline: "Same-day square-off · Leveraged",
    product: "MIS",
    leverage: "5×",
    margin: "Intraday SPAN (0% overnight)",
    hours: "09:15 – 15:15 IST",
    squareoffAt: "15:15",
    holdPeriod: "Minutes – hours",
    riskProfile: "Aggressive",
    strategies: [
      // ---- Intraday (6) ----
      { n: "Momentum AI",       k: "ML · intraday",      st: "draft",   cap: 0, alloc: 0, pnl30: 0, winR: 0, trades: 0, sharpe: 0, mkt: "NSE · NFO", paperDays: 0, desc: "Claude-scored momentum breakouts on 5/15-min" },
      { n: "Mean Reversion v2", k: "Indicator · MIS",    st: "draft",   cap: 0, alloc: 0, pnl30: 0, winR: 0, trades: 0, sharpe: 0, mkt: "NSE",       paperDays: 0, desc: "RSI + Bollinger reversion on liquid large-caps" },
      { n: "Grid Trader",       k: "Custom Python",     st: "draft",   cap: 0, alloc: 0, pnl30: 0, winR: 0, trades: 0, sharpe: 0, mkt: "NSE",       paperDays: 0, desc: "Range-bound grid with volatility brake" },
      { n: "Breakout Scalper",  k: "Indicator · intraday",st: "draft",  cap: 0, alloc: 0, pnl30: 0, winR: 0, trades: 0, sharpe: 0, mkt: "NSE",       paperDays: 0, desc: "Opening-range breakout · first 30 minutes" },
      { n: "VWAP Pullback",     k: "Indicator · MIS",    st: "draft",  cap: 0, alloc: 0, pnl30: 0, winR: 0, trades: 0, sharpe: 0, mkt: "NSE",       paperDays: 0, desc: "Pullback to VWAP after strong trend bar" },
      { n: "Opening Range",     k: "Indicator · MIS",    st: "draft",  cap: 0, alloc: 0, pnl30: 0, winR: 0, trades: 0, sharpe: 0,   mkt: "NSE",       paperDays: 0, desc: "ORB on NIFTY · 9:15-9:45 range" },
    ],
    defaults: { enabled: true, capitalPct: 25, dailyLossCapPct: 2.0, maxPositions: 8, maxPerTradePct: 3 },
    warnings: (s) => {
      const out = [];
      const now = new Date();
      const h = now.getHours(), m = now.getMinutes();
      const minsToSqOff = (15 * 60 + 15) - (h * 60 + m);
      if (s.enabled && minsToSqOff > 0 && minsToSqOff < 60) {
        out.push({ kind: "warn", text: `Auto square-off in ${minsToSqOff} min` });
      }
      if (s.enabled && h >= 15 && m >= 15) {
        out.push({ kind: "down", text: "Session over — positions squared" });
      }
      return out;
    },
  },
  swing: {
    id: "swing", label: "Swing", shortLabel: "CNC",
    icon: "trend", color: "var(--info)", colorSoft: "var(--info-soft)",
    tagline: "Hold days to weeks · Delivery",
    product: "CNC",
    leverage: "1×",
    margin: "Full value upfront",
    hours: "Any · overnight allowed",
    squareoffAt: "—",
    holdPeriod: "2 – 30 days",
    riskProfile: "Moderate",
    strategies: [
      // ---- Swing (4) ----
      { n: "Trend Follow",        k: "ML · multi-day",     st: "draft",  cap: 0, alloc: 0, pnl30: 0, winR: 0, trades: 0, sharpe: 0, mkt: "NSE", paperDays: 0, desc: "Claude-scored 20-day EMA trend continuation" },
      { n: "Sector Rotator",      k: "Quant · sector",     st: "draft", cap: 0, alloc: 0, pnl30: 0, winR: 0, trades: 0, sharpe: 0, mkt: "NSE", paperDays: 0, desc: "Rotate capital to top-N sector by 30d momentum" },
      { n: "Breakout Swing",      k: "Indicator · CNC",    st: "draft", cap: 0, alloc: 0, pnl30: 0, winR: 0, trades: 0, sharpe: 0, mkt: "NSE", paperDays: 0, desc: "52-week high breakout with volume filter" },
      { n: "Value Momentum",      k: "Fundamental + price",st: "draft", cap: 0, alloc: 0, pnl30: 0, winR: 0, trades: 0, sharpe: 0,   mkt: "NSE", paperDays: 0, desc: "Low P/E + positive price momentum screen" },
    ],
    defaults: { enabled: true, capitalPct: 35, dailyLossCapPct: 1.5, maxPositions: 15, maxPerTradePct: 5 },
    warnings: () => [],
  },
  options: {
    id: "options", label: "Options", shortLabel: "OPT",
    icon: "layers", color: "var(--violet)", colorSoft: "var(--violet-soft)",
    tagline: "Theta-driven · Defined risk",
    product: "NRML / MIS",
    leverage: "SPAN-based",
    margin: "SPAN + Exposure",
    hours: "09:15 – 15:30 IST",
    squareoffAt: "—",
    holdPeriod: "Intraday to expiry",
    riskProfile: "Variable · strategy-specific",
    strategies: [
      // ---- Options (5) ----
      { n: "Iron Condor Weekly",  k: "Defined-risk",       st: "draft",  cap: 0, alloc: 0, pnl30: 0,  winR: 0, trades: 0, sharpe: 0, mkt: "NFO", paperDays: 0, desc: "NIFTY weekly IC at 1SD wings · Thursday expiry" },
      { n: "Short Straddle",      k: "IV-harvest",         st: "draft", cap: 0, alloc: 0, pnl30: 0, winR: 0, trades: 0, sharpe: 0,   mkt: "NFO", paperDays: 0, desc: "ATM straddle · gamma hedge at 1.5x delta" },
      { n: "PE Hedge",            k: "Tail-hedge",         st: "draft",   cap: 0, alloc: 0, pnl30: 0, winR: 0, trades: 0, sharpe: 0, mkt: "NFO", paperDays: 0, desc: "OTM PE insurance for portfolio drawdown" },
      { n: "Covered Call",        k: "Yield-enhance",      st: "draft",  cap: 0, alloc: 0, pnl30: 0, winR: 0, trades: 0, sharpe: 0, mkt: "NFO", paperDays: 0, desc: "Write OTM CE on CNC holdings · 5% OTM" },
      { n: "Bull Call Spread",    k: "Directional · defined",st: "draft", cap: 0, alloc: 0, pnl30: 0, winR: 0, trades: 0, sharpe: 0,   mkt: "NFO", paperDays: 0, desc: "Buy ATM + sell OTM on confirmed trend" },
    ],
    defaults: { enabled: true, capitalPct: 25, dailyLossCapPct: 2.5, maxPositions: 6, maxPerTradePct: 8 },
    warnings: () => {
      // Nearest expiry context — NIFTY weekly = Thursday, BANKNIFTY = Wednesday
      const today = new Date();
      const dayOfWeek = today.getDay();
      const daysToThu = (4 - dayOfWeek + 7) % 7;
      const out = [];
      if (daysToThu === 0) out.push({ kind: "warn", text: "NIFTY weekly expires TODAY" });
      else if (daysToThu === 1) out.push({ kind: "info", text: "NIFTY weekly expires tomorrow" });
      else out.push({ kind: "muted", text: `Next expiry in ${daysToThu}d (NIFTY)` });
      return out;
    },
  },
  futures: {
    id: "futures", label: "Futures", shortLabel: "FUT",
    icon: "chart", color: "var(--accent)", colorSoft: "var(--accent-soft)",
    tagline: "Leveraged directional · Rollover-aware",
    product: "NRML",
    leverage: "SPAN-based (~6×)",
    margin: "SPAN + Exposure",
    hours: "09:15 – 15:30 IST",
    squareoffAt: "—",
    holdPeriod: "Days to next expiry",
    riskProfile: "Aggressive",
    strategies: [
      // ---- Futures (3) ----
      { n: "NIFTY Futures Trend",   k: "Directional",     st: "draft",  cap: 0, alloc: 0, pnl30: 0, winR: 0, trades: 0, sharpe: 0,   mkt: "NFO", paperDays: 0, desc: "NIFTY fut trend follow · daily close crossover" },
      { n: "Stock Futures Momentum", k: "Directional",    st: "draft",  cap: 0, alloc: 0, pnl30: 0, winR: 0, trades: 0, sharpe: 0, mkt: "NFO", paperDays: 0, desc: "Liquid stock fut momentum · sector-neutral" },
      { n: "Calendar Spread",        k: "Arb · defined",   st: "draft",  cap: 0, alloc: 0, pnl30: 0, winR: 0, trades: 0, sharpe: 0,   mkt: "NFO", paperDays: 0, desc: "Near-month vs far-month spread on NIFTY" },
    ],
    defaults: { enabled: false, capitalPct: 15, dailyLossCapPct: 2.0, maxPositions: 4, maxPerTradePct: 10 },
    warnings: () => {
      // Rollover week = last Thu – last Thu+1 of month
      const d = new Date();
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      const lastThu = new Date(lastDay);
      while (lastThu.getDay() !== 4) lastThu.setDate(lastThu.getDate() - 1);
      const daysToExpiry = Math.round((lastThu - d) / 86400000);
      if (daysToExpiry <= 5 && daysToExpiry >= 0) {
        return [{ kind: "warn", text: `Rollover week · ${daysToExpiry}d to expiry` }];
      }
      return [{ kind: "muted", text: `Current month expires in ${daysToExpiry}d` }];
    },
  },
};
const MODE_IDS = ["intraday", "swing", "options", "futures"];

// Strategy → mode reverse map + flat catalog (single source of truth)
const STRATEGY_MODE_MAP = {};
const STRATEGY_CATALOG = [];
MODE_IDS.forEach(id => {
  MODE_META[id].strategies.forEach(s => {
    STRATEGY_MODE_MAP[s.n] = id;
    STRATEGY_CATALOG.push({ ...s, mode: id });
  });
});
const getStrategy = (name) => STRATEGY_CATALOG.find(s => s.n === name);

// ============ Persistent state hook ============
// Persists to localStorage so toggles survive reload. In production this
// would be backend state (Redis + Postgres) so multiple processes see the
// same gates.
const MODE_STORAGE_KEY = "rsk.trading_modes.v1";

const loadModeState = () => {
  try {
    const raw = localStorage.getItem(MODE_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { console.warn('[trading-modes] swallowed:', e && e.message); }
  // Default: take each mode's defaults
  const out = {};
  MODE_IDS.forEach(id => { out[id] = { ...MODE_META[id].defaults }; });
  return out;
};

const useModeState = () => {
  const [state, setState] = React.useState(loadModeState);
  // T-487: track whether we've hydrated from backend. Initial render uses
  // localStorage (instant); backend hydration happens async on mount and
  // overwrites if it differs. Prevents UI flash for the common "they match" case.
  const hydratedRef = React.useRef(false);
  const debouncedPushRef = React.useRef(null);

  // T-487: pull canonical state from backend on mount. Backend is the source
  // of truth -- localStorage is a per-browser cache.
  // T-490: extracted into a callable so the risk-config-changed event listener
  // below can trigger a re-hydrate after soft-kill fires/resets.
  const hydrateFromBackend = React.useCallback(async () => {
    try {
      const r = await fetch('/api/me/risk-config', { credentials: 'include' }).then(r => r.json());
      if (r && r.ok && r.config && r.config.activeModes && typeof r.config.activeModes === 'object') {
        const remote = r.config.activeModes;
        const hasAny = MODE_IDS.some(id => remote[id] && typeof remote[id] === 'object');
        if (hasAny) {
          // T-490: when soft-kill flips modes, we must overwrite (not merge
          // with localStorage) so disabled state actually sticks. Use the
          // remote payload as the canonical source; fall back to MODE_META
          // defaults for any field the backend omits.
          setState(_prev => {
            const merged = {};
            MODE_IDS.forEach(id => {
              if (remote[id] && typeof remote[id] === 'object') {
                merged[id] = { ...MODE_META[id].defaults, ...remote[id] };
              } else {
                merged[id] = { ...MODE_META[id].defaults, ..._prev[id] };
              }
            });
            return merged;
          });
        } else {
          // T-490b: backend has empty activeModes but UI may have meaningful
          // local state (e.g. 4/4 enabled from a fresh install where the user
          // never explicitly toggled). Bootstrap by pushing the current local
          // state to backend NOW so the next kill-button click has data to
          // pause/restore.
          //
          // Read from React state via the functional-update trick (we don't
          // want to depend on `state` and re-create the callback every render).
          let snap;
          setState(s => { snap = s; return s; });
          // Allow React to flush so `snap` is populated, then PUT if non-trivial.
          await new Promise(r => setTimeout(r, 0));
          if (snap) {
            const hasMeaningfulLocal = MODE_IDS.some(id => snap[id] && (snap[id].enabled || (snap[id].capitalPct != null && snap[id].capitalPct > 0)));
            if (hasMeaningfulLocal) {
              try {
                await fetch('/api/me/risk-config', {
                  method: 'PUT', credentials: 'include',
                  headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window._csrfToken || '' },
                  body: JSON.stringify({ activeModes: snap }),
                });
              } catch (_) { /* swallow -- localStorage still has it */ }
            }
          }
        }
      }
      hydratedRef.current = true;
    } catch (_) {
      hydratedRef.current = true;
    }
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await hydrateFromBackend();
    })();
    return () => { cancelled = true; };
  }, [hydrateFromBackend]);

  // T-490: listen for soft-kill fire/reset and re-hydrate. Without this, the
  // Trading Modes screen keeps showing the stale (pre-kill) state until the
  // user navigates away and back.
  React.useEffect(() => {
    const onChange = () => {
      hydratedRef.current = false;
      hydrateFromBackend();
    };
    window.addEventListener('risk-config-changed', onChange);
    return () => window.removeEventListener('risk-config-changed', onChange);
  }, [hydrateFromBackend]);

  // T-487: debounced PUT to backend on state change (after initial hydration).
  // 500ms debounce so rapid slider drags coalesce into one network round-trip.
  // Always writes localStorage immediately for snappy UX + Tab B reads.
  React.useEffect(() => {
    try { localStorage.setItem(MODE_STORAGE_KEY, JSON.stringify(state)); } catch (e) { console.debug('[trading-modes] swallowed:', e && e.message); }
    try { window.dispatchEvent(new CustomEvent("modes-changed")); } catch (e) { console.debug('[trading-modes] swallowed:', e && e.message); }
    if (!hydratedRef.current) return; // skip the initial render
    if (debouncedPushRef.current) clearTimeout(debouncedPushRef.current);
    debouncedPushRef.current = setTimeout(() => {
      // T-487: send the activeModes subset (not full risk-config) -- backend
      // merges on top of existing fields.
      fetch('/api/me/risk-config', {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window._csrfToken || '' },
        body: JSON.stringify({ activeModes: state }),
      }).catch(e => console.debug('[trading-modes] backend sync failed (kept local):', e && e.message));
    }, 500);
  }, [state]);

  const toggleMode = (id) => setState(s => ({ ...s, [id]: { ...s[id], enabled: !s[id].enabled }}));
  const setField   = (id, key, val) => setState(s => ({ ...s, [id]: { ...s[id], [key]: val }}));
  const killAllModes = () => setState(s => {
    const out = { ...s };
    MODE_IDS.forEach(id => { out[id] = { ...s[id], enabled: false }; });
    return out;
  });

  // T-487: explicit save (used by Save allocation button). Bypasses debounce so
  // a user clicking Save gets immediate feedback instead of a 500ms wait.
  const saveNow = async () => {
    if (debouncedPushRef.current) clearTimeout(debouncedPushRef.current);
    try {
      const r = await fetch('/api/me/risk-config', {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window._csrfToken || '' },
        body: JSON.stringify({ activeModes: state }),
      }).then(r => r.json());
      return r && r.ok ? { ok: true } : { ok: false, reason: (r && r.reason) || 'save_failed' };
    } catch (e) {
      return { ok: false, reason: (e && e.message) || 'network_failed' };
    }
  };

  const activeCount = MODE_IDS.filter(id => state[id].enabled).length;
  const totalCapitalPct = MODE_IDS.reduce((sum, id) => sum + (state[id].enabled ? state[id].capitalPct : 0), 0);

  return { state, toggleMode, setField, killAllModes, saveNow, activeCount, totalCapitalPct };
};

// ============ Global gate — read-only check used by other screens ============
const isModeActive = (modeId) => {
  try {
    const raw = localStorage.getItem(MODE_STORAGE_KEY);
    if (!raw) return MODE_META[modeId]?.defaults.enabled ?? true;
    return JSON.parse(raw)[modeId]?.enabled ?? true;
  } catch { return true; }
};
const modeForStrategy = (strategyName) => STRATEGY_MODE_MAP[strategyName] || null;
const isStrategyModeActive = (strategyName) => {
  const m = modeForStrategy(strategyName);
  return m ? isModeActive(m) : true;
};

// Infer mode from symbol text — rough but enough for demo gating.
// In production, the signal itself carries a mode field.
const inferMode = (sym = "") => {
  const s = sym.toUpperCase();
  if (/\bCE\b|\bPE\b|CALL|PUT/.test(s)) return "options";
  if (/\bFUT\b|FUTURES/.test(s))         return "futures";
  return "intraday"; // default — could be swing too, but intraday is our aggressive default
};

// Returns the user's default mode if active, else falls back to the first active mode.
// Used by Trading screen + Strategies "New" button so a stale default doesn't strand them.
const getEffectiveDefaultMode = () => {
  let stored = "intraday";
  try { stored = localStorage.getItem("ats.defaultMode") || "intraday"; } catch (e) { console.debug('[trading-modes] swallowed:', e && e.message); }
  if (isModeActive(stored)) return stored;
  const fallback = MODE_IDS.find(id => isModeActive(id));
  return fallback || stored;
};

// Persist user-chosen default
const setDefaultMode = (id) => {
  try { localStorage.setItem("ats.defaultMode", id); } catch (e) { console.debug('[trading-modes] swallowed:', e && e.message); }
  try { window.dispatchEvent(new CustomEvent("default-mode-changed", { detail: id })); } catch (e) { console.debug('[trading-modes] swallowed:', e && e.message); }
};

Object.assign(window, {
  MODE_META, MODE_IDS, STRATEGY_MODE_MAP, STRATEGY_CATALOG, getStrategy,
  useModeState, isModeActive, modeForStrategy, isStrategyModeActive, inferMode,
  getEffectiveDefaultMode, setDefaultMode,
  MODE_STORAGE_KEY,
});
