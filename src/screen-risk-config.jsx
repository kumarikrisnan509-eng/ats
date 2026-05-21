/* eslint-disable */
/* T-262 — Risk Management config screen.
 *
 * Replaces scripts/SETUP-TRADING.cmd with a real Settings -> Risk Management
 * surface. Lets the operator (and eventually any user) configure:
 *   1. Capital + caps (max position pct, max daily loss pct, max open positions)
 *   2. DCA mix across NIFTYBEES / JUNIORBEES / GOLDBEES / MOM100
 *   3. Active strategies + voting threshold (k-of-N agreement gate)
 *   4. Trading mode (paper | micro_live | full_live, last one gated by 2FA)
 *
 * One global Save button. Disabled when nothing changed. Client-side validation
 * runs BEFORE the PUT so the user sees errors inline; the server re-validates
 * (services/risk-config.js) and returns 400 with a reason on conflict.
 *
 * Endpoints: GET/PUT /api/me/risk-config. CSRF is auto-attached by mock-data's
 * patched fetch (see window.fetchApi).
 */

const DCA_SYMBOLS = ['NIFTYBEES', 'JUNIORBEES', 'GOLDBEES', 'MOM100'];

// Fallback strategy list when /api/strategies hasn't loaded yet. Mirrors the
// IDs in deploy/backend/routes/strategies.js so the UI is functional even if
// the API call fails (e.g. offline / 503 during boot).
const FALLBACK_STRATEGIES = [
  { id: 'rsi_mean_revert', name: 'RSI mean reversion' },
  { id: 'ema_cross', name: 'EMA cross' },
  { id: 'macd_cross', name: 'MACD signal cross' },
  { id: 'bollinger', name: 'Bollinger band mean reversion' },
  { id: 'supertrend', name: 'Supertrend' },
  { id: 'adx_trend', name: 'ADX trend filter' },
  { id: 'donchian', name: 'Donchian breakout' },
  { id: 'stochastic', name: 'Stochastic %K cross' },
  { id: 'williams_r', name: 'Williams %R' },
  { id: 'heikin_ashi', name: 'Heikin-Ashi trend' },
  { id: 'cci', name: 'Commodity Channel Index' },
  { id: 'keltner', name: 'Keltner Channels' },
  { id: 'obv', name: 'OBV divergence' },
  { id: 'psar', name: 'Parabolic SAR' },
  { id: 'aroon', name: 'Aroon oscillator' },
  { id: 'cmf', name: 'Chaikin Money Flow' },
  { id: 'atr_trail', name: 'ATR trailing stop' },
  { id: 'ichimoku', name: 'Ichimoku Tenkan/Kijun cross' },
  { id: 'vwap', name: 'VWAP cross (rolling)' },
  { id: 'pivot', name: 'Pivot Points (R1/S1)' },
  { id: 'mfi', name: 'Money Flow Index' },
  { id: 'trix', name: 'TRIX' },
];

const _inr = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');

window.RiskConfigScreen = function RiskConfigScreen() {
  const [config, setConfig] = React.useState(null);     // working copy (edited locally)
  const [original, setOriginal] = React.useState(null); // last server snapshot (for dirty check)
  const [strategies, setStrategies] = React.useState(FALLBACK_STRATEGIES);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [err, setErr] = React.useState('');
  const [ok, setOk] = React.useState('');

  // --- initial load: config + strategies (parallel) ---
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cfgRes, stratRes] = await Promise.all([
          window.fetchApi('/api/me/risk-config'),
          window.fetchApi('/api/strategies').catch(() => null),
        ]);
        if (cancelled) return;
        if (cfgRes && cfgRes.ok && cfgRes.config) {
          setConfig(_clone(cfgRes.config));
          setOriginal(_clone(cfgRes.config));
        } else {
          setErr('Failed to load config: ' + (cfgRes && cfgRes.reason || 'unknown'));
        }
        if (stratRes && stratRes.ok && Array.isArray(stratRes.strategies) && stratRes.strategies.length) {
          setStrategies(stratRes.strategies.map(s => ({ id: s.id, name: s.name || s.id })));
        }
      } catch (e) {
        if (!cancelled) setErr(window.formatErr ? window.formatErr(e) : (e && e.message) || 'Load failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // --- dirty check (deep-ish equality on the small known schema) ---
  const dirty = React.useMemo(() => {
    if (!config || !original) return false;
    return JSON.stringify(config) !== JSON.stringify(original);
  }, [config, original]);

  // --- client-side validation -> array of {field, msg} ---
  const errors = React.useMemo(() => _validate(config), [config]);

  // --- save handler ---
  const onSave = async () => {
    if (!config || errors.length) return;
    setSaving(true); setErr(''); setOk('');
    try {
      const res = await window.fetchApi('/api/me/risk-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (res && res.ok && res.config) {
        setConfig(_clone(res.config));
        setOriginal(_clone(res.config));
        setOk('Saved.');
        setTimeout(() => setOk(''), 3000);
      } else {
        setErr((res && res.reason) || 'Save failed');
      }
    } catch (e) {
      setErr(window.formatErr ? window.formatErr(e) : (e && e.message) || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <>
        <div className="page-header"><h1 className="page-header__title">Risk management</h1></div>
        <div style={{ padding: 24, color: 'var(--text-3)' }}>Loading…</div>
      </>
    );
  }
  if (!config) {
    return (
      <>
        <div className="page-header"><h1 className="page-header__title">Risk management</h1></div>
        <div style={{ padding: 16, background: 'var(--down-soft, #fef2f2)', color: 'var(--down, #b91c1c)', border: '1px solid var(--border)', borderRadius: 6 }}>
          {err || 'Failed to load configuration.'}
        </div>
      </>
    );
  }

  const update = (patch) => setConfig(c => ({ ...c, ...patch }));
  const updateDca = (sym, val) => setConfig(c => ({ ...c, dcaAllocation: { ...c.dcaAllocation, [sym]: val } }));
  const toggleStrategy = (id) => setConfig(c => {
    const set = new Set(c.activeStrategies || []);
    if (set.has(id)) set.delete(id); else set.add(id);
    const next = strategies.map(s => s.id).filter(x => set.has(x));
    // Clamp votingThreshold to new size.
    const vt = Math.max(1, Math.min(c.votingThreshold || 1, next.length || 1));
    return { ...c, activeStrategies: next, votingThreshold: vt };
  });

  // --- live preview banner numbers ---
  const maxPositionINR = (config.capital || 0) * (config.maxPositionPct || 0);
  const maxDailyLossINR = (config.capital || 0) * (config.maxDailyLossPct || 0);
  const dcaSum = DCA_SYMBOLS.reduce((a, s) => a + Number(config.dcaAllocation && config.dcaAllocation[s] || 0), 0);
  const dcaSumPct = dcaSum * 100;
  const cashBufferPct = Math.max(0, 100 - dcaSumPct);

  return (
    <>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-header__title">Risk management</h1>
          <div className="page-header__sub">Configure trading capital, risk caps, DCA mix, and strategy voting. Replaces the SETUP-TRADING.cmd CLI.</div>
        </div>
        <button
          onClick={onSave}
          disabled={!dirty || saving || errors.length > 0}
          style={{
            padding: '8px 18px', fontSize: 13, fontWeight: 600,
            background: (!dirty || saving || errors.length > 0) ? 'var(--bg-sunk)' : 'var(--accent, #38a169)',
            color: (!dirty || saving || errors.length > 0) ? 'var(--text-3)' : 'white',
            border: 'none', borderRadius: 6,
            cursor: (!dirty || saving || errors.length > 0) ? 'not-allowed' : 'pointer',
          }}
          title={errors.length ? errors[0].msg : (dirty ? 'Save changes' : 'No changes')}
        >{saving ? 'Saving…' : 'Save'}</button>
      </div>

      {/* Preview banner */}
      <div style={{
        padding: 12, marginBottom: 16, fontSize: 13,
        background: 'var(--bg-soft)', border: '1px solid var(--border)', borderRadius: 6,
        display: 'flex', gap: 24, flexWrap: 'wrap',
      }}>
        <span><b>Capital:</b> {_inr(config.capital)}</span>
        <span><b>Max position:</b> {_inr(maxPositionINR)} ({((config.maxPositionPct || 0) * 100).toFixed(2)}%)</span>
        <span><b>Daily loss cap:</b> {_inr(maxDailyLossINR)} ({((config.maxDailyLossPct || 0) * 100).toFixed(2)}%)</span>
        <span><b>Mode:</b> {config.tradingMode}</span>
      </div>

      {err && <div style={{ padding: 10, marginBottom: 12, fontSize: 13, color: 'var(--down, #b91c1c)', background: 'var(--down-soft, #fef2f2)', border: '1px solid var(--border)', borderRadius: 6 }}>{err}</div>}
      {ok && <div style={{ padding: 10, marginBottom: 12, fontSize: 13, color: 'var(--up, #15803d)', background: 'var(--up-soft, #f0fdf4)', border: '1px solid var(--border)', borderRadius: 6 }}>{ok}</div>}
      {errors.length > 0 && (
        <div style={{ padding: 10, marginBottom: 12, fontSize: 12, color: 'var(--down, #b91c1c)', background: 'var(--down-soft, #fef2f2)', border: '1px solid var(--border)', borderRadius: 6 }}>
          {errors.map((e, i) => <div key={i}>- {e.msg}</div>)}
        </div>
      )}

      {/* RcSection 1: Capital & caps */}
      <RcSection title="Capital & caps" sub="Trading capital and percentage-based risk caps. INR caps derive from capital * pct, so they scale automatically.">
        <Field label="Trading capital (INR)" hint="1,000 – 10,000,000">
          <input type="number" min="1000" max="10000000" step="1000"
            value={config.capital}
            onChange={e => update({ capital: Number(e.target.value) || 0 })}
            style={_inputStyle}
          />
        </Field>
        <Field label="Max position size (%)" hint="0 – 100. Default 5%.">
          <PctInput value={config.maxPositionPct} onChange={v => update({ maxPositionPct: v })} max={100}/>
        </Field>
        <Field label="Max daily loss (%)" hint="0 – 100. Default 2%.">
          <PctInput value={config.maxDailyLossPct} onChange={v => update({ maxDailyLossPct: v })} max={100}/>
        </Field>
        <Field label="Max open positions" hint="1 – 50.">
          <input type="number" min="1" max="50" step="1"
            value={config.maxOpenPositions}
            onChange={e => update({ maxOpenPositions: Math.trunc(Number(e.target.value)) || 1 })}
            style={_inputStyle}
          />
        </Field>
      </RcSection>

      {/* RcSection 2: DCA mix */}
      <RcSection
        title="DCA mix (monthly SIP allocation)"
        sub="Each value is a fraction of capital deployed monthly to that ETF. Total must be <= 100% of capital. The remainder is held as cash buffer."
      >
        {DCA_SYMBOLS.map(sym => (
          <Field key={sym} label={sym} hint={`${_inr((config.capital || 0) * (config.dcaAllocation[sym] || 0))} / month at current capital`}>
            <PctInput
              value={config.dcaAllocation[sym] || 0}
              onChange={v => updateDca(sym, v)}
              max={100}
              step={0.01}
            />
          </Field>
        ))}
        <div style={{
          marginTop: 4, padding: 8, fontSize: 12,
          color: dcaSum > 1.000001 ? 'var(--down, #b91c1c)' : 'var(--text-3)',
          background: dcaSum > 1.000001 ? 'var(--down-soft, #fef2f2)' : 'var(--bg-sunk)',
          border: '1px solid var(--border)', borderRadius: 4,
        }}>
          Sum: {dcaSumPct.toFixed(2)}% &nbsp;({cashBufferPct.toFixed(2)}% to cash buffer)
          {dcaSum > 1.000001 && ' — exceeds 100%, please reduce.'}
        </div>
      </RcSection>

      {/* RcSection 3: Strategy voting */}
      <RcSection
        title="Strategy voting"
        sub={`Trades fire only when at least N of the active strategies agree. ${(config.activeStrategies || []).length} active, threshold ${config.votingThreshold}.`}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8, marginBottom: 16 }}>
          {strategies.map(s => {
            const active = (config.activeStrategies || []).includes(s.id);
            return (
              <label key={s.id} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                background: active ? 'var(--up-soft, #f0fdf4)' : 'var(--bg-soft)',
                border: '1px solid ' + (active ? 'var(--up, #15803d)' : 'var(--border)'),
                borderRadius: 4, cursor: 'pointer', fontSize: 12,
              }}>
                <input type="checkbox" checked={active} onChange={() => toggleStrategy(s.id)}/>
                <span style={{ color: 'var(--text-1)' }}>{s.name}</span>
              </label>
            );
          })}
        </div>
        <Field label="Voting threshold" hint={`1 – ${(config.activeStrategies || []).length || 1} (must be <= active strategies count)`}>
          <input type="number" min="1" max={Math.max(1, (config.activeStrategies || []).length)} step="1"
            value={config.votingThreshold}
            onChange={e => update({ votingThreshold: Math.max(1, Math.trunc(Number(e.target.value)) || 1) })}
            style={_inputStyle}
          />
        </Field>
      </RcSection>

      {/* RcSection 4: Trading mode */}
      <RcSection
        title="Trading mode"
        sub="Paper is fully simulated. Micro-live trades 10% real / 90% paper with caps shrunk 10x. Full-live is real money."
      >
        {[
          { id: 'paper', label: 'Paper (simulated)', sub: 'No real money. Recommended for Phase 1 validation.' },
          { id: 'micro_live', label: 'Micro-live (10% real)', sub: 'Caps shrunk 10x. Validates the live pipeline with minimal exposure.' },
          { id: 'full_live', label: 'Full-live (100% real)', sub: 'Real capital at risk. Requires 2FA setup in Settings -> Security.', disabled: true, disabledReason: 'Requires 2FA setup in Settings -> Security' },
        ].map(opt => (
          <label key={opt.id} title={opt.disabled ? opt.disabledReason : ''} style={{
            display: 'flex', gap: 10, alignItems: 'flex-start', padding: 10, marginBottom: 6,
            background: config.tradingMode === opt.id ? 'var(--up-soft, #f0fdf4)' : 'var(--bg-soft)',
            border: '1px solid ' + (config.tradingMode === opt.id ? 'var(--up, #15803d)' : 'var(--border)'),
            borderRadius: 4,
            opacity: opt.disabled ? 0.55 : 1,
            cursor: opt.disabled ? 'not-allowed' : 'pointer',
          }}>
            <input
              type="radio"
              name="tradingMode"
              value={opt.id}
              checked={config.tradingMode === opt.id}
              disabled={opt.disabled}
              onChange={() => !opt.disabled && update({ tradingMode: opt.id })}
              style={{ marginTop: 2 }}
            />
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-1)' }}>{opt.label}</div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{opt.sub}</div>
            </div>
          </label>
        ))}
      </RcSection>

      <div style={{ marginTop: 24, padding: 12, fontSize: 11, color: 'var(--text-4)', textAlign: 'center' }}>
        T-262. Replaces scripts/SETUP-TRADING.cmd. Configuration is per-user and persisted in user_risk_config.
      </div>
    </>
  );
};

// ---------- helpers (module-scoped, not exported) ----------

function _clone(o) { return JSON.parse(JSON.stringify(o)); }

function _validate(c) {
  if (!c) return [];
  const errs = [];
  if (!Number.isFinite(c.capital) || c.capital < 1000 || c.capital > 10000000) {
    errs.push({ field: 'capital', msg: 'Capital must be between 1,000 and 10,000,000.' });
  }
  if (!Number.isFinite(c.maxPositionPct) || c.maxPositionPct < 0 || c.maxPositionPct > 1) {
    errs.push({ field: 'maxPositionPct', msg: 'Max position must be between 0 and 100%.' });
  }
  if (!Number.isFinite(c.maxDailyLossPct) || c.maxDailyLossPct < 0 || c.maxDailyLossPct > 1) {
    errs.push({ field: 'maxDailyLossPct', msg: 'Max daily loss must be between 0 and 100%.' });
  }
  if (!Number.isInteger(c.maxOpenPositions) || c.maxOpenPositions < 1 || c.maxOpenPositions > 50) {
    errs.push({ field: 'maxOpenPositions', msg: 'Max open positions must be between 1 and 50.' });
  }
  const dcaSum = DCA_SYMBOLS.reduce((a, s) => a + Number(c.dcaAllocation && c.dcaAllocation[s] || 0), 0);
  if (dcaSum > 1.000001) errs.push({ field: 'dca', msg: `DCA total is ${(dcaSum * 100).toFixed(2)}% (>100%). Reduce one or more allocations.` });
  if (!Array.isArray(c.activeStrategies) || c.activeStrategies.length === 0) {
    errs.push({ field: 'activeStrategies', msg: 'Select at least one active strategy.' });
  }
  if (!Number.isInteger(c.votingThreshold) || c.votingThreshold < 1 || c.votingThreshold > (c.activeStrategies ? c.activeStrategies.length : 0)) {
    errs.push({ field: 'votingThreshold', msg: 'Voting threshold must be between 1 and the number of active strategies.' });
  }
  if (!['paper', 'micro_live', 'full_live'].includes(c.tradingMode)) {
    errs.push({ field: 'tradingMode', msg: 'Invalid trading mode.' });
  }
  return errs;
}

const _inputStyle = {
  width: 140, padding: '4px 8px', fontSize: 13,
  background: 'var(--bg)', color: 'var(--text-1)',
  border: '1px solid var(--border)', borderRadius: 4,
};

// Tiny presentational helpers (no external dep on primitives.jsx so this
// screen stays self-contained and won't break if those are renamed).
const RcSection = ({ title, sub, children }) => (
  <section style={{
    marginBottom: 18, padding: 16,
    background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
  }}>
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)' }}>{title}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{sub}</div>}
    </div>
    {children}
  </section>
);

const Field = ({ label, hint, children }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
    <div style={{ width: 220, fontSize: 12, color: 'var(--text-2)' }}>{label}</div>
    {children}
    {hint && <div style={{ fontSize: 11, color: 'var(--text-4)' }}>{hint}</div>}
  </div>
);

// PctInput: displays a 0-100 percent value but stores 0-1 in state.
const PctInput = ({ value, onChange, max = 100, step = 0.1 }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
    <input type="number" min="0" max={max} step={step}
      value={((Number(value) || 0) * 100).toFixed(2).replace(/\.?0+$/, '')}
      onChange={e => {
        const pct = Number(e.target.value);
        onChange(Number.isFinite(pct) ? pct / 100 : 0);
      }}
      style={{ ..._inputStyle, width: 90 }}
    />
    <span style={{ fontSize: 12, color: 'var(--text-3)' }}>%</span>
  </div>
);
