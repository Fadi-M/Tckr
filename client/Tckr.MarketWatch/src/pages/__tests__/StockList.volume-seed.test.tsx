/**
 * `StockList.volume-seed.test.tsx` — correctness-review fix. Before this fix,
 * `StockList.tsx` never called `source.getSnapshot(symbol)` for any symbol (only
 * `getUniverse()` + `subscribe()`), so a row's volume — derived in
 * `src/data/store.ts#applyTick` from `previousVolume + tick.q` — started accumulating
 * from 0 on that row's first tick after the page mounted, discarding whatever volume
 * the underlying data source had already accumulated before this page opened.
 * `StockDetail.tsx` already seeds its one symbol this way via `getSnapshot()`;
 * `StockList.tsx` now does the same for every symbol in the universe, fired (not
 * awaited) right after `setUniverse` so the table still paints immediately.
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { toDecimal } from '../../contracts/decimal.ts';
import type { IsoUtc } from '../../contracts/messages.ts';
import { applySnapshot, primeUniverse, resetStore } from '../../data/store.ts';
import { loadUniverseFixture, makeFakeSource, snapshotFixture } from './testSupport.ts';

const { mockGetSharedSource } = vi.hoisted(() => ({ mockGetSharedSource: vi.fn() }));
vi.mock('../../data/config.ts', () => ({ getSharedSource: mockGetSharedSource }));

import { StockList } from '../StockList.tsx';

/** This suite's snapshot template: fixed 50.00 price — only `volume` varies, the
 * whole point of these tests. */
function volumeSnapshotFixture(symbol: string, volume: number) {
  return snapshotFixture({
    symbol,
    volume,
    price: toDecimal('50.00'),
    change: toDecimal('0.00'),
    changePercent: '+0.00',
    open: toDecimal('50.00'),
    high: toDecimal('50.00'),
    low: toDecimal('50.00'),
    lastEventId: 'evt-000000000000004',
    exchangeTimestamp: '2026-09-12T10:00:00.000Z' as IsoUtc,
  });
}

describe('StockList volume seeding', () => {
  beforeEach(() => {
    resetStore();
    mockGetSharedSource.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('calls getSnapshot for every universe symbol on mount, seeding true cumulative volume', async () => {
    const universeSymbols = loadUniverseFixture();
    const expectedSymbols = universeSymbols.map((def) => def.symbol);
    // A real `MarketDataSource` primes the store's universe itself before a snapshot
    // for one of its symbols can be applied (store.ts's "real universe, not whatever
    // the wire claims" guard). This fake source is a plain object, not a real source
    // instance, so the test primes it explicitly to match that contract.
    primeUniverse(universeSymbols);
    const { source, getSnapshotCalls } = makeFakeSource(universeSymbols, {
      getSnapshotImpl: (symbol) => {
        const snapshot = volumeSnapshotFixture(symbol, 999_999);
        // Mirrors `SimulatedSource.getSnapshot`/`TckrGatewaySource.getSnapshot`, both of
        // which write the resolved snapshot into the shared store via `applySnapshot`
        // internally before resolving — `StockList.tsx` relies on that side effect
        // rather than doing it itself (see its module doc / mount effect).
        applySnapshot(snapshot);
        return Promise.resolve(snapshot);
      },
    });
    mockGetSharedSource.mockReturnValue(source);

    render(
      <MemoryRouter>
        <StockList />
      </MemoryRouter>,
    );

    // getUniverse() resolves, then the getSnapshot() calls it fires are themselves
    // async (Promise.resolve chains) — flush a few microtask turns for all 34 to settle.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect([...getSnapshotCalls].sort()).toEqual([...expectedSymbols].sort());
    expect(getSnapshotCalls).toHaveLength(34);

    // The seeded volume (999,999) is now visible in the row, proving it reached the
    // shared store via `applySnapshot`, not just that `getSnapshot` was called.
    const comiRow = screen.getByRole('row', { name: /^COMI,/ });
    expect(comiRow.textContent).toContain('999,999');
  });

  it('does not let one rejected snapshot stop the others from seeding (allSettled, not all)', async () => {
    const universeSymbols = loadUniverseFixture();
    // See the previous test's comment: this fake source is a plain object, not a real
    // source instance, so the store's universe must be primed explicitly.
    primeUniverse(universeSymbols);
    const { source, getSnapshotCalls } = makeFakeSource(universeSymbols, {
      getSnapshotImpl: (symbol) => {
        if (symbol === 'COMI') {
          return Promise.reject(new Error('simulated getSnapshot failure for COMI'));
        }
        const snapshot = volumeSnapshotFixture(symbol, 123_456);
        applySnapshot(snapshot);
        return Promise.resolve(snapshot);
      },
    });
    mockGetSharedSource.mockReturnValue(source);

    render(
      <MemoryRouter>
        <StockList />
      </MemoryRouter>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getSnapshotCalls).toHaveLength(34);
    const cibRow = screen.getByRole('row', { name: /^CIB,/ });
    expect(cibRow.textContent).toContain('123,456');
  });
});
