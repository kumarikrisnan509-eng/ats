/* eslint-disable */
// @ts-check
/* Money — the heart of the wealth loop.
   AI Signal -> Paper trade -> Live trade -> PROFITS -> Reinvest long-term.
   This screen is the "PROFITS -> Reinvest" hub. Three sections:
     1. Today's earnings + sweep progress (live /api/paper)
     2. Long-term portfolio breakdown (live /api/portfolio/holdings)
     3. Sweep rules editor (CRUD against /api/sweep)
*/

const MoneyScreen = () => {
  // ---- live paper stats (for today's earning) ----
  const [paperStats, setPaperStats] = React.useState(null);
  // ---- live holdings (for long-term breakdown) ----
  const [holdings, setHoldings] = React.useState(null);
  // ---- sweep state ----
  const [sweepData, setSweepData] = React.useState(null);
  const [evalData, setEvalData]   = React.useState(null);
  const [busy, setBusy]           = React.useState(false);
  const [msg, setMsg]             = React.useState("");
  // T-180 (SCREENS-AUDIT F-16 / item 3): sweep/execute moves money. Gate the
  // POST through TwoFactorModal (typed-phrase confirm) before firing.
  const [confirm2FA, setConfirm2FA] = React.useState(null); // {action, detail, onYes}
  // Tier 20: bucket strategy (emergency / short-term / long-term)
  const [buckets, setBuckets]     = React.useState(null);
  const [bucketDraft, setBucketDraft] = React.useState(null);
  // Tier 24: rebalance suggestions
  const [rebal, setRebal]         = React.useState(null);
  const [rebalBusy, setRebalBusy] = React.useState(false);
  // Tier 25: MPT portfolio optimiser
  // T-353d: Initial state was seeded with 3 fake assets (NIFTYBEES 12%/18%, GOLDBEES
  // 8%/15%, BOND-G7 7%/7%) -- never gated to demo, so every user saw fabricated
  // expected-return / volatility numbers in the asset-allocation tool. Start empty
  // and let the user add assets via the Add-Asset button.
  const [mptInputs, setMptInputs] = React.useState([]);
  const [mptResult, setMptResult] = React.useState(null);
  const [mptBusy, setMptBusy]     = React.useState(false);
  const runOptimize = async () => {
    setMptBusy(true); setMptResult(null);
    try {
      // Build inputs from current state
      const n = mptInputs.length;
      const symbols = mptInputs.map(x => x.symbol);
      const expectedReturns = mptInputs.map(x => Number(x.expectedReturnPct) / 100);
      // Diagonal cov matrix from vol (simple, user can refine later)
      const covMatrix = [];
      for (let i = 0; i < n; i++) {
        const row = [];
        for (let j = 0; j < n; j++) {
          if (i === j) row.push(Math.pow(Number(mptInputs[i].volPct) / 100, 2));
          else row.push(0.001); // small cross-asset correlation default
        }
        covMatrix.push(row);
      }
      const r = await window.fetchApi('/api/portfolio/optimize', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ symbols, expectedReturns, covMatrix, samples: 20000 }),
      });
      if (r && r.ok) setMptResult(r);
      else setMptResult({ ok: false, reason: (r && r.reason) || 'failed' });
    } catch (e) { setMptResult({ ok: false, reason: e.message }); }
    finally { setMptBusy(false); }
  };
  const addMptAsset = () => setMptInputs([...mptInputs, { symbol: '', expectedReturnPct: 10, volPct: 15 }]);
  const removeMptAsset = (i) => setMptInputs(mptInputs.filter((_, k) => k !== i));
  const updateMptAsset = (i, field, value) => {
    const next = mptInputs.slice();
    next[i] = { ...next[i], [field]: value };
    setMptInputs(next);
  };
  const runRebalance = async () => {
    setRebalBusy(true);
    try {
      const r = await window.fetchApi('/api/rebalance', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),  // auto-derives buckets + holdings + paper equity + cash
      });
      if (r && r.ok) setRebal(r);
      else setRebal({ ok: false, reason: (r && r.reason) || 'failed' });
    } catch (e) { setRebal({ ok: false, reason: e.message }); }
    finally { setRebalBusy(false); }
  };
  const saveBuckets = async (b) => {
    setBusy(true); setMsg('');
    try {
      const r = await window.fetchApi('/api/buckets', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ buckets: b }),
      });
      if (r && r.ok && r.buckets) { setBuckets(r.buckets); setMsg('Saved.'); setBucketDraft(null); }
      else setMsg('Save failed: ' + ((r && r.reason) || 'unknown'));
    } catch (e) { setMsg('Save failed: ' + e.message); }
    finally { setBusy(false); setTimeout(() => setMsg(''), 3500); }
  };

  const refresh = React.useCallback(async () => {
    try {
      const [p, h, sw, ev, bk] = await Promise.all([
        window.fetchApi('/api/paper').catch(() => null),
        window.fetchApi('/api/portfolio/holdings').catch(() => null),
        window.fetchApi('/api/sweep').catch(() => null),
        window.fetchApi('/api/sweep/evaluate').catch(() => null),
        window.fetchApi('/api/buckets').catch(() => null),
      ]);
      if (p  && p.ok)  setPaperStats(p.stats || p);
      if (h  && h.ok)  setHoldings(h.rows || []);
      if (sw && sw.ok) setSweepData(sw);
      if (ev && ev.ok) setEvalData(ev);
      if (bk && bk.ok && bk.buckets) setBuckets(bk.buckets);
    } catch (e) { console.warn('[screen-money] error:', e && e.message); }
  }, []);

  React.useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30000);
    return () => clearInterval(t);
  }, [refresh]);

  // -------- numbers --------
  const realized   = (paperStats && paperStats.realizedPnl)   || 0;
  const unrealized = (paperStats && paperStats.unrealizedPnl) || 0;
  const totalToday = realized + unrealized;
  // Sum potential sweep this round (across all enabled rules)
  const wouldSweepTotal = (evalData && evalData.wouldSweep || []).reduce((a, b) => a + (b.sweepINR || 0), 0);
  // First enabled rule's minProfitINR -> use as a visual progress denominator
  const rules = (sweepData && sweepData.rules) || [];
  const firstEnabled = rules.find(r => r.enabled);
  const threshold = firstEnabled ? firstEnabled.minProfitINR : 0;
  const pct = threshold > 0 ? Math.min(100, Math.max(0, Math.round((realized / threshold) * 100))) : (realized > 0 ? 100 : 0);

  // Group holdings into rough asset-classes by symbol heuristic
  const grouped = React.useMemo(() => {
    if (!holdings) return null;
    const buckets = { Equity: 0, ETF: 0, MF: 0, Other: 0 };
    for (const h of holdings) {
      const v = (h.quantity || h.qty || 0) * (h.last_price || h.ltp || h.lastPrice || 0);
      const sym = String(h.tradingsymbol || h.symbol || '').toUpperCase();
      let key = 'Equity';
      if (/BEES$|ETF$|NV20$|GOLD/.test(sym)) key = 'ETF';
      else if (/AXIS|HDFC|SBI|ICICI|UTI|MIRAE|PARAG|NIPPON|TATA/.test(sym) && /MF$|FUND$/.test(sym)) key = 'MF';
      else if (sym.length < 2) key = 'Other';
      buckets[key] = (buckets[key] || 0) + v;
    }
    const total = Object.values(buckets).reduce((a, b) => a + b, 0);
    return { buckets, total };
  }, [holdings]);

  const fmtInr = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');

  // -------- rule editor --------
  const [draft, setDraft] = React.useState(null); // editing rule
  const blankRule = () => ({
    id: null,
    enabled: true,
    cadence: 'daily',
    minProfitINR: 2000,
    sweepMode: 'pct',
    sweepPct: 60,
    sweepAbsINR: 0,
    target: 'NIFTYBEES',
    targetKind: 'etf',
    notes: '',
  });

  const saveRules = async (nextRules) => {
    setBusy(true); setMsg("");
    try {
      const r = await window.fetchApi('/api/sweep', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rules: nextRules }),
      });
      if (r && r.ok) { setMsg("Saved."); await refresh(); }
      else setMsg("Save failed: " + ((r && r.reason) || 'unknown'));
    } catch (e) { setMsg("Save failed: " + e.message); }
    finally { setBusy(false); setTimeout(() => setMsg(""), 3500); }
  };

  const upsertRule = async (r) => {
    const cur = rules.slice();
    if (r.id) {
      const i = cur.findIndex(x => x.id === r.id);
      if (i >= 0) cur[i] = r; else cur.push(r);
    } else cur.push(r);
    await saveRules(cur);
    setDraft(null);
  };
  const deleteRule = async (id) => {
    if (!confirm('Delete this sweep rule?')) return;
    await saveRules(rules.filter(x => x.id !== id));
  };
  const toggleRule = async (id) => {
    await saveRules(rules.map(x => x.id === id ? { ...x, enabled: !x.enabled } : x));
  };

  // T-180 (SCREENS-AUDIT F-16): split the actual POST out so the 2FA modal's
  // onConfirm can call it after the user types the confirm phrase.
  const _doSweepPost = async () => {
    setBusy(true); setMsg("");
    try {
      const r = await window.fetchApi('/api/sweep/execute', { method: 'POST' });
      if (r && r.ok) { setMsg(`Logged ${r.executed ? r.executed.length : 0} sweep entry(s).`); await refresh(); }
      else setMsg("Execute failed");
    } catch (e) { setMsg("Execute failed: " + e.message); }
    finally { setBusy(false); setTimeout(() => setMsg(""), 4000); }
  };
  const executeSweep = () => {
    // If TwoFactorModal isn't loaded for some reason, fall back to a native
    // confirm so we never lose the money-move guard entirely.
    if (!window.TwoFactorModal) {
      if (!confirm(`Execute sweep of ${fmtInr(wouldSweepTotal)} now? This will move funds into your long-term plan.`)) return;
      _doSweepPost();
      return;
    }
    setConfirm2FA({
      action: 'Confirm sweep execution',
      detail: `You are about to move ${fmtInr(wouldSweepTotal)} from trading profits into your long-term plan. This is a paper-only log today; once live trading is enabled it will place real orders. Type the confirm phrase below to proceed.`,
      onYes: _doSweepPost,
    });
  };

  // -------- UI --------
  return (
    <>
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* heading */}
      <div>
        <div style={{ fontSize: 12, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.6 }}>Wealth loop</div>
        <div style={{ fontSize: 22, fontWeight: 600, marginTop: 2 }}>Money: profits → long-term</div>
        <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 4 }}>
          Earned by AI signals + paper/live trades. Excess profit auto-sweeps into your long-term plan (ETF / SIP / Smallcase).
        </div>
      </div>

      {/* Row 1: today's earning + sweep progress */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ padding: 16, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase' }}>Today’s earning (paper)</div>
          <div style={{ fontSize: 28, fontWeight: 700, marginTop: 4, color: realized >= 0 ? 'var(--up)' : 'var(--down)' }}>
            {fmtInr(realized)}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4 }}>
            Realized · unrealized {fmtInr(unrealized)} · total {fmtInr(totalToday)}
          </div>
          {paperStats && (
            <div style={{ marginTop: 10, display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-2)' }}>
              <div>trades <b>{paperStats.tradeCount || 0}</b></div>
              <div>win-rate <b>{paperStats.winRate != null ? (paperStats.winRate * 100).toFixed(0) + '%' : '—'}</b></div>
              <div>equity <b>{fmtInr(paperStats.totalEquity || 0)}</b></div>
            </div>
          )}
        </div>

        <div style={{ padding: 16, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase' }}>Sweep progress</div>
            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>vs. threshold {fmtInr(threshold)}</div>
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, marginTop: 4 }}>{pct}%</div>
          <div style={{ height: 8, background: 'var(--bg-soft)', borderRadius: 999, marginTop: 8, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: pct + '%', background: pct >= 100 ? 'var(--up)' : 'var(--acc)', transition: 'width 0.4s' }}/>
          </div>
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-2)' }}>
            Would sweep right now: <b style={{ color: 'var(--text-1)' }}>{fmtInr(wouldSweepTotal)}</b>
            {evalData && evalData.wouldSweep && evalData.wouldSweep.length > 0 && (
              <span style={{ color: 'var(--text-3)' }}> · {evalData.wouldSweep.length} rule(s) firing</span>
            )}
          </div>
          <button
            onClick={executeSweep}
            disabled={busy || wouldSweepTotal <= 0}
            style={{
              marginTop: 12, padding: '8px 14px', fontSize: 13, fontWeight: 500,
              background: wouldSweepTotal > 0 ? 'var(--acc)' : 'var(--bg-soft)',
              color: wouldSweepTotal > 0 ? 'white' : 'var(--text-3)',
              border: '1px solid var(--border)', borderRadius: 8,
              cursor: wouldSweepTotal > 0 && !busy ? 'pointer' : 'not-allowed',
            }}
          >
            {busy ? 'Working…' : 'Sweep now (paper)'}
          </button>
          {msg && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-2)' }}>{msg}</div>}
        </div>
      </div>

      {/* Row 2: long-term portfolio breakdown */}
      <div style={{ padding: 16, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase' }}>Long-term portfolio</div>
            <div style={{ fontSize: 18, fontWeight: 600, marginTop: 2 }}>
              {grouped ? fmtInr(grouped.total) : '—'}
            </div>
          </div>
          <a href="#portfolio" style={{ fontSize: 12, color: 'var(--acc)' }}>Full portfolio →</a>
        </div>
        {!grouped && <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Loading holdings…</div>}
        {grouped && grouped.total === 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>No holdings yet. Once sweeps start placing real orders, breakdown will appear here.</div>
        )}
        {grouped && grouped.total > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            {Object.entries(grouped.buckets).map(([k, v]) => {
              const ppct = grouped.total > 0 ? Math.round((v / grouped.total) * 100) : 0;
              return (
                <div key={k} style={{ padding: 12, background: 'var(--bg-soft)', borderRadius: 8 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{k}</div>
                  <div style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>{fmtInr(v)}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>{ppct}% of total</div>
                  <div style={{ height: 4, background: 'var(--surface)', borderRadius: 99, marginTop: 6, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: ppct + '%', background: 'var(--acc)' }}/>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Tier 20: Bucket strategy (emergency / short / long) */}
      <div style={{ padding: 16, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase' }}>Bucket strategy</div>
            <div style={{ fontSize: 18, fontWeight: 600, marginTop: 2 }}>Emergency · Short-term · Long-term</div>
          </div>
          <button onClick={() => setBucketDraft({ ...(buckets || { emergency: 20, shortTerm: 30, longTerm: 50 }) })}
            style={{ padding: '6px 12px', fontSize: 12, background: 'var(--bg-soft)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer' }}>
            Edit
          </button>
        </div>
        {buckets ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {[
              { k: 'emergency',  label: 'Emergency',  pct: buckets.emergency, color: 'var(--down)' },
              { k: 'shortTerm',  label: 'Short-term', pct: buckets.shortTerm, color: 'var(--acc)' },
              { k: 'longTerm',   label: 'Long-term',  pct: buckets.longTerm,  color: 'var(--up)' },
            ].map(b => (
              <div key={b.k} style={{ padding: 12, background: 'var(--bg-soft)', borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{b.label}</div>
                <div style={{ fontSize: 18, fontWeight: 600, marginTop: 2 }}>{b.pct}%</div>
                <div style={{ height: 4, background: 'var(--surface)', borderRadius: 99, marginTop: 6, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: b.pct + '%', background: b.color }}/>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Loading bucket allocation…</div>
        )}
        {buckets && (buckets.emergency + buckets.shortTerm + buckets.longTerm < 100) && (
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-3)' }}>
            Unallocated: {100 - (buckets.emergency + buckets.shortTerm + buckets.longTerm)}% (working capital / trading book)
          </div>
        )}
      </div>

      {/* Tier 25: Portfolio optimiser (MPT) */}
      <div style={{ padding: 16, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase' }}>Portfolio optimiser</div>
            <div style={{ fontSize: 18, fontWeight: 600, marginTop: 2 }}>Modern Portfolio Theory · max-Sharpe + min-variance</div>
          </div>
          <button onClick={runOptimize} disabled={mptBusy || mptInputs.length < 2} style={{
            padding: '6px 12px', fontSize: 12, fontWeight: 500,
            background: 'var(--acc)', color: 'white', border: 0, borderRadius: 6,
            cursor: mptBusy ? 'wait' : 'pointer',
          }}>{mptBusy ? 'Solving...' : 'Optimize'}</button>
        </div>

        {/* Asset input table */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 30px', gap: 8, fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', padding: '0 6px' }}>
            <div>Symbol</div>
            <div>Expected return %/yr</div>
            <div>Volatility %/yr</div>
            <div></div>
          </div>
          {mptInputs.map((a, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 30px', gap: 8, alignItems: 'center' }}>
              <input value={a.symbol} onChange={e => updateMptAsset(i, 'symbol', e.target.value)} style={mptInpStyle} placeholder="NIFTYBEES"/>
              <input type="number" step="0.5" value={a.expectedReturnPct} onChange={e => updateMptAsset(i, 'expectedReturnPct', Number(e.target.value) || 0)} style={mptInpStyle}/>
              <input type="number" step="0.5" value={a.volPct} onChange={e => updateMptAsset(i, 'volPct', Number(e.target.value) || 0)} style={mptInpStyle}/>
              <button onClick={() => removeMptAsset(i)} disabled={mptInputs.length <= 2} style={{
                fontSize: 12, color: 'var(--down)', background: 'transparent', border: 0,
                cursor: mptInputs.length > 2 ? 'pointer' : 'not-allowed',
              }}>x</button>
            </div>
          ))}
          {mptInputs.length < 10 && (
            <button onClick={addMptAsset} style={{
              padding: '4px 10px', fontSize: 11, alignSelf: 'flex-start',
              background: 'var(--bg-soft)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer',
            }}>+ Add asset</button>
          )}
        </div>

        {mptResult && mptResult.ok === false && (
          <div style={{ padding: 10, background: 'var(--down-soft)', color: 'var(--down)', borderRadius: 6, fontSize: 12 }}>
            Error: {mptResult.reason}
          </div>
        )}

        {mptResult && mptResult.maxSharpe && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <PortfolioCard
              title="Max Sharpe"
              subtitle="tangency portfolio"
              data={mptResult.maxSharpe}
              symbols={mptResult.symbols}
              tone="up"
            />
            <PortfolioCard
              title="Min Variance"
              subtitle="lowest-risk portfolio"
              data={mptResult.minVariance}
              symbols={mptResult.symbols}
              tone="info"
            />
          </div>
        )}

        {mptResult && mptResult.frontier && (
          <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-3)' }}>
            Efficient frontier sampled at {mptResult.frontier.length} points · {mptResult.samples} Monte Carlo trials · risk-free {(mptResult.riskFreeRate * 100).toFixed(1)}%
          </div>
        )}

        {!mptResult && (
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
            Enter 2-10 assets with expected annual return and volatility. Click <b>Optimize</b> to solve for max-Sharpe and min-variance weights.
          </div>
        )}
      </div>

      {/* Tier 24: Rebalance check */}
      <div style={{ padding: 16, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase' }}>Rebalance</div>
            <div style={{ fontSize: 18, fontWeight: 600, marginTop: 2 }}>Bucket-target drift check</div>
          </div>
          <button onClick={runRebalance} disabled={rebalBusy} style={{
            padding: '6px 12px', fontSize: 12, fontWeight: 500,
            background: 'var(--acc)', color: 'white', border: 0, borderRadius: 6,
            cursor: rebalBusy ? 'wait' : 'pointer',
          }}>{rebalBusy ? 'Checking...' : 'Check now'}</button>
        </div>

        {!rebal && (
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
            Click <b>Check now</b> to compare your current allocation (Kite holdings + paper equity + cash) against your bucket targets.
          </div>
        )}

        {rebal && rebal.ok === false && (
          <div style={{ padding: 10, background: 'var(--down-soft)', color: 'var(--down)', borderRadius: 6, fontSize: 12 }}>
            Error: {rebal.reason}
          </div>
        )}

        {rebal && rebal.triggered === false && (
          <div style={{ padding: 12, background: 'var(--up-soft)', color: 'var(--up)', borderRadius: 6, fontSize: 13 }}>
            ✓ Allocation is within tolerance ({rebal.thresholdPct}% threshold). No rebalancing needed.
          </div>
        )}

        {rebal && rebal.triggered === true && (
          <>
            <div style={{ padding: 12, background: 'var(--warn-soft)', color: 'oklch(45% 0.13 80)', borderRadius: 6, fontSize: 13, marginBottom: 12 }}>
              Drift exceeds {rebal.thresholdPct}% threshold. {rebal.suggestions.length} suggested move(s):
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {rebal.suggestions.map((s, i) => (
                <div key={i} style={{ padding: 10, background: 'var(--bg-soft)', borderRadius: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>
                    <span style={{
                      padding: '2px 8px', fontSize: 10, fontWeight: 600, borderRadius: 4,
                      background: s.action === 'INCREASE' ? 'var(--up)' : 'var(--down)',
                      color: 'white', marginRight: 8,
                    }}>{s.action}</span>
                    <b>{s.bucket}</b> by ₹{(s.amountINR || 0).toLocaleString('en-IN')}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4 }}>{s.suggestedHow || s.rationale}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-3)' }}>
              Total portfolio: ₹{(rebal.total || 0).toLocaleString('en-IN')}.
              Current: emergency {rebal.current.emergency}% · short {rebal.current.shortTerm}% · long {rebal.current.longTerm}%.
            </div>
          </>
        )}
      </div>

      {/* Row 3: sweep rules editor */}
      <div style={{ padding: 16, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase' }}>Sweep rules</div>
            <div style={{ fontSize: 18, fontWeight: 600, marginTop: 2 }}>{rules.length} rule(s) · {rules.filter(r => r.enabled).length} enabled</div>
          </div>
          <button
            onClick={() => setDraft(blankRule())}
            style={{ padding: '6px 12px', fontSize: 12, background: 'var(--acc)', color: 'white', border: 0, borderRadius: 6, cursor: 'pointer' }}
          >
            + New rule
          </button>
        </div>

        {rules.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--text-2)', padding: 16, background: 'var(--bg-soft)', borderRadius: 8 }}>
            No sweep rules yet. Add one to start auto-reinvesting your trading profits into long-term holdings.
            <br/>
            <span style={{ color: 'var(--text-3)', fontSize: 12 }}>
              Example: <i>"When today's realized P&L &gt; ₹2,000, sweep 60% into NIFTYBEES."</i>
            </span>
          </div>
        )}

        {rules.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rules.map(r => (
              <div key={r.id} style={{
                padding: 12, background: 'var(--bg-soft)', borderRadius: 8,
                display: 'grid', gridTemplateColumns: '40px 1fr auto', gap: 12, alignItems: 'center',
              }}>
                <button
                  onClick={() => toggleRule(r.id)}
                  title={r.enabled ? 'Click to pause' : 'Click to enable'}
                  style={{
                    width: 28, height: 16, borderRadius: 99, border: 0,
                    background: r.enabled ? 'var(--up)' : 'var(--text-3)',
                    position: 'relative', cursor: 'pointer',
                  }}
                >
                  <span style={{
                    position: 'absolute', top: 2, left: r.enabled ? 14 : 2,
                    width: 12, height: 12, borderRadius: '50%', background: 'white', transition: 'left 0.2s',
                  }}/>
                </button>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>
                    When {r.cadence} profit &gt; <b>{fmtInr(r.minProfitINR)}</b>, sweep {' '}
                    {r.sweepMode === 'pct'      && <span><b>{r.sweepPct}%</b> of excess</span>}
                    {r.sweepMode === 'absolute' && <span>up to <b>{fmtInr(r.sweepAbsINR)}</b></span>}
                    {r.sweepMode === 'all_above'&& <span><b>everything above threshold</b></span>}
                    {' '}→ <b>{r.target}</b> <span style={{ fontSize: 11, color: 'var(--text-3)' }}>({r.targetKind})</span>
                  </div>
                  {r.notes && <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 3 }}>{r.notes}</div>}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => setDraft(r)} style={{ fontSize: 11, padding: '4px 10px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer' }}>Edit</button>
                  <button onClick={() => deleteRule(r.id)} style={{ fontSize: 11, padding: '4px 10px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--down)', cursor: 'pointer' }}>×</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {sweepData && sweepData.history && sweepData.history.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', marginBottom: 6 }}>Recent sweeps</div>
            <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
              {sweepData.history.slice(0, 5).map(h => (
                <div key={h.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
                  <span>{new Date(h.ts).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                  <span><b>{fmtInr(h.sweepINR)}</b> → {h.target} <span style={{ color: 'var(--text-3)' }}>({h.status})</span></span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-3)' }}>
              Total swept lifetime: <b style={{ color: 'var(--text-1)' }}>{fmtInr(sweepData.stats && sweepData.stats.totalSweptINR || 0)}</b>
            </div>
          </div>
        )}
      </div>

      {/* edit modal */}
      {draft && (
        <div onClick={() => setDraft(null)} style={{
          position: 'fixed', inset: 0, background: 'oklch(0% 0 0 / 0.5)', zIndex: 100,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            width: 520, padding: 24, background: 'var(--surface)',
            border: '1px solid var(--border)', borderRadius: 12,
            maxHeight: '90vh', overflowY: 'auto',
          }}>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>
              {draft.id ? 'Edit sweep rule' : 'New sweep rule'}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <MoneyField label="Cadence">
                <select value={draft.cadence} onChange={e => setDraft({ ...draft, cadence: e.target.value })} style={selStyle}>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </MoneyField>
              <MoneyField label="Min profit (₹)">
                <input type="number" value={draft.minProfitINR} onChange={e => setDraft({ ...draft, minProfitINR: Number(e.target.value) || 0 })} style={inpStyle}/>
              </MoneyField>

              <MoneyField label="Sweep mode">
                <select value={draft.sweepMode} onChange={e => setDraft({ ...draft, sweepMode: e.target.value })} style={selStyle}>
                  <option value="pct">Percent of excess</option>
                  <option value="absolute">Absolute (₹)</option>
                  <option value="all_above">Everything above threshold</option>
                </select>
              </MoneyField>
              {draft.sweepMode === 'pct' && (
                <MoneyField label="Percent (%)">
                  <input type="number" value={draft.sweepPct} onChange={e => setDraft({ ...draft, sweepPct: Number(e.target.value) || 0 })} style={inpStyle}/>
                </MoneyField>
              )}
              {draft.sweepMode === 'absolute' && (
                <MoneyField label="Absolute (₹)">
                  <input type="number" value={draft.sweepAbsINR} onChange={e => setDraft({ ...draft, sweepAbsINR: Number(e.target.value) || 0 })} style={inpStyle}/>
                </MoneyField>
              )}
              {draft.sweepMode === 'all_above' && <div/>}

              <MoneyField label="Target symbol">
                <input value={draft.target} onChange={e => setDraft({ ...draft, target: e.target.value })} placeholder="NIFTYBEES" style={inpStyle}/>
              </MoneyField>
              <MoneyField label="Target kind">
                <select value={draft.targetKind} onChange={e => setDraft({ ...draft, targetKind: e.target.value })} style={selStyle}>
                  <option value="etf">ETF</option>
                  <option value="sip">SIP / MF</option>
                  <option value="smallcase">Smallcase</option>
                  <option value="manual">Manual reminder</option>
                </select>
              </MoneyField>
            </div>

            <MoneyField label="Notes (optional)">
              <input value={draft.notes || ''} onChange={e => setDraft({ ...draft, notes: e.target.value })} placeholder="e.g., retirement bucket" style={inpStyle}/>
            </MoneyField>

            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-3)', padding: 8, background: 'var(--bg-soft)', borderRadius: 6 }}>
              Preview: when {draft.cadence} profit &gt; ₹{Number(draft.minProfitINR || 0).toLocaleString('en-IN')}, sweep{' '}
              {draft.sweepMode === 'pct' && `${draft.sweepPct}% of excess`}
              {draft.sweepMode === 'absolute' && `up to ₹${Number(draft.sweepAbsINR || 0).toLocaleString('en-IN')}`}
              {draft.sweepMode === 'all_above' && 'all above threshold'}
              {' '}into <b>{draft.target}</b>.
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button onClick={() => setDraft(null)} style={{ padding: '8px 14px', fontSize: 13, background: 'var(--bg-soft)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => upsertRule(draft)} disabled={busy} style={{ padding: '8px 14px', fontSize: 13, fontWeight: 500, background: 'var(--acc)', color: 'white', border: 0, borderRadius: 6, cursor: 'pointer' }}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tier 20: bucket edit modal */}
      {bucketDraft && (
        <div onClick={() => setBucketDraft(null)} style={{
          position: 'fixed', inset: 0, background: 'oklch(0% 0 0 / 0.5)', zIndex: 100,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            width: 420, padding: 24, background: 'var(--surface)',
            border: '1px solid var(--border)', borderRadius: 12,
          }}>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Edit bucket allocation</div>
            <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 12 }}>Percentages must sum to ≤ 100. The remainder is your working capital / trading book.</div>
            {[
              { k: 'emergency',  label: 'Emergency (3-6mo expenses)' },
              { k: 'shortTerm',  label: 'Short-term (1-3y goals)' },
              { k: 'longTerm',   label: 'Long-term (retirement, kids)' },
            ].map(b => (
              <div key={b.k} style={{ marginTop: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>{b.label}</div>
                <input type="number" min="0" max="100"
                  value={bucketDraft[b.k]}
                  onChange={e => setBucketDraft({ ...bucketDraft, [b.k]: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                  style={{ width: '100%', padding: '6px 10px', fontSize: 13, background: 'var(--bg-soft)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-1)' }}/>
              </div>
            ))}
            <div style={{ marginTop: 10, fontSize: 11, color: bucketDraft.emergency + bucketDraft.shortTerm + bucketDraft.longTerm > 100 ? 'var(--down)' : 'var(--text-3)' }}>
              Sum: {bucketDraft.emergency + bucketDraft.shortTerm + bucketDraft.longTerm}% (max 100)
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button onClick={() => setBucketDraft(null)} style={{ padding: '8px 14px', fontSize: 13, background: 'var(--bg-soft)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => saveBuckets(bucketDraft)} disabled={busy || (bucketDraft.emergency + bucketDraft.shortTerm + bucketDraft.longTerm > 100)}
                style={{ padding: '8px 14px', fontSize: 13, fontWeight: 500, background: 'var(--acc)', color: 'white', border: 0, borderRadius: 6, cursor: 'pointer' }}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    {window.TwoFactorModal && (
      <window.TwoFactorModal
        open={!!confirm2FA}
        onClose={() => setConfirm2FA(null)}
        action={confirm2FA && confirm2FA.action}
        detail={confirm2FA && confirm2FA.detail}
        onConfirm={confirm2FA && confirm2FA.onYes}
      />
    )}
    </>
  );
};

const inpStyle = { width: '100%', padding: '6px 10px', fontSize: 13, background: 'var(--bg-soft)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-1)' };
const selStyle = { ...inpStyle };
const MoneyField = ({ label, children }) => (
  <div style={{ marginTop: 10 }}>
    <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>{label}</div>
    {children}
  </div>
);

const mptInpStyle = { padding: '6px 10px', fontSize: 12, background: 'var(--bg-soft)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-1)' };

const PortfolioCard = ({ title, subtitle, data, symbols, tone }) => {
  const color = tone === 'up' ? 'var(--up)' : tone === 'info' ? 'var(--info)' : 'var(--text-1)';
  return (
    <div style={{ padding: 12, background: 'var(--bg-soft)', borderRadius: 8 }}>
      <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase' }}>{title}</div>
      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{subtitle}</div>
      <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
        <MptStat sub="Sharpe"  value={data.sharpe.toFixed(2)}  color={color}/>
        <MptStat sub="Return"  value={(data.expectedReturn * 100).toFixed(1) + '%'} color={color}/>
        <MptStat sub="Vol"     value={(data.volatility * 100).toFixed(1) + '%'} color={color}/>
      </div>
      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {symbols.map((s, i) => {
          const wPct = data.weights[i] * 100;
          return (
            <div key={s} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, fontSize: 11, alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ minWidth: 80 }}>{s}</span>
                <div style={{ flex: 1, height: 4, background: 'var(--surface)', borderRadius: 99, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: wPct + '%', background: color }}/>
                </div>
              </div>
              <span className="mono" style={{ fontWeight: 500 }}>{wPct.toFixed(1)}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const MptStat = ({ sub, value, color }) => (
  <div>
    <div style={{ fontSize: 10, color: 'var(--text-3)' }}>{sub}</div>
    <div style={{ fontSize: 14, fontWeight: 600, color, marginTop: 1 }} className="mono">{value}</div>
  </div>
);

window.MoneyScreen = MoneyScreen;
