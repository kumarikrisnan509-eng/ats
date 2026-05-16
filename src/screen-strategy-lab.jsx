/* eslint-disable */
/* Strategy Lab — Tier 10 consolidation.
   Merges 4 separate screens into one tabbed workflow:
     Backtest -> Tune -> Regime -> Benchmark
   This is the "validate before you ship" hub. The user clicks one nav item
   instead of jumping between 4 sidebar links.

   Each tab simply renders the existing screen component; logic stays put.
*/

const StrategyLabScreen = () => {
  // T100 (v9): Regime + Benchmark tabs removed — their screens were broken
  // and have been deleted. Regime context now injects into AI critic prompt (E6);
  // benchmark vs NIFTY is shown in Performance by regime panel inline.
  const TABS = [
    { id: "backtest",  label: "Backtest",   desc: "Walk-forward, out-of-sample" },
    { id: "tuner",     label: "Tune",       desc: "Bayesian param search" },
  ];

  const [tab, setTab] = React.useState(() => {
    try { const v = localStorage.getItem('ats.lab.tab'); return (v === 'regime' || v === 'benchmark') ? 'backtest' : (v || 'backtest'); } catch { return 'backtest'; }
  });

  const go = (id) => {
    setTab(id);
    try { localStorage.setItem('ats.lab.tab', id); } catch {}
  };

  const ChildScreen = (
    tab === 'backtest'  && window.BacktestScreen  ? <window.BacktestScreen/>  :
    tab === 'tuner'     && window.TunerScreen     ? <window.TunerScreen/>     :
    null
  );

  return (
    <div style={{ padding: 0 }}>
      {/* compact lab header */}
      <div style={{
        padding: '16px 16px 0', display: 'flex', flexDirection: 'column', gap: 4,
      }}>
        <div style={{ fontSize: 12, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.6 }}>Validate</div>
        <div style={{ fontSize: 22, fontWeight: 600 }}>Strategy Lab</div>
        <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
          One stop for validating strategies before they touch real money. Backtest historically, then tune hyperparameters.
        </div>
      </div>

      {/* tab strip */}
      <div style={{
        display: 'flex', gap: 4, padding: '12px 16px 0',
        borderBottom: '1px solid var(--border)',
      }}>
        {TABS.map(t => {
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              onClick={() => go(t.id)}
              style={{
                padding: '10px 16px', fontSize: 13, fontWeight: active ? 600 : 400,
                background: 'transparent',
                color: active ? 'var(--text-1)' : 'var(--text-2)',
                border: 0, borderBottom: active ? '2px solid var(--acc)' : '2px solid transparent',
                marginBottom: -1, cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
              }}
              title={t.desc}
            >
              <span>{t.label}</span>
              <span style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 1 }}>{t.desc}</span>
            </button>
          );
        })}
      </div>

      {/* active child screen */}
      <div style={{ paddingTop: 0 }}>
        {ChildScreen || (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-3)' }}>
            Child screen <b>{tab}</b> not yet loaded — refresh the page.
          </div>
        )}
      </div>
    </div>
  );
};

window.StrategyLabScreen = StrategyLabScreen;
