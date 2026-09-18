import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { resetStore } from '../../data/store.ts';
import { createFakeSource } from './testSupport.ts';

vi.mock('uplot', () => {
  class FakeUPlot {
    setData = vi.fn();
    destroy = vi.fn();
    setSize = vi.fn();
    redraw = vi.fn();
    root = document.createElement('div');
    cursor = { idx: null };
    data: [number[], number[]] = [[], []];
  }
  return { default: FakeUPlot };
});

vi.mock('../../data/config.ts', () => ({
  getSharedSource: vi.fn(),
  resetSharedSource: vi.fn(),
  resolveClientConfig: vi.fn(() => ({
    source: 'simulated' as const,
    gatewayUrl: 'ws://localhost:5000',
    demoUser: 'user-001',
    simulated: { eventsPerSecond: 2000, delayedOffsetMs: 15000, seed: 1 },
  })),
}));

import { getSharedSource, resetSharedSource } from '../../data/config.ts';
import { StockDetail } from '../StockDetail.tsx';

function createUnknownSymbolFakeSource() {
  return createFakeSource({
    // NOPE is not in the universe: a `MarketDataSource` rejects `getSnapshot` for an
    // unknown symbol, which is what this fake reproduces.
    snapshotImpl: (symbol) => Promise.reject(new Error(`Unknown symbol: ${symbol}`)),
  });
}

afterEach(cleanup);

beforeEach(() => {
  resetStore();
  resetSharedSource();
});

describe('StockDetail unknown symbol', () => {
  it('renders an explicit not-found state with a working link back to / for a symbol outside the universe', async () => {
    const { source } = createUnknownSymbolFakeSource();
    vi.mocked(getSharedSource).mockReturnValue(source);

    render(
      <MemoryRouter initialEntries={['/symbols/NOPE']}>
        <StockDetail symbol="NOPE" />
      </MemoryRouter>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const notFound = screen.getByTestId('stock-detail-not-found');
    expect(notFound.textContent ?? '').toContain('NOPE');

    const backLink = screen.getByRole('link', { name: /back to the list/i });
    expect(backLink.getAttribute('href')).toBe('/');

    // Never a blank page: no crash, and no leftover loading/price UI.
    expect(screen.queryByTestId('stock-detail-loading')).toBeNull();
    expect(screen.queryByTestId('stock-detail-price')).toBeNull();
  });
});
