/* eslint-disable */
/* Tier 86: Dedicated AI providers (BYOK) page.
   Mirrors the Brokers page pattern -- config has its own home, analysis lives on Insights.
   Per-user sealed keys for Claude / OpenAI / Gemini with Save / Test / Remove. */

const _PROVIDER_META = {
  anthropic: {
    label: 'Anthropic Claude',
    logo: 'C', logoColor: '#d97757',
    keyPrefix: 'sk-ant-',
    consoleUrl: 'https://console.anthropic.com/settings/keys',
    consoleLabel: 'console.anthropic.com',
    defaultModel: 'claude-sonnet-4-5',
    modelOptions: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5'],
    desc: 'Best for complex reasoning + intraday critic + strategy explain.',
  },
  openai: {
    label: 'OpenAI GPT',
    logo: 'O', logoColor: '#10a37f',
    keyPrefix: 'sk-',
    consoleUrl: 'https://platform.openai.com/api-keys',
    consoleLabel: 'platform.openai.com',
    defaultModel: 'gpt-4o-mini',
    modelOptions: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1', 'gpt-5'],
    desc: 'Good for macro/news scan + general analysis.',
  },
  gemini: {
    label: 'Google Gemini',
    logo: 'G', logoColor: '#4285f4',
    keyPrefix: 'AIza',
    consoleUrl: 'https://aistudio.google.com/apikey',
    consoleLabel: 'aistudio.google.com',
    defaultModel: 'gemini-2.0-flash',
    modelOptions: ['gemini-2.0-flash', 'gemini-2.5-pro', 'gemini-2.5-flash'],
    desc: 'Fast + cheap for consensus checks + vision (chart screenshots).',
  },
};

const AiKeysScreen = () => {
  const [keys, setKeys] = React.useState(null);            // server state
  const [supportedProviders, setSupported] = React.useState(['anthropic', 'openai', 'gemini']);
  const [usage, setUsage] = React.useState({});
  const [drafts, setDrafts] = React.useState({});          // {anthropic: {key:'', model:''}, ...}
  const [busy, setBusy] = React.useState({});              // {anthropic: 'save'|'test'|'remove'|null}
  const [results, setResults] = React.useState({});        // {anthropic: {ok, msg}, ...}
  const [toast, setToast] = React.useState(null);

  const refresh = React.useCallback(async () => {
    try {
      const [k, u] = await Promise.all([
        fetch('/api/me/ai-keys', { credentials: 'include' }).then(r => r.json()),
        fetch('/api/me/ai-keys/usage', { credentials: 'include' }).then(r => r.json()).catch(() => ({ ok: false })),
      ]);
      if (k.ok) {
        setKeys(k.keys || []);
        if (k.supportedProviders) setSupported(k.supportedProviders);
      }
      if (u.ok) setUsage(u.usage || {});
    } catch (e) { console.warn('[ai-keys] refresh failed:', e.message); }
  }, []);
  React.useEffect(() => { refresh(); }, [refresh]);

  const flash = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };

  const findKey = (provider) => (keys || []).find(k => k.provider === provider);
  const setDraft = (provider, patch) => setDrafts(d => ({ ...d, [provider]: { ...d[provider], ...patch } }));
  const setBusyFor = (provider, op) => setBusy(b => ({ ...b, [provider]: op }));

  const saveKey = async (provider) => {
    const d = drafts[provider] || {};
    const apiKey = d.key;
    const model = d.model || _PROVIDER_META[provider]?.defaultModel;
    if (!apiKey || apiKey.trim().length < 8) { flash('Enter the API key first', false); return; }
    setBusyFor(provider, 'save');
    try {
      const res = await fetch('/api/me/ai-keys', {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, apiKey, model_pref: model })
      });
      const j = await res.json();
      if (res.ok && j.ok) {
        flash(`${_PROVIDER_META[provider].label} key saved`);
        setDraft(provider, { key: '' });
        await refresh();
      } else flash(j.detail || j.reason || 'save failed', false);
    } catch (e) { flash(e.message, false); }
    finally { setBusyFor(provider, null); }
  };

  const testKey = async (provider, useDraftKey = false) => {
    setBusyFor(provider, 'test');
    setResults(r => ({ ...r, [provider]: null }));
    try {
      const body = { provider };
      if (useDraftKey && drafts[provider]?.key) body.apiKey = drafts[provider].key;
      if (drafts[provider]?.model) body.model = drafts[provider].model;
      const res = await fetch('/api/me/ai-keys/test', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      const j = await res.json();
      const ok = res.ok && j.ok;
      setResults(r => ({ ...r, [provider]: { ok, msg: ok ? `✓ Works · ${j.elapsed_ms}ms` : (j.detail || j.reason || 'test failed') } }));
    } catch (e) {
      setResults(r => ({ ...r, [provider]: { ok: false, msg: e.message } }));
    }
    finally { setBusyFor(provider, null); }
  };

  const removeKey = async (provider) => {
    if (!confirm(`Remove your ${_PROVIDER_META[provider].label} API key? Analysis using this provider will stop until you re-add it.`)) return;
    setBusyFor(provider, 'remove');
    try {
      const res = await fetch(`/api/me/ai-keys/${provider}`, { method: 'DELETE', credentials: 'include' });
      if (res.ok) { flash(`${_PROVIDER_META[provider].label} removed`); await refresh(); }
      else flash('remove failed', false);
    } catch (e) { flash(e.message, false); }
    finally { setBusyFor(provider, null); }
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-header__title">AI providers</h1>
          <div className="page-header__sub">Bring your own API keys for Claude, OpenAI, and Gemini. Sealed with libsodium.</div>
        </div>
      </div>

      {toast && (
        <div style={{
          padding: 10, marginBottom: 12, borderRadius: 6, fontSize: 12,
          background: toast.ok ? 'color-mix(in oklab, var(--up) 12%, transparent)' : 'color-mix(in oklab, var(--danger) 12%, transparent)',
          color: toast.ok ? 'var(--up)' : 'var(--danger)', border: '1px solid currentColor',
        }}>{toast.ok ? '✓' : '✕'} {toast.msg}</div>
      )}

      <div className="grid grid-3" style={{ gap: 16, marginBottom: 16 }}>
        {supportedProviders.map(provider => {
          const meta = _PROVIDER_META[provider] || { label: provider, logo: provider[0]?.toUpperCase(), logoColor: '#888', modelOptions: [], defaultModel: '' };
          const existing = findKey(provider);
          const isConfigured = !!existing;
          const draft = drafts[provider] || {};
          const op = busy[provider];
          const testResult = results[provider];
          const usageProv = usage[provider] || { calls_30d: 0, est_cost_inr: 0 };
          return (
            <Card key={provider} style={{ border: isConfigured ? '1px solid color-mix(in oklab, var(--up) 30%, var(--border))' : '1px solid var(--border)' }}>
              <div className="between" style={{ marginBottom: 12, alignItems: 'flex-start' }}>
                <div className="row" style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 10, background: meta.logoColor, color: 'white', display: 'grid', placeItems: 'center', fontWeight: 700, flexShrink: 0 }}>{meta.logo}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>{meta.label}</div>
                    <div className="muted" style={{ fontSize: 11 }}>{meta.desc}</div>
                  </div>
                </div>
                {isConfigured ? <Pill kind="up" dot>Active</Pill> : <Pill kind="neutral">Not set</Pill>}
              </div>

              <label style={{ display: 'block', marginBottom: 10 }}>
                <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>Model</div>
                <select className="input" value={draft.model || existing?.model_pref || meta.defaultModel}
                  onChange={e => setDraft(provider, { model: e.target.value })}>
                  {meta.modelOptions.map(m => <option key={m} value={m}>{m}{m === meta.defaultModel ? ' · default' : ''}</option>)}
                </select>
              </label>

              <label style={{ display: 'block', marginBottom: 10 }}>
                <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>
                  API key{isConfigured && <span style={{ marginLeft: 6, color: 'var(--up)' }}>· saved {_relTime(existing.created_at)}</span>}
                </div>
                <input className="input" type="password" autoComplete="off" value={draft.key || ''}
                  onChange={e => setDraft(provider, { key: e.target.value })}
                  placeholder={isConfigured ? `(saved · paste new key to replace)` : `${meta.keyPrefix}...`} />
              </label>

              {testResult && (
                <div style={{ fontSize: 11, padding: '6px 10px', borderRadius: 6, marginBottom: 10,
                  background: testResult.ok ? 'color-mix(in oklab, var(--up) 12%, transparent)' : 'color-mix(in oklab, var(--danger) 12%, transparent)',
                  color: testResult.ok ? 'var(--up)' : 'var(--danger)',
                }}>{testResult.msg}</div>
              )}

              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <button className="btn btn--sm btn--primary" disabled={!!op || !draft.key} onClick={() => saveKey(provider)}>
                  {op === 'save' ? '⋯ saving' : isConfigured ? 'Update key' : 'Save key'}
                </button>
                <button className="btn btn--sm" disabled={!!op || (!draft.key && !isConfigured)} onClick={() => testKey(provider, !!draft.key)}>
                  {op === 'test' ? '⋯ testing' : 'Test'}
                </button>
                {isConfigured && (
                  <button className="btn btn--sm" disabled={!!op} onClick={() => removeKey(provider)} style={{ color: 'var(--danger)', marginLeft: 'auto' }}>
                    {op === 'remove' ? '⋯ removing' : 'Remove'}
                  </button>
                )}
              </div>

              <div className="muted" style={{ fontSize: 11, marginTop: 12, paddingTop: 10, borderTop: '1px dashed var(--border)' }}>
                Get a key at <a href={meta.consoleUrl} target="_blank" rel="noopener" style={{ color: 'var(--accent)' }}>{meta.consoleLabel} ↗</a>
                {usageProv.calls_30d > 0 && (
                  <span style={{ marginLeft: 8 }}>· {usageProv.calls_30d} calls / 30d{usageProv.est_cost_inr ? ` · est ₹${usageProv.est_cost_inr.toFixed(2)}` : ''}</span>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <Card title="Where these get used" sub="The advisor and per-trade analysis on Insights consumes these keys." style={{ marginBottom: 16 }}>
        <div className="muted" style={{ fontSize: 13, lineHeight: 1.7 }}>
          <div>• <strong>Intraday critic</strong> — second-opinion on signals before promotion to live (uses Claude by default)</div>
          <div>• <strong>Strategy explain</strong> — natural-language summary of why a strategy fired (uses Claude)</div>
          <div>• <strong>Macro / news scan</strong> — daily roll-up of news affecting your watchlist (uses GPT-4o-mini)</div>
          <div>• <strong>Consensus check</strong> — runs the same prompt across all 3 providers when you have all configured</div>
          <div>• <strong>Vision (chart screenshots)</strong> — Gemini Flash for cheap multimodal analysis</div>
        </div>
        <div className="row" style={{ gap: 8, marginTop: 14 }}>
          <a className="btn btn--sm" href="#insights">Open AI Insights →</a>
          <a className="btn btn--sm" href="#review">Monthly AI review →</a>
        </div>
      </Card>

      <Card title="Privacy &amp; safety" flush>
        <div style={{ padding: 16, fontSize: 12, color: 'var(--text-2)', lineHeight: 1.7 }}>
          <div>🔒 API keys are <strong>libsodium-sealed</strong> with a master key that never leaves the VM. They are not logged in plaintext anywhere — not in app logs, not in audit, not in backups.</div>
          <div style={{ marginTop: 8 }}>💰 You pay providers directly. ATS never sees the dollar amount on your provider bill. Keep your provider-side spend limits low while testing.</div>
          <div style={{ marginTop: 8 }}>🚫 Trading decisions are NEVER auto-executed from AI output. AI advice is advisory only — it surfaces analysis, you press the button.</div>
          <div style={{ marginTop: 8 }}>🌍 Provider API calls leave your VM. Anthropic / OpenAI / Google see the prompt content (your portfolio summary, never your broker credentials).</div>
        </div>
      </Card>
    </>
  );
};

const _relTime = (s) => {
  if (!s) return '';
  const dt = (Date.now() - new Date(s).getTime()) / 1000;
  if (dt < 60) return 'just now';
  if (dt < 3600) return Math.round(dt/60) + 'm ago';
  if (dt < 86400) return Math.round(dt/3600) + 'h ago';
  return Math.round(dt/86400) + 'd ago';
};

Object.assign(window, { AiKeysScreen });
try { window.dispatchEvent(new Event('screens-changed')); } catch (_) {}
