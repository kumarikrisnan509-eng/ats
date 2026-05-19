// T-209: Vitest setup. Provides React + ReactDOM as globals (matching how
// app.html injects them via <script src="https://unpkg.com/react@18/...">).
// The frontend code reads React off `window.React`, so tests must put it
// there before any .jsx file is evaluated.

import React from 'react';
import ReactDOM from 'react-dom';

globalThis.React = React;
globalThis.ReactDOM = ReactDOM;

// Silence the React 18 ReactDOM warning in jsdom (we're not using
// createRoot in these primitive tests).
const origConsoleError = console.error;
console.error = (...args) => {
  const s = String(args[0] || '');
  if (s.includes('ReactDOM.render is no longer supported')) return;
  origConsoleError(...args);
};
