import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { toDecimal } from '../../contracts/decimal.ts';
import type { IsoUtc } from '../../contracts/messages.ts';
import { resetStore } from '../../data/store.ts';
import { DISPLAY_REFRESH_INTERVAL_MS } from '../../display/throttle.ts';
import { createFakeSource, snapshotFixture, tickFixture } from './testSupport.ts';

// jsdom has no canvas; PriceChart's real uPlot cannot construct there. Fake it, same
// technique task 05's own chart tests use (src/chart/__tests__/uplotTestDouble.ts).
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

// Spies on the real PriceCell so we can observe, in order, every value it was asked
// to render — the only reliable way to prove a DOM ordering claim when both renders
// settle within the same React `act()` flush.
vi.mock('../../components/PriceCell.tsx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../components/PriceCell.tsx')>();
  return {
    ...actual,
    PriceCell: vi.fn((props: Parameters<typeof actual.PriceCell>[0]) => <actual.PriceCell {...props} />),
  };
});

import { getSharedSource, resetSharedSource } from '../../data/config.ts';
import { PriceCell } from '../../components/PriceCell.tsx';
import { StockDetail } from '../StockDetail.tsx';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

beforeEach(() => {
  resetStore();
  resetSharedSource();
});

describe('StockDetail snapshot-then-stream ordering', () => {
  it('renders the snapshot before a tick that arrives while it is still in flight, and ends on the tick (newer wins)', async () => {
    vi.useFakeTimers();
    const { source, emitTick } = createFakeSource({
      snapshotImpl: (symbol) =>
        new Promise((resolve) => {
          setTimeout(() => resolve(snapshotFixture({ symbol })), 50);
        }),
    });
    vi.mocked(getSharedSource).mockReturnValue(source);

    render(
      <MemoryRouter>
        <StockDetail symbol="COMI" />
      </MemoryRouter>,
    );

    // Snapshot still in flight — nothing painted yet.
    expect(screen.getByTestId('stock-detail-loading')).toBeTruthy();
    expect(screen.queryByTestId('stock-detail-price')).toBeNull();

    // A tick "arrives" at 10ms — well before the 50ms snapshot resolves.
    act(() => {
      vi.advanceTimersByTime(10);
    });
    act(() => {
      emitTick(tickFixture());
    });

    // The tick must be held, not painted, until the snapshot has rendered.
    expect(screen.getByTestId('stock-detail-loading')).toBeTruthy();
    expect(screen.queryByTestId('stock-detail-price')).toBeNull();

    // Advance past the snapshot's resolution and flush the resulting effect cascade.
    await act(async () => {
      vi.advanceTimersByTime(60);
      await Promise.resolve();
      await Promise.resolve();
    });

    // Final state is the tick's price (it is chronologically newer).
    expect(screen.getByTestId('stock-detail-price').textContent).toContain('85.75');

    // Ordering: the snapshot's price must have been rendered (via PriceCell) before
    // the tick's price, not merely that the final state happens to be correct.
    const priceCellValues: string[] = vi
      .mocked(PriceCell)
      .mock.calls.map((call) => String(call[0]?.value ?? ''))
      .filter((value) => value === '84.50' || value === '85.75');
    const snapshotIndex = priceCellValues.indexOf('84.50');
    const tickIndex = priceCellValues.indexOf('85.75');
    expect(snapshotIndex).toBeGreaterThanOrEqual(0);
    expect(tickIndex).toBeGreaterThan(snapshotIndex);
  });

  it('a fresh snapshot is always the authoritative volume baseline, even when multiple ticks queued ahead of it', async () => {
    // `StockDetail`'s volume accumulator resets to the snapshot's own `volume` every
    // time a fresh snapshot is ingested (see the doc on `volumeSinceBaselineRef` in
    // `../StockDetail.tsx`): a snapshot is the server's authoritative running total, so
    // it always supersedes whatever this page had locally accumulated before it landed
    // — there is no way for the client to know, from here, whether the ticks queued
    // ahead of a slow-to-arrive snapshot are already folded into that snapshot's own
    // total or not, so trusting the fresh authoritative number is the only sound choice.
    // Price/timestamp still follow "newer wins" independently of that reset — this test
    // pins down that the two are decoupled: three ticks arrive while loading, only the
    // last one's price survives (existing "newer wins" behavior), and volume reflects
    // the fresh snapshot's own total, not an incremental sum of the queued ticks' `q`.
    vi.useFakeTimers();
    const { source, emitTick } = createFakeSource({
      snapshotImpl: (symbol) =>
        new Promise((resolve) => {
          setTimeout(() => resolve(snapshotFixture({ symbol })), 50);
        }),
    });
    vi.mocked(getSharedSource).mockReturnValue(source);

    render(
      <MemoryRouter>
        <StockDetail symbol="COMI" />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('stock-detail-loading')).toBeTruthy();

    // Three ticks arrive while the snapshot is still in flight — only the last one's
    // price/timestamp can win.
    act(() => {
      vi.advanceTimersByTime(10);
    });
    act(() => {
      emitTick(tickFixture({ p: toDecimal('85.10'), q: 50, t: '2026-09-12T10:30:05.000Z' as IsoUtc, id: 'evt-a' }));
      emitTick(tickFixture({ p: toDecimal('85.20'), q: 75, t: '2026-09-12T10:30:05.001Z' as IsoUtc, id: 'evt-b' }));
      emitTick(tickFixture({ p: toDecimal('85.75'), q: 25, t: '2026-09-12T10:30:05.002Z' as IsoUtc, id: 'evt-c' }));
    });

    expect(screen.getByTestId('stock-detail-loading')).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(60);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId('stock-detail-price').textContent).toContain('85.75');
    expect(screen.getByTestId('stock-detail-footer').textContent).toContain(
      new Intl.NumberFormat('en-US').format(216637),
    );

    // Once ready, a further tick's quantity accumulates normally on top of that fresh
    // baseline — the accumulator is not permanently stuck at 0 after the reset.
    act(() => {
      emitTick(tickFixture({ p: toDecimal('85.80'), q: 60, t: '2026-09-12T10:30:06.000Z' as IsoUtc, id: 'evt-d' }));
    });
    await act(async () => {
      vi.advanceTimersByTime(DISPLAY_REFRESH_INTERVAL_MS);
    });
    expect(screen.getByTestId('stock-detail-footer').textContent).toContain(
      new Intl.NumberFormat('en-US').format(216637 + 60),
    );
  });
});
