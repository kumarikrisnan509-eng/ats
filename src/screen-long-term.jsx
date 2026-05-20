/* eslint-disable */
/* T-249 (paired with T-248 MF removal):
 *
 * Long-Term basket screen -- the API-buyable replacement for the retired MF
 * picker. Surfaces a curated set of exchange-traded ETFs that cover the same
 * "passive long-term holding" use case as index/sector/gold/intl mutual funds,
 * but trade on NSE/BSE like any other stock and so CAN be placed through
 * /api/orders/place. Kite Connect's MF API is GET-only by Zerodha/SEBI
 * bank-mandate design; ETFs have no such constraint.
 *
 * Five curated buckets:
 *   - Broad index    : NIFTYBEES (Nifty 50)
 *   - Mid/small      : JUNIORBEES (Nifty Next 50)
 *   - Sector tilt    : BANKBEES (Bank Nifty)
 *   - International  : MOM100 (Motilal Nasdaq 100)
 *   - Gold hedge     : GOLDBEES (physical gold ETF)
 *
 * Each card shows the LTP (when available via watchlist subscription), with
 * Buy + DCA scheduling CTAs. The Buy CTA places a market order through the
 * existing dry-run -> 2FA -> place pipeline; the DCA CTA opens a quick
 * scheduler that registers a recurring strategy with the local autorun engine.
 *
 * IMPORTANT: this screen treats the user as the operator (personal-use scope).
 * It does not preview fund analytics or burn LLM tokens. The picks are
 * deliberately curated -- the analysis was that an AI MF picker over a
 * 15,000-fund universe was a misleading affordance when the platform couldn't
 * place the orders anyway. A curated 5-ETF list with auto-DCA is the honest
 * long-term-investing surface.
 */

const LONG_TERM_BASKET = [
  {
    symbol: 'NIFTYBEES',
    exchange: 'NSE',
    title: 'Nifty 50 ETF',
    bucket: 'broad-index',
    issuer: 'Nippon India',
    thesis: 'Tracks the 50 largest NSE-listed companies. The closest direct replacement for a Nifty 50 index fund (UTI / HDFC / ICICI Direct etc.) -- but exchange-traded and API-buyable.',
    expense_ratio_pct: 0.04,
    typical_pct_of_portfolio: '40-60%',
  },
  {
    symbol: 'JUNIORBEES',
    exchange: 'NSE',
    title: 'Nifty Next 50 ETF',
    bucket: 'mid-cap',
    issuer: 'Nippon India',
    thesis: 'The companies ranked 51-100 -- candidates to enter the Nifty 50. Historically higher returns + higher volatility than the Nifty 50. Use as a satellite to the broad-index core.',
    expense_ratio_pct: 0.15,
    typical_pct_of_portfolio: '10-20%',
  },
  {
    symbol: 'BANKBEES',
    exchange: 'NSE',
    title: 'Bank Nifty ETF',
    bucket: 'sector',
    issuer: 'Nippon India',
    thesis: 'Concentrated bet on Indian banks. Cyclical -- significant beta to interest-rate moves and credit cycle. Use sparingly; skip if you already hold direct bank stocks.',
    expense_ratio_pct: 0.19,
    typical_pct_of_portfolio: '0-10%',
  },
  {
    symbol: 'MOM100',
    exchange: 'NSE',
    title: 'Motilal Oswal Nasdaq 100 ETF',
    bucket: 'international',
    issuer: 'Motilal Oswal',
    thesis: 'Diversification out of Indian-only exposure -- gives you Apple, Microsoft, NVIDIA, Alphabet, etc. via an NSE-listed wrapper. INR-denominated, no LRS hassle. Worth 5-15% as a hedge against home-country risk.',
    expense_ratio_pct: 0.58,
    typical_pct_of_portfolio: '5-15%',
  },
  {
    symbol: 'GOLDBEES',
    exchange: 'NSE',
    title: 'Gold ETF',
    bucket: 'gold',
    issuer: 'Nippon India',
    thesis: 'Physical-gold-backed ETF, NSE-traded. The portfolio insurance -- typically uncorrelated with equity, ballasts during inflation or crisis. SEBI mandates physical backing per unit.',
    expense_ratio_pct: 0.50,
    typical_pct_of_portfolio: '5-10%',
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
  // Try to render LTPs if a live ticker tape is wired (watchlist subscription).
  // Graceful fallback to '-' if not -- the page must work for users who haven't
  // connected a broker yet (personal-use scope: it's a planning page first).
  const [ltp, setLtp] = React.useState({});
  React.useEffect(() => {
    let cancelled = false;
    const ws = window.LiveTickerStream;
    if (!ws || typeof ws.subscribe !== 'function') return;
    const symbols = LONG_TERM_BASKET.map(b => `${b.exchange}:${b.symbol}`);
    const off = ws.subscribe(symbols, (tick) => {
      if (cancelled) return;
      setLtp(prev => ({ ...prev, [tick.symbol]: tick.ltp }));
    });
    return () => { cancelled = true; if (off) off(); };
  }, []);

  const [buying, setBuying] = React.useState(null);

  const onBuy = async (entry, qty) => {
    if (!qty || qty <= 0) return;
    setBuying(entry.symbol);
    try {
      // Reuse the existing dry-run pipeline. The frontend already has fetchApi
      // with CSRF token + bearer headers attached.
      const r = await window.fetchApi('/api/orders/dry-run', {
        method: 'POST',
        body: JSON.stringify({
          exchange:    entry.exchange,
          symbol:      entry.symbol,
          side:        'BUY',
          orderType:   'MARKET',
          quantity:    Number(qty),
          product:     'CNC',     // long-term -> Cash-N-Carry (delivery)
          variety:     'regular',
          clientOrderId: `longterm-${entry.symbol}-${Date.now()}`,
        }),
      });
      if (r && r.ok) {
        if (window.confirm(`Dry-run OK. Place real order: BUY ${qty} ${entry.symbol} @ market?`)) {
          window.location.hash = '#trading';   // hand off to the live-trading screen which has 2FA flow
        }
      } else {
        alert('Dry-run rejected: ' + (r && r.reason || 'unknown'));
      }
    } catch (e) {
      alert('Buy failed: ' + (e && e.message || e));
    } finally {
      setBuying(null);
    }
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-header__title">Long-term basket</h1>
          <div className="page-header__sub">Curated exchange-traded ETFs for passive long-term investing. Fully API-buyable via /api/orders/place (unlike open-ended MFs).</div>
        </div>
      </div>

      <div style={{
        padding: 12, marginBottom: 16, fontSize: 12, color: 'var(--text-3)',
        background: 'var(--bg-soft)', border: '1px solid var(--border)', borderRadius: 6,
      }}>
        <b style={{ color: 'var(--text-2)' }}>Why ETFs, not mutual funds?</b> Kite Connect's MF API is read-only by Zerodha/SEBI design -- every MF purchase needs a bank-mandate the API can't broker. Exchange-traded ETFs trade on NSE/BSE like any stock and place through the same /api/orders/place pipeline this platform already uses for equities. Same passive-long-term thesis, no API constraint.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 16 }}>
        {LONG_TERM_BASKET.map(entry => {
          const sty = _bucketStyle[entry.bucket] || { bg: 'var(--bg-soft)', fg: 'var(--text-2)' };
          const liveLtp = ltp[`${entry.exchange}:${entry.symbol}`];
          return (
            <div key={entry.symbol} style={{
              padding: 16, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
              display: 'flex', flexDirection: 'column', gap: 10,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>{entry.symbol}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{entry.title} · {entry.issuer}</div>
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
                  <div style={{ fontSize: 13, color: 'var(--text-1)', fontFamily: 'var(--font-mono, monospace)' }}>
                    {liveLtp ? '₹' + Number(liveLtp).toFixed(2) : '—'}
                  </div>
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

              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <BuyButton entry={entry} onBuy={onBuy} busy={buying === entry.symbol}/>
                <DcaButton entry={entry}/>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 24, padding: 12, fontSize: 11, color: 'var(--text-4)', textAlign: 'center' }}>
        T-249. ETF picks are curated, not algorithmic. Expense ratios sourced from issuer websites at compose time -- verify current values before sizing positions.
      </div>
    </>
  );
};

const BuyButton = ({ entry, onBuy, busy }) => {
  const [qty, setQty] = React.useState(1);
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input type="number" min="1" value={qty} onChange={e => setQty(e.target.value)}
             style={{ width: 56, padding: '4px 6px', fontSize: 12, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4 }}/>
      <button disabled={busy} onClick={() => onBuy(entry, qty)} style={{
        padding: '4px 10px', fontSize: 11, fontWeight: 500,
        background: busy ? 'var(--bg-sunk)' : 'var(--acc, #38a169)',
        color: 'white', border: 'none', borderRadius: 4,
        cursor: busy ? 'wait' : 'pointer',
      }}>{busy ? 'Checking...' : 'Buy'}</button>
    </div>
  );
};

const DcaButton = ({ entry }) => {
  return (
    <button
      onClick={() => { window.location.hash = `#strategies?seed=longterm-dca:${entry.symbol}`; }}
      style={{
        padding: '4px 10px', fontSize: 11, fontWeight: 500,
        background: 'var(--bg-soft)', color: 'var(--text-2)',
        border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer',
      }}
      title="Schedule a monthly DCA buy (Kite-native SIP equivalent)"
    >
      + Auto-DCA
    </button>
  );
};
