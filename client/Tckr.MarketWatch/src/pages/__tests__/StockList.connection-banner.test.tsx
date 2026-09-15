/**
 * `StockList.connection-banner.test.tsx` — "Tckr First Run" design pass. Covers the
 * new `ConnectionBanner`/`useConnectionBanner` addition in `../StockList.tsx`: an
 * independent observer of the shared `MarketDataSource` (same pattern as
 * `ConnectionStatus`/`StreamBadge`) that surfaces a "Retry now"/"Reconnect" banner while
 * `reconnecting`/`closed`, and is absent for `connecting`/`connected`.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { toDecimal } from '../../contracts/decimal.ts';
import { CloseCode } from '../../contracts/closeCodes.ts';
import type { ConnectionState } from '../../data/MarketDataSource.ts';
import type { IsoUtc } from '../../contracts/messages.ts';
import type { SymbolDefinition, SymbolUniverseResponse } from '../../contracts/rest.ts';
import type { MarketDataSource } from '../../data/MarketDataSource.ts';
import { resetStore } from '../../data/store.ts';

const { mockGetSharedSource } = vi.hoisted(() => ({ mockGetSharedSource: vi.fn() }));
vi.mock('../../data/config.ts', () => ({ getSharedSource: mockGetSharedSource }));

import { StockList } from '../StockList.tsx';

const here = dirname(fileURLToPath(import.meta.url));

function loadUniverseFixture(): readonly SymbolDefinition[] {
  const raw = readFileSync(resolve(here, '../../../public/symbols.json'), 'utf-8');
  const parsed = JSON.parse(raw) as {
    symbols: readonly {
      symbol: string;
      name: string;
      referencePrice: number;
      tickSize: number;
      lotSize: number;
    }[];
  };
  return parsed.symbols.map((s) => ({
    symbol: s.symbol,
    name: s.name,
    currency: 'EGP',
    tickSize: toDecimal(s.tickSize.toString()),
    lotSize: s.lotSize,
    referencePrice: toDecimal(s.referencePrice.toString()),
  }));
}

function makeFakeSource(
  symbols: readonly SymbolDefinition[],
  initialState: ConnectionState,
): { source: MarketDataSource; emitStatus: (state: ConnectionState) => void; connect: ReturnType<typeof vi.fn> } {
  const statusHandlers = new Set<(s: ConnectionState) => void>();
  const connect = vi.fn(() => Promise.resolve());
  const source: MarketDataSource = {
    connect,
    disconnect: () => {},
    subscribe: () => {},
    unsubscribe: () => {},
    getUniverse: () =>
      Promise.resolve<SymbolUniverseResponse>({
        v: 1,
        asOf: new Date().toISOString() as IsoUtc,
        simulated: true,
        symbols,
      }),
    getSnapshot: () => Promise.reject(new Error('not used')),
    on: {
      tick: () => () => {},
      snapshot: () => () => {},
      status: (h) => {
        statusHandlers.add(h);
        return () => statusHandlers.delete(h);
      },
      error: () => () => {},
      entitlement: () => () => {},
    },
    identity: () => null,
    connectionState: () => initialState,
  };
  return { source, emitStatus: (state) => statusHandlers.forEach((h) => h(state)), connect };
}

async function renderList(initialState: ConnectionState) {
  const universeSymbols = loadUniverseFixture();
  const { source, connect } = makeFakeSource(universeSymbols, initialState);
  mockGetSharedSource.mockReturnValue(source);

  render(
    <MemoryRouter>
      <StockList />
    </MemoryRouter>,
  );

  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  return { connect };
}

describe('StockList connection banner', () => {
  beforeEach(() => {
    resetStore();
    mockGetSharedSource.mockReset();
  });

  afterEach(cleanup);

  it('shows nothing while connected', async () => {
    await renderList({ kind: 'connected', since: Date.now() });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a retry banner with a countdown while reconnecting, and Retry now calls connect()', async () => {
    const { connect } = await renderList({ kind: 'reconnecting', attempt: 2, nextRetryMs: 4000 });

    const banner = screen.getByRole('alert');
    expect(banner.textContent).toContain('retrying in');
    expect(banner.textContent).toContain('Attempt 2');

    fireEvent.click(screen.getByRole('button', { name: /retry now/i }));
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('shows a disconnected banner while closed, and Reconnect calls connect()', async () => {
    const { connect } = await renderList({ kind: 'closed', code: CloseCode.Normal, reason: 'server shutdown' });

    const banner = screen.getByRole('alert');
    expect(banner.textContent).toContain('Disconnected');

    fireEvent.click(screen.getByRole('button', { name: /^reconnect$/i }));
    expect(connect).toHaveBeenCalledTimes(1);
  });
});
