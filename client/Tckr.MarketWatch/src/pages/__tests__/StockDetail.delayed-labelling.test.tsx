import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { IsoUtc } from '../../contracts/messages.ts';
import { resetStore } from '../../data/store.ts';
import { createFakeSource, snapshotFixture } from './testSupport.ts';

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
    demoUser: 'user-002',
    simulated: { eventsPerSecond: 2000, delayedOffsetMs: 15000, seed: 1 },
  })),
}));

import { getSharedSource, resetSharedSource } from '../../data/config.ts';
import { StockDetail } from '../StockDetail.tsx';

// The exchange time carried by the DELAYED snapshot — well behind "now" (client-
// contract.md: a DELAYED snapshot/tick still carries its *original* exchange time).
const DELAYED_EXCHANGE_TIME = '2026-09-12T10:15:00.000Z' as IsoUtc;

function createDelayedFakeSource() {
  return createFakeSource({
    identity: { userId: 'user-002', stream: 'DELAYED', sessionId: 'sess-2' },
    snapshotImpl: (symbol) =>
      Promise.resolve(
        snapshotFixture({ symbol, stream: 'DELAYED', exchangeTimestamp: DELAYED_EXCHANGE_TIME, snapshotAge: 15000 }),
      ),
  });
}

afterEach(cleanup);

beforeEach(() => {
  resetStore();
  resetSharedSource();
});

describe('StockDetail DELAYED labelling', () => {
  it('shows the exchange time (not local receipt time) and states the DELAYED simulation-artifact context', async () => {
    const { source } = createDelayedFakeSource();
    vi.mocked(getSharedSource).mockReturnValue(source);

    render(
      <MemoryRouter>
        <StockDetail symbol="COMI" />
      </MemoryRouter>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(source.identity()?.stream).toBe('DELAYED');

    const asOf = screen.getByTestId('stock-detail-asof');
    // The exchange timestamp (2026-09-12T10:15:00Z), not "now" — this is the whole
    // point of the DELAYED test: it must reflect the event's own time, never local
    // receipt time. Displayed in Cairo market time, not raw UTC (see
    // StockDetail.tsx's `formatExchangeTime`) — 2026-09-12 falls within Egypt's DST
    // window, so 10:15:00 UTC renders as 13:15:00 Cairo (UTC+3).
    expect(asOf.textContent).toContain('13:15:00');
    // The DELAYED context — and that it is a simulation artifact — must be stated on
    // screen, not just implied by a badge colour.
    expect(asOf.textContent).toContain('DELAYED');
    expect(asOf.textContent?.toLowerCase()).toContain('simulat');
  });
});
