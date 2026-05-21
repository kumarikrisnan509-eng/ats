// types/api-shapes.d.ts — shape declarations for every backend response the UI consumes.
//
// Phase B-1: gradual JSDoc-typecheck adoption. Files that want to be guarded
// add `// @ts-check` at the top and JSDoc-import the relevant typedef:
//
//   // @ts-check
//   /** @typedef {import('../types/api-shapes').AttributionResponse} AttributionResponse */
//   /** @type {AttributionResponse} */
//   const r = await fetch('/api/me/attribution').then(r => r.json());
//
// Then `npx tsc --noEmit --checkJs` validates that every field access is
// compatible with the declared shape. This catches the attribution/slippage
// class of bug (UI reads r.regime as string when backend ships {label,confidence})
// at edit time, before it ever ships.
//
// Adoption order: highest-churn or recently-broken screens first. New screens
// SHOULD include `// @ts-check` on creation; existing screens migrate when
// touched.

// -----------------------------------------------------------------------------
// Common envelope used by every /api/me/* endpoint. `ok: false` responses have
// reason; `ok: true` responses get the per-endpoint payload merged in.

export interface ApiOk<T> { ok: true; reason?: never }
export interface ApiErr  { ok: false; reason: string }

// -----------------------------------------------------------------------------
// GET /api/me/attribution?n=N
// Source: deploy/backend/services/attribution.js _computeSnapshot()

export interface RegimeInfo {
  label: 'bull' | 'bear' | 'neutral' | 'unknown' | string;
  confidence: number | null;
}

export interface AutorunSummary {
  runs: number;
  placed: number;
  /** keys like "skipped_macro_block", "skipped_risk_cap" with frequency counts */
  gateSkips: Record<string, number>;
}

export interface StrategyBucket {
  count: number;
  pnl: number;
}

export interface PortfolioSnapshot {
  totalValue: number;
  cash: number;
  grossExposure: number;
  netExposure: number;
  leverage: number;
  positionCount: number;
}

export interface AttributionRow {
  date: string;                            // YYYY-MM-DD (IST)
  asOf: string;                            // ISO timestamp
  totalPnl: number;
  tradeCount: number;
  autorun: AutorunSummary;
  /** map of strategy tag -> {count, pnl}. Keys vary. */
  byStrategy: Record<string, StrategyBucket>;
  /** map of symbol -> {count, pnl}. Keys vary. */
  bySymbol: Record<string, StrategyBucket>;
  regime: RegimeInfo;
  portfolio: PortfolioSnapshot | null;
  _schema: 'attribution-v1';
}

export interface AttributionStats {
  lastSnapshotAt: string | null;
  rowCount: number;
  snapshotWindow: string;                  // e.g. "16:00 IST daily"
  timerArmed: boolean;
}

export type AttributionResponse =
  | (ApiOk<unknown> & { recent: AttributionRow[]; stats: AttributionStats })
  | ApiErr;

// -----------------------------------------------------------------------------
// GET /api/me/slippage
// Source: deploy/backend/services/slippage-tracker.js compute()

export interface SlippageOverall {
  trades: number;
  avgSlippageBps: number;
  totalSlippageINR: number;
}

/** Per-strategy / per-symbol bucket. trades==0 means empty bucket. */
export interface SlippageBucket {
  trades: number;
  avgSlippageBps: number;
  totalSlippageINR: number;
}

export interface SlippageWorstFill {
  tradeId: string | number;
  symbol: string;
  strategy: string;
  side: 'buy' | 'sell' | string;
  qty: number;
  expectedPrice: number;
  filledPrice: number;
  slippageBps: number;
  slippageINR: number;
  closedAt?: string;
}

export interface SlippagePayload {
  overall: SlippageOverall;
  byStrategy: Record<string, SlippageBucket>;
  bySymbol: Record<string, SlippageBucket>;
  worst: SlippageWorstFill[];
  _schema: 'slippage-tracker-v1';
}

export type SlippageResponse =
  | (ApiOk<unknown> & { slippage: SlippagePayload })
  | ApiErr;

// -----------------------------------------------------------------------------
// Reserved slots for the other recently-shipped screens. Fill in when each is
// migrated to `// @ts-check`. Keeping them undefined here surfaces a clear
// "type unknown" diagnostic instead of false safety.
//
// /api/me/walk-forward         -> WalkForwardResponse
// /api/me/macro-signals        -> MacroSignalsResponse
// /api/me/options-ops          -> OptionsOpsResponse
// /api/me/calibration          -> CalibrationResponse
// /api/me/sip                  -> SipResponse
