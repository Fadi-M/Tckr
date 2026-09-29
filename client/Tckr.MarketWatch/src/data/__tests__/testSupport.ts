/**
 * Shared helpers for the data-layer test suites. Not itself a `*.test.ts` file,
 * so Vitest does not run it directly.
 */
import { vi } from 'vitest';
import { toDecimal } from '../../contracts/decimal.ts';
import type { Stream, Tick } from '../../contracts/messages.ts';
import { SimulatedSource, type SimulatedSourceConfig } from '../SimulatedSource.ts';
import { primeUniverse } from '../store.ts';

/**
 * A fixed instant safely within EGX trading hours — Thursday 2026-01-15, 10:00 UTC =
 * 12:00 Cairo (Egypt's DST is off in January; see `marketCalendar.test.ts` for how this
 * exact date was verified against `Intl` ground truth). `SimulatedSource` now only
 * generates ticks while EGX is open (`marketCalendar.getMarketStatus`), so every
 * existing test that doesn't specifically care about market-hours behavior needs the
 * fake clock pinned to a known-open instant — otherwise whether ticks flow at all would
 * depend on what real wall-clock time the test suite happens to run at. Tests that
 * specifically exercise closed-market/transition behavior set their own system time
 * instead (see `simulated.marketHours.test.ts`).
 */
export const KNOWN_OPEN_NOW_MS = Date.UTC(2026, 0, 15, 10, 0, 0);

export function baseConfig(overrides: Partial<SimulatedSourceConfig> = {}): SimulatedSourceConfig {
  return {
    eventsPerSecond: 4000,
    delayedOffsetMs: 15000,
    seed: 20260912,
    demoUser: 'user-001',
    ...overrides,
  };
}

/** Creates a connected source subscribed to every named symbol in its own universe.
 * Requires fake timers to already be installed (`vi.useFakeTimers()`) — pins the fake
 * clock to `KNOWN_OPEN_NOW_MS` before connecting so ticks are guaranteed to flow,
 * regardless of real-world wall-clock time (see that constant's doc). */
export async function createSubscribedSource(
  config: SimulatedSourceConfig,
): Promise<SimulatedSource> {
  vi.setSystemTime(KNOWN_OPEN_NOW_MS);
  const source = new SimulatedSource(config);
  const universe = await source.getUniverse();
  source.subscribe(universe.symbols.map((s) => s.symbol));
  await source.connect();
  return source;
}

/** Advances fake timers until at least `count` ticks have been observed, then returns
 * exactly the first `count`. Caller must have already called `vi.useFakeTimers()`. */
export async function collectTicks(config: SimulatedSourceConfig, count: number): Promise<Tick[]> {
  const source = await createSubscribedSource(config);
  const ticks: Tick[] = [];
  source.on.tick((t) => {
    ticks.push(t);
  });
  const stepMs = 200;
  let elapsed = 0;
  const maxMs = 120000;
  while (ticks.length < count && elapsed < maxMs) {
    await vi.advanceTimersByTimeAsync(stepMs);
    elapsed += stepMs;
  }
  source.disconnect();
  return ticks.slice(0, count);
}

/** A validated decimal string's value as a scaled BigInt (4 implied decimal digits),
 * mirroring `contracts/decimal.ts`'s internal representation. Test-only: never used by
 * production code, and — like every helper in this file — built from string/BigInt
 * operations only, never the double-parsing globals the project bans on a price. */
export function toScaledForTest(value: string): bigint {
  const negative = value.charAt(0) === '-';
  const hasSign = negative || value.charAt(0) === '+';
  const unsigned = hasSign ? value.slice(1) : value;
  const dot = unsigned.indexOf('.');
  const intPart = dot === -1 ? unsigned : unsigned.slice(0, dot);
  const fracRaw = dot === -1 ? '' : unsigned.slice(dot + 1);
  const fracPart = fracRaw.padEnd(4, '0');
  const magnitude = BigInt(intPart + fracPart);
  return negative ? -magnitude : magnitude;
}

/** A LIVE trade tick; only the fields a scenario varies are parameters. */
export function tick(
  symbol: string,
  price: string,
  id: string,
  overrides: Partial<Tick> & { st?: Stream } = {},
): Tick {
  return {
    v: 1,
    type: 'tick',
    s: symbol,
    p: toDecimal(price),
    q: 100,
    k: 'TRADE',
    t: '2026-09-12T10:31:04.881Z' as Tick['t'],
    id,
    st: 'LIVE',
    ...overrides,
  };
}

/** Primes the store with COMI (reference 85.10) and, optionally, CIB (62.75). The store
 * drops ticks for unprimed symbols, as the real sources always prime first. */
export function primeSymbols(withCib = false): void {
  primeUniverse([
    {
      symbol: 'COMI',
      name: 'Commercial International Holding',
      referencePrice: toDecimal('85.10'),
    },
    ...(withCib
      ? [{ symbol: 'CIB', name: 'Cairo Investment Bank', referencePrice: toDecimal('62.75') }]
      : []),
  ]);
}
