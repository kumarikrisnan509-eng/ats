/* eslint-disable */
/* T-280c -- Macro signals (NSE FII/DII, breadth, 52w highs/lows) screen.
 * Read-only. Reads latest row from macro_signals via /api/me/macro-signals.
 * Feeds into the regime classifier's confidence/regime (T-280b).
 */

const _fmtTime = (s) => {
  if (!s) return '-';
  try { return new Date(s).toLocaleString('en-IN', { hour12: false }); } catch { return s; }
};
const _fmt = (n, places = 2) => Number.isFinite(n) ? n.toFixed(places) : '-';
const _flowColor = (n) => !Number.isFinite(n) || n === 0 ? 'var(--text-2)' : (n > 0 ? '#15803d' : '#b91c1c');
const _breadthColor = (n) => {
  if (!Number.isFinite(n)) return 'var(--text-2)';
  if (n > 1.5) return '#15803d';
  if (n < 0.67) return '#b91c1c';
  return '#f59e0b';
};

window.MacroSignalsScreen = function MacroSignalsScreen() {
  const [data, setData] = React.useState(null);
  const [err, setErr] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const r = await fetch('/api/me/macro-signals').then(r => r.json());
      if (r && r.ok) setData(r);
      else setErr(r && r.reason);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, []);

  React.useEffect(() => {
    load();
    const id = setInterval(load, 5 * 60000);
    return () => clearInterval(id);
  }, [load]);

  const manualRefresh = async () => {
    setRefreshing(true);
    try {
      await fetch('/api/me/macro-signals/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window._csrfToken || '' },
      });
      await load();
    } catch (e) { setErr(e.message); }
    finally { setRefreshing(false); }
  };

  if (loading) return <div style={{padding:24, color:'var(--text-2)'}}>Loading macro signals...</div>;
  if (err) return <div style={{padding:24, color:'var(--down)'}}>Error: {String(err)}</div>;

  const latest = data && data.latest;
  const enabled = data && data.fetcherEnabled;
  const errors = latest && latest.errorsJson ? (() => { try { return JSON.parse(latest.errorsJson); } catch { return []; } })() : [];

  return (
    <div style={{padding:'16px 24px', maxWidth:900}}>
      <h2 style={{margin:'4px 0 12px', fontSize:20}}>Macro signals
        <span style={{fontSize:12, color:'var(--text-3)', fontWeight:400, marginLeft:8}}>
          (NSE public — feeds regime detector)
        </span>
      </h2>

      <div style={{padding:'10px 14px', marginBottom:16, borderRadius:8, background:'var(--panel-2, #11151f)', border:'1px solid var(--border, #2a3142)', display:'flex', gap:18, alignItems:'center', fontSize:12, color:'var(--text-2)'}}>
        <div>
          <strong>Fetcher:</strong>{' '}
          <span style={{color: enabled ? '#15803d' : '#94a3b8'}}>
            {enabled ? 'ENABLED (NSE_MACRO_FETCH_ENABLED=true)' : 'OFF (env)'}
          </span>
        </div>
        <div>
          <strong>Last fetch:</strong> {_fmtTime(latest && latest.fetchedAt)}
        </div>
        <div style={{flex:1}}/>
        <button
          onClick={manualRefresh}
          disabled={refreshing}
          style={{padding:'4px 12px', background:'var(--panel, #1a1f2e)', border:'1px solid var(--border, #2a3142)', color:'var(--text-1)', borderRadius:4, cursor: refreshing ? 'wait' : 'pointer', fontSize:12}}
        >{refreshing ? 'fetching...' : 'Refresh now'}</button>
      </div>

      {!latest ? (
        <div style={{padding:32, textAlign:'center', color:'var(--text-2)'}}>
          No macro signals fetched yet. Click "Refresh now" or set
          <code style={{margin:'0 4px'}}>NSE_MACRO_FETCH_ENABLED=true</code>
          on the VM to start the daily cron.
        </div>
      ) : (
        <>
          <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))', gap:12, marginBottom:18}}>
            <div style={{padding:14, background:'var(--panel, #1a1f2e)', border:'1px solid var(--border, #2a3142)', borderRadius:8}}>
              <div style={{fontSize:11, color:'var(--text-3)', textTransform:'uppercase', letterSpacing:0.4}}>FII / FPI net flow</div>
              <div style={{fontSize:24, fontWeight:600, fontFamily:'monospace', color:_flowColor(latest.fiiNetFlow)}}>
                {latest.fiiNetFlow != null ? `${latest.fiiNetFlow > 0 ? '+' : ''}${_fmt(latest.fiiNetFlow)} cr` : '-'}
              </div>
              <div style={{fontSize:11, color:'var(--text-3)', marginTop:4}}>
                {latest.fiiNetFlow > 500 ? 'strong buying (+1 to richScore)' :
                 latest.fiiNetFlow < -500 ? 'strong selling (-1 to richScore)' : 'neutral / mild'}
              </div>
            </div>

            <div style={{padding:14, background:'var(--panel, #1a1f2e)', border:'1px solid var(--border, #2a3142)', borderRadius:8}}>
              <div style={{fontSize:11, color:'var(--text-3)', textTransform:'uppercase', letterSpacing:0.4}}>Market breadth (NIFTY 500)</div>
              <div style={{fontSize:24, fontWeight:600, fontFamily:'monospace', color:_breadthColor(latest.marketBreadth)}}>
                {_fmt(latest.marketBreadth, 2)}
              </div>
              <div style={{fontSize:11, color:'var(--text-3)', marginTop:4}}>
                advancers / decliners ratio. &gt;1.5 bullish, &lt;0.67 bearish.
              </div>
            </div>

            <div style={{padding:14, background:'var(--panel, #1a1f2e)', border:'1px solid var(--border, #2a3142)', borderRadius:8, opacity: latest.highLowRatio == null ? 0.6 : 1}}>
              <div style={{fontSize:11, color:'var(--text-3)', textTransform:'uppercase', letterSpacing:0.4}}>52w highs : lows</div>
              <div style={{fontSize:24, fontWeight:600, fontFamily:'monospace'}}>
                {_fmt(latest.highLowRatio, 2)}
              </div>
              <div style={{fontSize:11, color:'var(--text-3)', marginTop:4}}>
                NSE endpoint retired (Jan 2026); awaiting alternate source.
              </div>
            </div>
          </div>

          {errors.length > 0 && (
            <div style={{padding:'10px 14px', background:'rgba(245, 158, 11, 0.08)', border:'1px solid rgba(245, 158, 11, 0.4)', borderRadius:6, fontSize:12, color:'var(--text-2)'}}>
              <strong style={{color:'#f59e0b'}}>Fetch errors:</strong>
              <ul style={{margin:'4px 0 0 16px', padding:0}}>
                {errors.map((e, i) => <li key={i}>{String(e)}</li>)}
              </ul>
            </div>
          )}

          <div style={{marginTop:18, padding:'10px 14px', background:'var(--panel-2, #11151f)', border:'1px solid var(--border, #2a3142)', borderRadius:6, fontSize:11, color:'var(--text-3)', lineHeight:1.6}}>
            <strong>How this is used:</strong> Each non-null signal contributes ±1 to a
            "richScore". The regime detector (T-280b) uses richScore to boost confidence
            of the existing classification (NIFTY+VIX+ATR%-based) or flip a flat-neutral
            market to bull/bear when score ≥ 2 or ≤ -2. Extreme bearish (richScore ≤ -3)
            triggers the crisis tier. The signals are ADVISORY -- they don't fire orders
            on their own.
          </div>
        </>
      )}
    </div>
  );
};
