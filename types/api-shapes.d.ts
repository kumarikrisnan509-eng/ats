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
// POST /api/me/walk-forward     (T-301a + Phase B-2)
// Source: server.js handler @ ~4390 + services/walk-forward.js result shape.
// Inner ranked/summary/recommendation shapes are deliberately broad -- the
// UI renders them via JSX children so structural typing buys little; we only
// pin the field NAMES the screen accesses so typos surface.

export interface WalkForwardResponse_Ok {
  ok: true;
  symbol: string;
  ranked?: unknown[];
  summary?: Record<string, unknown>;
  recommendation?: { action?: string; params?: Record<string, unknown>; [k: string]: unknown };
  reason?: never;
}
export type WalkForwardResponse = WalkForwardResponse_Ok | ApiErr;

/** GET /api/strategies -- list of strategy descriptors the walk-forward UI prefetches. */
export interface StrategyParam {
  name: string;
  type: 'int' | 'float' | string;
  default: number;
  min?: number;
  max?: number;
}
export interface StrategyDescriptor {
  id: string;
  name?: string;
  params?: StrategyParam[];
}
export type StrategiesResponse =
  | (ApiOk<unknown> & { strategies: StrategyDescriptor[] })
  | ApiErr;

// -----------------------------------------------------------------------------
// GET /api/me/macro-signals     (T-280c + Phase B-2)
// Source: server.js handler + services/nse-macro-fetcher.js cachedLatest().

export interface MacroSignalsLatest {
  fetchedAt?: string;
  fiiNetFlow?: number | null;
  marketBreadth?: number | null;
  highLowRatio?: number | null;
  errorsJson?: string | null;
  [k: string]: unknown;
}

export type MacroSignalsResponse =
  | (ApiOk<unknown> & {
      fetcherEnabled: boolean;
      fetcherInstantiated: boolean;
      latest: MacroSignalsLatest | null;
    })
  | ApiErr;

// -----------------------------------------------------------------------------
// GET /api/options/opportunities?limit=N   (T-298a + Phase B-2)
// Source: server.js handler @ ~4354 (raw SQL projection).

export interface OptionOpportunityRow {
  id: number;
  scannedAt: string;
  underlying: string;
  regime: string;
  regimeConfidence: number | null;
  template: string;
  score: number;
  rawScore: number;
  weight: number;
  /** JSON-encoded opportunity payload; UI parses lazily. */
  opportunityJson: string | null;
  reviewed: number;                       // SQLite 0/1
  reviewedAt: string | null;
  reviewedNote: string | null;
}

export type OptionOpportunitiesResponse =
  | (ApiOk<unknown> & { count: number; opportunities: OptionOpportunityRow[] })
  | ApiErr;

/** GET /api/options/scanner/status -- gate-status flags surfaced to the ops screen. */
export type OptionScannerStatusResponse =
  | (ApiOk<unknown> & {
      fetcherEnabled: boolean;
      scannerEnabled: boolean;
      fetcherInstantiated: boolean;
      scannerInstantiated: boolean;
      note?: string;
    })
  | ApiErr;

// -----------------------------------------------------------------------------
// GET /api/me/calibration?windowDays=N + GET /api/me/recommend-retire
// (T-302a/T-303a + Phase B-2). Inner calibration object is large and varies;
// the screen reads it through generic Object.entries iteration so we leave it
// as Record<string, unknown>.

export type CalibrationResponse =
  | (ApiOk<unknown> & { windowDays: number; calibration: Record<string, unknown> })
  | ApiErr;

export interface RecommendRetireBuckets {
  retire?: Array<{ signal: string; [k: string]: unknown }>;
  keep?: Array<{ signal: string; [k: string]: unknown }>;
  [k: string]: unknown;
}
export type RecommendRetireResponse = (ApiOk<unknown> & RecommendRetireBuckets) | ApiErr;

// -----------------------------------------------------------------------------
// GET /api/sip/plan + GET /api/sip/history    (T-276 + Phase B-2)
// Sources: server.js handlers + services/sip-runner.js {plan, stats, history}.

export interface SipPlanRow {
  symbol: string;
  qty?: number;
  amount?: number;
  allocationPct?: number;
  status?: string;
  reason?: string;
  [k: string]: unknown;
}
export interface SipPlan {
  fireDate?: string;
  rows: SipPlanRow[];
  [k: string]: unknown;
}
export interface SipStats {
  lastTickAt?: string | null;
  timerArmed?: boolean;
  [k: string]: unknown;
}

export type SipPlanResponse =
  | (ApiOk<unknown> & { plan: SipPlan; stats: SipStats })
  | ApiErr;

export interface SipHistoryRow {
  fireDate: string;
  symbol: string;
  qty?: number;
  amount?: number;
  status?: string;
  reason?: string;
  [k: string]: unknown;
}
export type SipHistoryResponse =
  | (ApiOk<unknown> & { history: SipHistoryRow[] })
  | ApiErr;
