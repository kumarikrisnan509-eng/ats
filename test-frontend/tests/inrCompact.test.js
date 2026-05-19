// T-209 (CODE-AUDIT D.9 #2): second frontend unit test.
//
// inrCompact is the older INR compact formatter at src/primitives.jsx:84.
// It coexists with formatINR (src/r11-additions.jsx) -- the audit flagged
// this duplication. Pinning inrCompact's contract here means a future
// consolidation can't change its output without an explicit test update.
//
// inrCompact uses different boundaries than formatINR.compact:
//   <1k         -> exact   "₹847"
//   1-10k       -> 1 decimal "₹4.2k"
//   10k+        -> no decimals "₹84k"
//   1-10L       -> 2 decimals "₹2.84 L"  (note: SPACE before unit)
//   10L+        -> 1 decimal "₹28.4 L"
//   1-10Cr      -> 2 decimals "₹4.83 Cr"

import { describe, it, expect } from 'vitest';
import { loadJsx } from '../lib/load-jsx.js';

const prims = loadJsx('src/primitives.jsx');
const inrCompact = prims.inrCompact;

describe('inrCompact (src/primitives.jsx)', () => {
  it('is exposed on window', () => {
    expect(typeof inrCompact).toBe('function');
  });

  it('returns "—" for null', () => {
    expect(inrCompact(null)).toBe('—');
  });

  it('returns "—" for NaN', () => {
    expect(inrCompact(NaN)).toBe('—');
  });

  it('formats under 1k as exact rupees', () => {
    expect(inrCompact(847)).toBe('₹847');
  });

  it('formats 1-10k with 1 decimal', () => {
    expect(inrCompact(4200)).toBe('₹4.2k');
  });

  it('formats 10k+ with no decimals', () => {
    expect(inrCompact(84500)).toBe('₹85k');
  });

  it('formats 1-10L with 2 decimals + space before unit', () => {
    expect(inrCompact(284000)).toBe('₹2.84 L');
  });

  it('formats 10L+ with 1 decimal + space', () => {
    expect(inrCompact(2840000)).toBe('₹28.4 L');
  });

  it('formats 1-10Cr with 2 decimals', () => {
    expect(inrCompact(48300000)).toBe('₹4.83 Cr');
  });

  it('preserves sign on negative', () => {
    expect(inrCompact(-1240)).toBe('-₹1.2k');
  });
});
