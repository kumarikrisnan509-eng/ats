/* eslint-disable */
// @ts-check
/* T-298c -- Options opportunities (SHADOW MODE) screen.
 *
 * Read-only surface for the option_opportunities table populated by the
 * scanner in shadow mode. Lets the operator review what the regime-aware
 * strategy selector is proposing -- WITHOUT any path to actually placing
 * those trades. Promotion to a real (paper or live) order is deliberately
 * not in this screen; the operator copies the legs into the existing
 * orders flow if they decide to act.
 *
 * Sections:
 *   1. Status banner: scanner enabled? fetcher enabled? counts.
 *   2. Opportunity list: most recent first, grouped by regime + template.
 *   3. Per-row expand: shows full JSON of the opportunity (legs, scores).
 *   4. Operator can mark a row reviewed (with optional note).
 *
 * Refreshes every 30s via setInterval. No mutating actions besides the
 * /:id/review POST.
 */


/** @typedef {import('../types/api-shapes').OptionScannerStatusResponse} OptionScannerStatusResponse */
/** @typedef {import('../types/api-shapes').OptionOpportunitiesResponse} OptionOpportunitiesResponse */

(function () {
  // T-274c HOTFIX: IIFE wrapper so per-file helpers (_inr, _fmtTimeOpt, etc.)
  // do not collide with same-named consts in other screen-*.js files.
const _fmtTimeOpt = (s) => {
  if (!s) return '-';
  try { return new Date(s).toLocaleString('en-IN', { hour12: false }); } catch { return s; }
};
const _fmtScore = (n) => Number.isFinite(n) ? n.toFixed(4) : '-';

const TEMPLATE_LABELS = {
  iron_condor:       'Iron Condor',
  bull_call_spread:  'Bull Call Spread',
  bear_put_spread:   'Bear Put Spread',
  covered_call:      'Covered Call',
};

const REGIME_COLOURS = {
  bull:     '#15803d',
  bear:     '#b91c1c',
  neutral:  '#0ea5e9',
  volatile: '#f59e0b',
  crisis:   '#7c2d12',
  unknown:  '#94a3b8',
};

window.OptionsOpportunitiesScreen = function OptionsOpportunitiesScreen() {
  const [status, setStatus] = React.useState(null);
  const [opps, setOpps] = React.useState([]);
  const [expanded, setExpanded] = React.useState({});
  const [reviewing, setReviewing] = React.useState(null);
  const [reviewNote, setReviewNote] = React.useState('');
  const [err, setErr] = React.useState(null);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    try {
      const [s, o] = await Promise.all([
        /** @type {Promise<OptionScannerStatusResponse>} */ (fetch('/api/options/scanner/status').then(r => r.json())),
        /** @type {Promise<OptionOpportunitiesResponse>} */ (fetch('/api/options/opportunities?limit=50').then(r => r.json())),
      ]);
      if (s && s.ok) setStatus(s);
      if (o && o.ok) setOpps(o.opportunities || []);
      else if (o && !o.ok) setErr(o.reason);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  const review = async (id) => {
    try {
      const r = await fetch(`/api/options/opportunities/${id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window._csrfToken || '' },
        body: JSON.stringify({ note: reviewNote || null }),
      }).then(r => r.json());
      if (r && r.ok) {
        setReviewing(null);
        setReviewNote('');
        load();
      }
    } catch (e) { setErr(e.message); }
  };

  if (loading) return <div style={{padding:24, color:'var(--text-2)'}}>Loading...</div>;
  if (err) return <div style={{padding:24, color:'var(--down, #b91c1c)'}}>Error: {String(err)}</div>;

  const reviewedCount = opps.filter(o => o.reviewed).length;
  const unreviewedCount = opps.length - reviewedCount;

  return (
    <div style={{padding:'16px 24px', maxWidth:1200}}>
      <h2 style={{margin:'4px 0 12px', fontSize:20}}>Options opportunities (SHADOW)</h2>

      {/* Status banner */}
      <div style={{
        padding:'10px 14px', marginBottom:16, borderRadius:8,
        background:'var(--panel, #1a1f2e)', border:'1px solid var(--border, #2a3142)',
        display:'flex', flexWrap:'wrap', gap:24, alignItems:'center',
      }}>
        <div>
          <span style={{color:'var(--text-2)', fontSize:12}}>Scanner</span>
          <div style={{fontWeight:600, color: status && status.scannerEnabled ? '#15803d' : '#94a3b8'}}>
            {status && status.scannerEnabled ? 'ENABLED' : 'OFF (env)'}
          </div>
        </div>
        <div>
          <span style={{color:'var(--text-2)', fontSize:12}}>Fetcher</span>
          <div style={{fontWeight:600, color: status && status.fetcherEnabled ? '#15803d' : '#94a3b8'}}>
            {status && status.fetcherEnabled ? 'ENABLED' : 'OFF (env)'}
          </div>
        </div>
        <div>
          <span style={{color:'var(--text-2)', fontSize:12}}>Total opportunities</span>
          <div style={{fontWeight:600}}>{opps.length}</div>
        </div>
        <div>
          <span style={{color:'var(--text-2)', fontSize:12}}>Unreviewed</span>
          <div style={{fontWeight:600, color: unreviewedCount > 0 ? '#f59e0b' : '#94a3b8'}}>{unreviewedCount}</div>
        </div>
        <div style={{flex:1}}/>
        <div style={{color:'var(--text-2)', fontSize:11, maxWidth:380, textAlign:'right'}}>
          {(status && status.note) || 'Read-only log of scanner-proposed trades. No orders are placed from this screen.'}
        </div>
      </div>

      {opps.length === 0 ? (
        <div style={{padding:32, textAlign:'center', color:'var(--text-2)'}}>
          No opportunities logged yet. Scanner runs after each autorun cycle
          when OPTIONS_AUTORUN_ENABLED is set and option_quotes has data for
          the configured underlyings.
        </div>
      ) : (
        <table style={{width:'100%', borderCollapse:'collapse', fontSize:13}}>
          <thead>
            <tr style={{borderBottom:'1px solid var(--border, #2a3142)', color:'var(--text-2)', textAlign:'left'}}>
              <th style={{padding:'8px 6px'}}>Scanned</th>
              <th style={{padding:'8px 6px'}}>Regime</th>
              <th style={{padding:'8px 6px'}}>Underlying</th>
              <th style={{padding:'8px 6px'}}>Template</th>
              <th style={{padding:'8px 6px', textAlign:'right'}}>Score</th>
              <th style={{padding:'8px 6px'}}>Status</th>
              <th style={{padding:'8px 6px', width:60}}></th>
            </tr>
          </thead>
          <tbody>
            {opps.map(o => {
              const isOpen = expanded[o.id];
              let opp = null;
              try { opp = JSON.parse(o.opportunityJson); } catch {}
              return (
                <React.Fragment key={o.id}>
                  <tr style={{borderBottom:'1px solid var(--border, #2a3142)', opacity: o.reviewed ? 0.55 : 1}}>
                    <td style={{padding:'8px 6px', whiteSpace:'nowrap'}}>{_fmtTimeOpt(o.scannedAt)}</td>
                    <td style={{padding:'8px 6px'}}>
                      <span style={{
                        display:'inline-block', padding:'2px 8px', borderRadius:4, fontSize:11,
                        background: (REGIME_COLOURS[o.regime] || '#94a3b8') + '22',
                        color: REGIME_COLOURS[o.regime] || '#94a3b8',
                        fontWeight:600,
                      }}>{o.regime}</span>
                      {o.regimeConfidence != null && (
                        <span style={{marginLeft:6, color:'var(--text-2)', fontSize:11}}>
                          {(o.regimeConfidence * 100).toFixed(0)}%
                        </span>
                      )}
                    </td>
                    <td style={{padding:'8px 6px', fontWeight:600}}>{o.underlying}</td>
                    <td style={{padding:'8px 6px'}}>{TEMPLATE_LABELS[o.template] || o.template}</td>
                    <td style={{padding:'8px 6px', textAlign:'right', fontFamily:'monospace'}}>{_fmtScore(o.score)}</td>
                    <td style={{padding:'8px 6px', fontSize:12}}>
                      {o.reviewed ? (
                        <span style={{color:'#15803d'}}>reviewed</span>
                      ) : (
                        <span style={{color:'#f59e0b'}}>new</span>
                      )}
                    </td>
                    <td style={{padding:'8px 6px'}}>
                      <button
                        onClick={() => setExpanded(e => ({...e, [o.id]: !e[o.id]}))}
                        style={{background:'transparent', border:'1px solid var(--border, #2a3142)', color:'var(--text-1)', borderRadius:4, padding:'2px 8px', cursor:'pointer', fontSize:11}}
                      >{isOpen ? 'hide' : 'view'}</button>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={7} style={{padding:'12px 16px', background:'var(--panel-2, #11151f)', fontFamily:'monospace', fontSize:11, whiteSpace:'pre-wrap'}}>
                        {opp ? JSON.stringify(opp, null, 2) : '(failed to parse)'}
                        {!o.reviewed && (
                          <div style={{marginTop:12, paddingTop:12, borderTop:'1px solid var(--border, #2a3142)'}}>
                            {reviewing === o.id ? (
                              <div style={{display:'flex', gap:8, alignItems:'center'}}>
                                <input
                                  type="text" placeholder="Review note (optional)"
                                  value={reviewNote} onChange={e => setReviewNote(e.target.value)}
                                  style={{flex:1, padding:'4px 8px', background:'var(--panel, #1a1f2e)', border:'1px solid var(--border, #2a3142)', color:'var(--text-1)', borderRadius:4}}
                                />
                                <button onClick={() => review(o.id)} style={{padding:'4px 12px', cursor:'pointer'}}>Mark reviewed</button>
                                <button onClick={() => { setReviewing(null); setReviewNote(''); }} style={{padding:'4px 12px', cursor:'pointer'}}>Cancel</button>
                              </div>
                            ) : (
                              <button onClick={() => setReviewing(o.id)} style={{padding:'4px 12px', cursor:'pointer'}}>Mark reviewed</button>
                            )}
                          </div>
                        )}
                        {o.reviewed && o.reviewedNote && (
                          <div style={{marginTop:8, color:'var(--text-2)', fontSize:11}}>
                            <strong>Note:</strong> {o.reviewedNote}
                            <br/><strong>At:</strong> {_fmtTimeOpt(o.reviewedAt)}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
};

})();
