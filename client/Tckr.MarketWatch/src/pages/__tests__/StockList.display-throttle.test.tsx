/**
 * `StockList.display-throttle.test.tsx` — code-review fix (PR #3). `StockListRow`'s
 * display-refresh throttle used to be a hand-rolled `lastRenderAtRef` gate plus a
 * `setInterval` anchored at component *mount* time, which had a real bug: the mount-
 * relative interval schedule is essentially never aligned with the arbitrary moment a
 * real tick updates the gate, so the interval's very next firing after an accepted
 * render almost always landed inside that same render's window and was itself
 * suppressed — catch-up only succeeded on the *second* interval firing, close to 2x
 * `DISPLAY_REFRESH_INTERVAL_MS` late, not the "within one window" the old code's own
 * comment claimed. `StockListRow` now reuses `createThrottle` (`src/display/
 * throttle.ts`, the same utility `StockDetail.tsx` already uses) directly on the store
 * subscription, whose trailing-edge `setTimeout` is scheduled relative to the leading
 * call's own timestamp — a correct "within one window" guarantee.
 *
 * This mirrors `StockDetail.display-throttle.test.tsx`'s pattern (`vi.advanceTimersByTime`),
 * adapted to `StockListRow`'s per-row `data-render-count` test hook (see
 * `StockList.render-isolation.test.tsx`) instead of counting `PriceCell` calls.
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
  const row = screen.getAllByRole('row').find((candidate) => candidate.getAttribute('data-symbol') === symbol);
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

  it('a burst of ticks inside one window paints a leading repaint, then a trailing catch-up within exactly one window — never two', async () => {
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

    const before = renderCountFor('COMI');

    // A burst well within one throttle window — simulating a hot symbol's tape. The
    // leading tick paints immediately; the rest are collapsed by the throttle.
    act(() => {
      for (let i = 0; i < 20; i += 1) {
        applyTick(tickFixture({ s: 'COMI', p: toDecimal((85 + i * 0.01).toFixed(2)), id: `evt-burst-${i}` }));
      }
    });
    const afterLeading = renderCountFor('COMI');
    expect(afterLeading).toBe(before + 1);

    // Advancing exactly one window must flush the trailing catch-up now — not require a
    // second window the way the old mount-anchored-interval bug did.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DISPLAY_REFRESH_INTERVAL_MS);
    });
    const afterTrailing = renderCountFor('COMI');
    expect(afterTrailing).toBe(afterLeading + 1);

    // The trailing paint shows the *latest* tick of the burst, never a mid-burst value.
    const comiRow = screen.getAllByRole('row').find((candidate) => candidate.getAttribute('data-symbol') === 'COMI');
    expect(comiRow?.textContent).toContain('85.19');
  });
});
