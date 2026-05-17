/* eslint-disable */
/* G8 + mf_pick: MF search + AI picker */

window.MfPickerScreen = function MfPickerScreen() {
  const [q, setQ] = React.useState('');
  const [horizon, setHorizon] = React.useState(5);
  const [searching, setSearching] = React.useState(false);
  const [results, setResults] = React.useState(null);
  const [picking, setPicking] = React.useState(false);
  const [pick, setPick] = React.useState(null);
  const [err, setErr] = React.useState(null);

  const runSearch = async () => {
    if (q.length < 2) return;
    setSearching(true); setErr(null); setResults(null); setPick(null);
    try {
      const r = await fetch('/api/me/mf/search?q=' + encodeURIComponent(q) + '&limit=10', { credentials: 'include' }).then(r => r.json());
      if (r.ok) setResults(r);
      else setErr(r.detail || r.reason || 'search_failed');
    } catch (e) { setErr(e.message); }
    finally { setSearching(false); }
  };

  const runPick = async () => {
    if (q.length < 2) return;
    setPicking(true); setErr(null); setPick(null);
    try {
      const r = await fetch('/api/me/ai-workflows/mf-pick', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, horizon_years: horizon }),
      }).then(r => r.json());
      if (r.ok) setPick(r);
      else setErr(r.detail || r.reason || 'pick_failed');
    } catch (e) { setErr(e.message); }
    finally { setPicking(false); }
  };

  return (
    <div style={{ padding: '16px 24px 32px', maxWidth: 900 }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 4px' }}>Mutual Funds</h1>
      <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 16 }}>
        Search 14k AMFI schemes + ask AI for a top-3 pick. Powered by AMFI + MFAPI; AI uses the auto-router.
      </div>

      {/* Search bar */}
      <div style={{
        padding: 12, marginBottom: 16, borderRadius: 8, border: '1px solid var(--border)',
        display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
      }}>
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') runSearch(); }}
          placeholder="e.g. parag parikh flexi cap"
          style={{ flex: 1, minWidth: 200, padding: '7px 10px', fontSize: 13, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface, white)', color: 'var(--text)' }}
        />
        <label style={{ fontSize: 12, color: 'var(--text-3)' }}>
          Horizon&nbsp;
          <select value={horizon} onChange={e => setHorizon(parseInt(e.target.value, 10))} style={{ padding: '5px 8px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface, white)' }}>
            {[1, 2, 3, 5, 7, 10, 15].map(n => <option key={n} value={n}>{n}y</option>)}
          </select>
        </label>
        <button
          onClick={runSearch} disabled={q.length < 2 || searching}
          style={{ padding: '7px 14px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface, transparent)', cursor: searching ? 'wait' : 'pointer' }}
        >{searching ? 'Searching…' : 'Search schemes'}</button>
        <button
          onClick={runPick} disabled={q.length < 2 || picking}
          style={{ padding: '7px 14px', fontSize: 12, borderRadius: 6, border: '1px solid var(--accent, #3b82f6)', background: picking ? 'var(--surface-2)' : 'var(--accent, #3b82f6)', color: picking ? 'var(--text-2)' : 'white', cursor: picking ? 'wait' : 'pointer' }}
        >{picking ? 'Picking…' : 'AI pick top 3'}</button>
      </div>

      {err && <div style={{ padding: 10, marginBottom: 12, borderRadius: 6, color: 'var(--danger, #c53030)', border: '1px solid currentColor', fontSize: 12 }}>{err}</div>}

      {/* Plain search results */}
      {results && results.schemes && results.schemes.length > 0 && (
        <div style={{ marginBottom: 16, padding: 12, borderRadius: 8, border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6 }}>{results.count} matching schemes</div>
          <div style={{ display: 'grid', gap: 6 }}>
            {results.schemes.slice(0, 10).map(s => (
              <div key={s.code} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500 }}>{s.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{s.amc} · scheme #{s.code}</div>
                </div>
                <div style={{ fontFamily: 'var(--mono)', textAlign: 'right' }}>
                  ₹{s.nav || '—'}
                  <div style={{ fontSize: 10, color: 'var(--text-3)' }}>{s.date || ''}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI pick */}
      {pick && (
        <div style={{ padding: 12, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2, rgba(0,0,0,0.02))' }}>
          <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
            AI pick · {pick.horizon_years}y horizon · {pick.provider}/{pick.model} · ₹{Number(pick.cost_inr || 0).toFixed(4)} {pick.cached ? '· cached' : ''}
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>{pick.headline}</div>

          {pick.picks && pick.picks.length > 0 && (
            <div style={{ display: 'grid', gap: 8 }}>
              {pick.picks.map(p => {
                const cand = (pick.candidates || []).find(c => c.code === p.code) || {};
                return (
                  <div key={p.code} style={{ padding: 10, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface, white)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ padding: '2px 8px', borderRadius: 4, background: 'var(--accent, #3b82f6)', color: 'white', fontWeight: 600, fontSize: 11 }}>#{p.rank}</span>
                      <strong style={{ fontSize: 13 }}>{cand.name || ('scheme ' + p.code)}</strong>
                    </div>
                    <div style={{ fontSize: 12, marginBottom: 4 }}><em>Why:</em> {p.why}</div>
                    <div style={{ fontSize: 12, marginBottom: 4 }}><em>Caveat:</em> {p.caveat}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>
                      NAV ₹{cand.latest_nav || '—'}
                      {cand.cagr_1y != null && <> · 1y {cand.cagr_1y}%</>}
                      {cand.cagr_3y != null && <> · 3y {cand.cagr_3y}%</>}
                      {cand.cagr_5y != null && <> · 5y {cand.cagr_5y}%</>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {pick.general_advice && <div style={{ marginTop: 10, fontSize: 12, fontStyle: 'italic' }}>{pick.general_advice}</div>}

          {pick.call_id && window.AiFeedback && (
            <div style={{ marginTop: 8 }}><window.AiFeedback callId={pick.call_id} workflow="mf_pick" compact={true}/></div>
          )}
          {window.SebiDisclaimer && <window.SebiDisclaimer compact={true}/>}
        </div>
      )}
    </div>
  );
};
