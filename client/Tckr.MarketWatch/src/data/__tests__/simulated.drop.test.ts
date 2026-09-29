/**
 * `SimulatedSource.simulateDrop` walks the same close → reconnect path a real gateway
 * drop would: recoverable codes back off and reconnect with a new session, a terminal
 * code stays closed, and the jitter comes from the seeded PRNG.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloseCode } from '../../contracts/closeCodes.ts';
import type { ConnectionState } from '../MarketDataSource.ts';
import { SimulatedSource } from '../SimulatedSource.ts';
import { resetStore } from '../store.ts';
import { baseConfig, KNOWN_OPEN_NOW_MS } from './testSupport.ts';

async function droppedSource(code: CloseCode, seed?: number) {
  const source = new SimulatedSource(baseConfig(seed === undefined ? {} : { seed }));
  await source.connect();
  const sessionId = source.identity()?.sessionId;
  const states: ConnectionState[] = [];
  source.on.status((s) => states.push(s));
  source.simulateDrop(code);
  return { source, sessionId, states };
}

describe('SimulatedSource.simulateDrop', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(KNOWN_OPEN_NOW_MS);
    resetStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([CloseCode.TokenExpired, CloseCode.HeartbeatTimeout, CloseCode.SlowConsumer])(
    'recovers from %i: closed, reconnecting, then connected on a new session',
    async (code) => {
      const { source, sessionId, states } = await droppedSource(code);
      expect(states[0]).toEqual({ kind: 'closed', code, reason: 'simulated drop' });
      const reconnecting = states[1];
      if (reconnecting?.kind !== 'reconnecting') throw new Error('expected reconnecting');

      await vi.advanceTimersByTimeAsync(reconnecting.nextRetryMs + 10);

      expect(states.map((s) => s.kind).slice(2)).toEqual(['connecting', 'connected']);
      expect(source.identity()?.sessionId).not.toBe(sessionId);
      source.disconnect();
    },
  );

  it('stays closed after a terminal 4401, with no retry ever scheduled', async () => {
    const { source, states } = await droppedSource(CloseCode.Unauthenticated);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(states).toEqual([
      { kind: 'closed', code: CloseCode.Unauthenticated, reason: 'simulated drop' },
    ]);
    source.disconnect();
  });

  it('is a no-op before the source ever connected', () => {
    const source = new SimulatedSource(baseConfig());
    const states: ConnectionState[] = [];
    source.on.status((s) => states.push(s));
    source.simulateDrop(CloseCode.HeartbeatTimeout);
    expect(states).toHaveLength(0);
  });

  it('draws reconnect jitter from the seeded PRNG: same seed, same delay', async () => {
    const a = await droppedSource(CloseCode.SlowConsumer, 42);
    const b = await droppedSource(CloseCode.SlowConsumer, 42);
    a.source.disconnect();
    b.source.disconnect();
    expect(a.states[1]).toEqual(b.states[1]);
  });
});
