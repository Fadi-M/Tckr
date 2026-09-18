/**
 * `StockList.default-order.test.tsx` — task 04. Asserts: the default order (no column
 * sort applied) is the exchange's own `weight`-descending activity order — the first
 * four rows are COMI, CIB, ORAS, SWDY.
 *
 * `SymbolDefinition` (the frozen `client-contract.md` §2 shape returned by
 * `getUniverse()`) carries no `weight` field — see "Notes for other tasks". This test
 * relies on the documented, verified invariant that `public/symbols.json` — and
 * therefore `getUniverse()`'s response array, which preserves that file's order — is
 * already sorted by `weight` descending; the default (unsorted) render order is simply
 * that array order.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { resetStore } from '../../data/store.ts';
import { loadUniverseFixture, loadUniverseWeights, makeFakeSource } from './testSupport.ts';

const { mockGetSharedSource } = vi.hoisted(() => ({ mockGetSharedSource: vi.fn() }));
vi.mock('../../data/config.ts', () => ({ getSharedSource: mockGetSharedSource }));

import { StockList } from '../StockList.tsx';

function bodyRows() {
  return screen.getAllByRole('row').filter((row) => row.hasAttribute('data-symbol'));
}

describe('StockList default order', () => {
  beforeEach(() => {
    resetStore();
    mockGetSharedSource.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('public/symbols.json is itself weight-descending (precondition for this test)', () => {
    const weights = loadUniverseWeights();
    for (let i = 0; i + 1 < weights.length; i += 1) {
      expect(weights[i]).toBeGreaterThanOrEqual(weights[i + 1] as number);
    }
  });

  it('renders COMI, CIB, ORAS, SWDY first, with no sort applied', async () => {
    const symbols = loadUniverseFixture();
    mockGetSharedSource.mockReturnValue(makeFakeSource(symbols).source);

    render(
      <MemoryRouter>
        <StockList />
      </MemoryRouter>,
    );

    await screen.findAllByRole('row');
    const rows = bodyRows();
    const renderedSymbols = rows.map((row) => row.getAttribute('data-symbol'));

    expect(renderedSymbols.slice(0, 4)).toEqual(['COMI', 'CIB', 'ORAS', 'SWDY']);
  });
});
