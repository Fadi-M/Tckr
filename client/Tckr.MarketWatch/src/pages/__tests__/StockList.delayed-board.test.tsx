/**
 * `StockList.delayed-board.test.tsx` — on the DELAYED stream the page says so above
 * every price it shows: the highlight cards, the board and the detail pane (critique
 * 2026-09-26: first a delayed board price looked pixel-identical to a live one, then
 * the highlight cards sat outside the board's delayed note). Driven by the server's
 * `identity()` only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import type { Identity } from '../../data/MarketDataSource.ts';
import { resetStore } from '../../data/store.ts';
import { loadUniverseFixture, makeFakeSource, renderBoard } from './testSupport.tsx';

vi.mock('../../data/config.ts');

async function renderWithIdentity(identity: Identity | null) {
  const { source } = makeFakeSource(loadUniverseFixture());
  await renderBoard({ source: { ...source, identity: () => identity } });
}

describe('StockList delayed-stream banner', () => {
  beforeEach(resetStore);

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
    expect(
      banner.compareDocumentPosition(firstPrice!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it.each([
    ['on the LIVE stream', { userId: 'user-001', stream: 'LIVE', sessionId: 's' } as const],
    ['before the server has said which stream this is', null],
  ])('shows no note %s', async (_when, identity) => {
    await renderWithIdentity(identity);
    expect(screen.queryByTestId('delayed-stream-banner')).toBeNull();
  });
});
