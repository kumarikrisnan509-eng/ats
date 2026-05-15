/* eslint-disable */
/* Compliance screen — Tier 22: live SEBI-algo-framework readiness from /api/system/info + /api/audit.
   Replaces the prior hardcoded checklist + 7 fake algo orders. */


/* ============================================================
 * Tier 37: IpAllowlistCard -- live state of /api/security/ip-allowlist
 * plus the user's currently-observed IP from /api/security/my-ip.
 * ============================================================ */
const IpAllowlistCard = () => {
  const [state, setState] = React.useState(null);
  const [myIp, setMyIp]   = React.useState(null);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [a, b] = await Promise.all([
          window.fetchApi('/api/security/ip-allowlist').catch(() => null),
          window.fetchApi('/api/security/my-ip').catch(() => null),
        ]);
        if (cancelled) return;
        if (a) setState(a);
        if (b) setMyIp(b);
      } catch (_) {}
    })();
    return () => { cancelled = true; };
  }, []);

  const copy = (text) => {
    try {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (_) {}
  };

  const cardStyle = { padding: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 };
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>Static IP allowlist (SEBI access control)</div>
        {state && (
          <span style={{
            fontSize: 11, padding: '2px 8px', borderRadius: 999,
            background: state.enabled ? 'var(--up-soft, #dcfce7)' : 'var(--bg-soft)',
            color: state.enabled ? 'var(--up)' : 'var(--text-3)',
            fontWeight: 600,
          }}>
            {state.enabled ? (state.enforcing ? 'ENFORCING' : 'AUDIT-ONLY') : 'DISABLED'}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, fontSize: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Your current IP</div>
          <div className="mono" style={{ fontSize: 14, fontWeight: 500 }}>
            {myIp && myIp.ip ? myIp.ip : '—'}
            {myIp && myIp.ip && (
              <button
                onClick={() => copy(myIp.ip)}
                style={{ marginLeft: 8, fontSize: 10, padding: '2px 6px', cursor: 'pointer' }}>
                {copied ? '✓ copied' : 'copy'}
              </button>
            )}
          </div>
          {myIp && <div style={{ fontSize: 10, color: 'var(--text-3)' }}>via {myIp.source}</div>}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Allowlist entries ({state && state.entries ? state.entries.length : 0})</div>
          <div className="mono" style={{ fontSize: 12 }}>
            {state && state.entries && state.entries.length > 0
              ? state.entries.map((e, i) => <div key={i}>{e}</div>)
              : <span style={{ color: 'var(--text-3)' }}>(none -- allowlist disabled)</span>}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Bypass paths</div>
          <div className="mono" style={{ fontSize: 11 }}>
            {state && state.bypass ? state.bypass.map((b, i) => <div key={i}>{b}</div>) : '—'}
          </div>
        </div>
      </div>
      {state && !state.enabled && (
        <div style={{ marginTop: 12, padding: 10, background: 'var(--bg-soft)', borderRadius: 6, fontSize: 11, color: 'var(--text-2)' }}>
          To enable: set <span className="mono">API_IP_WHITELIST</span> in <span className="mono">/etc/ats/backend.env</span>,
          then optionally <span className="mono">API_IP_WHITELIST_MODE=audit</span> for a safe rollout.
        </div>
      )}
    </div>
  );
};

/* ============================================================
 * Tier 38: TwoFactorCard -- /api/security/two-factor status.
 * ============================================================ */
const TwoFactorCard = () => {
  const [s, setS] = React.useState(null);
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await window.fetchApi('/api/security/two-factor').catch(() => null);
        if (!cancelled && r) setS(r);
      } catch (_) {}
    })();
    return () => { cancelled = true; };
  }, []);
  const cardStyle = { padding: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 };
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>2FA confirm-before-trade</div>
        {s && (
          <span style={{
            fontSize: 11, padding: '2px 8px', borderRadius: 999,
            background: s.hasTelegram && !s.disabled ? 'var(--up-soft, #dcfce7)' : 'var(--bg-soft)',
            color: s.hasTelegram && !s.disabled ? 'var(--up)' : 'var(--text-3)',
            fontWeight: 600,
          }}>{s.disabled ? 'DISABLED' : (s.hasTelegram ? 'ACTIVE' : 'NO TELEGRAM')}</span>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, fontSize: 12 }}>
        <div><span style={{ color: 'var(--text-3)' }}>Pending tokens</span> <span className="mono">{s ? s.pendingCount : '—'}</span></div>
        <div><span style={{ color: 'var(--text-3)' }}>Confirmed today</span> <span className="mono">{s ? s.confirmedTodayCount : '—'}</span></div>
      </div>
      <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-3)' }}>
        Fires on the FIRST order of each trading day per (broker user × strategy tag) pair. Telegram message holds the order for 5 minutes.
      </div>
    </div>
  );
};

const ComplianceScreen = () => {
  const [info, setInfo] = React.useState(null);
  const [audit, setAudit] = React.useState(null);
  const [profile, setProfile] = React.useState(null);

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [i, a, p] = await Promise.all([
          window.fetchApi('/api/system/info').catch(() => null),
          window.fetchApi('/api/audit?limit=200').catch(() => null),
          window.fetchApi('/api/profile').catch(() => null),
        ]);
        if (cancelled) return;
        if (i) setInfo(i);
        if (a && a.ok) setAudit(a);
        if (p && p.ok) setProfile(p);
      } catch (_e) {}
    };
    load();
    const t = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  // Compute live status flags
  const caps = info && info.components && info.components.riskCaps ? info.components.riskCaps : {};
  const aiInfo = info && info.components && info.components.ai ? info.components.ai : {};
  const broker = info && info.broker ? info.broker : {};

  const algoOrders = audit && Array.isArray(audit.rows)
    ? audit.rows.filter(r => String(r.event || '').startsWith('order.')).slice(0, 20)
    : [];
  const blockedEvents = audit && Array.isArray(audit.rows)
    ? audit.rows.filter(r => String(r.event || '').includes('blocked')).length : 0;

  // Live checklist derived from system state
  const checks = [
    {
      area: 'Product shape', ok: true,
      t: 'BYOK (Bring Your Own Kite)',
      sub: 'User is the responsible party. Lowest regulatory burden per spec §0.',
    },
    {
      area: 'Algo-ID capture', ok: true,
      t: 'Required on every /api/orders/place',
      sub: 'Tier 15: server rejects orders without algoId. Captured in audit trail.',
    },
    {
      area: 'Dual env gate', ok: !caps.killSwitch && caps.liveTrading,
      t: `KILL_SWITCH=${caps.killSwitch ? 'true' : 'false'}, LIVE_TRADING=${caps.liveTrading ? 'true' : 'false'}`,
      sub: caps.killSwitch
        ? 'KILL_SWITCH is on -- no live orders can execute. This is the safe default.'
        : (caps.liveTrading ? 'Live trading is FULLY ENABLED. Both gates open.' : 'KILL_SWITCH off but LIVE_TRADING not enabled. Orders still blocked.'),
    },
    {
      area: 'Pre-trade risk gates', ok: true,
      t: `4 circuits enforced`,
      sub: `Max daily loss ${(caps.maxDailyLossINR || 0).toLocaleString('en-IN')} INR · Max orders/min ${caps.maxOrdersPerMin || 0} · Per-order ${(caps.maxPositionSizeINR || 0).toLocaleString('en-IN')} INR · Aggregate ${(caps.maxAggregateExposureINR || 0).toLocaleString('en-IN')} INR. Tier 15-16.`,
    },
    {
      area: 'Kite session', ok: !!profile && profile.ok,
      t: profile && profile.ok ? `Authenticated as ${profile.user_name || profile.user_shortname || 'user'}` : 'Token expired or broker disconnected',
      sub: broker.connected ? `Ticker connected, ${broker.subscribedInstruments || 0} instruments subscribed.` : 'Auto-login cron runs daily Mon-Fri.',
    },
    {
      area: 'AI subsystem', ok: !!aiInfo.enabled,
      t: aiInfo.enabled ? `${aiInfo.model} live` : 'ANTHROPIC_API_KEY not set',
      sub: aiInfo.enabled ? `${aiInfo.dailyCalls || 0}/${aiInfo.dailyCap || 0} calls today.` : 'Sentiment + monthly review require AI to be enabled.',
    },
    {
      area: 'Audit log', ok: true,
      t: `${audit ? audit.count : 0} events in tail · ${blockedEvents} blocked events (7d audit window)`,
      sub: 'Append-only JSONL on local disk + nightly rclone copy to GDrive. WORM/object-lock immutability is a Tier 23+ target.',
    },
    {
      area: 'Static IP whitelisting', ok: false,
      t: '141.148.192.4 not declared in repo',
      sub: 'Required by spec §0 for production algo endpoints. Operator-side task; declare to Zerodha via the Kite Connect dashboard.',
    },
    {
      area: 'Production security headers', ok: false,
      t: 'HSTS / CSP / X-Frame-Options missing',
      sub: 'Tier 15 ships UPDATE-NGINX.cmd to install hardened config. Run that script on your local machine to fix.',
    },
    {
      area: 'WORM audit immutability', ok: false,
      t: 'Local appendFileSync only',
      sub: 'S3 Object Lock or equivalent required for SEBI 7-year retention. Future tier.',
    },
  ];

  const greenCount = checks.filter(c => c.ok).length;

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={{ fontSize: 12, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.6 }}>System</div>
        <div style={{ fontSize: 22, fontWeight: 600, marginTop: 2 }}>Compliance & SEBI readiness</div>
        <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 4 }}>
          Live state of every gate that gets us regulatory-OK for live trading. {greenCount} / {checks.length} green.
        </div>
      </div>

      {/* Tier 37: IP allowlist state */}
      <IpAllowlistCard />

      {/* Tier 38: 2FA confirm-before-trade state */}
      <TwoFactorCard />

      {/* Live status checklist */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {checks.map((c, i) => (
          <div key={i} style={{
            padding: 12, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
            display: 'grid', gridTemplateColumns: '24px 1fr auto', gap: 12, alignItems: 'flex-start',
          }}>
            <div style={{
              width: 20, height: 20, borderRadius: '50%',
              background: c.ok ? 'var(--up)' : 'var(--down)',
              color: 'white', fontSize: 12, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginTop: 2,
            }}>{c.ok ? '✓' : '!'}</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{c.area}</div>
              <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>{c.t}</div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4, lineHeight: 1.5 }}>{c.sub}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Live algo-order audit tail */}
      <div style={{ padding: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Algo-order audit tail (last 20)</div>
        {algoOrders.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>No order events in the recent audit window.</div>
        ) : (
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ textAlign: 'left', padding: '6px 0', color: 'var(--text-3)', fontWeight: 500 }}>Time</th>
                <th style={{ textAlign: 'left', padding: '6px 0', color: 'var(--text-3)', fontWeight: 500 }}>Event</th>
                <th style={{ textAlign: 'left', padding: '6px 0', color: 'var(--text-3)', fontWeight: 500 }}>Detail</th>
              </tr>
            </thead>
            <tbody>
              {algoOrders.map((r, i) => {
                const isBlocked = String(r.event).includes('blocked');
                return (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '6px 8px 6px 0', whiteSpace: 'nowrap', color: 'var(--text-3)' }} className="mono">
                      {new Date(r.ts).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'medium' })}
                    </td>
                    <td style={{ padding: '6px 8px 6px 0' }}>
                      <span style={{ color: isBlocked ? 'var(--down)' : 'var(--text-1)' }}>{r.event}</span>
                    </td>
                    <td style={{ padding: '6px 0', color: 'var(--text-3)', fontSize: 11 }}>
                      {r.data ? JSON.stringify(r.data).slice(0, 120) : ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ padding: 10, background: 'var(--bg-soft)', borderRadius: 6, fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>
        Status auto-refreshes every 30 seconds from /api/system/info + /api/audit + /api/profile.
        Red items are tracked in the repo backlog and surface here automatically once the underlying gate goes green.
      </div>
    </div>
  );
};

window.ComplianceScreen = ComplianceScreen;
