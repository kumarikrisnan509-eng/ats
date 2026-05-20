/* eslint-disable */
/* T-249 + T-252 (polish) + T-253 (DCA wired to /api/sip):
 *
 * Long-Term basket screen — the API-buyable replacement for the retired MF
 * picker. Surfaces a curated set of exchange-traded ETFs that cover the same
 * "passive long-term holding" use case as index/sector/gold/intl mutual funds,
 * but trade on NSE/BSE like any other stock and so CAN be placed through
 * /api/orders/place. Kite Connect MF API is GET-only by Zerodha/SEBI
 * bank-mandate design; ETFs have no such constraint.
 *
 * Five curated buckets:
 *   - Broad index    : NIFTYBEES   (Nifty 50)
 *   - Mid/small      : JUNIORBEES  (Nifty Next 50)
 *   - Sector tilt    : BANKBEES    (Bank Nifty)
 *   - International  : MOM100      (Motilal Nasdaq 100)
 *   - Gold hedge     : GOLDBEES    (physical gold ETF)
 *
 * LTPs come from /api/quotes (REST snapshot of last traded price, returns
 * current during market hours / last close after-hours). Polled every 30s.
 * These symbols aren't in the default watchlist that drives the ws ticker
 * stream, so REST snapshotting is more reliable than chasing a subscribe
 * surface.
 *
 * Buy CTA: POST /api/orders/dry-run -> on ok confirm -> route to #trading
 * which has the full 2FA + place flow. We don't place directly from this
 * screen so we stay inside the audited live-trading pipeline.
 *
 * Auto-DCA CTA: PUT /api/sip with a new SIP entry pre-filled for the ETF.
 * The backend's existing longterm engine (Tier 18) handles the monthly
 * scheduling; no new cron infra needed.
 */

const LONG_TERM_BASKET = [
  {
    symbol: 'NIFTYBEES', exchange: 'NSE', title: 'Nifty 50 ETF',
    bucket: 'broad-index', issuer: 'Nippon India',
    thesis: 'Tracks the 50 largest NSE-listed companies. The closest direct replacement for a Nifty 50 index fund -- but exchange-traded and API-buyable.',
    expense_ratio_pct: 0.04, typical_pct_of_portfolio: '40-60%',
  },
  {
    symbol: 'JUNIORBEES', exchange: 'NSE', title: 'Nifty Next 50 ETF',
    bucket: 'mid-cap', issuer: 'Nippon India',
    thesis: 'The companies ranked 51-100 -- candidates to enter the Nifty 50. Historically higher returns + higher volatility than the Nifty 50. Use as a satellite to the broad-index core.',
    expense_ratio_pct: 0.15, typical_pct_of_portfolio: '10-20%',
  },
  {
    symbol: 'BANKBEES', exchange: 'NSE', title: 'Bank Nifty ETF',
    bucket: 'sector', issuer: 'Nippon India',
    thesis: 'Concentrated bet on Indian banks. Cyclical -- significant beta to interest-rate moves and credit cycle. Use sparingly; skip if you already hold direct bank stocks.',
    expense_ratio_pct: 0.19, typical_pct_of_portfolio: '0-10%',
  },
  {
    symbol: 'MOM100', exchange: 'NSE', title: 'Motilal Oswal Nasdaq 100 ETF',
    bucket: 'international', issuer: 'Motilal Oswal',
    thesis: 'Diversification out of Indian-only exposure -- gives you Apple, Microsoft, NVIDIA, Alphabet via an NSE-listed wrapper. INR-denominated, no LRS hassle. Worth 5-15% as a hedge against home-country risk.',
    expense_ratio_pct: 0.58, typical_pct_of_portfolio: '5-15%',
  },
  {
    symbol: 'GOLDBEES', exchange: 'NSE', title: 'Gold ETF',
    bucket: 'gold', issuer: 'Nippon India',
    thesis: 'Physical-gold-backed ETF, NSE-traded. Portfolio insurance -- typically uncorrelated with equity, ballasts during inflation or crisis. SEBI mandates physical backing per unit.',
    expense_ratio_pct: 0.50, typical_pct_of_portfolio: '5-10%',
  },
];

const _bucketStyle = {
  'broad-index':   { bg: 'rgba(56, 161, 105, 0.10)', fg: '#38a169' },
  'mid-cap':       { bg: 'rgba(214, 158, 46, 0.10)', fg: '#d69e2e' },
  'sector':        { bg: 'rgba(159, 122, 234, 0.10)', fg: '#9f7aea' },
  'international': { bg: 'rgba(66, 153, 225, 0.10)', fg: '#4299e1' },
  'gold':          { bg: 'rgba(221, 107, 32, 0.10)', fg: '#dd6b20' },
};

window.LongTermScreen = function LongTermScreen() {
  // ----- LTPs via /api/quotes REST snapshot (refresh every 30s) -----
  const [quotes, setQuotes] = React.useState({});
  const [quotesAt, setQuotesAt] = React.useState(null);
  React.useEffect(() => {
    let cancelled = false;
    const symParam = LONG_TERM_BASKET.map(b => `${b.exchange}:${b.symbol}`).join(',');
    const refresh = async () => {
      try {
        const r = await fetch(`/api/quotes?symbols=${encodeURIComponent(symParam)}`, { credentials: 'include' });
        const j = await r.json();
        if (cancelled || !j.ok) return;
        const map = {};
        for (const [k, v] of Object.entries(j.quotes || {})) {
          // server returns "NSE:NIFTYBEES" -> { last_price, ohlc:{close}, ... }
          const sym = k.split(':')[1] || k;
          map[sym] = {
            ltp:   v.last_price,
            close: v.ohlc && v.ohlc.close,
            change: v.net_change || ((v.last_price && v.ohlc && v.ohlc.close) ? v.last_price - v.ohlc.close : 0),
            changePct: (v.last_price && v.ohlc && v.ohlc.close) ? ((v.last_price - v.ohlc.close) / v.ohlc.close) * 100 : 0,
          };
        }
        setQuotes(map);
        setQuotesAt(Date.now());
      } catch (e) { console.warn('[longterm] quotes:', e && e.message); }
    };
    refresh();
    const t = setInterval(refresh, 30_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const [buying, setBuying] = React.useState(null);
  const [dcaBusy, setDcaBusy] = React.useState(null);
  const [msg, setMsg] = React.useState('');

  // ----- Buy CTA: dry-run -> redirect to #trading for the 2FA + place leg -----
  const onBuy = async (entry, qty) => {
    if (!qty || qty <= 0) { setMsg('Enter a quantity > 0 first'); return; }
    setBuying(entry.symbol); setMsg('');
    try {
      const csrf = (window.MockData && window.MockData.csrfToken && window.MockData.csrfToken()) || '';
      const r = await fetch('/api/orders/dry-run', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({
          exchange: entry.exchange, symbol: entry.symbol,
          side: 'BUY', orderType: 'MARKET', quantity: Number(qty),
          product: 'CNC', variety: 'regular', validity: 'DAY',
          clientOrderId: `longterm-${entry.symbol}-${Date.now()}`,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok) {
        const proceed = window.confirm(`Dry-run OK. Place BUY ${qty} ${entry.symbol} at market on Trading screen?`);
        if (proceed) {
          // Persist the prefill so the trading screen can pick it up
          try { sessionStorage.setItem('ats.tradingPrefill', JSON.stringify({ symbol: entry.symbol, exchange: entry.exchange, side: 'BUY', qty: Number(qty), orderType: 'MARKET', product: 'CNC' })); } catch (_) {}
          window.location.hash = '#trading';
        }
      } else {
        setMsg(`Dry-run rejected: ${j.reason || 'unknown'}${j.detail ? ' \u2014 ' + j.detail : ''}`);
      }
    } catch (e) { setMsg('Buy failed: ' + (e && e.message)); }
    finally { setBuying(null); }
  };

  // ----- Auto-DCA CTA: PUT /api/sip with a new entry (existing Tier 18 backend) -----
  const onAutoDca = async (entry) => {
    const amtStr = window.prompt(`Monthly DCA amount for ${entry.symbol} (INR):`, '5000');
    if (!amtStr) return;
    const amt = Number(amtStr);
    if (!Number.isFinite(amt) || amt < 100) { setMsg('Amount must be \u2265 \u20b9100'); return; }
    setDcaBusy(entry.symbol); setMsg('');
    try {
      // First GET current SIPs, then PUT the new list (the API is replace-all)
      const cur = await fetch('/api/sip', { credentials: 'include' }).then(r => r.json());
      if (!cur.ok) throw new Error(cur.reason || 'sip_load_failed');
      const newSip = {
        id: 'lt-' + entry.symbol.toLowerCase() + '-' + Date.now(),
        enabled: true,
        name: `Long-term ${entry.symbol}`,
        symbol: entry.symbol,
        targetKind: 'etf',
        frequency: 'monthly',
        amountINR: amt,
        dayOfMonth: 5,
        notes: `Auto-created from #longterm (${entry.bucket} bucket)`,
      };
      const next = [...(cur.sips || []), newSip];
      const csrf = (window.MockData && window.MockData.csrfToken && window.MockData.csrfToken()) || '';
      const r = await fetch('/api/sip', {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({ sips: next }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok) {
        setMsg(`DCA scheduled: \u20b9${amt}/mo into ${entry.symbol} on day 5. See #stpswp.`);
      } else {
        setMsg(`DCA save failed: ${j.reason || 'unknown'}`);
      }
    } catch (e) { setMsg('DCA failed: ' + (e && e.message)); }
    finally { setDcaBusy(null); setTimeout(() => setMsg(''), 5000); }
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-header__title">Long-term basket</h1>
          <div className="page-header__sub">Curated exchange-traded ETFs for passive long-term investing. Fully API-buyable via /api/orders/place.</div>
        </div>
        {quotesAt && (
          <div className="page-header__right">
            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
              Quotes refreshed {Math.round((Date.now() - quotesAt) / 1000)}s ago
            </div>
          </div>
        )}
      </div>

      <div style={{
        padding: 12, marginBottom: 16, fontSize: 12, color: 'var(--text-3)',
        background: 'var(--bg-soft)', border: '1px solid var(--border)', borderRadius: 6,
      }}>
        <b style={{ color: 'var(--text-2)' }}>Why ETFs, not mutual funds?</b> Kite Connect MF API is read-only by Zerodha/SEBI design -- every MF purchase needs a bank-mandate the API can't broker. Exchange-traded ETFs trade on NSE/BSE like any stock and place through the same /api/orders/place pipeline this platform already uses for equities. Same passive-long-term thesis, no API constraint.
      </div>

      {msg && (
        <div style={{
          padding: '10px 14px', marginBottom: 12, fontSize: 13,
          background: msg.includes('failed') || msg.includes('rejected') ? 'var(--down-soft, #fef2f2)' : 'var(--up-soft, #f0fdf4)',
          color: msg.includes('failed') || msg.includes('rejected') ? 'var(--down, #b91c1c)' : 'var(--up, #15803d)',
          border: '1px solid var(--border)', borderRadius: 6,
        }}>{msg}</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 16 }}>
        {LONG_TERM_BASKET.map(entry => {
          const sty = _bucketStyle[entry.bucket] || { bg: 'var(--bg-soft)', fg: 'var(--text-2)' };
          const q = quotes[entry.symbol];
          return (
            <div key={entry.symbol} style={{
              padding: 16, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
              display: 'flex', flexDirection: 'column', gap: 10,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>{entry.symbol}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{entry.title} \u00b7 {entry.issuer}</div>
                </div>
                <span style={{
                  padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 500, textTransform: 'uppercase',
                  background: sty.bg, color: sty.fg,
                }}>{entry.bucket}</span>
              </div>

              <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>{entry.thesis}</div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, fontSize: 11, color: 'var(--text-3)', paddingTop: 6, borderTop: '1px solid var(--border)' }}>
                <div>
                  <div style={{ textTransform: 'uppercase', fontSize: 9, letterSpacing: 0.5 }}>LTP</div>
                  <div style={{ fontSize: 13, color: 'var(--text-1)', fontFamily: 'var(--mono, monospace)' }}>
                    {q && q.ltp ? '\u20b9' + Number(q.ltp).toFixed(2) : '\u2014'}
                  </div>
                  {q && q.changePct != null && Math.abs(q.changePct) > 0.001 && (
                    <div style={{ fontSize: 10, color: q.changePct >= 0 ? 'var(--up)' : 'var(--down)', fontFamily: 'var(--mono, monospace)' }}>
                      {q.changePct >= 0 ? '+' : ''}{q.changePct.toFixed(2)}%
                    </div>
                  )}
                </div>
                <div>
                  <div style={{ textTransform: 'uppercase', fontSize: 9, letterSpacing: 0.5 }}>Expense</div>
                  <div style={{ fontSize: 13, color: 'var(--text-1)' }}>{entry.expense_ratio_pct.toFixed(2)}%</div>
                </div>
                <div>
                  <div style={{ textTransform: 'uppercase', fontSize: 9, letterSpacing: 0.5 }}>Suggested</div>
                  <div style={{ fontSize: 13, color: 'var(--text-1)' }}>{entry.typical_pct_of_portfolio}</div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 4, alignItems: 'center' }}>
                <BuyControl entry={entry} onBuy={onBuy} busy={buying === entry.symbol}/>
                <button
                  onClick={() => onAutoDca(entry)}
                  disabled={dcaBusy === entry.symbol}
                  style={{
                    padding: '4px 10px', fontSize: 11, fontWeight: 500,
                    background: 'var(--bg-soft)', color: 'var(--text-2)',
                    border: '1px solid var(--border)', borderRadius: 4,
                    cursor: dcaBusy === entry.symbol ? 'wait' : 'pointer',
                  }}
                  title="Schedule a monthly DCA buy via /api/sip"
                >
                  {dcaBusy === entry.symbol ? '\u2026' : '+ Auto-DCA'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 24, padding: 12, fontSize: 11, color: 'var(--text-4)', textAlign: 'center' }}>
        T-249 / T-252 / T-253. ETF picks are curated, not algorithmic. Expense ratios sourced from issuer websites at compose time -- verify before sizing.
      </div>
    </>
  );
};

const BuyControl = ({ entry, onBuy, busy }) => {
  const [qty, setQty] = React.useState(1);
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input type="number" min="1" value={qty} onChange={e => setQty(e.target.value)}
             style={{ width: 56, padding: '4px 6px', fontSize: 12, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4 }}/>
      <button disabled={busy} onClick={() => onBuy(entry, qty)} style={{
        padding: '4px 10px', fontSize: 11, fontWeight: 500,
        background: busy ? 'var(--bg-sunk)' : 'var(--accent, #38a169)',
        color: 'white', border: 'none', borderRadius: 4,
        cursor: busy ? 'wait' : 'pointer',
      }}>{busy ? 'Checking\\u2026' : 'Buy'}</button>
    </div>
  );
};
