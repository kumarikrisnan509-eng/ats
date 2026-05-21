/* eslint-disable */
// @ts-check
/* Tier 56: Onboarding wizard. 4 steps:
     1. Welcome
     2. Email verification status (skip if already verified)
     3. Connect broker (Zerodha OAuth -- existing flow)
     4. First watchlist (5 default symbols + custom add)
   onComplete() fires after step 4 -> app.jsx marks session.onboarded=true. */

const OnboardingWizard = ({ onComplete }) => {
  const [step, setStep] = React.useState(1);
  const [user, setUser]   = React.useState(null);
  const [broker, setBroker] = React.useState(null);
  const [busy, setBusy]   = React.useState(false);
  const [err, setErr]     = React.useState(null);
  const [seedSymbols, setSeedSymbols] = React.useState(['NIFTY 50','RELIANCE','HDFCBANK','INFY','TCS']);
  const [customSym, setCustomSym] = React.useState('');
  // Tier 66: paper-trading initial capital (the user picks this; was hardcoded INR 10L before)
  const [paperCapital, setPaperCapital] = React.useState(1000000);
  const [paperSaved, setPaperSaved] = React.useState(false);

  React.useEffect(() => {
    (async () => {
      try {
        const me = await window.fetchApi('/api/auth/me');
        if (me && me.ok) setUser(me.user);
        const h  = await window.fetchApi('/api/health').catch(()=>null);
        if (h && h.broker) setBroker(h.broker);
      } catch (e) { console.warn('[screen-onboarding] swallowed:', e && e.message); }
    })();
  }, []);

  // Skip step 2 if already verified
  const next = () => {
    let n = step + 1;
    if (n === 2 && user && user.is_verified) n = 3;
    setStep(n);
  };
  const back = () => setStep(Math.max(1, step - 1));

  const seedWatchlist = async () => {
    setBusy(true); setErr(null);
    try {
      for (const s of seedSymbols) {
        await window.fetchApi('/api/me/watchlist', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol: s }),
        }).catch(()=>null);
      }
      onComplete && onComplete();
    } catch (e) { setErr(String(e.message || e)); }
    finally { setBusy(false); }
  };

  const cardStyle = {
    maxWidth: 520, width: '100%', padding: 28,
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 12, boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
  };
  const stepBadge = (n, label) => (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '4px 10px', borderRadius: 999, fontSize: 11,
      background: step === n ? 'var(--accent)' : step > n ? 'var(--up-soft, #dcfce7)' : 'var(--bg-soft)',
      color: step === n ? 'white' : step > n ? 'var(--up)' : 'var(--text-3)',
      fontWeight: 600,
    }}>
      {step > n ? '✓' : n} {label}
    </span>
  );

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: 16 }}>
      <div style={cardStyle}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          {stepBadge(1, 'Welcome')}
          {stepBadge(2, 'Verify email')}
          {stepBadge(3, 'Connect broker')}
          {stepBadge(4, 'Paper capital')}
          {stepBadge(5, 'Watchlist')}
        </div>

        {step === 1 && (
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Welcome to ATS{user && user.name ? ', ' + user.name : ''}</div>
            <p style={{ color: 'var(--text-2)', fontSize: 14, lineHeight: 1.6 }}>
              Let's get you set up in 3 quick steps. You'll verify your email, connect your broker
              account (Zerodha, Dhan, or AngelOne), and pick a starter watchlist. You can change
              anything later from <strong>Settings → Profile</strong>.
            </p>
            <button onClick={next} className="btn btn--accent" style={{ marginTop: 12, padding: '8px 20px' }}>Get started</button>
          </div>
        )}

        {step === 2 && (
          <div>
            <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Verify your email</div>
            <p style={{ color: 'var(--text-2)', fontSize: 13, lineHeight: 1.6 }}>
              We sent a verification link to <strong>{user && user.email}</strong>. Click it to confirm.
              You can continue without verifying — some features (digest emails, password reset)
              won't work until you do.
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={back} className="btn">Back</button>
              <button onClick={next} className="btn btn--accent">Skip for now</button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Connect your broker</div>
            <p style={{ color: 'var(--text-2)', fontSize: 13, lineHeight: 1.6 }}>
              ATS needs to authenticate with your broker to fetch holdings, place orders, and stream
              live prices. We never store your broker password — only an encrypted access token
              (libsodium-sealed, BYOK).
            </p>
            <div style={{ padding: 10, background: 'var(--bg-soft)', borderRadius: 'var(--r-md)', fontSize: 12, marginBottom: 12 }}>
              Broker status: <strong>{broker && broker.connected ? '✓ connected (' + broker.name + ')' : 'not connected'}</strong>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={back} className="btn">Back</button>
              <a href="/api/brokers/zerodha/login" className="btn btn--accent">Connect Zerodha</a>
              <button onClick={next} className="btn">Skip for now</button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div>
            <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Set your paper-trading capital</div>
            <p style={{ color: 'var(--text-2)', fontSize: 13, lineHeight: 1.6, marginBottom: 14 }}>
              Paper trading lets you practice with simulated fills against live prices. How much
              virtual capital do you want to start with? You can change this anytime from the Paper
              trading screen.
            </p>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Initial capital (INR)</label>
              <input
                type="number" min={1000} max={10000000000} step={1000}
                value={paperCapital}
                onChange={ev => setPaperCapital(Math.max(1000, Number(ev.target.value) || 0))}
                style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', fontFamily: 'var(--mono)', fontSize: 14 }}
              />
              <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-3)' }}>
                Quick picks:
                {[100000, 500000, 1000000, 2500000, 5000000].map(v => (
                  <button key={v} onClick={() => setPaperCapital(v)} className="btn btn--sm" style={{ marginLeft: 6, padding: '2px 8px', fontSize: 11 }}>
                    ₹{(v/100000).toFixed(v >= 100000 ? 0 : 1)}L
                  </button>
                ))}
              </div>
            </div>
            {paperSaved && <div style={{ padding: 8, background: 'color-mix(in oklab, var(--up) 12%, transparent)', borderRadius: 'var(--r-md)', color: 'var(--up)', fontSize: 12, marginBottom: 10 }}>✓ Capital saved</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={back} className="btn">Back</button>
              <button
                onClick={async () => {
                  setBusy(true); setErr(null);
                  try {
                    const r = await window.fetchApi('/api/me/paper/capital', {
                      method: 'PUT', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ initialCapital: paperCapital, tier: 'CUSTOM', reset: true }),
                    });
                    if (r && r.ok) { setPaperSaved(true); setStep(5); }
                    else setErr(r && r.detail || r && r.reason || 'save failed');
                  } catch (e) { setErr(String(e.message || e)); }
                  finally { setBusy(false); }
                }}
                disabled={busy}
                className="btn btn--accent"
              >{busy ? 'Saving...' : 'Save and continue'}</button>
            </div>
            {err && <div style={{ padding: 8, background: 'color-mix(in oklab, var(--danger) 12%, transparent)', borderRadius: 'var(--r-md)', color: 'var(--danger)', fontSize: 12, marginTop: 10 }}>{err}</div>}
          </div>
        )}

        {step === 5 && (
          <div>
            <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Pick your starter watchlist</div>
            <p style={{ color: 'var(--text-2)', fontSize: 13, marginBottom: 12 }}>
              These symbols start streaming live prices once your broker is connected. Add or remove later from any screen.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {seedSymbols.map(s => (
                <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: 'var(--bg-soft)', borderRadius: 999, fontSize: 12 }}>
                  {s}
                  <button onClick={() => setSeedSymbols(seedSymbols.filter(x => x !== s))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)' }}>×</button>
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              <input
                value={customSym} onChange={ev => setCustomSym(ev.target.value.toUpperCase())}
                placeholder="e.g. ICICIBANK"
                style={{ flex: 1, padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', fontFamily: 'var(--mono)', fontSize: 12 }}
              />
              <button
                onClick={() => { if (customSym && !seedSymbols.includes(customSym)) { setSeedSymbols([...seedSymbols, customSym]); setCustomSym(''); } }}
                className="btn">+ add</button>
            </div>
            {err && <div style={{ padding: 8, background: 'var(--bg-soft)', border: '1px solid var(--down)', borderRadius: 'var(--r-md)', color: 'var(--down)', fontSize: 12, marginBottom: 10 }}>{err}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={back} className="btn">Back</button>
              <button onClick={seedWatchlist} disabled={busy || seedSymbols.length === 0} className="btn btn--accent">{busy ? '…' : 'Finish setup'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
window.OnboardingWizard = OnboardingWizard;
