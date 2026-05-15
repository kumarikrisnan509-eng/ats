/* eslint-disable */
/* Auth screens: LoginScreen + SignupScreen + Forgot/Reset.
   Tier 52: wired to /api/auth/* (Tier 50/51 backend). Replaces the prior
   demo-mode stub. Single component handles 4 modes: login, signup, forgot,
   reset. Mode controlled by ?mode= query / hash. onAuth callback fires on
   successful login so app.jsx can re-fetch /api/auth/me. */

const LoginScreen = ({ onAuth, go }) => {
  const initialMode = (() => {
    const h = (location.hash || '').replace('#', '').toLowerCase();
    if (h === 'signup' || h === 'forgot' || h === 'reset' || h === 'verify') return h;
    return 'login';
  })();
  const [mode, setMode] = React.useState(initialMode);
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [name, setName] = React.useState('');
  const [token, setToken] = React.useState(() => new URLSearchParams(location.search).get('token') || '');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [info, setInfo]   = React.useState(null);

  // Auto-trigger verify if landed with ?token=...&mode=verify
  React.useEffect(() => {
    if (mode === 'verify' && token) doVerify();
  }, []);

  const post = (path, body) => window.fetchApi(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const submitLogin = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null); setInfo(null);
    try {
      const r = await post('/api/auth/login', { email, password });
      if (r && r.ok) {
        try { localStorage.setItem('rc_session', JSON.stringify({ authed: true, onboarded: true, user: r.user })); } catch (_) {}
        if (typeof onAuth === 'function') onAuth(r.user);
        location.hash = 'dashboard';
        location.reload();
      } else { setError(r && r.reason); }
    } catch (e) { setError(String(e.message || e)); }
    finally { setBusy(false); }
  };

  const submitSignup = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null); setInfo(null);
    try {
      const r = await post('/api/auth/signup', { email, password, name });
      if (r && r.ok) {
        setInfo('Account created. ' + (r.user.is_verified ? 'You can sign in now.' : 'Check your email for a verification link.'));
        setMode('login'); setPassword('');
      } else { setError(r && r.reason); }
    } catch (e) { setError(String(e.message || e)); }
    finally { setBusy(false); }
  };

  const submitForgot = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null); setInfo(null);
    try {
      await post('/api/auth/forgot-password', { email });
      setInfo('If that email is registered, a password-reset link is on its way.');
    } catch (e) { setError(String(e.message || e)); }
    finally { setBusy(false); }
  };

  const submitReset = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null); setInfo(null);
    try {
      const r = await post('/api/auth/reset-password', { token, newPassword: password });
      if (r && r.ok) { setInfo('Password reset. Sign in with your new password.'); setMode('login'); }
      else setError(r && r.reason);
    } catch (e) { setError(String(e.message || e)); }
    finally { setBusy(false); }
  };

  const doVerify = async () => {
    setBusy(true); setError(null); setInfo(null);
    try {
      const r = await post('/api/auth/verify-email', { token });
      if (r && r.ok) setInfo(r.alreadyVerified ? 'Already verified.' : 'Email verified. Sign in to continue.');
      else setError(r && r.reason);
    } catch (e) { setError(String(e.message || e)); }
    finally { setBusy(false); }
  };

  const inputStyle = {
    width: '100%', padding: '10px 12px', marginBottom: 10,
    background: 'var(--bg-sunk)', border: '1px solid var(--border)',
    borderRadius: 'var(--r-md)', fontSize: 14, color: 'var(--text-1)',
  };
  const linkBtn = { background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 12, padding: 0 };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: 16 }}>
      <div style={{
        maxWidth: 400, width: '100%', padding: 28,
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 12, boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
      }}>
        <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>ATS</div>
        <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 20 }}>
          {mode === 'login'  ? 'Welcome back. Sign in to continue.'
          : mode === 'signup'? 'Create your ATS account.'
          : mode === 'forgot'? 'Reset your password.'
          : mode === 'reset' ? 'Choose a new password.'
          : mode === 'verify'? 'Verifying your email…'
          : ''}
        </div>

        {mode === 'login' && (
          <form onSubmit={submitLogin}>
            <input style={inputStyle} placeholder="Email" type="email" required value={email} onChange={ev=>setEmail(ev.target.value)} autoComplete="email"/>
            <input style={inputStyle} placeholder="Password" type="password" required value={password} onChange={ev=>setPassword(ev.target.value)} autoComplete="current-password"/>
            <button type="submit" disabled={busy} className="btn btn--accent" style={{ width:'100%', padding:10, fontSize:14, fontWeight:600 }}>{busy ? '…' : 'Sign in'}</button>
          </form>
        )}
        {mode === 'signup' && (
          <form onSubmit={submitSignup}>
            <input style={inputStyle} placeholder="Name (optional)" value={name} onChange={ev=>setName(ev.target.value)} autoComplete="name"/>
            <input style={inputStyle} placeholder="Email" type="email" required value={email} onChange={ev=>setEmail(ev.target.value)} autoComplete="email"/>
            <input style={inputStyle} placeholder="Password (≥8 chars)" type="password" required minLength={8} value={password} onChange={ev=>setPassword(ev.target.value)} autoComplete="new-password"/>
            <button type="submit" disabled={busy} className="btn btn--accent" style={{ width:'100%', padding:10, fontSize:14, fontWeight:600 }}>{busy ? '…' : 'Create account'}</button>
          </form>
        )}
        {mode === 'forgot' && (
          <form onSubmit={submitForgot}>
            <input style={inputStyle} placeholder="Email" type="email" required value={email} onChange={ev=>setEmail(ev.target.value)} autoComplete="email"/>
            <button type="submit" disabled={busy} className="btn btn--accent" style={{ width:'100%', padding:10, fontSize:14, fontWeight:600 }}>{busy ? '…' : 'Send reset link'}</button>
          </form>
        )}
        {mode === 'reset' && (
          <form onSubmit={submitReset}>
            <input style={inputStyle} placeholder="Reset token (from email)" value={token} onChange={ev=>setToken(ev.target.value)}/>
            <input style={inputStyle} placeholder="New password (≥8 chars)" type="password" required minLength={8} value={password} onChange={ev=>setPassword(ev.target.value)}/>
            <button type="submit" disabled={busy} className="btn btn--accent" style={{ width:'100%', padding:10, fontSize:14, fontWeight:600 }}>{busy ? '…' : 'Reset password'}</button>
          </form>
        )}
        {mode === 'verify' && (
          <div>
            <input style={inputStyle} placeholder="Verification token" value={token} onChange={ev=>setToken(ev.target.value)}/>
            <button onClick={doVerify} disabled={busy} className="btn btn--accent" style={{ width:'100%', padding:10, fontSize:14, fontWeight:600 }}>{busy ? '…' : 'Verify email'}</button>
          </div>
        )}

        {error && <div style={{ padding: 8, background: 'var(--bg-soft)', border: '1px solid var(--down)', borderRadius: 'var(--r-md)', color: 'var(--down)', fontSize: 12, marginTop: 10 }}>{error}</div>}
        {info  && <div style={{ padding: 8, background: 'var(--bg-soft)', border: '1px solid var(--up)',   borderRadius: 'var(--r-md)', color: 'var(--up)',   fontSize: 12, marginTop: 10 }}>{info}</div>}

        <div style={{ marginTop: 18, fontSize: 12, color: 'var(--text-3)', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          {mode === 'login' && (<>
            <button style={linkBtn} onClick={() => { setMode('signup'); setError(null); setInfo(null); }}>Create account</button>
            <button style={linkBtn} onClick={() => { setMode('forgot'); setError(null); setInfo(null); }}>Forgot password?</button>
          </>)}
          {mode !== 'login' && (
            <button style={linkBtn} onClick={() => { setMode('login'); setError(null); setInfo(null); }}>Back to sign in</button>
          )}
        </div>
      </div>
    </div>
  );
};
window.LoginScreen = LoginScreen;
