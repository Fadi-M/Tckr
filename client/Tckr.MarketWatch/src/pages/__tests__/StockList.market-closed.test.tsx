/**
 * EGX hours on the board: a "Market closed" status (never an alert, which is the
 * connection banner's) counting down to the next open, and the caption's "updated" time
 * only while prices can move. Fixture instants are verified in `marketCalendar.test.ts`.
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { cairoEpochFor } from '../../data/marketCalendar.ts';
import { resetStore } from '../../data/store.ts';
import { renderBoard } from './testSupport.tsx';

vi.mock('../../data/config.ts');

const MID_SESSION = cairoEpochFor('2026-01-15', 11, 0); // a Thursday
const AFTER_CLOSE = cairoEpochFor('2026-01-15', 16, 0); // next open: Sunday 10:00

async function renderAt(nowMs: number) {
  vi.setSystemTime(nowMs);
  await renderBoard();
}

async function oneBeat() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
}

describe('StockList market hours', () => {
  beforeEach(() => {
    resetStore();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('while EGX trades: no closed banner, and the caption says when the board last updated', async () => {
    await renderAt(MID_SESSION);
    expect(screen.queryByText(/market closed/i)).toBeNull();
    expect(screen.queryByRole('columnheader', { name: /^Last update$/ })).toBeNull();

    await oneBeat();

    expect(screen.getByTestId('board-updated-at').textContent).toMatch(/updated \d{2}:\d{2}:\d{2}/);
    // The columns still fill the row without a "Last update" column.
    const widths = Array.from(document.querySelectorAll<HTMLTableColElement>('colgroup col')).map(
      (col) => Number.parseFloat(col.style.width),
    );
    expect(widths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(100, 5);
  });

  it('once closed: a status (not an alert) counting down to the next open, and no update time', async () => {
    await renderAt(AFTER_CLOSE);
    const banner = screen.getByText(/market closed/i).closest('[role="status"]');
    expect(banner?.textContent).toMatch(/Reopens Sun 10:00 AM Cairo time, in 2d 18h\./);
    expect(screen.queryByRole('alert')).toBeNull();

    await oneBeat();
    expect(screen.queryByTestId('board-updated-at')).toBeNull();
  });
});
