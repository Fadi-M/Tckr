/**
 * `StockList`'s earned moments (2026-09-26 delight pass): the closed banner counts down
 * to the bell; the opening bell is marked once when EGX opens while the page is open; a
 * recovered stream is confirmed; and a search that matches nothing suggests the closest
 * instruments instead of a dead end. None of them fire on first paint.
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { cairoEpochFor } from '../../data/marketCalendar.ts';
import { resetStore } from '../../data/store.ts';
import { loadUniverseFixture, makeFakeSource } from './testSupport.ts';

const { mockGetSharedSource } = vi.hoisted(() => ({ mockGetSharedSource: vi.fn() }));
vi.mock('../../data/config.ts', () => ({ getSharedSource: mockGetSharedSource }));

import { closestInstruments } from '../closestInstruments.ts';
import { formatUntil, StockList } from '../StockList.tsx';

async function renderList() {
  const universeSymbols = loadUniverseFixture();
  const handle = makeFakeSource(universeSymbols);
  mockGetSharedSource.mockReturnValue(handle.source);
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<StockList />}>
          <Route
            path="EGX/symbols/:symbol"
            element={<div data-testid="detail-route">detail</div>}
          />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return handle;
}

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

  it('recovers a one-letter ticker typo', () => {
    expect(closestInstruments('COMY', universe)[0]?.symbol).toBe('COMI');
  });

  it('matches a misspelled word of a company name', () => {
    expect(closestInstruments('orascon', universe).map((def) => def.symbol)).toContain('ORAS');
  });

  it('offers nothing for an unrelated query rather than random symbols', () => {
    expect(closestInstruments('zzzzzz', universe)).toEqual([]);
  });
});

describe('StockList moments', () => {
  beforeEach(() => {
    resetStore();
    mockGetSharedSource.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('counts down to the next open in the market-closed banner', async () => {
    // Thursday 2026-01-15 16:00 Cairo — next open is Sunday 10:00.
    vi.setSystemTime(cairoEpochFor('2026-01-15', 16, 0));
    await renderList();
    const banner = screen.getByText(/market closed/i).closest('[role="status"]');
    expect(banner?.textContent).toMatch(/Reopens Sun 10:00 Cairo time, in 2d 18h\./);
  });

  it('marks the opening bell once when EGX opens while the page is open, never on load', async () => {
    vi.setSystemTime(cairoEpochFor('2026-01-15', 9, 59) + 45_000);
    await renderList();
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
    const handle = await renderList();
    act(() => handle.emitStatus({ kind: 'connected', since: Date.now() }));
    expect(screen.queryByText('Reconnected')).toBeNull();

    act(() => handle.emitStatus({ kind: 'reconnecting', attempt: 1, nextRetryMs: 1000 }));
    act(() => handle.emitStatus({ kind: 'connected', since: Date.now() }));
    expect(screen.getByText('Reconnected')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Reconnected')).toBeNull();
  });

  it('suggests the closest instrument when a search matches nothing, and opens it', async () => {
    vi.setSystemTime(cairoEpochFor('2026-01-15', 11, 0));
    await renderList();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search symbol or name' }), {
      target: { value: 'COMY' },
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByText('Did you mean')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^COMI/ }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('detail-route')).toBeTruthy();
  });
});
