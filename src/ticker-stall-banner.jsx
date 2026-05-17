/* eslint-disable */
/* T99-T45: top-of-page banner shown when the BACKEND tells us its upstream
   ticker (Kite WS) is in a degraded state — either stalled on an expired
   access_token (T-34 detection) or frozen mid-day (T-37 heartbeat).

   How it knows: live-ticks.jsx dispatches 'upstream-state' CustomEvents
   whenever the backend sends an {type:'upstream_state', ...} message over
   /ws. We listen for those, plus seed initial state from
   window.LiveTicks.state().upstream so the banner shows up correctly even
   if we missed the welcome message (e.g. mounted after /ws connected).

   Dismissible per-session via X. Re-shows on the next state change so a
   fresh stall after dismissal doesn't get silently hidden. */

const TickerStallBanner = ({ setRoute }) => {
  const [upstream, setUpstream] = React.useState(() => {
    try { return (window.LiveTicks && window.LiveTicks.state && window.LiveTicks.state().upstream) || null; }
    catch { return null; }
  });
  // Dismissal is keyed by the (stalledOnToken, tickStale) tuple. Dismissing
  // 'stalledOnToken' won't suppress a later 'tickStale' — different problem,
  // different banner.
  const [dismissedKey, setDismissedKey] = React.useState(null);

  React.useEffect(() => {
    const onUpstream = (e) => setUpstream(e.detail || null);
    window.addEventListener('upstream-state', onUpstream);
    // Also poll once a second as a belt-and-braces — LiveTicks may not have
    // emitted the event yet if this banner mounts mid-handshake.
    const poll = setInterval(() => {
      try {
        const s = window.LiveTicks && window.LiveTicks.state && window.LiveTicks.state().upstream;
        if (s) setUpstream(s);
      } catch (_) {}
    }, 1000);
    return () => {
      window.removeEventListener('upstream-state', onUpstream);
      clearInterval(poll);
    };
  }, []);

  if (!upstream) return null;
  // Only show the banner for the two real-degraded states; not for plain
  // "not connected yet" since that's covered by BrokerNotConnectedBanner.
  const isStalled = upstream.stalledOnToken === true;
  const isFrozen  = upstream.tickStale === true;
  if (!isStalled && !isFrozen) return null;

  const key = isStalled ? 'stalled' : 'frozen';
  if (dismissedKey === key) return null;

  const tone = isStalled ? 'danger' : 'warn';
  const bg = tone === 'danger'
    ? 'color-mix(in oklab, var(--danger, #dc2626) 12%, var(--surface))'
    : 'color-mix(in oklab, var(--warn, #d97706) 12%, var(--surface))';
  const border = tone === 'danger'
    ? 'color-mix(in oklab, var(--danger, #dc2626) 35%, var(--border))'
    : 'color-mix(in oklab, var(--warn, #d97706) 35%, var(--border))';
  const icon = isStalled ? '🔌' : '⏸';
  const title = isStalled ? 'Live data feed disconnected.' : 'Live data feed frozen.';
  const detail = isStalled
    ? 'Your Zerodha access token has expired and the WebSocket is no longer reconnecting (3 consecutive 403s). Reconnect to resume live prices and trading.'
    : 'No ticks have arrived from Kite in 90+ seconds while the market is open. Prices on screen may be stale. Check the Brokers screen.';

  return (
    <div role="status" aria-live="polite" style={{
      padding: '10px 16px',
      background: bg,
      borderBottom: '1px solid ' + border,
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      fontSize: 13,
    }}>
      <span style={{ fontSize: 18 }} aria-hidden="true">{icon}</span>
      <div style={{ flex: 1 }}>
        <strong>{title}</strong>
        <span className="muted" style={{ marginLeft: 8 }}>{detail}</span>
      </div>
      <button
        className="btn btn--sm btn--primary"
        onClick={() => setRoute && setRoute('brokers')}
      >Open Brokers</button>
      <button
        className="btn btn--sm btn--ghost"
        aria-label="dismiss"
        onClick={() => setDismissedKey(key)}
      >×</button>
    </div>
  );
};

Object.assign(window, { TickerStallBanner });
