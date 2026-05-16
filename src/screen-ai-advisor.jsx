/* eslint-disable */
/* Tier 69-70: Aladdin-style insights panel.
   - Live risk metrics from /api/me/risk-metrics
   - Factor exposure + concentration warnings from /api/me/factor-exposure
   - AI advisor: BYOK key management + run analysis
   Renders as one big screen accessible from sidebar (route: insights). */

const _fmtPct = (v) => v == null || isNaN(v) ? '—' : `${(v * 100).toFixed(2)}%`;
const _fmtNum = (v, d = 2) => v == null || isNaN(v) ? '—' : v.toFixed(d);

const AiAdvisorScreen = () => {
  const [risk,     setRisk]     = React.useState(null);
  const [factor,   setFactor]   = React.useState(null);
  const [keys,     setKeys]     = React.useState(null);
  const [advice,   setAdvice]   = React.useState(null);
  const [running,  setRunning]  = React.useState(false);
  const [err,      setErr]      = React.useState(null);
  const [keyForm,  setKeyForm]  = React.useState({ provider: 'anthropic', apiKey: '', model: '' });
  const [keySaved, setKeySaved] = React.useState(null);

  const refresh = React.useCallback(async () => {
    setErr(null);
    try {
      const [rk, fx, kk] = await Promise.all([
        fetch('/api/me/risk-metrics?days=252', { credentials: 'include' }).then(r => r.json()),
        fetch('/api/me/factor-exposure', { credentials: 'include' }).then(r => r.json()),
        fetch('/api/me/ai-keys', { credentials: 'include' }).then(r => r.json()),
      ]);
      setRisk(rk); setFactor(fx); setKeys(kk);
    } catch (e) { setErr(String(e.message || e)); }
  }, []);
  React.useEffect(() => { refresh(); }, [refresh]);

  const saveKey = async (e) => {
    e && e.preventDefault();
    setErr(null); setKeySaved(null);
    try {
      const r = await fetch('/api/me/ai-keys', {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(keyForm),
      });
      const j = await r.json();
      if (j.ok) {
        setKeySaved(`Saved ${keyForm.provider} key.`);
        setKeyForm({ ...keyForm, apiKey: '' });
        refresh();
      } else {
        setErr(j.detail || j.reason);
      }
    } catch (e) { setErr(String(e.message || e)); }
  };

  const removeKey = async (provider) => {
    if (!confirm(`Remove your ${provider} API key?`)) return;
    await fetch('/api/me/ai-keys/' + encodeURIComponent(provider), { method: 'DELETE', credentials: 'include' });
    refresh();
  };

  const runAdvisor = async () => {
    setRunning(true); setErr(null); setAdvice(null);
    try {
      const r = await fetch('/api/me/ai-advisor/analyze', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const j = await r.json();
      if (j.ok) setAdvice(j);
      else setErr(j.detail || j.reason);
    } catch (e) { setErr(String(e.message || e)); }
    finally { setRunning(false); }
  };

  const MetricRow = ({ label, value, hint }) => (
    <div className="between" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
      <div>
        <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{label}</div>
        {hint && <div style={{ fontSize: 10, color: 'var(--text-3)', opacity: 0.7 }}>{hint}</div>}
      </div>
      <div className="mono" style={{ fontSize: 14, fontWeight: 600 }}>{value}</div>
    </div>
  );

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-header__title">AI insights &middot; Risk &amp; Factor exposure</h1>
          <div className="page-header__sub">Per-user portfolio analytics powered by your own Claude / OpenAI / Gemini key.</div>
        </div>
      </div>

      {err && (
        <div style={{ padding: 12, marginBottom: 16, borderRadius: 8, background: 'color-mix(in oklab, var(--danger) 10%, transparent)', color: 'var(--danger)', fontSize: 13 }}>
          {err}
        </div>
      )}

      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        {/* Risk metrics */}
        <window.Card title="Risk metrics" sub="From your daily equity snapshots (last 252 trading days)">
          {!risk ? (
            <div className="muted">Loading...</div>
          ) : !risk.enoughData ? (
            <div className="muted" style={{ padding: 12, background: 'var(--bg-soft)', borderRadius: 6, fontSize: 12 }}>
              {risk.reason || 'Need at least 2 days of equity snapshots. Place a paper trade or wait for the daily snapshot job.'}
            </div>
          ) : (
            <>
              <MetricRow label="Cumulative return" value={_fmtPct(risk.cumulativeReturn)} />
              <MetricRow label="Annualized return" value={_fmtPct(risk.annualizedReturn)} hint="CAGR over the period" />
              <MetricRow label="Volatility (annual)" value={_fmtPct(risk.volatilityAnnual)} />
              <MetricRow label="Sharpe ratio" value={_fmtNum(risk.sharpeRatio)} hint={`vs ${(risk.rfAnnualUsed*100).toFixed(1)}% risk-free`} />
              <MetricRow label="Sortino ratio" value={_fmtNum(risk.sortinoRatio)} hint="downside-only" />
              <MetricRow label="Calmar ratio" value={_fmtNum(risk.calmarRatio)} hint="return / |max DD|" />
              <MetricRow label="Max drawdown" value={_fmtPct(risk.maxDrawdown)} hint={`${risk.maxDrawdownDays} days peak-to-trough`} />
              <MetricRow label="VaR 95% (1-day)" value={_fmtPct(risk.var95Daily)} hint="historical / empirical" />
              <MetricRow label="VaR 99% (1-day)" value={_fmtPct(risk.var99Daily)} />
              <MetricRow label="CVaR 95%" value={_fmtPct(risk.cvar95Daily)} hint="Expected Shortfall (avg tail loss)" />
            </>
          )}
        </window.Card>

        {/* Factor exposure */}
        <window.Card title="Factor exposure &amp; concentration" sub="Returns-based factors, plus concentration warnings">
          {!factor ? (
            <div className="muted">Loading...</div>
          ) : !factor.enoughData ? (
            <div className="muted" style={{ padding: 12, background: 'var(--bg-soft)', borderRadius: 6, fontSize: 12 }}>
              {factor.reason === 'broker_not_connected' ? 'Connect your Zerodha broker to compute factor exposure on your real holdings.' : factor.reason}
            </div>
          ) : (
            <>
              <MetricRow label="Holdings" value={String(factor.holdingCount)} />
              <MetricRow label="Portfolio momentum (1M)" value={_fmtPct(factor.portfolio?.momentum1M)} />
              <MetricRow label="Portfolio momentum (3M)" value={_fmtPct(factor.portfolio?.momentum3M)} />
              <MetricRow label="Portfolio momentum (12M)" value={_fmtPct(factor.portfolio?.momentum12M)} />
              <MetricRow label="Portfolio volatility (annual)" value={_fmtPct(factor.portfolio?.volatilityAnnual)} />
              <MetricRow label="Top single stock" value={_fmtPct(factor.concentration?.top1Weight)} hint={factor.perHolding?.[0]?.symbol} />
              <MetricRow label="Top 3 stocks" value={_fmtPct(factor.concentration?.top3Weight)} />
              <MetricRow label="Top sector" value={`${factor.concentration?.topSector?.name || '—'} (${_fmtPct(factor.concentration?.topSector?.weight)})`} />
              {factor.concentration?.warnings?.length > 0 && (
                <div style={{ marginTop: 12, padding: 10, borderRadius: 6, background: 'color-mix(in oklab, var(--warn, #d97706) 12%, transparent)', color: 'var(--warn, #d97706)', fontSize: 12 }}>
                  <strong>Concentration warnings:</strong>
                  <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
                    {factor.concentration.warnings.map((w, i) => (
                      <li key={i}>{w.kind.replace(/_/g, ' ')} {w.symbol ? `(${w.symbol})` : ''} {w.sector ? `(${w.sector})` : ''} -- {_fmtPct(w.weight)}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </window.Card>
      </div>

      {/* AI advisor section */}
      <window.Card title="AI Advisor (BYOK)" sub="Use your own Anthropic / OpenAI / Gemini API key. The key stays libsodium-sealed in our DB and is sent to the provider only when you run an analysis." style={{ marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <h4 style={{ marginTop: 0, fontSize: 14 }}>Connected providers</h4>
            {!keys ? (
              <div className="muted">Loading...</div>
            ) : !keys.keys || keys.keys.length === 0 ? (
              <div className="muted" style={{ fontSize: 13 }}>No keys yet. Add one on the right.</div>
            ) : (
              keys.keys.map(k => (
                <div key={k.provider} className="between" style={{ padding: '10px 12px', marginBottom: 6, background: 'var(--bg-soft)', borderRadius: 6 }}>
                  <div>
                    <strong style={{ textTransform: 'capitalize' }}>{k.provider}</strong>
                    <div style={{ fontSize: 11, color: 'var(--text-3)' }}>model: {k.model_pref}</div>
                  </div>
                  <button className="btn btn--sm" onClick={() => removeKey(k.provider)} style={{ color: 'var(--danger)' }}>Remove</button>
                </div>
              ))
            )}

            <button
              onClick={runAdvisor}
              disabled={running || !keys || !keys.keys || keys.keys.length === 0}
              className="btn btn--accent"
              style={{ marginTop: 14, width: '100%', padding: '10px 14px', fontWeight: 600 }}
            >{running ? 'Analyzing...' : 'Run AI analysis on my portfolio'}</button>
          </div>

          <div>
            <h4 style={{ marginTop: 0, fontSize: 14 }}>Add / update a key</h4>
            <form onSubmit={saveKey}>
              <label style={{ display: 'block', marginBottom: 8, fontSize: 12, color: 'var(--text-3)' }}>Provider</label>
              <select
                value={keyForm.provider}
                onChange={e => setKeyForm({ ...keyForm, provider: e.target.value, model: '' })}
                style={{ width: '100%', padding: '8px 10px', marginBottom: 10, border: '1px solid var(--border)', borderRadius: 6 }}
              >
                <option value="anthropic">Anthropic (Claude)</option>
                <option value="openai">OpenAI</option>
                <option value="gemini">Google Gemini</option>
              </select>

              <label style={{ display: 'block', marginBottom: 8, fontSize: 12, color: 'var(--text-3)' }}>API key</label>
              <input
                type="password"
                value={keyForm.apiKey}
                onChange={e => setKeyForm({ ...keyForm, apiKey: e.target.value })}
                placeholder="sk-..."
                autoComplete="off"
                style={{ width: '100%', padding: '8px 10px', marginBottom: 10, border: '1px solid var(--border)', borderRadius: 6, fontFamily: 'var(--mono)' }}
              />

              <label style={{ display: 'block', marginBottom: 8, fontSize: 12, color: 'var(--text-3)' }}>Model (optional)</label>
              <input
                value={keyForm.model}
                onChange={e => setKeyForm({ ...keyForm, model: e.target.value })}
                placeholder={keys && keys.defaultModels ? keys.defaultModels[keyForm.provider] : ''}
                style={{ width: '100%', padding: '8px 10px', marginBottom: 12, border: '1px solid var(--border)', borderRadius: 6, fontFamily: 'var(--mono)' }}
              />

              <button type="submit" className="btn btn--sm" disabled={!keyForm.apiKey || keyForm.apiKey.length < 10}>Save key</button>
              {keySaved && <span style={{ marginLeft: 12, fontSize: 12, color: 'var(--up)' }}>{keySaved}</span>}
            </form>
            <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text-3)' }}>
              Keys are encrypted at rest with libsodium. We never log or share them.
            </div>
          </div>
        </div>
      </window.Card>

      {/* Advice output */}
      {advice && advice.ok && advice.advice && (
        <window.Card title={`AI advice (${advice.provider} / ${advice.model})`}>
          <div style={{ marginBottom: 12, padding: 10, background: 'var(--bg-soft)', borderRadius: 6 }}>
            <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>Overall risk grade</div>
            <div style={{ fontSize: 32, fontWeight: 700, fontFamily: 'var(--mono)' }}>{advice.advice.overall_risk_grade}</div>
          </div>
          <h4 style={{ marginTop: 8, marginBottom: 6, fontSize: 14 }}>Summary</h4>
          <p style={{ marginTop: 0 }}>{advice.advice.summary}</p>

          {advice.advice.risk_concerns?.length > 0 && (
            <>
              <h4 style={{ marginBottom: 6, fontSize: 14 }}>Risk concerns</h4>
              <ul>{advice.advice.risk_concerns.map((c, i) => <li key={i}>{c}</li>)}</ul>
            </>
          )}

          {advice.advice.opportunities?.length > 0 && (
            <>
              <h4 style={{ marginBottom: 6, fontSize: 14 }}>Opportunities</h4>
              <ul>{advice.advice.opportunities.map((c, i) => <li key={i}>{c}</li>)}</ul>
            </>
          )}

          {advice.advice.suggested_actions?.length > 0 && (
            <>
              <h4 style={{ marginBottom: 6, fontSize: 14 }}>Suggested actions</h4>
              {advice.advice.suggested_actions.map((a, i) => (
                <div key={i} style={{ padding: 10, marginBottom: 8, background: 'var(--bg-soft)', borderRadius: 6 }}>
                  <div style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 999, background: a.priority === 1 ? 'var(--down)' : a.priority === 2 ? 'var(--warn, #d97706)' : 'var(--info, #3b82f6)', color: 'white', fontSize: 11, marginRight: 8 }}>P{a.priority}</div>
                  <strong>{a.action}</strong>
                  {a.target_symbol && <span className="mono" style={{ marginLeft: 8, fontSize: 12, color: 'var(--text-3)' }}>[{a.target_symbol}]</span>}
                  <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-3)' }}>{a.rationale}</div>
                </div>
              ))}
            </>
          )}

          <div style={{ marginTop: 16, padding: 10, background: 'color-mix(in oklab, var(--info, #3b82f6) 8%, transparent)', borderRadius: 6, fontSize: 11, color: 'var(--text-3)' }}>
            Not financial advice. Inputs: {advice.inputs?.hasRiskMetrics ? '✓ risk metrics' : 'no risk metrics'}, {advice.inputs?.hasFactorExposure ? '✓ factor exposure' : 'no factor exposure'}, {advice.inputs?.holdingCount || 0} holdings.
          </div>
        </window.Card>
      )}
    </>
  );
};

window.AiAdvisorScreen = AiAdvisorScreen;
