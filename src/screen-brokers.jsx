/* eslint-disable */
/* Brokers screen — broker adapter pattern.
   Tier 57: per-user broker credentials. Each user can connect their own Zerodha (or other broker)
   from this screen. Credentials are libsodium-sealed server-side and never returned to the client. */

// ============================================================================
// BrokerConnectModal -- collects API key, API secret, optional TOTP, broker_user_id.
// Mode: 'connect' (new) | 'edit' (modify existing) | 'reauth' (rotate access token only)
// ============================================================================
const BrokerConnectModal = ({ open, mode, brokerName, existing, onClose, onSaved }) => {
  if (!open) return null;
  const [brokerUserId, setBrokerUserId] = React.useState(existing?.broker_user_id || '');
  const [apiKey, setApiKey]             = React.useState('');
  const [apiSecret, setApiSecret]       = React.useState('');
  const [totpSeed, setTotpSeed]         = React.useState('');
  const [kitePassword, setKitePassword] = React.useState('');
  const [setDefault, setSetDefault]     = React.useState(true);
  const [busy, setBusy]                 = React.useState(false);
  const [err, setErr]                   = React.useState('');

  React.useEffect(() => {
    setBrokerUserId(existing?.broker_user_id || '');
    setApiKey(''); setApiSecret(''); setTotpSeed(''); setKitePassword(''); setErr('');
  }, [open, existing && existing.id]);

  const submit = async (e) => {
    e && e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const url = mode === 'edit' && existing ? `/api/me/broker/${existing.id}` : '/api/me/broker';
      const method = mode === 'edit' ? 'PUT' : 'POST';
      const body = { broker: brokerName.toLowerCase(), broker_user_id: brokerUserId };
      if (apiKey)       body.api_key    = apiKey;
      if (apiSecret)    body.api_secret = apiSecret;
      if (totpSeed)     body.totp_seed  = totpSeed;
      if (kitePassword) body.password   = kitePassword;
      body.set_default = setDefault;

      const res = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) {
        setErr(j.reason || `HTTP ${res.status}`);
      } else {
        onSaved && onSaved();
        onClose();
      }
    } catch (e) {
      setErr(e.message || 'request failed');
    } finally {
      setBusy(false);
    }
  };

  const title = mode === 'edit' ? `Edit ${brokerName} connection` : `Connect ${brokerName}`;
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'grid', placeItems: 'center', zIndex: 1000 }}>
      <Card style={{ width: 'min(480px, 92vw)', maxHeight: '90vh', overflow: 'auto' }}>
        <div className="between" style={{ marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{title}</h3>
          <button className="btn btn--sm btn--ghost" onClick={onClose} aria-label="close">×</button>
        </div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 16 }}>
          {brokerName.toLowerCase() === 'zerodha' ? (
            <>Get your Kite API key/secret from <span className="mono">developers.kite.trade</span>. The TOTP seed is optional and only needed for auto-login.</>
          ) : (
            <>Enter credentials from your broker dashboard.</>
          )}
        </div>
        <form onSubmit={submit}>
          <label style={{ display: 'block', marginBottom: 12 }}>
            <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>Broker user ID {brokerName.toLowerCase() === 'zerodha' && '(Kite client id, e.g. ABC123)'}</div>
            <input className="input" required value={brokerUserId} onChange={e => setBrokerUserId(e.target.value)} placeholder="e.g. ABC123" />
          </label>
          <label style={{ display: 'block', marginBottom: 12 }}>
            <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>API key {mode === 'edit' && <span style={{ color: 'var(--text-3)' }}>· leave blank to keep existing</span>}</div>
            <input className="input" type="password" autoComplete="off" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={mode === 'edit' ? '(unchanged)' : ''} />
          </label>
          <label style={{ display: 'block', marginBottom: 12 }}>
            <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>API secret {mode === 'edit' && <span style={{ color: 'var(--text-3)' }}>· leave blank to keep existing</span>}</div>
            <input className="input" type="password" autoComplete="off" value={apiSecret} onChange={e => setApiSecret(e.target.value)} placeholder={mode === 'edit' ? '(unchanged)' : ''} />
          </label>
          <label style={{ display: 'block', marginBottom: 12 }}>
            <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>TOTP seed (optional, for auto-login)</div>
            <input className="input" type="password" autoComplete="off" value={totpSeed} onChange={e => setTotpSeed(e.target.value)} placeholder="(optional)" />
          </label>
          <label style={{ display: 'block', marginBottom: 12 }}>
            <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>Kite password (optional, for headless auto-login)</div>
            <input className="input" type="password" autoComplete="off" value={kitePassword} onChange={e => setKitePassword(e.target.value)} placeholder={mode === 'edit' ? '(unchanged)' : '(optional)'} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, fontSize: 13 }}>
            <input type="checkbox" checked={setDefault} onChange={e => setSetDefault(e.target.checked)} /> Use this as my default broker
          </label>
          {err && <div style={{ padding: 10, background: 'color-mix(in oklab, var(--danger) 12%, transparent)', color: 'var(--danger)', borderRadius: 6, fontSize: 12, marginBottom: 12 }}>{err}</div>}
          <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn--sm" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="btn btn--sm btn--primary" disabled={busy}>{busy ? 'Saving…' : (mode === 'edit' ? 'Save changes' : 'Connect')}</button>
          </div>
        </form>
        <div className="muted" style={{ fontSize: 11, marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          🔒 Stored encrypted with libsodium. The server never logs these values, and they're never returned to the browser after save.
        </div>
      </Card>
    </div>
  );
};
Object.assign(window, { BrokerConnectModal });

const BrokersScreen = () => {
  // Live status of the primary broker from /api/health + /api/profile.
  const [zerodhaState, setZerodhaState] = React.useState({
    connected: null, since: '--', cap: [], orders: 0, fees: 0, userId: '--', userName: '--',
  });
  // Tier 57: per-user broker connections from /api/me/broker
  const [myBrokers, setMyBrokers] = React.useState([]); // [{id, broker, broker_user_id, has_api_key, has_access_token, is_default, ...}]
  const [modalState, setModalState] = React.useState({ open: false, mode: 'connect', brokerName: 'Zerodha', existing: null });

  const refreshMyBrokers = React.useCallback(async () => {
    try {
      const res = await fetch('/api/me/broker', { credentials: 'include' });
      if (!res.ok) return;
      const j = await res.json();
      if (j.ok) setMyBrokers(j.brokers || []);
    } catch (_) { /* unauthenticated or network — leave empty */ }
  }, []);
  React.useEffect(() => { refreshMyBrokers(); }, [refreshMyBrokers]);

  const myZerodha = myBrokers.find(b => b.broker === 'zerodha');
  const [testResult, setTestResult] = React.useState(null);
  const [testing, setTesting] = React.useState(false);
  const testConnection = async () => {
    setTesting(true); setTestResult(null);
    try {
      const res = await fetch('/api/me/broker-test', { method: 'POST', credentials: 'include' });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.ok) {
        setTestResult({ ok: true, msg: `Connected as ${j.profile.userName || j.profile.userId}. Segments: ${(j.profile.segments || []).join(', ')}.` });
      } else {
        setTestResult({ ok: false, msg: j.detail || j.reason || `HTTP ${res.status}`, hint: j.hint });
      }
    } catch (e) {
      setTestResult({ ok: false, msg: e.message || 'request failed' });
    } finally { setTesting(false); }
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
          fees: 0, // not exposed by Kite — would require P&L statement
          userId: (profile && profile.userId) || '--',
          userName: (profile && profile.userName) || '--',
          products: (profile && profile.products) || [],
          subscribedInstruments: (h && h.broker && h.broker.subscribedInstruments) || 0,
          instrumentsSize: (h && h.broker && h.broker.instruments && h.broker.instruments.size) || 0,
          lastTickAt: (h && h.broker && h.broker.lastTickAt) || 0,
          reconnectAttempts: (h && h.broker && h.broker.reconnectAttempts) || 0,
        });
      } catch (e) {
        if (!cancelled) console.warn('[brokers] health/profile fetch failed:', e.message);
      }
    };
    refresh();
    const id = setInterval(refresh, 15000); // refresh every 15s
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const brokers = [
    {
      n: "Zerodha Kite",
      st: zerodhaState.connected === null ? "loading" : (zerodhaState.connected ? "connected" : "disconnected"),
      since: zerodhaState.since,
      cap: zerodhaState.cap.length ? zerodhaState.cap : ["Equity", "F&O", "MCX", "CDS", "MF"],
      api: "kiteconnect v4",
      orders: zerodhaState.orders,
      fees: zerodhaState.fees,
      badge: "Primary",
      logoColor: "#387ed1",
      logoLetter: "Z",
      userName: zerodhaState.userName,
      userId: zerodhaState.userId,
      subscribed: zerodhaState.subscribedInstruments,
      instrumentsSize: zerodhaState.instrumentsSize,
      reconnectAttempts: zerodhaState.reconnectAttempts,
    },
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

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-header__title">Brokers</h1>
          <div className="page-header__sub">Portable broker layer. Add, swap, or run multiple brokers without touching strategy code.</div>
        </div>
        <div className="page-header__right">
          <button className="btn"><I.code size={14}/> Adapter docs</button>
          <button
            className="btn btn--primary"
            onClick={() => setModalState({ open: true, mode: 'connect', brokerName: 'Zerodha', existing: null })}
          ><I.plus size={14}/> Connect broker</button>
        </div>
      </div>

      {/* Architecture explainer */}
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

      <div className="grid grid-3" style={{ marginBottom: 16 }}>
        {brokers.map((b, i) => {
          // Tier 57: per-user override -- if user has stored creds for this broker, show their row.
          const isZerodha = b.n.toLowerCase().includes('zerodha');
          const myRow = isZerodha ? myZerodha : null;
          const showConnected = b.st === "connected" || !!myRow;
          return showConnected ? (
            <Card key={i} style={{ border: "1px solid color-mix(in oklab, var(--accent) 30%, var(--border))" }}>
              <div className="between" style={{ marginBottom: 12 }}>
                <div className="row">
                  <div style={{ width: 40, height: 40, borderRadius: 10, background: b.logoColor, color: "white", display: "grid", placeItems: "center", fontWeight: 700, letterSpacing: "-0.02em" }}>{b.logoLetter}</div>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>{b.n}</div>
                    <div className="muted" style={{ fontSize: 11, fontFamily: "var(--mono)" }}>{b.api}</div>
                  </div>
                </div>
                <Pill kind="acc">{myRow && myRow.is_default ? 'My default' : b.badge}</Pill>
              </div>
              <div className="chip-row" style={{ marginBottom: 12 }}>
                {b.cap.map(c => <span className="chip" key={c}>{c}</span>)}
              </div>
              <div className="divider"/>
              <div className="between" style={{ fontSize: 12 }}>
                <span className="muted">Broker user id</span>
                <span className="mono">{myRow ? myRow.broker_user_id : b.since}</span>
              </div>
              <div className="between" style={{ fontSize: 12, marginTop: 6 }}><span className="muted">Orders (30d)</span><span className="mono">{(b.orders||0).toLocaleString()}</span></div>
              {myRow ? (
                <>
                  <div className="between" style={{ fontSize: 12, marginTop: 6 }}><span className="muted">API key</span><span className="mono">{myRow.has_api_key ? '••• stored' : '— missing'}</span></div>
                  <div className="between" style={{ fontSize: 12, marginTop: 6 }}><span className="muted">Access token</span><span className="mono">{myRow.has_access_token ? '••• stored' : '— needs OAuth'}</span></div>
                  <div className="between" style={{ fontSize: 12, marginTop: 6 }}><span className="muted">TOTP auto-login</span><span className="mono">{myRow.has_totp ? '••• enabled' : 'disabled'}</span></div>
                </>
              ) : (
                <>
                  <div className="between" style={{ fontSize: 12, marginTop: 6 }}><span className="muted">Fees (30d)</span><span className="mono">{inr(b.fees)}</span></div>
                  <div className="between" style={{ fontSize: 12, marginTop: 6 }}><span className="muted">Status</span><Pill kind="up" dot>connected · 14ms</Pill></div>
                </>
              )}
              <div className="row" style={{ marginTop: 14, gap: 6, flexWrap: 'wrap' }}>
                {myRow ? (
                  <>
                    <button
                      className="btn btn--sm"
                      style={{ flex: 1, minWidth: 70, justifyContent: "center" }}
                      onClick={() => testConnection(myRow.id)}
                    >Test</button>
                    <button
                      className="btn btn--sm"
                      style={{ flex: 1, minWidth: 70, justifyContent: "center" }}
                      onClick={() => setModalState({ open: true, mode: 'edit', brokerName: b.n.split(' ')[0], existing: myRow })}
                    >Edit</button>
                    <button
                      className="btn btn--sm"
                      style={{ flex: 1, minWidth: 70, justifyContent: "center" }}
                      onClick={() => window.location.href = '/api/brokers/zerodha/login'}
                    >Reauth</button>
                    <button
                      className="btn btn--sm"
                      style={{ flex: 1, minWidth: 80, justifyContent: "center", color: 'var(--danger)' }}
                      onClick={() => disconnect(myRow.id)}
                    >Disconnect</button>
                  </>
                ) : (
                  <>
                    <button className="btn btn--sm" style={{ flex: 1, justifyContent: "center" }}>Test API</button>
                    <button className="btn btn--sm" style={{ flex: 1, justifyContent: "center" }}>Reauth</button>
                  </>
                )}
              </div>
            </Card>
          ) : (
            <div className="slot" key={i}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: "color-mix(in oklab, " + b.logoColor + " 18%, transparent)", color: b.logoColor, display: "grid", placeItems: "center", fontWeight: 700 }}>{b.logoLetter}</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{b.n}</div>
              <div style={{ fontSize: 11 }}>{b.note}</div>
              <button
                className="btn btn--sm"
                style={{ marginTop: 6 }}
                onClick={() => {
                  // Only zerodha/dhan/angelone/upstox are wired server-side today.
                  const supported = ['Zerodha', 'Dhan', 'AngelOne', 'Upstox'];
                  const match = supported.find(s => b.n.toLowerCase().includes(s.toLowerCase()));
                  if (!match) { alert(`${b.n} adapter not implemented yet.`); return; }
                  setModalState({ open: true, mode: 'connect', brokerName: match, existing: null });
                }}
              ><I.plus size={12}/> Connect</button>
            </div>
          );
        })}
      </div>

      {testing && <div className="row" style={{ padding: 10, marginBottom: 12, background: 'var(--bg-soft)', borderRadius: 6, fontSize: 12 }}>Testing connection&hellip;</div>}
      {testResult && (
        <div style={{
          padding: 12, marginBottom: 12, borderRadius: 6, fontSize: 12,
          background: testResult.ok ? 'color-mix(in oklab, var(--up) 12%, transparent)' : 'color-mix(in oklab, var(--danger) 12%, transparent)',
          color: testResult.ok ? 'var(--up)' : 'var(--danger)',
          border: '1px solid currentColor',
        }}>
          <strong>{testResult.ok ? '\u2713 Test passed' : '\u2715 Test failed'}.</strong> {testResult.msg}
          {testResult.hint && <div style={{ marginTop: 6, opacity: 0.85 }}>{testResult.hint}</div>}
          <button className="btn btn--sm" style={{ marginLeft: 12 }} onClick={() => setTestResult(null)}>Dismiss</button>
        </div>
      )}
      <BrokerConnectModal
        open={modalState.open}
        mode={modalState.mode}
        brokerName={modalState.brokerName}
        existing={modalState.existing}
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
              <tr>
                <th>Mode</th>
                <th>Primary broker</th>
                <th>Product</th>
                <th>Fallback</th>
                <th>Trigger</th>
                <th className="num-l">30d orders</th>
              </tr>
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
                    <td>
                      <span className="row" style={{ gap: 8 }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: meta.color }}/>
                        <span style={{ fontWeight: 500 }}>{meta.label}</span>
                      </span>
                    </td>
                    <td><Pill kind="acc">{row.primary}</Pill></td>
                    <td className="mono" style={{ fontSize: 12 }}>{row.product}</td>
                    <td>
                      {row.fallback === "—"
                        ? <span className="muted">—</span>
                        : <span className="mono" style={{ fontSize: 12, color: "var(--text-3)" }}>{row.fallback}</span>}
                    </td>
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

Object.assign(window, { BrokersScreen });
