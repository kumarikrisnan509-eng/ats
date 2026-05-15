/* eslint-disable */
/* Fixed income & REITs — Tier 21: live from /api/bonds + /api/reits.
   Replaces the prior fully-hardcoded version with a server-curated reference catalog. */

const FixedIncomeScreen = () => {
  const [tab, setTab] = React.useState("reits");
  const [bonds, setBonds] = React.useState(null);
  const [reits, setReits] = React.useState(null);

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [b, r] = await Promise.all([
          window.fetchApi('/api/bonds').catch(() => null),
          window.fetchApi('/api/reits').catch(() => null),
        ]);
        if (cancelled) return;
        if (b && b.ok) setBonds(b);
        if (r && r.ok) setReits(r);
      } catch (_e) {}
    };
    load();
    const t = setInterval(load, 300000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const fmtCr = (n) => n >= 1000 ? `₹${(n/1000).toFixed(1)}k Cr` : `₹${n} Cr`;
  const fmtINR = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={{ fontSize: 12, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.6 }}>Long-term plans</div>
        <div style={{ fontSize: 22, fontWeight: 600, marginTop: 2 }}>Fixed income & REITs</div>
        <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 4 }}>
          Reference catalog of Indian listed REITs and a sample bond ladder (G-Sec / AAA corporates / T-bills).
          Trade via your broker - this screen does not execute orders.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)' }}>
        {['reits', 'bonds'].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '10px 16px', fontSize: 13, fontWeight: tab === t ? 600 : 400,
            background: 'transparent', color: tab === t ? 'var(--text-1)' : 'var(--text-2)',
            border: 0, borderBottom: tab === t ? '2px solid var(--acc)' : '2px solid transparent',
            marginBottom: -1, cursor: 'pointer',
          }}>{t === 'reits' ? `REITs (${reits ? reits.rows.length : '...'})` : `Bonds (${bonds ? bonds.rows.length : '...'})`}</button>
        ))}
      </div>

      {tab === 'reits' && (
        <div>
          {!reits ? (
            <div style={{ padding: 16, color: 'var(--text-3)', fontSize: 13 }}>Loading REIT catalog...</div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 12 }}>
                {reits.rows.map(r => (
                  <div key={r.sym} style={{ padding: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>{r.sym}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{r.name}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 16, fontWeight: 600 }} className="mono">{fmtINR(r.nav)}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-3)' }}>NAV (last quarterly)</div>
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 12 }}>
                      <FiMini label="Yield"     value={`${r.distributionYieldPct}%`} tone="up"/>
                      <FiMini label="Occupancy" value={`${r.occupancyPct}%`}/>
                      <FiMini label="AUM"       value={fmtCr(r.aumCr)}/>
                    </div>
                    <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-3)' }}>
                      {r.type} - payouts {r.divFreq}
                    </div>
                  </div>
                ))}
              </div>
              <FiDisclaimer text={reits.disclaimer}/>
            </>
          )}
        </div>
      )}

      {tab === 'bonds' && (
        <div>
          {!bonds ? (
            <div style={{ padding: 16, color: 'var(--text-3)', fontSize: 13 }}>Loading bond catalog...</div>
          ) : (
            <>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-soft)' }}>
                    <th style={fiTh}>Type</th>
                    <th style={fiTh}>Name</th>
                    <th style={{ ...fiTh, textAlign: 'right' }}>Yield</th>
                    <th style={{ ...fiTh, textAlign: 'right' }}>Maturity</th>
                    <th style={fiTh}>Rating</th>
                    <th style={fiTh}>Risk</th>
                  </tr>
                </thead>
                <tbody>
                  {bonds.rows.map((b, i) => (
                    <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={fiTd}>
                        <span style={{ padding: '2px 6px', fontSize: 10, borderRadius: 4, background: fiTypeColor(b.type), color: 'white', whiteSpace: 'nowrap' }}>{b.type}</span>
                      </td>
                      <td style={fiTd}>
                        <div>{b.name}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-3)' }} className="mono">{b.isin}</div>
                      </td>
                      <td style={{ ...fiTd, textAlign: 'right' }} className="mono"><b>{b.yieldPct}%</b></td>
                      <td style={{ ...fiTd, textAlign: 'right' }} className="mono">{b.maturityYears < 1 ? `${Math.round(b.maturityYears * 12)}mo` : `${b.maturityYears}y`}</td>
                      <td style={fiTd}>{b.ratings}</td>
                      <td style={fiTd}>
                        <span style={{ fontSize: 11, color: b.risk === 'lowest' ? 'var(--up)' : b.risk === 'low' ? 'var(--acc)' : 'oklch(60% 0.14 70)' }}>{b.risk}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ marginTop: 12 }}><FiDisclaimer text={bonds.disclaimer}/></div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

const fiTh = { textAlign: 'left', padding: '8px 12px', fontSize: 10, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 };
const fiTd = { padding: '8px 12px', fontSize: 12 };

function fiTypeColor(t) {
  if (t === 'G-Sec')    return 'var(--up)';
  if (t === 'T-Bill')   return 'oklch(55% 0.14 165)';
  if (t === 'AAA Corp') return 'var(--acc)';
  if (t === 'AA Corp')  return 'oklch(60% 0.14 70)';
  return 'var(--text-3)';
}

const FiMini = ({ label, value, tone }) => (
  <div>
    <div style={{ fontSize: 10, color: 'var(--text-3)' }}>{label}</div>
    <div style={{ fontSize: 13, fontWeight: 600, color: tone === 'up' ? 'var(--up)' : 'var(--text-1)' }} className="mono">{value}</div>
  </div>
);

const FiDisclaimer = ({ text }) => (
  <div style={{ padding: 10, background: 'var(--bg-soft)', borderRadius: 6, fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>
    {text}
  </div>
);

window.FixedIncomeScreen = FixedIncomeScreen;
