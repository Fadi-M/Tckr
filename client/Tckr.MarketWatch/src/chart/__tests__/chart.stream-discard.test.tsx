/**
 * Proves client-contract.md §3.3's mixed-stream ban cannot be violated by this chart:
 * once the store's `onStreamDiscard` signal fires — which `resetStream()` does itself,
 * as its last step — no point pushed before that moment can still be present in what's
 * plotted, no matter how many new-stream points arrive afterwards.
 *
 * This exercises the real `src/data/store.ts` (not a mock): `resetStream()` is called
 * directly, exactly as the production discard path would (a stream-switch caller clears
 * the store, which then notifies `PriceChart` via `onStreamDiscard`). `uplot` is still
 * mocked — jsdom has no canvas — but the store integration is real.
 *
 * The discard handler itself calls `uPlot.setData` directly (see `PriceChart.tsx`'s
 * module doc) — it is not gated by the redraw interval, since a stream switch must
 * clear stale points immediately, not wait for the next `DISPLAY_REFRESH_INTERVAL_MS`
 * sample. A burst of raw ticks reaches the plot as at most one immediate point (the
 * first time the buffer goes empty -> non-empty, e.g. right after a discard clears it)
 * plus exactly one sample per fixed interval after that — never one point per raw tick
 * — so this test uses fake timers to advance it, exactly like
 * `chart.sampled-redraw.test.tsx`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { toDecimal } from '../../contracts/decimal.ts';
import { applyTick, resetStore, resetStream } from '../../data/store.ts';
import { DISPLAY_REFRESH_INTERVAL_MS } from '../../display/throttle.ts';
import { tick } from './chartTestSupport.ts';

vi.mock('uplot', async () => {
  const mod = await import('./uplotTestDouble.ts');
  return { default: mod.FakeUPlot };
});

import { instances, resetUplotMock } from './uplotTestDouble.ts';
import { PriceChart } from '../PriceChart.tsx';

function priceAt(i: number) {
  const cents = 8500 + i;
  const intPart = Math.floor(cents / 100);
  const frac = (cents % 100).toString().padStart(2, '0');
  return toDecimal(`${intPart}.${frac}`);
}

beforeEach(() => {
  resetStore();
  resetUplotMock();
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('PriceChart stream-discard correctness', () => {
  it('keeps no old-stream point after a discard: only post-discard points survive', () => {
    render(<PriceChart symbol="COMI" tickSize={toDecimal('0.01')} />);
    const instance = instances[0];
    expect(instance).toBeDefined();

    const oldCount = 20;
    act(() => {
      for (let i = 0; i < oldCount; i += 1) {
        applyTick(tick({ id: `old-${i}`, p: priceAt(i) }));
      }
    });
    // The first of the burst paints immediately (buffer was empty, so it's preceded by
    // a synthetic point — see chart.seeded-from-store.test.tsx); the rest are raw ticks,
    // not individually recorded — only one sample per interval is.
    expect(instance?.setData).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(DISPLAY_REFRESH_INTERVAL_MS);
    });
    const preCall = instance!.setData.mock.calls.at(-1)![0] as [Float64Array, Float64Array];
    // 2 seeded points plus exactly 1 sampled point (the burst's latest price), not
    // `oldCount` raw ticks.
    expect(preCall[0].length).toBe(3);
    expect(preCall[1][2]).toBeCloseTo(Number(priceAt(oldCount - 1)));

    // The discard fires via the real store: `resetStream()` clears every per-symbol
    // view and then fires `onStreamDiscard` — old-stream ticks must be gone
    // immediately, before any new-stream tick arrives, and independently of the
    // sampling interval above.
    const callsBeforeDiscard = instance!.setData.mock.calls.length;
    act(() => {
      resetStream();
    });
    expect(instance!.setData.mock.calls.length).toBe(callsBeforeDiscard + 1);
    const [clearedXs, clearedYs] = instance!.setData.mock.calls.at(-1)![0] as [Float64Array, Float64Array];
    expect(clearedXs.length).toBe(0);
    expect(clearedYs.length).toBe(0);

    // New-stream points arrive after the discard.
    const newCount = 7;
    act(() => {
      for (let i = 0; i < newCount; i += 1) {
        // Deliberately disjoint price range from the old stream — the assertion below
        // checks every value comes from the new-stream range only, so any old value
        // found here would prove a leak.
        applyTick(tick({ id: `new-${i}`, p: priceAt(1000 + i) }));
      }
    });
    act(() => {
      vi.advanceTimersByTime(DISPLAY_REFRESH_INTERVAL_MS);
    });

    const [postXs, postYs] = instance!.setData.mock.calls.at(-1)![0] as [Float64Array, Float64Array];

    // 2 seeded points plus exactly 1 sampled point from the new-stream burst — none of
    // the old-stream ones.
    expect(postXs.length).toBe(3);
    expect(postYs.length).toBe(3);
    for (const value of Array.from(postYs)) {
      // Old-stream prices were 85.00..85.19 (priceAt(0..19)); new-stream prices are
      // 95.00..95.06 (priceAt(1000..1006)) — disjoint ranges.
      expect(value).toBeGreaterThanOrEqual(95);
      expect(value).toBeLessThan(95.1);
    }
  });

  it('unsubscribes from the discard seam on unmount', () => {
    const { unmount } = render(<PriceChart symbol="COMI" tickSize={toDecimal('0.01')} />);
    const instance = instances[0];
    act(() => {
      applyTick(tick({ p: priceAt(0) }));
    });
    const callsBeforeUnmount = instance?.setData.mock.calls.length ?? 0;
    unmount();

    // Firing a discard after unmount must not throw, and the (now-destroyed) instance
    // must not receive another setData call — the listener was removed, not merely
    // left to no-op.
    expect(() => {
      act(() => {
        resetStream();
      });
    }).not.toThrow();
    expect(instance?.setData.mock.calls.length).toBe(callsBeforeUnmount);
  });
});
