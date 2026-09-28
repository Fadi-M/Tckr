/**
 * `StockList.display-throttle.test.tsx` — a row paints at most once per beat, on the
 * page's one wall-clock beat (`src/display/pacedViews.ts`), and always the latest tick.
 *
 * History: the row once had a mount-anchored interval (catch-up landed ~2 windows
 * late), then a leading+trailing `createThrottle` on its store subscription. The
 * leading edge painted a quiet symbol's first tick mid-beat, ahead of the board's order
 * and the hero picks, which were on clocks of their own; and the snapshot was still read
 * live on unrelated renders. Now nothing paints between beats.
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { toDecimal } from '../../contracts/decimal.ts';
import { applyTick, primeUniverse, resetStore } from '../../data/store.ts';
import { DISPLAY_REFRESH_INTERVAL_MS } from '../../display/throttle.ts';
import { loadUniverseFixture, makeFakeSource, tickFixture } from './testSupport.ts';

const { mockGetSharedSource } = vi.hoisted(() => ({ mockGetSharedSource: vi.fn() }));
vi.mock('../../data/config.ts', () => ({ getSharedSource: mockGetSharedSource }));

import { StockList } from '../StockList.tsx';

function renderCountFor(symbol: string): number {
  const row = screen
    .getAllByRole('row')
    .find((candidate) => candidate.getAttribute('data-symbol') === symbol);
  return Number(row?.getAttribute('data-render-count'));
}

describe('StockListRow display-refresh throttle', () => {
  beforeEach(() => {
    resetStore();
    mockGetSharedSource.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('a burst of ticks paints nothing until the next beat, then exactly once, with the latest tick', async () => {
    const universeSymbols = loadUniverseFixture();
    // A real `MarketDataSource` primes the store's universe itself before any tick can
    // be accepted (store.ts's "real universe, not whatever the wire claims" guard).
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

    const before = renderCountFor('COMI');

    // A hot symbol's burst, including its very first tick: none of it paints mid-beat.
    act(() => {
      for (let i = 0; i < 20; i += 1) {
        applyTick(
          tickFixture({
            s: 'COMI',
            p: toDecimal((85 + i * 0.01).toFixed(2)),
            id: `evt-burst-${i}`,
          }),
        );
      }
    });
    expect(renderCountFor('COMI')).toBe(before);

    // The next beat is never more than one window away.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DISPLAY_REFRESH_INTERVAL_MS);
    });
    expect(renderCountFor('COMI')).toBe(before + 1);

    // The beat shows the *latest* tick of the burst, never a mid-burst value.
    const comiRow = screen
      .getAllByRole('row')
      .find((candidate) => candidate.getAttribute('data-symbol') === 'COMI');
    expect(comiRow?.textContent).toContain('85.19');
  });
});
