// T-211 (CODE-AUDIT D.9 #2 follow-up): formatPct pure function test.
//
// formatPct is at src/r11-additions.jsx:41. It's the canonical percentage
// formatter used across the dashboard, signals, and AI review screens.
// Contract:
//   - null/NaN              -> "—"
//   - default               -> "12.34%" (2 decimals)
//   - sign:true + positive  -> "+12.34%"
//   - sign:true + zero/neg  -> "0.00%" / "-12.34%"  (no plus on zero)
//   - decimals option       -> "12.3%" (1 decimal), "12%" (0 decimals)

import { describe, it, expect } from 'vitest';
import { loadJsx } from '../lib/load-jsx.js';

const r11 = loadJsx('src/r11-additions.jsx');
const formatPct = r11.formatPct;

describe('formatPct (src/r11-additions.jsx)', () => {
  it('is a function', () => {
    expect(typeof formatPct).toBe('function');
  });

  it('returns "—" for null', () => {
    expect(formatPct(null)).toBe('—');
  });

  it('returns "—" for NaN', () => {
    expect(formatPct(NaN)).toBe('—');
  });

  it('returns "—" for undefined', () => {
    expect(formatPct(undefined)).toBe('—');
  });

  it('defaults to 2 decimals + "%" suffix', () => {
    expect(formatPct(12.345)).toBe('12.35%');
  });

  it('formats integers with 2 decimals', () => {
    expect(formatPct(12)).toBe('12.00%');
  });

  it('respects decimals:1 option', () => {
    expect(formatPct(12.34, { decimals: 1 })).toBe('12.3%');
  });

  it('respects decimals:0 option', () => {
    expect(formatPct(12.34, { decimals: 0 })).toBe('12%');
  });

  it('prepends + for positive values when sign:true', () => {
    expect(formatPct(2.5, { sign: true })).toBe('+2.50%');
  });

  it('does NOT prepend + for zero when sign:true', () => {
    expect(formatPct(0, { sign: true })).toBe('0.00%');
  });

  it('handles negative without crashing', () => {
    expect(formatPct(-3.14)).toBe('-3.14%');
  });

  it('handles negative with sign:true (no double sign)', () => {
    expect(formatPct(-3.14, { sign: true })).toBe('-3.14%');
  });
});
