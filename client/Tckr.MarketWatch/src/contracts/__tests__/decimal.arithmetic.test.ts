import { describe, expect, it } from 'vitest';
import { compare, formatCompact, multiplyByQuantity, subtract, toDecimal } from '../decimal.ts';

describe('subtract', () => {
  it('is exact where parseFloat fails', () => {
    // 0.30 - 0.10 === 0.19999999999999998 under IEEE-754 double subtraction.
    expect(subtract(toDecimal('0.30'), toDecimal('0.10'))).toBe('0.20');
  });

  it('handles carries across the decimal point', () => {
    expect(subtract(toDecimal('1.00'), toDecimal('0.01'))).toBe('0.99');
    expect(subtract(toDecimal('10.00'), toDecimal('9.99'))).toBe('0.01');
  });

  it('handles sign changes', () => {
    expect(subtract(toDecimal('1.00'), toDecimal('2.00'))).toBe('-1.00');
    expect(subtract(toDecimal('-1.00'), toDecimal('-2.00'))).toBe('1.00');
    expect(subtract(toDecimal('-1.00'), toDecimal('1.00'))).toBe('-2.00');
  });

  it('produces exact zero, never negative zero', () => {
    expect(subtract(toDecimal('5.00'), toDecimal('5.00'))).toBe('0.00');
  });

  it('preserves 4dp precision', () => {
    expect(subtract(toDecimal('0.0002'), toDecimal('0.0001'))).toBe('0.0001');
  });
});

describe('compare', () => {
  it('orders by magnitude, not string length', () => {
    expect(compare(toDecimal('9.5'), toDecimal('10.0'))).toBe(-1);
    expect(compare(toDecimal('10.0'), toDecimal('9.5'))).toBe(1);
    expect(compare(toDecimal('10.00'), toDecimal('10.0'))).toBe(0);
  });

  it('handles sign changes', () => {
    expect(compare(toDecimal('-1.00'), toDecimal('1.00'))).toBe(-1);
    expect(compare(toDecimal('1.00'), toDecimal('-1.00'))).toBe(1);
    expect(compare(toDecimal('-5.00'), toDecimal('-5.00'))).toBe(0);
  });

  it('treats +x and x as equal magnitude', () => {
    expect(compare(toDecimal('+1.05'), toDecimal('1.05'))).toBe(0);
  });
});

describe('multiplyByQuantity', () => {
  it('is exact where float multiplication drifts', () => {
    // 0.07 * 3 === 0.21000000000000002 under IEEE-754.
    expect(multiplyByQuantity(toDecimal('0.07'), 3)).toBe('0.21');
  });

  it('gives a traded value at the price precision', () => {
    expect(multiplyByQuantity(toDecimal('85.60'), 293_900)).toBe('25157840.00');
    expect(multiplyByQuantity(toDecimal('1.933'), 3_067_000)).toBe('5928511.000');
  });

  it('rejects a non-integer quantity', () => {
    expect(() => multiplyByQuantity(toDecimal('1.00'), 1.5)).toThrow(RangeError);
  });
});

describe('formatCompact', () => {
  it.each([
    ['25157840.00', '25.16M'],
    ['3067000', '3.07M'],
    ['6000000', '6M'],
    ['5928511.000', '5.93M'],
    ['1500', '1.5K'],
    ['950', '950'],
    ['999999', '1M'],
    ['2500000000', '2.5B'],
    ['0', '0'],
  ])('%s -> %s', (value, expected) => {
    expect(formatCompact(toDecimal(value))).toBe(expected);
  });

  it('keeps the sign', () => {
    expect(formatCompact(toDecimal('-3067000'))).toBe('-3.07M');
  });

  it('keeps trailing zeros on request, so a column of values lines up', () => {
    expect(formatCompact(toDecimal('18600000'), { fixedFraction: true })).toBe('18.60M');
    expect(formatCompact(toDecimal('6000000'), { fixedFraction: true })).toBe('6.00M');
  });
});
