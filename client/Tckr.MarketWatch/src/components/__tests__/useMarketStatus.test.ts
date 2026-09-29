/**
 * `useMarketStatus` keeps a tab that stays open across an EGX boundary honest: it flips
 * at the 10:00 open and the 14:30 close themselves (not at its next 30 s poll), with no
 * remount, and stops polling once unmounted. 2026-01-15 is a Thursday trading day with
 * Egypt's DST off (see `marketCalendar.test.ts`).
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { cairoEpochFor, MARKET_CLOSE, MARKET_OPEN } from '../../data/marketCalendar.ts';
import { useMarketStatus } from '../useMarketStatus.ts';

const TRADING_DAY = '2026-01-15';
const OPEN_AT = cairoEpochFor(TRADING_DAY, MARKET_OPEN.hour, MARKET_OPEN.minute);
const CLOSE_AT = cairoEpochFor(TRADING_DAY, MARKET_CLOSE.hour, MARKET_CLOSE.minute);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useMarketStatus', () => {
  it.each([
    ['open', 'closed', OPEN_AT, 15_000], // the 30 s poll would next run 15 s after the open
    ['close', 'open', CLOSE_AT, 5_000],
  ])('flips at the %s itself, while mounted', (_boundary, before, boundaryAt, lead) => {
    vi.setSystemTime(boundaryAt - lead);
    const { result } = renderHook(() => useMarketStatus());
    expect(result.current.state).toBe(before);

    act(() => {
      vi.advanceTimersByTime(lead + 10);
    });
    expect(result.current.state).not.toBe(before);
    expect(result.current.sessionDateKey).toBe(TRADING_DAY);
  });

  it('stops polling once unmounted', async () => {
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    vi.setSystemTime(cairoEpochFor(TRADING_DAY, 8, 0));
    const { result, unmount } = renderHook(() => useMarketStatus());
    expect(result.current.state).toBe('closed');

    unmount();
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);

    vi.setSystemTime(OPEN_AT + 60 * 60 * 1000);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(90_000);
    });
    expect(result.current.state).toBe('closed');
  });
});
