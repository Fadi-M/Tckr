/**
 * `StockDetail`'s session-history fetch: the chart must not render until
 * `source.getHistory(symbol)` has settled (even to empty, on failure), and the ISO
 * timestamps it returns must be converted to epoch ms before reaching `PriceChart` —
 * see `PriceChart.tsx`'s `ChartHistoryPoint` doc for why that conversion belongs here,
 * not inside the chart.
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { toDecimal } from '../../contracts/decimal.ts';
import type { IsoUtc } from '../../contracts/messages.ts';
import { resetStore } from '../../data/store.ts';
import { createFakeSource, renderDetail } from './testSupport.tsx';

vi.mock('uplot', async () => ({
  default: (await import('../../chart/__tests__/uplotTestDouble.ts')).FakeUPlot,
}));
vi.mock('../../data/config.ts');
// A transparent spy on the real PriceChart, to read the `history` it receives.
vi.mock('../../chart/PriceChart.tsx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../chart/PriceChart.tsx')>();
  return { ...actual, PriceChart: vi.fn(actual.PriceChart) };
});

import { PriceChart } from '../../chart/PriceChart.tsx';
import { StockDetail } from '../StockDetail.tsx';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

beforeEach(() => {
  resetStore();
  vi.mocked(PriceChart).mockClear();
});

describe('StockDetail session-history fetch', () => {
  it('shows a chart-loading placeholder until getHistory resolves, then renders the chart', async () => {
    vi.useFakeTimers();
    const { source } = createFakeSource({
      historyImpl: (symbol) =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ v: 1, symbol, points: [] }), 50);
        }),
    });
    await renderDetail(<StockDetail symbol="COMI" />, source);

    expect(screen.getByTestId('stock-detail-chart-loading')).toBeTruthy();
    expect(vi.mocked(PriceChart)).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(60);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByTestId('stock-detail-chart-loading')).toBeNull();
    expect(vi.mocked(PriceChart)).toHaveBeenCalled();
  });

  it("converts each history point's ISO timestamp to epoch ms before handing it to PriceChart", async () => {
    // `StockDetail` defaults to the "60S" range pill (design import), which filters
    // `history` down to points within the trailing 60 real-world seconds before
    // handing it to `PriceChart` — see `StockDetail.tsx`'s "Chart range selector"
    // module doc. Pinning the system clock to the fixture's own last timestamp keeps
    // both fixture points inside that window, so this test can still isolate what it
    // actually cares about (the ISO -> epoch-ms conversion) without the unrelated
    // range filter interfering.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T09:30:30.000Z'));
    const { source } = createFakeSource({
      historyImpl: (symbol) =>
        Promise.resolve({
          v: 1,
          symbol,
          points: [
            { t: '2026-09-12T09:30:00.000Z' as IsoUtc, p: toDecimal('84.00') },
            { t: '2026-09-12T09:30:30.000Z' as IsoUtc, p: toDecimal('84.05') },
          ],
        }),
    });
    await renderDetail(<StockDetail symbol="COMI" />, source);

    const lastCall = vi.mocked(PriceChart).mock.calls.at(-1);
    expect(lastCall).toBeDefined();
    expect(lastCall![0].history).toEqual([
      { t: Date.parse('2026-09-12T09:30:00.000Z'), p: toDecimal('84.00') },
      { t: Date.parse('2026-09-12T09:30:30.000Z'), p: toDecimal('84.05') },
    ]);
  });

  it('renders the chart with empty history if getHistory rejects, rather than loading forever', async () => {
    const { source } = createFakeSource({
      historyImpl: () => Promise.reject(new Error('simulated getHistory failure')),
    });
    await renderDetail(<StockDetail symbol="COMI" />, source);

    expect(screen.queryByTestId('stock-detail-chart-loading')).toBeNull();
    const lastCall = vi.mocked(PriceChart).mock.calls.at(-1);
    expect(lastCall![0].history).toEqual([]);
  });
});
