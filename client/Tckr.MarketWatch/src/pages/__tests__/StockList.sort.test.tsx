/**
 * Sorting by price compares decimals, never strings: "9.90" must sort below "18.90" and
 * "245.60", which a character-by-character sort gets backwards. Figures sort highest
 * first on the first click, and a third click flips back rather than clearing the sort.
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { toDecimal } from '../../contracts/decimal.ts';
import { applyTick, primeUniverse, resetStore } from '../../data/store.ts';
import { beatNowForTests } from '../../display/pacedViews.ts';
import { boardSymbols, loadUniverseFixture, renderBoard, tickFixture } from './testSupport.tsx';

vi.mock('../../data/config.ts');

/** Where COMI, SWDY and ORAS sit relative to each other, as a string like "ORAS<SWDY<COMI". */
function orderOf(...symbols: string[]): string {
  const all = boardSymbols();
  return [...symbols].sort((a, b) => all.indexOf(a) - all.indexOf(b)).join('<');
}

describe('StockList sort', () => {
  beforeEach(resetStore);
  afterEach(cleanup);

  it('orders price with decimal compare, descending first, and never clears on a third click', async () => {
    primeUniverse(loadUniverseFixture());
    await renderBoard();
    act(() => {
      applyTick(tickFixture({ s: 'COMI', p: toDecimal('9.90') })); // reference 85.10
      applyTick(tickFixture({ s: 'SWDY', p: toDecimal('18.90') })); // ORAS stays at 245.60
      beatNowForTests();
    });
    const priceHeader = screen.getByRole('columnheader', { name: /^price/i });
    const sortButton = within(priceHeader).getByRole('button');

    fireEvent.click(sortButton);
    expect(orderOf('COMI', 'SWDY', 'ORAS')).toBe('ORAS<SWDY<COMI');

    fireEvent.click(sortButton);
    expect(orderOf('COMI', 'SWDY', 'ORAS')).toBe('COMI<SWDY<ORAS');

    fireEvent.click(sortButton);
    expect(priceHeader.getAttribute('aria-sort')).toBe('descending');
    expect(orderOf('COMI', 'SWDY', 'ORAS')).toBe('ORAS<SWDY<COMI');
  });
});
