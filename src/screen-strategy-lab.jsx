/* eslint-disable */
/* Strategy Lab — Tier 10 consolidation.
   Merges 4 separate screens into one tabbed workflow:
     Backtest -> Tune -> Regime -> Benchmark
   This is the "validate before you ship" hub. The user clicks one nav item
   instead of jumping between 4 sidebar links.

   Each tab simply renders the existing screen component; logic stays put.
*/

function StrategyLabAiPanel() {
  const [strategies, setStrategies] = React.useState([]);
  const [stratId, setStratId] = React.useState('');
  const [busy, setBusy] = React.useState(null);   // 'explain' | 'tune' | null
  const [explain, setExplain] = React.useState(null);
  const [tune, setTune] = React.useState(null);
  const [err, setErr] = React.useState(null);

  React.useEffect(() => {
    fetch('/api/strategies', { credentials: 'include' })
      .then(r => r.json())
      .then(j => {
        if (j && j.ok && Array.isArray(j.strategies)) {
          setStrategies(j.strategies);
          if (!stratId && j.strategies[0]) setStratId(j.strategies[0].id);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runExplain = async () => {
    if (!stratId) return;
    setBusy('explain'); setErr(null); setExplain(null);
    try {
      const r = await fetch('/api/me/ai-workflows/explain', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategy_id: stratId }),
      }).then(r => r.json());
      if (r.ok) setExplain(r); else setErr(r.detail || r.reason || 'explain failed');
    } catch (e) { setErr(e.message); }
    finally { setBusy(null); }
  };

  const runTune = async () => {
    if (!stratId) return;
    setBusy('tune'); setErr(null); setTune(null);
    try {
      const r = await fetch('/api/me/ai-workflows/auto-tune', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategy_id: stratId, symbol: 'NIFTY 50' }),
      }).then(r => r.json());
      if (r.ok) setTune(r); else setErr(r.detail || r.reason || 'tune failed');
    } catch (e) { setErr(e.message); }
    finally { setBusy(null); }
  };

  return (
    <div style={{
      margin: '12px 16px 0', padding: 12, borderRadius: 8, border: '1px solid var(--border)',
      background: 'var(--surface-2, rgba(0,0,0,0.02))',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>AI assist</div>
        <select
          value={stratId}
          onChange={e => { setStratId(e.target.value); setExplain(null); setTune(null); }}
          style={{ padding: '5px 8px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface, white)' }}
        >
          {strategies.length === 0 && <option>Loading…</option>}
          {strategies.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button
          onClick={runExplain} disabled={!stratId || busy === 'explain'}
          style={{ padding: '5px 12px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface, transparent)', cursor: busy === 'explain' ? 'wait' : 'pointer' }}
        >{busy === 'explain' ? 'Explaining…' : 'Explain'}</button>
        <button
          onClick={runTune} disabled={!stratId || busy === 'tune'}
          style={{ padding: '5px 12px', fontSize: 12, borderRadius: 6, border: '1px solid var(--accent, #3b82f6)', background: busy === 'tune' ? 'var(--surface-2)' : 'var(--accent, #3b82f6)', color: busy === 'tune' ? 'var(--text-2)' : 'white', cursor: busy === 'tune' ? 'wait' : 'pointer' }}
        >{busy === 'tune' ? 'Tuning…' : 'AI tune (NIFTY 50, 120d)'}</button>
      </div>
      {err && <div style={{ marginTop: 6, fontSize: 11, color: 'var(--danger, #c53030)' }}>{err}</div>}

      {explain && (
        <div style={{ marginTop: 10, padding: 10, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface, white)', fontSize: 12 }}>
          <div style={{ marginBottom: 4 }}><strong>{explain.what_it_does}</strong></div>
          <div style={{ marginBottom: 4 }}><em>How it decides:</em> {explain.how_it_decides}</div>
          <div style={{ marginBottom: 4 }}><em>When it works:</em> {explain.when_it_works}</div>
          <div style={{ marginBottom: 4 }}><em>When it fails:</em> {explain.when_it_fails}</div>
          {explain.example && <div style={{ marginBottom: 4 }}><em>Example:</em> {explain.example}</div>}
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>{explain.provider}/{explain.model} · ₹{Number(explain.cost_inr || 0).toFixed(4)} {explain.cached ? '(cached)' : ''}</div>
          {explain.call_id && window.AiFeedback && (
            <div style={{ marginTop: 6 }}><window.AiFeedback callId={explain.call_id} workflow="strategy_explain" compact={true}/></div>
          )}
        </div>
      )}

      {tune && (
        <div style={{ marginTop: 10, padding: 10, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface, white)', fontSize: 12 }}>
          <div style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', background: tune.should_change ? 'var(--accent, #3b82f6)' : 'var(--text-3)', color: 'white' }}>{tune.should_change ? 'change' : 'keep'}</span>
            <strong>{tune.headline}</strong>
          </div>
          {tune.proposed_params && (
            <div style={{ marginBottom: 4, fontFamily: 'var(--mono)', fontSize: 11 }}>
              Proposed: {JSON.stringify(tune.proposed_params)}
            </div>
          )}
          <div style={{ marginBottom: 4 }}>{tune.rationale}</div>
          {tune.risk_note && <div style={{ fontSize: 11, color: 'var(--text-3)', fontStyle: 'italic' }}>{tune.risk_note}</div>}
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>{tune.provider}/{tune.model} · ₹{Number(tune.cost_inr || 0).toFixed(4)} {tune.cached ? '(cached)' : ''}</div>
          {tune.call_id && window.AiFeedback && (
            <div style={{ marginTop: 6 }}><window.AiFeedback callId={tune.call_id} workflow="strategy_autotune" compact={true}/></div>
          )}
        </div>
      )}
    </div>
  );
}

const StrategyLabScreen = () => {
  // T100 (v9): Regime + Benchmark tabs removed — their screens were broken
  // and have been deleted. Regime context now injects into AI critic prompt (E6);
  // benchmark vs NIFTY is shown in Performance by regime panel inline.
  const TABS = [
    { id: "backtest",  label: "Backtest",   desc: "Walk-forward, out-of-sample" },
    { id: "tuner",     label: "Tune",       desc: "Bayesian param search" },
  ];

  const [tab, setTab] = React.useState(() => {
    try { const v = localStorage.getItem('ats.lab.tab'); return (v === 'regime' || v === 'benchmark') ? 'backtest' : (v || 'backtest'); } catch { return 'backtest'; }
  });

  const go = (id) => {
    setTab(id);
    try { localStorage.setItem('ats.lab.tab', id); } catch {}
  };

  const ChildScreen = (
    tab === 'backtest'  && window.BacktestScreen  ? <window.BacktestScreen/>  :
    tab === 'tuner'     && window.TunerScreen     ? <window.TunerScreen/>     :
    null
  );

  return (
    <div style={{ padding: 0 }}>
      {/* compact lab header */}
      <div style={{
        padding: '16px 16px 0', display: 'flex', flexDirection: 'column', gap: 4,
      }}>
        <div style={{ fontSize: 12, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.6 }}>Validate</div>
        <div style={{ fontSize: 22, fontWeight: 600 }}>Strategy Lab</div>
        <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
          One stop for validating strategies before they touch real money. Backtest historically, then tune hyperparameters.
        </div>
      </div>

      {/* AI assist panel */}
      <StrategyLabAiPanel/>

      {/* tab strip */}
      <div style={{
        display: 'flex', gap: 4, padding: '12px 16px 0',
        borderBottom: '1px solid var(--border)',
      }}>
        {TABS.map(t => {
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              onClick={() => go(t.id)}
              style={{
                padding: '10px 16px', fontSize: 13, fontWeight: active ? 600 : 400,
                background: 'transparent',
                color: active ? 'var(--text-1)' : 'var(--text-2)',
                border: 0, borderBottom: active ? '2px solid var(--acc)' : '2px solid transparent',
                marginBottom: -1, cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
              }}
              title={t.desc}
            >
              <span>{t.label}</span>
              <span style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 1 }}>{t.desc}</span>
            </button>
          );
        })}
      </div>

      {/* active child screen */}
      <div style={{ paddingTop: 0 }}>
        {ChildScreen || (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-3)' }}>
            Child screen <b>{tab}</b> not yet loaded — refresh the page.
          </div>
        )}
      </div>
    </div>
  );
};

window.StrategyLabScreen = StrategyLabScreen;
