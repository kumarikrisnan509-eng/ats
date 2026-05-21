/* eslint-disable */
/* T-312 -- Slippage tracker screen. Reads GET /api/me/slippage. */


(function () {
  // T-274c HOTFIX: IIFE wrapper so per-file helpers (_inr, _fmtTime, etc.)
  // do not collide with same-named consts in other screen-*.js files.
const _bps = (n) => Number.isFinite(n) ? `${n.toFixed(1)} bps` : '-';
const _bpsColor = (n) => !Number.isFinite(n) ? 'var(--text-2)' : (n > 10 ? '#b91c1c' : (n > 5 ? '#f59e0b' : '#15803d'));

window.SlippageScreen = function SlippageScreen() {
  const [data, setData] = React.useState(null);
  const [err, setErr] = React.useState(null);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    try {
      const r = await fetch('/api/me/slippage').then(r => r.json());
      if (r && r.ok) setData(r.slippage);
      else setErr(r && r.reason);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, []);

  React.useEffect(() => {
    load();
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, [load]);

  if (loading) return <div style={{padding:24, color:'var(--text-2)'}}>Loading slippage data...</div>;
  if (err) return <div style={{padding:24, color:'var(--down)'}}>Error: {String(err)}</div>;
  if (!data) return <div style={{padding:24, color:'var(--text-2)'}}>No data yet.</div>;

  const byStrategy = data.byStrategy || {};
  const bySymbol = data.bySymbol || {};
  const overall = data.overall || {};

  return (
    <div style={{padding:'16px 24px', maxWidth:1200}}>
      <h2 style={{margin:'4px 0 12px', fontSize:20}}>Slippage tracker</h2>

      {/* Overall */}
      <section style={{background:'var(--panel, #1a1f2e)', border:'1px solid var(--border, #2a3142)', borderRadius:8, marginBottom:20, padding:14, display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(160px, 1fr))', gap:12}}>
        <div>
          <div style={{fontSize:11, color:'var(--text-3)', textTransform:'uppercase', letterSpacing:0.4}}>Mean slippage</div>
          <div style={{fontSize:22, fontWeight:600, color:_bpsColor(overall.meanBps), fontFamily:'monospace'}}>{_bps(overall.meanBps)}</div>
        </div>
        <div>
          <div style={{fontSize:11, color:'var(--text-3)', textTransform:'uppercase', letterSpacing:0.4}}>Median</div>
          <div style={{fontSize:22, fontWeight:600, fontFamily:'monospace'}}>{_bps(overall.medianBps)}</div>
        </div>
        <div>
          <div style={{fontSize:11, color:'var(--text-3)', textTransform:'uppercase', letterSpacing:0.4}}>P95 (tail)</div>
          <div style={{fontSize:22, fontWeight:600, color:_bpsColor(overall.p95Bps), fontFamily:'monospace'}}>{_bps(overall.p95Bps)}</div>
        </div>
        <div>
          <div style={{fontSize:11, color:'var(--text-3)', textTransform:'uppercase', letterSpacing:0.4}}>Fills tracked</div>
          <div style={{fontSize:22, fontWeight:600, fontFamily:'monospace'}}>{overall.fills || 0}</div>
        </div>
      </section>

      {/* By strategy */}
      <section style={{background:'var(--panel, #1a1f2e)', border:'1px solid var(--border, #2a3142)', borderRadius:8, marginBottom:20, padding:14}}>
        <h3 style={{margin:'0 0 10px', fontSize:14}}>By strategy</h3>
        {Object.keys(byStrategy).length === 0 ? (
          <div style={{color:'var(--text-2)', fontSize:13}}>No fills yet.</div>
        ) : (
          <table style={{width:'100%', borderCollapse:'collapse', fontSize:13}}>
            <thead>
              <tr style={{borderBottom:'1px solid var(--border, #2a3142)', textAlign:'left', color:'var(--text-2)'}}>
                <th style={{padding:'6px 4px'}}>Strategy</th>
                <th style={{padding:'6px 4px', textAlign:'right'}}>Fills</th>
                <th style={{padding:'6px 4px', textAlign:'right'}}>Mean</th>
                <th style={{padding:'6px 4px', textAlign:'right'}}>Median</th>
                <th style={{padding:'6px 4px', textAlign:'right'}}>P95</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(byStrategy).sort((a,b) => (b[1].meanBps||0) - (a[1].meanBps||0)).map(([k, v]) => (
                <tr key={k} style={{borderBottom:'1px solid var(--border, #2a3142)'}}>
                  <td style={{padding:'6px 4px', fontWeight:600}}>{k}</td>
                  <td style={{padding:'6px 4px', textAlign:'right'}}>{v.fills || 0}</td>
                  <td style={{padding:'6px 4px', textAlign:'right', fontFamily:'monospace', color:_bpsColor(v.meanBps)}}>{_bps(v.meanBps)}</td>
                  <td style={{padding:'6px 4px', textAlign:'right', fontFamily:'monospace'}}>{_bps(v.medianBps)}</td>
                  <td style={{padding:'6px 4px', textAlign:'right', fontFamily:'monospace', color:_bpsColor(v.p95Bps)}}>{_bps(v.p95Bps)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* By symbol */}
      <section style={{background:'var(--panel, #1a1f2e)', border:'1px solid var(--border, #2a3142)', borderRadius:8, padding:14}}>
        <h3 style={{margin:'0 0 10px', fontSize:14}}>By symbol (top 20 worst)</h3>
        {Object.keys(bySymbol).length === 0 ? (
          <div style={{color:'var(--text-2)', fontSize:13}}>No fills yet.</div>
        ) : (
          <table style={{width:'100%', borderCollapse:'collapse', fontSize:13}}>
            <thead>
              <tr style={{borderBottom:'1px solid var(--border, #2a3142)', textAlign:'left', color:'var(--text-2)'}}>
                <th style={{padding:'6px 4px'}}>Symbol</th>
                <th style={{padding:'6px 4px', textAlign:'right'}}>Fills</th>
                <th style={{padding:'6px 4px', textAlign:'right'}}>Mean slippage</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(bySymbol).sort((a,b) => (b[1].meanBps||0) - (a[1].meanBps||0)).slice(0, 20).map(([s, v]) => (
                <tr key={s} style={{borderBottom:'1px solid var(--border, #2a3142)'}}>
                  <td style={{padding:'6px 4px', fontWeight:600}}>{s}</td>
                  <td style={{padding:'6px 4px', textAlign:'right'}}>{v.fills || 0}</td>
                  <td style={{padding:'6px 4px', textAlign:'right', fontFamily:'monospace', color:_bpsColor(v.meanBps)}}>{_bps(v.meanBps)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
};

})();
