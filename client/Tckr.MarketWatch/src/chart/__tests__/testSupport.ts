/**
 * Shared helpers for the `PriceChart` suites. Not itself a `*.test.ts` file, so Vitest
 * does not run it directly.
 */
import { toDecimal, type DecimalString } from '../../contracts/decimal.ts';

/** "85.00" plus `i` cents, built with integer arithmetic only: files under `src/chart/`
 * must never use the banned float-to-string built-in (see `chart.formatting.test.ts`). */
export function priceAt(i: number): DecimalString {
  const cents = 8500 + i;
  const frac = (cents % 100).toString().padStart(2, '0');
  return toDecimal(`${Math.floor(cents / 100)}.${frac}`);
}
