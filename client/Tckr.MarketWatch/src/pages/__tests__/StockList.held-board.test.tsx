/**
 * Stale is visible: while the stream is down the board's caption carries a HELD tag with
 * the instant it dropped, and that instant survives a failed retry instead of resetting.
 * Held prices keep full contrast (no dimming), and the tag goes when the stream is back.
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { formatCairoClock } from '../../data/marketCalendar.ts';
import { resetStore } from '../../data/store.ts';
import { loadUniverseFixture, makeFakeSource, renderBoard } from './testSupport.tsx';

vi.mock('../../data/config.ts');

describe('StockList held board', () => {
  beforeEach(() => {
    resetStore();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-24T09:31:05Z'));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('marks the board HELD since the first drop, across a failed retry, undimmed, until reconnected', async () => {
    const fake = makeFakeSource(loadUniverseFixture(), {
      connectionState: { kind: 'connected', since: Date.now() },
    });
    await renderBoard({ source: fake.source });
    expect(screen.queryByTestId('board-held')).toBeNull();
    const droppedAt = Date.now();

    act(() => fake.emitStatus({ kind: 'reconnecting', attempt: 1, nextRetryMs: 1000 }));
    vi.setSystemTime(droppedAt + 7000);
    act(() => fake.emitStatus({ kind: 'reconnecting', attempt: 2, nextRetryMs: 2000 }));

    const held = screen.getByTestId('board-held');
    expect(held.textContent).toContain('Held');
    expect(held.textContent).toContain(`since ${formatCairoClock(droppedAt)}`);
    expect(screen.getByRole('grid', { name: 'Instruments' }).parentElement?.className).not.toMatch(
      /opacity-/,
    );

    act(() => fake.emitStatus({ kind: 'connected', since: Date.now() }));
    expect(screen.queryByTestId('board-held')).toBeNull();
  });
});
