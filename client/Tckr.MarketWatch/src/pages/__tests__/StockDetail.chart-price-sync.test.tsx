/**
 * Regression: "the current price shows one number and the line draws another." The chart
 * used to sample the store on its own timer, independently of the header. It is now fed
 * `livePrice` from the same quote the header renders, so the two never diverge: not for
 * the snapshot, not for a tick. (A tick queued during loading is
 * `StockDetail.snapshot-first.test.tsx`.)
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { toDecimal } from '../../contracts/decimal.ts';
import type { IsoUtc } from '../../contracts/messages.ts';
import { resetStore } from '../../data/store.ts';
import { beatNowForTests } from '../../display/pacedViews.ts';
import { createFakeSource, renderDetail, settle, tickFixture } from './testSupport.tsx';

vi.mock('uplot', async () => ({
  default: (await import('../../chart/__tests__/uplotTestDouble.ts')).FakeUPlot,
}));
vi.mock('../../data/config.ts');
// A transparent spy on the real PriceChart, to read the `livePrice` it receives.
vi.mock('../../chart/PriceChart.tsx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../chart/PriceChart.tsx')>();
  return { ...actual, PriceChart: vi.fn(actual.PriceChart) };
});

import { PriceChart } from '../../chart/PriceChart.tsx';
import { StockDetail } from '../StockDetail.tsx';

/** The header's price as plain text, without the direction glyph `PriceCell` adds. */
function headerPrice(): string {
  return screen.getByTestId('stock-detail-price').textContent.replace(/^[▲▼]/, '');
}

function chartPrice(): string | undefined {
  return vi.mocked(PriceChart).mock.calls.at(-1)?.[0].livePrice?.p;
}

beforeEach(() => {
  resetStore();
  vi.mocked(PriceChart).mockClear();
});

afterEach(cleanup);

describe('StockDetail keeps the price header and the chart in sync', () => {
  it('feeds PriceChart the header’s own price, for the snapshot and for every tick', async () => {
    const { source, emitTick } = createFakeSource();
    await renderDetail(<StockDetail symbol="COMI" />, source);

    expect(headerPrice()).toBe('84.50');
    expect(chartPrice()).toBe('84.50');

    act(() => {
      emitTick(tickFixture({ p: toDecimal('85.75'), t: '2026-09-12T10:30:35.000Z' as IsoUtc }));
      beatNowForTests();
    });
    await settle(1);

    expect(headerPrice()).toBe('85.75');
    expect(chartPrice()).toBe('85.75');
    // No render ever handed the chart a price the header didn't show.
    for (const [props] of vi.mocked(PriceChart).mock.calls) {
      if (props.livePrice) expect(['84.50', '85.75']).toContain(props.livePrice.p);
    }
  });
});
