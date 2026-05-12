/* eslint-disable */
/* Pre-auth screens — Login / Register / Forgot password
   Full-page brand layout, no sidebar/topbar. */

const AUTH_BG = (theme) => theme === "dark"
  ? "linear-gradient(135deg, oklch(20% 0.01 260) 0%, oklch(15% 0.015 260) 100%)"
  : "linear-gradient(135deg, oklch(98% 0.005 260) 0%, oklch(94% 0.01 260) 100%)";

// Shared layout: brand panel on left (desktop), form on right
const AuthLayout = ({ children, title, subtitle, footer }) => {
  return (
    <div style={{
      minHeight: "100vh", display: "grid",
      gridTemplateColumns: "1fr 1.1fr",
      background: AUTH_BG(document.documentElement.getAttribute("data-theme")),
    }}>
      {/* Brand panel */}
      <div style={{
        padding: "48px 56px",
        background: "var(--surface)",
        borderRight: "1px solid var(--border)",
        display: "flex", flexDirection: "column", gap: 32,
      }}>
        <div className="nav__brand" style={{ border: 0, padding: 0, margin: 0 }}>
          <div className="nav__logo">ATS</div>
          <div>
            <div className="nav__name">ATS</div>
            <div className="nav__sub">Trading platform</div>
          </div>
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 24, maxWidth: 440 }}>
          <div>
            <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>Why ATS</div>
            <h2 style={{ fontSize: 28, lineHeight: 1.25, letterSpacing: "-0.015em", marginBottom: 16, fontWeight: 600 }}>
              AI-assisted trading with paper-first validation and automatic profit sweeps.
            </h2>
            <p className="muted" style={{ fontSize: 14, lineHeight: 1.6 }}>
              Every signal gets 14 days in paper trading before touching live capital.
              Profits above your retention band auto-sweep into index funds.
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {[
              { v: "4", l: "trading modes" },
              { v: "8+", l: "strategies" },
              { v: "3", l: "AI sources" },
              { v: "Zerodha", l: "primary broker", mono: false },
            ].map(s => (
              <div key={s.l} style={{
                padding: "12px 14px",
                background: "var(--bg-soft)",
                borderRadius: "var(--r-md)",
                border: "1px solid var(--border)",
              }}>
                <div className="mono" style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em" }}>{s.v}</div>
                <div className="muted" style={{ fontSize: 11 }}>{s.l}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="muted" style={{ fontSize: 11, display: "flex", gap: 16 }}>
          <span>SEBI-compliant</span>
          <span>·</span>
          <span>Algo-ID tagged</span>
          <span>·</span>
          <span>Paper-first</span>
        </div>
      </div>

      {/* Form panel */}
      <div style={{ padding: "48px 56px", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: "100%", maxWidth: 400 }}>
          <div style={{ marginBottom: 32 }}>
            <h1 style={{ fontSize: 26, letterSpacing: "-0.02em", marginBottom: 8, fontWeight: 600 }}>{title}</h1>
            {subtitle && <div className="muted" style={{ fontSize: 14, lineHeight: 1.5 }}>{subtitle}</div>}
          </div>
          {children}
          {footer && <div style={{ marginTop: 24, fontSize: 13, color: "var(--text-3)", textAlign: "center" }}>{footer}</div>}
        </div>
      </div>
    </div>
  );
};

const FormField = ({ label, children, hint, error }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
    <label style={{ fontSize: 12, fontWeight: 500, color: "var(--text-2)" }}>{label}</label>
    {children}
    {hint && !error && <div className="muted" style={{ fontSize: 11 }}>{hint}</div>}
    {error && <div style={{ fontSize: 11, color: "var(--down)" }}>{error}</div>}
  </div>
);

const FormInput = (props) => (
  <input
    {...props}
    style={{
      padding: "10px 12px",
      fontSize: 14,
      border: "1px solid var(--border)",
      borderRadius: "var(--r-sm)",
      background: "var(--surface)",
      color: "var(--text-1)",
      outline: "none",
      transition: "border-color 0.1s",
      ...props.style,
    }}
    onFocus={e => e.currentTarget.style.borderColor = "var(--accent)"}
    onBlur={e => e.currentTarget.style.borderColor = "var(--border)"}
  />
);

// ---------- Login ----------
const LoginScreen = ({ onAuth, go }) => {
  const [email, setEmail] = React.useState("rajasekar@example.in");
  const [password, setPassword] = React.useState("");
  const [show, setShow] = React.useState(false);
  const [remember, setRemember] = React.useState(true);

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Log in to resume your automated trading session."
      footer={<>New here? <a href="#register" style={{ color: "var(--accent)", fontWeight: 500 }}>Create an account</a></>}
    >
      <FormField label="Email">
        <FormInput type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email"/>
      </FormField>
      <FormField label={
        <div className="between">
          <span>Password</span>
          <a href="#forgot" style={{ color: "var(--accent)", fontSize: 11, fontWeight: 400 }}>Forgot?</a>
        </div>
      }>
        <div style={{ position: "relative" }}>
          <FormInput
            type={show ? "text" : "password"}
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="current-password"
            style={{ width: "100%", paddingRight: 40 }}
          />
          <button
            type="button"
            onClick={() => setShow(s => !s)}
            style={{
              position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
              background: "none", border: "none", color: "var(--text-3)", cursor: "pointer", fontSize: 11,
            }}
          >{show ? "Hide" : "Show"}</button>
        </div>
      </FormField>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20, fontSize: 13 }}>
        <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} id="remember" />
        <label htmlFor="remember">Keep me signed in for 30 days</label>
      </div>

      <button
        className="btn btn--primary"
        style={{ width: "100%", justifyContent: "center", padding: "11px 16px", fontSize: 14, fontWeight: 500 }}
        onClick={onAuth}
      >
        Log in
      </button>

      <div style={{ textAlign: "center", margin: "20px 0 16px", position: "relative" }}>
        <div style={{ height: 1, background: "var(--border)", position: "absolute", top: "50%", left: 0, right: 0 }}/>
        <span className="muted" style={{ background: "var(--bg)", padding: "0 12px", fontSize: 11, position: "relative", textTransform: "uppercase", letterSpacing: "0.08em" }}>or</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <button className="btn" style={{ width: "100%", justifyContent: "center", padding: "10px 16px" }}>
          <span style={{ width: 16, height: 16, background: "var(--accent)", borderRadius: 3, display: "inline-block" }}/>
          Continue with Zerodha Kite
        </button>
        <button className="btn btn--ghost" style={{ width: "100%", justifyContent: "center", padding: "10px 16px", fontSize: 13 }}>
          Passkey / 2FA only
        </button>
      </div>
    </AuthLayout>
  );
};

// ---------- Register ----------
const RegisterScreen = ({ onAuth }) => {
  const [form, setForm] = React.useState({ name: "", email: "", phone: "", password: "", pan: "" });
  const [agree, setAgree] = React.useState(false);
  const [step, setStep] = React.useState(1);

  const update = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const passStrength = form.password.length < 8 ? "weak" : form.password.length < 12 ? "okay" : "strong";
  const passColor = { weak: "var(--down)", okay: "oklch(65% 0.13 80)", strong: "var(--up)" }[passStrength];

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Start with paper trading — no capital at risk. Takes 2 minutes."
      footer={<>Already have an account? <a href="#login" style={{ color: "var(--accent)", fontWeight: 500 }}>Log in</a></>}
    >
      {/* Progress */}
      <div style={{ display: "flex", gap: 4, marginBottom: 24 }}>
        {[1, 2].map(n => (
          <div key={n} style={{
            flex: 1, height: 3, borderRadius: 2,
            background: n <= step ? "var(--accent)" : "var(--border)",
          }}/>
        ))}
      </div>

      {step === 1 ? (
        <>
          <FormField label="Full name">
            <FormInput value={form.name} onChange={update("name")} placeholder="Rajasekar Selvam"/>
          </FormField>
          <FormField label="Email">
            <FormInput type="email" value={form.email} onChange={update("email")} placeholder="you@example.in"/>
          </FormField>
          <FormField label="Password" hint={`Length: ${form.password.length} · Strength: ${passStrength}`}>
            <FormInput type="password" value={form.password} onChange={update("password")}/>
            {form.password && (
              <div style={{ height: 2, background: "var(--border)", borderRadius: 1, marginTop: 4, overflow: "hidden" }}>
                <div style={{ width: `${Math.min(100, form.password.length * 10)}%`, height: "100%", background: passColor, transition: "all 0.2s" }}/>
              </div>
            )}
          </FormField>
          <button
            className="btn btn--primary"
            style={{ width: "100%", justifyContent: "center", padding: "11px 16px" }}
            onClick={() => setStep(2)}
            disabled={!form.name || !form.email || form.password.length < 8}
          >
            Continue
          </button>
        </>
      ) : (
        <>
          <div className="muted" style={{ fontSize: 12, marginBottom: 16, padding: "10px 12px", background: "var(--bg-soft)", borderRadius: "var(--r-sm)" }}>
            KYC details are only used to tag your broker's Algo-ID per SEBI rules. We never touch your bank.
          </div>
          <FormField label="Phone (Aadhaar-linked)">
            <FormInput value={form.phone} onChange={update("phone")} placeholder="+91 98765 43210"/>
          </FormField>
          <FormField label="PAN" hint="10-character permanent account number">
            <FormInput value={form.pan} onChange={update("pan")} placeholder="ABCDE1234F" maxLength={10} style={{ textTransform: "uppercase", fontFamily: "var(--mono)" }}/>
          </FormField>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 20, fontSize: 12 }}>
            <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} id="agree" style={{ marginTop: 3 }}/>
            <label htmlFor="agree" style={{ lineHeight: 1.5 }}>
              I understand trading involves risk. I agree to the <a href="#" style={{ color: "var(--accent)" }}>terms of service</a>, <a href="#" style={{ color: "var(--accent)" }}>risk disclosure</a>, and SEBI algo-trading rules.
            </label>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" style={{ flex: 1, justifyContent: "center", padding: "11px 16px" }} onClick={() => setStep(1)}>Back</button>
            <button
              className="btn btn--primary"
              style={{ flex: 2, justifyContent: "center", padding: "11px 16px" }}
              onClick={onAuth}
              disabled={!agree || !form.pan || !form.phone}
            >
              Create account → Onboarding
            </button>
          </div>
        </>
      )}
    </AuthLayout>
  );
};

// ---------- Forgot Password ----------
const ForgotScreen = () => {
  const [email, setEmail] = React.useState("");
  const [sent, setSent] = React.useState(false);

  return (
    <AuthLayout
      title={sent ? "Check your email" : "Reset your password"}
      subtitle={sent
        ? `We sent a reset link to ${email}. It expires in 30 minutes.`
        : "Enter the email you used to register. We'll send a reset link."}
      footer={<>Remembered it? <a href="#login" style={{ color: "var(--accent)", fontWeight: 500 }}>Back to login</a></>}
    >
      {sent ? (
        <>
          <div style={{
            padding: "16px 18px",
            background: "var(--up-soft)",
            border: "1px solid var(--up)",
            borderRadius: "var(--r-md)",
            marginBottom: 16,
            fontSize: 13,
          }}>
            <div style={{ fontWeight: 500, marginBottom: 4 }}>Reset link sent</div>
            <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
              If you don't see it in 2 minutes, check spam. The link is single-use and expires in 30 min.
            </div>
          </div>
          <button className="btn" style={{ width: "100%", justifyContent: "center" }} onClick={() => setSent(false)}>
            Send to a different email
          </button>
        </>
      ) : (
        <>
          <FormField label="Email">
            <FormInput type="email" value={email} onChange={e => setEmail(e.target.value)} autoFocus/>
          </FormField>
          <button
            className="btn btn--primary"
            style={{ width: "100%", justifyContent: "center", padding: "11px 16px" }}
            onClick={() => setSent(true)}
            disabled={!email.includes("@")}
          >
            Send reset link
          </button>
        </>
      )}
    </AuthLayout>
  );
};

window.LoginScreen = LoginScreen;
window.RegisterScreen = RegisterScreen;
window.ForgotScreen = ForgotScreen;
