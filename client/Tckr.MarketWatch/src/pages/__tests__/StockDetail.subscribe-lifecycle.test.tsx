import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
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

function snapshotFixture(symbol: string): Snapshot {
  return {
    v: 1,
    symbol,
    stream: 'LIVE',
    price: toDecimal('84.50'),
    change: toDecimal('0.13'),
    changePercent: '+0.15',
    open: toDecimal('84.37'),
    high: toDecimal('84.60'),
    low: toDecimal('84.10'),
    volume: 216637,
    lastEventId: 'evt-000000000000001',
    exchangeTimestamp: '2026-09-12T10:30:00.000Z' as IsoUtc,
    snapshotAge: 0,
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
  const identityValue: Identity = { userId: 'user-001', stream: 'LIVE', sessionId: 'sess-1' };
  const callLog: Array<{ op: 'subscribe' | 'unsubscribe'; symbols: readonly string[] }> = [];

  const source: MarketDataSource = {
    connect: vi.fn(() => Promise.resolve()),
    disconnect: vi.fn(),
    subscribe: vi.fn((symbols: readonly string[]) => {
      callLog.push({ op: 'subscribe', symbols });
    }),
    unsubscribe: vi.fn((symbols: readonly string[]) => {
      callLog.push({ op: 'unsubscribe', symbols });
    }),
    getUniverse: vi.fn(() => Promise.resolve(universeFixture())),
    getSnapshot: vi.fn((symbol: string) => Promise.resolve(snapshotFixture(symbol))),
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

  return { source, callLog };
}

afterEach(cleanup);

beforeEach(() => {
  resetStore();
  resetSharedSource();
});

describe('StockDetail subscribe/unsubscribe lifecycle', () => {
  it('subscribes once on mount and unsubscribes once on unmount (no StrictMode)', () => {
    const { source, callLog } = createFakeSource();
    vi.mocked(getSharedSource).mockReturnValue(source);

    const { unmount } = render(
      <MemoryRouter>
        <StockDetail symbol="COMI" />
      </MemoryRouter>,
    );

    expect(source.subscribe).toHaveBeenCalledTimes(1);
    expect(source.subscribe).toHaveBeenCalledWith(['COMI']);
    expect(source.unsubscribe).not.toHaveBeenCalled();

    unmount();

    expect(source.unsubscribe).toHaveBeenCalledTimes(1);
    expect(source.unsubscribe).toHaveBeenCalledWith(['COMI']);
    // eslint-disable-next-line no-console
    console.info('[StockDetail.subscribe-lifecycle] plain mount call log:', JSON.stringify(callLog));
  });

  it('nets exactly one active subscription under StrictMode double-invocation', () => {
    const { source, callLog } = createFakeSource();
    vi.mocked(getSharedSource).mockReturnValue(source);

    render(
      <StrictMode>
        <MemoryRouter>
          <StockDetail symbol="COMI" />
        </MemoryRouter>
      </StrictMode>,
    );

    expect(screen.getByTestId('stock-detail-loading')).toBeTruthy();

    const net = callLog.reduce((count, entry) => count + (entry.op === 'subscribe' ? 1 : -1), 0);
    expect(net).toBe(1);
    // eslint-disable-next-line no-console
    console.info('[StockDetail.subscribe-lifecycle] StrictMode call log:', JSON.stringify(callLog), 'net =', net);
  });
});
