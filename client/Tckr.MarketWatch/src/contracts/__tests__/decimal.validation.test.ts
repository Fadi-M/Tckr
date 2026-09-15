import { describe, expect, it } from 'vitest';
import { isDecimal, toDecimal } from '../decimal.ts';

const INVALID = ['1.23456', 'abc', '', '1,23', 'NaN', '1e3'];

describe('toDecimal', () => {
  it.each(INVALID)('throws on %j', (raw) => {
    expect(() => toDecimal(raw)).toThrow();
  });

  it('accepts an optional leading + (client-contract.md REST example: "+1.05")', () => {
    expect(() => toDecimal('+1.05')).not.toThrow();
  });

  it('accepts up to 4 fractional digits and a leading -', () => {
    expect(() => toDecimal('-3.5')).not.toThrow();
    expect(() => toDecimal('999999.9999')).not.toThrow();
    expect(() => toDecimal('100')).not.toThrow();
  });
});

describe('isDecimal', () => {
  it.each(INVALID)('is false for %j', (raw) => {
    expect(isDecimal(raw)).toBe(false);
  });

  it('is true for valid decimals', () => {
    expect(isDecimal('85.42')).toBe(true);
    expect(isDecimal('+1.05')).toBe(true);
    expect(isDecimal('-3.5')).toBe(true);
  });
});
