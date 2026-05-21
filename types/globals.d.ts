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

// Our screens use these helpers via window-export; treating them as `any`
// avoids cascade errors when typechecking partial-adoption files.
declare const _inr: any;
declare const _fmtTime: any;
declare const _fmtDate: any;
declare const _pnlColor: any;
