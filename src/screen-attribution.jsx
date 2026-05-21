/* eslint-disable */
/* T-311 -- Daily attribution screen. Reads GET /api/me/attribution. */

const _inr = (n) => {
  if (!Number.isFinite(n)) return '-';
  const a = Math.abs(n), sign = n < 0 ? '-' : '';
  if (a >= 1e7) return `${sign}₹${(a/1e7).toFixed(2)}cr`;
  if (a >= 1e5) return `${sign}₹${(a/1e5).toFixed(2)}L`;
  if (a >= 1e3) return `${sign}₹${(a/1e3).toFixed(1)}K`;
  return `${sign}₹${a.toFixed(0)}`;
};
const _pnlColor = (n) => !Number.isFinite(n) || n === 0 ? 'var(--text-2)' : (n > 0 ? '#15803d' : '#b91c1c');
const _fmtDate = (s) => { try { return new Date(s).toLocaleDateString('en-IN'); } catch { return s; } };

window.AttributionScreen = function AttributionScreen() {
  const [data, setData] = React.useState(null);
  const [stats, setStats] = React.useState(null);
  const [err, setErr] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [days, setDays] = React.useState(30);

  const load = React.useCallback(async () => {
    try {
      const r = await fetch(`/api/me/attribution?n=${days}`).then(r => r.json());
      if (r && r.ok) { setData(r.recent || []); setStats(r.stats || null); }
      else setErr(r && r.reason);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, [days]);

  React.useEffect(() => {
    load();
    const id = setInterval(load, 5 * 60000);
    return () => clearInterval(id);
  }, [load]);

  if (loading) return <div style={{padding:24, color:'var(--text-2)'}}>Loading attribution...</div>;
  if (err) return <div style={{padding:24, color:'var(--down)'}}>Error: {String(err)}</div>;

  const rows = Array.isArray(data) ? data : [];
  const totalPnl = rows.reduce((s, r) => s + (Number(r.totalPnl) || 0), 0);

  // Aggregate by strategy
  const byStrat = {};
  for (const r of rows) {
    if (r && r.byStrategy) {
      for (const [k, v] of Object.entries(r.byStrategy)) byStrat[k] = (byStrat[k] || 0) + (Number(v) || 0);
    }
  }
  const stratRows = Object.entries(byStrat).sort((a, b) => b[1] - a[1]);

  return (
    <div style={{padding:'16px 24px', maxWidth:1200}}>
      <h2 style={{margin:'4px 0 12px', fontSize:20}}>Daily attribution</h2>

      <div style={{display:'flex', gap:24, alignItems:'baseline', marginBottom:14, fontSize:13}}>
        <div>
          <span style={{color:'var(--text-2)'}}>Total PnL (window): </span>
          <strong style={{color:_pnlColor(totalPnl), fontFamily:'monospace', fontSize:18}}>{_inr(totalPnl)}</strong>
        </div>
        <div style={{flex:1}}/>
        <select value={days} onChange={e => setDays(Number(e.target.value))} style={{padding:'2px 6px', fontSize:12, background:'var(--panel-2)', color:'var(--text-1)', border:'1px solid var(--border)', borderRadius:4}}>
          <option value={7}>7 days</option>
          <option value={30}>30 days</option>
          <option value={90}>90 days</option>
        </select>
      </div>

      {/* By strategy summary */}
      <section style={{background:'var(--panel, #1a1f2e)', border:'1px solid var(--border, #2a3142)', borderRadius:8, marginBottom:20, padding:14}}>
        <h3 style={{margin:'0 0 10px', fontSize:14}}>PnL by strategy ({stratRows.length})</h3>
        {stratRows.length === 0 ? (
          <div style={{color:'var(--text-2)', fontSize:13}}>No attribution snapshots yet (cron runs at 16:00 IST after close).</div>
        ) : (
          <table style={{width:'100%', borderCollapse:'collapse', fontSize:13}}>
            <thead>
              <tr style={{borderBottom:'1px solid var(--border, #2a3142)', textAlign:'left', color:'var(--text-2)'}}>
                <th style={{padding:'6px 4px'}}>Strategy</th>
                <th style={{padding:'6px 4px', textAlign:'right'}}>PnL (window)</th>
                <th style={{padding:'6px 4px', textAlign:'right'}}>Share</th>
              </tr>
            </thead>
            <tbody>
              {stratRows.map(([s, p]) => (
                <tr key={s} style={{borderBottom:'1px solid var(--border, #2a3142)'}}>
                  <td style={{padding:'6px 4px', fontWeight:600}}>{s}</td>
                  <td style={{padding:'6px 4px', textAlign:'right', fontFamily:'monospace', color:_pnlColor(p)}}>{_inr(p)}</td>
                  <td style={{padding:'6px 4px', textAlign:'right', color:'var(--text-3)'}}>{totalPnl !== 0 ? `${(p / totalPnl * 100).toFixed(1)}%` : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Daily rows */}
      <section style={{background:'var(--panel, #1a1f2e)', border:'1px solid var(--border, #2a3142)', borderRadius:8, padding:14}}>
        <h3 style={{margin:'0 0 10px', fontSize:14}}>Daily snapshots</h3>
        {rows.length === 0 ? (
          <div style={{color:'var(--text-2)', fontSize:13}}>No data.</div>
        ) : (
          <table style={{width:'100%', borderCollapse:'collapse', fontSize:13}}>
            <thead>
              <tr style={{borderBottom:'1px solid var(--border, #2a3142)', textAlign:'left', color:'var(--text-2)'}}>
                <th style={{padding:'6px 4px'}}>Date</th>
                <th style={{padding:'6px 4px'}}>Regime</th>
                <th style={{padding:'6px 4px', textAlign:'right'}}>PnL</th>
                <th style={{padding:'6px 4px', textAlign:'right'}}>Trades</th>
                <th style={{padding:'6px 4px', textAlign:'right'}}>Skipped</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} style={{borderBottom:'1px solid var(--border, #2a3142)'}}>
                  <td style={{padding:'6px 4px'}}>{_fmtDate(r.date)}</td>
                  <td style={{padding:'6px 4px', fontSize:11}}>{r.regime || '-'}</td>
                  <td style={{padding:'6px 4px', textAlign:'right', fontFamily:'monospace', color:_pnlColor(r.totalPnl)}}>{_inr(r.totalPnl)}</td>
                  <td style={{padding:'6px 4px', textAlign:'right'}}>{r.trades || 0}</td>
                  <td style={{padding:'6px 4px', textAlign:'right', color:'var(--text-3)'}}>{r.skipped || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
};
