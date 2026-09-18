/**
 * `StockDetail`'s "MARKET CLOSED" badge and `PriceChart`'s `marketOpen` prop — both
 * driven by the same `marketCalendar.getMarketStatus()` call (via `useMarketStatus`),
 * so they can never disagree. Fixture timestamps verified in `marketCalendar.test.ts`:
 * 2026-01-15 is a Thursday (EGX trading day), Egypt's DST off.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { IsoUtc } from '../../contracts/messages.ts';
import { cairoEpochFor } from '../../data/marketCalendar.ts';
import { resetStore } from '../../data/store.ts';
import { createFakeSource, snapshotFixture, universeFixture } from './testSupport.ts';

const SESSION_OPEN = cairoEpochFor('2026-01-15', 10, 0);
const MID_SESSION = SESSION_OPEN + 60 * 60 * 1000; // market open
const AFTER_CLOSE = cairoEpochFor('2026-01-15', 14, 30) + 60 * 60 * 1000; // market closed

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

vi.mock('../../data/config.ts', () => ({
  getSharedSource: vi.fn(),
  resetSharedSource: vi.fn(),
  resolveClientConfig: vi.fn(() => ({
    source: 'simulated' as const,
    gatewayUrl: 'ws://localhost:5000',
    demoUser: 'user-001',
    simulated: { eventsPerSecond: 2000, delayedOffsetMs: 15000, seed: 1 },
  })),
}));

vi.mock('../../chart/PriceChart.tsx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../chart/PriceChart.tsx')>();
  return {
    ...actual,
    PriceChart: vi.fn((props: Parameters<typeof actual.PriceChart>[0]) => <actual.PriceChart {...props} />),
  };
});

import { getSharedSource, resetSharedSource } from '../../data/config.ts';
import { PriceChart } from '../../chart/PriceChart.tsx';
import { StockDetail } from '../StockDetail.tsx';

function createMarketClosedFakeSource() {
  return createFakeSource({
    universe: universeFixture({ asOf: '2026-01-15T08:00:00.000Z' as IsoUtc }),
    snapshotImpl: (symbol) =>
      Promise.resolve(snapshotFixture({ symbol, exchangeTimestamp: '2026-01-15T10:30:00.000Z' as IsoUtc })),
  });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

beforeEach(() => {
  resetStore();
  resetSharedSource();
  vi.mocked(PriceChart).mockClear();
});

describe('StockDetail market-closed badge / PriceChart.marketOpen agreement', () => {
  it('shows no market-closed badge and passes marketOpen=true while EGX is open', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(MID_SESSION);
    const { source } = createMarketClosedFakeSource();
    vi.mocked(getSharedSource).mockReturnValue(source);

    render(
      <MemoryRouter>
        <StockDetail symbol="COMI" />
      </MemoryRouter>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByTestId('market-closed-badge')).toBeNull();
    const lastCall = vi.mocked(PriceChart).mock.calls.at(-1)!;
    expect(lastCall[0].marketOpen).toBe(true);
  });

  it('shows the market-closed badge and passes marketOpen=false once EGX has closed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(AFTER_CLOSE);
    const { source } = createMarketClosedFakeSource();
    vi.mocked(getSharedSource).mockReturnValue(source);

    render(
      <MemoryRouter>
        <StockDetail symbol="COMI" />
      </MemoryRouter>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const badge = screen.getByTestId('market-closed-badge');
    expect(badge.textContent).toContain('MARKET CLOSED');
    expect(badge.textContent).toContain('Cairo');
    const lastCall = vi.mocked(PriceChart).mock.calls.at(-1)!;
    expect(lastCall[0].marketOpen).toBe(false);
  });
});
