/**
 * `SimulatedSource`'s EGX-hours gating of the *live tick engine* — distinct from
 * `simulated.history.test.ts`'s concern (what `getHistory()` returns). This suite
 * checks: no ticks while closed, ticks flow while open, and transitions (crossing
 * 10:00/14:30 Cairo while a tab is already connected) correctly start/stop generation
 * without needing a reload. See `marketCalendar.test.ts` for how the fixture
 * timestamps were verified.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tick } from '../../contracts/messages.ts';
import { SimulatedSource } from '../SimulatedSource.ts';
import { cairoEpochFor } from '../marketCalendar.ts';
import { resetStore } from '../store.ts';
import { baseConfig } from './testSupport.ts';

const SESSION_OPEN = cairoEpochFor('2026-01-15', 10, 0); // Thu, 08:00 UTC
const SESSION_CLOSE = cairoEpochFor('2026-01-15', 14, 30); // Thu, 12:30 UTC
const MID_SESSION = SESSION_OPEN + 60 * 60 * 1000;
const AFTER_CLOSE = SESSION_CLOSE + 60 * 60 * 1000;
const JUST_BEFORE_OPEN = SESSION_OPEN - 60 * 1000;

async function subscribedSourceAt(nowMs: number): Promise<SimulatedSource> {
  vi.setSystemTime(nowMs);
  const source = new SimulatedSource(baseConfig());
  const universe = await source.getUniverse();
  source.subscribe(universe.symbols.map((s) => s.symbol));
  await source.connect();
  return source;
}

beforeEach(() => {
  resetStore();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SimulatedSource live tick generation is gated by EGX hours', () => {
  it('generates no ticks at all while the market is closed', async () => {
    const source = await subscribedSourceAt(AFTER_CLOSE);
    const ticks: Tick[] = [];
    source.on.tick((t) => ticks.push(t));
    await vi.advanceTimersByTimeAsync(5000);
    expect(ticks).toHaveLength(0);
    source.disconnect();
  });

  it('generates ticks normally while the market is open', async () => {
    const source = await subscribedSourceAt(MID_SESSION);
    const ticks: Tick[] = [];
    source.on.tick((t) => ticks.push(t));
    await vi.advanceTimersByTimeAsync(500);
    expect(ticks.length).toBeGreaterThan(0);
    source.disconnect();
  });

  it('starts generating ticks the instant the market opens, with no reconnect needed', async () => {
    const source = await subscribedSourceAt(JUST_BEFORE_OPEN);
    const ticks: Tick[] = [];
    source.on.tick((t) => ticks.push(t));

    await vi.advanceTimersByTimeAsync(30_000); // still before open
    expect(ticks).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(60_000); // now past 10:00 Cairo
    expect(ticks.length).toBeGreaterThan(0);
    source.disconnect();
  });

  it('stops generating ticks the instant the market closes, with the tab still open', async () => {
    const closingSoon = SESSION_CLOSE - 200;
    const source = await subscribedSourceAt(closingSoon);
    const ticks: Tick[] = [];
    source.on.tick((t) => ticks.push(t));

    await vi.advanceTimersByTimeAsync(1000); // crosses 14:30 Cairo
    const countAtClose = ticks.length;
    expect(countAtClose).toBeGreaterThan(0);

    await vi.advanceTimersByTimeAsync(30_000); // well past close now
    expect(ticks.length).toBe(countAtClose); // nothing further generated
    source.disconnect();
  });

  it("freezes getSnapshot's price/OHLC at the session's final backfilled values once closed", async () => {
    const source = await subscribedSourceAt(AFTER_CLOSE);
    // With the market closed, nothing drains a getSnapshot() request except an
    // immediate macrotask (see SimulatedSource.getSnapshot's doc) — under fake timers
    // that macrotask needs an explicit advance to fire, exactly like every other
    // deferred-snapshot test in this codebase (e.g. StockDetail.snapshot-first).
    const firstPromise = source.getSnapshot('COMI');
    await vi.advanceTimersByTimeAsync(0);
    const first = await firstPromise;

    await vi.advanceTimersByTimeAsync(60_000);

    const secondPromise = source.getSnapshot('COMI');
    await vi.advanceTimersByTimeAsync(0);
    const second = await secondPromise;

    expect(second.price).toBe(first.price);
    expect(second.high).toBe(first.high);
    expect(second.low).toBe(first.low);
    expect(second.volume).toBe(first.volume);
    source.disconnect();
  });

  it('a getSnapshot() call issued while closed still resolves (does not hang)', async () => {
    const source = await subscribedSourceAt(AFTER_CLOSE);
    const snapshotPromise = source.getSnapshot('COMI');
    await vi.advanceTimersByTimeAsync(0);
    const snapshot = await snapshotPromise;
    expect(snapshot.symbol).toBe('COMI');
    source.disconnect();
  });
});
