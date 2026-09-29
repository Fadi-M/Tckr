/**
 * A symbol outside the universe (a stale link, a typo in the URL) gets an explicit
 * not-found view with a way back and a tab title that says so: never a blank page or a
 * stuck loading state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { resetStore } from '../../data/store.ts';
import { createFakeSource, renderDetail } from './testSupport.tsx';

vi.mock('uplot', async () => ({
  default: (await import('../../chart/__tests__/uplotTestDouble.ts')).FakeUPlot,
}));
vi.mock('../../data/config.ts');

import { StockDetail } from '../StockDetail.tsx';

beforeEach(resetStore);
afterEach(cleanup);

describe('StockDetail unknown symbol', () => {
  it('renders not-found with a link back to the board, and names it in the tab title', async () => {
    // A real source rejects `getSnapshot` for a symbol outside the universe.
    const { source } = createFakeSource({
      snapshotImpl: (symbol) => Promise.reject(new Error(`Unknown symbol: ${symbol}`)),
    });
    await renderDetail(<StockDetail symbol="NOPE" />, source, { path: '/EGX/symbols/NOPE' });

    expect(screen.getByTestId('stock-detail-not-found').textContent).toContain('NOPE');
    expect(screen.getByRole('link', { name: /all instruments/i }).getAttribute('href')).toBe('/');
    expect(screen.queryByTestId('stock-detail-loading')).toBeNull();
    expect(screen.queryByTestId('stock-detail-price')).toBeNull();
    expect(document.title).toBe('Unknown symbol NOPE · Tckr MarketWatch');
  });
});
