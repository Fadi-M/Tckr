import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { CloseCode } from '../../contracts/closeCodes.ts';
import { createFakeSource, fakeIdentity } from './testSupport.ts';

vi.mock('../../data/config.ts', () => ({
  getSharedSource: vi.fn(),
  resolveClientConfig: vi.fn(),
}));

import { getSharedSource } from '../../data/config.ts';
import { ConnectionStatus } from '../ConnectionStatus.tsx';

afterEach(cleanup);

describe('ConnectionStatus — seeding from connectionState()', () => {
  it('seeds directly from connectionState() at first paint when the source implements it', () => {
    const source = createFakeSource(fakeIdentity(), {
      connectionState: { kind: 'reconnecting', attempt: 3, nextRetryMs: 4000 },
    });
    vi.mocked(getSharedSource).mockReturnValue(source);

    render(<ConnectionStatus />);

    // No `on.status` event was ever emitted — this is what the very first render shows.
    expect(screen.getByTestId('connection-status').textContent).toBe('Reconnecting in 4s (attempt 3)');
  });

  it('reflects the "closed then reconnecting in the same call" detail: a read right after a reconnectable drop is reconnecting, not closed', () => {
    // Mirrors TckrGatewaySource's documented behaviour: after a reconnectable close it
    // transitions to `reconnecting` synchronously in the same call that emits `closed`,
    // so `connectionState()` never observably returns the intermediate `closed` for a
    // recoverable code.
    const source = createFakeSource(fakeIdentity(), {
      connectionState: { kind: 'reconnecting', attempt: 1, nextRetryMs: 500 },
    });
    vi.mocked(getSharedSource).mockReturnValue(source);

    render(<ConnectionStatus />);
    expect(screen.getByTestId('connection-status').textContent).toBe('Reconnecting in 1s (attempt 1)');
  });

  it('seeds a terminal closed state (4401) directly, with no auto-retry implied', () => {
    const source = createFakeSource(fakeIdentity(), {
      connectionState: { kind: 'closed', code: CloseCode.Unauthenticated, reason: 'bad token' },
    });
    vi.mocked(getSharedSource).mockReturnValue(source);

    render(<ConnectionStatus />);
    expect(screen.getByTestId('connection-status').textContent).toBe('Not authenticated — sign in again');
  });

  it('falls back to the identity()-based proxy when the source has no connectionState()', () => {
    const connectedSource = createFakeSource(fakeIdentity());
    vi.mocked(getSharedSource).mockReturnValue(connectedSource);
    expect(connectedSource.connectionState).toBeUndefined();

    render(<ConnectionStatus />);
    expect(screen.getByTestId('connection-status').textContent).toMatch(/^Connected/);
  });

  it('falls back to "connecting" when neither connectionState() nor identity() is available', () => {
    const source = createFakeSource(null);
    vi.mocked(getSharedSource).mockReturnValue(source);

    render(<ConnectionStatus />);
    expect(screen.getByTestId('connection-status').textContent).toBe('Connecting…');
  });
});
