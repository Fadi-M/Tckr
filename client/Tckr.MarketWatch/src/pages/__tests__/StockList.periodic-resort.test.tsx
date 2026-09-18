/**
 * `StockList.periodic-resort.test.tsx` — correctness-review fix. `sorted` reads live
 * snapshot values *imperatively* (via `compareBy`/`getSymbolSnapshot`), recomputing only
 * on mount, a sort click, or a debounced search — never on every tick (see the module
 * doc in `../StockList.tsx`: resorting on every tick would reintroduce the whole-table
 * re-render this page exists to avoid, and would make rows jump under the cursor).
 * Left alone that means an active preset (e.g. "Most active") can show a stale ranking
 * indefinitely between user actions, even while individual rows keep visibly
 * repainting. `StockList.tsx` now forces one extra resort every
 * `DISPLAY_REFRESH_INTERVAL_MS` while a sort is active, via a `resortTick` counter
 * bumped on that cadence.
 *
 * This test asserts BOTH halves of that contract: the ranking is still stale
 * immediately after a tick (no resort-per-tick regression), and it catches up once the
 * interval fires — without any further user action.
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { toDecimal } from '../../contracts/decimal.ts';
import { applyTick, primeUniverse, resetStore } from '../../data/store.ts';
import { DISPLAY_REFRESH_INTERVAL_MS } from '../../display/throttle.ts';
import { loadUniverseFixture, makeFakeSource, tickFixture } from './testSupport.ts';

const { mockGetSharedSource } = vi.hoisted(() => ({ mockGetSharedSource: vi.fn() }));
vi.mock('../../data/config.ts', () => ({ getSharedSource: mockGetSharedSource }));

import { StockList } from '../StockList.tsx';

function bodyRows() {
  return screen.getAllByRole('row').filter((row) => row.hasAttribute('data-symbol'));
}

describe('StockList periodic re-sort', () => {
  beforeEach(() => {
    resetStore();
    mockGetSharedSource.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('keeps a stale ranking between ticks, then catches up once DISPLAY_REFRESH_INTERVAL_MS elapses', async () => {
    const universeSymbols = loadUniverseFixture();
    // A real `MarketDataSource` primes the store's universe itself before any tick can
    // be accepted (store.ts's "real universe, not whatever the wire claims" guard).
    // This fake source is a plain object, not a real source instance, so the test
    // primes it explicitly to match that contract.
    primeUniverse(universeSymbols);
    mockGetSharedSource.mockReturnValue(makeFakeSource(universeSymbols).source);

    render(
      <MemoryRouter>
        <StockList />
      </MemoryRouter>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // "Most active" sorts by volume descending. Every symbol starts at volume 0 (tied),
    // so the initial order is the untouched universe order — SWDY is not first.
    fireEvent.click(screen.getByRole('button', { name: /most active/i }));
    const before = bodyRows().map((row) => row.getAttribute('data-symbol'));
    expect(before[0]).not.toBe('SWDY');

    // Push SWDY's volume far above every other symbol's (still 0). The row itself
    // repaints immediately (it reads the store reactively) but the table's *order*
    // must NOT jump immediately — that would mean this page resorts on every tick,
    // which the module doc says would make rows jump under the user's cursor.
    act(() => {
      applyTick(tickFixture({ s: 'SWDY', p: toDecimal('10.00'), q: 5_000_000 }));
    });
    const stillBefore = bodyRows().map((row) => row.getAttribute('data-symbol'));
    expect(stillBefore[0]).not.toBe('SWDY');

    // Once a full DISPLAY_REFRESH_INTERVAL_MS window elapses, the periodic re-sort
    // fires and SWDY — now the clear volume leader — rises to the top with no further
    // user action.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DISPLAY_REFRESH_INTERVAL_MS);
    });
    const after = bodyRows().map((row) => row.getAttribute('data-symbol'));
    expect(after[0]).toBe('SWDY');
  });
});
