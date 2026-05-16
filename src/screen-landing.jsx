/* eslint-disable */
/* Tier 61: Anonymous landing page.
   Shown to unauthenticated visitors. Replaces the prior behavior where they
   saw the dashboard with mock KPIs. Renders a clean marketing splash with
   hero, features, how-it-works, and signup CTAs. */

const LandingHero = ({ onGetStarted, onSignIn }) => (
  <section style={{
    background: 'linear-gradient(135deg, #047857 0%, #064e3b 60%, #022c22 100%)',
    color: '#fff',
    padding: '72px 32px 96px',
    position: 'relative',
    overflow: 'hidden',
  }}>
    <div style={{
      position: 'absolute', top: '-30%', right: '-10%',
      width: 600, height: 600, borderRadius: '50%',
      background: 'radial-gradient(circle, rgba(16,185,129,0.18) 0%, transparent 70%)',
      pointerEvents: 'none',
    }}/>
    <div style={{ maxWidth: 1100, margin: '0 auto', position: 'relative', zIndex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 56 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 10,
          background: 'rgba(255,255,255,0.16)',
          display: 'grid', placeItems: 'center',
          fontWeight: 800, fontSize: 18, letterSpacing: '-0.02em',
        }}>A</div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em' }}>ATS</div>
          <div style={{ fontSize: 11, opacity: 0.7, fontFamily: 'var(--mono)' }}>Automated Trading System</div>
        </div>
        <div style={{ flex: 1 }}/>
        <button onClick={onSignIn} style={{
          background: 'transparent', color: '#fff',
          border: '1px solid rgba(255,255,255,0.3)',
          padding: '8px 16px', borderRadius: 8,
          fontSize: 13, fontWeight: 500, cursor: 'pointer',
        }}>Sign in</button>
      </div>

      <div style={{ maxWidth: 720 }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '6px 12px', borderRadius: 999,
          background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)',
          fontSize: 12, fontWeight: 500, marginBottom: 24,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 8px #10b981' }}/>
          Live on Zerodha &middot; Built for Indian markets
        </div>
        <h1 style={{
          fontSize: 56, lineHeight: 1.05, margin: '0 0 20px',
          letterSpacing: '-0.03em', fontWeight: 700,
        }}>
          Algo trading without the Python.
        </h1>
        <p style={{
          fontSize: 18, lineHeight: 1.55, opacity: 0.88,
          margin: '0 0 36px', maxWidth: 580,
        }}>
          Build, backtest, and deploy automated trading strategies on Indian markets.
          Connect Zerodha. Paper-trade with real prices. Promote to live when you're ready.
        </p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button onClick={onGetStarted} style={{
            background: '#fff', color: '#047857',
            border: 'none', padding: '14px 28px',
            borderRadius: 10, fontSize: 15, fontWeight: 600,
            cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          }}>Get started &mdash; it's free</button>
          <button onClick={onSignIn} style={{
            background: 'rgba(255,255,255,0.08)', color: '#fff',
            border: '1px solid rgba(255,255,255,0.25)',
            padding: '14px 28px', borderRadius: 10,
            fontSize: 15, fontWeight: 500, cursor: 'pointer',
          }}>I already have an account</button>
        </div>
        <div style={{ marginTop: 24, fontSize: 12, opacity: 0.6 }}>
          No credit card. Paper trading is unlimited and free. Live trading requires your own Zerodha account.
        </div>
      </div>
    </div>
  </section>
);

const FeatureGrid = () => (
  <section style={{ padding: '80px 32px', background: 'var(--bg, #f8fafc)' }}>
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 56 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#047857', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>
          Built end-to-end
        </div>
        <h2 style={{ fontSize: 36, margin: 0, letterSpacing: '-0.02em' }}>Everything an algo trader needs</h2>
      </div>
      <div style={{
        display: 'grid', gap: 20,
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
      }}>
        {[
          { icon: '⚡', title: 'Real-time Kite WebSocket', desc: 'Sub-second ticks across NSE, BSE, MCX. Same data feed your broker uses.' },
          { icon: '\u{1F512}', title: 'Per-user broker isolation', desc: 'Your Zerodha credentials are libsodium-sealed. Each user sees only their own data.' },
          { icon: '\u{1F4D8}', title: 'Strategy lab', desc: 'Build, backtest, and tune. EMA, RSI, MACD, Bollinger, custom rules. Multi-strategy portfolios.' },
          { icon: '\u{1F4DD}', title: 'Paper trading', desc: 'Live prices, simulated fills. Your capital, your slippage model. Zero real-money risk.' },
          { icon: '\u{1F916}', title: 'AI advisor (BYOK)', desc: 'Bring your own Claude / OpenAI / Gemini key. Portfolio analysis and rebalance suggestions.' },
          { icon: '\u{1F6E1}', title: 'Risk + compliance', desc: 'Kill switch, daily loss caps, IP allowlists, 2FA on live orders, WORM audit log.' },
        ].map(f => (
          <div key={f.title} style={{
            padding: '28px 24px',
            background: 'var(--surface, #fff)',
            borderRadius: 14,
            border: '1px solid var(--border, #e2e8f0)',
            transition: 'transform 200ms, box-shadow 200ms',
            cursor: 'default',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.08)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}>
            <div style={{ fontSize: 32, marginBottom: 14 }}>{f.icon}</div>
            <h3 style={{ fontSize: 16, margin: '0 0 6px', fontWeight: 600 }}>{f.title}</h3>
            <p style={{ fontSize: 13.5, margin: 0, color: 'var(--text-3, #64748b)', lineHeight: 1.6 }}>{f.desc}</p>
          </div>
        ))}
      </div>
    </div>
  </section>
);

const HowItWorks = () => (
  <section style={{ padding: '80px 32px', background: 'var(--surface, #fff)' }}>
    <div style={{ maxWidth: 980, margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 56 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#047857', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>How it works</div>
        <h2 style={{ fontSize: 36, margin: 0, letterSpacing: '-0.02em' }}>Three steps from sign-up to live trading</h2>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 28 }}>
        {[
          { n: 1, title: 'Sign up', desc: 'Email + password. No credit card. You land on a paper-trading dashboard with INR 10L of virtual capital and live market data.' },
          { n: 2, title: 'Connect Zerodha (optional)', desc: 'Add your Kite API key + secret. Secrets are sealed at rest. Click Reauth daily for fresh access tokens. Or stay on paper.' },
          { n: 3, title: 'Backtest, paper, then go live', desc: 'Build strategies in the lab. Watch them run on paper. Promote to live when the metrics earn it. Kill switch is one click.' },
        ].map(s => (
          <div key={s.n} style={{ textAlign: 'left' }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10,
              background: 'linear-gradient(135deg, #047857, #065f46)',
              color: '#fff', display: 'grid', placeItems: 'center',
              fontWeight: 700, fontSize: 16, marginBottom: 16,
            }}>{s.n}</div>
            <h3 style={{ fontSize: 18, margin: '0 0 8px', fontWeight: 600 }}>{s.title}</h3>
            <p style={{ fontSize: 14, margin: 0, color: 'var(--text-3, #64748b)', lineHeight: 1.65 }}>{s.desc}</p>
          </div>
        ))}
      </div>
    </div>
  </section>
);

const FooterCTA = ({ onGetStarted }) => (
  <section style={{
    padding: '80px 32px',
    background: 'linear-gradient(135deg, #064e3b 0%, #022c22 100%)',
    color: '#fff', textAlign: 'center',
  }}>
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <h2 style={{ fontSize: 36, margin: '0 0 18px', letterSpacing: '-0.02em' }}>Start with paper. Go live when ready.</h2>
      <p style={{ fontSize: 16, opacity: 0.85, lineHeight: 1.6, margin: '0 0 32px' }}>
        Get an account in under a minute. Trade on virtual capital with real prices today.
      </p>
      <button onClick={onGetStarted} style={{
        background: '#fff', color: '#047857',
        border: 'none', padding: '14px 32px',
        borderRadius: 10, fontSize: 15, fontWeight: 600,
        cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
      }}>Create your account</button>
    </div>
  </section>
);

const LandingFooter = () => (
  <footer style={{
    padding: '32px',
    background: 'var(--bg, #f8fafc)',
    borderTop: '1px solid var(--border, #e2e8f0)',
    color: 'var(--text-3, #64748b)',
    fontSize: 12,
  }}>
    <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', justifyContent: 'space-between' }}>
      <div>
        &copy; ATS &middot; Automated Trading System
      </div>
      <div style={{ opacity: 0.8 }}>
        Investments in securities are subject to market risks. Read all related documents carefully.
      </div>
    </div>
  </footer>
);

const LandingScreen = () => {
  const goSignup = () => { location.hash = 'signup'; };
  const goLogin  = () => { location.hash = 'login'; };
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg, #f8fafc)' }}>
      <LandingHero onGetStarted={goSignup} onSignIn={goLogin}/>
      <FeatureGrid/>
      <HowItWorks/>
      <FooterCTA onGetStarted={goSignup}/>
      <LandingFooter/>
    </div>
  );
};

window.LandingScreen = LandingScreen;
