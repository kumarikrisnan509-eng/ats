/* eslint-disable */
/* STP / SWP — Tier 19: live SIP manager + SWP simulator backed by /api/sip + /api/swp/simulate.
   Replaces the prior fully-hardcoded version. Spec §2 Stage 5: "SIP manager — scheduled mutual fund / direct equity / ETF investments" + "Retirement withdrawal simulator — SWP modelling, safe withdrawal rate under Indian tax regime".
*/

// T-242: Zerodha Coin SIPs panel. Reads /api/me/mf/sips (Kite Connect MF API,
// GET-only). Lets the user see their real SIPs alongside the local-ATS SIPs
// above. Modify/cancel must go through Coin -- Kite doesn't expose those over
// the API. The "Open in Coin" deeplink takes the user there directly.
const CoinSipsPanel = () => {
  const [state, setState] = React.useState({ loading: true, sips: [], summary: null, reason: null });
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/me/mf/sips', { credentials: 'include' }).then(r => r.json());
        if (cancelled) return;
        if (r.ok && r.brokerConnected) setState({ loading: false, sips: r.sips || [], summary: r.summary, reason: null });
        else setState({ loading: false, sips: [], summary: null, reason: r.reason || 'no_data' });
      } catch (e) { if (!cancelled) setState({ loading: false, sips: [], summary: null, reason: e.message }); }
    })();
    return () => { cancelled = true; };
  }, []);
  const fmtInr = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
  if (state.loading) {
    return <div style={{ padding: 12, fontSize: 12, color: 'var(--text-3)' }}>Loading Coin SIPs...</div>;
  }
  if (state.reason) {
    const niceReason = ({
      'no_broker_connected':        'Connect Zerodha in Settings -> Brokers to see your Coin SIPs here.',
      'broker_does_not_support_mf': 'Your connected broker doesn\'t expose mutual funds via API. (Currently only Zerodha Kite does.)',
    })[state.reason] || ('Could not load Coin SIPs: ' + state.reason);
    return (
      <div style={{ padding: 12, fontSize: 12, color: 'var(--text-3)', border: '1px dashed var(--border)', borderRadius: 6 }}>
        {niceReason}
      </div>
    );
  }
  if (!state.sips.length) {
    return (
      <div style={{ padding: 12, fontSize: 12, color: 'var(--text-3)', border: '1px dashed var(--border)', borderRadius: 6 }}>
        No Coin SIPs registered. Visit <a href="https://coin.zerodha.com" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--acc)' }}>coin.zerodha.com</a> to start one. It will appear here automatically.
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12, color: 'var(--text-3)', display: 'flex', justifyContent: 'space-between' }}>
        <span>From Zerodha Coin - {state.sips.length} SIP{state.sips.length === 1 ? '' : 's'} ({state.summary && state.summary.active} active)</span>
        {state.summary && state.summary.monthlyOutlay > 0 && (
          <span>Monthly outlay <b style={{ color: 'var(--text-1)' }}>{fmtInr(state.summary.monthlyOutlay)}</b></span>
        )}
      </div>
      {state.sips.map(s => (
        <div key={s.sipId} style={{
          padding: 12, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
          display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'center',
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{s.fund}</div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <span>{fmtInr(s.instalmentAmount)} {s.frequency}</span>
              {s.instalmentDay > 0 && <span>day {s.instalmentDay}</span>}
              <span>ISIN {s.isin}</span>
              {s.nextInstalment && <span>next {s.nextInstalment}</span>}
              <span style={{
                padding: '1px 6px', borderRadius: 3, fontWeight: 500,
                background: s.status === 'ACTIVE' ? 'var(--up-soft)' : s.status === 'PAUSED' ? 'var(--warn-soft)' : 'var(--bg-sunk)',
                color: s.status === 'ACTIVE' ? 'var(--up)' : s.status === 'PAUSED' ? 'var(--warn)' : 'var(--text-3)',
              }}>{s.status}</span>
            </div>
          </div>
          <a href="https://coin.zerodha.com/dashboard" target="_blank" rel="noopener noreferrer" style={{
            padding: '4px 10px', fontSize: 11, fontWeight: 500,
            background: 'var(--bg-soft)', color: 'var(--text-2)', borderRadius: 4, textDecoration: 'none',
          }}>Open in Coin -&gt;</a>
        </div>
      ))}
      <div style={{ fontSize: 10, color: 'var(--text-4)', marginTop: 4 }}>
        Source: Kite Connect MF API (read-only). Modify or cancel SIPs at coin.zerodha.com.
      </div>
    </div>
  );
};

const StpSwpScreen = () => {
  const [tab, setTab] = React.useState("sips");
  const [sips, setSips] = React.useState([]);
  const [stats, setStats] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState("");
  const [draft, setDraft] = React.useState(null);

  const refresh = React.useCallback(async () => {
    try {
      const r = await window.fetchApi('/api/sip').catch(() => null);
      if (r && r.ok) { setSips(r.sips || []); setStats(r.stats || null); }
    } catch (_e) {}
  }, []);
  React.useEffect(() => {
    refresh();
    const t = setInterval(refresh, 60000);
    return () => clearInterval(t);
  }, [refresh]);

  const fmtInr = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');

  const blankSip = () => ({
    id: null, enabled: true, name: '',
    symbol: 'NIFTYBEES', targetKind: 'etf',
    frequency: 'monthly', amountINR: 10000, dayOfMonth: 5,
    goalId: null, notes: '',
  });

  const saveAll = async (next) => {
    setBusy(true); setMsg('');
    try {
      const r = await window.fetchApi('/api/sip', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sips: next }),
      });
      if (r && r.ok) { setMsg('Saved.'); await refresh(); }
      else setMsg('Save failed: ' + ((r && r.reason) || 'unknown'));
    } catch (e) { setMsg('Save failed: ' + e.message); }
    finally { setBusy(false); setTimeout(() => setMsg(''), 3500); }
  };
  const upsertSip = async (s) => {
    const cur = sips.slice();
    if (s.id) {
      const i = cur.findIndex(x => x.id === s.id);
      if (i >= 0) cur[i] = s; else cur.push(s);
    } else cur.push(s);
    await saveAll(cur);
    setDraft(null);
  };
  const delSip = async (id) => {
    if (!confirm('Delete this SIP?')) return;
    await saveAll(sips.filter(x => x.id !== id));
  };
  const toggleSip = async (id) => {
    await saveAll(sips.map(x => x.id === id ? { ...x, enabled: !x.enabled } : x));
  };

  // SWP simulator state
  const [swp, setSwp] = React.useState({
    corpus: 50000000, annualReturnPct: 8, annualInflationPct: 6,
    monthlyWithdrawalINR: 200000, years: 25,
  });
  const [swpResult, setSwpResult] = React.useState(null);
  const [swpBusy, setSwpBusy] = React.useState(false);
  const runSwp = async () => {
    setSwpBusy(true); setSwpResult(null);
    try {
      const r = await window.fetchApi('/api/swp/simulate', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(swp),
      });
      if (r && r.ok) setSwpResult(r);
      else setSwpResult({ ok: false, reason: (r && r.reason) || 'failed' });
    } catch (e) { setSwpResult({ ok: false, reason: e.message }); }
    finally { setSwpBusy(false); }
  };

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={{ fontSize: 12, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.6 }}>Long-term plans</div>
        <div style={{ fontSize: 22, fontWeight: 600, marginTop: 2 }}>STP / SWP</div>
        <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 4 }}>
          Scheduled investments (SIPs) and inflation-adjusted withdrawal simulation (SWP) for retirement planning.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)' }}>
        {['sips', 'swp'].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '10px 16px', fontSize: 13, fontWeight: tab === t ? 600 : 400,
            background: 'transparent', color: tab === t ? 'var(--text-1)' : 'var(--text-2)',
            border: 0, borderBottom: tab === t ? '2px solid var(--acc)' : '2px solid transparent',
            marginBottom: -1, cursor: 'pointer',
          }}>
            {t === 'sips' ? `SIPs (${sips.length})` : 'SWP simulator'}
          </button>
        ))}
      </div>

      {tab === 'sips' && (
        <>
          {/* T-242: real Zerodha Coin SIPs (read-only from Kite Connect) */}
          <div style={{ paddingBottom: 12, borderBottom: '1px solid var(--border)', marginBottom: 4 }}>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Coin SIPs</div>
            <CoinSipsPanel />
          </div>
          {stats && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              <SipStat label="Active SIPs" value={`${stats.enabledSips} / ${stats.sipCount}`}/>
              <SipStat label="Monthly outflow" value={fmtInr(stats.totalMonthlyINR)}/>
              <SipStat label="Annual deployment" value={fmtInr((stats.totalMonthlyINR || 0) * 12)}/>
            </div>
          )}
          <div>
            <button onClick={() => setDraft(blankSip())} style={{
              padding: '8px 14px', fontSize: 13, fontWeight: 500,
              background: 'var(--acc)', color: 'white', border: 0, borderRadius: 6, cursor: 'pointer',
            }}>+ New SIP</button>
            {msg && <span style={{ marginLeft: 12, fontSize: 12, color: 'var(--text-2)' }}>{msg}</span>}
          </div>
          {sips.length === 0 ? (
            <div style={{ padding: 24, background: 'var(--bg-soft)', borderRadius: 8, fontSize: 13, color: 'var(--text-2)' }}>
              No SIPs yet. Add a scheduled investment to automate your long-term wealth building.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {sips.map(s => (
                <div key={s.id} style={{
                  padding: 12, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
                  display: 'grid', gridTemplateColumns: '40px 1fr auto', gap: 12, alignItems: 'center',
                }}>
                  <button onClick={() => toggleSip(s.id)} title={s.enabled ? 'Pause' : 'Enable'} style={{
                    width: 28, height: 16, borderRadius: 99, border: 0,
                    background: s.enabled ? 'var(--up)' : 'var(--text-3)', position: 'relative', cursor: 'pointer',
                  }}>
                    <span style={{ position: 'absolute', top: 2, left: s.enabled ? 14 : 2, width: 12, height: 12, borderRadius: '50%', background: 'white', transition: 'left 0.2s' }}/>
                  </button>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>
                      {s.name || s.symbol} - <b>{fmtInr(s.amountINR)}</b> {s.frequency} -&gt; <b>{s.symbol}</b>
                      <span style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 6 }}>({s.targetKind})</span>
                    </div>
                    {s.notes && <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{s.notes}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => setDraft(s)} style={sipBtn}>Edit</button>
                    <button onClick={() => delSip(s.id)} style={{ ...sipBtn, color: 'var(--down)' }}>x</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'swp' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ padding: 16, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Inputs</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
              <SipField label="Starting corpus (₹)">
                <input type="number" value={swp.corpus} onChange={e => setSwp({ ...swp, corpus: Number(e.target.value) || 0 })} style={sipInp}/>
              </SipField>
              <SipField label="Expected annual return (%)">
                <input type="number" step="0.5" value={swp.annualReturnPct} onChange={e => setSwp({ ...swp, annualReturnPct: Number(e.target.value) || 0 })} style={sipInp}/>
              </SipField>
              <SipField label="Inflation (%/yr)">
                <input type="number" step="0.5" value={swp.annualInflationPct} onChange={e => setSwp({ ...swp, annualInflationPct: Number(e.target.value) || 0 })} style={sipInp}/>
              </SipField>
              <SipField label="Monthly withdrawal today (₹)">
                <input type="number" value={swp.monthlyWithdrawalINR} onChange={e => setSwp({ ...swp, monthlyWithdrawalINR: Number(e.target.value) || 0 })} style={sipInp}/>
              </SipField>
              <SipField label="Horizon (years)">
                <input type="number" value={swp.years} onChange={e => setSwp({ ...swp, years: Number(e.target.value) || 25 })} style={sipInp}/>
              </SipField>
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <button onClick={runSwp} disabled={swpBusy} style={{
                  padding: '8px 14px', fontSize: 13, fontWeight: 500,
                  background: 'var(--acc)', color: 'white', border: 0, borderRadius: 6, cursor: swpBusy ? 'wait' : 'pointer',
                }}>{swpBusy ? 'Simulating…' : 'Run simulation'}</button>
              </div>
            </div>
          </div>

          {swpResult && swpResult.ok === false && (
            <div style={{ padding: 12, background: 'var(--down-soft)', color: 'var(--down)', borderRadius: 6, fontSize: 12 }}>
              Error: {swpResult.reason}
            </div>
          )}

          {swpResult && swpResult.isSustainable !== undefined && (
            <div style={{ padding: 16, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Result</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
                <SipStat label="Sustainable?" value={swpResult.isSustainable ? 'Yes' : 'No'} tone={swpResult.isSustainable ? 'up' : 'down'}/>
                <SipStat label="Ending balance" value={swpResult.isSustainable ? fmtInr(swpResult.endingBalance) : `Runs out in ${swpResult.runsOutInYears}y`} tone={swpResult.isSustainable ? 'up' : 'down'}/>
                <SipStat label="Sampled years" value={String(swpResult.months ? swpResult.months.length : 0)}/>
              </div>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <th style={{ textAlign: 'left', padding: '6px 0', color: 'var(--text-3)', fontWeight: 500 }}>Year</th>
                    <th style={{ textAlign: 'right', padding: '6px 0', color: 'var(--text-3)', fontWeight: 500 }}>Monthly draw</th>
                    <th style={{ textAlign: 'right', padding: '6px 0', color: 'var(--text-3)', fontWeight: 500 }}>Corpus balance</th>
                  </tr>
                </thead>
                <tbody>
                  {(swpResult.months || []).map((m, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '6px 0' }}>{Math.round(m.month / 12)}y</td>
                      <td style={{ padding: '6px 0', textAlign: 'right' }} className="mono">{fmtInr(m.withdrawal)}</td>
                      <td style={{ padding: '6px 0', textAlign: 'right' }} className="mono">{fmtInr(m.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!swpResult && (
            <div style={{ padding: 16, background: 'var(--bg-soft)', borderRadius: 8, fontSize: 12, color: 'var(--text-3)' }}>
              Click <b>Run simulation</b> to project your retirement corpus month-by-month with inflation-adjusted withdrawals.
            </div>
          )}
        </div>
      )}

      {draft && (
        <div onClick={() => setDraft(null)} style={{
          position: 'fixed', inset: 0, background: 'oklch(0% 0 0 / 0.5)', zIndex: 100,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            width: 520, padding: 24, background: 'var(--surface)',
            border: '1px solid var(--border)', borderRadius: 12, maxHeight: '90vh', overflowY: 'auto',
          }}>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>
              {draft.id ? 'Edit SIP' : 'New SIP'}
            </div>
            <SipField label="Name"><input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} style={sipInp} placeholder="e.g. Retirement core"/></SipField>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 8 }}>
              <SipField label="Symbol / scheme"><input value={draft.symbol} onChange={e => setDraft({ ...draft, symbol: e.target.value })} style={sipInp}/></SipField>
              <SipField label="Kind">
                <select value={draft.targetKind} onChange={e => setDraft({ ...draft, targetKind: e.target.value })} style={sipInp}>
                  <option value="etf">ETF</option><option value="mf">Mutual fund</option><option value="equity">Equity</option><option value="smallcase">Smallcase</option>
                </select>
              </SipField>
              <SipField label="Frequency">
                <select value={draft.frequency} onChange={e => setDraft({ ...draft, frequency: e.target.value })} style={sipInp}>
                  <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option>
                </select>
              </SipField>
              <SipField label="Amount (₹)"><input type="number" value={draft.amountINR} onChange={e => setDraft({ ...draft, amountINR: Number(e.target.value) || 0 })} style={sipInp}/></SipField>
              <SipField label="Day of month (1-28)"><input type="number" min="1" max="28" value={draft.dayOfMonth} onChange={e => setDraft({ ...draft, dayOfMonth: Number(e.target.value) || 1 })} style={sipInp}/></SipField>
            </div>
            <SipField label="Notes"><input value={draft.notes || ''} onChange={e => setDraft({ ...draft, notes: e.target.value })} style={sipInp} placeholder="optional"/></SipField>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button onClick={() => setDraft(null)} style={{ padding: '8px 14px', fontSize: 13, background: 'var(--bg-soft)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => upsertSip(draft)} disabled={busy} style={{ padding: '8px 14px', fontSize: 13, fontWeight: 500, background: 'var(--acc)', color: 'white', border: 0, borderRadius: 6, cursor: 'pointer' }}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const sipInp = { width: '100%', padding: '6px 10px', fontSize: 13, background: 'var(--bg-soft)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-1)' };
const sipBtn = { fontSize: 11, padding: '4px 10px', background: 'var(--bg-soft)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer' };
const SipField = ({ label, children }) => (
  <div style={{ marginTop: 8 }}>
    <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>{label}</div>
    {children}
  </div>
);
const SipStat = ({ label, value, tone }) => (
  <div style={{ padding: 12, background: 'var(--bg-soft)', borderRadius: 8 }}>
    <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{label}</div>
    <div style={{ fontSize: 18, fontWeight: 600, marginTop: 2, color: tone === 'up' ? 'var(--up)' : tone === 'down' ? 'var(--down)' : 'var(--text-1)' }}>{value}</div>
  </div>
);

window.StpSwpScreen = StpSwpScreen;
