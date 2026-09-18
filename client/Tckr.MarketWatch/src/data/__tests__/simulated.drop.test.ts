import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloseCode } from '../../contracts/closeCodes.ts';
import type { ConnectionState } from '../MarketDataSource.ts';
import { SimulatedSource } from '../SimulatedSource.ts';
import { resetStore } from '../store.ts';
import { baseConfig, KNOWN_OPEN_NOW_MS } from './testSupport.ts';

describe('SimulatedSource.simulateDrop', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Pinned to a known-open EGX instant — see KNOWN_OPEN_NOW_MS's doc. Not load-bearing
    // for most assertions here (connection lifecycle, not price data), but `connect()`
    // now backfills on every call, so a deterministic `now` keeps this suite's timing
    // assertions (delay/jitter) independent of real wall-clock time too.
    vi.setSystemTime(KNOWN_OPEN_NOW_MS);
    resetStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits closed then schedules a reconnect for a recoverable code (4408 HeartbeatTimeout)', async () => {
    const source = new SimulatedSource(baseConfig());
    await source.connect();
    const initialSessionId = source.identity()?.sessionId;

    const states: ConnectionState[] = [];
    source.on.status((s) => states.push(s));

    source.simulateDrop(CloseCode.HeartbeatTimeout);

    expect(states[0]).toEqual({ kind: 'closed', code: CloseCode.HeartbeatTimeout, reason: 'simulated drop' });
    expect(states[1]?.kind).toBe('reconnecting');

    const reconnecting = states[1];
    const delay = reconnecting && reconnecting.kind === 'reconnecting' ? reconnecting.nextRetryMs : 0;
    await vi.advanceTimersByTimeAsync(delay + 10);

    expect(states.some((s) => s.kind === 'connecting')).toBe(true);
    expect(states.some((s) => s.kind === 'connected')).toBe(true);
    expect(source.identity()?.sessionId).not.toBe(initialSessionId);

    source.disconnect();
  });

  it('does not schedule a reconnect for a terminal code (4401 Unauthenticated)', async () => {
    const source = new SimulatedSource(baseConfig());
    await source.connect();

    const states: ConnectionState[] = [];
    source.on.status((s) => states.push(s));

    source.simulateDrop(CloseCode.Unauthenticated);

    expect(states).toEqual([{ kind: 'closed', code: CloseCode.Unauthenticated, reason: 'simulated drop' }]);

    await vi.advanceTimersByTimeAsync(60000);
    expect(states).toHaveLength(1); // no reconnecting/connecting ever follows

    source.disconnect();
  });

  it('recovers automatically for 4403 (token expired) and 4429 (slow consumer)', async () => {
    for (const code of [CloseCode.TokenExpired, CloseCode.SlowConsumer] as const) {
      const source = new SimulatedSource(baseConfig());
      await source.connect();
      const states: ConnectionState[] = [];
      source.on.status((s) => states.push(s));

      source.simulateDrop(code);
      const reconnecting = states[1];
      const delay = reconnecting && reconnecting.kind === 'reconnecting' ? reconnecting.nextRetryMs : 0;
      await vi.advanceTimersByTimeAsync(delay + 10);

      expect(states.some((s) => s.kind === 'connected')).toBe(true);
      source.disconnect();
    }
  });

  it('is a no-op when the source was never connected', () => {
    const source = new SimulatedSource(baseConfig());
    const states: ConnectionState[] = [];
    source.on.status((s) => states.push(s));
    source.simulateDrop(CloseCode.HeartbeatTimeout);
    expect(states).toHaveLength(0);
  });

  it('draws reconnect jitter from the seeded PRNG: same seed, same delay', async () => {
    const a = new SimulatedSource(baseConfig({ seed: 42 }));
    await a.connect();
    const statesA: ConnectionState[] = [];
    a.on.status((s) => statesA.push(s));
    a.simulateDrop(CloseCode.SlowConsumer);
    a.disconnect();

    const b = new SimulatedSource(baseConfig({ seed: 42 }));
    await b.connect();
    const statesB: ConnectionState[] = [];
    b.on.status((s) => statesB.push(s));
    b.simulateDrop(CloseCode.SlowConsumer);
    b.disconnect();

    expect(statesA[1]).toEqual(statesB[1]);
  });
});
