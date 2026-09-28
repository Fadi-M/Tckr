/**
 * `percentChangeText` is the wire shape of `changePercent` (client-contract.md: `"+1.24"`).
 * It must round exactly, half away from zero: the `toFixed` path it replaced printed a
 * −0.235% move as "-0.23" (the double is −0.23499…) and a tiny fall as "-0.00".
 */
import { describe, expect, it } from 'vitest';
import { formatPercentFigure } from '../../display/percent.ts';
import { decimalPlaces, percentChangeText, toDecimal } from '../decimal.ts';

describe('percentChangeText', () => {
  it('matches the contract example', () => {
    // 84.37 -> 85.42 is +1.2445%.
    expect(percentChangeText(toDecimal('84.37'), toDecimal('85.42'))).toBe('+1.24');
  });

  it('rounds an exact half away from zero, in both directions', () => {
    // 200.00 -> 199.53 is exactly -0.235%; 200.00 -> 200.47 exactly +0.235%.
    expect(percentChangeText(toDecimal('200.00'), toDecimal('199.53'))).toBe('-0.24');
    expect(percentChangeText(toDecimal('200.00'), toDecimal('200.47'))).toBe('+0.24');
  });

  it('agrees with the on-screen formatter on the case toFixed got wrong', () => {
    const wire = percentChangeText(toDecimal('200.00'), toDecimal('199.53'));
    expect(wire).toBe(formatPercentFigure(-0.235));
  });

  it('prints an unchanged or rounds-to-zero move as unsigned 0.00, never -0.00', () => {
    expect(percentChangeText(toDecimal('50.00'), toDecimal('50.00'))).toBe('0.00');
    expect(percentChangeText(toDecimal('100000.00'), toDecimal('99999.99'))).toBe('0.00');
  });

  it('returns 0.00 for a zero base rather than dividing by zero', () => {
    expect(percentChangeText(toDecimal('0'), toDecimal('1.00'))).toBe('0.00');
  });

  it('honours a requested precision', () => {
    expect(percentChangeText(toDecimal('3.00'), toDecimal('4.00'), 3)).toBe('+33.333');
    expect(percentChangeText(toDecimal('3.00'), toDecimal('4.00'), 0)).toBe('+33');
  });
});

describe('decimalPlaces', () => {
  it('reads the written fractional length', () => {
    expect(decimalPlaces('0.005')).toBe(3);
    expect(decimalPlaces('12.50')).toBe(2);
    expect(decimalPlaces('7')).toBe(0);
  });
});
