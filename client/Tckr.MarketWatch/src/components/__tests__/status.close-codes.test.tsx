/**
 * Each close code (client-contract.md §3.4) gets its own actionable message in the
 * connection pill, so a trader can tell a shutdown from a bad token from falling behind,
 * and 4429 names the remedy.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { CloseCode } from '../../contracts/closeCodes.ts';
import { createFakeSource, fakeIdentity } from './testSupport.ts';

vi.mock('../../data/config.ts');

import { getSharedSource } from '../../data/config.ts';
import { ConnectionStatus } from '../ConnectionStatus.tsx';

afterEach(cleanup);

describe('ConnectionStatus — close codes', () => {
  it('maps each close code to its own message', () => {
    const source = createFakeSource(fakeIdentity());
    vi.mocked(getSharedSource).mockReturnValue(source);
    render(<ConnectionStatus />);

    const shown = [
      CloseCode.Normal,
      CloseCode.Unauthenticated,
      CloseCode.TokenExpired,
      CloseCode.HeartbeatTimeout,
      CloseCode.SlowConsumer,
    ].map((code) => {
      act(() => source.emitStatus({ kind: 'closed', code, reason: 'test' }));
      return screen.getByTestId('connection-status').textContent;
    });

    expect(shown).toEqual([
      'Disconnected',
      'Not authenticated — sign in again',
      'Session expired — reconnecting',
      'Connection timed out — reconnecting',
      'Disconnected: this client fell behind. Try watching fewer symbols.',
    ]);
  });
});
