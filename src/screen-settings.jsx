/* eslint-disable */
// @ts-check
/* Tier 85: Settings page polish — sticky side-nav, 2-col layout, sticky save bar,
   section icons, custom time picker, skeleton loaders, danger zone visual treatment,
   inline Test buttons for notification channels, mobile responsive. */

// ============ time picker (replaces native input) ============
const TimePicker = ({ value, onChange, disabled }) => {
  const slots = [];
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 30]) {
      const hh = String(h).padStart(2, '0');
      const mm = String(m).padStart(2, '0');
      slots.push(`${hh}:${mm}`);
    }
  }
  return (
    <select className="input" value={value || '16:00'} disabled={disabled}
      onChange={e => onChange(e.target.value)} style={{ maxWidth: 140 }}>
      {slots.map(s => <option key={s} value={s}>{s} IST</option>)}
    </select>
  );
};

// ============ skeleton placeholder ============
const SettingsSkeleton = ({ h = 16, w = '100%', mb = 8, r = 4 }) => (
  <div style={{ height: h, width: w, marginBottom: mb, borderRadius: r,
    background: 'linear-gradient(90deg, var(--bg-soft) 0%, color-mix(in oklab, var(--bg-soft) 60%, var(--border)) 50%, var(--bg-soft) 100%)',
    backgroundSize: '200% 100%', animation: 'ats-shimmer 1.4s ease-in-out infinite',
  }} />
);

// ============ side-nav row ============
const NavRow = ({ icon, label, active, onClick, hint }) => (
  <button onClick={onClick} className="btn btn--ghost" style={{
    width: '100%', justifyContent: 'flex-start', padding: '10px 14px', borderRadius: 6,
    background: active ? 'color-mix(in oklab, var(--accent) 10%, transparent)' : 'transparent',
    color: active ? 'var(--accent)' : 'var(--text)',
    fontWeight: active ? 500 : 400, fontSize: 13, gap: 10,
  }}>
    <span style={{ fontSize: 16, lineHeight: 1, width: 18, display: 'inline-block', textAlign: 'center' }}>{icon}</span>
    <span style={{ flex: 1, textAlign: 'left' }}>{label}</span>
    {hint && <span className="muted" style={{ fontSize: 10 }}>{hint}</span>}
  </button>
);

// ============ section card with icon header ============
const Section = React.forwardRef(({ id, icon, title, sub, children, danger, savedAt }, ref) => (
  <section id={id} ref={ref} style={{ scrollMarginTop: 24 }}>
    <div style={{
      background: 'var(--surface)',
      border: danger ? '1px solid color-mix(in oklab, var(--danger) 30%, var(--border))' : '1px solid var(--border)',
      borderRadius: 10, overflow: 'hidden', marginBottom: 16,
    }}>
      <div style={{
        padding: '14px 18px', borderBottom: '1px solid var(--border)',
        background: danger ? 'color-mix(in oklab, var(--danger) 8%, transparent)' : 'transparent',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <span style={{
          fontSize: 16, width: 32, height: 32, borderRadius: 8,
          background: danger ? 'color-mix(in oklab, var(--danger) 15%, transparent)' : 'color-mix(in oklab, var(--accent) 10%, transparent)',
          display: 'grid', placeItems: 'center', color: danger ? 'var(--danger)' : 'var(--accent)', fontWeight: 600,
        }}>{icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: danger ? 'var(--danger)' : 'var(--text)' }}>{title}</div>
          {sub && <div className="muted" style={{ fontSize: 12, marginTop: 1 }}>{sub}</div>}
        </div>
        {savedAt && (
          <div className="muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }} title={savedAt.toISOString()}>
            Saved {_relTime(savedAt)}
          </div>
        )}
      </div>
      <div style={{ padding: 18 }}>{children}</div>
    </div>
  </section>
));

const _relTime = (d) => {
  const dt = (Date.now() - (d instanceof Date ? d.getTime() : new Date(d).getTime())) / 1000;
  if (dt < 60) return 'just now';
  if (dt < 3600) return Math.round(dt/60) + 'm ago';
  if (dt < 86400) return Math.round(dt/3600) + 'h ago';
  return Math.round(dt/86400) + 'd ago';
};

const SettingsScreen = () => {
  // server state
  const [account, setAccount] = React.useState(null);
  const [prefs, setPrefs] = React.useState(null);
  const [notif, setNotif] = React.useState(null);
  // form state (mirrors server + tracks dirty)
  const [accountForm, setAccountForm] = React.useState({ name: '', email: '' });
  const [prefsForm, setPrefsForm] = React.useState(null);
  const [notifForm, setNotifForm] = React.useState({
    email_enabled: true, email_digest_time: '16:00',
    telegram_enabled: false, telegram_chat_id: '', telegram_bot_token: '',
    webhook_enabled: false, webhook_url: '', webhook_secret: '',
  });
  // save timestamps
  const [savedAt, setSavedAt] = React.useState({ account: null, display: null, notifications: null });
  // ui
  const [toast, setToast] = React.useState(null);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [activeSection, setActiveSection] = React.useState('account');
  const [testingChannel, setTestingChannel] = React.useState(null);
  // T-189: per-section save in-flight flag (so inline Save buttons can show "⋯ saving"
  // and prevent double-submit). Distinct from `testingChannel`, which gates Send test only.
  const [savingNotif, setSavingNotif] = React.useState(false);

  // refs for scrollspy
  const refs = {
    account: React.useRef(null), display: React.useRef(null), notifications: React.useRef(null),
    aiProviders: React.useRef(null), connected: React.useRef(null), danger: React.useRef(null),
  };

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [a, p, n] = await Promise.all([
          fetch('/api/v1/me/account', { credentials: 'include' }).then(r => r.json()),
          fetch('/api/v1/me/preferences', { credentials: 'include' }).then(r => r.json()),
          fetch('/api/v1/me/notifications', { credentials: 'include' }).then(r => r.json()),
        ]);
        if (cancelled) return;
        if (a.ok) { setAccount(a.account); setAccountForm({ name: a.account.name || '', email: a.account.email || '' }); }
        if (p.ok) { setPrefs(p.preferences); setPrefsForm(p.preferences); }
        if (n.ok) {
          setNotif(n.notifications);
          setNotifForm({
            email_enabled: !!n.notifications.email_enabled,
            email_digest_time: n.notifications.email_digest_time || '16:00',
            telegram_enabled: !!n.notifications.telegram_enabled,
            telegram_chat_id: n.notifications.telegram_chat_id || '',
            telegram_bot_token: n.notifications.telegram_bot_token_set ? '(unchanged)' : '',
            webhook_enabled: !!n.notifications.webhook_enabled,
            webhook_url: n.notifications.webhook_url || '',
            webhook_secret: n.notifications.webhook_secret_set ? '(unchanged)' : '',
          });
        }
      } catch (e) { console.warn('[settings] load failed:', e.message); }
    };
    load();
  }, []);

  // scrollspy
  React.useEffect(() => {
    const handler = () => {
      const sections = ['account', 'display', 'notifications', 'aiProviders', 'connected', 'danger'];
      let current = sections[0];
      for (const s of sections) {
        const el = refs[s].current;
        if (el && el.getBoundingClientRect().top < 200) current = s;
      }
      setActiveSection(current);
    };
    window.addEventListener('scroll', handler, { passive: true });
    handler();
    return () => window.removeEventListener('scroll', handler);
  }, []);

  const flash = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };

  // dirty trackers — compare form vs server snapshot
  const accountDirty = account && (accountForm.name !== (account.name || '') || accountForm.email !== (account.email || ''));
  const prefsDirty = prefs && prefsForm && JSON.stringify(prefs) !== JSON.stringify(prefsForm);
  // T-192: split notifDirty into per-channel flags so each inline Save button
  // can show/hide based on its OWN section's state, not the whole notifications
  // blob. emailDirty/telegramDirty/webhookDirty are evaluated against the
  // server-side snapshot (`notif`) the same way the old combined flag was.
  const emailDirty = notif && (
    notifForm.email_enabled !== !!notif.email_enabled ||
    notifForm.email_digest_time !== (notif.email_digest_time || '16:00')
  );
  const telegramDirty = notif && (
    notifForm.telegram_enabled !== !!notif.telegram_enabled ||
    notifForm.telegram_chat_id !== (notif.telegram_chat_id || '') ||
    (notifForm.telegram_bot_token !== '(unchanged)' && notifForm.telegram_bot_token !== '')
  );
  const webhookDirty = notif && (
    notifForm.webhook_enabled !== !!notif.webhook_enabled ||
    notifForm.webhook_url !== (notif.webhook_url || '') ||
    (notifForm.webhook_secret !== '(unchanged)' && notifForm.webhook_secret !== '')
  );
  const notifDirty = emailDirty || telegramDirty || webhookDirty;
  const anyDirty = accountDirty || prefsDirty || notifDirty;

  const saveAll = async () => {
    if (accountDirty) await saveAccount();
    if (prefsDirty)   await savePrefs();
    if (notifDirty)   await saveNotif();
  };
  const discardAll = () => {
    if (account) setAccountForm({ name: account.name || '', email: account.email || '' });
    if (prefs)   setPrefsForm(prefs);
    if (notif) setNotifForm({
      email_enabled: !!notif.email_enabled, email_digest_time: notif.email_digest_time || '16:00',
      telegram_enabled: !!notif.telegram_enabled, telegram_chat_id: notif.telegram_chat_id || '',
      telegram_bot_token: notif.telegram_bot_token_set ? '(unchanged)' : '',
      webhook_enabled: !!notif.webhook_enabled, webhook_url: notif.webhook_url || '',
      webhook_secret: notif.webhook_secret_set ? '(unchanged)' : '',
    });
  };

  const saveAccount = async () => {
    const res = await fetch('/api/v1/me/account', { method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(accountForm) });
    const j = await res.json();
    if (res.ok && j.ok) {
      flash('Account saved');
      const refreshed = await fetch('/api/v1/me/account', { credentials: 'include' }).then(r => r.json());
      if (refreshed.ok) setAccount(refreshed.account);
      setSavedAt(s => ({ ...s, account: new Date() }));
    } else flash(j.detail || 'save failed', false);
  };

  const savePrefs = async () => {
    const res = await fetch('/api/v1/me/preferences', { method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(prefsForm) });
    const j = await res.json();
    if (res.ok && j.ok) {
      flash('Display saved');
      setPrefs(j.preferences);
      if (prefsForm.theme) document.documentElement.setAttribute('data-theme', prefsForm.theme === 'auto' ? '' : prefsForm.theme);
      if (prefsForm.density) document.documentElement.setAttribute('data-density', prefsForm.density);
      setSavedAt(s => ({ ...s, display: new Date() }));
    } else flash(j.detail || 'save failed', false);
  };

  const saveNotif = async () => {
    // T-189: guard re-entry while a save is in flight (per-section Save buttons
    // can fire while the global sticky bar is also visible).
    if (savingNotif) return;

    // T-192-E: confirm before clobbering an existing sealed credential. The
    // backend will simply replace the sealed cell -- there's no undo. For
    // trading-related alerting credentials a single mistyped char can mean
    // missed signals during market hours, so an explicit confirm is worth the
    // friction. We only ask when the user is REPLACING a real token, not when
    // first setting one (notif.*_set is false in that case).
    const replacingTelegramToken =
      notif && notif.telegram_bot_token_set &&
      notifForm.telegram_bot_token !== '(unchanged)' &&
      notifForm.telegram_bot_token !== '';
    const replacingWebhookSecret =
      notif && notif.webhook_secret_set &&
      notifForm.webhook_secret !== '(unchanged)' &&
      notifForm.webhook_secret !== '';
    if (replacingTelegramToken || replacingWebhookSecret) {
      const what = replacingTelegramToken && replacingWebhookSecret
        ? 'the Telegram bot token AND webhook signing secret'
        : replacingTelegramToken ? 'the Telegram bot token' : 'the webhook signing secret';
      if (!window.confirm(`Replace ${what}? The previous sealed value will be discarded and cannot be recovered.`)) {
        return;
      }
    }

    setSavingNotif(true);

    // T-192-D: optimistic update. Mutate the local `notif` snapshot to what we
    // are about to send so the dirty flags clear and "Saved just now" can show
    // immediately. If the PUT fails we roll back to `prevNotif`. This removes
    // the ~200ms re-fetch latency for the common case (save succeeds).
    const prevNotif = notif;
    const prevForm = notifForm;
    const payload = { ...notifForm };
    if (payload.telegram_bot_token === '(unchanged)') delete payload.telegram_bot_token;
    if (payload.webhook_secret === '(unchanged)') delete payload.webhook_secret;
    const optimistic = {
      ...notif,
      email_enabled: !!payload.email_enabled,
      email_digest_time: payload.email_digest_time || '16:00',
      telegram_enabled: !!payload.telegram_enabled,
      telegram_chat_id: payload.telegram_chat_id || '',
      telegram_bot_token_set: payload.telegram_bot_token ? true : !!(notif && notif.telegram_bot_token_set),
      webhook_enabled: !!payload.webhook_enabled,
      webhook_url: payload.webhook_url || '',
      webhook_secret_set: payload.webhook_secret ? true : !!(notif && notif.webhook_secret_set),
    };
    setNotif(optimistic);
    // After optimistic update, mask the input fields the same way the server
    // masks them on re-read. This is what the old code did via a refetch.
    setNotifForm(f => ({ ...f,
      telegram_bot_token: optimistic.telegram_bot_token_set ? '(unchanged)' : '',
      webhook_secret:     optimistic.webhook_secret_set ? '(unchanged)' : '',
    }));
    setSavedAt(s => ({ ...s, notifications: new Date() }));

    try {
      const res = await fetch('/api/v1/me/notifications', { method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const j = await res.json();
      if (res.ok && j.ok) {
        flash('Notifications saved');
      } else {
        // Rollback: server rejected the change.
        setNotif(prevNotif);
        setNotifForm(prevForm);
        flash(j.detail || j.reason || 'save failed', false);
      }
    } catch (e) {
      // Rollback: network or transport error.
      setNotif(prevNotif);
      setNotifForm(prevForm);
      flash('Save failed: ' + (e && e.message ? e.message : 'network error'), false);
    } finally {
      setSavingNotif(false);
    }
  };

  const testChannel = async (channel) => {
    setTestingChannel(channel);
    try {
      const res = await fetch('/api/v1/me/notifications/test', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel }) });
      const j = await res.json();
      if (res.ok && j.ok) flash(`✓ Test message sent via ${channel}`);
      else flash(`Test failed: ${j.detail || j.reason || 'unknown'}`, false);
    } catch (e) { flash(`Test failed: ${e.message}`, false); }
    finally { setTestingChannel(null); }
  };

  const jumpTo = (id) => {
    const el = refs[id].current;
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const exportData = () => window.open('/api/v1/me/export', '_blank');
  const confirmDelete = async () => {
    const res = await fetch('/api/v1/me/account', { method: 'DELETE', credentials: 'include',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'DELETE' }) });
    if (res.ok) { window.dispatchEvent(new CustomEvent('logout')); window.location.hash = 'login'; }
  };

  return (
    <>
      <style>{`@keyframes ats-shimmer { 0% {background-position: 200% 0;} 100% {background-position: -200% 0;} }`}</style>

      <div className="page-header">
        <div>
          <h1 className="page-header__title">Settings</h1>
          <div className="page-header__sub">Account, display, notifications.</div>
        </div>
      </div>

      {toast && (
        <div style={{
          padding: 10, marginBottom: 12, borderRadius: 6, fontSize: 12,
          background: toast.ok ? 'color-mix(in oklab, var(--up) 12%, transparent)' : 'color-mix(in oklab, var(--danger) 12%, transparent)',
          color: toast.ok ? 'var(--up)' : 'var(--danger)', border: '1px solid currentColor',
        }}>{toast.ok ? '✓' : '✕'} {toast.msg}</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 220px) minmax(0, 1fr)', gap: 24 }}
        className="settings-grid">
        {/* ===== STICKY SIDE NAV ===== */}
        <aside style={{ position: 'sticky', top: 16, alignSelf: 'flex-start', height: 'fit-content', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <NavRow icon="👤" label="Account"         active={activeSection === 'account'}        onClick={() => jumpTo('account')} />
          <NavRow icon="🎨" label="Display"         active={activeSection === 'display'}        onClick={() => jumpTo('display')} />
          <NavRow icon="🔔" label="Notifications"   active={activeSection === 'notifications'}  onClick={() => jumpTo('notifications')} />
          <NavRow icon="🤖" label="AI providers"    active={activeSection === 'aiProviders'}    onClick={() => jumpTo('aiProviders')} />
          <NavRow icon="🔗" label="Connected apps"  active={activeSection === 'connected'}      onClick={() => jumpTo('connected')} />
          <NavRow icon="⚠"  label="Danger zone"    active={activeSection === 'danger'}         onClick={() => jumpTo('danger')} />
          <div style={{ marginTop: 16, padding: '10px 14px', borderTop: '1px solid var(--border)' }}>
            <div className="muted" style={{ fontSize: 11 }}>
              {anyDirty ? <span style={{ color: 'var(--warn, #d97706)' }}>⚠ Unsaved changes</span> : <span>All changes saved</span>}
            </div>
          </div>
        </aside>

        {/* ===== CONTENT ===== */}
        <main>
          {/* Account */}
          <Section ref={refs.account} id="account" icon="👤" title="Account"
            sub="Your identity. Email change requires re-verification."
            savedAt={savedAt.account}>
            {!account ? (
              <><SettingsSkeleton w="40%" h={14} /><SettingsSkeleton w="100%" h={36} /><SettingsSkeleton w="100%" h={36} /></>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 16 }}>
                  <label>
                    <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>Name</div>
                    <input className="input" value={accountForm.name} onChange={e => setAccountForm(f => ({ ...f, name: e.target.value }))} />
                  </label>
                  <label>
                    <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>
                      Email {!account.is_verified && <span style={{ color: 'var(--warn, #d97706)', marginLeft: 6 }}>· unverified</span>}
                    </div>
                    <input className="input" type="email" value={accountForm.email} onChange={e => setAccountForm(f => ({ ...f, email: e.target.value }))} />
                  </label>
                </div>
                <div className="muted" style={{ fontSize: 11, marginTop: 12 }}>
                  Timezone: Asia/Kolkata (IST) · auto-detected · Account ID #{account.id} · Created {_relTime(account.created_at)}
                </div>
              </>
            )}
          </Section>

          {/* Display */}
          <Section ref={refs.display} id="display" icon="🎨" title="Display"
            sub="Theme, density, currency format." savedAt={savedAt.display}>
            {!prefsForm ? (
              <><SettingsSkeleton w="100%" h={40} /><SettingsSkeleton w="100%" h={40} /><SettingsSkeleton w="100%" h={40} /></>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>Theme</div>
                    <Segmented value={prefsForm.theme} onChange={v => setPrefsForm(p => ({ ...p, theme: v }))}
                      options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'auto', label: 'System' }]} />
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>Density</div>
                    <Segmented value={prefsForm.density} onChange={v => setPrefsForm(p => ({ ...p, density: v }))}
                      options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]} />
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>Currency format</div>
                    <Segmented value={prefsForm.currency_format} onChange={v => setPrefsForm(p => ({ ...p, currency_format: v }))}
                      options={[{ value: 'abbrev', label: '₹4.8L' }, { value: 'full', label: '₹4,82,340' }]} />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 18, paddingTop: 16, borderTop: '1px dashed var(--border)' }}>
                  <div className="between">
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 500 }}>Round to whole rupees</div>
                      <div className="muted" style={{ fontSize: 11 }}>Drop the paise on all displays.</div>
                    </div>
                    <Toggle on={!!prefsForm.round_rupees} onClick={() => setPrefsForm(p => ({ ...p, round_rupees: !p.round_rupees }))} />
                  </div>
                  <div className="between">
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 500 }}>P&L in header</div>
                      <div className="muted" style={{ fontSize: 11 }}>Today's P&L widget in the top bar.</div>
                    </div>
                    <Toggle on={!!prefsForm.show_pnl_in_header} onClick={() => setPrefsForm(p => ({ ...p, show_pnl_in_header: !p.show_pnl_in_header }))} />
                  </div>
                </div>
              </>
            )}
          </Section>

          {/* Notifications */}
          <Section ref={refs.notifications} id="notifications" icon="🔔" title="Notifications"
            sub="Where critical alerts land. Tokens are libsodium-sealed; never echoed back."
            savedAt={savedAt.notifications}>
            {!notif ? <><SettingsSkeleton h={80} /><SettingsSkeleton h={80} /><SettingsSkeleton h={80} /></> : (
              <div style={{ display: 'grid', gap: 14 }}>
                {/* Email */}
                <div style={{ padding: 14, border: '1px solid var(--border)', borderRadius: 6, background: notifForm.email_enabled ? 'transparent' : 'color-mix(in oklab, var(--bg-soft) 50%, transparent)' }}>
                  <div className="between" style={{ marginBottom: notifForm.email_enabled ? 10 : 0 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>📧 Email digest</div>
                      <div className="muted" style={{ fontSize: 11 }}>Daily summary of orders, P&L, signals.</div>
                    </div>
                    <Toggle on={notifForm.email_enabled} onClick={() => setNotifForm(f => ({ ...f, email_enabled: !f.email_enabled }))} />
                  </div>
                  {notifForm.email_enabled && (
                    <div className="row" style={{ gap: 8, marginTop: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                      <label>
                        <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>Send time</div>
                        <TimePicker value={notifForm.email_digest_time} onChange={v => setNotifForm(f => ({ ...f, email_digest_time: v }))} />
                      </label>
                      <div style={{ flex: 1 }} />
                      {/* T-189 + T-192-A: inline Save renders ONLY when THIS section is dirty.
                          Disappears when clean so the user isn't tempted to click a no-op. */}
                      {emailDirty && (
                        <button className="btn btn--sm btn--primary" data-testid="notif-save-email"
                          disabled={savingNotif} onClick={saveNotif}>
                          {savingNotif ? '⋯ saving' : 'Save'}
                        </button>
                      )}
                      <button className="btn btn--sm" disabled={!!testingChannel} onClick={() => testChannel('email')}>
                        {testingChannel === 'email' ? '⋯ sending' : 'Send test email'}
                      </button>
                    </div>
                  )}
                </div>
                {/* Telegram */}
                <div style={{ padding: 14, border: '1px solid var(--border)', borderRadius: 6, background: notifForm.telegram_enabled ? 'transparent' : 'color-mix(in oklab, var(--bg-soft) 50%, transparent)' }}>
                  <div className="between" style={{ marginBottom: notifForm.telegram_enabled ? 10 : 0 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>✈ Telegram</div>
                      <div className="muted" style={{ fontSize: 11 }}>Real-time alerts via your own bot.</div>
                    </div>
                    <Toggle on={notifForm.telegram_enabled} onClick={() => setNotifForm(f => ({ ...f, telegram_enabled: !f.telegram_enabled }))} />
                  </div>
                  {notifForm.telegram_enabled && (
                    <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
                      <label>
                        <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>Bot token <a href="https://core.telegram.org/bots#how-do-i-create-a-bot" target="_blank" rel="noopener" style={{ color: 'var(--accent)', marginLeft: 6 }}>get from @BotFather ↗</a></div>
                        <input className="input" type="password" autoComplete="off" value={notifForm.telegram_bot_token}
                          onChange={e => setNotifForm(f => ({ ...f, telegram_bot_token: e.target.value }))}
                          placeholder={notif.telegram_bot_token_set ? '(unchanged)' : '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11'} />
                      </label>
                      <label>
                        <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>Chat ID <a href="https://t.me/getmyid_bot" target="_blank" rel="noopener" style={{ color: 'var(--accent)', marginLeft: 6 }}>find via @getmyid_bot ↗</a></div>
                        <input className="input" value={notifForm.telegram_chat_id}
                          onChange={e => setNotifForm(f => ({ ...f, telegram_chat_id: e.target.value }))}
                          placeholder="e.g. 140299" />
                      </label>
                      <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
                        {/* T-189 + T-192-A: Save is conditional on THIS section's own dirty flag.
                            T-189 hint text dropped -- the appearing/disappearing button now
                            carries the same signal without adding noise to a clean state. */}
                        {telegramDirty && (
                          <button className="btn btn--sm btn--primary" data-testid="notif-save-telegram"
                            disabled={savingNotif} onClick={saveNotif}>
                            {savingNotif ? '⋯ saving' : 'Save'}
                          </button>
                        )}
                        <button className="btn btn--sm" disabled={!!testingChannel || !notif.telegram_bot_token_set} onClick={() => testChannel('telegram')}>
                          {testingChannel === 'telegram' ? '⋯ sending' : 'Send test message'}
                        </button>
                      </div>
                      {!notif.telegram_bot_token_set && !telegramDirty && (
                        <div className="muted" style={{ fontSize: 11, fontStyle: 'italic', marginTop: 4 }}>
                          ⓘ No token saved yet. Paste your bot token and chat ID -- a Save button will appear.
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {/* Webhook */}
                <div style={{ padding: 14, border: '1px solid var(--border)', borderRadius: 6, background: notifForm.webhook_enabled ? 'transparent' : 'color-mix(in oklab, var(--bg-soft) 50%, transparent)' }}>
                  <div className="between" style={{ marginBottom: notifForm.webhook_enabled ? 10 : 0 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>🌐 Webhook</div>
                      <div className="muted" style={{ fontSize: 11 }}>POST a signed payload on every alert.</div>
                    </div>
                    <Toggle on={notifForm.webhook_enabled} onClick={() => setNotifForm(f => ({ ...f, webhook_enabled: !f.webhook_enabled }))} />
                  </div>
                  {notifForm.webhook_enabled && (
                    <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
                      <label>
                        <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>URL</div>
                        <input className="input" type="url" value={notifForm.webhook_url}
                          onChange={e => setNotifForm(f => ({ ...f, webhook_url: e.target.value }))}
                          placeholder="https://example.com/hooks/ats" />
                      </label>
                      <label>
                        <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>HMAC signing secret (optional)</div>
                        <input className="input" type="password" autoComplete="off" value={notifForm.webhook_secret}
                          onChange={e => setNotifForm(f => ({ ...f, webhook_secret: e.target.value }))}
                          placeholder={notif.webhook_secret_set ? '(unchanged)' : 'Signs the body with HMAC-SHA256 in X-ATS-Signature'} />
                      </label>
                      <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
                        {/* T-189 + T-192-A: Save conditional on THIS section's dirty flag. */}
                        {webhookDirty && (
                          <button className="btn btn--sm btn--primary" data-testid="notif-save-webhook"
                            disabled={savingNotif} onClick={saveNotif}>
                            {savingNotif ? '⋯ saving' : 'Save'}
                          </button>
                        )}
                        <button className="btn btn--sm" disabled={!!testingChannel || !notifForm.webhook_url} onClick={() => testChannel('webhook')}>
                          {testingChannel === 'webhook' ? '⋯ POSTing' : 'Send test POST'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </Section>

          {/* T87 Option C: AI providers inline card — quick view + link to dedicated #ai-keys */}
          <Section ref={refs.aiProviders} id="ai-providers" icon="🤖" title="AI providers (BYOK)"
            sub="Bring your own keys for Claude, OpenAI, and Gemini. Sealed with libsodium.">
            <AiProvidersInline />
          </Section>

          {/* Connected apps — moved UP from below danger zone */}
          <Section ref={refs.connected} id="connected" icon="🔗" title="Connected apps"
            sub="Other settings live on their canonical pages — no duplication.">
            <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
              <a className="btn" href="#brokers"   style={{ flex: 1, minWidth: 180, justifyContent: 'space-between' }}>Broker API keys <span>→</span></a>
              <a className="btn" href="#modes"     style={{ flex: 1, minWidth: 180, justifyContent: 'space-between' }}>Trading modes <span>→</span></a>
              <a className="btn" href="#compliance" style={{ flex: 1, minWidth: 180, justifyContent: 'space-between' }}>Compliance &amp; audit <span>→</span></a>
            </div>
          </Section>

          {/* Danger zone */}
          <Section ref={refs.danger} id="danger" icon="⚠" title="Danger zone" sub="Irreversible actions." danger>
            <div className="between" style={{ marginBottom: 14 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>Export my data</div>
                <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>JSON of your account, brokers (no secrets), watchlist, paper orders, P&amp;L history, preferences.</div>
              </div>
              <button className="btn btn--sm" onClick={exportData}>Download JSON</button>
            </div>
            <div style={{ borderTop: '1px dashed color-mix(in oklab, var(--danger) 30%, var(--border))', marginBottom: 14 }} />
            <div className="between">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--danger)' }}>Delete account</div>
                <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>Permanently delete this account, all sealed broker credentials, watchlist, P&amp;L history, and preferences. Cannot be undone.</div>
              </div>
              <button className="btn btn--sm" style={{ color: 'var(--danger)', borderColor: 'color-mix(in oklab, var(--danger) 40%, var(--border))' }} onClick={() => setDeleteOpen(true)}>Delete account</button>
            </div>
          </Section>
        </main>
      </div>

      {/* ===== STICKY SAVE BAR ===== */}
      {anyDirty && (
        <div style={{
          position: 'sticky', bottom: 0, left: 0, right: 0, zIndex: 60,
          margin: '16px -16px -16px', padding: '12px 24px',
          background: 'var(--surface)', borderTop: '1px solid var(--border)',
          boxShadow: '0 -4px 12px rgba(0,0,0,0.05)',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{ fontSize: 13, color: 'var(--warn, #d97706)', fontWeight: 500 }}>
            ⚠ Unsaved changes
            <span className="muted" style={{ marginLeft: 8, fontWeight: 400 }}>
              {[accountDirty && 'Account', prefsDirty && 'Display', notifDirty && 'Notifications'].filter(Boolean).join(' · ')}
            </span>
          </div>
          <div style={{ flex: 1 }} />
          <button className="btn btn--sm" onClick={discardAll}>Discard</button>
          <button className="btn btn--sm btn--primary" onClick={saveAll}>Save changes</button>
        </div>
      )}

      {deleteOpen && (
        <DeleteAccountModal onCancel={() => setDeleteOpen(false)} onConfirm={confirmDelete} email={account?.email} />
      )}
    </>
  );
};

const DeleteAccountModal = ({ onCancel, onConfirm, email }) => {
  const [typed, setTyped] = React.useState('');
  const valid = typed === 'DELETE';
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'grid', placeItems: 'center', zIndex: 1000 }}>
      <Card style={{ width: 'min(480px, 92vw)' }}>
        <div className="between" style={{ marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Delete account?</h3>
          <button className="btn btn--sm btn--ghost" onClick={onCancel}>×</button>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '0 0 12px' }}>
          This permanently deletes <strong>{email || 'your account'}</strong> and all associated data:
        </p>
        <ul style={{ fontSize: 12, color: 'var(--text-2)', margin: '0 0 16px', paddingLeft: 18 }}>
          <li>Sealed broker credentials (Zerodha API keys, TOTP seed, password)</li>
          <li>Watchlist, alerts, paper trading state</li>
          <li>Daily P&L history, cron run history</li>
          <li>Notification settings (Telegram, Email, Webhook tokens)</li>
        </ul>
        <p style={{ fontSize: 12, color: 'var(--danger)', margin: '0 0 12px' }}>
          This cannot be undone. Live broker connections at Zerodha are NOT affected — only our copies are deleted.
        </p>
        <label style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
          Type <code style={{ background: 'var(--bg-soft)', padding: '2px 6px', borderRadius: 4 }}>DELETE</code> to confirm:
        </label>
        <input className="input" value={typed} onChange={e => setTyped(e.target.value)} autoFocus placeholder="DELETE" style={{ marginBottom: 16 }} />
        <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn--sm" onClick={onCancel}>Cancel</button>
          <button className="btn btn--sm" disabled={!valid} onClick={() => valid && onConfirm()}
            style={{ background: valid ? 'var(--danger)' : 'var(--bg-soft)', color: valid ? 'white' : 'var(--text-3)', opacity: valid ? 1 : 0.5 }}>
            Delete account
          </button>
        </div>
      </Card>
    </div>
  );
};

// Mobile responsive: collapse side-nav to top on narrow viewports
const _settingsCSS = document.createElement('style');
_settingsCSS.textContent = `
  @media (max-width: 768px) {
    .settings-grid { grid-template-columns: 1fr !important; gap: 12px !important; }
    .settings-grid > aside { position: static !important; flex-direction: row !important; overflow-x: auto; padding-bottom: 8px; }
    .settings-grid > aside > button { flex: 0 0 auto; min-width: 100px; }
  }
`;
if (!document.getElementById('ats-settings-css')) { _settingsCSS.id = 'ats-settings-css'; document.head.appendChild(_settingsCSS); }

// T87 Option C: AI providers inline card — compact summary + CTA to dedicated page
const AiProvidersInline = () => {
  const [keys, setKeys] = React.useState(null);
  const [meta, setMeta] = React.useState({ supportedProviders: ['anthropic', 'openai', 'gemini'] });
  React.useEffect(() => {
    fetch('/api/me/ai-keys', { credentials: 'include' })
      .then(r => r.json()).then(j => {
        if (j.ok) { setKeys(j.keys || []); if (j.supportedProviders) setMeta(m => ({ ...m, supportedProviders: j.supportedProviders, defaultModels: j.defaultModels })); }
      }).catch(() => setKeys([]));
  }, []);
  const PROV = { anthropic: { label: 'Claude', logo: 'C', color: '#d97757' },
                 openai:    { label: 'OpenAI', logo: 'O', color: '#10a37f' },
                 gemini:    { label: 'Gemini', logo: 'G', color: '#4285f4' } };
  const findKey = (p) => (keys || []).find(k => k.provider === p);
  const configured = (keys || []).length;
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 14 }}>
        {meta.supportedProviders.map(p => {
          const pm = PROV[p] || { label: p, logo: p[0]?.toUpperCase(), color: '#888' };
          const k = findKey(p);
          return (
            <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 10, border: '1px solid var(--border)', borderRadius: 6, background: k ? 'color-mix(in oklab, var(--up) 6%, transparent)' : 'transparent' }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: pm.color, color: 'white', display: 'grid', placeItems: 'center', fontWeight: 700, flexShrink: 0 }}>{pm.logo}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{pm.label}</div>
                <div className="muted" style={{ fontSize: 11 }}>{k ? `✓ ${k.model_pref || 'default model'}` : 'Not set'}</div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="between" style={{ paddingTop: 12, borderTop: '1px dashed var(--border)' }}>
        <div className="muted" style={{ fontSize: 12 }}>
          {keys === null ? 'Loading…' : `${configured} of ${meta.supportedProviders.length} providers configured`}
        </div>
        <a className="btn btn--sm btn--primary" href="#ai-keys">Manage AI keys →</a>
      </div>
    </>
  );
};
Object.assign(window, { AiProvidersInline });

Object.assign(window, { SettingsScreen, DeleteAccountModal, TimePicker});
