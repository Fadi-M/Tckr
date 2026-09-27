/**
 * `StockList.held-board.test.tsx` — the board marks held prices where they are, not only
 * in the connection banner: while the stream is `reconnecting`/`closed`, the table's
 * caption carries a HELD tag with the instant the stream dropped, and that instant
 * survives a failed retry (a second `reconnecting` event) instead of resetting to it.
 * Held prices keep full contrast (no dimming class on the table card).
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { formatCairoClock } from '../../data/marketCalendar.ts';
import { resetStore } from '../../data/store.ts';
import { loadUniverseFixture, makeFakeSource } from './testSupport.ts';

const { mockGetSharedSource } = vi.hoisted(() => ({ mockGetSharedSource: vi.fn() }));
vi.mock('../../data/config.ts', () => ({
  getSharedSource: mockGetSharedSource,
  reconnectSharedSource: vi.fn(),
}));

import { StockList } from '../StockList.tsx';

async function renderConnectedList() {
  const handle = makeFakeSource(loadUniverseFixture(), { connectionState: { kind: 'connected', since: Date.now() } });
  mockGetSharedSource.mockReturnValue(handle.source);
  render(
    <MemoryRouter>
      <StockList />
    </MemoryRouter>,
  );
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return handle;
}

describe('StockList held board', () => {
  beforeEach(() => {
    resetStore();
    mockGetSharedSource.mockReset();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-24T09:31:05Z'));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('shows no HELD marker while connected', async () => {
    await renderConnectedList();
    expect(screen.queryByTestId('board-held')).toBeNull();
  });

  it('marks the board HELD since the first drop, keeps that instant across a failed retry, and never dims it', async () => {
    const { emitStatus } = await renderConnectedList();
    const droppedAt = Date.now();

    act(() => emitStatus({ kind: 'reconnecting', attempt: 1, nextRetryMs: 1000 }));
    vi.setSystemTime(droppedAt + 7000);
    act(() => emitStatus({ kind: 'reconnecting', attempt: 2, nextRetryMs: 2000 }));

    const held = screen.getByTestId('board-held');
    expect(held.textContent).toContain('Held');
    expect(held.textContent).toContain(`since ${formatCairoClock(droppedAt)}`);
    expect(screen.getByRole('grid', { name: 'Instruments' }).parentElement?.className).not.toMatch(/opacity-/);

    act(() => emitStatus({ kind: 'connected', since: Date.now() }));
    expect(screen.queryByTestId('board-held')).toBeNull();
  });
});
