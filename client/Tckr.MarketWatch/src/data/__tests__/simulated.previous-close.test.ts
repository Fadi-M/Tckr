/**
 * `SimulatedSource` models an EGX session's two anchors: the previous close (the
 * universe's `referencePrice`, EGX's reference price) and the session open, which the
 * pre-open auction moves a small, seeded gap away from it. The snapshot carries both, so
 * the client can quote Change from the close and show the move since the open.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compare, percentChange } from '../../contracts/decimal.ts';
import { SimulatedSource } from '../SimulatedSource.ts';
import { cairoEpochFor } from '../marketCalendar.ts';
import { resetStore } from '../store.ts';
import { baseConfig } from './testSupport.ts';

const MID_SESSION = cairoEpochFor('2026-01-15', 11, 0);

beforeEach(() => {
  resetStore();
  vi.useFakeTimers();
  vi.setSystemTime(MID_SESSION);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SimulatedSource previous close and auction open', () => {
  it('sends the reference price as the previous close, and opens within a small gap of it', async () => {
    const source = new SimulatedSource(baseConfig());
    const universe = await source.getUniverse();
    await source.connect();

    const pending = universe.symbols.map((def) => source.getSnapshot(def.symbol));
    await vi.advanceTimersByTimeAsync(1000);
    const snapshots = await Promise.all(pending);

    let gapped = 0;
    for (const [i, def] of universe.symbols.entries()) {
      const snapshot = snapshots[i]!;
      expect(snapshot.previousClose).toBe(def.referencePrice);
      const gap = Math.abs(percentChange(def.referencePrice, snapshot.open));
      expect(gap).toBeLessThanOrEqual(
        0.8 + 1e-9 + (100 * Number(def.tickSize)) / Number(def.referencePrice),
      );
      if (compare(snapshot.open, def.referencePrice) !== 0) {
        gapped += 1;
      }
    }
    // Most sessions open away from the close; the two are no longer the same number.
    expect(gapped).toBeGreaterThan(universe.symbols.length / 2);
    source.disconnect();
  });
});
