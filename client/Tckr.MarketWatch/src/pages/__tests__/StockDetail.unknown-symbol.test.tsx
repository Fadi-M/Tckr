import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { toDecimal } from '../../contracts/decimal.ts';
import type { EntitlementChanged, ErrorMsg, IsoUtc, Tick } from '../../contracts/messages.ts';
import type { Snapshot, SymbolUniverseResponse } from '../../contracts/rest.ts';
import type { ConnectionState, Identity, MarketDataSource } from '../../data/MarketDataSource.ts';
import { resetStore } from '../../data/store.ts';

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

function universeFixture(): SymbolUniverseResponse {
  return {
    v: 1,
    asOf: '2026-09-12T09:00:00.000Z' as IsoUtc,
    simulated: true,
    symbols: [
      {
        symbol: 'COMI',
        name: 'Commercial International Holding',
        currency: 'EGP',
        tickSize: toDecimal('0.05'),
        lotSize: 100,
        referencePrice: toDecimal('85.10'),
      },
    ],
  };
}

function createFakeSource() {
  const tickHandlers = new Set<(t: Tick) => void>();
  const snapshotHandlers = new Set<(s: Snapshot) => void>();
  const statusHandlers = new Set<(s: ConnectionState) => void>();
  const errorHandlers = new Set<(e: ErrorMsg) => void>();
  const entitlementHandlers = new Set<(e: EntitlementChanged) => void>();
  const identityValue: Identity = { userId: 'user-001', stream: 'LIVE', sessionId: 'sess-1' };

  const source: MarketDataSource = {
    connect: vi.fn(() => Promise.resolve()),
    disconnect: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    getUniverse: vi.fn(() => Promise.resolve(universeFixture())),
    // NOPE is not in the universe: a `MarketDataSource` rejects `getSnapshot` for an
    // unknown symbol, which is what this fake reproduces.
    getSnapshot: vi.fn((symbol: string) => Promise.reject(new Error(`Unknown symbol: ${symbol}`))),
    on: {
      tick: (h) => {
        tickHandlers.add(h);
        return () => tickHandlers.delete(h);
      },
      snapshot: (h) => {
        snapshotHandlers.add(h);
        return () => snapshotHandlers.delete(h);
      },
      status: (h) => {
        statusHandlers.add(h);
        return () => statusHandlers.delete(h);
      },
      error: (h) => {
        errorHandlers.add(h);
        return () => errorHandlers.delete(h);
      },
      entitlement: (h) => {
        entitlementHandlers.add(h);
        return () => entitlementHandlers.delete(h);
      },
    },
    identity: () => identityValue,
  };

  return { source };
}

afterEach(cleanup);

beforeEach(() => {
  resetStore();
  resetSharedSource();
});

describe('StockDetail unknown symbol', () => {
  it('renders an explicit not-found state with a working link back to / for a symbol outside the universe', async () => {
    const { source } = createFakeSource();
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
