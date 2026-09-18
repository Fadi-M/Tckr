/**
 * `StockList.pre-tick.test.tsx` — task 04. Asserts: before any tick, each row shows its
 * `referencePrice` from the universe in the muted style — never a spinner, never
 * `0.00`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { format } from '../../contracts/decimal.ts';
import { resetStore } from '../../data/store.ts';
import { loadUniverseFixture, makeFakeSource } from './testSupport.ts';

const { mockGetSharedSource } = vi.hoisted(() => ({ mockGetSharedSource: vi.fn() }));
vi.mock('../../data/config.ts', () => ({ getSharedSource: mockGetSharedSource }));

import { StockList } from '../StockList.tsx';

describe('StockList pre-tick display', () => {
  beforeEach(() => {
    resetStore();
    mockGetSharedSource.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows each symbol’s referencePrice, muted, and never "0.00", before any tick', async () => {
    const universeSymbols = loadUniverseFixture();
    mockGetSharedSource.mockReturnValue(makeFakeSource(universeSymbols).source);

    render(
      <MemoryRouter>
        <StockList />
      </MemoryRouter>,
    );

    const rows = await screen.findAllByRole('row');
    const bodyRows = rows.filter((row) => row.hasAttribute('data-symbol'));
    expect(bodyRows).toHaveLength(34);

    for (const def of universeSymbols) {
      const row = bodyRows.find((r) => r.getAttribute('data-symbol') === def.symbol);
      expect(row).toBeTruthy();
      if (!row) continue;

      const priceCell = row.querySelector('.tckr-price-cell--muted');
      expect(priceCell, `${def.symbol} should render a muted price cell before its first tick`).toBeTruthy();

      const text = priceCell?.textContent ?? '';
      expect(text).not.toBe('0.00');
      expect(text).not.toBe('');

      // The displayed text must be the formatted referencePrice, not an arbitrary
      // placeholder — decimals are picked from `max(referencePrice dp, tickSize dp)`,
      // matching the live-tick precision (`StockList.tsx`'s `decimalPlacesOf`).
      const dot = (s: string) => (s.includes('.') ? s.length - s.indexOf('.') - 1 : 0);
      const decimals = Math.max(dot(def.referencePrice), dot(def.tickSize));
      expect(text).toBe(format(def.referencePrice, { decimals }));
    }

    // No per-row spinner/loading affordance.
    expect(screen.queryAllByRole('progressbar')).toHaveLength(0);
  });
});
