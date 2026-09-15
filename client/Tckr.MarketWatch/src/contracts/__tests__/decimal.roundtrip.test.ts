import { describe, expect, it } from 'vitest';
import { format, toDecimal } from '../decimal.ts';

const VALUES = [
  '0.0001',
  '-3.5',
  '999999.9999',
  '0',
  '0.0000',
  '85.42',
  '100',
  '1234.5',
  '-0.0001',
];

describe('format(toDecimal(x)) round trip', () => {
  it.each(VALUES)('round-trips %s', (value) => {
    expect(format(toDecimal(value))).toBe(value);
  });
});
