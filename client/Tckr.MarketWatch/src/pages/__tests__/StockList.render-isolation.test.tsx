/**
 * The board under a hot symbol's load (README.md design decision #9): a burst of ticks
 * paints nothing between beats, then, on the page's one wall-clock beat
 * (`src/display/pacedViews.ts`), re-renders exactly that symbol's row, once, with the
 * burst's latest price. The other 33 rows don't render at all. Each row exposes
 * `data-render-count` for exactly this check.
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { toDecimal } from '../../contracts/decimal.ts';
import { applyTick, primeUniverse, resetStore } from '../../data/store.ts';
import { DISPLAY_REFRESH_INTERVAL_MS } from '../../display/throttle.ts';
import { boardRows, loadUniverseFixture, renderBoard, tickFixture } from './testSupport.tsx';

vi.mock('../../data/config.ts');

function renderCounts(): Map<string, number> {
  return new Map(
    boardRows().map((row) => [
      row.getAttribute('data-symbol')!,
      Number(row.getAttribute('data-render-count')),
    ]),
  );
}

describe('StockList render isolation', () => {
  beforeEach(() => {
    resetStore();
    // Fake timers also freeze each row's 1 s "last update" label, which would otherwise
    // add incidental renders under CI load.
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('paints a 200-tick burst once, on the beat, in its own row only, with the latest price', async () => {
    const universe = loadUniverseFixture();
    primeUniverse(universe); // real sources prime before a tick can be accepted
    await renderBoard();
    const before = renderCounts();
    expect(before.size).toBe(34);

    act(() => {
      for (let i = 0; i < 200; i += 1) {
        applyTick(
          tickFixture({ s: 'COMI', p: toDecimal((85 + i * 0.01).toFixed(2)), id: `evt-${i}` }),
        );
      }
    });
    expect(renderCounts()).toEqual(before); // nothing mid-beat, not even the first tick

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DISPLAY_REFRESH_INTERVAL_MS);
    });

    const after = renderCounts();
    for (const [symbol, count] of before) {
      expect(after.get(symbol), symbol).toBe(symbol === 'COMI' ? count + 1 : count);
    }
    const comi = boardRows().find((row) => row.getAttribute('data-symbol') === 'COMI');
    expect(comi?.textContent).toContain('86.99');
  });
});
