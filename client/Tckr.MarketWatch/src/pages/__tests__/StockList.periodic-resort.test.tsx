/**
 * `StockList.periodic-resort.test.tsx` — correctness-review fix. `sorted` reads live
 * snapshot values *imperatively* (via `compareBy`/`getSymbolSnapshot`), recomputing only
 * on mount, a sort click, or a debounced search — never on every tick (see the module
 * doc in `../StockList.tsx`: resorting on every tick would reintroduce the whole-table
 * re-render this page exists to avoid, and would make rows jump under the cursor).
 * Left alone that means an active preset (e.g. "Most active") can show a stale ranking
 * indefinitely between user actions, even while individual rows keep visibly
 * repainting. `StockList.tsx` now re-ranks on the page's price beat
 * (`subscribeBeat`, every `DISPLAY_REFRESH_INTERVAL_MS`) while a sort is active, in the
 * same commit as the figures it ranks by.
 *
 * This test asserts BOTH halves of that contract: the ranking is still stale
 * immediately after a tick (no resort-per-tick regression), and it catches up once the
 * interval fires — without any further user action.
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { toDecimal } from '../../contracts/decimal.ts';
import { applyTick, primeUniverse, resetStore } from '../../data/store.ts';
import { DISPLAY_REFRESH_INTERVAL_MS } from '../../display/throttle.ts';
import { boardSymbols, loadUniverseFixture, renderBoard, tickFixture } from './testSupport.tsx';

vi.mock('../../data/config.ts');

describe('StockList periodic re-sort', () => {
  beforeEach(() => {
    resetStore();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('keeps a stale ranking between ticks, then catches up once DISPLAY_REFRESH_INTERVAL_MS elapses', async () => {
    primeUniverse(loadUniverseFixture()); // real sources prime before a tick is accepted
    await renderBoard();

    // "Most active" sorts by volume descending. Every symbol starts at volume 0 (tied),
    // so the initial order is the untouched universe order — SWDY is not first.
    fireEvent.click(screen.getByRole('button', { name: 'Most active' }));
    const before = boardSymbols();
    expect(before[0]).not.toBe('SWDY');

    // Push SWDY's volume far above every other symbol's (still 0). Neither its figures
    // nor the table's *order* may jump immediately — that would mean this page resorts on every tick,
    // which the module doc says would make rows jump under the user's cursor.
    act(() => {
      applyTick(tickFixture({ s: 'SWDY', p: toDecimal('10.00'), q: 5_000_000 }));
    });
    const stillBefore = boardSymbols();
    expect(stillBefore[0]).not.toBe('SWDY');

    // Once the next beat passes (at most DISPLAY_REFRESH_INTERVAL_MS away), the re-sort
    // fires and SWDY — now the clear volume leader — rises to the top with no further
    // user action.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DISPLAY_REFRESH_INTERVAL_MS);
    });
    const after = boardSymbols();
    expect(after[0]).toBe('SWDY');
  });
});
