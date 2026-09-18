/**
 * `StockList`'s "Market closed" banner (`MarketClosedBanner`/`useMarketStatus`) — an
 * independent observer of `marketCalendar.getMarketStatus()`, distinct from
 * `ConnectionBanner` (transport state) — see `StockList.connection-banner.test.tsx` for
 * that one. Fixture timestamps verified in `marketCalendar.test.ts`.
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { cairoEpochFor } from '../../data/marketCalendar.ts';
import { resetStore } from '../../data/store.ts';
import { loadUniverseFixture, makeFakeSource } from './testSupport.ts';

const SESSION_OPEN = cairoEpochFor('2026-01-15', 10, 0);
const MID_SESSION = SESSION_OPEN + 60 * 60 * 1000;
const AFTER_CLOSE = cairoEpochFor('2026-01-15', 14, 30) + 60 * 60 * 1000;

const { mockGetSharedSource } = vi.hoisted(() => ({ mockGetSharedSource: vi.fn() }));
vi.mock('../../data/config.ts', () => ({ getSharedSource: mockGetSharedSource }));

import { StockList } from '../StockList.tsx';

async function renderListAt(nowMs: number) {
  vi.setSystemTime(nowMs);
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
}

describe('StockList market-closed banner', () => {
  beforeEach(() => {
    resetStore();
    mockGetSharedSource.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('shows nothing while EGX is open', async () => {
    await renderListAt(MID_SESSION);
    expect(screen.queryByText(/market closed/i)).toBeNull();
  });

  it('shows the market-closed banner, with the next-open time, once EGX has closed', async () => {
    await renderListAt(AFTER_CLOSE);
    const banner = screen.getByText(/market closed/i).closest('[role="status"]');
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toContain('Cairo');
    expect(banner!.textContent).toMatch(/\d{2}:\d{2}/);
  });

  it('is a status region, not an alert — distinct from the connection banner', async () => {
    await renderListAt(AFTER_CLOSE);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(/market closed/i).closest('[role="status"]')).not.toBeNull();
  });
});
