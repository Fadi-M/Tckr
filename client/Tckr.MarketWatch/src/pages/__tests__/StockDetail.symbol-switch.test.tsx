import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { toDecimal } from '../../contracts/decimal.ts';
import type { EntitlementChanged, ErrorMsg, IsoUtc, Tick } from '../../contracts/messages.ts';
import type { Snapshot, SymbolUniverseResponse } from '../../contracts/rest.ts';
import type { ConnectionState, Identity, MarketDataSource } from '../../data/MarketDataSource.ts';
import { resetStore } from '../../data/store.ts';

// Exposes the fake uPlot's constructor calls/instances to the test body, so a symbol
// switch can be shown to destroy the old chart instance and construct a fresh one —
// "the chart is remounted/reset with no COMI point" from the brief. `vi.hoisted` is
// required because `vi.mock` factories are hoisted above ordinary imports/consts.
const { fakeUplotConstructorSpy, fakeUplotInstances } = vi.hoisted(() => {
  return {
    fakeUplotConstructorSpy: vi.fn(),
    fakeUplotInstances: [] as Array<{ destroy: ReturnType<typeof vi.fn> }>,
  };
});

vi.mock('uplot', () => {
  class FakeUPlot {
    setData = vi.fn();
    destroy = vi.fn();
    setSize = vi.fn();
    redraw = vi.fn();
    root = document.createElement('div');
    cursor = { idx: null };
    data: [number[], number[]] = [[], []];
    constructor(...args: unknown[]) {
      fakeUplotConstructorSpy(...args);
      fakeUplotInstances.push(this);
    }
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
      {
        symbol: 'CIB',
        name: 'Commercial International Bank',
        currency: 'EGP',
        tickSize: toDecimal('0.05'),
        lotSize: 100,
        referencePrice: toDecimal('70.00'),
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
  // A single shared spy for both subscribe and unsubscribe, recording call order.
  const callOrder: string[] = [];

  const source: MarketDataSource = {
    connect: vi.fn(() => Promise.resolve()),
    disconnect: vi.fn(),
    subscribe: vi.fn((symbols: readonly string[]) => {
      callOrder.push(`subscribe(${symbols.join(',')})`);
    }),
    unsubscribe: vi.fn((symbols: readonly string[]) => {
      callOrder.push(`unsubscribe(${symbols.join(',')})`);
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

  return { source, callOrder };
}

afterEach(cleanup);

beforeEach(() => {
  resetStore();
  resetSharedSource();
});

describe('StockDetail symbol switch', () => {
  it('unsubscribes the old symbol before subscribing the new one, and resets the chart', async () => {
    const { source, callOrder } = createFakeSource();
    vi.mocked(getSharedSource).mockReturnValue(source);

    const { rerender } = render(
      <MemoryRouter>
        <StockDetail symbol="COMI" />
      </MemoryRouter>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fakeUplotConstructorSpy).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(['subscribe(COMI)']);
    const comiChart = fakeUplotInstances[0];
    expect(comiChart).toBeDefined();

    await act(async () => {
      rerender(
        <MemoryRouter>
          <StockDetail symbol="CIB" />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    // Order asserted via one shared spy log: unsubscribe(COMI) strictly before
    // subscribe(CIB).
    expect(callOrder).toEqual(['subscribe(COMI)', 'unsubscribe(COMI)', 'subscribe(CIB)']);

    // The chart is remounted for the new symbol: the old uPlot instance is destroyed
    // and a fresh one constructed — no COMI point survives into CIB's chart.
    expect(comiChart?.destroy).toHaveBeenCalledTimes(1);
    expect(fakeUplotConstructorSpy).toHaveBeenCalledTimes(2);
  });
});
