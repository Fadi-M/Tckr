/**
 * The detail pane under a hot symbol's load. `StockDetail` reads `on.tick` uncoalesced, so
 * a burst paints nothing until the page's next beat (`src/display/pacedViews.ts`, the same
 * beat as the board row) and then paints once, with the latest tick. Every tick's
 * quantity still reaches the volume, even though only the last one's price is painted.
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { toDecimal } from '../../contracts/decimal.ts';
import type { IsoUtc } from '../../contracts/messages.ts';
import { resetStore } from '../../data/store.ts';
import { DISPLAY_REFRESH_INTERVAL_MS } from '../../display/throttle.ts';
import { createFakeSource, renderDetail, tickFixture } from './testSupport.tsx';

vi.mock('uplot', async () => ({
  default: (await import('../../chart/__tests__/uplotTestDouble.ts')).FakeUPlot,
}));
vi.mock('../../data/config.ts');
vi.mock('../../components/PriceCell.tsx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../components/PriceCell.tsx')>();
  return { ...actual, PriceCell: vi.fn(actual.PriceCell) };
});

import { PriceCell } from '../../components/PriceCell.tsx';
import { StockDetail } from '../StockDetail.tsx';

const SNAPSHOT_VOLUME = 216637; // snapshotFixture's volume
const price = () => screen.getByTestId('stock-detail-price').textContent;

beforeEach(() => {
  resetStore();
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('StockDetail display throttle', () => {
  it('paints a 40-tick burst once, on the beat, with the latest price and every tick’s volume', async () => {
    const { source, emitTick } = createFakeSource();
    await renderDetail(<StockDetail symbol="COMI" />, source);
    expect(price()).toContain('84.50');
    vi.mocked(PriceCell).mockClear();

    act(() => {
      for (let i = 0; i < 40; i += 1) {
        emitTick(
          tickFixture({
            p: toDecimal((85 + i * 0.01).toFixed(2)),
            q: 10,
            t: `2026-09-12T10:30:05.${String(i).padStart(3, '0')}Z` as IsoUtc,
            id: `evt-${i}`,
          }),
        );
      }
    });

    // Nothing paints mid-beat, not even the burst's first tick.
    const paintedMidBeat = vi
      .mocked(PriceCell)
      .mock.calls.filter(([props]) => String(props.value).startsWith('85.'));
    expect(paintedMidBeat).toEqual([]);
    expect(price()).toContain('84.50');

    await act(async () => {
      vi.advanceTimersByTime(DISPLAY_REFRESH_INTERVAL_MS);
    });

    expect(price()).toContain('85.39');
    expect(screen.getByTestId('stock-detail-footer').textContent).toContain(
      (SNAPSHOT_VOLUME + 40 * 10).toLocaleString('en-US'),
    );
  });
});
