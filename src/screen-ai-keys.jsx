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
    defaultModel: 'claude-sonnet-4-6',
    modelOptions: ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5'],
    desc: 'Best for complex reasoning + intraday critic + strategy explain.',
  },
  openai: {
    label: 'OpenAI GPT',
    logo: 'O', logoColor: '#10a37f',
    keyPrefix: 'sk-',
    consoleUrl: 'https://platform.openai.com/api-keys',
    consoleLabel: 'platform.openai.com',
    defaultModel: 'gpt-5.5',
    modelOptions: ['gpt-5.5', 'gpt-5.4', 'o4-mini', 'o3-mini'],
    desc: 'Good for macro/news scan + general analysis.',
  },
  gemini: {
    label: 'Google Gemini',
    logo: 'G', logoColor: '#4285f4',
    keyPrefix: 'AIza',
    consoleUrl: 'https://aistudio.google.com/apikey',
    consoleLabel: 'aistudio.google.com',
    defaultModel: 'gemini-3.1-pro-preview',
    modelOptions: ['gemini-3.1-pro-preview', 'gemini-3-pro-preview', 'gemini-3.1-flash-lite'],
    desc: 'Fast + cheap for consensus checks + vision (chart screenshots).',
  },
};

const AiKeysScreen = () => {
  const [keys, setKeys] = React.useState(null);            // server state
  const [supportedProviders, setSupported] = React.useState(['anthropic', 'openai', 'gemini']);
  const [usage, setUsage] = React.useState({});
  const [usageMeta, setUsageMeta] = React.useState({ cap_inr: 50, spent_today_inr: 0, cap_remaining_inr: 50, cap_used_pct: 0, byPeriod: {}, byWorkflow: [] });
  const [capDraft, setCapDraft] = React.useState('');     // T99-C1 spend-cap editor
  const [aiMode, setAiMode] = React.useState('balanced'); // T99-H9 quality | balanced | economy
  const [routerPreview, setRouterPreview] = React.useState({ workflows: [], availableProviders: [], mode: 'balanced' });
  const [reviewBusy, setReviewBusy] = React.useState(false);
  const [reviewResult, setReviewResult] = React.useState(null);
  const [drafts, setDrafts] = React.useState({});          // {anthropic: {key:'', model:''}, ...}
  const [busy, setBusy] = React.useState({});              // {anthropic: 'save'|'test'|'remove'|null}
  const [results, setResults] = React.useState({});        // {anthropic: {ok, msg}, ...}
  const [dynamicModels, setDynamicModels] = React.useState({});  // T97: { anthropic: [id,...], openai: [...], gemini: [...] }
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
        // T97: fetch each provider's actual list-models (the real models the saved key can access)
        for (const krow of (k.keys || [])) {
          fetch(`/api/me/ai-keys/models/${krow.provider}`, { credentials: 'include' })
            .then(r => r.json())
            .then(mj => {
              if (mj.ok && Array.isArray(mj.models) && mj.models.length) {
                setDynamicModels(d => ({ ...d, [krow.provider]: mj.models.map(m => m.id) }));
              }
            })
            .catch(() => { /* fall back to hardcoded list */ });
        }
      }
      if (u.ok) {
        setUsage(u.usage || {});
        setUsageMeta({
          cap_inr: u.cap_inr != null ? u.cap_inr : 50,
          spent_today_inr: u.spent_today_inr || 0,
          cap_remaining_inr: u.cap_remaining_inr != null ? u.cap_remaining_inr : 50,
          cap_used_pct: u.cap_used_pct || 0,
          byPeriod: u.byPeriod || {},
          byWorkflow: u.byWorkflow || [],
        });
        if (!capDraft) setCapDraft(String(u.cap_inr != null ? u.cap_inr : 50));
      }
      // T99-H9: fetch saved AI mode
      try {
        const pr = await fetch('/api/me/preferences', { credentials: 'include' }).then(r => r.json()).catch(() => null);
        if (pr && pr.ok && pr.preferences) {
          setAiMode(pr.preferences.ai_mode || 'balanced');
        }
      } catch (_) {}
      // T99-H2: fetch router preview (what model gets picked for each workflow)
      try {
        const rp = await fetch('/api/me/ai-keys/router-preview', { credentials: 'include' }).then(r => r.json()).catch(() => null);
        if (rp && rp.ok) setRouterPreview({ workflows: rp.workflows || [], availableProviders: rp.availableProviders || [], mode: rp.mode || 'balanced' });
      } catch (_) {}
    } catch (e) { console.warn('[ai-keys] refresh failed:', e.message); }
  }, []);
  React.useEffect(() => { refresh(); }, [refresh]);

  const flash = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };

  // T99-H9: save AI mode (quality | balanced | economy)
  const saveMode = async (m) => {
    setAiMode(m);
    try {
      const cur = await fetch('/api/me/preferences', { credentials: 'include' }).then(r => r.json()).catch(() => null);
      const body = { ...(cur && cur.preferences ? cur.preferences : {}), ai_mode: m };
      const r = await fetch('/api/me/preferences', { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
      if (r.ok) { flash(`AI mode: ${m}`); refresh(); }
      else flash(r.reason || 'mode_save_failed', false);
    } catch (e) { flash('mode_save_failed: ' + e.message, false); }
  };

  // T99-A2: run on-demand monthly review now
  const runMonthlyReview = async () => {
    setReviewBusy(true);
    setReviewResult(null);
    try {
      const r = await fetch('/api/me/ai-workflows/monthly-review', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: '{}',
      }).then(r => r.json());
      if (r.ok) { setReviewResult(r); flash(`Monthly review ready (${r.cached ? 'cached' : 'fresh'})`); refresh(); }
      else flash(r.detail || r.reason || 'review_failed', false);
    } catch (e) { flash('review_failed: ' + e.message, false); }
    finally { setReviewBusy(false); }
  };

  // T99-C1: save daily spend cap. PUT /api/me/preferences merges with existing prefs.
  const saveCap = async () => {
    const n = Number(capDraft);
    if (!Number.isFinite(n) || n < 0 || n > 5000) { flash('Cap must be ₹0–5000', false); return; }
    try {
      // Pull current prefs so we don't overwrite other fields with nulls
      const cur = await fetch('/api/me/preferences', { credentials: 'include' }).then(r => r.json()).catch(() => null);
      const body = { ...(cur && cur.preferences ? cur.preferences : {}), daily_ai_cap_inr: n };
      const r = await fetch('/api/me/preferences', {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then(r => r.json());
      if (r.ok) { flash(`Daily AI cap set to ₹${n}`); refresh(); }
      else flash(r.reason || 'cap_save_failed', false);
    } catch (e) { flash('cap_save_failed: ' + e.message, false); }
  };

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

  // T98: auto-save model selection without requiring API key re-entry
  const saveModelOnly = async (provider, model) => {
    setBusyFor(provider, 'save');
    try {
      const res = await fetch('/api/me/ai-keys', {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, model_pref: model }),
      });
      const j = await res.json();
      if (j.ok) { flash(`Model updated -> ${model}`); await refresh(); }
      else flash(j.detail || j.reason || 'save failed', false);
    } catch (e) { flash(e.message, false); }
    finally { setBusyFor(provider, null); }
  };

    const testKey = async (provider, useDraftKey = false) => {
    setBusyFor(provider, 'test');
    setResults(r => ({ ...r, [provider]: null }));
    try {
      const body = { provider };
      if (useDraftKey && drafts[provider]?.key) body.apiKey = drafts[provider].key;
      // T92: always send the currently-displayed model so test matches what user sees
      const existing = keys.find(k => k.provider === provider);
      const currentModel = drafts[provider]?.model || existing?.model_pref || _PROVIDER_META[provider]?.defaultModel;
      if (currentModel) body.model = currentModel;
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

      {/* T99-A3/C1: spend summary + daily cap editor */}
      <div style={{
        padding: 14, marginBottom: 16, borderRadius: 8, border: '1px solid var(--border)',
        background: 'var(--surface-2, rgba(0,0,0,0.02))',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Today's AI spend</div>
            <div style={{ fontSize: 28, fontWeight: 700, fontFamily: 'var(--mono)' }}>
              ₹{Number(usageMeta.spent_today_inr || 0).toFixed(2)}
              <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text-3)', marginLeft: 6 }}>
                / ₹{Number(usageMeta.cap_inr || 0).toFixed(0)} cap
              </span>
            </div>
            <div style={{
              marginTop: 6, height: 6, borderRadius: 4, overflow: 'hidden',
              background: 'color-mix(in oklab, currentColor 10%, transparent)',
            }}>
              <div style={{
                width: Math.min(100, Math.max(0, Number(usageMeta.cap_used_pct || 0))) + '%',
                height: '100%',
                background: usageMeta.cap_used_pct > 90 ? 'var(--danger)' : usageMeta.cap_used_pct > 70 ? 'var(--warn, #d97706)' : 'var(--up)',
                transition: 'width 200ms ease',
              }}/>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6 }}>
              {usageMeta.cap_used_pct > 90 ? 'Near cap — new AI calls will be blocked.' :
               usageMeta.cap_used_pct > 70 ? 'Approaching cap.' :
               `${(usageMeta.cap_remaining_inr || 0).toFixed(2)} remaining today.`}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 4 }}>
                Daily cap (₹)
              </label>
              <input
                type="number" min="0" max="5000" step="10"
                value={capDraft}
                onChange={e => setCapDraft(e.target.value)}
                style={{
                  padding: '6px 10px', fontSize: 14, fontFamily: 'var(--mono)',
                  border: '1px solid var(--border)', borderRadius: 6, width: 100,
                  background: 'var(--surface, white)', color: 'var(--text)',
                }}
              />
            </div>
            <button
              onClick={saveCap}
              disabled={!capDraft || Number(capDraft) === Number(usageMeta.cap_inr)}
              style={{
                padding: '7px 14px', fontSize: 13, borderRadius: 6,
                border: '1px solid var(--accent, #3b82f6)',
                background: 'var(--accent, #3b82f6)', color: 'white',
                cursor: 'pointer', opacity: (!capDraft || Number(capDraft) === Number(usageMeta.cap_inr)) ? 0.5 : 1,
              }}
            >Save cap</button>
          </div>
        </div>
        <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-3)' }}>
          Hard cap on total ₹ ATS spends on AI per day, across all your providers. Default ₹50. When reached, new AI calls return <code>spend_cap_exceeded</code> until midnight IST or you raise the cap.
        </div>
      </div>

      {/* T99-H9: AI mode segmented control */}
      <div style={{
        padding: 12, marginBottom: 12, borderRadius: 8, border: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>AI mode</div>
          <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>
            {aiMode === 'quality'  && 'Always pick the best model. Highest cost, highest signal quality.'}
            {aiMode === 'balanced' && 'Quality-first defaults. Critique + reviews use Sonnet; explainers use Haiku.'}
            {aiMode === 'economy'  && 'Cheapest viable model per workflow. Fastest, lowest cost, signal quality may dip.'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 0, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
          {['economy', 'balanced', 'quality'].map(m => (
            <button
              key={m}
              onClick={() => saveMode(m)}
              style={{
                padding: '7px 14px', fontSize: 12, fontWeight: 500,
                border: 'none', cursor: 'pointer',
                background: aiMode === m ? 'var(--accent, #3b82f6)' : 'var(--surface, transparent)',
                color: aiMode === m ? 'white' : 'var(--text)',
                textTransform: 'capitalize',
              }}
            >{m}</button>
          ))}
        </div>
      </div>

      {/* T99-H2: router transparency — what ATS would call right now per workflow */}
      {routerPreview.workflows.length > 0 && (
        <details style={{
          padding: 12, marginBottom: 12, borderRadius: 8, border: '1px solid var(--border)',
        }}>
          <summary style={{ cursor: 'pointer', fontWeight: 500, fontSize: 13 }}>
            What ATS picks for each workflow ({routerPreview.workflows.filter(w => w.ai).length} AI · mode: {routerPreview.mode})
          </summary>
          <div style={{ marginTop: 10, overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-3)', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '6px 8px' }}>Workflow</th>
                  <th style={{ padding: '6px 8px' }}>Provider</th>
                  <th style={{ padding: '6px 8px' }}>Model</th>
                  <th style={{ padding: '6px 8px' }}>Family</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>Est. ₹/call</th>
                </tr>
              </thead>
              <tbody>
                {routerPreview.workflows.map((w, i) => (
                  <tr key={w.workflow + i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '6px 8px', fontFamily: 'var(--mono)' }}>{w.workflow}</td>
                    {w.ai ? (
                      <>
                        <td style={{ padding: '6px 8px' }}>{w.provider}</td>
                        <td style={{ padding: '6px 8px', fontFamily: 'var(--mono)', fontSize: 11 }}>{w.model}</td>
                        <td style={{ padding: '6px 8px', color: 'var(--text-3)' }}>{w.family}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'var(--mono)' }}>₹{Number(w.est_cost_inr || 0).toFixed(4)}</td>
                      </>
                    ) : (
                      <td colSpan={4} style={{ padding: '6px 8px', fontStyle: 'italic', color: 'var(--text-3)' }}>
                        {w.reason === 'no_ai_call' ? 'no AI call (local computation)' : (w.reason || 'unavailable — add a provider key')}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {/* T99-F3 + A2: workflow cost breakdown + run-now button */}
      <div style={{ padding: 12, marginBottom: 16, borderRadius: 8, border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontWeight: 500, fontSize: 13 }}>
            30-day cost by workflow {usageMeta.byWorkflow && usageMeta.byWorkflow.length > 0 ? `(${usageMeta.byWorkflow.length} active)` : '(no AI calls yet)'}
          </div>
          <button
            onClick={runMonthlyReview}
            disabled={reviewBusy || !(keys && keys.length)}
            style={{
              padding: '6px 12px', fontSize: 12, borderRadius: 6,
              border: '1px solid var(--accent, #3b82f6)',
              background: 'var(--accent, #3b82f6)', color: 'white',
              cursor: 'pointer', opacity: (reviewBusy || !(keys && keys.length)) ? 0.5 : 1,
            }}
          >{reviewBusy ? 'Running…' : 'Run monthly review'}</button>
        </div>
        {usageMeta.byWorkflow && usageMeta.byWorkflow.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-3)', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '4px 8px' }}>Workflow</th>
                  <th style={{ padding: '4px 8px', textAlign: 'right' }}>Calls</th>
                  <th style={{ padding: '4px 8px', textAlign: 'right' }}>Cost (₹)</th>
                  <th style={{ padding: '4px 8px' }}>Providers</th>
                </tr>
              </thead>
              <tbody>
                {usageMeta.byWorkflow.map((w, i) => (
                  <tr key={w.workflow + i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '4px 8px', fontFamily: 'var(--mono)' }}>{w.workflow}</td>
                    <td style={{ padding: '4px 8px', textAlign: 'right' }}>{w.calls}</td>
                    <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: 'var(--mono)' }}>₹{Number(w.cost_inr || 0).toFixed(4)}</td>
                    <td style={{ padding: '4px 8px', fontSize: 11, color: 'var(--text-3)' }}>
                      {Object.entries(w.providers || {}).map(([p, c]) => `${p}: ${c}`).join(', ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--text-3)', padding: '8px 0' }}>
            No AI calls yet. Run a critique or analysis to populate this view.
          </div>
        )}
        {reviewResult && reviewResult.ok && (
          <div style={{
            marginTop: 12, padding: 10, borderRadius: 6, border: '1px solid var(--border)',
            background: 'var(--surface-2, rgba(0,0,0,0.02))',
          }}>
            <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
              Monthly review · {reviewResult.period} · {reviewResult.provider}/{reviewResult.model}
            </div>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>{reviewResult.headline}</div>
            {reviewResult.what_went_well && reviewResult.what_went_well.length > 0 && (
              <div style={{ marginBottom: 6, fontSize: 12 }}>
                <strong style={{ color: 'var(--up)' }}>What went well:</strong>
                <ul style={{ marginTop: 4, paddingLeft: 18 }}>{reviewResult.what_went_well.map((x, i) => <li key={i}>{x}</li>)}</ul>
              </div>
            )}
            {reviewResult.what_went_wrong && reviewResult.what_went_wrong.length > 0 && (
              <div style={{ marginBottom: 6, fontSize: 12 }}>
                <strong style={{ color: 'var(--danger)' }}>What went wrong:</strong>
                <ul style={{ marginTop: 4, paddingLeft: 18 }}>{reviewResult.what_went_wrong.map((x, i) => <li key={i}>{x}</li>)}</ul>
              </div>
            )}
            {reviewResult.patterns_observed && (
              <div style={{ marginBottom: 6, fontSize: 12 }}><strong>Pattern:</strong> {reviewResult.patterns_observed}</div>
            )}
            {reviewResult.suggested_focus && reviewResult.suggested_focus.length > 0 && (
              <div style={{ marginBottom: 6, fontSize: 12 }}>
                <strong>Suggested focus next month:</strong>
                <ul style={{ marginTop: 4, paddingLeft: 18 }}>{reviewResult.suggested_focus.map((x, i) => <li key={i}>{x}</li>)}</ul>
              </div>
            )}
            {reviewResult.ai_spend_assessment && (
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8 }}>{reviewResult.ai_spend_assessment}</div>
            )}
            {/* T-I5: feedback widget */}
            {reviewResult.call_id && window.AiFeedback && (
              <div style={{ marginTop: 8 }}>
                <window.AiFeedback callId={reviewResult.call_id} workflow="monthly_review" compact={true}/>
              </div>
            )}
            {window.SebiDisclaimer && <window.SebiDisclaimer compact={true}/>}
          </div>
        )}
      </div>

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
                  onChange={e => {
                    const m = e.target.value;
                    setDraft(provider, { model: m });
                    // T98: auto-save if already configured and user isn't mid-typing a new key
                    if (isConfigured && !draft.key) { saveModelOnly(provider, m); }
                  }}>
                  {(dynamicModels[provider] || meta.modelOptions).map(m => <option key={m} value={m}>{m}{m === meta.defaultModel ? ' · default' : ''}</option>)}
                </select>
              </label>

              <label style={{ display: 'block', marginBottom: 10 }}>
                <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>
                  API key{isConfigured && <span style={{ marginLeft: 6, color: 'var(--up)' }}>· saved {_akRelTime(existing.created_at)}</span>}
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

const _akRelTime = (s) => {
  if (!s) return '';
  const dt = (Date.now() - new Date(s).getTime()) / 1000;
  if (dt < 60) return 'just now';
  if (dt < 3600) return Math.round(dt/60) + 'm ago';
  if (dt < 86400) return Math.round(dt/3600) + 'h ago';
  return Math.round(dt/86400) + 'd ago';
};

Object.assign(window, { AiKeysScreen });
try { window.dispatchEvent(new Event('screens-changed')); } catch (_) {}
