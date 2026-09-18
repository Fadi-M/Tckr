/**
 * `PriceChart` plots a *sample* of the price taken at most once per
 * `DISPLAY_REFRESH_INTERVAL_MS` (see `PriceChart.tsx`'s module doc), fed via the
 * `livePrice` prop from `StockDetail` — never a record of every raw tick and never an
 * independent read of `src/data/store.ts` (an earlier revision did that; see the module
 * doc's "why `livePrice` is a prop" section for the bug it caused). This suite exists to
 * pin down the property that matters most: each scheduled redraw must be a strict
 * continuation of the one before it — the exact same points, with at most one new one
 * appended — no matter how many times `livePrice` changes inside a single window.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { toDecimal } from '../../contracts/decimal.ts';
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
  resetUplotMock();
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('PriceChart sampled redraw', () => {
  it('paints immediately the first time livePrice arrives after mount, even without a mount-time seed', () => {
    // No livePrice/history at mount: no seed-setData call (see
    // chart.seeded-from-store.test.tsx). `StockDetail` fetches its snapshot
    // asynchronously, so this is the common case, not an edge case — the chart must not
    // sit empty until the first interval fires once data actually exists.
    const { rerender } = render(<PriceChart symbol="COMI" tickSize={toDecimal('0.01')} />);
    const instance = instances[0];
    expect(instance).toBeDefined();
    expect(instance?.setData).not.toHaveBeenCalled();

    rerender(<PriceChart symbol="COMI" tickSize={toDecimal('0.01')} livePrice={{ t: 1000, p: priceAt(0) }} />);
    expect(instance?.setData).toHaveBeenCalledTimes(1);
    // A synthetic point one second earlier, at the same price, precedes the real one —
    // a single point cannot render a visible line (see chart.seeded-from-store.test.tsx).
    const [xs] = instance!.setData.mock.calls[0]![0] as [Float64Array, Float64Array];
    expect(xs.length).toBe(2);
  });

  it('takes exactly one sample per window no matter how many times livePrice changes inside it', () => {
    const { rerender } = render(<PriceChart symbol="COMI" tickSize={toDecimal('0.01')} />);
    const instance = instances[0];

    // A burst: `livePrice` changes 500 times in rapid succession (as StockDetail's own
    // quote would for a hot symbol), all well before the chart's own 30s interval.
    for (let i = 0; i < 500; i += 1) {
      rerender(<PriceChart symbol="COMI" tickSize={toDecimal('0.01')} livePrice={{ t: 1000 + i, p: priceAt(i) }} />);
    }
    // Only the very first arrival painted (buffer was empty, seeded with the synthetic
    // pair); the other 499 prop changes are not individually recorded.
    expect(instance?.setData).toHaveBeenCalledTimes(1);
    const [seededXs] = instance!.setData.mock.calls[0]![0] as [Float64Array, Float64Array];
    expect(seededXs.length).toBe(2);

    act(() => {
      vi.advanceTimersByTime(DISPLAY_REFRESH_INTERVAL_MS);
    });
    expect(instance?.setData).toHaveBeenCalledTimes(2);

    // The window's one sample is appended — 2 seeded points plus exactly 1 new one, not
    // 500 — and it reflects the *latest* livePrice of the burst (priceAt(499)), not a
    // stale mid-burst value.
    const [xs, ys] = instance!.setData.mock.calls[1]![0] as [Float64Array, Float64Array];
    expect(xs.length).toBe(3);
    expect(ys.length).toBe(3);
    expect(ys[2]).toBeCloseTo(Number(priceAt(499)));
  });

  it('never reshuffles history: every redraw is the previous one plus at most one new point', () => {
    const { rerender } = render(
      <PriceChart symbol="COMI" tickSize={toDecimal('0.01')} livePrice={{ t: 1000, p: priceAt(0) }} />,
    );
    const instance = instances[0];

    for (let window = 0; window < 5; window += 1) {
      // A bursty window: 200 rapid `livePrice` changes, simulating a hot symbol's own
      // throttled-but-still-frequent quote updates — must never change how many
      // *samples* land in the chart.
      for (let i = 0; i < 200; i += 1) {
        const idx = window * 200 + i;
        rerender(<PriceChart symbol="COMI" tickSize={toDecimal('0.01')} livePrice={{ t: 2000 + idx, p: priceAt(idx) }} />);
      }
      const before = instance!.setData.mock.calls.at(-1)![0] as [Float64Array, Float64Array];
      act(() => {
        vi.advanceTimersByTime(DISPLAY_REFRESH_INTERVAL_MS);
      });
      const after = instance!.setData.mock.calls.at(-1)![0] as [Float64Array, Float64Array];

      // Exactly one point longer than before, and every prior point is byte-for-byte
      // unchanged — the line only ever grows, it never gets redrawn into a different
      // shape.
      expect(after[0].length).toBe(before[0].length + 1);
      expect(Array.from(after[0].slice(0, before[0].length))).toEqual(Array.from(before[0]));
      expect(Array.from(after[1].slice(0, before[1].length))).toEqual(Array.from(before[1]));
    }
  });

  it('repaints on the fixed interval even during a quiet window with no livePrice change', () => {
    const { rerender } = render(<PriceChart symbol="COMI" tickSize={toDecimal('0.01')} />);
    const instance = instances[0];

    const live: ChartHistoryPoint = { t: 1000, p: priceAt(0) };
    rerender(<PriceChart symbol="COMI" tickSize={toDecimal('0.01')} livePrice={live} />);
    expect(instance?.setData).toHaveBeenCalledTimes(1);

    // livePrice does not change in this window, but the timer still fires — it
    // re-samples the same unchanged price rather than skipping, keeping the cadence
    // unconditional (a flat stretch is still real information: the price hasn't moved).
    act(() => {
      vi.advanceTimersByTime(DISPLAY_REFRESH_INTERVAL_MS);
    });
    expect(instance?.setData).toHaveBeenCalledTimes(2);
    const [xs, ys] = instance!.setData.mock.calls[1]![0] as [Float64Array, Float64Array];
    expect(xs.length).toBe(3);
    expect(ys[2]).toBeCloseTo(Number(priceAt(0)));
  });

  it('stops sampling and repainting once unmounted', () => {
    const { rerender, unmount } = render(<PriceChart symbol="COMI" tickSize={toDecimal('0.01')} />);
    const instance = instances[0];

    rerender(<PriceChart symbol="COMI" tickSize={toDecimal('0.01')} livePrice={{ t: 1000, p: priceAt(0) }} />);
    const callsBeforeUnmount = instance?.setData.mock.calls.length ?? 0;
    unmount();

    act(() => {
      vi.advanceTimersByTime(DISPLAY_REFRESH_INTERVAL_MS * 3);
    });
    expect(instance?.setData.mock.calls.length).toBe(callsBeforeUnmount);
  });
});
