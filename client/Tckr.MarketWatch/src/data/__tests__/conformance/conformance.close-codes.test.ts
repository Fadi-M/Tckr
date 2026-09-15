/**
 * All four abnormal close codes (client-contract.md §3.4) produce the right
 * `ConnectionState` and the right reconnect decision:
 *   - `4401` unauthenticated → closed, no reconnect (a bad token loops forever otherwise)
 *   - `4403` token expired    → closed, then reconnects
 *   - `4408` heartbeat timeout → closed, then reconnects
 *   - `4429` slow consumer    → closed, then reconnects
 * `1000` (normal) is included for contrast: closed, no reconnect.
 *
 * "Reconnects" is asserted as a subsequent `reconnecting` `ConnectionState` with the
 * exact attempt-1 backoff delay (500ms, since this harness's injected `random` is a
 * constant `0.5` — see `nextDelay`'s formula in `reconnect.ts`).
 *
 * Also covers `connectionState()` — the synchronous "current status" getter task 07
 * asked for (optional on `MarketDataSource`, implemented here as a real, always-present
 * method): it must answer with exactly what `on.status` last emitted, for a `connected`
 * state, for each abnormal close, and during the reconnect wait.
 */
import { describe, expect, it, vi } from 'vitest';
import { CloseCode } from '../../../contracts/closeCodes.ts';
import type { ConnectionState } from '../../MarketDataSource.ts';
import { connectAndAuthenticate, createHarness } from './gatewayHarness.ts';

interface CaseSpec {
  readonly code: number;
  readonly reason: string;
  readonly shouldReconnect: boolean;
}

const CASES: readonly CaseSpec[] = [
  { code: CloseCode.Unauthenticated, reason: 'invalid token', shouldReconnect: false },
  { code: CloseCode.TokenExpired, reason: 'token expired mid-session', shouldReconnect: true },
  { code: CloseCode.HeartbeatTimeout, reason: 'heartbeat timeout', shouldReconnect: true },
  { code: CloseCode.SlowConsumer, reason: 'client fell behind', shouldReconnect: true },
  { code: CloseCode.Normal, reason: 'server shutdown', shouldReconnect: false },
];

describe('gateway close-code conformance', () => {
  it.each(CASES)('code $code → closed state, shouldReconnect=$shouldReconnect', async ({ code, reason, shouldReconnect }) => {
    vi.useFakeTimers();
    try {
      const harness = createHarness();
      const socket = await connectAndAuthenticate(harness);
      const statuses: ConnectionState[] = [];
      harness.source.on.status((s) => statuses.push(s));

      socket.serverClose(code, reason);

      const closedStates = statuses.filter((s) => s.kind === 'closed');
      expect(closedStates).toHaveLength(1);
      expect(closedStates[0]).toEqual({ kind: 'closed', code, reason });
      // For a non-reconnecting code, connectionState() still reads 'closed' right
      // after the close (no follow-up transition is coming). For a reconnecting code,
      // `#handleClose` decides and emits 'reconnecting' synchronously in the same
      // call — connectionState() has therefore already moved past 'closed' by the
      // time serverClose() returns, which the `shouldReconnect` branch below checks.
      if (!shouldReconnect) {
        expect(harness.source.connectionState()).toEqual({ kind: 'closed', code, reason });
      }

      await vi.advanceTimersByTimeAsync(0);
      const reconnecting = statuses.filter((s) => s.kind === 'reconnecting');
      if (shouldReconnect) {
        expect(reconnecting).toHaveLength(1);
        expect(reconnecting[0]).toMatchObject({ kind: 'reconnecting', attempt: 1, nextRetryMs: 500 });
        expect(harness.source.connectionState()).toEqual(reconnecting[0]);
      } else {
        expect(reconnecting).toHaveLength(0);
        // No reconnect was scheduled — connectionState() still reports the closed state.
        expect(harness.source.connectionState()).toEqual({ kind: 'closed', code, reason });
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("connectionState() reports 'connected' synchronously right after authentication, matching the last on.status emission", async () => {
    const harness = createHarness();
    const statuses: ConnectionState[] = [];
    harness.source.on.status((s) => statuses.push(s));
    await connectAndAuthenticate(harness);

    const lastEmitted = statuses[statuses.length - 1];
    expect(lastEmitted?.kind).toBe('connected');
    expect(harness.source.connectionState()).toEqual(lastEmitted);
  });

  it("connectionState() reports a closed state before connect() has ever been called", () => {
    const harness = createHarness();
    expect(harness.source.connectionState().kind).toBe('closed');
  });

  it('an unmapped close code (e.g. a proxy-level 1006) is still treated as reconnectable', async () => {
    vi.useFakeTimers();
    try {
      const harness = createHarness();
      const socket = await connectAndAuthenticate(harness);
      const statuses: ConnectionState[] = [];
      harness.source.on.status((s) => statuses.push(s));

      socket.serverClose(1006, '');
      await vi.advanceTimersByTimeAsync(0);

      expect(statuses.some((s) => s.kind === 'closed' && (s.code as number) === 1006)).toBe(true);
      expect(statuses.some((s) => s.kind === 'reconnecting')).toBe(true);
      expect(harness.source.connectionState().kind).toBe('reconnecting');
    } finally {
      vi.useRealTimers();
    }
  });

  it('an intentional client disconnect() never reconnects, even on an otherwise-reconnectable code path', async () => {
    vi.useFakeTimers();
    try {
      const harness = createHarness();
      await connectAndAuthenticate(harness);
      const statuses: ConnectionState[] = [];
      harness.source.on.status((s) => statuses.push(s));

      harness.source.disconnect();
      await vi.advanceTimersByTimeAsync(60_000);

      expect(statuses.some((s) => s.kind === 'reconnecting')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
