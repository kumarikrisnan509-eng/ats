/* eslint-disable */
/* Smallcase / theme basket comparator -- Tier 21: live from /api/smallcase/baskets.
   Curated catalog only. Subscribe through smallcase.com or your broker. */

const SmallcaseScreen = () => {
  const [data, setData] = React.useState(null);
  const [filter, setFilter] = React.useState('all');
  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await window.fetchApi('/api/smallcase/baskets').catch(() => null);
        if (!cancelled && r && r.ok) setData(r);
      } catch (_e) {}
    };
    load();
    const t = setInterval(load, 300000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const rows = data ? data.rows : null;
  const tiers = rows ? Array.from(new Set(rows.map(r => r.tier))) : [];
  const filtered = rows ? (filter === 'all' ? rows : rows.filter(r => r.tier === filter)) : [];

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={{ fontSize: 12, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.6 }}>Long-term plans</div>
        <div style={{ fontSize: 22, fontWeight: 600, marginTop: 2 }}>Smallcases</div>
        <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 4 }}>
          Curated theme-basket catalog. Subscribe through smallcase.com or your broker. This screen does not execute orders.
        </div>
      </div>

      {!rows ? (
        <div style={{ padding: 16, color: 'var(--text-3)', fontSize: 13 }}>Loading smallcase catalog...</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <FilterPill active={filter === 'all'} onClick={() => setFilter('all')}>All ({rows.length})</FilterPill>
            {tiers.map(t => (
              <FilterPill key={t} active={filter === t} onClick={() => setFilter(t)}>
                {t.replace('_', ' ')} ({rows.filter(r => r.tier === t).length})
              </FilterPill>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {filtered.map(r => (
              <div key={r.id} style={{ padding: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{r.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{r.mgr} - {r.theme}</div>
                <div style={{ display: 'flex', gap: 16, fontSize: 11, marginTop: 10 }}>
                  <span><span className="muted">Stocks</span> <b>{r.stocks}</b></span>
                  <span><span className="muted">Rebal</span> <b>{r.rebal}</b></span>
                </div>
                <div style={{ marginTop: 10, display: 'inline-block', padding: '2px 8px', fontSize: 10, borderRadius: 4, background: 'var(--bg-soft)', color: 'var(--text-2)' }}>
                  {r.tier.replace('_', ' ')}
                </div>
              </div>
            ))}
          </div>

          <div style={{ padding: 10, background: 'var(--bg-soft)', borderRadius: 6, fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>
            {data.disclaimer}
          </div>
        </>
      )}
    </div>
  );
};

const FilterPill = ({ active, onClick, children }) => (
  <button onClick={onClick} style={{
    padding: '4px 10px', fontSize: 11, borderRadius: 99,
    background: active ? 'var(--acc)' : 'var(--bg-soft)',
    color: active ? 'white' : 'var(--text-2)',
    border: '1px solid var(--border)', cursor: 'pointer',
  }}>{children}</button>
);

window.SmallcaseScreen = SmallcaseScreen;
