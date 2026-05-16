/* eslint-disable */
/* Tier 84: lean Settings page.
   Stripped from 5 tabs of mostly-mock data to a single page with 3 sections
   + Danger zone. Duplicates of Brokers / AI Advisor / Trading modes are gone --
   each redirects via a small CTA card to the canonical page. */

const SettingsScreen = () => {
  const [account, setAccount] = React.useState(null);
  const [accountForm, setAccountForm] = React.useState({ name: '', email: '' });
  const [accountSaving, setAccountSaving] = React.useState(false);
  const [prefs, setPrefs] = React.useState(null);
  const [prefsSaving, setPrefsSaving] = React.useState(false);
  const [notif, setNotif] = React.useState(null);
  const [notifForm, setNotifForm] = React.useState({
    email_enabled: true, email_digest_time: '16:00',
    telegram_enabled: false, telegram_chat_id: '', telegram_bot_token: '',
    webhook_enabled: false, webhook_url: '', webhook_secret: '',
  });
  const [notifSaving, setNotifSaving] = React.useState(false);
  const [toast, setToast] = React.useState(null);
  const [deleteOpen, setDeleteOpen] = React.useState(false);

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
        if (p.ok) setPrefs(p.preferences);
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

  const flash = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };

  const saveAccount = async () => {
    setAccountSaving(true);
    try {
      const res = await fetch('/api/v1/me/account', {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: accountForm.name, email: accountForm.email })
      });
      const j = await res.json();
      if (res.ok && j.ok) {
        flash('Account updated' + (accountForm.email !== account?.email ? ' — re-verify your new email' : ''));
        const refreshed = await fetch('/api/v1/me/account', { credentials: 'include' }).then(r => r.json());
        if (refreshed.ok) setAccount(refreshed.account);
      } else flash(j.detail || j.reason || 'save failed', false);
    } catch (e) { flash(e.message, false); }
    finally { setAccountSaving(false); }
  };

  const updatePref = async (patch) => {
    if (!prefs) return;
    const updated = { ...prefs, ...patch };
    setPrefs(updated);
    setPrefsSaving(true);
    try {
      const res = await fetch('/api/v1/me/preferences', {
        method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      });
      const j = await res.json();
      if (res.ok && j.ok) {
        if (patch.theme) document.documentElement.setAttribute('data-theme', patch.theme === 'auto' ? '' : patch.theme);
        if (patch.density) document.documentElement.setAttribute('data-density', patch.density);
        flash('Preferences saved');
      } else flash(j.detail || 'save failed', false);
    } catch (e) { flash(e.message, false); }
    finally { setPrefsSaving(false); }
  };

  const saveNotif = async () => {
    setNotifSaving(true);
    try {
      const payload = { ...notifForm };
      if (payload.telegram_bot_token === '(unchanged)') delete payload.telegram_bot_token;
      if (payload.webhook_secret === '(unchanged)') delete payload.webhook_secret;
      const res = await fetch('/api/v1/me/notifications', {
        method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const j = await res.json();
      if (res.ok && j.ok) flash('Notifications saved');
      else flash(j.detail || 'save failed', false);
    } catch (e) { flash(e.message, false); }
    finally { setNotifSaving(false); }
  };

  const exportData = () => { window.open('/api/v1/me/export', '_blank'); };

  const confirmDelete = async () => {
    const res = await fetch('/api/v1/me/account', {
      method: 'DELETE', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: 'DELETE' })
    });
    if (res.ok) { window.dispatchEvent(new CustomEvent('logout')); window.location.hash = 'login'; }
  };

  return (
    <>
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

      <Card title="Account" sub="Your identity. Email change requires re-verification." style={{ marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 12 }}>
          <label>
            <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>Name</div>
            <input className="input" value={accountForm.name} onChange={e => setAccountForm(f => ({ ...f, name: e.target.value }))} />
          </label>
          <label>
            <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>Email{account && !account.is_verified && <span style={{ color: 'var(--warn, #d97706)', marginLeft: 6 }}>· unverified</span>}</div>
            <input className="input" type="email" value={accountForm.email} onChange={e => setAccountForm(f => ({ ...f, email: e.target.value }))} />
          </label>
        </div>
        <div className="between">
          <div className="muted" style={{ fontSize: 11 }}>Timezone: Asia/Kolkata (IST) · auto-detected</div>
          <button className="btn btn--sm btn--primary" disabled={accountSaving || !account} onClick={saveAccount}>{accountSaving ? 'Saving…' : 'Save account'}</button>
        </div>
      </Card>

      <Card title="Display" sub="Theme, density, currency format." style={{ marginBottom: 16 }}>
        {!prefs ? <div className="muted" style={{ fontSize: 12 }}>Loading…</div> : (
          <div style={{ display: 'grid', gap: 12 }}>
            <div className="between">
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>Theme</div>
                <div className="muted" style={{ fontSize: 11 }}>Light, dark, or follow system.</div>
              </div>
              <Segmented value={prefs.theme} onChange={v => updatePref({ theme: v })}
                options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'auto', label: 'System' }]} />
            </div>
            <div className="between">
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>Density</div>
                <div className="muted" style={{ fontSize: 11 }}>Comfortable spacing or compact rows.</div>
              </div>
              <Segmented value={prefs.density} onChange={v => updatePref({ density: v })}
                options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]} />
            </div>
            <div className="between">
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>Currency format</div>
                <div className="muted" style={{ fontSize: 11 }}>Abbreviate large numbers vs. full digits.</div>
              </div>
              <Segmented value={prefs.currency_format} onChange={v => updatePref({ currency_format: v })}
                options={[{ value: 'abbrev', label: '₹4.8L' }, { value: 'full', label: '₹4,82,340' }]} />
            </div>
            <div className="between">
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>Round to whole rupees</div>
                <div className="muted" style={{ fontSize: 11 }}>Drop the paise on all displays.</div>
              </div>
              <Toggle on={!!prefs.round_rupees} onClick={() => updatePref({ round_rupees: !prefs.round_rupees })} />
            </div>
            <div className="between">
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>Show P&L in header</div>
                <div className="muted" style={{ fontSize: 11 }}>Floating widget on the top bar with today's P&L.</div>
              </div>
              <Toggle on={!!prefs.show_pnl_in_header} onClick={() => updatePref({ show_pnl_in_header: !prefs.show_pnl_in_header })} />
            </div>
          </div>
        )}
      </Card>

      <Card title="Notifications" sub="Where critical alerts land. Tokens are libsodium-sealed; never echoed back." style={{ marginBottom: 16 }}>
        {!notif ? <div className="muted" style={{ fontSize: 12 }}>Loading…</div> : (
          <div style={{ display: 'grid', gap: 14 }}>
            <div style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 6 }}>
              <div className="between" style={{ marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>Email digest</div>
                  <div className="muted" style={{ fontSize: 11 }}>Daily summary of orders, P&L, and signals.</div>
                </div>
                <Toggle on={notifForm.email_enabled} onClick={() => setNotifForm(f => ({ ...f, email_enabled: !f.email_enabled }))} />
              </div>
              {notifForm.email_enabled && (
                <label style={{ display: 'block', marginTop: 8 }}>
                  <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>Send time (IST)</div>
                  <input className="input" type="time" value={notifForm.email_digest_time}
                    onChange={e => setNotifForm(f => ({ ...f, email_digest_time: e.target.value }))} style={{ maxWidth: 160 }} />
                </label>
              )}
            </div>

            <div style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 6 }}>
              <div className="between" style={{ marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>Telegram</div>
                  <div className="muted" style={{ fontSize: 11 }}>Real-time alerts. Create your own bot via @BotFather, paste the token + chat ID below.</div>
                </div>
                <Toggle on={notifForm.telegram_enabled} onClick={() => setNotifForm(f => ({ ...f, telegram_enabled: !f.telegram_enabled }))} />
              </div>
              {notifForm.telegram_enabled && (
                <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                  <label>
                    <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>Bot token</div>
                    <input className="input" type="password" autoComplete="off" value={notifForm.telegram_bot_token}
                      onChange={e => setNotifForm(f => ({ ...f, telegram_bot_token: e.target.value }))}
                      placeholder={notif.telegram_bot_token_set ? '(unchanged)' : 'Paste from @BotFather'} />
                  </label>
                  <label>
                    <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>Chat ID</div>
                    <input className="input" value={notifForm.telegram_chat_id}
                      onChange={e => setNotifForm(f => ({ ...f, telegram_chat_id: e.target.value }))}
                      placeholder="e.g. 140299" />
                  </label>
                </div>
              )}
            </div>

            <div style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 6 }}>
              <div className="between" style={{ marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>Webhook</div>
                  <div className="muted" style={{ fontSize: 11 }}>POST a signed payload on every alert. Optional HMAC secret signs the body.</div>
                </div>
                <Toggle on={notifForm.webhook_enabled} onClick={() => setNotifForm(f => ({ ...f, webhook_enabled: !f.webhook_enabled }))} />
              </div>
              {notifForm.webhook_enabled && (
                <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                  <label>
                    <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>URL</div>
                    <input className="input" type="url" value={notifForm.webhook_url}
                      onChange={e => setNotifForm(f => ({ ...f, webhook_url: e.target.value }))}
                      placeholder="https://example.com/hooks/ats" />
                  </label>
                  <label>
                    <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>Signing secret (optional)</div>
                    <input className="input" type="password" autoComplete="off" value={notifForm.webhook_secret}
                      onChange={e => setNotifForm(f => ({ ...f, webhook_secret: e.target.value }))}
                      placeholder={notif.webhook_secret_set ? '(unchanged)' : 'For HMAC-SHA256 X-ATS-Signature header'} />
                  </label>
                </div>
              )}
            </div>

            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn--sm btn--primary" disabled={notifSaving} onClick={saveNotif}>{notifSaving ? 'Saving…' : 'Save notifications'}</button>
            </div>
          </div>
        )}
      </Card>

      <Card title="Other settings" sub="Moved to their canonical pages — no duplication." style={{ marginBottom: 16 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <a className="btn btn--sm" href="#brokers">Broker API keys →</a>
          <a className="btn btn--sm" href="#insights">AI advisor (BYOK) →</a>
          <a className="btn btn--sm" href="#modes">Trading modes →</a>
          <a className="btn btn--sm" href="#compliance">Compliance &amp; audit →</a>
        </div>
      </Card>

      <Card title="Danger zone" sub="Irreversible actions." style={{ marginBottom: 16, borderColor: 'color-mix(in oklab, var(--danger) 30%, var(--border))' }}>
        <div className="between" style={{ marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500 }}>Export my data</div>
            <div className="muted" style={{ fontSize: 11 }}>Download a JSON of all your data: account, brokers (no secrets), watchlist, paper orders, P&L history, preferences.</div>
          </div>
          <button className="btn btn--sm" onClick={exportData}>Download JSON</button>
        </div>
        <div className="divider" />
        <div className="between" style={{ marginTop: 12 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--danger)' }}>Delete account</div>
            <div className="muted" style={{ fontSize: 11 }}>Permanently delete this account, all brokers (sealed credentials), watchlist, P&L, and preferences. Cannot be undone.</div>
          </div>
          <button className="btn btn--sm" style={{ color: 'var(--danger)' }} onClick={() => setDeleteOpen(true)}>Delete account</button>
        </div>
      </Card>

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

Object.assign(window, { SettingsScreen, DeleteAccountModal });
