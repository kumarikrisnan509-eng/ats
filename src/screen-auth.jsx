/* eslint-disable */
// @ts-check
/* Tier 67: Auth screens redesigned with two-panel layout, password strength meter,
   show/hide password toggles, inline validation, anti-enumeration messaging.
   Single component handles 5 modes: login, signup, forgot, reset, verify.
   Mobile collapses the brand panel. All API calls go to /api/auth/* */

const _passwordScore = (pw) => {
  if (!pw) return 0;
  let s = 0;
  if (pw.length >= 8)  s++;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/[0-9]/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return Math.min(s, 5);
};
const _scoreLabel = (s) => ['', 'Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'][s];
const _scoreColor = (s) => ['var(--border)', '#dc2626', '#f97316', '#eab308', '#84cc16', '#16a34a'][s];

const PasswordInput = ({ value, onChange, placeholder, autoComplete, showStrength = false, required = true, minLength }) => {
  const [show, setShow] = React.useState(false);
  const score = _passwordScore(value);
  return (
    <div style={{ position: 'relative', marginBottom: showStrength ? 8 : 14 }}>
      <input
        type={show ? 'text' : 'password'}
        required={required}
        minLength={minLength}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete={autoComplete}
        style={{
          width: '100%', padding: '12px 44px 12px 14px',
          background: 'var(--bg-sunk, #f8fafc)',
          border: '1px solid var(--border)',
          borderRadius: 8, fontSize: 14, color: 'var(--text)', outline: 'none',
          transition: 'border-color 120ms',
        }}
        onFocus={(e) => e.target.style.borderColor = 'var(--accent)'}
        onBlur={(e) => e.target.style.borderColor = 'var(--border)'}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShow(s => !s)}
        aria-label={show ? 'Hide password' : 'Show password'}
        style={{
          position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: 'var(--text-3)', fontSize: 12, padding: 4,
        }}
      >{show ? 'Hide' : 'Show'}</button>
      {showStrength && value && (
        <div style={{ marginTop: 6, display: 'flex', gap: 4, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 3, flex: 1 }}>
            {[1,2,3,4,5].map(i => (
              <div key={i} style={{
                flex: 1, height: 4, borderRadius: 2,
                background: i <= score ? _scoreColor(score) : 'var(--border)',
                transition: 'background 120ms',
              }}/>
            ))}
          </div>
          <span style={{ fontSize: 11, color: _scoreColor(score), minWidth: 80, textAlign: 'right' }}>
            {_scoreLabel(score)}
          </span>
        </div>
      )}
    </div>
  );
};

const TextInput = ({ type = 'text', value, onChange, placeholder, autoComplete, required = false, autoFocus = false }) => (
  <input
    type={type}
    required={required}
    autoFocus={autoFocus}
    value={value}
    onChange={onChange}
    placeholder={placeholder}
    autoComplete={autoComplete}
    style={{
      width: '100%', padding: '12px 14px', marginBottom: 14,
      background: 'var(--bg-sunk, #f8fafc)',
      border: '1px solid var(--border)',
      borderRadius: 8, fontSize: 14, color: 'var(--text)', outline: 'none',
      transition: 'border-color 120ms',
    }}
    onFocus={(e) => e.target.style.borderColor = 'var(--accent)'}
    onBlur={(e) => e.target.style.borderColor = 'var(--border)'}
  />
);

const BrandPanel = ({ subtitle }) => (
  <div style={{
    background: 'linear-gradient(135deg, #047857 0%, #065f46 100%)',
    color: '#fff',
    padding: '48px 40px',
    display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
    minHeight: 600,
  }}>
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 10,
          background: 'rgba(255,255,255,0.16)',
          display: 'grid', placeItems: 'center',
          fontWeight: 800, fontSize: 18, letterSpacing: '-0.02em',
        }}>A</div>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.01em' }}>ATS</div>
          <div style={{ fontSize: 11, opacity: 0.7, fontFamily: 'var(--mono)' }}>Automated Trading System</div>
        </div>
      </div>
      <h1 style={{ fontSize: 28, lineHeight: 1.2, margin: '0 0 14px', letterSpacing: '-0.02em', fontWeight: 600 }}>
        Algo trading for retail India.
      </h1>
      <p style={{ fontSize: 14, opacity: 0.85, lineHeight: 1.6, margin: 0 }}>
        {subtitle || 'Connect Zerodha. Backtest your strategies. Paper trade with real prices. Promote to live when you are confident.'}
      </p>
    </div>

    <div style={{ marginTop: 40 }}>
      {[
        { k: 'Realtime Kite WebSocket', v: 'Sub-second ticks across NSE, BSE, MCX' },
        { k: 'Per-user broker isolation',  v: 'Your credentials, your data, encrypted at rest' },
        { k: 'Strategy lab + paper trading', v: 'Build, backtest, paper-trade, then go live' },
        { k: 'AI-assisted insights', v: 'Claude/Gemini integration for portfolio analysis' },
      ].map(({k, v}) => (
        <div key={k} style={{ marginBottom: 18, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ width: 18, height: 18, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', display: 'grid', placeItems: 'center', flexShrink: 0, marginTop: 2 }}>
            <span style={{ fontSize: 10 }}>&#10003;</span>
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{k}</div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>{v}</div>
          </div>
        </div>
      ))}
    </div>

    <div style={{ marginTop: 40, fontSize: 11, opacity: 0.6 }}>
      &copy; ATS &middot; Investment subject to market risks. Not financial advice.
    </div>
  </div>
);

const FormPanel = ({ title, subtitle, children, footer, error, info }) => (
  <div style={{
    padding: '48px 40px',
    display: 'flex', flexDirection: 'column', justifyContent: 'center',
    minHeight: 600, background: 'var(--surface, #fff)',
  }}>
    <div style={{ maxWidth: 360, width: '100%', margin: '0 auto' }}>
      <h2 style={{ fontSize: 22, margin: '0 0 6px', letterSpacing: '-0.02em', fontWeight: 600 }}>{title}</h2>
      {subtitle && <p style={{ fontSize: 13, color: 'var(--text-3)', margin: '0 0 24px', lineHeight: 1.5 }}>{subtitle}</p>}
      {children}
      {error && (
        <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 8, background: 'color-mix(in oklab, #dc2626 10%, transparent)', color: '#b91c1c', fontSize: 13, borderLeft: '3px solid #dc2626' }}>
          {error}
        </div>
      )}
      {info && (
        <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 8, background: 'color-mix(in oklab, #16a34a 10%, transparent)', color: '#15803d', fontSize: 13, borderLeft: '3px solid #16a34a' }}>
          {info}
        </div>
      )}
      {footer}
    </div>
  </div>
);

const PrimaryButton = ({ busy, children, ...rest }) => (
  <button
    {...rest}
    disabled={busy || rest.disabled}
    style={{
      width: '100%', padding: '12px 16px', marginTop: 4,
      background: busy ? 'var(--text-3)' : 'var(--accent, #047857)',
      color: '#fff', border: 'none', borderRadius: 8,
      fontSize: 14, fontWeight: 600, letterSpacing: '0.01em',
      cursor: busy ? 'not-allowed' : 'pointer',
      transition: 'background 120ms',
    }}
  >{busy ? 'Working...' : children}</button>
);

const linkBtn = {
  background: 'none', border: 'none', color: 'var(--accent, #047857)',
  cursor: 'pointer', fontSize: 13, padding: 0, fontWeight: 500,
};

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
  const [info, setInfo] = React.useState(null);

  React.useEffect(() => {
    if (mode === 'verify' && token) doVerify();
  }, []);

  const switchMode = (m) => { setMode(m); setError(null); setInfo(null); };

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
        try { localStorage.setItem('rc_session', JSON.stringify({ authed: true, onboarded: true, user: r.user })); } catch (e) { console.debug('[screen-auth] swallowed:', e && e.message); }
        if (typeof onAuth === 'function') onAuth(r.user);
        location.hash = 'dashboard';
        location.reload();
      } else { setError(r && r.reason || 'Sign in failed'); }
    } catch (e) { setError(String(e.message || e)); }
    finally { setBusy(false); }
  };

  const submitSignup = async (e) => {
    e.preventDefault();
    if (_passwordScore(password) < 2) { setError('Pick a stronger password (8+ chars, mix of letters and numbers)'); return; }
    setBusy(true); setError(null); setInfo(null);
    try {
      const r = await post('/api/auth/signup', { email, password, name });
      if (r && r.ok) {
        setInfo('Account created. ' + (r.user.is_verified ? 'You can sign in now.' : 'Check your email for a verification link.'));
        switchMode('login'); setPassword('');
      } else { setError(r && r.reason || 'Signup failed'); }
    } catch (e) { setError(String(e.message || e)); }
    finally { setBusy(false); }
  };

  const submitForgot = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null); setInfo(null);
    try {
      await post('/api/auth/forgot-password', { email });
      setInfo('If that email is registered with us, a password-reset link is on its way. Check your inbox in a minute or two.');
    } catch (e) { setError(String(e.message || e)); }
    finally { setBusy(false); }
  };

  const submitReset = async (e) => {
    e.preventDefault();
    if (_passwordScore(password) < 2) { setError('Pick a stronger password'); return; }
    setBusy(true); setError(null); setInfo(null);
    try {
      const r = await post('/api/auth/reset-password', { token, newPassword: password });
      if (r && r.ok) { setInfo('Password reset. Sign in with your new password.'); switchMode('login'); }
      else setError(r && r.reason || 'Reset failed');
    } catch (e) { setError(String(e.message || e)); }
    finally { setBusy(false); }
  };

  const doVerify = async () => {
    setBusy(true); setError(null); setInfo(null);
    try {
      const r = await post('/api/auth/verify-email', { token });
      if (r && r.ok) setInfo(r.alreadyVerified ? 'Already verified.' : 'Email verified! Sign in to continue.');
      else setError(r && r.reason || 'Verification failed');
    } catch (e) { setError(String(e.message || e)); }
    finally { setBusy(false); }
  };

  // Pick the form pane content based on mode
  const renderForm = () => {
    if (mode === 'login') {
      return (
        <FormPanel
          title="Welcome back"
          subtitle="Sign in to continue to your dashboard."
          error={error} info={info}
          footer={
            <div style={{ marginTop: 22, fontSize: 13, color: 'var(--text-3)', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <span>New here? <button style={linkBtn} onClick={() => switchMode('signup')}>Create an account</button></span>
              <button style={linkBtn} onClick={() => switchMode('forgot')}>Forgot password?</button>
            </div>
          }
        >
          <form onSubmit={submitLogin}>
            <TextInput type="email" required autoFocus value={email} onChange={ev=>setEmail(ev.target.value)} placeholder="Email" autoComplete="email"/>
            <PasswordInput value={password} onChange={ev=>setPassword(ev.target.value)} placeholder="Password" autoComplete="current-password"/>
            <PrimaryButton busy={busy} type="submit">Sign in</PrimaryButton>
          </form>
        </FormPanel>
      );
    }
    if (mode === 'signup') {
      return (
        <FormPanel
          title="Create your account"
          subtitle="Start with paper trading. Connect Zerodha when you're ready to go live."
          error={error} info={info}
          footer={
            <div style={{ marginTop: 22, fontSize: 13, color: 'var(--text-3)' }}>
              Already have an account? <button style={linkBtn} onClick={() => switchMode('login')}>Sign in</button>
            </div>
          }
        >
          <form onSubmit={submitSignup}>
            <TextInput autoFocus value={name} onChange={ev=>setName(ev.target.value)} placeholder="Your name" autoComplete="name"/>
            <TextInput type="email" required value={email} onChange={ev=>setEmail(ev.target.value)} placeholder="Email" autoComplete="email"/>
            <PasswordInput value={password} onChange={ev=>setPassword(ev.target.value)} placeholder="Password" autoComplete="new-password" minLength={8} showStrength/>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 14 }}>
              By continuing you agree to the Terms and acknowledge that trading involves risk.
            </div>
            <PrimaryButton busy={busy} type="submit">Create account</PrimaryButton>
          </form>
        </FormPanel>
      );
    }
    if (mode === 'forgot') {
      return (
        <FormPanel
          title="Reset your password"
          subtitle="Enter your email and we'll send a reset link if the account exists. We won't reveal whether the email is registered."
          error={error} info={info}
          footer={
            <div style={{ marginTop: 22, fontSize: 13 }}>
              <button style={linkBtn} onClick={() => switchMode('login')}>&larr; Back to sign in</button>
            </div>
          }
        >
          <form onSubmit={submitForgot}>
            <TextInput type="email" required autoFocus value={email} onChange={ev=>setEmail(ev.target.value)} placeholder="Email" autoComplete="email"/>
            <PrimaryButton busy={busy} type="submit">Send reset link</PrimaryButton>
          </form>
        </FormPanel>
      );
    }
    if (mode === 'reset') {
      return (
        <FormPanel
          title="Choose a new password"
          subtitle="Paste the token from the reset email, then set a new password."
          error={error} info={info}
          footer={
            <div style={{ marginTop: 22, fontSize: 13 }}>
              <button style={linkBtn} onClick={() => switchMode('login')}>&larr; Back to sign in</button>
            </div>
          }
        >
          <form onSubmit={submitReset}>
            <TextInput required value={token} onChange={ev=>setToken(ev.target.value)} placeholder="Reset token (from email)"/>
            <PasswordInput value={password} onChange={ev=>setPassword(ev.target.value)} placeholder="New password" autoComplete="new-password" minLength={8} showStrength/>
            <PrimaryButton busy={busy} type="submit">Reset password</PrimaryButton>
          </form>
        </FormPanel>
      );
    }
    if (mode === 'verify') {
      return (
        <FormPanel
          title="Verify your email"
          subtitle="Click the link in the email we sent, or paste the verification token below."
          error={error} info={info}
          footer={
            <div style={{ marginTop: 22, fontSize: 13 }}>
              <button style={linkBtn} onClick={() => switchMode('login')}>&larr; Back to sign in</button>
            </div>
          }
        >
          <TextInput required value={token} onChange={ev=>setToken(ev.target.value)} placeholder="Verification token"/>
          <PrimaryButton busy={busy} onClick={doVerify}>Verify email</PrimaryButton>
        </FormPanel>
      );
    }
    return null;
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg, #f8fafc)', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div style={{
        width: '100%', maxWidth: 980,
        background: 'var(--surface, #fff)',
        borderRadius: 16,
        overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.04)',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
      }} className="auth-shell">
        <div className="auth-brand-panel">
          <BrandPanel
            subtitle={
              mode === 'signup' ? "Create an account to start. Paper-trade with live prices. Connect your broker when you're ready."
              : mode === 'forgot' ? "We'll help you get back into your account."
              : mode === 'reset'  ? "Almost done. Just pick a new password."
              : mode === 'verify' ? "One last step: confirm your email."
              : undefined
            }
          />
        </div>
        {renderForm()}
      </div>
      {/* Mobile: stack panels */}
      <style>{`
        @media (max-width: 768px) {
          .auth-shell { grid-template-columns: 1fr !important; max-width: 480px !important; }
          .auth-brand-panel { display: none; }
        }
      `}</style>
    </div>
  );
};

window.LoginScreen = LoginScreen;
