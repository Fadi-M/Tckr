/**
 * Snapshot, then stream (client-contract.md §3.3): ticks that arrive while the snapshot is
 * still in flight are held, the snapshot paints first, and the newest tick's price wins.
 * The snapshot's volume is the server's authoritative running total, so it replaces
 * whatever the queued ticks added rather than being summed with them. (Volume
 * accumulating after that is `StockDetail.display-throttle.test.tsx`.)
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { toDecimal } from '../../contracts/decimal.ts';
import type { IsoUtc } from '../../contracts/messages.ts';
import { resetStore } from '../../data/store.ts';
import { createFakeSource, renderDetail, snapshotFixture, tickFixture } from './testSupport.tsx';

vi.mock('uplot', async () => ({
  default: (await import('../../chart/__tests__/uplotTestDouble.ts')).FakeUPlot,
}));
vi.mock('../../data/config.ts');
// A transparent spy on the real PriceCell, to see the order values were painted in when
// both renders settle within one `act()` flush.
vi.mock('../../components/PriceCell.tsx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../components/PriceCell.tsx')>();
  return { ...actual, PriceCell: vi.fn(actual.PriceCell) };
});

import { PriceCell } from '../../components/PriceCell.tsx';
import { StockDetail } from '../StockDetail.tsx';

const SNAPSHOT_VOLUME = 216637; // snapshotFixture's volume

/** Renders COMI with its snapshot 50 ms away, and returns the fake's `emitTick`. */
async function renderWithSlowSnapshot() {
  const { source, emitTick } = createFakeSource({
    snapshotImpl: (symbol) =>
      new Promise((resolve) => setTimeout(() => resolve(snapshotFixture({ symbol })), 50)),
  });
  await renderDetail(<StockDetail symbol="COMI" />, source, { settleFirst: false });
  act(() => {
    vi.advanceTimersByTime(10);
  });
  return emitTick;
}

async function landSnapshot() {
  await act(async () => {
    vi.advanceTimersByTime(60);
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  resetStore();
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('StockDetail snapshot-then-stream ordering', () => {
  it('holds a tick that beats the snapshot, paints the snapshot first, and ends on the tick', async () => {
    const emitTick = await renderWithSlowSnapshot();
    act(() => emitTick(tickFixture())); // 85.75, newer than the snapshot's 84.50

    expect(screen.getByTestId('stock-detail-loading')).toBeTruthy();
    expect(screen.queryByTestId('stock-detail-price')).toBeNull();

    await landSnapshot();

    expect(screen.getByTestId('stock-detail-price').textContent).toContain('85.75');
    const painted = vi
      .mocked(PriceCell)
      .mock.calls.map(([props]) => String(props.value))
      .filter((value) => value === '84.50' || value === '85.75');
    expect(painted.indexOf('84.50')).toBeGreaterThanOrEqual(0);
    expect(painted.indexOf('85.75')).toBeGreaterThan(painted.indexOf('84.50'));
  });

  it('takes the snapshot’s volume as the baseline, not a sum of the ticks queued ahead of it', async () => {
    const emitTick = await renderWithSlowSnapshot();
    act(() => {
      for (const [p, q, ms] of [
        ['85.10', 50, '000'],
        ['85.20', 75, '001'],
        ['85.75', 25, '002'],
      ] as const) {
        emitTick(
          tickFixture({
            p: toDecimal(p),
            q,
            t: `2026-09-12T10:30:05.${ms}Z` as IsoUtc,
            id: `evt-${ms}`,
          }),
        );
      }
    });

    await landSnapshot();

    expect(screen.getByTestId('stock-detail-price').textContent).toContain('85.75');
    expect(screen.getByTestId('stock-detail-footer').textContent).toContain(
      SNAPSHOT_VOLUME.toLocaleString('en-US'),
    );
  });
});
