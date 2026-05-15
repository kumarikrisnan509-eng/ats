/* eslint-disable */
/* Tier 58: top-of-page banner shown when the user is authenticated but has not yet
   connected a broker. Hidden once they connect, dismissible per-session via X. */

const BrokerNotConnectedBanner = ({ setRoute }) => {
  const [state, setState] = React.useState({ checked: false, connected: null });
  const [dismissed, setDismissed] = React.useState(() => {
    try { return sessionStorage.getItem('ats_broker_banner_dismissed') === '1'; }
    catch { return false; }
  });

  React.useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch('/api/me/broker', { credentials: 'include' });
        if (cancelled) return;
        if (res.status === 401) {
          setState({ checked: true, connected: null }); // not logged in
          return;
        }
        const j = await res.json();
        const connected = !!(j && j.ok && Array.isArray(j.brokers) && j.brokers.length > 0);
        setState({ checked: true, connected });
      } catch (_) {
        if (!cancelled) setState({ checked: true, connected: null });
      }
    };
    check();
    const id = setInterval(check, 60000); // re-check every minute (cheap GET)
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (dismissed) return null;
  if (!state.checked) return null;
  if (state.connected !== false) return null; // null = unauthed, true = connected — both hide

  return (
    <div style={{
      padding: '10px 16px',
      background: 'color-mix(in oklab, var(--warn, #d97706) 12%, var(--surface))',
      borderBottom: '1px solid color-mix(in oklab, var(--warn, #d97706) 30%, var(--border))',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      fontSize: 13,
    }}>
      <span style={{ fontSize: 18 }}>🔌</span>
      <div style={{ flex: 1 }}>
        <strong>Connect your broker to see live holdings, orders, and positions.</strong>
        <span className="muted" style={{ marginLeft: 8 }}>Paper trading and watchlists work without it — but the Portfolio and Orders screens stay empty until you connect.</span>
      </div>
      <button
        className="btn btn--sm btn--primary"
        onClick={() => setRoute && setRoute('brokers')}
      >Connect now</button>
      <button
        className="btn btn--sm btn--ghost"
        aria-label="dismiss"
        onClick={() => {
          setDismissed(true);
          try { sessionStorage.setItem('ats_broker_banner_dismissed', '1'); } catch (_) {}
        }}
      >×</button>
    </div>
  );
};

Object.assign(window, { BrokerNotConnectedBanner });
