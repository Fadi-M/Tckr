/**
 * `entitlementChanged` (a LIVE↔DELAYED stream switch) must never leave the old
 * stream's quote/baseline/extras on screen — client-contract.md §3.3: "discard any
 * buffered ticks from the old stream rather than mixing the two on one chart."
 *
 * `StockDetail` keeps its own parallel quote/extras state instead of reading
 * `src/data/store.ts` (see the module doc at the top of `../StockDetail.tsx`), so it
 * cannot rely on that module's `resetStream()`/`onStreamDiscard` (which
 * `PriceChart.tsx` already reacts to for the chart's own buffer — see
 * `src/chart/__tests__/chart.stream-discard.test.tsx`). This page's own
 * `source.on.entitlement` handler must do the equivalent clearing itself.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { toDecimal } from '../../contracts/decimal.ts';
import type { EntitlementChanged, IsoUtc } from '../../contracts/messages.ts';
import { resetStore } from '../../data/store.ts';
import { DISPLAY_REFRESH_INTERVAL_MS } from '../../display/throttle.ts';
import { createFakeSource, tickFixture } from './testSupport.ts';

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

import { getSharedSource, resetSharedSource } from '../../data/config.ts';
import { StockDetail } from '../StockDetail.tsx';

function entitlementChangedFixture(stream: 'LIVE' | 'DELAYED'): EntitlementChanged {
  return {
    v: 1,
    type: 'entitlementChanged',
    stream,
    resubscribeRequired: true,
    effectiveFrom: '2026-09-12T10:35:00.000Z' as IsoUtc,
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

beforeEach(() => {
  resetStore();
  resetSharedSource();
});

describe('StockDetail entitlementChanged', () => {
  it('clears the stale quote/extras on a stream switch instead of leaving old-stream data on screen', async () => {
    vi.useFakeTimers();
    const { source, emitTick, emitEntitlement } = createFakeSource();
    vi.mocked(getSharedSource).mockReturnValue(source);

    render(
      <MemoryRouter>
        <StockDetail symbol="COMI" />
      </MemoryRouter>,
    );

    // Reach `ready` (snapshot resolves synchronously in this fixture): 84.50, LIVE.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId('stock-detail-price').textContent).toContain('84.50');

    // A LIVE tick moves the displayed price/change/volume away from the snapshot —
    // this is the "old stream" state that must not survive the switch below.
    act(() => {
      emitTick(
        tickFixture({
          p: toDecimal('86.00'),
          q: 500,
          t: '2026-09-12T10:30:05.000Z' as IsoUtc,
          st: 'LIVE',
        }),
      );
    });
    expect(screen.getByTestId('stock-detail-price').textContent).toContain('86.00');
    expect(screen.getByTestId('stock-detail-footer').textContent).toContain(
      new Intl.NumberFormat('en-US').format(216637 + 500),
    );

    // The stream switch: entitlementChanged fires (LIVE -> DELAYED).
    act(() => {
      emitEntitlement(entitlementChangedFixture('DELAYED'));
    });

    // The old stream's price/change/badge/extras must be gone immediately — not left
    // on screen until the next tick or snapshot happens to arrive.
    expect(screen.queryByTestId('stock-detail-price')).toBeNull();
    expect(screen.queryByTestId('stock-detail-footer')).toBeNull();
    expect(screen.getByTestId('stock-detail-loading')).toBeTruthy();

    // A fresh tick under the new stream must not be diffed against the old stream's
    // baseline (86.00) — the baseline re-anchors to this tick's own price, exactly
    // like `store.ts`'s `resetStream()` re-anchoring to a fresh reference point.
    // Advance past the throttle window first so this tick paints on its leading edge
    // rather than being coalesced with the pre-switch tick above.
    act(() => {
      vi.advanceTimersByTime(DISPLAY_REFRESH_INTERVAL_MS);
    });
    act(() => {
      emitTick(
        tickFixture({
          p: toDecimal('90.00'),
          q: 10,
          t: '2026-09-12T10:36:00.000Z' as IsoUtc,
          st: 'DELAYED',
        }),
      );
    });

    expect(screen.getByTestId('stock-detail-price').textContent).toContain('90.00');
    // Change is 0.00 (0.00%) — proof the new tick was NOT diffed against the discarded
    // 86.00 LIVE-stream baseline.
    expect(screen.getByTestId('stock-detail-change').textContent).toContain('0.00');
    expect(screen.getByTestId('stock-detail-change-percent').textContent).toContain('0.00%');
    // Volume restarts from this tick's own quantity, not the old stream's accumulated
    // total (216637 + 500 immediately before the switch).
    expect(screen.getByTestId('stock-detail-footer').textContent).toContain(
      new Intl.NumberFormat('en-US').format(10),
    );
  });
});
