// T-209 (CODE-AUDIT D.9 #2): first frontend unit test.
//
// formatINR is the canonical INR formatter at src/r11-additions.jsx:19.
// It handles four shapes:
//   - null/NaN              -> "—"
//   - compact mode          -> "₹X.XXCr" / "₹X.XXL" / "₹X.XK"
//   - full mode (default)   -> Indian grouping "₹12,34,567"
//   - sign option           -> "+₹X" for positive, "-₹X" for negative

import { describe, it, expect } from 'vitest';
import { loadJsx } from '../lib/load-jsx.js';

const r11 = loadJsx('src/r11-additions.jsx');
const formatINR = r11.formatINR;

describe('formatINR (src/r11-additions.jsx)', () => {
  it('is exposed on window', () => {
    expect(typeof formatINR).toBe('function');
  });

  it('returns "—" for null', () => {
    expect(formatINR(null)).toBe('—');
  });

  it('returns "—" for NaN', () => {
    expect(formatINR(NaN)).toBe('—');
  });

  it('returns "—" for undefined', () => {
    expect(formatINR(undefined)).toBe('—');
  });

  it('formats compact under 1k as exact rupees', () => {
    expect(formatINR(847, 'compact')).toBe('₹847');
  });

  it('formats compact thousands with 1 decimal', () => {
    expect(formatINR(4200, 'compact')).toBe('₹4.2K');
  });

  it('formats compact lakhs with 2 decimals', () => {
    expect(formatINR(482734, 'compact')).toBe('₹4.83L');
  });

  it('formats compact crores with 2 decimals', () => {
    expect(formatINR(12345678, 'compact')).toBe('₹1.23Cr');
  });

  it('uses Indian grouping in full mode', () => {
    expect(formatINR(1234567)).toBe('₹12,34,567');
  });

  it('respects decimals option', () => {
    // 1234.5 with 2 decimals -> ₹1,234.50
    expect(formatINR(1234.5, { decimals: 2 })).toBe('₹1,234.50');
  });

  it('prepends + for positive values when sign:true', () => {
    expect(formatINR(1240, { sign: true })).toBe('+₹1,240');
  });

  it('prepends - for negative values when sign:true', () => {
    expect(formatINR(-1240, { sign: true })).toBe('-₹1,240');
  });

  it('does NOT prepend + for positive when sign is omitted', () => {
    expect(formatINR(1240)).toBe('₹1,240');
  });
});
