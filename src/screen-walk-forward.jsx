/* eslint-disable */
// @ts-check
/* T-301a  -- Walk-forward parameter optimization screen. */
/* T-312b -- Phase B-2: typed against /api/me/walk-forward + /api/strategies. */

/** @typedef {import('../types/api-shapes').WalkForwardResponse} WalkForwardResponse */
/** @typedef {import('../types/api-shapes').StrategiesResponse}  StrategiesResponse */
/** @typedef {import('../types/api-shapes').StrategyDescriptor} StrategyDescriptor */

(function () {
  // T-274c HOTFIX: IIFE wrapper so per-file helpers (_inr, _fmtTime, etc.)
  // do not collide with same-named consts in other screen-*.js files.
const _fmtWF = (n, p = 2) => Number.isFinite(n) ? n.toFixed(p) : '-';
const _badgeWF = (action) => ({ update: '#15803d', no_change: '#94a3b8' })[action] || '#94a3b8';

window.WalkForwardScreen = function WalkForwardScreen() {
  const [strategies, setStrategies] = React.useState([]);
  const [strategy, setStrategy] = React.useState('rsi_mean_revert');
  const [symbol, setSymbol] = React.useState('RELIANCE');
  const [inWindow, setInWindow] = React.useState(60);
  const [outWindow, setOutWindow] = React.useState(14);
  const [step, setStep] = React.useState(14);
  const [running, setRunning] = React.useState(false);
  const [result, setResult] = React.useState(null);
  const [err, setErr] = React.useState(null);
  const [paramGridJson, setParamGridJson] = React.useState('{}');

  React.useEffect(() => {
    fetch('/api/strategies').then(r => r.json()).then(/** @param {StrategiesResponse} r */ (r) => {
      if (r && r.ok && Array.isArray(r.strategies)) setStrategies(r.strategies);
    }).catch(() => {});
  }, []);

  React.useEffect(() => {
    // Pre-populate paramGrid with sensible sweep ranges from strategy defaults
    const s = strategies.find(x => x.id === strategy);
    if (!s || !Array.isArray(s.params)) { setParamGridJson('{}'); return; }
    const grid = {};
    for (const p of s.params) {
      if (p.type === 'int' && Number.isFinite(p.default)) {
        const d = p.default;
        grid[p.name] = [Math.max(p.min || 1, d - 4), d, d + 4].map(v => Math.round(v));
      } else if (Number.isFinite(p.default)) {
        const d = p.default;
        const step = Math.abs(d) >= 10 ? 5 : 0.5;
        grid[p.name] = [d - step, d, d + step].map(v => +v.toFixed(2));
      }
    }
    setParamGridJson(JSON.stringify(grid, null, 2));
  }, [strategy, strategies]);

  const run = async () => {
    setRunning(true);
    setErr(null);
    setResult(null);
    let grid;
    try { grid = JSON.parse(paramGridJson); }
    catch (e) { setErr('paramGrid is not valid JSON: ' + e.message); setRunning(false); return; }
    try {
      /** @type {WalkForwardResponse} */
      const r = await fetch('/api/me/walk-forward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window._csrfToken || '' },
        body: JSON.stringify({ strategy, symbol: symbol.toUpperCase(), paramGrid: grid, opts: { inWindow, outWindow, step } }),
      }).then(r => r.json());
      if (r && r.ok) setResult(r);
      else setErr(r && r.reason);
    } catch (e) { setErr(e.message); }
    finally { setRunning(false); }
  };

  return (
    <div style={{padding:'16px 24px', maxWidth:1200}}>
      <h2 style={{margin:'4px 0 12px', fontSize:20}}>Walk-forward optimization
        <span style={{fontSize:12, color:'var(--text-3)', fontWeight:400, marginLeft:8}}>
          (advisory — runs paramGrid sweep over rolling IS/OOS windows)
        </span>
      </h2>

      <div style={{padding:14, background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, marginBottom:14}}>
        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:10, marginBottom:10}}>
          <div>
            <div style={{fontSize:11, color:'var(--text-3)'}}>Strategy</div>
            <select value={strategy} onChange={e => setStrategy(e.target.value)} style={{width:'100%', padding:'4px 8px', background:'var(--surface-2)', color:'var(--text-1)', border:'1px solid var(--border)', borderRadius:4}}>
              {strategies.map(s => <option key={s.id} value={s.id}>{s.name || s.id}</option>)}
            </select>
          </div>
          <div>
            <div style={{fontSize:11, color:'var(--text-3)'}}>Symbol (NSE)</div>
            <input value={symbol} onChange={e => setSymbol(e.target.value)} style={{width:'100%', padding:'4px 8px', background:'var(--surface-2)', color:'var(--text-1)', border:'1px solid var(--border)', borderRadius:4, fontFamily:'monospace'}}/>
          </div>
          <div>
            <div style={{fontSize:11, color:'var(--text-3)'}}>IS window (bars)</div>
            <input type="number" value={inWindow} onChange={e => setInWindow(Math.max(20, Number(e.target.value) || 60))} style={{width:'100%', padding:'4px 8px', background:'var(--surface-2)', color:'var(--text-1)', border:'1px solid var(--border)', borderRadius:4}}/>
          </div>
          <div>
            <div style={{fontSize:11, color:'var(--text-3)'}}>OOS window (bars)</div>
            <input type="number" value={outWindow} onChange={e => setOutWindow(Math.max(5, Number(e.target.value) || 14))} style={{width:'100%', padding:'4px 8px', background:'var(--surface-2)', color:'var(--text-1)', border:'1px solid var(--border)', borderRadius:4}}/>
          </div>
          <div>
            <div style={{fontSize:11, color:'var(--text-3)'}}>Step (bars)</div>
            <input type="number" value={step} onChange={e => setStep(Math.max(1, Number(e.target.value) || 14))} style={{width:'100%', padding:'4px 8px', background:'var(--surface-2)', color:'var(--text-1)', border:'1px solid var(--border)', borderRadius:4}}/>
          </div>
        </div>
        <div style={{marginBottom:10}}>
          <div style={{fontSize:11, color:'var(--text-3)', marginBottom:4}}>paramGrid (JSON; arrays of values per key)</div>
          <textarea
            value={paramGridJson}
            onChange={e => setParamGridJson(e.target.value)}
            rows={6}
            style={{width:'100%', padding:'6px 8px', background:'var(--surface-2)', color:'var(--text-1)', border:'1px solid var(--border)', borderRadius:4, fontFamily:'monospace', fontSize:12}}
          />
          <div style={{fontSize:10, color:'var(--text-3)', marginTop:2}}>
            Cartesian product of values. Max 200 combinations per run.
          </div>
        </div>
        <button
          onClick={run}
          disabled={running}
          style={{padding:'6px 16px', background:'var(--accent, #3b82f6)', color:'white', border:0, borderRadius:4, cursor: running ? 'wait' : 'pointer', fontWeight:600}}
        >{running ? 'Running...' : 'Run walk-forward'}</button>
      </div>

      {err && (
        <div style={{padding:'10px 14px', background:'rgba(185, 28, 28, 0.1)', border:'1px solid rgba(185, 28, 28, 0.4)', borderRadius:6, color:'var(--down, #b91c1c)', fontSize:13, marginBottom:14}}>
          {String(err)}
        </div>
      )}

      {result && (
        <>
          <section style={{padding:14, background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, marginBottom:14}}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:8}}>
              <h3 style={{margin:0, fontSize:14}}>Recommendation</h3>
              <span style={{padding:'2px 10px', borderRadius:4, fontSize:12, fontWeight:700, background:_badgeWF(result.recommendation.action)+'22', color:_badgeWF(result.recommendation.action)}}>
                {result.recommendation.action.toUpperCase()}
              </span>
            </div>
            <div style={{fontSize:13, color:'var(--text-2)', marginBottom:8}}>{result.recommendation.reason}</div>
            {result.recommendation.proposedParams && (
              <div style={{fontSize:12, fontFamily:'monospace', background:'var(--surface-2)', padding:'6px 10px', borderRadius:4}}>
                <strong>Proposed params:</strong> {JSON.stringify(result.recommendation.proposedParams)}
              </div>
            )}
            <div style={{marginTop:10, padding:8, background:'var(--surface-2)', borderRadius:4, fontSize:11, color:'var(--text-3)'}}>
              This recommendation is <strong>advisory only</strong>. The engine
              does not apply these params automatically — review and edit your
              risk-config / strategy params manually if you agree.
            </div>
          </section>

          {result.summary && (
            <section style={{padding:14, background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, marginBottom:14, display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(160px, 1fr))', gap:10}}>
              <div><div style={{fontSize:11, color:'var(--text-3)'}}>Windows tested</div><div style={{fontSize:20, fontWeight:600}}>{result.summary.windowCount}</div></div>
              <div><div style={{fontSize:11, color:'var(--text-3)'}}>Combos tested</div><div style={{fontSize:20, fontWeight:600}}>{result.combosTested}</div></div>
              <div><div style={{fontSize:11, color:'var(--text-3)'}}>Avg IS score</div><div style={{fontSize:20, fontWeight:600, fontFamily:'monospace'}}>{_fmtWF(result.summary.avgIsScore)}</div></div>
              <div><div style={{fontSize:11, color:'var(--text-3)'}}>Avg OOS score</div><div style={{fontSize:20, fontWeight:600, fontFamily:'monospace'}}>{_fmtWF(result.summary.avgOosScore)}</div></div>
              <div><div style={{fontSize:11, color:'var(--text-3)'}}>Dominance</div><div style={{fontSize:20, fontWeight:600, fontFamily:'monospace'}}>{_fmtWF((result.summary.dominanceFrac || 0) * 100, 0)}%</div></div>
              <div><div style={{fontSize:11, color:'var(--text-3)'}}>Overfit?</div><div style={{fontSize:20, fontWeight:600, color: result.summary.overfit ? '#f59e0b' : '#15803d'}}>{result.summary.overfit ? 'YES' : 'no'}</div></div>
            </section>
          )}

          <section style={{padding:14, background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8}}>
            <h3 style={{margin:'0 0 8px', fontSize:14}}>Per-window results ({result.windows.length})</h3>
            <table style={{width:'100%', borderCollapse:'collapse', fontSize:12}}>
              <thead>
                <tr style={{borderBottom:'1px solid var(--border)', textAlign:'left', color:'var(--text-2)'}}>
                  <th style={{padding:'4px 6px'}}>Window</th>
                  <th style={{padding:'4px 6px'}}>IS params (best)</th>
                  <th style={{padding:'4px 6px', textAlign:'right'}}>IS score</th>
                  <th style={{padding:'4px 6px', textAlign:'right'}}>OOS score</th>
                </tr>
              </thead>
              <tbody>
                {result.windows.map((w, i) => (
                  <tr key={i} style={{borderBottom:'1px solid var(--border)'}}>
                    <td style={{padding:'4px 6px', fontFamily:'monospace'}}>[{w.startIdx}..{w.endIdx}]</td>
                    <td style={{padding:'4px 6px', fontFamily:'monospace', fontSize:11}}>{JSON.stringify(w.isParams)}</td>
                    <td style={{padding:'4px 6px', textAlign:'right', fontFamily:'monospace'}}>{_fmtWF(w.isScore)}</td>
                    <td style={{padding:'4px 6px', textAlign:'right', fontFamily:'monospace', color: w.oosScore > 0 ? '#15803d' : '#b91c1c'}}>{_fmtWF(w.oosScore)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
};

})();
