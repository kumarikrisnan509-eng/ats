/* eslint-disable */
// @ts-check
/* T-310 -- SIP plan + history screen.
 * Reads GET /api/sip/plan + /api/sip/history. Read-only -- no mutations.
 */


/** @typedef {import('../types/api-shapes').SipPlanResponse}    SipPlanResponse */
/** @typedef {import('../types/api-shapes').SipHistoryResponse} SipHistoryResponse */

(function () {
  // T-274c HOTFIX: IIFE wrapper so per-file helpers (_inrSip, _fmtTime, etc.)
  // do not collide with same-named consts in other screen-*.js files.
const _inrSip = (n) => {
  if (!Number.isFinite(n)) return '-';
  const a = Math.abs(n), sign = n < 0 ? '-' : '';
  if (a >= 1e7) return `${sign}₹${(a/1e7).toFixed(2)}cr`;
  if (a >= 1e5) return `${sign}₹${(a/1e5).toFixed(2)}L`;
  if (a >= 1e3) return `${sign}₹${(a/1e3).toFixed(1)}K`;
  return `${sign}₹${a.toFixed(0)}`;
};
const _fmtDateSip = (s) => { try { return new Date(s).toLocaleString('en-IN', { hour12: false }); } catch { return s || '-'; } };

const _statusColor = (s) => ({ placed: '#15803d', failed: '#b91c1c', skipped: '#94a3b8' })[s] || '#94a3b8';

window.SipScreen = function SipScreen() {
  const [plan, setPlan] = React.useState(null);
  const [stats, setStats] = React.useState(null);
  const [history, setHistory] = React.useState([]);
  const [err, setErr] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [days, setDays] = React.useState(30);

  const load = React.useCallback(async () => {
    try {
      const [p, h] = await Promise.all([
        /** @type {Promise<SipPlanResponse>} */ (fetch('/api/sip/plan').then(r => r.json())),
        /** @type {Promise<SipHistoryResponse>} */ (fetch(`/api/sip/history?days=${days}`).then(r => r.json())),
      ]);
      if (p && p.ok) { setPlan(p.plan); setStats(p.stats); } else setErr(p && p.reason);
      if (h && h.ok) setHistory(h.history || []);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, [days]);

  React.useEffect(() => {
    load();
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, [load]);

  if (loading) return <div style={{padding:24, color:'var(--text-2)'}}>Loading SIP data...</div>;
  if (err) return <div style={{padding:24, color:'var(--down, #b91c1c)'}}>Error: {String(err)}</div>;

  const planRows = plan && Array.isArray(plan.rows) ? plan.rows : [];
  const planTotal = planRows.reduce((s, r) => s + (Number(r.amount) || 0), 0);

  return (
    <div style={{padding:'16px 24px', maxWidth:1200}}>
      <h2 style={{margin:'4px 0 12px', fontSize:20}}>SIP plan + history</h2>

      {/* Today's plan */}
      <section style={{background:'var(--panel, #1a1f2e)', border:'1px solid var(--border, #2a3142)', borderRadius:8, marginBottom:20, padding:14}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:10}}>
          <h3 style={{margin:0, fontSize:14}}>Today's plan</h3>
          <span style={{color:'var(--text-2)', fontSize:12}}>{plan && plan.fireDate ? _fmtDateSip(plan.fireDate) : 'n/a'}</span>
        </div>
        {planRows.length === 0 ? (
          <div style={{color:'var(--text-2)', fontSize:13}}>No SIPs configured (set up via Risk management page).</div>
        ) : (
          <table style={{width:'100%', borderCollapse:'collapse', fontSize:13}}>
            <thead>
              <tr style={{borderBottom:'1px solid var(--border, #2a3142)', textAlign:'left', color:'var(--text-2)'}}>
                <th style={{padding:'6px 4px'}}>Symbol</th>
                <th style={{padding:'6px 4px', textAlign:'right'}}>Allocation %</th>
                <th style={{padding:'6px 4px', textAlign:'right'}}>Amount</th>
                <th style={{padding:'6px 4px', textAlign:'right'}}>Est. qty</th>
                <th style={{padding:'6px 4px'}}>Status (today)</th>
                <th style={{padding:'6px 4px'}}>Reason</th>
              </tr>
            </thead>
            <tbody>
              {planRows.map((r, i) => (
                <tr key={i} style={{borderBottom:'1px solid var(--border, #2a3142)'}}>
                  <td style={{padding:'6px 4px', fontWeight:600}}>{r.symbol}</td>
                  <td style={{padding:'6px 4px', textAlign:'right'}}>{Number(r.allocationPct || 0).toFixed(1)}%</td>
                  <td style={{padding:'6px 4px', textAlign:'right', fontFamily:'monospace'}}>{_inrSip(r.amount)}</td>
                  <td style={{padding:'6px 4px', textAlign:'right', fontFamily:'monospace'}}>{Number.isFinite(r.qty) ? r.qty : '-'}</td>
                  <td style={{padding:'6px 4px', color:_statusColor(r.status)}}>{r.status || '-'}</td>
                  <td style={{padding:'6px 4px', color:'var(--text-3)', fontSize:11}}>{r.reason || ''}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={2} style={{padding:'6px 4px', fontWeight:600, color:'var(--text-2)'}}>Total</td>
                <td style={{padding:'6px 4px', textAlign:'right', fontFamily:'monospace', fontWeight:600}}>{_inrSip(planTotal)}</td>
              </tr>
            </tbody>
          </table>
        )}
        {stats && (
          <div style={{marginTop:12, fontSize:11, color:'var(--text-3)'}}>
            Runner armed: {stats.timerArmed ? 'yes' : 'no'} · last tick {_fmtDateSip(stats.lastTickAt)}
          </div>
        )}
      </section>

      {/* History */}
      <section style={{background:'var(--panel, #1a1f2e)', border:'1px solid var(--border, #2a3142)', borderRadius:8, padding:14}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:10}}>
          <h3 style={{margin:0, fontSize:14}}>Recent fires ({history.length})</h3>
          <select value={days} onChange={e => setDays(Number(e.target.value))} style={{padding:'2px 6px', fontSize:12, background:'var(--panel-2, #11151f)', color:'var(--text-1)', border:'1px solid var(--border, #2a3142)', borderRadius:4}}>
            <option value={7}>last 7 days</option>
            <option value={30}>last 30 days</option>
            <option value={90}>last 90 days</option>
            <option value={365}>last year</option>
          </select>
        </div>
        {history.length === 0 ? (
          <div style={{color:'var(--text-2)', fontSize:13}}>No SIP fires recorded in this window.</div>
        ) : (
          <table style={{width:'100%', borderCollapse:'collapse', fontSize:13}}>
            <thead>
              <tr style={{borderBottom:'1px solid var(--border, #2a3142)', textAlign:'left', color:'var(--text-2)'}}>
                <th style={{padding:'6px 4px'}}>When</th>
                <th style={{padding:'6px 4px'}}>Symbol</th>
                <th style={{padding:'6px 4px', textAlign:'right'}}>Amount</th>
                <th style={{padding:'6px 4px', textAlign:'right'}}>Alloc %</th>
                <th style={{padding:'6px 4px'}}>Status</th>
                <th style={{padding:'6px 4px'}}>Order id</th>
                <th style={{padding:'6px 4px'}}>Reason</th>
              </tr>
            </thead>
            <tbody>
              {history.map(h => (
                <tr key={h.id} style={{borderBottom:'1px solid var(--border, #2a3142)'}}>
                  <td style={{padding:'6px 4px', whiteSpace:'nowrap'}}>{_fmtDateSip(h.fired_at)}</td>
                  <td style={{padding:'6px 4px', fontWeight:600}}>{h.symbol}</td>
                  <td style={{padding:'6px 4px', textAlign:'right', fontFamily:'monospace'}}>{_inrSip(h.amount_inr)}</td>
                  <td style={{padding:'6px 4px', textAlign:'right'}}>{Number(h.allocation_pct).toFixed(1)}%</td>
                  <td style={{padding:'6px 4px', color:_statusColor(h.status), fontWeight:600}}>{h.status}</td>
                  <td style={{padding:'6px 4px', fontFamily:'monospace', fontSize:11, color:'var(--text-3)'}}>{h.order_id || '-'}</td>
                  <td style={{padding:'6px 4px', color:'var(--text-3)', fontSize:11}}>{h.reason || ''}</td>
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
