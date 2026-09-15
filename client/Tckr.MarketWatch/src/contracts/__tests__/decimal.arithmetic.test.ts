import { describe, expect, it } from 'vitest';
import { compare, subtract, toDecimal } from '../decimal.ts';

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
