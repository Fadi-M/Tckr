/**
 * `ConnectionStatus` while EGX isn't trading: the socket is healthy but nothing
 * streams, so the pill steps down to neutral — its dot included. A green dot beside
 * "Market closed" read as "trades are moving" (critique 2026-09-26).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { cairoEpochFor } from '../../data/marketCalendar.ts';
import { createFakeSource, fakeIdentity } from './testSupport.ts';

vi.mock('../../data/config.ts', () => ({
  getSharedSource: vi.fn(),
  resolveClientConfig: vi.fn(),
}));

import { getSharedSource } from '../../data/config.ts';
import { ConnectionStatus } from '../ConnectionStatus.tsx';

function renderConnectedAt(nowMs: number): HTMLElement {
  vi.setSystemTime(nowMs);
  vi.mocked(getSharedSource).mockReturnValue(
    createFakeSource(fakeIdentity(), { connectionState: { kind: 'connected', since: nowMs } }),
  );
  render(<ConnectionStatus />);
  return screen.getByRole('status').querySelector<HTMLElement>('[aria-hidden="true"]')!;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ConnectionStatus dot while EGX is closed', () => {
  it('is green while EGX trades', () => {
    const dot = renderConnectedAt(cairoEpochFor('2026-01-15', 12, 0));
    expect(dot.className).toContain('bg-up');
  });

  it('goes neutral, like the pill, once EGX has closed', () => {
    const dot = renderConnectedAt(cairoEpochFor('2026-01-15', 16, 0));
    expect(dot.className).toContain('bg-text-muted');
    expect(dot.className).not.toContain('bg-up');
  });
});
