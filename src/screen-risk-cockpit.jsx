/* eslint-disable */
// @ts-check
/* T-274 -- Risk Cockpit screen (Phase 2 of the vision doc).
 *
 * Read-only dashboard surfacing GET /api/me/portfolio/aggregates. Becomes the
 * operator's home base for "what do I actually own / what am I exposed to."
 *
 * Sections:
 *   1. KPI row     -- total value, cash, MTM PnL, gross/net exposure, leverage
 *   2. Positions   -- table with symbol, qty, avg, LTP, MV, MTM PnL %
 *   3. By sector   -- pill chart of concentration
 *   4. By strategy -- realised PnL grouped by strategy tag
 *   5. Concentration alert if top position > 30% of long MV
 *
 * Refreshes every 30s via setInterval. No mutating actions on this screen.
 */

const _inrRC = (n) => {
  if (n == null || !Number.isFinite(n)) return '-';
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (a >= 1e7) return `${sign}₹${(a/1e7).toFixed(2)}cr`;
  if (a >= 1e5) return `${sign}₹${(a/1e5).toFixed(2)}L`;
  if (a >= 1e3) return `${sign}₹${(a/1e3).toFixed(1)}K`;
  return `${sign}₹${a.toFixed(0)}`;
};

const _pctRC = (n, places = 2) => {
  if (!Number.isFinite(n)) return '-';
  return `${n.toFixed(places)}%`;
};

const _pnlColorRC = (n) => {
  if (!Number.isFinite(n) || n === 0) return 'var(--text-2)';
  return n > 0 ? 'var(--up, #15803d)' : 'var(--down, #b91c1c)';
};

// Stable sector -> colour mapping for the pill chart.
const SECTOR_COLOURS = {
  banking:        '#3b82f6',
  financials:     '#6366f1',
  it:             '#0ea5e9',
  energy:         '#ef4444',
  auto:           '#f59e0b',
  fmcg:           '#10b981',
  pharma:         '#a855f7',
  metals:         '#78716c',
  cement:         '#737373',
  telecom:        '#ec4899',
  utilities:      '#eab308',
  consumer_disc:  '#f97316',
  industrials:    '#84cc16',
  etf:            '#14b8a6',
  other:          '#94a3b8',
};

window.RiskCockpitScreen = function RiskCockpitScreen() {
  const [data, setData] = React.useState(null);
  const [optionGreeks, setOptionGreeks] = React.useState(null);   // T-294b: net book Greeks
  const [autorunHistory, setAutorunHistory] = React.useState([]);   // T-313: recent runs
  const [regime, setRegime] = React.useState(null);     // T-280: market regime banner
  const [stress, setStress] = React.useState(null);     // T-275: scenario stress preview
  const [shockPct, setShockPct] = React.useState(-3);
  const [error, setError] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [lastUpdated, setLastUpdated] = React.useState(null);

  const fetchAggregates = async () => {
    try {
      const r = await window.fetchApi('/api/me/portfolio/aggregates');
      if (r && r.ok) {
        setData(r.aggregates);
        setOptionGreeks(r.optionGreeks || null);   // T-294b
        // T-313: fire-and-forget fetch autorun history; failures silent
        fetch('/api/autorun').then(x => x.json()).then(ar => {
          if (ar && ar.ok && Array.isArray(ar.history)) setAutorunHistory(ar.history);
        }).catch(() => {});
        setError(null);
        setLastUpdated(new Date());
      } else {
        setError((r && r.reason) || 'Failed to load aggregates');
      }
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  };

  const fetchRegime = async () => {
    try {
      const r = await window.fetchApi('/api/me/regime');
      if (r && r.ok) setRegime(r.regime);
    } catch (_e) { /* non-critical */ }
  };

  const fetchStress = async (pct) => {
    try {
      const r = await window.fetchApi('/api/me/portfolio/stress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ broadPct: Number(pct) || 0 }),
      });
      if (r && r.ok) setStress(r.stress);
    } catch (_e) { /* non-critical */ }
  };

  React.useEffect(() => {
    fetchAggregates();
    fetchRegime();
    fetchStress(shockPct);
    const t = setInterval(() => { fetchAggregates(); fetchRegime(); }, 30000);
    return () => clearInterval(t);
  }, []);

  React.useEffect(() => {
    if (data) fetchStress(shockPct);
  }, [shockPct, data && data.positionCount]);

  if (loading && !data) {
    return <div style={{ padding: 24, color: 'var(--text-3)' }}>Loading risk cockpit...</div>;
  }
  if (error && !data) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--down, #b91c1c)', marginBottom: 8 }}>
          Couldn't load aggregates
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{error}</div>
        <button onClick={fetchAggregates} style={_btnStyle}>Retry</button>
      </div>
    );
  }
  if (!data) return null;

  const positions = Array.isArray(data.positions) ? data.positions : [];
  const sectors   = data.bySector || {};
  const strategies = data.byStrategy || {};
  const conc = data.topConcentration || {};
  const concAlert = Number.isFinite(conc.pct) && conc.pct > 30;

  return (
    <div style={{ padding: '0 24px 24px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: 'var(--text-1)' }}>Risk Cockpit</h2>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
            Unified position view. Auto-refreshes every 30s.
            {lastUpdated && ` Last updated: ${lastUpdated.toLocaleTimeString()}.`}
          </div>
        </div>
        <button onClick={fetchAggregates} style={_btnStyle}>Refresh</button>
      </div>

      {regime && (
        <div style={{
          padding: '10px 14px', marginBottom: 16,
          background: _regimeBgColor(regime.regime),
          border: `1px solid ${_regimeBorderColor(regime.regime)}`,
          borderRadius: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            <strong style={{ fontSize: 13, color: _regimeTextColor(regime.regime), textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Regime: {regime.regime}
            </strong>
            <span style={{ marginLeft: 12, fontSize: 12, color: 'var(--text-3)' }}>
              confidence {(regime.confidence * 100).toFixed(0)}%
              {regime.inputs && regime.inputs.vix != null && ` · VIX ${regime.inputs.vix}`}
              {regime.inputs && regime.inputs.niftyClose != null && ` · NIFTY ${regime.inputs.niftyClose}`}
            </span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-4)', maxWidth: 480, textAlign: 'right' }}>
            {Array.isArray(regime.reasoning) && regime.reasoning.length > 0 ? regime.reasoning[0] : ''}
          </div>
        </div>
      )}

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 20 }}>
        <KPI label="Total value"    value={_inrRC(data.totalValue)} sub="cash + market value" />
        <KPI label="Cash"           value={_inrRC(data.cash)} />
        <KPI label="MTM P&L"        value={_inrRC(data.totalMtmPnl)} color={_pnlColorRC(data.totalMtmPnl)} />
        <KPI label="Gross exposure" value={_inrRC(data.grossExposure)} sub="|long| + |short|" />
        <KPI label="Net exposure"   value={_inrRC(data.netExposure)} sub="long − short" color={_pnlColorRC(data.netExposure)} />
        <KPI label="Leverage"       value={data.leverage != null ? `${data.leverage.toFixed(2)}x` : '-'} sub="gross / cash" color={data.leverage > 2 ? 'var(--down, #b91c1c)' : 'var(--text-1)'} />
      </div>

      {/* Concentration alert */}
      {concAlert && (
        <div style={{
          padding: '10px 14px', marginBottom: 16,
          background: '#fef9c3', border: '1px solid #fde047', borderRadius: 6,
          fontSize: 13, color: '#854d0e',
        }}>
          <strong>Concentration alert:</strong> {conc.symbol} is {_pctRC(conc.pct)} of long market value — consider trimming below 30% for diversification.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20 }}>
        {/* LEFT: Positions table */}
        <section style={_panelStyle}>
          <div style={_panelHeader}>Positions ({positions.length})</div>
          {positions.length === 0 ? (
            <div style={{ padding: 20, color: 'var(--text-3)', fontSize: 13, textAlign: 'center' }}>
              No open positions. SIPs and autorun signals will land here when they fire.
            </div>
          ) : (
            <table style={_tableStyle}>
              <thead>
                <tr>
                  <th style={_thStyle}>Symbol</th>
                  <th style={_thStyle}>Sector</th>
                  <th style={_thStyleR}>Qty</th>
                  <th style={_thStyleR}>Avg</th>
                  <th style={_thStyleR}>LTP</th>
                  <th style={_thStyleR}>Market value</th>
                  <th style={_thStyleR}>MTM P&L</th>
                  <th style={_thStyleR}>%</th>
                </tr>
              </thead>
              <tbody>
                {positions.map(p => (
                  <tr key={p.symbol}>
                    <td style={_tdStyle}><strong>{p.symbol}</strong></td>
                    <td style={_tdStyle}><SectorPill sector={p.sector}/></td>
                    <td style={_tdStyleR}>{p.qty}</td>
                    <td style={_tdStyleR}>{_inrRC(p.avgPrice)}</td>
                    <td style={_tdStyleR}>{p.ltp != null ? _inrRC(p.ltp) : '—'}</td>
                    <td style={_tdStyleR}>{_inrRC(p.marketValue)}</td>
                    <td style={{ ..._tdStyleR, color: _pnlColorRC(p.mtmPnl) }}>{_inrRC(p.mtmPnl)}</td>
                    <td style={{ ..._tdStyleR, color: _pnlColorRC(p.mtmPnl) }}>{_pctRC(p.mtmPnlPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* RIGHT: Sector + strategy breakdowns */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <section style={_panelStyle}>
            <div style={_panelHeader}>By sector</div>
            {Object.keys(sectors).length === 0 ? (
              <div style={{ padding: 16, color: 'var(--text-3)', fontSize: 12 }}>No positions.</div>
            ) : (
              <div style={{ padding: 12 }}>
                {Object.entries(sectors)
                  .sort((a, b) => b[1].marketValue - a[1].marketValue)
                  .map(([sec, info]) => (
                    <div key={sec} style={{ marginBottom: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                        <span style={{ color: 'var(--text-2)' }}>{sec}</span>
                        <span style={{ color: 'var(--text-3)' }}>{_pctRC(info.weightPct || 0)} · {_inrRC(info.marketValue)}</span>
                      </div>
                      <div style={{ height: 6, background: 'var(--bg-sunk)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{
                          height: '100%',
                          width: `${Math.min(100, info.weightPct || 0)}%`,
                          background: SECTOR_COLOURS[sec] || SECTOR_COLOURS.other,
                          transition: 'width 0.3s ease',
                        }}/>
                      </div>
                    </div>
                ))}
              </div>
            )}
          </section>

          <section style={_panelStyle}>
            <div style={_panelHeader}>Realised P&L by strategy</div>
            {Object.keys(strategies).length === 0 ? (
              <div style={{ padding: 16, color: 'var(--text-3)', fontSize: 12 }}>No closed trades yet.</div>
            ) : (
              <table style={{ ..._tableStyle, marginBottom: 0 }}>
                <thead>
                  <tr>
                    <th style={_thStyle}>Strategy</th>
                    <th style={_thStyleR}>Trades</th>
                    <th style={_thStyleR}>Realised</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(strategies)
                    .sort((a, b) => b[1].realisedPnl - a[1].realisedPnl)
                    .map(([tag, info]) => (
                      <tr key={tag}>
                        <td style={_tdStyle}><code style={{ fontSize: 11, color: 'var(--text-2)' }}>{tag}</code></td>
                        <td style={_tdStyleR}>{info.count}</td>
                        <td style={{ ..._tdStyleR, color: _pnlColorRC(info.realisedPnl) }}>{_inrRC(info.realisedPnl)}</td>
                      </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      </div>

      {stress && positions.length > 0 && (
        <section style={{ ..._panelStyle, marginTop: 20 }}>
          <div style={_panelHeader}>Scenario stress test</div>
          <div style={{ padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: 'var(--text-2)' }}>Broad market shock (%):</label>
              <input type="range" min="-15" max="15" step="0.5"
                value={shockPct}
                onChange={e => setShockPct(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <span style={{ fontSize: 14, fontWeight: 600, color: shockPct < 0 ? 'var(--down, #b91c1c)' : (shockPct > 0 ? 'var(--up, #15803d)' : 'var(--text-1)'), minWidth: 50, textAlign: 'right' }}>
                {shockPct > 0 ? '+' : ''}{shockPct}%
              </span>
            </div>
            <div style={{ display: 'flex', gap: 24, fontSize: 13, flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--text-3)' }}>
                Portfolio would move <strong style={{ color: _pnlColorRC(stress.portfolioMovePct) }}>{_pctRC(stress.portfolioMovePct)}</strong>
              </span>
              <span style={{ color: 'var(--text-3)' }}>
                Hypothetical PnL: <strong style={{ color: _pnlColorRC(stress.totalShockPnl) }}>{_inrRC(stress.totalShockPnl)}</strong>
              </span>
              <span style={{ color: 'var(--text-3)' }}>
                from baseline {_inrRC(stress.totalBaselineMV)} to {_inrRC(stress.totalShockedMV)}
              </span>
            </div>
          </div>
        </section>
      )}

      {/* T-294b: Option Greeks rollup -- only render when present + matched > 0 */}
      {optionGreeks && Number.isFinite(optionGreeks.netDelta) && optionGreeks.matched > 0 && (
        <section style={{ ..._panelStyle, marginTop: 20 }}>
          <div style={_panelHeader}>
            Option Greeks (book-level)
            <span style={{ marginLeft: 12, fontSize: 11, fontWeight: 400, color: 'var(--text-3)' }}>
              {optionGreeks.matched} matched / {optionGreeks.unmatched ? optionGreeks.unmatched.length : 0} unmatched
            </span>
          </div>
          <div style={{ padding: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.4 }}>Net Delta</div>
              <div style={{ fontSize: 20, fontWeight: 600, fontFamily: 'monospace', color: _pnlColorRC(optionGreeks.netDelta) }}>
                {Number(optionGreeks.netDelta).toFixed(2)}
              </div>
              {Number.isFinite(optionGreeks.notionalDelta) && (
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                  Notional: {_inrRC(optionGreeks.notionalDelta)}
                </div>
              )}
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.4 }}>Net Gamma</div>
              <div style={{ fontSize: 20, fontWeight: 600, fontFamily: 'monospace' }}>
                {Number(optionGreeks.netGamma).toFixed(4)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.4 }}>Net Vega</div>
              <div style={{ fontSize: 20, fontWeight: 600, fontFamily: 'monospace' }}>
                {Number(optionGreeks.netVega).toFixed(2)}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>per 1pt IV</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.4 }}>Net Theta</div>
              <div style={{ fontSize: 20, fontWeight: 600, fontFamily: 'monospace', color: _pnlColorRC(optionGreeks.netTheta) }}>
                {Number(optionGreeks.netTheta).toFixed(2)}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>per day</div>
            </div>
          </div>
          {optionGreeks.unmatched && optionGreeks.unmatched.length > 0 && (
            <div style={{ padding: '6px 14px 12px', fontSize: 11, color: 'var(--text-3)' }}>
              Unmatched (no quote in option_quotes): {optionGreeks.unmatched.slice(0, 5).join(', ')}{optionGreeks.unmatched.length > 5 ? '...' : ''}
            </div>
          )}
        </section>
      )}

      {/* T-313: Autorun recent runs widget */}
      {autorunHistory.length > 0 && (
        <section style={{ ..._panelStyle, marginTop: 20 }}>
          <div style={_panelHeader}>
            Autorun recent runs
            <span style={{ marginLeft: 12, fontSize: 11, fontWeight: 400, color: 'var(--text-3)' }}>
              {autorunHistory.length} runs · skipped patterns reveal which gate is gating
            </span>
          </div>
          <div style={{ padding: 14 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border, #2a3142)', textAlign: 'left', color: 'var(--text-2)' }}>
                  <th style={{ padding: '4px 6px' }}>When</th>
                  <th style={{ padding: '4px 6px' }}>Result</th>
                  <th style={{ padding: '4px 6px' }}>Regime</th>
                  <th style={{ padding: '4px 6px' }}>Signal</th>
                  <th style={{ padding: '4px 6px', textAlign: 'right' }}>ms</th>
                </tr>
              </thead>
              <tbody>
                {autorunHistory.slice(0, 15).map((r, i) => {
                  const isPlaced = r.result === 'placed';
                  const isSkipped = String(r.result || '').startsWith('skipped');
                  const color = isPlaced ? '#15803d' : (isSkipped ? '#f59e0b' : 'var(--text-2)');
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border, #2a3142)' }}>
                      <td style={{ padding: '4px 6px', whiteSpace: 'nowrap', color: 'var(--text-3)' }}>
                        {r.ts ? new Date(r.ts).toLocaleTimeString('en-IN', { hour12: false }) : '-'}
                      </td>
                      <td style={{ padding: '4px 6px', color, fontWeight: 600 }}>{r.result || '-'}</td>
                      <td style={{ padding: '4px 6px' }}>{(r.regime && r.regime.label) || r.regime || '-'}</td>
                      <td style={{ padding: '4px 6px', fontSize: 11, color: 'var(--text-3)' }}>{r.signal || ''}</td>
                      <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: 'monospace', color: 'var(--text-3)' }}>{r.durationMs || 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div style={{ marginTop: 16, padding: 12, fontSize: 11, color: 'var(--text-4)', textAlign: 'center' }}>
        T-272 + T-274 + T-275 + T-280 (Phase 2 + Phase 3 partial). Schema: <code>{data._schema}</code>. Equity-only -- option Greeks (delta/vega/theta) come in Phase 4.
      </div>
    </div>
  );
};

// ---------- presentational helpers ----------
const KPI = ({ label, value, sub, color }) => (
  <div style={{
    padding: '12px 14px',
    background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6,
  }}>
    <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
    <div style={{ fontSize: 20, fontWeight: 600, marginTop: 6, color: color || 'var(--text-1)' }}>{value}</div>
    {sub && <div style={{ fontSize: 10, color: 'var(--text-4)', marginTop: 2 }}>{sub}</div>}
  </div>
);

const SectorPill = ({ sector }) => (
  <span style={{
    display: 'inline-block', padding: '2px 8px', borderRadius: 999,
    fontSize: 10, fontWeight: 600, letterSpacing: 0.3,
    color: '#fff',
    background: SECTOR_COLOURS[sector] || SECTOR_COLOURS.other,
  }}>{sector}</span>
);

// T-280: regime banner colour helpers.
const _regimeBgColor = (r) => ({
  bull: '#dcfce7', bear: '#fee2e2', neutral: '#f5f5f5',
  volatile: '#fef9c3', crisis: '#fecaca',
})[r] || '#f5f5f5';
const _regimeBorderColor = (r) => ({
  bull: '#15803d', bear: '#b91c1c', neutral: '#a3a3a3',
  volatile: '#a16207', crisis: '#991b1b',
})[r] || '#a3a3a3';
const _regimeTextColor = (r) => ({
  bull: '#15803d', bear: '#b91c1c', neutral: '#525252',
  volatile: '#a16207', crisis: '#991b1b',
})[r] || '#525252';

const _btnStyle = {
  padding: '6px 12px', fontSize: 12, fontWeight: 500,
  background: 'var(--surface)', color: 'var(--text-1)',
  border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer',
};
const _panelStyle = {
  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
};
const _panelHeader = {
  padding: '10px 14px', borderBottom: '1px solid var(--border)',
  fontSize: 13, fontWeight: 600, color: 'var(--text-1)',
};
const _tableStyle = {
  width: '100%', borderCollapse: 'collapse', marginBottom: 0,
};
const _thStyle = {
  padding: '8px 12px', textAlign: 'left',
  fontSize: 11, fontWeight: 600, color: 'var(--text-3)',
  textTransform: 'uppercase', letterSpacing: 0.4,
  borderBottom: '1px solid var(--border)',
};
const _thStyleR = { ..._thStyle, textAlign: 'right' };
const _tdStyle = {
  padding: '8px 12px', fontSize: 13, color: 'var(--text-1)',
  borderBottom: '1px solid var(--border)',
};
const _tdStyleR = { ..._tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
