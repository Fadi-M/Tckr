import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { toDecimal } from '../../contracts/decimal.ts';
import type { EntitlementChanged, ErrorMsg, IsoUtc, Tick } from '../../contracts/messages.ts';
import type { Snapshot, SymbolUniverseResponse } from '../../contracts/rest.ts';
import type { ConnectionState, Identity, MarketDataSource } from '../../data/MarketDataSource.ts';
import { resetStore } from '../../data/store.ts';

// jsdom has no canvas; PriceChart's real uPlot cannot construct there. Fake it, same
// technique task 05's own chart tests use (src/chart/__tests__/uplotTestDouble.ts).
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

// Spies on the real PriceCell so we can observe, in order, every value it was asked
// to render — the only reliable way to prove a DOM ordering claim when both renders
// settle within the same React `act()` flush.
vi.mock('../../components/PriceCell.tsx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../components/PriceCell.tsx')>();
  return {
    ...actual,
    PriceCell: vi.fn((props: Parameters<typeof actual.PriceCell>[0]) => <actual.PriceCell {...props} />),
  };
});

import { getSharedSource, resetSharedSource } from '../../data/config.ts';
import { PriceCell } from '../../components/PriceCell.tsx';
import { StockDetail } from '../StockDetail.tsx';

function snapshotFixture(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    v: 1,
    symbol: 'COMI',
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
    ...overrides,
  };
}

function tickFixture(overrides: Partial<Tick> = {}): Tick {
  return {
    v: 1,
    type: 'tick',
    s: 'COMI',
    p: toDecimal('85.75'),
    q: 100,
    k: 'TRADE',
    t: '2026-09-12T10:30:05.000Z' as IsoUtc,
    id: 'evt-000000000000002',
    st: 'LIVE',
    ...overrides,
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

interface FakeSourceOptions {
  readonly identity?: Identity | null;
  readonly snapshotImpl?: (symbol: string) => Promise<Snapshot>;
}

function createFakeSource(options: FakeSourceOptions = {}) {
  const tickHandlers = new Set<(t: Tick) => void>();
  const snapshotHandlers = new Set<(s: Snapshot) => void>();
  const statusHandlers = new Set<(s: ConnectionState) => void>();
  const errorHandlers = new Set<(e: ErrorMsg) => void>();
  const entitlementHandlers = new Set<(e: EntitlementChanged) => void>();
  let identityValue: Identity | null = options.identity ?? { userId: 'user-001', stream: 'LIVE', sessionId: 'sess-1' };
  const defaultSnapshotImpl = (symbol: string) => Promise.resolve(snapshotFixture({ symbol }));

  const source: MarketDataSource = {
    connect: vi.fn(() => Promise.resolve()),
    disconnect: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    getUniverse: vi.fn(() => Promise.resolve(universeFixture())),
    getSnapshot: vi.fn((symbol: string) => (options.snapshotImpl ?? defaultSnapshotImpl)(symbol)),
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

  return {
    source,
    emitTick: (t: Tick) => tickHandlers.forEach((h) => h(t)),
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

beforeEach(() => {
  resetStore();
  resetSharedSource();
});

describe('StockDetail snapshot-then-stream ordering', () => {
  it('renders the snapshot before a tick that arrives while it is still in flight, and ends on the tick (newer wins)', async () => {
    vi.useFakeTimers();
    const { source, emitTick } = createFakeSource({
      snapshotImpl: (symbol) =>
        new Promise((resolve) => {
          setTimeout(() => resolve(snapshotFixture({ symbol })), 50);
        }),
    });
    vi.mocked(getSharedSource).mockReturnValue(source);

    render(
      <MemoryRouter>
        <StockDetail symbol="COMI" />
      </MemoryRouter>,
    );

    // Snapshot still in flight — nothing painted yet.
    expect(screen.getByTestId('stock-detail-loading')).toBeTruthy();
    expect(screen.queryByTestId('stock-detail-price')).toBeNull();

    // A tick "arrives" at 10ms — well before the 50ms snapshot resolves.
    act(() => {
      vi.advanceTimersByTime(10);
    });
    act(() => {
      emitTick(tickFixture());
    });

    // The tick must be held, not painted, until the snapshot has rendered.
    expect(screen.getByTestId('stock-detail-loading')).toBeTruthy();
    expect(screen.queryByTestId('stock-detail-price')).toBeNull();

    // Advance past the snapshot's resolution and flush the resulting effect cascade.
    await act(async () => {
      vi.advanceTimersByTime(60);
      await Promise.resolve();
      await Promise.resolve();
    });

    // Final state is the tick's price (it is chronologically newer).
    expect(screen.getByTestId('stock-detail-price').textContent).toContain('85.75');

    // Ordering: the snapshot's price must have been rendered (via PriceCell) before
    // the tick's price, not merely that the final state happens to be correct.
    const priceCellValues: string[] = vi
      .mocked(PriceCell)
      .mock.calls.map((call) => String(call[0]?.value ?? ''))
      .filter((value) => value === '84.50' || value === '85.75');
    const snapshotIndex = priceCellValues.indexOf('84.50');
    const tickIndex = priceCellValues.indexOf('85.75');
    expect(snapshotIndex).toBeGreaterThanOrEqual(0);
    expect(tickIndex).toBeGreaterThan(snapshotIndex);
  });
});
