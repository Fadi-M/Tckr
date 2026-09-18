/**
 * `StockList.universe.test.tsx` — task 04 (docs/phase-3-web-client/04-stock-list.md).
 * Asserts: exactly 34 rows; the rendered symbol set equals the set in
 * `public/symbols.json`, read from disk — not a hard-coded list in this test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { resetStore } from '../../data/store.ts';
import { loadUniverseFixture, makeFakeSource } from './testSupport.ts';

const { mockGetSharedSource } = vi.hoisted(() => ({ mockGetSharedSource: vi.fn() }));
vi.mock('../../data/config.ts', () => ({ getSharedSource: mockGetSharedSource }));

import { StockList } from '../StockList.tsx';

describe('StockList universe rendering', () => {
  beforeEach(() => {
    resetStore();
    mockGetSharedSource.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders exactly the 34 named instruments from public/symbols.json, and no others', async () => {
    const universeSymbols = loadUniverseFixture();
    expect(universeSymbols).toHaveLength(34);
    mockGetSharedSource.mockReturnValue(makeFakeSource(universeSymbols).source);

    render(
      <MemoryRouter>
        <StockList />
      </MemoryRouter>,
    );

    const allRows = await screen.findAllByRole('row');
    const bodyRows = allRows.filter((row) => row.hasAttribute('data-symbol'));
    expect(bodyRows).toHaveLength(34);

    const renderedSymbols = new Set(bodyRows.map((row) => row.getAttribute('data-symbol')));
    const expectedSymbols = new Set(universeSymbols.map((def) => def.symbol));
    expect(renderedSymbols).toEqual(expectedSymbols);
  });
});
