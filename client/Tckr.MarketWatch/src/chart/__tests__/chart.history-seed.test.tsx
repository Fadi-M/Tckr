/**
 * `PriceChart`'s `history` prop — seeding the full session line at mount, instead of a
 * chart only ever showing samples that arrive after it mounts. See `PriceChart.tsx`'s
 * `ChartHistoryPoint`/`history` doc and `SimulatedSource.getHistory`. The "live" side of
 * these tests uses the `livePrice` prop (fed at mount, exactly as `StockDetail` would),
 * not the store — `PriceChart` no longer reads `src/data/store.ts` for price data.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { toDecimal } from '../../contracts/decimal.ts';

vi.mock('uplot', async () => {
  const mod = await import('./uplotTestDouble.ts');
  return { default: mod.FakeUPlot };
});

import { instances, resetUplotMock } from './uplotTestDouble.ts';
import { PriceChart, type ChartHistoryPoint } from '../PriceChart.tsx';

function historyPoint(t: number, price: string): ChartHistoryPoint {
  return { t, p: toDecimal(price) };
}

afterEach(cleanup);

beforeEach(() => {
  resetUplotMock();
});

describe('PriceChart history seeding', () => {
  it('seeds the buffer with every history point, in order, before anything live', () => {
    const history = [historyPoint(1000, '84.00'), historyPoint(2000, '84.50'), historyPoint(3000, '85.00')];

    render(<PriceChart symbol="COMI" tickSize={toDecimal('0.01')} history={history} />);

    const instance = instances[0];
    expect(instance).toBeDefined();
    expect(instance?.setData).toHaveBeenCalledTimes(1);
    const [xs, ys] = instance!.setData.mock.calls[0]![0] as [Float64Array, Float64Array];
    expect(Array.from(xs)).toEqual([1000, 2000, 3000]);
    expect(Array.from(ys)).toEqual([84, 84.5, 85]);
  });

  it('appends livePrice after history when it is strictly newer than the last history point', () => {
    const history = [historyPoint(1000, '84.00'), historyPoint(2000, '84.50')];
    const livePrice = historyPoint(3000, '86.00');

    render(<PriceChart symbol="COMI" tickSize={toDecimal('0.01')} history={history} livePrice={livePrice} />);

    const instance = instances[0];
    const [xs, ys] = instance!.setData.mock.calls[0]![0] as [Float64Array, Float64Array];
    expect(xs.length).toBe(3);
    expect(ys[2]).toBeCloseTo(86);
  });

  it('does not duplicate the trailing point when history already ends at (or after) livePrice\'s time', () => {
    // `SimulatedSource.getHistory` always appends "now" as its own last point, so in
    // practice history's own tail is normally >= whatever livePrice has — this must
    // not double that point.
    const history = [historyPoint(1000, '84.00'), historyPoint(5000, '85.00')];
    const livePrice = historyPoint(3000, '86.00'); // older than history's own last point

    render(<PriceChart symbol="COMI" tickSize={toDecimal('0.01')} history={history} livePrice={livePrice} />);

    const instance = instances[0];
    const [xs] = instance!.setData.mock.calls[0]![0] as [Float64Array, Float64Array];
    expect(xs.length).toBe(2);
  });

  it('doubles a single history point into a flat two-point line when there is no livePrice yet', () => {
    const history = [historyPoint(5000, '84.00')];

    render(<PriceChart symbol="COMI" tickSize={toDecimal('0.01')} history={history} />);

    const instance = instances[0];
    const [xs, ys] = instance!.setData.mock.calls[0]![0] as [Float64Array, Float64Array];
    expect(xs.length).toBe(2);
    expect(Array.from(ys)).toEqual([84, 84]);
    expect(xs[1]! - xs[0]!).toBe(1000);
  });

  it('falls back to the empty-state placeholder when history is empty and there is no livePrice', () => {
    const { getByTestId } = render(<PriceChart symbol="COMI" tickSize={toDecimal('0.01')} history={[]} />);
    expect(getByTestId('price-chart-empty-state')).toBeDefined();
    expect(instances[0]?.setData).not.toHaveBeenCalled();
  });

  it('behaves exactly as before (single live-point doubling) when `history` is omitted entirely', () => {
    render(<PriceChart symbol="COMI" tickSize={toDecimal('0.01')} livePrice={{ t: 1000, p: toDecimal('85.42') }} />);

    const instance = instances[0];
    const [xs, ys] = instance!.setData.mock.calls[0]![0] as [Float64Array, Float64Array];
    expect(xs.length).toBe(2);
    expect(ys[0]).toBeCloseTo(85.42);
    expect(ys[1]).toBeCloseTo(85.42);
  });
});
