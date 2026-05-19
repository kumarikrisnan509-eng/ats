// T-211 (CODE-AUDIT D.9 #2 follow-up): formatNumber pure function test.
//
// formatNumber is at src/r11-additions.jsx:48. Wraps Number.toLocaleString
// with Indian grouping (`en-IN`) and consistent null/NaN handling.

import { describe, it, expect } from 'vitest';
import { loadJsx } from '../lib/load-jsx.js';

const r11 = loadJsx('src/r11-additions.jsx');
const formatNumber = r11.formatNumber;

describe('formatNumber (src/r11-additions.jsx)', () => {
  it('is a function', () => {
    expect(typeof formatNumber).toBe('function');
  });

  it('returns "—" for null', () => {
    expect(formatNumber(null)).toBe('—');
  });

  it('returns "—" for NaN', () => {
    expect(formatNumber(NaN)).toBe('—');
  });

  it('returns "—" for undefined', () => {
    expect(formatNumber(undefined)).toBe('—');
  });

  it('formats with Indian grouping (1,23,456)', () => {
    expect(formatNumber(123456)).toBe('1,23,456');
  });

  it('formats over 1 crore (1,23,45,678)', () => {
    expect(formatNumber(12345678)).toBe('1,23,45,678');
  });

  it('formats small integers without grouping', () => {
    expect(formatNumber(847)).toBe('847');
  });

  it('respects decimals option', () => {
    expect(formatNumber(1234.5, { decimals: 2 })).toBe('1,234.50');
  });

  it('formats zero', () => {
    expect(formatNumber(0)).toBe('0');
  });

  it('handles negative with Indian grouping', () => {
    // en-IN locale produces a leading minus sign with the same grouping.
    expect(formatNumber(-123456)).toBe('-1,23,456');
  });
});
