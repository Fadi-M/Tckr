/**
 * `StockList.delayed-board.test.tsx` — on the DELAYED stream the page says so above
 * every price it shows: the highlight cards, the board and the detail pane (critique
 * 2026-09-26: first a delayed board price looked pixel-identical to a live one, then
 * the highlight cards sat outside the board's delayed note). Driven by the server's
 * `identity()` only.
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Identity } from '../../data/MarketDataSource.ts';
import { resetStore } from '../../data/store.ts';
import { loadUniverseFixture, makeFakeSource } from './testSupport.ts';

const { mockGetSharedSource } = vi.hoisted(() => ({ mockGetSharedSource: vi.fn() }));
vi.mock('../../data/config.ts', () => ({
  getSharedSource: mockGetSharedSource,
  resolveClientConfig: vi.fn(() => ({
    source: 'simulated' as const,
    gatewayUrl: 'ws://localhost:5000',
    demoUser: 'user-002',
    simulated: { eventsPerSecond: 2000, delayedOffsetMs: 15000, seed: 1 },
  })),
}));

import { StockList } from '../StockList.tsx';

async function renderWithIdentity(identity: Identity | null) {
  const { source } = makeFakeSource(loadUniverseFixture());
  mockGetSharedSource.mockReturnValue({ ...source, identity: () => identity });
  render(
    <MemoryRouter>
      <StockList />
    </MemoryRouter>,
  );
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('StockList delayed-stream banner', () => {
  beforeEach(() => {
    resetStore();
    mockGetSharedSource.mockReset();
  });

  afterEach(cleanup);

  it('states the delay above the highlight cards and the board, simulation included', async () => {
    await renderWithIdentity({ userId: 'user-002', stream: 'DELAYED', sessionId: 's' });

    const banner = screen.getByTestId('delayed-stream-banner');
    expect(banner.textContent).toContain('Delayed prices · 15s behind');
    expect(banner.textContent).toContain('Every price on this page is 15s behind the exchange');
    expect(banner.textContent).toContain('simulated');
    // It comes before every price on the page: the first highlight card and the board.
    const firstPrice = document.querySelector('button[aria-label], table');
    expect(firstPrice).not.toBeNull();
    expect(banner.compareDocumentPosition(firstPrice!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows no note on the LIVE stream', async () => {
    await renderWithIdentity({ userId: 'user-001', stream: 'LIVE', sessionId: 's' });
    expect(screen.queryByTestId('delayed-stream-banner')).toBeNull();
  });

  it('shows no note before the server has said which stream this is', async () => {
    await renderWithIdentity(null);
    expect(screen.queryByTestId('delayed-stream-banner')).toBeNull();
  });
});
