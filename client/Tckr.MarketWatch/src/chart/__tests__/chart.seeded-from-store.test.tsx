/**
 * Renamed in spirit (not just literally) from "seeds from an existing store snapshot":
 * `PriceChart` no longer reads `src/data/store.ts` for live data at all — it is fed the
 * current price via the `livePrice` prop by its one caller, `StockDetail` (see
 * `PriceChart.tsx`'s module doc for why: two independent 30s samplers of the same tape
 * could show two different "current" prices at the same instant, which is exactly the
 * bug this architecture change fixes). This suite proves the mount-time seeding
 * behavior is unchanged in spirit — only its data source moved from the store to a prop.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { toDecimal } from '../../contracts/decimal.ts';

vi.mock('uplot', async () => {
  const mod = await import('./uplotTestDouble.ts');
  return { default: mod.FakeUPlot };
});

import { instances, resetUplotMock } from './uplotTestDouble.ts';
import { PriceChart } from '../PriceChart.tsx';

afterEach(cleanup);

beforeEach(() => {
  resetUplotMock();
});

describe('PriceChart seeds from an existing livePrice prop', () => {
  it('draws a visible line immediately on mount when livePrice is already provided', () => {
    render(<PriceChart symbol="COMI" tickSize={toDecimal('0.01')} livePrice={{ t: Date.now(), p: toDecimal('85.42') }} />);

    const instance = instances[0];
    expect(instance).toBeDefined();
    expect(instance?.setData).toHaveBeenCalledTimes(1);

    // A single point cannot render a visible line (uPlot needs two x-values to draw a
    // segment), so the real point is preceded by a synthetic one a second earlier at
    // the same price — a flat stub, not nothing, until real ticks give it a slope.
    const [xs, ys] = instance!.setData.mock.calls[0]![0] as [Float64Array, Float64Array];
    expect(xs.length).toBe(2);
    expect(ys.length).toBe(2);
    expect(xs[1]! - xs[0]!).toBe(1000);
    expect(ys[0]).toBeCloseTo(85.42);
    expect(ys[1]).toBeCloseTo(85.42);

    // The empty-state placeholder must not show: there is already a point.
    expect(screen.queryByTestId('price-chart-empty-state')).toBeNull();
  });

  it('does not seed (or call setData) when neither history nor livePrice is provided yet', () => {
    render(<PriceChart symbol="COMI" tickSize={toDecimal('0.01')} />);
    const instance = instances[0];
    expect(instance).toBeDefined();
    expect(instance?.setData).not.toHaveBeenCalled();
    expect(screen.queryByTestId('price-chart-empty-state')).not.toBeNull();
  });
});
