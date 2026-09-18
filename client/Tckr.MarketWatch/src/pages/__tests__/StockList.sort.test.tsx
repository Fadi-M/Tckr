/**
 * `StockList.sort.test.tsx` — task 04. Asserts: sorting by price ascending/descending
 * orders via `compare` (decimal-safe), never lexicographically — `9.90` must sort below
 * `85.10`, which a string sort would get backwards (`"85.10" < "9.90"` lexically).
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { toDecimal } from '../../contracts/decimal.ts';
import { applyTick, primeUniverse, resetStore } from '../../data/store.ts';
import { loadUniverseFixture, makeFakeSource, tickFixture } from './testSupport.ts';

const { mockGetSharedSource } = vi.hoisted(() => ({ mockGetSharedSource: vi.fn() }));
vi.mock('../../data/config.ts', () => ({ getSharedSource: mockGetSharedSource }));

import { StockList } from '../StockList.tsx';

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function bodyRows() {
  return screen.getAllByRole('row').filter((row) => row.hasAttribute('data-symbol'));
}

describe('StockList sort', () => {
  beforeEach(() => {
    resetStore();
    mockGetSharedSource.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('sorts price ascending/descending using decimal `compare`, not lexicographic order', async () => {
    const universeSymbols = loadUniverseFixture();
    // A real `MarketDataSource` primes the store's universe itself (e.g.
    // `SimulatedSource`'s constructor) before any tick for one of its symbols can be
    // accepted — `applyTick` drops ticks for an unprimed symbol (store.ts's own
    // "real universe, not whatever the wire claims" guard). This fake source is a
    // plain object, not a real source instance, so the test primes it explicitly to
    // match that contract.
    primeUniverse(universeSymbols);
    mockGetSharedSource.mockReturnValue(makeFakeSource(universeSymbols).source);

    render(
      <MemoryRouter>
        <StockList />
      </MemoryRouter>,
    );
    await flushMicrotasks();
    expect(bodyRows()).toHaveLength(34);

    // COMI (default reference price 85.10) is pushed to a low price; SWDY (reference
    // 18.42) to a low-but-different price; ORAS (reference 245.60) stays high. A
    // lexicographic string sort would order "18.90" < "245.60" < "9.90" incorrectly
    // (comparing character by character); decimal `compare` must not.
    act(() => {
      applyTick(tickFixture({ s: 'COMI', p: toDecimal('9.90') }));
      applyTick(tickFixture({ s: 'SWDY', p: toDecimal('18.90') }));
    });

    const priceHeader = screen.getByRole('columnheader', { name: /^price/i });
    const sortButton = within(priceHeader).getByRole('button');

    fireEvent.click(sortButton); // ascending
    let symbols = bodyRows().map((row) => row.getAttribute('data-symbol'));
    let indexOf = (s: string) => symbols.indexOf(s);
    expect(indexOf('COMI')).toBeGreaterThanOrEqual(0);
    expect(indexOf('COMI')).toBeLessThan(indexOf('SWDY'));
    expect(indexOf('SWDY')).toBeLessThan(indexOf('ORAS'));

    fireEvent.click(sortButton); // descending
    symbols = bodyRows().map((row) => row.getAttribute('data-symbol'));
    indexOf = (s: string) => symbols.indexOf(s);
    expect(indexOf('ORAS')).toBeLessThan(indexOf('SWDY'));
    expect(indexOf('SWDY')).toBeLessThan(indexOf('COMI'));
  });
});
