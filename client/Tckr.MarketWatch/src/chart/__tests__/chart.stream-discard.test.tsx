/**
 * Proves client-contract.md §3.3's mixed-stream ban cannot be violated by this chart:
 * once the store's `onStreamDiscard` signal fires — which `resetStream()` does itself,
 * as its last step — no point pushed before that moment can still be present in what's
 * plotted, no matter how many new-stream points arrive afterwards.
 *
 * This exercises the real `src/data/store.ts` `resetStream()`/`onStreamDiscard` (not a
 * mock) — that global cross-cutting signal is still store-driven, unlike this
 * component's *live price sampling*, which no longer reads the store at all (see
 * `PriceChart.tsx`'s module doc). The "old-stream" and "new-stream" points below are
 * therefore fed via `livePrice` prop changes (`rerender`), the same way `StockDetail`
 * would actually update them, not via `applyTick`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { toDecimal } from '../../contracts/decimal.ts';
import { resetStore, resetStream } from '../../data/store.ts';
import { DISPLAY_REFRESH_INTERVAL_MS } from '../../display/throttle.ts';

vi.mock('uplot', async () => {
  const mod = await import('./uplotTestDouble.ts');
  return { default: mod.FakeUPlot };
});

import { instances, resetUplotMock } from './uplotTestDouble.ts';
import { PriceChart, type ChartHistoryPoint } from '../PriceChart.tsx';

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
    let live: ChartHistoryPoint = { t: 1000, p: priceAt(0) };
    const { rerender } = render(<PriceChart symbol="COMI" tickSize={toDecimal('0.01')} livePrice={live} />);
    const instance = instances[0];
    expect(instance).toBeDefined();
    // The initial livePrice paints immediately (buffer was empty, so it's preceded by
    // a synthetic point — see chart.seeded-from-store.test.tsx).
    expect(instance?.setData).toHaveBeenCalledTimes(1);

    // "Old stream" burst: livePrice changes rapidly, well before the chart's own 30s
    // sampling interval — only the interval's own sample gets recorded, not every one.
    for (let i = 1; i < 20; i += 1) {
      live = { t: 1000 + i, p: priceAt(i) };
      rerender(<PriceChart symbol="COMI" tickSize={toDecimal('0.01')} livePrice={live} />);
    }
    act(() => {
      vi.advanceTimersByTime(DISPLAY_REFRESH_INTERVAL_MS);
    });
    const preCall = instance!.setData.mock.calls.at(-1)![0] as [Float64Array, Float64Array];
    // 2 seeded points plus exactly 1 sampled point (the burst's latest price), not one
    // per rerender.
    expect(preCall[0].length).toBe(3);
    expect(preCall[1][2]).toBeCloseTo(Number(priceAt(19)));

    // The discard fires via the real store: `resetStream()` clears every per-symbol
    // view and then fires `onStreamDiscard` — old-stream points must be gone
    // immediately, before any new-stream point arrives, and independently of the
    // sampling interval above.
    const callsBeforeDiscard = instance!.setData.mock.calls.length;
    act(() => {
      resetStream();
    });
    expect(instance!.setData.mock.calls.length).toBe(callsBeforeDiscard + 1);
    const [clearedXs, clearedYs] = instance!.setData.mock.calls.at(-1)![0] as [Float64Array, Float64Array];
    expect(clearedXs.length).toBe(0);
    expect(clearedYs.length).toBe(0);

    // New-stream points arrive after the discard, at a deliberately disjoint price
    // range — the assertion below checks every value comes from the new-stream range
    // only, so any old value found here would prove a leak.
    live = { t: 100_000, p: priceAt(1000) };
    rerender(<PriceChart symbol="COMI" tickSize={toDecimal('0.01')} livePrice={live} />);
    for (let i = 1; i < 7; i += 1) {
      live = { t: 100_000 + i, p: priceAt(1000 + i) };
      rerender(<PriceChart symbol="COMI" tickSize={toDecimal('0.01')} livePrice={live} />);
    }
    act(() => {
      vi.advanceTimersByTime(DISPLAY_REFRESH_INTERVAL_MS);
    });

    const [postXs, postYs] = instance!.setData.mock.calls.at(-1)![0] as [Float64Array, Float64Array];

    // 2 re-seeded points (from the first post-discard livePrice) plus exactly 1
    // sampled point from the new-stream burst — none of the old-stream ones.
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
    const { unmount } = render(
      <PriceChart symbol="COMI" tickSize={toDecimal('0.01')} livePrice={{ t: 1000, p: priceAt(0) }} />,
    );
    const instance = instances[0];
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
