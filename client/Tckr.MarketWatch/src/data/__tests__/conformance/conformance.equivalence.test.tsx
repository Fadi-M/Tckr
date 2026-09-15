/**
 * Layer 2 — source equivalence (08-gateway-source-conformance.md). Runs the *same*
 * page-level assertions (`pageAssertions.tsx`) against `StockList`/`StockDetail` (tasks
 * 04/06, imported unmodified) wired to each of `SimulatedSource` and `TckrGatewaySource`
 * in turn, via one `describe.each`. This is the test that substantiates the phase's
 * plug-and-play claim: if a page needed to know which source it was talking to, one of
 * these two branches would fail.
 *
 * `src/data/config.ts`'s `createMarketDataSource`/`getSharedSource` are mocked *for this
 * test file only* (`vi.mock`, scoped to this module) to return whichever concrete
 * source the current `describe.each` branch built — the pages under test call whichever
 * of the two they call exactly as written, unaware anything is different. This does not
 * touch `config.ts` on disk (owned by task 02); it is exactly the "construct sources
 * directly" escape hatch `config.ts`'s own module doc reserves for this suite.
 *
 * Per-source driving is necessarily different (a `SimulatedSource` random walk has no
 * seam to inject an exact tick; a `TckrGatewaySource` is driven through a
 * `FakeWebSocket`) — see `pageAssertions.tsx`'s header for why the assertions are
 * expressed as invariants rather than exact values where the two sources cannot agree
 * on more than that.
 */
import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FIXTURES } from '../../../contracts/fixtures/index.ts';
import { resetStore } from '../../store.ts';
import { SimulatedSource } from '../../SimulatedSource.ts';
import { TckrGatewaySource } from '../../TckrGatewaySource.ts';
import { FakeWebSocket } from '../../../test-support/FakeWebSocket.ts';
import type { MarketDataSource } from '../../MarketDataSource.ts';
import { baseGatewayConfig, jsonResponse } from './gatewayHarness.ts';
import {
  expectDetailLoading,
  expectDetailNotFound,
  expectDetailShowsAPrice,
  expectListRowFor,
} from './pageAssertions.tsx';

// jsdom has no canvas; PriceChart's real uPlot cannot construct there — same technique
// task 05's own chart tests and task 06's StockDetail tests use.
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

// StockList/StockDetail (04/06) call `getSharedSource()` — the shared-singleton
// accessor config.ts's own doc assigns "connection ownership" to (it calls `connect()`
// itself; call sites must not). `mockGetSharedSource` stands in for it here, and each
// rig below calls `connect()` on its own source itself (harmlessly redundant with
// whatever the real `getSharedSource()` would also do), so this suite works whichever
// of the two a page calls.
const { mockCreateMarketDataSource, mockGetSharedSource, mockResolveClientConfig, mockResetSharedSource } =
  vi.hoisted(() => ({
    mockCreateMarketDataSource: vi.fn(),
    mockGetSharedSource: vi.fn(),
    mockResolveClientConfig: vi.fn(() => ({
      source: 'simulated' as const,
      gatewayUrl: 'ws://localhost:5000',
      demoUser: 'user-001',
      simulated: { eventsPerSecond: 4000, delayedOffsetMs: 15000, seed: 1 },
    })),
    mockResetSharedSource: vi.fn(),
  }));
vi.mock('../../config.ts', () => ({
  createMarketDataSource: mockCreateMarketDataSource,
  getSharedSource: mockGetSharedSource,
  resolveClientConfig: mockResolveClientConfig,
  resetSharedSource: mockResetSharedSource,
}));

import { StockList } from '../../../pages/StockList.tsx';
import { StockDetail } from '../../../pages/StockDetail.tsx';

interface SourceRig {
  readonly source: MarketDataSource;
  /** Lets the "known symbol" scenario advance whatever clock that source needs so its
   * snapshot/first tick actually arrives. A no-op for the gateway, which is driven by
   * explicit fixture emission instead of time passing. */
  settle(): Promise<void>;
  /** Delivers one more live update for `symbol` after the initial snapshot, so the
   * "still shows a price after more data" invariant is exercised, not just the
   * snapshot alone. */
  deliverFollowUpTick(symbol: string): Promise<void>;
}

function buildSimulatedRig(): SourceRig {
  const source = new SimulatedSource({
    eventsPerSecond: 4000,
    delayedOffsetMs: 15000,
    seed: 1,
    demoUser: 'user-001',
  });
  // Mirrors getSharedSource()'s "connection ownership" rule: it connects the source
  // itself, once, before any call site sees it.
  void source.connect();
  return {
    source,
    settle: async () => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
    },
    deliverFollowUpTick: async () => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
    },
  };
}

function buildGatewayRig(): SourceRig {
  const universeBody = FIXTURES['symbols-universe'];
  const snapshotBody = { ...FIXTURES['snapshot-live'].snapshot, symbol: 'COMI' };
  const fetchImpl = vi.fn((url: string) => {
    if (url.endsWith('/symbols/COMI/snapshot')) {
      return Promise.resolve(jsonResponse(snapshotBody));
    }
    if (url.endsWith('/symbols')) {
      return Promise.resolve(jsonResponse(universeBody));
    }
    return Promise.resolve(jsonResponse({ error: 'not found' }, false, 404));
  });
  const source = new TckrGatewaySource(baseGatewayConfig(), {
    createSocket: (url) => new FakeWebSocket(url),
    fetchImpl,
    random: () => 0.5,
  });
  // Mirrors getSharedSource()'s "connection ownership" rule (see buildSimulatedRig).
  // Harmless for the scenarios this rig drives — REST getSnapshot()/getUniverse() do
  // not depend on the socket's handshake — but keeps this rig honest about what a real
  // call site would experience.
  source.connect().catch(() => {});
  return {
    source,
    settle: async () => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(0);
      });
    },
    deliverFollowUpTick: async (symbol: string) => {
      await act(async () => {
        const socket = FakeWebSocket.lastInstance;
        if (!socket) {
          throw new Error('buildGatewayRig: no FakeWebSocket has been constructed yet');
        }
        socket.emit({ ...FIXTURES['tick-trade'], s: symbol, p: '86.00' });
        await vi.advanceTimersByTimeAsync(0);
      });
    },
  };
}

const RIGS: readonly (readonly [string, () => SourceRig])[] = [
  ['simulated', buildSimulatedRig],
  ['gateway', buildGatewayRig],
];

/** Points both `createMarketDataSource()` and `getSharedSource()` at the same rig
 * instance — whichever a page calls (StockList/StockDetail currently call
 * `getSharedSource()`; `createMarketDataSource()` is kept wired too so this suite does
 * not silently stop covering a page that reverts to calling it directly). */
function activateRig(rig: SourceRig): void {
  mockCreateMarketDataSource.mockReturnValue(rig.source);
  mockGetSharedSource.mockReturnValue(rig.source);
}

describe.each(RIGS)('%s source — page equivalence', (_name, buildRig) => {
  beforeEach(() => {
    resetStore();
    mockCreateMarketDataSource.mockReset();
    mockGetSharedSource.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('StockDetail: loading → snapshot paints a price → a later update still shows a price', async () => {
    const rig = buildRig();
    activateRig(rig);

    render(
      <MemoryRouter>
        <StockDetail symbol="COMI" />
      </MemoryRouter>,
    );

    expectDetailLoading();

    await rig.settle();
    expectDetailShowsAPrice();

    await rig.deliverFollowUpTick('COMI');
    expectDetailShowsAPrice();
  });

  it('StockDetail: an unknown symbol renders not-found, never a stuck loading state', async () => {
    const rig = buildRig();
    activateRig(rig);

    render(
      <MemoryRouter>
        <StockDetail symbol="NOPEXX" />
      </MemoryRouter>,
    );

    await rig.settle();
    expectDetailNotFound();
  });

  it('StockList: loads the universe and renders a row for COMI, without inventing it', async () => {
    const rig = buildRig();
    activateRig(rig);

    render(
      <MemoryRouter>
        <StockList />
      </MemoryRouter>,
    );

    await rig.settle();
    expectListRowFor('COMI');
  });
});
