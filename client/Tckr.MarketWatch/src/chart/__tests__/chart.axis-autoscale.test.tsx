/**
 * Regression: `PriceChart` once passed `resetScales: false` to every redraw and discard
 * `setData`. uPlot's y auto-range falls back to a degenerate zero-anchored range when the
 * plotted values have no variance, which the first paint often does (a single seeded point
 * is doubled into a flat segment). Freezing scales after that pinned a flat line near the
 * bottom of an oversized axis for the chart's whole life. jsdom can't run uPlot's scale
 * math, so this asserts the root cause in our code: no `setData` call ever passes `false`.
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

describe('PriceChart y-axis auto-scale', () => {
  it('is never suppressed after a flat first paint: not on redraw, not on a stream discard', () => {
    const history = [{ t: 1000, p: toDecimal('85.00') }];
    const { rerender } = render(
      <PriceChart symbol="COMI" tickSize={toDecimal('0.01')} history={history} />,
    );
    const plot = instances[0]!;
    const [, firstYs] = plot.setData.mock.calls[0]![0] as [Float64Array, Float64Array];
    expect(Array.from(firstYs)).toEqual([85, 85]); // zero variance: the degenerate seed

    rerender(
      <PriceChart
        symbol="COMI"
        tickSize={toDecimal('0.01')}
        history={history}
        livePrice={{ t: 2000, p: toDecimal('90.00') }}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(DISPLAY_REFRESH_INTERVAL_MS);
    });
    const [, ys] = plot.setData.mock.calls.at(-1)![0] as [Float64Array, Float64Array];
    expect(Array.from(ys)).toContain(90);

    act(() => {
      resetStream();
    });

    expect(plot.setData.mock.calls.length).toBeGreaterThanOrEqual(3);
    for (const call of plot.setData.mock.calls) {
      expect(call[1]).not.toBe(false);
    }
  });
});
