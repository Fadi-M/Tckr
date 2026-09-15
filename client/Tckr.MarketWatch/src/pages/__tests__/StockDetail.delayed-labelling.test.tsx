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
    demoUser: 'user-002',
    simulated: { eventsPerSecond: 2000, delayedOffsetMs: 15000, seed: 1 },
  })),
}));

import { getSharedSource, resetSharedSource } from '../../data/config.ts';
import { StockDetail } from '../StockDetail.tsx';

// The exchange time carried by the DELAYED snapshot — well behind "now" (client-
// contract.md: a DELAYED snapshot/tick still carries its *original* exchange time).
const DELAYED_EXCHANGE_TIME = '2026-09-12T10:15:00.000Z' as IsoUtc;

function delayedSnapshotFixture(symbol: string): Snapshot {
  return {
    v: 1,
    symbol,
    stream: 'DELAYED',
    price: toDecimal('84.50'),
    change: toDecimal('0.13'),
    changePercent: '+0.15',
    open: toDecimal('84.37'),
    high: toDecimal('84.60'),
    low: toDecimal('84.10'),
    volume: 216637,
    lastEventId: 'evt-000000000000001',
    exchangeTimestamp: DELAYED_EXCHANGE_TIME,
    snapshotAge: 15000,
    simulated: true,
  };
}

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
  const identityValue: Identity = { userId: 'user-002', stream: 'DELAYED', sessionId: 'sess-2' };

  const source: MarketDataSource = {
    connect: vi.fn(() => Promise.resolve()),
    disconnect: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    getUniverse: vi.fn(() => Promise.resolve(universeFixture())),
    getSnapshot: vi.fn((symbol: string) => Promise.resolve(delayedSnapshotFixture(symbol))),
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

describe('StockDetail DELAYED labelling', () => {
  it('shows the exchange time (not local receipt time) and states the DELAYED simulation-artifact context', async () => {
    const { source } = createFakeSource();
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
    // The exchange timestamp (10:15:00), not "now" — this is the whole point of the
    // DELAYED test: it must reflect the event's own time, never local receipt time.
    expect(asOf.textContent).toContain('10:15:00');
    // The DELAYED context — and that it is a simulation artifact — must be stated on
    // screen, not just implied by a badge colour.
    expect(asOf.textContent).toContain('DELAYED');
    expect(asOf.textContent?.toLowerCase()).toContain('simulat');
  });
});
