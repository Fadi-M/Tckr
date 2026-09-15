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
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { toDecimal } from '../../contracts/decimal.ts';
import { applyTick, resetStore, resetStream } from '../../data/store.ts';
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

let rafQueue: FrameRequestCallback[] = [];

function flushOneFrame(): void {
  const queued = rafQueue;
  rafQueue = [];
  for (const cb of queued) {
    cb(performance.now());
  }
}

beforeEach(() => {
  resetStore();
  resetUplotMock();
  rafQueue = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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
    act(() => {
      flushOneFrame();
    });
    expect(instance?.setData).toHaveBeenCalledTimes(1);
    const [preXs] = instance!.setData.mock.calls[0]![0] as [Float64Array, Float64Array];
    expect(preXs.length).toBe(oldCount);

    // The discard fires via the real store: `resetStream()` clears every per-symbol
    // view and then fires `onStreamDiscard` — old-stream ticks must be gone
    // immediately, before any new-stream tick arrives.
    act(() => {
      resetStream();
    });
    expect(instance?.setData).toHaveBeenCalledTimes(2);
    const [clearedXs, clearedYs] = instance!.setData.mock.calls[1]![0] as [Float64Array, Float64Array];
    expect(clearedXs.length).toBe(0);
    expect(clearedYs.length).toBe(0);

    // New-stream points arrive after the discard.
    const newCount = 7;
    act(() => {
      for (let i = 0; i < newCount; i += 1) {
        // Deliberately disjoint price range from the old stream — the assertion below
        // checks the series length and every value comes from the new-stream range
        // only, so any old value found here would prove a leak.
        applyTick(tick({ id: `new-${i}`, p: priceAt(1000 + i) }));
      }
    });
    act(() => {
      flushOneFrame();
    });

    expect(instance?.setData).toHaveBeenCalledTimes(3);
    const [postXs, postYs] = instance!.setData.mock.calls[2]![0] as [Float64Array, Float64Array];

    // Exactly the M new-stream points, none of the N old-stream ones.
    expect(postXs.length).toBe(newCount);
    expect(postYs.length).toBe(newCount);
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
    act(() => {
      flushOneFrame();
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
