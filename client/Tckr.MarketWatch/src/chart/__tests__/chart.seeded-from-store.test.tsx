import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { toDecimal } from '../../contracts/decimal.ts';
import { applyTick, resetStore } from '../../data/store.ts';
import { tick } from './chartTestSupport.ts';

vi.mock('uplot', async () => {
  const mod = await import('./uplotTestDouble.ts');
  return { default: mod.FakeUPlot };
});

import { instances, resetUplotMock } from './uplotTestDouble.ts';
import { PriceChart } from '../PriceChart.tsx';

afterEach(cleanup);

beforeEach(() => {
  resetStore();
  resetUplotMock();
});

describe('PriceChart seeds from an existing store snapshot', () => {
  it('draws a visible line immediately on mount when the store already has a snapshot', () => {
    applyTick(tick({ p: toDecimal('85.42') }));

    render(<PriceChart symbol="COMI" tickSize={toDecimal('0.01')} />);

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

  it('does not seed (or call setData) when the store has no snapshot for the symbol yet', () => {
    render(<PriceChart symbol="COMI" tickSize={toDecimal('0.01')} />);
    const instance = instances[0];
    expect(instance).toBeDefined();
    expect(instance?.setData).not.toHaveBeenCalled();
    expect(screen.queryByTestId('price-chart-empty-state')).not.toBeNull();
  });
});
