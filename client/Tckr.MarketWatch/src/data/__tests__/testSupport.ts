/**
 * Shared helpers for the `SimulatedSource` test suites. Not itself a `*.test.ts` file,
 * so Vitest does not run it directly.
 */
import { vi } from 'vitest';
import { SimulatedSource, type SimulatedSourceConfig } from '../SimulatedSource.ts';
import type { Tick } from '../../contracts/messages.ts';

export function baseConfig(overrides: Partial<SimulatedSourceConfig> = {}): SimulatedSourceConfig {
  return {
    eventsPerSecond: 4000,
    delayedOffsetMs: 15000,
    seed: 20260912,
    demoUser: 'user-001',
    ...overrides,
  };
}

/** Creates a connected source subscribed to every named symbol in its own universe. */
export async function createSubscribedSource(config: SimulatedSourceConfig): Promise<SimulatedSource> {
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
    // eslint-disable-next-line no-await-in-loop
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
