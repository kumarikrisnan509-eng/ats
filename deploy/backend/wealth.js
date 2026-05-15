// wealth.js -- Tier 21: curated static catalogs for Stage 5 long-term products.
//
// These are NOT live broker-quoted instruments. They are reference data the user
// can browse to plan their long-term allocation. Yields / NAVs are PUBLIC RBI / NSE
// snapshots refreshed quarterly. To execute, the user goes to their broker (Zerodha
// Coin, Kite, etc.) -- our role is research + planning.
//
// This file ships a static catalog. Future tiers can:
//   - Pull live REIT NAVs from /api/quote when broker is connected
//   - Refresh yields from RBI publications (cron)
//   - Plug into Zerodha Coin API for direct SIP placement
//
// Public API:
//   const w = new Wealth()
//   w.getBonds() / w.getReits() / w.getSmallcases() / w.getTraders()

class Wealth {
  constructor() {
    // Reference data only -- not live broker quotes.
    this._refreshedAt = new Date().toISOString();
  }

  /**
   * Government securities + AAA-rated corporates + T-bill ladder rungs.
   * Yields are recent secondary-market quotes; not investment advice.
   */
  getBonds() {
    return {
      ok: true,
      refreshedAt: this._refreshedAt,
      disclaimer: 'Reference data only. Yields are recent secondary-market snapshots, not live quotes. Trade via your broker for actual fills.',
      rows: [
        { type: 'G-Sec',      isin: 'IN0020220026', name: '7.26% GS 2032',      maturityYears: 7,  yieldPct: 7.18, ratings: 'SOV',   risk: 'lowest'  },
        { type: 'G-Sec',      isin: 'IN0020210020', name: '7.06% GS 2027',      maturityYears: 2,  yieldPct: 7.10, ratings: 'SOV',   risk: 'lowest'  },
        { type: 'G-Sec',      isin: 'IN0020230011', name: '7.18% GS 2029',      maturityYears: 4,  yieldPct: 7.18, ratings: 'SOV',   risk: 'lowest'  },
        { type: 'G-Sec',      isin: 'IN0020210135', name: '6.10% GS 2031',      maturityYears: 6,  yieldPct: 7.21, ratings: 'SOV',   risk: 'lowest'  },
        { type: 'T-Bill',     isin: 'rolling',      name: '364-day T-Bill',     maturityYears: 1,  yieldPct: 6.92, ratings: 'SOV',   risk: 'lowest'  },
        { type: 'T-Bill',     isin: 'rolling',      name: '91-day T-Bill',      maturityYears: 0.25, yieldPct: 6.78, ratings: 'SOV', risk: 'lowest'  },
        { type: 'AAA Corp',   isin: 'INE040A08493', name: 'HDFC Bank 7.85% 2030', maturityYears: 5, yieldPct: 7.85, ratings: 'AAA',   risk: 'low'     },
        { type: 'AAA Corp',   isin: 'INE062A08272', name: 'SBI 8.10% 2032',      maturityYears: 7, yieldPct: 8.10, ratings: 'AAA',   risk: 'low'     },
        { type: 'AAA Corp',   isin: 'INE001A07RY1', name: 'PFC 7.70% 2028',      maturityYears: 3, yieldPct: 7.70, ratings: 'AAA',   risk: 'low'     },
        { type: 'AAA Corp',   isin: 'INE020B08CO5', name: 'REC 7.60% 2028',      maturityYears: 3, yieldPct: 7.60, ratings: 'AAA',   risk: 'low'     },
        { type: 'AA Corp',    isin: 'INE114A07803', name: 'Tata Capital 8.40% 2029', maturityYears: 4, yieldPct: 8.40, ratings: 'AA+', risk: 'moderate' },
      ],
    };
  }

  /**
   * Indian listed REITs (4 currently public on NSE).
   */
  getReits() {
    return {
      ok: true,
      refreshedAt: this._refreshedAt,
      disclaimer: 'Reference data only. NAVs and yields from recent quarterly reports. Trade via your broker for live prices.',
      rows: [
        { sym: 'EMBASSY',   name: 'Embassy Office Parks REIT',        type: 'Office', nav: 392.4, distributionYieldPct: 6.8, occupancyPct: 89, aumCr: 41200, divFreq: 'Quarterly' },
        { sym: 'MINDSPACE', name: 'Mindspace Business Parks REIT',    type: 'Office', nav: 358.2, distributionYieldPct: 6.6, occupancyPct: 86, aumCr: 32800, divFreq: 'Quarterly' },
        { sym: 'BIRET',     name: 'Brookfield India REIT',            type: 'Office', nav: 286.4, distributionYieldPct: 7.2, occupancyPct: 82, aumCr: 28400, divFreq: 'Quarterly' },
        { sym: 'NXST',      name: 'Nexus Select Trust (Retail)',      type: 'Retail', nav: 142.6, distributionYieldPct: 7.4, occupancyPct: 96, aumCr: 18600, divFreq: 'Quarterly' },
      ],
    };
  }

  /**
   * Curated smallcase / theme-basket catalog. The actual platform is smallcase.com;
   * we surface a curated list so users can decide what to research. Subscription
   * happens externally.
   */
  getSmallcases() {
    return {
      ok: true,
      refreshedAt: this._refreshedAt,
      disclaimer: 'Catalog reference only. Subscribe through smallcase.com or your broker. Returns are historic backtest, not guarantees.',
      rows: [
        { id: 'aw-windmill',     name: 'All Weather Investing',  mgr: 'Windmill Capital', theme: 'Diversified',      stocks: 12, rebal: 'Quarterly', tier: 'low_risk' },
        { id: 'eq-gold-windmill',name: 'Equity & Gold',           mgr: 'Windmill Capital', theme: 'Asset allocation', stocks: 8,  rebal: 'Quarterly', tier: 'low_risk' },
        { id: 'top100-windmill', name: 'Top 100 stocks',          mgr: 'Windmill Capital', theme: 'Large-cap core',   stocks: 30, rebal: 'Yearly',    tier: 'core' },
        { id: 'ev-niveshaay',    name: 'Electric Mobility',       mgr: 'Niveshaay',        theme: 'Sectoral · EV',    stocks: 14, rebal: 'Quarterly', tier: 'thematic' },
        { id: 'nb-niveshaay',    name: 'Naya Bharat',             mgr: 'Niveshaay',        theme: 'India growth',     stocks: 18, rebal: 'Quarterly', tier: 'thematic' },
        { id: 'div-windmill',    name: 'Dividend Aristocrats',    mgr: 'Windmill Capital', theme: 'Dividend income',  stocks: 15, rebal: 'Yearly',    tier: 'income' },
      ],
    };
  }

  /**
   * Copy-trading registry. Tier 21: empty by design.
   *
   * Spec §0: "Not a copy-trading platform in v1 (that's a separate compliance track)".
   * Until we onboard SEBI-registered RA partners and have signed agreements, the list
   * stays empty. The UI honestly shows "No traders yet" instead of fake leaderboards.
   */
  getTraders() {
    return {
      ok: true,
      refreshedAt: this._refreshedAt,
      disclaimer: 'Copy-trading requires SEBI-registered RA partnerships under the 2026 framework. No traders are currently onboarded.',
      rows: [],
    };
  }
}

module.exports = { Wealth };
