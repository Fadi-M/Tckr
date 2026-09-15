import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { createFakeSource, fakeIdentity } from './testSupport.ts';

vi.mock('../../data/config.ts', () => ({
  getSharedSource: vi.fn(),
  resolveClientConfig: vi.fn(),
}));

import { getSharedSource } from '../../data/config.ts';
import { ConnectionStatus } from '../ConnectionStatus.tsx';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ConnectionStatus — reconnecting countdown', () => {
  it('counts down once per second and never updates faster than that', () => {
    const source = createFakeSource(fakeIdentity());
    vi.mocked(getSharedSource).mockReturnValue(source);

    render(<ConnectionStatus />);

    act(() => {
      source.emitStatus({ kind: 'reconnecting', attempt: 1, nextRetryMs: 5000 });
    });
    expect(screen.getByTestId('connection-status').textContent).toBe('Reconnecting in 5s (attempt 1)');

    // Well under one second: must not have changed yet.
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.getByTestId('connection-status').textContent).toBe('Reconnecting in 5s (attempt 1)');

    act(() => {
      vi.advanceTimersByTime(600); // total 1000ms
    });
    expect(screen.getByTestId('connection-status').textContent).toBe('Reconnecting in 4s (attempt 1)');

    act(() => {
      vi.advanceTimersByTime(1000); // total 2000ms
    });
    expect(screen.getByTestId('connection-status').textContent).toBe('Reconnecting in 3s (attempt 1)');

    act(() => {
      vi.advanceTimersByTime(3000); // total 5000ms — countdown floors at 0, not negative
    });
    expect(screen.getByTestId('connection-status').textContent).toBe('Reconnecting in 0s (attempt 1)');
  });

  it('a new reconnecting event (a fresh attempt) restarts the countdown from its own nextRetryMs', () => {
    const source = createFakeSource(fakeIdentity());
    vi.mocked(getSharedSource).mockReturnValue(source);

    render(<ConnectionStatus />);

    act(() => {
      source.emitStatus({ kind: 'reconnecting', attempt: 1, nextRetryMs: 1000 });
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByTestId('connection-status').textContent).toBe('Reconnecting in 0s (attempt 1)');

    act(() => {
      source.emitStatus({ kind: 'reconnecting', attempt: 2, nextRetryMs: 2000 });
    });
    expect(screen.getByTestId('connection-status').textContent).toBe('Reconnecting in 2s (attempt 2)');
  });

  it('shows elapsed connected time, also throttled to once per second', () => {
    const source = createFakeSource(fakeIdentity());
    vi.mocked(getSharedSource).mockReturnValue(source);

    render(<ConnectionStatus />);

    act(() => {
      source.emitStatus({ kind: 'connected', since: Date.now() });
    });
    expect(screen.getByTestId('connection-status').textContent).toBe('Connected · 0s');

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByTestId('connection-status').textContent).toBe('Connected · 1s');
  });
});
