/**
 * `status.live-region-quiet.test.tsx` — critique 2026-09-27: the connection pill is a
 * `role="status"` live region, and its elapsed time / retry countdown changed every
 * second, so a screen reader announced "Connected · 7s", "Connected · 8s", ... The
 * ticking numbers stay on screen but are hidden from assistive tech; what the region
 * exposes changes only when the connection state does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { createFakeSource, fakeIdentity } from './testSupport.ts';

vi.mock('../../data/config.ts', () => ({
  getSharedSource: vi.fn(),
  resolveClientConfig: vi.fn(),
}));

import { getSharedSource } from '../../data/config.ts';
import { ConnectionStatus } from '../ConnectionStatus.tsx';

/** The live region's text as assistive tech reads it: everything outside
 * `aria-hidden` subtrees. */
function announcedText(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  clone.querySelectorAll('[aria-hidden="true"]').forEach((hidden) => hidden.remove());
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ConnectionStatus — live region stays quiet between state changes', () => {
  it('does not change what it announces as the connected time ticks', () => {
    const source = createFakeSource(fakeIdentity());
    vi.mocked(getSharedSource).mockReturnValue(source);
    render(<ConnectionStatus />);

    act(() => {
      source.emitStatus({ kind: 'connected', since: Date.now() });
    });
    const region = screen.getByRole('status');
    const before = announcedText(region);
    expect(before).toBe('Connected');

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(announcedText(region)).toBe(before);
  });

  it('announces the reconnect attempt, not the per-second countdown', () => {
    const source = createFakeSource(fakeIdentity());
    vi.mocked(getSharedSource).mockReturnValue(source);
    render(<ConnectionStatus />);

    act(() => {
      source.emitStatus({ kind: 'reconnecting', attempt: 2, nextRetryMs: 5000 });
    });
    const region = screen.getByRole('status');
    expect(announcedText(region)).toBe('Reconnecting, attempt 2');

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(announcedText(region)).toBe('Reconnecting, attempt 2');
    // Sighted users still see the countdown.
    expect(screen.getByTestId('connection-status').textContent).toBe(
      'Reconnecting in 3s (attempt 2)',
    );
  });
});
