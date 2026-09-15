import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { CloseCode, type CloseCode as CloseCodeType } from '../../contracts/closeCodes.ts';
import { createFakeSource, fakeIdentity } from './testSupport.ts';

vi.mock('../../data/config.ts', () => ({
  getSharedSource: vi.fn(),
  resolveClientConfig: vi.fn(),
}));

import { getSharedSource } from '../../data/config.ts';
import { ConnectionStatus } from '../ConnectionStatus.tsx';

afterEach(cleanup);

describe('ConnectionStatus — close codes', () => {
  it('renders five distinct, actionable messages, one per close code, and 4429 names the remedy', () => {
    const source = createFakeSource(fakeIdentity());
    vi.mocked(getSharedSource).mockReturnValue(source);

    render(<ConnectionStatus />);

    const codes = [
      CloseCode.Normal,
      CloseCode.Unauthenticated,
      CloseCode.TokenExpired,
      CloseCode.HeartbeatTimeout,
      CloseCode.SlowConsumer,
    ] as const;

    const messages = new Set<string>();
    for (const code of codes) {
      act(() => {
        source.emitStatus({ kind: 'closed', code, reason: 'test' });
      });
      messages.add(screen.getByTestId('connection-status').textContent ?? '');
    }

    expect(messages.size).toBe(5);

    act(() => {
      source.emitStatus({ kind: 'closed', code: CloseCode.SlowConsumer, reason: 'test' });
    });
    const slowConsumerText = screen.getByTestId('connection-status').textContent ?? '';
    expect(slowConsumerText.toLowerCase()).toContain('fewer symbols');

    act(() => {
      source.emitStatus({ kind: 'closed', code: CloseCode.Unauthenticated, reason: 'test' });
    });
    expect(screen.getByTestId('connection-status').textContent).toBe('Not authenticated — sign in again');
  });

  it('maps each code to exactly the specified string', () => {
    const source = createFakeSource(fakeIdentity());
    vi.mocked(getSharedSource).mockReturnValue(source);
    render(<ConnectionStatus />);

    const expectations: ReadonlyArray<readonly [CloseCodeType, string]> = [
      [CloseCode.Normal, 'Disconnected'],
      [CloseCode.Unauthenticated, 'Not authenticated — sign in again'],
      [CloseCode.TokenExpired, 'Session expired — reconnecting'],
      [CloseCode.HeartbeatTimeout, 'Connection timed out — reconnecting'],
      [
        CloseCode.SlowConsumer,
        'Disconnected: this client fell behind. Try watching fewer symbols.',
      ],
    ];

    for (const [code, expected] of expectations) {
      act(() => {
        source.emitStatus({ kind: 'closed', code, reason: 'test' });
      });
      expect(screen.getByTestId('connection-status').textContent).toBe(expected);
    }
  });
});
