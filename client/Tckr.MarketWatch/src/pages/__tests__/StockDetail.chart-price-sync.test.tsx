/**
 * Regression test for the reported bug: "current price shows a number and the line
 * draws another number." Root cause was architectural — `PriceChart` used to read
 * `src/data/store.ts` independently, on its own 30s timer, completely unsynchronized
 * with `StockDetail`'s own displayed price (computed on `StockDetail`'s own,
 * separately-timed throttle over the uncoalesced raw tick stream). Two independent
 * samplers of the same tape will, at any given instant, often disagree.
 *
 * The fix: `PriceChart` is now fed `livePrice`, computed directly from the exact same
 * `quote` state `StockDetail` renders as its big price header — see `PriceChart.tsx`'s
 * and `StockDetail.tsx`'s module docs. This test proves the header text and the value
 * handed to `PriceChart` never diverge, across a snapshot, a queued-during-loading tick,
 * and post-ready ticks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { toDecimal } from '../../contracts/decimal.ts';
import type { IsoUtc } from '../../contracts/messages.ts';
import { resetStore } from '../../data/store.ts';
import { createFakeSource, snapshotFixture, tickFixture } from './testSupport.ts';

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

// Spies on the real PriceChart so the `livePrice` prop it actually receives, on every
// render, can be compared directly against the header's own displayed text.
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

/** The header's displayed price, as plain text (e.g. "84.50"), stripped of the
 * direction glyph `PriceCell` prepends. */
function headerPriceText(): string {
  return screen.getByTestId('stock-detail-price').textContent!.replace(/^[▲▼]/, '');
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

describe('StockDetail keeps the price header and the chart in sync', () => {
  it('feeds PriceChart the exact same price as the header, for the initial snapshot and every subsequent tick', async () => {
    const { source, emitTick } = createFakeSource();
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

    // Snapshot rendered: header and PriceChart's livePrice must agree.
    expect(headerPriceText()).toBe('84.50');
    let lastCall = vi.mocked(PriceChart).mock.calls.at(-1)!;
    expect(lastCall[0].livePrice?.p).toBe(toDecimal('84.50'));

    // A post-ready tick updates both the header and the chart's prop together, in the
    // same render — never one without the other.
    act(() => {
      emitTick(tickFixture({ p: toDecimal('85.75'), t: '2026-09-12T10:30:35.000Z' as IsoUtc, id: 'evt-x' }));
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(headerPriceText()).toBe('85.75');
    lastCall = vi.mocked(PriceChart).mock.calls.at(-1)!;
    expect(lastCall[0].livePrice?.p).toBe(toDecimal('85.75'));

    // Every single render PriceChart received must have shown a price matching what
    // the header showed at some point in that same commit — no call where PriceChart's
    // livePrice held a value the header never displayed.
    for (const call of vi.mocked(PriceChart).mock.calls) {
      const livePrice = call[0].livePrice;
      if (livePrice) {
        expect(['84.50', '85.75']).toContain(livePrice.p);
      }
    }
  });

  it('a tick queued while the snapshot is still in flight reaches PriceChart with the same value the header ends up showing', async () => {
    vi.useFakeTimers();
    const { source, emitTick } = createFakeSource();
    vi.mocked(source.getSnapshot).mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(snapshotFixture()), 50);
        }),
    );
    vi.mocked(getSharedSource).mockReturnValue(source);

    render(
      <MemoryRouter>
        <StockDetail symbol="COMI" />
      </MemoryRouter>,
    );

    act(() => {
      vi.advanceTimersByTime(10);
    });
    act(() => {
      emitTick(tickFixture({ p: toDecimal('85.75'), t: '2026-09-12T10:30:05.000Z' as IsoUtc }));
    });

    await act(async () => {
      vi.advanceTimersByTime(60);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(headerPriceText()).toBe('85.75');
    const lastCall = vi.mocked(PriceChart).mock.calls.at(-1)!;
    expect(lastCall[0].livePrice?.p).toBe(toDecimal('85.75'));
  });
});
