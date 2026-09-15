/**
 * Shared helpers for the `PriceChart` test suites (task 05). Not itself a `*.test.ts`
 * file, so Vitest does not run it directly — same convention as
 * `src/data/__tests__/testSupport.ts`.
 */
import type { Tick } from '../../contracts/messages.ts';
import { toDecimal } from '../../contracts/decimal.ts';

export function tick(overrides: Partial<Tick> = {}): Tick {
  return {
    v: 1,
    type: 'tick',
    s: 'COMI',
    p: toDecimal('85.42'),
    q: 500,
    k: 'TRADE',
    t: '2026-09-12T10:31:04.881Z' as Tick['t'],
    id: 'evt-000000000000001',
    st: 'LIVE',
    ...overrides,
  };
}
