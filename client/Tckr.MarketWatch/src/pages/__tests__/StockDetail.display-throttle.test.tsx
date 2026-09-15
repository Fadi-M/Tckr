/**
 * `StockDetail.display-throttle.test.tsx` — "Tckr First Run" design pass follow-up.
 * `StockDetail` reads `source.on.tick` directly, uncoalesced (module doc in
 * `../StockDetail.tsx`) — a hot symbol can burst far more ticks/sec than a human can
 * read as discrete price changes. This asserts the fix: once the page is `ready`, a
 * burst of ticks inside one `DISPLAY_REFRESH_INTERVAL_MS` window paints at most twice
 * (the leading tick, then one trailing catch-up), and the value shown after the window
 * is the *latest* tick, never one from the middle of the burst.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { toDecimal } from '../../contracts/decimal.ts';
import type { EntitlementChanged, ErrorMsg, IsoUtc, Tick } from '../../contracts/messages.ts';
import type { Snapshot, SymbolUniverseResponse } from '../../contracts/rest.ts';
import type { ConnectionState, Identity, MarketDataSource } from '../../data/MarketDataSource.ts';
import { resetStore } from '../../data/store.ts';
import { DISPLAY_REFRESH_INTERVAL_MS } from '../../display/throttle.ts';

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

function snapshotFixture(): Snapshot {
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
  };
}

function tickFixture(price: string, seq: number): Tick {
  return {
    v: 1,
    type: 'tick',
    s: 'COMI',
    p: toDecimal(price),
    q: 10,
    k: 'TRADE',
    t: `2026-09-12T10:30:05.${String(seq).padStart(3, '0')}Z` as IsoUtc,
    id: `evt-00000000000000${seq}`,
    st: 'LIVE',
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

  const source: MarketDataSource = {
    connect: vi.fn(() => Promise.resolve()),
    disconnect: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    getUniverse: vi.fn(() => Promise.resolve(universeFixture())),
    getSnapshot: vi.fn(() => Promise.resolve(snapshotFixture())),
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

  return { source, emitTick: (t: Tick) => tickHandlers.forEach((h) => h(t)) };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

beforeEach(() => {
  resetStore();
  resetSharedSource();
});

describe('StockDetail display refresh throttling', () => {
  it('paints a burst of live ticks at most twice per window, ending on the latest tick', async () => {
    vi.useFakeTimers();
    const { source, emitTick } = createFakeSource();
    vi.mocked(getSharedSource).mockReturnValue(source);

    render(
      <MemoryRouter>
        <StockDetail symbol="COMI" />
      </MemoryRouter>,
    );

    // Reach `ready` (snapshot resolves synchronously in this fixture).
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId('stock-detail-price').textContent).toContain('84.50');

    vi.mocked(PriceCell).mockClear();

    // A burst well within one throttle window — simulating a hot symbol's tape.
    const burstSize = 40;
    act(() => {
      for (let i = 0; i < burstSize; i += 1) {
        emitTick(tickFixture((85 + i * 0.01).toFixed(2), i));
      }
    });

    // Leading tick painted immediately; the other 39 are suppressed until the window
    // elapses — never one render per tick.
    const pricesAfterLeading = vi
      .mocked(PriceCell)
      .mock.calls.map((call) => String(call[0]?.value ?? ''))
      .filter((v) => v.startsWith('85.'));
    expect(pricesAfterLeading.length).toBeLessThan(burstSize);
    expect(screen.getByTestId('stock-detail-price').textContent).toContain('85.00');

    // Flush the trailing edge: exactly one more paint, showing the *last* tick of the
    // burst (85 + 39*0.01 = 85.39), never a mid-burst value.
    await act(async () => {
      vi.advanceTimersByTime(DISPLAY_REFRESH_INTERVAL_MS);
    });
    expect(screen.getByTestId('stock-detail-price').textContent).toContain('85.39');
  });
});
