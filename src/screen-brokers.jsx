/* eslint-disable */
/* Brokers screen — broker adapter pattern.
   Tier 57: per-user broker credentials. Each user can connect their own Zerodha (or other broker)
            from this screen. Credentials are libsodium-sealed server-side and never returned.
   Tier 79: 3-state status card (connected / token-expired-with-auto / token-expired-no-auto)
            + 3-step wizard for Edit credentials
            + Auto reauth (1-click headless) and Manual reauth (popup) explicit buttons. */

// ============================================================================
// Helpers
// ============================================================================
const _fmtRelative = (iso) => {
  if (!iso) return '—';
  const t = new Date(iso); if (Number.isNaN(t.getTime())) return '—';
  const dt = (Date.now() - t.getTime()) / 1000;
  if (dt < 60) return 'just now';
  if (dt < 3600) return `${Math.round(dt/60)}m ago`;
  if (dt < 86400) return `${Math.round(dt/3600)}h ago`;
  return `${Math.round(dt/86400)}d ago`;
};
const _fmtRelativeFuture = (iso) => {
  if (!iso) return '—';
  const t = new Date(iso); if (Number.isNaN(t.getTime())) return '—';
  const dt = (t.getTime() - Date.now()) / 1000;
  if (dt <= 0) return 'expired';
  if (dt < 60)    return `${Math.round(dt)}s left`;
  if (dt < 3600)  return `${Math.round(dt/60)}m left`;
  if (dt < 86400) return `${Math.round(dt/3600)}h ${Math.round((dt%3600)/60)}m left`;
  return `${Math.round(dt/86400)}d left`;
};
const _isBase32 = (s) => /^[A-Z2-7]{16,}={0,7}$/i.test((s||'').replace(/\s/g, ''));

// ============================================================================
// 3-step Edit/Connect wizard
// ============================================================================
const BrokerWizardModal = ({ open, mode, brokerName, existing, onClose, onSaved }) => {
  if (!open) return null;
  const [step, setStep] = React.useState(1);
  const [brokerUserId, setBrokerUserId] = React.useState(existing?.broker_user_id || '');
  const [apiKey, setApiKey]             = React.useState('');
  const [apiSecret, setApiSecret]       = React.useState('');
  const [totpSeed, setTotpSeed]         = React.useState('');
  const [kitePassword, setKitePassword] = React.useState('');
  const [setDefault, setSetDefault]     = React.useState(true);
  const [showApiKey, setShowApiKey]     = React.useState(false);
  const [showApiSecret, setShowApiSecret] = React.useState(false);
  const [showPassword, setShowPassword] = React.useState(false);
  const [autoReauth, setAutoReauth]     = React.useState(true);
  const [busy, setBusy]                 = React.useState(false);
  const [progress, setProgress]         = React.useState([]);
  const [err, setErr]                   = React.useState('');

  React.useEffect(() => {
    setStep(1);
    setBrokerUserId(existing?.broker_user_id || '');
    setApiKey(''); setApiSecret(''); setTotpSeed(''); setKitePassword('');
    setSetDefault(true); setBusy(false); setProgress([]); setErr('');
  }, [open, existing && existing.id]);

  const isZerodha = brokerName.toLowerCase() === 'zerodha';
  const hasExistingApi = mode === 'edit' && existing && existing.has_api_key;
  const hasExistingTotp = mode === 'edit' && existing && existing.has_totp && existing.has_password;

  // Step 1 validity: requires user id always; api key/secret required unless editing-with-existing
  const step1Ok = brokerUserId.length >= 2 && (hasExistingApi || (apiKey.length >= 4 && apiSecret.length >= 4));
  const wantsAutoLogin = (totpSeed && kitePassword) || hasExistingTotp;

  const submit = async () => {
    setErr(''); setBusy(true); setProgress([{ step: 'save', status: 'pending', label: 'Save sealed credentials' }]);
    try {
      const url = mode === 'edit' && existing ? `/api/me/broker/${existing.id}` : '/api/me/broker';
      const method = mode === 'edit' ? 'PUT' : 'POST';
      const body = { broker: brokerName.toLowerCase(), broker_user_id: brokerUserId };
      if (apiKey)       body.api_key    = apiKey;
      if (apiSecret)    body.api_secret = apiSecret;
      if (totpSeed)     body.totp_seed  = totpSeed;
      if (kitePassword) body.password   = kitePassword;
      body.set_default = setDefault;
      if (autoReauth && wantsAutoLogin) body.autoReauthAfterSave = true;

      setProgress([{ step: 'save', status: 'in_progress', label: 'Save sealed credentials' }]);
      const res = await fetch(url, {
        method, credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) {
        setProgress([{ step: 'save', status: 'failed', label: 'Save sealed credentials', detail: j.reason || j.detail }]);
        setErr(j.reason || `HTTP ${res.status}`);
        return;
      }

      const next = [{ step: 'save', status: 'done', label: 'Save sealed credentials' }];
      if (j.autoReauth) {
        if (j.autoReauth.ok) {
          next.push({ step: 'reauth', status: 'done', label: `Headless Kite login · token valid until ${new Date(j.autoReauth.expiresAt).toLocaleString()}` });
        } else {
          next.push({ step: 'reauth', status: 'failed', label: 'Headless Kite login', detail: j.autoReauth.reason + (j.autoReauth.detail ? `: ${j.autoReauth.detail}` : '') });
        }
      }
      setProgress(next);

      onSaved && onSaved();
      // Auto-close on full success after a beat so the user sees the green ticks.
      const allDone = next.every(p => p.status === 'done');
      if (allDone) setTimeout(() => onClose(), 1200);
    } catch (e) {
      setErr(e.message || 'request failed');
      setProgress(p => p.map(s => s.status === 'in_progress' ? { ...s, status: 'failed' } : s));
    } finally {
      setBusy(false);
    }
  };

  const title = mode === 'edit' ? `Edit ${brokerName} connection` : `Connect ${brokerName}`;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'grid', placeItems: 'center', zIndex: 1000 }}>
      <Card style={{ width: 'min(540px, 94vw)', maxHeight: '92vh', overflow: 'auto' }}>
        <div className="between" style={{ marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{title}</h3>
          <button className="btn btn--sm btn--ghost" onClick={onClose} aria-label="close" disabled={busy}>×</button>
        </div>

        {/* Progress bar */}
        <div className="row" style={{ gap: 6, marginBottom: 16 }}>
          {[1,2,3].map(n => (
            <div key={n} style={{
              flex: 1, height: 4, borderRadius: 2,
              background: step >= n ? (n < step ? 'var(--up)' : 'var(--accent)') : 'var(--border)',
            }} />
          ))}
        </div>

        {/* STEP 1: required */}
        {step === 1 && (
          <>
            <div className="muted" style={{ fontSize: 11, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Step 1 of 3 · Required</div>
            <div className="muted" style={{ fontSize: 12, marginBottom: 14 }}>
              {isZerodha ? <>Get your API key/secret from <span className="mono">developers.kite.trade</span>.</> : <>Enter credentials from your broker dashboard.</>}
            </div>

            <label style={{ display: 'block', marginBottom: 12 }}>
              <div style={{ fontSize: 12, marginBottom: 4 }}>Broker user ID {isZerodha && <span className="muted">· Kite client id (e.g. ABC123)</span>}</div>
              <input className="input" required value={brokerUserId} onChange={e => setBrokerUserId(e.target.value.trim())} placeholder="e.g. ABC123" />
            </label>

            <label style={{ display: 'block', marginBottom: 12 }}>
              <div className="between" style={{ marginBottom: 4 }}>
                <span style={{ fontSize: 12 }}>API key {hasExistingApi && <span className="muted">· leave blank to keep existing</span>}</span>
                <button type="button" className="btn btn--sm btn--ghost" style={{ fontSize: 11 }} onClick={() => setShowApiKey(s => !s)}>{showApiKey ? 'hide' : 'show'}</button>
              </div>
              <input className="input" type={showApiKey ? 'text' : 'password'} autoComplete="off" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={hasExistingApi ? '(unchanged)' : ''} />
            </label>

            <label style={{ display: 'block', marginBottom: 12 }}>
              <div className="between" style={{ marginBottom: 4 }}>
                <span style={{ fontSize: 12 }}>API secret {hasExistingApi && <span className="muted">· leave blank to keep existing</span>}</span>
                <button type="button" className="btn btn--sm btn--ghost" style={{ fontSize: 11 }} onClick={() => setShowApiSecret(s => !s)}>{showApiSecret ? 'hide' : 'show'}</button>
              </div>
              <input className="input" type={showApiSecret ? 'text' : 'password'} autoComplete="off" value={apiSecret} onChange={e => setApiSecret(e.target.value)} placeholder={hasExistingApi ? '(unchanged)' : ''} />
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, fontSize: 13 }}>
              <input type="checkbox" checked={setDefault} onChange={e => setSetDefault(e.target.checked)} /> Use this as my default broker
            </label>

            <div className="row" style={{ justifyContent: 'space-between' }}>
              <button type="button" className="btn btn--sm" onClick={onClose}>Cancel</button>
              <button type="button" className="btn btn--sm btn--primary" disabled={!step1Ok} onClick={() => setStep(2)}>Continue →</button>
            </div>
          </>
        )}

        {/* STEP 2: auto-login (optional) */}
        {step === 2 && (
          <>
            <div className="muted" style={{ fontSize: 11, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Step 2 of 3 · Auto-login (optional)</div>
            <div className="muted" style={{ fontSize: 12, marginBottom: 14 }}>
              Add TOTP seed + Kite password and we'll log you in automatically every morning. Skip and you'll click Reauth daily.
            </div>

            <label style={{ display: 'block', marginBottom: 12 }}>
              <div className="between" style={{ marginBottom: 4 }}>
                <span style={{ fontSize: 12 }}>TOTP seed (base32, ~32 chars)</span>
                {isZerodha && <a href="https://kite.zerodha.com/settings/account" target="_blank" rel="noopener" style={{ fontSize: 11, color: 'var(--accent)' }}>Where to find this ↗</a>}
              </div>
              <input className="input" value={totpSeed} onChange={e => setTotpSeed(e.target.value.replace(/\s/g, '').toUpperCase())} placeholder={hasExistingTotp ? '(unchanged — seed already saved)' : 'JBSWY3DPEHPK3PXP...'} />
              {totpSeed && (
                <div style={{ fontSize: 11, marginTop: 4, color: _isBase32(totpSeed) ? 'var(--up)' : 'var(--danger)' }}>
                  {_isBase32(totpSeed) ? `✓ valid base32 · ${totpSeed.length} chars` : 'must be base32 (A–Z + 2–7)'}
                </div>
              )}
            </label>

            <label style={{ display: 'block', marginBottom: 14 }}>
              <div className="between" style={{ marginBottom: 4 }}>
                <span style={{ fontSize: 12 }}>Kite password</span>
                <button type="button" className="btn btn--sm btn--ghost" style={{ fontSize: 11 }} onClick={() => setShowPassword(s => !s)}>{showPassword ? 'hide' : 'show'}</button>
              </div>
              <input className="input" type={showPassword ? 'text' : 'password'} autoComplete="off" value={kitePassword} onChange={e => setKitePassword(e.target.value)} placeholder={hasExistingTotp ? '(unchanged)' : 'Your kite.zerodha.com login password'} />
            </label>

            <div style={{ background: 'color-mix(in oklab, var(--accent) 8%, transparent)', padding: '8px 10px', borderRadius: 6, marginBottom: 16, fontSize: 11, color: 'var(--text-2)' }}>
              🔒 Sealed with libsodium. Never logged. Never returned to the browser after save.
            </div>

            <div className="between">
              <button type="button" className="btn btn--sm" onClick={() => { setTotpSeed(''); setKitePassword(''); setStep(3); }}>Skip auto-login →</button>
              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="btn btn--sm" onClick={() => setStep(1)}>Back</button>
                <button type="button" className="btn btn--sm btn--primary" onClick={() => setStep(3)}>Continue →</button>
              </div>
            </div>
          </>
        )}

        {/* STEP 3: confirm + live progress */}
        {step === 3 && (
          <>
            <div className="muted" style={{ fontSize: 11, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Step 3 of 3 · Save and connect</div>
            <div className="muted" style={{ fontSize: 12, marginBottom: 14 }}>
              {wantsAutoLogin
                ? 'We can run a headless Kite login right after saving (~10 seconds, no popup).'
                : 'Without TOTP+password we can only save credentials. You can do Manual reauth later from the broker card.'}
            </div>

            {wantsAutoLogin && (
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: 10, marginBottom: 14, border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 }}>
                <input type="checkbox" checked={autoReauth} onChange={e => setAutoReauth(e.target.checked)} style={{ marginTop: 3 }}/>
                <span>
                  <div>Save and auto-reauth now</div>
                  <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>If unchecked, the credentials are saved but you'll still see "needs reauth" until you click Auto reauth on the card.</div>
                </span>
              </label>
            )}

            {progress.length > 0 && (
              <div style={{ padding: 10, marginBottom: 14, background: 'var(--bg-soft)', borderRadius: 6 }}>
                {progress.map((p, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 0' }}>
                    <span style={{ color: p.status === 'done' ? 'var(--up)' : p.status === 'failed' ? 'var(--danger)' : p.status === 'in_progress' ? 'var(--accent)' : 'var(--text-3)' }}>
                      {p.status === 'done' ? '✓' : p.status === 'failed' ? '✕' : p.status === 'in_progress' ? '⋯' : '○'}
                    </span>
                    <span style={{ color: p.status === 'failed' ? 'var(--danger)' : 'var(--text-2)' }}>{p.label}</span>
                    {p.detail && <span className="muted" style={{ fontSize: 11 }}>· {p.detail}</span>}
                  </div>
                ))}
              </div>
            )}

            {err && <div style={{ padding: 10, background: 'color-mix(in oklab, var(--danger) 12%, transparent)', color: 'var(--danger)', borderRadius: 6, fontSize: 12, marginBottom: 12 }}>{err}</div>}

            <div className="between">
              <button type="button" className="btn btn--sm" onClick={() => setStep(2)} disabled={busy}>Back</button>
              <button type="button" className="btn btn--sm btn--primary" onClick={submit} disabled={busy}>
                {busy ? 'Working…' : (autoReauth && wantsAutoLogin ? 'Save and auto-reauth' : 'Save')}
              </button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
};
Object.assign(window, { BrokerWizardModal });

// Back-compat: some legacy code refers to BrokerConnectModal.
Object.assign(window, { BrokerConnectModal: BrokerWizardModal });

const BrokersScreen = () => {
  const [zerodhaState, setZerodhaState] = React.useState({ connected: null, since: '--', cap: [], orders: 0, fees: 0, userId: '--', userName: '--' });
  const [myBrokers, setMyBrokers] = React.useState([]);
  const [modalState, setModalState] = React.useState({ open: false, mode: 'connect', brokerName: 'Zerodha', existing: null });
  const [testResult, setTestResult] = React.useState(null);
  const [busy, setBusy] = React.useState(null); // 'test' | 'auto' | 'manual' | null

  const refreshMyBrokers = React.useCallback(async () => {
    try {
      const res = await fetch('/api/me/broker', { credentials: 'include' });
      if (!res.ok) return;
      const j = await res.json();
      if (j.ok) setMyBrokers(j.brokers || []);
    } catch (_) {}
  }, []);
  React.useEffect(() => { refreshMyBrokers(); }, [refreshMyBrokers]);

  const myZerodha = myBrokers.find(b => b.broker === 'zerodha');

  const testConnection = async () => {
    setBusy('test'); setTestResult(null);
    try {
      const res = await fetch('/api/me/broker/test', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ broker: 'zerodha' }) });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.ok) setTestResult({ ok: true, msg: `Connected as ${j.profile.user_id}${j.profile.email ? ' (' + j.profile.email + ')' : ''}.` });
      else setTestResult({ ok: false, msg: j.detail || j.reason || `HTTP ${res.status}`, reason: j.reason });
    } catch (e) { setTestResult({ ok: false, msg: e.message || 'request failed' }); }
    finally { setBusy(null); refreshMyBrokers(); }
  };

  const autoReauth = async () => {
    setBusy('auto'); setTestResult({ ok: null, msg: 'Running headless Kite login (~10s)...' });
    try {
      const res = await fetch('/api/me/broker/auto-reauth', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ broker: 'zerodha' }) });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.ok) setTestResult({ ok: true, msg: `Token refreshed. Valid until ${new Date(j.expiresAt).toLocaleString()}.` });
      else {
        const hint = j.reason === 'daemon_not_installed' ? ' Run setup-auto-login-daemon.sh on the host.'
                   : j.reason === 'daemon_down' ? ' systemctl status ats-auto-login-daemon on the host.'
                   : j.reason === 'no_totp_or_password' ? ' Add TOTP seed + Kite password in Edit credentials.'
                   : '';
        setTestResult({ ok: false, msg: (j.detail || j.reason || `HTTP ${res.status}`) + hint, reason: j.reason });
      }
    } catch (e) { setTestResult({ ok: false, msg: e.message || 'request failed' }); }
    finally { setBusy(null); refreshMyBrokers(); }
  };

  const manualReauth = async () => {
    setBusy('manual'); setTestResult({ ok: null, msg: 'Opening Kite login window...' });
    try {
      const r = await fetch('/api/me/broker-oauth-url', { credentials: 'include' });
      const j = await r.json();
      if (!r.ok || !j.ok) { setTestResult({ ok: false, msg: j.detail || j.reason || `HTTP ${r.status}` }); setBusy(null); return; }
      const popup = window.open(j.url, 'kite-reauth', 'width=520,height=720,popup=1');
      if (!popup) { setTestResult({ ok: false, msg: 'Popup blocked. Allow popups for this site and retry.' }); setBusy(null); return; }
      const onMsg = (ev) => {
        if (ev.data && ev.data.type === 'ats-broker-connected') {
          window.removeEventListener('message', onMsg);
          setTestResult({ ok: true, msg: 'Kite connected. Access token refreshed.' });
          setBusy(null);
          refreshMyBrokers();
        }
      };
      window.addEventListener('message', onMsg);
      const watch = setInterval(() => {
        if (popup.closed) {
          clearInterval(watch); window.removeEventListener('message', onMsg);
          if (busy === 'manual') setBusy(null);
        }
      }, 800);
    } catch (e) { setTestResult({ ok: false, msg: e.message || 'OAuth start failed' }); setBusy(null); }
  };

  const disconnect = async (id) => {
    const typed = prompt('Type DISCONNECT to permanently remove these credentials:');
    if (typed !== 'DISCONNECT') return;
    const res = await fetch(`/api/me/broker/${id}`, { method: 'DELETE', credentials: 'include' });
    if (res.ok) { refreshMyBrokers(); setTestResult(null); }
  };

  React.useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const [h, p, ords] = await Promise.all([
          window.fetchApi('/api/health'),
          window.fetchApi('/api/profile').catch(() => ({ profile: null })),
          window.fetchApi('/api/orders').catch(() => ({ rows: [] })),
        ]);
        if (cancelled) return;
        const profile = p && p.profile;
        setZerodhaState({
          connected: !!(h && h.broker && h.broker.connected),
          since: profile && profile.userId ? `userId ${profile.userId}` : 'unknown',
          cap: (profile && profile.exchanges) || [],
          orders: (ords && Array.isArray(ords.rows)) ? ords.rows.length : 0,
          fees: 0,
          userId: (profile && profile.userId) || '--',
          userName: (profile && profile.userName) || '--',
          products: (profile && profile.products) || [],
          subscribedInstruments: (h && h.broker && h.broker.subscribedInstruments) || 0,
          instrumentsSize: (h && h.broker && h.broker.instruments && h.broker.instruments.size) || 0,
          lastTickAt: (h && h.broker && h.broker.lastTickAt) || 0,
          reconnectAttempts: (h && h.broker && h.broker.reconnectAttempts) || 0,
        });
      } catch (e) { if (!cancelled) console.warn('[brokers] health/profile fetch failed:', e.message); }
    };
    refresh();
    const id = setInterval(refresh, 15000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const brokers = [
    { n: "Zerodha Kite", st: zerodhaState.connected === null ? "loading" : (zerodhaState.connected ? "connected" : "disconnected"), since: zerodhaState.since,
      cap: zerodhaState.cap.length ? zerodhaState.cap : ["Equity", "F&O", "MCX", "CDS", "MF"], api: "kiteconnect v4",
      orders: zerodhaState.orders, fees: zerodhaState.fees, badge: "Primary", logoColor: "#387ed1", logoLetter: "Z" },
    { n: "Upstox Pro",      st: "slot", note: "OAuth ready · adapter stub", logoLetter: "U", logoColor: "#a020f0" },
    { n: "ICICI Breeze",    st: "slot", note: "Adapter not implemented",    logoLetter: "I", logoColor: "#e25c2b" },
    { n: "Dhan",            st: "slot", note: "Adapter not implemented",    logoLetter: "D", logoColor: "#0dbf81" },
    { n: "Interactive Brokers", st: "slot", note: "For US equity (future)", logoLetter: "IB", logoColor: "#c8102e" },
  ];
  const adapters = [
    { m: "placeOrder",        zerodha: true, upstox: true, icici: true, dhan: true, ib: true },
    { m: "modifyOrder",       zerodha: true, upstox: true, icici: true, dhan: true, ib: true },
    { m: "cancelOrder",       zerodha: true, upstox: true, icici: true, dhan: true, ib: true },
    { m: "getPositions",      zerodha: true, upstox: true, icici: true, dhan: true, ib: true },
    { m: "getHoldings",       zerodha: true, upstox: true, icici: true, dhan: true, ib: false },
    { m: "subscribeTicks",    zerodha: true, upstox: true, icici: false, dhan: true, ib: true },
    { m: "historicalCandles", zerodha: true, upstox: true, icici: false, dhan: false, ib: true },
    { m: "placeSIP",          zerodha: true, upstox: false, icici: true, dhan: false, ib: false },
  ];

  // Tier 79: derive a single status pill colour + label from token_status + auto_login_capable
  const statusPill = (row) => {
    if (!row) return null;
    if (row.token_status === 'valid') return { kind: 'up', text: `Connected · ${_fmtRelativeFuture(row.expires_at)}`, dot: true };
    if (row.token_status === 'expiring_soon') return { kind: 'warn', text: `Expires in ${_fmtRelativeFuture(row.expires_at)}`, dot: true };
    if (row.token_status === 'expired') return { kind: 'warn', text: `Token expired · ${_fmtRelative(row.issued_at)}`, dot: true };
    return { kind: 'warn', text: 'Reauth needed', dot: true };
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-header__title">Brokers</h1>
          <div className="page-header__sub">Portable broker layer. Add, swap, or run multiple brokers without touching strategy code.</div>
        </div>
        <div className="page-header__right">
          <button className="btn"><I.code size={14}/> Adapter docs</button>
          <button className="btn btn--primary" onClick={() => setModalState({ open: true, mode: 'connect', brokerName: 'Zerodha', existing: null })}>
            <I.plus size={14}/> Connect broker
          </button>
        </div>
      </div>

      <Card className="card--soft" style={{ marginBottom: 16 }}>
        <div className="row" style={{ gap: 20, justifyContent: "space-between" }}>
          {["Strategies", "Broker Adapter API", "Broker SDK", "Exchange"].map((s, i, a) => (
            <React.Fragment key={i}>
              <div style={{ textAlign: "center", flex: 1 }}>
                <div style={{ fontFamily: "var(--display)", fontSize: 18, letterSpacing: "-0.01em" }}>{s}</div>
                <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                  {["Python modules, stateless", "uniform interface · same call shape", "Zerodha · Upstox · Dhan · …", "NSE · BSE · MCX · CDS"][i]}
                </div>
              </div>
              {i < a.length - 1 && <div style={{ color: "var(--text-4)", fontFamily: "var(--mono)" }}>→</div>}
            </React.Fragment>
          ))}
        </div>
      </Card>

      {/* Test/Reauth result banner */}
      {testResult && (
        <div style={{
          padding: 12, marginBottom: 12, borderRadius: 6, fontSize: 12,
          background: testResult.ok === true ? 'color-mix(in oklab, var(--up) 12%, transparent)'
                    : testResult.ok === false ? 'color-mix(in oklab, var(--danger) 12%, transparent)'
                    : 'var(--bg-soft)',
          color: testResult.ok === true ? 'var(--up)' : testResult.ok === false ? 'var(--danger)' : 'var(--text-2)',
          border: '1px solid currentColor',
        }}>
          <strong>{testResult.ok === true ? '✓ ' : testResult.ok === false ? '✕ ' : '⋯ '}</strong>{testResult.msg}
          <button className="btn btn--sm" style={{ marginLeft: 12 }} onClick={() => setTestResult(null)}>Dismiss</button>
        </div>
      )}

      <div className="grid grid-3" style={{ marginBottom: 16 }}>
        {brokers.map((b, i) => {
          const isZerodha = b.n.toLowerCase().includes('zerodha');
          const myRow = isZerodha ? myZerodha : null;
          const showConnected = !!myRow;
          if (!showConnected) {
            return (
              <div className="slot" key={i}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: "color-mix(in oklab, " + b.logoColor + " 18%, transparent)", color: b.logoColor, display: "grid", placeItems: "center", fontWeight: 700 }}>{b.logoLetter}</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{b.n}</div>
                <div style={{ fontSize: 11 }}>{b.note}</div>
                <button className="btn btn--sm" style={{ marginTop: 6 }} onClick={() => {
                  const supported = ['Zerodha', 'Dhan', 'AngelOne', 'Upstox'];
                  const match = supported.find(s => b.n.toLowerCase().includes(s.toLowerCase()));
                  if (!match) { alert(`${b.n} adapter not implemented yet.`); return; }
                  setModalState({ open: true, mode: 'connect', brokerName: match, existing: null });
                }}><I.plus size={12}/> Connect</button>
              </div>
            );
          }
          const pill = statusPill(myRow);
          return (
            <Card key={i} style={{ border: "1px solid color-mix(in oklab, var(--accent) 30%, var(--border))" }}>
              <div className="between" style={{ marginBottom: 12 }}>
                <div className="row">
                  <div style={{ width: 40, height: 40, borderRadius: 10, background: b.logoColor, color: "white", display: "grid", placeItems: "center", fontWeight: 700 }}>{b.logoLetter}</div>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>{b.n}</div>
                    <div className="muted" style={{ fontSize: 11, fontFamily: "var(--mono)" }}>{b.api} · {myRow.broker_user_id} {myRow.is_default && '· default'}</div>
                  </div>
                </div>
                {pill && <Pill kind={pill.kind} dot={pill.dot}>{pill.text}</Pill>}
              </div>

              <div className="chip-row" style={{ marginBottom: 12 }}>
                {b.cap.map(c => <span className="chip" key={c}>{c}</span>)}
              </div>

              {/* Status checklist */}
              <div style={{ background: 'var(--bg-soft)', borderRadius: 6, padding: '10px 12px', marginBottom: 14 }}>
                <ChecklistRow ok={myRow.has_api_key} label="API credentials" value={myRow.has_api_key ? 'stored' : 'missing'} />
                <ChecklistRow ok={myRow.token_status === 'valid'}
                  warn={myRow.token_status === 'expired'}
                  label="Access token"
                  value={
                    myRow.token_status === 'valid' ? `valid · ${_fmtRelativeFuture(myRow.expires_at)}` :
                    myRow.token_status === 'expiring_soon' ? `expiring soon · ${_fmtRelativeFuture(myRow.expires_at)}` :
                    myRow.token_status === 'expired' ? `expired ${_fmtRelative(myRow.issued_at)}` :
                    'needs OAuth'
                  } />
                <ChecklistRow ok={myRow.auto_login_capable}
                  neutral={!myRow.auto_login_capable}
                  label="Auto-login"
                  value={myRow.auto_login_capable ? 'configured · ready' : 'not configured'} />
                <ChecklistRow neutral={!myRow.last_test_at}
                  ok={myRow.last_test_ok === true}
                  warn={myRow.last_test_ok === false}
                  label="Last test"
                  value={myRow.last_test_at ? (`${myRow.last_test_ok ? 'passed' : 'failed'} · ${_fmtRelative(myRow.last_test_at)}`) : 'never'} />
                <ChecklistRow ok={true} label="Orders (30d)" value={(b.orders||0).toLocaleString()} />
              </div>

              {/* Buttons — Auto button only when capable; Manual always; Test/Edit/Disconnect always */}
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {myRow.auto_login_capable && (
                  <button className="btn btn--sm btn--primary" disabled={busy !== null} onClick={autoReauth} style={{ flex: 1, minWidth: 110, justifyContent: 'center' }}>
                    {busy === 'auto' ? '⋯ logging in' : '⚡ Auto reauth'}
                  </button>
                )}
                <button className="btn btn--sm" disabled={busy !== null} onClick={manualReauth} style={{ flex: 1, minWidth: 90, justifyContent: 'center' }}>
                  {busy === 'manual' ? '⋯ popup' : 'Manual reauth'}
                </button>
                <button className="btn btn--sm" disabled={busy !== null} onClick={testConnection} style={{ flex: 1, minWidth: 70, justifyContent: 'center' }}>
                  {busy === 'test' ? '⋯ testing' : 'Test'}
                </button>
                <button className="btn btn--sm" disabled={busy !== null} onClick={() => setModalState({ open: true, mode: 'edit', brokerName: 'Zerodha', existing: myRow })} style={{ flex: 1, minWidth: 70, justifyContent: 'center' }}>
                  Edit
                </button>
                <button className="btn btn--sm" disabled={busy !== null} onClick={() => disconnect(myRow.id)} style={{ flex: 1, minWidth: 90, justifyContent: 'center', color: 'var(--danger)' }}>
                  Disconnect
                </button>
              </div>

              {!myRow.auto_login_capable && (
                <div style={{ marginTop: 10, padding: '8px 10px', background: 'color-mix(in oklab, var(--accent) 8%, transparent)', borderRadius: 6, fontSize: 11, color: 'var(--text-2)' }}>
                  💡 Add TOTP seed + Kite password in Edit to enable one-click Auto reauth.
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <BrokerWizardModal
        open={modalState.open} mode={modalState.mode} brokerName={modalState.brokerName} existing={modalState.existing}
        onClose={() => setModalState({ ...modalState, open: false })}
        onSaved={refreshMyBrokers}
      />

      <Card title="Adapter coverage" sub="Which broker implements which capability" flush>
        <table className="table">
          <thead><tr><th>Method</th><th style={{ textAlign: "center" }}>Zerodha</th><th style={{ textAlign: "center" }}>Upstox</th><th style={{ textAlign: "center" }}>ICICI</th><th style={{ textAlign: "center" }}>Dhan</th><th style={{ textAlign: "center" }}>IBKR</th></tr></thead>
          <tbody>
            {adapters.map((a, i) => (
              <tr key={i}>
                <td className="mono" style={{ fontSize: 12 }}>{a.m}()</td>
                {["zerodha", "upstox", "icici", "dhan", "ib"].map(k => (
                  <td key={k} style={{ textAlign: "center" }}>
                    {a[k] ? <I.check size={14} className="up"/> : <span className="muted">—</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div style={{ marginTop: 16 }}>
        <Card title="Routing by mode" sub="Each mode pins to a broker + product type. Fallbacks activate on primary failure." flush>
          <table className="table">
            <thead>
              <tr><th>Mode</th><th>Primary broker</th><th>Product</th><th>Fallback</th><th>Trigger</th><th className="num-l">30d orders</th></tr>
            </thead>
            <tbody>
              {[
                { id: "intraday", primary: "Zerodha", product: "MIS",      fallback: "Upstox (stub)", trigger: "Zerodha API > 500ms or auth expired", orders: 2140 },
                { id: "swing",    primary: "Zerodha", product: "CNC",      fallback: "—",              trigger: "Manual re-route only",                orders:  184 },
                { id: "options",  primary: "Zerodha", product: "NRML/MIS", fallback: "Dhan (slot)",    trigger: "Illiquid wing · depth < lot×5",       orders:  382 },
                { id: "futures",  primary: "Zerodha", product: "NRML",     fallback: "—",              trigger: "Manual re-route only",                orders:  134 },
              ].map(row => {
                const meta = window.MODE_META[row.id];
                return (
                  <tr key={row.id}>
                    <td><span className="row" style={{ gap: 8 }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: meta.color }}/><span style={{ fontWeight: 500 }}>{meta.label}</span></span></td>
                    <td><Pill kind="acc">{row.primary}</Pill></td>
                    <td className="mono" style={{ fontSize: 12 }}>{row.product}</td>
                    <td>{row.fallback === "—" ? <span className="muted">—</span> : <span className="mono" style={{ fontSize: 12, color: "var(--text-3)" }}>{row.fallback}</span>}</td>
                    <td className="muted" style={{ fontSize: 11 }}>{row.trigger}</td>
                    <td className="num mono">{row.orders.toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ padding: "10px 16px", borderTop: "1px solid var(--border)", background: "var(--bg-soft)", fontSize: 11, color: "var(--text-3)" }}>
            <I.info size={12} style={{ verticalAlign: -1, marginRight: 6 }}/>
            Routing is enforced at the adapter layer — strategies call <code>placeOrder()</code> without knowing which broker handles it.
          </div>
        </Card>
      </div>
    </>
  );
};

const ChecklistRow = ({ ok, warn, neutral, label, value }) => {
  const color = ok ? 'var(--up)' : warn ? 'var(--warn, #d97706)' : neutral ? 'var(--text-3)' : 'var(--text-3)';
  const icon = ok ? '✓' : warn ? '✕' : neutral ? '—' : '○';
  return (
    <div className="between" style={{ fontSize: 12, padding: '3px 0' }}>
      <span><span style={{ display: 'inline-block', width: 14, color, fontWeight: 700 }}>{icon}</span><span className="muted">{label}</span></span>
      <span className="mono">{value}</span>
    </div>
  );
};
Object.assign(window, { ChecklistRow });

Object.assign(window, { BrokersScreen });
