import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { toDecimal } from '../../contracts/decimal.ts';
import { applyTick, resetStore } from '../../data/store.ts';
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

// Injected frame scheduler: PriceChart calls the global requestAnimationFrame directly
// (its public prop surface, per the brief, is only {symbol, tickSize, capacity?,
// height?} — there is no scheduler prop to inject). Replacing the global here is the
// "frame scheduler injected" the brief's test table calls for.
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

describe('PriceChart frame-coalesced redraw', () => {
  it('produces exactly 1 setData call for 500 store notifications delivered before a single frame flush', () => {
    // No pre-existing snapshot: mount performs no immediate seed-setData call, so the
    // only setData calls possible come from the frame-scheduled redraw path below.
    render(<PriceChart symbol="COMI" tickSize={toDecimal('0.01')} />);
    const instance = instances[0];
    expect(instance).toBeDefined();
    expect(instance?.setData).not.toHaveBeenCalled();

    act(() => {
      for (let i = 0; i < 500; i += 1) {
        applyTick(tick({ id: `evt-${i}`, p: priceAt(i) }));
      }
    });

    // 500 notifications landed; only one animation frame was ever requested.
    expect(rafQueue.length).toBe(1);
    expect(instance?.setData).not.toHaveBeenCalled();

    act(() => {
      flushOneFrame();
    });

    expect(instance?.setData).toHaveBeenCalledTimes(1);

    // The single setData call carries the whole accumulated batch, not just the last
    // tick — coalescing drops redraws, not data.
    const [xs, ys] = instance!.setData.mock.calls[0]![0] as [Float64Array, Float64Array];
    expect(xs.length).toBe(500);
    expect(ys.length).toBe(500);
  });

  it('schedules a fresh frame for the next batch after a flush', () => {
    render(<PriceChart symbol="COMI" tickSize={toDecimal('0.01')} />);
    const instance = instances[0];

    act(() => {
      applyTick(tick({ id: 'evt-a', p: priceAt(0) }));
    });
    act(() => {
      flushOneFrame();
    });
    expect(instance?.setData).toHaveBeenCalledTimes(1);

    act(() => {
      for (let i = 0; i < 500; i += 1) {
        applyTick(tick({ id: `evt-b-${i}`, p: priceAt(i) }));
      }
    });
    expect(rafQueue.length).toBe(1);
    act(() => {
      flushOneFrame();
    });
    expect(instance?.setData).toHaveBeenCalledTimes(2);
  });
});
