/**
 * The board's earned moments (2026-09-26 delight pass), each on a real event only: the
 * opening bell is marked once when EGX opens while the page is open; a recovered stream
 * is confirmed; a search that matches nothing suggests the closest instruments instead
 * of a dead end. None fires on first paint. (The closed banner's countdown is
 * `StockList.market-closed.test.tsx`.)
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { cairoEpochFor } from '../../data/marketCalendar.ts';
import { resetStore } from '../../data/store.ts';
import { formatUntil } from '../../display/formatUntil.ts';
import { closestInstruments } from '../closestInstruments.ts';
import { loadUniverseFixture, makeFakeSource, renderBoard, settle } from './testSupport.tsx';

vi.mock('../../data/config.ts');

describe('formatUntil', () => {
  it('is coarse: days+hours, hours+minutes, minutes, then "under a minute"', () => {
    expect(formatUntil(38 * 3_600_000 + 5 * 60_000)).toBe('in 1d 14h');
    expect(formatUntil(3 * 3_600_000 + 12 * 60_000)).toBe('in 3h 12m');
    expect(formatUntil(12 * 60_000 + 30_000)).toBe('in 12m');
    expect(formatUntil(20_000)).toBe('in under a minute');
  });
});

describe('closestInstruments', () => {
  const universe = loadUniverseFixture();

  it('recovers a ticker typo or a misspelled name, and offers nothing for an unrelated query', () => {
    expect(closestInstruments('COMY', universe)[0]?.symbol).toBe('COMI');
    expect(closestInstruments('orascon', universe).map((def) => def.symbol)).toContain('ORAS');
    expect(closestInstruments('zzzzzz', universe)).toEqual([]);
  });
});

describe('StockList moments', () => {
  beforeEach(() => {
    resetStore();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('marks the opening bell once when EGX opens while the page is open, never on load', async () => {
    vi.setSystemTime(cairoEpochFor('2026-01-15', 9, 59) + 45_000);
    await renderBoard();
    expect(screen.queryByText('EGX is open')).toBeNull();

    // useMarketStatus re-checks every 30s; two checks carry the clock past 10:00.
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText('EGX is open')).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(9_000);
    });
    expect(screen.queryByText('EGX is open')).toBeNull();
  });

  it('confirms a recovered stream, but not the first connection', async () => {
    vi.setSystemTime(cairoEpochFor('2026-01-15', 11, 0));
    const fake = makeFakeSource(loadUniverseFixture());
    await renderBoard({ source: fake.source });
    act(() => fake.emitStatus({ kind: 'connected', since: Date.now() }));
    expect(screen.queryByText('Reconnected')).toBeNull();

    act(() => fake.emitStatus({ kind: 'reconnecting', attempt: 1, nextRetryMs: 1000 }));
    act(() => fake.emitStatus({ kind: 'connected', since: Date.now() }));
    expect(screen.getByText('Reconnected')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Reconnected')).toBeNull();
  });

  it('suggests the closest instrument when a search matches nothing, and opens it', async () => {
    vi.setSystemTime(cairoEpochFor('2026-01-15', 11, 0));
    await renderBoard();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search symbol or name' }), {
      target: { value: 'COMY' },
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByText('Did you mean')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^COMI/ }));
    await settle(1);
    expect(screen.getByTestId('detail-route').textContent).toBe('COMI');
  });
});
