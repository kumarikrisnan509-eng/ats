/* eslint-disable */
// @ts-check
/* T-302a/T-303a -- Signal calibration + auto-retire recommendation screen.
 * Read-only. Surfaces /api/me/calibration + /api/me/recommend-retire.
 * Recommendations are advisory -- engine still respects operator's
 * activeStrategies list in risk-config.
 */


/** @typedef {import('../types/api-shapes').CalibrationResponse}     CalibrationResponse */
/** @typedef {import('../types/api-shapes').RecommendRetireResponse} RecommendRetireResponse */

(function () {
  // T-274c HOTFIX: IIFE wrapper so per-file helpers (_inrCal, _fmtTime, etc.)
  // do not collide with same-named consts in other screen-*.js files.
const _pctCal = (n) => n == null ? '-' : `${(n * 100).toFixed(1)}%`;
const _inrCal = (n) => {
  if (!Number.isFinite(n)) return '-';
  const a = Math.abs(n), sign = n < 0 ? '-' : '';
  if (a >= 1e5) return `${sign}₹${(a/1e5).toFixed(2)}L`;
  if (a >= 1e3) return `${sign}₹${(a/1e3).toFixed(1)}K`;
  return `${sign}₹${a.toFixed(0)}`;
};
const _pnlColorCal = (n) => !Number.isFinite(n) || n === 0 ? 'var(--text-2)' : (n > 0 ? '#15803d' : '#b91c1c');
const _badgeCal = (rec) => ({ retire: '#b91c1c', watch: '#f59e0b', keep: '#15803d' })[rec] || '#94a3b8';

window.CalibrationScreen = function CalibrationScreen() {
  const [calibration, setCalibration] = React.useState([]);
  const [recommendation, setRecommendation] = React.useState(null);
  const [err, setErr] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [days, setDays] = React.useState(30);

  const load = React.useCallback(async () => {
    try {
      const [c, r] = await Promise.all([
        fetch(`/api/me/calibration?windowDays=${days}`).then(r => r.json()),
        fetch(`/api/me/recommend-retire?windowDays=${days}`).then(r => r.json()),
      ]);
      if (c && c.ok) setCalibration(c.calibration || []);
      if (r && r.ok) setRecommendation(r);
      if ((c && !c.ok) || (r && !r.ok)) setErr((c && c.reason) || (r && r.reason));
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, [days]);

  React.useEffect(() => {
    load();
    const id = setInterval(load, 5 * 60000);
    return () => clearInterval(id);
  }, [load]);

  if (loading) return <div style={{padding:24, color:'var(--text-2)'}}>Loading calibration...</div>;
  if (err) return <div style={{padding:24, color:'var(--down)'}}>Error: {String(err)}</div>;

  const flat = recommendation
    ? [...recommendation.retire, ...recommendation.watch, ...recommendation.keep]
    : calibration.map(s => ({ ...s, recommendation: 'keep', reason: '-' }));

  return (
    <div style={{padding:'16px 24px', maxWidth:1200}}>
      <h2 style={{margin:'4px 0 12px', fontSize:20}}>Strategy calibration <span style={{fontSize:13, color:'var(--text-3)', fontWeight:400}}>(advisory only)</span></h2>

      <div style={{padding:'10px 12px', background:'var(--panel-2, #11151f)', border:'1px solid var(--border, #2a3142)', borderRadius:6, marginBottom:14, fontSize:12, color:'var(--text-2)', lineHeight:1.5}}>
        Recommendations below are <strong>NEVER enforced automatically</strong>. The engine
        still respects your <code>activeStrategies</code> list in the Risk management page.
        To act on a "retire" recommendation, manually remove the strategy from your active
        list. Window: last <strong>{days}</strong> days of closed trades.
      </div>

      <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:14}}>
        {recommendation && recommendation.summary && (
          <div style={{display:'flex', gap:18, fontSize:13}}>
            <span><strong style={{color:'#b91c1c'}}>{recommendation.summary.retire}</strong> retire</span>
            <span><strong style={{color:'#f59e0b'}}>{recommendation.summary.watch}</strong> watch</span>
            <span><strong style={{color:'#15803d'}}>{recommendation.summary.keep}</strong> keep</span>
          </div>
        )}
        <select value={days} onChange={e => setDays(Number(e.target.value))} style={{padding:'2px 6px', fontSize:12, background:'var(--panel-2)', color:'var(--text-1)', border:'1px solid var(--border)', borderRadius:4}}>
          <option value={7}>7 days</option>
          <option value={30}>30 days</option>
          <option value={90}>90 days</option>
          <option value={180}>180 days</option>
        </select>
      </div>

      {flat.length === 0 ? (
        <div style={{padding:32, textAlign:'center', color:'var(--text-2)'}}>
          No closed trades in this window. Calibration needs ≥1 closed trade per strategy
          (and ≥20 for a real recommendation).
        </div>
      ) : (
        <table style={{width:'100%', borderCollapse:'collapse', fontSize:13}}>
          <thead>
            <tr style={{borderBottom:'1px solid var(--border, #2a3142)', textAlign:'left', color:'var(--text-2)'}}>
              <th style={{padding:'6px 4px'}}>Strategy</th>
              <th style={{padding:'6px 4px'}}>Recommendation</th>
              <th style={{padding:'6px 4px', textAlign:'right'}}>Trades</th>
              <th style={{padding:'6px 4px', textAlign:'right'}}>Wins / Losses</th>
              <th style={{padding:'6px 4px', textAlign:'right'}}>Hit rate</th>
              <th style={{padding:'6px 4px', textAlign:'right'}}>Avg PnL</th>
              <th style={{padding:'6px 4px', textAlign:'right'}}>Total PnL</th>
              <th style={{padding:'6px 4px', textAlign:'right'}}>Max consec L</th>
              <th style={{padding:'6px 4px'}}>Reason</th>
            </tr>
          </thead>
          <tbody>
            {flat.map(s => (
              <tr key={s.strategy} style={{borderBottom:'1px solid var(--border, #2a3142)'}}>
                <td style={{padding:'6px 4px', fontWeight:600}}>{s.strategy}</td>
                <td style={{padding:'6px 4px'}}>
                  <span style={{
                    display:'inline-block', padding:'2px 8px', borderRadius:4, fontSize:11, fontWeight:600,
                    background: _badgeCal(s.recommendation) + '22', color: _badgeCal(s.recommendation),
                  }}>{(s.recommendation || 'keep').toUpperCase()}</span>
                </td>
                <td style={{padding:'6px 4px', textAlign:'right'}}>{s.trades}</td>
                <td style={{padding:'6px 4px', textAlign:'right', fontFamily:'monospace', fontSize:12}}>{s.wins}/{s.losses}</td>
                <td style={{padding:'6px 4px', textAlign:'right', fontFamily:'monospace'}}>{_pctCal(s.hitRate)}</td>
                <td style={{padding:'6px 4px', textAlign:'right', fontFamily:'monospace', color:_pnlColorCal(s.avgPnl)}}>{s.avgPnl != null ? _inrCal(s.avgPnl) : '-'}</td>
                <td style={{padding:'6px 4px', textAlign:'right', fontFamily:'monospace', color:_pnlColorCal(s.totalPnl)}}>{_inrCal(s.totalPnl)}</td>
                <td style={{padding:'6px 4px', textAlign:'right'}}>{s.maxConsecutiveLosses || 0}</td>
                <td style={{padding:'6px 4px', fontSize:11, color:'var(--text-3)'}}>{s.reason || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

})();
