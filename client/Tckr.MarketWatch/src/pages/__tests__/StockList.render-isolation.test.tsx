/**
 * `StockList.render-isolation.test.tsx` — task 04. Asserts the whole point of the
 * page's design: a tick for one symbol re-renders that row and nothing else
 * (README.md design decision #9). Each row exposes a `data-render-count` attribute for
 * exactly this purpose — see the doc comment on `StockListRow` in `../StockList.tsx`.
 *
 * Measured counts (pasted into "Notes for other tasks" in the final report): before the
 * tick every one of the 34 rows is at render count 1; after one `applyTick('COMI', ...)`,
 * COMI is at 2 and the other 33 remain at 1 — asserted generically below via a
 * before/after diff so the test does not depend on the exact baseline count.
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { toDecimal } from '../../contracts/decimal.ts';
import { applyTick, primeUniverse, resetStore } from '../../data/store.ts';
import { loadUniverseFixture, makeFakeSource, tickFixture } from './testSupport.ts';

const { mockGetSharedSource } = vi.hoisted(() => ({ mockGetSharedSource: vi.fn() }));
vi.mock('../../data/config.ts', () => ({ getSharedSource: mockGetSharedSource }));

import { StockList } from '../StockList.tsx';

describe('StockList render isolation', () => {
  beforeEach(() => {
    resetStore();
    mockGetSharedSource.mockReset();
    // Each row also runs a 1s `setInterval` to recompute its relative "last update"
    // label (independent of ticks — see `StockList.tsx`). Freezing time keeps that
    // timer from firing mid-test and adding an incidental render under CI load.
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('a tick for COMI increments exactly COMI’s render count by 1, leaving the other 33 rows unchanged', async () => {
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

    // Flush the `getUniverse()` microtask without relying on `findBy*`'s real-timer
    // polling, which does not advance under `vi.useFakeTimers()`.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const rowsBefore = screen.getAllByRole('row').filter((row) => row.hasAttribute('data-symbol'));
    expect(rowsBefore).toHaveLength(34);
    const before = new Map<string, number>(
      rowsBefore.map((row) => [
        row.getAttribute('data-symbol') as string,
        Number(row.getAttribute('data-render-count')),
      ]),
    );

    act(() => {
      applyTick(tickFixture({ s: 'COMI', p: toDecimal('85.42'), q: 500 }));
    });

    const rowsAfter = screen.getAllByRole('row').filter((row) => row.hasAttribute('data-symbol'));
    const after = new Map<string, number>(
      rowsAfter.map((row) => [
        row.getAttribute('data-symbol') as string,
        Number(row.getAttribute('data-render-count')),
      ]),
    );

    let comiDelta = -1;
    let othersUnchanged = true;
    for (const [symbol, beforeCount] of before) {
      const afterCount = after.get(symbol) ?? -1;
      if (symbol === 'COMI') {
        comiDelta = afterCount - beforeCount;
      } else if (afterCount !== beforeCount) {
        othersUnchanged = false;
      }
    }

    expect(comiDelta).toBe(1);
    expect(othersUnchanged).toBe(true);
  });
});
