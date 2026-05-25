/* eslint-disable */
/* Live tick simulator — pretends to be a Zerodha WebSocket feed.
   Emits 'tick' CustomEvent on window every ~800ms with random walk per symbol.
   Components can subscribe via window.addEventListener('tick', e => e.detail). */

(function() {
  // If we are served from a backend that exposes /ws, prefer real broker data.
  // Fallback to the in-browser random walk if the WS won't connect (e.g. opened from file://).
  // R12: this is the seam to a real Kite Ticker via the ATS backend. See deploy/ANALYSIS-v2.md.
  const wsScheme = (typeof location !== "undefined" && location.protocol === "https:") ? "wss:" : "ws:";
  const wsUrl = (typeof location !== "undefined" && location.host)
    ? `${wsScheme}//${location.host}/ws`
    : null;

  // T-420 (production-readiness audit, BLOCKER #1):
  // Was: 15 hardcoded "seed prices" that components rendered before the WS
  //      connected, making the app show plausible-but-fake numbers for the
  //      first ~3s of every page load. Demo mode is killed in primitives.jsx
  //      (T83) so there is no legitimate use for the random-walk simulator.
  // Now: SYMBOLS starts empty. Real /ws populates it. Components handle the
  //      empty case (`if (!sym) return null` in useLiveTick, etc.) and show
  //      an empty state until real ticks arrive.
  const SYMBOLS = {};

  // T-420: was `connected = true` -- lied about connection state until WS
  // either succeeded or the fallback timer fired. Start false so the LIVE
  // indicator says RECONNECTING/CLOSED honestly until real data arrives.
  let connected = false;
  let ticking = true;
  let tickCount = 0;
  let lastTickAt = Date.now();
  let connDropAt = null;
  let reconnects = 0;
  // T99-T44: upstream (Kite → backend) state, pushed by backend over /ws.
  // Distinct from `connected` which tracks frontend → backend. UI can show
  // 'data feed frozen' when stalledOnToken or tickStale is true even though
  // our local socket to backend is fine.
  let upstreamStalledOnToken = false;
  let upstreamTickStale = false;
  let upstreamConnected = true;

  const state = () => ({
    connected, ticking, tickCount, lastTickAt, reconnects,
    lagMs: Date.now() - lastTickAt,
    symbols: { ...SYMBOLS },
    upstream: {
      connected: upstreamConnected,
      stalledOnToken: upstreamStalledOnToken,
      tickStale: upstreamTickStale,
    },
  });

  // Random walk per symbol — small ticks 60% of the time, occasional bigger moves
  const randomTick = (s) => {
    const p = Math.random();
    let pctChange;
    if (p < 0.6)      pctChange = (Math.random() - 0.5) * 0.0006;  // ±0.03%
    else if (p < 0.9) pctChange = (Math.random() - 0.5) * 0.0020;  // ±0.10%
    else              pctChange = (Math.random() - 0.5) * 0.0050;  // ±0.25%
    s.ltp = Math.max(1, s.ltp * (1 + pctChange));
  };

  // ---------- Real-feed mode: try to attach to /ws on the same origin ----------
  let useRealFeed = false;
  let realSocket = null;

  function attachRealFeed() {
    if (!wsUrl) return;
    try {
      realSocket = new WebSocket(wsUrl);
    } catch (e) {
      return;
    }
    let gotData = false;
    const fallbackTimer = setTimeout(() => {
      if (!gotData) {
        // /ws unreachable or backend in mock mode without responses — keep simulator.
        try { realSocket && realSocket.close(); } catch (e) { console.debug('[live-ticks] swallowed:', e && e.message); }
      }
    }, 3000);

    realSocket.addEventListener("open", () => {
      // No-op; the server pushes welcome + ticks unprompted.
    });
    realSocket.addEventListener("message", (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (!msg || !msg.type) return;
      if (msg.type === "welcome") {
        useRealFeed = true;
        connected = true;
        gotData = true;
        clearTimeout(fallbackTimer);

        // Merge backend's effective symbol set (defaults + persisted watchlist).
        // T-420c HOTFIX: previously initialised each symbol to { ltp: 0, prev: 0 },
        // which made every downstream % calc compute (0-0)/0*100 = NaN until the
        // first real tick arrived for that symbol. This was masked before T-420
        // because SYMBOLS was pre-seeded with realistic LTPs. Now we don't pre-
        // populate at all -- the tick handler below initialises an entry on first
        // sighting using msg.ltp for BOTH ltp and prev, so the first chg% is
        // exactly 0 (not NaN).
        const backendSymbols = Array.isArray(msg.symbols) ? msg.symbols : [];

        // Subscribe to the union of backend symbols + symbols this client already
        // tracks locally, so any extra symbols get resolved to Kite tokens.
        const union = Array.from(new Set([...backendSymbols, ...Object.keys(SYMBOLS)]));
        try {
          realSocket.send(JSON.stringify({ type: "subscribe", symbols: union }));
        } catch (e) { console.warn('[live-ticks] swallowed:', e && e.message); }

        // Snapshot prices NOW so the UI doesn't sit on hardcoded seeds while
        // we wait for the first live tick (which during market-closed hours
        // may never arrive). /api/quotes hits Kite's REST LTP endpoint and
        // returns the last traded price per symbol — current during market
        // hours, last close after-hours.
        (async () => {
          try {
            // Equity symbols only — indices are handled by /ws subscribe.
            const eq = Object.keys(SYMBOLS).filter(s =>
              !/^(NIFTY|BANKNIFTY|SENSEX|FINNIFTY|MIDCPNIFTY|INDIAVIX|NIFTY 22550 CE|BANKNIFTY FUT)/.test(s)
            );
            if (eq.length === 0) return;
            const url = "/api/quotes?symbols=" + encodeURIComponent(eq.join(","));
            const res = await fetch(url, { credentials: "include" });
            if (!res.ok) return;
            const body = await res.json();
            if (!body || !body.quotes) return;
            let hits = 0;
            for (const [key, row] of Object.entries(body.quotes)) {
              if (!row || typeof row.last_price !== "number") continue;
              const sym = key.includes(":") ? key.split(":")[1] : key;
              // Tier 65: prev = previous day's close (from ohlc.close), not the seed ltp.
              // This is what Kite returns as the day's prior reference, so change% is meaningful.
              const prevClose = (row.ohlc && typeof row.ohlc.close === "number")
                ? row.ohlc.close
                : (typeof row.previous_close === "number" ? row.previous_close : row.last_price);
              if (!SYMBOLS[sym]) SYMBOLS[sym] = { ltp: row.last_price, prev: prevClose };
              else {
                SYMBOLS[sym].ltp = row.last_price;
                SYMBOLS[sym].prev = prevClose;
              }
              hits++;
            }
            if (hits > 0) {
              lastTickAt = Date.now();
              tickCount += hits;
              window.dispatchEvent(new CustomEvent("tick", { detail: state() }));
              try { console.log(`[live-ticks] snapshot from /api/quotes: ${hits} symbols`); } catch (e) { console.warn('[live-ticks] swallowed:', e && e.message); }
            }
          } catch (e) {
            try { console.warn("[live-ticks] snapshot fetch failed:", e.message); } catch (e) { console.warn('[live-ticks] swallowed:', e && e.message); }
          }
        })();
        return;
      }
      if (msg.type === "upstream_state") {
        // T99-T44: backend pushed a change in Kite-side connection state.
        upstreamConnected = !!msg.connected;
        upstreamStalledOnToken = !!msg.stalledOnToken;
        upstreamTickStale = !!msg.tickStale;
        try { console.log("[live-ticks] upstream_state:", { connected: upstreamConnected, stalledOnToken: upstreamStalledOnToken, tickStale: upstreamTickStale }); } catch (e) { console.warn('[live-ticks] swallowed:', e && e.message); }
        window.dispatchEvent(new CustomEvent("upstream-state", { detail: state().upstream }));
        return;
      }
      if (msg.type === "order_update" && msg.orderId) {
        // T99-T61: real-time Kite order postback. Backend HMAC-verified it
        // already (line 1019 of server.js); we just store + fan out. UI
        // consumers (Orders screen, toast notifier) can subscribe via the
        // 'order-update' CustomEvent or poll window.LiveTicks.state().orderUpdates.
        const entry = {
          orderId:   msg.orderId,
          status:    msg.status,
          symbol:    msg.symbol,
          exchange:  msg.exchange,
          side:      msg.side,
          quantity:  msg.quantity,
          filledQty: msg.filledQty,
          pendingQty: msg.pendingQty,
          price:     msg.price,
          avgPrice:  msg.avgPrice,
          statusMsg: msg.statusMsg,
          ts:        msg.ts || Date.now(),
        };
        orderUpdates.push(entry);
        if (orderUpdates.length > ORDER_UPDATES_MAX) orderUpdates.shift();
        try { console.log("[live-ticks] order_update:", entry.status, entry.symbol, entry.orderId); } catch (e) { console.warn('[live-ticks] swallowed:', e && e.message); }
        window.dispatchEvent(new CustomEvent("order-update", { detail: entry }));
        return;
      }
      if (msg.type === "subscribed") {
        // T-184 (F-12): backend ack — only log when ats_debug=1 in localStorage.
        // Reduces dev-tools noise for normal users while keeping the signal
        // available for operators investigating tick issues.
        try {
          if (window.localStorage && localStorage.getItem('ats_debug') === '1') {
            console.log("[live-ticks] subscribed:", msg);
          }
        } catch (e) { console.warn('[live-ticks] swallowed:', e && e.message); }
        return;
      }
      if (msg.type === "tick" && typeof msg.symbol === "string" && typeof msg.ltp === "number") {
        // Tier 65: ONLY update ltp on tick. Never touch prev -- it's the prior day's close,
        // a stable reference point for change% calculations.
        if (!SYMBOLS[msg.symbol]) {
          // First sighting of a symbol with no snapshot -- use the tick as both anchors.
          SYMBOLS[msg.symbol] = { ltp: msg.ltp, prev: msg.ltp };
        } else {
          SYMBOLS[msg.symbol].ltp = msg.ltp;
          // If prev hasn't been set from a real snapshot (still equal to original seed),
          // and msg includes ohlc.close, use it.
          if (typeof msg.prev === "number" && msg.prev > 0) {
            SYMBOLS[msg.symbol].prev = msg.prev;
          }
        }
        tickCount++;
        lastTickAt = Date.now();
        connected = true;
        gotData = true;
        window.dispatchEvent(new CustomEvent("tick", { detail: state() }));
      }
    });
    realSocket.addEventListener("close", () => {
      if (useRealFeed) {
        connected = false;
        connDropAt = Date.now();
        window.dispatchEvent(new CustomEvent("tick-disconnect", { detail: { at: connDropAt } }));
        // try to reconnect after 4 s
        setTimeout(attachRealFeed, 4000);
      }
    });
    realSocket.addEventListener("error", () => { /* fallback timer will handle it */ });
  }
  // Kick the real feed attempt without blocking the simulator.
  attachRealFeed();

  // T-420 (production-readiness audit, BLOCKER #1):
  // Was: an 800ms random-walk simulator that fabricated prices whenever the
  //      real feed wasn't connected. This is the misleading-fake-data path
  //      the audit flagged -- users saw plausible LTPs even when the broker
  //      WS was down. Gated behind demo mode (which is hard-disabled in
  //      primitives.jsx T83) so this is effectively dead code on prod, but
  //      kept for any future demo/screenshot mode.
  setInterval(() => {
    if (useRealFeed) return;
    if (!connected || !ticking) return;
    const demoOn = (typeof window.isDemoMode === 'function') && window.isDemoMode();
    if (!demoOn) return;
    Object.keys(SYMBOLS).forEach(sym => randomTick(SYMBOLS[sym]));
    tickCount++;
    lastTickAt = Date.now();
    window.dispatchEvent(new CustomEvent("tick", { detail: state() }));
  }, 800);

  // T-420: was a random connection-drop simulator (Math.random < 0.003 every
  // 1s). Same fakery problem. Gated behind demo mode.
  setInterval(() => {
    const demoOn = (typeof window.isDemoMode === 'function') && window.isDemoMode();
    if (!demoOn) return;
    if (Math.random() < 0.003) {
      connected = false;
      connDropAt = Date.now();
      window.dispatchEvent(new CustomEvent("tick-disconnect", { detail: { at: connDropAt } }));
      setTimeout(() => {
        connected = true;
        reconnects++;
        window.dispatchEvent(new CustomEvent("tick-reconnect", { detail: { downtime: Date.now() - connDropAt, reconnects } }));
      }, 2000 + Math.random() * 6000);
    }
  }, 1000);

  // Public API
  window.LiveTicks = {
    state,
    pause: () => { ticking = false; },
    resume: () => { ticking = true; },
    forceDisconnect: () => {
      connected = false;
      connDropAt = Date.now();
      window.dispatchEvent(new CustomEvent("tick-disconnect", { detail: { at: connDropAt } }));
      setTimeout(() => {
        connected = true;
        reconnects++;
        window.dispatchEvent(new CustomEvent("tick-reconnect", { detail: { downtime: Date.now() - connDropAt, reconnects } }));
      }, 3500);
    },
  };
})();

// React hook — components subscribe to a single symbol or all
const useLiveTick = (symbol) => {
  const [, bump] = React.useReducer(x => x + 1, 0);
  React.useEffect(() => {
    const h = () => bump();
    window.addEventListener("tick", h);
    window.addEventListener("tick-disconnect", h);
    window.addEventListener("tick-reconnect", h);
    return () => {
      window.removeEventListener("tick", h);
      window.removeEventListener("tick-disconnect", h);
      window.removeEventListener("tick-reconnect", h);
    };
  }, []);
  const s = window.LiveTicks.state();
  if (symbol) {
    const sym = s.symbols[symbol];
    if (!sym) return null;
    const change = sym.ltp - sym.prev;
    return { ltp: sym.ltp, prev: sym.prev, change, changePct: (change / sym.prev) * 100, connected: s.connected, lagMs: s.lagMs };
  }
  return s;
};

// Live ticker strip — horizontal scroll of all symbols, used in shell
const LiveTicker = () => {
  const tick = useLiveTick();
  if (!tick) return null;

  const symbols = Object.entries(tick.symbols);

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 0,
      background: "var(--bg-soft)", borderBottom: "1px solid var(--border)",
      height: 32, overflow: "hidden", position: "relative",
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 6, padding: "0 14px",
        flexShrink: 0, borderRight: "1px solid var(--border)", height: "100%",
        background: (() => {
          const ms = (typeof window.marketStatus === "function") ? window.marketStatus() : { open: true };
          if (!tick.connected) return "#dc2626"; // red: reconnecting
          if (!ms.open) return "#6b7280"; // grey: market closed
          const fresh = (Date.now() - (tick.lastTickAt || 0)) < 30000;
          if (!fresh) return "#d97706"; // amber: stale during open hours
          return "#059669"; // green: live
        })(),
        color: "#fff",
        fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase",
        position: "relative", zIndex: 2,
      }}>
        <span style={{
          width: 6, height: 6, borderRadius: "50%", background: "currentColor",
          boxShadow: tick.connected ? "0 0 0 3px color-mix(in oklab, var(--up) 25%, transparent)" : "none",
          animation: tick.connected ? "pulse 2s infinite" : "none",
        }}/>
        {(() => {
          const ms = (typeof window.marketStatus === "function") ? window.marketStatus() : { open: true, label: "" };
          if (!tick.connected) return "RECONNECTING";
          if (!ms.open) return ms.label || "CLOSED";
          const fresh = (Date.now() - (tick.lastTickAt || 0)) < 30000;
          if (!fresh) return "STALE";
          return "LIVE";
        })()}
      </div>
      <div style={{ display: "flex", overflow: "hidden", flex: 1, gap: 24, padding: "0 14px", whiteSpace: "nowrap", animation: "ticker-scroll 60s linear infinite" }}>
        {[...symbols, ...symbols].map(([sym, data], i) => {
          const change = data.ltp - data.prev;
          const pct = (change / data.prev) * 100;
          const up = change >= 0;
          return (
            <div key={i} style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 11, fontFamily: "var(--mono)" }}>
              <span style={{ fontWeight: 600, color: "var(--text)" }}>{sym}</span>
              <span style={{ color: "var(--text-2)" }}>{data.ltp.toFixed(2)}</span>
              <span style={{ color: up ? "var(--up)" : "var(--down)" }}>
                {up ? "▲" : "▼"} {pct >= 0 ? "+" : ""}{pct.toFixed(2)}%
              </span>
            </div>
          );
        })}
      </div>
      <style>{`
        @keyframes ticker-scroll {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
      `}</style>
    </div>
  );
};

// Tiny live cell — flashes on tick, used in tables
const LiveCell = ({ symbol, decimals = 2, showChange = false }) => {
  const tick = useLiveTick(symbol);
  const [flash, setFlash] = React.useState(null);
  const lastRef = React.useRef(tick && tick.ltp);

  React.useEffect(() => {
    if (!tick) return;
    if (lastRef.current && tick.ltp !== lastRef.current) {
      setFlash(tick.ltp > lastRef.current ? "up" : "down");
      const t = setTimeout(() => setFlash(null), 400);
      lastRef.current = tick.ltp;
      return () => clearTimeout(t);
    }
    lastRef.current = tick && tick.ltp;
  }, [tick && tick.ltp]);

  if (!tick) return <span className="muted">—</span>;
  const bg = flash === "up" ? "var(--up-soft)" : flash === "down" ? "var(--down-soft)" : "transparent";
  const color = flash === "up" ? "var(--up)" : flash === "down" ? "var(--down)" : undefined;

  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "1px 6px", borderRadius: 4,
      background: bg, color, transition: "background .3s, color .3s",
      fontFamily: "var(--mono)", fontSize: "inherit",
    }}>
      {tick.ltp.toFixed(decimals)}
      {showChange && (
        <span style={{ fontSize: 10, color: tick.change >= 0 ? "var(--up)" : "var(--down)" }}>
          {tick.change >= 0 ? "+" : ""}{tick.changePct.toFixed(2)}%
        </span>
      )}
    </span>
  );
};

Object.assign(window, { useLiveTick, LiveTicker, LiveCell });

// Connection state hook — components react to disconnect/reconnect
const useConnectionState = () => {
  const [state, setState] = React.useState(() => {
    const s = window.LiveTicks.state();
    return { connected: s.connected, lagMs: s.lagMs, lastTickAt: s.lastTickAt };
  });
  React.useEffect(() => {
    const update = () => {
      const s = window.LiveTicks.state();
      setState({ connected: s.connected, lagMs: s.lagMs, lastTickAt: s.lastTickAt });
    };
    window.addEventListener("tick", update);
    window.addEventListener("tick-disconnect", update);
    window.addEventListener("tick-reconnect", update);
    // Also re-evaluate every 2s so the "X seconds ago" updates while idle
    const id = setInterval(update, 2000);
    return () => {
      window.removeEventListener("tick", update);
      window.removeEventListener("tick-disconnect", update);
      window.removeEventListener("tick-reconnect", update);
      clearInterval(id);
    };
  }, []);
  return state;
};

// Aggregate P&L for a list of positions — returns live total + delta
// positions: [{ symbol, qty, avg }] — uses LiveTicks LTP per symbol
const useLivePnL = (positions) => {
  useLiveTick(); // subscribe to global tick
  const s = window.LiveTicks.state();
  let total = 0;
  let mtm = 0;
  positions.forEach(p => {
    const sym = s.symbols[p.symbol];
    if (!sym) {
      // Fallback: use the static `ltp` field if symbol not in feed
      if (typeof p.ltp === "number") {
        total += (p.ltp - p.avg) * p.qty;
        mtm   += p.ltp * p.qty;
      }
      return;
    }
    total += (sym.ltp - p.avg) * p.qty;
    mtm   += sym.ltp * p.qty;
  });
  return { total, mtm, connected: s.connected };
};

// Animated number that smooth-counts to its target value
const CountUp = ({ value, format = (v) => v.toFixed(0), duration = 400 }) => {
  const [shown, setShown] = React.useState(value);
  const fromRef = React.useRef(value);
  const startRef = React.useRef(performance.now());
  const targetRef = React.useRef(value);
  React.useEffect(() => {
    fromRef.current = shown;
    targetRef.current = value;
    startRef.current = performance.now();
    let raf;
    const step = (now) => {
      const t = Math.min(1, (now - startRef.current) / duration);
      const ease = 1 - Math.pow(1 - t, 3);
      const v = fromRef.current + (targetRef.current - fromRef.current) * ease;
      setShown(v);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span>{format(shown)}</span>;
};

// Stale indicator — small badge near a price showing "now" / "3s ago" / "stale".
// T99-T51: respects upstream stall state too — when the backend's Kite WS is
// stalled on an expired token (T-34) or frozen mid-day (T-37), the local
// socket might still be fine, but the prices we're displaying are stale
// because the backend has no new data to send us. Override the local "now"
// reading in that case.
const StaleIndicator = ({ compact = false }) => {
  const { connected, lastTickAt } = useConnectionState();
  const age = Math.floor((Date.now() - lastTickAt) / 1000);
  // Read upstream state directly from LiveTicks — useConnectionState only
  // exposes the local socket fields. Cheap (one object access per render).
  let upstream = null;
  try { upstream = window.LiveTicks && window.LiveTicks.state && window.LiveTicks.state().upstream; } catch (e) { console.warn('[live-ticks] swallowed:', e && e.message); }
  if (upstream && upstream.stalledOnToken) {
    return <span style={{ fontSize: 9, color: "var(--down)", marginLeft: 4 }} title="Broker token expired — reconnect from Brokers screen">⚠ feed offline</span>;
  }
  if (upstream && upstream.tickStale) {
    return <span style={{ fontSize: 9, color: "var(--warn, #d97706)", marginLeft: 4 }} title="Backend received no ticks for 90+s while market open">⚠ frozen</span>;
  }
  if (connected && age < 2) {
    return <span style={{ fontSize: 9, color: "var(--up)", marginLeft: 4 }}>● now</span>;
  }
  if (connected && age < 10) {
    return <span style={{ fontSize: 9, color: "var(--text-3)", marginLeft: 4 }}>{age}s ago</span>;
  }
  return <span style={{ fontSize: 9, color: "var(--down)", marginLeft: 4 }} title="Feed lag exceeded">⚠ stale {age}s</span>;
};

Object.assign(window, { useConnectionState, useLivePnL, CountUp, StaleIndicator });
