/**
 * `StockList.row-aria-label.test.tsx` — accessibility-review fix. A row is the focus
 * target (`tabIndex={0}`), so its `aria-label` is the only thing a keyboard/
 * screen-reader user gets — it previously was just the bare symbol (`aria-label={symbol}`),
 * omitting the price and up/down direction that is the entire point of the row for a
 * sighted user. `StockList.tsx` now builds a richer label from `price`/`changePercent`
 * already computed in `StockListRow`.
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { toDecimal } from '../../contracts/decimal.ts';
import { applyTick, primeUniverse, resetStore } from '../../data/store.ts';
import { loadUniverseFixture, makeFakeSource, tickFixture } from './testSupport.ts';

const { mockGetSharedSource } = vi.hoisted(() => ({ mockGetSharedSource: vi.fn() }));
vi.mock('../../data/config.ts', () => ({ getSharedSource: mockGetSharedSource }));

import { StockList } from '../StockList.tsx';

describe('StockList row aria-label', () => {
  beforeEach(() => {
    resetStore();
    mockGetSharedSource.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("includes the symbol and price even before any tick has arrived", async () => {
    const universeSymbols = loadUniverseFixture();
    mockGetSharedSource.mockReturnValue(makeFakeSource(universeSymbols).source);

    render(
      <MemoryRouter>
        <StockList />
      </MemoryRouter>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const comi = universeSymbols.find((s) => s.symbol === 'COMI');
    expect(comi).toBeDefined();
    const row = screen.getByRole('row', { name: new RegExp(`^COMI, ${comi?.referencePrice}\\b`) });
    expect(row).toBeTruthy();
  });

  // Each direction gets its own fresh render rather than two ticks against the same
  // mounted row: `StockListRow` deliberately throttles to at most one repaint per
  // `DISPLAY_REFRESH_INTERVAL_MS` (`createThrottle` wrapping the store subscription —
  // see that file's doc comment), so a second tick landing inside the same window
  // would not repaint and this test would flake on that timing rather than testing the
  // aria-label. A fresh mount always paints its first tick immediately — `createThrottle`
  // fires the first call in a fresh window leading-edge, with no delay.
  it('includes formatted price and "up" direction after an up tick', async () => {
    const universeSymbols = loadUniverseFixture();
    // A real `MarketDataSource` primes the store's universe itself before any tick can
    // be accepted (store.ts's "real universe, not whatever the wire claims" guard).
    // This fake source is a plain object, not a real source instance, so the test
    // primes it explicitly to match that contract.
    primeUniverse(universeSymbols);
    mockGetSharedSource.mockReturnValue(makeFakeSource(universeSymbols).source);

    render(
      <MemoryRouter>
        <StockList />
      </MemoryRouter>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // COMI's reference price is 85.10 (public/symbols.json) — tick it up.
    act(() => {
      applyTick(tickFixture({ s: 'COMI', p: toDecimal('90.00') }));
    });
    const upRow = screen.getByRole('row', { name: /^COMI, 90(\.0+)?, up \d+(\.\d+)?%$/ });
    expect(upRow).toBeTruthy();
  });

  it('includes formatted price and "down" direction after a down tick', async () => {
    const universeSymbols = loadUniverseFixture();
    primeUniverse(universeSymbols);
    mockGetSharedSource.mockReturnValue(makeFakeSource(universeSymbols).source);

    render(
      <MemoryRouter>
        <StockList />
      </MemoryRouter>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Tick it down relative to the session baseline (referencePrice).
    act(() => {
      applyTick(tickFixture({ s: 'COMI', p: toDecimal('10.00') }));
    });
    const downRow = screen.getByRole('row', { name: /^COMI, 10(\.0+)?, down \d+(\.\d+)?%$/ });
    expect(downRow).toBeTruthy();
  });
});
