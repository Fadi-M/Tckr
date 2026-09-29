/**
 * The connection pill's first paint. `getSharedSource()` connects before any component
 * subscribes to `on.status`, so the pill seeds from `connectionState()` when the source
 * has it, else from `identity()` (connected once the server has said who we are), else
 * shows "Connecting…".
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { CloseCode } from '../../contracts/closeCodes.ts';
import { createFakeSource, fakeIdentity } from './testSupport.ts';

vi.mock('../../data/config.ts');

import { getSharedSource } from '../../data/config.ts';
import { ConnectionStatus } from '../ConnectionStatus.tsx';

afterEach(cleanup);

describe('ConnectionStatus — first paint', () => {
  it.each([
    [
      { kind: 'reconnecting', attempt: 3, nextRetryMs: 4000 } as const,
      'Reconnecting in 4s (attempt 3)',
    ],
    [
      { kind: 'closed', code: CloseCode.Unauthenticated, reason: 'bad token' } as const,
      'Not authenticated — sign in again',
    ],
  ])('seeds from connectionState() %j', (connectionState, expected) => {
    vi.mocked(getSharedSource).mockReturnValue(
      createFakeSource(fakeIdentity(), { connectionState }),
    );
    render(<ConnectionStatus />);
    expect(screen.getByTestId('connection-status').textContent).toBe(expected);
  });

  it('falls back to identity() without connectionState(), and to "Connecting…" without either', () => {
    vi.mocked(getSharedSource).mockReturnValue(createFakeSource(fakeIdentity()));
    render(<ConnectionStatus />);
    expect(screen.getByTestId('connection-status').textContent).toMatch(/^Connected/);
    cleanup();

    vi.mocked(getSharedSource).mockReturnValue(createFakeSource(null));
    render(<ConnectionStatus />);
    expect(screen.getByTestId('connection-status').textContent).toBe('Connecting…');
  });
});
