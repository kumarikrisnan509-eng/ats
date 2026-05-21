// types/globals.d.ts — global shims for tsc --checkJs over our browser-loaded JSX.
//
// Our .jsx files load via 52 <script> tags into the same global scope and call
// React via `window.React` (UMD bundle from CDN). They don't `import React`, so
// tsc needs to be told React exists as a global. We use `any` here on purpose:
// the point of Phase B-1 is to type our OWN API shapes, not to fully type
// React. Strict React typing would require installing @types/react and porting
// every file to ES modules -- much bigger lift than this iteration justifies.

// React UMD global. Lookups like React.useState, React.useEffect, React.useCallback
// all type-check; their return types stay `any` but field-access on returned
// objects gets the safety we want from the API typedef side.
declare const React: any;
declare const ReactDOM: any;

// window globals our screens write to (window.AttributionScreen, etc.). The
// `screens` map in app.jsx reads these.
interface Window {
  [key: string]: any;
}

// Phase B-1 originally declared _inr/_fmtTime/_fmtDate/_pnlColor as
// ambient globals here. Those have been removed because screens now either
// IIFE-wrap their own copy (T-274c pattern) or declare them at top level;
// the ambient declarations conflicted with TS2451 "Cannot redeclare
// block-scoped variable".

// Phase B-3: cross-file globals exported via the window-namespace pattern.
// Every .jsx ships as its own <script>; primitives, formatters, icons, and
// custom hooks defined in one file are read as bare names in others. tsc
// needs these declared to type-check the screens.

// React hooks (when destructured as globals via `const { useState } = React`).
declare const useState: any;
declare const useMemo: any;
declare const useEffect: any;
declare const useCallback: any;
declare const useRef: any;
declare const useContext: any;
declare const useReducer: any;

// Primitives (src/primitives.jsx + r8/r9/r10/r11-primitives.jsx + r8-additions.jsx).
declare const Card: any;
declare const Stat: any;
declare const Pill: any;
declare const Chip: any;
declare const Toggle: any;
declare const Segmented: any;
declare const Progress: any;

// Charts + tickers.
declare const Sparkline: any;
declare const LiveSparkline: any;
declare const LiveCell: any;
declare const StaleIndicator: any;
declare const AreaChart: any;
declare const BarRow: any;
declare const Candles: any;
declare const Heatmap: any;
declare const Donut: any;
declare const CountUp: any;

// Icon factory.
declare const I: any;

// Formatters (src/primitives.jsx / r8-primitives.jsx).
declare const inr: any;
declare const inrCompact: any;
declare const pct: any;
declare const clsPN: any;

// Live data + connection hooks (src/live-ticks.jsx).
declare const useLivePnL: any;
declare const useLiveTick: any;
declare const useConnectionState: any;
declare const seriesRandom: any;


// Phase B-4: JSX permissive component-prop typing.
// Our 52 .jsx files declare local components like
//   const MetricRow = ({ label, value, hint }) => ...
// TypeScript infers MetricRow as REQUIRING {label, value, hint}, so any
// call site that omits one fails with TS2741. In a window-globals app
// where the same component is reused with different prop subsets, that
// strictness is noise, not signal. The shape-mismatch bug class we
// actually care about (UI reads r.regime as string when backend ships
// {label,confidence}) is caught by the api-shapes.d.ts typedefs on
// fetch() returns, not by component-prop strictness.
//
// React uses LibraryManagedAttributes to derive a JSX element's expected
// props from a component's declared props. Mapping it to `any` tells tsc
// "any props are fine for any component," which lets us @ts-check screens
// without making every local component perfectly polymorphic by hand.

declare namespace JSX {
  interface IntrinsicElements { [k: string]: any }
  type Element = any;
  type ElementClass = any;
  type ElementAttributesProperty = { props: any };
  type ElementChildrenAttribute = { children: any };
  type LibraryManagedAttributes<C, P> = any;
}
