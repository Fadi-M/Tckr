/**
 * `StockList.connection-banner.test.tsx` — "Tckr First Run" design pass. Covers the
 * new `ConnectionBanner`/`useConnectionBanner` addition in `../StockList.tsx`: an
 * independent observer of the shared `MarketDataSource` (same pattern as
 * `ConnectionStatus`/`StreamBadge`) that surfaces a "Retry now"/"Reconnect" banner while
 * `reconnecting`/`closed`, and is absent for `connecting`/`connected`.
 *
 * Code-review fix (PR #3): the banner's buttons now call `reconnectSharedSource()`
 * (`src/data/config.ts`), not a bare `getSharedSource().connect()` — see that module's
 * doc comment for why a bare `.connect()` is not safe to expose to call sites. The mock
 * below reimplements `reconnectSharedSource()`'s real disconnect-then-connect shape
 * against the mocked source, so these tests assert the same contract
 * `config.reconnect-shared-source.test.ts` asserts against the real `SimulatedSource`.
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CloseCode } from '../../contracts/closeCodes.ts';
import type { ConnectionState } from '../../data/MarketDataSource.ts';
import { resetStore } from '../../data/store.ts';
import { loadUniverseFixture, makeFakeSource } from './testSupport.ts';

const { mockGetSharedSource, mockReconnectSharedSource } = vi.hoisted(() => ({
  mockGetSharedSource: vi.fn(),
  mockReconnectSharedSource: vi.fn(),
}));
vi.mock('../../data/config.ts', () => ({
  getSharedSource: mockGetSharedSource,
  reconnectSharedSource: mockReconnectSharedSource,
}));

import { StockList } from '../StockList.tsx';

async function renderList(initialState: ConnectionState) {
  const universeSymbols = loadUniverseFixture();
  const { source, connect, disconnect } = makeFakeSource(universeSymbols, { connectionState: initialState });
  mockGetSharedSource.mockReturnValue(source);
  // Mirrors `reconnectSharedSource()`'s real shape (`config.ts`): disconnect, then
  // connect, against whichever source `getSharedSource()` currently returns.
  mockReconnectSharedSource.mockImplementation(() => {
    source.disconnect();
    void source.connect();
  });

  render(
    <MemoryRouter>
      <StockList />
    </MemoryRouter>,
  );

  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  return { connect, disconnect };
}

describe('StockList connection banner', () => {
  beforeEach(() => {
    resetStore();
    mockGetSharedSource.mockReset();
    mockReconnectSharedSource.mockReset();
  });

  afterEach(cleanup);

  it('shows nothing while connected', async () => {
    await renderList({ kind: 'connected', since: Date.now() });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a retry banner with a countdown while reconnecting, and Retry now reconnects via reconnectSharedSource()', async () => {
    const { connect, disconnect } = await renderList({ kind: 'reconnecting', attempt: 2, nextRetryMs: 4000 });

    const banner = screen.getByRole('alert');
    expect(banner.textContent).toContain('retrying in');
    expect(banner.textContent).toContain('Attempt 2');

    fireEvent.click(screen.getByRole('button', { name: /retry now/i }));
    expect(mockReconnectSharedSource).toHaveBeenCalledTimes(1);
    // Never a bare `.connect()` with no matching `.disconnect()` — see
    // `config.ts`'s doc comment on why that is not safe on every
    // `MarketDataSource` implementation.
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('shows a disconnected banner while closed, and Reconnect reconnects via reconnectSharedSource()', async () => {
    const { connect, disconnect } = await renderList({ kind: 'closed', code: CloseCode.Normal, reason: 'server shutdown' });

    const banner = screen.getByRole('alert');
    expect(banner.textContent).toContain('Disconnected');

    fireEvent.click(screen.getByRole('button', { name: /^reconnect$/i }));
    expect(mockReconnectSharedSource).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledTimes(1);
  });
});
