/**
 * Regression test for a real bug (not caught by `chart.sampled-redraw.test.tsx`, which
 * only asserts on the x/y *data* arrays passed to `setData`, never the `resetScales`
 * argument): a previous revision of `PriceChart.tsx` passed `resetScales: false` to
 * every periodic `redraw()`/`onStreamDiscard` `setData` call, as "future-proofing" for a
 * zoom/pan feature that does not exist.
 *
 * uPlot's y-axis auto-range (`uPlot.rangeNum`) falls back to a degenerate, zero-anchored
 * range whenever the currently plotted values have zero variance (verified directly:
 * `uPlot.rangeNum(18.42, 18.42, 0.1, true)` returns `[0, 37]`) — which the very first
 * paint often does, since a single seeded point is deliberately doubled (same price
 * twice) to give uPlot two x-values to draw a segment. With `resetScales: false` on
 * every redraw after that, uPlot was told to preserve that degenerate `[0, 37]`-ish
 * range forever, even once real, varying prices arrived — a chart that *looks* like a
 * flat line pinned near the bottom of a wildly oversized axis, for the rest of its life,
 * despite the underlying price data genuinely changing tick to tick.
 *
 * `FakeUPlot`/jsdom cannot exercise uPlot's actual scale math (jsdom has no canvas —
 * see this suite's sibling files for why every `chart.*.test.tsx` mocks the `uplot`
 * module). What this file asserts instead is the actual, fixable root cause within our
 * own code: every `setData` call after the very first paint must leave `resetScales` at
 * its default (`true`), never pass `false` — trust uPlot's own (Context7-verified)
 * auto-ranging to do the right thing once given permission to run on every redraw.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { toDecimal } from '../../contracts/decimal.ts';
import { resetStream } from '../../data/store.ts';
import { DISPLAY_REFRESH_INTERVAL_MS } from '../../display/throttle.ts';

vi.mock('uplot', async () => {
  const mod = await import('./uplotTestDouble.ts');
  return { default: mod.FakeUPlot };
});

import { instances, resetUplotMock } from './uplotTestDouble.ts';
import { PriceChart } from '../PriceChart.tsx';

beforeEach(() => {
  resetUplotMock();
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** `setData`'s optional second argument: `undefined` (omitted) and `true` are both
 * "reset scales" (uPlot's own default) — only an explicit `false` suppresses it. */
function resetScalesArg(call: unknown[]): unknown {
  return call[1];
}

describe('PriceChart y-axis auto-scale is never suppressed after the first paint', () => {
  it('a periodic redraw() call never passes resetScales: false', () => {
    render(<PriceChart symbol="COMI" tickSize={toDecimal('0.01')} history={[{ t: 1000, p: toDecimal('85.00') }]} />);
    const instance = instances[0];
    expect(instance).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(DISPLAY_REFRESH_INTERVAL_MS);
    });

    // At least one redraw() call beyond the initial seed must have happened.
    expect(instance!.setData.mock.calls.length).toBeGreaterThanOrEqual(2);
    for (const call of instance!.setData.mock.calls) {
      expect(resetScalesArg(call)).not.toBe(false);
    }
  });

  it('the y-axis re-expands once real variance follows a degenerate flat start (the actual bug scenario)', () => {
    // Exactly one history sample — triggers the single-point-doubling fallback, the
    // exact degenerate (min === max) seed that exposed the bug.
    const { rerender } = render(
      <PriceChart symbol="COMI" tickSize={toDecimal('0.01')} history={[{ t: 1000, p: toDecimal('85.00') }]} />,
    );
    const instance = instances[0];
    const [, firstYs] = instance!.setData.mock.calls[0]![0] as [Float64Array, Float64Array];
    expect(Array.from(firstYs)).toEqual([85, 85]); // degenerate: zero variance

    // A real, distinct livePrice arrives (as StockDetail would supply it) and gets
    // sampled on the next scheduled redraw.
    rerender(
      <PriceChart
        symbol="COMI"
        tickSize={toDecimal('0.01')}
        history={[{ t: 1000, p: toDecimal('85.00') }]}
        livePrice={{ t: 2000, p: toDecimal('90.00') }}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(DISPLAY_REFRESH_INTERVAL_MS);
    });

    const lastCall = instance!.setData.mock.calls.at(-1)!;
    expect(resetScalesArg(lastCall)).not.toBe(false);
    const [, ys] = lastCall[0] as [Float64Array, Float64Array];
    // The real point (90) must actually be in the plotted data — the fix under test is
    // that uPlot is *permitted* to re-range around it, not merely that it was pushed.
    expect(Array.from(ys)).toContain(90);
  });

  it('the onStreamDiscard clear never passes resetScales: false', () => {
    render(<PriceChart symbol="COMI" tickSize={toDecimal('0.01')} history={[{ t: 1000, p: toDecimal('85.00') }]} />);
    const instance = instances[0];

    act(() => {
      resetStream();
    });

    const lastCall = instance!.setData.mock.calls.at(-1)!;
    expect(resetScalesArg(lastCall)).not.toBe(false);
  });
});
