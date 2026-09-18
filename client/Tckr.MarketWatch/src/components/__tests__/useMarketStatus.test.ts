/**
 * `useMarketStatus` in isolation, decoupled from the two pages that consume it
 * (`StockDetail`, `StockList`). Every existing market-closed test
 * (`StockDetail.market-closed.test.tsx`, `StockList.market-closed.test.tsx`,
 * `chart.market-closed.test.tsx`) pins a fake system time BEFORE rendering and only
 * asserts the INITIAL badge/prop state — none of them advance fake timers PAST the
 * hook's own 30s poll interval WHILE MOUNTED, so none of them prove the hook's
 * `setInterval`/`setState` mechanism actually drives a live UI update in place (a user
 * who leaves the tab open across a market transition should see the badge update on its
 * own, with no remount). This suite targets exactly that mechanism, via `renderHook`
 * directly against the hook rather than through either page.
 *
 * Fixture instants are all derived from `cairoEpochFor`, matching the convention in
 * `marketCalendar.test.ts` and `simulated.marketHours.test.ts`: 2026-01-15 is a verified
 * Thursday trading day with Egypt's DST off. Fake timers are used throughout (never real
 * wall-clock time) since EGX's real trading window is only open a few hours a day and
 * this suite must pass regardless of when CI runs it.
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { cairoEpochFor, MARKET_CLOSE, MARKET_OPEN } from '../../data/marketCalendar.ts';
import { useMarketStatus } from '../useMarketStatus.ts';

// `useMarketStatus`'s own poll cadence (kept here rather than imported, mirroring the
// soft-coupling comment in useMarketStatus.ts itself for this exact value).
const MARKET_STATUS_REFRESH_MS = 30_000;

const TRADING_DAY = '2026-01-15'; // Thursday, DST off (see marketCalendar.test.ts).
const OPEN_AT = cairoEpochFor(TRADING_DAY, MARKET_OPEN.hour, MARKET_OPEN.minute);
const CLOSE_AT = cairoEpochFor(TRADING_DAY, MARKET_CLOSE.hour, MARKET_CLOSE.minute);
const MID_SESSION = OPEN_AT + 60 * 60 * 1000; // safely inside 10:00-14:30 Cairo
const BEFORE_OPEN = cairoEpochFor(TRADING_DAY, 8, 0); // 08:00 Cairo, before 10:00 open

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useMarketStatus', () => {
  it('renders with the correct initial status for a pinned "market open" instant', () => {
    vi.setSystemTime(MID_SESSION);
    const { result } = renderHook(() => useMarketStatus());
    expect(result.current.state).toBe('open');
    expect(result.current.sessionDateKey).toBe(TRADING_DAY);
  });

  it('renders with the correct initial status for a pinned "market closed" instant', () => {
    vi.setSystemTime(BEFORE_OPEN);
    const { result } = renderHook(() => useMarketStatus());
    expect(result.current.state).toBe('closed');
  });

  it('flips from closed to open on its own once polling crosses the open boundary', async () => {
    // 45s before open: still closed, and close enough that two 30s polls straddle the
    // boundary (poll #1 at +30s is still 15s shy of open; poll #2 at +60s is 15s past it).
    const justBeforeOpen = OPEN_AT - 45_000;
    vi.setSystemTime(justBeforeOpen);
    const { result } = renderHook(() => useMarketStatus());
    expect(result.current.state).toBe('closed');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MARKET_STATUS_REFRESH_MS); // +30s: still before open
    });
    expect(result.current.state).toBe('closed');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MARKET_STATUS_REFRESH_MS); // +60s total: past open
    });
    expect(result.current.state).toBe('open');
  });

  it('flips from open to closed on its own once polling crosses the close boundary', async () => {
    const justBeforeClose = CLOSE_AT - 45_000;
    vi.setSystemTime(justBeforeClose);
    const { result } = renderHook(() => useMarketStatus());
    expect(result.current.state).toBe('open');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MARKET_STATUS_REFRESH_MS); // +30s: still open
    });
    expect(result.current.state).toBe('open');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MARKET_STATUS_REFRESH_MS); // +60s total: past close
    });
    expect(result.current.state).toBe('closed');
  });

  it('clears its interval on unmount, so no further polling occurs', async () => {
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    vi.setSystemTime(BEFORE_OPEN);
    const { result, unmount } = renderHook(() => useMarketStatus());
    expect(result.current.state).toBe('closed');

    unmount();
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);

    // Advancing well past the open boundary after unmount must not throw or otherwise
    // indicate a still-running timer touching unmounted state.
    vi.setSystemTime(OPEN_AT + 60 * 60 * 1000);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MARKET_STATUS_REFRESH_MS * 3);
    });
    // The hook's last-rendered value is frozen at whatever it was before unmount.
    expect(result.current.state).toBe('closed');
  });
});
