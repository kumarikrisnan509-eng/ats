/* eslint-disable */
/* Copy-trading -- Tier 22: live from /api/copy/traders.
   Spec §0: "Not a copy-trading platform in v1 (that's a separate compliance track)".
   Backend honestly returns an empty list with a SEBI-disclaimer until an RA-partner agreement lands. */

const CopyScreen = () => {
  const [data, setData] = React.useState(null);
  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await window.fetchApi('/api/copy/traders').catch(() => null);
        if (!cancelled && r && r.ok) setData(r);
      } catch (_e) {}
    };
    load();
    const t = setInterval(load, 60000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={{ fontSize: 12, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.6 }}>Wealth</div>
        <div style={{ fontSize: 22, fontWeight: 600, marginTop: 2 }}>Copy trading</div>
        <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 4 }}>
          Follow SEBI-registered Research Analysts. Their signals get auto-translated to your book under YOUR risk limits.
        </div>
      </div>

      {!data ? (
        <div style={{ padding: 16, color: 'var(--text-3)', fontSize: 13 }}>Loading...</div>
      ) : data.rows.length === 0 ? (
        <div style={{ padding: 32, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>👥</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>No traders onboarded yet</div>
          <div style={{ fontSize: 13, color: 'var(--text-2)', maxWidth: 560, margin: '0 auto', lineHeight: 1.6 }}>
            Under the April 2026 SEBI algo framework, copy-trading requires partnerships with SEBI-registered Research Analysts.
            We have not yet signed any RA agreements. This screen will populate once partners are onboarded.
          </div>
          <div style={{ marginTop: 16, padding: 12, background: 'var(--bg-soft)', borderRadius: 6, fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5, maxWidth: 560, margin: '16px auto 0' }}>
            {data.disclaimer}
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {data.rows.map((t, i) => (
            <div key={i} style={{ padding: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{t.name}</div>
              <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{t.handle}</div>
              <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 6 }}>{t.style}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

window.CopyScreen = CopyScreen;
